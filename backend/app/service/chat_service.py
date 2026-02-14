

import asyncio
import datetime
import logging
import os
import platform
from pathlib import Path
from typing import Any

from camel.models import ModelProcessingError
from camel.tasks import Task
from camel.toolkits import ToolkitMessageIntegration
from camel.types import ModelPlatformType
from fastapi import Request
from inflection import titleize
from pydash import chain

from app.agent.agent_model import agent_model
from app.agent.factory import (
    browser_agent,
    developer_agent,
    document_agent,
    multi_modal_agent,
    question_confirm_agent,
    task_summary_agent,
)
from app.agent.listen_chat_agent import ListenChatAgent
from app.agent.toolkit.human_toolkit import HumanToolkit
from app.agent.toolkit.note_taking_toolkit import NoteTakingToolkit
from app.agent.toolkit.terminal_toolkit import TerminalToolkit
from app.agent.tools import get_mcp_tools, get_toolkits
from app.model.chat import Chat, NewAgent, Status, sse_json
from app.service.task import (
    Action,
    ActionDecomposeProgressData,
    ActionDecomposeTextData,
    ActionImproveData,
    Agents,
    TaskLock,
    delete_task_lock,
    set_current_task_id,
)
from app.utils.event_loop_utils import set_main_event_loop
from app.utils.file_utils import get_working_directory
from app.utils.workforce import Workforce

logger = logging.getLogger("chat_service")
MAX_CONVERSATION_CONTEXT_LENGTH = 100000

