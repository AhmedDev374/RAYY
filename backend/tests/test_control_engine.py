"""Unit tests for the RAYY Control Engine (محرك التحكم).

These exercise the actual control logic — rules, safety, gating and the closed
loop — against a real SQLite schema and the real device adapter. No HTTP, no
"a button was clicked" assertions.

Run from `backend/`:  ../.venv/Scripts/python.exe -m pytest tests -q
"""

from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base
from app.models import (
    AuxReading,
    ControlSettings,
    Device,
    DeviceActuatorState,
    DeviceCapability,
    DeviceCommand,
    DevicePot,
    Plant,
    Reading,
    SpeciesProfile,
    User,
)
from app.services import control_engine as engine
from app.services import device_adapter as da

# The engine reads species thresholds from `species_profiles`; seed the two
# species used here with the same values as `app/encyclopedia_data.py`.
TOMATO_THRESHOLDS = {
    "soil_moisture": {"min": 50, "max": 80, "ideal": 65},
    "temperature": {"min": 18, "max": 29, "ideal": 24},
    "humidity": {"min": 55, "max": 80, "ideal": 65},
    "light": {"min": 900, "max": 1200, "ideal": 1050},
}
ROSE_THRESHOLDS = {
    "soil_moisture": {"min": 40, "max": 80, "ideal": 60},
    "temperature": {"min": 15, "max": 25, "ideal": 20},
    "humidity": {"min": 40, "max": 70, "ideal": 55},
    "light": {"min": 900, "max": 1200, "ideal": 1050},
}

# A board with every sensor and actuator wired (what the firmware can declare).
FULL_CAPABILITIES = [
    ("temperature", "sensor", True, "ok"),
    ("humidity", "sensor", True, "ok"),
    ("light", "sensor", True, "ok"),
    ("soil_moisture", "sensor", True, "ok"),
    ("water_level", "sensor", True, "ok"),
    ("flow", "sensor", True, "ok"),
    ("pump", "actuator", True, "ok"),
    ("valve", "actuator", True, "ok"),
    ("fan", "actuator", True, "ok"),
    ("vent", "actuator", True, "ok"),
    ("grow_light", "actuator", True, "ok"),
]


@pytest.fixture()
def db() -> Session:
    engine_sql = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine_sql)
    session = sessionmaker(bind=engine_sql)()
    session.add(
        SpeciesProfile(
            species="Tomato",
            name_ar="الطماطم",
            name_en="Tomato",
            thresholds=TOMATO_THRESHOLDS,
            care_guide="",
        )
    )
    session.add(
        SpeciesProfile(
            species="Rose",
            name_ar="الورد",
            name_en="Rose",
            thresholds=ROSE_THRESHOLDS,
            care_guide="",
        )
    )
    session.commit()
    try:
        yield session
    finally:
        session.close()


def make_user(db: Session, email: str = "unit@rayy.test") -> User:
    user = User(email=email, password_hash="x")
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def make_device(
    db: Session,
    *,
    claimed: bool = True,
    last_seen_age: int = 5,
    capabilities: list[tuple] | None = FULL_CAPABILITIES,
    name: str = "RAYY-UNIT-001",
) -> Device:
    device = Device(
        user_id=make_user(db, f"{name}@rayy.test").id,
        name=name,
        is_claimed=claimed,
        last_seen=datetime.now(timezone.utc) - timedelta(seconds=last_seen_age),
        firmware_version="3.0.0",
    )
    db.add(device)
    db.commit()
    db.refresh(device)
    for i in range(4):
        db.add(DevicePot(device_id=device.id, pot_index=i))
    for key, kind, supported, status in capabilities or []:
        db.add(
            DeviceCapability(
                device_id=device.id,
                key=key,
                kind=kind,
                supported=supported,
                status=status,
            )
        )
    db.commit()
    db.refresh(device)
    return device


def make_plant(db: Session, species: str = "Tomato", device: Device | None = None) -> Plant:
    plant = Plant(user_id=make_user(db, f"p-{species}@rayy.test").id, species=species, nickname=f"{species} Unit")
    db.add(plant)
    db.commit()
    db.refresh(plant)
    if device is not None:
        plant.device_id = device.id
        pot = db.query(DevicePot).filter(DevicePot.device_id == device.id, DevicePot.pot_index == 0).first()
        pot.plant_id = plant.id
        db.commit()
    return plant


def reading(soil=60.0, temp=24.0, hum=62.0, light=1000.0, age: int = 0) -> Reading:
    return Reading(
        device_id=1,
        plant_id=1,
        pot_index=0,
        ts=int(datetime.now(timezone.utc).timestamp()) - age,
        temperature=temp,
        humidity=hum,
        light=light,
        soil_moisture=soil,
        ph=6.5,
    )


