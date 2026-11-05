"""Ozow One API request and independent transaction verification."""
import os
import unittest
from unittest.mock import patch

import ozow_checkout as ozow

REFERENCE = "AR" + "A" * 32
PAYMENT_ID = "497f6eca-6276-4993-bfeb-53cbbbba6f08"


class OzowCheckoutTest(unittest.TestCase):
    def setUp(self):
        self.enterContext(patch.dict(os.environ, {"OZOW_ENABLED": "true", "OZOW_ENV": "production",
            "OZOW_CLIENT_ID": "client", "OZOW_CLIENT_SECRET": "private",
            "OZOW_SITE_CODE": "ABC-DEF-GHI"}))

    def test_enablement_requires_all_production_credentials(self):
        self.assertTrue(ozow.configured())
        for key, value in [("OZOW_ENABLED", "false"), ("OZOW_ENV", "staging"),
                           ("OZOW_CLIENT_ID", ""), ("OZOW_CLIENT_SECRET", ""),
                           ("OZOW_SITE_CODE", "wrong")]:
            with self.subTest(key=key), patch.dict(os.environ, {key: value}):
                self.assertFalse(ozow.configured())

    def test_start_uses_one_api_and_validates_redirect(self):
        calls = []
        def request(path, payload=None, token=None, form=False):
            calls.append((path, payload, token, form))
            if path == "/token":
                return {"access_token": "access"}
            return {"id": PAYMENT_ID, "status": "Created",
                    "redirectUrl": "https://pay.ozow.com/secure"}
        with patch.object(ozow, "_json_request", side_effect=request):
            self.assertEqual(ozow.start(REFERENCE, 1500, "https://arounus.test/return"),
                             (PAYMENT_ID, "https://pay.ozow.com/secure"))
        self.assertEqual(calls[0][0:2], ("/token", {"client_id": "client", "client_secret": "private",
            "scope": "payments", "grant_type": "client_credentials"}))
        self.assertEqual(calls[1][0], "/payments")
        self.assertEqual(calls[1][1]["amount"], {"currency": "ZAR", "value": 15.0})
        self.assertEqual(calls[1][1]["merchantReference"], REFERENCE)
        self.assertEqual(calls[1][2], "access")
        with patch.object(ozow, "_json_request", side_effect=lambda path, *a, **k:
                {"access_token": "access"} if path == "/token" else
                {"id": PAYMENT_ID, "status": "Created", "redirectUrl": "https://evil.test/pay"}):
            with self.assertRaises(ozow.OzowError):
                ozow.start(REFERENCE, 1500, "https://arounus.test/return")

    def test_only_matching_site_reference_amount_and_currency_are_paid(self):
        row = {"merchantReference": REFERENCE, "siteCode": "ABC-DEF-GHI",
               "amount": {"currency": "ZAR", "value": 15.0}, "status": "Successful"}
        with patch.object(ozow, "_token", return_value="access"), patch.object(
                ozow, "_json_request", return_value={"results": [row]}) as request:
            self.assertEqual(ozow.verify(PAYMENT_ID, REFERENCE, 1500, "2026-11-05T00:00:00+00:00"), "paid")
            self.assertIn("fromDate=2026-11-05", request.call_args.args[0])
        for field, value in [("merchantReference", "OTHER"), ("siteCode", "OTHER"),
                             ("amount", {"currency": "ZAR", "value": 1.0}),
                             ("amount", {"currency": "USD", "value": 15.0})]:
            with self.subTest(field=field), patch.object(ozow, "_token", return_value="access"), patch.object(
                    ozow, "_json_request", return_value={"results": [{**row, field: value}]}):
                self.assertEqual(ozow.verify(PAYMENT_ID, REFERENCE, 1500, "2026-11-05T00:00:00+00:00"), "pending")
        with patch.object(ozow, "_token", return_value="access"), patch.object(
                ozow, "_json_request", return_value={"results": [{**row, "status": "Error"}]}):
            self.assertEqual(ozow.verify(PAYMENT_ID, REFERENCE, 1500, "2026-11-05T00:00:00+00:00"), "failed")


if __name__ == "__main__":
    unittest.main()
