import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import ControlCenter from './ControlCenter';
import { ControlLogCard } from './Panels';
import type { ControlActuator, ControlSnapshot } from '../../lib/control';

// ---------------------------------------------------------------------------
// Fixtures: shaped exactly like GET /api/v1/control/status/{plant_id}
// ---------------------------------------------------------------------------

/** One actuator row as `build_snapshot()` produces it. */
function actuator(overrides: Partial<ControlActuator> & { key: string }): ControlActuator {
  return {
    label: overrides.key,
    icon: '🔧',
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

/** A supported, wired simulated output of the software bench. */
const simPump = actuator({
  key: 'pump',
  label: 'مضخة الري',
  icon: '💧',
  on: false,
  state_label: 'متوقف',
});
const simFan = actuator({
  key: 'fan',
  label: 'المروحة',
  icon: '🌬️',
  unit: '%',
  variable: true,
  on: true,
  value: 60,
  state_label: 'تعمل — 60%',
});
const simVent = actuator({
  key: 'vent',
  label: 'فتحات الصوبة',
  icon: '🪟',
  unit: '%',
  variable: true,
  on: true,
  value: 35,
  state_label: 'مفتوحة — 35%',
});
const simLight = actuator({
  key: 'grow_light',
  label: 'إضاءة النمو',
  icon: '☀️',
  unit: '%',
  variable: true,
  on: false,
  value: null,
  state_label: 'متوقفة',
});
const tankRow = actuator({
  key: 'tank',
  label: 'خزان المياه',
  icon: '🚰',
  unit: '%',
  supported: false,
  online: false,
  simulated: false,
  hardware_dependent: true,
  capability_status: 'missing',
  capability_status_label: 'يتطلب تركيب الحساس',
  support_reason: 'لا يوجد حساس مستوى مياه — أدخل المستوى يدوياً لتفعيل حماية المضخة.',
  on: false,
  value: null,
  state_label: 'غير معروف',
});

const targets: ControlSnapshot['targets'] = {
  temperature: { min: 18, max: 29, ideal: 24, label: 'درجة الحرارة', unit: '°C', text: '18.0°C — 29.0°C' },
  humidity: { min: 55, max: 80, ideal: 65, label: 'رطوبة الهواء', unit: '%', text: '55% — 80%' },
  soil_moisture: { min: 50, max: 80, ideal: 65, label: 'رطوبة التربة', unit: '%', text: '50% — 80%' },
  light: { min: 900, max: 1200, ideal: 1050, label: 'شدة الإضاءة', unit: 'لوكس', text: '900 — 1,200 لوكس' },
};

function system(
  key: string,
  label: string,
  icon: string,
  actuators: ControlActuator[],
  current: { label: string; value: number | null; unit: string; text: string },
  targetKey: keyof ControlSnapshot['targets'],
  reason: string,
): ControlSnapshot['systems'][number] {
  return {
    key,
    label,
    icon,
    description: `${label} — يقرر RAYY الإجراء المناسب.`,
    active: true,
    status: 'ok',
    status_label: 'ضمن النطاق',
    severity: 'ok',
    reason,
    detail: '',
    action: 'hold',
    action_label: 'لا تغيير',
    value: null,
    current,
    target: targets[targetKey],
    actuators,
    capability: { supported: true, reason: '' },
    controllable: true,
    hardware_dependent: false,
    mode: 'auto',
    mode_label: 'تلقائي',
  };
}

const tomatoSnapshot: ControlSnapshot = {
  plant: { id: 2, nickname: 'مزرعة الطماطم', species: 'Tomato' },
  mode: 'auto',
  mode_label: 'تلقائي',
  modes: [
    { key: 'auto', label: 'تلقائي' },
    { key: 'manual', label: 'يدوي' },
    { key: 'scheduled', label: 'مجدول' },
  ],
  emergency_stop: false,
  emergency_stop_reason: null,
  overall_status: {
    key: 'warning',
    label: 'تحتاج انتباه',
    detail: 'مستوى المياه غير معروف — لا يوجد حساس مستوى مياه.',
  },
  sensors: { available: true, status: 'ok', label: 'متاحة', detail: 'القراءات حديثة.', age_seconds: 3 },
  sensor_details: [
    {
      key: 'temperature',
      label: 'درجة الحرارة',
      unit: '°C',
      value: 25.7,
      text: '25.7 °C',
      supported: true,
      online: true,
      status: 'ok',
      status_label: 'يعمل',
      reason: '',
      hardware_dependent: false,
    },
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
  device_link: {
    device_id: 2,
    device_name: 'RAYY-SIM-TOMATO-001',
    connected: true,
    source: 'simulation',
    last_seen_seconds: 3,
    firmware_version: null,
    capabilities_declared: true,
    capabilities: [],
    sensors: [],
    actuators: [
      {
        key: 'pump',
        kind: 'actuator',
        label: 'مضخة الري',
        supported: true,
        online: true,
        status: 'simulation',
        status_label: 'وحدة تحكم ذكية',
        reason: 'تمثيل رقمي لوحدة تحكم ميدانية.',
        hardware_dependent: false,
        simulated: true,
        variable: false,
      },
    ],
    reported_states: [],
  },
  targets,
  targets_source: 'species',
  systems: [
    system(
      'irrigation',
      'نظام الري',
      '💧',
      [simPump, actuator({ key: 'valve', label: 'صمام الري', icon: '🚰' })],
      { label: 'رطوبة التربة', value: 52, unit: '%', text: '52%' },
      'soil_moisture',
      'رطوبة التربة 52% داخل النطاق المستهدف (50% — 80%) — لا حاجة للري.',
    ),
    system(
      'temperature',
      'التحكم في درجة الحرارة',
      '🌡️',
      [simFan, simVent],
      { label: 'درجة الحرارة', value: 25.7, unit: '°C', text: '25.7°C' },
      'temperature',
      'درجة الحرارة 25.7°C داخل النطاق المستهدف (18.0°C — 29.0°C).',
    ),
    system(
      'ventilation',
      'التهوية',
      '🌬️',
      [simFan, simVent],
      { label: 'رطوبة الهواء', value: 62, unit: '%', text: '62%' },
      'humidity',
      'رطوبة الهواء 62% داخل النطاق المستهدف (55% — 80%).',
    ),
    system(
      'lighting',
      'نظام الإضاءة',
      '☀️',
      [simLight],
      { label: 'شدة الإضاءة', value: 927, unit: 'لوكس', text: '927 لوكس' },
      'light',
      'الإضاءة 927 لوكس داخل النطاق المستهدف (900 — 1,200 لوكس).',
    ),
    system(
      'water_tank',
      'خزان المياه',
      '🚰',
      [tankRow],
      { label: '—', value: null, unit: '', text: 'لا يوجد حساس' },
      'soil_moisture',
      'مستوى المياه غير معروف — لا يوجد حساس مستوى مياه.',
    ),
  ],
  controlled_systems: [
    { key: 'irrigation', label: 'نظام الري', icon: '💧' },
    { key: 'lighting', label: 'نظام الإضاءة', icon: '☀️' },
  ],
  tank: {
    known: false,
    level_pct: null,
    source: 'unknown',
    source_label: 'غير معروف',
    sensor_available: false,
    sensor_reason: 'يتطلب تركيب حساس مستوى المياه على الجهاز — جاهز للتكامل.',
    capacity_l: 20,
    used_today_l: 0,
    used_today_estimated: true,
    used_today_source_label: 'تقديري (لا يوجد حساس تدفق)',
    flow_lpm: null,
    flow_sensor_available: false,
    status: 'unknown',
    status_label: 'المستوى غير معروف',
    warning: 'مستوى المياه غير معروف — يتطلب تركيب حساس مستوى المياه على الجهاز.',
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
    rules: [
      {
        key: 'pump_protection',
        label: 'إيقاف المضخة عند نقص المياه',
        enabled: false,
        hardware_dependent: true,
        detail: 'يتطلب تركيب حساس مستوى المياه أو إدخال المستوى يدوياً.',
      },
      {
        key: 'pump_max_runtime',
        label: 'أقصى زمن تشغيل للمضخة (180 ثانية)',
        enabled: true,
        hardware_dependent: false,
        detail: 'يعمل في محرك التحكم وفي firmware الجهاز.',
      },
    ],
  },
  alerts: [
    {
      kind: 'water_level_unknown',
      severity: 'warning',
      title: 'مستوى المياه غير معروف',
      detail: 'لا يوجد حساس مستوى مياه متصل.',
      action_hint: 'أدخل مستوى الخزان يدوياً أو ركّب حساس المستوى.',
      hardware_dependent: true,
      source: 'tank',
      signature: 'tank|unknown',
    },
  ],
  reading: { ts: 1700000000, temperature: 25.7, humidity: 62, light: 927, soil_moisture: 52, ph: 6.5 },
  decisions: [
    {
      system: 'irrigation',
      system_label: 'نظام الري',
      action: 'hold',
      action_label: 'لا تغيير',
      actuator: null,
      actuator_label: null,
      value: null,
      reason: 'رطوبة التربة 52% داخل النطاق المستهدف (50% — 80%).',
      severity: 'ok',
    },
  ],
  pipeline: ['قراءة الحساسات', 'احتياج النبات', 'شروط السلامة', 'القرار', 'أمر التنفيذ'],
  history: [
    {
      id: 9,
      plant_id: 2,
      system: 'ventilation',
      system_label: 'التهوية',
      actuator: 'fan',
      actuator_label: 'المروحة',
      action: 'on',
      action_label: 'تشغيل',
      value: 70,
      reason: 'درجة الحرارة تجاوزت الحد الأعلى للنبات (29°C).',
      result: 'queued',
      result_label: 'بانتظار الجهاز',
      result_detail: 'تم إرسال الأمر إلى الجهاز (بانتظار التنفيذ).',
      source: 'auto',
      source_label: 'تلقائي',
      severity: 'warning',
      time_label: '11:42',
      created_at: '2026-09-16T08:42:00+00:00',
    },
    {
      id: 8,
      plant_id: 2,
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
  schedules: [
    {
      id: 3,
      plant_id: 2,
      system: 'irrigation',
      system_label: 'نظام الري',
      actuator: 'pump',
      actuator_label: 'مضخة الري',
      action: 'on',
      action_label: 'تشغيل',
      value: 400,
      duration_sec: 300,
      time_of_day: '06:00',
      days: [0, 1, 2, 3, 4, 5, 6],
      enabled: true,
      note: null,
      last_run_at: null,
    },
  ],
  generated_at: '2026-09-16T09:00:00+00:00',
};

/** The same plant with no device at all: every control must be disabled. */
const unwiredSnapshot: ControlSnapshot = {
  ...tomatoSnapshot,
  device_link: {
    device_id: null,
    device_name: '',
    connected: false,
    source: 'none',
    last_seen_seconds: null,
    firmware_version: null,
    capabilities_declared: false,
    capabilities: [],
    sensors: [],
    actuators: [],
    reported_states: [],
  },
  systems: tomatoSnapshot.systems.map((item) => ({
    ...item,
    controllable: false,
    hardware_dependent: true,
    actuators: item.actuators.map((row) => ({
      ...row,
      supported: false,
      online: false,
      simulated: false,
      hardware_dependent: true,
      capability_status: 'no_device',
      capability_status_label: 'غير متصل',
      support_reason: 'لا يوجد جهاز مرتبط بهذه النبتة.',
    })),
  })),
};

function renderWithCache(node: React.ReactElement, snapshot: ControlSnapshot = tomatoSnapshot) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // The shared cache entry IS the data source; useControlSnapshot reads it, and
  // React Query never fetches during renderToString because effects don't run.
  queryClient.setQueryData(['control-status', snapshot.plant.id], snapshot);
  return renderToString(
    <QueryClientProvider client={queryClient}>{node}</QueryClientProvider>,
  );
}

describe('مركز التحكم الذكي — واجهة تشغيل', () => {
  const html = renderWithCache(<ControlCenter plantId={2} />);

  it('يعرض العنوان وحالة النظام وكل أوضاع التشغيل', () => {
    expect(html).toContain('مركز التحكم الذكي');
    expect(html).toContain('حالة النظام');
    expect(html).toContain('وضع التشغيل');
    expect(html).toContain('تلقائي');
    expect(html).toContain('يدوي');
    expect(html).toContain('مجدول');
  });

  it('يعرض أدوات التحكم الفعلية لكل نظام وليس حالة فقط', () => {
    expect(html).toContain('التحكم السريع');
    expect(html).toContain('نظام الري');
    expect(html).toContain('تشغيل المضخة');
    expect(html).toContain('إيقاف المضخة');
    expect(html).toContain('التهوية');
    expect(html).toContain('سرعة المروحة');
    expect(html).toContain('درجة الحرارة');
    expect(html).toContain('تعديل النطاق');
    expect(html).toContain('نظام الإضاءة');
    expect(html).toContain('شدة الإضاءة');
    expect(html).toContain('فتحات التهوية');
    expect(html).toContain('نسبة الفتح');
    expect(html).toContain('فتح بالكامل');
    expect(html).toContain('إغلاق بالكامل');
    expect(html).toContain('خزان المياه');
  });

  it('يعرض كمية المياه ومدة الري والحد الأقصى لمدة التشغيل', () => {
    expect(html).toContain('كمية المياه');
    expect(html).toContain('مدة التشغيل');
    expect(html).toContain('حد أقصى لمدة الري');
    expect(html).toContain('3 دقيقة');
  });

  it('يعرض إعدادات البيئة المستهدفة من احتياج النبات', () => {
    expect(html).toContain('إعدادات البيئة المستهدفة');
    expect(html).toContain('رطوبة التربة');
    expect(html).toContain('50% — 80%');
    expect(html).toContain('رطوبة الهواء');
  });

  it('يعرض حالة الأجهزة والحساسات الفعلية', () => {
    expect(html).toContain('حالة الأجهزة');
    expect(html).toContain('وحدات التنفيذ');
    expect(html).toContain('الحساسات');
    expect(html).toContain('يتطلب تركيب الحساس');
  });

  it('يعرض التنبيهات مع ما يجب فعله', () => {
    expect(html).toContain('التنبيهات');
    expect(html).toContain('مستوى المياه غير معروف');
    expect(html).toContain('أدخل مستوى الخزان يدوياً');
  });

  it('يُظهر اسم الجهاز ونوع المصدر', () => {
    expect(html).toContain('RAYY-SIM-TOMATO-001');
    expect(html).toContain('وحدة تحكم ذكية');
  });

  it('لا يعرض كلمة «محاكاة» في واجهة التشغيل', () => {
    expect(html).not.toContain('محاكاة');
    expect(html).not.toContain('المحاكي');
  });

  it('لا يدّعي وجود حساس مستوى مياه ولا يقيس استهلاك المياه', () => {
    expect(html).toContain('حساس مستوى المياه غير متصل');
    expect(html).toContain('قياس استهلاك المياه يتطلب حساس تدفق');
    expect(html).not.toContain('72%');
  });

  it('يعرض جدول التشغيل والإيقاف الطارئ', () => {
    expect(html).toContain('جدول التشغيل');
    expect(html).toContain('إضافة مهمة');
    expect(html).toContain('تعديل');
    expect(html).toContain('حذف');
    expect(html).toContain('إيقاف طارئ');
  });

  it('يضع شرح القرار في قسم قابل للتوسيع وليس في مساحة التحكم', () => {
    expect(html).toContain('كيف اتخذ RAYY القرار؟');
    // Collapsed by default. The dashboard animates sections open/closed instead
    // of unmounting them (so collapsing can never reset device or sensor state),
    // so the body is present but hidden: aria-expanded="false", aria-hidden and
    // a zero max-height. The section arrow reflects that real state.
    expect(html).toContain('aria-expanded="false" aria-controls="section-body-activeDecision"');
    expect(html).toContain('aria-hidden="true" style="max-height:0"');
    expect(html).toContain('data-state="collapsed"');
    expect(html).toContain('data-expanded="false"');
  });

  it('لا يعرض أي نص واجهة بالإنجليزية', () => {
    for (const forbidden of [
      'Dashboard',
      'Control Center',
      'Pump',
      'Manual',
      'Automatic',
      'Scheduled',
      'Temperature',
      'Fan',
      'Water Tank',
    ]) {
      expect(html).not.toContain(forbidden);
    }
  });
});

describe('مركز التحكم الذكي — عتاد غير موجود', () => {
  const html = renderWithCache(<ControlCenter plantId={2} />, unwiredSnapshot);

  it('يعرض أدوات التحكم معطّلة مع سبب كل واحدة', () => {
    expect(html).toContain('الأجهزة غير متصلة');
    expect(html).toContain('هذه الوظيفة غير مدعومة حالياً');
    expect(html).toContain('لا يوجد جهاز مرتبط بهذه النبتة');
    expect(html).toContain('التحكم في فتحات الصوبة غير متصل');
  });

  it('ينبّه أن المهام المجدولة لن تُنفَّذ على أجهزة', () => {
    expect(html).toContain('بعض المهام لن تُنفَّذ على أجهزة حقيقية');
  });

  it('لا يعرض شريطاً أو زراً يعمل بدون عتاد', () => {
    expect(html).toContain('disabled');
  });
});

describe('سجل التحكم', () => {
  it('يعرض الوقت والنظام والإجراء والسبب والنتيجة', () => {
    const logHtml = renderWithCache(
      <ControlLogCard
        events={tomatoSnapshot.history}
        systemFilter="all"
        onFilterChange={() => undefined}
      />,
    );
    expect(logHtml).toContain('سجل التحكم');
    expect(logHtml).toContain('11:42');
    expect(logHtml).toContain('التهوية');
    expect(logHtml).toContain('تشغيل');
    expect(logHtml).toContain('درجة الحرارة تجاوزت الحد الأعلى');
    expect(logHtml).toContain('بانتظار الجهاز');
    expect(logHtml).toContain('تم التنفيذ');
  });
});