def decide(db: Session, plant: Plant, value: Reading | None):
    """Run the full rule set for a plant and return (decisions, settings, link)."""
    settings = engine.get_or_create_settings(db, plant)
    targets, _ = engine.resolve_targets(db, plant, settings)
    link = da.build_link(db, plant)
    sensors = engine.sensor_state(value)
    decisions = engine.evaluate(value, targets, settings, sensors, link)
    return decisions, settings, link


def one(decisions, system: str):
    return next(d for d in decisions if d.system == system)


def age_pump_start(db: Session, plant: Plant, seconds: int = 120) -> ControlSettings:
    settings = engine.get_or_create_settings(db, plant)
    intents = dict(settings.actuators or {})
    entry = dict(intents.get(da.PUMP) or {})
    old = datetime.now(timezone.utc) - timedelta(seconds=seconds)
    entry["last_started_at"] = old.isoformat()
    entry["last_changed_at"] = old.isoformat()
    intents[da.PUMP] = entry
    settings.actuators = intents
    db.commit()
    return settings


# ---------------------------------------------------------------------------
# 1. Plant-specific control ranges
# ---------------------------------------------------------------------------
def test_targets_come_from_the_selected_plant(db: Session):
    device = make_device(db)
    tomato = make_plant(db, "Tomato", device=device)
    rose = make_plant(db, "Rose", device=device)

    tomato_settings = engine.get_or_create_settings(db, tomato)
    rose_settings = engine.get_or_create_settings(db, rose)
    tomato_targets, tomato_source = engine.resolve_targets(db, tomato, tomato_settings)
    rose_targets, rose_source = engine.resolve_targets(db, rose, rose_settings)

    assert tomato_source == "species" and rose_source == "species"
    # Tomato wants a wetter, warmer greenhouse than Rose.
    assert tomato_targets["soil_moisture"]["min"] == 50
    assert rose_targets["soil_moisture"]["min"] == 40
    assert tomato_targets["temperature"]["max"] == 29
    assert rose_targets["temperature"]["max"] == 25

    # 26°C is fine for Tomato but too warm for Rose.
    assert one(decide(db, tomato, reading(temp=26))[0], "temperature").action == "hold"
    rose_decision = one(decide(db, rose, reading(temp=26))[0], "temperature")
    assert rose_decision.action == "on"


def test_per_plant_override_beats_species_default(db: Session):
    plant = make_plant(db, "Tomato")
    settings = engine.get_or_create_settings(db, plant)
    settings.targets = {"soil_moisture": {"min": 30, "max": 45}}
    db.commit()

    targets, source = engine.resolve_targets(db, plant, settings)
    assert source == "custom"
    assert targets["soil_moisture"]["min"] == 30
    # 40% is below the species minimum (50) but inside the plant's own range.
    decision = one(decide(db, plant, reading(soil=40))[0], "irrigation")
    assert decision.action == "hold"


# ---------------------------------------------------------------------------
# 2. Automatic irrigation (closed loop)
# ---------------------------------------------------------------------------
def test_automatic_irrigation_starts_when_soil_is_below_target(db: Session):
    device = make_device(db)
    plant = make_plant(db, device=device)

    cycle = engine.run_control_cycle(db, plant.id, reading(soil=30))
    irrigation = one(cycle.decisions, "irrigation")
    assert irrigation.action == "on"
    assert irrigation.actuator == da.PUMP
    assert "50" in irrigation.reason  # the plant's own minimum

    settings = engine.get_or_create_settings(db, plant)
    assert (settings.actuators or {})[da.PUMP]["on"] is True
    # A real command reached the device queue with the legacy-safe token.
    command = db.query(DeviceCommand).filter(DeviceCommand.action == "water").first()
    assert command is not None
    assert any(event.result == "queued" and event.actuator == da.PUMP for event in cycle.events)


def test_irrigation_stops_when_soil_reaches_target(db: Session):
    device = make_device(db)
    plant = make_plant(db, device=device)
    engine.run_control_cycle(db, plant.id, reading(soil=30))
    age_pump_start(db, plant)

    cycle = engine.run_control_cycle(db, plant.id, reading(soil=70))
    irrigation = one(cycle.decisions, "irrigation")
    assert irrigation.action == "off"
    assert "تم إيقاف المضخة" in irrigation.reason

    settings = engine.get_or_create_settings(db, plant)
    assert (settings.actuators or {})[da.PUMP]["on"] is False
    assert db.query(DeviceCommand).filter(DeviceCommand.action == "pump_off").count() == 1


