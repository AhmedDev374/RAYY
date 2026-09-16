from datetime import datetime

from pydantic import BaseModel, EmailStr, Field


class UserCreate(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8)


class UserLogin(BaseModel):
    email: EmailStr
    password: str


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class UserOut(BaseModel):
    id: int
    email: str
    created_at: datetime

    model_config = {"from_attributes": True}


class PlantCreate(BaseModel):
    species: str
    nickname: str
    device_id: int | None = None
    pot_index: int | None = None


class PlantUpdate(BaseModel):
    species: str | None = None
    nickname: str | None = None
    device_id: int | None = None
    pot_index: int | None = None


class PlantOut(BaseModel):
    id: int
    species: str
    nickname: str
    device_id: int | None
    created_at: datetime

    model_config = {"from_attributes": True}


class ReadingOut(BaseModel):
    id: int
    plant_id: int | None = None
    pot_index: int = 0
    ts: int
    temperature: float
    humidity: float
    light: float
    soil_moisture: float
    ph: float = 6.5
    soil_status: str | None = None
    created_at: datetime | None = None

    model_config = {"from_attributes": True}


class BlynkReadingsResponse(BaseModel):
    connected: bool
    source: str = "blynk"
    latest: ReadingOut
    readings: list[ReadingOut]


class IngestReadingItem(BaseModel):
    pot_index: int = 0
    ts: int
    temperature: float
    humidity: float
    light: float
    soil_moisture: float
    ph: float = 6.5
    # Optional: only present when the matching sensor is actually installed.
    water_level_pct: float | None = None
    flow_lpm: float | None = None


class IngestPayload(BaseModel):
    readings: list[IngestReadingItem]


class SimulationState(BaseModel):
    # State of the built-in tomato sensor simulator. `source` is a hint for the
    # UI badge only -- the readings themselves are indistinguishable from real
    # ones because they flow through the same sensor pipeline.
    running: bool
    device_name: str
    device_id: int | None = None
    plant_id: int | None = None
    nickname: str
    species: str
    source: str = "simulation"
    interval_seconds: float
    started_at: float | None = None
    reading_count: int = 0
    last_values: dict | None = None
class DeviceRegisterResponse(BaseModel):
    device_id: int
    setup_token: str
    qr_payload: str
    claim_url: str


class DeviceClaimRequest(BaseModel):
    setup_token: str
    firmware_version: str | None = None


class DeviceClaimResponse(BaseModel):
    device_token: str
    ingest_url: str
    device_id: int


class DeviceOut(BaseModel):
    id: int
    name: str
    is_claimed: bool
    last_seen: datetime | None
    firmware_version: str | None
    created_at: datetime

    model_config = {"from_attributes": True}


class DeviceCommandRequest(BaseModel):
    action: str
    pot_index: int = 0
    duration_sec: int = 5


class DeviceCommandOut(BaseModel):
    id: int
    action: str
    pot_index: int
    duration_sec: int
    status: str

    model_config = {"from_attributes": True}


class DeviceCapabilityItem(BaseModel):
    """What the firmware says is wired to the board.

    `kind` is "actuator" or "sensor"; `key` uses the stable identifiers in
    `app.services.device_adapter` (pump, valve, fan, vent, grow_light,
    temperature, humidity, light, soil_moisture, water_level, flow).

    `variable` says whether the output accepts a 0-100% value (a dimmer or a
    speed-controlled fan) or is plain on/off. Omit it and RAYY falls back to the
    actuator's model; declare `false` and the UI shows ON/OFF only, never a
    slider that cannot do anything.
    """

    key: str
    kind: str = "actuator"
    supported: bool = False
    status: str = "not_installed"
    detail: str | None = None
    variable: bool | None = None


class DeviceActuatorStateItem(BaseModel):
    actuator: str
    on: bool = False
    value: float | None = None
    error: str | None = None


class DeviceReportRequest(BaseModel):
    """Heartbeat from a real node: capabilities, actuator states, tank/flow."""

    firmware_version: str | None = None
    capabilities: list[DeviceCapabilityItem] | None = None
    actuators: list[DeviceActuatorStateItem] | None = None
    water_level_pct: float | None = None
    flow_lpm: float | None = None


class DeviceReportResponse(BaseModel):
    ok: bool = True
    server_time: int
    poll_seconds: int = 3
    emergency_stop: bool = False
    plant_id: int | None = None
    mode: str | None = None
    note: str | None = None


class DeviceCommandAck(BaseModel):
    """Result of executing a command on the board (real feedback loop)."""

    ok: bool
    detail: str | None = None
    value: float | None = None
    water_used_l: float | None = None


