// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ControlCenter from './ControlCenter';
import type { ControlSnapshot } from '../../lib/control';

// These tests mount the REAL ControlCenter, click the REAL control buttons and
// assert the visible text on the card changes — i.e. the exact chain the ticket
// asks for: onClick → command → state update → re-render → visible ON/OFF.
//
// The network is the only thing stubbed: `api()` calls `fetch`, so a fetch mock
// returns the control snapshot the backend would return.

function actuator(overrides: Record<string, unknown> = {}) {
  return {
    key: 'pump',
    label: 'مضخة الري',
    icon: '💧',
    unit: null,
    supported: true,
    online: true,
    support_reason: '',
    capability_status: 'simulation',
    capability_status_label: 'وحدة تحكم ذكية',
    simulated: true,
    hardware_dependent: false,
    variable: false,
    on: false,
    value: null,
    state_label: 'متوقف',
    reported: null,
    ...overrides,
  };
}

function snapshotWith(pumpOn: boolean, fanOn = false, ventValue: number | null = 0): ControlSnapshot {
  return {
    plant: { id: 1, nickname: 'مزرعة الطماطم', species: 'Tomato' },
    mode: 'manual',
    mode_label: 'يدوي',
    modes: [
      { key: 'auto', label: 'تلقائي' },
      { key: 'manual', label: 'يدوي' },
      { key: 'scheduled', label: 'مجدول' },
    ],
    emergency_stop: false,
    emergency_stop_reason: null,
    overall_status: { key: 'ok', label: 'يعمل بشكل طبيعي', detail: 'كل شيء جيد.' },
    sensors: { available: true, status: 'ok', label: 'متاحة', detail: '', age_seconds: 2 },
    device_link: {
      device_id: 9,
      device_name: 'RAYY-SIM-TOMATO-001',
      connected: true,
      source: 'simulation',
      last_seen_seconds: 2,
      firmware_version: null,
      capabilities_declared: true,
      capabilities: [],
      sensors: [],
      actuators: [],
      reported_states: [],
    },
    targets: {
      temperature: { min: 18, max: 29, ideal: 24, label: 'درجة الحرارة', unit: '°C', text: '18 — 29' },
      humidity: { min: 55, max: 80, ideal: 65, label: 'رطوبة الهواء', unit: '%', text: '55 — 80' },
      soil_moisture: { min: 50, max: 80, ideal: 65, label: 'رطوبة التربة', unit: '%', text: '50 — 80' },
      light: { min: 900, max: 1200, ideal: 1050, label: 'شدة الإضاءة', unit: 'لوكس', text: '900 — 1200' },
    },
    targets_source: 'species',
    systems: [
      {
        key: 'irrigation',
        label: 'نظام الري',
        icon: '💧',
        description: '',
        active: true,
        status: 'ok',
        status_label: 'طبيعي',
        severity: 'ok',
        reason: '',
        detail: '',
        action: 'hold',
        action_label: 'مراقبة',
        value: 62,
        current: { label: 'رطوبة التربة', value: 62, unit: '%', text: '62%' },
        target: { min: 50, max: 80, ideal: 65, label: 'رطوبة التربة', unit: '%', text: '50 — 80' },
        actuators: [actuator({ key: 'pump', on: pumpOn, state_label: pumpOn ? 'يعمل' : 'متوقف' })],
        capability: { supported: true, reason: '' },
        controllable: true,
        hardware_dependent: false,
        mode: 'manual',
        mode_label: 'يدوي',
      },
      {
        key: 'ventilation',
        label: 'التهوية',
        icon: '🌬️',
        description: '',
        active: true,
        status: 'ok',
        status_label: 'طبيعي',
        severity: 'ok',
        reason: '',
        detail: '',
        action: 'hold',
        action_label: 'مراقبة',
        value: 60,
        current: { label: 'رطوبة الهواء', value: 60, unit: '%', text: '60%' },
        target: { min: 55, max: 80, ideal: 65, label: 'رطوبة الهواء', unit: '%', text: '55 — 80' },
        actuators: [
          actuator({
            key: 'fan',
            label: 'المروحة',
            icon: '🌬️',
            unit: '%',
            variable: true,
            on: fanOn,
            value: fanOn ? 60 : null,
            state_label: fanOn ? 'يعمل — 60%' : 'متوقف',
          }),
          actuator({ key: 'vent', label: 'فتحات الصوبة', icon: '🪟', unit: '%', variable: true, on: ventValue !== null, value: ventValue, state_label: ventValue !== null ? `مفتوحة — ${ventValue}%` : 'مغلقة' }),
        ],
        capability: { supported: true, reason: '' },
        controllable: true,
        hardware_dependent: false,
        mode: 'manual',
        mode_label: 'يدوي',
      },
    ],
    controlled_systems: [],
    sensor_details: [],
    tank: {
      known: true,
      level_pct: 78,
      source: 'sensor',
      source_label: 'حساس مستوى المياه',
      sensor_available: true,
      sensor_reason: '',
      capacity_l: 20,
      used_today_l: 0,
      used_today_estimated: true,
      used_today_source_label: 'تقديري',
      flow_lpm: null,
      flow_sensor_available: false,
      status: 'ok',
      status_label: 'طبيعي',
      warning: '',
      critical_pct: 15,
      low_pct: 30,
    },
    safety: {
      pump_max_runtime_seconds: 180,
      pump_max_runtime_default_seconds: 180,
      pump_max_runtime_is_default: true,
      pump_max_runtime_bounds: [30, 3600],
      pump_min_interval_seconds: 60,
      actuator_min_switch_seconds: 30,
      sensor_stale_seconds: 900,
      flow_min_lpm: 0.05,
      tank_critical_pct: 15,
      tank_low_pct: 30,
      rules: [],
    },
    alerts: [],
    reading: { ts: 1700000, temperature: 27, humidity: 68, light: 8450, soil_moisture: 62, ph: 6.5 },
    decisions: [],
    pipeline: [],
    history: [],
    schedules: [],
    generated_at: '2026-09-16T09:00:00+00:00',
  } as unknown as ControlSnapshot;
}

