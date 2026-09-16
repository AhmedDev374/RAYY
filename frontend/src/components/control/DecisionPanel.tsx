import type { ControlSnapshot } from '../../lib/control';
import { Chip, Collapsible, Notice, StatusPill } from './ui';

const SEVERITY_TONE: Record<string, string> = {
  ok: 'border-green-100 bg-green-50',
  info: 'border-sky-100 bg-sky-50',
  warning: 'border-amber-100 bg-amber-50',
  critical: 'border-red-100 bg-red-50',
};

/**
 * The decision explainer. It is deliberately collapsed by default: the panel
 * above it is for *doing*, this one is for *understanding*.
 */
export function DecisionPanel({ snapshot }: { snapshot: ControlSnapshot }) {
  const activeDecisions = snapshot.decisions.filter(
    (decision) => decision.action !== 'hold' || decision.reason,
  );

  return (
    <Collapsible
      section="activeDecision"
      title="كيف اتخذ RAYY القرار؟"
      icon="🧠"
      badge={<Chip tone="neutral">{snapshot.decisions.length} نظام</Chip>}
    >
      <div className="space-y-4">
        <div>
          <p className="text-xs font-bold text-gray-700 mb-2">مسار القرار</p>
          <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
            {snapshot.pipeline.map((stage, index) => (
              <span key={stage} className="flex items-center gap-1.5">
                <span className="bg-leaf-50 text-leaf-800 ring-1 ring-leaf-100 px-2.5 py-1 rounded-lg font-medium">
                  {stage}
                </span>
                {index < snapshot.pipeline.length - 1 && (
                  <span className="text-gray-300">←</span>
                )}
              </span>
            ))}
          </div>
        </div>

        {activeDecisions.length === 0 ? (
          <Notice tone="info">لا توجد قرارات مسجّلة في هذه الدورة.</Notice>
        ) : (
          <div className="space-y-2">
            {activeDecisions.map((decision) => (
              <div
                key={decision.system}
                className={`rounded-xl border px-3.5 py-3 ${
                  SEVERITY_TONE[decision.severity] ?? SEVERITY_TONE.info
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
                  <span className="text-xs font-bold text-gray-800">
                    {decision.system_label}
                  </span>
                  <span className="flex items-center gap-2">
                    {decision.actuator_label && (
                      <Chip tone="neutral">{decision.actuator_label}</Chip>
                    )}
                    <StatusPill
                      label={decision.action_label}
                      severity={decision.severity}
                      dot={false}
                    />
                  </span>
                </div>
                <p className="text-[11px] text-gray-700 leading-5">{decision.reason}</p>
              </div>
            ))}
          </div>
        )}

        <div>
          <p className="text-xs font-bold text-gray-700 mb-2">قواعد السلامة</p>
          <div className="rounded-xl border border-gray-100 divide-y divide-gray-50">
            {snapshot.safety.rules.map((rule) => (
              <div key={rule.key} className="flex items-start justify-between gap-3 px-3.5 py-2.5">
                <span className="min-w-0">
                  <span className="block text-xs font-semibold text-gray-800">{rule.label}</span>
                  <span className="block text-[11px] text-gray-500 leading-5 mt-0.5">
                    {rule.detail}
                  </span>
                </span>
                <span className="shrink-0">
                  {rule.enabled ? (
                    <StatusPill label="مفعّلة" severity="ok" dot={false} />
                  ) : (
                    <Chip
                      tone={rule.hardware_dependent ? 'muted' : 'neutral'}
                      title={rule.detail}
                    >
                      {rule.hardware_dependent ? 'يتطلب عتاداً' : 'غير مفعّلة'}
                    </Chip>
                  )}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Collapsible>
  );
}
