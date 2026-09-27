"""Admin-managed partner credentials and webhook delivery controls."""
import ipaddress
import secrets
import socket
from typing import Literal
from urllib.parse import urlsplit

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import get_db
from app.deps import require_role
from app.models import Partner, User, UserRole, WebhookDelivery
from app.security import hash_password
from app.services.webhooks import deliver_webhook

router = APIRouter(prefix="/integrations", tags=["integrations"])


class PartnerCreate(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    environment: Literal["sandbox", "production"] = "sandbox"
    webhook_url: str | None = Field(default=None, max_length=300)


class WebhookTarget(BaseModel):
    url: str = Field(min_length=8, max_length=300)


def _validate_webhook_url(value: str, production_partner: bool = False) -> str:
    value = value.strip()
    parsed = urlsplit(value)
    settings = get_settings()
    if parsed.scheme not in ("https", "http") or not parsed.hostname or parsed.username or parsed.password:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            "Webhook URL must be an absolute HTTP(S) URL without embedded credentials")
    try:
        port = parsed.port
    except ValueError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Webhook URL has an invalid port") from exc
    require_public_host = settings.is_production or production_partner
    if require_public_host and parsed.scheme != "https":
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            "Production webhooks must use HTTPS")
    if require_public_host:
        host = parsed.hostname.rstrip(".").lower()
        if host == "localhost" or host.endswith((".localhost", ".local")):
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                                "Production webhook hosts must be publicly reachable")
        try:
            addresses = {ipaddress.ip_address(item[4][0])
                         for item in socket.getaddrinfo(host, port or 443, type=socket.SOCK_STREAM)}
        except OSError as exc:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                                "Webhook host must resolve before it can be saved") from exc
        if not addresses or any(not address.is_global for address in addresses):
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                                "Webhook host must resolve only to public IP addresses")
    return value


def _partner_out(partner: Partner) -> dict:
    return {
        "id": partner.id,
        "name": partner.name,
        "client_id": partner.client_id,
        "environment": partner.environment,
        "is_active": partner.is_active,
        "webhook_url": partner.webhook_url,
        "webhook_configured": bool(partner.webhook_url and partner.webhook_secret),
        "created_at": partner.created_at.isoformat() if partner.created_at else None,
    }


@router.get("/partners")
def list_partners(db: Session = Depends(get_db),
                  user: User = Depends(require_role(UserRole.admin))) -> list[dict]:
    rows = db.query(Partner).order_by(Partner.id.asc()).all()
    return [_partner_out(partner) for partner in rows]


@router.post("/partners", status_code=status.HTTP_201_CREATED)
def create_partner(body: PartnerCreate, db: Session = Depends(get_db),
                   user: User = Depends(require_role(UserRole.admin))) -> dict:
    client_id = f"pb_{secrets.token_hex(12)}"
    client_secret = secrets.token_urlsafe(32)
    webhook_url = (_validate_webhook_url(body.webhook_url, production_partner=body.environment == "production")
                   if body.webhook_url else None)
    webhook_secret = secrets.token_hex(32) if webhook_url else None
    partner = Partner(
        name=body.name.strip(),
        client_id=client_id,
        client_secret_hash=hash_password(client_secret),
        scopes=["customers:w", "quotes:w", "policies:r", "payments:w", "claims:w"],
        environment=body.environment,
        webhook_url=webhook_url,
        webhook_secret=webhook_secret,
    )
    db.add(partner)
    db.commit()
    db.refresh(partner)
    return {
        **_partner_out(partner),
        "client_secret": client_secret,
        "webhook_secret": webhook_secret,
        "credentials_notice": "Save these credentials now. The client secret and webhook secret are shown only once.",
    }


@router.post("/partners/{client_id}/webhook")
def set_partner_webhook(client_id: str, body: WebhookTarget, db: Session = Depends(get_db),
                        user: User = Depends(require_role(UserRole.admin))) -> dict:
    partner = db.query(Partner).filter(Partner.client_id == client_id).first()
    if not partner:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Partner not found")
    partner.webhook_url = _validate_webhook_url(
        body.url, production_partner=partner.environment == "production",
    )
    partner.webhook_secret = secrets.token_hex(32)
    db.commit()
    return {
        **_partner_out(partner),
        "webhook_secret": partner.webhook_secret,
        "credentials_notice": "Save this signing secret now. It is shown only once; setting the URL rotates the previous secret.",
    }


@router.delete("/partners/{client_id}/webhook")
def disable_partner_webhook(client_id: str, db: Session = Depends(get_db),
                            user: User = Depends(require_role(UserRole.admin))) -> dict:
    partner = db.query(Partner).filter(Partner.client_id == client_id).first()
    if not partner:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Partner not found")
    partner.webhook_url = None
    partner.webhook_secret = None
    db.commit()
    return {"client_id": client_id, "webhook_configured": False}


@router.get("/webhooks/deliveries")
def list_deliveries(limit: int = Query(default=100, ge=1, le=250),
                    state: str | None = Query(default=None, alias="status"),
                    db: Session = Depends(get_db),
                    user: User = Depends(require_role(UserRole.admin))) -> list[dict]:
    query = db.query(WebhookDelivery)
    if state:
        query = query.filter(WebhookDelivery.status == state)
    rows = query.order_by(WebhookDelivery.id.desc()).limit(limit).all()
    return [{
        "id": row.id,
        "delivery_id": row.delivery_id,
        "partner_id": row.partner_id,
        "event": row.event,
        "target_host": urlsplit(row.target_url).hostname or "",
        "status": row.status,
        "attempts": row.attempts,
        "response_status": row.response_status,
        "last_error": row.last_error,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "delivered_at": row.delivered_at.isoformat() if row.delivered_at else None,
    } for row in rows]


@router.post("/webhooks/deliveries/{delivery_row_id}/retry", status_code=status.HTTP_202_ACCEPTED)
def retry_delivery(delivery_row_id: int, background_tasks: BackgroundTasks,
                   db: Session = Depends(get_db),
                   user: User = Depends(require_role(UserRole.admin))) -> dict:
    row = db.get(WebhookDelivery, delivery_row_id)
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Webhook delivery not found")
    if row.status != "failed":
        raise HTTPException(status.HTTP_409_CONFLICT, "Only failed webhook deliveries can be retried")
    row.status = "pending"
    row.last_error = None
    db.commit()
    background_tasks.add_task(deliver_webhook, row.id)
    return {"delivery_id": row.delivery_id, "status": "pending"}