let container: HTMLDivElement;
let root: Root;

function mount(node: React.ReactNode) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root.render(node);
  });
}

function withProviders(node: React.ReactNode, client: QueryClient) {
  return <QueryClientProvider client={client}>{node}</QueryClientProvider>;
}

/** Wait for React Query to settle the initial fetch. */
async function settle() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 50));
  });
}

function findButton(text: string): HTMLButtonElement {
  const buttons = Array.from(container.querySelectorAll('button'));
  const match = buttons.find((b) => b.textContent?.trim().includes(text));
  if (!match) throw new Error(`button not found: ${text}\n${container.innerHTML.slice(0, 500)}`);
  return match as HTMLButtonElement;
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

/// <reference types="vitest" />
function mockFetch(initial: ControlSnapshot, onCommand: (body: any) => ControlSnapshot) {
  let current = initial;
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (String(url).includes('/control/manual')) {
      current = onCommand(JSON.parse(String(init?.body ?? '{}')));
      return new Response(
        JSON.stringify({
          ok: true,
          event: {
            id: 9, plant_id: 1, system: 'ventilation', system_label: 'التهوية',
            actuator: 'vent', actuator_label: 'فتحات الصوبة', action: 'set', action_label: 'ضبط',
            value: 100, reason: '', result: 'executed', result_label: 'تم التنفيذ',
            result_detail: null, source: 'manual', source_label: 'يدوي', severity: 'info',
            time_label: '11:00', created_at: 'x',
          },
          snapshot: current,
        }),
        { status: 200 },
      );
    }
    return new Response(JSON.stringify(current), { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return () => current;
}

describe('ControlCenter — a click visibly changes the control state', () => {
  it('vents: فتح بالكامل / إغلاق بالكامل reflect the applied opening', async () => {
    mockFetch(snapshotWith(false, false, 0), () => snapshotWith(false, false, 100));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }}});
    mount(withProviders(<ControlCenter plantId={1} />, client));
    await settle();

    // Closed to start: إغلاق بالكامل is the pressed one.
    expect(findButton('إغلاق بالكامل').getAttribute('aria-pressed')).toBe('true');
    expect(findButton('فتح بالكامل').getAttribute('aria-pressed')).toBe('false');

    await act(async () => {
      findButton('فتح بالكامل').click();
      await new Promise((r) => setTimeout(r, 100));
    });

    // After the click the valve reads OPEN — 100% and فتح بالكامل is pressed.
    expect(container.innerHTML).toContain('مفتوحة — 100%');
    expect(findButton('فتح بالكامل').getAttribute('aria-pressed')).toBe('true');
    expect(findButton('إغلاق بالكامل').getAttribute('aria-pressed')).toBe('false');
  });

  it('rolls back the optimistic state when the command fails', async () => {
    let current = snapshotWith(false, false, 0);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (String(url).includes('/control/manual')) {
          return new Response(JSON.stringify({ detail: 'فشل الجهاز' }), { status: 500 });
        }
        return new Response(JSON.stringify(current), { status: 200 });
      }),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }}});
    mount(withProviders(<ControlCenter plantId={1} />, client));
    await settle();

    await act(async () => {
      findButton('فتح بالكامل').click();
      await new Promise((r) => setTimeout(r, 120));
    });

    // The command failed, so the UI must NOT keep claiming the valve is open.
    expect(findButton('إغلاق بالكامل').getAttribute('aria-pressed')).toBe('true');
    expect(findButton('فتح بالكامل').getAttribute('aria-pressed')).toBe('false');
  });

  it('pump: تشغيل المضخة becomes the active button after the pump turns on', async () => {
    // First GET returns pump OFF; the POST returns pump ON (as the backend would).
    let current = snapshotWith(false);
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).includes('/control/manual')) {
        current = snapshotWith(true);
        return new Response(
          JSON.stringify({
            ok: true,
            event: {
              id: 1, plant_id: 1, system: 'irrigation', system_label: 'نظام الري',
              actuator: 'pump', actuator_label: 'مضخة الري', action: 'on', action_label: 'تشغيل',
              value: null, reason: '', result: 'executed', result_label: 'تم التنفيذ',
              result_detail: null, source: 'manual', source_label: 'يدوي', severity: 'info',
              time_label: '11:00', created_at: 'x',
            },
            snapshot: current,
          }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify(current), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = new QueryClient({ defaultOptions: { queries: { retry: false }}});
    mount(withProviders(<ControlCenter plantId={1} />, client));
    await settle();

    // Before any click: pump is OFF, so the OFF button is the pressed one and
    // the card shows the stopped state.
    expect(findButton('إيقاف المضخة').getAttribute('aria-pressed')).toBe('true');
    expect(findButton('💧 تشغيل المضخة').getAttribute('aria-pressed')).toBe('false');
    expect(container.innerHTML).toContain('المضخة متوقفة');

    await act(async () => {
      findButton('💧 تشغيل المضخة').click();
      await new Promise((r) => setTimeout(r, 10));
    });
    // The confirm dialog appears — confirm it (the confirm button is the one
    // inside the dialog, not the card button).
    const dialog = container.querySelector('[role="dialog"]') ?? container;
    const confirm = Array.from(dialog.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'تشغيل',
    ) as HTMLButtonElement;
    await act(async () => {
      confirm.click();
      await new Promise((r) => setTimeout(r, 100));
    });

    // After the click the pump is visibly ON: the badge, and the pressed state
    // of the ON button, both changed — no page refresh involved.
    expect(container.innerHTML).toContain('المضخة تعمل');
    expect(findButton('💧 تشغيل المضخة').getAttribute('aria-pressed')).toBe('true');
    expect(findButton('إيقاف المضخة').getAttribute('aria-pressed')).toBe('false');
  });

  it('quick control: the toggle flips the fan to ON and the card reacts at once', async () => {
    mockFetch(snapshotWith(false, false, 0), () => snapshotWith(false, true, 0));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }}});
    mount(withProviders(<ControlCenter plantId={1} />, client));
    await settle();

    // Locate the fan card's switch: the quick-control card that holds the
    // "المروحة" heading and its own role=switch toggle.
    const fanCard = Array.from(container.querySelectorAll('div')).find((d) =>
      d.textContent?.includes('المروحة'),
    ) as HTMLDivElement;
    const fanSwitch = fanCard.querySelector('button[role="switch"]') as HTMLButtonElement;
    expect(fanSwitch.getAttribute('aria-checked')).toBe('false');

    await act(async () => {
      fanSwitch.click();
      await new Promise((r) => setTimeout(r, 150));
    });

    // The toggle is ON and the device card shows the running state.
    const fanSwitches = container.querySelectorAll('button[role="switch"]');
    const anyOn = Array.from(fanSwitches).some(
      (s) => s.getAttribute('aria-checked') === 'true',
    );
    expect(anyOn).toBe(true);
    expect(container.innerHTML).toContain('● تعمل');
  });
});
