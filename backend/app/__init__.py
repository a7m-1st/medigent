

import debugpy
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.router import register_routers

# Start debugpy on port 5678
debugpy.listen(("0.0.0.0", 5678))
print("⏳ Debugpy listening on port 5678 - Attach your debugger now if needed")

# Initialize FastAPI with title
api = FastAPI(title="Eigent Multi-Agent System API")

# Add CORS middleware
api.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register all routers
register_routers(api)
