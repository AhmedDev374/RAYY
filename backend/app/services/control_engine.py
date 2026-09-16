"""RAYY Control Engine (محرك التحكم رَيّ).

The control loop, kept independent from FastAPI so it can be called from the
sensor pipeline (`POST /ingest`), the simulator tick and the HTTP router alike:

    Sensors → Plant requirements → Current conditions → Safety conditions
            → Control rules → Decision → Actuator command (device adapter)
            → Device acknowledgement → Feedback → new decision

Hardware honesty rules baked into this module
---------------------------------------------
* A rule only runs on a sensor that the *device declared* and that is *fresh*.
  Otherwise the system holds and says which sensor is missing
  («يتطلب تركيب الحساس») instead of guessing a value.
* Targets come from the species thresholds (encyclopedia data) plus per-plant
  overrides — Tomato and Rose genuinely differ.
* Decisions are proportional (fan speed, vent position, light level), not
  on/off switches, and they are re-evaluated on every reading.
* Safety: pump protection from the water-level sensor, maximum pump runtime,
  no-flow detection (flow sensor), repeated-irrigation guard, actuator
  debounce, sensor-failure hold, and the emergency stop.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from app.models import (
    ControlEvent,
    ControlSchedule,
    ControlSettings,
    Plant,
    SpeciesProfile,
)
from app.services import device_adapter as da

logger = logging.getLogger("uvicorn.error")

MODE_LABELS = {"auto": "تلقائي", "manual": "يدوي", "scheduled": "مجدول"}

# Fallback ranges for a plant whose species has no encyclopedia entry yet.
DEFAULT_THRESHOLDS: dict[str, dict[str, float]] = {
    "temperature": {"min": 18.0, "max": 28.0, "ideal": 24.0},
    "humidity": {"min": 45.0, "max": 75.0, "ideal": 60.0},
    "soil_moisture": {"min": 35.0, "max": 75.0, "ideal": 55.0},
    "light": {"min": 300.0, "max": 1200.0, "ideal": 800.0},
}

TARGET_META = {
    "temperature": {"label": "درجة الحرارة", "unit": "°C"},
    "humidity": {"label": "رطوبة الهواء", "unit": "%"},
    "soil_moisture": {"label": "رطوبة التربة", "unit": "%"},
    "light": {"label": "شدة الإضاءة", "unit": "لوكس"},
}

SYSTEM_META: dict[str, dict] = {
    "irrigation": {
        "label": "نظام الري",
        "icon": "💧",
        "active": True,
        "actuators": [da.PUMP, da.VALVE],
        "sensors": [da.SOIL],
        "description": "يقرر متى يبدأ الري ومتى يتوقف بناءً على رطوبة التربة المقروءة فعلياً.",
    },
    "temperature": {
        "label": "التحكم في درجة الحرارة",
        "icon": "🌡️",
        "active": True,
        "actuators": [da.FAN, da.VENT],
        "sensors": [da.TEMP],
        "description": "يوازن درجة الحرارة عبر سرعة المروحة وفتحات الصوبة.",
    },
    "ventilation": {
        "label": "التهوية",
        "icon": "🌬️",
        "active": True,
        "actuators": [da.FAN, da.VENT],
        "sensors": [da.HUMIDITY, da.TEMP],
        "description": "يخفض رطوبة الهواء عند ارتفاعها بتشغيل المروحة وفتح الفتحات.",
    },
    "lighting": {
        "label": "نظام الإضاءة",
        "icon": "☀️",
        "active": True,
        "actuators": [da.GROW_LIGHT],
        "sensors": [da.LIGHT],
        "description": "يشغّل إضاءة النمو عندما تقل الإضاءة عن احتياج النبات.",
    },
    "water_tank": {
        "label": "خزان المياه",
        "icon": "🚰",
        "active": False,
        "actuators": [],
        "sensors": [da.WATER_LEVEL],
        "description": "يراقب مستوى المياه ويمنع تشغيل المضخة عند نقص المياه.",
    },
}

ACTUATOR_META: dict[str, dict] = {
    da.PUMP: {"label": "مضخة الري", "icon": "💧", "unit": None},
    da.VALVE: {"label": "صمام الري", "icon": "🚰", "unit": None},
    da.FAN: {"label": "المروحة", "icon": "🌬️", "unit": "%"},
    da.VENT: {"label": "فتحات الصوبة", "icon": "🪟", "unit": "%"},
    da.GROW_LIGHT: {"label": "إضاءة النمو", "icon": "☀️", "unit": "%"},
    da.TANK: {"label": "خزان المياه", "icon": "🚰", "unit": "%"},
}

SENSOR_META: dict[str, dict] = {
    da.TEMP: {"label": "درجة الحرارة", "unit": "°C", "digits": 1},
    da.HUMIDITY: {"label": "رطوبة الهواء", "unit": "%", "digits": 0},
    da.LIGHT: {"label": "شدة الإضاءة", "unit": "لوكس", "digits": 0},
    da.SOIL: {"label": "رطوبة التربة", "unit": "%", "digits": 0},
    da.WATER_LEVEL: {"label": "مستوى المياه", "unit": "%", "digits": 0},
    da.FLOW: {"label": "تدفق المياه", "unit": "لتر/دقيقة", "digits": 2},
}

# --- Safety constants (documented so the UI can explain them) --------------
TANK_CRITICAL_PCT = 15.0
TANK_LOW_PCT = 30.0
SENSOR_STALE_SECONDS = 600
PUMP_MIN_INTERVAL_SECONDS = 60
PUMP_MAX_RUNTIME_SECONDS = 180
# Bounds for the user-configurable pump runtime ceiling (30s .. 1h).
PUMP_MIN_MAX_RUNTIME_SECONDS = 30
PUMP_MAX_MAX_RUNTIME_SECONDS = 3600
FLOW_MIN_LPM = 0.05
FLOW_STARTUP_GRACE_SECONDS = 15
ACTUATOR_MIN_SWITCH_SECONDS = 20
WATER_FLOW_L_PER_MIN = 0.6  # nominal; used only for an explicitly-labelled estimate
REPEAT_ALERT_MINUTES = 10

STATUS_LABELS = {
    "ok": "يعمل بشكل طبيعي",
    "warning": "تحتاج انتباه",
    "critical": "حالة حرجة",
    "stopped": "إيقاف طارئ",
    "offline": "الأجهزة غير متصلة",
    "unknown": "لا توجد بيانات",
    "hold": "معلّق بانتظار الحساس",
}

ACTION_LABELS = {
    "on": "تشغيل",
    "off": "إيقاف",
    "set": "ضبط",
    "hold": "لا تغيير",
    "block": "منع",
    "set_mode": "تغيير الوضع",
    "emergency_stop": "إيقاف طارئ",
    "emergency_reset": "إلغاء الإيقاف الطارئ",
    "update_settings": "تحديث الإعدادات",
}

RESULT_LABELS = {
    "executed": "تم التنفيذ",
    "queued": "بانتظار الجهاز",
    "blocked": "ممنوع لأسباب سلامة",
    "unsupported": "غير مدعوم من الأجهزة",
    "offline": "الأجهزة غير متصلة",
    "failed": "فشل التنفيذ",
    "info": "متابعة",
}

SOURCE_LABELS = {
    "auto": "تلقائي",
    "manual": "يدوي",
    "schedule": "مجدول",
    "safety": "حماية",
    "device": "الجهاز",
}


@dataclass
class Decision:
    """One control decision for one system."""

    system: str
    action: str  # on | off | set | hold | block
    reason: str
    severity: str = "info"  # ok | info | warning | critical
    actuator: str | None = None
    value: float | None = None
    duration_sec: int | None = None
    status: str = "ok"
    status_label: str = STATUS_LABELS["ok"]
    detail: str = ""
    source: str = "auto"
    hardware_dependent: bool = False

    @property
    def signature(self) -> str:
        value = "-" if self.value is None else f"{round(self.value)}"
        return f"{self.system}|{self.actuator}|{self.action}|{value}|{self.severity}"


@dataclass
class CycleResult:
    decisions: list[Decision] = field(default_factory=list)
    events: list[ControlEvent] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Settings & targets
# ---------------------------------------------------------------------------
def get_or_create_settings(db: Session, plant: Plant) -> ControlSettings:
    settings = db.query(ControlSettings).filter(ControlSettings.plant_id == plant.id).first()
    if settings is None:
        settings = ControlSettings(plant_id=plant.id)
        db.add(settings)
        db.commit()
        db.refresh(settings)
    return settings


def resolve_targets(db: Session, plant: Plant, settings: ControlSettings) -> tuple[dict, str]:
    """Species thresholds + per-plant overrides. Returns (targets, source)."""
    profile = db.query(SpeciesProfile).filter(SpeciesProfile.species == plant.species).first()
    targets: dict[str, dict[str, float | None]] = {
        key: dict(value) for key, value in DEFAULT_THRESHOLDS.items()
    }
    if profile and isinstance(profile.thresholds, dict):
        for key in targets:
            raw = profile.thresholds.get(key)
            if isinstance(raw, dict) and raw.get("min") is not None and raw.get("max") is not None:
                targets[key] = {
                    "min": float(raw["min"]),
                    "max": float(raw["max"]),
                    "ideal": float(raw.get("ideal", (raw["min"] + raw["max"]) / 2)),
                }

    overrides = settings.targets or {}
    custom = False
    for key, override in overrides.items():
        if key not in targets or not isinstance(override, dict):
            continue
        merged = dict(targets[key])
        for bound in ("min", "max", "ideal"):
            if override.get(bound) is not None:
                merged[bound] = float(override[bound])
                custom = True
        if merged["min"] > merged["max"]:
            merged["min"], merged["max"] = merged["max"], merged["min"]
        if merged.get("ideal") is None or not (merged["min"] <= merged["ideal"] <= merged["max"]):
            merged["ideal"] = (merged["min"] + merged["max"]) / 2
        targets[key] = merged

    return targets, ("custom" if custom else "species")


def reading_age_seconds(reading) -> int | None:
    if reading is None:
        return None
    try:
        ts = float(reading.ts)
    except (TypeError, ValueError):
        return None
    if ts < 946684800:  # devices that send uptime-seconds instead of an epoch
        return None
    return max(0, int(datetime.now(timezone.utc).timestamp() - ts))


def sensor_state(reading) -> dict:
    """Overall freshness of the reading stream (drives "الحساسات غير متاحة")."""
    age = reading_age_seconds(reading)
    if reading is None:
        return {
            "available": False,
            "status": "unavailable",
            "label": "لا توجد قراءات",
            "detail": "لم تصل أي قراءة من الحساسات بعد.",
            "age_seconds": None,
        }
    if age is None:
        return {
            "available": True,
            "status": "ok",
            "label": "متاحة",
            "detail": "القراءات تصل من الحساسات.",
            "age_seconds": None,
        }
    if age > SENSOR_STALE_SECONDS:
        return {
            "available": False,
            "status": "stale",
            "label": "قراءات قديمة",
            "detail": f"آخر قراءة منذ {age // 60} دقيقة — تم تعليق القرارات التلقائية.",
            "age_seconds": age,
        }
    return {
        "available": True,
        "status": "ok",
        "label": "متاحة",
        "detail": "القراءات حديثة.",
        "age_seconds": age,
    }


def sensor_details(reading, link: da.DeviceLink) -> list[dict]:
    """One honest row per sensor RAYY could use, including the missing ones."""
    rows: list[dict] = []
    for key, meta in SENSOR_META.items():
        capability = link.sensor_capability(key)
        installed = bool(capability and capability.supported)
        online = link.sensor_usable(key)
        value = link.sensor_value(key, reading) if online else None
        if online and value is not None:
            digits = meta["digits"]
            text = f"{value:,.{digits}f} {meta['unit']}".strip()
            status = "ok"
            status_label = "يعمل"
            reason = ""
        else:
            text = "—"
            if capability is None:
                status, status_label = "no_device", "غير متصل"
                reason = "لا يوجد جهاز مرتبط بهذه النبتة."
            elif not installed:
                status = capability.status
                status_label = capability.as_dict()["status_label"]
                reason = capability.reason or "لم يتم تركيب الحساس على الجهاز."
            elif capability.status == "error":
                status, status_label = "error", "فشل الحساس"
                reason = capability.reason or "الجهاز أبلغ عن فشل قراءة هذا الحساس."
            else:
                status, status_label = "offline", "غير متصل"
                reason = capability.reason or "الجهاز غير متصل أو القراءات غير حديثة."
        rows.append(
            {
                "key": key,
                "label": meta["label"],
                "unit": meta["unit"],
                "value": value,
                "text": text,
                "supported": installed,
                "online": online,
                "status": status,
                "status_label": status_label,
                "reason": reason,
                "hardware_dependent": not installed,
            }
        )
    return rows


# ---------------------------------------------------------------------------
# Water tank state (sensor first, then clearly-labelled manual value)
# ---------------------------------------------------------------------------
def _tank_state(settings: ControlSettings, link: da.DeviceLink) -> dict:
    sensor_available = link.sensor_usable(da.WATER_LEVEL)
    if sensor_available and link.water_level_pct is not None:
        return {
            "pct": float(link.water_level_pct),
            "source": "sensor",
            "source_label": "حساس مستوى المياه",
            "low_pct": TANK_LOW_PCT,
            "critical_pct": TANK_CRITICAL_PCT,
        }
    if settings.water_tank_pct is not None:
        return {
            "pct": float(settings.water_tank_pct),
            "source": "manual",
            "source_label": "قيمة مُدخلة يدوياً",
            "low_pct": TANK_LOW_PCT,
            "critical_pct": TANK_CRITICAL_PCT,
        }
    return {
        "pct": None,
        "source": "unknown",
        "source_label": "غير معروف",
        "low_pct": TANK_LOW_PCT,
        "critical_pct": TANK_CRITICAL_PCT,
    }


# ---------------------------------------------------------------------------
# Rules
# ---------------------------------------------------------------------------
def _fmt(value: float | None, digits: int = 1) -> str:
    if value is None:
        return "—"
    return f"{value:.{digits}f}"


def _is_variable(actuator: str, capability) -> bool:
    """Whether this output accepts a 0-100% value.

    The device's own capability report is authoritative: a firmware that
    declares `variable: false` gets an ON/OFF control even though RAYY's model of
    that actuator normally allows a percentage. Only when the firmware said
    nothing (None) does RAYY fall back to its own model.
    """
    if capability is not None and capability.variable is not None:
        return bool(capability.variable)
    return ACTUATOR_META.get(actuator, {}).get("unit") == "%"


def _sensor_gate(link: da.DeviceLink, sensor: str) -> str | None:
    """Arabic reason why a sensor cannot be used right now (None when usable).

    The sensor label is always part of the message so the user knows exactly
    which hardware is missing instead of reading a generic "sensor missing".
    """
    if link.sensor_usable(sensor):
        return None
    capability = link.sensor_capability(sensor)
    label = SENSOR_META[sensor]["label"]
    if capability is None:
        return f"لا يوجد جهاز مرتبط لقراءة {label}."
    if not capability.supported:
        return f"يتطلب تركيب حساس {label} على الجهاز — جاهز للتكامل."
    if capability.status == "error":
        return f"فشل حساس {label} — {capability.reason or 'الجهاز أبلغ عن خطأ قراءة.'}"
    return f"الجهاز غير متصل — لا يمكن قراءة {label} حالياً."


def _hold_for_missing_data(system: str, sensor: str, reason: str, detail: str = "") -> Decision:
    """A hold decision that says plainly which sensor is missing/not ready."""
    return Decision(
        system=system,
        action="hold",
        reason=f"تم تعليق قرار هذا النظام — {reason}",
        severity="warning",
        status="unknown",
        status_label=f"يتطلب {SENSOR_META[sensor]['label']}",
        detail=detail
        or f"يعود القرار تلقائياً عند توفّر {SENSOR_META[sensor]['label']} وقراءات حديثة.",
        hardware_dependent="تركيب" in reason or "لم يتم" in reason,
    )


def _tank_decision(settings: ControlSettings, link: da.DeviceLink) -> Decision:
    state = _tank_state(settings, link)
    level = state["pct"]
    if level is None:
        capability = link.sensor_capability(da.WATER_LEVEL)
        reason = (
            capability.reason
            if capability and not capability.supported
            else "لا يوجد حساس مستوى مياه متصل، وضّح المستوى يدوياً لتفعيل حماية المضخة."
        )
        return Decision(
            system="water_tank",
            action="hold",
            reason=(
                f"مستوى المياه غير معروف — {reason}"
            ),
            severity="warning",
            status="unknown",
            status_label="المستوى غير معروف",
            detail="حماية المضخة تعمل فقط عندما يكون مستوى المياه معروفاً (حساس أو إدخال يدوي).",
            hardware_dependent=bool(capability and not capability.supported),
        )
    if level <= TANK_CRITICAL_PCT:
        return Decision(
            system="water_tank",
            action="block",
            reason=(
                f"مستوى المياه منخفض ({_fmt(level, 0)}% — {state['source_label']}) — "
                "تم إيقاف التشغيل التلقائي للمضخة لحماية النظام من العمل دون مياه."
            ),
            severity="critical",
            status="critical",
            status_label="مستوى منخفض",
            detail="أضف ماءً إلى الخزان ثم حدّث المستوى.",
        )
    if level <= TANK_LOW_PCT:
        return Decision(
            system="water_tank",
            action="hold",
            reason=(
                f"مستوى المياه منخفض نسبياً ({_fmt(level, 0)}% — {state['source_label']}). "
                "يُنصح بإعادة التعبئة."
            ),
            severity="warning",
            status="warning",
            status_label="تحتاج انتباه",
            detail="الري التلقائي ما زال مسموحاً لكن الهامش ضيق.",
        )
    return Decision(
        system="water_tank",
        action="hold",
        reason=f"مستوى المياه طبيعي ({_fmt(level, 0)}% — {state['source_label']}).",
        severity="ok",
        status="ok",
        status_label="طبيعي",
    )


def _pump_seconds_since_start(settings: ControlSettings) -> float | None:
    last_start = ((settings.actuators or {}).get(da.PUMP) or {}).get("last_started_at")
    if not last_start:
        return None
    try:
        started = datetime.fromisoformat(str(last_start))
    except ValueError:
        return None
    if started.tzinfo is None:
        started = started.replace(tzinfo=timezone.utc)
    return (datetime.now(timezone.utc) - started).total_seconds()


def _pump_runtime_guard(settings: ControlSettings, link: da.DeviceLink) -> Decision | None:
    """Maximum runtime protection — stops a pump that never got its stop order."""
    intent = (settings.actuators or {}).get(da.PUMP) or {}
    if not intent.get("on"):
        return None
    elapsed = _pump_seconds_since_start(settings)
    if elapsed is None:
        return None

    if link.uses_real_flow() and elapsed >= FLOW_STARTUP_GRACE_SECONDS:
        flow = link.flow_lpm or 0.0
        if flow < FLOW_MIN_LPM:
            return Decision(
                system="irrigation",
                action="off",
                actuator=da.PUMP,
                reason=(
                    f"حماية المضخة: لا يوجد تدفق ماء ({_fmt(flow, 2)} لتر/دقيقة) رغم تشغيل "
                    f"المضخة منذ {int(elapsed)} ثانية — تم إيقافها فوراً."
                ),
                severity="critical",
                status="critical",
                status_label="توقف للحماية",
                detail="تحقّق من الخزان والصمام وحساس التدفق قبل إعادة التشغيل.",
            )

    limit = pump_max_runtime_seconds(settings)
    if elapsed >= limit:
        return Decision(
            system="irrigation",
            action="off",
            actuator=da.PUMP,
            reason=(
                f"حماية المضخة: تجاوز زمن التشغيل الحد الأقصى ({limit} ثانية) — "
                "تم إيقاف الري تلقائياً."
            ),
            severity="critical",
            status="critical",
            status_label="توقف للحماية",
            detail="أقصى زمن تشغيل متصل للمضخة محدد لحماية المضخة والتربة.",
        )
    return None


def pump_max_runtime_seconds(settings: ControlSettings) -> int:
    """The configured pump runtime ceiling, clamped to a sane range.

    A user-set value can never disable the protection: an out-of-range number
    falls back to the engine default instead of being trusted.
    """
    value = settings.irrigation_max_runtime_sec
    if value is None:
        return PUMP_MAX_RUNTIME_SECONDS
    return max(PUMP_MIN_MAX_RUNTIME_SECONDS, min(int(value), PUMP_MAX_MAX_RUNTIME_SECONDS))


def _irrigation_decision(
    reading, targets, settings: ControlSettings, tank: Decision, link: da.DeviceLink
) -> Decision:
    soil_gate = _sensor_gate(link, da.SOIL)
    pump = (settings.actuators or {}).get(da.PUMP, {})
    pump_running = bool(pump.get("on"))

    if tank.action == "block":
        return Decision(
            system="irrigation",
            action="block",
            actuator=da.PUMP,
            reason=tank.reason,
            severity="critical",
            status="critical",
            status_label="متوقّف للحماية",
            detail="تم منع الري لعدم توفر كمية مياه كافية.",
        )

    if soil_gate is not None:
        return _hold_for_missing_data(
            "irrigation",
            da.SOIL,
            soil_gate,
            "الري التلقائي يحتاج حساس رطوبة تربة مُركّباً وقراءات حديثة.",
        )

    soil_value = link.sensor_value(da.SOIL, reading)
    if soil_value is None:
        return _hold_for_missing_data(
            "irrigation", da.SOIL, "لا توجد قراءة حالية لرطوبة التربة."
        )
    soil = float(soil_value)
    target = targets["soil_moisture"]
    low, high, ideal = target["min"], target["max"], target.get("ideal", target["min"])

    if soil <= low:
        elapsed = _pump_seconds_since_start(settings)
        if elapsed is not None and elapsed < PUMP_MIN_INTERVAL_SECONDS:
            return Decision(
                system="irrigation",
                action="hold",
                actuator=da.PUMP,
                value=pump.get("value"),
                reason=(
                    "الري جارٍ بالفعل — تم منع أمر تشغيل متكرر."
                    if pump_running
                    else "تم منع ري متكرر — المضخة شُغّلت قبل أقل من دقيقة."
                ),
                severity="info",
                status="warning",
                status_label="حماية من التكرار",
                detail=f"آخر تشغيل منذ {int(elapsed)} ثانية.",
            )
        return Decision(
            system="irrigation",
            action="on",
            actuator=da.PUMP,
            duration_sec=10,
            reason=(
                f"رطوبة التربة {_fmt(soil, 0)}% أقل من الحد الأدنى لاحتياج النبات "
                f"({_fmt(low, 0)}%) — الري مطلوب."
            ),
            severity="warning",
            status="warning",
            status_label="الري مطلوب",
            detail=f"سيتم إيقاف الري عند بلوغ {_fmt(max(float(ideal), low + 5), 0)}%.",
        )

    stop_at = max(float(ideal), low + 5.0)
    if pump_running and soil >= stop_at:
        return Decision(
            system="irrigation",
            action="off",
            actuator=da.PUMP,
            reason=(
                f"رطوبة التربة وصلت إلى {_fmt(soil, 0)}% وهي داخل النطاق المستهدف "
                f"({_fmt(low, 0)}% — {_fmt(high, 0)}%) — تم إيقاف المضخة."
            ),
            severity="ok",
            status="ok",
            status_label="جاهز",
            detail="التغذية الراجعة من الحساس هي التي أنهت دورة الري.",
        )

    if pump_running:
        return Decision(
            system="irrigation",
            action="hold",
            actuator=da.PUMP,
            value=pump.get("value"),
            reason=f"الري جارٍ — رطوبة التربة حالياً {_fmt(soil, 0)}%.",
            severity="info",
            status="warning",
            status_label="الري جارٍ",
            detail=f"سيتوقف الري عند {_fmt(stop_at, 0)}%.",
        )

    return Decision(
        system="irrigation",
        action="hold",
        actuator=da.PUMP,
        reason=(
            f"رطوبة التربة {_fmt(soil, 0)}% داخل النطاق المستهدف "
            f"({_fmt(low, 0)}% — {_fmt(high, 0)}%) — لا حاجة للري."
        ),
        severity="ok",
        status="ok",
        status_label="جاهز",
    )


def _temperature_decision(reading, targets, link: da.DeviceLink) -> Decision:
    gate = _sensor_gate(link, da.TEMP)
    target = targets["temperature"]
    low, high, ideal = target["min"], target["max"], target.get("ideal")
    if gate is not None:
        return _hold_for_missing_data(
            "temperature",
            da.TEMP,
            gate,
            "التحكم في الحرارة يحتاج حساس درجة حرارة مُركّباً وقراءات حديثة.",
        )
    temp_value = link.sensor_value(da.TEMP, reading)
    if temp_value is None:
        return _hold_for_missing_data(
            "temperature", da.TEMP, "لا توجد قراءة حالية لدرجة الحرارة."
        )
    temp = float(temp_value)
    if temp > high:
        overshoot = temp - high
        fan_speed = max(40.0, min(100.0, 40.0 + overshoot * 10.0))
        vent_pos = max(30.0, min(100.0, 30.0 + overshoot * 8.0))
        return Decision(
            system="temperature",
            action="on",
            actuator=da.FAN,
            value=round(fan_speed),
            reason=(
                f"درجة الحرارة الحالية {_fmt(temp)}°C أعلى من الحد الأعلى لاحتياج النبات "
                f"({_fmt(high)}°C) — تم رفع سرعة المروحة إلى {fan_speed:.0f}% "
                f"وفتح الفتحات إلى {vent_pos:.0f}%."
            ),
            severity="warning",
            status="warning",
            status_label="جارٍ التبريد",
            detail=f"سيعود النظام للوضع الطبيعي عند بلوغ {_fmt(ideal if ideal else high)}°C.",
        )
    if temp < low:
        return Decision(
            system="temperature",
            action="off",
            actuator=da.FAN,
            value=0,
            reason=(
                f"درجة الحرارة الحالية {_fmt(temp)}°C أقل من الحد الأدنى لاحتياج النبات "
                f"({_fmt(low)}°C) — تم إيقاف المروحة وإغلاق الفتحات للحفاظ على الدفء."
            ),
            severity="warning",
            status="warning",
            status_label="جارٍ الاحتفاظ بالحرارة",
            detail="لا يوجد مسخّن مُركّب على الجهاز الحالي.",
        )
    return Decision(
        system="temperature",
        action="hold",
        actuator=da.FAN,
        value=0,
        reason=(
            f"درجة الحرارة {_fmt(temp)}°C داخل النطاق المستهدف "
            f"({_fmt(low)}°C — {_fmt(high)}°C)."
        ),
        severity="ok",
        status="ok",
        status_label="ضمن النطاق",
    )


def _ventilation_decision(reading, targets, link: da.DeviceLink) -> Decision:
    gate = _sensor_gate(link, da.HUMIDITY)
    target = targets["humidity"]
    low, high, ideal = target["min"], target["max"], target.get("ideal")
    if gate is not None:
        return _hold_for_missing_data(
            "ventilation",
            da.HUMIDITY,
            gate,
            "التهوية التلقائية تحتاج حساس رطوبة هواء مُركّباً وقراءات حديثة.",
        )
    humidity_value = link.sensor_value(da.HUMIDITY, reading)
    if humidity_value is None:
        return _hold_for_missing_data(
            "ventilation", da.HUMIDITY, "لا توجد قراءة حالية لرطوبة الهواء."
        )
    humidity = float(humidity_value)
    if humidity > high:
        overshoot = humidity - high
        fan_speed = max(50.0, min(100.0, 50.0 + overshoot * 2.5))
        vent_pos = max(35.0, min(100.0, 35.0 + overshoot * 3.0))
        return Decision(
            system="ventilation",
            action="on",
            actuator=da.FAN,
            value=round(fan_speed),
            reason=(
                f"رطوبة الهواء الحالية {_fmt(humidity, 0)}% أعلى من الحد الأعلى "
                f"({_fmt(high, 0)}%) — تشغيل التهوية بسرعة {fan_speed:.0f}% "
                f"وفتح الفتحات {vent_pos:.0f}% لتقليل خطر الأمراض الفطرية."
            ),
            severity="warning",
            status="warning",
            status_label="تهوية نشطة",
            detail=f"سيتوقف عند بلوغ {_fmt(ideal if ideal else high, 0)}%.",
        )
    return Decision(
        system="ventilation",
        action="hold",
        actuator=da.FAN,
        value=0,
        reason=(
            f"رطوبة الهواء {_fmt(humidity, 0)}% داخل النطاق المستهدف "
            f"({_fmt(low, 0)}% — {_fmt(high, 0)}%) — لا حاجة للتهوية."
        ),
        severity="ok",
        status="ok",
        status_label="لا حاجة للتهوية",
    )


def _lighting_decision(reading, targets, link: da.DeviceLink) -> Decision:
    gate = _sensor_gate(link, da.LIGHT)
    target = targets["light"]
    low, ideal = target["min"], target.get("ideal") or target["min"]
    if gate is not None:
        return _hold_for_missing_data(
            "lighting",
            da.LIGHT,
            gate,
            "التحكم في الإضاءة يحتاج حساس إضاءة مُركّباً وقراءات حديثة.",
        )
    light_value = link.sensor_value(da.LIGHT, reading)
    if light_value is None:
        return _hold_for_missing_data(
            "lighting", da.LIGHT, "لا توجد قراءة حالية لشدة الإضاءة."
        )
    light = float(light_value)
    if light < low:
        level = max(30.0, min(100.0, ((float(ideal) - light) / float(ideal)) * 100.0))
        return Decision(
            system="lighting",
            action="on",
            actuator=da.GROW_LIGHT,
            value=round(level),
            reason=(
                f"الإضاءة الحالية {_fmt(light, 0)} لوكس أقل من الحد الأدنى لاحتياج النبات "
                f"({_fmt(low, 0)} لوكس) — تشغيل إضاءة النمو بقدرة {level:.0f}%."
            ),
            severity="warning",
            status="warning",
            status_label="الإضاءة مطلوبة",
            detail=f"سيتوقف عند بلوغ {_fmt(ideal, 0)} لوكس.",
        )
    return Decision(
        system="lighting",
        action="off",
        actuator=da.GROW_LIGHT,
        reason=(
            f"الإضاءة الحالية {_fmt(light, 0)} لوكس مناسبة لاحتياج النبات "
            f"({_fmt(low, 0)} لوكس أو أكثر)."
        ),
        severity="ok",
        status="ok",
        status_label="مناسبة",
    )


def evaluate(
    reading,
    targets: dict,
    settings: ControlSettings,
    sensors: dict,
    link: da.DeviceLink,
) -> list[Decision]:
    """Run every rule once and return one decision per system.

    Missing sensor data NEVER produces a control action: when the reading
    stream itself is stale/unavailable the four data-driven loops hold, and the
    tank rule still runs because it does not depend on the reading stream at
    all. Only the pump protections keep the authority to *stop* hardware.
    """
    tank = _tank_decision(settings, link)

    if sensors.get("available"):
        decisions = [
            _irrigation_decision(reading, targets, settings, tank, link),
            _temperature_decision(reading, targets, link),
            _ventilation_decision(reading, targets, link),
            _lighting_decision(reading, targets, link),
            tank,
        ]
    else:
        detail = sensors.get("detail") or "لا تصل قراءات حديثة من الحساسات."
        decisions = [
            Decision(
                system=system,
                action="hold",
                reason=f"تم تعليق القرار التلقائي — {detail}",
                severity="warning",
                status="unknown",
                status_label="بانتظار البيانات",
                detail="لا يُتخذ أي إجراء على بيانات قديمة أو مفقودة.",
            )
            for system in ("irrigation", "temperature", "ventilation", "lighting")
        ]
        decisions.append(tank)

    # Maximum-runtime / no-flow protection outranks the normal irrigation rule
    # and may still stop the pump even while readings are stale (it depends on
    # the flow sensor, not on the reading stream).
    guard = _pump_runtime_guard(settings, link)
    if guard is not None:
        decisions[0] = guard
    return decisions


def merge_actuator_commands(decisions: list[Decision]) -> list[Decision]:
    """Resolve competing demands on a shared actuator (max demand wins)."""
    by_actuator: dict[str, Decision] = {}
    passthrough: list[Decision] = []
    for decision in decisions:
        if decision.actuator is None or decision.action not in ("on", "off", "set"):
            passthrough.append(decision)
            continue
        current = by_actuator.get(decision.actuator)
        if current is None:
            by_actuator[decision.actuator] = decision
            continue
        if decision.action == "off" and current.action != "off":
            continue
        if current.action == "off" and decision.action != "off":
            by_actuator[decision.actuator] = decision
        elif (decision.value or 0) > (current.value or 0):
            by_actuator[decision.actuator] = decision
    return passthrough + list(by_actuator.values())


def with_valve(decisions: list[Decision], link: da.DeviceLink) -> list[Decision]:
    """Couple the irrigation valve to the pump when the valve is installed.

    Opening order (valve → pump) and closing order (pump → valve) matter for
    real plumbing, so the valve command is inserted before an "on" and after an
    "off".
    """
    if not link.supports(da.VALVE):
        return decisions
    expanded: list[Decision] = []
    for decision in decisions:
        if decision.actuator != da.PUMP or decision.action not in ("on", "off"):
            expanded.append(decision)
            continue
        valve = Decision(
            system=decision.system,
            action=decision.action,
            actuator=da.VALVE,
            reason=(
                "فتح صمام الري قبل تشغيل المضخة."
                if decision.action == "on"
                else "إغلاق صمام الري بعد إيقاف المضخة."
            ),
            severity=decision.severity,
            status=decision.status,
            status_label=decision.status_label,
            detail="",
        )
        if decision.action == "on":
            expanded.extend([valve, decision])
        else:
            expanded.extend([decision, valve])
    return expanded


# ---------------------------------------------------------------------------
# Persistence of intents + control log
# ---------------------------------------------------------------------------
def _should_log(db: Session, plant_id: int, signature: str, severity: str) -> bool:
    last = (
        db.query(ControlEvent)
        .filter(ControlEvent.plant_id == plant_id, ControlEvent.signature == signature)
        .order_by(ControlEvent.id.desc())
        .first()
    )
    if last is None:
        return True
    created = last.created_at
    if created is not None and created.tzinfo is None:
        created = created.replace(tzinfo=timezone.utc)
    if created is None:
        return True
    age = datetime.now(timezone.utc) - created
    if severity in ("warning", "critical"):
        return age >= timedelta(minutes=REPEAT_ALERT_MINUTES)
    return False


def _should_log_change(db: Session, plant_id: int, system: str, signature: str) -> bool:
    last = (
        db.query(ControlEvent)
        .filter(ControlEvent.plant_id == plant_id, ControlEvent.system == system)
        .order_by(ControlEvent.id.desc())
        .first()
    )
    return last is None or last.signature != signature


def record_event(
    db: Session,
    plant_id: int,
    *,
    system: str,
    action: str,
    reason: str,
    result: str,
    severity: str = "info",
    source: str = "auto",
    actuator: str | None = None,
    value: float | None = None,
    signature: str = "",
    result_detail: str | None = None,
) -> ControlEvent:
    event = ControlEvent(
        plant_id=plant_id,
        system=system,
        actuator=actuator,
        action=action,
        value=value,
        reason=reason,
        result=result,
        result_detail=result_detail,
        source=source,
        severity=severity,
        signature=signature,
    )
    db.add(event)
    db.commit()
    db.refresh(event)
    return event


def safe_run_control_cycle(db: Session, plant_id: int | None, reading) -> None:
    """Control must never break the sensor pipeline."""
    if plant_id is None:
        return
    try:
        run_control_cycle(db, plant_id, reading)
    except Exception:  # noqa: BLE001 - never surface control errors to ingest
        db.rollback()
        logger.exception("Control cycle failed for plant_id=%s", plant_id)


def _set_intent(
    settings: ControlSettings,
    actuator: str,
    on: bool,
    value: float | None,
    source: str,
) -> None:
    intents = dict(settings.actuators or {})
    entry = dict(intents.get(actuator) or {})
    now = datetime.now(timezone.utc)
    if on and not entry.get("on"):
        entry["last_started_at"] = now.isoformat()
    if entry.get("on") != on:
        entry["last_changed_at"] = now.isoformat()
    entry.update({"on": on, "value": value, "updated_at": now.isoformat(), "source": source})
    intents[actuator] = entry
    settings.actuators = intents


def _debounce_remaining(settings: ControlSettings, actuator: str) -> float | None:
    """Seconds left before this actuator may switch again (None when allowed)."""
    entry = (settings.actuators or {}).get(actuator) or {}
    changed = entry.get("last_changed_at")
    if not changed:
        return None
    try:
        changed_at = datetime.fromisoformat(str(changed))
    except ValueError:
        return None
    if changed_at.tzinfo is None:
        changed_at = changed_at.replace(tzinfo=timezone.utc)
    elapsed = (datetime.now(timezone.utc) - changed_at).total_seconds()
    remaining = ACTUATOR_MIN_SWITCH_SECONDS - elapsed
    return remaining if remaining > 0 else None


def apply_decision(
    db: Session,
    plant: Plant,
    settings: ControlSettings,
    decision: Decision,
    adapter: da.BaseDeviceAdapter,
    source: str = "auto",
) -> ControlEvent | None:
    """Deliver one decision to hardware and log it. Returns the logged event."""
    if decision.actuator is None:
        if not _should_log_change(db, plant.id, decision.system, decision.signature):
            return None
        return record_event(
            db,
            plant.id,
            system=decision.system,
            action=decision.action,
            reason=decision.reason,
            result="info",
            severity=decision.severity,
            source="safety" if decision.severity in ("warning", "critical") else source,
            signature=decision.signature,
            result_detail=decision.detail or None,
        )

    if decision.action == "hold":
        if not _should_log_change(db, plant.id, decision.system, decision.signature):
            return None
        return record_event(
            db,
            plant.id,
            system=decision.system,
            action="hold",
            reason=decision.reason,
            result="info",
            severity="info" if decision.severity == "ok" else decision.severity,
            source=source,
            actuator=decision.actuator,
            signature=decision.signature,
            result_detail=decision.detail or None,
        )

    if decision.action == "block":
        if not _should_log(db, plant.id, decision.signature, decision.severity):
            return None
        return record_event(
            db,
            plant.id,
            system=decision.system,
            action="block",
            reason=decision.reason,
            result="blocked",
            severity=decision.severity,
            source="safety",
            actuator=decision.actuator,
            signature=decision.signature,
            result_detail=decision.detail or None,
        )

    # Debounce: never rapid-cycle an actuator (safety-critical stops excepted).
    if decision.severity != "critical" and decision.action in ("on", "off"):
        remaining = _debounce_remaining(settings, decision.actuator)
        if remaining is not None:
            signature = f"debounce|{decision.actuator}|{decision.action}"
            if _should_log_change(db, plant.id, decision.system, signature):
                return record_event(
                    db,
                    plant.id,
                    system=decision.system,
                    action="hold",
                    reason=(
                        f"تم تأجيل أمر «{ACTION_LABELS.get(decision.action, decision.action)}» "
                        f"لـ{ACTUATOR_META[decision.actuator]['label']} لمنع التشغيل والإيقاف المتكرر."
                    ),
                    result="info",
                    severity="info",
                    source=source,
                    actuator=decision.actuator,
                    signature=signature,
                    result_detail=f"يمكن إعادة الإرسال بعد {int(remaining)} ثانية.",
                )
            return None

    if not _should_log_change(db, plant.id, decision.system, decision.signature):
        return None

    command = da.ActuatorCommand(
        actuator=decision.actuator,
        action=decision.action,
        value=decision.value,
        duration_sec=decision.duration_sec,
        reason=decision.reason,
    )
    outcome = adapter.send(command)
    on = decision.action in ("on", "set")
    _set_intent(settings, decision.actuator, on, decision.value, source)

    if command.actuator == da.PUMP and on:
        _track_water_usage(settings, command.duration_sec or 5, adapter.link)
    settings.updated_at = datetime.now(timezone.utc)
    db.commit()

    if outcome.status == "queued":
        result_detail = outcome.detail
    else:
        result_detail = f"{outcome.detail} — القرار مسجّل ولم يُنفَّذ على أجهزة حقيقية."

    return record_event(
        db,
        plant.id,
        system=decision.system,
        action=decision.action,
        reason=decision.reason,
        result=outcome.status,
        severity=decision.severity,
        source=source,
        actuator=decision.actuator,
        value=decision.value,
        signature=decision.signature,
        result_detail=result_detail,
    )


def _track_water_usage(
    settings: ControlSettings, duration_sec: int, link: da.DeviceLink | None = None
) -> None:
    """Estimated consumption — skipped when a real flow sensor provides it."""
    today = datetime.now().strftime("%Y-%m-%d")
    if settings.water_used_date != today:
        settings.water_used_date = today
        settings.water_used_today_l = 0.0
    if link is not None and link.has_flow_sensor():
        # A flow sensor is wired, so consumption must come from the real
        # measurements (device acknowledgement), never from an estimate —
        # otherwise the two figures would be added together.
        return
    settings.water_used_today_l = round(
        (settings.water_used_today_l or 0.0) + WATER_FLOW_L_PER_MIN * (duration_sec / 60.0), 2
    )


# ---------------------------------------------------------------------------
# Control cycle
# ---------------------------------------------------------------------------
def run_control_cycle(db: Session, plant_id: int, reading) -> CycleResult:
    """Full Sensing → Decision → Actuation → Logging pass for one plant."""
    plant = db.get(Plant, plant_id)
    if plant is None:
        return CycleResult()

    settings = get_or_create_settings(db, plant)
    targets, _ = resolve_targets(db, plant, settings)
    sensors = sensor_state(reading)
    link = da.build_link(db, plant)
    adapter = da.get_adapter(db, plant, link)

    decisions = evaluate(reading, targets, settings, sensors, link)
    result = CycleResult(decisions=decisions)

    if not settings.emergency_stop:
        result.events.extend(process_schedules(db, plant, settings, adapter))

    if settings.emergency_stop:
        for decision in decisions:
            if decision.severity in ("critical", "warning") and _should_log(
                db, plant.id, decision.signature, "critical"
            ):
                result.events.append(
                    record_event(
                        db,
                        plant.id,
                        system=decision.system,
                        action="block",
                        reason="النظام في حالة إيقاف طارئ — لا يتم تنفيذ أي أمر حتى تأكيد المستخدم.",
                        result="blocked",
                        severity="warning",
                        source="safety",
                        actuator=decision.actuator,
                        signature=f"estopped|{decision.signature}",
                        result_detail=settings.emergency_stop_reason or None,
                    )
                )
        return result

    if settings.mode == "auto":
        for decision in with_valve(merge_actuator_commands(decisions), link):
            event = apply_decision(db, plant, settings, decision, adapter)
            if event is not None:
                result.events.append(event)

    # Alerts are derived last so they see the state the cycle just produced.
    result.events.extend(log_cycle_alerts(db, plant, settings, targets, reading, decisions, link, sensors))
    return result


def log_cycle_alerts(
    db: Session,
    plant: Plant,
    settings: ControlSettings,
    targets: dict,
    reading,
    decisions: list[Decision],
    link: da.DeviceLink,
    sensors: dict,
) -> list[ControlEvent]:
    from app.services.alerts import build_alerts, log_alerts

    alerts = build_alerts(
        settings=settings,
        targets=targets,
        reading=reading,
        decisions=decisions,
        link=link,
        sensors=sensors,
    )
    return log_alerts(db, plant.id, alerts, record_event)


def active_alerts(
    db: Session,
    plant: Plant,
    settings: ControlSettings,
    targets: dict,
    reading,
    decisions: list[Decision],
    link: da.DeviceLink,
    sensors: dict,
) -> list[dict]:
    from app.services.alerts import (
        build_alerts,
        failed_command_alerts,
        recent_protection_alerts,
    )

    alerts = build_alerts(
        settings=settings,
        targets=targets,
        reading=reading,
        decisions=decisions,
        link=link,
        sensors=sensors,
    )
    alerts.extend(failed_command_alerts(db, link))
    alerts.extend(recent_protection_alerts(db, plant.id))
    ordered = sorted(
        alerts,
        key=lambda item: {"critical": 0, "warning": 1, "info": 2}.get(item.severity, 3),
    )
    return [alert.as_dict() for alert in ordered]


# ---------------------------------------------------------------------------
# Manual control / modes / safety
# ---------------------------------------------------------------------------
def manual_command(
    db: Session,
    plant: Plant,
    actuator: str,
    action: str,
    value: float | None = None,
    duration_sec: int | None = None,
) -> ControlEvent:
    """Apply a user's manual command, respecting safety conditions."""
    settings = get_or_create_settings(db, plant)
    link = da.build_link(db, plant)
    adapter = da.get_adapter(db, plant, link)
    system = _system_for_actuator(actuator)
    label = ACTUATOR_META.get(actuator, {}).get("label", actuator)

    # Impossible / unsupported commands are refused before anything is queued.
    if actuator not in da.ACTUATOR_KEYS:
        return record_event(
            db,
            plant.id,
            system=system,
            action=action,
            reason=f"أمر غير معروف: «{actuator}» ليس مشغّلاً معروفاً في النظام.",
            result="unsupported",
            severity="warning",
            source="manual",
            actuator=actuator,
            value=value,
            signature=f"manual|{actuator}|unknown",
            result_detail="المشغّلات المتاحة: مضخة الري، صمام الري، المروحة، الفتحات، إضاءة النمو.",
        )

    if action not in ("on", "off", "set"):
        return record_event(
            db,
            plant.id,
            system=system,
            action=action,
            reason=f"إجراء غير صالح «{action}» — الإجراءات المتاحة: تشغيل، إيقاف، ضبط.",
            result="unsupported",
            severity="warning",
            source="manual",
            actuator=actuator,
            value=value,
            signature=f"manual|{actuator}|{action}|bad",
            result_detail="تم رفض الأمر دون إرساله إلى الجهاز.",
        )

    if action == "set" and value is not None and ACTUATOR_META.get(actuator, {}).get("unit") == "%":
        if not 0 <= float(value) <= 100:
            return record_event(
                db,
                plant.id,
                system=system,
                action=action,
                reason=f"قيمة غير صالحة لـ{label}: {value}% — النطاق المسموح 0% إلى 100%.",
                result="blocked",
                severity="warning",
                source="manual",
                actuator=actuator,
                value=value,
                signature=f"manual|{actuator}|range",
                result_detail="تم رفض الأمر قبل إرساله إلى الجهاز.",
            )

    def blocked(reason: str, detail: str | None = None) -> ControlEvent:
        return record_event(
            db,
            plant.id,
            system=system,
            action=action,
            reason=reason,
            result="blocked",
            severity="warning",
            source="manual",
            actuator=actuator,
            value=value,
            signature=f"manual|{actuator}|blocked|{reason[:40]}",
            result_detail=detail,
        )

    if settings.emergency_stop:
        return blocked(
            "لا يمكن تنفيذ أمر يدوي أثناء الإيقاف الطارئ. أعد التفعيل أولاً.",
            settings.emergency_stop_reason,
        )

    if actuator in (da.PUMP, da.VALVE) and action in ("on", "set"):
        tank = _tank_decision(settings, link)
        if tank.action == "block":
            return blocked(tank.reason, "حماية المضخة منعت التشغيل.")
        if actuator == da.PUMP:
            elapsed = _pump_seconds_since_start(settings)
            if elapsed is not None and elapsed < PUMP_MIN_INTERVAL_SECONDS:
                return blocked(
                    "تم منع ري متكرر غير منطقي — المضخة شُغّلت قبل أقل من دقيقة.",
                    f"آخر تشغيل منذ {int(elapsed)} ثانية.",
                )

    on = action in ("on", "set")
    _set_intent(settings, actuator, on, value, "manual")
    settings.updated_at = datetime.now(timezone.utc)
    db.commit()

    outcome = adapter.send(
        da.ActuatorCommand(
            actuator=actuator,
            action=action,
            value=value,
            duration_sec=duration_sec or (10 if actuator == da.PUMP else None),
            reason=f"أمر يدوي من المستخدم لتشغيل {label}.",
        )
    )
    if actuator == da.PUMP and on:
        _track_water_usage(settings, duration_sec or 10, link)
        db.commit()

    detail = outcome.detail
    # "executed" already carries its own source note (the software bench), so
    # only genuinely non-executed outcomes get the disclaimer.
    if outcome.status not in ("queued", "executed"):
        detail = f"{outcome.detail} — تم تسجيل الأمر ولم يُنفَّذ على أجهزة حقيقية."

    return record_event(
        db,
        plant.id,
        system=system,
        action=action,
        reason=f"تحكم يدوي من المستخدم: {label} — {_action_label(action)}.",
        result=outcome.status,
        severity="info",
        source="manual",
        actuator=actuator,
        value=value,
        signature=f"manual|{actuator}|{action}|{value}",
        result_detail=detail,
    )


