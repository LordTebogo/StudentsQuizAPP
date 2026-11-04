"""The optional smoke check must not embed credentials or upload on import."""
import ast
import importlib
from pathlib import Path
import unittest
from unittest.mock import patch


class CloudinaryCredentialsTest(unittest.TestCase):
    def test_import_does_not_upload(self):
        with patch("cloudinary.uploader.upload") as upload:
            importlib.import_module("cloudinary_test")
            upload.assert_not_called()

    def test_source_has_no_literal_cloudinary_credentials(self):
        for filename in ("cloudinary_test.py", "cloudinary_utils.py"):
            source = ast.parse(Path(filename).read_text(encoding="utf-8"))
            for node in ast.walk(source):
                if isinstance(node, ast.Call):
                    for argument in node.keywords:
                        if argument.arg in {"api_key", "api_secret"}:
                            self.assertNotIsInstance(argument.value, ast.Constant, filename)

    def test_public_environment_template_contains_no_session_keys(self):
        for line in Path(".env.example").read_text(encoding="utf-8").splitlines():
            if "SESSION_SECRET=" in line and not line.startswith("#"):
                self.assertEqual(line.split("=", 1)[1], "")


if __name__ == "__main__":
    unittest.main()
