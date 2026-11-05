"""Ozow One API hosted payments. Credentials remain server-side."""

import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation


class OzowError(Exception):
    pass


API_BASE = "https://one.ozow.com/v1"


def configured():
    return (os.getenv("OZOW_ENABLED", "false").strip().lower() == "true"
            and bool(os.getenv("OZOW_CLIENT_ID", "").strip())
            and bool(os.getenv("OZOW_CLIENT_SECRET", "").strip())
            and bool(re.fullmatch(r"[A-Za-z0-9]{3}-[A-Za-z0-9]{3}-[A-Za-z0-9]{3}",
                                  os.getenv("OZOW_SITE_CODE", "").strip()))
            and os.getenv("OZOW_ENV", "production").strip().lower() == "production")


def _json_request(path, payload=None, token=None, form=False):
    if form:
        body = urllib.parse.urlencode(payload).encode("utf-8")
        content_type = "application/x-www-form-urlencoded"
    elif payload is not None:
        body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        content_type = "application/json"
    else:
        body = None
        content_type = "application/json"
    headers = {"Content-Type": content_type, "Accept": "application/json"}
    if token:
        headers["Authorization"] = "Bearer " + token
    request = urllib.request.Request(API_BASE + path, body, headers,
                                     method="POST" if body is not None else "GET")
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            data = json.loads(response.read(512000))
    except (urllib.error.URLError, TimeoutError, ValueError) as exc:
        raise OzowError("Ozow is unavailable. Please try again later.") from exc
    if not isinstance(data, dict):
        raise OzowError("Ozow returned an unexpected response")
    return data


def _token():
    if not configured():
        raise OzowError("Ozow checkout is not available")
    data = _json_request("/token", {
        "client_id": os.environ["OZOW_CLIENT_ID"].strip(),
        "client_secret": os.environ["OZOW_CLIENT_SECRET"].strip(),
        "scope": "payments", "grant_type": "client_credentials",
    }, form=True)
    token = data.get("access_token")
    if not isinstance(token, str) or not token:
        raise OzowError("Ozow authentication failed")
    return token


def start(reference, amount_cents, return_url):
    if not re.fullmatch(r"A[RS][A-F0-9]{32}", reference) or amount_cents < 1:
        raise OzowError("Invalid payment request")
    expires = datetime.now(timezone.utc) + timedelta(minutes=30)
    data = _json_request("/payments", {
        "siteCode": os.environ["OZOW_SITE_CODE"].strip(),
        "amount": {"currency": "ZAR", "value": amount_cents / 100},
        "merchantReference": reference,
        "beneficiaryReference": reference[:20],
        "expireAt": expires.replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "returnUrl": return_url,
    }, token=_token())
    payment_id = data.get("id")
    redirect_url = data.get("redirectUrl", "")
    parsed = urllib.parse.urlsplit(redirect_url)
    if (not isinstance(payment_id, str) or
            not re.fullmatch(r"[0-9a-fA-F-]{36}", payment_id) or
            data.get("status", "").lower() != "created" or
            parsed.scheme != "https" or parsed.hostname != "pay.ozow.com"):
        raise OzowError("Ozow returned an unexpected checkout link")
    return payment_id, redirect_url


def verify(payment_id, reference, amount_cents, created_at):
    if not re.fullmatch(r"[0-9a-fA-F-]{36}", payment_id):
        raise OzowError("Invalid Ozow payment ID")
    from_date = datetime.fromisoformat(created_at).date().isoformat()
    to_date = datetime.now(timezone.utc).date().isoformat()
    query = urllib.parse.urlencode({"fromDate": from_date, "toDate": to_date})
    data = _json_request("/payments/" + payment_id + "/transactions?" + query, token=_token())
    results = data.get("results")
    if not isinstance(results, list):
        raise OzowError("Ozow returned an unexpected transaction response")
    matched = []
    for row in results:
        if not isinstance(row, dict):
            continue
        amount = row.get("amount") or {}
        try:
            cents = int(Decimal(str(amount.get("value"))) * 100)
        except (InvalidOperation, ValueError, TypeError):
            continue
        if (row.get("merchantReference") == reference and
                row.get("siteCode") == os.environ["OZOW_SITE_CODE"].strip() and
                amount.get("currency") == "ZAR" and cents == amount_cents):
            matched.append(row.get("status", "").lower())
    if "successful" in matched:
        return "paid"
    if "error" in matched:
        return "failed"
    return "pending"
