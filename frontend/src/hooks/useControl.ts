import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  controlEmergencyReset,
  controlEmergencyStop,
  createSchedule,
  deleteSchedule,
  getControlStatus,
  sendManualCommand,
  setControlMode,
  updateControlSettings,
  updateSchedule,
  type ControlMode,
  type ControlSnapshot,
  type ControlSettingsUpdate,
  type ScheduleInput,
  type ScheduleUpdate,
} from '../lib/control';

export interface ControlFeedback {
  tone: 'ok' | 'warning' | 'critical' | 'info';
  text: string;
}

/**
 * One shared snapshot per plant: every part of the dashboard (control center,
 * device states, control log, schedules) reads the same React Query entry, so
 * there is exactly one poll — not one per card.
 */
export function useControlSnapshot(plantId: number | null, refetchInterval = 5000) {
  return useQuery({
    queryKey: ['control-status', plantId],
    queryFn: () => getControlStatus(plantId as number),
    enabled: !!plantId,
    refetchInterval,
  });
}

/**
 * Control mutations. Every mutation that returns a fresh snapshot seeds the
 * query cache with it, so the UI reflects the decision (and the reason behind
 * it) immediately instead of waiting for the next poll.
 */
export function useControlActions(plantId: number | null) {
  const queryClient = useQueryClient();
  const [feedback, setFeedback] = useState<ControlFeedback | null>(null);
  // The actuator currently awaiting a server response, so only THAT device's
  // button shows a loading state (never all of them at once).
  const [pendingActuator, setPendingActuator] = useState<string | null>(null);

  const store = (snapshot?: ControlSnapshot) => {
    if (plantId === null) return;
    if (snapshot) queryClient.setQueryData(['control-status', plantId], snapshot);
    else queryClient.invalidateQueries({ queryKey: ['control-status', plantId] });
  };

  /**
   * Flip one actuator in the cached snapshot so the dashboard reacts the moment
   * the user clicks, before the server answers. `onSuccess` replaces this with
   * the authoritative snapshot; `onError` restores the previous one, so the UI
   * never keeps claiming a device is ON after a failed command.
   */
  const optimisticActuator = (actuator: string, on: boolean, value?: number | null) => {
    if (plantId === null) return;
    const key = ['control-status', plantId];
    const previous = queryClient.getQueryData<ControlSnapshot>(key);
    if (!previous) return;
    queryClient.setQueryData<ControlSnapshot>(key, {
      ...previous,
      systems: previous.systems.map((system) => ({
        ...system,
        actuators: system.actuators.map((row) =>
          row.key === actuator
            ? {
                ...row,
                on,
                value: value ?? row.value,
                state_label: on ? (value != null ? `يعمل — ${value}%` : 'يعمل') : 'متوقف',
              }
            : row,
        ),
      })),
    });
    return previous;
  };

  const modeMutation = useMutation({
    mutationFn: (mode: ControlMode) => setControlMode(plantId as number, mode),
    onSuccess: (data) => {
      store();
      setFeedback({ tone: 'info', text: `تم تحويل وضع التشغيل إلى «${data.mode_label}».` });
    },
    onError: (error: unknown) =>
      setFeedback({ tone: 'critical', text: describeError(error, 'تعذّر تغيير وضع التشغيل.') }),
  });

  const manualMutation = useMutation({
    mutationFn: (vars: {
      actuator: string;
      action: 'on' | 'off' | 'set';
      value?: number | null;
      durationSec?: number | null;
    }) =>
      sendManualCommand(
        plantId as number,
        vars.actuator,
        vars.action,
        vars.value,
        vars.durationSec,
      ),
    onMutate: (vars) => {
      // Immediate, persistent visual feedback: the device card flips the moment
      // the button is pressed. Returns the pre-click snapshot for rollback.
      setPendingActuator(vars.actuator);
      const previous = optimisticActuator(
        vars.actuator,
        vars.action === 'on' || vars.action === 'set',
        vars.value,
      );
      return { previous };
    },
    onSuccess: (data) => {
      store(data.snapshot);
      const event = data.event;
      const head = `${event.actuator_label ?? event.system_label}: ${event.action_label} — ${event.result_label}`;
      const tone: ControlFeedback['tone'] =
        event.result === 'queued'
          ? 'ok'
          : event.result === 'blocked'
            ? 'critical'
            : event.result === 'executed'
              ? 'ok'
              : 'warning';
      setFeedback({ tone, text: `${head}${event.result_detail ? ` — ${event.result_detail}` : ''}` });
    },
    onError: (error: unknown, _vars, context) => {
      // Revert the optimistic flip so the UI never shows a device as ON when the
      // command actually failed, and surface a clear error state.
      if (context?.previous) store(context.previous);
      else store();
      setFeedback({ tone: 'critical', text: describeError(error, 'تعذّر إرسال الأمر.') });
    },
    onSettled: () => setPendingActuator(null),
  });

  const settingsMutation = useMutation({
    mutationFn: (payload: ControlSettingsUpdate) =>
      updateControlSettings(plantId as number, payload),
    onSuccess: () => {
      store();
      setFeedback({ tone: 'ok', text: 'تم حفظ إعدادات التحكم.' });
    },
    onError: (error: unknown) =>
      setFeedback({ tone: 'critical', text: describeError(error, 'تعذّر حفظ الإعدادات.') }),
  });

  const emergencyMutation = useMutation({
    mutationFn: (action: 'stop' | 'reset') =>
      action === 'stop'
        ? controlEmergencyStop(plantId as number)
        : controlEmergencyReset(plantId as number),
    onSuccess: (data) => {
      store(data.snapshot);
      setFeedback({ tone: data.emergency_stop ? 'critical' : 'ok', text: data.message });
    },
    onError: (error: unknown) =>
      setFeedback({ tone: 'critical', text: describeError(error, 'تعذّر تنفيذ الإيقاف الطارئ.') }),
  });

  const scheduleMutation = useMutation({
    mutationFn: (payload: Omit<ScheduleInput, 'plant_id'>) =>
      createSchedule({ ...payload, plant_id: plantId as number }),
    onSuccess: (schedule) => {
      store();
      setFeedback({
        tone: 'ok',
        text: `تمت إضافة جدولة ${schedule.time_of_day} — ${schedule.system_label}.`,
      });
    },
    onError: (error: unknown) =>
      setFeedback({ tone: 'critical', text: describeError(error, 'تعذّر إنشاء الجدولة.') }),
  });

  const deleteScheduleMutation = useMutation({
    mutationFn: (scheduleId: number) => deleteSchedule(scheduleId),
    onSuccess: () => {
      store();
      setFeedback({ tone: 'info', text: 'تم حذف الجدولة.' });
    },
    onError: (error: unknown) =>
      setFeedback({ tone: 'critical', text: describeError(error, 'تعذّر حذف الجدولة.') }),
  });

  const editScheduleMutation = useMutation({
    mutationFn: (vars: { scheduleId: number; payload: ScheduleUpdate }) =>
      updateSchedule(vars.scheduleId, vars.payload),
    onSuccess: (schedule) => {
      store();
      setFeedback({ tone: 'ok', text: `تم تعديل الجدولة ${schedule.time_of_day}.` });
    },
    onError: (error: unknown) =>
      setFeedback({ tone: 'critical', text: describeError(error, 'تعذّر تعديل الجدولة.') }),
  });

  return {
    feedback,
    clearFeedback: () => setFeedback(null),
    // The device whose command is in flight (for a per-button loading state).
    pendingActuator,
    busy:
      modeMutation.isPending ||
      manualMutation.isPending ||
      settingsMutation.isPending ||
      emergencyMutation.isPending ||
      scheduleMutation.isPending ||
      deleteScheduleMutation.isPending ||
      editScheduleMutation.isPending,
    setMode: (mode: ControlMode) => modeMutation.mutate(mode),
    sendCommand: (
      actuator: string,
      action: 'on' | 'off' | 'set',
      value?: number | null,
      durationSec?: number | null,
    ) => manualMutation.mutate({ actuator, action, value, durationSec }),
    saveSettings: (payload: ControlSettingsUpdate) => settingsMutation.mutate(payload),
    emergency: (action: 'stop' | 'reset') => emergencyMutation.mutate(action),
    addSchedule: (payload: Omit<ScheduleInput, 'plant_id'>) => scheduleMutation.mutate(payload),
    editSchedule: (scheduleId: number, payload: ScheduleUpdate) =>
      editScheduleMutation.mutate({ scheduleId, payload }),
    removeSchedule: (scheduleId: number) => deleteScheduleMutation.mutate(scheduleId),
  };
}

function describeError(error: unknown, fallback: string): string {
  if (error && typeof error === 'object' && 'message' in error) {
    const message = String((error as { message?: unknown }).message ?? '');
    if (message) return `${fallback} (${message})`;
  }
  return fallback;
}
