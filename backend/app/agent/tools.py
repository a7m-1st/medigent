

import asyncio
import logging
import os

from camel.toolkits import MCPToolkit

from app.agent.toolkit.audio_analysis_toolkit import AudioAnalysisToolkit
from app.agent.toolkit.image_analysis_toolkit import ImageAnalysisToolkit
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
    logger.info(
        f"Getting MCP tools for {len(mcp_server['mcpServers'])} servers"
    )
    if len(mcp_server["mcpServers"]) == 0:
        return []

    # Ensure unified auth directory for all mcp-remote servers to avoid
    # re-authentication on each task
    config_dict = {**mcp_server}
    for server_config in config_dict["mcpServers"].values():
        if "env" not in server_config:
            server_config["env"] = {}
        # Set global auth directory to persist authentication across tasks
        if "MCP_REMOTE_CONFIG_DIR" not in server_config["env"]:
            server_config["env"]["MCP_REMOTE_CONFIG_DIR"] = env(
                "MCP_REMOTE_CONFIG_DIR", os.path.expanduser("~/.mcp-auth")
            )

    mcp_toolkit = None
    try:
        mcp_toolkit = MCPToolkit(config_dict=config_dict, timeout=180)
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
    except asyncio.CancelledError:
        logger.info("MCP connection cancelled during get_mcp_tools")
        return []
    except Exception as e:
        logger.error(f"Failed to connect MCP toolkit: {e}", exc_info=True)
        return []
