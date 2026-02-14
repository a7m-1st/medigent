# Opencode Multi-Agent Configuration

This folder contains configurations for specialized agents that work on different aspects of the MedGemma project.

## Agent Selection

You can configure which model each agent uses by editing `agents-config.json`. Available models:

### Recommended Models by Agent Type:

**UI Agent (Frontend Development)**
- Claude 3.5 Sonnet - Excellent for React/TypeScript/UI components
- GPT-4 - Great for complex UI logic and state management
- Gemini Pro - Good for comprehensive frontend architecture

**Integration Agent (API/Data Flow)**
- Claude 3.5 Sonnet - Best for API integration and data modeling
- GPT-4 - Excellent for complex integrations and error handling
- Llama 3.1 70B - Good for open-source integration work

**Backend Agent (FastAPI/Python)**
- Claude 3.5 Sonnet - Excellent for Python/FastAPI development
- GPT-4 - Great for backend architecture and complex logic
- Gemini Pro - Good for comprehensive backend systems

## Usage

1. Edit `agents-config.json` to select models for each agent
2. Run agents using the opencode CLI
3. Agents will use their configured models automatically

## Agent Capabilities

### UI Agent
- React/TypeScript component development
- State management (Zustand/Redux)
- Styling (Tailwind CSS, shadcn/ui)
- Frontend architecture
- Component testing

### Integration Agent  
- API client development
- Type schema creation (Zod)
- Service layer implementation
- Data flow architecture
- Error handling strategies

### Backend Agent
- FastAPI route development
- Pydantic model creation
- Database integration
- Authentication/Authorization
- API documentation
