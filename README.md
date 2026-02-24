# Medigent - Your Intelligent Partner for Medical Insights

This project consists of a multi-agent system with a FastAPI backend and React frontend, integrated with the MedGemma AI model.

## Project Structure

- `backend/` - FastAPI backend with multi-agent system
- `frontend/` - React + TypeScript + Vite frontend
- `model/` - vLLM / llamacpp service configuration for MedGemma model

## Quick Start

### Prerequisites

- Docker and Docker Compose
  OR Locally with:
- Python 3.11 or 3.12
- Node.js 20+
- UV package manager
- Hugging Face account and API token
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

3. Once downloaded, you need to run the docker compose which will read the ./models directory

   ```bash
   cd model
   docker-compose up -d
   ```

4. You need to configure the Medgemma model config in https://medigent.awelkaircodes.org or your locally hosted frontend. The model server will be available at `http://localhost:8080/v1`. You need to host the backend locally if you don't have a public domain, or configure Cloudflare tunnel to use it with our public website.

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
