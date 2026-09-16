import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useControlSnapshot } from '../hooks/useControl';
import { usePlantWebSocket } from '../hooks/useWebSocket';
import { api } from '../lib/api';
import { DEVICE_SOURCE_AR, type ControlSnapshot } from '../lib/control';
import type { SpeciesProfile } from '../lib/encyclopedia';

type ControlSnapshotTank = ControlSnapshot['tank'];
import { getSimulationStatus, startSimulation, type SimulationState } from '../lib/simulation';
import ControlCenter from '../components/control/ControlCenter';
import { ControlLogCard } from '../components/control/Panels';
import { SEVERITY_STYLES, StatusPill, ControlCard } from '../components/control/ui';
import { CollapsibleToolbar } from '../components/collapsible/CollapsibleSection';

interface Plant {
  id: number;
  species: string;
  nickname: string;
}

interface Reading {
  id: number;
  ts: number;
  temperature: number;
  humidity: number;
  light: number;
  soil_moisture: number;
  ph: number;
  soil_status?: string;
}

function soilStatus(moisture: number, statusLabel?: string) {
  if (statusLabel) {
    const label = statusLabel;
    if (label === 'Dry') return { label: 'جافة', color: 'bg-orange-100 text-orange-700', icon: '⚠️' };
    if (label === 'Moist') return { label: 'رطبة', color: 'bg-green-100 text-green-700', icon: '💧' };
    if (label === 'Wet') return { label: 'مشبعة بالماء', color: 'bg-blue-100 text-blue-700', icon: '🌱' };
  }

  if (moisture < 30) return { label: 'جافة', color: 'bg-orange-100 text-orange-700', icon: '🏜️' };
  if (moisture < 60) return { label: 'رطبة', color: 'bg-green-100 text-green-700', icon: '💧' };
  return { label: 'مشبعة بالماء', color: 'bg-blue-100 text-blue-700', icon: '🌊' };
}

function healthScore(r: Reading) {
  let score = 100;
  if (r.temperature < 15 || r.temperature > 32) score -= 20;
  if (r.humidity < 30 || r.humidity > 85) score -= 15;
  if (r.soil_moisture < 25 || r.soil_moisture > 80) score -= 25;
  if (r.light < 200) score -= 10;
  return Math.max(0, score);
}

function getMetricStatus(label: string, value: number): { status: 'good' | 'warning' | 'critical'; delta: string } {
  switch (label) {
    case 'temperature':
      if (value < 10 || value > 38) return { status: 'critical', delta: value > 38 ? '↑ مرتفعة' : '↓ منخفضة' };
      if (value < 15 || value > 32) return { status: 'warning', delta: value > 32 ? '↑ دافئة' : '↓ باردة' };
      return { status: 'good', delta: '✓ مثالي' };
    case 'humidity':
      if (value < 20 || value > 90) return { status: 'critical', delta: value > 90 ? '↑ مرتفعة' : '↓ منخفضة' };
      if (value < 30 || value > 80) return { status: 'warning', delta: value > 80 ? '↑ مرتفعة' : '↓ منخفضة' };
      return { status: 'good', delta: '✓ مثالي' };
    case 'soil_moisture':
      if (value < 15 || value > 90) return { status: 'critical', delta: value > 90 ? '↑ مشبعة بالماء' : '↓ جافة جدًا' };
      if (value < 30 || value > 75) return { status: 'warning', delta: value > 75 ? '↑ مرتفعة' : '↓ منخفضة' };
      return { status: 'good', delta: '✓ مثالي' };
    case 'light':
      if (value < 100) return { status: 'critical', delta: '↓ إضاءة ضعيفة جدًا' };
      if (value < 300) return { status: 'warning', delta: '↓ إضاءة منخفضة' };
      return { status: 'good', delta: '✓ إضاءة جيدة' };
    case 'health':
      if (value < 50) return { status: 'critical', delta: '↓ ضعيفة' };
      if (value < 75) return { status: 'warning', delta: '~ متوسطة' };
      return { status: 'good', delta: '✓ صحية' };
    default:
      return { status: 'good', delta: '' };
  }
}

