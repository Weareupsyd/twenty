"""Customer support requests and staff helpdesk queue."""
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import get_current_user, require_role, staff_roles
from app.models import SupportTicket, User
from app.security import new_reference

router = APIRouter(prefix="/support", tags=["support"])


class TicketCreate(BaseModel):
    subject: str = Field(min_length=4, max_length=160)
    description: str = Field(min_length=10, max_length=4000)

    @field_validator("subject", "description", mode="before")
    @classmethod
    def trim_text(cls, value: str) -> str:
        return value.strip() if isinstance(value, str) else value


class TicketStatusUpdate(BaseModel):
    status: Literal["open", "pending", "resolved"]


def _ticket_out(ticket: SupportTicket, db: Session) -> dict:
    user = db.get(User, ticket.user_id) if ticket.user_id else None
    return {
        "reference": ticket.reference,
        "subject": ticket.subject,
        "description": ticket.description,
        "channel": ticket.channel,
        "status": ticket.status,
        "priority": ticket.priority,
        "customer_name": user.full_name if user else "Guest",
        "customer_phone": user.phone if user else "",
        "created_at": ticket.created_at.isoformat() if ticket.created_at else None,
    }


@router.post("/tickets", status_code=status.HTTP_201_CREATED)
def create_ticket(body: TicketCreate, db: Session = Depends(get_db),
                  user: User = Depends(get_current_user)) -> dict:
    ticket = SupportTicket(
        reference=new_reference("TK"),
        user_id=user.id,
        subject=body.subject,
        description=body.description,
        channel="portal",
    )
    db.add(ticket)
    db.commit()
    db.refresh(ticket)
    return _ticket_out(ticket, db)


@router.get("/tickets/mine")
def my_tickets(db: Session = Depends(get_db),
               user: User = Depends(get_current_user)) -> list[dict]:
    rows = (db.query(SupportTicket)
              .filter(SupportTicket.user_id == user.id)
              .order_by(SupportTicket.id.desc()).limit(100).all())
    return [_ticket_out(ticket, db) for ticket in rows]


@router.get("/tickets")
def list_tickets(status_filter: Literal["open", "pending", "resolved"] | None = Query(default=None, alias="status"),
                 db: Session = Depends(get_db),
                 user: User = Depends(require_role(*staff_roles))) -> list[dict]:
    query = db.query(SupportTicket)
    if status_filter:
        query = query.filter(SupportTicket.status == status_filter)
    rows = query.order_by(SupportTicket.id.desc()).limit(250).all()
    return [_ticket_out(ticket, db) for ticket in rows]


@router.post("/tickets/{reference}/status")
def update_ticket_status(reference: str, body: TicketStatusUpdate,
                         db: Session = Depends(get_db),
                         user: User = Depends(require_role(*staff_roles))) -> dict:
    ticket = db.query(SupportTicket).filter(SupportTicket.reference == reference).first()
    if not ticket:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Support ticket not found")
    ticket.status = body.status
    db.commit()
    db.refresh(ticket)
    return _ticket_out(ticket, db)
