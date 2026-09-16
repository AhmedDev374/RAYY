import { useState } from 'react';
import { useControlActions, useControlSnapshot } from '../../hooks/useControl';
import type { ControlMode, ControlSnapshot } from '../../lib/control';
import { DecisionPanel } from './DecisionPanel';
import {
  IrrigationCard,
  LightingCard,
  QuickControls,
  TemperatureCard,
  VentilationCard,
  VentsCard,
  WaterCard,
  findActuator,
  type OperatorActions,
} from './OperatorCards';
import { ScheduleManager } from './ScheduleManager';
import { AlertsCard, DecisionLine, DeviceStatusCard, SensorStrip, TargetsCard } from './TargetsAndStatus';
import { Button, ConfirmDialog, ControlCard, Notice, SEVERITY_STYLES, StatusPill } from './ui';

const MODE_DESCRIPTIONS: Record<ControlMode, string> = {
  auto: 'RAYY يقرأ الحساسات واحتياجات النبات ويتخذ القرارات وينفّذها تلقائياً.',
  manual: 'أنت تتحكم في الأجهزة مباشرة، والقرار التلقائي معطّل.',
  scheduled: 'تُنفَّذ الأوامر المجدولة فقط، بدون تدخل تلقائي.',
};

export default function ControlCenter({ plantId }: { plantId: number }) {
  const { data: snapshot, isLoading, isError } = useControlSnapshot(plantId);
  const actions = useControlActions(plantId);
  const [stopDialog, setStopDialog] = useState(false);
  const [pendingMode, setPendingMode] = useState<ControlMode | null>(null);

  if (isLoading) {
    return (
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm animate-pulse h-64" />
    );
  }

  if (isError || !snapshot) {
    return (
      <ControlCard section="controlCenter" title="مركز التحكم الذكي" icon="🎛️">
        <Notice tone="critical" icon="⚠️">
          تعذّر تحميل حالة نظام التحكم لهذه النبتة. المراقبة تعمل، لكن بيانات التحكم غير متاحة الآن.
        </Notice>
      </ControlCard>
    );
  }

  const severity = mapOverallSeverity(snapshot);
  const operator: OperatorActions = {
    mode: snapshot.mode,
    emergencyStop: snapshot.emergency_stop,
    busy: actions.busy,
    pendingActuator: actions.pendingActuator,
    sendCommand: actions.sendCommand,
    saveSettings: actions.saveSettings,
  };

  const byKey = (key: string) => snapshot.systems.find((system) => system.key === key);
  const irrigation = byKey('irrigation');
  const temperature = byKey('temperature');
  const ventilation = byKey('ventilation');
  const lighting = byKey('lighting');
  const fan = findActuator(ventilation, 'fan') ?? findActuator(temperature, 'fan');
  const vent = findActuator(ventilation, 'vent') ?? findActuator(temperature, 'vent');

  // The schedule manager must say up front when the output it targets is absent.
  const missingOutputs = ['pump', 'fan', 'vent', 'grow_light']
    .filter((key) => {
      const actuator = findActuator(byKey(systemForActuator(key)), key);
      return !actuator || !actuator.supported || !actuator.online;
    })
    .map((key) => ACTUATOR_AR[key]);
  const hardwareNote =
    missingOutputs.length > 0
      ? `بعض المهام لن تُنفَّذ على أجهزة حقيقية لأن وحدات التنفيذ التالية غير مركّبة: ${missingOutputs.join('، ')}.`
      : undefined;

  const applyMode = (mode: ControlMode) => {
    if (mode === snapshot.mode) return;
    if (mode === 'manual') {
      setPendingMode(mode);
      return;
    }
    actions.setMode(mode);
  };

  return (
    <section id="control-center" className="space-y-5">
      {/* 1. Header: state + mode ---------------------------------------- */}
      <ControlCard
        section="controlCenter"
        title="مركز التحكم الذكي"
        icon="🎛️"
        subtitle="تحكم فعلي في أجهزة الصوبة لهذه النبتة"
        badge={
          <div className="flex items-center gap-2 flex-wrap">
            <StatusPill
              label={snapshot.overall_status.label}
              severity={severity}
              pulse={severity === 'ok'}
            />
            {snapshot.emergency_stop && <StatusPill label="إيقاف طارئ" severity="critical" />}
          </div>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className={`rounded-xl px-4 py-3 ${SEVERITY_STYLES[severity].soft}`}>
              <p className="text-xs font-bold text-gray-700 mb-1">حالة النظام</p>
              <p className="text-sm font-bold text-gray-900">{snapshot.overall_status.label}</p>
              <p className="text-[11px] leading-5 text-gray-600 mt-1">
                {snapshot.overall_status.detail}
              </p>
            </div>

            <div className="lg:col-span-2 rounded-xl border border-gray-100 p-4">
              <p className="text-xs font-bold text-gray-700 mb-3">وضع التشغيل</p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {snapshot.modes.map((mode) => {
                  const active = snapshot.mode === mode.key;
                  return (
                    <button
                      key={mode.key}
                      type="button"
                      onClick={() => applyMode(mode.key)}
                      disabled={actions.busy}
                      className={`text-right p-3 rounded-xl border transition-all disabled:cursor-not-allowed ${
                        active
                          ? 'border-leaf-300 bg-leaf-50'
                          : 'border-gray-100 hover:border-gray-200 hover:bg-gray-50'
                      }`}
                    >
                      <span className="flex items-center gap-2">
                        <span
                          className={`w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center shrink-0 ${
                            active ? 'border-leaf-600' : 'border-gray-300'
                          }`}
                        >
                          {active && <span className="w-1.5 h-1.5 rounded-full bg-leaf-600" />}
                        </span>
                        <span className="text-sm font-bold text-gray-800">{mode.label}</span>
                      </span>
                      <span className="block text-[11px] text-gray-500 leading-4 mt-1.5">
                        {MODE_DESCRIPTIONS[mode.key]}
                      </span>
                    </button>
                  );
                })}
              </div>
              {snapshot.mode !== 'auto' && (
                <Button
                  className="w-full mt-3"
                  size="sm"
                  disabled={actions.busy}
                  onClick={() => actions.setMode('auto')}
                >
                  ترك RAYY يتحكم تلقائياً
                </Button>
              )}
            </div>
          </div>

          <SensorStrip snapshot={snapshot} />

          {snapshot.device_link.source === 'simulation' && (
            <Notice tone="info" icon="🎛️">
              الأوامر تُنفَّذ على وحدة التحكم «{snapshot.device_link.device_name}» عبر مسار التحكم
              نفسه المستخدم مع العتاد الميداني.
            </Notice>
          )}
          {snapshot.device_link.device_id === null && (
            <Notice tone="warning" icon="🔌">
              الأجهزة غير متصلة — لا توجد وحدة تنفيذ مرتبطة بهذه النبتة، لذلك ستظهر أدوات التحكم
              معطّلة مع سبب كل واحدة.
            </Notice>
          )}
          {snapshot.emergency_stop && (
            <Notice tone="critical" icon="⛔">
              الإيقاف الطارئ مُفعَّل — جميع وحدات التنفيذ متوقفة ولا تُنفَّذ أوامر جديدة حتى تأكيد
              المستخدم.
            </Notice>
          )}
        </div>
      </ControlCard>

      {actions.feedback && (
        <Notice tone={actions.feedback.tone} icon={actions.feedback.tone === 'ok' ? '✅' : undefined}>
          <span className="flex items-start justify-between gap-3">
            <span>{actions.feedback.text}</span>
            <button
              type="button"
              onClick={actions.clearFeedback}
              className="text-gray-400 hover:text-gray-600 shrink-0"
              aria-label="إغلاق التنبيه"
            >
              ✕
            </button>
          </span>
        </Notice>
      )}

      {/* 2. Quick controls ---------------------------------------------- */}
      <QuickControls snapshot={snapshot} actions={operator} />

      {/* 3. Subsystem control cards ------------------------------------- */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <IrrigationCard system={irrigation} snapshot={snapshot} actions={operator} />
        <VentilationCard system={ventilation} actions={operator} />
        <TemperatureCard system={temperature} snapshot={snapshot} actions={operator} />
        <LightingCard system={lighting} snapshot={snapshot} actions={operator} />
        <VentsCard system={ventilation ?? temperature} actions={operator} />
        <WaterCard snapshot={snapshot} actions={operator} />
      </div>

      {/* 4. Targets + status + alerts ----------------------------------- */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <TargetsCard snapshot={snapshot} actions={operator} />
        <div className="space-y-5">
          <DeviceStatusCard link={snapshot.device_link} sensorDetails={snapshot.sensor_details} />
          <AlertsCard snapshot={snapshot} />
        </div>
        <div className="space-y-5">
          <ControlCard
            title="القرار النشط"
            icon="🧭"
            subtitle="ما يقرره RAYY الآن لكل نظام، والسبب بالأرقام"
          >
            <DecisionLine snapshot={snapshot} />
          </ControlCard>

          <ControlCard
            title="الإيقاف الطارئ"
            icon="⛔"
            subtitle="يوقف جميع وحدات التنفيذ فوراً ويمنع أي أمر جديد"
            className={snapshot.emergency_stop ? 'ring-2 ring-red-200' : ''}
          >
            {snapshot.emergency_stop ? (
              <div className="space-y-3">
                <Notice tone="critical">
                  {snapshot.emergency_stop_reason ??
                    'جميع وحدات التنفيذ متوقفة. لن يعود النظام للعمل تلقائياً قبل تأكيدك.'}
                </Notice>
                <Button
                  variant="primary"
                  className="w-full"
                  disabled={actions.busy}
                  onClick={() => actions.emergency('reset')}
                >
                  إلغاء الإيقاف الطارئ واستئناف التحكم
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-[11px] text-gray-500 leading-5">
                  يوقف المضخة والمراوح والفتحات والإضاءة فوراً، ويمنع أي أمر جديد حتى تأكيدك.
                </p>
                <Button
                  variant="danger"
                  className="w-full"
                  disabled={actions.busy}
                  onClick={() => setStopDialog(true)}
                >
                  ⛔ إيقاف طارئ
                </Button>
              </div>
            )}
          </ControlCard>
        </div>
      </div>

      {/* 5. Schedule + log ---------------------------------------------- */}
      <ScheduleManager
        schedules={snapshot.schedules}
        busy={actions.busy}
        emergencyStop={snapshot.emergency_stop}
        hardwareNote={hardwareNote}
        onCreate={actions.addSchedule}
        onUpdate={actions.editSchedule}
        onDelete={actions.removeSchedule}
      />

      {/* 6. Explanation (secondary) ------------------------------------- */}
      <DecisionPanel snapshot={snapshot} />

      <ConfirmDialog
        open={stopDialog}
        title="تأكيد الإيقاف الطارئ"
        message="سيتم إيقاف جميع وحدات التنفيذ (المضخة، المروحة، الفتحات، الإضاءة) ومنع أي أمر جديد. لن يستأنف النظام التحكم تلقائياً قبل تأكيدك."
        confirmLabel="نعم، أوقف كل شيء"
        onCancel={() => setStopDialog(false)}
        onConfirm={() => {
          actions.emergency('stop');
          setStopDialog(false);
        }}
        danger
      />

      <ConfirmDialog
        open={pendingMode === 'manual'}
        title="التحويل إلى الوضع اليدوي"
        message="في الوضع اليدوي يتوقف RAYY عن اتخاذ القرارات تلقائياً وتتحكم أنت في الأجهزة. ستبقى المراقبة والتنبيهات وحماية المضخة تعمل."
        confirmLabel="تحويل إلى يدوي"
        onCancel={() => setPendingMode(null)}
        onConfirm={() => {
          actions.setMode('manual');
          setPendingMode(null);
        }}
      />
    </section>
  );
}

const ACTUATOR_AR: Record<string, string> = {
  pump: 'مضخة الري',
  fan: 'المروحة',
  vent: 'فتحات التهوية',
  grow_light: 'إضاءة النمو',
};

function systemForActuator(actuator: string): string {
  switch (actuator) {
    case 'pump':
      return 'irrigation';
    case 'grow_light':
      return 'lighting';
    default:
      return 'ventilation';
  }
}

function mapOverallSeverity(snapshot: ControlSnapshot): 'ok' | 'info' | 'warning' | 'critical' {
  switch (snapshot.overall_status.key) {
    case 'ok':
      return 'ok';
    case 'warning':
      return 'warning';
    case 'critical':
    case 'stopped':
      return 'critical';
    default:
      return 'info';
  }
}
