"""The About page uses a separate, gated Paystack checkout for donations."""
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


class SupportPaymentsTest(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(main.app)
        self.enterContext(patch.dict(os.environ, {"PAYSTACK_SECRET_KEY": "sk_live_unit_test_only",
            "PAYSTACK_ENABLED": "true", "PUBLIC_BASE_URL": "https://arounus.test"}))

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
        reference, email, cents, callback = start.call_args.args
        self.assertRegex(reference, r"^AS[A-F0-9]{32}$")
        self.assertEqual((email, cents, callback), ("donor@example.test", 7500,
            "https://arounus.test/billing/support/return"))

    def test_return_claims_success_only_after_live_paystack_verification(self):
        reference = "AS" + "A" * 32
        with patch.object(main, "paystack_verify", return_value={"reference": reference, "status": "success",
                "currency": "ZAR", "domain": "live"}):
            response = self.client.get("/billing/support/return?reference=" + reference, follow_redirects=False)
            self.assertEqual(response.headers["location"], "/about?support=success#supportArounus")
        with patch.object(main, "paystack_verify", return_value={"reference": reference, "status": "success",
                "currency": "ZAR", "domain": "test"}):
            response = self.client.get("/billing/support/return?reference=" + reference, follow_redirects=False)
            self.assertEqual(response.headers["location"], "/about?support=pending#supportArounus")


if __name__ == "__main__":
    unittest.main()
