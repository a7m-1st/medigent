# MedGemma Project

This project consists of a multi-agent system with a FastAPI backend and React frontend, integrated with the MedGemma AI model through vLLM.

## Project Structure

- `backend/` - FastAPI backend with multi-agent system
- `frontend/` - React + TypeScript + Vite frontend
- `model/` - vLLM service configuration for MedGemma model
- `.opencode/` - Multi-agent configuration for specialized agents

## Quick Start

### Prerequisites

- Docker and Docker Compose
- Python 3.11+ (for running backend without Docker)
- Node.js 20+ (for running frontend without Docker)
- Hugging Face account and API token
- (Optional) Cloudflare Tunnel token for external access

---

## Running the Model Service (vLLM)

The `model/` directory contains the vLLM service for running the MedGemma model.

### Setup

1. Navigate to the model directory:
   ```bash
   cd model
   ```

2. Copy the environment file and configure it:
   ```bash
   cp .env.example .env
   ```

3. Edit `.env` and add your tokens:
   ```env
   HF_TOKEN=your_huggingface_token_here
   CF_TUNNEL_TOKEN=your_cloudflare_tunnel_token_here  # Optional
   ```

4. Create the models directory:
   ```bash
   mkdir -p models
   ```

### Start the vLLM Service

```bash
cd model
docker-compose up -d
```

This will:
- Download the `google/medgemma-4b-it` model (first run may take several minutes)
- Start the vLLM server on port 8000
- (Optional) Start Cloudflare tunnel for external access

### Verify the Model Service

```bash
curl http://localhost:8000/health
```

### Stop the Model Service

```bash
cd model
docker-compose down
```

---

## Running the Full Stack with Docker Compose

To run the entire application (backend + frontend + model) together:

### From the Root Directory

```bash
docker-compose up -d
```

This builds and starts:
- Frontend (built into static files)
- Backend (FastAPI serving on port 8000)
- Combined into a single container

### Access the Application

- Web UI: http://localhost:8000
- Health Check: http://localhost:8000/health

### Stop the Full Stack

```bash
docker-compose down
```

---

## Running the Backend Without Docker

If you prefer to run the backend directly without Docker:

### Prerequisites

- Python 3.11 or 3.12
- UV package manager (recommended) or pip

### Setup

1. Navigate to the backend directory:
   ```bash
   cd backend
   ```

2. Create a virtual environment and install dependencies using UV:
   ```bash
   uv sync
   ```

### Start the Backend

Using UV:
```bash
cd backend
uv run uvicorn app:api --host 0.0.0.0 --port 3001 --reload
```

Using Python directly:
```bash
cd backend
source .venv/bin/activate  # On Windows: .venv\Scripts\activate
uvicorn app:api --host 0.0.0.0 --port 3001 --reload
```

### Backend API Endpoints

- `GET /health` - Health check
- `POST /chat` - Start a new chat session (SSE streaming)
- `POST /chat/{project_id}` - Continue/improve chat
- `POST /chat/{project_id}/human-reply` - Send human reply to agent
- `DELETE /chat/{project_id}` - Stop chat session
- `POST /model/validate` - Validate model configuration
- `POST /task/{project_id}/start` - Start/resume task
- `DELETE /task/stop-all` - Stop all tasks

### Development Mode

The backend runs with debugpy enabled on port 5678 for debugging.

---

## Running the Frontend Without Docker

To run the frontend in development mode:

```bash
cd frontend
npm install
npm run dev
```

The frontend will be available at http://localhost:5173 (or another port if 5173 is in use).

---

## Development Workflow

Terminal 1 - Backend:
```bash
cd backend
uv run uvicorn app:api --host 0.0.0.0 --port 3001 --reload
```

Terminal 2 - Frontend:
```bash
cd frontend
npm run dev
```

---

## Testing

Run the backend API tests:

```bash
cd backend
python test_api.py
```

**Note:** Update the `API_KEY` in `test_api.py` before running tests.

---

## Environment Variables

### Model Service (`model/.env`)

| Variable | Description | Required |
|----------|-------------|----------|
| `HF_TOKEN` | Hugging Face API token | Yes |
| `CF_TUNNEL_TOKEN` | Cloudflare Tunnel token | No |

---

## Troubleshooting

### Frontend Issues

**Node modules issues:**
```bash
cd frontend
rm -rf node_modules package-lock.json
npm install
```

---

## Architecture

- **Frontend**: React + TypeScript + Vite + Tailwind CSS
- **Backend**: FastAPI + Python 3.11/3.12 + UV package manager
- **AI Model**: MedGemma 4B (google/medgemma-4b-it) via vLLM
- **Agents**: Multi-agent system using CAMEL-AI framework

---

## License

See [LICENSE](LICENSE) file for details.