def test_opening_order_valve_then_pump_and_closing_order_pump_then_valve(db: Session):
    device = make_device(db)
    plant = make_plant(db, device=device)
    settings = engine.get_or_create_settings(db, plant)
    targets, _ = engine.resolve_targets(db, plant, settings)
    link = da.build_link(db, plant)
    sensors = engine.sensor_state(reading(soil=30))

    decisions = engine.evaluate(reading(soil=30), targets, settings, sensors, link)
    sent = engine.with_valve(engine.merge_actuator_commands(decisions), link)
    order = [d.actuator for d in sent if d.actuator in (da.PUMP, da.VALVE)]
    assert order == [da.VALVE, da.PUMP]

    settings.actuators = {**(settings.actuators or {}), da.PUMP: {"on": True, "value": None}}
    settings.actuators["pump"]["last_started_at"] = (
        datetime.now(timezone.utc) - timedelta(seconds=120)
    ).isoformat()
    db.commit()
    decisions = engine.evaluate(reading(soil=75), targets, settings, sensors, link)
    sent = engine.with_valve(engine.merge_actuator_commands(decisions), link)
    order = [d.actuator for d in sent if d.actuator in (da.PUMP, da.VALVE) and d.action == "off"]
    assert order == [da.PUMP, da.VALVE]


def test_repeated_irrigation_is_prevented(db: Session):
    device = make_device(db)
    plant = make_plant(db, device=device)
    engine.run_control_cycle(db, plant.id, reading(soil=30))  # starts the pump

    # A second dry reading one second later must not re-issue a start command.
    cycle = engine.run_control_cycle(db, plant.id, reading(soil=28))
    irrigation = one(cycle.decisions, "irrigation")
    assert irrigation.action == "hold"
    assert "متكرر" in irrigation.reason
    assert db.query(DeviceCommand).filter(DeviceCommand.action == "water").count() == 1


def test_water_usage_is_estimated_without_a_flow_sensor(db: Session):
    device = make_device(db, capabilities=[("pump", "actuator", True, "ok"),
                                          ("soil_moisture", "sensor", True, "ok")])
    plant = make_plant(db, device=device)
    engine.run_control_cycle(db, plant.id, reading(soil=30))
    settings = engine.get_or_create_settings(db, plant)
    assert settings.water_used_today_l > 0  # clearly-labelled estimate


def test_water_usage_from_real_flow_is_not_double_counted(db: Session):
    device = make_device(db)  # has a real flow sensor
    plant = make_plant(db, device=device)
    engine.run_control_cycle(db, plant.id, reading(soil=30))
    settings = engine.get_or_create_settings(db, plant)
    # A flow sensor is wired, so the engine must not add an estimate at all.
    assert settings.water_used_today_l == 0
    assert da.build_link(db, plant).has_flow_sensor() is True
    assert da.build_link(db, plant).uses_real_flow() is False  # no reading yet

    db.add(
        AuxReading(
            device_id=device.id,
            plant_id=plant.id,
            ts=int(datetime.now(timezone.utc).timestamp()),
            flow_lpm=1.2,
        )
    )
    db.commit()
    link = da.build_link(db, plant)
    assert link.flow_lpm == pytest.approx(1.2)
    assert link.uses_real_flow() is True


# ---------------------------------------------------------------------------
# 3. Temperature, ventilation and lighting rules
# ---------------------------------------------------------------------------
def test_automatic_temperature_control_raises_fan_and_vent(db: Session):
    device = make_device(db)
    plant = make_plant(db, device=device)

    hot = one(decide(db, plant, reading(temp=33))[0], "temperature")
    assert hot.action == "on" and hot.actuator == da.FAN
    assert hot.value is not None and 40 <= hot.value <= 100
    assert "33" in hot.reason and "29" in hot.reason

    # Proportional: a hotter greenhouse demands a faster fan.
    hotter = one(decide(db, plant, reading(temp=36))[0], "temperature")
    assert hotter.value > hot.value

    cold = one(decide(db, plant, reading(temp=12))[0], "temperature")
    assert cold.action == "off" and cold.value == 0
    assert one(decide(db, plant, reading(temp=24))[0], "temperature").action == "hold"


def test_ventilation_answers_humidity_not_only_temperature(db: Session):
    device = make_device(db)
    plant = make_plant(db, device=device)
    humid = one(decide(db, plant, reading(hum=88))[0], "ventilation")
    assert humid.action == "on" and humid.value >= 50
    assert one(decide(db, plant, reading(hum=60))[0], "ventilation").action == "hold"


def test_max_demand_wins_on_the_shared_fan(db: Session):
    device = make_device(db)
    plant = make_plant(db, device=device)
    decisions = decide(db, plant, reading(temp=33, hum=88))[0]
    merged = engine.merge_actuator_commands(decisions)
    fan = next(d for d in merged if d.actuator == da.FAN)
    singles = [d.value for d in decisions if d.actuator == da.FAN and d.value]
    assert fan.value == max(singles)


