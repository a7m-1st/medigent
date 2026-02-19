"""
Task Complexity Triage Module

Evaluates incoming user questions and determines the appropriate
processing path:
- SIMPLE: Direct answer from Coordinator (no agent orchestration)
- MODERATE: 1-2 specialized agents
- COMPLEX: Full multi-agent task decomposition

This improves efficiency for simple queries while preserving
multi-agent capabilities for complex tasks.
"""

import logging
from dataclasses import dataclass
from enum import Enum
from typing import Optional

from camel.agents import ChatAgent

logger = logging.getLogger("triage")


class ComplexityLevel(str, Enum):
    """Task complexity classification."""
    SIMPLE = "simple"      # Direct answer, no tools needed
    MODERATE = "moderate"  # 1-2 agents needed
    COMPLEX = "complex"    # Full multi-agent orchestration


@dataclass
class TriageResult:
    """Result of task complexity assessment."""
    complexity: ComplexityLevel
    reasoning: str
    suggested_agents: list[str]  # Empty for SIMPLE, 1-2 for MODERATE
    direct_answer: Optional[str] = None  # Pre-generated answer for SIMPLE


# Triage prompt for the coordinator to evaluate task complexity
TRIAGE_PROMPT = """You are a medical assistant coordinator. Your job is to evaluate the user's question and determine how to best answer it.

## Classification Rules

### SIMPLE (Direct Answer)
Questions that can be answered directly from medical knowledge without any tools:
- General medical knowledge questions (e.g., "What is hypertension?", "What are symptoms of diabetes?")
- Medical term explanations
- Basic health information
- Simple factual questions about conditions, medications, or procedures

### MODERATE (1-2 Agents)
Questions that need ONE specific capability:
- Image/scan analysis → multi_modal_agent
- Web search for latest research → browser_agent
- Document generation/editing → document_agent
- Code execution or file operations → developer_agent

### COMPLEX (Full Orchestration)
Questions that require MULTIPLE capabilities combined:
- Analyzing multiple images + generating a report
- Research + document creation + code execution
- Multi-step workflows with dependencies
- Tasks explicitly requesting multiple outputs

## User's Question
{question}

## Attached Files
{attachments}

## Your Task
Analyze the question and respond in this EXACT format:

COMPLEXITY: [SIMPLE|MODERATE|COMPLEX]
REASONING: [Brief explanation of why this classification]
AGENTS: [Comma-separated list of needed agents, or "none" for SIMPLE]

If COMPLEXITY is SIMPLE, also provide:
ANSWER: [Your direct, helpful answer to the question]

Remember:
- For SIMPLE questions, provide a complete, accurate medical answer
- Be conservative: when in doubt, classify as MODERATE or COMPLEX
- Medical image analysis ALWAYS requires multi_modal_agent (MODERATE or higher)
"""


def parse_triage_response(response: str) -> TriageResult:
    """Parse the coordinator's triage response into a TriageResult."""
    lines = response.strip().split('\n')

    complexity = ComplexityLevel.COMPLEX  # Default to most conservative
    reasoning = ""
    agents = []
    direct_answer = None

    current_section = None
    answer_lines = []

    for line in lines:
        line_stripped = line.strip()

        if line_stripped.startswith("COMPLEXITY:"):
            value = line_stripped.replace("COMPLEXITY:", "").strip().upper()
            if value == "SIMPLE":
                complexity = ComplexityLevel.SIMPLE
            elif value == "MODERATE":
                complexity = ComplexityLevel.MODERATE
            else:
                complexity = ComplexityLevel.COMPLEX
            current_section = "complexity"

        elif line_stripped.startswith("REASONING:"):
            reasoning = line_stripped.replace("REASONING:", "").strip()
            current_section = "reasoning"

        elif line_stripped.startswith("AGENTS:"):
            agents_str = line_stripped.replace("AGENTS:", "").strip().lower()
            if agents_str and agents_str != "none":
                agents = [a.strip() for a in agents_str.split(",") if a.strip()]
            current_section = "agents"

        elif line_stripped.startswith("ANSWER:"):
            answer_lines = [line_stripped.replace("ANSWER:", "").strip()]
            current_section = "answer"

        elif current_section == "answer" and line_stripped:
            # Continue collecting answer lines
            answer_lines.append(line_stripped)

    if answer_lines:
        direct_answer = "\n".join(answer_lines)

    return TriageResult(
        complexity=complexity,
        reasoning=reasoning,
        suggested_agents=agents,
        direct_answer=direct_answer,
    )


async def evaluate_task_complexity(
    coordinator_agent: ChatAgent,
    question: str,
    attachments: list[str] | None = None,
) -> TriageResult:
    """
    Evaluate the complexity of a user's question using the coordinator agent.

    Args:
        coordinator_agent: The coordinator agent to use for evaluation
        question: The user's question
        attachments: List of file paths attached to the question

    Returns:
        TriageResult with complexity level and optional direct answer
    """
    # Format attachments info
    if attachments:
        attachments_info = "\n".join(f"- {path}" for path in attachments)
    else:
        attachments_info = "None"

    # Build the triage prompt
    prompt = TRIAGE_PROMPT.format(
        question=question,
        attachments=attachments_info,
    )

    logger.info(f"[TRIAGE] Evaluating question complexity: {question[:100]}...")

    try:
        # Get coordinator's assessment
        response = coordinator_agent.step(prompt)
        response_text = response.msgs[0].content if response.msgs else ""

        logger.debug(f"[TRIAGE] Raw response: {response_text[:500]}...")

        # Parse the response
        result = parse_triage_response(response_text)

        logger.info(
            f"[TRIAGE] Result: complexity={result.complexity.value}, "
            f"agents={result.suggested_agents}, "
            f"reasoning={result.reasoning[:100]}..."
        )

        # Validation: if attachments exist, cannot be SIMPLE
        if attachments and result.complexity == ComplexityLevel.SIMPLE:
            logger.info(
                "[TRIAGE] Upgrading SIMPLE to MODERATE due to attachments"
            )
            result = TriageResult(
                complexity=ComplexityLevel.MODERATE,
                reasoning=f"Has attachments. Original: {result.reasoning}",
                suggested_agents=["multi_modal_agent"],
                direct_answer=None,
            )

        return result

    except Exception as e:
        logger.error(f"[TRIAGE] Error during evaluation: {e}", exc_info=True)
        # Default to COMPLEX on error (most conservative)
        return TriageResult(
            complexity=ComplexityLevel.COMPLEX,
            reasoning=f"Error during triage: {str(e)}",
            suggested_agents=[],
            direct_answer=None,
        )


# Agent name mapping for frontend display
AGENT_DISPLAY_NAMES = {
    "browser_agent": "Browser Agent",
    "developer_agent": "Developer Agent",
    "document_agent": "Document Agent",
    "multi_modal_agent": "Multi-Modal Agent",
}