import os
from pathlib import Path

import debugpy
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from app.router import register_routers

# Load .env from the backend directory (project-level config)
_backend_env = Path(__file__).resolve().parent.parent / ".env"
if _backend_env.exists():
    load_dotenv(dotenv_path=str(_backend_env), override=False)
    print(f"Loaded environment from {_backend_env}")

# Start debugpy on port 5678
debugpy.listen(("0.0.0.0", 5678))
print("Debugpy listening on port 5678 - Attach your debugger now if needed")

# Initialize FastAPI with title
api = FastAPI(title="Eigent Multi-Agent System API")

# Add CORS middleware - for development, allow all origins
# For production, specify exact origins
api.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allow all origins in development
    allow_credentials=False,  # Must be False when allow_origins is ["*"]
    allow_methods=["GET", "POST", "DELETE", "OPTIONS", "PUT", "PATCH"],
    allow_headers=["*"],
    expose_headers=["*"],  # Required for SSE headers to be accessible
)

# Register all routers
register_routers(api)

# Serve static files from the frontend build
static_dir = os.path.join(os.path.dirname(__file__), "static")
if os.path.exists(static_dir):
    api.mount("/", StaticFiles(directory=static_dir, html=True), name="static")

    @api.get("/{path:path}")
    async def catch_all(path: str):
        return FileResponse(os.path.join(static_dir, "index.html"))
