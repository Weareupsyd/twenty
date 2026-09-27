"""Internal endpoints for trusted services (bot). Guarded by X-Internal-Key."""
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import require_internal_key
from app.models import Quote, QuoteChannel, SupportTicket, User
from app.schemas import QuoteIn, QuoteOut
from app.security import new_reference
from app.services import insurance

router = APIRouter(prefix="/internal", tags=["internal"])


@router.post("/quotes", response_model=QuoteOut)
def create_quote_internal(body: QuoteIn, db: Session = Depends(get_db),
                          _: None = Depends(require_internal_key)) -> QuoteOut:
    """Bot quote creation. Customer resolution by phone happens here so the
    quote is linked to a real account when the number is known."""
    from app.config import get_settings
    customer = None
    if body.customer_phone:
        customer = db.query(User).filter(User.phone == body.customer_phone).first()
    try:
        q = insurance.create_quote(db, vehicle=body.vehicle.model_dump(),
                                   channel=QuoteChannel.whatsapp, created_by=None,
                                   customer=customer)
    except insurance.BusinessRule as br:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, {"code": br.code, "detail": br.detail})
    return QuoteOut(
        reference=q.reference, vehicle=q.vehicle_json, rate=q.rate, value=q.value,
        premium=q.premium, extras=q.extras, status=q.status.value,
        share_url=f"{get_settings().public_base_url}/quote/{q.reference}", valid_until=q.expires_at,
    )


class TicketIn(BaseModel):
    phone: str
    subject: str
    channel: str = "whatsapp"


@router.post("/support/tickets", status_code=201)
def create_ticket(body: TicketIn, db: Session = Depends(get_db),
                  _: None = Depends(require_internal_key)) -> dict:
    user = db.query(User).filter(User.phone == body.phone).first()
    ticket = SupportTicket(reference=new_reference("TK"), user_id=user.id if user else None,
                           subject=body.subject, channel=body.channel)
    db.add(ticket)
    db.commit()
    return {"ticket_ref": ticket.reference, "status": ticket.status}