def set_mode(db: Session, plant: Plant, mode: str) -> ControlSettings:
    if mode not in MODE_LABELS:
        raise ValueError("invalid mode")
    settings = get_or_create_settings(db, plant)
    settings.mode = mode
    settings.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(settings)
    record_event(
        db,
        plant.id,
        system="system",
        action="set_mode",
        reason=f"تم تغيير وضع التشغيل إلى «{MODE_LABELS[mode]}».",
        result="executed",
        severity="info",
        source="manual",
        signature=f"mode|{mode}",
    )
    return settings


def emergency_stop(db: Session, plant: Plant, reason: str | None = None) -> list[ControlEvent]:
    settings = get_or_create_settings(db, plant)
    link = da.build_link(db, plant)
    adapter = da.get_adapter(db, plant, link)
    events: list[ControlEvent] = []

    settings.emergency_stop = True
    settings.emergency_stop_reason = reason or "إيقاف طارئ بواسطة المستخدم."
    now = datetime.now(timezone.utc)

    # Plumbed order: stop the pump before closing the valve.
    for actuator in (da.PUMP, da.VALVE, da.FAN, da.VENT, da.GROW_LIGHT):
        _set_intent(settings, actuator, False, 0, "safety")
        outcome = adapter.send(
            da.ActuatorCommand(actuator=actuator, action="off", reason="إيقاف طارئ.")
        )
        if outcome.status == "queued":
            events.append(
                record_event(
                    db,
                    plant.id,
                    system=_system_for_actuator(actuator),
                    action="off",
                    reason="إيقاف طارئ: تم إيقاف جميع وحدات التنفيذ.",
                    result="queued",
                    severity="critical",
                    source="safety",
                    actuator=actuator,
                    signature=f"estop|{actuator}",
                    result_detail=outcome.detail,
                )
            )
    settings.updated_at = now
    db.commit()
    events.append(
        record_event(
            db,
            plant.id,
            system="system",
            action="emergency_stop",
            reason="تم تفعيل الإيقاف الطارئ وإيقاف جميع وحدات التنفيذ.",
            result="executed",
            severity="critical",
            source="safety",
            signature="estop|on",
            result_detail="لن يعود النظام للعمل تلقائياً قبل تأكيد المستخدم.",
        )
    )
    return events


