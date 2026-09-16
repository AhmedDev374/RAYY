import { useState } from 'react';
import type { ControlSchedule, ScheduleInput, ScheduleUpdate } from '../../lib/control';
import { WEEKDAYS_AR, describeDuration } from '../../lib/control';
import { Button, ConfirmDialog, ControlCard, Notice, StatusPill } from './ui';

/** The systems a schedule can target, with the value the form starts on. */
const SCHEDULE_SYSTEMS = [
  {
    key: 'irrigation',
    label: 'نظام الري',
    action: 'on' as const,
    valueKind: 'volume' as const,
    value: 500,
    durationSec: 300,
  },
  {
    key: 'lighting',
    label: 'نظام الإضاءة',
    action: 'set' as const,
    valueKind: 'percent' as const,
    value: 60,
    durationSec: 0,
  },
  {
    key: 'temperature',
    label: 'المروحة (تبريد)',
    action: 'set' as const,
    valueKind: 'percent' as const,
    value: 60,
    durationSec: 0,
  },
  {
    key: 'ventilation',
    label: 'التهوية (فتحات)',
    action: 'set' as const,
    valueKind: 'percent' as const,
    value: 40,
    durationSec: 0,
  },
];

interface FormState {
  time: string;
  systemKey: string;
  action: 'on' | 'off' | 'set';
  value: number;
  durationMin: number;
  days: number[];
}

const emptyForm = (): FormState => ({
  time: '06:00',
  systemKey: SCHEDULE_SYSTEMS[0].key,
  action: SCHEDULE_SYSTEMS[0].action,
  value: SCHEDULE_SYSTEMS[0].value,
  durationMin: 5,
  days: [0, 1, 2, 3, 4, 5, 6],
});

