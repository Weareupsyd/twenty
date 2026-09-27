"""Payments: initiate (MoMo / Airtel / bank) + provider webhook + manual confirm."""
import base64
import hmac
import json

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import get_db
from app.deps import get_optional_user, require_role, staff_roles
from app.models import Payment, PaymentProvider, PaymentStatus, Quote, User, UserRole
from app.schemas import PaymentIn
from app.security import hmac_signature
from app.services import insurance
from app.services.clients import send_email
from app.services.webhooks import enqueue_partner_event

router = APIRouter(prefix="/payments", tags=["payments"])


@router.get("")
def list_payments(status: str | None = None, db: Session = Depends(get_db),
                  user: User = Depends(require_role(*staff_roles))) -> list[dict]:
    """Staff queue: payments to reconcile (pending/failed) or history."""
    q = db.query(Payment)
    if status:
        q = q.filter(Payment.status == PaymentStatus(status).value)
    q = q.order_by(Payment.id.desc()).limit(200)
    return [{"payment_ref": p.reference, "quote_ref": db.get(Quote, p.quote_id).reference,
             "provider": p.provider.value, "amount": p.amount, "status": p.status.value,
             "failure_reason": p.failure_reason, "policy_id": p.policy_id} for p in q.all()]


@router.get("/mine")
def my_payments(db: Session = Depends(get_db),
                user: User = Depends(require_role(UserRole.customer))) -> list[dict]:
    """Customer payment history, scoped to quotes attached to the signed-in user."""
    rows = (db.query(Payment)
              .join(Quote, Payment.quote_id == Quote.id)
              .filter(Quote.customer_id == user.id)
              .order_by(Payment.id.desc()).limit(100).all())
    return [{
        "payment_ref": payment.reference,
        "quote_ref": db.get(Quote, payment.quote_id).reference,
        "provider": payment.provider.value,
        "amount": payment.amount,
        "status": payment.status.value,
        "failure_reason": payment.failure_reason,
        "created_at": payment.created_at.isoformat() if payment.created_at else None,
    } for payment in rows]


@router.post("")
def initiate(body: PaymentIn, background_tasks: BackgroundTasks,
             db: Session = Depends(get_db),
             user: User | None = Depends(get_optional_user)) -> dict:
    quote = db.query(Quote).filter(Quote.reference == body.quote_reference).first()
    if not quote:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Quote not found")
    if user:
        if user.role != UserRole.customer:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "A customer account is required to pay")
        if quote.customer_id is not None and quote.customer_id != user.id:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Quote belongs to a different customer")
        if quote.customer_id is None:
            quote.customer_id = user.id
    elif quote.customer_id is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED,
                            "Sign in or create a customer account before paying this quote")
    try:
        p = insurance.initiate_payment(db, quote, provider=body.method, payer_phone=body.payer_phone)
    except insurance.BusinessRule as br:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, {"code": br.code, "detail": br.detail})
    enqueue_partner_event(db, quote.partner_id, "payment.initiated", {
        "payment_ref": p.reference, "quote_id": quote.reference,
        "status": p.status.value, "amount_ugx": p.amount,
    }, background_tasks)
    return {
        "payment_ref": p.reference, "status": p.status.value, "amount": p.amount,
        "provider": p.provider.value,
        "message": ("Payment request recorded. Follow the instructions from your mobile-money provider; the policy will be issued after payment is confirmed."
                    if p.provider.value in ("mtn_momo", "airtel_money")
                    else f"Transfer to Stanbic Bank Uganda using reference {p.reference}. The policy will be issued after payment is confirmed."),
    }


