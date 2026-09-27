"""Claims: FNOL intake (portal, bot via internal key, partner API) + status machine."""
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import get_current_user, require_internal_key, require_role, staff_roles
from app.models import Claim, ClaimStatus, Policy, Quote, User
from app.schemas import ClaimIn, StatusUpdate
from app.security import new_reference
from app.services.webhooks import enqueue_partner_event

router = APIRouter(prefix="/claims", tags=["claims"])

VALID_TRANSITIONS = {
    ClaimStatus.reported: {ClaimStatus.assigned, ClaimStatus.rejected},
    ClaimStatus.assigned: {ClaimStatus.assessed, ClaimStatus.rejected},
    ClaimStatus.assessed: {ClaimStatus.approved, ClaimStatus.rejected},
    ClaimStatus.approved: {ClaimStatus.settled},
    ClaimStatus.rejected: set(),
    ClaimStatus.settled: set(),
}


def _claim_out(c: Claim) -> dict:
    return {
        "reference": c.reference, "policy_no": db_policy_no(c), "status": c.status.value,
        "incident_date": str(c.incident_date), "photos": c.photos,
    }


def db_policy_no(c: Claim) -> str:
    return c.policy.policy_no if c.policy else ""


def file_claim(db: Session, body: ClaimIn, reporter: User | None, channel: str) -> Claim:
    policy = db.query(Policy).filter(Policy.policy_no == body.policy_no).first()
    if not policy:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Policy not found")
    if policy.status.value != "active":
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, {"code": "POLICY_NOT_ACTIVE",
                                                                   "detail": "Claims can only be filed on active policies"})
    claim = Claim(
        reference=new_reference("CL"),
        policy_id=policy.id,
        reporter_id=reporter.id if reporter else None,
        incident_date=body.incident_date,
        description=body.description,
        location=body.location,
        photos=body.photos,
    )
    db.add(claim)
    db.commit()
    return claim


@router.get("")
def list_claims(db: Session = Depends(get_db),
                user: User = Depends(require_role(*staff_roles))) -> list[dict]:
    """Staff claims queue (newest first)."""
    rows = db.query(Claim).order_by(Claim.id.desc()).limit(200).all()
    return [_claim_out(c) for c in rows]


@router.post("")
def create_claim(body: ClaimIn, background_tasks: BackgroundTasks,
                 db: Session = Depends(get_db),
                 user: User = Depends(get_current_user)) -> dict:
    policy = db.query(Policy).filter(Policy.policy_no == body.policy_no).first()
    claim = file_claim(db, body, user, "web")
    quote = db.get(Quote, policy.quote_id) if policy else None
    enqueue_partner_event(db, quote.partner_id if quote else None, "claim.created", {
        "claim_ref": claim.reference, "policy_no": body.policy_no,
        "status": claim.status.value,
    }, background_tasks)
    return _claim_out(claim)


@router.post("/internal")
def create_claim_internal(body: ClaimIn, background_tasks: BackgroundTasks,
                          db: Session = Depends(get_db),
                          _: None = Depends(require_internal_key)) -> dict:
    """Bot / services file claims on behalf of customers (channel recorded in audit)."""
    policy = db.query(Policy).filter(Policy.policy_no == body.policy_no).first()
    claim = file_claim(db, body, None, "whatsapp")
    quote = db.get(Quote, policy.quote_id) if policy else None
    enqueue_partner_event(db, quote.partner_id if quote else None, "claim.created", {
        "claim_ref": claim.reference, "policy_no": body.policy_no,
        "status": claim.status.value,
    }, background_tasks)
    return _claim_out(claim)


@router.get("/{reference}")
def get_claim(reference: str, db: Session = Depends(get_db)) -> dict:
    c = db.query(Claim).filter(Claim.reference == reference).first()
    if not c:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Claim not found")
    return _claim_out(c)


@router.post("/{reference}/status")
def update_status(reference: str, body: StatusUpdate, background_tasks: BackgroundTasks,
                  db: Session = Depends(get_db),
                  user: User = Depends(require_role(*staff_roles))) -> dict:
    c = db.query(Claim).filter(Claim.reference == reference).first()
    if not c:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Claim not found")
    previous_status = c.status
    try:
        new_status = ClaimStatus(body.status)
    except ValueError:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Unknown status")
    if new_status not in VALID_TRANSITIONS[c.status]:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            {"code": "BAD_TRANSITION",
                             "detail": f"Cannot move claim from {c.status.value} to {new_status.value}"})
    c.status = new_status
    if new_status == ClaimStatus.assigned:
        c.adjuster_id = user.id
    db.commit()
    policy = db.get(Policy, c.policy_id)
    quote = db.get(Quote, policy.quote_id) if policy else None
    enqueue_partner_event(db, quote.partner_id if quote else None, "claim.status_changed", {
        "claim_ref": c.reference, "policy_no": policy.policy_no if policy else "",
        "previous_status": previous_status.value, "status": c.status.value,
    }, background_tasks)
    return _claim_out(c)