def clear_emergency(db: Session, plant: Plant) -> ControlSettings:
    settings = get_or_create_settings(db, plant)
    settings.emergency_stop = False
    settings.emergency_stop_reason = None
    settings.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(settings)
    record_event(
        db,
        plant.id,
        system="system",
        action="emergency_reset",
        reason="تم إلغاء الإيقاف الطارئ ويمكن للنظام استئناف التحكم.",
        result="executed",
        severity="info",
        source="manual",
        signature="estop|off",
    )
    return settings


# ---------------------------------------------------------------------------
# Schedules
# ---------------------------------------------------------------------------
def process_schedules(
    db: Session, plant: Plant, settings: ControlSettings, adapter: da.BaseDeviceAdapter
) -> list[ControlEvent]:
    now = datetime.now()
    events: list[ControlEvent] = []
    schedules = (
        db.query(ControlSchedule)
        .filter(
            ControlSchedule.plant_id == plant.id,
            ControlSchedule.enabled == True,  # noqa: E712 - SQLAlchemy column compare
        )
        .all()
    )
    for schedule in schedules:
        if not _schedule_due(schedule, now):
            continue
        actuator = schedule.actuator or _actuator_for_system(schedule.system)
        if actuator is None:
            continue
        outcome = adapter.send(
            da.ActuatorCommand(
                actuator=actuator,
                action=schedule.action,
                value=schedule.value,
                duration_sec=schedule.duration_sec or None,
                reason=f"جدولة {schedule.time_of_day}.",
            )
        )
        _set_intent(
            settings,
            actuator,
            schedule.action in ("on", "set"),
            schedule.value,
            "schedule",
        )
        if actuator == da.PUMP and schedule.action in ("on", "set"):
            _track_water_usage(settings, schedule.duration_sec or 10, adapter.link)
        schedule.last_run_at = datetime.now(timezone.utc)
        settings.updated_at = datetime.now(timezone.utc)
        db.commit()
        detail = outcome.detail
        if outcome.status != "queued":
            detail = f"{outcome.detail} — تم تسجيل الأمر ولم يُنفَّذ على أجهزة حقيقية."
        events.append(
            record_event(
                db,
                plant.id,
                system=schedule.system,
                action=schedule.action,
                reason=f"تنفيذ جدولة {schedule.time_of_day} — {_action_label(schedule.action)}.",
                result=outcome.status,
                severity="info",
                source="schedule",
                actuator=actuator,
                value=schedule.value,
                signature=f"schedule|{schedule.id}|{schedule.time_of_day}",
                result_detail=detail,
            )
        )
    return events


