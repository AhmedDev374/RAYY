import { api } from './api';

// ---------------------------------------------------------------------------
// Types — mirror of app/services/control_engine.build_snapshot()
//
// Every user-facing string (reason, status_label, action_label, result_label)
// is produced by the backend in Arabic, so the UI never has to invent wording
// for a decision it did not make.
// ---------------------------------------------------------------------------

export type ControlMode = 'auto' | 'manual' | 'scheduled';
export type Severity = 'ok' | 'info' | 'warning' | 'critical';

export interface ControlRange {
  min: number;
  max: number;
  ideal: number | null;
  label: string;
  unit: string;
  text: string;
}

export interface ControlTargets {
  temperature: ControlRange;
  humidity: ControlRange;
  soil_moisture: ControlRange;
  light: ControlRange;
}

export interface ControlMeasure {
  label: string;
  value: number | null;
  unit: string;
  text: string;
}

export interface ControlActuator {
  key: string;
  label: string;
  icon: string;
  unit: string | null;
  supported: boolean;
  online: boolean;
  support_reason: string;
  capability_status: string;
  capability_status_label: string;
  /** True when this output is the software bench, not real hardware. */
  simulated: boolean;
  /** True when the component is missing/offline (i.e. needs hardware work). */
  hardware_dependent: boolean;
  /** True when the output accepts 0-100% (dimmer/speed) rather than on/off. */
  variable: boolean;
  on: boolean;
  value: number | null;
  state_label: string;
  reported: {
    actuator: string;
    label: string;
    on: boolean;
    value: number | null;
    error: string | null;
    reported: boolean;
    reported_age_seconds: number | null;
  } | null;
}

export interface ControlSystem {
  key: string;
  label: string;
  icon: string;
  description: string;
  active: boolean;
  status: string;
  status_label: string;
  severity: Severity;
  reason: string;
  detail: string;
  action: string;
  action_label: string;
  value: number | null;
  current: ControlMeasure;
  target: ControlRange;
  actuators: ControlActuator[];
  capability: { supported: boolean; reason: string };
  controllable: boolean;
  hardware_dependent: boolean;
  mode: string;
  mode_label: string;
}

export interface DeviceLinkComponent {
  key: string;
  kind: 'sensor' | 'actuator';
  label: string;
  supported: boolean;
  online: boolean;
  status: string;
  status_label: string;
  reason: string;
  hardware_dependent: boolean;
  simulated: boolean;
  /** From the firmware: false = ON/OFF only, null = not declared. */
  variable: boolean | null;
}

/** @deprecated kept for callers typed against the older actuator-only shape. */
export interface DeviceLinkActuator extends DeviceLinkComponent {
  actuator?: string;
}

export interface ControlSensorDetail {
  key: string;
  label: string;
  unit: string;
  value: number | null;
  text: string;
  supported: boolean;
  online: boolean;
  status: string;
  status_label: string;
  reason: string;
  hardware_dependent: boolean;
}

export interface ControlDeviceLink {
  device_id: number | null;
  device_name: string;
  connected: boolean;
  source: 'hardware' | 'simulation' | 'none';
  last_seen_seconds: number | null;
  firmware_version: string | null;
  capabilities_declared: boolean;
  capabilities: DeviceLinkComponent[];
  sensors: DeviceLinkComponent[];
  actuators: DeviceLinkComponent[];
  reported_states: {
    actuator: string;
    label: string;
    on: boolean;
    value: number | null;
    error: string | null;
    reported: boolean;
    reported_age_seconds: number | null;
  }[];
}

export interface ControlEvent {
  id: number;
  plant_id: number;
  system: string;
  system_label: string;
  actuator: string | null;
  actuator_label: string | null;
  action: string;
  action_label: string;
  value: number | null;
  reason: string;
  result: string;
  result_label: string;
  result_detail: string | null;
  source: string;
  source_label: string;
  severity: Severity;
  time_label: string;
  created_at: string;
}

export interface ControlSchedule {
  id: number;
  plant_id: number;
  system: string;
  system_label: string;
  actuator: string | null;
  actuator_label: string | null;
  action: string;
  action_label: string;
  value: number | null;
  duration_sec: number;
  time_of_day: string;
  days: number[];
  enabled: boolean;
  note: string | null;
  last_run_at: string | null;
}

