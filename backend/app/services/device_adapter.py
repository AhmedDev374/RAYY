"""Device Control Interface (طبقة تجريد الأجهزة).

The layering this module enforces:

    Frontend
      → FastAPI (routers/control.py)
        → RAYY Control Engine (services/control_engine.py)
          → Device Adapter (this file)
            → POST /api/v1/devices/{id}/commands  (queue the ESP32 polls)
              → Arduino / ESP32 firmware
                → real relays, servos and sensors

Nothing above this layer may claim what the hardware is doing: capabilities
come from what the device itself reported (`device_capabilities`), actuator
states come from what the device reported (`device_actuator_states`), and a
queued command is reported as «بانتظار التنفيذ» until the device acknowledges
it. Anything the board does not have is labelled «يتطلب تركيب الحساس» /
«جاهز للتكامل» — never a fabricated value.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.models import (
    AuxReading,
    Device,
    DeviceActuatorState,
    DeviceCapability,
    DeviceCommand,
    DevicePot,
    Plant,
)

# --- Actuator keys (stable identifiers; labels are Arabic, in ACTUATOR_META) --
PUMP = "pump"
VALVE = "valve"
FAN = "fan"
VENT = "vent"
GROW_LIGHT = "grow_light"
TANK = "tank"  # not an actuator: the tank is monitored, never driven

# --- Sensor keys -----------------------------------------------------------
TEMP = "temperature"
HUMIDITY = "humidity"
LIGHT = "light"
SOIL = "soil_moisture"
WATER_LEVEL = "water_level"
FLOW = "flow"

ACTUATOR_KEYS = (PUMP, VALVE, FAN, VENT, GROW_LIGHT)
SENSOR_KEYS = (TEMP, HUMIDITY, LIGHT, SOIL, WATER_LEVEL, FLOW)

ACTUATOR_LABELS = {
    PUMP: "مضخة الري",
    VALVE: "صمام الري",
    FAN: "المروحة",
    VENT: "فتحات الصوبة",
    GROW_LIGHT: "إضاءة النمو",
    TANK: "خزان المياه",
}

SENSOR_LABELS = {
    TEMP: "حساس درجة الحرارة",
    HUMIDITY: "حساس رطوبة الهواء",
    LIGHT: "حساس الإضاءة",
    SOIL: "حساس رطوبة التربة",
    WATER_LEVEL: "حساس مستوى المياه",
    FLOW: "حساس تدفق المياه",
}

# Arabic states shown to the user for every capability.
CAPABILITY_STATUS_AR = {
    "ready": "جاهز",
    "offline": "غير متصل",
    "missing": "يتطلب تركيب الحساس",
    "missing_actuator": "يتطلب تركيب وحدة التنفيذ",
    "no_device": "غير متصل",
    "error": "فشل الحساس",
    "firmware": "جاهز للتكامل",
    # Exists only inside the software bench - never physical hardware.
    "simulation": "وحدة تحكم ذكية",
}

# A device is considered online when it has posted recently.
LINK_FRESH_SECONDS = 300

# Shown wherever a bench output could be mistaken for real field hardware.
SIMULATION_SOURCE_AR = (
    "تمثيل رقمي لوحدة تحكم ميدانية — يعمل عبر مسار التحكم نفسه بانتظار الربط بالعتاد."
)

# The firmware the current repository ships. A device reporting a lower/unknown
# firmware (or nothing at all) has *not* declared its wiring, so we fall back to
# the hardware this firmware is known to have: 4 soil probes, DHT, LDR and one
# irrigation relay.
LEGACY_RELAY_ONLY = "legacy-relay-only"


@dataclass
class Capability:
    """One sensor or actuator as the hardware actually is."""

    key: str
    kind: str  # actuator | sensor
    label: str
    supported: bool  # hardware is installed
    online: bool  # usable right now
    status: str  # ready | offline | missing | no_device | error | firmware | simulation
    reason: str  # Arabic explanation ("" when everything is fine)
    # True when the component only exists inside the software bench (a
    # "RAYY-SIM-*" device). The UI must label it, never present it as hardware.
    simulated: bool = False
    # Whether the output accepts 0-100%. None = the firmware did not declare it;
    # the caller then falls back to the actuator model rather than assuming.
    variable: bool | None = None

    def as_dict(self) -> dict:
        return {
            "key": self.key,
            "kind": self.kind,
            "label": self.label,
            "supported": self.supported,
            "online": self.online,
            "status": self.status,
            "status_label": CAPABILITY_STATUS_AR.get(self.status, self.status),
            "reason": self.reason,
            "hardware_dependent": not self.supported,
            "simulated": self.simulated,
            "variable": self.variable,
        }


@dataclass
class ActuatorState:
    """The actuator state reported by the device (or "unknown")."""

    actuator: str
    label: str
    on: bool
    value: float | None
    error: str | None
    reported_at: datetime | None = None
    reported: bool = False

    def as_dict(self) -> dict:
        return {
            "actuator": self.actuator,
            "label": self.label,
            "on": self.on,
            "value": self.value,
            "error": self.error,
            "reported": self.reported,
            "reported_age_seconds": self.age_seconds,
        }

    @property
    def age_seconds(self) -> int | None:
        if self.reported_at is None or not self.reported:
            return None
        reported = self.reported_at
        if reported.tzinfo is None:
            reported = reported.replace(tzinfo=timezone.utc)
        return max(0, int((datetime.now(timezone.utc) - reported).total_seconds()))


@dataclass
class DeviceLink:
    device_id: int | None = None
    device_name: str = ""
    connected: bool = False
    source: str = "none"  # hardware | simulation | none
    last_seen_seconds: int | None = None
    firmware_version: str | None = None
    declared: str = LEGACY_RELAY_ONLY  # capability source
    capabilities: dict[str, Capability] = field(default_factory=dict)
    actuator_states: dict[str, ActuatorState] = field(default_factory=dict)
    water_level_pct: float | None = None
    water_level_age_seconds: int | None = None
    flow_lpm: float | None = None
    flow_age_seconds: int | None = None

    # -- capability queries ---------------------------------------------------
    def actuator_capability(self, actuator: str) -> Capability | None:
        return self.capabilities.get(actuator)

    def sensor_capability(self, sensor: str) -> Capability | None:
        return self.capabilities.get(sensor)

    def supports(self, actuator: str) -> bool:
        capability = self.capabilities.get(actuator)
        return bool(capability and capability.supported and capability.online)

    def reason_for(self, actuator: str) -> str:
        """Why an actuator cannot be used right now ("" when it can)."""
        capability = self.capabilities.get(actuator)
        if capability and capability.supported and capability.online:
            return ""
        if capability is not None and capability.reason:
            return capability.reason
        if self.device_id is None:
            return "لا يوجد جهاز مرتبط بهذه النبتة."
        # A known actuator the board never declared at all: not wired.
        label = ACTUATOR_LABELS.get(actuator, actuator)
        return f"وحدة تنفيذ {label} غير مُركّبة على الجهاز — جاهز للتكامل."

    @property
    def is_simulation(self) -> bool:
        """True when this "device" is the software bench, not real hardware."""
        return self.source == "simulation"

    def has_flow_sensor(self) -> bool:
        """True when a flow sensor is wired, so usage must come from real data."""
        capability = self.capabilities.get(FLOW)
        return bool(capability and capability.supported and capability.online)

    def sensor_value(self, sensor: str, reading) -> float | None:
        """The real value of a sensor, or None when it cannot be read.

        Temperature/humidity/light/soil come from the regular reading payload;
        water level and flow come from `aux_readings` (or the device report).
        """
        if not self.sensor_usable(sensor):
            return None
        if reading is not None and sensor in (TEMP, HUMIDITY, LIGHT, SOIL):
            return float(getattr(reading, sensor))
        if sensor == WATER_LEVEL:
            return self.water_level_pct
        if sensor == FLOW:
            return self.flow_lpm
        return None

    def sensor_usable(self, sensor: str) -> bool:
        """True only when the sensor is installed, healthy and reporting fresh."""
        capability = self.capabilities.get(sensor)
        if capability is None or not capability.supported or not capability.online:
            return False
        if sensor in (WATER_LEVEL, FLOW):
            age = (
                self.water_level_age_seconds if sensor == WATER_LEVEL else self.flow_age_seconds
            )
            return age is not None and age <= LINK_FRESH_SECONDS
        return True

    def uses_real_flow(self) -> bool:
        """A flow reading that is fresh enough to base protection on."""
        return self.sensor_usable(FLOW)

    def as_dict(self) -> dict:
        return {
            "device_id": self.device_id,
            "device_name": self.device_name,
            "connected": self.connected,
            "source": self.source,
            "last_seen_seconds": self.last_seen_seconds,
            "firmware_version": self.firmware_version,
            "capabilities_declared": self.declared != LEGACY_RELAY_ONLY,
            "capabilities": [item.as_dict() for item in self.capabilities.values()],
            "sensors": [
                item.as_dict() for item in self.capabilities.values() if item.kind == "sensor"
            ],
            "actuators": [
                item.as_dict() for item in self.capabilities.values() if item.kind == "actuator"
            ],
            "reported_states": [state.as_dict() for state in self.actuator_states.values()],
        }


# ---------------------------------------------------------------------------
# Wire protocol
# ---------------------------------------------------------------------------
def wire_token(actuator: str, action: str, value: float | None) -> str:
    """The `action` string stored in `device_commands` and read by the ESP32.

    Pump-on stays the legacy literal `water` on purpose: an already-deployed
    board running the old firmware greps the response body for "water" and
    opens the relay. Every other token is new, and no *_off token contains
    "water", so an old board can never be told to water by an off command.
    """
    if actuator == PUMP:
        return "water" if action in ("on", "set") else "pump_off"
    if action == "set" and value is not None:
        return f"{actuator}_set_{int(round(value))}"
    return f"{actuator}_{action}"


def parse_wire_token(token: str) -> tuple[str, str, float | None]:
    """Inverse of `wire_token` (used for acknowledgements and the control log)."""
    if token == "water":
        return PUMP, "on", None
    if token == "pump_off":
        return PUMP, "off", None
    # Longest key first so "grow_light" is not mistaken for a shorter prefix.
    for candidate in sorted(ACTUATOR_KEYS, key=len, reverse=True):
        if token != candidate and not token.startswith(candidate + "_"):
            continue
        rest = token[len(candidate) :].lstrip("_")
        if rest.startswith("set_"):
            try:
                return candidate, "set", float(rest[4:])
            except ValueError:
                return candidate, "set", None
        if rest in ("on", "off"):
            return candidate, rest, None
        return candidate, rest or "unknown", None
    return token, "unknown", None


@dataclass
class ActuatorCommand:
    actuator: str
    action: str  # on | off | set
    value: float | None = None
    duration_sec: int | None = None
    reason: str = ""
    pot_index: int = 0


@dataclass
class CommandResult:
    """Outcome of trying to deliver one actuator command.

    status: queued | unsupported | offline | blocked
    """

    status: str
    detail: str
    command_id: int | None = None

    @property
    def delivered(self) -> bool:
        return self.status == "queued"


# ---------------------------------------------------------------------------
# Capability resolution
# ---------------------------------------------------------------------------
def _default_capabilities(source: str, connected: bool, declared_missing: bool) -> dict[str, Capability]:
    """Conservative fallback for a board that has not declared its wiring.

    Known hardware of the shipped firmware: DHT11 (temperature, humidity), LDR
    (light), four soil probes, one irrigation relay. No valve, no fan driver,
    no servo, no grow light, no water-level sensor, no flow sensor.
    """
    capabilities: dict[str, Capability] = {}
    if source == "simulation":
        # A "RAYY-SIM-*" device is a software bench, not hardware. Its outputs
        # are usable **and executable** (the bench applies the command), but
        # every capability is flagged `simulated` and carries an unmissable
        # Arabic label so no surface can present it as a real actuator.
        for key in ACTUATOR_KEYS:
            capabilities[key] = Capability(
                key,
                "actuator",
                ACTUATOR_LABELS[key],
                True,
                connected,
                "simulation" if connected else "offline",
                SIMULATION_SOURCE_AR
                if connected
                else "الجهاز غير متصل حالياً.",
                True,
            )
        # The bench models a real tank with a level sensor: the simulator writes
        # an aux reading (`AuxReading.water_level_pct`) exactly like a physical
        # level sensor posts to `/report`. So the tank is *known* in simulation —
        # the dashboard and the demo read the same simulated tank state instead of
        # showing «غير متاح». It stays `simulated` so no surface presents it as
        # physical hardware.
        capabilities[WATER_LEVEL] = Capability(
            WATER_LEVEL,
            "sensor",
            SENSOR_LABELS[WATER_LEVEL],
            True,
            connected,
            "simulation" if connected else "offline",
            SIMULATION_SOURCE_AR if connected else "الجهاز غير متصل حالياً.",
            True,
        )
        capabilities[FLOW] = Capability(
            FLOW,
            "sensor",
            SENSOR_LABELS[FLOW],
            False,
            False,
            "missing",
            "لا يوجد حساس تدفق مياه — نسبة استهلاك المياه تقديرية حتى تركيب الحساس.",
            True,
        )
        for key in (TEMP, HUMIDITY, LIGHT, SOIL):
            capabilities[key] = Capability(
                key,
                "sensor",
                SENSOR_LABELS[key],
                True,
                connected,
                "ready" if connected else "offline",
                "" if connected else "الجهاز غير متصل حالياً.",
                True,
            )
        return capabilities

    firmware_note = (
        "يتطلب تحديث firmware الجهاز للإبلاغ عن قدراته — الطبقة جاهزة للتكامل."
        if declared_missing
        else ""
    )
    for key in ACTUATOR_KEYS:
        if key == PUMP:
            capabilities[key] = Capability(
                key, "actuator", ACTUATOR_LABELS[key], True, connected,
                "ready" if connected else "offline",
                firmware_note or ("" if connected else "الجهاز غير متصل حالياً."),
            )
        else:
            capabilities[key] = Capability(
                key, "actuator", ACTUATOR_LABELS[key], False, False, "missing_actuator",
                f"وحدة تنفيذ {ACTUATOR_LABELS[key]} غير مُركّبة على الجهاز الحالي — جاهز للتكامل.",
            )
    for key in (TEMP, HUMIDITY, LIGHT, SOIL):
        capabilities[key] = Capability(
            key, "sensor", SENSOR_LABELS[key], True, connected,
            "ready" if connected else "offline",
            firmware_note or ("" if connected else "الجهاز غير متصل حالياً."),
        )
    for key in (WATER_LEVEL, FLOW):
        capabilities[key] = Capability(
            key, "sensor", SENSOR_LABELS[key], False, False, "missing",
            f"يتطلب تركيب {SENSOR_LABELS[key]} على الجهاز — جاهز للتكامل.",
        )
    return capabilities


def _missing_capability(key: str, kind: str, detail: str | None = None) -> Capability:
    """A component the board declared nothing about -> not wired on it."""
    labels = SENSOR_LABELS if kind == "sensor" else ACTUATOR_LABELS
    label = labels.get(key, key)
    if kind == "sensor":
        reason = detail or f"يتطلب تركيب {label} على الجهاز — جاهز للتكامل."
        return Capability(key, kind, label, False, False, "missing", reason)
    reason = detail or f"وحدة تنفيذ {label} غير مُركّبة على الجهاز — جاهز للتكامل."
    return Capability(key, kind, label, False, False, "missing_actuator", reason)


def _declared_capabilities(rows: list[DeviceCapability], connected: bool) -> dict[str, Capability]:
    capabilities: dict[str, Capability] = {}
    for row in rows:
        key = row.key
        if row.kind == "sensor" and key not in SENSOR_KEYS:
            continue
        if row.kind == "actuator" and key not in ACTUATOR_KEYS:
            continue
        labels = SENSOR_LABELS if row.kind == "sensor" else ACTUATOR_LABELS
        installed = bool(row.supported)
        status = row.status or ("ok" if installed else "not_installed")
        if not installed:
            resolved = "missing_actuator" if row.kind == "actuator" else "missing"
            reason = row.detail or (
                f"وحدة تنفيذ {labels.get(key, key)} غير مُركّبة على الجهاز — جاهز للتكامل."
                if row.kind == "actuator"
                else f"يتطلب تركيب {labels.get(key, key)} على الجهاز — جاهز للتكامل."
            )
            online = False
        elif status == "error":
            resolved = "error"
            reason = row.detail or "الجهاز أبلغ عن فشل قراءة هذا الحساس."
            online = False
        elif not connected:
            resolved = "offline"
            reason = row.detail or "الجهاز غير متصل حالياً."
            online = False
        else:
            resolved = "ready"
            reason = ""
            online = True
        capabilities[key] = Capability(
            key=key,
            kind=row.kind,
            label=labels.get(key, key),
            supported=installed,
            online=online,
            status=resolved,
            reason=reason,
            # Straight from the firmware: False means ON/OFF only.
            variable=row.variable,
        )

    # A board that reported its wiring says something about the components it
    # did *not* mention too: they are not installed on that board. Without this
    # they would be reported as "no device", which is a different problem.
    for key in SENSOR_KEYS:
        capabilities.setdefault(key, _missing_capability(key, "sensor"))
    for key in ACTUATOR_KEYS:
        capabilities.setdefault(key, _missing_capability(key, "actuator"))
    return capabilities


def _no_device_capabilities() -> dict[str, Capability]:
    capabilities: dict[str, Capability] = {}
    for key in ACTUATOR_KEYS:
        capabilities[key] = Capability(
            key, "actuator", ACTUATOR_LABELS[key], False, False, "no_device",
            "لا يوجد جهاز مرتبط بهذه النبتة.",
        )
    for key in SENSOR_KEYS:
        capabilities[key] = Capability(
            key, "sensor", SENSOR_LABELS[key], False, False, "no_device",
            "لا يوجد جهاز مرتبط بهذه النبتة، فلا يمكن قراءة هذا الحساس.",
        )
    return capabilities


# ---------------------------------------------------------------------------
# Plant → device resolution
# ---------------------------------------------------------------------------
def find_plant_device(db: Session, plant: Plant) -> Device | None:
    if plant.device_id:
        device = db.query(Device).filter(Device.id == plant.device_id).first()
        if device:
            return device
    pot = db.query(DevicePot).filter(DevicePot.plant_id == plant.id).first()
    if pot:
        return db.query(Device).filter(Device.id == pot.device_id).first()
    return None


def find_plant_pot_index(db: Session, plant: Plant) -> int:
    pot = db.query(DevicePot).filter(DevicePot.plant_id == plant.id).first()
    return pot.pot_index if pot else 0


def _latest_aux(db: Session, device_id: int, plant_id: int | None) -> AuxReading | None:
    query = db.query(AuxReading).filter(AuxReading.device_id == device_id)
    if plant_id is not None:
        query = query.filter(AuxReading.plant_id == plant_id)
    # `id` breaks ties: a device can post a level and a flow rate within the
    # same second, and without a tie-breaker the "latest" row was whichever one
    # SQLite happened to return first - so the tank could report a stale value
    # even though a newer one existed.
    return query.order_by(AuxReading.ts.desc(), AuxReading.id.desc()).first()


def _aux_age(reading: AuxReading | None) -> int | None:
    if reading is None or not reading.ts:
        return None
    return max(0, int(datetime.now(timezone.utc).timestamp() - reading.ts))


def build_link(db: Session, plant: Plant) -> DeviceLink:
    """Describe what is *actually* attached to this plant right now."""
    device = find_plant_device(db, plant)
    if device is None:
        return DeviceLink(capabilities=_no_device_capabilities(), source="none")

    now = datetime.now(timezone.utc)
    last_seen = device.last_seen
    age: int | None = None
    if last_seen is not None:
        if last_seen.tzinfo is None:
            last_seen = last_seen.replace(tzinfo=timezone.utc)
        age = int((now - last_seen).total_seconds())

    is_sim = device.name.startswith("RAYY-SIM-")
    connected = age is not None and age <= LINK_FRESH_SECONDS
    source = "simulation" if is_sim else "hardware"

    declared_rows = (
        db.query(DeviceCapability).filter(DeviceCapability.device_id == device.id).all()
    )
    if source == "simulation":
        capabilities = _default_capabilities(source, connected, True)
        declared = "simulation"
    elif declared_rows:
        capabilities = _declared_capabilities(declared_rows, connected)
        declared = "device"
    else:
        capabilities = _default_capabilities(source, connected, True)
        declared = LEGACY_RELAY_ONLY

    actuator_states: dict[str, ActuatorState] = {}
    for row in (
        db.query(DeviceActuatorState).filter(DeviceActuatorState.device_id == device.id).all()
    ):
        actuator_states[row.actuator] = ActuatorState(
            actuator=row.actuator,
            label=ACTUATOR_LABELS.get(row.actuator, row.actuator),
            on=bool(row.on),
            value=row.value,
            error=row.error,
            reported_at=row.reported_at,
            reported=True,
        )

    aux = _latest_aux(db, device.id, plant.id)
    aux_age = _aux_age(aux)

    return DeviceLink(
        device_id=device.id,
        device_name=device.name,
        connected=connected,
        source=source,
        last_seen_seconds=age,
        firmware_version=device.firmware_version,
        declared=declared,
        capabilities=capabilities,
        actuator_states=actuator_states,
        water_level_pct=aux.water_level_pct if aux else None,
        water_level_age_seconds=aux_age if (aux and aux.water_level_pct is not None) else None,
        flow_lpm=aux.flow_lpm if aux else None,
        flow_age_seconds=aux_age if (aux and aux.flow_lpm is not None) else None,
    )


# ---------------------------------------------------------------------------
# Adapters
# ---------------------------------------------------------------------------
class BaseDeviceAdapter:
    """The contract a real hardware integration must satisfy."""

    link: DeviceLink

    def send(self, command: ActuatorCommand) -> CommandResult:  # pragma: no cover
        raise NotImplementedError


class LinkedDeviceAdapter(BaseDeviceAdapter):
    """Delivers commands to the plant's device command queue (the ESP32 polls it)."""

    def __init__(self, db: Session, link: DeviceLink, pot_index: int) -> None:
        self.db = db
        self.link = link
        self.pot_index = pot_index

    def send(self, command: ActuatorCommand) -> CommandResult:
        if self.link.device_id is None:
            return CommandResult("offline", "لا يوجد جهاز مرتبط بهذه النبتة.")

        # Connectivity first: an installed-but-unreachable actuator is offline,
        # not "unsupported" — the two are different problems for the user.
        if not self.link.connected:
            return CommandResult("offline", f"الجهاز «{self.link.device_name}» غير متصل حالياً.")

        reason = self.link.reason_for(command.actuator)
        if reason:
            return CommandResult("unsupported", reason)

        token = wire_token(command.actuator, command.action, command.value)
        simulating = self.link.is_simulation
        cmd = DeviceCommand(
            device_id=self.link.device_id,
            action=token,
            pot_index=command.pot_index if command.pot_index is not None else self.pot_index,
            duration_sec=command.duration_sec or 5,
            # The bench has no firmware to poll the queue, so the row is stored
            # as already applied - it would otherwise sit "pending" forever and
            # the UI would claim an order was waiting for hardware that does
            # not exist.
            status="executed" if simulating else "pending",
        )
        self.db.add(cmd)
        self.db.commit()
        self.db.refresh(cmd)
        if simulating:
            # A real board reports the new actuator state back on its next poll;
            # the bench applies the command itself and writes the very same
            # `device_actuator_states` row, so the devices card shows the true
            # ON/OFF state rather than only the command intent.
            _apply_simulated_state(self.db, self.link.device_id, command)
            return CommandResult(
                "executed",
                f"تم تنفيذ الأمر على «{self.link.device_name}».",
                command_id=cmd.id,
            )
        return CommandResult(
            "queued",
            f"تم إرسال الأمر إلى الجهاز «{self.link.device_name}» (بانتظار التنفيذ والتأكيد).",
            command_id=cmd.id,
        )


def _apply_simulated_state(
    db: Session, device_id: int | None, command: ActuatorCommand
) -> None:
    """Record the actuator state the simulated unit is now in.

    Mirrors the write `/devices/{id}/report` performs for a real board: one row
    per actuator in `device_actuator_states`. `on`/`value` follow the command, so
    the UI reads genuine device feedback rather than the command intent alone.
    """
    if device_id is None:
        return
    row = (
        db.query(DeviceActuatorState)
        .filter(
            DeviceActuatorState.device_id == device_id,
            DeviceActuatorState.actuator == command.actuator,
        )
        .first()
    )
    if row is None:
        row = DeviceActuatorState(device_id=device_id, actuator=command.actuator)
        db.add(row)
    on = command.action in ("on", "set")
    row.on = on
    # A variable output reports the exact level; on/off outputs report nothing.
    row.value = command.value if on else (0 if command.value is not None else None)
    row.error = None
    row.reported_at = datetime.now(timezone.utc)
    db.commit()


def get_adapter(db: Session, plant: Plant, link: DeviceLink | None = None) -> BaseDeviceAdapter:
    link = link or build_link(db, plant)
    return LinkedDeviceAdapter(db, link, find_plant_pot_index(db, plant))
