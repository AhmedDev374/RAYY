"""Report which Control Center controls actually work for the live device.

Runs against a copy of the deployed database so the user's data is untouched,
and sends exactly the commands the operator panel sends - nothing more. For
each control it prints whether the backend executed it, refused it (safety), or
reported it as unsupported hardware, plus whether the output is the software
bench or a real device.

Run from backend/:  ../.venv/Scripts/python.exe verify_ui_controls.py
"""

import os
import shutil
import sys
from datetime import datetime, timezone

os.environ["AUTH_MODE"] = "legacy"
os.environ["SECRET_KEY"] = "verify-ui-controls-key"
os.environ["GEMINI_API_KEY"] = ""

SOURCE_DB = "data/app.db"
WORK_DB = "data/_ui_controls.db"
if os.path.exists(SOURCE_DB):
    shutil.copyfile(SOURCE_DB, WORK_DB)
os.environ["DATABASE_URL"] = f"sqlite:///./{WORK_DB}"

sys.stdout.reconfigure(encoding="utf-8")

from fastapi.testclient import TestClient  # noqa: E402

from app.database import Base, SessionLocal, engine  # noqa: E402
from app.main import app  # noqa: E402
from app.models import ControlSettings, Plant, User  # noqa: E402
from app.security import create_access_token  # noqa: E402

Base.metadata.create_all(bind=engine)

db = SessionLocal()
plant = db.query(Plant).first()
if plant is None:
    print("No plant in the database - nothing to check.")
    raise SystemExit(1)
owner = db.get(User, plant.user_id)
headers = {"Authorization": f"Bearer {create_access_token(str(owner.id))}"}
plant_id = plant.id
print(f"Plant: {plant.nickname} ({plant.species}) id={plant_id}")
db.close()

client = TestClient(app)
results: list[tuple[str, str, str]] = []


def snapshot() -> dict:
    response = client.get(f"/api/v1/control/status/{plant_id}", headers=headers)
    assert response.status_code == 200, response.text
    return response.json()


def clear_pump_cooldown() -> None:
    """Let the pump-start control be tested in isolation, repeatedly."""
    session = SessionLocal()
    row = session.query(ControlSettings).filter(ControlSettings.plant_id == plant_id).first()
    if row:
        intents = dict(row.actuators or {})
        entry = dict(intents.get("pump") or {})
        entry.pop("last_started_at", None)
        entry.pop("last_changed_at", None)
        intents["pump"] = entry
        row.actuators = intents
        session.commit()
    session.close()


def send(label: str, actuator: str, action: str, value=None, duration=None, reset_pump=False):
    if reset_pump:
        clear_pump_cooldown()
    response = client.post(
        "/api/v1/control/manual",
        json={
            "plant_id": plant_id,
            "actuator": actuator,
            "action": action,
            "value": value,
            "duration_sec": duration,
        },
        headers=headers,
    )
    body = response.json()
    event = body.get("event") or {}
    results.append((label, event.get("result", "?"), event.get("result_detail") or ""))


initial = snapshot()
link = initial["device_link"]
print(
    f"Device: {link['device_name'] or '(none)'} | source={link['source']} "
    f"| connected={link['connected']} | capabilities_declared={link['capabilities_declared']}"
)
print()

# --- the exact commands the operator panel sends ---------------------------
send("تشغيل المضخة (التحكم السريع)", "pump", "on", None, 180, reset_pump=True)
send("إيقاف المضخة", "pump", "off", None, None)
send("فتح صمام الري", "valve", "on", None, 60)
send("إغلاق صمام الري", "valve", "off", None, None)
send("المروحة — ضبط السرعة 65%", "fan", "set", 65)
send("المروحة — إيقاف", "fan", "off", 0)
send("الفتحات — فتح 100%", "vent", "set", 100)
send("الفتحات — إغلاق", "vent", "off", 0)
send("الإضاءة — تشغيل 60%", "grow_light", "set", 60)
send("الإضاءة — إيقاف", "grow_light", "off", 0)
send("قيمة خارج النطاق (المروحة 180%)", "fan", "set", 180)
# Not reachable from the panel (it only sends known outputs) - kept to prove the
# backend refuses an unknown output instead of queueing it to the device.
unknown = client.post(
    "/api/v1/control/manual",
    json={"plant_id": plant_id, "actuator": "sprinkler", "action": "on"},
    headers=headers,
)
unknown_body = unknown.json()
results.append(
    (
        "مشغّل غير معروف",
        unknown_body.get("event", {}).get("result", f"HTTP {unknown.status_code}"),
        unknown_body.get("event", {}).get("result_detail") or str(unknown_body)[:70],
    )
)

# --- settings the panel writes --------------------------------------------
settings_before = client.get(f"/api/v1/control/settings/{plant_id}", headers=headers).json()
client.put(
    f"/api/v1/control/settings/{plant_id}",
    json={"targets": {"soil_moisture": {"min": 45, "max": 60}}},
    headers=headers,
)
after = snapshot()
target_ok = after["targets"]["soil_moisture"]["min"] == 45 and after["targets_source"] == "custom"
client.put(
    f"/api/v1/control/settings/{plant_id}",
    json={"targets": {"soil_moisture": None}},
    headers=headers,
)
restored = snapshot()
restore_ok = restored["targets_source"] == "species"

