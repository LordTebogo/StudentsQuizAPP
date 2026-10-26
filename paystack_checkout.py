"""Paystack hosted checkout for South African Google Pay payments."""

import json
import os
import urllib.error
import urllib.parse
import urllib.request


class PaystackError(Exception):
    pass


def configured():
    """Only expose live checkout after the merchant enables Google Pay."""
    return (os.getenv("PAYSTACK_SECRET_KEY", "").startswith("sk_live_")
            and os.getenv("PAYSTACK_GOOGLE_PAY_ENABLED", "").lower() == "true")


def _request(path, payload=None):
    secret = os.getenv("PAYSTACK_SECRET_KEY", "").strip()
    if not secret:
        raise PaystackError("Google Pay checkout is not configured")
    body = json.dumps(payload).encode("utf-8") if payload is not None else None
    request = urllib.request.Request("https://api.paystack.co" + path, body,
                                     {"Authorization": "Bearer " + secret, "Content-Type": "application/json"},
                                     method="POST" if body is not None else "GET")
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            data = json.loads(response.read(512000))
    except (urllib.error.URLError, TimeoutError, ValueError) as exc:
        raise PaystackError("Paystack is unavailable. Please try again later.") from exc
    if not isinstance(data, dict) or data.get("status") is not True or not isinstance(data.get("data"), dict):
        raise PaystackError("Paystack could not process this transaction")
    return data["data"]


def start(reference, email, amount_cents, callback_url):
    data = _request("/transaction/initialize", {
        "reference": reference,
        "email": email,
        "amount": amount_cents,
        "currency": "ZAR",
        "callback_url": callback_url,
        # Google Pay appears on Paystack's hosted checkout when the account,
        # card and device are eligible. It uses the card channel.
        "channels": ["card"],
    })
    url = data.get("authorization_url", "")
    parsed = urllib.parse.urlsplit(url)
    if data.get("reference") != reference or parsed.scheme != "https" or parsed.hostname != "checkout.paystack.com":
        raise PaystackError("Paystack returned an unexpected checkout link")
    return url


def verify(reference):
    data = _request("/transaction/verify/" + urllib.parse.quote(reference, safe=""))
    return {
        "reference": data.get("reference"),
        "status": data.get("status"),
        "amount_cents": data.get("amount"),
        "currency": data.get("currency"),
        "domain": data.get("domain"),
        "email": (data.get("customer") or {}).get("email"),
    }
