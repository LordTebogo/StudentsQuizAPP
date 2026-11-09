"""Public openings and PIN-protected vacancy updates."""
import os
import tempfile
import unittest

from fastapi.testclient import TestClient

_database = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
_database.close()
os.environ["DATABASE_URL"] = "sqlite:///" + _database.name.replace("\\", "/")
os.environ["SMTP_HOST"] = ""
import main  # noqa: E402


class VacancyTest(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(main.app)
        self.pin = {"X-Lecturer-Pin": main.LECTURER_PIN}

    def test_seeded_openings_and_public_page(self):
        page = self.client.get("/vacancies")
        self.assertEqual(page.status_code, 200)
        self.assertIn("How earnings work", page.text)
        self.assertIn("/?account=register", page.text)
        openings = self.client.get("/vacancies/openings").json()
        self.assertIn("Room agents", [item["title"] for item in openings])
        self.assertIn("Growth marketing", [item["title"] for item in openings])

    def test_admin_can_add_edit_and_close_opening(self):
        self.assertNotEqual(self.client.get("/admin/vacancies").status_code, 200)
        payload = {"title": "Community outreach", "summary": "Build local connections.",
                   "details": "Help new users get started.", "is_open": True}
        self.assertNotEqual(self.client.post("/admin/vacancies", json=payload).status_code, 200)
        created = self.client.post("/admin/vacancies", json=payload, headers=self.pin)
        self.assertEqual(created.status_code, 200, created.text)
        vacancy_id = created.json()["id"]
        self.assertIn(vacancy_id, [item["id"] for item in self.client.get("/vacancies/openings").json()])
        payload.update(summary="Updated introduction.", is_open=False)
        edited = self.client.put(f"/admin/vacancies/{vacancy_id}", json=payload, headers=self.pin)
        self.assertEqual(edited.status_code, 200, edited.text)
        self.assertEqual(edited.json()["summary"], "Updated introduction.")
        self.assertNotIn(vacancy_id, [item["id"] for item in self.client.get("/vacancies/openings").json()])
        self.assertIn(vacancy_id, [item["id"] for item in self.client.get("/admin/vacancies", headers=self.pin).json()])


if __name__ == "__main__":
    unittest.main()