client.put(
    f"/api/v1/control/settings/{plant_id}",
    json={"irrigation_max_runtime_sec": 600},
    headers=headers,
)
runtime_after = snapshot()["safety"]
runtime_ok = runtime_after["pump_max_runtime_seconds"] == 600
client.put(
    f"/api/v1/control/settings/{plant_id}",
    json={"irrigation_max_runtime_sec": 0},
    headers=headers,
)
runtime_reset = snapshot()["safety"]["pump_max_runtime_is_default"]

client.put(f"/api/v1/control/settings/{plant_id}", json={"water_tank_pct": 65}, headers=headers)
tank_after = snapshot()["tank"]
tank_ok = tank_after["known"] and tank_after["level_pct"] == 65

# --- schedule manager -----------------------------------------------------
created = client.post(
    "/api/v1/control/schedule",
    json={
        "plant_id": plant_id,
        "system": "irrigation",
        "action": "on",
        "value": 500,
        "duration_sec": 300,
        "time_of_day": "06:00",
        "days": [0, 1, 2, 3, 4, 5, 6],
    },
    headers=headers,
)
schedule_id = created.json()["id"]
edited = client.put(
    f"/api/v1/control/schedule/{schedule_id}",
    json={"time_of_day": "06:30", "value": 700},
    headers=headers,
)
edit_ok = edited.status_code == 200 and edited.json()["time_of_day"] == "06:30"
deleted = client.delete(f"/api/v1/control/schedule/{schedule_id}", headers=headers)

# --- modes + emergency ----------------------------------------------------
mode_ok = all(
    client.post(
        "/api/v1/control/mode", json={"plant_id": plant_id, "mode": mode}, headers=headers
    ).json()["mode"]
    == mode
    for mode in ("manual", "scheduled", "auto")
)
stop = client.post("/api/v1/control/emergency-stop", json={"plant_id": plant_id}, headers=headers)
blocked_after_stop = client.post(
    "/api/v1/control/manual",
    json={"plant_id": plant_id, "actuator": "fan", "action": "set", "value": 50},
    headers=headers,
).json()
reset = client.post("/api/v1/control/emergency-reset", json={"plant_id": plant_id}, headers=headers)

# --- capabilities ---------------------------------------------------------
final = snapshot()
print("COMMANDS SENT BY THE OPERATOR PANEL")
print("-" * 78)
for label, result, detail in results:
    print(f"{label:38} -> {result:12} {detail[:60]}")
print()
print("SETTINGS / SCHEDULE / MODES")
print("-" * 78)
print(f"{'تعديل النطاق المستهدف':38} -> {'يعمل' if target_ok else 'فشل'}")
print(f"{'استعادة احتياج النبات':38} -> {'يعمل' if restore_ok else 'فشل'}")
print(f"{'تعديل الحد الأقصى لمدة الري':38} -> {'يعمل' if runtime_ok else 'فشل'}")
print(f"{'استعادة الحد الافتراضي':38} -> {'يعمل' if runtime_reset else 'فشل'}")
print(f"{'إدخال مستوى الخزان يدوياً':38} -> {'يعمل' if tank_ok else 'فشل'}")
print(f"{'جدولة + تعديل + حذف مهمة':38} -> {'يعمل' if edit_ok and deleted.status_code == 204 else 'فشل'}")
print(f"{'تبديل الأوضاع (يدوي/مجدول/تلقائي)':38} -> {'يعمل' if mode_ok else 'فشل'}")
print(
    f"{'الإيقاف الطارئ يمنع الأوامر':38} -> "
    f"{'يعمل' if stop.json()['emergency_stop'] and not blocked_after_stop['ok'] else 'فشل'}"
)
print(f"{'إلغاء الإيقاف الطارئ':38} -> {'يعمل' if not reset.json()['emergency_stop'] else 'فشل'}")
print()
print("OUTPUTS SEEN BY THE PANEL")
print("-" * 78)
for system in final["systems"]:
    for actuator in system["actuators"]:
        kind = (
            "محاكاة"
            if actuator["simulated"]
            else "عتاد حقيقي"
            if actuator["supported"]
            else "غير مُركّب"
        )
        print(
            f"{actuator['label']:20} supported={str(actuator['supported']):5} "
            f"variable={str(actuator['variable']):5} online={str(actuator['online']):5} "
            f"| {kind} | {actuator['capability_status_label']}"
        )
print()
print("SENSORS")
print("-" * 78)
for sensor in final["sensor_details"]:
    print(
        f"{sensor['label']:20} online={str(sensor['online']):5} "
        f"value={sensor['text']:12} | {sensor['status_label']}"
    )
print()
print(f"Water level source: {final['tank']['source_label']} ({final['tank']['level_pct']})")
print(f"Water usage available: {final['tank']['flow_sensor_available']}")

# Put the copied database back the way we found it.
engine.dispose()
try:
    if os.path.exists(WORK_DB):
        os.remove(WORK_DB)
    print("\n(تم حذف نسخة قاعدة البيانات المؤقتة — قاعدة بياناتك الأصلية لم تُمسّ)")
except PermissionError:
    print(f"\n(ملاحظة: احذف الملف المؤقت {WORK_DB} يدوياً)")
print("checked at", datetime.now(timezone.utc).isoformat(timespec="seconds"))
