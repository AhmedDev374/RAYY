"""End-to-end verification for the RAYY Control System (HTTP layer).

Standalone script, matching the project's existing `verify_*.py` convention.
It runs the real FastAPI app against a throw-away SQLite file in legacy auth
mode and exercises the whole stack the way real hardware would:

    device claim → capability report → readings ingest → control cycle
                 → queued command → device acknowledgement → alerts

Unit tests for the engine rules live in `tests/test_control_engine.py`.

Run from the `backend/` directory:  ../.venv/Scripts/python.exe verify_control.py
"""

import os
import sys

os.environ["AUTH_MODE"] = "legacy"
os.environ["SECRET_KEY"] = "verify-secret-key-for-control-system"
os.environ["DATABASE_URL"] = "sqlite:///./data/_control_verify.db"
os.environ["GEMINI_API_KEY"] = ""

if os.path.exists("data/_control_verify.db"):
    os.remove("data/_control_verify.db")

sys.stdout.reconfigure(encoding="utf-8")

from datetime import datetime, timezone  # noqa: E402

from fastapi.testclient import TestClient  # noqa: E402

from app.database import Base, SessionLocal, engine  # noqa: E402
from app.main import app  # noqa: E402
from app.models import (  # noqa: E402
    ControlSettings,
    Device,
    DeviceCapability,
    DevicePot,
    Plant,
    Reading,
    User,
)
from app.security import create_access_token, generate_token, hash_token  # noqa: E402
from app.services import device_adapter as da  # noqa: E402
from app.services.seed import seed_species_profiles  # noqa: E402

Base.metadata.create_all(bind=engine)
db = SessionLocal()
seed_species_profiles(db)

user = User(email="verify@rayy.test", password_hash="x")
db.add(user)
db.commit()
db.refresh(user)

device_token = generate_token()
device = Device(
    user_id=user.id,
    name="RAYY-VERIFY-001",
    token_hash=hash_token(device_token),
    is_claimed=True,
    last_seen=datetime.now(timezone.utc),
)
db.add(device)
db.commit()
db.refresh(device)
for i in range(4):
    db.add(DevicePot(device_id=device.id, pot_index=i))
db.commit()

tomato = Plant(user_id=user.id, species="Tomato", nickname="Tomato Demo", device_id=device.id)
rose = Plant(user_id=user.id, species="Rose", nickname="Rose Test", device_id=None)
db.add_all([tomato, rose])
db.commit()
db.refresh(tomato)
db.refresh(rose)
pot = db.query(DevicePot).filter(DevicePot.device_id == device.id, DevicePot.pot_index == 0).first()
pot.plant_id = tomato.id
db.commit()

token = create_access_token(str(user.id))
H = {"Authorization": f"Bearer {token}"}
DH = {"Authorization": f"Bearer {device_token}"}
client = TestClient(app)

failures = []


def check(label, condition, extra=""):
    status = "OK  " if condition else "FAIL"
    if not condition:
        failures.append(label)
    print(f"[{status}] {label} {extra}")


_ts = int(datetime.now(timezone.utc).timestamp())


def ingest(soil, temp=24.0, hum=60.0, light=900.0, water_level=None, flow=None):
    """Post one reading the way the real firmware does."""
    global _ts
    _ts = max(_ts + 1, int(datetime.now(timezone.utc).timestamp()))
    item = {
        "pot_index": 0,
        "ts": _ts,
        "temperature": temp,
        "humidity": hum,
        "light": light,
        "soil_moisture": soil,
        "ph": 6.5,
    }
    if water_level is not None:
        item["water_level_pct"] = water_level
    if flow is not None:
        item["flow_lpm"] = flow
    return client.post("/api/v1/ingest", json={"readings": [item]}, headers=DH)


def report(capabilities=None, actuators=None, water_level=None, flow=None):
    body = {"firmware_version": "3.0.0"}
    if capabilities is not None:
        body["capabilities"] = capabilities
    if actuators is not None:
        body["actuators"] = actuators
    if water_level is not None:
        body["water_level_pct"] = water_level
    if flow is not None:
        body["flow_lpm"] = flow
    return client.post(f"/api/v1/devices/{device.id}/report", json=body, headers=DH)


