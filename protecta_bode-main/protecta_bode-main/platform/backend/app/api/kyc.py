"""KYC: handoff sessions on the vendored (Protecta-branded) verification stack.

The platform never touches ID documents or selfies: customers complete
verification on the hosted wizard and we read back only the outcome."""
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import get_current_user, require_role, staff_roles
from app.models import KycStatus, User
from app.services import clients

router = APIRouter(prefix="/kyc", tags=["kyc"])


@router.post("/session")
def open_session(db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> dict:
    try:
        session = clients.kyc_open_session(user.id)
    except clients.ServiceUnavailable as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc))
    if not session.get("id") or not session.get("url"):
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE,
                            "KYC service did not return a verification link")
    user.kyc_session_id = str(session["id"])
    db.commit()
    return {"session_id": user.kyc_session_id, "url": session["url"]}


@router.get("/session/{session_id}")
def session_status(session_id: str, db: Session = Depends(get_db),
                   user: User = Depends(get_current_user)) -> dict:
    if not user.kyc_session_id or user.kyc_session_id != session_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "KYC session not found")
    try:
        result = clients.kyc_result(session_id)
    except clients.ServiceUnavailable as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc))
    status_value = str(result.get("status", "")).lower()
    if status_value in {"approved", "verified", "complete", "completed"}:
        user.kyc_status = KycStatus.approved
        db.commit()
    elif status_value in {"rejected", "failed", "hard_rejected"}:
        user.kyc_status = KycStatus.rejected
        db.commit()
    return result


@router.post("/manual-review/{user_id}")
def manual_review(user_id: int, decision: dict, db: Session = Depends(get_db),
                  staff: User = Depends(require_role(*staff_roles))) -> dict:
    """Tier-2 manual review for high-value vehicles, fleets, agents and brokers."""
    target = db.get(User, user_id)
    if not target:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
    target.kyc_status = KycStatus(decision.get("decision", "pending"))
    db.commit()
    return {"user_id": target.id, "kyc_status": target.kyc_status.value}
