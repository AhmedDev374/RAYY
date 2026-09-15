import logging

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import get_db
from app.models import User
from app.security import decode_token
from app.services.supabase_auth import get_or_create_user_from_token

logger = logging.getLogger("uvicorn.error")
bearer_scheme = HTTPBearer(auto_error=False)
settings = get_settings()


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> User:
    # Safe, non-sensitive diagnostics: never log the token itself.
    logger.info(
        "auth_mode=%s authorization_header_present=%s bearer_token_present=%s supabase_url_configured=%s",
        settings.auth_mode,
        credentials is not None,
        bool(credentials and credentials.credentials),
        bool(settings.supabase_url),
    )

    if not credentials:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")

    token = credentials.credentials

    if settings.use_supabase_auth:
        user = get_or_create_user_from_token(db, token)
        if not user:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Supabase JWT verification failed")
        logger.info("authenticated_user_id=%s", user.id)
        return user

    payload = decode_token(token)
    if not payload or payload.get("type") != "access":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Legacy JWT invalid")
    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="No sub in token")
    user = db.get(User, int(user_id))
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found in DB")
    logger.info("authenticated_user_id=%s", user.id)
    return user


def get_user_from_token_string(db: Session, token: str) -> User | None:
    if settings.use_supabase_auth:
        return get_or_create_user_from_token(db, token)
    payload = decode_token(token)
    if not payload or payload.get("type") != "access":
        return None
    return db.get(User, int(payload["sub"]))