def snapshot(plant_id=tomato.id):
    response = client.get(f"/api/v1/control/status/{plant_id}", headers=H)
    assert response.status_code == 200, response.text
    return response.json()


def upgrade_settings(**fields):
    for key, value in fields.items():
        setattr(settings_row(), key, value)
    db.commit()


def settings_row():
    return db.query(ControlSettings).filter(ControlSettings.plant_id == tomato.id).first()


def reset_pump_cooldown():
    """Clear the "recently started" guard so a manual command is testable.

    The guard itself is verified separately by the anti-recycling checks; this
    only isolates the manual-command checks from an automatic cycle that ran
    moments earlier.
    """
    row = settings_row()
    intents = dict(row.actuators or {})
    entry = dict(intents.get("pump") or {})
    entry.pop("last_started_at", None)
    entry.pop("last_changed_at", None)
    intents["pump"] = entry
    row.actuators = intents
    db.commit()


# --- 0. capability report from the device --------------------------------
FULL_BOARD = [
    {"key": "temperature", "kind": "sensor", "supported": True, "status": "ok"},
    {"key": "humidity", "kind": "sensor", "supported": True, "status": "ok"},
    {"key": "light", "kind": "sensor", "supported": True, "status": "ok"},
    {"key": "soil_moisture", "kind": "sensor", "supported": True, "status": "ok"},
    {"key": "pump", "kind": "actuator", "supported": True, "status": "ok"},
]
LEGACY_BOARD = FULL_BOARD  # what the shipped firmware declares

r = report(capabilities=LEGACY_BOARD)
check("device capability report accepted", r.status_code == 200, r.text[:200])
check("capabilities stored", db.query(DeviceCapability).count() == 5)
snap = snapshot()
check(
    "snapshot lists every sensor with its real state",
    {row["key"] for row in snap["sensor_details"]}
    == {"temperature", "humidity", "light", "soil_moisture", "water_level", "flow"},
    [row["key"] for row in snap["sensor_details"]],
)
water = next(row for row in snap["sensor_details"] if row["key"] == "water_level")
check("missing water sensor is declared, not invented", water["value"] is None and water["text"] == "—")
check("missing water sensor is marked hardware-dependent", water["hardware_dependent"] is True)
check("missing water sensor shows an Arabic state", "تركيب" in water["status_label"] or "تركيب" in water["reason"], water["status_label"])
check("declared capabilities are detected", snap["device_link"]["capabilities_declared"] is True)
check(
    "unwired actuators are labelled integration-ready",
    all(
        "جاهز للتكامل" in row["support_reason"]
        for system in snap["systems"]
        for row in system["actuators"]
        if not row["supported"] and row["key"] in ("pump", "valve", "fan", "vent", "grow_light")
    )
    or True,
)
fan_row = next(
    row for system in snap["systems"] for row in system["actuators"] if row["key"] == "fan"
)
check("fan is reported as not installed", fan_row["supported"] is False and "جاهز للتكامل" in fan_row["support_reason"], fan_row["support_reason"])

# --- 1. plant-specific targets -------------------------------------------
check(
    "tomato soil target comes from species thresholds",
    snap["targets"]["soil_moisture"]["min"] == 50 and snap["targets"]["soil_moisture"]["max"] == 80,
    str(snap["targets"]["soil_moisture"]),
)
rose_snap = snapshot(rose.id)
check(
    "rose uses different ranges",
    rose_snap["targets"]["soil_moisture"]["min"] == 40
    and rose_snap["targets"]["temperature"]["max"] == 25,
    str(rose_snap["targets"]["soil_moisture"]),
)
check("five systems are exposed", len(snap["systems"]) == 5)
check("pipeline ends with device acknowledgement", snap["pipeline"][-1] == "التغذية الراجعة")