@router.post("/webhook/{provider}")
async def provider_webhook(provider: str, request: Request, background_tasks: BackgroundTasks,
                           db: Session = Depends(get_db)) -> dict:
    """Verified payment-provider callback; signs the exact raw JSON request body."""
    settings = get_settings()
    raw = await request.body()
    if settings.payment_webhook_secret:
        provided = request.headers.get("X-PB-Signature", "")
        if provided.startswith("sha256="):
            provided = provided[7:]
        expected = hmac_signature(settings.payment_webhook_secret, raw)
        if not provided or not hmac.compare_digest(provided, expected):
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid payment webhook signature")
    elif settings.is_production:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE,
                            "PAYMENT_WEBHOOK_SECRET is not configured")

    try:
        body = json.loads(raw)
    except (json.JSONDecodeError, UnicodeDecodeError):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Webhook body must be valid JSON")
    if not isinstance(body, dict):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Webhook body must be a JSON object")
    try:
        callback_provider = PaymentProvider(provider)
    except ValueError:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Unknown payment provider")
    if callback_provider == PaymentProvider.cash_agent:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Unknown payment provider")

    reference = str(body.get("payment_ref") or "")
    payment = db.query(Payment).filter(Payment.reference == reference).first()
    if not payment:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Unknown payment reference")
    if payment.provider != callback_provider:
        raise HTTPException(status.HTTP_409_CONFLICT, "Webhook provider does not match this payment")
    if body.get("amount") is not None:
        amount = body["amount"]
        if isinstance(amount, bool) or not isinstance(amount, (int, str)) \
                or (isinstance(amount, str) and not amount.isdigit()):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Webhook amount must be an integer")
        if int(amount) != payment.amount:
            raise HTTPException(status.HTTP_409_CONFLICT, "Webhook amount does not match this payment")

    outcome = str(body.get("outcome", "")).lower()
    if outcome not in ("success", "failed"):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "outcome must be success or failed")
    quote = db.get(Quote, payment.quote_id)
    if outcome == "success":
        provider_ref = body.get("provider_ref") or reference
        if not isinstance(provider_ref, str) or len(provider_ref) > 64:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                                "provider_ref must be a string of at most 64 characters")
        already_confirmed = payment.status == PaymentStatus.confirmed
        try:
            policy = insurance.confirm_payment(
                db, payment, provider_ref=provider_ref)
        except insurance.BusinessRule as br:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                                {"code": br.code, "detail": br.detail})
        if not already_confirmed:
            _notify_issued(db, payment, policy)
            enqueue_partner_event(db, quote.partner_id if quote else None, "payment.confirmed", {
                "payment_ref": payment.reference, "quote_id": quote.reference if quote else "",
                "policy_no": policy.policy_no, "amount_ugx": payment.amount,
            }, background_tasks)
            enqueue_partner_event(db, quote.partner_id if quote else None, "policy.issued", {
                "policy_no": policy.policy_no, "quote_id": quote.reference if quote else "",
                "status": policy.status.value, "premium_ugx": policy.premium,
                "period_start": str(policy.period_start), "period_end": str(policy.period_end),
            }, background_tasks)
        return {"status": "confirmed", "policy_no": policy.policy_no}

    if payment.status == PaymentStatus.confirmed:
        raise HTTPException(status.HTTP_409_CONFLICT, "A confirmed payment cannot be marked failed")
    newly_failed = payment.status != PaymentStatus.failed
    payment.status = PaymentStatus.failed
    payment.failure_reason = str(body.get("failure_reason") or "unknown")[:160]
    db.commit()
    if newly_failed:
        enqueue_partner_event(db, quote.partner_id if quote else None, "payment.failed", {
            "payment_ref": payment.reference, "quote_id": quote.reference if quote else "",
            "amount_ugx": payment.amount, "failure_reason": payment.failure_reason,
        }, background_tasks)
    return {"status": "failed"}


@router.post("/{reference}/confirm-manual")
def confirm_manual(reference: str, background_tasks: BackgroundTasks,
                   db: Session = Depends(get_db),
                   user: User = Depends(require_role(*staff_roles))) -> dict:
    """Admin confirms a bank transfer after reconciliation."""
    payment = db.query(Payment).filter(Payment.reference == reference).first()
    if not payment:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Payment not found")
    already_confirmed = payment.status == PaymentStatus.confirmed
    try:
        policy = insurance.confirm_payment(db, payment, provider_ref=reference, actor=f"admin:{user.id}")
    except insurance.BusinessRule as br:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            {"code": br.code, "detail": br.detail})
    if not already_confirmed:
        _notify_issued(db, payment, policy)
        quote = db.get(Quote, payment.quote_id)
        enqueue_partner_event(db, quote.partner_id if quote else None, "payment.confirmed", {
            "payment_ref": payment.reference, "quote_id": quote.reference if quote else "",
            "policy_no": policy.policy_no, "amount_ugx": payment.amount,
        }, background_tasks)
        enqueue_partner_event(db, quote.partner_id if quote else None, "policy.issued", {
            "policy_no": policy.policy_no, "quote_id": quote.reference if quote else "",
            "status": policy.status.value, "premium_ugx": policy.premium,
            "period_start": str(policy.period_start), "period_end": str(policy.period_end),
        }, background_tasks)
    return {"status": "confirmed", "policy_no": policy.policy_no}


def _notify_issued(db: Session, payment: Payment, policy) -> None:
    """Policy-issued email with the protected PDF attached; outages must never block issuance."""
    quote = db.get(Quote, payment.quote_id)
    holder = db.get(User, quote.customer_id) if quote.customer_id else None
    if holder and holder.email:
        attachments = None
        try:
            from app.api.policies import render_policy_pdf
            pdf = render_policy_pdf(db, policy)
            attachments = [{"filename": f"{policy.policy_no}.pdf",
                            "content_base64": base64.b64encode(pdf).decode("ascii")}]
        except Exception:
            attachments = None   # email still goes out, portal download remains
        try:
            send_email("policy-issued", holder.email, {
                "first_name": holder.full_name.split(" ")[0],
                "policy_no": policy.policy_no,
                "vehicle": quote.vehicle_json.get("make", ""),
                "plate": quote.vehicle_json.get("plate", ""),
                "period_start": str(policy.period_start),
                "period_end": str(policy.period_end),
                "premium_ugx": f"UGX {policy.premium:,}",
                "portal_url": get_settings().public_base_url,
            }, attachments=attachments)
        except Exception:
            pass
