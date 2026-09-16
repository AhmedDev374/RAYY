import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import DashboardPage from './DashboardPage';
import type { ControlSnapshot } from '../lib/control';

// Renders the whole dashboard for a simulated plant from cache (no network:
// React Query does not fetch during renderToString because effects never run)
// and checks the requested section order:
//   الحالة العامة -> المراقبة -> مركز التحكم الذكي -> الأجهزة -> الرسوم
//   -> التوصيات -> سجل التحكم -> إحصائيات الذكاء الاصطناعي -> إجراءات سريعة
const plant = { id: 7, species: 'Tomato', nickname: 'مزرعة الطماطم' };

const reading = {
  id: 1,
  ts: 1700000000,
  temperature: 25.7,
  humidity: 62,
  light: 927,
  soil_moisture: 44,
  ph: 6.5,
};

const snapshot = {
  plant,
  mode: 'auto',
  mode_label: 'تلقائي',
  modes: [
    { key: 'auto', label: 'تلقائي' },
    { key: 'manual', label: 'يدوي' },
    { key: 'scheduled', label: 'مجدول' },
  ],
  emergency_stop: false,
  emergency_stop_reason: null,
  overall_status: { key: 'ok', label: 'يعمل بشكل طبيعي', detail: 'جميع الأنظمة داخل النطاقات المستهدفة.' },
  sensors: { available: true, status: 'ok', label: 'متاحة', detail: 'القراءات حديثة.', age_seconds: 3 },
  device_link: {
    device_id: 4,
    device_name: 'RAYY-SIM-TOMATO-001',
    connected: true,
    source: 'simulation',
    last_seen_seconds: 3,
    firmware_version: null,
    actuators: [],
  },
  targets: {
    temperature: { min: 18, max: 29, ideal: 24, label: 'درجة الحرارة', unit: '°C', text: '18.0°C — 29.0°C' },
    humidity: { min: 55, max: 80, ideal: 65, label: 'رطوبة الهواء', unit: '%', text: '55% — 80%' },
    soil_moisture: { min: 50, max: 80, ideal: 65, label: 'رطوبة التربة', unit: '%', text: '50% — 80%' },
    light: { min: 900, max: 1200, ideal: 1050, label: 'شدة الإضاءة', unit: 'لوكس', text: '900 — 1,200 لوكس' },
  },
  targets_source: 'species',
  systems: [],
  controlled_systems: [{ key: 'irrigation', label: 'نظام الري', icon: '💧' }],
  sensor_details: [
    {
      key: 'water_level',
      label: 'مستوى المياه',
      unit: '%',
      value: null,
      text: '—',
      supported: false,
      online: false,
      status: 'missing',
      status_label: 'يتطلب تركيب الحساس',
      reason: 'يتطلب تركيب حساس مستوى المياه على الجهاز — جاهز للتكامل.',
      hardware_dependent: true,
    },
  ],
  safety: {
    pump_max_runtime_seconds: 180,
    pump_max_runtime_default_seconds: 180,
    pump_max_runtime_is_default: true,
    pump_max_runtime_bounds: [30, 3600] as [number, number],
    pump_min_interval_seconds: 60,
    actuator_min_switch_seconds: 30,
    sensor_stale_seconds: 900,
    flow_min_lpm: 0.05,
    tank_critical_pct: 15,
    tank_low_pct: 30,
    rules: [],
  },
  alerts: [],
  tank: {
    known: false,
    level_pct: null,
    source: 'unknown',
    source_label: 'غير معروف',
    sensor_available: false,
    sensor_reason: 'لا يوجد حساس مستوى مياه متصل.',
    capacity_l: 20,
    used_today_l: 0,
    used_today_estimated: true,
    used_today_source_label: 'تقديري (لا يوجد حساس تدفق)',
    flow_lpm: null,
    flow_sensor_available: false,
    status: 'unknown',
    status_label: 'المستوى غير معروف',
    warning: 'لا يوجد حساس مستوى مياه متصل.',
    critical_pct: 15,
    low_pct: 30,
  },
  reading,
  decisions: [],
  pipeline: ['قراءة الحساسات', 'القرار', 'أمر التنفيذ'],
  history: [
    {
      id: 1,
      plant_id: 7,
      system: 'irrigation',
      system_label: 'نظام الري',
      actuator: 'pump',
      actuator_label: 'مضخة الري',
      action: 'off',
      action_label: 'إيقاف',
      value: null,
      reason: 'رطوبة التربة وصلت إلى النطاق المستهدف — تم إيقاف المضخة.',
      result: 'executed',
      result_label: 'تم التنفيذ',
      result_detail: null,
      source: 'auto',
      source_label: 'تلقائي',
      severity: 'ok',
      time_label: '11:35',
      created_at: '2026-09-16T08:35:00+00:00',
    },
  ],
  schedules: [],
  generated_at: '2026-09-16T09:00:00+00:00',
} as unknown as ControlSnapshot;