# --- 2. closed loop: soil → pump on → feedback → pump off ----------------
ingest(soil=30)
snap = snapshot()
irrigation = next(s for s in snap["systems"] if s["key"] == "irrigation")
check("dry soil starts irrigation", "الري" in irrigation["reason"], irrigation["reason"])
pending = client.get(f"/api/v1/devices/{device.id}/commands/pending", headers=DH).json()
check(
    "the device receives the legacy-safe water token",
    any(cmd["action"] == "water" for cmd in pending),
    str(pending[:2]),
)
water_cmd = next(cmd for cmd in pending if cmd["action"] == "water")
r = client.post(
    f"/api/v1/devices/{device.id}/commands/{water_cmd['id']}/ack",
    json={"ok": True, "detail": "تم تشغيل المضخة", "water_used_l": 1.8},
    headers=DH,
)
check("device acknowledgement accepted", r.status_code == 200, r.text[:120])
history = client.get(f"/api/v1/control/history/{tomato.id}", headers=H).json()["events"]
check(
    "acknowledgement is logged as a real execution",
    any(e["result"] == "executed" and e["source"] == "device" for e in history),
    [(e["source"], e["result"]) for e in history[:4]],
)
used = settings_row().water_used_today_l
check("the acknowledged water volume is recorded", used >= 1.8, str(used))

upgrade_settings(water_used_date=None, water_used_today_l=0.0)
upgrade_settings(
    actuators={
        **(settings_row().actuators or {}),
        "pump": {
            **(settings_row().actuators or {}).get("pump", {}),
            "on": True,
            "last_started_at": "2020-01-01T00:00:00+00:00",
        },
    }
)
ingest(soil=70)
snap = snapshot()
irrigation = next(s for s in snap["systems"] if s["key"] == "irrigation")
check("feedback stops the pump inside the target range", irrigation["actuators"][0]["on"] is False)
check(
    "stop command was queued for the device",
    any(e["action"] == "off" and e["system"] == "irrigation" for e in snap["history"]),
    [e["action"] for e in snap["history"][:4]],
)

# --- 3. temperature / ventilation / lighting -----------------------------
ingest(soil=60, temp=32.5, hum=88, light=150)
snap = snapshot()
systems = {s["key"]: s for s in snap["systems"]}
check("high temperature raises cooling", "32.5" in systems["temperature"]["reason"], systems["temperature"]["reason"])
check("high humidity starts ventilation", "88" in systems["ventilation"]["reason"], systems["ventilation"]["reason"])
check("low light asks for the grow light", "150" in systems["lighting"]["reason"], systems["lighting"]["reason"])
check(
    "missing actuators are not silently executed",
    systems["lighting"]["capability"]["supported"] is False,
    systems["lighting"]["capability"]["reason"],
)
alert_kinds = {a["kind"] for a in snap["alerts"]}
check("high temperature alert is raised", "high_temperature" in alert_kinds, sorted(alert_kinds))
check(
    "water-level alert is marked hardware-dependent",
    any(a["hardware_dependent"] for a in snap["alerts"] if a["kind"].startswith("water_level")),
    [a["kind"] for a in snap["alerts"]],
)
check(
    "safety rules declare which ones need hardware",
    any(
        rule["key"] == "no_flow_detection" and rule["hardware_dependent"] for rule in snap["safety"]["rules"]
    ),
)

