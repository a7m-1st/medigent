# Medigent - Your Intelligent Partner for Medical Insights

This project consists of a multi-agent system with a FastAPI backend and React frontend, integrated with the MedGemma AI model.

## Project Structure

- `backend/` - FastAPI backend with multi-agent system
- `frontend/` - React + TypeScript + Vite frontend
- `model/` - vLLM service configuration for MedGemma model
- `.opencode/` - Multi-agent configuration for specialized agents

## Quick Start

### Prerequisites

- Python 3.11 or 3.12
- Node.js 20+
- UV package manager
- Hugging Face account and API token
- Docker and Docker Compose
- (Optional) Cloudflare Tunnel token for external access

### Running Locally (Development)

#### 1. Frontend

```bash
cd frontend
npm install
npm run dev
```

#### 2. Backend

```bash
cd backend
uv sync
uv run uvicorn app:api --host 0.0.0.0 --port 3001 --reload
```

### Running with Docker (Recommended for Production)
To run the full-stack application:

**From the root directory**
```bash
docker-compose up -d
```
This builds and starts:
- Frontend (built into static files)
- Backend (FastAPI serving on port 8000)
- Combined into a single container

**Access the Application:** http://localhost:8000

**NOTE:** By default, the agents use Gemini and Medigent team's hosted MedGemma API. To switch to local hardware (fully private/offline), view the **Setting Up Local Model** section.

## Setting Up Local Model (Optional)

_Use this option if you want to run the MedGemma model entirely on your own hardware rather than relying on external hosted servers for full data privacy and offline performance._

### Option 1: Python Script
1. Configure your HuggingFace token in `model/.env`:

   ```
   HF_TOKEN=your_token_here
   ```

2. Run the weights download script:

   ```bash
   cd backend
   uv run python app/model/download_models.py
   ```

   _This script fetches the base MedGemma GGUF and the required vision projector file._

3. Once downloaded, the app will automatically use the local .GGUF files from `./model/models/` for inference.

### Option 2: Run via Docker
This starts the `llama.cpp` server with GPU acceleration and the Cloudflare tunnel.

1. Ensure `model/.env` contains `HF_TOKEN` and `CF_TUNNEL_TOKEN`.

2. Launch Services

   ```bash
   cd model
   docker-compose up -d
   ```

3. The model server will be available at `http://localhost:8000`

## Security & Encryption

To protect sensitive agent credentials (like API keys), Medigent uses Fernet symmetric encryption. API keys are encrypted on the frontend before being sent to the backend, where they are decrypted for use.

### Configuration Required

1. **Generate an encryption key:**
   ```bash
   python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
   ```

2. **Configure the backend:**
   Add to `backend/.env`:
   ```
   ENCRYPTION_KEY=your_generated_key_here
   ```

3. **Configure the frontend:**
   Add to `frontend/.env.local`:
   ```
   VITE_ENCRYPTION_KEY=your_generated_key_here
   ```

Make sure both keys match exactly.
