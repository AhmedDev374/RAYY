"""End-to-end verification of the single-source-of-truth fixes.

Runs the real app with TestClient (real lifespan, real DB, real simulator) and
asserts, in order:

1. The tank is genuinely available in the simulation (not "غير متاح").
2. Every surface reads the SAME reading: the plant readings endpoint and the
   control snapshot used by the sensor strip / tank / charts.
3. A manual pump ON changes the visible actuator state and the tank begins to
   drain; a manual OFF stops it — all reflected in the next snapshot (no reload).

Run from the backend directory:
    ..\\.venv\\Scripts\\python.exe scripts/verify_consistency.py
"""
import time
import app.services.supabase_auth as supabase_auth_module  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402


def main() -> None:
    sub = f"verify-{int(time.time())}"
    supabase_auth_module.verify_supabase_token = lambda token: {
        "sub": sub,
        "email": f"{sub}@example.com",
    }
    headers = {"Authorization": "Bearer verify-token"}

    with TestClient(app) as client:
        start = client.post("/api/v1/simulation/start", headers=headers).json()
        plant_id = start["plant_id"]
        assert plant_id, "simulation must provision a plant"
        time.sleep(7)  # a couple of ticks

        # --- 1. Tank is available and known -------------------------------
        snap = client.get(f"/api/v1/control/status/{plant_id}", headers=headers).json()
        tank = snap["tank"]
        print("TANK:", tank["level_pct"], tank["source"], tank["status_label"])
        assert tank["known"] is True, "tank must be known during simulation"
        assert tank["level_pct"] is not None, "tank must have a percentage"
        assert "غير متاح" not in str(tank), "tank must not report unavailable"
        # The level sensor is declared supported so the UI shows a real value.
        water_row = next(r for r in snap["sensor_details"] if r["key"] == "water_level")
        print("WATER SENSOR:", water_row["value"], water_row["status_label"])
        assert water_row["online"] and water_row["value"] is not None

        # --- 2. Single source: snapshot reading == latest polled reading ---
        rows = client.get(
            f"/api/v1/plants/{plant_id}/readings?limit=5", headers=headers
        ).json()
        latest = max(rows, key=lambda r: (r["ts"], r["id"]))
        sr = snap["reading"]
        print(
            "SNAPSHOT reading: T=%s H=%s L=%s S=%s"
            % (sr["temperature"], sr["humidity"], sr["light"], sr["soil_moisture"])
        )
        print(
            "POLLED  reading: T=%s H=%s L=%s S=%s"
            % (
                latest["temperature"],
                latest["humidity"],
                latest["light"],
                latest["soil_moisture"],
            )
        )
        assert sr["temperature"] == latest["temperature"]
        assert sr["humidity"] == latest["humidity"]
        assert sr["light"] == latest["light"]
        assert sr["soil_moisture"] == latest["soil_moisture"]

        def pump(snapshot):
            for system in snapshot["systems"]:
                for act in system["actuators"]:
                    if act["key"] == "pump":
                        return act
            raise AssertionError("pump actuator missing")

        # --- 3. Manual ON: device state becomes active ---------------------
        before = pump(snap)
        print("PUMP before:", before["on"], before["state_label"])
        on = client.post(
            "/api/v1/control/manual",
            headers=headers,
            json={"plant_id": plant_id, "actuator": "pump", "action": "on", "duration_sec": 60},
        ).json()
        after = pump(on["snapshot"])
        print("PUMP after ON:", after["on"], after["state_label"], "| result:", on["event"]["result"])
        assert after["on"] is True, "manual ON must set the actuator on"
        # The device now *reports* ON (device_actuator_states), not just intent.
        reported = [s for s in on["snapshot"]["device_link"]["reported_states"] if s["actuator"] == "pump"]
        print("PUMP reported state:", reported)
        assert reported and reported[-1]["on"] is True

        # Tank drains while the pump runs.
        lvl_start = tank["level_pct"]
        time.sleep(7)
        snap2 = client.get(f"/api/v1/control/status/{plant_id}", headers=headers).json()
        lvl_after = snap2["tank"]["level_pct"]
        print("TANK level %s -> %s (draining)" % (lvl_start, lvl_after))
        assert lvl_after < lvl_start, "tank must drain while the pump runs"

        # --- 4. Manual OFF: device state becomes inactive ------------------
        off = client.post(
            "/api/v1/control/manual",
            headers=headers,
            json={"plant_id": plant_id, "actuator": "pump", "action": "off"},
        ).json()
        after_off = pump(off["snapshot"])
        print("PUMP after OFF:", after_off["on"], after_off["state_label"])
        assert after_off["on"] is False, "manual OFF must set the actuator off"
        reported_off = [
            s for s in off["snapshot"]["device_link"]["reported_states"] if s["actuator"] == "pump"
        ]
        assert reported_off and reported_off[-1]["on"] is False

        # --- 5. Fan ON/OFF is visible too ----------------------------------
        fan_on = client.post(
            "/api/v1/control/manual",
            headers=headers,
            json={"plant_id": plant_id, "actuator": "fan", "action": "on"},
        ).json()
        fan = next(
            a
            for s in fan_on["snapshot"]["systems"]
            for a in s["actuators"]
            if a["key"] == "fan"
        )
        print("FAN after ON:", fan["on"], fan["state_label"])
        assert fan["on"] is True

        client.post("/api/v1/simulation/stop", headers=headers)

    print("\nCONSISTENCY OK - single source of truth, tank, and manual controls verified")


if __name__ == "__main__":
    main()