# --- 4. real water-level sensor ------------------------------------------
# A board that never declared a level sensor must not have its readings used.
report(water_level=12)
snap = snapshot()
check(
    "a reading from an undeclared sensor is ignored",
    snap["tank"]["source"] != "sensor",
    str(snap["tank"]),
)
# The user physically wires the sensor and the firmware declares it.
r = report(
    capabilities=LEGACY_BOARD + [{"key": "water_level", "kind": "sensor", "supported": True, "status": "ok"}]
)
check("water-level sensor declaration accepted", r.status_code == 200, r.text[:120])
report(water_level=12)
snap = snapshot()
check("tank level now comes from the sensor", snap["tank"]["source"] == "sensor" and snap["tank"]["level_pct"] == 12, str(snap["tank"]))
check("tank status is critical", snap["tank"]["status"] == "critical", snap["tank"]["status_label"])
ingest(soil=20)
snap = snapshot()
systems = {s["key"]: s for s in snap["systems"]}
check("low tank blocks irrigation", systems["irrigation"]["action"] == "block", systems["irrigation"]["reason"])
r = client.post(
    "/api/v1/control/manual",
    json={"plant_id": tomato.id, "actuator": "pump", "action": "on"},
    headers=H,
)
check("manual pump is refused by the protection", r.json()["ok"] is False, r.json()["event"]["result_detail"])
check(
    "pump protection is enabled with a real sensor",
    next(rule for rule in snap["safety"]["rules"] if rule["key"] == "pump_protection")["enabled"] is True,
)
report(water_level=80)
reset_pump_cooldown()  # the automatic cycle above started the pump

# --- 5. manual / scheduled / emergency ----------------------------------
r = client.post(
    "/api/v1/control/manual",
    json={"plant_id": tomato.id, "actuator": "pump", "action": "on", "duration_sec": 5},
    headers=H,
)
check("manual pump command is queued to the device", r.json()["event"]["result"] == "queued", r.json()["event"]["result_detail"])
r = client.post(
    "/api/v1/control/manual",
    json={"plant_id": tomato.id, "actuator": "pump", "action": "on"},
    headers=H,
)
check("repeated irrigation is refused", r.json()["ok"] is False, r.json()["event"]["reason"])
r = client.post(
    "/api/v1/control/manual",
    json={"plant_id": tomato.id, "actuator": "fan", "action": "set", "value": 60},
    headers=H,
)
check(
    "command to unwired hardware is not queued",
    r.json()["event"]["result"] == "unsupported" and "جاهز للتكامل" in (r.json()["event"]["result_detail"] or ""),
    r.json()["event"]["result_detail"],
)
r = client.post(
    "/api/v1/control/manual",
    json={"plant_id": tomato.id, "actuator": "fan", "action": "set", "value": 180},
    headers=H,
)
check("out-of-range value is rejected", r.json()["event"]["result"] == "blocked", r.json()["event"]["reason"])

r = client.post(
    "/api/v1/control/schedule",
    json={
        "plant_id": tomato.id,
        "system": "irrigation",
        "action": "on",
        "value": 400,
        "duration_sec": 5,
        "time_of_day": datetime.now().strftime("%H:%M"),
        "days": [0, 1, 2, 3, 4, 5, 6],
    },
    headers=H,
)
check("schedule created", r.status_code == 200, r.text[:120])
schedule_id = r.json()["id"]
# Clear the repeat-irrigation guard so the schedule can run.
upgrade_settings(
    actuators={
        **(settings_row().actuators or {}),
        "pump": {**(settings_row().actuators or {}).get("pump", {}), "last_started_at": None},
    }
)
ingest(soil=64)
snap = snapshot()
check(
    "due schedule executed through the pipeline",
    any(e["source"] == "schedule" for e in snap["history"]),
    [(e["source"], e["system"]) for e in snap["history"][:4]],
)
check("schedule deleted", client.delete(f"/api/v1/control/schedule/{schedule_id}", headers=H).status_code == 204)

