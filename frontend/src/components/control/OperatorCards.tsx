import { useEffect, useState } from 'react';
import type {
  ControlActuator,
  ControlMode,
  ControlSettingsUpdate,
  ControlSnapshot,
  ControlSystem,
} from '../../lib/control';
import { mlToDurationSec, describeDuration, WATER_PRESETS_ML } from '../../lib/control';
import {
  ActionButton,
  Button,
  Chip,
  ConfirmDialog,
  ControlCard,
  KeyValue,
  Notice,
  NumberField,
  PresetRow,
  ProgressBar,
  Reading,
  Slider,
  StatusPill,
  Toggle,
} from './ui';

// ---------------------------------------------------------------------------
// Shared operator contract
// ---------------------------------------------------------------------------
export interface OperatorActions {
  mode: ControlMode;
  emergencyStop: boolean;
  busy: boolean;
  /** Actuator whose command is in flight, for a per-device loading state. */
  pendingActuator?: string | null;
  sendCommand: (
    actuator: string,
    action: 'on' | 'off' | 'set',
    value?: number | null,
    durationSec?: number | null,
  ) => void;
  saveSettings: (payload: ControlSettingsUpdate) => void;
}

export function findActuator(
  system: ControlSystem | undefined,
  key: string,
): ControlActuator | undefined {
  return system?.actuators?.find((actuator) => actuator.key === key);
}

/**
 * Why a control cannot be used, in the backend's own words.
 * `undefined` means the output is usable.
 */
function blockedReason(actuator: ControlActuator | undefined): string | undefined {
  if (!actuator) return 'هذه الوظيفة غير مدعومة حالياً — لا توجد وحدة تنفيذ لهذا النظام.';
  if (!actuator.supported) return actuator.support_reason || 'هذه الوظيفة غير مدعومة حالياً.';
  if (!actuator.online) return actuator.support_reason || 'وحدة التنفيذ غير متصلة حالياً.';
  return undefined;
}

/**
 * Provenance label: simulated outputs are never shown as hardware.
 * `undefined` means the system exposes no such actuator at all.
 */
function ActuatorChips({ actuator }: { actuator: ControlActuator | undefined }) {
  if (!actuator) return <Chip tone="muted">هذه الوظيفة غير مدعومة حالياً</Chip>;
  return (
    <span className="inline-flex items-center gap-1.5 flex-wrap">
      {actuator.simulated && (
        <Chip tone="sim" title={actuator.support_reason}>
          وحدة تحكم ذكية
        </Chip>
      )}
      {!actuator.supported && <Chip tone="muted">يتطلب تركيب وحدة التنفيذ</Chip>}
      {actuator.supported && !actuator.online && <Chip tone="muted">غير متصل</Chip>}
    </span>
  );
}

/** Honest message shown instead of a control that the hardware lacks. */
function UnsupportedNotice({ actuator }: { actuator: ControlActuator | undefined }) {
  if (actuator && actuator.supported && actuator.online) return null;
  return (
    <Notice tone="warning" icon="🔌">
      هذه الوظيفة غير مدعومة حالياً — {blockedReason(actuator)}
    </Notice>
  );
}

