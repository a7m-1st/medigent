

import platform
import uuid

from camel.messages import BaseMessage
from camel.toolkits import ToolkitMessageIntegration

from app.agent.agent_model import agent_model
from app.agent.listen_chat_agent import logger
from app.agent.prompt import BROWSER_SYS_PROMPT
from app.agent.toolkit.human_toolkit import HumanToolkit
from app.agent.toolkit.hybrid_browser_toolkit import HybridBrowserToolkit
from app.agent.toolkit.note_taking_toolkit import NoteTakingToolkit
from app.agent.toolkit.terminal_toolkit import TerminalToolkit
from app.agent.utils import NOW_STR
from app.component.environment import env
from app.model.chat import Chat
from app.service.task import Agents
from app.utils.file_utils import get_working_directory


def browser_agent(options: Chat):
    working_directory = get_working_directory(options)
    logger.info(
        f"Creating browser agent for project: {options.project_id} "
        f"in directory: {working_directory}"
    )
    message_integration = ToolkitMessageIntegration(
        message_handler=HumanToolkit(
            options.project_id, Agents.browser_agent
        ).send_message_to_user
    )

    web_toolkit_custom = HybridBrowserToolkit(
        options.project_id,
        headless=False,
        browser_log_to_file=True,
        stealth=True,
        session_id=str(uuid.uuid4())[:8],
        default_start_url="about:blank",
        cdp_url=f"http://localhost:{env('browser_port', '9222')}",
        enabled_tools=[
            "browser_click",
            "browser_type",
            "browser_back",
            "browser_forward",
            "browser_select",
            "browser_console_exec",
            "browser_console_view",
            "browser_switch_tab",
            "browser_enter",
            "browser_visit_page",
            "browser_scroll",
            "browser_sheet_read",
            "browser_sheet_input",
            "browser_get_page_snapshot",
        ],
    )

    # Save reference before registering for toolkits_to_register_agent
    web_toolkit_for_agent_registration = web_toolkit_custom
    web_toolkit_custom = message_integration.register_toolkits(
        web_toolkit_custom
    )

    terminal_toolkit = TerminalToolkit(
        options.project_id,
        Agents.browser_agent,
        working_directory=working_directory,
        safe_mode=True,
        clone_current_env=True,
    )
    terminal_toolkit = message_integration.register_functions(
        [terminal_toolkit.shell_exec]
    )

    note_toolkit = NoteTakingToolkit(
        options.project_id,
        Agents.browser_agent,
        working_directory=working_directory,
    )
    note_toolkit = message_integration.register_toolkits(note_toolkit)

    tools = [
        *HumanToolkit.get_can_use_tools(
            options.project_id, Agents.browser_agent
        ),
        *web_toolkit_custom.get_tools(),
        *terminal_toolkit,
        *note_toolkit.get_tools(),
    ]

    system_message = BROWSER_SYS_PROMPT.format(
        platform_system=platform.system(),
        platform_machine=platform.machine(),
        working_directory=working_directory,
        now_str=NOW_STR,
    )

    return agent_model(
        Agents.browser_agent,
        BaseMessage.make_assistant_message(
            role_name="Browser Agent",
            content=system_message,
        ),
        options,
        tools,
        prune_tool_calls_from_memory=True,
        tool_names=[
            HybridBrowserToolkit.toolkit_name(),
            HumanToolkit.toolkit_name(),
            NoteTakingToolkit.toolkit_name(),
            TerminalToolkit.toolkit_name(),
        ],
        toolkits_to_register_agent=[web_toolkit_for_agent_registration],
        enable_snapshot_clean=True,
        support_native_tool_calling=not options.use_simulated_tool_calling,
    )
