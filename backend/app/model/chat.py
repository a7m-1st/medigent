

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

PLATFORM_MAPPING = {
    "Z.ai": "openai-compatible-model",
    "ModelArk": "openai-compatible-model",
}


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
    language: str = "en"
    browser_port: int = 9222
    max_retries: int = 3
    allow_local_system: bool = False
    installed_mcp: McpServers = {"mcpServers": {}}
    bun_mirror: str = ""
    uvx_mirror: str = ""
    env_path: str | None = None
    summary_prompt: str = DEFAULT_SUMMARY_PROMPT
    # For provider-specific parameters like Azure
    extra_params: dict | None = None
    # User-specific search engine configurations
    # (e.g., GOOGLE_API_KEY, SEARCH_ENGINE_ID)
    search_config: dict[str, str] | None = None
    # Check if we need to use simulated tool calling
    # This is useful for models that don't support native function calling
    # like MedGemma, local LLMs, or other open-source models
    use_simulated_tool_calling: bool = False

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
        return data

    @field_validator("model_platform")
    @classmethod
    def map_model_platform(cls, v: str) -> str:
        return PLATFORM_MAPPING.get(v, v)

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

    def get_bun_env(self) -> dict[str, str]:
        return (
            {"NPM_CONFIG_REGISTRY": self.bun_mirror} if self.bun_mirror else {}
        )

    def get_uvx_env(self) -> dict[str, str]:
        return (
            {
                "UV_DEFAULT_INDEX": self.uvx_mirror,
                "PIP_INDEX_URL": self.uvx_mirror,
            }
            if self.uvx_mirror
            else {}
        )

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
    attaches: list[str] = []


class HumanReply(BaseModel):
    agent: str
    reply: str


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
    extra_params: dict | None = None

    def has_custom_config(self) -> bool:
        """Check if any custom model configuration is set."""
        return any(
            [
                self.model_platform is not None,
                self.model_type is not None,
                self.api_key is not None,
                self.api_url is not None,
                self.extra_params is not None,
            ]
        )


class NewAgent(BaseModel):
    name: str
    description: str
    tools: list[str]
    mcp_tools: McpServers | None
    env_path: str | None = None
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