function render() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(['plants'], [plant]);
  // Arabic plant names come from the encyclopedia catalog, so the selector can
  // render "مزرعة الطماطم (الطماطم)" instead of the raw species key.
  queryClient.setQueryData(['encyclopedia'], [{ species: 'Tomato', name_ar: 'الطماطم' }]);
  queryClient.setQueryData(['readings', plant.id], [reading]);
  queryClient.setQueryData(['control-status', plant.id], snapshot);
  queryClient.setQueryData(['simulation-status'], {
    running: true,
    plant_id: plant.id,
    device_id: 4,
    nickname: 'مزرعة الطماطم',
    species: 'Tomato',
    source: 'simulation',
    interval_seconds: 3,
    started_at: 1700000000,
    reading_count: 10,
    last_values: null,
    device_name: 'RAYY-SIM-TOMATO-001',
  });
  return renderToString(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/dashboard']}>
        <DashboardPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('لوحة تحكم الصوبة الذكية', () => {
  const html = render();

  it('تعرض العنوان الجديد والوصف', () => {
    expect(html).toContain('لوحة تحكم الصوبة الذكية');
    expect(html).toContain('مراقبة وتحكم ذكي في بيئة النبات');
    expect(html).not.toContain('لوحة تحكم الري الذكي');
  });

  it('تعرض حالة النظام العامة واختيار النبات', () => {
    expect(html).toContain('وضع التشغيل');
    expect(html).toContain('مصدر البيانات');
    expect(html).toContain('مزرعة الطماطم');
    expect(html).toContain('الطماطم');
  });

  it('تُبقي نظام المراقبة الحالي كما هو', () => {
    expect(html).toContain('درجة الحرارة');
    expect(html).toContain('رطوبة التربة');
    expect(html).toContain('صحة النبتة');
    expect(html).toContain('توصيات العناية');
    expect(html).toContain('إحصائيات نموذج الذكاء الاصطناعي');
    expect(html).toContain('إجراءات سريعة');
    expect(html).toContain('درجة الحرارة والرطوبة');
  });

  it('تعرض مركز التحكم الذكي وسجل التحكم داخل نفس الصفحة', () => {
    expect(html).toContain('مركز التحكم الذكي');
    expect(html).toContain('حالة الأجهزة');
    expect(html).toContain('سجل التحكم');
    expect(html).toContain('جدول التشغيل');
    // The operator controls must be reachable from the dashboard itself.
    expect(html).toContain('التحكم السريع');
    expect(html).toContain('تشغيل المضخة');
  });

  it('لا تعرض بطاقة سجل التحكم أكثر من مرة في الصفحة', () => {
    // The card is identified by its own subtitle, which appears nowhere else.
    const occurrences = html.split('كل قرار وكل أمر').length - 1;
    expect(occurrences).toBe(1);
  });

  it('ترتب الأقسام بالترتيب المطلوب', () => {
    const order = [
      'لوحة تحكم الصوبة الذكية', // 1. Header
      'وضع التشغيل', // 2. اختيار النبات + الحالة العامة
      'صحة النبتة', // 3. نظرة عامة على الحساسات
      'مركز التحكم الذكي', // 4. مركز التحكم الذكي
      'حالة الأجهزة', // 5. حالة الأجهزة
      'درجة الحرارة والرطوبة', // 6. الرسوم البيانية
      'توصيات العناية', // 7. توصيات RAYY
      'سجل التحكم', // 8. سجل التحكم
      'إحصائيات نموذج الذكاء الاصطناعي', // 9. إحصائيات الذكاء الاصطناعي
      'إجراءات سريعة', // 10. إجراءات سريعة
    ];
    let cursor = -1;
    for (const section of order) {
      const index = html.indexOf(section, cursor + 1);
      expect(index, `section out of order: ${section}`).toBeGreaterThan(cursor);
      cursor = index;
    }
  });
});