def test_automatic_lighting_decision(db: Session):
    device = make_device(db)
    plant = make_plant(db, device=device)

    dark = one(decide(db, plant, reading(light=120))[0], "lighting")
    assert dark.action == "on" and dark.actuator == da.GROW_LIGHT
    assert dark.value is not None and 30 <= dark.value <= 100

    bright = one(decide(db, plant, reading(light=1100))[0], "lighting")
    assert bright.action == "off"


# ---------------------------------------------------------------------------
# 4. Manual and scheduled commands
# ---------------------------------------------------------------------------
def test_manual_command_reaches_the_device_queue(db: Session):
    device = make_device(db)
    plant = make_plant(db, device=device)

    event = engine.manual_command(db, plant, da.FAN, "set", value=65)
    assert event.result == "queued"
    command = db.query(DeviceCommand).order_by(DeviceCommand.id.desc()).first()
    assert command.action == "fan_set_65"
    settings = engine.get_or_create_settings(db, plant)
    assert (settings.actuators or {})[da.FAN]["value"] == 65


def test_manual_command_is_not_executed_on_unsupported_hardware(db: Session):
    # A board that only has the irrigation relay (the shipped firmware).
    device = make_device(db, capabilities=[("pump", "actuator", True, "ok"),
                                          ("soil_moisture", "sensor", True, "ok")])
    plant = make_plant(db, device=device)

    event = engine.manual_command(db, plant, da.GROW_LIGHT, "on")
    assert event.result == "unsupported"
    # The reason names the missing output and marks it as integration-ready.
    assert "إضاءة النمو" in (event.result_detail or "")
    assert "جاهز للتكامل" in (event.result_detail or "")
    assert db.query(DeviceCommand).count() == 0  # nothing was queued


def test_scheduled_command_runs_when_due(db: Session):
    from app.models import ControlSchedule

    device = make_device(db)
    plant = make_plant(db, device=device)
    settings = engine.get_or_create_settings(db, plant)
    link = da.build_link(db, plant)
    adapter = da.get_adapter(db, plant, link)

    schedule = ControlSchedule(
        plant_id=plant.id,
        system="irrigation",
        actuator=da.PUMP,
        action="on",
        value=400,
        duration_sec=10,
        time_of_day=datetime.now().strftime("%H:%M"),
        days=[0, 1, 2, 3, 4, 5, 6],
    )
    db.add(schedule)
    db.commit()

    events = engine.process_schedules(db, plant, settings, adapter)
    assert any(event.source == "schedule" and event.result == "queued" for event in events)
    # Idempotent: the same schedule does not fire twice.
    assert engine.process_schedules(db, plant, settings, adapter) == []


def test_schedule_is_not_executed_outside_its_window(db: Session):
    from app.models import ControlSchedule

    device = make_device(db)
    plant = make_plant(db, device=device)
    settings = engine.get_or_create_settings(db, plant)
    adapter = da.get_adapter(db, plant, da.build_link(db, plant))

    later = (datetime.now() + timedelta(hours=2)).strftime("%H:%M")
    db.add(
        ControlSchedule(
            plant_id=plant.id,
            system="irrigation",
            action="on",
            time_of_day=later,
            days=[0, 1, 2, 3, 4, 5, 6],
        )
    )
    db.commit()
    assert engine.process_schedules(db, plant, settings, adapter) == []


# ---------------------------------------------------------------------------
# 5. Safety
# ---------------------------------------------------------------------------
def test_low_water_blocks_irrigation(db: Session):
    device = make_device(db)
    plant = make_plant(db, device=device)
    # Real water-level sensor reporting 10%.
    db.add(
        AuxReading(
            device_id=device.id,
            plant_id=plant.id,
            ts=int(datetime.now(timezone.utc).timestamp()),
            water_level_pct=10,
        )
    )
    db.commit()

    cycle = engine.run_control_cycle(db, plant.id, reading(soil=20))
    irrigation = one(cycle.decisions, "irrigation")
    assert irrigation.action == "block"
    assert "حماية" in irrigation.reason
    tank = one(cycle.decisions, "water_tank")
    assert tank.status == "critical"
    # No irrigation command was queued (a grow-light command is unrelated).
    assert db.query(DeviceCommand).filter(DeviceCommand.action == "water").count() == 0


def test_manual_pump_is_blocked_by_water_protection(db: Session):
    device = make_device(db)
    plant = make_plant(db, device=device)
    settings = engine.get_or_create_settings(db, plant)
    settings.water_tank_pct = 5
    db.commit()

    event = engine.manual_command(db, plant, da.PUMP, "on")
    assert event.result == "blocked"
    assert "حماية المضخة" in (event.result_detail or "")


