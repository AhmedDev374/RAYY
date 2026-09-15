"""Tomato sensor simulation.

Design goals (see the feature request):

* The simulator must feed readings through the *same* pipeline the real
  hardware uses -- i.e. the very same `Reading` rows, WebSocket broadcast and
  proactive-alert evaluation that `POST /api/v1/ingest` performs. The dashboard
  therefore needs no special-casing: a simulated plant looks exactly like a
  real one.
* Values must drift smoothly over time (a day/night sine wave plus small
  bounded noise), never jump to fresh random numbers on every tick.
* Starting twice must not spawn a second generator. ON/OFF is idempotent and
  owned by the process (a single background asyncio task per device).
* Turning OFF stops *new* readings but never deletes history.

Swapping the simulated node for a real ESP32/Arduino is a firmware concern
only: the real node claims a device, gets a device token and POSTs to
`/api/v1/ingest` with the same 4-pot layout. Nothing in the dashboard changes.
"""

from __future__ import annotations

import asyncio
import logging
import math
import random
import time
import zlib
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.models import Device, DevicePot, Plant, Reading
from app.services.proactive_alerts import evaluate_proactive_alerts

logger = logging.getLogger("uvicorn.error")

# --- Public identity of the simulated node ---------------------------------
SIM_DEVICE_NAME = "RAYY-SIM-TOMATO-001"
SIM_SPECIES = "Tomato"
SIM_NICKNAME = "Tomato Demo"
SIM_SOURCE = "simulation"

SIM_TICK_SECONDS = 3.0
SIM_POT_INDEX = 0


