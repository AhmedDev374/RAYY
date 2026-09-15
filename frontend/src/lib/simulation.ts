import { api } from './api';

// Mirrors backend `SimulationState`. The simulator writes readings through the
// normal sensor pipeline, so `plant_id` here is an ordinary plant id that the
// dashboard can select and chart like any other.
export interface SimulationState {
  running: boolean;
  device_name: string;
  device_id: number | null;
  plant_id: number | null;
  nickname: string;
  species: string;
  source: string;
  interval_seconds: number;
  started_at: number | null;
  reading_count: number;
  last_values: Record<string, number> | null;
}

/** Turn Simulation Mode ON. Idempotent — repeated calls never start a second run. */
export function startSimulation() {
  return api<SimulationState>('/api/v1/simulation/start', { method: 'POST' });
}

/** Turn Simulation Mode OFF. Stops new readings; history is preserved. */
export function stopSimulation() {
  return api<SimulationState>('/api/v1/simulation/stop', { method: 'POST' });
}

/** Current simulator status (used to restore the toggle after a refresh). */
export function getSimulationStatus() {
  return api<SimulationState>('/api/v1/simulation/status');
}
