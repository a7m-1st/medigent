

import platform

from camel.messages import BaseMessage
from camel.toolkits import ToolkitMessageIntegration

from app.agent.agent_model import agent_model
from app.agent.listen_chat_agent import logger
from app.agent.prompt import DEVELOPER_SYS_PROMPT
from app.agent.toolkit.human_toolkit import HumanToolkit
from app.agent.toolkit.note_taking_toolkit import NoteTakingToolkit
from app.agent.toolkit.terminal_toolkit import TerminalToolkit
from app.agent.utils import NOW_STR
from app.model.chat import Chat
from app.service.task import Agents
from app.utils.file_utils import get_working_directory


async def developer_agent(options: Chat):
    working_directory = get_working_directory(options)
    logger.info(
        f"Creating developer agent for project: {options.project_id} "
        f"in directory: {working_directory}"
    )
    message_integration = ToolkitMessageIntegration(
        message_handler=HumanToolkit(
            options.project_id, Agents.developer_agent
        ).send_message_to_user
    )
    note_toolkit = NoteTakingToolkit(
        api_task_id=options.project_id,
        agent_name=Agents.developer_agent,
        working_directory=working_directory,
    )
    note_toolkit = message_integration.register_toolkits(note_toolkit)

    terminal_toolkit = TerminalToolkit(
        options.project_id,
        Agents.developer_agent,
        working_directory=working_directory,
        safe_mode=True,
        clone_current_env=True,
    )
    terminal_toolkit = message_integration.register_toolkits(terminal_toolkit)

    tools = [
        *HumanToolkit.get_can_use_tools(
            options.project_id, Agents.developer_agent
        ),
        *note_toolkit.get_tools(),
        *terminal_toolkit.get_tools(),
    ]
    system_message = DEVELOPER_SYS_PROMPT.format(
        platform_system=platform.system(),
        platform_machine=platform.machine(),
        working_directory=working_directory,
        now_str=NOW_STR,
    )

    return agent_model(
        Agents.developer_agent,
        BaseMessage.make_assistant_message(
            role_name="Developer Agent",
            content=system_message,
        ),
        options,
        tools,
        tool_names=[
            HumanToolkit.toolkit_name(),
            TerminalToolkit.toolkit_name(),
            NoteTakingToolkit.toolkit_name(),
        ],
    )
