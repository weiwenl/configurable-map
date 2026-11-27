import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from fastapi.testclient import TestClient

from app.main import create_app


class HealthTests(unittest.TestCase):
    def setUp(self):
        directory = TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.app = create_app(Path(directory.name) / "configurations.db")

    def test_health_response(self):
        with TestClient(self.app) as client:
            response = client.get("/api/health")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"status": "ok"})

    def test_documentation_uses_api_schema_url(self):
        with TestClient(self.app) as client:
            response = client.get("/api/docs")
        self.assertEqual(response.status_code, 200)
        self.assertIn("text/html", response.headers["content-type"])
        self.assertIn("/api/openapi.json", response.text)

    def test_openapi_documents_health(self):
        with TestClient(self.app) as client:
            response = client.get("/api/openapi.json")
        self.assertEqual(response.status_code, 200)
        self.assertIn("200", response.json()["paths"]["/api/health"]["get"]["responses"])