class SimulationEngine:
    """Owns the single background generator for one simulated device.

    A generator task is only ever created when none is running, so repeated
    `start()` calls are safe (requirement: no duplicate simulators).
    """

    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self._task: asyncio.Task | None = None
        self._device_id: int | None = None
        self._plant_id: int | None = None
        self._started_at: float | None = None
        self._reading_count = 0
        self._last_values: dict[str, float] | None = None
        # Randomised-but-fixed starting phase so two runs don't look identical.
        self._phase = random.random() * math.tau

    # -- status --------------------------------------------------------------
    @property
    def running(self) -> bool:
        return self._task is not None and not self._task.done()

    def status(self) -> dict:
        return {
            "running": self.running,
            "device_name": SIM_DEVICE_NAME,
            "device_id": self._device_id,
            "plant_id": self._plant_id,
            "nickname": SIM_NICKNAME,
            "species": SIM_SPECIES,
            "source": SIM_SOURCE,
            "interval_seconds": SIM_TICK_SECONDS,
            "started_at": self._started_at,
            "reading_count": self._reading_count,
            "last_values": self._last_values,
        }

    # -- control -------------------------------------------------------------
    async def start(self, db: Session, user_id: int | None = None) -> dict:
        """Idempotently start the generator, provisioning the sim device."""
        async with self._lock:
            device = self._ensure_device(db, user_id)
            self._device_id = device.id
            self._plant_id = self._ensure_plant(db, device, user_id)

            if self.running:
                # Already ON -> no second simulator (requirement 11).
                return self.status()

            self._started_at = time.time()
            self._reading_count = 0
            self._task = asyncio.create_task(self._run(device.id, self._plant_id))
            logger.info(
                "Simulation ON: device=%s device_id=%s plant_id=%s interval=%.1fs",
                SIM_DEVICE_NAME,
                device.id,
                self._plant_id,
                SIM_TICK_SECONDS,
            )
            return self.status()

    async def stop(self) -> dict:
        """Stop the generator. History already written is kept untouched."""
        async with self._lock:
            task = self._task
            self._task = None
            if task and not task.done():
                task.cancel()
                try:
                    await task
                except (asyncio.CancelledError, Exception):  # noqa: BLE001 - teardown
                    pass
            logger.info("Simulation OFF: device=%s", SIM_DEVICE_NAME)
            return self.status()

    # -- lifecycle helpers ---------------------------------------------------
    def _ensure_device(self, db: Session, user_id: int | None = None) -> Device:
        """Find (or create) the stable simulated device.

        Matching on `name` keeps a single row for RAYY-SIM-TOMATO-001 across
        restarts, and `is_claimed=False` is the "unclaimed prototype" state --
        the same status a real node has before onboarding. `/ingest` is never
        bypassed: `_persist()` writes through the identical Reading path.
        """
        owner_id = user_id if user_id is not None else _first_user_id(db)
        device = db.query(Device).filter(Device.name == SIM_DEVICE_NAME).first()
        if device is None:
            # `devices.user_id` is NOT NULL, so the simulated node belongs to
            # the user who turned Simulation Mode on — exactly like a real node
            # claimed during onboarding.
            device = Device(user_id=owner_id, name=SIM_DEVICE_NAME, is_claimed=False)
            db.add(device)
            db.commit()
            db.refresh(device)
        elif owner_id is not None and device.user_id != owner_id:
            device.user_id = owner_id
            db.commit()
        # Make sure the 4-pot layout exists so pot_index 0 is addressable,
        # mirroring what claim_device does for real hardware.
        existing_pots = {p.pot_index for p in device.pots}
        for i in range(4):
            if i not in existing_pots:
                db.add(DevicePot(device_id=device.id, pot_index=i))
        db.commit()
        db.refresh(device)
        return device

    def _ensure_plant(self, db: Session, device: Device, user_id: int | None = None) -> int:
        """Find (or create) the 'Tomato Demo' plant and bind it to pot 0."""
        owner_id = user_id if user_id is not None else _first_user_id(db)
        plant = (
            db.query(Plant)
            .filter(Plant.nickname == SIM_NICKNAME, Plant.species == SIM_SPECIES)
            .first()
        )
        if plant is not None and owner_id is not None and plant.user_id != owner_id:
            # Re-home onto the account actually driving the simulator so it
            # shows up in that user's GET /api/v1/plants.
            plant.user_id = owner_id
            db.commit()
        if plant is None:
            plant = Plant(
                user_id=owner_id,
                species=SIM_SPECIES,
                nickname=SIM_NICKNAME,
                device_id=device.id,
            )
            db.add(plant)
            db.commit()
            db.refresh(plant)

        pot = (
            db.query(DevicePot)
            .filter(DevicePot.device_id == device.id, DevicePot.pot_index == SIM_POT_INDEX)
            .first()
        )
        if pot is None:
            pot = DevicePot(device_id=device.id, pot_index=SIM_POT_INDEX, plant_id=plant.id)
            db.add(pot)
        elif pot.plant_id != plant.id:
            pot.plant_id = plant.id
        if plant.device_id != device.id:
            plant.device_id = device.id
        db.commit()
        return plant.id

    async def _run(self, device_id: int, plant_id: int) -> None:
        """Tick loop: emit one smoothly-evolving reading every SIM_TICK_SECONDS."""
        from app.database import SessionLocal

        try:
            while True:
                start = time.monotonic()
                db = SessionLocal()
                try:
                    values = self._next_values()
                    reading = self._persist(db, device_id, plant_id, values)
                    if reading and reading.plant_id:
                        self._last_values = values
                        self._reading_count += 1
                        await _broadcast(reading)
                        evaluate_proactive_alerts(db, reading.plant_id, reading)
                except Exception:  # noqa: BLE001 - never kill the loop on one bad tick
                    logger.exception("Simulation tick failed")
                finally:
                    db.close()

                elapsed = time.monotonic() - start
                await asyncio.sleep(max(0.5, SIM_TICK_SECONDS - elapsed))
        except asyncio.CancelledError:
            logger.info("Simulation generator cancelled")
            raise

    # -- value generation ----------------------------------------------------
    def _next_values(self) -> dict[str, float]:
        """Smooth, physically-plausible tomato conditions.

        A day/night cycle (period = 120 real seconds, so a "day" is observable
        in a demo) drives temperature/light; slow bounded random walks supply
        the small jitter a real sensor has. Nothing here is a fresh
        `uniform()` per reading -- every quantity moves continuously.
        """
        t = (time.time() - (self._started_at or time.time())) + self._phase
        day = math.sin(math.tau * t / 120.0)  # -1 (night) .. +1 (midday)
        slow = math.sin(math.tau * t / 600.0)

        temperature = 23.0 + 4.5 * day + 0.4 * slow
        humidity = 62.0 - 12.0 * day + 1.5 * slow
        light = max(0.0, 650.0 + 480.0 * day)
        # Soil dries slowly and "refills" a little at the day peak (watering).
        soil_moisture = 52.0 + 8.0 * slow - 6.0 * day
        ph = 6.5 + 0.15 * math.sin(t / 45.0)

        def jitter(v: float, spread: float, low: float, high: float) -> float:
            return round(max(low, min(high, v + random.uniform(-spread, spread))), 1)

        return {
            "temperature": jitter(temperature, 0.25, 5.0, 45.0),
            "humidity": jitter(humidity, 0.8, 5.0, 100.0),
            "light": round(max(0.0, min(1200.0, light + random.uniform(-12, 12))), 0),
            "soil_moisture": jitter(soil_moisture, 0.8, 5.0, 95.0),
            "ph": jitter(ph, 0.05, 4.0, 9.0),
        }

    def _persist(
        self, db: Session, device_id: int, plant_id: int | None, values: dict[str, float]
    ) -> Reading | None:
        """Write a Reading using the exact schema `/ingest` writes."""
        try:
            device = db.query(Device).filter(Device.id == device_id).first()
            if device is not None:
                device.last_seen = datetime.now(timezone.utc)
            reading = Reading(
                device_id=device_id,
                plant_id=plant_id,
                pot_index=SIM_POT_INDEX,
                ts=int(time.time()),
                temperature=values["temperature"],
                humidity=values["humidity"],
                light=values["light"],
                soil_moisture=values["soil_moisture"],
                ph=values["ph"],
            )
            db.add(reading)
            db.commit()
            db.refresh(reading)
            return reading
        except Exception:  # noqa: BLE001
            db.rollback()
            logger.exception("Simulation persist failed")
            return None


def _first_user_id(db: Session) -> int | None:
    """Attach the demo plant to an existing account so it is visible in the UI.

    If no users exist yet we leave it unowned (NULL) -- the first registered
    user will see it once assigned, and nothing crashes in the meantime.
    """
    from app.models import User

    user = db.query(User).order_by(User.id).first()
    return user.id if user else None


async def _broadcast(reading: Reading) -> None:
    """Push a live update over the WebSocket -- same shape `/ingest` sends."""
    from app.ws_manager import ws_manager

    await ws_manager.broadcast(
        reading.plant_id,
        {
            "id": reading.id,
            "plant_id": reading.plant_id,
            "pot_index": reading.pot_index,
            "ts": reading.ts,
            "temperature": reading.temperature,
            "humidity": reading.humidity,
            "light": reading.light,
            "soil_moisture": reading.soil_moisture,
            "ph": reading.ph,
        },
    )


# One process-wide engine -> exactly one simulator per backend instance.
simulation_engine = SimulationEngine()

# Small helper kept for callers that want a deterministic-ish marker (e.g.
# tests) without importing zlib themselves.
def value_fingerprint(values: dict[str, float]) -> int:
    return zlib.crc32(repr(sorted(values.items())).encode())
