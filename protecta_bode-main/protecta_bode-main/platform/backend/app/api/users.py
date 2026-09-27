"""Staff provisioning for agency and broker accounts."""
import re
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import require_role
from app.models import User, UserRole
from app.security import hash_password

router = APIRouter(prefix="/users", tags=["user-onboarding"])


class UserOnboardIn(BaseModel):
    full_name: str = Field(min_length=2, max_length=120)
    phone: str = Field(min_length=8, max_length=20)
    email: str = Field(min_length=6, max_length=160)
    password: str = Field(min_length=12, max_length=128)
    role: Literal["agent", "broker"]
    licence_no: str = Field(min_length=3, max_length=40)
    parent_broker_id: int | None = None

    @field_validator("full_name", "licence_no", mode="before")
    @classmethod
    def trim_fields(cls, value):
        return value.strip() if isinstance(value, str) else value

    @field_validator("email", mode="before")
    @classmethod
    def normalize_email(cls, value):
        if not isinstance(value, str) or not value.strip():
            return None
        value = value.strip().lower()
        if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", value):
            raise ValueError("Enter a valid email address")
        return value

    @field_validator("phone", mode="before")
    @classmethod
    def normalize_phone(cls, value):
        if not isinstance(value, str):
            return value
        digits = re.sub(r"\D", "", value)
        if value.strip().startswith("+") or digits.startswith("256"):
            return f"+{digits}"
        return f"+256{digits.lstrip('0')}"


def _user_out(user: User) -> dict:
    return {
        "id": user.id,
        "full_name": user.full_name,
        "phone": user.phone,
        "email": user.email,
        "role": user.role.value,
        "licence_no": user.licence_no,
        "parent_broker_id": user.parent_broker_id,
        "is_active": user.is_active,
        "kyc_status": user.kyc_status.value,
        "created_at": user.created_at.isoformat() if user.created_at else None,
    }


@router.get("/distribution")
def distribution_users(db: Session = Depends(get_db),
                       admin: User = Depends(require_role(UserRole.admin))) -> dict:
    brokers = db.query(User).filter(User.role == UserRole.broker).order_by(User.full_name).all()
    agents = db.query(User).filter(User.role == UserRole.agent).order_by(User.full_name).all()
    return {
        "brokers": [{**_user_out(broker), "agents": [
            _user_out(agent) for agent in agents if agent.parent_broker_id == broker.id
        ]} for broker in brokers],
        "independent_agents": [_user_out(agent) for agent in agents if not agent.parent_broker_id],
    }


@router.post("/onboard", status_code=status.HTTP_201_CREATED)
def onboard_user(body: UserOnboardIn, db: Session = Depends(get_db),
                 admin: User = Depends(require_role(UserRole.admin))) -> dict:
    if not re.fullmatch(r"\+[1-9]\d{7,14}", body.phone):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            "Phone must be a valid international number, for example +256772123456")
    if db.query(User).filter(User.phone == body.phone).first():
        raise HTTPException(status.HTTP_409_CONFLICT, "An account already exists for this phone number")
    if db.query(User).filter(User.licence_no == body.licence_no).first():
        raise HTTPException(status.HTTP_409_CONFLICT, "This licence number is already registered")

    parent_id = None
    if body.role == "agent" and body.parent_broker_id is not None:
        broker = db.get(User, body.parent_broker_id)
        if not broker or broker.role != UserRole.broker or not broker.is_active:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                                "Select an active broker account for this agent")
        parent_id = broker.id
    elif body.role == "broker" and body.parent_broker_id is not None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            "A broker account cannot be assigned to a parent broker")

    user = User(
        full_name=body.full_name,
        phone=body.phone,
        email=str(body.email) if body.email else None,
        role=UserRole(body.role),
        licence_no=body.licence_no,
        parent_broker_id=parent_id,
        password_hash=hash_password(body.password),
        is_active=True,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return {
        **_user_out(user),
        "sign_in": "Use this phone number or email as your username and the password provided by the administrator.",
    }
