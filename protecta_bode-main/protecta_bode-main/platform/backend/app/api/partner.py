"""Partner & Broker API (docs/PARTNER_API.md).

Client-credentials auth, scoped to the calling partner's own book.
Idempotency-Key is required and replay-safe on quote bind."""
import hashlib
import json
from datetime import datetime

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import get_db
from app.models import (KycStatus, Partner, PartnerCustomer as PartnerCustomerLink,
                        PartnerIdempotencyRecord, Payment, PaymentProvider, Policy,
                        Quote, QuoteChannel, User)
from app.services.webhooks import enqueue_partner_event
from app.schemas import ClaimIn, VehicleIn
from app.security import hash_password, make_jwt, new_reference, verify_password
from app.services import insurance

router = APIRouter(prefix="/partner", tags=["partner-api"])

# ── auth ─────────────────────────────────────────────────────────────────────
class ClientCredentials(BaseModel):
    client_id: str
    client_secret: str


def current_partner(request: Request, db: Session = Depends(get_db)) -> Partner:
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Missing bearer token")
    from app.security import decode_jwt
    try:
        payload = decode_jwt(auth.removeprefix("Bearer ").strip())
    except Exception:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid token")
    if payload.get("typ") != "partner":
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not a partner token")
    partner = db.query(Partner).filter(Partner.client_id == payload["cid"]).first()
    if not partner or not partner.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Partner inactive")
    return partner


@router.post("/auth/token")
def token(body: ClientCredentials, db: Session = Depends(get_db)) -> dict:
    partner = db.query(Partner).filter(Partner.client_id == body.client_id).first()
    if not partner or not verify_password(body.client_secret, partner.client_secret_hash):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Unknown client_id or bad secret")
    if not partner.is_active:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Partner suspended")
    return {"access_token": make_jwt(partner.client_id, "partner", minutes=15, extra={"typ": "partner", "cid": partner.client_id}),
            "token_type": "bearer", "expires_in": 900}


# ── customers ────────────────────────────────────────────────────────────────
class PartnerCustomer(BaseModel):
    full_name: str
    phone: str
    email: str | None = None
    nin_or_passport: str | None = None


@router.post("/customers", status_code=201)
def create_customer(body: PartnerCustomer, db: Session = Depends(get_db),
                    partner: Partner = Depends(current_partner)) -> dict:
    if db.query(User).filter(User.phone == body.phone).first():
        raise HTTPException(status.HTTP_409_CONFLICT, {"code": "DUPLICATE_PHONE",
                                                       "detail": "A user with this phone already exists"})
    user = User(full_name=body.full_name, phone=body.phone, email=body.email, nin=body.nin_or_passport)
    db.add(user)
    db.flush()
    db.add(PartnerCustomerLink(partner_id=partner.id, customer_id=user.id))
    db.commit()
    return {"customer_id": user.id, "kyc_status": user.kyc_status.value}


@router.get("/customers/{customer_id}")
def get_customer(customer_id: int, db: Session = Depends(get_db),
                 partner: Partner = Depends(current_partner)) -> dict:
    linked = db.query(PartnerCustomerLink.id).filter(
        PartnerCustomerLink.partner_id == partner.id,
        PartnerCustomerLink.customer_id == customer_id,
    ).first()
    if not linked:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Customer not found")
    user = db.get(User, customer_id)
    if not user:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Customer not found")
    policies = (db.query(Policy).join(Quote, Policy.quote_id == Quote.id)
                  .filter(Quote.customer_id == user.id).all())
    return {"customer_id": user.id, "full_name": user.full_name, "kyc_status": user.kyc_status.value,
            "policies": [{"policy_no": p.policy_no, "status": p.status.value} for p in policies]}


# ── quotes / bind ────────────────────────────────────────────────────────────
class PartnerQuote(BaseModel):
    customer_id: int
    vehicle: VehicleIn
    product_code: str = "BODE-01"


@router.post("/quotes", status_code=201)
def create_quote(body: PartnerQuote, background_tasks: BackgroundTasks,
                 db: Session = Depends(get_db),
                 partner: Partner = Depends(current_partner)) -> dict:
    linked = db.query(PartnerCustomerLink.id).filter(
        PartnerCustomerLink.partner_id == partner.id,
        PartnerCustomerLink.customer_id == body.customer_id,
    ).first()
    if not linked:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Customer not found")
    customer = db.get(User, body.customer_id)
    if not customer:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Customer not found")
    try:
        q = insurance.create_quote(db, vehicle=body.vehicle.model_dump(),
                                   channel=QuoteChannel.partner_api, created_by=None,
                                   customer=customer, partner_id=partner.id)
    except insurance.BusinessRule as br:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, {"code": br.code, "detail": br.detail})
    s = get_settings()
    enqueue_partner_event(db, partner.id, "quote.created", {
        "quote_id": q.reference, "premium_ugx": q.premium,
        "valid_until": q.expires_at.isoformat(),
    }, background_tasks)
    return {"quote_id": q.reference, "premium_ugx": q.premium, "rate": q.rate,
            "valid_until": q.expires_at.isoformat(), "share_url": f"{s.public_base_url}/quote/{q.reference}"}


