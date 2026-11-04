"""Regression checks for PIN fallback, role confusion and key rotation."""
import hashlib
import secrets
import unittest
from session_security import load_session_secrets, production_environment, issue_token, verify_token


class SessionSecurityTest(unittest.TestCase):
    def setUp(self):
        self.secret = secrets.token_urlsafe(48)

    def test_production_never_generates_fallback_keys(self):
        for marker in ({"RENDER": "true"}, {"AROUNUS_ENV": "production"},
                       {"DATABASE_URL": "postgresql://unused"}):
            with self.subTest(marker=marker), self.assertRaisesRegex(RuntimeError, "LECTURER_SESSION_SECRET"):
                load_session_secrets(marker)
        with self.assertRaisesRegex(RuntimeError, "STUDENT_SESSION_SECRET"):
            load_session_secrets({"AROUNUS_ENV": "production", "LECTURER_SESSION_SECRET": self.secret})

    def test_unsafe_or_published_values_are_rejected(self):
        for value in ("90435", "", "a" * 48, "1234567890" * 5, "replace-me-with-a-new-secret-value"):
            with self.subTest(value=value), self.assertRaises(RuntimeError):
                load_session_secrets({"AROUNUS_ENV": "production", "LECTURER_SESSION_SECRET": value})
        with self.assertRaises(RuntimeError):
            load_session_secrets({"LECTURER_SESSION_SECRET": self.secret},
                                 [hashlib.sha256(self.secret.encode()).hexdigest()])

    def test_local_keys_are_random_and_never_the_pin(self):
        first = load_session_secrets({"LECTURER_PIN": "90435"})
        second = load_session_secrets({"LECTURER_PIN": "90435"})
        self.assertNotEqual(first["lecturer"], first["student"])
        self.assertNotEqual(first["student"], second["student"])
        self.assertTrue(all(len(key) >= 32 for key in first.values()))

    def test_roles_cannot_be_swapped_even_with_same_key_and_id(self):
        for role in ("lecturer", "student", "src", "landlord"):
            token = issue_token(role, 22, self.secret, now=100)
            self.assertEqual(verify_token(token, role, self.secret, now=101), 22)
            for other in ("lecturer", "student", "src", "landlord"):
                if other != role:
                    with self.assertRaises(ValueError):
                        verify_token(token, other, self.secret, now=101)

    def test_expired_tampered_pin_signed_and_old_key_tokens_are_rejected(self):
        token = issue_token("student", 22, self.secret, now=100)
        invalid = [token + "x", token.replace(".", "!."), "..", "x.y", "x" * 2000,
                   issue_token("student", 22, "90435", now=100), None]
        for value in invalid:
            with self.subTest(value=str(value)[:20]), self.assertRaises(ValueError):
                verify_token(value, "student", self.secret, now=101)
        with self.assertRaises(ValueError):
            verify_token(token, "student", self.secret, now=43300)
        with self.assertRaises(ValueError):
            verify_token(token, "student", secrets.token_urlsafe(48), now=101)


if __name__ == "__main__":
    unittest.main()
