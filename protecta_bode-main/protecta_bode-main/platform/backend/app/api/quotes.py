"""Quote endpoints (web + authenticated). The Partner API and bot reuse
services.insurance.create_quote so attribution and pricing stay identical."""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import get_db
from app.deps import get_optional_user
from app.models import Quote, QuoteChannel, User
from app.schemas import QuoteIn, QuoteOut
from app.services import insurance

router = APIRouter(prefix="/quotes", tags=["quotes"])


def _out(q: Quote, base_url: str) -> QuoteOut:
    return QuoteOut(
        reference=q.reference, vehicle=q.vehicle_json, rate=q.rate, value=q.value,
        premium=q.premium, extras=q.extras, status=q.status.value,
        share_url=f"{base_url}/quote/{q.reference}", valid_until=q.expires_at,
        customer_attached=q.customer_id is not None,
    )


@router.post("", response_model=QuoteOut, status_code=201)
def create_quote(body: QuoteIn, db: Session = Depends(get_db),
                 user: User | None = Depends(get_optional_user)) -> QuoteOut:
    """Public/portal quote: customer sessions link the policyholder, while
    agent/broker sessions attribute the quote to the producing intermediary."""
    try:
        q = insurance.create_quote(
            db, vehicle=body.vehicle.model_dump(), channel=QuoteChannel.web,
            created_by=user.id if (user and user.role.value in ("agent", "broker")) else None,
            customer=user if (user and user.role.value == "customer") else None,
        )
    except insurance.BusinessRule as br:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, {"code": br.code, "detail": br.detail})
    return _out(q, get_settings().public_base_url)


@router.get("/{reference}", response_model=QuoteOut)
def get_quote(reference: str, db: Session = Depends(get_db)) -> QuoteOut:
    q = db.query(Quote).filter(Quote.reference == reference).first()
    if not q:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Quote not found")
    return _out(q, get_settings().public_base_url)
