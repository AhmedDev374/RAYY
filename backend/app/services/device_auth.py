"""Device-token authentication shared by every device-facing endpoint.

A physical node authenticates with the bearer token it received at claim time
(hashed in `devices.token_hash`) — not with a user JWT. This helper is the
single implementation of that check, used by `/ingest`, `/report`, the command
poll and the command acknowledgement.
"""

from __future__ import annotations

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models import Device
from app.security import hash_token


def get_device_from_token(db: Session, authorization: str | None) -> Device:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="unauthorized")
    token = authorization.removeprefix("Bearer ").strip()
    device = (
        db.query(Device)
        .filter(Device.token_hash == hash_token(token), Device.is_claimed == True)  # noqa: E712
        .first()
    )
    if not device:
        raise HTTPException(status_code=401, detail="unauthorized")
    return device


def assert_same_device(device: Device, device_id: int) -> None:
    if device.id != device_id:
        raise HTTPException(status_code=403, detail="forbidden")