async def step_solve(options: Chat, request: Request, task_lock: TaskLock):
    """Main task execution loop. Called when POST /chat endpoint
    is hit to start a new chat session.

    Processes task queue, manages workforce lifecycle, and streams
    responses back to the client via SSE.

    Args:
        options (Chat): Chat configuration containing task details and
            model settings.
        request (Request): FastAPI request object for client connection
            management.
        task_lock (TaskLock): Shared task state and queue for the project.

    Yields:
        SSE formatted responses for task progress, errors, and results
    """
    start_event_loop = True

    # Initialize task_lock attributes
    if not hasattr(task_lock, "conversation_history"):
        task_lock.conversation_history = []
    if not hasattr(task_lock, "last_task_result"):
        task_lock.last_task_result = ""
    if not hasattr(task_lock, "question_agent"):
        task_lock.question_agent = None
    if not hasattr(task_lock, "summary_generated"):
        task_lock.summary_generated = False

    # Create or reuse persistent question_agent
    if task_lock.question_agent is None:
        task_lock.question_agent = question_confirm_agent(options)
    else:
        hist_len = len(task_lock.conversation_history)
        logger.debug(
            f"Reusing existing question_agent with {hist_len} history entries"
        )

    question_agent = task_lock.question_agent

    # Other variables
    camel_task = None
    workforce = None
    mcp = None
    last_completed_task_result = ""  # Track the last completed task result
    summary_task_content = ""  # Track task summary
    loop_iteration = 0
    event_loop = asyncio.get_running_loop()
    sub_tasks: list[Task] = []

    logger.info("=" * 80)
    logger.info(
        "🚀 [LIFECYCLE] step_solve STARTED",
        extra={"project_id": options.project_id, "task_id": options.task_id},
    )
    logger.info("=" * 80)
    logger.debug(
        "Step solve options",
        extra={
            "task_id": options.task_id,
            "model_platform": options.model_platform,
        },
    )

    while True:
        loop_iteration += 1
        logger.debug(
            f"[LIFECYCLE] step_solve loop iteration #{loop_iteration}",
            extra={
                "project_id": options.project_id,
                "task_id": options.task_id,
            },
        )

        if await request.is_disconnected():
            logger.warning("=" * 80)
            logger.warning(
                "[LIFECYCLE] CLIENT DISCONNECTED "
                f"for project {options.project_id}"
            )
            logger.warning("=" * 80)
            if workforce is not None:
                logger.info(
                    "[LIFECYCLE] Stopping workforce "
                    "due to client disconnect, "
                    "workforce._running="
                    f"{workforce._running}"
                )
                if workforce._running:
                    workforce.stop()
                workforce.stop_gracefully()
                logger.info(
                    "[LIFECYCLE] Workforce stopped after client disconnect"
                )
            else:
                logger.info("[LIFECYCLE] Workforce is None, no need to stop")
            task_lock.status = Status.done
            try:
                await delete_task_lock(task_lock.id)
                logger.info(
                    "[LIFECYCLE] Task lock deleted after client disconnect"
                )
            except Exception as e:
                logger.error(f"Error deleting task lock on disconnect: {e}")
            logger.info(
                "[LIFECYCLE] Breaking out of "
                "step_solve loop due to "
                "client disconnect"
            )
            break
        try:
            item = await task_lock.get_queue()
        except Exception as e:
            logger.error(
                "Error getting item from queue",
                extra={
                    "project_id": options.project_id,
                    "task_id": options.task_id,
                    "error": str(e),
                },
                exc_info=True,
            )
            # Continue waiting instead of breaking on queue error
            continue

        conv_ctx = build_conversation_context(
            task_lock, header="=== Conversation Context ==="
        )
        total_length = len(conv_ctx)
        is_exceeded = total_length > MAX_CONVERSATION_CONTEXT_LENGTH
        context_for_coordinator = conv_ctx

        try:
            if item.action == Action.improve or start_event_loop:
                logger.info("=" * 80)
                logger.info(
                    "[NEW-QUESTION] Action.improve "
                    "received or start_event_loop",
                    extra={
                        "project_id": options.project_id,
                        "start_event_loop": start_event_loop,
                    },
                )
                wf_state = (
                    "None"
                    if workforce is None
                    else f"exists(id={id(workforce)})"
                )
                logger.info(
                    "[NEW-QUESTION] Current workforce"
                    f" state: workforce={wf_state}"
                )
                ct_state = (
                    "None"
                    if camel_task is None
                    else f"exists(id={camel_task.id})"
                )
                logger.info(
                    "[NEW-QUESTION] Current "
                    "camel_task state: "
                    f"camel_task={ct_state}"
                )
                logger.info("=" * 80)
                # from viztracer import VizTracer

                # tracer = VizTracer()
                # tracer.start()
                if start_event_loop is True:
                    question = options.question
                    attaches_to_use = options.attaches
                    logger.info(
                        "[NEW-QUESTION] Initial question"
                        " from options.question: "
                        f"'{question[:100]}...'"
                    )
                    start_event_loop = False
                else:
                    assert isinstance(item, ActionImproveData)
                    question = item.data.question
                    attaches_to_use = (
                        item.data.attaches
                        if item.data.attaches
                        else options.attaches
                    )
                    logger.info(
                        "[NEW-QUESTION] Follow-up "
                        "question from "
                        "ActionImproveData: "
                        f"'{question[:100]}...'"
                    )

                if is_exceeded:
                    logger.error(
                        "Conversation history too long",
                        extra={
                            "project_id": options.project_id,
                            "current_length": total_length,
                            "max_length": MAX_CONVERSATION_CONTEXT_LENGTH,
                        },
                    )
                    ctx_msg = (
                        "The conversation history "
                        "is too long. Please create"
                        " a new project to continue."
                    )
                    yield sse_json(
                        "context_too_long",
                        {
                            "message": ctx_msg,
                            "current_length": total_length,
                            "max_length": MAX_CONVERSATION_CONTEXT_LENGTH,
                        },
                    )
                    continue

                # Determine task complexity: attachments
                # mean workforce, otherwise let agent decide
                is_complex_task: bool
                if len(attaches_to_use) > 0:
                    is_complex_task = True
                    logger.info(
                        "[NEW-QUESTION] Has attachments"
                        ", treating as complex task"
                    )
                else:
                    is_complex_task = await question_confirm(
                        question_agent, question, task_lock
                    )
                    logger.info(
                        "[NEW-QUESTION] question_confirm"
                        " result: is_complex="
                        f"{is_complex_task}"
                    )

                if not is_complex_task:
                    logger.info(
                        "[NEW-QUESTION] Simple question"
                        ", providing direct answer "
                        "without workforce"
                    )
                    simple_answer_prompt = (
                        f"{conv_ctx}"
                        f"User Query: {question}\n\n"
                        "Provide a direct, helpful "
                        "answer to this simple "
                        "question."
                    )

                    try:
                        simple_resp = question_agent.step(simple_answer_prompt)
                        if simple_resp and simple_resp.msgs:
                            answer_content = simple_resp.msgs[0].content
                        else:
                            answer_content = (
                                "I understand your "
                                "question, but I'm "
                                "having trouble "
                                "generating a response "
                                "right now."
                            )

                        task_lock.add_conversation("assistant", answer_content)

                        yield sse_json(
                            "wait_confirm",
                            {"content": answer_content, "question": question},
                        )
                    except Exception as e:
                        logger.error(f"Error generating simple answer: {e}")
                        yield sse_json(
                            "wait_confirm",
                            {
                                "content": "I encountered an error"
                                " while processing "
                                "your question.",
                                "question": question,
                            },
                        )

                    # Clean up empty folder if it was created for this task
                    if (
                        hasattr(task_lock, "new_folder_path")
                        and task_lock.new_folder_path
                    ):
                        try:
                            folder_path = Path(task_lock.new_folder_path)
                            if folder_path.exists() and folder_path.is_dir():
                                # Check if folder is empty
                                if not any(folder_path.iterdir()):
                                    folder_path.rmdir()
                                    logger.info(
                                        "Cleaned up empty"
                                        " folder: "
                                        f"{folder_path}"
                                    )
                                    # Also clean up parent
                                    # project folder if empty
                                    project_folder = folder_path.parent
                                    if project_folder.exists() and not any(
                                        project_folder.iterdir()
                                    ):
                                        project_folder.rmdir()
                                        logger.info(
                                            "Cleaned up "
                                            "empty project"
                                            " folder: "
                                            f"{project_folder}"
                                        )
                                else:
                                    logger.info(
                                        "Folder not empty"
                                        ", keeping: "
                                        f"{folder_path}"
                                    )
                            # Reset the folder path
                            task_lock.new_folder_path = None
                        except Exception as e:
                            logger.error(f"Error cleaning up folder: {e}")
                else:
                    logger.info(
                        "[NEW-QUESTION] Complex task, "
                        "creating workforce and "
                        "decomposing"
                    )
                    # Update the sync_step with new task_id
                    if hasattr(item, "new_task_id") and item.new_task_id:
                        set_current_task_id(
                            options.project_id, item.new_task_id
                        )
                        task_lock.summary_generated = False

                    yield sse_json("confirmed", {"question": question})

                    # Check if workforce exists - reuse
                    # it; otherwise create new one
                    if workforce is not None:
                        logger.debug(
                            "[NEW-QUESTION] Reusing "
                            "existing workforce "
                            f"(id={id(workforce)})"
                        )
                    else:
                        logger.info(
                            "[NEW-QUESTION] Creating NEW workforce instance"
                        )
                        (workforce, mcp) = await construct_workforce(options)
                        if options.new_agents:
                            logger.warning(
                                "Skipping dynamic new_agents setup: "
                                "new_agent_model/format_agent_description "
                                "are removed"
                            )
                    task_lock.status = Status.confirmed

                    # Create camel_task for the question
                    clean_task_content = question + options.summary_prompt
                    camel_task = Task(
                        content=clean_task_content, id=options.task_id
                    )
                    if len(attaches_to_use) > 0:
                        camel_task.additional_info = {
                            Path(file_path).name: file_path
                            for file_path in attaches_to_use
                        }

                    # Stream decomposition in background
                    stream_state = {
                        "subtasks": [],
                        "seen_ids": set(),
                        "last_content": "",
                    }
                    state_holder: dict[str, Any] = {
                        "sub_tasks": [],
                        "summary_task": "",
                    }

                    def on_stream_batch(
                        new_tasks: list[Task], is_final: bool = False
                    ):
                        fresh_tasks = [
                            t
                            for t in new_tasks
                            if t.id not in stream_state["seen_ids"]
                        ]
                        for t in fresh_tasks:
                            stream_state["seen_ids"].add(t.id)
                        stream_state["subtasks"].extend(fresh_tasks)

                    def on_stream_text(chunk):
                        try:
                            accumulated_content = (
                                chunk.msg.content
                                if hasattr(chunk, "msg") and chunk.msg
                                else str(chunk)
                            )
                            last_content = stream_state["last_content"]

                            # Calculate delta: new content
                            # not in the previous chunk
                            if accumulated_content.startswith(last_content):
                                delta_content = accumulated_content[
                                    len(last_content) :
                                ]
                            else:
                                delta_content = accumulated_content

                            stream_state["last_content"] = accumulated_content

                            if delta_content:
                                asyncio.run_coroutine_threadsafe(
                                    task_lock.put_queue(
                                        ActionDecomposeTextData(
                                            data={
                                                "project_id": options.project_id,
                                                "task_id": options.task_id,
                                                "content": delta_content,
                                            }
                                        )
                                    ),
                                    event_loop,
                                )
                        except Exception as e:
                            logger.warning(
                                f"Failed to stream decomposition text: {e}"
                            )

                    async def run_decomposition():
                        nonlocal summary_task_content
                        try:
                            sub_tasks = await asyncio.to_thread(
                                workforce.medgemma_make_sub_tasks,
                                camel_task,
                                context_for_coordinator,
                                on_stream_batch,
                                on_stream_text,
                            )

                            if stream_state["subtasks"]:
                                sub_tasks = stream_state["subtasks"]
                            state_holder["sub_tasks"] = sub_tasks
                            logger.info(
                                "Task decomposed into "
                                f"{len(sub_tasks)} subtasks"
                            )
                            try:
                                task_lock.decompose_sub_tasks = sub_tasks
                            except Exception:
                                pass

                            # Generate task summary
                            try:
                                content_preview = (
                                    camel_task.content
                                    if hasattr(camel_task, "content")
                                    else ""
                                )
                                if content_preview is None:
                                    content_preview = ""
                                if len(content_preview) > 80:
                                    cp = content_preview[:80]
                                    summary_task_content = cp + "..."
                                else:
                                    summary_task_content = content_preview
                                summary_task_content = (
                                    f"Task|{summary_task_content}"
                                )
                                task_lock.summary_generated = True
                            except Exception:
                                task_lock.summary_generated = True
                                content_preview = (
                                    camel_task.content
                                    if hasattr(camel_task, "content")
                                    else ""
                                )
                                if content_preview is None:
                                    content_preview = ""
                                if len(content_preview) > 80:
                                    cp = content_preview[:80]
                                    summary_task_content = cp + "..."
                                else:
                                    summary_task_content = content_preview
                                summary_task_content = (
                                    f"Task|{summary_task_content}"
                                )

                            state_holder["summary_task"] = summary_task_content
                            try:
                                task_lock.summary_task_content = (
                                    summary_task_content
                                )
                            except Exception:
                                pass

                            payload = {
                                "project_id": options.project_id,
                                "task_id": options.task_id,
                                "sub_tasks": tree_sub_tasks(
                                    camel_task.subtasks
                                ),
                                "delta_sub_tasks": tree_sub_tasks(sub_tasks),
                                "is_final": True,
                                "summary_task": summary_task_content,
                            }
                            await task_lock.put_queue(
                                ActionDecomposeProgressData(data=payload)
                            )
                        except Exception as e:
                            logger.error(
                                f"Error in background decomposition: {e}",
                                exc_info=True,
                            )

                    bg_task = asyncio.create_task(run_decomposition())
                    task_lock.add_background_task(bg_task)

            elif item.action == Action.start:
                if is_exceeded:
                    logger.error(
                        "Cannot start task: "
                        "conversation history too "
                        f"long ({total_length} chars)"
                        " for project "
                        f"{options.project_id}"
                    )
                    ctx_msg = (
                        "The conversation history "
                        "is too long. Please create"
                        " a new project to continue."
                    )
                    yield sse_json(
                        "context_too_long",
                        {
                            "message": ctx_msg,
                            "current_length": total_length,
                            "max_length": MAX_CONVERSATION_CONTEXT_LENGTH,
                        },
                    )
                    continue

                if workforce is not None:
                    if workforce._state.name == "PAUSED":
                        # Resume paused workforce -
                        # subtasks should already
                        # be loaded
                        workforce.resume()
                        continue
                else:
                    continue

                task_lock.status = Status.processing
                if not sub_tasks:
                    sub_tasks = getattr(task_lock, "decompose_sub_tasks", [])
                task = asyncio.create_task(workforce.medgemma_start(sub_tasks))
                task_lock.add_background_task(task)
            elif item.action == Action.task_state:
                # Track completed task results for the end event
                task_id = item.data.get("task_id", "unknown")
                task_state = item.data.get("state", "unknown")
                task_result = item.data.get("result", "")

                if task_state == "DONE" and task_result:
                    last_completed_task_result = task_result

                yield sse_json("task_state", item.data)
            elif item.action == Action.create_agent:
                yield sse_json("create_agent", item.data)
            elif item.action == Action.activate_agent:
                yield sse_json("activate_agent", item.data)
            elif item.action == Action.deactivate_agent:
                yield sse_json("deactivate_agent", dict(item.data))
            elif item.action == Action.assign_task:
                yield sse_json("assign_task", item.data)
            elif item.action == Action.activate_toolkit:
                yield sse_json("activate_toolkit", item.data)
            elif item.action == Action.deactivate_toolkit:
                yield sse_json("deactivate_toolkit", item.data)
            elif item.action == Action.write_file:
                yield sse_json(
                    "write_file",
                    {
                        "file_path": item.data,
                        "process_task_id": item.process_task_id,
                    },
                )
            elif item.action == Action.ask:
                yield sse_json("ask", item.data)
            elif item.action == Action.notice:
                yield sse_json(
                    "notice",
                    {
                        "notice": item.data,
                        "process_task_id": item.process_task_id,
                    },
                )
            elif item.action == Action.decompose_text:
                yield sse_json("decompose_text", item.data)
            elif item.action == Action.decompose_progress:
                yield sse_json("to_sub_tasks", item.data)
            elif item.action == Action.timeout:
                logger.info("=" * 80)
                logger.info(
                    "[LIFECYCLE] TIMEOUT action "
                    "received for project "
                    f"{options.project_id}, "
                    f"task {options.task_id}"
                )
                logger.info(f"[LIFECYCLE] Timeout data: {item.data}")
                logger.info("=" * 80)

                # Send timeout error to frontend
                timeout_message = item.data.get(
                    "message", "Task execution timeout"
                )
                in_flight = item.data.get("in_flight_tasks", 0)
                pending = item.data.get("pending_tasks", 0)
                timeout_seconds = item.data.get("timeout_seconds", 0)

                yield sse_json(
                    "error",
                    {
                        "message": timeout_message,
                        "type": "timeout",
                        "details": {
                            "in_flight_tasks": in_flight,
                            "pending_tasks": pending,
                            "timeout_seconds": timeout_seconds,
                        },
                    },
                )
            elif item.action == Action.budget_not_enough:
                if workforce is not None:
                    workforce.pause()
                yield sse_json(
                    Action.budget_not_enough, {"message": "budget not enough"}
                )
            elif item.action == Action.end:
                logger.info("=" * 80)
                logger.info(
                    "[LIFECYCLE] END action "
                    "received for project "
                    f"{options.project_id}, "
                    f"task {options.task_id}"
                )
                logger.info(
                    "[LIFECYCLE] camel_task "
                    f"exists: {camel_task is not None}"
                    ", current status: "
                    f"{task_lock.status}, workforce"
                    f" exists: {workforce is not None}"
                )
                if workforce is not None:
                    logger.info(
                        "[LIFECYCLE] Workforce state"
                        " at END: _state="
                        f"{workforce._state.name}"
                        ", _running="
                        f"{workforce._running}"
                    )
                logger.info("=" * 80)

                # Prevent duplicate end processing
                if task_lock.status == Status.done:
                    logger.warning(
                        "[LIFECYCLE] END action "
                        "received but task already "
                        "marked as done. Ignoring "
                        "duplicate END action."
                    )
                    continue

                if camel_task is None:
                    logger.warning(
                        "END action received but "
                        "camel_task is None for "
                        "project "
                        f"{options.project_id}, "
                        f"task {options.task_id}. "
                        "This may indicate multiple "
                        "END actions or improper "
                        "task lifecycle management."
                    )
                    # Use item data as final result
                    # if camel_task is None
                    final_result: str = (
                        str(item.data) if item.data else "Task completed"
                    )
                else:
                    get_result = get_task_result_with_optional_summary
                    final_result: str = await get_result(camel_task, options)

                task_lock.status = Status.done

                task_lock.last_task_result = final_result

                # Handle task content - use fallback if camel_task is None
                if camel_task is not None:
                    task_content: str = camel_task.content
                    if "=== CURRENT TASK ===" in task_content:
                        task_content = task_content.split(
                            "=== CURRENT TASK ==="
                        )[-1].strip()
                else:
                    task_content: str = f"Task {options.task_id}"

                task_lock.add_conversation(
                    "task_result",
                    {
                        "task_content": task_content,
                        "task_result": final_result,
                        "working_directory": get_working_directory(
                            options, task_lock
                        ),
                    },
                )

                yield sse_json("end", final_result)

                if workforce is not None:
                    logger.info(
                        "[LIFECYCLE] Calling "
                        "workforce.stop_gracefully()"
                        " for project "
                        f"{options.project_id}, "
                        f"workforce id={id(workforce)}"
                    )
                    workforce.stop_gracefully()
                    logger.info(
                        "[LIFECYCLE] Workforce "
                        "stopped gracefully for "
                        "project "
                        f"{options.project_id}"
                    )
                    workforce = None
                    logger.info("[LIFECYCLE] Workforce set to None")
                else:
                    logger.warning(
                        "[LIFECYCLE] Workforce "
                        "already None at end "
                        "action for project "
                        f"{options.project_id}"
                    )

                camel_task = None
                logger.info("[LIFECYCLE] camel_task set to None")

                if question_agent is not None:
                    question_agent.reset()
                    logger.info(
                        "[LIFECYCLE] question_agent"
                        " reset for project "
                        f"{options.project_id}"
                    )
            elif item.action == Action.stop:
                logger.info("=" * 80)
                logger.info(
                    "[LIFECYCLE] STOP action received"
                    " for project "
                    f"{options.project_id}"
                )
                logger.info("=" * 80)
                if workforce is not None:
                    logger.info(
                        "[LIFECYCLE] Workforce exists "
                        f"(id={id(workforce)}), "
                        f"_running={workforce._running}"
                        ", _state="
                        f"{workforce._state.name}"
                    )
                    if workforce._running:
                        logger.info(
                            "[LIFECYCLE] Calling "
                            "workforce.stop() because"
                            " _running=True"
                        )
                        workforce.stop()
                        logger.info("[LIFECYCLE] workforce.stop() completed")
                    logger.info(
                        "[LIFECYCLE] Calling workforce.stop_gracefully()"
                    )
                    workforce.stop_gracefully()
                    logger.info(
                        "[LIFECYCLE] Workforce stopped"
                        " for project "
                        f"{options.project_id}"
                    )
                else:
                    logger.warning(
                        "[LIFECYCLE] Workforce is None"
                        " at stop action for project"
                        f" {options.project_id}"
                    )
                logger.info("[LIFECYCLE] Deleting task lock")
                await delete_task_lock(task_lock.id)
                logger.info(
                    "[LIFECYCLE] Task lock deleted, breaking out of loop"
                )
                break
            else:
                logger.warning(f"Unknown action: {item.action}")
        except ModelProcessingError as e:
            logger.error(
                "ModelProcessingError for task "
                f"{options.task_id}, action "
                f"{item.action}: {e}",
                exc_info=True,
            )
            yield sse_json("error", {"message": str(e)})
            if (
                "workforce" in locals()
                and workforce is not None
                and workforce._running
            ):
                workforce.stop()
        except Exception as e:
            logger.error(
                "Unhandled exception for task "
                f"{options.task_id}, action "
                f"{item.action}: {e}",
                exc_info=True,
            )
            yield sse_json("error", {"message": str(e)})
            # Continue processing other items instead of breaking

