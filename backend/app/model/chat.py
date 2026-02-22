import json
import logging
import os
import re
from pathlib import Path
from typing import Literal

from camel.types import ModelType, RoleType
from pydantic import BaseModel, Field, field_validator, model_validator

from app.model.enums import DEFAULT_SUMMARY_PROMPT, Status  # noqa: F401

logger = logging.getLogger("chat_model")


class ChatHistory(BaseModel):
    role: RoleType
    content: str


class QuestionAnalysisResult(BaseModel):
    type: Literal["simple", "complex"] = Field(
        description="Whether this is a simple question or complex task"
    )
    answer: str | None = Field(
        default=None,
        description="Direct answer for simple questions."
        " None for complex tasks.",
    )


McpServers = dict[Literal["mcpServers"], dict[str, dict]]


class AgentConfig(BaseModel):
    """Configuration for a specific agent type (e.g., Gemini 3 or MedGemma 4B).
    
    Used for primary_agent (Gemini 3 agents) and secondary_agent (MedGemma 4B agents).
    Falls back to Chat global config if not provided.
    """
    api_url: str | None = None
    model_type: str | None = None
    model_platform: str | None = None
    api_key: str | None = None
    use_simulated_tool_calling: bool = False
    # Maximum context window size in tokens for this agent's model.
    # Used as token_limit for CAMEL's auto-compaction (context summarization).
    # If None, CAMEL uses the model backend's default token limit.
    model_context_size: int | None = None
    
    def get_effective_config(self, fallback: "AgentConfig") -> "AgentConfig":
        """Returns a new AgentConfig with fallbacks applied."""
        return AgentConfig(
            api_url=self.api_url or fallback.api_url,
            model_type=self.model_type or fallback.model_type,
            model_platform=self.model_platform or fallback.model_platform,
            api_key=self.api_key or fallback.api_key,
            use_simulated_tool_calling=self.use_simulated_tool_calling or fallback.use_simulated_tool_calling,
            model_context_size=self.model_context_size or fallback.model_context_size,
        )
    
    def has_custom_config(self) -> bool:
        """Check if any custom configuration values are set."""
        return any([
            self.api_url,
            self.model_type,
            self.model_platform,
            self.api_key,
        ])

class ChatMessage(BaseModel):
    id: str
    role: str
    content: str
    timestamp: str
    images: list[str] | None = None


class Chat(BaseModel):
    task_id: str
    project_id: str
    question: str
    attaches: list[str] = []
    # Model config fields: optional, fall back to env vars if not provided
    model_platform: str = ""
    model_type: str = ""
    api_key: str = ""
    # for cloud version, user don't need to set api_url
    api_url: str | None = None
    max_retries: int = 3
    installed_mcp: McpServers = {"mcpServers": {}}
    summary_prompt: str = DEFAULT_SUMMARY_PROMPT
    # Check if we need to use simulated tool calling
    # This is useful for models that don't support native function calling
    # like MedGemma, local LLMs, or other open-source models
    use_simulated_tool_calling: bool = False
    # Medical workforce model configurations
    # secondary_agent: For MedGemma 4B agents (Radiologist, Attending Physician, Clinical Pharmacologist)
    # Falls back to Chat global config if not provided
    secondary_agent: AgentConfig | None = None
    # Conversation history from frontend (last N messages for context)
    history: list[ChatMessage] = []

    @model_validator(mode="before")
    @classmethod
    def apply_env_defaults(cls, data: dict) -> dict:
        """Fill model config from environment variables when not
        provided by the frontend."""
        if isinstance(data, dict):
            if not data.get("api_key"):
                data["api_key"] = os.getenv("GEMINI_API_KEY", "")
            if not data.get("model_platform"):
                data["model_platform"] = os.getenv(
                    "MODEL_PLATFORM", ""
                )
            if not data.get("model_type"):
                data["model_type"] = os.getenv("MODEL_TYPE", "")
            if not data.get("api_url"):
                env_url = os.getenv("API_URL", "")
                if env_url:
                    data["api_url"] = env_url
            
            # Set default secondary_agent (MedGemma) configuration if not provided
            if not data.get("secondary_agent"):
                medgemma_ctx = os.getenv("MEDGEMMA_CONTEXT_SIZE", "16384")
                data["secondary_agent"] = {
                    "api_url": os.getenv("MEDGEMMA_API_URL", "https://med.awelkaircodes.org/v1"),
                    "model_platform": os.getenv("MEDGEMMA_MODEL_PLATFORM", "openai-compatible-model"),
                    "model_type": os.getenv("MEDGEMMA_MODEL_TYPE", "medgemma-4b"),
                    "use_simulated_tool_calling": True,
                    "model_context_size": int(medgemma_ctx) if medgemma_ctx else None,
                }
        return data

    @field_validator("model_type")
    @classmethod
    def check_model_type(cls, model_type: str):
        try:
            # Try to get the enum by name and return its value
            enum_member = ModelType[model_type]
            return enum_member.value
        except KeyError:
            # Not a valid enum name, return as-is
            logger.debug(
                f"model_type '{model_type}' is not a"
                f" valid ModelType enum"
            )
        return model_type

    def file_save_path(self, path: str | None = None):
        # Use project-based structure: project_{project_id}/task_{task_id}
        save_path = (
            Path.home()
            / "medgemma"
            / f"project_{self.project_id}"
            / f"task_{self.task_id}"
        )
        if path is not None:
            save_path = save_path / path
        save_path.mkdir(parents=True, exist_ok=True)

        return str(save_path)


class SupplementChat(BaseModel):
    question: str
    task_id: str | None = None
    project_id: str | None = None
    attaches: list[str] = []


class HumanReply(BaseModel):
    agent: str
    reply: str
    attaches: list[str] = []


class TaskContent(BaseModel):
    id: str
    content: str


class UpdateData(BaseModel):
    task: list[TaskContent]


class AgentModelConfig(BaseModel):
    """Optional per-agent model configuration
    to override the default task model."""

    model_platform: str | None = None
    model_type: str | None = None
    api_key: str | None = None
    api_url: str | None = None
    # Context window size in tokens, passed from AgentConfig (secondary agents).
    # Used as token_limit for CAMEL's auto-compaction.
    model_context_size: int | None = None

    def has_custom_config(self) -> bool:
        """Check if any custom model configuration is set."""
        return any(
            [
                self.model_platform is not None,
                self.model_type is not None,
                self.api_key is not None,
                self.api_url is not None,
            ]
        )


class NewAgent(BaseModel):
    name: str
    description: str
    tools: list[str]
    mcp_tools: McpServers | None
    custom_model_config: AgentModelConfig | None = None


class AddTaskRequest(BaseModel):
    content: str
    project_id: str | None = None
    task_id: str | None = None
    additional_info: dict | None = None
    insert_position: int = -1
    is_independent: bool = False


class RemoveTaskRequest(BaseModel):
    task_id: str


def sse_json(step: str, data):
    res_format = {"step": step, "data": data}
    return f"data: {json.dumps(res_format, ensure_ascii=False)}\n\n"
