"""Username/password sign-in and email-verified password setup/reset."""
import re
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field, field_validator, model_validator
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import get_db
from app.deps import get_current_user
from app.models import OtpCode, User
from app.schemas import TokenOut
from app.security import hash_password, make_jwt, verify_password
from app.services.clients import ServiceUnavailable, send_email, send_evolution_whatsapp_text

router = APIRouter(prefix="/auth", tags=["auth"])


def _email(value):
    if value is None or (isinstance(value, str) and not value.strip()):
        return None
    if not isinstance(value, str):
        return value
    value = value.strip().lower()
    if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", value):
        raise ValueError("Enter a valid email address")
    return value


def _normalize_phone(value):
    """Normalize local Ugandan input or international E.164 input to E.164."""
    if not isinstance(value, str):
        return value
    value = value.strip()
    digits = re.sub(r"\D", "", value)
    if value.startswith("+") or digits.startswith("256"):
        phone = f"+{digits}"
    else:
        phone = f"+256{digits.lstrip('0')}"
    if not re.fullmatch(r"\+[1-9]\d{7,14}", phone):
        raise ValueError("Enter a valid phone number, including the country code")
    return phone


class RequestOtp(BaseModel):
    phone: str = Field(min_length=8, max_length=20)  # E.164, e.g. +256772123456
    email: str | None = Field(default=None, max_length=160)  # first-time customer delivery address

    @field_validator("email", mode="before")
    @classmethod
    def validate_email(cls, value):
        return _email(value)


class VerifyOtp(BaseModel):
    phone: str
    code: str
    full_name: str | None = None   # required when creating a customer account
    password: str = Field(min_length=12, max_length=128)

    @field_validator("full_name", mode="before")
    @classmethod
    def trim_name(cls, value):
        return value.strip() if isinstance(value, str) else value


class RequestWhatsAppOtp(BaseModel):
    phone: str = Field(min_length=8, max_length=24)

    @field_validator("phone", mode="before")
    @classmethod
    def normalize_phone(cls, value):
        return _normalize_phone(value)


class VerifyWhatsAppOtp(BaseModel):
    phone: str = Field(min_length=8, max_length=24)
    code: str = Field(pattern=r"^\d{6}$")

    @field_validator("phone", mode="before")
    @classmethod
    def normalize_phone(cls, value):
        return _normalize_phone(value)


class PasswordLogin(BaseModel):
    username: str | None = Field(default=None, min_length=3, max_length=160)
    phone: str | None = Field(default=None, min_length=8, max_length=20)  # backwards-compatible alias
    password: str = Field(min_length=1, max_length=128)

    @model_validator(mode="after")
    def require_username(self):
        if not (self.username or self.phone):
            raise ValueError("username is required")
        return self


@router.post("/request-otp")
def request_otp(body: RequestOtp, db: Session = Depends(get_db)) -> dict:
    settings = get_settings()
    user = db.query(User).filter(User.phone == body.phone).first()
    # Existing users only receive codes at their already-registered address.
    # A new customer can supply an email because there is not yet a profile to look up.
    destination = user.email if user else body.email
    if settings.is_production and not destination:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            "An email address is required. If you already have an account, contact support to add or update it.")

    code = f"{secrets.randbelow(900000) + 100000}"
    if destination and settings.is_production:
        try:
            send_email("otp", destination, {
                "first_name": user.full_name.split(" ")[0] if user else "there",
                "otp_code": code,
            })
        except Exception as exc:
            if settings.is_production:
                raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE,
                                    "Could not deliver the one-time code. Please try again later.") from exc

    db.add(OtpCode(
        phone=body.phone,
        code=code,
        purpose="password_setup",
        email=destination,
        expires_at=datetime.now(timezone.utc) + timedelta(minutes=10),
    ))
    db.commit()
    response = {"sent": True, "delivery": "email" if settings.is_production else "sandbox"}
    if not settings.is_production:
        response["debug_code"] = code
    return response


@router.post("/verify-otp", response_model=TokenOut)
def verify_otp(body: VerifyOtp, db: Session = Depends(get_db)) -> TokenOut:
    otp = (db.query(OtpCode)
             .filter(OtpCode.phone == body.phone, OtpCode.code == body.code,
                     OtpCode.purpose.in_(("login", "password_setup")),
                     OtpCode.consumed.is_(False), OtpCode.expires_at > datetime.now(timezone.utc))
             .order_by(OtpCode.id.desc()).first())
    if not otp:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid or expired code")
    user = db.query(User).filter(User.phone == body.phone).first()
    if not user:
        if not body.full_name:
            raise HTTPException(status.HTTP_404_NOT_FOUND,
                                "No account on this number; provide full_name to register")
        settings = get_settings()
        if settings.is_production and not otp.email:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                                "A verified delivery email is required to register a customer")
        user = User(full_name=body.full_name, phone=body.phone, email=otp.email,
                    password_hash=hash_password(body.password))
        db.add(user)
        db.flush()
    else:
        # OTP delivery to the registered email is the password-setup/reset proof.
        user.password_hash = hash_password(body.password)
    otp.consumed = True
    db.commit()
    return TokenOut(access_token=make_jwt(str(user.id), user.role.value), role=user.role.value)


