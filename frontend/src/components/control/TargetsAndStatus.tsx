import { useEffect, useState } from 'react';
import type {
  ControlDeviceLink,
  ControlSensorDetail,
  ControlSnapshot,
} from '../../lib/control';
import { DEVICE_SOURCE_AR } from '../../lib/control';
import type { OperatorActions } from './OperatorCards';
import {
  Button,
  Chip,
  ControlCard,
  KeyValue,
  Notice,
  NumberField,
  ProgressBar,
  StatusPill,
} from './ui';

// ---------------------------------------------------------------------------
// إعدادات البيئة المستهدفة
// ---------------------------------------------------------------------------
const TARGET_ROWS: {
  key: keyof ControlSnapshot['targets'];
  icon: string;
  label: string;
  step: number;
  unit: string;
}[] = [
  { key: 'temperature', icon: '🌡️', label: 'درجة الحرارة', step: 0.5, unit: '°C' },
  { key: 'soil_moisture', icon: '💧', label: 'رطوبة التربة', step: 1, unit: '%' },
  { key: 'humidity', icon: '💨', label: 'رطوبة الهواء', step: 1, unit: '%' },
  { key: 'light', icon: '☀️', label: 'شدة الإضاءة', step: 25, unit: 'لوكس' },
];

export function TargetsCard({
  snapshot,
  actions,
}: {
  snapshot: ControlSnapshot;
  actions: OperatorActions;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [min, setMin] = useState(0);
  const [max, setMax] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const open = (row: (typeof TARGET_ROWS)[number]) => {
    const target = snapshot.targets[row.key];
    setMin(target.min);
    setMax(target.max);
    setEditing(row.key);
    setError(null);
  };

  return (
    <ControlCard
      section="environmentTargets"
      title="إعدادات البيئة المستهدفة"
      icon="🎯"
      subtitle="النطاقات التي يبني عليها RAYY قراراته لهذه النبتة تحديداً"
      badge={
        <StatusPill
          label={snapshot.targets_source === 'species' ? 'احتياج النبات' : 'نطاق مخصص'}
          severity="info"
          dot={false}
        />
      }
    >
      <div className="space-y-2">
        {TARGET_ROWS.map((row) => {
          const target = snapshot.targets[row.key];
          const isEditing = editing === row.key;
          return (
            <div key={row.key} className="rounded-xl border border-gray-100 p-3.5">
              <div className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-2 text-xs font-bold text-gray-700">
                  <span>{row.icon}</span>
                  {row.label}
                </span>
                <span className="flex items-center gap-2">
                  <span dir="ltr" className="text-xs font-semibold text-gray-800 tabular-nums">
                    {target.text}
                  </span>
                  <Button
                    size="sm"
                    variant={isEditing ? 'ghost' : 'outline'}
                    disabled={actions.busy}
                    onClick={() => (isEditing ? setEditing(null) : open(row))}
                  >
                    {isEditing ? 'إغلاق' : 'تعديل'}
                  </Button>
                </span>
              </div>

              {isEditing && (
                <div className="space-y-3 mt-3">
                  <div className="grid grid-cols-2 gap-3">
                    <NumberField
                      label="الحد الأدنى"
                      value={min}
                      step={row.step}
                      unit={row.unit}
                      disabled={actions.busy}
                      onChange={setMin}
                    />
                    <NumberField
                      label="الحد الأعلى"
                      value={max}
                      step={row.step}
                      unit={row.unit}
                      disabled={actions.busy}
                      onChange={setMax}
                    />
                  </div>
                  {error && <Notice tone="critical">{error}</Notice>}
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      size="sm"
                      disabled={actions.busy}
                      onClick={() => {
                        if (min >= max) {
                          setError('الحد الأدنى يجب أن يكون أصغر من الحد الأعلى.');
                          return;
                        }
                        actions.saveSettings({ targets: { [row.key]: { min, max } } });
                        setEditing(null);
                      }}
                    >
                      حفظ
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={actions.busy}
                      onClick={() => {
                        actions.saveSettings({ targets: { [row.key]: null } });
                        setEditing(null);
                      }}
                    >
                      احتياج النبات الأصلي
                    </Button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </ControlCard>
  );
}

// ---------------------------------------------------------------------------
// حالة الأجهزة والحساسات (من تقرير القدرات الفعلي)
// ---------------------------------------------------------------------------
function linkSeverity(link: ControlDeviceLink): 'ok' | 'warning' | 'info' {
  if (link.source === 'none') return 'warning';
  if (!link.connected) return 'warning';
  if (link.source === 'simulation') return 'info';
  return 'ok';
}

export function DeviceStatusCard({
  link,
  sensorDetails,
}: {
  link: ControlDeviceLink;
  sensorDetails: ControlSensorDetail[];
}) {
  const severity = linkSeverity(link);
  const sourceLabel = DEVICE_SOURCE_AR[link.source] ?? link.source;

  const dot = (state: 'on' | 'off') =>
    state === 'on' ? 'bg-green-500' : 'bg-gray-300';

  return (
    <ControlCard
      section="deviceStatus"
      title="حالة الأجهزة"
      icon="🔌"
      subtitle="ما هو متصل فعلياً: القدرات تُقرأ من تقرير الجهاز نفسه"
      badge={
        <StatusPill
          label={link.device_id === null ? 'الأجهزة غير متصلة' : sourceLabel}
          severity={severity}
          pulse={link.connected}
        />
      }
    >
      <div className="space-y-4">
        {link.device_id === null ? (
          <Notice tone="warning" icon="🔌">
            الأجهزة غير متصلة — لا يوجد جهاز مرتبط بهذه النبتة. المراقبة والقرارات تعمل، لكن لا توجد
            وحدة تنفيذ لاستقبال الأوامر.
          </Notice>
        ) : link.source === 'simulation' ? (
          <Notice tone="info" icon="🎛️">
            وحدة التحكم «{link.device_name}» متصلة — تُرسل الأوامر إليها وتُقرأ الحساسات منها عبر نفس مسار التحكم الميداني.
          </Notice>
        ) : link.connected ? (
          <Notice tone="ok" icon="✅">
            الجهاز «{link.device_name}» متصل
            {link.last_seen_seconds !== null
              ? ` — آخر إشارة منذ ${link.last_seen_seconds} ثانية`
              : ''}
            . الأوامر تُرسل إلى قائمة أوامر الجهاز وينفّذها الـfirmware عند الاستعلام التالي.
          </Notice>
        ) : (
          <Notice tone="warning" icon="📡">
            الجهاز «{link.device_name}» غير متصل حالياً — لن تُنفَّذ الأوامر حتى يعود للاتصال.
          </Notice>
        )}

        <div>
          <p className="text-xs font-bold text-gray-700 mb-2">وحدات التنفيذ</p>
          <div className="rounded-xl border border-gray-100 divide-y divide-gray-50">
            {link.actuators.length === 0 && (
              <p className="px-3.5 py-3 text-xs text-gray-500">لا توجد وحدات تنفيذ مُعلنة.</p>
            )}
            {link.actuators.map((row) => (
              <div key={row.key} className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                <span className="flex items-center gap-2 text-xs text-gray-700">
                  <span className={`w-2 h-2 rounded-full ${dot(row.supported && row.online ? 'on' : 'off')}`} />
                  {row.label}
                </span>
                <span className="flex items-center gap-2">
                  {row.simulated && <Chip tone="sim">وحدة تحكم ذكية</Chip>}
                  <span
                    className={`text-[11px] font-semibold ${
                      row.supported && row.online ? 'text-gray-700' : 'text-gray-400'
                    }`}
                    title={row.reason}
                  >
                    {row.status_label}
                  </span>
                </span>
              </div>
            ))}
          </div>
        </div>

        <div>
          <p className="text-xs font-bold text-gray-700 mb-2">الحساسات</p>
          <div className="rounded-xl border border-gray-100 divide-y divide-gray-50">
            {sensorDetails.map((sensor) => (
              <div key={sensor.key} className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                <span className="flex items-center gap-2 text-xs text-gray-700">
                  <span className={`w-2 h-2 rounded-full ${dot(sensor.online ? 'on' : 'off')}`} />
                  {sensor.label}
                </span>
                <span className="flex items-center gap-2">
                  <span
                    dir="ltr"
                    className={`text-[11px] tabular-nums ${
                      sensor.online ? 'text-gray-700 font-semibold' : 'text-gray-400'
                    }`}
                  >
                    {sensor.online ? sensor.text : '—'}
                  </span>
                  <span
                    className={`text-[11px] font-semibold ${
                      sensor.online ? 'text-gray-500' : 'text-amber-700'
                    }`}
                    title={sensor.reason}
                  >
                    {sensor.status_label}
                  </span>
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-gray-100 divide-y divide-gray-50">
          <div className="px-3.5 py-2.5">
            <KeyValue label="اسم الجهاز" value={link.device_name || 'لا يوجد جهاز مرتبط'} dir="ltr" />
          </div>
          <div className="px-3.5 py-2.5">
            <KeyValue label="نوع المصدر" value={sourceLabel} />
          </div>
          <div className="px-3.5 py-2.5">
            <KeyValue
              label="إصدار الـfirmware"
              value={link.firmware_version ?? 'لم يُبلَّغ عنه'}
              dir="ltr"
            />
          </div>
          <div className="px-3.5 py-2.5">
            <KeyValue
              label="تقرير القدرات"
              value={link.capabilities_declared ? 'مُستلَم من الجهاز' : 'لم يُستلَم بعد'}
            />
          </div>
        </div>
      </div>
    </ControlCard>
  );
}

// ---------------------------------------------------------------------------
// التنبيهات
// ---------------------------------------------------------------------------
export function AlertsCard({ snapshot }: { snapshot: ControlSnapshot }) {
  const alerts = snapshot.alerts ?? [];
  return (
    <ControlCard
      section="alerts"
      title="التنبيهات"
      icon="🔔"
      subtitle="تنبيهات النظام الحالية لهذه النبتة"
      badge={
        <StatusPill
          label={alerts.length === 0 ? 'لا توجد تنبيهات' : `${alerts.length} تنبيه`}
          severity={alerts.some((alert) => alert.severity === 'critical') ? 'critical' : alerts.length ? 'warning' : 'ok'}
          dot={false}
        />
      }
    >
      {alerts.length === 0 ? (
        <p className="text-xs text-gray-500 text-center py-4">
          لا توجد تنبيهات — كل القيم داخل النطاقات المستهدفة.
        </p>
      ) : (
        <div className="space-y-2">
          {alerts.map((alert) => (
            <div
              key={alert.kind}
              className={`rounded-xl px-3.5 py-2.5 border ${
                alert.severity === 'critical'
                  ? 'border-red-100 bg-red-50'
                  : alert.severity === 'warning'
                    ? 'border-amber-100 bg-amber-50'
                    : 'border-sky-100 bg-sky-50'
              }`}
            >
              <p className="flex items-center gap-2 text-xs font-bold text-gray-800">
                {alert.title}
                {alert.hardware_dependent && <Chip tone="muted">يتطلب عتاداً</Chip>}
              </p>
              <p className="text-[11px] text-gray-600 leading-5 mt-1">{alert.detail}</p>
              {alert.action_hint && (
                <p className="text-[11px] text-gray-500 leading-5 mt-1">
                  <span className="font-bold">ما يجب فعله: </span>
                  {alert.action_hint}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </ControlCard>
  );
}

// ---------------------------------------------------------------------------
// شريط حالة الحساسات الحية (يُستخدم أعلى المركز)
// ---------------------------------------------------------------------------
export function SensorStrip({ snapshot }: { snapshot: ControlSnapshot }) {
  const reading = snapshot.reading;
  const items = [
    { label: 'الحرارة', value: reading ? `${reading.temperature.toFixed(1)}°C` : '—' },
    { label: 'رطوبة الهواء', value: reading ? `${reading.humidity.toFixed(0)}%` : '—' },
    { label: 'رطوبة التربة', value: reading ? `${reading.soil_moisture.toFixed(0)}%` : '—' },
    { label: 'الإضاءة', value: reading ? `${reading.light.toFixed(0)} لوكس` : '—' },
  ];
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
      {items.map((item) => (
        <div key={item.label} className="rounded-xl bg-gray-50 px-3 py-2">
          <p className="text-[10px] text-gray-500">{item.label}</p>
          <p dir="ltr" className="text-sm font-bold text-gray-900 tabular-nums text-right">
            {item.value}
          </p>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// القرار المتخذ الآن لكل نظام (سطر مختصر تحت كل بطاقة)
// ---------------------------------------------------------------------------
export function DecisionLine({ snapshot }: { snapshot: ControlSnapshot }) {
  const [selected, setSelected] = useState(snapshot.systems[0]?.key ?? 'irrigation');
  const system = snapshot.systems.find((item) => item.key === selected) ?? snapshot.systems[0];
  if (!system) return null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {snapshot.systems.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setSelected(item.key)}
            className={`px-3 py-1.5 rounded-lg text-[11px] font-bold transition-all ${
              item.key === selected
                ? 'bg-leaf-700 text-white'
                : 'bg-gray-50 text-gray-600 hover:bg-gray-100'
            }`}
          >
            {item.icon} {item.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
        <div className="rounded-xl bg-gray-50 px-3.5 py-3">
          <p className="text-[10px] text-gray-500 mb-1">القيمة الحالية</p>
          <p dir="ltr" className="font-bold text-gray-900 tabular-nums text-right">
            {system.current.text}
          </p>
        </div>
        <div className="rounded-xl bg-gray-50 px-3.5 py-3">
          <p className="text-[10px] text-gray-500 mb-1">النطاق المستهدف</p>
          <p dir="ltr" className="font-bold text-gray-900 tabular-nums text-right">
            {system.target.text}
          </p>
        </div>
        <div className="rounded-xl bg-gray-50 px-3.5 py-3">
          <p className="text-[10px] text-gray-500 mb-1">قرار RAYY</p>
          <p className="font-bold text-gray-900">{system.action_label}</p>
        </div>
      </div>

      <div className="rounded-xl bg-leaf-50 px-3.5 py-3">
        <p className="text-[11px] text-leaf-900 leading-5">
          <span className="font-bold">السبب: </span>
          {system.reason || 'لا يوجد قرار نشط لهذا النظام.'}
        </p>
        {system.detail && (
          <p className="text-[11px] text-leaf-800/80 leading-5 mt-1">{system.detail}</p>
        )}
      </div>

      {system.current.value !== null && system.current.value !== undefined && (
        <ProgressBar value={system.current.value} min={0} max={100} severity={system.severity} />
      )}
    </div>
  );
}
