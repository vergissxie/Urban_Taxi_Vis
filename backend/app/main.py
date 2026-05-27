from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.analytics import router as analytics_router
from app.api.assistant import router as assistant_router
from app.api.health import router as health_router
from app.api.matched import router as matched_router
from app.api.trajectory import router as trajectory_router
from app.core.config import settings


app = FastAPI(
    title=settings.app_name,
    version="0.1.0",
    description="Urban Taxi trajectory mining and visualization backend",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health_router)
app.include_router(trajectory_router)
app.include_router(analytics_router)
app.include_router(matched_router)
app.include_router(assistant_router)


@app.get("/")
def root() -> dict:
    return {
        "message": "Urban Taxi Vis backend is running",
        "docs": "/docs",
        "health": "/health",
    }