function getRecommendations(r: Reading): Array<{ text: string; type: 'good' | 'warning' | 'critical' }> {
  const tips: Array<{ text: string; type: 'good' | 'warning' | 'critical' }> = [];
  const soilPct = r.soil_moisture;
  const lightValue = r.light;
  if (r.temperature >= 15 && r.temperature <= 32)
    tips.push({ text: 'درجة الحرارة ضمن النطاق المثالي لمعظم النباتات المنزلية.', type: 'good' });
  else if (r.temperature > 32)
    tips.push({ text: 'درجة الحرارة مرتفعة — أبعد النبتة عن مصادر الحرارة المباشرة.', type: 'warning' });
  else
    tips.push({ text: 'درجة الحرارة منخفضة — فكّر في نقل نبتتك إلى مكان أكثر دفئًا.', type: 'warning' });

  if (soilPct > 75)
    tips.push({ text: 'رطوبة التربة مرتفعة — قلّل تكرار الري لتجنب تعفن الجذور.', type: 'warning' });
  else if (soilPct < 25)
    tips.push({ text: 'التربة جافة — اسقِ نبتتك قريبًا.', type: 'critical' });
  else
    tips.push({ text: 'رطوبة التربة في مستوى مناسب وصحي.', type: 'good' });

  if (r.humidity < 30)
    tips.push({ text: 'الرطوبة منخفضة — فكّر في الرش أو استخدام جهاز ترطيب.', type: 'warning' });
  else if (r.humidity > 80)
    tips.push({ text: 'الرطوبة مرتفعة جدًا — تأكد من جودة تهوية المكان.', type: 'warning' });
  else
    tips.push({ text: 'مستوى الرطوبة مناسب ومريح لنبتتك.', type: 'good' });

  if (lightValue < 200)
    tips.push({ text: 'مستوى الإضاءة منخفض — انقل النبتة إلى مكان أكثر إضاءة أو استخدم إضاءة نمو.', type: 'warning' });
  else
    tips.push({ text: 'شدة الإضاءة مناسبة لنمو صحي.', type: 'good' });

  return tips;
}

const statusColors = {
  good: 'border-green-200 bg-green-50',
  warning: 'border-yellow-200 bg-yellow-50',
  critical: 'border-red-200 bg-red-50',
};

const statusTextColors = {
  good: 'text-green-600',
  warning: 'text-yellow-600',
  critical: 'text-red-600',
};

const statusDotColors = {
  good: 'bg-green-500',
  warning: 'bg-yellow-500',
  critical: 'bg-red-500',
};

