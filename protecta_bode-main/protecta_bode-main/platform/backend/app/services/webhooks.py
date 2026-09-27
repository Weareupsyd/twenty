"""Signed, durable outbound webhooks for external API partners."""
from __future__ import annotations

import json
import logging
import secrets
import time
from datetime import datetime, timezone

import httpx
from fastapi import BackgroundTasks
from sqlalchemy.orm import Session

from app.db import SessionLocal
from app.models import Partner, WebhookDelivery
from app.security import hmac_signature

logger = logging.getLogger(__name__)
MAX_ATTEMPTS = 3


def enqueue_partner_event(db: Session, partner_id: int | None, event: str, data: dict,
                          background_tasks: BackgroundTasks | None = None) -> str | None:
    """Persist an event before scheduling delivery; a partner outage won't undo cover."""
    if not partner_id:
        return None
    partner = db.get(Partner, partner_id)
    if not partner or not partner.is_active or not partner.webhook_url or not partner.webhook_secret:
        return None

    delivery_id = f"evt_{secrets.token_hex(16)}"
    payload = {
        "id": delivery_id,
        "event": event,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "data": data,
    }
    raw = json.dumps(payload, separators=(",", ":"), ensure_ascii=True).encode("utf-8")
    delivery = WebhookDelivery(
        delivery_id=delivery_id,
        partner_id=partner.id,
        event=event,
        target_url=partner.webhook_url,
        payload=raw.decode("utf-8"),
        signature=hmac_signature(partner.webhook_secret, raw),
        status="pending",
    )
    try:
        db.add(delivery)
        db.commit()
        db.refresh(delivery)
    except Exception:
        db.rollback()
        logger.exception("Unable to enqueue partner webhook event=%s partner_id=%s", event, partner_id)
        return None
    if background_tasks is not None:
        background_tasks.add_task(deliver_webhook, delivery.id)
    return delivery.delivery_id


def deliver_webhook(delivery_row_id: int) -> None:
    """Deliver with bounded retries; retain final status for the admin to inspect/retry."""
    for attempt in range(1, MAX_ATTEMPTS + 1):
        with SessionLocal() as db:
            delivery = db.get(WebhookDelivery, delivery_row_id)
            if not delivery or delivery.status == "delivered":
                return
            delivery.attempts += 1
            delivery.status = "sending"
            target_url = delivery.target_url
            event = delivery.event
            delivery_id = delivery.delivery_id
            payload = delivery.payload.encode("utf-8")
            signature = delivery.signature
            db.commit()

        response_status: int | None = None
        error = ""
        try:
            response = httpx.post(
                target_url,
                content=payload,
                headers={
                    "Content-Type": "application/json",
                    "User-Agent": "ProtectaBode-Webhooks/1.0",
                    "X-PB-Event": event,
                    "X-PB-Delivery": delivery_id,
                    "X-PB-Signature": f"sha256={signature}",
                },
                timeout=5.0,
                follow_redirects=False,
            )
            response_status = response.status_code
            if not 200 <= response.status_code < 300:
                error = f"Receiver returned HTTP {response.status_code}"
        except Exception as exc:  # noqa: BLE001 - log and retry integration failures
            error = f"{type(exc).__name__}: {exc}"[:2000]

        with SessionLocal() as db:
            delivery = db.get(WebhookDelivery, delivery_row_id)
            if not delivery:
                return
            delivery.response_status = response_status
            delivery.last_error = error or None
            if not error:
                delivery.status = "delivered"
                delivery.delivered_at = datetime.now(timezone.utc)
                db.commit()
                logger.info("Partner webhook delivered id=%s event=%s", delivery_id, event)
                return
            delivery.status = "failed" if attempt == MAX_ATTEMPTS else "pending"
            db.commit()

        logger.warning("Partner webhook failed id=%s attempt=%s/%s error=%s",
                       delivery_id, attempt, MAX_ATTEMPTS, error)
        if attempt < MAX_ATTEMPTS:
            time.sleep(attempt)