def to_sub_tasks(task: Task, summary_task_content: str):
    logger.info("[TO-SUB-TASKS] 📋 Creating to_sub_tasks SSE event")
    logger.info(
        f"[TO-SUB-TASKS] task.id={task.id}"
        f", summary={summary_task_content[:50]}"
        f"..., subtasks_count="
        f"{len(task.subtasks)}"
    )
    result = {
        "summary_task": summary_task_content,
        "sub_tasks": tree_sub_tasks(task.subtasks),
    }
    logger.info("[TO-SUB-TASKS] ✅ to_sub_tasks SSE event created")
    return result


def build_conversation_context(
    task_lock: TaskLock, header: str = "=== Conversation Context ==="
) -> str:
    history = getattr(task_lock, "conversation_history", [])
    if not history:
        return ""

    lines = [f"{header}\n"]
    for entry in history[-20:]:
        role = str(entry.get("role", "assistant")).strip() or "assistant"
        content = entry.get("content", "")
        if isinstance(content, dict):
            content = content.get("task_result") or str(content)
        content_text = str(content).strip()
        if not content_text:
            continue
        lines.append(f"{role.upper()}: {content_text}")

    if len(lines) == 1:
        return ""
    return "\n".join(lines) + "\n\n"


def tree_sub_tasks(sub_tasks: list[Task], depth: int = 0):
    if depth > 5:
        return []

    result = (
        chain(sub_tasks)
        .filter(lambda x: x.content != "")
        .map(
            lambda x: {
                "id": x.id,
                "content": x.content,
                "state": x.state,
                "subtasks": tree_sub_tasks(x.subtasks, depth + 1),
            }
        )
        .value()
    )

    return result