// ---------------------------------------------------------------------------
// Target range editor
// ---------------------------------------------------------------------------
export function RangeEditor({
  target,
  unit,
  step,
  busy,
  disabled = false,
  onSave,
  onReset,
}: {
  target: { min: number; max: number; text: string; label: string };
  unit: string;
  step: number;
  busy: boolean;
  disabled?: boolean;
  onSave: (min: number, max: number) => void;
  onReset: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [min, setMin] = useState(target.min);
  const [max, setMax] = useState(target.max);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setMin(target.min);
    setMax(target.max);
    setEditing(false);
    setError(null);
  }, [target.min, target.max]);

  if (!editing) {
    return (
      <div className="flex items-center justify-between gap-3 pt-1">
        <Button size="sm" variant="outline" disabled={disabled} onClick={() => setEditing(true)}>
          تعديل النطاق
        </Button>
        <span dir="ltr" className="text-[11px] text-gray-400 tabular-nums">
          {target.text}
        </span>
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-xl border border-gray-100 p-3">
      <div className="grid grid-cols-2 gap-3">
        <NumberField
          label="الحد الأدنى"
          value={min}
          step={step}
          unit={unit}
          onChange={setMin}
          disabled={disabled}
        />
        <NumberField
          label="الحد الأعلى"
          value={max}
          step={step}
          unit={unit}
          onChange={setMax}
          disabled={disabled}
        />
      </div>
      {error && <Notice tone="critical">{error}</Notice>}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          disabled={busy || disabled}
          onClick={() => {
            if (min >= max) {
              setError('الحد الأدنى يجب أن يكون أصغر من الحد الأعلى.');
              return;
            }
            setError(null);
            onSave(min, max);
            setEditing(false);
          }}
        >
          حفظ النطاق
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={busy || disabled}
          onClick={() => {
            onReset();
            setEditing(false);
          }}
        >
          احتياج النبات الأصلي
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
          إلغاء
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 💧 نظام الري
// ---------------------------------------------------------------------------
export function IrrigationCard({
  system,
  snapshot,
  actions,
}: {
  system: ControlSystem | undefined;
  snapshot: ControlSnapshot;
  actions: OperatorActions;
}) {
  const pump = findActuator(system, 'pump');
  const valve = findActuator(system, 'valve');
  const [presetMl, setPresetMl] = useState(WATER_PRESETS_ML[1]);
  const [durationMin, setDurationMin] = useState(5);
  const [confirm, setConfirm] = useState<'start' | 'stop' | null>(null);
  const [showMaxRuntime, setShowMaxRuntime] = useState(false);

  const soilTarget = snapshot.targets.soil_moisture;
  const tank = snapshot.tank;
  const pumpBlocked = blockedReason(pump);
  const pumpOn = pump?.on ?? false;
  const durationSec = Math.round(durationMin * 60);

  const start = () =>
    actions.sendCommand('pump', 'on', null, durationSec || mlToDurationSec(presetMl));

  return (
    <>
      <ControlCard
        section="irrigation"
        title="نظام الري"
        icon="💧"
        subtitle="يشغّل المضخة حتى تصل رطوبة التربة إلى النطاق المستهدف ثم يوقفها"
        badge={
          <span className="flex items-center gap-2">
            <ActuatorChips actuator={pump ?? valve} />
            <StatusPill
              label={pumpOn ? 'المضخة تعمل' : 'المضخة متوقفة'}
              severity={pumpOn ? 'ok' : 'info'}
              pulse={pumpOn}
            />
          </span>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Reading label="رطوبة التربة" value={system?.current.text ?? '—'} />
            <Reading
              label="النطاق المستهدف"
              value={soilTarget.text}
              caption={snapshot.targets_source === 'species' ? 'احتياج النبات' : 'نطاق مخصص'}
            />
          </div>

          {system?.current.value !== null && system?.current.value !== undefined && (
            <ProgressBar
              value={system.current.value}
              min={0}
              max={100}
              severity={system.severity ?? 'info'}
            />
          )}

          {/* Water availability — only shown honestly */}
          <div className="rounded-xl border border-gray-100 divide-y divide-gray-50">
            <div className="px-3.5 py-2.5">
              <KeyValue
                label="مستوى خزان المياه"
                value={
                  tank.sensor_available && tank.level_pct !== null ? (
                    <span>
                      <span dir="ltr" className="tabular-nums">
                        {tank.level_pct.toFixed(0)}%
                      </span>
                      <span className="text-gray-400 text-[10px] mr-1">حساس مستوى المياه</span>
                    </span>
                  ) : tank.known && tank.level_pct !== null ? (
                    <span>
                      <span dir="ltr" className="tabular-nums">
                        {tank.level_pct.toFixed(0)}%
                      </span>
                      <span className="text-gray-400 text-[10px] mr-1">قيمة يدوية</span>
                    </span>
                  ) : (
                    <span className="text-gray-400 text-[11px]">حساس مستوى المياه غير متصل</span>
                  )
                }
              />
            </div>
            <div className="px-3.5 py-2.5">
              <KeyValue
                label="المياه المستخدمة اليوم"
                value={
                  tank.flow_sensor_available ? (
                    <span dir="ltr" className="tabular-nums">
                      {tank.used_today_l.toFixed(2)} لتر (حساس تدفق)
                    </span>
                  ) : (
                    <span className="text-gray-400 text-[11px]">
                      قياس استهلاك المياه يتطلب حساس تدفق
                    </span>
                  )
                }
              />
            </div>
            <div className="px-3.5 py-2.5">
              <KeyValue
                label="حد أقصى لمدة الري"
                value={
                  <span className="flex items-center gap-2">
                    <span dir="ltr" className="tabular-nums">
                      {describeDuration(snapshot.safety.pump_max_runtime_seconds)}
                    </span>
                    <button
                      type="button"
                      onClick={() => setShowMaxRuntime((current) => !current)}
                      className="text-[10px] font-bold text-leaf-700 hover:underline"
                    >
                      تعديل
                    </button>
                  </span>
                }
              />
            </div>
          </div>

          {showMaxRuntime && (
            <MaxRuntimeEditor snapshot={snapshot} actions={actions} />
          )}

          <UnsupportedNotice actuator={pump} />

          {/* Manual control */}
          <div className="space-y-4 rounded-xl border border-gray-100 p-3.5">
            <p className="text-xs font-bold text-gray-700">التحكم اليدوي في الري</p>

            <PresetRow
              label="كمية المياه (تقديرية — تُحوَّل إلى مدة تشغيل)"
              options={WATER_PRESETS_ML}
              value={presetMl}
              suffix="مل"
              disabled={!!pumpBlocked || actions.emergencyStop}
              onChange={(next) => {
                setPresetMl(next);
                setDurationMin(Math.max(1, Math.round(mlToDurationSec(next) / 60)));
              }}
            />

            <Slider
              label="مدة التشغيل"
              value={durationMin}
              min={0}
              max={30}
              unit=" دقيقة"
              disabled={!!pumpBlocked || actions.emergencyStop}
              onChange={setDurationMin}
              hint={`المدة المطلوبة: ${describeDuration(durationSec)} — سيتحقق النظام من حماية المياه ومنع الري المتكرر.`}
            />

            {durationSec > snapshot.safety.pump_max_runtime_seconds && (
              <Notice tone="warning" icon="🛡️">
                المدة المطلوبة أطول من الحد الأقصى المسموح (
                {describeDuration(snapshot.safety.pump_max_runtime_seconds)}) — ستتوقف المضخة عند
                الحد الأقصى تلقائياً لحمايتها.
              </Notice>
            )}

            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <ActionButton
                  label="💧 تشغيل المضخة"
                  active={pumpOn}
                  pending={actions.pendingActuator === 'pump' && !pumpOn}
                  disabled={!!pumpBlocked || actions.busy || actions.emergencyStop}
                  onClick={() => setConfirm('start')}
                  className="flex-none px-4"
                />
                <ActionButton
                  label="إيقاف المضخة"
                  active={!pumpOn}
                  pending={actions.pendingActuator === 'pump' && pumpOn}
                  disabled={!!pumpBlocked || actions.busy || actions.emergencyStop}
                  onClick={() => setConfirm('stop')}
                  className="flex-none px-4"
                />
              </div>
              {valve && (
                <div className="flex flex-wrap items-center gap-2">
                  <ActionButton
                    label={valve.on ? 'إغلاق صمام الري' : 'فتح صمام الري'}
                    active={!!valve.on}
                    pending={actions.pendingActuator === 'valve'}
                    disabled={!!blockedReason(valve) || actions.busy || actions.emergencyStop}
                    onClick={() =>
                      actions.sendCommand('valve', valve.on ? 'off' : 'on', null, durationSec)
                    }
                    className="flex-none px-4"
                  />
                  <span className="text-[11px] font-bold text-gray-600">
                    صمام الري:{' '}
                    <span className={valve.on ? 'text-leaf-700' : 'text-gray-400'}>
                      {valve.on ? '● مفتوح' : '● مغلق'}
                    </span>
                  </span>
                </div>
              )}
            </div>
            <p className="text-[11px] text-gray-400 leading-5">
              في الوضع التلقائي يقرر RAYY متى يبدأ الري ومتى يتوقف بناءً على رطوبة التربة واحتياج
              النبات.
            </p>
          </div>

          {!pumpBlocked && (
            <div className="rounded-xl bg-leaf-50 px-3.5 py-3">
              <p className="text-[11px] text-leaf-800 leading-5">
                <span className="font-bold">سبب القرار: </span>
                {system?.reason || 'لا يوجد قرار نشط.'}
              </p>
            </div>
          )}

          <RangeEditor
            target={soilTarget}
            unit="%"
            step={1}
            busy={actions.busy}
            disabled={actions.emergencyStop}
            onSave={(min, max) =>
              actions.saveSettings({ targets: { soil_moisture: { min, max } } })
            }
            onReset={() => actions.saveSettings({ targets: { soil_moisture: null } })}
          />
        </div>
      </ControlCard>

      <ConfirmDialog
        open={confirm === 'start'}
        title="تأكيد تشغيل الري"
        message={`سيتم تشغيل المضخة لمدة تصل إلى ${describeDuration(durationSec)}. يتحقق النظام من مستوى المياه ومن الحماية ضد الري المتكرر، وأي أمر مرفوض يُسجَّل في سجل التحكم.`}
        confirmLabel="تشغيل"
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          start();
          setConfirm(null);
        }}
      />
      <ConfirmDialog
        open={confirm === 'stop'}
        title="تأكيد إيقاف المضخة"
        message="سيتم إيقاف المضخة فوراً وتسجيل العملية في سجل التحكم."
        confirmLabel="إيقاف"
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          actions.sendCommand('pump', 'off', null, null);
          setConfirm(null);
        }}
      />
    </>
  );
}

