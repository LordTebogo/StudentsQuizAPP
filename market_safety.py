"""Guest reporting and an administrator-only review queue for marketplace listings."""
from datetime import datetime, timedelta, timezone
import hashlib
import hmac
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from database import get_db
from models import Accommodation, Landlord, MarketAdvert, MarketListingReport


class ListingReportInput(BaseModel):
    kind: Literal["room", "offer"]
    listing_id: int = Field(gt=0)
    reason: Literal["unavailable", "outdated", "suspicious", "misleading", "other"]
    details: str = Field(default="", max_length=2000)


class ReportReviewInput(BaseModel):
    status: Literal["open", "resolved"]


def create_market_safety_router(require_admin, secret: str):
    def prevent_caching(response: Response):
        response.headers["Cache-Control"] = "private, no-store"

    router = APIRouter(dependencies=[Depends(prevent_caching)])

    @router.post("/marketing/reports", status_code=201)
    def report_listing(payload: ListingReportInput, request: Request, db: Session = Depends(get_db)):
        now = datetime.now(timezone.utc)
        # Ignore untrusted forwarded headers. No raw network address is stored.
        address = request.client.host if request.client else "unknown"
        reporter_key = hmac.new(secret.encode(), address.encode(), hashlib.sha256).hexdigest()
        recent = db.query(MarketListingReport).filter(
            MarketListingReport.reporter_key == reporter_key,
            MarketListingReport.created_at >= (now - timedelta(hours=1)).isoformat(),
        )
        duplicate = recent.filter_by(kind=payload.kind, listing_id=payload.listing_id, reason=payload.reason).first()
        if duplicate:
            return {"ok": True, "reference": duplicate.id}
        if recent.count() >= 10:
            raise HTTPException(429, "Too many reports. Please try later or contact Arounus support.", headers={"Retry-After": "3600"})
        if payload.kind == "room":
            item = db.query(Accommodation).join(Landlord).filter(
                Accommodation.id == payload.listing_id, Accommodation.is_approved == True,
                Landlord.active == True,
            ).first()
            title = item.title if item else ""
        else:
            today = now.date().isoformat()
            item = db.query(MarketAdvert).filter(
                MarketAdvert.id == payload.listing_id, MarketAdvert.status == "approved",
                (MarketAdvert.starts_at.is_(None)) | (MarketAdvert.starts_at <= today),
                (MarketAdvert.expires_at.is_(None)) | (MarketAdvert.expires_at >= today),
            ).first()
            title = item.headline if item else ""
        if not item:
            raise HTTPException(404, "This listing is no longer published. Contact Arounus support with its link if you still need help.")
        if title.strip().upper().startswith("DEMO:") or (item.campus or "").strip().lower() == "demo campus":
            raise HTTPException(400, "This is an example listing, not a real offer.")
        report = MarketListingReport(kind=payload.kind, listing_id=payload.listing_id,
            listing_title=title[:180], reason=payload.reason, details=payload.details.strip(),
            reporter_key=reporter_key, created_at=now.isoformat(), status="open")
        db.add(report)
        db.commit()
        return {"ok": True, "reference": report.id}

    @router.get("/admin/market-reports")
    def list_reports(status: Literal["open", "resolved"] = "open", _admin=Depends(require_admin), db: Session = Depends(get_db)):
        rows = db.query(MarketListingReport).filter_by(status=status).order_by(MarketListingReport.created_at.desc()).limit(100).all()
        return [{key: getattr(row, key) for key in ("id", "kind", "listing_id", "listing_title", "reason", "details", "status", "created_at", "reviewed_at")} for row in rows]

    @router.patch("/admin/market-reports/{report_id}")
    def review_report(report_id: int, payload: ReportReviewInput, _admin=Depends(require_admin), db: Session = Depends(get_db)):
        report = db.query(MarketListingReport).filter_by(id=report_id).first()
        if not report:
            raise HTTPException(404, "Report not found")
        report.status = payload.status
        report.reviewed_at = datetime.now(timezone.utc).isoformat() if payload.status == "resolved" else None
        db.commit()
        return {"ok": True, "status": report.status}

    return router