export function ScheduleManager({
  schedules,
  busy,
  emergencyStop,
  hardwareNote,
  onCreate,
  onUpdate,
  onDelete,
}: {
  schedules: ControlSchedule[];
  busy: boolean;
  emergencyStop: boolean;
  /** Set when the targeted output is not installed, so the UI can say so. */
  hardwareNote?: string;
  onCreate: (payload: Omit<ScheduleInput, 'plant_id'>) => void;
  onUpdate: (scheduleId: number, payload: ScheduleUpdate) => void;
  onDelete: (id: number) => void;
}) {
  const [form, setForm] = useState<FormState>(emptyForm);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ControlSchedule | null>(null);

  const selected =
    SCHEDULE_SYSTEMS.find((item) => item.key === form.systemKey) ?? SCHEDULE_SYSTEMS[0];

  const toggleDay = (day: number) =>
    setForm((current) => ({
      ...current,
      days: current.days.includes(day)
        ? current.days.filter((item) => item !== day)
        : [...current.days, day].sort(),
    }));

  const startEdit = (schedule: ControlSchedule) => {
    setEditingId(schedule.id);
    setForm({
      time: schedule.time_of_day,
      systemKey: schedule.system,
      action: schedule.action as 'on' | 'off' | 'set',
      value: schedule.value ?? 0,
      durationMin: Math.max(1, Math.round(schedule.duration_sec / 60)),
      days: schedule.days,
    });
  };

  const submit = () => {
    const durationSec = selected.valueKind === 'volume' ? Math.round(form.durationMin * 60) : 0;
    if (editingId !== null) {
      onUpdate(editingId, {
        system: selected.key,
        action: form.action,
        value: form.action === 'off' ? 0 : form.value,
        duration_sec: durationSec,
        time_of_day: form.time,
        days: form.days,
      });
      setEditingId(null);
      setForm(emptyForm());
      return;
    }
    onCreate({
      system: selected.key,
      action: form.action,
      value: form.action === 'off' ? 0 : form.value,
      duration_sec: durationSec,
      time_of_day: form.time,
      days: form.days,
    });
    setForm(emptyForm());
  };

  return (
    <>
      <ControlCard
        section="schedule"
        title="جدول التشغيل"
        icon="🗓️"
        subtitle="مهام مجدولة بالوقت واليوم — تُنفَّذ عبر نفس محرك التحكم وتُسجَّل في سجل التحكم"
        badge={<StatusPill label={`${schedules.length} مهمة`} severity="info" dot={false} />}
      >
        <div className="space-y-5">
          <div className="space-y-3 rounded-xl border border-gray-100 p-3.5">
            <p className="text-xs font-bold text-gray-700">
              {editingId === null ? 'إضافة مهمة' : 'تعديل مهمة'}
            </p>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <label className="block text-xs">
                <span className="text-gray-600 font-medium block mb-1">الوقت</span>
                <input
                  type="time"
                  dir="ltr"
                  value={form.time}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, time: event.target.value }))
                  }
                  className="w-full bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm font-semibold text-gray-800 text-center shadow-sm focus:outline-none focus:ring-2 focus:ring-leaf-500"
                />
              </label>

              <label className="block text-xs">
                <span className="text-gray-600 font-medium block mb-1">النظام</span>
                <select
                  value={form.systemKey}
                  onChange={(event) => {
                    const next = SCHEDULE_SYSTEMS.find((item) => item.key === event.target.value);
                    if (!next) return;
                    setForm((current) => ({
                      ...current,
                      systemKey: next.key,
                      action: next.action,
                      value: next.value,
                      durationMin: Math.max(1, Math.round(next.durationSec / 60)),
                    }));
                  }}
                  className="w-full bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm font-medium text-gray-800 shadow-sm focus:outline-none focus:ring-2 focus:ring-leaf-500"
                >
                  {SCHEDULE_SYSTEMS.map((item) => (
                    <option key={item.key} value={item.key}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block text-xs">
                <span className="text-gray-600 font-medium block mb-1">الإجراء</span>
                <select
                  value={form.action}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      action: event.target.value as 'on' | 'off' | 'set',
                    }))
                  }
                  className="w-full bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm font-medium text-gray-800 shadow-sm focus:outline-none focus:ring-2 focus:ring-leaf-500"
                >
                  <option value="on">تشغيل</option>
                  <option value="set">ضبط قيمة</option>
                  <option value="off">إيقاف</option>
                </select>
              </label>

              <label className="block text-xs">
                <span className="text-gray-600 font-medium block mb-1">
                  {selected.valueKind === 'volume' ? 'كمية المياه (مل)' : 'القيمة (%)'}
                </span>
                <input
                  type="number"
                  dir="ltr"
                  min={0}
                  value={form.value}
                  disabled={form.action === 'off'}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, value: Number(event.target.value) }))
                  }
                  className="w-full bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm font-semibold text-gray-800 text-center shadow-sm focus:outline-none focus:ring-2 focus:ring-leaf-500 disabled:bg-gray-50 disabled:text-gray-400"
                />
              </label>
            </div>

            {selected.valueKind === 'volume' && (
              <label className="block text-xs max-w-[220px]">
                <span className="text-gray-600 font-medium block mb-1">
                  مدة التشغيل (دقيقة)
                </span>
                <input
                  type="number"
                  dir="ltr"
                  min={1}
                  max={60}
                  value={form.durationMin}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, durationMin: Number(event.target.value) }))
                  }
                  className="w-full bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm font-semibold text-gray-800 text-center shadow-sm focus:outline-none focus:ring-2 focus:ring-leaf-500"
                />
                <span className="text-[10px] text-gray-400 leading-4 block mt-1">
                  الكمية المطلوبة تقديرية — لا يوجد حساس تدفق لقياس المياه الفعلية.
                </span>
              </label>
            )}

            <div>
              <span className="text-xs text-gray-600 font-medium block mb-2">الأيام</span>
              <div className="flex flex-wrap gap-1.5">
                {WEEKDAYS_AR.map((label, index) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() => toggleDay(index)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                      form.days.includes(index)
                        ? 'bg-leaf-100 text-leaf-800 ring-1 ring-leaf-200'
                        : 'bg-gray-50 text-gray-500 hover:bg-gray-100'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {emergencyStop && (
              <Notice tone="critical" icon="⛔">
                الإيقاف الطارئ مُفعَّل — لن تُنفَّذ الجداول حتى تأكيد المستخدم.
              </Notice>
            )}
            {hardwareNote && <Notice tone="info" icon="🔌">{hardwareNote}</Notice>}

            <div className="flex flex-wrap items-center gap-2">
              <Button
                disabled={busy || form.days.length === 0 || emergencyStop}
                onClick={submit}
              >
                {editingId === null ? 'إضافة مهمة' : 'حفظ التعديل'}
              </Button>
              {editingId !== null && (
                <Button
                  variant="ghost"
                  onClick={() => {
                    setEditingId(null);
                    setForm(emptyForm());
                  }}
                >
                  إلغاء التعديل
                </Button>
              )}
            </div>
          </div>

          <div className="overflow-x-auto -mx-2">
            <table className="w-full text-right text-xs min-w-[560px]">
              <thead>
                <tr className="text-gray-500 border-b border-gray-100">
                  <th className="font-semibold px-2 py-2 whitespace-nowrap">الوقت</th>
                  <th className="font-semibold px-2 py-2 whitespace-nowrap">النظام</th>
                  <th className="font-semibold px-2 py-2 whitespace-nowrap">الإجراء</th>
                  <th className="font-semibold px-2 py-2 whitespace-nowrap">القيمة</th>
                  <th className="font-semibold px-2 py-2 whitespace-nowrap">المدة</th>
                  <th className="font-semibold px-2 py-2 whitespace-nowrap">الأيام</th>
                  <th className="font-semibold px-2 py-2 whitespace-nowrap" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {schedules.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-2 py-6 text-center text-gray-500">
                      لا توجد مهام مجدولة لهذه النبتة بعد.
                    </td>
                  </tr>
                ) : (
                  schedules.map((schedule) => (
                    <tr key={schedule.id}>
                      <td dir="ltr" className="px-2 py-3 tabular-nums font-semibold text-gray-700">
                        {schedule.time_of_day}
                      </td>
                      <td className="px-2 py-3 text-gray-700 whitespace-nowrap">
                        {schedule.system_label}
                      </td>
                      <td className="px-2 py-3 font-semibold text-leaf-700 whitespace-nowrap">
                        {schedule.action_label}
                      </td>
                      <td dir="ltr" className="px-2 py-3 tabular-nums text-gray-700">
                        {schedule.value !== null && schedule.value !== undefined
                          ? schedule.value
                          : '—'}
                      </td>
                      <td className="px-2 py-3 text-gray-600 whitespace-nowrap">
                        {schedule.duration_sec ? describeDuration(schedule.duration_sec) : '—'}
                      </td>
                      <td className="px-2 py-3 text-gray-500">
                        {schedule.days.length === 7
                          ? 'كل الأيام'
                          : schedule.days.map((day) => WEEKDAYS_AR[day]).join('، ')}
                      </td>
                      <td className="px-2 py-3 whitespace-nowrap">
                        <span className="flex items-center gap-1.5">
                          <Button size="sm" variant="outline" disabled={busy} onClick={() => startEdit(schedule)}>
                            تعديل
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={busy}
                            onClick={() => setPendingDelete(schedule)}
                          >
                            حذف
                          </Button>
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </ControlCard>

      <ConfirmDialog
        open={pendingDelete !== null}
        title="حذف مهمة مجدولة"
        message={`سيتم حذف مهمة ${pendingDelete?.time_of_day ?? ''} — ${pendingDelete?.system_label ?? ''}.`}
        confirmLabel="حذف"
        danger
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          if (pendingDelete) onDelete(pendingDelete.id);
          setPendingDelete(null);
        }}
      />
    </>
  );
}