@router.post("/request-whatsapp-otp")
def request_whatsapp_otp(body: RequestWhatsAppOtp, db: Session = Depends(get_db)) -> dict:
    """Send a short-lived sign-in code to an existing account's registered number.

    The response is deliberately the same for registered and unregistered numbers.
    Evolution credentials stay on the backend; sandbox can expose a code only when
    no Evolution delivery has been configured.
    """
    settings = get_settings()
    evolution_ready = bool(
        settings.evolution_api_url and settings.evolution_api_key and settings.evolution_instance
    )
    if settings.is_production and not evolution_ready:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE,
                            "WhatsApp sign-in is not configured. Please use your password or contact support.")

    phone = body.phone
    now = datetime.now(timezone.utc)
    recent_cutoff = now - timedelta(minutes=15)
    recent_requests = (db.query(OtpCode)
                       .filter(OtpCode.phone == phone, OtpCode.purpose == "whatsapp_login",
                               OtpCode.created_at >= recent_cutoff)
                       .count())
    user = db.query(User).filter(User.phone == phone, User.is_active.is_(True)).first()
    if recent_requests >= 3:
        # Keep the same public response for matched and unmatched phone numbers.
        return {"sent": True, "message": "If an active account matches this number, a code has been sent."}

    code = f"{secrets.randbelow(900000) + 100000}"
    if user and evolution_ready:
        try:
            send_evolution_whatsapp_text(
                phone,
                f"*Protecta Bode* sign-in code: {code}. It expires in 10 minutes. Do not share it.",
            )
        except ServiceUnavailable:
            # Keep the public response identical for valid and unknown numbers even
            # if Evolution is unavailable. A consumed placeholder still throttles
            # retries without creating a verifiable code.
            db.add(OtpCode(
                phone=phone,
                code=code,
                purpose="whatsapp_login",
                consumed=True,
                expires_at=now + timedelta(minutes=10),
            ))
            db.commit()
            return {"sent": True, "message": "If an active account matches this number, a code has been sent."}

    # Store a consumed placeholder for unmatched numbers too, so the per-number
    # send throttle does not reveal whether an account exists.
    if user:
        db.query(OtpCode).filter(
            OtpCode.phone == phone,
            OtpCode.purpose == "whatsapp_login",
            OtpCode.consumed.is_(False),
        ).update({"consumed": True}, synchronize_session=False)
    db.add(OtpCode(
        phone=phone,
        code=code,
        purpose="whatsapp_login",
        consumed=not bool(user),
        expires_at=now + timedelta(minutes=10),
    ))
    db.commit()

    response = {"sent": True, "message": "If an active account matches this number, a code has been sent."}
    if user and not settings.is_production and not evolution_ready:
        response["debug_code"] = code
    return response


@router.post("/verify-whatsapp-otp", response_model=TokenOut)
def verify_whatsapp_otp(body: VerifyWhatsAppOtp, db: Session = Depends(get_db)) -> TokenOut:
    now = datetime.now(timezone.utc)
    otp = (db.query(OtpCode)
           .filter(OtpCode.phone == body.phone, OtpCode.purpose == "whatsapp_login",
                   OtpCode.consumed.is_(False), OtpCode.expires_at > now)
           .order_by(OtpCode.id.desc()).first())
    if not otp:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid or expired code")
    if otp.attempts >= 5:
        otp.consumed = True
        db.commit()
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid or expired code")
    if otp.code != body.code:
        otp.attempts += 1
        if otp.attempts >= 5:
            otp.consumed = True
        db.commit()
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid or expired code")

    user = db.query(User).filter(User.phone == body.phone, User.is_active.is_(True)).first()
    if not user:
        otp.consumed = True
        db.commit()
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid or expired code")
    otp.consumed = True
    db.commit()
    return TokenOut(access_token=make_jwt(str(user.id), user.role.value), role=user.role.value)


@router.post("/login-password", response_model=TokenOut)
def login_password(body: PasswordLogin, db: Session = Depends(get_db)) -> TokenOut:
    identifier = (body.username or body.phone or "").strip()
    if "@" in identifier:
        matches = db.query(User).filter(User.email == identifier.lower()).limit(2).all()
        user = matches[0] if len(matches) == 1 else None
    else:
        digits = re.sub(r"\D", "", identifier)
        if identifier.startswith("+") or digits.startswith("256"):
            phone = f"+{digits}"
        else:
            phone = f"+256{digits.lstrip('0')}"
        user = db.query(User).filter(User.phone == phone).first()
    if not user or not user.password_hash or not verify_password(body.password, user.password_hash):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Wrong username or password")
    return TokenOut(access_token=make_jwt(str(user.id), user.role.value), role=user.role.value)


@router.get("/me")
def me(user: User = Depends(get_current_user)) -> dict:
    return {
        "id": user.id, "full_name": user.full_name, "phone": user.phone,
        "email": user.email, "role": user.role.value, "kyc_status": user.kyc_status.value,
        "licence_no": user.licence_no,
    }
