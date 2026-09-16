"""Regression tests for the schema-drift bug that broke the Control Center.

`create_all()` only creates missing tables; it never adds a column to a table
that already exists. The deployed `data/app.db` had `control_settings` created
before `water_used_date` was declared, so every
`GET /api/v1/control/status/{plant_id}` answered 500 with

    OperationalError: no such column: control_settings.water_used_date

while the monitoring dashboard (whose tables were older and unchanged) kept
working — the exact "المراقبة تعمل، لكن بيانات التحكم غير متاحة" symptom.

These tests build a genuinely old `control_settings` table, then assert that
the startup sync repairs it and that a real control snapshot can be produced.
"""

from __future__ import annotations

import pytest
from sqlalchemy import create_engine, inspect, text

import app.models  # noqa: F401  (registers the tables on Base.metadata)
from app.database import Base
from app.models import Device, Plant, Reading, User
from app.services import control_engine as engine
from app.services.schema_sync import report_drift, sync_schema

# The columns `control_settings` had before water_used_date was declared.
_LEGACY_CONTROL_SETTINGS = """
CREATE TABLE control_settings (
    id INTEGER PRIMARY KEY,
    plant_id INTEGER NOT NULL,
    mode VARCHAR(20) NOT NULL,
    emergency_stop BOOLEAN NOT NULL,
    emergency_stop_reason VARCHAR(255),
    targets JSON,
    actuators JSON,
    water_tank_pct FLOAT,
    water_tank_capacity_l FLOAT,
    water_used_today_l FLOAT NOT NULL,
    updated_at DATETIME
)
"""


@pytest.fixture()
def legacy_engine(tmp_path):
    """A database whose control_settings table predates the current models."""
    url = f"sqlite:///{tmp_path / 'legacy.db'}"
    engine_ = create_engine(url, connect_args={"check_same_thread": False})
    with engine_.begin() as connection:
        connection.execute(text(_LEGACY_CONTROL_SETTINGS))
    yield engine_
    engine_.dispose()


def test_drift_is_detected_before_sync(legacy_engine):
    assert "control_settings.water_used_date" in report_drift(legacy_engine)


def test_sync_adds_the_missing_column(legacy_engine):
    added = sync_schema(legacy_engine)

    assert "control_settings.water_used_date" in added
    columns = {c["name"] for c in inspect(legacy_engine).get_columns("control_settings")}
    assert "water_used_date" in columns
    assert "control_settings.water_used_date" not in report_drift(legacy_engine)


def test_sync_is_idempotent(legacy_engine):
    sync_schema(legacy_engine)
    Base.metadata.create_all(bind=legacy_engine)  # the not-yet-created tables
    assert report_drift(legacy_engine) == []

    # A second startup must be a no-op: no repeated DDL, no errors.
    assert sync_schema(legacy_engine) == []
    assert report_drift(legacy_engine) == []


def test_sync_never_drops_or_retypes_existing_columns(legacy_engine):
    with legacy_engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO control_settings (plant_id, mode, emergency_stop, "
                "water_used_today_l) VALUES (1, 'auto', 0, 3.5)"
            )
        )

    sync_schema(legacy_engine)

    with legacy_engine.begin() as connection:
        row = connection.execute(
            text("SELECT mode, emergency_stop, water_used_today_l FROM control_settings")
        ).one()
    assert (row.mode, row.water_used_today_l) == ("auto", 3.5)


def test_snapshot_works_on_a_migrated_legacy_database(legacy_engine):
    """The end-to-end symptom: the snapshot must survive the old schema."""
    sync_schema(legacy_engine)
    Base.metadata.create_all(bind=legacy_engine)  # the remaining (new) tables

    import time

    from sqlalchemy.orm import sessionmaker

    db = sessionmaker(bind=legacy_engine)()
    try:
        user = User(email="migrated@rayy.test", password_hash="x")
        db.add(user)
        db.commit()
        db.refresh(user)

        device = Device(user_id=user.id, name="RAYY-MIGRATED-001", is_claimed=True)
        db.add(device)
        db.commit()
        db.refresh(device)

        plant = Plant(
            user_id=user.id, species="Tomato", nickname="Tomato Demo", device_id=device.id
        )
        db.add(plant)
        db.commit()
        db.refresh(plant)

        db.add(
            Reading(
                device_id=device.id,
                plant_id=plant.id,
                pot_index=0,
                ts=int(time.time()),
                temperature=25.0,
                humidity=60.0,
                light=950.0,
                soil_moisture=52.0,
                ph=6.5,
            )
        )
        db.commit()

        reading = (
            db.query(Reading)
            .filter(Reading.plant_id == plant.id)
            .order_by(Reading.ts.desc())
            .first()
        )

        snapshot = engine.build_snapshot(db, plant, reading)

        assert snapshot["plant"]["nickname"] == "Tomato Demo"
        assert snapshot["mode"] == "auto"
        # Settings row was created on the migrated table, so the new column is
        # genuinely usable (this is what raised OperationalError before).
        assert snapshot["tank"]["used_today_l"] == 0.0
        assert len(snapshot["systems"]) == 5
    finally:
        db.close()