def test_pump_max_runtime_protection(db: Session):
    device = make_device(db, capabilities=[("pump", "actuator", True, "ok"),
                                          ("soil_moisture", "sensor", True, "ok")])
    plant = make_plant(db, device=device)
    engine.run_control_cycle(db, plant.id, reading(soil=30))  # pump ON
    age_pump_start(db, plant, engine.PUMP_MAX_RUNTIME_SECONDS + 5)

    cycle = engine.run_control_cycle(db, plant.id, reading(soil=30))
    irrigation = one(cycle.decisions, "irrigation")
    assert irrigation.action == "off"
    assert "الحد الأقصى" in irrigation.reason
    assert irrigation.severity == "critical"
    # The protection stop stays visible as an alert after the pump is stopped.
    assert any(alert["kind"] == "pump_protection_stop" for alert in _alerts(db, plant))


def test_no_flow_detection_stops_the_pump(db: Session):
    device = make_device(db)  # flow sensor installed, reporting zero
    plant = make_plant(db, device=device)
    engine.run_control_cycle(db, plant.id, reading(soil=30))
    db.add(
        AuxReading(
            device_id=device.id,
            plant_id=plant.id,
            ts=int(datetime.now(timezone.utc).timestamp()),
            flow_lpm=0.0,
        )
    )
    db.commit()
    age_pump_start(db, plant, engine.FLOW_STARTUP_GRACE_SECONDS + 5)

    cycle = engine.run_control_cycle(db, plant.id, reading(soil=30))
    irrigation = one(cycle.decisions, "irrigation")
    assert irrigation.action == "off"
    assert "لا يوجد تدفق" in irrigation.reason


def test_emergency_stop_forces_everything_off_and_blocks_commands(db: Session):
    device = make_device(db)
    plant = make_plant(db, device=device)
    engine.run_control_cycle(db, plant.id, reading(soil=30))  # pump ON

    events = engine.emergency_stop(db, plant)
    assert any(event.action == "emergency_stop" for event in events)
    settings = engine.get_or_create_settings(db, plant)
    assert settings.emergency_stop is True
    assert all(not (intent or {}).get("on") for intent in (settings.actuators or {}).values())
    assert db.query(DeviceCommand).filter(DeviceCommand.action == "pump_off").count() == 1

    # No automatic actuation while stopped...
    before = db.query(DeviceCommand).count()
    cycle = engine.run_control_cycle(db, plant.id, reading(soil=10))
    assert one(cycle.decisions, "irrigation").action in ("hold", "block")
    assert db.query(DeviceCommand).count() == before
    # ...and no manual command either.
    assert engine.manual_command(db, plant, da.PUMP, "on").result == "blocked"

    engine.clear_emergency(db, plant)
    assert engine.get_or_create_settings(db, plant).emergency_stop is False


def test_actuator_debounce_prevents_rapid_cycling(db: Session):
    device = make_device(db)
    plant = make_plant(db, device=device)
    settings = engine.get_or_create_settings(db, plant)
    engine._set_intent(settings, da.FAN, True, 60, "auto")
    db.commit()

    targets, _ = engine.resolve_targets(db, plant, settings)
    link = da.build_link(db, plant)
    adapter = da.get_adapter(db, plant, link)
    decision = engine.Decision(
        system="temperature",
        action="off",
        actuator=da.FAN,
        reason="إيقاف المروحة",
        severity="ok",
    )
    event = engine.apply_decision(db, plant, settings, decision, adapter)
    assert event is not None and event.action == "hold"
    assert "تأجيل" in event.reason
    assert db.query(DeviceCommand).filter(DeviceCommand.action == "fan_off").count() == 0


# ---------------------------------------------------------------------------
# 6. Missing sensors / offline devices
# ---------------------------------------------------------------------------
def test_missing_sensor_holds_the_rule_and_flags_hardware(db: Session):
    # Board without a water-level sensor or a grow light.
    device = make_device(
        db,
        capabilities=[
            ("pump", "actuator", True, "ok"),
            ("soil_moisture", "sensor", True, "ok"),
            ("temperature", "sensor", True, "ok"),
            ("humidity", "sensor", True, "ok"),
            ("light", "sensor", True, "ok"),
            ("water_level", "sensor", False, "not_installed"),
            ("grow_light", "actuator", False, "not_installed"),
        ],
    )
    plant = make_plant(db, device=device)
    decisions, _, link = decide(db, plant, reading(soil=60, light=1300))

    tank = one(decisions, "water_tank")
    assert tank.action == "hold" and tank.hardware_dependent is True
    assert "غير معروف" in tank.reason

    lighting = one(decisions, "lighting")
    # The light reading is fresh, so the rule runs; the actuator is what is missing.
    assert lighting.action == "off"
    assert link.supports(da.GROW_LIGHT) is False
    assert "جاهز للتكامل" in link.reason_for(da.GROW_LIGHT)

    details = engine.sensor_details(reading(soil=60, light=1300), link)
    water = next(row for row in details if row["key"] == da.WATER_LEVEL)
    assert water["supported"] is False
    assert water["hardware_dependent"] is True
    assert water["value"] is None
    assert water["text"] == "—"
    assert "يتطلب" in water["status_label"] or "تركيب" in water["reason"]