async def question_confirm(
    agent: ListenChatAgent, prompt: str, task_lock: TaskLock | None = None
) -> bool:
    """Simple question confirmation - returns True
    for complex tasks, False for simple questions."""

    context_prompt = ""

    full_prompt = f"""{context_prompt}User Query: {prompt}

Determine if this user query is a complex task or a simple question.

**Complex task** (answer "yes"): Requires tools, code execution, \
file operations, multi-step planning, or creating/modifying content
- Examples: "create a file", "search for X", \
"implement feature Y", "write code", "analyze data"

**Simple question** (answer "no"): Can be answered directly \
with knowledge or conversation history, no action needed
- Examples: greetings ("hello", "hi"), \
fact queries ("what is X?"), clarifications, status checks

Answer only "yes" or "no". Do not provide any explanation.

Is this a complex task? (yes/no):"""

    try:
        resp = agent.step(full_prompt)

        if not resp or not resp.msgs or len(resp.msgs) == 0:
            logger.warning(
                "No response from agent, defaulting to complex task"
            )
            return True

        content = resp.msgs[0].content
        if not content:
            logger.warning(
                "Empty content from agent, defaulting to complex task"
            )
            return True

        normalized = content.strip().lower()
        is_complex = "yes" in normalized

        result_str = "complex task" if is_complex else "simple question"
        logger.info(
            f"Question confirm result: {result_str}",
            extra={"response": content, "is_complex": is_complex},
        )

        return is_complex

    except Exception as e:
        logger.error(f"Error in question_confirm: {e}")
        raise