class DiagnosisOut(BaseModel):
    id: int
    plant_id: int | None
    image_url: str
    class_name: str | None
    plant_species: str | None
    disease: str | None
    confidence: float | None
    status: str
    treatment_json: dict | None
    created_at: datetime

    model_config = {"from_attributes": True}


class CareEventCreate(BaseModel):
    event_type: str
    notes: str | None = None


class CareEventOut(BaseModel):
    id: int
    plant_id: int
    event_type: str
    notes: str | None
    created_at: datetime

    model_config = {"from_attributes": True}


class AiSupport(BaseModel):
    """Reusable, never-guessed AI-compatibility flag.

    `supported`/`model` are always seeded as `False`/`None`. Real values are
    meant to be supplied later from the user's own AgroScan `labels.json`.
    """

    supported: bool = False
    model: str | None = None


class SpeciesProfileOut(BaseModel):
    id: int
    species: str

    # Identity
    name_ar: str
    name_en: str
    scientific_name: str
    family: str
    category: str
    aliases: list[str] | None = None
    image_url: str | None = None

    # Arabic content
    description_ar: str
    watering_ar: str
    fertilization_ar: str
    greenhouse_guidance_ar: str
    common_pests: dict | None
    nutrient_deficiencies: dict | None
    ai_support: AiSupport

    # Original fields, preserved for backward compatibility
    thresholds: dict
    care_guide: str
    seasonal_tips: str
    common_diseases: dict | None

    model_config = {"from_attributes": True}


class CategoryOut(BaseModel):
    key: str
    label_ar: str
    icon: str


class DiseaseReportCreate(BaseModel):
    disease: str
    species: str | None = None
    latitude: float | None = None
    longitude: float | None = None
    region: str | None = None


class DiseaseMapPoint(BaseModel):
    geohash: str
    region: str | None
    disease: str
    count: int


class ControlRange(BaseModel):
    min: float
    max: float
    ideal: float | None = None


class ControlTargets(BaseModel):
    temperature: ControlRange | None = None
    humidity: ControlRange | None = None
    soil_moisture: ControlRange | None = None
    light: ControlRange | None = None


class ControlSettingsUpdate(BaseModel):
    """Partial update. Every field is optional -- only what is sent changes."""

    mode: str | None = None
    targets: dict | None = None
    water_tank_pct: float | None = None
    water_tank_capacity_l: float | None = None
    # Pump runtime ceiling (seconds). Omit to leave unchanged; send 0 to reset
    # to the engine default. Values outside the allowed range are rejected.
    irrigation_max_runtime_sec: int | None = None


class ControlModeRequest(BaseModel):
    plant_id: int
    mode: str


class ControlManualCommand(BaseModel):
    plant_id: int
    actuator: str
    action: str  # on | off | set
    value: float | None = None
    duration_sec: int | None = None


class ControlAutoRequest(BaseModel):
    plant_id: int


class ControlEmergencyStopRequest(BaseModel):
    plant_id: int
    reason: str | None = None


class ControlScheduleCreate(BaseModel):
    plant_id: int
    system: str
    actuator: str | None = None
    action: str = "on"
    value: float | None = None
    duration_sec: int = 0
    time_of_day: str = Field(pattern=r"^([01]\d|2[0-3]):[0-5]\d$")
    days: list[int] = Field(default_factory=lambda: [0, 1, 2, 3, 4, 5, 6])
    enabled: bool = True
    note: str | None = None


class ControlScheduleUpdate(BaseModel):
    """Partial edit of a scheduled task. Only what is sent changes."""

    system: str | None = None
    action: str | None = None
    value: float | None = None
    duration_sec: int | None = None
    time_of_day: str | None = Field(default=None, pattern=r"^([01]\d|2[0-3]):[0-5]\d$")
    days: list[int] | None = None
    enabled: bool | None = None
    note: str | None = None


class ControlEventOut(BaseModel):
    id: int
    plant_id: int
    system: str
    system_label: str | None = None
    actuator: str | None
    actuator_label: str | None = None
    action: str
    action_label: str | None = None
    value: float | None
    reason: str
    result: str
    result_detail: str | None
    source: str
    severity: str
    created_at: datetime

    model_config = {"from_attributes": True}


class ControlScheduleOut(BaseModel):
    id: int
    plant_id: int
    system: str
    system_label: str | None = None
    actuator: str | None
    actuator_label: str | None = None
    action: str
    action_label: str | None = None
    value: float | None
    duration_sec: int
    time_of_day: str
    days: list[int]
    enabled: bool
    note: str | None
    last_run_at: datetime | None

    model_config = {"from_attributes": True}


class ChatRequest(BaseModel):
    plant_id: int | None = None
    message: str


class ChatResponse(BaseModel):
    reply: str
