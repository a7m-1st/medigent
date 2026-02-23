

import asyncio
import logging
import os

from camel.toolkits import MCPToolkit

from app.agent.toolkit.audio_analysis_toolkit import AudioAnalysisToolkit
from app.agent.toolkit.document_analysis_toolkit import (
    DocumentAnalysisToolkit,
)
from app.agent.toolkit.image_analysis_toolkit import ImageAnalysisToolkit
from app.agent.toolkit.pubmed_toolkit import PubMedToolkit
from app.agent.toolkit.search_toolkit import SearchToolkit
from app.agent.toolkit.terminal_toolkit import TerminalToolkit
from app.agent.toolkit.video_analysis_toolkit import VideoAnalysisToolkit
from app.component.environment import env
from app.model.chat import McpServers
from app.agent.toolkit.abstract_toolkit import AbstractToolkit

logger = logging.getLogger(__name__)


async def get_toolkits(tools: list[str], agent_name: str, api_task_id: str):
    logger.info(
        f"Getting toolkits for agent: {agent_name}, "
        f"task: {api_task_id}, tools: {tools}"
    )
    toolkits = {
        "video_analysis_toolkit": VideoAnalysisToolkit,
        "audio_analysis_toolkit": AudioAnalysisToolkit,
        "image_analysis_toolkit": ImageAnalysisToolkit,
        "document_analysis_toolkit": DocumentAnalysisToolkit,
        "pubmed_toolkit": PubMedToolkit,
        "search_toolkit": SearchToolkit,
        "terminal_toolkit": TerminalToolkit,
    }
    res = []
    for item in tools:
        if item in toolkits:
            toolkit: AbstractToolkit = toolkits[item]
            toolkit.agent_name = agent_name
            toolkit_tools = toolkit.get_can_use_tools(api_task_id)
            toolkit_tools = (
                await toolkit_tools
                if asyncio.iscoroutine(toolkit_tools)
                else toolkit_tools
            )
            res.extend(toolkit_tools)
        else:
            logger.warning(f"Toolkit {item} not found for agent {agent_name}")
    return res


async def get_mcp_tools(mcp_server: McpServers):
    """Connect to MCP servers and return available tools.

    Raises:
        MCPConnectionError (from camel) or other exceptions on failure.
        The caller is responsible for handling errors — this function
        intentionally does NOT swallow them so that connection failures
        are surfaced to the user.
    """
    logger.info(
        f"Getting MCP tools for {len(mcp_server['mcpServers'])} servers"
    )
    if len(mcp_server["mcpServers"]) == 0:
        return []

    # Build a mutable copy of the config dict.
    # For STDIO servers (command-based), ensure a unified auth directory
    # so mcp-remote doesn't re-authenticate on each task.
    # For URL-based (remote) servers, skip env injection — it's unused.
    config_dict = {**mcp_server}
    for server_config in config_dict["mcpServers"].values():
        is_remote = "url" in server_config
        if not is_remote:
            if "env" not in server_config:
                server_config["env"] = {}
            if "MCP_REMOTE_CONFIG_DIR" not in server_config["env"]:
                server_config["env"]["MCP_REMOTE_CONFIG_DIR"] = env(
                    "MCP_REMOTE_CONFIG_DIR",
                    os.path.expanduser("~/.mcp-auth"),
                )

    mcp_toolkit = MCPToolkit(config_dict=config_dict, timeout=30)
    await mcp_toolkit.connect()

    logger.info(
        f"Successfully connected to MCP toolkit with "
        f"{len(mcp_server['mcpServers'])} servers"
    )
    tools = mcp_toolkit.get_tools()
    if tools:
        tool_names = [
            (
                tool.get_function_name()
                if hasattr(tool, "get_function_name")
                else str(tool)
            )
            for tool in tools
        ]
        logging.debug(f"MCP tool names: {tool_names}")
    return tools
