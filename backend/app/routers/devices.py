import json
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import get_db
from app.deps import get_current_user
from app.models import (
    AuxReading,
    ControlSettings,
    Device,
    DeviceActuatorState,
    DeviceCapability,
    DeviceCommand,
    DevicePot,
    Plant,
    User,
)
from app.schemas import (
    DeviceCapabilityItem,
    DeviceClaimRequest,
    DeviceClaimResponse,
    DeviceCommandAck,
    DeviceCommandOut,
    DeviceCommandRequest,
    DeviceOut,
    DeviceRegisterResponse,
    DeviceReportRequest,
    DeviceReportResponse,
)
from app.security import generate_token, hash_token
from app.services.control_engine import record_event
from app.services.device_auth import assert_same_device, get_device_from_token
from app.services.device_adapter import ACTUATOR_LABELS, parse_wire_token

router = APIRouter(prefix="/devices", tags=["devices"])
settings = get_settings()


@router.post("/register", response_model=DeviceRegisterResponse)
def register_device(
    name: str = "ESP32 Sensor",
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    setup_token = generate_token()
    device = Device(
        user_id=user.id,
        name=name,
        setup_token_hash=hash_token(setup_token),
        setup_expires_at=datetime.now(timezone.utc) + timedelta(hours=24),
        is_claimed=False,
    )
    db.add(device)
    db.commit()
    db.refresh(device)

    qr_payload = json.dumps(
        {
            "setup_token": setup_token,
            "api_url": settings.public_api_url,
            "device_id": device.id,
        }
    )
    claim_url = f"{settings.public_api_url}{settings.api_v1_prefix}/devices/claim"
    return DeviceRegisterResponse(
        device_id=device.id,
        setup_token=setup_token,
        qr_payload=qr_payload,
        claim_url=claim_url,
    )


@router.post("/claim", response_model=DeviceClaimResponse)
def claim_device(payload: DeviceClaimRequest, db: Session = Depends(get_db)):
    token_hash = hash_token(payload.setup_token)
    device = db.query(Device).filter(Device.setup_token_hash == token_hash).first()
    if not device:
        raise HTTPException(status_code=404, detail="Invalid setup token")
    if device.setup_expires_at and device.setup_expires_at < datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="Setup token expired")
    if device.is_claimed:
        raise HTTPException(status_code=400, detail="Device already claimed")

    device_token = generate_token()
    device.token_hash = hash_token(device_token)
    device.setup_token_hash = None
    device.is_claimed = True
    device.firmware_version = payload.firmware_version
    device.last_seen = datetime.now(timezone.utc)
    if not device.pots:
        for i in range(4):
            db.add(DevicePot(device_id=device.id, pot_index=i))
    db.commit()

    ingest_url = f"{settings.public_api_url}{settings.api_v1_prefix}/ingest"
    return DeviceClaimResponse(device_token=device_token, ingest_url=ingest_url, device_id=device.id)


