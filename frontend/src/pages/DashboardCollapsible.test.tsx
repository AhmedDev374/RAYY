﻿// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DashboardPage from './DashboardPage';
import { CollapsibleProvider } from '../components/collapsible';
import type { ControlSnapshot } from '../lib/control';

// ---------------------------------------------------------------------------
// These tests mount the REAL dashboard, click the REAL global controls and the
// REAL section headers, and assert against the real section state:
//
//   * "توسيع الكل"  -> EVERY section header reports aria-expanded="true"
//   * "طي الكل"     -> EVERY section header reports aria-expanded="false"
//   * a single header click only changes THAT section (mixed state is kept)
//   * collapsing a section never resets the device controls it contains, and
//     never stops the live sensor/tank values.
// ---------------------------------------------------------------------------

const plant = { id: 7, species: 'Tomato', nickname: 'مزرعة الطماطم' };

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

function snapshot(temperature = 27): ControlSnapshot {
  return {
    plant,
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
        actuators: [actuator({ key: 'pump', on: true, state_label: 'يعمل' })],
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
            on: true,
            value: 70,
            state_label: 'يعمل — 70%',
          }),
          actuator({
            key: 'vent',
            label: 'فتحات الصوبة',
            icon: '🪟',
            unit: '%',
            variable: true,
            on: true,
            value: 80,
            state_label: 'مفتوحة — 80%',
          }),
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
    reading: { ts: 1700000, temperature, humidity: 68, light: 8450, soil_moisture: 62, ph: 6.5 },
    decisions: [],
    pipeline: [],
    history: [
      {
        id: 1,
        plant_id: 7,
        system: 'ventilation',
        system_label: 'التهوية',
        actuator: 'fan',
        actuator_label: 'المروحة',
        action: 'on',
        action_label: 'تشغيل',
        value: 70,
        reason: 'ارتفاع الحرارة.',
        result: 'executed',
        result_label: 'تم التنفيذ',
        result_detail: null,
        source: 'manual',
        source_label: 'يدوي',
        severity: 'info',
        time_label: '11:00',
        created_at: 'x',
      },
    ],
    schedules: [],
    generated_at: '2026-09-16T09:00:00+00:00',
  } as unknown as ControlSnapshot;
}

let container: HTMLDivElement;
let root: Root;
let client: QueryClient;
let current = snapshot();

// jsdom implements neither ResizeObserver nor layout: the section body uses it
// to keep its open height in sync, so a no-op stand-in is enough here.
class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

/** Fill the shared React Query cache with the entries the real queries use. */
function seedCache(client: QueryClient) {
  client.setQueryData(['plants'], [plant]);
  client.setQueryData(['readings', plant.id], [current.reading]);
  client.setQueryData(['control-status', plant.id], current);
  client.setQueryData(['simulation-status'], {
    running: true,
    plant_id: plant.id,
    device_id: 9,
    nickname: plant.nickname,
    species: plant.species,
    source: 'simulation',
    interval_seconds: 3,
    started_at: 1700000,
    reading_count: 10,
    last_values: null,
    device_name: 'RAYY-SIM-TOMATO-001',
  });
}

beforeEach(() => {
  current = snapshot();
  vi.stubGlobal('ResizeObserver', NoopResizeObserver);
  // No route is reached: getAccessToken() waits on a mocked Supabase session,
  // so the cache above is the data source. The live-refresh test below proves
  // an updated cached snapshot reaches the collapsed cards.
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

async function settle() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 60));
  });
}

function mount() {
  // Seed the shared cache with the same entries the real queries would fill, so
  // the test exercises the real sections without depending on the mocked
  // Supabase session timing. The live-refresh test below re-seeds the
  const queries = { retry: false, staleTime: Infinity, refetchOnMount: false, refetchOnWindowFocus: false };
  client = new QueryClient({ defaultOptions: { queries } });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root.render(
      <QueryClientProvider client={client}>
        <CollapsibleProvider>
          <DashboardPage />
        </CollapsibleProvider>
      </QueryClientProvider>,
    );
  });
}

/** Every collapsible section header currently in the dashboard. */
function headers() {
  return Array.from(container.querySelectorAll('button[aria-controls^="section-body-"]')).map((node) => {
    const el = node as HTMLButtonElement;
    return {
      el,
      key: (el.getAttribute('aria-controls') ?? '').replace('section-body-', ''),
      expanded: el.getAttribute('aria-expanded'),
    };
  });
}

function headerFor(key: string) {
  const found = headers().find((h) => h.key === key);
  if (!found) throw new Error(`section not found: ${key}\n${container.innerHTML.slice(0, 400)}`);
  return found.el;
}

function buttonByLabel(label: string): HTMLButtonElement {
  const match = Array.from(container.querySelectorAll('button')).find((b) =>
    (b.getAttribute('aria-label') ?? b.textContent ?? '').includes(label),
  );
  if (!match) throw new Error(`button not found: ${label}`);
  return match as HTMLButtonElement;
}

