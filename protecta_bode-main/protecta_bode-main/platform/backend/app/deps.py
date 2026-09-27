"""Shared FastAPI dependencies: DB session, current user, role guards, internal key."""
from fastapi import Depends, Header, HTTPException, status
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import User, UserRole
from app.security import decode_jwt


def get_current_user(authorization: str = Header(default=""), db: Session = Depends(get_db)) -> User:
    if not authorization.startswith("Bearer "):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Missing bearer token")
    try:
        payload = decode_jwt(authorization.removeprefix("Bearer ").strip())
    except Exception:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or expired token")
    user = db.get(User, int(payload["sub"]))
    if not user or not user.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "User not found or inactive")
    return user


def get_optional_user(authorization: str = Header(default=""), db: Session = Depends(get_db)) -> User | None:
    """Like get_current_user but returns None for anonymous callers (public endpoints
    that optionally personalise). A supplied-but-bad token still fails loudly."""
    if not authorization.startswith("Bearer "):
        return None
    return get_current_user(authorization=authorization, db=db)


def require_role(*roles: UserRole):
    def guard(user: User = Depends(get_current_user)) -> User:
        if user.role not in roles:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Insufficient role")
        return user
    return guard


def require_internal_key(x_internal_key: str = Header(default="")) -> None:
    from app.config import get_settings
    if x_internal_key != get_settings().internal_api_key:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid internal key")


staff_roles = (UserRole.admin, UserRole.underwriter, UserRole.claims_handler)
