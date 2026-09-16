"""Control System routes (نظام التحكم).

Mounted under `/api/v1/control`. These routes did not exist before this
feature, so nothing here collides with the existing `/plants`, `/sensors`,
`/devices`, `/simulation` or `/encyclopedia` routers.

  GET    /api/v1/control/status/{plant_id}
  GET    /api/v1/control/settings/{plant_id}
  PUT    /api/v1/control/settings/{plant_id}
  POST   /api/v1/control/mode
  POST   /api/v1/control/auto
  POST   /api/v1/control/manual
  POST   /api/v1/control/schedule
  GET    /api/v1/control/schedule/{plant_id}
  DELETE /api/v1/control/schedule/{schedule_id}
  GET    /api/v1/control/history/{plant_id}
  POST   /api/v1/control/emergency-stop
  POST   /api/v1/control/emergency-reset
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user
from app.models import ControlSchedule, Plant, Reading, User
from app.schemas import (
    ControlAutoRequest,
    ControlEmergencyStopRequest,
    ControlManualCommand,
    ControlModeRequest,
    ControlScheduleCreate,
    ControlScheduleUpdate,
    ControlSettingsUpdate,
)
from app.services import control_engine as engine
from app.services import device_adapter as da

router = APIRouter(prefix="/control", tags=["control"])


def _get_plant(db: Session, user: User, plant_id: int) -> Plant:
    plant = db.query(Plant).filter(Plant.id == plant_id, Plant.user_id == user.id).first()
    if not plant:
        raise HTTPException(status_code=404, detail="Plant not found")
    return plant


def _latest_reading(db: Session, plant_id: int) -> Reading | None:
    return (
        db.query(Reading)
        .filter(Reading.plant_id == plant_id)
        # Ties on `ts` are real (a device posts several pots per cycle), and
        # without a second key the "latest" row is not deterministic.
        .order_by(Reading.ts.desc(), Reading.id.desc())
        .first()
    )


@router.get("/status/{plant_id}")
def control_status(
    plant_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    plant = _get_plant(db, user, plant_id)
    return engine.build_snapshot(db, plant, _latest_reading(db, plant_id))


@router.get("/settings/{plant_id}")
def control_settings(
    plant_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    plant = _get_plant(db, user, plant_id)
    settings = engine.get_or_create_settings(db, plant)
    targets, source = engine.resolve_targets(db, plant, settings)
    return {
        "plant_id": plant.id,
        "mode": settings.mode,
        "mode_label": engine.MODE_LABELS.get(settings.mode, settings.mode),
        "emergency_stop": settings.emergency_stop,
        "targets": targets,
        "targets_source": source,
        "overrides": settings.targets or {},
        "actuators": settings.actuators or {},
        "water_tank_pct": settings.water_tank_pct,
        "water_tank_capacity_l": settings.water_tank_capacity_l,
        "irrigation_max_runtime_sec": engine.pump_max_runtime_seconds(settings),
        "irrigation_max_runtime_is_default": settings.irrigation_max_runtime_sec is None,
        "irrigation_max_runtime_bounds": [
            engine.PUMP_MIN_MAX_RUNTIME_SECONDS,
            engine.PUMP_MAX_MAX_RUNTIME_SECONDS,
        ],
        "updated_at": settings.updated_at,
    }


@router.put("/settings/{plant_id}")
def update_control_settings(
    plant_id: int,
    payload: ControlSettingsUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    plant = _get_plant(db, user, plant_id)
    settings = engine.get_or_create_settings(db, plant)

    if payload.mode is not None:
        if payload.mode not in engine.MODE_LABELS:
            raise HTTPException(status_code=422, detail="Unknown control mode")
        settings.mode = payload.mode

    if payload.targets is not None:
        overrides = dict(settings.targets or {})
        for key, value in payload.targets.items():
            if key not in engine.DEFAULT_THRESHOLDS:
                continue
            if value is None:
                # Explicit null = revert this range to the species default.
                overrides.pop(key, None)
                continue
            if not isinstance(value, dict):
                raise HTTPException(status_code=422, detail=f"Invalid range for {key}")
            current = dict(overrides.get(key) or {})
            for bound in ("min", "max", "ideal"):
                if bound in value and value[bound] is not None:
                    current[bound] = float(value[bound])
            if "min" in current and "max" in current and current["min"] > current["max"]:
                raise HTTPException(status_code=422, detail=f"min > max for {key}")
            overrides[key] = current
        settings.targets = overrides

    if payload.water_tank_pct is not None:
        if not 0 <= payload.water_tank_pct <= 100:
            raise HTTPException(status_code=422, detail="water_tank_pct must be 0-100")
        settings.water_tank_pct = payload.water_tank_pct

    if payload.water_tank_capacity_l is not None:
        if payload.water_tank_capacity_l <= 0:
            raise HTTPException(status_code=422, detail="water_tank_capacity_l must be > 0")
        settings.water_tank_capacity_l = payload.water_tank_capacity_l

    if payload.irrigation_max_runtime_sec is not None:
        # 0 = "back to the engine default". Anything else is clamped server-side
        # so the safety ceiling can never be disabled from the UI.
        if payload.irrigation_max_runtime_sec == 0:
            settings.irrigation_max_runtime_sec = None
        else:
            if not (
                engine.PUMP_MIN_MAX_RUNTIME_SECONDS
                <= payload.irrigation_max_runtime_sec
                <= engine.PUMP_MAX_MAX_RUNTIME_SECONDS
            ):
                raise HTTPException(
                    status_code=422,
                    detail=(
                        "irrigation_max_runtime_sec must be "
                        f"{engine.PUMP_MIN_MAX_RUNTIME_SECONDS}-{engine.PUMP_MAX_MAX_RUNTIME_SECONDS} "
                        "seconds, or 0 to use the default"
                    ),
                )
            settings.irrigation_max_runtime_sec = payload.irrigation_max_runtime_sec

    db.commit()
    db.refresh(settings)

    engine.record_event(
        db,
        plant.id,
        system="system",
        action="update_settings",
        reason="تم تحديث إعدادات التحكم.",
        result="executed",
        severity="info",
        source="manual",
        signature=f"settings|{settings.updated_at}",
    )
    return control_settings(plant_id, user, db)


@router.post("/mode")
def set_mode(
    payload: ControlModeRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    plant = _get_plant(db, user, payload.plant_id)
    try:
        settings = engine.set_mode(db, plant, payload.mode)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="Unknown control mode") from exc
    return {
        "plant_id": plant.id,
        "mode": settings.mode,
        "mode_label": engine.MODE_LABELS.get(settings.mode, settings.mode),
    }


@router.post("/auto")
def set_auto(
    payload: ControlAutoRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """Hand control back to RAYY (وضع تلقائي)."""
    plant = _get_plant(db, user, payload.plant_id)
    settings = engine.set_mode(db, plant, "auto")
    return {
        "plant_id": plant.id,
        "mode": settings.mode,
        "mode_label": engine.MODE_LABELS.get(settings.mode, settings.mode),
    }


@router.post("/manual")
def manual_command(
    payload: ControlManualCommand,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    plant = _get_plant(db, user, payload.plant_id)
    if payload.actuator not in da.ACTUATOR_LABELS:
        raise HTTPException(status_code=422, detail="Unknown actuator")
    if payload.action not in ("on", "off", "set"):
        raise HTTPException(status_code=422, detail="Unknown action")
    event = engine.manual_command(
        db,
        plant,
        actuator=payload.actuator,
        action=payload.action,
        value=payload.value,
        duration_sec=payload.duration_sec,
    )
    return {
        "ok": event.result != "blocked",
        "event": engine.event_to_dict(event),
        "snapshot": engine.build_snapshot(db, plant, _latest_reading(db, plant.id)),
    }


@router.post("/schedule")
def create_schedule(
    payload: ControlScheduleCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    plant = _get_plant(db, user, payload.plant_id)
    if payload.system not in engine.SYSTEM_META:
        raise HTTPException(status_code=422, detail="Unknown system")
    actuator = payload.actuator or engine.actuator_for_system(payload.system)
    if actuator is None:
        raise HTTPException(status_code=422, detail="This system has no actuator")
    if payload.action not in ("on", "off", "set"):
        raise HTTPException(status_code=422, detail="Unknown action")

    schedule = ControlSchedule(
        plant_id=plant.id,
        system=payload.system,
        actuator=actuator,
        action=payload.action,
        value=payload.value,
        duration_sec=payload.duration_sec,
        time_of_day=payload.time_of_day,
        days=payload.days or [0, 1, 2, 3, 4, 5, 6],
        enabled=payload.enabled,
        note=payload.note,
    )
    db.add(schedule)
    db.commit()
    db.refresh(schedule)
    return engine.schedule_to_dict(schedule)


@router.put("/schedule/{schedule_id}")
def update_schedule(
    schedule_id: int,
    payload: ControlScheduleUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """Edit an existing scheduled task in place (تعديل مهمة مجدولة)."""
    schedule = db.query(ControlSchedule).filter(ControlSchedule.id == schedule_id).first()
    if not schedule:
        raise HTTPException(status_code=404, detail="Schedule not found")
    plant = _get_plant(db, user, schedule.plant_id)  # ownership check

    if payload.system is not None:
        if payload.system not in engine.SYSTEM_META:
            raise HTTPException(status_code=422, detail="Unknown system")
        actuator = engine.actuator_for_system(payload.system)
        if actuator is None:
            raise HTTPException(status_code=422, detail="This system has no actuator")
        schedule.system = payload.system
        schedule.actuator = actuator
    if payload.action is not None:
        if payload.action not in ("on", "off", "set"):
            raise HTTPException(status_code=422, detail="Unknown action")
        schedule.action = payload.action
    if payload.value is not None:
        schedule.value = payload.value
    if payload.duration_sec is not None:
        schedule.duration_sec = payload.duration_sec
    if payload.time_of_day is not None:
        schedule.time_of_day = payload.time_of_day
    if payload.days is not None:
        schedule.days = payload.days or [0, 1, 2, 3, 4, 5, 6]
    if payload.enabled is not None:
        schedule.enabled = payload.enabled
    if payload.note is not None:
        schedule.note = payload.note

    # An edited task must be allowed to run again at its new time.
    schedule.last_run_at = None
    db.commit()
    db.refresh(schedule)

    engine.record_event(
        db,
        plant.id,
        system=schedule.system,
        action="update_schedule",
        reason=f"تم تعديل مهمة مجدولة إلى {schedule.time_of_day}.",
        result="executed",
        severity="info",
        source="manual",
        signature=f"schedule|{schedule.id}|edit",
    )
    return engine.schedule_to_dict(schedule)


@router.get("/schedule/{plant_id}")
def list_schedules(
    plant_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[dict]:
    plant = _get_plant(db, user, plant_id)
    rows = (
        db.query(ControlSchedule)
        .filter(ControlSchedule.plant_id == plant.id)
        .order_by(ControlSchedule.time_of_day)
        .all()
    )
    return [engine.schedule_to_dict(row) for row in rows]


@router.delete("/schedule/{schedule_id}", status_code=204)
def delete_schedule(
    schedule_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    schedule = db.query(ControlSchedule).filter(ControlSchedule.id == schedule_id).first()
    if not schedule:
        raise HTTPException(status_code=404, detail="Schedule not found")
    _get_plant(db, user, schedule.plant_id)  # ownership check
    db.delete(schedule)
    db.commit()


@router.get("/history/{plant_id}")
def control_history(
    plant_id: int,
    limit: int = Query(default=50, ge=1, le=200),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    plant = _get_plant(db, user, plant_id)
    return {
        "plant_id": plant.id,
        "events": engine.load_history(db, plant.id, limit=limit),
        "result_labels": engine.RESULT_LABELS,
        "source_labels": engine.SOURCE_LABELS,
    }


@router.post("/emergency-stop")
def emergency_stop(
    payload: ControlEmergencyStopRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    plant = _get_plant(db, user, payload.plant_id)
    engine.emergency_stop(db, plant, payload.reason)
    return {
        "ok": True,
        "emergency_stop": True,
        "message": "تم تفعيل الإيقاف الطارئ وإيقاف جميع وحدات التنفيذ.",
        "snapshot": engine.build_snapshot(db, plant, _latest_reading(db, plant.id)),
    }


@router.post("/emergency-reset")
def emergency_reset(
    payload: ControlAutoRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """Explicit user confirmation is required before RAYY resumes control."""
    plant = _get_plant(db, user, payload.plant_id)
    settings = engine.clear_emergency(db, plant)
    return {
        "ok": True,
        "emergency_stop": settings.emergency_stop,
        "message": "تم إلغاء الإيقاف الطارئ ويمكن للنظام استئناف التحكم.",
        "snapshot": engine.build_snapshot(db, plant, _latest_reading(db, plant.id)),
    }