export interface ControlSnapshot {
  plant: { id: number; nickname: string; species: string };
  mode: ControlMode;
  mode_label: string;
  modes: { key: ControlMode; label: string }[];
  emergency_stop: boolean;
  emergency_stop_reason: string | null;
  overall_status: { key: string; label: string; detail: string };
  sensors: {
    available: boolean;
    status: string;
    label: string;
    detail: string;
    age_seconds: number | null;
  };
  device_link: ControlDeviceLink;
  targets: ControlTargets;
  targets_source: 'species' | 'custom';
  systems: ControlSystem[];
  controlled_systems: { key: string; label: string; icon: string }[];
  sensor_details: ControlSensorDetail[];
  tank: {
    known: boolean;
    level_pct: number | null;
    source: 'sensor' | 'manual' | 'unknown';
    source_label: string;
    sensor_available: boolean;
    sensor_reason: string;
    capacity_l: number;
    used_today_l: number;
    used_today_estimated: boolean;
    used_today_source_label: string;
    flow_lpm: number | null;
    flow_sensor_available: boolean;
    status: string;
    status_label: string;
    warning: string;
    critical_pct: number;
    low_pct: number;
  };
  safety: {
    pump_max_runtime_seconds: number;
    pump_max_runtime_default_seconds: number;
    pump_max_runtime_is_default: boolean;
    pump_max_runtime_bounds: [number, number];
    pump_min_interval_seconds: number;
    actuator_min_switch_seconds: number;
    sensor_stale_seconds: number;
    flow_min_lpm: number;
    tank_critical_pct: number;
    tank_low_pct: number;
    rules: {
      key: string;
      label: string;
      enabled: boolean;
      hardware_dependent: boolean;
      detail: string;
    }[];
  };
  alerts: {
    kind: string;
    severity: Severity;
    title: string;
    detail: string;
    action_hint: string | null;
    hardware_dependent: boolean;
    source: string;
    signature: string;
  }[];
  reading: {
    ts: number;
    temperature: number;
    humidity: number;
    light: number;
    soil_moisture: number;
    ph: number;
  } | null;
  decisions: {
    system: string;
    system_label: string;
    action: string;
    action_label: string;
    actuator: string | null;
    actuator_label: string | null;
    value: number | null;
    reason: string;
    severity: Severity;
  }[];
  pipeline: string[];
  history: ControlEvent[];
  schedules: ControlSchedule[];
  generated_at: string;
}

export interface ControlSettingsResponse {
  plant_id: number;
  mode: ControlMode;
  mode_label: string;
  emergency_stop: boolean;
  targets: Omit<ControlTargets, 'temperature' | 'humidity' | 'soil_moisture' | 'light'> & {
    [key: string]: { min: number; max: number; ideal: number | null };
  };
  targets_source: 'species' | 'custom';
  overrides: Record<string, { min?: number; max?: number; ideal?: number }>;
  actuators: Record<string, { on: boolean; value: number | null; source: string | null }>;
  water_tank_pct: number | null;
  water_tank_capacity_l: number;
  /** Pump runtime ceiling in seconds, and whether it is the engine default. */
  irrigation_max_runtime_sec: number;
  irrigation_max_runtime_is_default: boolean;
  irrigation_max_runtime_bounds: [number, number];
  updated_at: string;
}

export interface ControlSettingsUpdate {
  mode?: ControlMode;
  targets?: Record<string, { min?: number; max?: number } | null>;
  water_tank_pct?: number | null;
  water_tank_capacity_l?: number;
  /** 0 resets to the engine default; otherwise 30..3600 seconds. */
  irrigation_max_runtime_sec?: number;
}

export interface ControlActionResult {
  ok: boolean;
  event: ControlEvent;
  snapshot: ControlSnapshot;
}

// ---------------------------------------------------------------------------
// Endpoints
// ---------------------------------------------------------------------------
export function getControlStatus(plantId: number) {
  return api<ControlSnapshot>(`/api/v1/control/status/${plantId}`);
}

export function getControlSettings(plantId: number) {
  return api<ControlSettingsResponse>(`/api/v1/control/settings/${plantId}`);
}

