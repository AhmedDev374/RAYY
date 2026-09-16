import type { ControlEvent } from '../../lib/control';
import { ControlCard, SEVERITY_STYLES } from './ui';

// ---------------------------------------------------------------------------
// سجل التحكم
// ---------------------------------------------------------------------------
export function ControlLogCard({
  events,
  systemFilter,
  onFilterChange,
}: {
  events: ControlEvent[];
  systemFilter: string;
  onFilterChange: (value: string) => void;
}) {
  const filtered = events.filter((event) => systemFilter === 'all' || event.system === systemFilter);
  const systems = Array.from(new Set(events.map((event) => event.system)));

  return (
    <ControlCard
      section="controlLog"
      title="سجل التحكم"
      icon="🗂️"
      subtitle="كل قرار وكل أمر: الوقت، النظام، الإجراء، السبب، والنتيجة"
      badge={
        <select
          value={systemFilter}
          onChange={(event) => onFilterChange(event.target.value)}
          className="bg-white border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs font-medium text-gray-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-leaf-500"
        >
          <option value="all">كل الأنظمة</option>
          {systems.map((system) => (
            <option key={system} value={system}>
              {events.find((event) => event.system === system)?.system_label ?? system}
            </option>
          ))}
        </select>
      }
    >
      {filtered.length === 0 ? (
        <p className="text-xs text-gray-500 text-center py-6">
          لا توجد عمليات تحكم مسجّلة بعد لهذه النبتة.
        </p>
      ) : (
        <div className="overflow-x-auto -mx-2">
          <table className="w-full text-right text-xs min-w-[640px]">
            <thead>
              <tr className="text-gray-500 border-b border-gray-100">
                <th className="font-semibold px-2 py-2 whitespace-nowrap">الوقت</th>
                <th className="font-semibold px-2 py-2 whitespace-nowrap">النظام</th>
                <th className="font-semibold px-2 py-2 whitespace-nowrap">الإجراء</th>
                <th className="font-semibold px-2 py-2">السبب</th>
                <th className="font-semibold px-2 py-2 whitespace-nowrap">النتيجة</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filtered.map((event) => (
                <tr key={event.id} className="align-top">
                  <td dir="ltr" className="px-2 py-3 text-gray-500 tabular-nums whitespace-nowrap">
                    {event.time_label || '—'}
                  </td>
                  <td className="px-2 py-3 text-gray-700 whitespace-nowrap">{event.system_label}</td>
                  <td className="px-2 py-3 text-gray-800 font-semibold whitespace-nowrap">
                    {event.action_label}
                    {event.value !== null && event.value !== undefined && (
                      <span dir="ltr" className="text-gray-500 font-normal">
                        {' '}
                        ({event.value})
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-3 text-gray-600 leading-5 min-w-[220px]">
                    {event.reason}
                    {event.result_detail && (
                      <span className="block text-[11px] text-gray-400 mt-1">{event.result_detail}</span>
                    )}
                  </td>
                  <td className="px-2 py-3 whitespace-nowrap">
                    <span
                      className={`inline-flex items-center gap-1.5 text-[11px] font-semibold px-2 py-1 rounded-full ${
                        SEVERITY_STYLES[event.severity]?.chip ?? SEVERITY_STYLES.info.chip
                      }`}
                    >
                      {event.result_label}
                    </span>
                    <span className="block text-[11px] text-gray-400 mt-1">
                      {event.source_label}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </ControlCard>
  );
}
