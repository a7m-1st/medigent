import platform

from camel.messages import BaseMessage
from camel.models import ModelFactory, OpenAIAudioModels
from camel.toolkits import ToolkitMessageIntegration
from camel.types import ModelPlatformType

from app.agent.agent_model import agent_model
from app.agent.listen_chat_agent import logger
from app.agent.prompt import MULTI_MODAL_SYS_PROMPT
from app.agent.utils import NOW_STR
from app.model.chat import Chat, AgentModelConfig
from app.service.task import Agents
from app.utils.file_utils import get_working_directory


def multi_modal_agent(options: Chat):
    # Use MedGemma for multi-modal analysis
    medgemma_config = AgentModelConfig(
        model_platform="openai-compatible-model",
        model_type="medgemma-4b-it-Q6_K.gguf",
        api_url="https://med.awelkaircodes.org/v1",
        api_key="anything",
    )

    working_directory = get_working_directory(options)
    logger.info(
        f"Creating multi-modal agent for project: {options.project_id} "
        f"in directory: {working_directory}"
    )

    message_integration = ToolkitMessageIntegration(
        message_handler=HumanToolkit(
            options.project_id, Agents.multi_modal_agent
        ).send_message_to_user
    )
    toolkit_model = ModelFactory.create(
        model_platform=options.model_platform.lower(),
        model_type=options.model_type,
        api_key=options.api_key,
        url=options.api_url,
    )
    image_analysis_toolkit = ImageAnalysisToolkit(
        options.project_id, model=toolkit_model
    )
    image_analysis_toolkit = message_integration.register_toolkits(
        image_analysis_toolkit
    )

    terminal_toolkit = TerminalToolkit(
        options.project_id,
        agent_name=Agents.multi_modal_agent,
        working_directory=working_directory,
        safe_mode=True,
        clone_current_env=True,
    )
    terminal_toolkit = message_integration.register_toolkits(terminal_toolkit)

    note_toolkit = NoteTakingToolkit(
        options.project_id,
        Agents.multi_modal_agent,
        working_directory=working_directory,
    )
    note_toolkit = message_integration.register_toolkits(note_toolkit)
    tools = [
        *image_analysis_toolkit.get_tools(),
        *HumanToolkit.get_can_use_tools(
            options.project_id, Agents.multi_modal_agent
        ),
        *terminal_toolkit.get_tools(),
        *note_toolkit.get_tools(),
    ]
    # Convert string model_platform to enum for comparison
    try:
        model_platform_enum = ModelPlatformType(options.model_platform.lower())
    except (ValueError, AttributeError):
        model_platform_enum = None

    if model_platform_enum == ModelPlatformType.OPENAI:
        audio_analysis_toolkit = AudioAnalysisToolkit(
            options.project_id,
            working_directory,
            OpenAIAudioModels(
                api_key=options.api_key,
                url=options.api_url,
            ),
        )
        audio_analysis_toolkit = message_integration.register_toolkits(
            audio_analysis_toolkit
        )
        tools.extend(audio_analysis_toolkit.get_tools())

    system_message = MULTI_MODAL_SYS_PROMPT.format(
        platform_system=platform.system(),
        platform_machine=platform.machine(),
        working_directory=working_directory,
        now_str=NOW_STR,
    )

    return agent_model(
        Agents.multi_modal_agent,
        BaseMessage.make_assistant_message(
            role_name="Multi Modal Agent",
            content=system_message,
        ),
        options,
        tools,
        tool_names=tool_names,
        custom_model_config=medgemma_config,
    )