def test_sensor_not_installed_holds_irrigation_without_fabricating_a_value(db: Session):
    device = make_device(
        db,
        capabilities=[
            ("pump", "actuator", True, "ok"),
            ("soil_moisture", "sensor", False, "not_installed"),
        ],
    )
    plant = make_plant(db, device=device)
    cycle = engine.run_control_cycle(db, plant.id, reading(soil=10))
    irrigation = one(cycle.decisions, "irrigation")
    assert irrigation.action == "hold"
    assert irrigation.hardware_dependent is True
    # The reason names the exact missing sensor, not a generic "sensor missing".
    assert "رطوبة التربة" in irrigation.reason
    assert db.query(DeviceCommand).filter(DeviceCommand.action == "water").count() == 0


def test_sensor_failure_holds_decisions_and_raises_an_alert(db: Session):
    device = make_device(db)
    plant = make_plant(db, device=device)
    row = (
        db.query(DeviceCapability)
        .filter(DeviceCapability.device_id == device.id, DeviceCapability.key == da.SOIL)
        .first()
    )
    row.status = "error"
    db.commit()

    decisions, _, link = decide(db, plant, reading(soil=20))
    irrigation = one(decisions, "irrigation")
    assert irrigation.action == "hold"
    assert link.sensor_usable(da.SOIL) is False

    alerts = _alerts(db, plant)
    assert any(alert["kind"].startswith("sensor_error") for alert in alerts)


def test_stale_readings_hold_every_decision(db: Session):
    device = make_device(db)
    plant = make_plant(db, device=device)
    decisions, _, _ = decide(db, plant, reading(soil=20, age=engine.SENSOR_STALE_SECONDS + 60))
    assert all(decision.action in ("hold", "block") for decision in decisions)


def test_offline_device_is_reported_offline_and_nothing_is_queued(db: Session):
    device = make_device(db, last_seen_age=engine.SENSOR_STALE_SECONDS * 2)
    plant = make_plant(db, device=device)
    link = da.build_link(db, plant)
    assert link.connected is False
    assert link.source == "hardware"

    adapter = da.get_adapter(db, plant, link)
    result = adapter.send(da.ActuatorCommand(actuator=da.PUMP, action="on"))
    assert result.status == "offline"
    assert db.query(DeviceCommand).count() == 0

    alerts = _alerts(db, plant)
    assert any(alert["kind"] == "device_disconnected" for alert in alerts)


def test_plant_without_any_device_reports_no_device(db: Session):
    plant = make_plant(db, "Tomato")
    link = da.build_link(db, plant)
    assert link.device_id is None
    assert link.supports(da.PUMP) is False
    assert engine.manual_command(db, plant, da.PUMP, "on").result == "offline"
    alerts = _alerts(db, plant)
    assert any(alert["kind"] == "no_device" for alert in alerts)


def test_legacy_firmware_only_gets_the_irrigation_relay(db: Session):
    """A board that never reported capabilities is assumed to only have the relay."""
    device = make_device(db, capabilities=None)
    plant = make_plant(db, device=device)
    link = da.build_link(db, plant)
    assert link.declared == da.LEGACY_RELAY_ONLY
    assert link.supports(da.PUMP) is True
    assert link.supports(da.FAN) is False
    assert link.supports(da.GROW_LIGHT) is False
    assert link.sensor_usable(da.SOIL) is True
    assert link.sensor_usable(da.WATER_LEVEL) is False


# ---------------------------------------------------------------------------
# 7. Invalid commands
# ---------------------------------------------------------------------------
def test_unknown_actuator_and_action_are_rejected(db: Session):
    device = make_device(db)
    plant = make_plant(db, device=device)

    unknown = engine.manual_command(db, plant, "laser", "on")
    assert unknown.result == "unsupported"
    assert "ليس مشغّلاً معروفاً" in unknown.reason

    bad_action = engine.manual_command(db, plant, da.PUMP, "explode")
    assert bad_action.result == "unsupported"
    assert db.query(DeviceCommand).count() == 0


