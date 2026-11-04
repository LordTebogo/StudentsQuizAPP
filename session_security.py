"""Session signing configuration and role-bound, expiring account tokens."""
import base64
import hashlib
import hmac
import secrets
import time


SESSION_TTL_SECONDS = 12 * 60 * 60
ROLES = ("lecturer", "student", "src", "landlord")


def clean_setting(value):
    value = str(value or "").strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
        value = value[1:-1].strip()
    return value


def production_environment(environ):
    """Hosted deployments must never silently use temporary development keys."""
    flags = (environ.get(name, "").lower() for name in ("AROUNUS_ENV", "APP_ENV", "ENVIRONMENT"))
    return (any(flag in {"production", "prod"} for flag in flags)
            or environ.get("RENDER", "").lower() == "true"
            or bool(environ.get("RENDER_SERVICE_ID"))
            or environ.get("DATABASE_URL", "").startswith(("postgres:", "postgresql:", "postgresql+")))


def load_session_secrets(environ, public_fingerprints=()):
    production = production_environment(environ)
    values = {}
    for role in ROLES:
        name = f"{role.upper()}_SESSION_SECRET"
        value = clean_setting(environ.get(name))
        if not value:
            if role in {"src", "landlord"}:
                value = values["student"]
            elif production:
                raise RuntimeError(f"Set {name} to a new random secret before starting production.")
            else:
                # Local SQLite development only. Sessions expire on restart.
                value = secrets.token_urlsafe(48)
        if (len(value) < 32 or len(set(value)) < 12
                or value.isdigit() or value == clean_setting(environ.get("LECTURER_PIN"))
                or hashlib.sha256(value.encode()).hexdigest() in public_fingerprints
                or any(word in value.lower() for word in ("your-secret", "change-me", "replace-me"))):
            raise RuntimeError(f"{name} must be a new random secret of at least 32 characters; never use a PIN or a published example.")
        values[role] = value
    return values


def _encode(value):
    return base64.urlsafe_b64encode(value).decode().rstrip("=")


def issue_token(role, account_id, secret, now=None):
    if role not in ROLES or account_id <= 0:
        raise ValueError("Invalid account")
    expires = int(time.time() if now is None else now) + SESSION_TTL_SECONDS
    payload = f"v2:{role}:{account_id}:{expires}".encode()
    signature = hmac.new(secret.encode(), payload, hashlib.sha256).digest()
    return f"{_encode(payload)}.{_encode(signature)}"


def verify_token(token, role, secret, now=None):
    if not isinstance(token, str) or len(token) > 1024 or token.count(".") != 1:
        raise ValueError("Invalid session")
    encoded_payload, encoded_signature = token.split(".")
    def decode(value):
        return base64.b64decode(value + "=" * (-len(value) % 4), altchars=b"-_", validate=True)
    payload, signature = decode(encoded_payload), decode(encoded_signature)
    expected = hmac.new(secret.encode(), payload, hashlib.sha256).digest()
    if not hmac.compare_digest(signature, expected):
        raise ValueError("Invalid session")
    version, token_role, account, expiry = payload.decode().split(":")
    if (version != "v2" or token_role != role or role not in ROLES or int(account) <= 0
            or int(expiry) <= int(time.time() if now is None else now)):
        raise ValueError("Invalid session")
    return int(account)