export function updateControlSettings(plantId: number, payload: ControlSettingsUpdate) {
  return api<ControlSettingsResponse>(`/api/v1/control/settings/${plantId}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

export function updateControlTargets(
  plantId: number,
  targets: Record<string, { min?: number; max?: number } | null>,
) {
  return updateControlSettings(plantId, { targets });
}

export function setControlMode(plantId: number, mode: ControlMode) {
  return api<{ plant_id: number; mode: ControlMode; mode_label: string }>('/api/v1/control/mode', {
    method: 'POST',
    body: JSON.stringify({ plant_id: plantId, mode }),
  });
}

export function setControlAuto(plantId: number) {
  return api<{ plant_id: number; mode: ControlMode; mode_label: string }>('/api/v1/control/auto', {
    method: 'POST',
    body: JSON.stringify({ plant_id: plantId }),
  });
}

export function sendManualCommand(
  plantId: number,
  actuator: string,
  action: 'on' | 'off' | 'set',
  value?: number | null,
  durationSec?: number | null,
) {
  return api<ControlActionResult>('/api/v1/control/manual', {
    method: 'POST',
    body: JSON.stringify({
      plant_id: plantId,
      actuator,
      action,
      value: value ?? null,
      duration_sec: durationSec ?? null,
    }),
  });
}

export function controlEmergencyStop(plantId: number) {
  return api<{ ok: boolean; emergency_stop: boolean; message: string; snapshot: ControlSnapshot }>(
    '/api/v1/control/emergency-stop',
    { method: 'POST', body: JSON.stringify({ plant_id: plantId }) },
  );
}

export function controlEmergencyReset(plantId: number) {
  return api<{ ok: boolean; emergency_stop: boolean; message: string; snapshot: ControlSnapshot }>(
    '/api/v1/control/emergency-reset',
    { method: 'POST', body: JSON.stringify({ plant_id: plantId }) },
  );
}

export function listSchedules(plantId: number) {
  return api<ControlSchedule[]>(`/api/v1/control/schedule/${plantId}`);
}

export interface ScheduleInput {
  plant_id: number;
  system: string;
  action: 'on' | 'off' | 'set';
  value?: number | null;
  duration_sec?: number;
  time_of_day: string;
  days: number[];
  enabled?: boolean;
  note?: string | null;
}

export function createSchedule(payload: ScheduleInput) {
  return api<ControlSchedule>('/api/v1/control/schedule', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export interface ScheduleUpdate {
  system?: string;
  action?: 'on' | 'off' | 'set';
  value?: number | null;
  duration_sec?: number;
  time_of_day?: string;
  days?: number[];
  enabled?: boolean;
  note?: string | null;
}

export function updateSchedule(scheduleId: number, payload: ScheduleUpdate) {
  return api<ControlSchedule>(`/api/v1/control/schedule/${scheduleId}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

export function deleteSchedule(scheduleId: number) {
  return api<void>(`/api/v1/control/schedule/${scheduleId}`, { method: 'DELETE' });
}

export function getControlHistory(plantId: number, limit = 50) {
  return api<{ plant_id: number; events: ControlEvent[] }>(
    `/api/v1/control/history/${plantId}?limit=${limit}`,
  );
}

// ---------------------------------------------------------------------------
// Shared display helpers (Arabic labels used by the UI shell itself)
// ---------------------------------------------------------------------------
export const ACTUATOR_UI: Record<string, { label: string; icon: string; unit: string | null }> = {
  pump: { label: 'مضخة الري', icon: '💧', unit: null },
  valve: { label: 'صمام الري', icon: '🚰', unit: null },
  fan: { label: 'المروحة', icon: '🌬️', unit: '%' },
  vent: { label: 'فتحات الصوبة', icon: '🪟', unit: '%' },
  grow_light: { label: 'إضاءة النمو', icon: '☀️', unit: '%' },
  tank: { label: 'خزان المياه', icon: '🚰', unit: '%' },
};

/**
 * Water quantities offered as one-tap irrigation presets. The backend converts
 * a duration into an estimate; without a flow sensor the delivered volume is
 * never claimed as measured.
 */
export const WATER_PRESETS_ML = [100, 250, 500, 1000];

/** Nominal flow used to turn a requested volume into a pump runtime. */
export const NOMINAL_FLOW_L_PER_MIN = 0.6;

export function mlToDurationSec(ml: number): number {
  return Math.max(1, Math.round((ml / 1000 / NOMINAL_FLOW_L_PER_MIN) * 60));
}

export function describeDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)} ثانية`;
  const minutes = seconds / 60;
  return `${Number.isInteger(minutes) ? minutes : minutes.toFixed(1)} دقيقة`;
}

export const SYSTEM_UI: Record<string, { label: string; icon: string }> = {
  irrigation: { label: 'الري', icon: '💧' },
  temperature: { label: 'درجة الحرارة', icon: '🌡️' },
  ventilation: { label: 'التهوية', icon: '🌬️' },
  lighting: { label: 'الإضاءة', icon: '☀️' },
  water_tank: { label: 'خزان المياه', icon: '🚰' },
  system: { label: 'النظام', icon: '⚙️' },
};

export const WEEKDAYS_AR = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

export const DEVICE_SOURCE_AR: Record<string, string> = {
  hardware: 'أجهزة حقيقية',
  simulation: 'وحدة تحكم ذكية',
  none: 'غير متصل',
};