async def summary_task(agent: ListenChatAgent, task: Task) -> str:
    prompt = f"""The user's task is:
---
{task.to_string()}
---
Your instructions are:
1.  Come up with a short and descriptive name for this task.
2.  Create a concise summary of the task's main points and objectives.
3.  Return the task name and the summary, separated by a vertical bar (|).

Example format: "Task Name|This is the summary of the task."
Do not include any other text or formatting.
"""
    logger.debug("Generating task summary", extra={"task_id": task.id})
    try:
        res = agent.step(prompt)
        summary = res.msgs[0].content
        logger.info("Task summary generated", extra={"summary": summary})
        return summary
    except Exception as e:
        logger.error(
            "Error generating task summary",
            extra={"error": str(e)},
            exc_info=True,
        )
        raise


async def summary_subtasks_result(agent: ListenChatAgent, task: Task) -> str:
    """
    Summarize the aggregated results from all subtasks into a concise summary.

    Args:
        agent: The summary agent to use
        task: The main task containing subtasks and their aggregated results

    Returns:
        A concise summary of all subtask results
    """
    subtasks_info = ""
    for i, subtask in enumerate(task.subtasks, 1):
        subtasks_info += f"\n**Subtask {i}**\n"
        subtasks_info += f"Description: {subtask.content}\n"
        subtasks_info += f"Result: {subtask.result or 'No result'}\n"
        subtasks_info += "---\n"

    prompt = f"""You are a professional summarizer. \
Summarize the results of the following subtasks.

Main Task: {task.content}

Subtasks (with descriptions and results):
---
{subtasks_info}
---

Instructions:
1. Provide a concise summary of what was accomplished
2. Highlight key findings or outputs from each subtask
3. Mention any important files created or actions taken
4. Use bullet points or sections for clarity
5. DO NOT repeat the task name in your summary - go straight to the results
6. Keep it professional but conversational

Summary:
"""

    res = agent.step(prompt)
    summary = res.msgs[0].content

    logger.info(
        "Generated subtasks summary for "
        f"task {task.id} with "
        f"{len(task.subtasks)} subtasks"
    )

    return summary


