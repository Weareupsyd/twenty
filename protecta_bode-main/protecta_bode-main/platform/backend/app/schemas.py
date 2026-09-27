"""Pydantic request/response schemas."""
from datetime import date, datetime

from pydantic import BaseModel, Field, field_validator

PLATE_RE = r"^[UA][A-Z]{2}\s?\d{1,3}[A-Z]$|^[A-Z]{3}\s?\d{1,3}[A-Z]$"


class VehicleIn(BaseModel):
    plate: str = Field(min_length=5, max_length=12, examples=["UAA 123A"])
    make: str
    model: str
    year: int = Field(ge=1980, le=2027)
    value: int   # range enforced by the business rule (config-driven), not the schema

    @field_validator("plate")
    @classmethod
    def normalise_plate(cls, v: str) -> str:
        return v.upper().replace("", "").strip()


class QuoteIn(BaseModel):
    vehicle: VehicleIn
    customer_phone: str | None = None    # E.164 when the quote pre-registers a customer


class QuoteOut(BaseModel):
    reference: str
    vehicle: dict
    rate: float
    value: int
    premium: int
    extras: list
    status: str
    share_url: str
    valid_until: datetime | None
    customer_attached: bool = False


class PaymentIn(BaseModel):
    quote_reference: str
    method: str = Field(pattern="^(mtn_momo|airtel_money|bank)$")
    payer_phone: str | None = None


class ClaimIn(BaseModel):
    policy_no: str
    incident_date: date
    description: str = Field(min_length=20)
    location: str | None = None
    photos: list[str] = []


class StatusUpdate(BaseModel):
    status: str
    note: str | None = None


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    role: str