def test_out_of_range_value_is_rejected_before_reaching_the_device(db: Session):
    device = make_device(db)
    plant = make_plant(db, device=device)
    event = engine.manual_command(db, plant, da.FAN, "set", value=180)
    assert event.result == "blocked"
    assert "0%" in event.reason
    assert db.query(DeviceCommand).count() == 0


# ---------------------------------------------------------------------------
# 8. Snapshot / dashboard payload
# ---------------------------------------------------------------------------
def test_snapshot_reports_hardware_honestly(db: Session):
    device = make_device(db)
    plant = make_plant(db, device=device)
    db.add(
        AuxReading(
            device_id=device.id,
            plant_id=plant.id,
            ts=int(datetime.now(timezone.utc).timestamp()),
            water_level_pct=72,
            flow_lpm=0.8,
        )
    )
    db.commit()

    snapshot = engine.build_snapshot(db, plant, reading(soil=44, temp=25.7, light=927))
    assert snapshot["tank"]["level_pct"] == pytest.approx(72)
    assert snapshot["tank"]["source"] == "sensor"
    assert snapshot["tank"]["used_today_estimated"] is False
    assert snapshot["device_link"]["capabilities_declared"] is True

    sensor_keys = {row["key"] for row in snapshot["sensor_details"]}
    assert sensor_keys == set(da.SENSOR_KEYS)
    assert len(snapshot["systems"]) == 5
    assert snapshot["pipeline"][-1] == "التغذية الراجعة"

    safety_keys = {rule["key"] for rule in snapshot["safety"]["rules"]}
    assert {"pump_protection", "pump_max_runtime", "no_flow_detection"} <= safety_keys
    no_flow = next(r for r in snapshot["safety"]["rules"] if r["key"] == "no_flow_detection")
    assert no_flow["enabled"] is True  # a real flow sensor is installed here

    irrigation = next(s for s in snapshot["systems"] if s["key"] == "irrigation")
    assert irrigation["current"]["value"] == pytest.approx(44)
    assert irrigation["target"]["min"] == 50
    assert irrigation["actuators"][0]["supported"] is True


def test_snapshot_without_water_sensor_has_no_fabricated_level(db: Session):
    device = make_device(
        db,
        capabilities=[("pump", "actuator", True, "ok"),
                      ("soil_moisture", "sensor", True, "ok")],
    )
    plant = make_plant(db, device=device)
    snapshot = engine.build_snapshot(db, plant, reading(soil=44))

    assert snapshot["tank"]["level_pct"] is None
    assert snapshot["tank"]["known"] is False
    assert snapshot["tank"]["source"] == "unknown"
    assert snapshot["tank"]["sensor_available"] is False
    assert snapshot["tank"]["used_today_estimated"] is True
    water = next(row for row in snapshot["sensor_details"] if row["key"] == da.WATER_LEVEL)
    assert water["value"] is None and water["text"] == "—"


def _fan_row(db: Session, plant: Plant, variable: bool | None):
    """The panel's view of the fan for a board that declared `variable`."""
    capability = DeviceCapability(
        device_id=plant.device_id,
        key="fan",
        kind="actuator",
        supported=True,
        status="ok",
        variable=variable,
    )
    db.add(capability)
    db.commit()
    snapshot = engine.build_snapshot(db, plant, reading())
    ventilation = next(s for s in snapshot["systems"] if s["key"] == "ventilation")
    return next(row for row in ventilation["actuators"] if row["key"] == "fan")


def test_firmware_can_declare_an_on_off_only_output(db: Session):
    """`variable: false` must hide the speed slider, not fake one."""
    device = make_device(db, capabilities=[("soil_moisture", "sensor", True, "ok")])
    plant = make_plant(db, device=device)

    row = _fan_row(db, plant, variable=False)

    assert row["supported"] is True
    assert row["variable"] is False


def test_declared_variable_output_keeps_the_percentage_control(db: Session):
    device = make_device(db, capabilities=[("soil_moisture", "sensor", True, "ok")])
    plant = make_plant(db, device=device)

    assert _fan_row(db, plant, variable=True)["variable"] is True


def test_undeclared_variable_falls_back_to_the_actuator_model(db: Session):
    """An older firmware that says nothing still gets a speed control."""
    device = make_device(db, capabilities=[("soil_moisture", "sensor", True, "ok")])
    plant = make_plant(db, device=device)

    assert _fan_row(db, plant, variable=None)["variable"] is True


