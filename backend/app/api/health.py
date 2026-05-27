import redis
from fastapi import APIRouter

from app.core.config import settings
from app.db.session import check_db_connection


router = APIRouter(prefix="/health", tags=["health"])


def check_redis_connection() -> bool:
    try:
        client = redis.from_url(settings.redis_url)
        return bool(client.ping())
    except Exception:
        return False


@router.get("")
def health_check() -> dict:
    db_ok = check_db_connection()
    redis_ok = check_redis_connection()

    status = "ok" if db_ok and redis_ok else "degraded"

    return {
        "status": status,
        "database": "ok" if db_ok else "error",
        "redis": "ok" if redis_ok else "error",
    }
