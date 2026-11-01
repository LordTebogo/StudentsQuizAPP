"""First-party, anonymous app traffic and administrator-only history."""
import hashlib
import hmac
import re
import secrets
from datetime import date, datetime, timedelta, timezone
from urllib.parse import urlsplit

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from database import get_db
from models import AppTrafficActivity

LOCAL_TIMEZONE = timezone(timedelta(hours=2))  # Johannesburg has no DST.
COOKIE_NAME = "arounus_traffic"
ACTIVE_SECONDS = 120


def utc_now():
    return datetime.now(timezone.utc)


def timestamp(value):
    return value.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")


def local_hour(value):
    return value.astimezone(LOCAL_TIMEZONE).replace(minute=0, second=0, microsecond=0).isoformat()


def create_traffic_router(require_admin, session_secret):
    router = APIRouter()
    secret = session_secret.encode("utf-8")

    def signature(identifier):
        return hmac.new(secret, ("app-traffic:" + identifier).encode(), hashlib.sha256).hexdigest()

    @router.post("/traffic/heartbeat", status_code=204, include_in_schema=False)
    def heartbeat(request: Request, db: Session = Depends(get_db)):
        # The browser calls this only for a visible page. Reject cross-site
        # submissions even though other parts of the app allow broad CORS.
        origin = request.headers.get("origin")
        if request.headers.get("sec-fetch-site") == "cross-site" or (
            origin and urlsplit(origin).netloc != request.url.netloc
        ):
            raise HTTPException(status_code=403, detail="Traffic updates must come from this app")
        cookie = request.cookies.get(COOKIE_NAME, "")
        identifier, _, supplied_signature = cookie.partition(".")
        valid = bool(re.fullmatch(r"[a-f0-9]{32}", identifier)) and bool(re.fullmatch(r"[a-f0-9]{64}", supplied_signature)) and hmac.compare_digest(
            supplied_signature, signature(identifier)
        )
        if not valid:
            identifier = secrets.token_hex(16)
        visitor_hash = hashlib.sha256(identifier.encode()).hexdigest()
        now = utc_now()
        hour, seen = local_hour(now), timestamp(now)
        activity = db.query(AppTrafficActivity).filter_by(visitor_hash=visitor_hash, hour=hour)
        existing = activity.first()
        if existing is None:
            db.add(AppTrafficActivity(visitor_hash=visitor_hash, hour=hour, first_seen=seen, last_seen=seen))
            try:
                db.commit()
            except IntegrityError:
                # Multiple open tabs/workers can first report an hour together.
                db.rollback()
                activity.filter(AppTrafficActivity.last_seen < seen).update({"last_seen": seen})
                db.commit()
        elif existing.last_seen < timestamp(now - timedelta(seconds=30)):
            activity.filter(AppTrafficActivity.last_seen < seen).update({"last_seen": seen})
            db.commit()
        response = Response(status_code=204, headers={"Cache-Control": "no-store"})
        if not valid:
            forwarded = request.headers.get("x-forwarded-proto", "").split(",", 1)[0].strip()
            response.set_cookie(
                COOKIE_NAME, identifier + "." + signature(identifier), max_age=365 * 86400,
                httponly=True, samesite="lax", secure=request.url.scheme == "https" or forwarded == "https",
            )
        return response

    @router.get("/admin/traffic", dependencies=[Depends(require_admin)])
    def traffic(response: Response, start_date: date | None = None, end_date: date | None = None,
                db: Session = Depends(get_db)):
        response.headers["Cache-Control"] = "no-store"
        now = utc_now()
        today = now.astimezone(LOCAL_TIMEZONE).date()
        end = end_date or today
        start = start_date or end - timedelta(days=6)
        if start > end or (end - start).days > 365 or end == date.max:
            raise HTTPException(status_code=400, detail="Choose a date range of up to 366 days, with the start before the end")
        start_hour = start.isoformat() + "T00:00:00+02:00"
        end_hour = (end + timedelta(days=1)).isoformat() + "T00:00:00+02:00"
        today_hour = today.isoformat() + "T00:00:00+02:00"
        distinct_visitors = func.count(func.distinct(AppTrafficActivity.visitor_hash))
        query = db.query(distinct_visitors)
        first_seen = db.query(func.min(AppTrafficActivity.first_seen)).scalar()
        daily_counts = dict(db.query(func.substr(AppTrafficActivity.hour, 1, 10), distinct_visitors).filter(
            AppTrafficActivity.hour >= start_hour, AppTrafficActivity.hour < end_hour,
        ).group_by(func.substr(AppTrafficActivity.hour, 1, 10)).all())
        hours = [local_hour(now - timedelta(hours=i)) for i in range(24)]
        hourly_counts = dict(db.query(AppTrafficActivity.hour, distinct_visitors).filter(
            AppTrafficActivity.hour >= hours[-1], AppTrafficActivity.hour <= hours[0],
        ).group_by(AppTrafficActivity.hour).all())
        return {
            "generated_at": timestamp(now), "timezone": "Africa/Johannesburg",
            "active_window_seconds": ACTIVE_SECONDS, "tracking_started_at": first_seen,
            "summary": {
                "active_now": query.filter(AppTrafficActivity.last_seen >= timestamp(now - timedelta(seconds=ACTIVE_SECONDS))).scalar(),
                "past_hour": query.filter(AppTrafficActivity.last_seen >= timestamp(now - timedelta(hours=1))).scalar(),
                "today": query.filter(AppTrafficActivity.hour >= today_hour).scalar(),
                "all_time": query.scalar(),
                "selected_period": query.filter(AppTrafficActivity.hour >= start_hour, AppTrafficActivity.hour < end_hour).scalar(),
            },
            "start_date": start.isoformat(), "end_date": end.isoformat(),
            "daily": [{"date": (start + timedelta(days=i)).isoformat(),
                       "visitors": daily_counts.get((start + timedelta(days=i)).isoformat(), 0)}
                      for i in range((end - start).days + 1)],
            "hourly": [{"hour": hour, "visitors": hourly_counts.get(hour, 0)} for hour in reversed(hours)],
        }

    return router
