"""Policies: lookup, my-policies, status transitions (staff only)."""
import base64

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Response, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import get_current_user, require_role, staff_roles
from app.models import AppSetting, Policy, PolicyStatus, Quote, User, Vehicle
from app.services.policy_pdf import build_policy_pdf
from app.services.webhooks import enqueue_partner_event

router = APIRouter(prefix="/policies", tags=["policies"])


def _vehicle_for(policy: Policy, quote: Quote, db: Session) -> dict:
    veh = db.get(Vehicle, policy.vehicle_id) if policy.vehicle_id else None
    snap = quote.vehicle_json or {}
    return {
        "plate": veh.plate if veh else snap.get("plate", ""),
        "make": veh.make if veh else snap.get("make", ""),
        "model": veh.model if veh else snap.get("model", ""),
        "body": snap.get("body", ""),
        "cc": snap.get("cc", ""),
        "seats": snap.get("seats", ""),
    }


def render_policy_pdf(db: Session, policy: Policy) -> bytes:
    """The official policy document with the schedule filled in (password =
    the policyholder's phone digits)."""
    quote = db.get(Quote, policy.quote_id)
    holder = db.get(User, policy.policyholder_id)
    pricing_row = db.get(AppSetting, "pricing")
    pricing = (pricing_row.value if pricing_row else {}) or {}
    return build_policy_pdf(
        policy_no=policy.policy_no,
        insured_name=holder.full_name if holder else "",
        customer_phone=holder.phone if holder else "",
        period_start=policy.period_start, period_end=policy.period_end,
        vehicle=_vehicle_for(policy, quote, db),
        value=quote.value, premium=policy.premium, pricing=pricing,
        issued_at=policy.issued_at)


def _policy_out(p: Policy) -> dict:
    return {
        "policy_no": p.policy_no, "status": p.status.value,
        "period_start": str(p.period_start), "period_end": str(p.period_end),
        "premium": p.premium,
    }


@router.get("")
def list_policies(db: Session = Depends(get_db),
                  user: User = Depends(require_role(*staff_roles))) -> list[dict]:
    """Staff policy register for operations and issuance follow-up."""
    rows = db.query(Policy).order_by(Policy.id.desc()).limit(250).all()
    result = []
    for policy in rows:
        quote = db.get(Quote, policy.quote_id)
        holder = db.get(User, policy.policyholder_id)
        vehicle = _vehicle_for(policy, quote, db) if quote else {}
        result.append({
            **_policy_out(policy),
            "customer_name": holder.full_name if holder else "",
            "quote_reference": quote.reference if quote else "",
            "vehicle": vehicle,
        })
    return result


@router.get("/mine")
def my_policies(db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> list[dict]:
    rows = (db.query(Policy)
              .join(Quote, Policy.quote_id == Quote.id)
              .filter((Policy.policyholder_id == user.id) | (Quote.created_by == user.id))
              .order_by(Policy.id.desc()).all())
    return [_policy_out(p) for p in rows]


@router.get("/{policy_no}")
def get_policy(policy_no: str, db: Session = Depends(get_db)) -> dict:
    p = db.query(Policy).filter(Policy.policy_no == policy_no).first()
    if not p:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Policy not found")
    return _policy_out(p)


@router.get("/{policy_no}/document")
def download_document(policy_no: str, db: Session = Depends(get_db),
                      user: User = Depends(get_current_user)):
    """The policy document as a password-protected PDF (password = the
    policyholder's phone number, digits only). Owner, the originating
    agent/broker, and staff may download it."""
    policy = db.query(Policy).filter(Policy.policy_no == policy_no).first()
    if not policy:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Policy not found")
    quote = db.get(Quote, policy.quote_id)
    if not (policy.policyholder_id == user.id or quote.created_by == user.id
            or user.role in staff_roles):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not your policy")
    pdf = render_policy_pdf(db, policy)
    return Response(content=pdf, media_type="application/pdf", headers={
        "Content-Disposition": f'attachment; filename="{policy.policy_no}.pdf"',
        "X-Pdf-Password-Hint": "Password is the policyholder phone number, digits only",
    })


class PolicyStatusIn(BaseModel):
    status: str   # active | lapsed | cancelled | expired


@router.post("/{policy_no}/status")
def set_status(policy_no: str, body: PolicyStatusIn, background_tasks: BackgroundTasks,
               db: Session = Depends(get_db),
               user: User = Depends(require_role(*staff_roles))) -> dict:
    p = db.query(Policy).filter(Policy.policy_no == policy_no).first()
    if not p:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Policy not found")
    previous_status = p.status
    try:
        p.status = PolicyStatus(body.status)
    except ValueError:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Unknown status")
    db.commit()
    if previous_status != p.status:
        quote = db.get(Quote, p.quote_id)
        enqueue_partner_event(db, quote.partner_id if quote else None, "policy.status_changed", {
            "policy_no": p.policy_no, "quote_id": quote.reference if quote else "",
            "previous_status": previous_status.value, "status": p.status.value,
        }, background_tasks)
    return _policy_out(p)