def _schedule_due(schedule: ControlSchedule, now: datetime) -> bool:
    if now.weekday() not in (schedule.days or []):
        # Python: Monday=0. The UI sends 0=Sunday..6=Saturday.
        if ((now.weekday() + 1) % 7) not in (schedule.days or []):
            return False
    try:
        hour, minute = (int(part) for part in schedule.time_of_day.split(":"))
    except (ValueError, AttributeError):
        return False
    scheduled = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
    delta = (now - scheduled).total_seconds()
    if delta < 0 or delta >= 90:
        return False
    last = schedule.last_run_at
    if last is not None:
        if last.tzinfo is None:
            last = last.replace(tzinfo=timezone.utc)
        if (datetime.now(timezone.utc) - last).total_seconds() < 3600:
            return False
    return True


# ---------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------
ACTUATOR_SYSTEM = {
    da.PUMP: "irrigation",
    da.VALVE: "irrigation",
    da.FAN: "ventilation",
    da.VENT: "ventilation",
    da.GROW_LIGHT: "lighting",
    da.TANK: "water_tank",
}


def _system_for_actuator(actuator: str) -> str:
    return ACTUATOR_SYSTEM.get(actuator, "system")


def _actuator_for_system(system: str) -> str | None:
    for actuator, mapped in ACTUATOR_SYSTEM.items():
        if mapped == system:
            return actuator
    return None