export default function DashboardPage() {
  const [plantId, setPlantId] = useState<number | null>(null);
  const [logFilter, setLogFilter] = useState('all');
  const queryClient = useQueryClient();

  // There is no Simulation Mode toggle: selecting the simulated plant in the
  // normal plant selector is what turns the simulator on (see the effect below).
  const { data: simulation } = useQuery({
    queryKey: ['simulation-status'],
    queryFn: getSimulationStatus,
    refetchInterval: 5000,
    retry: false,
  });
  const simRunning = !!simulation?.running;

  const startSim = useMutation({
    mutationFn: startSimulation,
    onSuccess: (state: SimulationState) => {
      queryClient.setQueryData(['simulation-status'], state);
      // Starting the simulation provisions the simulated plant row, so the
      // plant list must be refreshed for it to appear in the selector.
      queryClient.invalidateQueries({ queryKey: ['plants'] });
    },
  });

  // Single source of truth: the authenticated user's real plants from
  // GET /api/v1/plants. This shares the ['plants'] query key with the
  // "My Plants", Diagnosis and Chat pages, so a plant added or removed there
  // is reflected here through React Query's shared cache invalidation.
  const { data: plants = [], isLoading: plantsLoading, isError: plantsError } = useQuery({
    queryKey: ['plants'],
    queryFn: () => api<Plant[]>('/api/v1/plants'),
    retry: false,
  });

  // The Encyclopedia is the single source of truth for the Arabic plant names.
  // Sharing the ['encyclopedia'] query key with the other pages means one cached
  // request, not a second catalog fetch.
  const { data: catalog = [] } = useQuery({
    queryKey: ['encyclopedia'],
    queryFn: () => api<SpeciesProfile[]>('/api/v1/encyclopedia'),
    staleTime: Infinity,
  });

  // Show the plant type in Arabic in the selector (e.g. "مزرعة الطماطم (الطماطم)").
  // Falls back to the stored species key until the catalog loads; nothing is
  // hardcoded, so every supported plant is translated dynamically.
  const speciesNameAr = (speciesKey: string) =>
    catalog.find((s) => s.species === speciesKey)?.name_ar ?? speciesKey;

  const hasPlants = plants.length > 0;
  const selectedId = plantId ?? plants[0]?.id ?? null;
  const selectedPlant = plants.find((p) => p.id === selectedId);

  // If the user has no plants at all, seed the simulated plant so the
  // dashboard is never empty — selecting it auto-starts the simulator.
  useEffect(() => {
    if (plantsLoading || plantsError) return;
    if (hasPlants) return;
    if (simRunning || startSim.isPending) return;
    startSim.mutate();
  }, [plantsLoading, plantsError, hasPlants, simRunning, startSim]);

  // Selecting the simulated plant in the normal selector starts the existing
  // tomato simulator. `start` is idempotent server-side, so re-selecting it --
  // or React re-running this effect -- can never spawn a second simulator, a
  // second simulated plant or a second RAYY-SIM-TOMATO-001 device.
  // Switching to any other plant simply stops *displaying* simulated data; the
  // engine keeps running and the simulated plant's history is never deleted.
  const isSimPlantSelected = !!selectedId && selectedId === simulation?.plant_id;
  useEffect(() => {
    if (!selectedPlant) return;
    if (selectedPlant.species !== 'Tomato') return;
    if (simRunning || startSim.isPending) return;
    startSim.mutate();
  }, [selectedPlant, simRunning, startSim]);

  const { data: apiReadings = [], isLoading: readingsLoading } = useQuery({
    queryKey: ['readings', selectedId],
    queryFn: () => api<Reading[]>(`/api/v1/plants/${selectedId}/readings?limit=200`),
    enabled: !!selectedId,
    // Poll faster while the simulated plant is the one being viewed so the
    // charts visibly advance; fall back to the normal cadence otherwise.
    refetchInterval: isSimPlantSelected ? 3000 : 30000,
    retry: false,
  });

  const { reading: liveReading, connected } = usePlantWebSocket(hasPlants ? selectedId : null);

  // Control state shares the ['control-status', plantId] React Query entry with
  // the Smart Control Center below, so this is a cache read -- not a second
  // poll. It feeds the general status strip, the control log and -- because it
  // carries the plant's latest reading -- the metric cards and charts too. It
  // polls at the same cadence as the readings query while the simulated plant
  // is selected, so the two can never drift apart on screen.
  const { data: controlSnapshot } = useControlSnapshot(
    selectedId,
    isSimPlantSelected ? 3000 : 5000,
  );

  // Single source of truth for the live readings.
  //
  // The control snapshot is built server-side from the plant's latest reading
  // and is the exact same reading the Smart Control Center's sensor strip and
  // the water tank are derived from. Preferring it here means the metric cards,
  // the charts and every control card are all fed by ONE reading, instead of
  // one component showing the WebSocket value and another the polled value and
  // the two disagreeing. The WebSocket reading is still used when it is the
  // freshest one the browser has, and the polled `readings` list is the last
  // fallback -- but all three paths converge on the same numbers.
  const snapshotReading = controlSnapshot?.reading ?? null;
  const liveForSelected =
    liveReading && (liveReading.plant_id === selectedId || liveReading.plant_id == null)
      ? liveReading
      : null;
  const controlReading: Reading | null = snapshotReading
    ? {
        id: apiReadings[0]?.id ?? 0,
        ts: snapshotReading.ts,
        temperature: snapshotReading.temperature,
        humidity: snapshotReading.humidity,
        light: snapshotReading.light,
        soil_moisture: snapshotReading.soil_moisture,
        ph: snapshotReading.ph,
      }
    : null;
  // Prefer the snapshot reading so the metric cards show exactly what the
  // control center / sensor strip show; fall back to the socket then the poll.
  const latest = controlReading || liveForSelected || apiReadings[0] || null;
  // Charts are built from the same polled history; the newest point is replaced
  // by `latest` so the line's last value and the metric card above it are the
  // same number (the polled list lags the snapshot by up to one poll interval).
  const chartData = [...apiReadings]
    .reverse()
    .map((r) => ({
      time: new Date(r.ts * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      temp: +r.temperature.toFixed(1),
      humidity: +r.humidity.toFixed(1),
      soil: +r.soil_moisture.toFixed(0),
      light: +r.light.toFixed(0),
    }));
  if (latest && chartData.length > 0) {
    chartData[chartData.length - 1] = {
      time: new Date(latest.ts * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      temp: +latest.temperature.toFixed(1),
      humidity: +latest.humidity.toFixed(1),
      soil: +latest.soil_moisture.toFixed(0),
      light: +latest.light.toFixed(0),
    };
  }

  const soil = latest
    ? soilStatus(latest.soil_moisture, 'soil_status' in latest ? latest.soil_status : undefined)
    : null;
  const health = latest ? healthScore(latest) : 0;
  const recommendations = latest ? getRecommendations(latest) : [];
  const lastUpdated = latest ? new Date(latest.ts * 1000).toLocaleString() : null;
  const soilBarWidth = latest ? latest.soil_moisture : 0;

  return (
    <div dir="rtl" className="space-y-6">
      {/* Top bar */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="text-right">
          <h1 className="text-2xl font-bold text-gray-900">لوحة تحكم الصوبة الذكية</h1>
          <p className="text-sm text-gray-500 mt-0.5">مراقبة وتحكم ذكي في بيئة النبات</p>
          {lastUpdated && (
            <p className="text-xs text-gray-400 mt-0.5">آخر تحديث: {lastUpdated}</p>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-3">
          {/* GLOBAL section controls: these two buttons act on EVERY collapsible
              dashboard section at once. They are intentionally kept apart from
              the single arrow each section header carries. */}
          <CollapsibleToolbar />

          {hasPlants && (
          <div className="flex items-center gap-3">
            <select
              className="bg-white border border-gray-200 rounded-lg px-4 py-2.5 text-sm font-medium text-gray-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500"
              value={selectedId ?? ''}
              onChange={(e) => setPlantId(Number(e.target.value))}
            >
              {plants.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nickname} ({speciesNameAr(p.species)})
                </option>
              ))}
            </select>
            <span
              className={`inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full ${
                connected
                  ? 'bg-green-100 text-green-700 ring-1 ring-green-200'
                  : 'bg-gray-100 text-gray-600 ring-1 ring-gray-200'
              }`}
            >
              <span
                className={`w-2 h-2 rounded-full ${
                  connected ? 'bg-green-500 animate-pulse' : 'bg-gray-400'
                }`}
              />
              {connected ? 'مباشر' : 'استعلام دوري'}
            </span>
          </div>
          )}
        </div>
      </div>

      {/* حالة النظام العامة: RAYY يراقب ويتحكم --------------------------- */}
      {!plantsLoading && !plantsError && hasPlants && controlSnapshot && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-5 py-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-2.5">
              <StatusPill
                label={controlSnapshot.overall_status.label}
                severity={
                  controlSnapshot.overall_status.key === 'ok'
                    ? 'ok'
                    : controlSnapshot.overall_status.key === 'warning'
                      ? 'warning'
                      : controlSnapshot.overall_status.key === 'critical'
                        ? 'critical'
                        : controlSnapshot.overall_status.key === 'stopped'
                          ? 'critical'
                          : 'info'
                }
                pulse={controlSnapshot.overall_status.key === 'ok'}
              />
              <span className="text-xs font-medium text-gray-600">
                وضع التشغيل: <span className="font-bold text-gray-800">{controlSnapshot.mode_label}</span>
              </span>
              {controlSnapshot.emergency_stop && <StatusPill label="إيقاف طارئ" severity="critical" />}
            </div>
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="text-xs text-gray-500">
                مصدر البيانات:{' '}
                <span className="font-semibold text-gray-700">
                  {DEVICE_SOURCE_AR[controlSnapshot.device_link.source] ??
                    controlSnapshot.device_link.source}
                </span>
              </span>
              <span className="text-xs text-gray-500">
                الحساسات:{' '}
                <span
                  className={`font-semibold ${
                    controlSnapshot.sensors.available ? 'text-green-700' : 'text-amber-700'
                  }`}
                >
                  {controlSnapshot.sensors.label}
                </span>
              </span>
            </div>
          </div>
          <p className={`text-xs leading-5 mt-2.5 ${SEVERITY_STYLES[
            controlSnapshot.overall_status.key === 'ok' ? 'ok' : 'warning'
          ].text}`}>
            {controlSnapshot.overall_status.detail}
          </p>
        </div>
      )}

      {plantsLoading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="bg-white rounded-2xl shadow-sm animate-pulse">
              <div className="h-40 bg-gray-200 rounded-t-2xl" />
              <div className="p-5 space-y-3">
                <div className="h-5 bg-gray-200 rounded w-2/3" />
                <div className="h-4 bg-gray-100 rounded w-1/2" />
              </div>
            </div>
          ))}
        </div>
      ) : plantsError ? (
        <div className="text-center py-16 bg-white rounded-2xl border border-gray-100 shadow-sm">
          <div className="text-6xl mb-4">⚠️</div>
          <h3 className="text-xl font-semibold text-gray-700 mb-2">تعذّر تحميل نباتاتك</h3>
          <p className="text-gray-500 max-w-sm mx-auto">
            يرجى تحديث الصفحة أو المحاولة مرة أخرى لاحقًا.
          </p>
        </div>
      ) : !hasPlants ? (
        <div className="text-center py-16 bg-white rounded-2xl border border-gray-100 shadow-sm">
          <div className="text-6xl mb-4">🌱</div>
          <h3 className="text-xl font-semibold text-gray-700 mb-2">لا توجد نباتات بعد</h3>
          <p className="text-gray-500 max-w-sm mx-auto mb-6">
            أضف نبتتك الأولى لبدء مراقبتها.
          </p>
          <Link
            to="/plants?add=1"
            className="inline-flex items-center gap-2 bg-leaf-700 hover:bg-leaf-800 text-white px-5 py-2.5 rounded-xl font-medium shadow-lg shadow-leaf-700/25 transition-all hover:shadow-xl hover:shadow-leaf-700/30 hover:-translate-y-0.5"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            إضافة نبتة
          </Link>
        </div>
      ) : latest ? (
        <>
          {/* Metric cards */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <MetricCard
              label="درجة الحرارة"
              value={`${latest.temperature.toFixed(1)}°C`}
              icon={
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v3m0 0v3m0-3h3m-3 0H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              }
              metric="temperature"
              rawValue={latest.temperature}
            />
            <MetricCard
              label="الرطوبة"
              value={`${latest.humidity.toFixed(0)}%`}
              icon={
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707" />
                </svg>
              }
              metric="humidity"
              rawValue={latest.humidity}
            />
            <MetricCard
              label="الإضاءة"
              value={`${latest.light.toFixed(0)} lx`}
              icon={
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 3v2.25m6.364.386l-1.591 1.591M21 12h-2.25m-.386 6.364l-1.591-1.591M12 18.75V21m-4.773-4.227l-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z" />
                </svg>
              }
              metric="light"
              rawValue={latest.light}
            />
            <MetricCard
              label="رطوبة التربة"
              value={`${latest.soil_moisture.toFixed(0)}%`}
              icon={
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19.5 12c0 4.97-4.03 9-9 9s-9-4.03-9-9c0-3.728 4.5-9.5 9-14 4.5 4.5 9 10.272 9 14z" />
                </svg>
              }
              metric="soil_moisture"
              rawValue={latest.soil_moisture}
              badge={soil}
            />
            <MetricCard
              label="صحة النبتة"
              value={`${health}%`}
              icon={
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z" />
                </svg>
              }
              metric="health"
              rawValue={health}
            />
          </div>

          {/* مركز التحكم الذكي — مراقبة وتحكم في نفس الصفحة */}
          <ControlCenter plantId={selectedId as number} />

          {/* Main content grid */}
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
            {/* Charts - 3 columns */}
            <div className="lg:col-span-3 space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Temperature & Humidity chart card.
                    Deliberately NOT a collapsible section: `collapsible={false}`
                    keeps its body always rendered, so the chart and its live
                    data stay visible. It is not registered in the expand/collapse
                    state and the global "توسيع الكل" / "طي الكل" controls never
                    touch it.
                    The card header labels were removed on purpose: no title and
                    no subtitle render, but the card container, the chart and all
                    of its data/updates stay exactly as they were. */}
                <ControlCard collapsible={false}>
                  <h3 className="text-sm font-semibold text-gray-700 mb-4">درجة الحرارة والرطوبة</h3>
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={chartData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                        <XAxis dataKey="time" tick={{ fontSize: 10 }} stroke="#9ca3af" />
                        <YAxis stroke="#9ca3af" tick={{ fontSize: 10 }} />
                        <Tooltip
                          contentStyle={{ borderRadius: '12px', border: '1px solid #e5e7eb', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)' }}
                        />
                        <Legend wrapperStyle={{ fontSize: '12px' }} />
                        <Line type="monotone" dataKey="temp" stroke="#16a34a" strokeWidth={2} dot={false} name="درجة الحرارة (°C)" />
                        <Line type="monotone" dataKey="humidity" stroke="#2563eb" strokeWidth={2} dot={false} name="الرطوبة (%)" />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </ControlCard>

                {/* Soil Moisture & Light chart */}
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                  <h3 className="text-sm font-semibold text-gray-700 mb-4">رطوبة التربة والإضاءة</h3>
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={chartData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                        <XAxis dataKey="time" tick={{ fontSize: 10 }} stroke="#9ca3af" />
                        <YAxis stroke="#9ca3af" tick={{ fontSize: 10 }} />
                        <Tooltip
                          contentStyle={{ borderRadius: '12px', border: '1px solid #e5e7eb', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)' }}
                        />
                        <Legend wrapperStyle={{ fontSize: '12px' }} />
                        <Line type="monotone" dataKey="soil" stroke="#ca8a04" strokeWidth={2} dot={false} name="التربة (%)" />
                        <Line type="monotone" dataKey="light" stroke="#9333ea" strokeWidth={2} dot={false} name="الإضاءة (lx)" />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>

              {/* Recommendations */}
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                <h3 className="text-sm font-semibold text-gray-700 mb-4 flex-row-reverse items-center justify-end gap-2">
                  <svg className="w-4 h-4 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                  </svg>
                  توصيات العناية
                </h3>
                <div className="space-y-3">
                  {recommendations.map((rec, i) => (
                    <div
                      key={i}
                      dir="rtl"
                      className={`flex items-start gap-3 p-3 rounded-xl ${
                        rec.type === 'good' ? 'bg-green-50' : rec.type === 'warning' ? 'bg-yellow-50' : 'bg-red-50'
                      }`}
                    >
                      <p className={`flex-1 text-right text-sm ${
                        rec.type === 'good' ? 'text-green-800' : rec.type === 'warning' ? 'text-yellow-800' : 'text-red-800'
                      }`}>
                        {rec.text}
                      </p>
                      <span className={`mt-0.5 w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 ${
                        rec.type === 'good' ? 'bg-green-200 text-green-700' : rec.type === 'warning' ? 'bg-yellow-200 text-yellow-700' : 'bg-red-200 text-red-700'
                      }`}>
                        {rec.type === 'good' ? '✓' : rec.type === 'warning' ? '!' : '✕'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* سجل التحكم */}
              {controlSnapshot && (
                <ControlLogCard
                  events={controlSnapshot.history}
                  systemFilter={logFilter}
                  onFilterChange={setLogFilter}
                />
              )}
            </div>

            {/* Sidebar - 1 column */}
            <div className="space-y-6">
              {/* Model Stats */}
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                <h3 className="text-sm font-semibold text-gray-700 mb-4">إحصائيات نموذج الذكاء الاصطناعي</h3>
                <div className="space-y-4">
                  <StatItem label="دقة النموذج" value="92.37%" />
                  <StatItem label="النباتات المدعومة" value="20" />
                  <StatItem label="فئات الأمراض" value="27" />
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-500">حالة الذكاء الاصطناعي</span>
                    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-green-700 bg-green-50 px-2 py-1 rounded-full">
                      <span className="w-1.5 h-1.5 bg-green-500 rounded-full" />
                      متصل
                    </span>
                  </div>
                </div>
              </div>

              {/* Soil Status */}
              {soil && (
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                  <h3 className="text-sm font-semibold text-gray-700 mb-3">حالة التربة</h3>
                  <div className={`inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium ${soil.color}`}>
                    <span>{soil.icon}</span>
                    <span>{soil.label}</span>
                  </div>
                  <div className="mt-3">
                    <div className="flex flex-row-reverse justify-between text-xs text-gray-500 mb-1">
                      <span>جافة</span>
                      <span>مشبعة بالماء</span>
                    </div>
                    <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-500 bg-gradient-to-r from-orange-400 via-green-500 to-blue-500"
                        style={{ width: `${Math.min(100, soilBarWidth)}%` }}
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Water Tank — the SAME simulated tank the control center and the
                  demo read, so the dashboard never disagrees with them. */}
              {controlSnapshot && <TankCard tank={controlSnapshot.tank} />}

              {/* Quick actions */}
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                <h3 className="text-sm font-semibold text-gray-700 mb-3">إجراءات سريعة</h3>
                <div className="space-y-2">
                  <a href="/diagnose" className="flex items-center gap-3 p-3 rounded-xl hover:bg-gray-50 transition-colors group">
                    <span className="w-8 h-8 bg-purple-100 rounded-lg flex items-center justify-center text-purple-600 group-hover:bg-purple-200 transition-colors">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                      </svg>
                    </span>
                    <span className="text-sm text-gray-700">تشخيص مرض</span>
                  </a>
                  <a href="/chat" className="flex items-center gap-3 p-3 rounded-xl hover:bg-gray-50 transition-colors group">
                    <span className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center text-blue-600 group-hover:bg-blue-200 transition-colors">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                      </svg>
                    </span>
                    <span className="text-sm text-gray-700">اسأل المساعد الذكي</span>
                  </a>
                </div>
              </div>
            </div>
          </div>
        </>
      ) : readingsLoading ? (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm animate-pulse">
          <div className="h-64 bg-gray-200 rounded-2xl" />
        </div>
      ) : (
        <div className="text-center py-16 bg-white rounded-2xl border border-gray-100 shadow-sm">
          <div className="text-6xl mb-4">📡</div>
          <h3 className="text-xl font-semibold text-gray-700 mb-2">لا توجد قراءات من الحساسات بعد</h3>
          <p className="text-gray-500 max-w-sm mx-auto">
            {selectedPlant?.nickname ?? 'هذه النبتة'} مسجّلة ولكنها لم ترسل أي قراءات بعد.
            وصّل جهاز الحساسات أو انتظر القراءة التالية.
          </p>
        </div>
      )}
    </div>
  );
}

function MetricCard({
  label,
  value,
  icon,
  metric,
  rawValue,
  badge,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  metric: string;
  rawValue: number;
  badge?: { label: string; color: string; icon: string } | null;
}) {
  const { status, delta } = getMetricStatus(metric, rawValue);

  return (
    <div className={`rounded-2xl border p-4 text-right transition-all hover:shadow-md ${statusColors[status]}`}>
      <div className="flex flex-row-reverse items-center justify-between mb-2">
        <span className={`${statusTextColors[status]}`}>{icon}</span>
        <span className={`w-2 h-2 rounded-full ${statusDotColors[status]}`} />
      </div>
      <p className="text-2xl font-bold text-gray-900">{value}</p>
      <p className="text-xs text-gray-500 mt-0.5">{label}</p>
      <p className={`text-xs font-medium mt-1 ${statusTextColors[status]}`}>{delta}</p>
      {badge && (
        <span className={`inline-block mt-2 text-xs px-2 py-0.5 rounded-full font-medium ${badge.color}`}>
          {badge.icon} {badge.label}
        </span>
      )}
    </div>
  );
}

function TankCard({ tank }: { tank: ControlSnapshotTank }) {
  const severity =
    tank.status === 'critical'
      ? 'critical'
      : tank.status === 'low'
        ? 'warning'
        : tank.status === 'ok'
          ? 'ok'
          : 'info';
  const pct = tank.known && tank.level_pct !== null ? tank.level_pct : null;
  const barColor =
    severity === 'critical'
      ? 'bg-red-500'
      : severity === 'warning'
        ? 'bg-amber-500'
        : severity === 'ok'
          ? 'bg-sky-500'
          : 'bg-gray-300';

  return (
    <ControlCard
      section="waterTank"
      title="خزان المياه"
      subtitle="مستوى الخزان المستخدم في حماية المضخة"
    >
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs text-gray-500">المستوى الحالي</span>
        <span
          className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${
            severity === 'critical'
              ? 'bg-red-100 text-red-700'
              : severity === 'warning'
                ? 'bg-amber-100 text-amber-700'
                : severity === 'ok'
                  ? 'bg-sky-100 text-sky-700'
                  : 'bg-gray-100 text-gray-600'
          }`}
        >
          {tank.status_label}
        </span>
      </div>
      {pct !== null ? (
        <>
          <div className="flex items-end justify-between mb-2">
            <span dir="ltr" className="text-2xl font-bold text-gray-900 tabular-nums">
              {pct.toFixed(0)}%
            </span>
            <span className="text-xs text-gray-500">{tank.source_label}</span>
          </div>
          <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${barColor}`}
              style={{ width: `${Math.max(0, Math.min(100, pct))}%` }}
            />
          </div>
          {tank.warning && <p className="text-[11px] text-gray-500 mt-3 leading-5">{tank.warning}</p>}
        </>
      ) : (
        <p className="text-xs text-gray-500 leading-5">{tank.warning || 'مستوى الخزان غير متاح حالياً.'}</p>
      )}
    </ControlCard>
  );
}

function StatItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-gray-500">{label}</span>
      <span dir="ltr" className="text-sm font-semibold text-gray-900">{value}</span>
    </div>
  );
}
