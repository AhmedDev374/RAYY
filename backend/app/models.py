import enum
from datetime import datetime

from sqlalchemy import (
    Boolean,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy import JSON
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class CareEventType(str, enum.Enum):
    water = "water"
    fertilize = "fertilize"
    prune = "prune"
    repot = "repot"
    note = "note"


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    supabase_id: Mapped[str | None] = mapped_column(String(36), unique=True, index=True, nullable=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    password_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    plants: Mapped[list["Plant"]] = relationship(back_populates="user")
    devices: Mapped[list["Device"]] = relationship(back_populates="user")


class Device(Base):
    __tablename__ = "devices"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    name: Mapped[str] = mapped_column(String(120), default="ESP32 Sensor")
    token_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)
    setup_token_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)
    setup_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    is_claimed: Mapped[bool] = mapped_column(Boolean, default=False)
    last_seen: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    firmware_version: Mapped[str | None] = mapped_column(String(50), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    user: Mapped["User"] = relationship(back_populates="devices")
    pots: Mapped[list["DevicePot"]] = relationship(back_populates="device")
    readings: Mapped[list["Reading"]] = relationship(back_populates="device")
    pending_commands: Mapped[list["DeviceCommand"]] = relationship(back_populates="device")
    capabilities: Mapped[list["DeviceCapability"]] = relationship(back_populates="device")
    actuator_states: Mapped[list["DeviceActuatorState"]] = relationship(back_populates="device")
    aux_readings: Mapped[list["AuxReading"]] = relationship()


class DevicePot(Base):
    __tablename__ = "device_pots"
    __table_args__ = (UniqueConstraint("device_id", "pot_index", name="uq_device_pot"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    device_id: Mapped[int] = mapped_column(ForeignKey("devices.id"), index=True)
    pot_index: Mapped[int] = mapped_column(Integer)
    plant_id: Mapped[int | None] = mapped_column(ForeignKey("plants.id"), nullable=True)

    device: Mapped["Device"] = relationship(back_populates="pots")
    plant: Mapped["Plant | None"] = relationship(back_populates="device_pot")


class Plant(Base):
    __tablename__ = "plants"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    species: Mapped[str] = mapped_column(String(120))
    nickname: Mapped[str] = mapped_column(String(120))
    device_id: Mapped[int | None] = mapped_column(ForeignKey("devices.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    user: Mapped["User"] = relationship(back_populates="plants")
    device_pot: Mapped["DevicePot | None"] = relationship(back_populates="plant", uselist=False)
    readings: Mapped[list["Reading"]] = relationship(back_populates="plant")
    diagnoses: Mapped[list["Diagnosis"]] = relationship(back_populates="plant")
    care_events: Mapped[list["CareEvent"]] = relationship(back_populates="plant")


class Reading(Base):
    __tablename__ = "readings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    device_id: Mapped[int] = mapped_column(ForeignKey("devices.id"), index=True)
    plant_id: Mapped[int | None] = mapped_column(ForeignKey("plants.id"), index=True, nullable=True)
    pot_index: Mapped[int] = mapped_column(Integer, default=0)
    ts: Mapped[int] = mapped_column(Integer, index=True)
    temperature: Mapped[float] = mapped_column(Float)
    humidity: Mapped[float] = mapped_column(Float)
    light: Mapped[float] = mapped_column(Float)
    soil_moisture: Mapped[float] = mapped_column(Float)
    ph: Mapped[float] = mapped_column(Float, default=6.5)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    device: Mapped["Device"] = relationship(back_populates="readings")
    plant: Mapped["Plant | None"] = relationship(back_populates="readings")


class Diagnosis(Base):
    __tablename__ = "diagnoses"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    plant_id: Mapped[int | None] = mapped_column(ForeignKey("plants.id"), index=True, nullable=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    image_url: Mapped[str] = mapped_column(String(500))
    class_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    plant_species: Mapped[str | None] = mapped_column(String(120), nullable=True)
    disease: Mapped[str | None] = mapped_column(String(200), nullable=True)
    confidence: Mapped[float | None] = mapped_column(Float, nullable=True)
    status: Mapped[str] = mapped_column(String(50), default="success")
    treatment_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    plant: Mapped["Plant | None"] = relationship(back_populates="diagnoses")


class CareEvent(Base):
    __tablename__ = "care_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    plant_id: Mapped[int] = mapped_column(ForeignKey("plants.id"), index=True)
    event_type: Mapped[CareEventType] = mapped_column(Enum(CareEventType))
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    plant: Mapped["Plant"] = relationship(back_populates="care_events")


class SpeciesProfile(Base):
    """Encyclopedia entry (موسوعة رَيّ).

    `species` stays the stable English key used by the rest of the app
    (diagnosis, chat, disease-map, the AI model, etc.) and is never
    translated. Every other field the Arabic Encyclopedia UI needs is
    stored alongside it here, so the original architecture (one row per
    species, `thresholds` JSON, `care_guide`/`seasonal_tips` text,
    `common_diseases` JSON) is preserved and simply extended.
    """

    __tablename__ = "species_profiles"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    species: Mapped[str] = mapped_column(String(120), unique=True, index=True)

    # --- Identity -----------------------------------------------------
    name_ar: Mapped[str] = mapped_column(String(120), default="")
    name_en: Mapped[str] = mapped_column(String(120), default="")
    scientific_name: Mapped[str] = mapped_column(String(160), default="")
    family: Mapped[str] = mapped_column(String(120), default="")
    category: Mapped[str] = mapped_column(String(40), default="", index=True)
    aliases: Mapped[list | None] = mapped_column(JSON, nullable=True)
    image_url: Mapped[str | None] = mapped_column(String(500), nullable=True)

    # --- Content (Arabic) ----------------------------------------------
    description_ar: Mapped[str] = mapped_column(Text, default="")
    watering_ar: Mapped[str] = mapped_column(Text, default="")
    fertilization_ar: Mapped[str] = mapped_column(Text, default="")
    greenhouse_guidance_ar: Mapped[str] = mapped_column(Text, default="")
    common_pests: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    nutrient_deficiencies: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    # --- AI compatibility (never guessed here — filled in later from the
    #     user's own AgroScan labels.json) --------------------------------
    ai_support: Mapped[dict] = mapped_column(JSON, default=lambda: {"supported": False, "model": None})

    # --- Original fields (kept, still used by the ideal-conditions
    #     gauges and the legacy care-guide / seasonal-tips sections) ------
    thresholds: Mapped[dict] = mapped_column(JSON)
    care_guide: Mapped[str] = mapped_column(Text, default="")
    seasonal_tips: Mapped[str] = mapped_column(Text, default="")
    common_diseases: Mapped[dict | None] = mapped_column(JSON, nullable=True)


class DiseaseReport(Base):
    __tablename__ = "disease_reports"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    disease: Mapped[str] = mapped_column(String(200))
    species: Mapped[str | None] = mapped_column(String(120), nullable=True)
    geohash: Mapped[str] = mapped_column(String(12), index=True)
    region: Mapped[str | None] = mapped_column(String(120), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class DeviceCommand(Base):
    __tablename__ = "device_commands"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    device_id: Mapped[int] = mapped_column(ForeignKey("devices.id"), index=True)
    action: Mapped[str] = mapped_column(String(50))
    pot_index: Mapped[int] = mapped_column(Integer, default=0)
    duration_sec: Mapped[int] = mapped_column(Integer, default=5)
    status: Mapped[str] = mapped_column(String(20), default="pending")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    device: Mapped["Device"] = relationship(back_populates="pending_commands")


# ---------------------------------------------------------------------------
# RAYY Control System (نظام التحكم)
#
# Three *new* tables only. Nothing on the existing tables is altered, because
# `Base.metadata.create_all()` creates missing tables but never ALTERs existing
# ones -- so adding columns to `plants`/`devices` would silently break deployed
# databases. Control state therefore hangs off `plant_id` in its own tables.
# ---------------------------------------------------------------------------

CONTROL_MODES = ("auto", "manual", "scheduled")


def _default_targets() -> dict:
    return {"temperature": {}, "humidity": {}, "soil_moisture": {}, "light": {}}


def _default_actuators() -> dict:
    # Last state RAYY *commanded* for each actuator. This is an intent log, not
    # a hardware reading: the UI labels it as such whenever no device is
    # actually connected (see `services/device_adapter.py`).
    return {
        "pump": {"on": False, "value": None, "updated_at": None, "source": None},
        "fan": {"on": False, "value": 0, "updated_at": None, "source": None},
        "vent": {"on": False, "value": 0, "updated_at": None, "source": None},
        "grow_light": {"on": False, "value": None, "updated_at": None, "source": None},
    }


class ControlSettings(Base):
    """Per-plant control configuration (mode, target overrides, last intents)."""

    __tablename__ = "control_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    plant_id: Mapped[int] = mapped_column(ForeignKey("plants.id"), unique=True, index=True)

    # "auto" | "manual" | "scheduled"
    mode: Mapped[str] = mapped_column(String(20), default="auto")
    emergency_stop: Mapped[bool] = mapped_column(Boolean, default=False)
    emergency_stop_reason: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # Sparse overrides on top of the species thresholds, e.g.
    # {"temperature": {"min": 22, "max": 28}, ...}
    targets: Mapped[dict] = mapped_column(JSON, default=_default_targets)
    actuators: Mapped[dict] = mapped_column(JSON, default=_default_actuators)

    # Water tank. There is no level sensor in the current firmware, so this is
    # either NULL ("المستوى غير معروف") or a value the user entered by hand.
    water_tank_pct: Mapped[float | None] = mapped_column(Float, nullable=True)
    water_tank_capacity_l: Mapped[float] = mapped_column(Float, default=20.0)
    water_used_today_l: Mapped[float] = mapped_column(Float, default=0.0)
    water_used_date: Mapped[str | None] = mapped_column(String(10), nullable=True)

    # Safety: how long the irrigation pump may stay on before RAYY cuts it.
    # NULL means "use the engine default"; the engine never allows no limit.
    irrigation_max_runtime_sec: Mapped[int | None] = mapped_column(Integer, nullable=True)

    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class ControlEvent(Base):
    """Control log entry (سجل التحكم) -- one row per decision/action."""

    __tablename__ = "control_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    plant_id: Mapped[int] = mapped_column(ForeignKey("plants.id"), index=True)

    system: Mapped[str] = mapped_column(String(30), index=True)
    actuator: Mapped[str | None] = mapped_column(String(30), nullable=True)
    action: Mapped[str] = mapped_column(String(30))
    value: Mapped[float | None] = mapped_column(Float, nullable=True)
    reason: Mapped[str] = mapped_column(Text, default="")

    # executed | queued | blocked | unsupported | offline | info
    result: Mapped[str] = mapped_column(String(20), default="info")
    result_detail: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # auto | manual | schedule | safety
    source: Mapped[str] = mapped_column(String(20), default="auto")
    # ok | info | warning | critical
    severity: Mapped[str] = mapped_column(String(20), default="info")

    # Dedupe key so the 3-second sensor pipeline logs a decision once, and logs
    # it again only when the decision actually changes.
    signature: Mapped[str] = mapped_column(String(160), index=True, default="")

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


# ---------------------------------------------------------------------------
# Device I/O (طبقة الأجهزة الحقيقية)
#
# The firmware *declares* which sensors and actuators are actually installed on
# the board (`POST /api/v1/devices/{id}/report`). Everything the UI shows about
# hardware is derived from these rows -- never assumed, never invented. Legacy
# firmware that never reports gets a conservative capability set instead.
# ---------------------------------------------------------------------------

DEVICE_CAPABILITY_KINDS = ("actuator", "sensor")

# ok          -> installed and answering
# error       -> installed but the device reported a read/actuation fault
# not_installed -> firmware knows the pin but no hardware is wired
CAPABILITY_STATUSES = ("ok", "error", "not_installed")


class DeviceCapability(Base):
    __tablename__ = "device_capabilities"
    __table_args__ = (UniqueConstraint("device_id", "key", name="uq_device_capability"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    device_id: Mapped[int] = mapped_column(ForeignKey("devices.id"), index=True)
    key: Mapped[str] = mapped_column(String(40), index=True)
    kind: Mapped[str] = mapped_column(String(20), default="actuator")
    supported: Mapped[bool] = mapped_column(Boolean, default=False)
    status: Mapped[str] = mapped_column(String(20), default="not_installed")
    detail: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # NULL = the firmware did not say. True only when the output really accepts
    # a 0-100% value (dimming / speed), so the UI never offers a dead slider.
    variable: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    device: Mapped["Device"] = relationship(back_populates="capabilities")


class DeviceActuatorState(Base):
    """Actuator state *reported by the device* (real feedback, not an intent)."""

    __tablename__ = "device_actuator_states"
    __table_args__ = (UniqueConstraint("device_id", "actuator", name="uq_device_actuator"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    device_id: Mapped[int] = mapped_column(ForeignKey("devices.id"), index=True)
    actuator: Mapped[str] = mapped_column(String(40), index=True)
    on: Mapped[bool] = mapped_column(Boolean, default=False)
    value: Mapped[float | None] = mapped_column(Float, nullable=True)
    error: Mapped[str | None] = mapped_column(String(255), nullable=True)
    reported_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    device: Mapped["Device"] = relationship(back_populates="actuator_states")


class AuxReading(Base):
    """Readings from sensors that are not part of the original 5-value payload.

    Water level and flow live in their own table because `readings` already
    exists in deployed databases and cannot gain columns safely.
    """

    __tablename__ = "aux_readings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    device_id: Mapped[int] = mapped_column(ForeignKey("devices.id"), index=True)
    plant_id: Mapped[int | None] = mapped_column(ForeignKey("plants.id"), index=True, nullable=True)
    ts: Mapped[int] = mapped_column(Integer, index=True)
    water_level_pct: Mapped[float | None] = mapped_column(Float, nullable=True)
    flow_lpm: Mapped[float | None] = mapped_column(Float, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ControlSchedule(Base):
    """Scheduled control action (التشغيل المجدول)."""

    __tablename__ = "control_schedules"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    plant_id: Mapped[int] = mapped_column(ForeignKey("plants.id"), index=True)

    system: Mapped[str] = mapped_column(String(30))
    actuator: Mapped[str | None] = mapped_column(String(30), nullable=True)
    action: Mapped[str] = mapped_column(String(30), default="on")
    value: Mapped[float | None] = mapped_column(Float, nullable=True)
    duration_sec: Mapped[int] = mapped_column(Integer, default=0)

    time_of_day: Mapped[str] = mapped_column(String(5))  # "HH:MM"
    days: Mapped[list] = mapped_column(JSON, default=lambda: [0, 1, 2, 3, 4, 5, 6])
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    note: Mapped[str | None] = mapped_column(String(160), nullable=True)

    last_run_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