# Public aliases (the router and any future integration should not reach into
# underscore-prefixed helpers).
actuator_for_system = _actuator_for_system
system_for_actuator = _system_for_actuator


def _action_label(action: str) -> str:
    return ACTION_LABELS.get(action, action)


def actuator_state_label(actuator: str, intent: dict, capability: da.Capability | None) -> str:
    """Human label for one actuator — always honest about the hardware."""
    if capability is None or not capability.supported:
        return "غير متاح"
    if not capability.online:
        return "غير متصل"
    on = bool(intent.get("on"))
    value = intent.get("value")
    meta = ACTUATOR_META.get(actuator, {})
    if actuator in (da.PUMP, da.VALVE, da.GROW_LIGHT) and meta.get("unit") is None:
        return "يعمل" if on else "متوقف"
    if on:
        if meta.get("unit") == "%" and value is not None:
            return f"يعمل — {value:.0f}%"
        return "يعمل"
    if meta.get("unit") == "%":
        return f"مغلق — {value:.0f}%" if value else "مغلق"
    return "متوقف"


def event_to_dict(event: ControlEvent) -> dict:
    if event.created_at is not None:
        created = event.created_at
        if created.tzinfo is None:
            created = created.replace(tzinfo=timezone.utc)
        time_label = created.astimezone().strftime("%H:%M")
        iso = created.isoformat()
    else:
        time_label, iso = "", ""
    return {
        "id": event.id,
        "plant_id": event.plant_id,
        "system": event.system,
        "system_label": SYSTEM_META.get(event.system, {}).get(
            "label", "تنبيهات النظام" if event.system == "alert" else event.system
        ),
        "actuator": event.actuator,
        "actuator_label": ACTUATOR_META.get(event.actuator or "", {}).get("label"),
        "action": event.action,
        "action_label": _action_label(event.action),
        "value": event.value,
        "reason": event.reason,
        "result": event.result,
        "result_label": RESULT_LABELS.get(event.result, event.result),
        "result_detail": event.result_detail,
        "source": event.source,
        "source_label": SOURCE_LABELS.get(event.source, event.source),
        "severity": event.severity,
        "time_label": time_label,
        "created_at": iso,
    }