async function click(node: HTMLElement) {
  await act(async () => {
    node.click();
    await new Promise((r) => setTimeout(r, 30));
  });
}

describe('نظام الأقسام القابلة للطي — لوحة التحكم', () => {
  it('يعرض كل الأقسام القابلة للطي ويضع أزرار التحكم العامة في الأعلى', async () => {
    mount();
    await settle();

    const keys = headers().map((h) => h.key);
    // 13 distinct collapsible sections on the dashboard (بطاقة الحرارة تخدم قسمين).
    expect(keys).toContain('controlCenter');
    expect(keys).toContain('quickControl');
    expect(keys).toContain('irrigation');
    expect(keys).toContain('ventilation');
    expect(keys).toContain('temperature');
    expect(keys).toContain('lighting');
    expect(keys).toContain('vents');
    expect(keys).toContain('waterTank');
    expect(keys).toContain('environmentTargets');
    expect(keys).toContain('deviceStatus');
    expect(keys).toContain('alerts');
    expect(keys).toContain('activeDecision');
    expect(keys).toContain('schedule');
    expect(keys).toContain('controlLog');

    // Exactly ONE arrow per section header, and no second toggle control.
    const sectionOf = (key: string) =>
      container.querySelector(`[data-section="${key}"]`) as HTMLElement;
    const arrow = sectionOf('irrigation').querySelector('[data-state]') as HTMLElement;
    expect(arrow).toBeTruthy();
    expect(arrow.querySelectorAll('svg')).toHaveLength(1);
    expect(sectionOf('irrigation').querySelectorAll('[data-state]')).toHaveLength(1);

    // The two global controls are present, separate from the section arrows.
    expect(buttonByLabel('توسيع كل الأقسام')).toBeTruthy();
    expect(buttonByLabel('طي كل الأقسام')).toBeTruthy();
  });

  it('«توسيع الكل» يوسّع كل الأقسام ويجعل كل سهم لأعلى', async () => {
    mount();
    await settle();

    await click(buttonByLabel('طي كل الأقسام'));
    await click(buttonByLabel('توسيع كل الأقسام'));

    const state = headers();
    expect(state.length).toBeGreaterThanOrEqual(13);
    for (const header of state) {
      expect(header.expanded, `section ${header.key} should be expanded`).toBe('true');
    }
    const arrows = container.querySelectorAll('[data-section] > button [data-state="expanded"] svg');
    expect(arrows.length).toBeGreaterThanOrEqual(13);
    for (const node of Array.from(arrows)) {
      expect(node.getAttribute('data-expanded')).toBe('true');
      expect(node.getAttribute('class')).toContain('rotate-180');
    }
  });

  it('«طي الكل» يطي كل الأقسام ويجعل كل سهم لأسفل', async () => {
    mount();
    await settle();

    await click(buttonByLabel('طي كل الأقسام'));

    for (const header of headers()) {
      expect(header.expanded, `section ${header.key} should be collapsed`).toBe('false');
    }
    const collapsed = container.querySelectorAll('[data-section] > button [data-state="collapsed"] svg');
    expect(collapsed.length).toBeGreaterThanOrEqual(13);
    for (const node of Array.from(collapsed)) {
      expect(node.getAttribute('data-expanded')).toBe('false');
      expect(node.getAttribute('class')).toContain('rotate-0');
    }
  });

  it('النقر على رأس قسم واحد يبدّل هذا القسم فقط ويحافظ على الحالات المختلطة', async () => {
    mount();
    await settle();

    // Every section starts expanded except the decision explainer.
    expect(headerFor('activeDecision').getAttribute('aria-expanded')).toBe('false');

    await click(headerFor('irrigation'));
    await click(headerFor('ventilation'));

    expect(headerFor('irrigation').getAttribute('aria-expanded')).toBe('false');
    expect(headerFor('ventilation').getAttribute('aria-expanded')).toBe('false');
    // Untouched sections keep their own state — no forced uniformity.
    expect(headerFor('quickControl').getAttribute('aria-expanded')).toBe('true');
    expect(headerFor('temperature').getAttribute('aria-expanded')).toBe('true');
    expect(headerFor('deviceStatus').getAttribute('aria-expanded')).toBe('true');
    expect(headerFor('activeDecision').getAttribute('aria-expanded')).toBe('false');

    // Toggling back only affects that one section again.
    await click(headerFor('irrigation'));
    expect(headerFor('irrigation').getAttribute('aria-expanded')).toBe('true');
    expect(headerFor('ventilation').getAttribute('aria-expanded')).toBe('false');

    // The global "توسيع الكل" flattens a mixed state…
    await click(buttonByLabel('توسيع كل الأقسام'));
    expect(new Set(headers().map((h) => h.expanded))).toEqual(new Set(['true']));

    // …and "طي الكل" flattens the other way.
    await click(buttonByLabel('طي كل الأقسام'));
    expect(new Set(headers().map((h) => h.expanded))).toEqual(new Set(['false']));
  });

  it('الطي لا يعيد ضبط أجهزة التحكم ولا يعيد إنشاء حالتها', async () => {
    mount();
    await settle();

    // The pump is ON and the valve/fan keep their values.
    const pumpCard = container.querySelector('[data-section="irrigation"]') as HTMLElement;
    expect(pumpCard.innerHTML).toContain('المضخة تعمل');
    expect(pumpCard.innerHTML).toContain('52%'); // استخدم القيمة الحالية

    const pumpButtonBefore = Array.from(pumpCard.querySelectorAll('button')).find((b) =>
      (b.textContent ?? '').includes('تشغيل المضخة'),
    ) as HTMLButtonElement;
    expect(pumpButtonBefore.getAttribute('aria-pressed')).toBe('true');

    // Collapse it, then expand it again.
    await click(headerFor('irrigation'));
    expect(headerFor('irrigation').getAttribute('aria-expanded')).toBe('false');

    const collapsedCard = container.querySelector('[data-section="irrigation"]') as HTMLElement;
    // The SAME DOM (same button node) survives: nothing was unmounted/reset.
    const pumpButtonAfter = Array.from(collapsedCard.querySelectorAll('button')).find((b) =>
      (b.textContent ?? '').includes('تشغيل المضخة'),
    ) as HTMLButtonElement;
    expect(pumpButtonAfter).toBe(pumpButtonBefore);
    expect(pumpButtonAfter.getAttribute('aria-pressed')).toBe('true');
    expect(collapsedCard.querySelector('[aria-hidden="true"]')).toBeTruthy();

    await click(headerFor('irrigation'));
    const expandedCard = container.querySelector('[data-section="irrigation"]') as HTMLElement;
    const pumpButtonFinal = Array.from(expandedCard.querySelectorAll('button')).find((b) =>
      (b.textContent ?? '').includes('تشغيل المضخة'),
    ) as HTMLButtonElement;
    expect(pumpButtonFinal).toBe(pumpButtonBefore);
    expect(pumpButtonFinal.getAttribute('aria-pressed')).toBe('true');
    expect(expandedCard.innerHTML).toContain('المضخة تعمل');
  });

  it('القيم الحيّة (الحساسات والخزان) تبقى متصلة واللوحة مغلقة بالكامل', async () => {
    mount();
    await settle();

    // Tank is at 78% while expanded.
    expect((container.querySelector('[data-section="waterTank"]') as HTMLElement).innerHTML).toContain('78%');

    await click(buttonByLabel('طي كل الأقسام'));

    // The simulation keeps producing readings and the backend's fresh snapshot
    // is written to the SAME query entry, exactly as the live poll does.
    current = snapshot(31);
    client.setQueryData(['control-status', plant.id], current);
    await settle();

    await click(buttonByLabel('توسيع كل الأقسام'));

    const tank = container.querySelector('[data-section="waterTank"]') as HTMLElement;
    expect(tank.innerHTML).toContain('78%');

    // The live sensor value is the NEW one, not a frozen snapshot of the old UI.
    const temperatureCard = container.querySelector('[data-section="temperature"]') as HTMLElement;
    expect(temperatureCard.innerHTML).toContain('31');
  });

  it('سجل التحكم يبقى متصلاً بالحدث الحقي بعد الطي والتوسيع', async () => {
    mount();
    await settle();

    const log = () => (container.querySelector('[data-section="controlLog"]') as HTMLElement).innerHTML;
    expect(log()).toContain('سجل التحكم');
    expect(log()).toContain('11:00');

    await click(buttonByLabel('طي كل الأقسام'));
    expect(headerFor('controlLog').getAttribute('aria-expanded')).toBe('false');
    // Collapsing only hides it; the history itself is still rendered.
    expect(log()).toContain('11:00');

    await click(buttonByLabel('توسيع كل الأقسام'));
    expect(headerFor('controlLog').getAttribute('aria-expanded')).toBe('true');
    expect(log()).toContain('11:00');
  });

  it('كل رأس قسم عنصر تفاعلي حقي مع aria-expanded و aria-controls', async () => {
    mount();
    await settle();

    for (const header of headers()) {
      const controls = header.el.getAttribute('aria-controls') as string;
      expect(header.el.tagName).toBe('BUTTON');
      expect(['true', 'false']).toContain(header.expanded);
      // aria-controls points at the real body element of that section.
      expect(container.querySelector(`#${controls}`)).toBeTruthy();
      // …and the body mirrors the header state.
      expect(container.querySelector(`#${controls}`)?.getAttribute('aria-hidden')).toBe(
        header.expanded === 'true' ? 'false' : 'true',
      );
    }
  });
});
