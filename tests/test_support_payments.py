"""The About page uses a separate, gated Ozow checkout for donations."""
import os
import tempfile
import unittest
from unittest.mock import patch

_db = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
_db.close()
os.environ["DATABASE_URL"] = "sqlite:///" + _db.name.replace("\\", "/")
os.environ["SMTP_HOST"] = ""

from fastapi.testclient import TestClient
import main
from models import SupportPayment

PAYMENT_ID = "497f6eca-6276-4993-bfeb-53cbbbba6f08"


class SupportPaymentsTest(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(main.app)
        self.enterContext(patch.dict(os.environ, {"OZOW_CLIENT_ID": "client-test",
            "OZOW_CLIENT_SECRET": "secret-test", "OZOW_SITE_CODE": "ABC-DEF-GHI",
            "OZOW_ENABLED": "true", "OZOW_ENV": "production",
            "PUBLIC_BASE_URL": "https://arounus.test"}))

    def test_disabled_checkout_does_not_accept_donations(self):
        with patch.dict(os.environ, {"OZOW_ENABLED": "false"}):
            self.assertFalse(self.client.get("/billing/support/status").json()["available"])
            self.assertEqual(self.client.post("/billing/support/checkout", json={"amount_rand": 50,
                "email": "donor@example.test"}).status_code, 503)

    def test_checkout_uses_separate_reference_and_amount(self):
        start = self.enterContext(patch.object(main, "ozow_start", return_value=(PAYMENT_ID, "https://pay.ozow.com/test")))
        self.assertTrue(self.client.get("/billing/support/status").json()["available"])
        for amount, email in [(19, "donor@example.test"), (5001, "donor@example.test"),
                              (50, "invalid")]:
            self.assertEqual(self.client.post("/billing/support/checkout", json={"amount_rand": amount,
                "email": email}).status_code, 400)
        response = self.client.post("/billing/support/checkout", json={"amount_rand": 75,
            "email": " Donor@Example.Test "})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["checkout_url"], "https://pay.ozow.com/test")
        reference, cents, callback = start.call_args.args
        self.assertRegex(reference, r"^AS[A-F0-9]{32}$")
        self.assertEqual((cents, callback), (7500,
            "https://arounus.test/billing/support/return?reference=" + reference))
        with main.SessionLocal() as db:
            payment = db.query(SupportPayment).filter_by(merchant_reference=reference).one()
            self.assertEqual((payment.email, payment.amount_cents, payment.ozow_payment_id),
                             ("donor@example.test", 7500, PAYMENT_ID))

    def test_return_claims_success_only_after_ozow_verification(self):
        reference = "AS" + "A" * 32
        return_payment_id = "00000000-0000-0000-0000-000000000001"
        with main.SessionLocal() as db:
            db.add(SupportPayment(merchant_reference=reference, ozow_payment_id=return_payment_id,
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


if __name__ == "__main__":
    unittest.main()
