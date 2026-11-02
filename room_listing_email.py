"""Transactional room notifications, delivered after responses with durable retries."""
import html
import logging
import os
import smtplib
import ssl
import threading
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
from email.utils import format_datetime
from urllib.parse import urlsplit

from models import Accommodation, Landlord, RoomListingEmail

logger = logging.getLogger(__name__)
_delivery_lock = threading.Lock()


def queue_room_email(db, room, event):
    # The caller commits this row with the listing/approval transaction.
    existing = db.query(RoomListingEmail).filter_by(room_id=room.id, event=event).first()
    if not existing:
        db.add(RoomListingEmail(room_id=room.id, event=event, status="pending", attempts=0,
                                next_attempt_at=datetime.now(timezone.utc).isoformat()))
    elif existing.status == "skipped" and event == "live":
        existing.status = "pending"
        existing.next_attempt_at = datetime.now(timezone.utc).isoformat()


def build_room_email(job, room, owner):
    base = os.getenv("PUBLIC_BASE_URL", "https://arounus.com").strip().rstrip("/")
    parsed = urlsplit(base)
    if parsed.scheme != "https" or not parsed.netloc or parsed.username or parsed.password:
        base = "https://arounus.com"
    link = f"{base}/listing/room/{room.id}"
    title = room.title.replace("\r", " ").replace("\n", " ")
    greeting = f"Hi {owner.full_name},"
    if job.event == "submitted":
        subject = "Your Arounus room listing is awaiting verification"
        body = (f'Thank you for listing "{title}" on Arounus. Your room has been submitted for verification and is not live yet.\n\n'
                "We will alert you by email when verification is complete and your listing is approved and live.")
        action = ""
    else:
        subject = "Your Arounus room listing is now live"
        body = f'Good news! Your room listing "{title}" has been verified and approved. It is now live on Arounus.\n\nView and share your listing:\n{link}'
        action = f'<p><a href="{html.escape(link, quote=True)}" style="display:inline-block;padding:12px 20px;background:#087f70;color:#fff;border-radius:8px;text-decoration:none">View your listing</a></p>'
    footer = "Thank you for being part of Arounus — Around us.\nNeed help? Email arounus.com@gmail.com or WhatsApp 061 704 8855."
    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = os.getenv("SMTP_FROM") or os.getenv("SMTP_USER") or "no-reply@arounus.com"
    msg["To"] = owner.email
    msg["Reply-To"] = "arounus.com@gmail.com"
    msg["Date"] = format_datetime(datetime.now(timezone.utc))
    msg["Message-ID"] = f"<room-{room.id}-{job.event}-{job.id}@arounus.com>"
    msg.set_content(f"{greeting}\n\n{body}\n\n{footer}")
    paragraphs = ''.join(f'<p>{html.escape(part).replace(chr(10), "<br>")}</p>' for part in body.split('\n\n'))
    msg.add_alternative(f'<!doctype html><html><body style="margin:0;background:#f2f7f4;font-family:Arial,sans-serif;color:#19312e"><main style="max-width:560px;margin:24px auto;padding:28px;background:#fff;border:1px solid #d4e5dc;border-radius:16px"><p style="color:#087f70;font-weight:bold">AROUNUS · AROUND US</p><h1 style="font-size:24px">{"Listing received" if job.event == "submitted" else "Your listing is live"}</h1><p>{html.escape(greeting)}</p>{paragraphs}{action}<p style="font-size:13px;color:#526b65">{html.escape(footer).replace(chr(10), "<br>")}</p></main></body></html>', subtype="html")
    return msg


def send_room_email(message):
    host = os.getenv("SMTP_HOST", "").strip()
    if not host:
        return False
    try:
        port = int(os.getenv("SMTP_PORT", "587"))
        use_ssl = port == 465 or os.getenv("SMTP_SSL", "0").lower() in ("1", "true", "yes")
        client = smtplib.SMTP_SSL if use_ssl else smtplib.SMTP
        options = {"timeout": 10}
        if use_ssl:
            options["context"] = ssl.create_default_context()
        with client(host, port, **options) as smtp:
            smtp.ehlo()
            if not use_ssl and os.getenv("SMTP_TLS", "1").lower() not in ("0", "false", "no"):
                smtp.starttls(context=ssl.create_default_context())
                smtp.ehlo()
            if os.getenv("SMTP_USER"):
                smtp.login(os.environ["SMTP_USER"], os.getenv("SMTP_PASSWORD", ""))
            return not smtp.send_message(message)
    except Exception as exc:
        # Do not log addresses, message contents or SMTP credentials.
        logger.warning("Room email delivery failed (%s); retained for retry", type(exc).__name__)
        return False


def deliver_room_emails(session_factory, limit=20):
    if not _delivery_lock.acquire(blocking=False):
        return
    try:
        for _ in range(limit):
            with session_factory() as db:
                now = datetime.now(timezone.utc)
                # Row locks also prevent concurrent production instances from sending the same job.
                job = (db.query(RoomListingEmail).filter(RoomListingEmail.status == "pending",
                       RoomListingEmail.next_attempt_at <= now.isoformat())
                       .order_by(RoomListingEmail.id).with_for_update(skip_locked=True).first())
                if not job:
                    break
                room = db.get(Accommodation, job.room_id)
                owner = db.get(Landlord, room.landlord_id) if room else None
                stale = (not owner or not owner.active or
                         (job.event == "submitted" and room.is_approved) or
                         (job.event == "live" and not (room.is_approved and room.is_available)))
                if stale:
                    job.status = "skipped"
                else:
                    job.attempts += 1
                    try:
                        message = build_room_email(job, room, owner)
                    except ValueError:
                        # One malformed account address must not block other advertisers' mail.
                        job.status = "failed"
                        logger.warning("Room email %s has invalid message headers", job.id)
                        db.commit()
                        continue
                    if send_room_email(message):
                        job.status = "sent"
                        job.sent_at = now.isoformat()
                    else:
                        job.next_attempt_at = (now + timedelta(seconds=min(3600, 60 * 2 ** min(job.attempts - 1, 6)))).isoformat()
                db.commit()
    except Exception:
        logger.exception("Room email queue processing failed; pending messages will retry")
    finally:
        _delivery_lock.release()


def start_room_email_worker(session_factory):
    stop = threading.Event()
    def run():
        while not stop.is_set():
            deliver_room_emails(session_factory)
            stop.wait(30)
    thread = threading.Thread(target=run, name="room-email-delivery", daemon=True)
    thread.start()
    return stop, thread