@router.post("/quotes/{reference}/bind", status_code=202)
def bind_quote(reference: str, body: dict, request: Request, background_tasks: BackgroundTasks,
               db: Session = Depends(get_db), partner: Partner = Depends(current_partner)) -> dict:
    idem = (request.headers.get("Idempotency-Key") or "").strip()
    if not idem or len(idem) > 128:
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                            "Idempotency-Key header required (maximum 128 characters)")
    try:
        provider = PaymentProvider(str(body.get("payment_method", "mtn_momo")))
    except ValueError:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Unknown payment method")
    if provider == PaymentProvider.cash_agent:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Unsupported partner payment method")

    quote = db.query(Quote).filter(Quote.reference == reference).first()
    if not quote:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Quote not found")
    if quote.partner_id != partner.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Quote does not belong to this partner")
    customer = db.get(User, quote.customer_id) if quote.customer_id else None
    if not customer or customer.kyc_status != KycStatus.approved:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, {"code": "KYC_REQUIRED",
                                                                   "detail": "Customer must complete KYC before bind"})

    operation = "quote.bind"
    request_data = {
        "operation": operation,
        "quote_id": reference,
        "payment_method": provider.value,
        "payer_phone": body.get("payer_phone"),
    }
    request_hash = hashlib.sha256(json.dumps(
        request_data, sort_keys=True, separators=(",", ":"), ensure_ascii=True,
    ).encode("utf-8")).hexdigest()

    existing = db.query(PartnerIdempotencyRecord).filter(
        PartnerIdempotencyRecord.partner_id == partner.id,
        PartnerIdempotencyRecord.key == idem,
    ).first()
    if existing:
        return _replay_bind(existing, operation, request_hash)

    record = PartnerIdempotencyRecord(
        partner_id=partner.id, key=idem, operation=operation, request_hash=request_hash,
    )
    db.add(record)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        existing = db.query(PartnerIdempotencyRecord).filter(
            PartnerIdempotencyRecord.partner_id == partner.id,
            PartnerIdempotencyRecord.key == idem,
        ).first()
        if existing:
            return _replay_bind(existing, operation, request_hash)
        raise HTTPException(status.HTTP_409_CONFLICT, "Idempotency key could not be reserved")

    try:
        payment = insurance.initiate_payment(
            db, quote, provider=provider.value, payer_phone=body.get("payer_phone"), commit=False,
        )
    except insurance.BusinessRule as br:
        db.rollback()
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            {"code": br.code, "detail": br.detail})

    response = {"payment_ref": payment.reference, "state": payment.status.value}
    record.response = response
    db.commit()
    enqueue_partner_event(db, partner.id, "payment.initiated", {
        "payment_ref": payment.reference, "quote_id": quote.reference,
        "status": payment.status.value, "amount_ugx": payment.amount,
    }, background_tasks)
    return response


def _replay_bind(record: PartnerIdempotencyRecord, operation: str,
                 request_hash: str) -> dict:
    if record.operation != operation or record.request_hash != request_hash:
        raise HTTPException(status.HTTP_409_CONFLICT,
                            "Idempotency-Key was already used for a different request")
    if not record.response:
        raise HTTPException(status.HTTP_409_CONFLICT,
                            "The original request is still processing; retry shortly")
    return record.response


# ── payments & webhooks ──────────────────────────────────────────────────────
@router.get("/payments/{reference}")
def payment_status(reference: str, db: Session = Depends(get_db),
                   partner: Partner = Depends(current_partner)) -> dict:
    p = (db.query(Payment)
           .join(Quote, Payment.quote_id == Quote.id)
           .filter(Payment.reference == reference, Quote.partner_id == partner.id)
           .first())
    if not p:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Payment not found")
    return {"payment_ref": p.reference, "status": p.status.value, "amount": p.amount}


# ── claims ───────────────────────────────────────────────────────────────────
@router.post("/claims", status_code=201)
def file_claim(body: ClaimIn, background_tasks: BackgroundTasks,
               db: Session = Depends(get_db),
               partner: Partner = Depends(current_partner)) -> dict:
    policy = db.query(Policy).filter(Policy.policy_no == body.policy_no).first()
    if not policy:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Policy not found")
    quote = db.get(Quote, policy.quote_id)
    if not quote or quote.partner_id != partner.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Policy does not belong to this partner")
    from app.api.claims import file_claim
    claim = file_claim(db, body, None, "partner_api")
    enqueue_partner_event(db, partner.id, "claim.created", {
        "claim_ref": claim.reference, "policy_no": policy.policy_no,
        "status": claim.status.value,
    }, background_tasks)
    return {"reference": claim.reference, "status": claim.status.value}


# ── partner-scoped reports ───────────────────────────────────────────────────
@router.get("/reports/commissions")
def commissions(month: str, db: Session = Depends(get_db),
                partner: Partner = Depends(current_partner)) -> dict:
    from app.models import Commission
    try:
        datetime.strptime(month, "%Y-%m")
    except ValueError:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "month must use YYYY-MM format")
    rows = (db.query(Commission)
              .join(Policy, Commission.policy_id == Policy.id)
              .join(Quote, Policy.quote_id == Quote.id)
              .filter(Quote.partner_id == partner.id, Commission.statement_month == month)
              .all())
    total = sum(c.amount for c in rows)
    return {"month": month, "policies": len(rows), "total_commission_ugx": total}