def test_pump_runtime_limit_is_configurable_and_cannot_be_disabled(db: Session):
    device = make_device(db, capabilities=[("pump", "actuator", True, "ok")])
    plant = make_plant(db, device=device)
    settings = engine.get_or_create_settings(db, plant)
    assert engine.pump_max_runtime_seconds(settings) == engine.PUMP_MAX_RUNTIME_SECONDS

    settings.irrigation_max_runtime_sec = 600
    assert engine.pump_max_runtime_seconds(settings) == 600

    # Out-of-range values can never remove the ceiling entirely.
    settings.irrigation_max_runtime_sec = 10_000_000
    assert engine.pump_max_runtime_seconds(settings) == engine.PUMP_MAX_MAX_RUNTIME_SECONDS
    settings.irrigation_max_runtime_sec = 1
    assert engine.pump_max_runtime_seconds(settings) == engine.PUMP_MIN_MAX_RUNTIME_SECONDS

    snapshot = engine.build_snapshot(db, plant, reading())
    assert snapshot["safety"]["pump_max_runtime_default_seconds"] == engine.PUMP_MAX_RUNTIME_SECONDS


def test_configured_runtime_limit_stops_the_pump(db: Session):
    device = make_device(db, capabilities=[("pump", "actuator", True, "ok"),
                                          ("soil_moisture", "sensor", True, "ok")])
    plant = make_plant(db, device=device)
    settings = engine.get_or_create_settings(db, plant)
    settings.irrigation_max_runtime_sec = 240
    db.commit()

    engine.run_control_cycle(db, plant.id, reading(soil=30))  # pump ON
    age_pump_start(db, plant, 250)

    cycle = engine.run_control_cycle(db, plant.id, reading(soil=30))
    irrigation = one(cycle.decisions, "irrigation")
    assert irrigation.action == "off"
    assert "240" in irrigation.reason


def test_acknowledgement_records_real_execution(db: Session):
    """The device ACK is what turns a queued command into 'تم التنفيذ'."""
    device = make_device(db)
    plant = make_plant(db, device=device)
    engine.run_control_cycle(db, plant.id, reading(soil=30))
    command = db.query(DeviceCommand).filter(DeviceCommand.action == "water").first()
    assert command.status == "pending"

    command.status = "done"
    db.commit()
    assert da.parse_wire_token(command.action) == (da.PUMP, "on", None)
    assert da.parse_wire_token("fan_set_65") == (da.FAN, "set", 65.0)
    assert da.parse_wire_token("grow_light_off") == (da.GROW_LIGHT, "off", None)
    assert da.parse_wire_token("valve_on") == (da.VALVE, "on", None)


def test_wire_token_can_never_water_on_an_off_command():
    """Legacy boards grep the response for "water" — an off token must not match."""
    assert da.wire_token(da.PUMP, "on", None) == "water"
    assert "water" not in da.wire_token(da.PUMP, "off", None)
    for actuator in (da.VALVE, da.FAN, da.VENT, da.GROW_LIGHT):
        for action in ("on", "off", "set"):
            assert "water" not in da.wire_token(actuator, action, 50)


def _alerts(db: Session, plant: Plant) -> list[dict]:
    settings = engine.get_or_create_settings(db, plant)
    targets, _ = engine.resolve_targets(db, plant, settings)
    link = da.build_link(db, plant)
    latest = (
        db.query(Reading).filter(Reading.plant_id == plant.id).order_by(Reading.ts.desc()).first()
    )
    sensors = engine.sensor_state(latest)
    decisions = engine.evaluate(latest, targets, settings, sensors, link)
    return engine.active_alerts(db, plant, settings, targets, latest, decisions, link, sensors)


def test_alert_cooldown_deduplicates_repeated_events(db: Session):
    device = make_device(db)
    plant = make_plant(db, device=device)
    db.add(
        AuxReading(
            device_id=device.id,
            plant_id=plant.id,
            ts=int(datetime.now(timezone.utc).timestamp()),
            water_level_pct=5,
        )
    )
    db.commit()

    first = engine.run_control_cycle(db, plant.id, reading(soil=20))
    second = engine.run_control_cycle(db, plant.id, reading(soil=20))
    low_water_first = [e for e in first.events if e.system == "alert"]
    low_water_second = [e for e in second.events if e.system == "alert"]
    assert low_water_first, "the low-water alert should be recorded"
    assert low_water_second == [], "an unchanged alert must not be logged again"


def test_emergency_stop_alert_is_reported(db: Session):
    device = make_device(db)
    plant = make_plant(db, device=device)
    engine.emergency_stop(db, plant)
    alerts = _alerts(db, plant)
    assert any(alert["kind"] == "emergency_stop" for alert in alerts)


@pytest.mark.parametrize("species", ["Tomato", "Rose"])
def test_engine_is_species_agnostic(db: Session, species: str):
    device = make_device(db)
    plant = make_plant(db, species, device=device)
    cycle = engine.run_control_cycle(db, plant.id, reading(soil=20))
    irrigation = one(cycle.decisions, "irrigation")
    assert "الحد الأدنى" in irrigation.reason
    assert species.lower() in plant.nickname.lower() or plant.species == species