def schedule_to_dict(schedule: ControlSchedule) -> dict:
    actuator = schedule.actuator or _actuator_for_system(schedule.system)
    last = schedule.last_run_at
    if last is not None and last.tzinfo is None:
        last = last.replace(tzinfo=timezone.utc)
    return {
        "id": schedule.id,
        "plant_id": schedule.plant_id,
        "system": schedule.system,
        "system_label": SYSTEM_META.get(schedule.system, {}).get("label", schedule.system),
        "actuator": actuator,
        "actuator_label": ACTUATOR_META.get(actuator or "", {}).get("label"),
        "action": schedule.action,
        "action_label": _action_label(schedule.action),
        "value": schedule.value,
        "duration_sec": schedule.duration_sec,
        "time_of_day": schedule.time_of_day,
        "days": schedule.days or [],
        "enabled": schedule.enabled,
        "note": schedule.note,
        "last_run_at": last.isoformat() if last else None,
    }


PIPELINE_STAGES = [
    "قراءة الحساسات",
    "احتياج النبات",
    "الظروف الحالية",
    "شروط السلامة",
    "قواعد التحكم",
    "القرار",
    "أمر التنفيذ",
    "تأكيد الجهاز",
    "التغذية الراجعة",
]

SYSTEM_SENSOR = {
    "irrigation": da.SOIL,
    "temperature": da.TEMP,
    "ventilation": da.HUMIDITY,
    "lighting": da.LIGHT,
    "water_tank": da.WATER_LEVEL,
}