@router.get("", response_model=list[DeviceOut])
def list_devices(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return db.query(Device).filter(Device.user_id == user.id).order_by(Device.id).all()


@router.post("/{device_id}/commands", response_model=DeviceCommandOut)
def create_command(
    device_id: int,
    payload: DeviceCommandRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    device = db.query(Device).filter(Device.id == device_id, Device.user_id == user.id).first()
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
    cmd = DeviceCommand(
        device_id=device.id,
        action=payload.action,
        pot_index=payload.pot_index,
        duration_sec=payload.duration_sec,
    )
    db.add(cmd)
    db.commit()
    db.refresh(cmd)
    return cmd


# ---------------------------------------------------------------------------
# Device -> backend (real hardware feedback)
# ---------------------------------------------------------------------------
def _plant_for_device(db: Session, device: Device) -> Plant | None:
    pot = (
        db.query(DevicePot)
        .filter(DevicePot.device_id == device.id, DevicePot.plant_id.isnot(None))
        .order_by(DevicePot.pot_index)
        .first()
    )
    if pot and pot.plant_id:
        return db.query(Plant).filter(Plant.id == pot.plant_id).first()
    return None


@router.post("/{device_id}/report", response_model=DeviceReportResponse)
def report_device_state(
    device_id: int,
    payload: DeviceReportRequest,
    authorization: str = Header(default=""),
    db: Session = Depends(get_db),
) -> DeviceReportResponse:
    """Heartbeat from a real node.

    The board declares which sensors/actuators are actually wired (once, or
    whenever they change), reports the state it is really in, and picks up the
    server's safety flags (emergency stop). Everything the dashboard shows about
    hardware originates from this call — nothing is assumed by the backend.
    """
    device = get_device_from_token(db, authorization)
    assert_same_device(device, device_id)

    device.last_seen = datetime.now(timezone.utc)
    if payload.firmware_version:
        device.firmware_version = payload.firmware_version[:50]

    if payload.capabilities is not None:
        for item in payload.capabilities:
            _upsert_capability(db, device.id, item)

    if payload.actuators is not None:
        for state in payload.actuators:
            row = (
                db.query(DeviceActuatorState)
                .filter(
                    DeviceActuatorState.device_id == device.id,
                    DeviceActuatorState.actuator == state.actuator,
                )
                .first()
            )
            if row is None:
                row = DeviceActuatorState(device_id=device.id, actuator=state.actuator)
                db.add(row)
            row.on = state.on
            row.value = state.value
            row.error = state.error
            row.reported_at = datetime.now(timezone.utc)

    plant = _plant_for_device(db, device)
    if payload.water_level_pct is not None or payload.flow_lpm is not None:
        db.add(
            AuxReading(
                device_id=device.id,
                plant_id=plant.id if plant else None,
                ts=int(datetime.now(timezone.utc).timestamp()),
                water_level_pct=payload.water_level_pct,
                flow_lpm=payload.flow_lpm,
            )
        )

    db.commit()

    settings = None
    if plant is not None:
        settings = (
            db.query(ControlSettings).filter(ControlSettings.plant_id == plant.id).first()
        )
    emergency = bool(settings and settings.emergency_stop)
    note = None
    if emergency:
        note = "إيقاف طارئ مُفعَّل على الخادم — أوقف جميع وحدات التنفيذ ولا تنفّذ أوامر جديدة."

    return DeviceReportResponse(
        ok=True,
        server_time=int(datetime.now(timezone.utc).timestamp()),
        poll_seconds=3,
        emergency_stop=emergency,
        plant_id=plant.id if plant else None,
        mode=settings.mode if settings else None,
        note=note,
    )


def _upsert_capability(db: Session, device_id: int, item: DeviceCapabilityItem) -> None:
    row = (
        db.query(DeviceCapability)
        .filter(DeviceCapability.device_id == device_id, DeviceCapability.key == item.key)
        .first()
    )
    if row is None:
        row = DeviceCapability(device_id=device_id, key=item.key)
        db.add(row)
    row.kind = item.kind if item.kind in ("actuator", "sensor") else "actuator"
    row.supported = item.supported
    row.status = "ok" if (item.supported and item.status == "ok") else (
        "error" if item.status == "error" else "not_installed"
    )
    row.detail = item.detail
    # None means "the firmware did not say" - kept as NULL so RAYY can fall back
    # to its own model instead of guessing that a dimmer exists.
    row.variable = item.variable
    row.updated_at = datetime.now(timezone.utc)


@router.post("/{device_id}/commands/{command_id}/ack")
def ack_command(
    device_id: int,
    command_id: int,
    payload: DeviceCommandAck,
    authorization: str = Header(default=""),
    db: Session = Depends(get_db),
) -> dict:
    """Acknowledgement of an executed (or failed) command.

    Closes the control loop: the backend only logs «تم التنفيذ» when the board
    confirms it, and a failure raises a real alert instead of silently passing.
    """
    device = get_device_from_token(db, authorization)
    assert_same_device(device, device_id)

    cmd = (
        db.query(DeviceCommand)
        .filter(DeviceCommand.id == command_id, DeviceCommand.device_id == device.id)
        .first()
    )
    if cmd is None:
        raise HTTPException(status_code=404, detail="Command not found")

    actuator, action, value = parse_wire_token(cmd.action)
    cmd.status = "done" if payload.ok else "failed"
    device.last_seen = datetime.now(timezone.utc)

    plant = _plant_for_device(db, device)
    if plant is not None and payload.water_used_l:
        settings = (
            db.query(ControlSettings).filter(ControlSettings.plant_id == plant.id).first()
        )
        if settings is not None:
            today = datetime.now().strftime("%Y-%m-%d")
            if settings.water_used_date != today:
                settings.water_used_date = today
                settings.water_used_today_l = 0.0
            settings.water_used_today_l = round(
                (settings.water_used_today_l or 0.0) + float(payload.water_used_l), 2
            )
    db.commit()

    if plant is not None:
        label = ACTUATOR_LABELS.get(actuator, actuator)
        record_event(
            db,
            plant.id,
            system="device",
            action=action,
            actuator=actuator,
            value=value,
            reason=(
                f"تأكيد من الجهاز «{device.name}»: {label} — "
                + ("تم التنفيذ" if payload.ok else "فشل التنفيذ")
            ),
            result="executed" if payload.ok else "failed",
            severity="info" if payload.ok else "critical",
            source="device",
            signature=f"ack|{cmd.id}|{'ok' if payload.ok else 'fail'}",
            result_detail=payload.detail or None,
        )

    return {"ok": True, "command_id": cmd.id, "status": cmd.status}


