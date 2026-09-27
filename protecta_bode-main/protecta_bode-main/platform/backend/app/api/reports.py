"""Reports suite (docs/REPORTS.md): agent commissions, performance, broker tree.

All queries are channel-aware and reconcile to CONFIRMED payments only."""
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import get_current_user, require_role, staff_roles
from app.models import (Commission, CommissionStatus, Policy, Quote, QuoteChannel,
                        User, UserRole)

router = APIRouter(prefix="/reports", tags=["reports"])


def _month_range(month: str) -> tuple:
    start = datetime.strptime(month, "%Y-%m")
    y, m = start.year, start.month
    end = datetime(y + (m == 12), (m % 12) + 1, 1)
    return start, end


@router.get("/my-commissions")
def my_commissions(month: str = Query(pattern=r"^\d{4}-\d{2}$"),
                   db: Session = Depends(get_db),
                   user: User = Depends(get_current_user)) -> dict:
    """Agent/broker view of their own commissions (portal month view)."""
    start, end = _month_range(month)
    rows = (db.query(Commission)
              .filter(Commission.beneficiary_id == user.id,
                      Commission.created_at >= start, Commission.created_at < end)
              .order_by(Commission.id.desc()).all())
    items = []
    for commission in rows:
        policy = db.get(Policy, commission.policy_id)
        items.append({
            "policy_no": policy.policy_no if policy else "",
            "amount_ugx": commission.amount,
            "rate": commission.rate,
            "status": commission.status.value,
            "created_at": commission.created_at.isoformat() if commission.created_at else None,
        })
    return {"month": month,
            "total_ugx": sum(c.amount for c in rows),
            "payable_ugx": sum(c.amount for c in rows if c.status == CommissionStatus.payable),
            "paid_ugx": sum(c.amount for c in rows if c.status == CommissionStatus.paid),
            "items": items}


@router.get("/agent-commissions")
def agent_commissions(month: str = Query(pattern=r"^\d{4}-\d{2}$"),
                      db: Session = Depends(get_db),
                      user: User = Depends(require_role(*staff_roles, UserRole.broker))) -> dict:
    start, end = _month_range(month)
    query = (db.query(
                User.id, User.full_name, User.licence_no,
                func.count(Commission.id).label("policies"),
                func.sum(Commission.amount).label("commission"),
                func.sum(Commission.amount).filter(Commission.status == CommissionStatus.paid).label("paid"),
            )
            .join(Commission, Commission.beneficiary_id == User.id)
            .filter(Commission.created_at >= start, Commission.created_at < end))
    if user.role == UserRole.broker:
        query = query.filter(User.parent_broker_id == user.id)
    rows = query.group_by(User.id).all()
    return {"month": month, "agents": [
        {"agent_id": r.id, "name": r.full_name, "licence_no": r.licence_no,
         "policies": r.policies, "commission_ugx": int(r.commission or 0),
         "paid_ugx": int(r.paid or 0)} for r in rows]}


@router.get("/agent-performance")
def agent_performance(days: int = 30, db: Session = Depends(get_db),
                      user: User = Depends(require_role(*staff_roles, UserRole.broker))) -> dict:
    since = datetime.now(timezone.utc) - timedelta(days=days)
    agent_query = db.query(User).filter(User.role == UserRole.agent)
    if user.role == UserRole.broker:
        agent_query = agent_query.filter(User.parent_broker_id == user.id)
    agents = agent_query.all()
    out = []
    for a in agents:
        quotes = (db.query(func.count(Quote.id))
                    .filter(Quote.created_by == a.id, Quote.created_at >= since).scalar()) or 0
        converted = (db.query(func.count(Quote.id))
                       .filter(Quote.created_by == a.id, Quote.created_at >= since,
                               Quote.status == "converted").scalar()) or 0
        gwp = (db.query(func.sum(Policy.premium))
                 .join(Quote, Policy.quote_id == Quote.id)
                 .filter(Quote.created_by == a.id, Quote.created_at >= since).scalar()) or 0
        out.append({
            "agent_id": a.id, "name": a.full_name,
            "quotes": quotes, "converted": converted,
            "conversion_pct": round(100 * converted / quotes, 1) if quotes else 0.0,
            "gwp_ugx": int(gwp),
        })
    out.sort(key=lambda r: r["gwp_ugx"], reverse=True)
    return {"window_days": days, "agents": out}


@router.get("/broker-tree")
def broker_tree(db: Session = Depends(get_db),
                user: User = Depends(require_role(*staff_roles, UserRole.broker))) -> dict:
    """Distribution tree: broker -> agents -> policies/GWP/commission."""
    brokers = ([user] if user.role == UserRole.broker
               else db.query(User).filter(User.role == UserRole.broker).all())
    tree = []
    for b in brokers:
        agents = db.query(User).filter(User.parent_broker_id == b.id).all()
        node = {"broker_id": b.id, "broker": b.full_name, "agents": [],
                "gwp_ugx": 0, "commission_ugx": 0}
        for a in agents:
            gwp = (db.query(func.coalesce(func.sum(Policy.premium), 0))
                     .join(Quote, Policy.quote_id == Quote.id)
                     .filter(Quote.created_by == a.id).scalar())
            com = (db.query(func.coalesce(func.sum(Commission.amount), 0))
                     .filter(Commission.beneficiary_id == a.id).scalar())
            node["agents"].append({"agent_id": a.id, "name": a.full_name,
                                   "gwp_ugx": int(gwp), "commission_ugx": int(com)})
            node["gwp_ugx"] += int(gwp)
            node["commission_ugx"] += int(com)
        tree.append(node)
    return {"brokers": tree, "generated_at": datetime.now(timezone.utc).isoformat()}


@router.get("/daily-flash")
def daily_flash(db: Session = Depends(get_db),
                user: User = Depends(require_role(*staff_roles))) -> dict:
    today = datetime.now(timezone.utc).date()
    quotes = db.query(func.count(Quote.id)).filter(func.date(Quote.created_at) == today).scalar()
    policies = db.query(func.count(Policy.id)).filter(func.date(Policy.issued_at) == today).scalar()
    gwp = db.query(func.coalesce(func.sum(Policy.premium), 0)).filter(func.date(Policy.issued_at) == today).scalar()
    by_channel = dict(db.query(Quote.channel, func.count(Quote.id))
                        .filter(func.date(Quote.created_at) == today)
                        .group_by(Quote.channel).all())
    return {"date": str(today), "quotes": quotes, "policies_issued": policies,
            "gwp_ugx": int(gwp), "by_channel": {k.value if hasattr(k, "value") else str(k): v for k, v in by_channel.items()}}