def _measure_text(sensor_key: str | None, reading, link: da.DeviceLink) -> dict:
    if sensor_key is None:
        return {"label": "—", "value": None, "unit": "", "text": "لا يوجد حساس", "available": False}
    meta = SENSOR_META[sensor_key]
    available = link.sensor_usable(sensor_key)
    value = link.sensor_value(sensor_key, reading) if available else None
    if value is None:
        text = "لا توجد قراءة"
    elif meta["digits"] == 0:
        text = f"{value:,.0f} {meta['unit']}".strip()
    else:
        text = f"{value:,.{meta['digits']}f} {meta['unit']}".strip()
    return {
        "label": meta["label"],
        "value": value,
        "unit": meta["unit"],
        "text": text,
        "available": available and value is not None,
    }


def _target_text(sensor_key: str | None, targets: dict) -> dict:
    if sensor_key is None or sensor_key not in targets:
        return {"label": "—", "min": None, "max": None, "ideal": None, "text": "—"}
    meta = TARGET_META[sensor_key]
    target = targets[sensor_key]
    if sensor_key == "light":
        text = f"{target['min']:,.0f} — {target['max']:,.0f} {meta['unit']}"
    elif sensor_key == "temperature":
        text = f"{target['min']:.1f}{meta['unit']} — {target['max']:.1f}{meta['unit']}"
    else:
        text = f"{target['min']:.0f}{meta['unit']} — {target['max']:.0f}{meta['unit']}"
    return {
        "label": meta["label"],
        "min": target["min"],
        "max": target["max"],
        "ideal": target.get("ideal"),
        "unit": meta["unit"],
        "text": text,
    }


