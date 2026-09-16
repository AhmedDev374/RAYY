"""Arabic alert engine (نظام التنبيهات).

Alerts are *derived* from real state — readings, decisions, device reports and
the command queue — never invented. Each alert states plainly whether it is a
real, currently-active condition or whether it is waiting on hardware:

    "ارتفاع درجة الحرارة — 32.5°C أعلى من الحد الأعلى 29.0°C"
    "يتطلب تركيب حساس مستوى المياه لتفعيل حماية المضخة"

Alerts are also written to the control log (سجل التحكم) with signature-based
deduplication, so an ongoing condition is recorded once and re-stated on the
cooldown instead of on every 3-second reading.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from app.models import ControlEvent, DeviceCommand
from app.services import device_adapter as da

# Keep in sync with control_engine.REPEAT_ALERT_MINUTES (imported lazily to
# avoid a circular import at module load time).
ALERT_COOLDOWN_MINUTES = 10


@dataclass
class Alert:
    kind: str
    severity: str  # info | warning | critical
    title: str
    detail: str
    action_hint: str = ""
    hardware_dependent: bool = False
    source: str = "system"  # sensor | device | safety | system

    @property
    def signature(self) -> str:
        return f"alert|{self.kind}|{self.severity}"

    def as_dict(self) -> dict:
        return {
            "kind": self.kind,
            "severity": self.severity,
            "title": self.title,
            "detail": self.detail,
            "action_hint": self.action_hint,
            "hardware_dependent": self.hardware_dependent,
            "source": self.source,
            "signature": self.signature,
        }


def build_alerts(
    *,
    settings,
    targets: dict,
    reading,
    decisions: list,
    link: da.DeviceLink,
    sensors: dict,
) -> list[Alert]:
    """Every currently-active alert for one plant, in Arabic."""
    alerts: list[Alert] = []
    alerts.extend(_temperature_alerts(reading, targets, link))
    alerts.extend(_soil_alerts(reading, targets, link))
    alerts.extend(_water_level_alerts(settings, link))
    alerts.extend(_sensor_alerts(sensors, link))
    alerts.extend(_device_alerts(link))
    alerts.extend(_decision_alerts(decisions))
    if getattr(settings, "emergency_stop", False):
        alerts.append(
            Alert(
                kind="emergency_stop",
                severity="critical",
                title="إيقاف طارئ مُفعَّل",
                detail=settings.emergency_stop_reason
                or "تم إيقاف جميع وحدات التنفيذ ومنع أي أمر جديد.",
                action_hint="أكّد إلغاء الإيقاف الطارئ من مركز التحكم لاستئناف العمل.",
                source="safety",
            )
        )
    return alerts


def _temperature_alerts(reading, targets, link: da.DeviceLink) -> list[Alert]:
    if not link.sensor_usable(da.TEMP):
        capability = link.sensor_capability(da.TEMP)
        return [
            Alert(
                kind="temperature_sensor_missing",
                severity="warning",
                title="لا يمكن مراقبة درجة الحرارة",
                detail=(
                    capability.reason
                    if capability
                    else "لم يتم تركيب حساس درجة الحرارة على الجهاز."
                ),
                action_hint="يتطلب تركيب حساس درجة الحرارة (DHT22/DHT11) للتحكم في التهوية.",
                hardware_dependent=True,
                source="sensor",
            )
        ]
    if reading is None:
        return []
    temp = float(reading.temperature)
    high, low = float(targets["temperature"]["max"]), float(targets["temperature"]["min"])
    if temp > high:
        critical = temp >= high + 3
        return [
            Alert(
                kind="high_temperature",
                severity="critical" if critical else "warning",
                title="ارتفاع درجة الحرارة",
                detail=f"درجة الحرارة {temp:.1f}°C أعلى من الحد الأعلى لاحتياج النبات ({high:.1f}°C).",
                action_hint="تشغيل التهوية ورفع سرعة المروحة وفتح فتحات الصوبة.",
                source="sensor",
            )
        ]
    if temp < low:
        return [
            Alert(
                kind="low_temperature",
                severity="warning",
                title="انخفاض درجة الحرارة",
                detail=f"درجة الحرارة {temp:.1f}°C أقل من الحد الأدنى ({low:.1f}°C).",
                action_hint="إغلاق الفتحات وإيقاف التهوية؛ لا يوجد مسخّن مُركّب حالياً.",
                source="sensor",
            )
        ]
    return []


def _soil_alerts(reading, targets, link: da.DeviceLink) -> list[Alert]:
    if not link.sensor_usable(da.SOIL):
        capability = link.sensor_capability(da.SOIL)
        return [
            Alert(
                kind="soil_sensor_missing",
                severity="warning",
                title="لا يمكن مراقبة رطوبة التربة",
                detail=capability.reason if capability else "لم يتم تركيب حساس رطوبة التربة.",
                action_hint="يتطلب تركيب حساس رطوبة التربة لتفعيل الري التلقائي.",
                hardware_dependent=True,
                source="sensor",
            )
        ]
    if reading is None:
        return []
    soil = float(reading.soil_moisture)
    low, high = float(targets["soil_moisture"]["min"]), float(targets["soil_moisture"]["max"])
    if soil <= low:
        return [
            Alert(
                kind="low_soil_moisture",
                severity="warning" if soil > low - 10 else "critical",
                title="انخفاض رطوبة التربة",
                detail=f"رطوبة التربة {soil:.0f}% أقل من الحد الأدنى ({low:.0f}%).",
                action_hint="الري مطلوب — سيقوم RAYY بذلك تلقائياً في الوضع التلقائي.",
                source="sensor",
            )
        ]
    if soil >= high:
        return [
            Alert(
                kind="high_soil_moisture",
                severity="info",
                title="رطوبة تربة مرتفعة",
                detail=f"رطوبة التربة {soil:.0f}% أعلى من الحد الأعلى ({high:.0f}%).",
                action_hint="إيقاف الري حتى تنخفض الرطوبة إلى النطاق المستهدف.",
                source="sensor",
            )
        ]
    return []


def _water_level_alerts(settings, link: da.DeviceLink) -> list[Alert]:
    """Low-water warning — real when the sensor exists, declared otherwise."""
    sensor_ok = link.sensor_usable(da.WATER_LEVEL)
    from app.services.control_engine import TANK_CRITICAL_PCT, _tank_state

    level = _tank_state(settings, link)
    alerts: list[Alert] = []
    if level["source"] == "unknown":
        alerts.append(
            Alert(
                kind="water_level_unknown",
                severity="warning",
                title="مستوى المياه غير معروف",
                detail=(
                    link.sensor_capability(da.WATER_LEVEL).reason
                    if link.sensor_capability(da.WATER_LEVEL)
                    else "لا يوجد حساس مستوى مياه متصل."
                ),
                action_hint=(
                    "حماية المضخة معطّلة (تعتمد على الحساس). "
                    + ("يتطلب تركيب حساس مستوى المياه." if not sensor_ok else "")
                ).strip(),
                hardware_dependent=not sensor_ok,
                source="sensor" if sensor_ok else "system",
            )
        )
        return alerts
    if level["pct"] is not None and level["pct"] <= TANK_CRITICAL_PCT:
        alerts.append(
            Alert(
                kind="low_water_level",
                severity="critical",
                title="انخفاض مستوى المياه",
                detail=f"مستوى المياه {level['pct']:.0f}% — أقل من الحد الحرج ({TANK_CRITICAL_PCT:.0f}%).",
                action_hint="أضف ماءً إلى الخزان. تم منع تشغيل المضخة لحمايتها.",
                source="sensor" if level["source"] == "sensor" else "system",
            )
        )
    elif level["pct"] is not None and level["pct"] <= level["low_pct"]:
        alerts.append(
            Alert(
                kind="water_level_low",
                severity="warning",
                title="مستوى المياه منخفض",
                detail=f"مستوى المياه {level['pct']:.0f}% — أقل من الحد الآمن ({level['low_pct']:.0f}%).",
                action_hint="أعد تعبئة الخزان قبل دورة الري القادمة.",
                source="sensor" if level["source"] == "sensor" else "system",
            )
        )
    return alerts


def _sensor_alerts(sensors: dict, link: da.DeviceLink) -> list[Alert]:
    alerts: list[Alert] = []
    if not sensors.get("available"):
        alerts.append(
            Alert(
                kind="sensor_failure",
                severity="critical" if sensors.get("status") == "unavailable" else "warning",
                title="فشل الحساس أو انقطاع القراءات",
                detail=sensors.get("detail", "لا تصل قراءات حديثة من الحساسات."),
                action_hint="تم تعليق القرارات التلقائية حتى تعود القراءات.",
                source="sensor",
            )
        )
    for capability in link.capabilities.values():
        if capability.kind == "sensor" and capability.status == "error":
            alerts.append(
                Alert(
                    kind=f"sensor_error_{capability.key}",
                    severity="warning",
                    title=f"فشل الحساس — {capability.label}",
                    detail=capability.reason or "الجهاز أبلغ عن فشل قراءة هذا الحساس.",
                    action_hint="تحقّق من توصيل الحساس ومن إعدادات الـfirmware.",
                    source="sensor",
                )
            )
    return alerts


def _device_alerts(link: da.DeviceLink) -> list[Alert]:
    if link.device_id is None:
        return [
            Alert(
                kind="no_device",
                severity="warning",
                title="لا يوجد جهاز مرتبط",
                detail="هذه النبتة غير مرتبطة بأي جهاز، فلا توجد حساسات ولا وحدات تنفيذ.",
                action_hint="اربط جهاز ESP32 من صفحة تهيئة الأجهزة.",
                hardware_dependent=True,
                source="device",
            )
        ]
    if link.source == "simulation":
        return [
            Alert(
                kind="simulated_source",
                severity="info",
                title="وحدة تحكم ذكية متصلة",
                detail="القراءات والأوامر تعمل عبر وحدة التحكم الذكية المرتبطة بهذه النبتة.",
                action_hint="اربط جهازاً ميدانياً لتنفيذ الأوامر على العتاد الفعلي.",
                hardware_dependent=True,
                source="device",
            )
        ]
    if not link.connected:
        age = link.last_seen_seconds
        return [
            Alert(
                kind="device_disconnected",
                severity="critical",
                title="انقطاع اتصال الجهاز",
                detail=(
                    f"الجهاز «{link.device_name}» غير متصل"
                    + (f" منذ {max(1, age // 60)} دقيقة" if age else "")
                    + "."
                ),
                action_hint="تحقّق من الشبكة والطاقة؛ الأوامر لن تُنفَّذ حتى يعود الاتصال.",
                source="device",
            )
        ]
    return []


def _decision_alerts(decisions: list) -> list[Alert]:
    alerts: list[Alert] = []
    for decision in decisions:
        if decision.action == "block" and decision.severity in ("warning", "critical"):
            alerts.append(
                Alert(
                    kind=f"protection_{decision.system}",
                    severity=decision.severity,
                    title=(
                        "توقف المضخة بسبب الحماية"
                        if decision.system == "irrigation"
                        else f"إجراء محجوب — {decision.system}"
                    ),
                    detail=decision.reason,
                    action_hint=decision.detail or "راجع شروط السلامة في مركز التحكم.",
                    source="safety",
                )
            )
    return alerts


def recent_protection_alerts(db: Session, plant_id: int, minutes: int = 30) -> list[Alert]:
    """"توقف المضخة بسبب الحماية" stays visible after it has happened.

    The protection stop is a *moment* (the pump is off again immediately), so
    the active-alert list is built from the logged critical irrigation event
    rather than from the current decision.
    """
    row = (
        db.query(ControlEvent)
        .filter(
            ControlEvent.plant_id == plant_id,
            ControlEvent.system == "irrigation",
            ControlEvent.severity == "critical",
        )
        .order_by(ControlEvent.id.desc())
        .first()
    )
    if row is None:
        return []
    age = alert_age_minutes(row)
    if age is None or age > minutes:
        return []
    return [
        Alert(
            kind="pump_protection_stop",
            severity="critical",
            title="توقف المضخة بسبب الحماية",
            detail=row.reason,
            action_hint=row.result_detail
            or "تحقّق من الخزان والصمام وحساس التدفق قبل إعادة التشغيل.",
            source="safety",
        )
    ]


def failed_command_alerts(db: Session, link: da.DeviceLink, limit: int = 5) -> list[Alert]:
    """Alerts for commands the device reported as failed (real feedback)."""
    if link.device_id is None:
        return []
    rows = (
        db.query(DeviceCommand)
        .filter(DeviceCommand.device_id == link.device_id, DeviceCommand.status == "failed")
        .order_by(DeviceCommand.id.desc())
        .limit(limit)
        .all()
    )
    alerts: list[Alert] = []
    for row in rows:
        actuator, action, value = da.parse_wire_token(row.action)
        label = da.ACTUATOR_LABELS.get(actuator, actuator)
        alerts.append(
            Alert(
                kind=f"command_failed_{row.id}",
                severity="critical",
                title="فشل تنفيذ أمر الجهاز",
                detail=f"الجهاز أبلغ عن فشل تنفيذ الأمر: {label}.",
                action_hint="تحقّق من توصيل وحدة التنفيذ ومن حالة الجهاز.",
                source="device",
            )
        )
    return alerts


def log_alerts(db: Session, plant_id: int, alerts: list[Alert], record_event) -> list:  # noqa: D401
    """Persist new/changed alerts to the control log (deduplicated)."""
    from app.services.control_engine import _should_log

    events = []
    for alert in alerts:
        if not _should_log(db, plant_id, alert.signature, alert.severity):
            continue
        events.append(
            record_event(
                db,
                plant_id,
                system="alert",
                action=alert.kind,
                reason=f"{alert.title} — {alert.detail}",
                result="info",
                severity=alert.severity,
                source="safety" if alert.source in ("safety", "device") else "auto",
                signature=alert.signature,
                result_detail=alert.action_hint or None,
            )
        )
    return events


def alert_age_minutes(event: ControlEvent) -> float | None:
    created = event.created_at
    if created is None:
        return None
    if created.tzinfo is None:
        created = created.replace(tzinfo=timezone.utc)
    return (datetime.now(timezone.utc) - created).total_seconds() / 60.0


def cooldown_elapsed(event: ControlEvent) -> bool:
    age = alert_age_minutes(event)
    return age is not None and age >= ALERT_COOLDOWN_MINUTES


__all__ = [
    "Alert",
    "build_alerts",
    "failed_command_alerts",
    "recent_protection_alerts",
    "log_alerts",
    "ALERT_COOLDOWN_MINUTES",
]
