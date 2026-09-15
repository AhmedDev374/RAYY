import logging
import os
import re
import socket
import sys
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, Response
from fastapi.staticfiles import StaticFiles

from app.config import get_settings
from app.database import Base, SessionLocal, engine
from app.routers import auth, care, chat, content, devices, diagnosis, plants, sensors, simulation
from app.services.seed import seed_species_profiles

logger = logging.getLogger("uvicorn.error")
settings = get_settings()

DEFAULT_ORIGINS = {
    "http://localhost:5173",
    "http://localhost:5174",  # Vite falls back here when 5173 is taken
    "http://localhost:5175",  # ...and again when 5174 is taken
    "http://localhost:3000",
    "https://smart-plant-dr.vercel.app",
}
VERCEL_ORIGIN_RE = re.compile(r"^https://[\w-]+\.vercel\.app$")
# Vite auto-increments the dev port whenever the chosen one is busy, so a
# hardcoded list can never keep up (5173 -> 5174 -> 5175 -> ...). Any loopback
# origin is allowed: a browser can only send an Origin matching the page it is
# actually serving, so this cannot be abused by a remote page.
LOCALHOST_ORIGIN_RE = re.compile(r"^http://(?:localhost|127\.0\.0\.1)(?::\d+)?$")


def is_allowed_origin(origin: str | None) -> bool:
    if not origin:
        return False
    if origin in DEFAULT_ORIGINS or origin in settings.cors_origin_list:
        return True
    if VERCEL_ORIGIN_RE.fullmatch(origin):
        return True
    return bool(LOCALHOST_ORIGIN_RE.fullmatch(origin))


_PROCESS_STARTED_AT = datetime.now(timezone.utc).isoformat(timespec="seconds")


def _serve_port() -> int:
    """The port this process was told to serve (uvicorn --port, else 8000)."""
    argv = sys.argv
    if "--port" in argv:
        index = argv.index("--port") + 1
        if index < len(argv) and argv[index].isdigit():
            return int(argv[index])
    return 8000


def _warn_if_port_already_served() -> None:
    """Report loudly when another process already owns our port.

    Windows lets a second uvicorn bind the same address:port without error
    (SO_REUSEADDR), and a killed `--reload` parent leaves an orphaned worker
    holding the socket. Two instances of different ages then split requests
    between them, so the same test can measure two completely different
    latencies depending on which one answers. uvicorn binds this port only
    *after* the lifespan startup below finishes, so a successful connect here
    can only be somebody else.
    """
    port = _serve_port()
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.settimeout(1.0)
        occupied = probe.connect_ex(("127.0.0.1", port)) == 0

    if occupied:
        logger.error(
            "DUPLICATE BACKEND: something is already listening on 127.0.0.1:%s. "
            "Requests will be split between both instances and may be served by "
            "stale code. Stop the other backend (including any orphaned uvicorn "
            "worker left behind by an earlier --reload session) before testing.",
            port,
        )
    else:
        logger.info("Port %s is free - this is the only backend instance.", port)


@asynccontextmanager
async def lifespan(app: FastAPI):
    _warn_if_port_already_served()
    if settings.use_supabase_auth:
        auth_detail = f"Supabase URL configured: {bool(settings.supabase_url)}"
    else:
        auth_detail = f"Legacy JWT secret set: {settings.secret_key != 'dev-secret-key-change-this'}"

    logger.info(
        "Auth mode: %s | %s | DB: %s | CORS env: %s | Blynk: %s | ML model: %s",
        settings.auth_mode,
        auth_detail,
        settings.database_url[:40] + "...",
        settings.cors_origin_list,
        bool(settings.blynk_auth_token),
        (Path(__file__).resolve().parent / "ml" / "exports" / "smart_plant_doctor_model.pth").is_file(),
    )
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        seed_species_profiles(db)
    finally:
        db.close()
    uploads = Path(settings.uploads_dir)
    uploads.mkdir(parents=True, exist_ok=True)
    yield


app = FastAPI(title=settings.app_name, lifespan=lifespan)


@app.middleware("http")
async def cors_middleware(request: Request, call_next):
    origin = request.headers.get("origin")
    allowed = is_allowed_origin(origin)

    if request.method == "OPTIONS":
        if not allowed:
            return Response(status_code=400, content="CORS origin not allowed")
        requested_headers = request.headers.get("Access-Control-Request-Headers", "Authorization, Content-Type")
        return Response(
            status_code=200,
            headers={
                "Access-Control-Allow-Origin": origin or "",
                "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
                "Access-Control-Allow-Headers": requested_headers,
                "Access-Control-Allow-Credentials": "true",
                "Access-Control-Max-Age": "600",
                "Vary": "Origin",
            },
        )

    try:
        response = await call_next(request)
    except Exception:
        logger.exception("Unhandled request error")
        response = JSONResponse(status_code=500, content={"detail": "Internal server error"})

    if allowed and origin:
        response.headers["Access-Control-Allow-Origin"] = origin
        response.headers["Access-Control-Allow-Credentials"] = "true"
        response.headers["Vary"] = "Origin"
    return response


prefix = settings.api_v1_prefix
app.include_router(auth.router, prefix=prefix)
app.include_router(plants.router, prefix=prefix)
app.include_router(devices.router, prefix=prefix)
app.include_router(sensors.router, prefix=prefix)
app.include_router(simulation.router, prefix=prefix)
app.include_router(diagnosis.router, prefix=prefix)
app.include_router(care.router, prefix=prefix)
app.include_router(content.router, prefix=prefix)
app.include_router(chat.router, prefix=prefix)

# NOTE: this used to be guarded by `if os.path.isdir(settings.uploads_dir)`, which
# ran at import time -- *before* the lifespan handler above had a chance to create
# the directory. On any fresh deploy (or ephemeral filesystem) the uploads dir
# didn't exist yet at import time, so the guard silently skipped the mount and
# every previously-uploaded diagnosis image 404'd ("broken image" in the UI),
# even though the file itself was written to disk correctly by the /diagnose
# endpoint. Create the directory here (idempotent) and always mount it.
os.makedirs(settings.uploads_dir, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=settings.uploads_dir), name="uploads")


@app.get("/health")
def health():
    # pid/started_at expose which instance answered: two different pids on this
    # port, or a started_at older than the code on disk, means a stale backend
    # is still serving some requests.
    return {
        "status": "ok",
        "pid": os.getpid(),
        "started_at": _PROCESS_STARTED_AT,
    }