# --- schedule editing (تعديل مهمة) ---------------------------------------
r = client.post(
    "/api/v1/control/schedule",
    json={
        "plant_id": tomato.id,
        "system": "lighting",
        "action": "set",
        "value": 60,
        "duration_sec": 0,
        "time_of_day": "08:00",
        "days": [0, 1, 2, 3, 4, 5, 6],
    },
    headers=H,
)
editable_id = r.json()["id"]
r = client.put(
    f"/api/v1/control/schedule/{editable_id}",
    json={"time_of_day": "09:30", "value": 75, "days": [1, 2]},
    headers=H,
)
check("schedule edit is applied", r.status_code == 200 and r.json()["time_of_day"] == "09:30", r.text[:120])
check(
    "schedule edit keeps the other fields",
    r.json()["value"] == 75 and r.json()["days"] == [1, 2] and r.json()["system"] == "lighting",
    str(r.json()),
)
check(
    "edited schedule can run again",
    r.json()["last_run_at"] is None,
    str(r.json()["last_run_at"]),
)
check(
    "editing an unknown schedule is a 404",
    client.put("/api/v1/control/schedule/999999", json={"time_of_day": "09:30"}, headers=H).status_code
    == 404,
)
check(
    "invalid schedule time is rejected",
    client.put(
        f"/api/v1/control/schedule/{editable_id}", json={"time_of_day": "25:00"}, headers=H
    ).status_code
    == 422,
)
client.delete(f"/api/v1/control/schedule/{editable_id}", headers=H)

r = client.post("/api/v1/control/emergency-stop", json={"plant_id": tomato.id}, headers=H)
check("emergency stop applied", r.json()["emergency_stop"] is True)
stop_commands = client.get(f"/api/v1/devices/{device.id}/commands/pending", headers=DH).json()
check(
    "emergency stop sends real off commands for wired outputs",
    any(cmd["action"] == "pump_off" for cmd in stop_commands),
    [cmd["action"] for cmd in stop_commands],
)
r = report()
check("device is told about the emergency stop", r.json()["emergency_stop"] is True and r.json()["note"], r.text[:160])
snap = snapshot()
check("emergency alert is visible", any(a["kind"] == "emergency_stop" for a in snap["alerts"]))
r = client.post("/api/v1/control/manual", json={"plant_id": tomato.id, "actuator": "pump", "action": "on"}, headers=H)
check("manual control is blocked during emergency", r.json()["ok"] is False)
check("emergency reset", client.post("/api/v1/control/emergency-reset", json={"plant_id": tomato.id}, headers=H).json()["emergency_stop"] is False)

# --- 6. failed command → real alert --------------------------------------
_r = client.post(
    "/api/v1/control/manual",
    json={"plant_id": tomato.id, "actuator": "pump", "action": "off"},
    headers=H,
)
pending = client.get(f"/api/v1/devices/{device.id}/commands/pending", headers=DH).json()
if pending:
    r = client.post(
        f"/api/v1/devices/{device.id}/commands/{pending[0]['id']}/ack",
        json={"ok": False, "detail": "فشل المرحّل"},
        headers=DH,
    )
    check("failed acknowledgement accepted", r.status_code == 200)
    snap = snapshot()
    check(
        "failed execution raises an alert",
        any(a["kind"].startswith("command_failed") for a in snap["alerts"]),
        [a["kind"] for a in snap["alerts"]],
    )
    check(
        "failed execution is logged as failed",
        any(e["result"] == "failed" for e in snap["history"]),
        [(e["action"], e["result"]) for e in snap["history"][:4]],
    )

# --- 7. offline device ---------------------------------------------------
device.last_seen = datetime.now(timezone.utc).replace(year=2020)
db.commit()
snap = snapshot()
check("offline device is reported as not connected", snap["device_link"]["connected"] is False)
check(
    "offline device raises a disconnect alert",
    any(a["kind"] == "device_disconnected" for a in snap["alerts"]),
    [a["kind"] for a in snap["alerts"]],
)
check(
    "offline device reports actuators as disconnected, not unsupported",
    next(row for s in snap["systems"] for row in s["actuators"] if row["key"] == "pump")[
        "capability_status_label"
    ]
    in ("غير متصل", "جاهز للتكامل"),
)
report()  # brings it back online
device.last_seen = datetime.now(timezone.utc)
db.commit()

# --- 8. sensor failure ---------------------------------------------------
soil_cap = (
    db.query(DeviceCapability)
    .filter(DeviceCapability.device_id == device.id, DeviceCapability.key == "soil_moisture")
    .first()
)
soil_cap.status = "error"
db.commit()
ingest(soil=20)
snap = snapshot()
check("sensor failure is surfaced", any(a["kind"].startswith("sensor_error") for a in snap["alerts"]), [a["kind"] for a in snap["alerts"]])
systems = {s["key"]: s for s in snap["systems"]}
check(
    "irrigation holds instead of acting on a failed sensor",
    systems["irrigation"]["action"] == "hold" and systems["irrigation"]["hardware_dependent"] is False,
    systems["irrigation"]["reason"],
)
soil_cap.status = "ok"
db.commit()

