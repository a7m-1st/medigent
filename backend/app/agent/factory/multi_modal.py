import platform

from camel.messages import BaseMessage

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

    tools = []
    tool_names = []

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
