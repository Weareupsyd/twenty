"""Outbound service clients: KYC stack, email service and Evolution WhatsApp."""
from datetime import datetime, timezone
import re
from urllib.parse import quote

import httpx

from app.config import get_settings


class ServiceUnavailable(RuntimeError):
    pass


def send_evolution_whatsapp_text(phone: str, text: str) -> None:
    """Send a WhatsApp text through a configured Evolution API instance.

    The Evolution API key is sent only in a backend-to-backend request. Numbers
    are sent as international digits without a leading plus, as expected by the
    `/message/sendText/{instance}` endpoint.
    """
    settings = get_settings()
    if not (settings.evolution_api_url and settings.evolution_api_key and settings.evolution_instance):
        raise ServiceUnavailable("WhatsApp sign-in is not configured")

    number = re.sub(r"\D", "", phone)
    instance = quote(settings.evolution_instance, safe="")
    endpoint = f"{settings.evolution_api_url.rstrip('/')}/message/sendText/{instance}"
    try:
        response = httpx.post(
            endpoint,
            headers={"apikey": settings.evolution_api_key},
            json={"number": number, "text": text},
            timeout=15,
        )
        response.raise_for_status()
    except httpx.HTTPError as exc:
        raise ServiceUnavailable("WhatsApp delivery failed") from exc

    # Evolution may return a 2xx response with a structured error payload.
    try:
        payload = response.json()
    except ValueError:
        payload = None
    if isinstance(payload, dict) and payload.get("error"):
        raise ServiceUnavailable("WhatsApp delivery failed")


def kyc_open_session(user_id: int) -> dict:
    """Create a hosted KYC verification and return its session ID and public URL.

    The Kabila API uses POST /api/v2/verify/initialize and returns
    verification_id/verification_url; the platform never receives ID images.
    """
    s = get_settings()
    if not s.kyc_api_key:
        raise ServiceUnavailable("KYC service not configured (missing KYC_API_KEY)")
    day_key = datetime.now(timezone.utc).strftime("%Y%m%d")
    external_user_id = f"protecta-bode-user-{user_id}"
    try:
        r = httpx.post(
            f"{s.kyc_service_url.rstrip('/')}/api/v2/verify/initialize",
            headers={
                "X-API-Key": s.kyc_api_key,
                "Idempotency-Key": f"pb-kyc-{user_id}-{day_key}",
            },
            json={
                "user_id": external_user_id,
                "document_type": "auto",
                "issuing_country": "UG",
                "verification_mode": "full",
                "source": "api",
                "external_system": "protecta_bode",
                "external_reference": str(user_id),
                "subject_type": "individual",
            },
            timeout=15,
        )
        r.raise_for_status()
        payload = r.json()
        verification_id = payload.get("verification_id")
        verification_url = payload.get("verification_url")
        if not verification_id or not verification_url:
            raise ServiceUnavailable("KYC service returned no verification link")
        return {"id": verification_id, "url": verification_url, "status": payload.get("status")}
    except httpx.HTTPError as exc:
        raise ServiceUnavailable(f"KYC service error: {exc}") from exc


def kyc_result(session_id: str) -> dict:
    s = get_settings()
    if not s.kyc_api_key:
        raise ServiceUnavailable("KYC service not configured (missing KYC_API_KEY)")
    try:
        r = httpx.get(
            f"{s.kyc_service_url.rstrip('/')}/api/v2/verify/{session_id}/status",
            headers={"X-API-Key": s.kyc_api_key},
            timeout=15,
        )
        r.raise_for_status()
        return r.json()
    except httpx.HTTPError as exc:
        raise ServiceUnavailable(f"KYC service error: {exc}") from exc


def send_email(template: str, to: str, ctx: dict, subject: str | None = None,
               attachments: list[dict] | None = None) -> dict:
    """Fire a branded transactional email through the email microservice."""
    s = get_settings()
    payload = {"template": template, "to": to, "context": ctx}
    if subject:
        payload["subject"] = subject
    if attachments:
        payload["attachments"] = attachments
    try:
        r = httpx.post(f"{s.email_service_url}/send", json=payload, timeout=15)
        r.raise_for_status()
        return r.json()
    except httpx.HTTPError as exc:
        raise ServiceUnavailable(f"Email service error: {exc}") from exc
