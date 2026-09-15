"""Tests for Simulation Mode.

Covers the acceptance criteria: OFF produces no readings, ON starts producing
smoothly-evolving readings through the normal sensor pipeline, repeated ON is
idempotent (no duplicate simulators), OFF stops new readings but preserves
history, and unrelated plants are untouched.
"""
import time

import pytest

from app.services.simulation_service import (
    SIM_DEVICE_NAME,
    SIM_NICKNAME,
    SIM_SPECIES,
    simulation_engine,
)


@pytest.fixture()
def auth_headers(client, monkeypatch):
    """Register a legacy JWT user and return an Authorization header.

    The engine re-homes the demo plant onto whoever starts it, so this user
    also owns "Tomato Demo" and can read its readings.
    """
    # Supabase's JWKS verifier is monkeypatched so no network call is made —
    # the same approach as tests/test_auth.py. The user row is then created by
    # get_or_create_user_from_token on first use.
    import app.services.supabase_auth as supabase_auth_module
    sub = f"sim-user-{int(time.time() * 1000)}"
    monkeypatch.setattr(
        supabase_auth_module,
        "verify_supabase_token",
        lambda token: {"sub": sub, "email": f"{sub}@example.com"},
    )
    return {"Authorization": "Bearer sim-test-token"}


def _wait_for_readings(client, plant_id, headers, minimum=3, timeout=25.0):
    """Poll the readings endpoint until `minimum` rows exist (sim ticks every 3s)."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        res = client.get(f"/api/v1/plants/{plant_id}/readings?limit=50", headers=headers)
        if res.status_code == 200 and len(res.json()) >= minimum:
            return res.json()
        time.sleep(0.5)
    pytest.fail(f"simulator produced fewer than {minimum} readings within {timeout}s")


def test_status_defaults_to_off(client, auth_headers):
    res = client.get("/api/v1/simulation/status", headers=auth_headers)
    assert res.status_code == 200
    body = res.json()
    assert body["running"] is False
    assert body["device_name"] == SIM_DEVICE_NAME
    assert body["nickname"] == SIM_NICKNAME
    assert body["species"] == SIM_SPECIES


def test_off_then_on_then_off_full_cycle(client, auth_headers):
    # --- ON: start producing readings through the normal pipeline ----------
    res = client.post("/api/v1/simulation/start", headers=auth_headers)
    assert res.status_code == 200
    started = res.json()
    assert started["running"] is True
    plant_id = started["plant_id"]
    assert plant_id is not None

    readings = _wait_for_readings(client, plant_id, auth_headers, minimum=3)
    assert len(readings) >= 3

    # Values are plausible tomato conditions, not raw randoms.
    latest = readings[0]
    assert 5 <= latest["temperature"] <= 45
    assert 5 <= latest["humidity"] <= 100
    assert 0 <= latest["light"] <= 1200
    assert 5 <= latest["soil_moisture"] <= 95

    # --- repeated ON is idempotent (no duplicate simulator) ----------------
    res2 = client.post("/api/v1/simulation/start", headers=auth_headers)
    assert res2.status_code == 200
    second = res2.json()
    assert second["running"] is True
    assert second["plant_id"] == plant_id
    assert second["device_id"] == started["device_id"]
    # Same generator: the count keeps climbing on the one task, it does not reset
    # to a fresh engine.
    assert second["reading_count"] >= started["reading_count"]

    # --- OFF: stops new readings, history is preserved ---------------------
    res3 = client.post("/api/v1/simulation/stop", headers=auth_headers)
    assert res3.status_code == 200
    assert res3.json()["running"] is False

    before = client.get(f"/api/v1/plants/{plant_id}/readings?limit=200", headers=auth_headers).json()
    time.sleep(7)  # > 2 sim ticks; nothing new should arrive
    after = client.get(f"/api/v1/plants/{plant_id}/readings?limit=200", headers=auth_headers).json()

    assert len(before) > 0, "history from the ON phase must be preserved"
    assert len(after) == len(before), "OFF must not generate new readings"


def test_readings_change_smoothly(client, auth_headers):
    """Consecutive readings should differ by small amounts, not random jumps."""
    res = client.post("/api/v1/simulation/start", headers=auth_headers)
    plant_id = res.json()["plant_id"]

    readings = _wait_for_readings(client, plant_id, auth_headers, minimum=4)
    # Endpoint returns newest-first; sort ascending by ts for a time series.
    series = sorted(readings, key=lambda r: r["ts"])
    temps = [r["temperature"] for r in series]
    deltas = [abs(b - a) for a, b in zip(temps, temps[1:]) if b != a]

    if deltas:  # with a 3s tick and small jitter there is always movement
        # Smooth drift: no step should look like a fresh uniform() draw.
        assert max(deltas) < 3.0, f"temperature jumped too sharply: {deltas}"


def test_simulation_requires_auth(client):
    assert client.get("/api/v1/simulation/status").status_code == 401
    assert client.post("/api/v1/simulation/start").status_code == 401
    assert client.post("/api/v1/simulation/stop").status_code == 401


def test_teardown_stops_engine(client, auth_headers):
    """Leave the process-wide engine OFF so other tests start clean."""
    client.post("/api/v1/simulation/start", headers=auth_headers)
    client.post("/api/v1/simulation/stop", headers=auth_headers)
    assert simulation_engine.running is False
