from contextlib import closing
from datetime import datetime, timezone
import json
from pathlib import Path
import secrets
import sqlite3
from uuid import uuid4

from .defaults import DEFAULT_CONFIGURATION, DEFAULT_CONFIGURATION_ID, SYSTEM_OWNER_ID
from .demo_configurations import DEMO_SHARED_CONFIGURATIONS, DEMO_SHARE_OWNER_ID
from .models import CreateConfiguration


class DuplicateNameError(Exception):
    pass


class ConfigurationRepository:
    def __init__(self, database_path: Path):
        self.database_path = database_path

    def connect(self):
        connection = sqlite3.connect(self.database_path)
        connection.row_factory = sqlite3.Row
        connection.create_collation(
            "NAME_CASEFOLD",
            lambda first_name, second_name: (first_name.casefold() > second_name.casefold()) - (first_name.casefold() < second_name.casefold()),
        )
        connection.execute("PRAGMA foreign_keys = ON")
        return connection

    def initialize(self):
        self.database_path.parent.mkdir(parents=True, exist_ok=True)
        with closing(self.connect()) as connection, connection:
            connection.executescript("""
                CREATE TABLE IF NOT EXISTS configurations (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 100),
                    owner_id TEXT NOT NULL,
                    visibility TEXT NOT NULL DEFAULT 'private' CHECK(visibility IN ('private', 'unlisted')),
                    share_token TEXT UNIQUE,
                    settings_json TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    UNIQUE(owner_id, name COLLATE NAME_CASEFOLD)
                );
                CREATE TABLE IF NOT EXISTS user_defaults (
                    user_id TEXT PRIMARY KEY,
                    configuration_id TEXT NOT NULL REFERENCES configurations(id)
                );
            """)
            connection.execute(
                """INSERT INTO configurations (id, name, owner_id, settings_json, created_at)
                VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING""",
                (DEFAULT_CONFIGURATION_ID, DEFAULT_CONFIGURATION.name, SYSTEM_OWNER_ID,
                DEFAULT_CONFIGURATION.configuration.model_dump_json(), datetime.now(timezone.utc).isoformat()),
            )
            owner = connection.execute(
                "SELECT owner_id FROM configurations WHERE id = ?", (DEFAULT_CONFIGURATION_ID,),
            ).fetchone()
            if owner["owner_id"] != SYSTEM_OWNER_ID:
                raise ValueError("The predefined default ID belongs to another owner.")
            # Future: Move demo fixtures into explicit demo-account setup when login is added.
            for configuration_id, share_token, draft in DEMO_SHARED_CONFIGURATIONS:
                connection.execute(
                    """INSERT INTO configurations
                    (id, name, owner_id, visibility, share_token, settings_json, created_at)
                    VALUES (?, ?, ?, 'unlisted', ?, ?, ?) ON CONFLICT(id) DO NOTHING""",
                    (configuration_id, draft.name, DEMO_SHARE_OWNER_ID, share_token,
                    draft.configuration.model_dump_json(), datetime.now(timezone.utc).isoformat()),
                )

    def create(self, owner_id: str, draft: CreateConfiguration):
        record = {
            "id": str(uuid4()),
            "name": draft.name,
            "visibility": "private",
            "created_at": datetime.now(timezone.utc).isoformat(),
            "configuration": draft.configuration.model_dump(),
        }
        with closing(self.connect()) as connection, connection:
            try:
                connection.execute(
                    "INSERT INTO configurations (id, name, owner_id, settings_json, created_at) VALUES (?, ?, ?, ?, ?)",
                    (record["id"], record["name"], owner_id,
                    json.dumps(record["configuration"], allow_nan=False), record["created_at"]),
                )
            except sqlite3.IntegrityError as error:
                if error.sqlite_errorname == "SQLITE_CONSTRAINT_UNIQUE":
                    raise DuplicateNameError from error
                raise
        return record

    def list(self, owner_id: str):
        with closing(self.connect()) as connection:
            return [dict(row) for row in connection.execute(
                "SELECT id, name, visibility, created_at FROM configurations WHERE owner_id = ? ORDER BY created_at DESC, id",
                (owner_id,),
            )]

    def share(self, owner_id: str, configuration_id: str):
        with closing(self.connect()) as connection, connection:
            row = connection.execute(
                """UPDATE configurations
                SET visibility = 'unlisted', share_token = COALESCE(share_token, ?)
                WHERE id = ? AND owner_id = ? AND id != ?
                RETURNING share_token""",
                (secrets.token_urlsafe(32), configuration_id, owner_id, DEFAULT_CONFIGURATION_ID),
            ).fetchone()
        return row["share_token"] if row else None

    def get_shared(self, token: str):
        with closing(self.connect()) as connection:
            row = connection.execute(
                """SELECT id, name, visibility, created_at, settings_json FROM configurations
                WHERE share_token = ? AND visibility = 'unlisted'""",
                (token,),
            ).fetchone()
        if row is None:
            return None
        record = dict(row)
        record["configuration"] = json.loads(record.pop("settings_json"))
        return record

    def get(self, owner_id: str, configuration_id: str):
        with closing(self.connect()) as connection:
            row = connection.execute(
                "SELECT id, name, visibility, created_at, settings_json FROM configurations WHERE id = ? AND owner_id = ?",
                (configuration_id, owner_id),
            ).fetchone()
        if row is None:
            return None
        record = dict(row)
        record["configuration"] = json.loads(record.pop("settings_json"))
        return record
