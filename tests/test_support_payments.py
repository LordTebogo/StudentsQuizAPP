"""Donations use Paystack while older Ozow returns remain verifiable."""
import hashlib
import hmac
import json
import os
import tempfile
import time
import unittest
from unittest.mock import patch

_db = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
_db.close()
os.environ["DATABASE_URL"] = "sqlite:///" + _db.name.replace("\\", "/")
os.environ["SMTP_HOST"] = ""

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, inspect, text
import main
from models import SupportPayment

PAYMENT_ID = "497f6eca-6276-4993-bfeb-53cbbbba6f08"
SIGNING_KEY = "whsec_support_test"


class SupportPaymentsTest(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(main.app)
        self.enterContext(patch.dict(os.environ, {"PAYSTACK_SECRET_KEY": "sk_live_support_test",
            "PAYSTACK_ENABLED": "true", "PAYSTACK_WEBHOOK_SECRET": SIGNING_KEY,
            "PUBLIC_BASE_URL": "https://arounus.test"}))

    def test_disabled_checkout_does_not_accept_donations(self):
        with patch.dict(os.environ, {"PAYSTACK_ENABLED": "false"}):
            self.assertFalse(self.client.get("/billing/support/status").json()["available"])
            self.assertEqual(self.client.post("/billing/support/checkout", json={"amount_rand": 50,
                "email": "donor@example.test"}).status_code, 503)

    def test_checkout_uses_separate_reference_and_amount(self):
        start = self.enterContext(patch.object(main, "paystack_start", return_value="https://checkout.paystack.com/test"))
        self.assertTrue(self.client.get("/billing/support/status").json()["available"])
        for amount, email in [(19, "donor@example.test"), (5001, "donor@example.test"),
                              (50, "invalid")]:
            self.assertEqual(self.client.post("/billing/support/checkout", json={"amount_rand": amount,
                "email": email}).status_code, 400)
        response = self.client.post("/billing/support/checkout", json={"amount_rand": 75,
            "email": " Donor@Example.Test "})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["checkout_url"], "https://checkout.paystack.com/test")
        reference, checkout_email, cents, callback = start.call_args.args
        self.assertRegex(reference, r"^AS[A-F0-9]{32}$")
        self.assertEqual((checkout_email, cents, callback), ("donor@example.test", 7500,
            "https://arounus.test/billing/support/return?reference=" + reference))
        with main.SessionLocal() as db:
            payment = db.query(SupportPayment).filter_by(merchant_reference=reference).one()
            self.assertEqual((payment.email, payment.amount_cents, payment.provider, payment.checkout_url),
                             ("donor@example.test", 7500, "paystack", "https://checkout.paystack.com/test"))

    def test_paystack_return_requires_exact_verified_transaction(self):
        with patch.object(main, "paystack_start", return_value="https://checkout.paystack.com/test"):
            response = self.client.post("/billing/support/checkout", json={"amount_rand": 50,
                "email": "donor@example.test"})
        self.assertEqual(response.status_code, 200)
        with main.SessionLocal() as db:
            payment = db.query(SupportPayment).filter_by(checkout_url=response.json()["checkout_url"]).order_by(SupportPayment.id.desc()).first()
            reference = payment.merchant_reference
        valid = {"reference": reference, "status": "success", "amount_cents": 5000,
                 "currency": "ZAR", "domain": "live", "email": "donor@example.test"}
        for field, value in (("amount_cents", 1), ("currency", "USD"), ("domain", "test"),
                             ("email", "other@example.test"), ("reference", "wrong")):
            with self.subTest(field=field), patch.object(main, "paystack_verify", return_value={**valid, field: value}):
                result = self.client.get("/billing/support/return?reference=" + reference, follow_redirects=False)
                self.assertIn("support=mismatch", result.headers["location"])
        with patch.object(main, "paystack_verify", return_value=valid) as verify:
            result = self.client.get("/billing/support/return?reference=" + reference, follow_redirects=False)
            self.assertIn("support=success", result.headers["location"])
            verify.assert_called_once_with(reference)
        with main.SessionLocal() as db:
            self.assertEqual(db.query(SupportPayment).filter_by(merchant_reference=reference).one().status, "paid")

    def test_signed_support_webhook_confirms_once(self):
        with patch.object(main, "paystack_start", return_value="https://checkout.paystack.com/support-test"):
            self.client.post("/billing/support/checkout", json={"amount_rand": 75, "email": "donor@example.test"})
        with main.SessionLocal() as db:
            reference = db.query(SupportPayment).filter_by(checkout_url="https://checkout.paystack.com/support-test").order_by(SupportPayment.id.desc()).first().merchant_reference
        body = json.dumps({"event": "charge.success", "data": {"reference": reference}}).encode()
        stamp = str(int(time.time()))
        digest = hmac.new(SIGNING_KEY.encode(), stamp.encode() + b"." + body, hashlib.sha512).hexdigest()
        headers = {"Paystack-Signature": f"t={stamp},v1=whk_test:{digest}"}
        verified = {"reference": reference, "status": "success", "amount_cents": 7500,
                    "currency": "ZAR", "domain": "live", "email": "donor@example.test"}
        self.assertEqual(self.client.post("/billing/paystack/webhook", content=body).status_code, 401)
        with patch.object(main, "paystack_verify", return_value=verified) as verify:
            self.assertEqual(self.client.post("/billing/paystack/webhook", content=body, headers=headers).status_code, 200)
            self.assertEqual(self.client.post("/billing/paystack/webhook", content=body, headers=headers).status_code, 200)
            verify.assert_called_once_with(reference)

    def test_old_ozow_return_still_verifies(self):
        reference = "AS" + "A" * 32
        return_payment_id = "00000000-0000-0000-0000-000000000001"
        with main.SessionLocal() as db:
            db.add(SupportPayment(merchant_reference=reference, provider="ozow", ozow_payment_id=return_payment_id,
                email="donor@example.test", amount_cents=5000, status="pending",
                created_at="2026-11-05T00:00:00+00:00"))
            db.commit()
        with patch.object(main, "ozow_verify", return_value="pending"):
            response = self.client.get("/billing/support/return?reference=" + reference, follow_redirects=False)
            self.assertEqual(response.headers["location"], "/about?support=pending#supportArounus")
        with patch.object(main, "ozow_verify", return_value="paid") as verify:
            response = self.client.get("/billing/support/return?reference=" + reference, follow_redirects=False)
            self.assertEqual(response.headers["location"], "/about?support=success#supportArounus")
            verify.assert_called_once_with(return_payment_id, reference, 5000, "2026-11-05T00:00:00+00:00")
        with patch.object(main, "ozow_verify", side_effect=AssertionError("paid donation was verified twice")):
            response = self.client.get("/billing/support/return?reference=" + reference, follow_redirects=False)
            self.assertEqual(response.headers["location"], "/about?support=success#supportArounus")

    def test_existing_support_payments_gain_legacy_provider(self):
        engine = create_engine("sqlite://")
        try:
            with engine.begin() as connection:
                connection.execute(text("CREATE TABLE support_payments (id INTEGER PRIMARY KEY, merchant_reference VARCHAR)"))
                connection.execute(text("INSERT INTO support_payments (id, merchant_reference) VALUES (1, 'ASOLD')"))
            with patch.object(main, "engine", engine):
                main.ensure_support_billing_schema()
                main.ensure_support_billing_schema()
            self.assertIn("provider", {column["name"] for column in inspect(engine).get_columns("support_payments")})
            with engine.connect() as connection:
                self.assertEqual(connection.execute(text("SELECT provider FROM support_payments WHERE id = 1")).scalar_one(), "ozow")
        finally:
            engine.dispose()


if __name__ == "__main__":
    unittest.main()