async def get_task_result_with_optional_summary(
    task: Task, options: Chat
) -> str:
    """
    Get the task result, with LLM summary if there are multiple subtasks.

    Args:
        task: The task to get result from
        options: Chat options for creating summary agent

    Returns:
        The task result (summarized if multiple subtasks, raw otherwise)
    """
    result = str(task.result or "")

    if task.subtasks and len(task.subtasks) > 1:
        logger.info(
            f"Task {task.id} has "
            f"{len(task.subtasks)} subtasks, "
            "generating summary"
        )
        try:
            summary_agent = task_summary_agent(options)
            summarized_result = await summary_subtasks_result(
                summary_agent, task
            )
            result = summarized_result
            logger.info(f"Successfully generated summary for task {task.id}")
        except Exception as e:
            logger.error(f"Failed to generate summary for task {task.id}: {e}")
    elif task.subtasks and len(task.subtasks) == 1:
        logger.info(f"Task {task.id} has only 1 subtask, skipping LLM summary")
        if result and "--- Subtask" in result and "Result ---" in result:
            parts = result.split("Result ---", 1)
            if len(parts) > 1:
                result = parts[1].strip()

    return result


async def construct_workforce(
    options: Chat,
) -> tuple[Workforce, ListenChatAgent]:
    """Construct a workforce with all required agents.

    This function creates all agents in PARALLEL to minimize startup time.
    Sync functions are run in thread pool, async functions
    are awaited concurrently.
    """
    logger.debug(
        "construct_workforce started",
        extra={"project_id": options.project_id, "task_id": options.task_id},
    )

    # Store main event loop reference for thread-safe async task scheduling
    # This allows agent_model() to schedule tasks
    # when called from worker threads
    set_main_event_loop(asyncio.get_running_loop())

    working_directory = get_working_directory(options)

    # ========================================================================
    # Define agent creation functions
    # ========================================================================

    def _create_coordinator_and_task_agents() -> list[ListenChatAgent]:
        """Create coordinator and task agents (sync, runs in thread pool)."""
        return [
            agent_model(
                key,
                prompt,
                options,
                [
                    *(
                        ToolkitMessageIntegration(
                            message_handler=HumanToolkit(
                                options.project_id, key
                            ).send_message_to_user
                        ).register_toolkits(
                            NoteTakingToolkit(
                                options.project_id,
                                working_directory=working_directory,
                            )
                        )
                    ).get_tools()
                ],
            )
            for key, prompt in {
                Agents.coordinator_agent: f"""
You are a helpful coordinator.
- You are now working in system {platform.system()} with architecture
{platform.machine()} at working directory \
`{working_directory}`. All local file operations \
must occur here, but you can access files from any \
place in the file system. For all file system \
operations, you MUST use absolute paths to ensure \
precision and avoid ambiguity.
The current date is {datetime.date.today()}. \
For any date-related tasks, you MUST use this as \
the current date.
            """,
                Agents.task_agent: f"""
You are a helpful task planner.
- You are now working in system {platform.system()} with architecture
{platform.machine()} at working directory \
`{working_directory}`. All local file operations \
must occur here, but you can access files from any \
place in the file system. For all file system \
operations, you MUST use absolute paths to ensure \
precision and avoid ambiguity.
The current date is {datetime.date.today()}. \
For any date-related tasks, you MUST use this as \
the current date.
        """,
            }.items()
        ]

    def _create_new_worker_agent() -> ListenChatAgent:
        """Create new worker agent (sync, runs in thread pool)."""
        return agent_model(
            Agents.new_worker_agent,
            f"""
        You are a helpful assistant.
- You are now working in system {platform.system()} with architecture
{platform.machine()} at working directory \
`{working_directory}`. All local file operations \
must occur here, but you can access files from any \
place in the file system. For all file system \
operations, you MUST use absolute paths to ensure \
precision and avoid ambiguity.
The current date is {datetime.date.today()}. \
For any date-related tasks, you MUST use this as \
the current date.
        """,
            options,
            [
                *HumanToolkit.get_can_use_tools(
                    options.project_id, Agents.new_worker_agent
                ),
                *(
                    ToolkitMessageIntegration(
                        message_handler=HumanToolkit(
                            options.project_id, Agents.new_worker_agent
                        ).send_message_to_user
                    ).register_toolkits(
                        NoteTakingToolkit(
                            options.project_id,
                            working_directory=working_directory,
                        )
                    )
                ).get_tools(),
            ],
        )

    # ========================================================================
    # Execute all agent creations in PARALLEL
    # ========================================================================

    try:
        # asyncio.gather runs all coroutines concurrently
        # asyncio.to_thread runs sync functions in
        # thread pool without blocking event loop
        results = await asyncio.gather(
            asyncio.to_thread(_create_coordinator_and_task_agents),
            asyncio.to_thread(_create_new_worker_agent),
            asyncio.to_thread(browser_agent, options),
            developer_agent(options),
            document_agent(options),
            asyncio.to_thread(multi_modal_agent, options),
        )
    except Exception as e:
        logger.error(
            f"Failed to create agents in parallel: {e}", exc_info=True
        )
        raise
    finally:
        # Always clear event loop reference after
        # parallel agent creation completes.
        # This prevents stale references and
        # potential cross-request interference
        set_main_event_loop(None)

    # Unpack results
    (
        coord_task_agents,
        new_worker_agent,
        searcher,
        developer,
        documenter,
        multi_modaler,
        mcp,
    ) = results

    coordinator_agent, task_agent = coord_task_agents

    # ========================================================================
    # Create Workforce instance and add workers (must be sequential)
    # ========================================================================

    try:
        model_platform_enum = ModelPlatformType(options.model_platform.lower())
    except (ValueError, AttributeError):
        model_platform_enum = None

    workforce = Workforce(
        options.project_id,
        "A workforce",
        graceful_shutdown_timeout=3,
        share_memory=False,
        coordinator_agent=coordinator_agent,
        task_agent=task_agent,
        new_worker_agent=new_worker_agent,
        use_structured_output_handler=False
        if model_platform_enum == ModelPlatformType.OPENAI
        else True,
    )

    # Register workforce metrics callback
    workforce.add_single_agent_worker(
        "Developer Agent: A master-level coding assistant with a powerful "
        "terminal. It can write and execute code, manage files, automate "
        "desktop tasks, and deploy web applications to solve complex "
        "technical challenges.",
        developer,
    )
    workforce.add_single_agent_worker(
        "Browser Agent: Can search the web, extract webpage content, "
        "simulate browser actions, and provide relevant information to "
        "solve the given task.",
        searcher,
    )
    workforce.add_single_agent_worker(
        "Document Agent: A document processing assistant skilled in creating "
        "and modifying a wide range of file formats. It can generate "
        "text-based files/reports (Markdown, JSON, YAML, HTML), "
        "office documents (Word, PDF), presentations (PowerPoint), and "
        "data files (Excel, CSV).",
        documenter,
    )
    workforce.add_single_agent_worker(
        "Multi-Modal Agent: A specialist in media processing. It can "
        "analyze images and audio, transcribe speech, download videos, and "
        "generate new images from text prompts.",
        multi_modaler,
    )

    return workforce, mcp


