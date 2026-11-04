"""Paystack hosted checkout and signed payment events for South Africa."""

import json
import hashlib
import hmac
import re
import time
import os
import urllib.error
import urllib.parse
import urllib.request


class PaystackError(Exception):
    pass


def configured():
    """Expose real checkout only after the merchant explicitly enables it."""
    enabled = os.getenv("PAYSTACK_ENABLED")
    if enabled is None:
        # Compatibility with deployments using the former Google Pay switch.
        enabled = os.getenv("PAYSTACK_GOOGLE_PAY_ENABLED", "false")
    return (os.getenv("PAYSTACK_SECRET_KEY", "").strip().startswith("sk_live_")
            and enabled.strip().lower() == "true")


def verify_webhook_signature(body, signature=None, legacy_signature=None, now=None):
    """Verify current timestamped signatures, or the legacy header until migration."""
    signing_secret = os.getenv("PAYSTACK_WEBHOOK_SECRET", "").strip()
    if signature or signing_secret:
        if not signing_secret.startswith("whsec_") or not isinstance(signature, str):
            return False
        timestamps, signatures = [], []
        for field in signature.split(","):
            name, separator, value = field.strip().partition("=")
            if not separator:
                continue
            if name == "t":
                timestamps.append(value)
            elif name == "v1":
                key_id, separator, digest = value.partition(":")
                if separator and key_id.startswith("whk_") and re.fullmatch(r"[0-9a-f]{128}", digest):
                    signatures.append(digest)
        if len(timestamps) != 1 or not re.fullmatch(r"[0-9]{1,12}", timestamps[0]):
            return False
        timestamp = int(timestamps[0])
        if abs((time.time() if now is None else now) - timestamp) > 300:
            return False
        signed = timestamps[0].encode("ascii") + b"." + body
        expected = hmac.new(signing_secret.encode(), signed, hashlib.sha512).hexdigest()
        return any(hmac.compare_digest(expected, candidate) for candidate in signatures)
    secret = os.getenv("PAYSTACK_SECRET_KEY", "").strip()
    if not secret or not isinstance(legacy_signature, str) or not re.fullmatch(r"[0-9a-f]{128}", legacy_signature):
        return False
    expected = hmac.new(secret.encode(), body, hashlib.sha512).hexdigest()
    return hmac.compare_digest(expected, legacy_signature)


def _request(path, payload=None):
    secret = os.getenv("PAYSTACK_SECRET_KEY", "").strip()
    if not secret:
        raise PaystackError("Paystack checkout is not configured")
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
        # Omit channels so hosted checkout uses the merchant's approved dashboard
        # preferences, currency, and device eligibility (cards, banks and wallets).
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
