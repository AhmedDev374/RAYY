"""In-process end-to-end check of Simulation Mode against a real SQLite DB.

Starts the ASGI app with TestClient (real lifespan, real DB writes, real
background generator task) and inspects the database directly. Run from the
backend directory:

    ..\\.venv\\Scripts\\python.exe scripts/sim_smoke.py
"""
import time
import app.services.supabase_auth as supabase_auth_module  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.database import SessionLocal  # noqa: E402
from app.main import app  # noqa: E402
from app.models import Device, Plant, Reading  # noqa: E402
from app.services.simulation_service import SIM_DEVICE_NAME, SIM_NICKNAME  # noqa: E402


def _db_counts():
    db = SessionLocal()
    try:
        return (
            db.query(Reading).count(),
            db.query(Plant).filter(Plant.nickname == SIM_NICKNAME).count(),
            db.query(Device).filter(Device.name == SIM_DEVICE_NAME).count(),
        )
    finally:
        db.close()


def main() -> None:
    # Test env authenticates via the Supabase path (the app default); patch the
    # JWKS verifier so no network call is made.
    sub = f"smoke-{int(time.time())}"
    supabase_auth_module.verify_supabase_token = lambda token: {
        "sub": sub,
        "email": f"{sub}@example.com",
    }
    headers = {"Authorization": "Bearer smoke-token"}

    with TestClient(app) as client:
        status = client.get("/api/v1/simulation/status", headers=headers).json()
        print("1) default status:", status["running"], "(expect False)")
        assert status["running"] is False

        r1 = client.post("/api/v1/simulation/start", headers=headers).json()
        print(
            "2) start #1: running=%s device=%s plant=%s/%s id=%s"
            % (r1["running"], r1["device_name"], r1["nickname"], r1["species"], r1["plant_id"])
        )
        assert r1["running"] and r1["device_name"] == SIM_DEVICE_NAME

        time.sleep(7)  # ~2 ticks at 3s
        r2 = client.post("/api/v1/simulation/start", headers=headers).json()
        print(
            "3) start #2 (idempotent): same device_id=%s same plant_id=%s"
            % (r2["device_id"] == r1["device_id"], r2["plant_id"] == r1["plant_id"])
        )
        assert r2["device_id"] == r1["device_id"] and r2["plant_id"] == r1["plant_id"]

        rows = client.get(
            f"/api/v1/plants/{r1['plant_id']}/readings?limit=50", headers=headers
        ).json()
        print("4) readings via normal endpoint: %d" % len(rows))
        for row in sorted(rows, key=lambda x: x["ts"])[:4]:
            print(
                "     ts=%s T=%.1f H=%.1f L=%.0f S=%.1f pH=%.1f"
                % (
                    row["ts"],
                    row["temperature"],
                    row["humidity"],
                    row["light"],
                    row["soil_moisture"],
                    row["ph"],
                )
            )
        assert len(rows) >= 2

        before_readings, plants, devices = _db_counts()
        print(
            "5) DB: readings=%d tomato_demo_plants=%d sim_devices=%d"
            % (before_readings, plants, devices)
        )
        assert devices == 1 and plants == 1, "no duplicate device/plant rows"

        client.post("/api/v1/simulation/stop", headers=headers)
        time.sleep(8)  # > 2 ticks; nothing new should arrive
        rows_after = client.get(
            f"/api/v1/plants/{r1['plant_id']}/readings?limit=200", headers=headers
        ).json()
        db_after, _, _ = _db_counts()
        print(
            "6) OFF: endpoint=%d (was %d), db=%d (was %d)"
            % (len(rows_after), len(rows), db_after, before_readings)
        )
        assert len(rows_after) == len(rows), "OFF must not generate new readings"
        assert db_after == before_readings, "DB must not grow while OFF"
        assert len(rows_after) > 0, "history preserved"

    print("\nSMOKE OK - all simulation behaviours verified")


if __name__ == "__main__":
    main()
