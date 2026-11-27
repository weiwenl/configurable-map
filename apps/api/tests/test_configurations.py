from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
import json
from pathlib import Path
import sqlite3
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from app.defaults import DEFAULT_CONFIGURATION_ID, SYSTEM_OWNER_ID
from app.demo_configurations import DEMO_SHARED_CONFIGURATIONS, DEMO_SHARE_OWNER_ID
from app.main import create_app, DEMO_OWNER_ID
from app.models import CreateConfiguration
from app.repository import ConfigurationRepository, DuplicateNameError


def draft(name="My trees"):
    return {"name": name, "configuration": {
        "symbolConfig": {
            "color": {"field": "Leaf_Area", "stops": [
                {"value": 10, "color": "#ffffff"}, {"value": 40000, "color": "#00fd00"},
            ]},
            "size": {"field": "Leaf_Bmass", "stops": [
                {"value": 0, "size": 40}, {"value": 700, "size": 5},
            ]},
        },
        "tableConfig": {"columns": ["Cmn_Name", "Leaf_Bmass", "Tree_ID"]},
    }}


class ConfigurationTests(unittest.TestCase):
    def test_demo_shared_seeds_are_accessible_and_preserved_on_restart(self):
        repository = ConfigurationRepository(self.database_path)
        with closing(repository.connect()) as connection:
            rows = [dict(row) for row in connection.execute(
                "SELECT * FROM configurations WHERE owner_id = ? ORDER BY id", (DEMO_SHARE_OWNER_ID,),
            )]
        self.assertEqual(len(rows), 2)
        expected = {configuration_id: draft for configuration_id, _, draft in DEMO_SHARED_CONFIGURATIONS}
        expected_tokens = {
            "b69f75a7-73f6-4ee6-b774-545c0a21d4bb": "RfYTCzDAO0YBTDuFBjuG7rUmpzMaSWY3hHlaAQbtx4c",
            "21383eb7-2f20-4e65-a67f-e99b87a683fe": "YRJH15Pu9ye3ik4q736OzqziDVa6GKLMfxfH13rePR4",
        }
        self.assertEqual({row["id"]: row["share_token"] for row in rows}, expected_tokens)
        with TestClient(create_app(self.database_path.with_name("independent.db"))) as independent:
            for configuration_id, token in expected_tokens.items():
                response = independent.get(f"/api/configurations/shared/{token}")
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.json()["id"], configuration_id)
                self.assertEqual(response.json()["configuration"], expected[configuration_id].configuration.model_dump())
        self.assertEqual(len({row["share_token"] for row in rows}), 2)
        for row in rows:
            self.assertRegex(row["share_token"], r"^[A-Za-z0-9_-]{43}$")
            self.assertTrue(row["created_at"])
            response = self.client.get(f"/api/configurations/shared/{row['share_token']}")
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()["configuration"], expected[row["id"]].configuration.model_dump())
            self.assertEqual(response.json()["name"], expected[row["id"]].name)
            self.assertEqual(self.client.post(f"/api/configurations/{row['id']}/share").status_code, 404)
        self.assertEqual(self.client.get("/api/configurations").json(), [])
        # Preserve existing records, including locally edited demo settings and links.
        with closing(repository.connect()) as connection, connection:
            connection.execute("UPDATE configurations SET name = ?, share_token = ? WHERE id = ?",
                               ("Edited demo", "existing-demo-link", rows[0]["id"]))
        rows[0]["name"] = "Edited demo"
        rows[0]["share_token"] = "existing-demo-link"
        repository.initialize()
        with closing(repository.connect()) as connection:
            self.assertEqual([dict(row) for row in connection.execute(
                "SELECT * FROM configurations WHERE owner_id = ? ORDER BY id", (DEMO_SHARE_OWNER_ID,),
            )], rows)
        self.assertEqual(self.client.get("/api/configurations/shared/existing-demo-link").json()["name"], "Edited demo")

    def test_normal_share_still_generates_a_secure_random_token(self):
        saved = self.client.post("/api/configurations", json=draft()).json()
        with patch("app.repository.secrets.token_urlsafe", return_value="generated-custom-token") as generate_token:
            response = self.client.post(f"/api/configurations/{saved['id']}/share")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"token": "generated-custom-token"})
        generate_token.assert_called_once_with(32)

    def setUp(self):
        directory = TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.database_path = Path(directory.name) / "configurations.db"
        self.app = create_app(self.database_path)
        self.client = TestClient(self.app)
        self.client.__enter__()
        self.addCleanup(self.client.__exit__, None, None, None)

    def test_predefined_default_returns_seeded_payload_outside_custom_list(self):
        response = self.client.get("/api/configurations/default")
        self.assertEqual(response.status_code, 200)
        saved = response.json()
        self.assertEqual(saved["visibility"], "private")
        self.assertTrue(saved["created_at"])
        self.assertEqual({key: saved[key] for key in ("id", "name", "configuration")}, {
            "id": "system-default",
            "name": "System default",
            "configuration": {
                "symbolConfig": {
                    "color": {"field": "Leaf_Area", "stops": [
                        {"value": 10, "color": "#ffffff"}, {"value": 40000, "color": "#00fd00"},
                    ]},
                    "size": {"field": "Leaf_Bmass", "stops": [
                        {"value": 0, "size": 5}, {"value": 700, "size": 40},
                    ]},
                },
                "tableConfig": {"columns": ["Leaf_Area", "Leaf_Bmass"]},
            },
        })
        repository = ConfigurationRepository(self.database_path)
        repository.initialize()
        self.assertEqual(repository.get(SYSTEM_OWNER_ID, DEFAULT_CONFIGURATION_ID), saved)
        with closing(repository.connect()) as connection:
            self.assertEqual(connection.execute("SELECT COUNT(*) FROM configurations").fetchone()[0], 3)
            self.assertEqual(connection.execute("SELECT COUNT(*) FROM user_defaults").fetchone()[0], 0)
        self.assertEqual(self.client.get("/api/configurations").json(), [])
        self.assertEqual(self.client.get("/api/configurations/system-default").status_code, 404)

    def test_restart_preserves_default_edits_and_same_name_custom(self):
        original = self.client.get("/api/configurations/default").json()
        response = self.client.post("/api/configurations", json=draft("System default"))
        self.assertEqual(response.status_code, 201)
        custom = response.json()
        self.assertNotEqual(custom["id"], original["id"])
        changed = draft("Edited system default")
        repository = ConfigurationRepository(self.database_path)
        with closing(repository.connect()) as connection, connection:
            connection.execute(
                "UPDATE configurations SET name = ?, settings_json = ? WHERE id = ?",
                (changed["name"], json.dumps(changed["configuration"]), DEFAULT_CONFIGURATION_ID),
            )
        for _ in range(2):
            with TestClient(create_app(self.database_path)) as restarted:
                self.assertEqual(restarted.get("/api/configurations/default").json(), {**original, **changed})
                self.assertEqual(restarted.get(f"/api/configurations/{custom['id']}").json(), custom)
                self.assertEqual(restarted.get("/api/configurations").json(), [
                    {key: custom[key] for key in ("id", "name", "visibility", "created_at")},
                ])
        with closing(repository.connect()) as connection:
            self.assertEqual(connection.execute("SELECT COUNT(*) FROM configurations").fetchone()[0], 4)

    def test_seed_id_collision_preserves_other_owner_record(self):
        repository = ConfigurationRepository(self.database_path)
        with closing(repository.connect()) as connection, connection:
            connection.execute("UPDATE configurations SET owner_id = ? WHERE id = ?",
                            (DEMO_OWNER_ID, DEFAULT_CONFIGURATION_ID))
        original = repository.get(DEMO_OWNER_ID, DEFAULT_CONFIGURATION_ID)
        with self.assertRaisesRegex(ValueError, "belongs to another owner"):
            repository.initialize()
        self.assertEqual(repository.get(DEMO_OWNER_ID, DEFAULT_CONFIGURATION_ID), original)

    def test_round_trip_preserves_order_inverse_sizes_and_survives_restart(self):
        self.assertEqual(self.client.get("/api/configurations").json(), [])
        response = self.client.post("/api/configurations", json=draft("  My trees  "))
        self.assertEqual(response.status_code, 201)
        saved = response.json()
        self.assertEqual(saved["name"], "My trees")
        self.assertEqual(saved["visibility"], "private")
        self.assertEqual(saved["configuration"], draft()["configuration"])
        with TestClient(create_app(self.database_path)) as restarted:
            reopened = restarted.get(f"/api/configurations/{saved['id']}")
            self.assertEqual(reopened.status_code, 200)
            self.assertEqual(reopened.json(), saved)
            summaries = restarted.get("/api/configurations").json()
            self.assertEqual(summaries, [{key: saved[key] for key in ("id", "name", "visibility", "created_at")}])

    def test_duplicate_trimmed_casefolded_names_return_conflict_without_overwrite(self):
        first = self.client.post("/api/configurations", json=draft("Straße")).json()
        response = self.client.post("/api/configurations", json=draft("  STRASSE  "))
        self.assertEqual(response.status_code, 409)
        self.assertIn("already exists", response.json()["detail"])
        self.assertEqual(len(self.client.get("/api/configurations").json()), 1)
        self.assertEqual(self.client.get(f"/api/configurations/{first['id']}").json(), first)

    def test_server_owns_identity_and_other_owner_records_are_not_exposed(self):
        repository = ConfigurationRepository(self.database_path)
        foreign = repository.create("another-owner", CreateConfiguration.model_validate(draft()))
        self.assertEqual(self.client.get(f"/api/configurations/{foreign['id']}").status_code, 404)
        self.assertEqual(self.client.get("/api/configurations/missing").status_code, 404)
        self.assertEqual(self.client.get("/api/configurations?owner_id=another-owner").json(), [])
        request = draft()
        request["owner_id"] = "another-owner"
        self.assertEqual(self.client.post("/api/configurations", json=request).status_code, 422)
        self.assertEqual(self.client.post("/api/configurations", json=draft()).status_code, 201)

    def test_invalid_settings_are_rejected_without_any_writes(self):
        requests = []
        for name in (" ", "x" * 101, 42):
            requests.append(draft(name))
        for columns in ([], ["Tree_ID", "Tree_ID"], ["unknown"], [123], ["tree_id"]):
            request = draft()
            request["configuration"]["tableConfig"]["columns"] = columns
            requests.append(request)
        for size in (0, 101, True, "5", float("inf"), float("nan")):
            request = draft()
            request["configuration"]["symbolConfig"]["size"]["stops"][0]["size"] = size
            requests.append(request)
        for field, replacement in (("field", "Height"), ("stops", [])):
            request = draft()
            request["configuration"]["symbolConfig"]["color"][field] = replacement
            requests.append(request)
        request = draft()
        request["configuration"]["symbolConfig"]["color"]["stops"][0]["color"] = "red"
        requests.append(request)
        request = draft()
        request["configuration"]["symbolConfig"]["size"]["stops"][0]["value"] = False
        requests.append(request)
        request = draft()
        request["configuration"]["symbolConfig"]["color"]["stops"].reverse()
        requests.append(request)
        request = draft()
        request["configuration"]["extra"] = "not supported"
        requests.append(request)
        for request in requests:
            with self.subTest(request=request):
                response = self.client.post("/api/configurations", content=json.dumps(request),
                                            headers={"Content-Type": "application/json"})
                self.assertEqual(response.status_code, 422)
                self.assertIsInstance(response.json()["detail"], list)
        self.assertEqual(self.client.get("/api/configurations").json(), [])

    def test_database_prevents_simultaneous_duplicate_names_per_owner(self):
        repository = ConfigurationRepository(self.database_path)

        def save(name):
            try:
                repository.create(DEMO_OWNER_ID, CreateConfiguration.model_validate(draft(name)))
                return "saved"
            except DuplicateNameError:
                return "duplicate"

        with ThreadPoolExecutor(max_workers=2) as workers:
            self.assertCountEqual(list(workers.map(save, ["My trees", "MY TREES"])), ["saved", "duplicate"])
        self.assertEqual(len(repository.list(DEMO_OWNER_ID)), 1)

    def test_user_default_foreign_key_is_enabled(self):
        repository = ConfigurationRepository(self.database_path)
        connection = repository.connect()
        self.addCleanup(connection.close)
        with self.assertRaises(sqlite3.IntegrityError):
            connection.execute("INSERT INTO user_defaults VALUES (?, ?)", (DEMO_OWNER_ID, "missing"))

    def test_publish_returns_stable_token_and_preserves_saved_settings_after_restart(self):
        saved = self.client.post("/api/configurations", json=draft()).json()
        url = f"/api/configurations/{saved['id']}/share"
        response = self.client.post(url)
        self.assertEqual(response.status_code, 200)
        token = response.json()["token"]
        self.assertEqual(set(response.json()), {"token"})
        self.assertRegex(token, r"^[A-Za-z0-9_-]{43}$")
        self.assertEqual(self.client.post(url).json(), {"token": token})
        expected = {**saved, "visibility": "unlisted"}
        self.assertEqual(self.client.get(f"/api/configurations/shared/{token}").json(), expected)
        self.assertEqual(self.client.get(f"/api/configurations/{saved['id']}").json(), expected)
        summary = self.client.get("/api/configurations").json()[0]
        self.assertEqual(summary, {key: expected[key] for key in ("id", "name", "visibility", "created_at")})
        with TestClient(create_app(self.database_path)) as restarted:
            self.assertEqual(restarted.post(url).json(), {"token": token})
            self.assertEqual(restarted.get(f"/api/configurations/shared/{token}").json(), expected)

    def test_private_and_unknown_tokens_are_not_readable(self):
        saved = self.client.post("/api/configurations", json=draft()).json()
        repository = ConfigurationRepository(self.database_path)
        with closing(repository.connect()) as connection, connection:
            connection.execute("UPDATE configurations SET share_token = ? WHERE id = ?", ("inactive-token", saved["id"]))
        for token in ("unknown-token", "inactive-token", saved["id"]):
            self.assertEqual(self.client.get(f"/api/configurations/shared/{token}").status_code, 404)

    def test_shared_foreign_record_is_readable_but_cannot_be_published_by_demo_owner(self):
        repository = ConfigurationRepository(self.database_path)
        foreign = repository.create("another-owner", CreateConfiguration.model_validate(draft()))
        for configuration_id in (foreign["id"], "missing", DEFAULT_CONFIGURATION_ID):
            response = self.client.post(f"/api/configurations/{configuration_id}/share")
            self.assertEqual(response.status_code, 404)
        self.assertEqual(repository.get("another-owner", foreign["id"]), foreign)
        token = repository.share("another-owner", foreign["id"])
        self.assertEqual(self.client.get(f"/api/configurations/shared/{token}").json(),
                        {**foreign, "visibility": "unlisted"})
        self.assertEqual(self.client.get("/api/configurations").json(), [])
        self.assertEqual(self.client.get(f"/api/configurations/{foreign['id']}").status_code, 404)
        self.assertEqual(self.client.get("/api/configurations/default").json()["visibility"], "private")

    def test_simultaneous_shares_return_the_same_token(self):
        saved = self.client.post("/api/configurations", json=draft()).json()

        def publish(_):
            return self.client.post(f"/api/configurations/{saved['id']}/share")

        with ThreadPoolExecutor(max_workers=4) as workers:
            responses = list(workers.map(publish, range(4)))
        self.assertEqual([response.status_code for response in responses], [200] * 4)
        tokens = {response.json()["token"] for response in responses}
        self.assertEqual(len(tokens), 1)
        self.assertEqual(self.client.get(f"/api/configurations/shared/{tokens.pop()}").json()["configuration"], saved["configuration"])