def build_snapshot(db: Session, plant: Plant, reading) -> dict:
    """Everything the Dashboard needs for one plant, in one response."""
    settings = get_or_create_settings(db, plant)
    targets, targets_source = resolve_targets(db, plant, settings)
    sensors = sensor_state(reading)
    link = da.build_link(db, plant)
    decisions = evaluate(reading, targets, settings, sensors, link)
    by_system = {decision.system: decision for decision in decisions}
    intents = settings.actuators or {}
    tank_state = _tank_state(settings, link)

    systems: list[dict] = []
    for key, meta in SYSTEM_META.items():
        decision = by_system.get(key)
        sensor_key = SYSTEM_SENSOR.get(key)
        actuator_rows = []
        capability_supported = False
        for actuator in meta["actuators"]:
            capability = link.actuator_capability(actuator)
            supported = bool(capability and capability.supported)
            online = bool(capability and capability.online)
            capability_supported = capability_supported or (supported and online)
            intent = intents.get(actuator) or {}
            reported = link.actuator_states.get(actuator)
            actuator_rows.append(
                {
                    "key": actuator,
                    "label": ACTUATOR_META[actuator]["label"],
                    "icon": ACTUATOR_META[actuator]["icon"],
                    "unit": ACTUATOR_META[actuator]["unit"],
                    "supported": supported,
                    "online": online,
                    "support_reason": link.reason_for(actuator),
                    "capability_status": capability.status if capability else "no_device",
                    "capability_status_label": (
                        capability.as_dict()["status_label"] if capability else "غير متصل"
                    ),
                    # A simulated output is executable but is never hardware: the
                    # UI must label it instead of presenting it as a device.
                    "simulated": bool(capability and capability.simulated),
                    "hardware_dependent": not (supported and online),
                    # Variable output (0-100%) vs plain on/off. The firmware's
                    # own declaration wins when it made one; otherwise RAYY falls
                    # back to the actuator model. Either way the UI never offers
                    # a dimmer for an output that cannot dim.
                    "variable": _is_variable(actuator, capability),
                    # Intent = what RAYY last commanded; reported = what the device says.
                    "on": bool(intent.get("on")),
                    "value": intent.get("value"),
                    "state_label": actuator_state_label(actuator, intent, capability),
                    "reported": reported.as_dict() if reported else None,
                }
            )
        if key == "water_tank":
            capability_supported = False
            tank_capability = link.sensor_capability(da.WATER_LEVEL)
            actuator_rows = [
                {
                    "key": da.TANK,
                    "label": ACTUATOR_META[da.TANK]["label"],
                    "icon": ACTUATOR_META[da.TANK]["icon"],
                    "unit": "%",
                    "supported": bool(tank_capability and tank_capability.supported),
                    "online": bool(tank_capability and tank_capability.online),
                    "support_reason": tank_capability.reason if tank_capability else "",
                    "capability_status": tank_capability.status if tank_capability else "no_device",
                    "capability_status_label": (
                        tank_capability.as_dict()["status_label"] if tank_capability else "غير متصل"
                    ),
                    "simulated": False,
                    "hardware_dependent": not bool(tank_capability and tank_capability.supported),
                    "variable": False,
                    "on": tank_state["pct"] is not None,
                    "value": tank_state["pct"],
                    "state_label": tank_state["source_label"],
                    "reported": None,
                }
            ]

        systems.append(
            {
                "key": key,
                "label": meta["label"],
                "icon": meta["icon"],
                "description": meta["description"],
                "active": meta["active"],
                "status": decision.status if decision else "unknown",
                "status_label": decision.status_label if decision else STATUS_LABELS["unknown"],
                "severity": decision.severity if decision else "info",
                "reason": decision.reason if decision else "",
                "detail": decision.detail if decision else "",
                "action": decision.action if decision else "hold",
                "action_label": _action_label(decision.action) if decision else "—",
                "value": decision.value if decision else None,
                "current": _measure_text(sensor_key, reading, link),
                "target": _target_text(sensor_key, targets),
                "actuators": actuator_rows,
                "capability": {
                    "supported": capability_supported,
                    "reason": "" if capability_supported else (
                        link.reason_for(meta["actuators"][0])
                        if meta["actuators"]
                        else "هذا النظام للمراقبة فقط ولا يحتوي على وحدة تنفيذ."
                    ),
                },
                "controllable": capability_supported,
                "mode": settings.mode,
                "mode_label": MODE_LABELS.get(settings.mode, settings.mode),
                "hardware_dependent": bool(decision.hardware_dependent) if decision else False,
            }
        )

    overall = _overall_status(settings, sensors, link, decisions)
    alerts = active_alerts(db, plant, settings, targets, reading, decisions, link, sensors)

    history = load_history(db, plant.id, limit=25)
    schedules = (
        db.query(ControlSchedule)
        .filter(ControlSchedule.plant_id == plant.id)
        .order_by(ControlSchedule.time_of_day)
        .all()
    )

    flow_sensor = link.has_flow_sensor()
    flow_real = link.uses_real_flow()

    return {
        "plant": {"id": plant.id, "nickname": plant.nickname, "species": plant.species},
        "mode": settings.mode,
        "mode_label": MODE_LABELS.get(settings.mode, settings.mode),
        "modes": [{"key": key, "label": label} for key, label in MODE_LABELS.items()],
        "emergency_stop": settings.emergency_stop,
        "emergency_stop_reason": settings.emergency_stop_reason,
        "overall_status": overall,
        "sensors": sensors,
        "sensor_details": sensor_details(reading, link),
        "device_link": link.as_dict(),
        "targets": {
            key: {**value, "label": TARGET_META[key]["label"], "unit": TARGET_META[key]["unit"]}
            for key, value in targets.items()
        },
        "targets_source": targets_source,
        "systems": systems,
        "controlled_systems": [
            {"key": item["key"], "label": item["label"], "icon": item["icon"]}
            for item in systems
            if item["active"]
        ],
        "tank": {
            "known": tank_state["pct"] is not None,
            "level_pct": tank_state["pct"],
            "source": tank_state["source"],
            "source_label": tank_state["source_label"],
            "sensor_available": link.sensor_usable(da.WATER_LEVEL),
            "sensor_reason": (
                link.sensor_capability(da.WATER_LEVEL).reason
                if link.sensor_capability(da.WATER_LEVEL)
                else ""
            ),
            "capacity_l": settings.water_tank_capacity_l,
            "used_today_l": settings.water_used_today_l or 0.0,
            "used_today_estimated": not flow_sensor,
            "used_today_source_label": (
                "قياس حساس التدفق" if flow_sensor else "تقديري (لا يوجد حساس تدفق)"
            ),
            "flow_lpm": link.flow_lpm if flow_sensor else None,
            "flow_sensor_available": flow_sensor,
            "status": by_system["water_tank"].status if "water_tank" in by_system else "unknown",
            "status_label": (
                by_system["water_tank"].status_label
                if "water_tank" in by_system
                else STATUS_LABELS["unknown"]
            ),
            "warning": by_system["water_tank"].reason if "water_tank" in by_system else "",
            "critical_pct": TANK_CRITICAL_PCT,
            "low_pct": TANK_LOW_PCT,
        },
        "safety": {
            "pump_max_runtime_seconds": pump_max_runtime_seconds(settings),
            "pump_max_runtime_default_seconds": PUMP_MAX_RUNTIME_SECONDS,
            "pump_max_runtime_is_default": settings.irrigation_max_runtime_sec is None,
            "pump_max_runtime_bounds": [PUMP_MIN_MAX_RUNTIME_SECONDS, PUMP_MAX_MAX_RUNTIME_SECONDS],
            "pump_min_interval_seconds": PUMP_MIN_INTERVAL_SECONDS,
            "actuator_min_switch_seconds": ACTUATOR_MIN_SWITCH_SECONDS,
            "sensor_stale_seconds": SENSOR_STALE_SECONDS,
            "flow_min_lpm": FLOW_MIN_LPM,
            "tank_critical_pct": TANK_CRITICAL_PCT,
            "tank_low_pct": TANK_LOW_PCT,
            "rules": [
                {
                    "key": "pump_protection",
                    "label": "إيقاف المضخة عند نقص المياه",
                    "enabled": tank_state["pct"] is not None,
                    "hardware_dependent": not link.sensor_usable(da.WATER_LEVEL),
                    "detail": (
                        "يعمل عبر حساس مستوى المياه."
                        if link.sensor_usable(da.WATER_LEVEL)
                        else (
                            "يعمل عبر القيمة اليدوية."
                            if tank_state["pct"] is not None
                            else "يتطلب تركيب حساس مستوى المياه أو إدخال المستوى يدوياً."
                        )
                    ),
                },
                {
                    "key": "pump_max_runtime",
                    "label": f"أقصى زمن تشغيل للمضخة ({pump_max_runtime_seconds(settings)} ثانية)",
                    "enabled": True,
                    "hardware_dependent": False,
                    "detail": "يعمل في محرك التحكم وفي firmware الجهاز.",
                },
                {
                    "key": "no_flow_detection",
                    "label": "إيقاف المضخة عند انعدام التدفق",
                    "enabled": flow_real,
                    "hardware_dependent": not flow_real,
                    "detail": (
                        "يعمل عبر حساس التدفق."
                        if flow_real
                        else "يتطلب تركيب حساس تدفق المياه."
                    ),
                },
                {
                    "key": "repeat_irrigation",
                    "label": f"منع الري المتكرر خلال {PUMP_MIN_INTERVAL_SECONDS} ثانية",
                    "enabled": True,
                    "hardware_dependent": False,
                    "detail": "يمنع أوامر التشغيل/الإيقاف المتتابعة غير المنطقية.",
                },
                {
                    "key": "sensor_failure",
                    "label": "تعليق القرارات عند فشل الحساسات",
                    "enabled": True,
                    "hardware_dependent": False,
                    "detail": f"تُعتبر القراءات قديمة بعد {SENSOR_STALE_SECONDS // 60} دقيقة.",
                },
                {
                    "key": "emergency_stop",
                    "label": "الإيقاف الطارئ لكل وحدات التنفيذ",
                    "enabled": True,
                    "hardware_dependent": False,
                    "detail": "يرسل أوامر إيقاف حقيقية ويوقف التحكم التلقائي حتى تأكيد المستخدم.",
                },
            ],
        },
        "alerts": alerts,
        "reading": None
        if reading is None
        else {
            "ts": reading.ts,
            "temperature": reading.temperature,
            "humidity": reading.humidity,
            "light": reading.light,
            "soil_moisture": reading.soil_moisture,
            "ph": reading.ph,
        },
        "decisions": [
            {
                "system": decision.system,
                "system_label": SYSTEM_META[decision.system]["label"],
                "action": decision.action,
                "action_label": _action_label(decision.action),
                "actuator": decision.actuator,
                "actuator_label": ACTUATOR_META.get(decision.actuator or "", {}).get("label"),
                "value": decision.value,
                "reason": decision.reason,
                "severity": decision.severity,
                "hardware_dependent": decision.hardware_dependent,
            }
            for decision in decisions
            if decision.severity in ("warning", "critical") or decision.action != "hold"
        ],
        "pipeline": PIPELINE_STAGES,
        "history": history,
        "schedules": [schedule_to_dict(item) for item in schedules],
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }


def _overall_status(settings, sensors, link, decisions) -> dict:
    if settings.emergency_stop:
        return {
            "key": "stopped",
            "label": STATUS_LABELS["stopped"],
            "detail": settings.emergency_stop_reason or "تم إيقاف جميع وحدات التنفيذ.",
        }
    if any(decision.severity == "critical" for decision in decisions):
        worst = next(d for d in decisions if d.severity == "critical")
        return {"key": "critical", "label": STATUS_LABELS["critical"], "detail": worst.reason}
    if not link.connected and link.device_id is None:
        return {
            "key": "offline",
            "label": STATUS_LABELS["offline"],
            "detail": "لا يوجد جهاز مرتبط بهذه النبتة — المراقبة والتحليل يعملان بلا أجهزة تنفيذ.",
        }
    if any(decision.severity == "warning" for decision in decisions):
        worst = next(d for d in decisions if d.severity == "warning")
        return {"key": "warning", "label": STATUS_LABELS["warning"], "detail": worst.reason}
    if not sensors.get("available"):
        return {
            "key": "warning",
            "label": "معلّق — لا توجد قراءات حديثة",
            "detail": sensors.get("detail", ""),
        }
    return {
        "key": "ok",
        "label": STATUS_LABELS["ok"],
        "detail": "جميع الأنظمة داخل النطاقات المستهدفة.",
    }


def load_history(db: Session, plant_id: int, limit: int = 50) -> list[dict]:
    rows = (
        db.query(ControlEvent)
        .filter(ControlEvent.plant_id == plant_id)
        .order_by(ControlEvent.id.desc())
        .limit(limit)
        .all()
    )
    return [event_to_dict(row) for row in rows]
