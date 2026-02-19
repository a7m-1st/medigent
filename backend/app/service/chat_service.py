import asyncio
import base64
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
    ActionErrorData,
    ActionImproveData,
    Agents,
    TaskLock,
    delete_task_lock,
    set_current_task_id,
)
from app.utils.event_loop_utils import set_main_event_loop
from app.utils.file_utils import get_working_directory, process_attaches
from app.utils.triage import (
    ComplexityLevel,
    TriageResult,
    evaluate_task_complexity,
)
from app.utils.workforce import Workforce

logger = logging.getLogger("chat_service")
MAX_CONVERSATION_CONTEXT_LENGTH = 100000

# Feature flag: Enable dynamic task routing based on complexity
ENABLE_DYNAMIC_ROUTING = True


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
    if not hasattr(task_lock, "summary_generated"):
        task_lock.summary_generated = False

    # Other variables
    camel_task = None
    workforce = None
    summary_task_content = ""  # Track task summary
    loop_iteration = 0
    event_loop = asyncio.get_running_loop()
    sub_tasks: list[Task] = []

    # Session timeout: 1 hour (3600 seconds)
    SESSION_TIMEOUT_SECONDS = 3600
    session_start_time = datetime.datetime.now()

    while True:
        loop_iteration += 1
        logger.debug(
            f"[LIFECYCLE] step_solve loop iteration #{loop_iteration}",
            extra={
                "project_id": options.project_id,
                "task_id": options.task_id,
            },
        )

        # Check session timeout (1 hour)
        elapsed = (
            datetime.datetime.now() - session_start_time
        ).total_seconds()
        if elapsed > SESSION_TIMEOUT_SECONDS:
            # Stop workforce if running
            if workforce is not None and workforce._running:
                logger.info(
                    "[LIFECYCLE] Stopping workforce due to session timeout"
                )
                workforce.stop()
                workforce.stop_gracefully()

            # Send timeout error to client
            yield sse_json(
                "error",
                {
                    "message": f"Session timeout: Chat session exceeded {SESSION_TIMEOUT_SECONDS // 3600} hour limit",
                    "type": "timeout",
                },
            )
            # Clean up task lock
            logger.info(
                "[LIFECYCLE] Deleting task lock due to session timeout"
            )
            await delete_task_lock(task_lock.id)
            break

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
                    attaches_raw = options.attaches
                    logger.info(
                        "[NEW-QUESTION] Initial question"
                        " from options.question: "
                        f"'{question[:100]}...'"
                    )
                    start_event_loop = False
                else:
                    assert isinstance(item, ActionImproveData)
                    question = item.data.question
                    attaches_raw = (
                        item.data.attaches
                        if item.data.attaches
                        else options.attaches
                    )
                    # Process base64 attachments
                    save_dir = options.file_save_path("attachments")
                    attaches_to_use = process_attachments(
                        attaches_to_use,
                        save_dir,
                        options.project_id,
                        options.task_id,
                    )
                    logger.info(
                        "[NEW-QUESTION] Follow-up "
                        "question from "
                        "ActionImproveData: "
                        f"'{question[:100]}...'"
                    )

                # Process attachments: convert base64 images to file paths
                working_directory = get_working_directory(options)
                attaches_to_use = process_attaches(
                    attaches_raw, working_directory
                ) if attaches_raw else []
                if attaches_to_use:
                    logger.info(
                        f"[NEW-QUESTION] Processed {len(attaches_to_use)} "
                        f"attachments: {[Path(p).name for p in attaches_to_use]}"
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

                logger.info(
                    "[NEW-QUESTION] Processing task via workforce flow"
                )
                # Update the sync_step with new task_id
                if hasattr(item, "new_task_id") and item.new_task_id:
                    set_current_task_id(options.project_id, item.new_task_id)
                    task_lock.summary_generated = False

                yield sse_json("confirmed", {"question": question})

                # ============================================================
                # DYNAMIC ROUTING: Evaluate task complexity before processing
                # ============================================================
                suggested_agents: list[str] | None = None

                if ENABLE_DYNAMIC_ROUTING:
                    triage_result = await perform_triage(
                        question,
                        attaches_to_use,
                        options,
                        context_for_coordinator,
                    )

                    # Handle SIMPLE questions - direct answer without workforce
                    if triage_result.complexity == ComplexityLevel.SIMPLE:
                        logger.info(
                            "[TRIAGE] SIMPLE question detected, "
                            "returning direct answer"
                        )

                        # Send direct answer as end event
                        direct_answer = triage_result.direct_answer or (
                            "I apologize, but I couldn't generate a response. "
                            "Please try rephrasing your question."
                        )

                        # Record in conversation history
                        task_lock.add_conversation("user", question)
                        task_lock.add_conversation("assistant", direct_answer)
                        task_lock.last_task_result = direct_answer
                        task_lock.status = Status.done

                        yield sse_json("end", direct_answer)

                        # Clean up and close SSE
                        try:
                            await delete_task_lock(task_lock.id)
                        except Exception as e:
                            logger.error(f"Error deleting task lock: {e}")
                        break

                    # For MODERATE/COMPLEX, continue with workforce flow
                    suggested_agents = triage_result.suggested_agents
                    logger.info(
                        f"[TRIAGE] {triage_result.complexity.value.upper()} "
                        f"question, proceeding with workforce. "
                        f"Suggested agents: {suggested_agents}"
                    )

                # ============================================================
                # END DYNAMIC ROUTING
                # ============================================================

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
                    # Pass suggested_agents for dynamic agent creation
                    # If None (routing disabled) or empty, all agents are created
                    workforce = await construct_workforce(options, suggested_agents)
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
                                            len(last_content):
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
                            workforce.workforce_make_sub_tasks,
                            camel_task,
                            context_for_coordinator,
                            on_stream_batch,
                            on_stream_text,
                        )

                        if stream_state["subtasks"]:
                            sub_tasks = stream_state["subtasks"]
                        state_holder["sub_tasks"] = sub_tasks
                        logger.info(
                            f"Task decomposed into {len(sub_tasks)} subtasks"
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
                            "sub_tasks": tree_sub_tasks(camel_task.subtasks),
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

                async def workforce_start_with_error_handling():
                    """Wrap workforce_start to catch errors and send SSE error events."""
                    try:
                        await workforce.workforce_start(sub_tasks)
                    except Exception as e:
                        error_msg = str(e)
                        logger.error(
                            f"[WORKFORCE] Error during task execution: {error_msg}",
                            extra={
                                "project_id": options.project_id,
                                "task_id": options.task_id,
                            },
                            exc_info=True,
                        )
                        # Put error action in queue so main loop can yield it
                        await task_lock.put_queue(
                            ActionErrorData(
                                action=Action.error,
                                data={
                                    "message": error_msg,
                                    "type": "workforce_error",
                                },
                            )
                        )

                task = asyncio.create_task(
                    workforce_start_with_error_handling()
                )
                task_lock.add_background_task(task)
            elif item.action == Action.task_state:
                # Track completed task results for the end event
                task_state = item.data.get("state", "unknown")
                task_result = item.data.get("result", "")
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
            elif item.action == Action.terminal:
                yield sse_json(
                    "terminal",
                    {
                        "process_task_id": item.process_task_id,
                        "data": item.data,
                    },
                )
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
            elif item.action == Action.error:
                # Error during workforce execution
                error_message = item.data.get("message", "Unknown error")
                error_type = item.data.get("type", "workforce_error")
                logger.error(
                    f"[SSE] Sending error event: {error_message}",
                    extra={
                        "project_id": options.project_id,
                        "task_id": options.task_id,
                    },
                )
                yield sse_json(
                    "error",
                    {
                        "message": error_message,
                        "type": error_type,
                    },
                )
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

                # Close SSE connection after task ends
                logger.info(
                    "[LIFECYCLE] Breaking out of "
                    "step_solve loop to close SSE "
                    "connection after task end"
                )
                try:
                    await delete_task_lock(task_lock.id)
                    logger.info("[LIFECYCLE] Task lock deleted after task end")
                except Exception as e:
                    logger.error(f"Error deleting task lock on end: {e}")
                break

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
        required_agents: list[str] | None = None,
) -> Workforce:
    """Construct a workforce with required agents.

    This function creates agents in PARALLEL to minimize startup time.
    Sync functions are run in thread pool, async functions
    are awaited concurrently.

    Args:
        options: Chat configuration
        required_agents: List of agent names to create. If None or empty,
            creates all agents (for COMPLEX tasks). Valid values:
            - 'browser_agent'
            - 'developer_agent'
            - 'document_agent'
            - 'multi_modal_agent'

    Returns:
        Configured Workforce instance
    """
    # Normalize required_agents - if empty or None, create all agents
    if not required_agents:
        required_agents = [
            "browser_agent",
            "developer_agent",
            "document_agent",
            "multi_modal_agent",
        ]

    logger.info(
        f"[WORKFORCE] Creating workforce with agents: {required_agents}",
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
    # Execute agent creations in PARALLEL (only for required agents)
    # ========================================================================

    # Always create coordinator, task, and new_worker agents
    base_tasks = [
        asyncio.to_thread(_create_coordinator_and_task_agents),
        asyncio.to_thread(_create_new_worker_agent),
    ]

    # Dynamically add only required specialist agents
    # Use lambdas to defer coroutine creation until they're actually needed
    agent_creation_map = {
        "browser_agent": lambda: asyncio.to_thread(browser_agent, options),
        "developer_agent": developer_agent,
        "document_agent": document_agent,
        "multi_modal_agent": lambda: asyncio.to_thread(multi_modal_agent, options),
    }

    # Build list of tasks to execute
    specialist_tasks = []
    specialist_names = []
    for agent_name in required_agents:
        if agent_name in agent_creation_map:
            # Call the lambda/function to get the actual coroutine/task
            # Lambdas capture options, async functions need it passed in
            agent_creator = agent_creation_map[agent_name]
            if callable(agent_creator) and agent_name in ("developer_agent", "document_agent"):
                # Async function - needs options passed in
                specialist_tasks.append(agent_creator(options))
            else:
                # Lambda with options already captured
                specialist_tasks.append(agent_creator())
            specialist_names.append(agent_name)

    logger.info(f"[WORKFORCE] Creating {len(specialist_names)} specialist agents: {specialist_names}")

    try:
        # Run all agent creations in parallel
        all_tasks = base_tasks + specialist_tasks
        results = await asyncio.gather(*all_tasks)
    except Exception as e:
        logger.error(
            f"Failed to create agents in parallel: {e}", exc_info=True
        )
        raise
    finally:
        # Always clear event loop reference after
        # parallel agent creation completes.
        set_main_event_loop(None)

    # Unpack base results
    coord_task_agents = results[0]
    new_worker_agent = results[1]
    coordinator_agent, task_agent = coord_task_agents

    # Unpack specialist agents into a dict
    specialist_agents = {}
    for i, agent_name in enumerate(specialist_names):
        specialist_agents[agent_name] = results[2 + i]

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

    # Worker descriptions for each agent type
    worker_descriptions = {
        "developer_agent": (
            "Developer Agent: A master-level coding assistant with a powerful "
            "terminal. It can write and execute code, manage files, automate "
            "desktop tasks, and deploy web applications to solve complex "
            "technical challenges."
        ),
        "browser_agent": (
            "Browser Agent: Can search the web, extract webpage content, "
            "simulate browser actions, and provide relevant information to "
            "solve the given task."
        ),
        "document_agent": (
            "Document Agent: A document processing assistant skilled in creating "
            "and modifying a wide range of file formats. It can generate "
            "text-based files/reports (Markdown, JSON, YAML, HTML), "
            "office documents (Word, PDF), presentations (PowerPoint), and "
            "data files (Excel, CSV)."
        ),
        "multi_modal_agent": (
            "Multi-Modal Agent: A specialist in media processing. It can "
            "analyze images and audio, transcribe speech, download videos, and "
            "generate new images from text prompts."
        ),
    }

    # Add only the created specialist agents to workforce
    for agent_name, agent in specialist_agents.items():
        description = worker_descriptions.get(agent_name, f"{agent_name}: A specialist agent")
        workforce.add_single_agent_worker(description, agent)
        logger.debug(f"[WORKFORCE] Added {agent_name} to workforce")

    logger.info(f"[WORKFORCE] Workforce created with {len(specialist_agents)} specialist agents")
    return workforce


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


# ============================================================================
# TRIAGE FUNCTIONS - Dynamic Task Routing
# ============================================================================

# Medical Assistant Coordinator prompt for triage and direct answering
MEDICAL_COORDINATOR_PROMPT = """You are MedGemma, a knowledgeable and helpful medical assistant.

<your_role>
You serve as both a medical information assistant AND a coordinator for complex tasks.
For simple medical questions, you provide direct, accurate answers.
For complex tasks requiring specialized tools (image analysis, web search, document creation),
you coordinate with specialized agents.
</your_role>

<guidelines>
- Provide accurate, evidence-based medical information
- Use clear, accessible language while maintaining medical accuracy
- Always recommend consulting healthcare professionals for personal medical decisions
- Be empathetic and supportive in your responses
- Cite medical sources when appropriate
- Acknowledge uncertainty when information is limited or evolving
</guidelines>

<environment>
- System: {platform_system} ({platform_machine})
- Working Directory: {working_directory}
- Current Date: {current_date}
</environment>
"""


async def perform_triage(
        question: str,
        attachments: list[str],
        options: Chat,
        conversation_context: str,
) -> TriageResult:
    """
    Perform task complexity triage to determine the best processing path.

    Args:
        question: The user's question
        attachments: List of attached file paths
        options: Chat configuration options
        conversation_context: Previous conversation context

    Returns:
        TriageResult with complexity level and optional direct answer
    """
    logger.info(f"[TRIAGE] Starting triage for question: {question[:100]}...")

    working_directory = get_working_directory(options)

    # Build the triage coordinator prompt
    triage_prompt = MEDICAL_COORDINATOR_PROMPT.format(
        platform_system=platform.system(),
        platform_machine=platform.machine(),
        working_directory=working_directory,
        current_date=datetime.date.today(),
    )

    # Create a lightweight coordinator agent for triage
    # No tools needed - just evaluation and direct answering
    triage_agent = agent_model(
        "triage_coordinator",
        triage_prompt,
        options,
        tools=[],  # No tools for triage - pure LLM evaluation
    )

    try:
        # Perform complexity evaluation
        result = await evaluate_task_complexity(
            coordinator_agent=triage_agent,
            question=question,
            attachments=attachments if attachments else None,
        )

        logger.info(
            f"[TRIAGE] Completed: complexity={result.complexity.value}, "
            f"reasoning={result.reasoning[:100]}..."
        )

        return result

    except Exception as e:
        logger.error(f"[TRIAGE] Error during triage: {e}", exc_info=True)
        # Default to COMPLEX on error (most conservative)
        return TriageResult(
            complexity=ComplexityLevel.COMPLEX,
            reasoning=f"Triage error: {str(e)}. Defaulting to full processing.",
            suggested_agents=[],
            direct_answer=None,
        )