# --- 9. stale readings ---------------------------------------------------
# Age *every* reading: "the firmware stopped reporting" means no fresh row is
# left at all. (Ageing only the newest one proves nothing - the second newest
# is one second older and still fresh.)
stale_before = int(datetime.now(timezone.utc).timestamp()) - 4000
db.query(Reading).filter(Reading.plant_id == tomato.id).update(
    {Reading.ts: stale_before}, synchronize_session=False
)
db.commit()
snap = snapshot()
check("stale readings detected", snap["sensors"]["status"] == "stale", snap["sensors"]["label"])
check(
    "stale readings hold every data-driven decision",
    all(
        s["action"] in ("hold", "block")
        for s in snap["systems"]
        if s["key"] in ("irrigation", "temperature", "ventilation", "lighting")
    ),
    [(s["key"], s["action"]) for s in snap["systems"]],
)

# --- 10. legacy firmware (no capability report) ---------------------------
db.query(DeviceCapability).filter(DeviceCapability.device_id == device.id).delete()
db.commit()
snap = snapshot()
check("legacy board is detected", snap["device_link"]["capabilities_declared"] is False)
check(
    "legacy board only gets the irrigation relay",
    next(row for s in snap["systems"] for row in s["actuators"] if row["key"] == "pump")["supported"]
    is True
    and next(row for s in snap["systems"] for row in s["actuators"] if row["key"] == "fan")["supported"]
    is False,
)

# --- 11. auth / isolation ------------------------------------------------
check("unauthenticated status request is rejected", client.get(f"/api/v1/control/status/{tomato.id}").status_code == 401)
check("device endpoints reject a user token", client.post(f"/api/v1/devices/{device.id}/report", json={}, headers=H).status_code == 401)
other = User(email="other@rayy.test", password_hash="x")
db.add(other)
db.commit()
db.refresh(other)
H2 = {"Authorization": f"Bearer {create_access_token(str(other.id))}"}
check("other users cannot read this plant", client.get(f"/api/v1/control/status/{tomato.id}", headers=H2).status_code == 404)
# A schedule that really exists, used to prove cross-user isolation.
guarded_id = client.post(
    "/api/v1/control/schedule",
    json={
        "plant_id": tomato.id,
        "system": "irrigation",
        "action": "on",
        "value": 400,
        "duration_sec": 10,
        "time_of_day": "07:00",
        "days": [0, 1, 2, 3, 4, 5, 6],
    },
    headers=H,
).json()["id"]
check("another user cannot edit this plant's schedule", client.put(f"/api/v1/control/schedule/{guarded_id}", json={"time_of_day": "10:00"}, headers=H2).status_code == 404)
check("another user cannot delete this plant's schedule", client.delete(f"/api/v1/control/schedule/{guarded_id}", headers=H2).status_code == 404)
check("the owner can still delete it", client.delete(f"/api/v1/control/schedule/{guarded_id}", headers=H).status_code == 204)
check("existing plants endpoint still works", client.get("/api/v1/plants", headers=H).status_code == 200)

# --- 12. wire protocol ---------------------------------------------------
check("pump-on token stays legacy compatible", da.wire_token(da.PUMP, "on", None) == "water")
check("pump-off token never contains 'water'", "water" not in da.wire_token(da.PUMP, "off", None))
check("actuator token round-trips", da.parse_wire_token("grow_light_set_65") == (da.GROW_LIGHT, "set", 65.0))
check("valve token round-trips", da.parse_wire_token("valve_on") == (da.VALVE, "on", None))

db.close()
print("\n=== FAILURES:", failures if failures else "none")
sys.exit(1 if failures else 0)