function MaxRuntimeEditor({
  snapshot,
  actions,
}: {
  snapshot: ControlSnapshot;
  actions: OperatorActions;
}) {
  const [minutes, setMinutes] = useState(
    Math.round(snapshot.safety.pump_max_runtime_seconds / 60),
  );
  const [min, max] = snapshot.safety.pump_max_runtime_bounds;

  useEffect(() => {
    setMinutes(Math.round(snapshot.safety.pump_max_runtime_seconds / 60));
  }, [snapshot.safety.pump_max_runtime_seconds]);

  const seconds = Math.round(minutes * 60);
  const valid = seconds >= min && seconds <= max;

  return (
    <div className="space-y-3 rounded-xl border border-amber-100 bg-amber-50/50 p-3.5">
      <p className="text-[11px] text-amber-800 leading-5">
        أقصى مدة يسمح بها النظام للمضخة قبل إيقافها تلقائياً لحمايتها. لا يمكن تعطيل هذه الحماية:
        أي قيمة خارج النطاق المسموح تُرفض.
      </p>
      <NumberField
        label="أقصى مدة تشغيل (دقيقة)"
        value={minutes}
        min={Math.round(min / 60)}
        max={Math.round(max / 60)}
        step={1}
        disabled={actions.busy}
        onChange={setMinutes}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          disabled={!valid || actions.busy}
          onClick={() => actions.saveSettings({ irrigation_max_runtime_sec: seconds })}
        >
          حفظ الحد
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={actions.busy || snapshot.safety.pump_max_runtime_is_default}
          onClick={() => actions.saveSettings({ irrigation_max_runtime_sec: 0 })}
        >
          القيمة الافتراضية (
          {describeDuration(snapshot.safety.pump_max_runtime_default_seconds)})
        </Button>
        {!valid && (
          <span className="text-[11px] text-red-600">
            النطاق المسموح {Math.round(min / 60)} إلى {Math.round(max / 60)} دقيقة.
          </span>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 🌬️ التهوية  +  🌡️ درجة الحرارة
// ---------------------------------------------------------------------------
export function VentilationCard({
  system,
  actions,
}: {
  system: ControlSystem | undefined;
  actions: OperatorActions;
}) {
  const fan = findActuator(system, 'fan');
  const blocked = blockedReason(fan);
  const [speed, setSpeed] = useState(fan?.value ?? 0);
  const [confirmOff, setConfirmOff] = useState(false);

  useEffect(() => {
    if (fan?.value !== null && fan?.value !== undefined) setSpeed(fan.value);
    else if (fan?.on) setSpeed(60);
  }, [fan?.value, fan?.on]);

  return (
    <>
      <ControlCard
        section="ventilation"
        title="التهوية"
        icon="🌬️"
        subtitle="سرعة المروحة تُضبط حسب الحاجة لتصريف الحرارة والرطوبة الزائدة"
        badge={
          <span className="flex items-center gap-2">
            <ActuatorChips actuator={fan} />
            <StatusPill
              label={fan?.state_label ?? 'غير متاح'}
              severity={fan?.on ? 'ok' : 'info'}
              pulse={fan?.on}
            />
          </span>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Reading label="رطوبة الهواء" value={system?.current.text ?? '—'} />
            <Reading label="النطاق المستهدف" value={system?.target.text ?? '—'} />
          </div>

          <UnsupportedNotice actuator={fan} />

          {/* Variable speed only where the output actually supports it. */}
          {fan?.variable ? (
            <Slider
              label="سرعة المروحة"
              value={speed}
              min={0}
              max={100}
              disabled={!!blocked || actions.emergencyStop}
              onChange={setSpeed}
              hint="0% إيقاف كامل — 100% أقصى قدرة."
            />
          ) : (
            fan?.supported && (
              <Notice tone="info" icon="ℹ️">
                هذه المروحة تعمل بالتشغيل/الإيقاف فقط — التحكم في السرعة غير مدعوم حالياً.
              </Notice>
            )
          )}

          <div className="flex flex-wrap items-center gap-2">
            {fan?.variable ? (
              <ActionButton
                label="تطبيق السرعة"
                active={!!fan?.on}
                pending={actions.pendingActuator === 'fan'}
                disabled={!!blocked || actions.busy || actions.emergencyStop}
                onClick={() => actions.sendCommand('fan', 'set', speed)}
                className="flex-none px-4"
              />
            ) : (
              <ActionButton
                label="تشغيل"
                active={!!fan?.on}
                pending={actions.pendingActuator === 'fan' && !fan?.on}
                disabled={!!blocked || actions.busy || actions.emergencyStop}
                onClick={() => actions.sendCommand('fan', 'on', null)}
                className="flex-none px-4"
              />
            )}
            <ActionButton
              label="إيقاف"
              active={!fan?.on}
              pending={actions.pendingActuator === 'fan' && !!fan?.on}
              disabled={!!blocked || actions.busy || actions.emergencyStop}
              onClick={() => (speed > 0 && fan?.variable ? setConfirmOff(true) : actions.sendCommand('fan', 'off', fan?.variable ? 0 : null))}
              className="flex-none px-4"
            />
          </div>
          <div className="text-[11px] font-bold text-gray-600">
            المروحة:{' '}
            <span className={fan?.on ? 'text-leaf-700' : 'text-gray-400'}>
              {fan?.on
                ? `● تعمل${fan?.variable && fan.value !== null ? ` — السرعة ${fan.value}%` : ''}`
                : '● متوقفة'}
            </span>
          </div>

          <div className="rounded-xl bg-gray-50 px-3.5 py-3">
            <p className="text-[11px] text-gray-600 leading-5">
              <span className="font-bold">سبب القرار: </span>
              {system?.reason || 'لا يوجد قرار نشط.'}
            </p>
          </div>
        </div>
      </ControlCard>

      <ConfirmDialog
        open={confirmOff}
        title="إيقاف المروحة"
        message="سيتم إيقاف المروحة بالكامل (السرعة 0%)."
        confirmLabel="إيقاف"
        onCancel={() => setConfirmOff(false)}
        onConfirm={() => {
          actions.sendCommand('fan', 'off', 0);
          setConfirmOff(false);
        }}
      />
    </>
  );
}

export function TemperatureCard({
  system,
  snapshot,
  actions,
}: {
  system: ControlSystem | undefined;
  snapshot: ControlSnapshot;
  actions: OperatorActions;
}) {
  const fan = findActuator(system, 'fan');
  const vent = findActuator(system, 'vent');
  const target = snapshot.targets.temperature;
  const current = system?.current.value ?? null;
  const inRange = current !== null && current >= target.min && current <= target.max;

  return (
    <ControlCard
      section="temperature"
      title="درجة الحرارة"
      icon="🌡️"
      subtitle="التحكم يتم عبر وحدات التنفيذ المتصلة (المروحة وفتحات التهوية)"
      badge={
        <StatusPill
          label={inRange ? 'ضمن النطاق' : (system?.status_label ?? 'غير متاح')}
          severity={inRange ? 'ok' : (system?.severity ?? 'info')}
        />
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Reading
            label="درجة الحرارة الحالية"
            value={current === null ? '—' : current.toFixed(1)}
            unit="°C"
            tone={inRange ? 'text-gray-900' : 'text-amber-700'}
          />
          <Reading label="النطاق المستهدف" value={target.text} unit="" />
        </div>

        {current !== null && (
          <ProgressBar
            value={current}
            min={target.min - 10}
            max={target.max + 10}
            severity={inRange ? 'ok' : 'warning'}
          />
        )}

        <div className="rounded-xl border border-gray-100 divide-y divide-gray-50">
          <div className="px-3.5 py-2.5">
            <KeyValue
              label="وحدة التنفيذ المسؤولة"
              value={
                <span className="flex items-center gap-2 flex-wrap">
                  {fan?.label ?? 'المروحة'}
                  {fan?.variable && fan.value !== null && (
                    <span dir="ltr" className="tabular-nums text-gray-500">
                      {fan.value}%
                    </span>
                  )}
                  <Chip tone={fan?.supported && fan.online ? 'neutral' : 'muted'}>
                    {fan?.supported && fan.online ? 'متاحة' : 'غير متاحة'}
                  </Chip>
                </span>
              }
            />
          </div>
          <div className="px-3.5 py-2.5">
            <KeyValue
              label="فتحات التهوية"
              value={
                <span className="flex items-center gap-2 flex-wrap">
                  {vent?.variable && vent.value !== null ? (
                    <span dir="ltr" className="tabular-nums">
                      {vent.value}%
                    </span>
                  ) : (
                    <span className="text-gray-400 text-[11px]">
                      {vent?.supported ? 'تشغيل/إيقاف فقط' : 'غير مدعومة حالياً'}
                    </span>
                  )}
                  <Chip tone={vent?.supported && vent.online ? 'neutral' : 'muted'}>
                    {vent?.supported && vent.online ? 'متاحة' : 'غير متاحة'}
                  </Chip>
                </span>
              }
            />
          </div>
        </div>

        <div className="rounded-xl bg-gray-50 px-3.5 py-3">
          <p className="text-[11px] text-gray-600 leading-5">
            <span className="font-bold">سبب القرار: </span>
            {system?.reason || 'لا يوجد قرار نشط.'}
          </p>
        </div>

        <RangeEditor
          target={target}
          unit="°C"
          step={0.5}
          busy={actions.busy}
          disabled={actions.emergencyStop}
          onSave={(min, max) => actions.saveSettings({ targets: { temperature: { min, max } } })}
          onReset={() => actions.saveSettings({ targets: { temperature: null } })}
        />
      </div>
    </ControlCard>
  );
}

// ---------------------------------------------------------------------------
// ☀️ نظام الإضاءة
// ---------------------------------------------------------------------------
export function LightingCard({
  system,
  snapshot,
  actions,
}: {
  system: ControlSystem | undefined;
  snapshot: ControlSnapshot;
  actions: OperatorActions;
}) {
  const light = findActuator(system, 'grow_light');
  const blocked = blockedReason(light);
  const [level, setLevel] = useState(light?.value ?? 60);
  const target = snapshot.targets.light;

  useEffect(() => {
    if (light?.value !== null && light?.value !== undefined) setLevel(light.value);
  }, [light?.value]);

  return (
    <ControlCard
      section="lighting"
      title="نظام الإضاءة"
      icon="☀️"
      subtitle="إضاءة النمو تُشغَّل عند انخفاض الإضاءة الطبيعية عن احتياج النبات"        badge={
          <span className="flex items-center gap-2">
            <ActuatorChips actuator={light} />
          <StatusPill
            label={light?.state_label ?? 'غير متاح'}
            severity={light?.on ? 'ok' : 'info'}
            pulse={light?.on}
          />
        </span>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Reading label="الإضاءة الحالية" value={system?.current.text ?? '—'} />
          <Reading label="المستوى المستهدف" value={target.text} caption="حسب احتياج النبات" />
        </div>

        <UnsupportedNotice actuator={light} />

        {light?.variable && (
          <Slider
            label="شدة الإضاءة"
            value={level}
            min={0}
            max={100}
            disabled={!!blocked || actions.emergencyStop}
            onChange={setLevel}
            hint="النسبة المئوية من قدرة إضاءة النمو."
          />
        )}
        {light?.supported && !light.variable && (
          <Notice tone="info" icon="ℹ️">
            إضاءة النمو تعمل بالتشغيل/الإيقاف فقط — التحكم في الشدة غير مدعوم حالياً.
          </Notice>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <ActionButton
            label="تشغيل"
            active={!!light?.on}
            pending={actions.pendingActuator === 'grow_light' && !light?.on}
            disabled={!!blocked || actions.busy || actions.emergencyStop}
            onClick={() =>
              actions.sendCommand('grow_light', light?.variable ? 'set' : 'on', light?.variable ? level : null)
            }
            className="flex-none px-4"
          />
          <ActionButton
            label="إيقاف"
            active={!light?.on}
            pending={actions.pendingActuator === 'grow_light' && !!light?.on}
            disabled={!!blocked || actions.busy || actions.emergencyStop}
            onClick={() => actions.sendCommand('grow_light', 'off', light?.variable ? 0 : null)}
            className="flex-none px-4"
          />
        </div>

        <div className="rounded-xl bg-gray-50 px-3.5 py-3">
          <p className="text-[11px] text-gray-600 leading-5">
            <span className="font-bold">سبب القرار: </span>
            {system?.reason || 'لا يوجد قرار نشط.'}
          </p>
        </div>

        <RangeEditor
          target={target}
          unit="لوكس"
          step={25}
          busy={actions.busy}
          disabled={actions.emergencyStop}
          onSave={(min, max) => actions.saveSettings({ targets: { light: { min, max } } })}
          onReset={() => actions.saveSettings({ targets: { light: null } })}
        />
      </div>
    </ControlCard>
  );
}

// ---------------------------------------------------------------------------
// 🪟 فتحات الصوبة
// ---------------------------------------------------------------------------
export function VentsCard({
  system,
  actions,
}: {
  system: ControlSystem | undefined;
  actions: OperatorActions;
}) {
  const vent = findActuator(system, 'vent');
  const blocked = blockedReason(vent);
  const [position, setPosition] = useState(vent?.value ?? 0);

  useEffect(() => {
    if (vent?.value !== null && vent?.value !== undefined) setPosition(vent.value);
  }, [vent?.value]);

  return (
    <ControlCard
      section="vents"
      title="فتحات التهوية"
      icon="🪟"
      subtitle="نسبة فتح فتحات الصوبة — تُستخدم لتصريف الحرارة والرطوبة"        badge={
          <span className="flex items-center gap-2">
            <ActuatorChips actuator={vent} />
          <StatusPill
            label={vent?.state_label ?? 'غير متاح'}
            severity={vent?.on ? 'ok' : 'info'}
            pulse={vent?.on}
          />
        </span>
      }
    >
      <div className="space-y-4">
        {!vent?.supported && (
          <Notice tone="warning" icon="🪟">
            التحكم في فتحات الصوبة غير متصل — {vent?.support_reason}
          </Notice>
        )}

        {vent?.supported && !vent.variable && (
          <Notice tone="info" icon="ℹ️">
            الفتحات تعمل بالتشغيل/الإيقاف فقط — تحديد نسبة الفتح غير مدعوم حالياً.
          </Notice>
        )}

        {vent?.variable && (
          <>
            <Slider
              label="نسبة الفتح"
              value={position}
              min={0}
              max={100}
              disabled={!!blocked || actions.emergencyStop}
              onChange={setPosition}
              hint="0% مغلقة تماماً — 100% مفتوحة بالكامل."
            />
            <ProgressBar
              value={position}
              severity={position > 70 ? 'warning' : 'ok'}
              height="h-3"
            />
            <div className="flex flex-wrap items-center gap-2">
              <ActionButton
                label="تطبيق نسبة الفتح"
                active={!!vent?.on && vent.value === position && position > 0 && position < 100}
                pending={actions.pendingActuator === 'vent'}
                disabled={!!blocked || actions.busy || actions.emergencyStop}
                onClick={() => actions.sendCommand('vent', 'set', position)}
                className="flex-none px-4"
              />
              <ActionButton
                label="فتح بالكامل"
                active={!!vent?.on && vent.value === 100}
                pending={actions.pendingActuator === 'vent'}
                disabled={!!blocked || actions.busy || actions.emergencyStop}
                onClick={() => {
                  setPosition(100);
                  actions.sendCommand('vent', 'set', 100);
                }}
                className="flex-none px-4"
              />
              <ActionButton
                label="إغلاق بالكامل"
                active={!vent?.on || vent.value === 0}
                pending={actions.pendingActuator === 'vent'}
                disabled={!!blocked || actions.busy || actions.emergencyStop}
                onClick={() => {
                  setPosition(0);
                  actions.sendCommand('vent', 'off', 0);
                }}
                className="flex-none px-4"
              />
            </div>
            <div className="text-[11px] font-bold text-gray-600">
              فتحات التهوية:{' '}
              <span className={vent?.on ? 'text-leaf-700' : 'text-gray-400'}>
                {vent?.on ? `● مفتوحة — ${vent.value ?? 0}%` : '● مغلقة'}
              </span>
            </div>
          </>
        )}

        {vent?.supported && !vent.variable && (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              disabled={!!blocked || actions.busy || actions.emergencyStop || vent.on}
              onClick={() => actions.sendCommand('vent', 'on', null)}
            >
              فتح
            </Button>
            <Button
              variant="outline"
              disabled={!!blocked || actions.busy || actions.emergencyStop || !vent.on}
              onClick={() => actions.sendCommand('vent', 'off', null)}
            >
              إغلاق
            </Button>
          </div>
        )}

        <div className="rounded-xl bg-gray-50 px-3.5 py-3">
          <p className="text-[11px] text-gray-600 leading-5">
            <span className="font-bold">سبب القرار: </span>
            {system?.reason || 'لا يوجد قرار نشط.'}
          </p>
        </div>
      </div>
    </ControlCard>
  );
}

// ---------------------------------------------------------------------------
// 🚰 إدارة المياه
// ---------------------------------------------------------------------------
export function WaterCard({
  snapshot,
  actions,
}: {
  snapshot: ControlSnapshot;
  actions: OperatorActions;
}) {
  const tank = snapshot.tank;
  const [level, setLevel] = useState(tank.level_pct ?? 50);
  const [confirm, setConfirm] = useState(false);

  const severity =
    tank.status === 'critical' ? 'critical' : tank.status === 'low' ? 'warning' : tank.status === 'ok' ? 'ok' : 'info';

  return (
    <>
      <ControlCard
        section="waterTank"
        title="خزان المياه"
        icon="🚰"
        subtitle="حماية المضخة: لا يبدأ الري عندما يكون المستوى منخفضاً"
        badge={<StatusPill label={tank.status_label} severity={severity} />}
      >
        <div className="space-y-4">
          {tank.sensor_available && tank.level_pct !== null ? (
            <div className="rounded-xl bg-gray-50 px-3.5 py-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] text-gray-500">مستوى الخزان — حساس مستوى المياه</span>
                <span dir="ltr" className="text-lg font-bold tabular-nums">
                  {tank.level_pct.toFixed(0)}%
                </span>
              </div>
              <ProgressBar value={tank.level_pct} severity={severity} height="h-3" />
            </div>
          ) : tank.known && tank.level_pct !== null ? (
            <div className="rounded-xl bg-gray-50 px-3.5 py-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] text-gray-500">مستوى الخزان — قيمة مُدخلة يدوياً</span>
                <span dir="ltr" className="text-lg font-bold tabular-nums">
                  {tank.level_pct.toFixed(0)}%
                </span>
              </div>
              <ProgressBar value={tank.level_pct} severity={severity} height="h-3" />
              <p className="text-[11px] text-gray-400 mt-2 leading-5">
                حساس مستوى المياه غير متصل — القيمة يدوية ويجب تحديثها بنفسك.
              </p>
            </div>
          ) : (
            <Notice tone="warning" icon="🚰">
              حساس مستوى المياه غير متصل — لا يمكن قياس مستوى الخزان، ولن يعرض النظام نسبة غير
              حقيقية. أدخل المستوى يدوياً أدناه لتفعيل حماية المضخة.
            </Notice>
          )}

          <div className="rounded-xl border border-gray-100 divide-y divide-gray-50">
            <div className="px-3.5 py-2.5">
              <KeyValue
                label="المياه المستخدمة اليوم"
                value={
                  tank.flow_sensor_available ? (
                    <span dir="ltr" className="tabular-nums">
                      {tank.used_today_l.toFixed(2)} لتر
                    </span>
                  ) : (
                    <span className="text-gray-400 text-[11px]">
                      قياس استهلاك المياه يتطلب حساس تدفق
                    </span>
                  )
                }
              />
            </div>
            <div className="px-3.5 py-2.5">
              <KeyValue label="سعة الخزان" value={`${tank.capacity_l} لتر`} dir="ltr" />
            </div>
            <div className="px-3.5 py-2.5">
              <KeyValue
                label="حد التحذير / الحد الحرج"
                value={`${tank.low_pct}% / ${tank.critical_pct}%`}
                dir="ltr"
              />
            </div>
          </div>

          {tank.warning && <Notice tone={severity === 'critical' ? 'critical' : 'warning'}>{tank.warning}</Notice>}

          <div className="space-y-3 rounded-xl border border-gray-100 p-3.5">
            <Slider
              label="تحديث مستوى المياه يدوياً"
              value={level}
              onChange={setLevel}
              disabled={actions.emergencyStop || tank.sensor_available}
              hint={
                tank.sensor_available
                  ? 'المستوى يأتي من الحساس — التحديث اليدوي غير مطلوب.'
                  : 'اقرأ المؤشر على الخزان وأدخل النسبة.'
              }
            />
            <Button
              size="sm"
              variant="outline"
              disabled={actions.busy || actions.emergencyStop || tank.sensor_available}
              onClick={() => setConfirm(true)}
            >
              تحديث المستوى
            </Button>
          </div>
        </div>
      </ControlCard>

      <ConfirmDialog
        open={confirm}
        title="تحديث مستوى خزان المياه"
        message={`سيتم تسجيل المستوى ${level}% واستخدامه في حماية المضخة. هذه قيمة يدوية لأن الجهاز لا يحتوي على حساس مستوى.`}
        confirmLabel="تحديث"
        onCancel={() => setConfirm(false)}
        onConfirm={() => {
          actions.saveSettings({ water_tank_pct: level });
          setConfirm(false);
        }}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// التحكم السريع
// ---------------------------------------------------------------------------
export function QuickControls({
  snapshot,
  actions,
}: {
  snapshot: ControlSnapshot;
  actions: OperatorActions;
}) {
  const byKey = (key: string) => snapshot.systems.find((system) => system.key === key);
  const temperature = byKey('temperature');
  const ventilation = byKey('ventilation');
  const lighting = byKey('lighting');
  const irrigation = byKey('irrigation');

  const fan = findActuator(ventilation, 'fan') ?? findActuator(temperature, 'fan');
  const vent = findActuator(ventilation, 'vent') ?? findActuator(temperature, 'vent');
  const light = findActuator(lighting, 'grow_light');
  const pump = findActuator(irrigation, 'pump');

  const rows: {
    key: string;
    icon: string;
    label: string;
    actuator: ControlActuator | undefined;
    on: () => void;
    off: () => void;
    onLabel: string;
    offLabel: string;
    variable?: boolean;
  }[] = [
    {
      key: 'pump',
      icon: '💧',
      label: 'المضخة',
      actuator: pump,
      onLabel: 'تشغيل',
      offLabel: 'إيقاف',
      // Never request more than the safety ceiling allows, so the pump is not
      // started with a duration the guard would immediately truncate.
      on: () =>
        actions.sendCommand('pump', 'on', null, snapshot.safety.pump_max_runtime_seconds),
      off: () => actions.sendCommand('pump', 'off', null, null),
    },
    {
      key: 'fan',
      icon: '🌬️',
      label: 'المروحة',
      actuator: fan,
      onLabel: 'تشغيل',
      offLabel: 'إيقاف',
      on: () => actions.sendCommand('fan', fan?.variable ? 'set' : 'on', fan?.variable ? 60 : null),
      off: () => actions.sendCommand('fan', 'off', fan?.variable ? 0 : null),
    },
    {
      key: 'grow_light',
      icon: '☀️',
      label: 'الإضاءة',
      actuator: light,
      onLabel: 'تشغيل',
      offLabel: 'إيقاف',
      on: () =>
        actions.sendCommand('grow_light', light?.variable ? 'set' : 'on', light?.variable ? 60 : null),
      off: () => actions.sendCommand('grow_light', 'off', light?.variable ? 0 : null),
    },
    {
      key: 'vent',
      icon: '🪟',
      label: 'الفتحات',
      actuator: vent,
      onLabel: 'فتح',
      offLabel: 'إغلاق',
      on: () => actions.sendCommand('vent', vent?.variable ? 'set' : 'on', vent?.variable ? 100 : null),
      off: () => actions.sendCommand('vent', 'off', vent?.variable ? 0 : null),
    },
  ];

  return (
    <ControlCard
      section="quickControl"
      title="التحكم السريع"
      icon="⚡"
      subtitle="أوامر فورية للأجهزة المتصلة — تُرسل عبر نفس مسار التحكم وتُسجَّل في سجل التحكم"
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        {rows.map((row) => {
          const blocked = blockedReason(row.actuator);
          const on = !!row.actuator?.on;
          const pending = actions.pendingActuator === row.key;
          const disabled = !!blocked || actions.busy || actions.emergencyStop;
          return (
            <div
              key={row.key}
              className={`rounded-xl border p-3.5 space-y-3 transition-all ${
                on
                  ? 'border-leaf-300 bg-leaf-50 ring-1 ring-leaf-200'
                  : 'border-gray-100 bg-white'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 text-sm font-bold text-gray-700">
                  <span
                    className={`w-2 h-2 rounded-full ${
                      pending ? 'bg-amber-400 animate-pulse' : on ? 'bg-green-500 animate-pulse' : 'bg-gray-300'
                    }`}
                  />
                  <span>{row.icon}</span>
                  {row.label}
                </span>
                {row.actuator?.simulated && <Chip tone="sim">وحدة تحكم ذكية</Chip>}
              </div>
              <Toggle
                label={pending ? 'جارٍ التنفيذ…' : (row.actuator?.state_label ?? 'غير متاح')}
                on={on}
                disabled={disabled || !row.actuator}
                busy={pending}
                onLabel={row.onLabel}
                offLabel={row.offLabel}
                onChange={(next) => {
                  // The toggle dispatches a real backend command; the cached
                  // snapshot is flipped optimistically so the card reacts at once.
                  if (next) row.on();
                  else row.off();
                }}
              />
              {/* Explicit action buttons. The one matching the current state is
                  shown as pressed/active and disabled, so the click is obvious. */}
              <div className="flex items-center gap-2">
                <ActionButton
                  label={row.onLabel}
                  active={on}
                  pending={pending && !on}
                  disabled={disabled || !row.actuator}
                  onClick={row.on}
                />
                <ActionButton
                  label={row.offLabel}
                  active={!on}
                  pending={pending && on}
                  disabled={disabled || !row.actuator}
                  onClick={row.off}
                />
              </div>
              {blocked && (
                <p className="text-[10px] text-gray-400 leading-4" title={blocked}>
                  {row.actuator?.supported ? 'غير متصل حالياً' : 'هذه الوظيفة غير مدعومة حالياً'}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </ControlCard>
  );
}
