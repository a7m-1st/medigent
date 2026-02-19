

import platform

from camel.messages import BaseMessage
from camel.toolkits import ToolkitMessageIntegration

from app.agent.agent_model import agent_model
from app.agent.listen_chat_agent import logger
from app.agent.prompt import CHIEF_OF_MEDICINE_PROMPT
from app.agent.toolkit.human_toolkit import HumanToolkit
from app.agent.toolkit.note_taking_toolkit import NoteTakingToolkit
from app.agent.utils import NOW_STR
from app.model.chat import AgentConfig, Chat
from app.service.task import Agents
from app.utils.file_utils import get_working_directory


async def chief_of_medicine_agent(options: Chat):
    """Create Chief of Medicine agent (Gemini 3 - Coordinator)
    
    This agent uses primary_agent config (Gemini 3) for task orchestration.
    Falls back to global Chat config if primary_agent not provided.
    """
    working_directory = get_working_directory(options)
    logger.info(
        f"Creating Chief of Medicine agent for project: {options.project_id} "
        f"in directory: {working_directory}"
    )
    
    # Get effective configuration
    # primary_agent -> Chat global config
    global_config = AgentConfig(
        api_url=options.api_url,
        model_type=options.model_type,
        model_platform=options.model_platform,
        api_key=options.api_key,
    )
    effective_config = options.primary_agent.get_effective_config(global_config) if options.primary_agent else global_config
    
    message_integration = ToolkitMessageIntegration(
        message_handler=HumanToolkit(
            options.project_id, Agents.chief_of_medicine
        ).send_message_to_user
    )
    
    note_toolkit = NoteTakingToolkit(
        api_task_id=options.project_id,
        agent_name=Agents.chief_of_medicine,
        working_directory=working_directory,
    )
    note_toolkit = message_integration.register_toolkits(note_toolkit)
    
    tools = [
        *HumanToolkit.get_can_use_tools(
            options.project_id, Agents.chief_of_medicine
        ),
        *note_toolkit.get_tools(),
    ]
    
    system_message = CHIEF_OF_MEDICINE_PROMPT.format(
        platform_system=platform.system(),
        platform_machine=platform.machine(),
        working_directory=working_directory,
        now_str=NOW_STR,
    )
    
    # Create custom model config for this agent
    from app.model.chat import AgentModelConfig
    custom_config = AgentModelConfig(
        model_platform=effective_config.model_platform,
        model_type=effective_config.model_type,
        api_key=effective_config.api_key,
        api_url=effective_config.api_url,
    ) if effective_config.has_custom_config() else None
    
    return agent_model(
        Agents.chief_of_medicine,
        BaseMessage.make_assistant_message(
            role_name="Chief of Medicine",
            content=system_message,
        ),
        options,
        tools,
        tool_names=[
            HumanToolkit.toolkit_name(),
            NoteTakingToolkit.toolkit_name(),
        ],
        support_native_tool_calling=not options.use_simulated_tool_calling,
        custom_model_config=custom_config,
    )
