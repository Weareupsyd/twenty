"""JWT + password hashing + reference generators."""
import secrets
import uuid
from datetime import datetime, timedelta, timezone

import jwt
from passlib.context import CryptContext

from app.config import get_settings

settings = get_settings()
pwd_ctx = CryptContext(schemes=["bcrypt"], deprecated="auto")

ALGORITHM = "HS256"


def hash_password(plain: str) -> str:
    return pwd_ctx.hash(plain)


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_ctx.verify(plain, hashed)


def make_jwt(sub: str, role: str, minutes: int = 60 * 12, extra: dict | None = None) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": sub, "role": role, "iat": now,
        "exp": now + timedelta(minutes=minutes), "jti": uuid.uuid4().hex,
    }
    if extra:
        payload.update(extra)
    return jwt.encode(payload, settings.secret_key, algorithm=ALGORITHM)


def decode_jwt(token: str) -> dict:
    return jwt.decode(token, settings.secret_key, algorithms=[ALGORITHM])


def new_reference(prefix: str) -> str:
    """Short human-safe reference for payments, claims, and support tickets."""
    body = secrets.token_hex(3).upper()
    return f"{prefix}-{body}"


def new_opaque_id() -> str:
    """Random 15-digit public identifier for shareable quote URLs."""
    return str(secrets.randbelow(900_000_000_000_000) + 100_000_000_000_000)


def new_policy_no() -> str:
    year = datetime.now(timezone.utc).year
    return f"PB-{year}-{secrets.token_hex(3).upper()}"


def hmac_signature(secret: str, body: bytes) -> str:
    import hmac
    import hashlib
    return hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
