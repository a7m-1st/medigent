

import platform

from camel.messages import BaseMessage
from camel.models import ModelFactory
from camel.toolkits import ToolkitMessageIntegration

from app.agent.agent_model import agent_model
from app.agent.listen_chat_agent import logger
from app.agent.prompt import RADIOLOGIST_PROMPT
from app.agent.toolkit.human_toolkit import HumanToolkit
from app.agent.toolkit.image_analysis_toolkit import ImageAnalysisToolkit
from app.agent.toolkit.note_taking_toolkit import NoteTakingToolkit
from app.agent.toolkit.video_analysis_toolkit import VideoAnalysisToolkit
from app.agent.utils import NOW_STR
from app.model.chat import AgentConfig, Chat
from app.service.task import Agents
from app.utils.file_utils import get_working_directory


async def radiologist_agent(options: Chat):
    """Create Radiologist agent (MedGemma 4B - Medical Imaging)
    
    This agent uses secondary_agent config (MedGemma 4B) for medical image analysis.
    Falls back to primary_agent config, then global Chat config if not provided.
    """
    working_directory = get_working_directory(options)
    logger.info(
        f"Creating Radiologist agent for project: {options.project_id} "
        f"in directory: {working_directory}"
    )
    
    # Get effective configuration
    # secondary_agent -> primary_agent -> Chat global config
    global_config = AgentConfig(
        api_url=options.api_url,
        model_type=options.model_type,
        model_platform=options.model_platform,
        api_key=options.api_key,
    )
    
    if options.secondary_agent:
        # Use secondary agent config with fallback to global
        effective_config = options.secondary_agent.get_effective_config(global_config)
    elif options.primary_agent:
        # Fallback to primary agent config
        effective_config = options.primary_agent.get_effective_config(global_config)
    else:
        # Use global config
        effective_config = global_config
    
    message_integration = ToolkitMessageIntegration(
        message_handler=HumanToolkit(
            options.project_id, Agents.radiologist
        ).send_message_to_user
    )
    
    # Create model for image analysis toolkit
    toolkit_model = ModelFactory.create(
        model_platform=effective_config.model_platform.lower() if effective_config.model_platform else options.model_platform.lower(),
        model_type=effective_config.model_type if effective_config.model_type else options.model_type,
        api_key=effective_config.api_key if effective_config.api_key else options.api_key,
        url=effective_config.api_url if effective_config.api_url else options.api_url,
    )
    
    # Toolkits
    image_analysis_toolkit = ImageAnalysisToolkit(
        options.project_id, model=toolkit_model
    )
    image_analysis_toolkit = message_integration.register_toolkits(image_analysis_toolkit)
    
    video_analysis_toolkit = VideoAnalysisToolkit(
        options.project_id,
        working_directory=working_directory,
    )
    video_analysis_toolkit = message_integration.register_toolkits(video_analysis_toolkit)
    
    note_toolkit = NoteTakingToolkit(
        api_task_id=options.project_id,
        agent_name=Agents.radiologist,
        working_directory=working_directory,
    )
    note_toolkit = message_integration.register_toolkits(note_toolkit)
    
    tools = [
        *image_analysis_toolkit.get_tools(),
        *video_analysis_toolkit.get_tools(),
        *HumanToolkit.get_can_use_tools(
            options.project_id, Agents.radiologist
        ),
        *note_toolkit.get_tools(),
    ]
    
    system_message = RADIOLOGIST_PROMPT.format(
        platform_system=platform.system(),
        platform_machine=platform.machine(),
        working_directory=working_directory,
        now_str=NOW_STR,
    )
    
    from app.model.chat import AgentModelConfig
    custom_config = AgentModelConfig(
        model_platform=effective_config.model_platform,
        model_type=effective_config.model_type,
        api_key=effective_config.api_key,
        api_url=effective_config.api_url,
    ) if effective_config.has_custom_config() else None
    
    return agent_model(
        Agents.radiologist,
        BaseMessage.make_assistant_message(
            role_name="Radiologist",
            content=system_message,
        ),
        options,
        tools,
        tool_names=[
            ImageAnalysisToolkit.toolkit_name(),
            VideoAnalysisToolkit.toolkit_name(),
            HumanToolkit.toolkit_name(),
            NoteTakingToolkit.toolkit_name(),
        ],
        support_native_tool_calling=not options.use_simulated_tool_calling,
        custom_model_config=custom_config,
    )