def format_agent_description(agent_data: NewAgent) -> str:
    r"""Format a comprehensive agent description including name, tools, and
    description.
    """
    description_parts = [f"{agent_data.name}:"]

    # Add description if available
    if hasattr(agent_data, "description") and agent_data.description:
        description_parts.append(agent_data.description.strip())
    else:
        description_parts.append("A specialized agent")

    # Add tools information
    tool_names = []
    if hasattr(agent_data, "tools") and agent_data.tools:
        for tool in agent_data.tools:
            tool_names.append(titleize(tool))

    if hasattr(agent_data, "mcp_tools") and agent_data.mcp_tools:
        for mcp_server in agent_data.mcp_tools.get("mcpServers", {}).keys():
            tool_names.append(titleize(mcp_server))

    if tool_names:
        description_parts.append(
            f"with access to {', '.join(tool_names)} tools : <{tool_names}>"
        )

    return " ".join(description_parts)


async def new_agent_model(data: NewAgent, options: Chat):
    logger.info(
        "Creating new agent",
        extra={
            "agent_name": data.name,
            "project_id": options.project_id,
            "task_id": options.task_id,
        },
    )
    logger.debug(
        "New agent data", extra={"agent_data": data.model_dump_json()}
    )
    working_directory = get_working_directory(options)
    tool_names = []
    tools = [*await get_toolkits(data.tools, data.name, options.project_id)]
    for item in data.tools:
        tool_names.append(titleize(item))
    # Always include terminal_toolkit with proper working directory
    terminal_toolkit = TerminalToolkit(
        options.project_id,
        agent_name=data.name,
        working_directory=working_directory,
        safe_mode=True,
        clone_current_env=True,
    )
    tools.extend(terminal_toolkit.get_tools())
    tool_names.append(titleize("terminal_toolkit"))
    if data.mcp_tools is not None:
        tools = [*tools, *await get_mcp_tools(data.mcp_tools)]
        for item in data.mcp_tools["mcpServers"].keys():
            tool_names.append(titleize(item))
    for item in tools:
        logger.debug(f"Agent {data.name} tool: {item.func.__name__}")
    logger.info(
        f"Agent {data.name} created with {len(tools)} tools: {tool_names}"
    )
    # Enhanced system message with platform information
    enhanced_description = f"""{data.description}
- You are now working in system {platform.system()} with architecture
{platform.machine()} at working directory \
`{working_directory}`. All local file operations \
must occur here, but you can access files from any \
place in the file system. For all file system \
operations, you MUST use absolute paths to ensure \
precision and avoid ambiguity.
The current date is {datetime.date.today()}. \
For any date-related tasks, you MUST use this as \
the current date.
"""

    # Pass per-agent custom model config if available
    custom_model_config = getattr(data, "custom_model_config", None)
    return agent_model(
        data.name,
        enhanced_description,
        options,
        tools,
        tool_names=tool_names,
        custom_model_config=custom_model_config,
    )
