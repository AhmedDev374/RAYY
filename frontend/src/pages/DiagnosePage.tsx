import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { api, ApiError, getAccessToken, handleUnauthorizedResponse } from '../lib/api';
import {
  toArabicClass,
  toArabicPlant,
  isNonLeafClass,
  isHealthyClass,
  UI_AR,
} from '../lib/arabicLabels';

interface Plant {
  id: number;
  nickname: string;
  species: string;
}

interface DiagnosisResult {
  status: string;
  message?: string;
  plant?: string;
  disease?: string;
  confidence?: number;
  class_name?: string;
  unmapped?: boolean;
  treatment?: {
    name: string;
    symptoms: string;
    home_remedies: string[];
    prevention: string;
  };
  image_url?: string;
}

interface HistoryItem {
  id: number;
  image_url: string;
  disease: string;
  plant_species?: string | null;
  class_name?: string | null;
  confidence: number;
  created_at: string;
}

function confidenceColor(conf: number) {
  if (conf >= 80) return { bg: 'bg-green-500', text: 'text-green-700', label: 'ثقة عالية' };
  if (conf >= 60) return { bg: 'bg-yellow-500', text: 'text-yellow-700', label: 'ثقة متوسطة' };
  return { bg: 'bg-red-500', text: 'text-red-700', label: 'ثقة منخفضة' };
}

// The model falls back to generic labels like "Class_45" whenever a predicted
// class index has no verified entry in the plant/disease knowledge base. We
// must never dress a generic label up as a real diagnosis — detect it and
// render an honest "unmapped class" state instead.
function isUnmappedLabel(value?: string | null): boolean {
  if (!value) return true;
  return /^class[\s_-]?\d+$/i.test(value.trim());
}

function isHealthy(disease?: string | null): boolean {
  return !!disease && disease.trim().toLowerCase() === 'healthy';
}

// Breaks a curated symptoms sentence (from the treatment knowledge base) into
// short scannable bullets. Purely a presentation transform of real backend
// text -- never invents content.
function toBullets(text?: string | null): string[] {
  if (!text) return [];
  return text
    .split(/(?<=[.;])\s+(?=[A-Z])/)
    .map((s) => s.trim().replace(/[.;]+$/, ''))
    .filter(Boolean);
}

function confidenceRingColor(conf: number) {
  if (conf >= 80) return '#16a34a';
  if (conf >= 60) return '#ca8a04';
  return '#dc2626';
}

function ConfidenceRing({ value, size = 84 }: { value: number; size?: number }) {
  const pct = Math.min(Math.max(value, 0), 100);
  const color = confidenceRingColor(pct);
  return (
    <div
      className="relative flex-shrink-0 rounded-full"
      style={{
        width: size,
        height: size,
        background: `conic-gradient(${color} 0 ${pct}%, #f1f5f9 ${pct}% 100%)`,
        padding: 6,
      }}
      aria-label={`درجة الثقة ${pct.toFixed(0)}%`}
    >
      <div className="w-full h-full rounded-full bg-white flex flex-col items-center justify-center">
        <span className="text-base font-bold text-gray-900 leading-none">{pct.toFixed(0)}%</span>
        <span className="text-[10px] text-gray-400 mt-0.5">درجة الثقة</span>
      </div>
    </div>
  );
}

// Small fallback shown in place of a broken <img>. Never lets the browser's
// raw broken-image icon (or the alt text alone) reach the user.
function ImageUnavailable({ className = '' }: { className?: string }) {
  return (
    <div className={`flex flex-col items-center justify-center gap-1.5 bg-gray-50 text-gray-300 ${className}`}>
      <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.5}
          d="M3 16.5l5.25-5.25a2.25 2.25 0 013 0L15 15m-1.5-1.5l1.406-1.406a2.25 2.25 0 013 0L21 15m-18 3.75h18M3.75 6h16.5a.75.75 0 01.75.75v10.5a.75.75 0 01-.75.75H3.75a.75.75 0 01-.75-.75V6.75A.75.75 0 013.75 6z"
        />
      </svg>
      <span className="text-[11px] font-medium text-gray-400">الصورة غير متاحة</span>
    </div>
  );
}

export default function DiagnosePage() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [plantId, setPlantId] = useState<number | ''>('');
  const [result, setResult] = useState<DiagnosisResult | null>(null);
  const [shareLocation, setShareLocation] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const queryClient = useQueryClient();

  const { data: plants = [] } = useQuery({
    queryKey: ['plants'],
    queryFn: () => api<Plant[]>('/api/v1/plants'),
  });

  const handleFile = (f: File) => {
    setFile(f);
    setResult(null);
    const reader = new FileReader();
    reader.onload = (e) => setPreview(e.target?.result as string);
    reader.readAsDataURL(f);
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    const f = e.dataTransfer.files[0];
    if (f && f.type.startsWith('image/')) handleFile(f);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(true);
  }, []);

  const handleDragLeave = useCallback(() => setDragActive(false), []);

  const diagnose = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error('يرجى اختيار صورة أولًا.');
      const form = new FormData();
      form.append('file', file);
      if (plantId) form.append('plant_id', String(plantId));
      const token = await getAccessToken();

      let res: Response;
      try {
        res = await fetch(`${import.meta.env.VITE_API_URL || ''}/api/v1/diagnose`, {
          method: 'POST',
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          body: form,
        });
      } catch {
        throw new Error('خطأ في الشبكة — تحقق من اتصالك وحاول مرة أخرى.');
      }

      if (res.status === 401) {
        let message = 'انتهت صلاحية الجلسة — يرجى تسجيل الدخول مرة أخرى.';
        try {
          const body = await res.json();
          message = body?.detail?.message || body?.detail || message;
        } catch {
          // ignore unparsable body
        }
        console.warn('[diagnose] 401', message);
        await handleUnauthorizedResponse(message);
        throw new ApiError(message, 401);
      }

      if (!res.ok) {
        // Backend returns { detail: { status, code, message } } for known failure
        // modes (bad MIME type, oversized file, undecodable image, model failure, etc).
        let message = `فشل التشخيص (${res.status}). يرجى المحاولة مرة أخرى.`;
        try {
          const body = await res.json();
          message = body?.detail?.message || body?.detail || message;
        } catch {
          // Response wasn't JSON (e.g. a proxy error page) — fall back to the default above.
        }
        throw new ApiError(message, res.status);
      }

      try {
        return (await res.json()) as DiagnosisResult;
      } catch {
        throw new Error('تم استلام رد غير قابل للقراءة من الخادم. يرجى المحاولة مرة أخرى.');
      }
    },
    onSuccess: async (data) => {
      setResult(data);
      if (shareLocation && data.disease) {
        navigator.geolocation.getCurrentPosition(async (pos) => {
          await api('/api/v1/disease-reports', {
            method: 'POST',
            body: JSON.stringify({
              disease: data.disease,
              species: data.plant,
              latitude: pos.coords.latitude,
              longitude: pos.coords.longitude,
            }),
          });
        });
      }
    },
  });

  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [deleteErrorId, setDeleteErrorId] = useState<number | null>(null);
  const [deleteErrorMessage, setDeleteErrorMessage] = useState<string | null>(null);

  const deleteDiagnosis = useMutation({
    mutationFn: async (id: number) => {
      await api(`/api/v1/diagnose/history/${id}`, { method: 'DELETE' });
      return id;
    },
    onMutate: (id) => {
      setDeletingId(id);
      setDeleteErrorId(null);
      setDeleteErrorMessage(null);
    },
    onSuccess: (id) => {
      setDeletingId(null);
      queryClient.invalidateQueries({ queryKey: ['diagnosis-history'] });
    },
    onError: (err, id) => {
      setDeletingId(null);
      setDeleteErrorId(id);
      const message =
        err && typeof err === 'object' && 'message' in err
          ? String((err as Error).message)
          : 'تعذّر حذف هذا التشخيص.';
      setDeleteErrorMessage(message);
      console.error('[diagnose] delete failed', err);
    },
  });

  const { data: history = [] } = useQuery({
    queryKey: ['diagnosis-history', plantId],
    queryFn: () =>
      api<HistoryItem[]>(
        plantId ? `/api/v1/diagnose/plants/${plantId}/diagnoses` : '/api/v1/diagnose/history',
      ),
  });

  return (
    <div dir="rtl" lang="ar" className="font-arabic space-y-8">
      {/* Header */}
      <div className="text-right">
        <h1 className="text-2xl font-bold text-gray-900">🌿 اكتشاف أمراض النباتات</h1>
        <p className="text-gray-500 text-sm mt-1">ارفع صورة لورقة نبات لتحديد الأمراض والحصول على توصيات العلاج.</p>
      </div>

      {/* Upload Section */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
        <div className="flex flex-wrap items-center gap-4 mb-5">
          <div className="flex-1 min-w-[200px]">
            <label className="block text-sm font-medium text-gray-700 mb-1.5">النبتة (اختياري)</label>
            <select
              className="w-full max-w-xs bg-white border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500"
              value={plantId}
              onChange={(e) => setPlantId(e.target.value ? Number(e.target.value) : '')}
            >
              <option value="">اكتشاف تلقائي من الصورة</option>
              {plants.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nickname} ({p.species})
                </option>
              ))}
            </select>
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={shareLocation}
              onChange={(e) => setShareLocation(e.target.checked)}
              className="w-4 h-4 text-green-600 rounded border-gray-300 focus:ring-green-500"
            />
            شارك بشكل مجهول على خريطة الأمراض
          </label>
        </div>

        {/* Drop zone */}
        <div
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          className={`relative border-2 border-dashed rounded-2xl p-8 text-center transition-all cursor-pointer ${
            dragActive
              ? 'border-green-500 bg-green-50'
              : file
              ? 'border-green-300 bg-green-50/30'
              : 'border-gray-200 hover:border-green-400 hover:bg-green-50/30'
          }`}
          onClick={() => document.getElementById('file-input')?.click()}
        >
          <input
            id="file-input"
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
            }}
          />
          {!file ? (
            <div className="space-y-3">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto">
                <svg className="w-8 h-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                </svg>
              </div>
              <div>
                <p className="text-gray-700 font-medium">اسحب صورة الورقة إلى هنا</p>
                <p className="text-gray-400 text-sm mt-1">أو انقر لتصفح الملفات • JPG وPNG حتى 10 ميجابايت</p>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-3 justify-center">
              <svg className="w-5 h-5 text-green-600 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <div className="text-right">
                <p className="text-sm font-medium text-gray-700">{file.name}</p>
                <p className="text-xs text-gray-400">{(file.size / 1024).toFixed(1)} KB</p>
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setFile(null);
                  setPreview(null);
                  setResult(null);
                }}
                className="mr-2 text-gray-400 hover:text-red-500 transition-colors"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          )}
        </div>

        {/* Analyze button */}
        <div className="mt-5 flex items-center gap-4">
          <button
            disabled={!file || diagnose.isPending}
            onClick={() => diagnose.mutate()}
            className="inline-flex items-center gap-2 bg-green-600 hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium px-6 py-3 rounded-xl transition-all shadow-lg shadow-green-600/20"
          >
            {diagnose.isPending ? (
              <>
                <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                جارٍ التحليل...
              </>
            ) : (
              <>
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                تحليل الصورة
              </>
            )}
          </button>
         {diagnose.isError && (
  <p className="text-sm text-red-600 whitespace-pre-wrap">
    {diagnose.error instanceof Error
      ? diagnose.error.message
      : 'فشل التشخيص'}
  </p>
)}
        </div>
      </div>

      {/* Results */}
      {result && result.status !== 'error' && (() => {
        const unmapped = result.unmapped || (isUnmappedLabel(result.disease) && isUnmappedLabel(result.plant));
        const healthy = !unmapped && isHealthy(result.disease);
        const lowConfidence = result.status === 'low_confidence';
        const confidence = result.confidence ?? 0;
        const symptomBullets = toBullets(result.treatment?.symptoms);

        return (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Image preview */}
            {preview && (
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 h-fit">
                <img
                  src={preview}
                  alt="Uploaded leaf"
                  className="w-full h-80 object-contain rounded-xl bg-gray-50"
                />
              </div>
            )}

            {/* Professional diagnosis report (Arabic / RTL) */}
            <div
              dir="rtl"
              lang="ar"
              className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden"
            >
              <div className="p-6 space-y-5">
                {/* Report header */}
                <div className="flex items-center gap-2 pb-4 border-b border-gray-100">
                  <span className="text-xl">🌿</span>
                  <h2 className="text-base font-bold text-gray-900">
                    تقرير تشخيص النبات
                  </h2>
                </div>

                {/* Plant identification + confidence ring */}
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide">
                      النبات المشخّص
                    </p>
                    {unmapped ? (
                      <p className="text-lg font-bold text-gray-900 mt-1">
                        تعذر تحديد نوع النبات أو المرض بدقة
                      </p>
                    ) : (
                      <p className="text-lg font-bold text-gray-900 mt-1 truncate">
                        {toArabicPlant(result.class_name) || toArabicClass(result.class_name)}
                      </p>
                    )}
                  </div>
                  <ConfidenceRing value={confidence} />
                </div>

                {/* Status banner */}
{lowConfidence ? (
                  <div className="rounded-xl px-4 py-3 bg-amber-50 border border-amber-100 text-amber-800 text-sm font-medium flex items-start gap-2">
                    <span>⚠️</span>
                    <span>{result.message || 'الصورة غير واضحة بما يكفي لتشخيص دقيق.'}</span>
                  </div>
) : unmapped ? (
<div className="rounded-xl px-4 py-3 bg-amber-50 border border-amber-100 text-amber-800 text-sm font-medium flex items-start gap-2">
                    <span>⚠️</span>
                    <span>تم التعرف على فئة نباتية، ولكن لم يتم العثور على name تش diagnosis موثوق لهذا الفئة.</span>
                  </div>
                ) : isNonLeafClass(result.class_name) ? (
                  <div className="rounded-xl px-4 py-3 bg-amber-50 border border-amber-100 text-amber-800 text-sm font-medium flex items-start gap-2">
                    <span>⚠️</span>
                    <span>الصورة لا تحتوي على ورقة نبات واضحة</span>
                  </div>
                ) : healthy ? (
                  <div className="rounded-xl px-4 py-3 bg-green-50 border border-green-100 text-green-800 text-sm font-medium flex items-center gap-2">
                    <span>🟢</span>
                    <span>النبات سليم</span>
                  </div>
                ) : (
                  <div className="rounded-xl px-4 py-3 bg-red-50 border border-red-100 text-red-800 text-sm font-medium flex items-center gap-2">
                    <span>🔴</span>
                    <span>توجد علامات مرضية</span>
                  </div>
                )}

                {/* Diagnosis (only when mapped + not healthy) */}
{!unmapped && !healthy && (
                  <div>
                    <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide">
                      {UI_AR.closestDiagnosis}
                    </p>
                    <p className="text-base font-bold text-gray-900 mt-1">
                      🦠 {toArabicClass(result.class_name) || result.treatment?.name || result.disease}
                    </p>
                  </div>
                )}

                {/* Unmapped model label - never show a raw Class_N identifier */}
                {unmapped && (
                  <div className="rounded-xl px-4 py-3 bg-amber-50 border border-amber-100 text-amber-800 text-sm font-medium flex items-start gap-2">
                    <span>⚠️</span>
                    <span>تعذر تحديد التشخيص بدقة</span>
                  </div>
                )}

                {/* What the system detected */}
                {!unmapped && symptomBullets.length > 0 && (
                  <div>
                    <p className="text-sm font-semibold text-gray-700 mb-2">
                      🔎 ماذا لاحظ النظام؟
                    </p>
                    <ul className="space-y-1.5">
                      {symptomBullets.map((s, i) => (
                        <li key={i} className="flex items-start gap-2 text-sm text-gray-600">
                          <span className="text-green-500 mt-1">•</span>
                          <span className="leading-relaxed">{s}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Recommended actions */}
                {!unmapped && result.treatment?.home_remedies && result.treatment.home_remedies.length > 0 && (
                  <div className="bg-green-50 rounded-xl p-4 border border-green-100">
                    <p className="text-sm font-semibold text-green-800 mb-2.5">
                      💊 ماذا تفعل الآن؟
                    </p>
                    <ol className="space-y-2">
                      {result.treatment.home_remedies.map((remedy, i) => (
                        <li key={i} className="flex gap-2 text-sm text-green-700">
                          <span className="flex-shrink-0 w-5 h-5 bg-green-200 rounded-full flex items-center justify-center text-xs font-bold text-green-800">
                            {i + 1}
                          </span>
                          <span className="leading-relaxed">{remedy}</span>
                        </li>
                      ))}
                    </ol>
                  </div>
                )}

                {/* Prevention */}
                {!unmapped && result.treatment?.prevention && (
                  <div className="bg-blue-50 rounded-xl p-4 border border-blue-100">
                    <p className="text-sm font-semibold text-blue-800 mb-1.5">🛡️ الوقاية</p>
                    <p className="text-sm text-blue-700 leading-relaxed">
                      {result.treatment.prevention}
                    </p>
                  </div>
                )}

                {/* Disclaimer */}
                <p className="text-[11px] text-gray-400 leading-relaxed pt-3 border-t border-gray-100">
                  ⚠️ هذا التشخيص مبني على تحليل الصورة بواسطة الذكاء الاصطناعي، ولا يُعد بديلاً عن الفحص الزراعي المتخصص.
                </p>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Diagnosis History */}
      {history.length > 0 && (
        <div>
          <div className="mb-4">
            <h3 className="text-lg font-bold text-gray-900">سجل التشخيص</h3>
            <p className="text-sm text-gray-400 mt-0.5">نتائج تحليلات النباتات السابقة</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            {history.map((h) => (
              <HistoryCard
                key={h.id}
                item={h}
                onDelete={deleteDiagnosis.mutate}
                isDeleting={deletingId === h.id}
                deleteError={deletingId === h.id ? deleteErrorMessage : null}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function HistoryCard({
  item,
  onDelete,
  isDeleting,
  deleteError,
}: {
  item: HistoryItem;
  onDelete: (id: number) => void;
  isDeleting: boolean;
  deleteError: string | null;
}) {
  const [imgFailed, setImgFailed] = useState(false);
  const hConf = confidenceColor(item.confidence);
  const unmapped = isUnmappedLabel(item.disease) && isUnmappedLabel(item.plant_species);
  const label = unmapped ? UI_AR.unableToIdentifyDiagnosis : toArabicClass(item.class_name || item.disease);
  const src = item.image_url
    ? `${import.meta.env.VITE_API_URL || ''}${item.image_url}`
    : null;

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isDeleting) return;
    onDelete(item.id);
  };

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden hover:shadow-md transition-shadow relative">
      {/* Card */}
      <div dir="rtl" className="w-full h-44 bg-gray-50 rounded-t-2xl overflow-hidden">
        {src && !imgFailed ? (
          <img
            src={src}
            alt={label || 'صورة تشخيص النبات'}
            className="w-full h-full object-cover"
            onError={() => setImgFailed(true)}
          />
        ) : (
          <ImageUnavailable className="w-full h-full" />
        )}

        {/* Direct-delete trash icon — top-right of the card image */}
        <button
          type="button"
          onClick={handleDelete}
          disabled={isDeleting}
          aria-label="حذف هذا التشخيص"
          title="حذف هذا التشخيص"
          className={`absolute top-2 left-2 w-8 h-8 rounded-full text-white flex items-center justify-center transition-colors disabled:opacity-50 disabled:cursor-not-allowed backdrop-blur-sm ${
            deleteError ? 'bg-red-600 hover:bg-red-700' : 'bg-black/40 hover:bg-red-600'
          }`}
        >
          {isDeleting ? (
            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          ) : (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}>
              <path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3M5 7h14" />
            </svg>
          )}
        </button>
      </div>

      {/* Info area */}
      <div className="p-4">
        <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide">
          {UI_AR.diagnosisLabel}
        </p>
        <p className="font-semibold text-sm text-gray-900 truncate mt-0.5">
          {label || 'غير معروف'}
        </p>

        <div className="flex items-center justify-between mt-3 mb-1.5">
          <span className="text-xs font-medium text-gray-500">{UI_AR.confidence}</span>
          <span className={`text-xs font-semibold ${hConf.text}`}>
            {item.confidence?.toFixed(1)}%
          </span>
        </div>
        <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full ${hConf.bg}`}
            style={{ width: `${Math.min(Math.max(item.confidence, 0), 100)}%` }}
          />
        </div>

        <div className="flex flex-row-reverse items-center justify-end gap-1.5 mt-3 text-xs text-gray-400">
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
            />
          </svg>
          {new Date(item.created_at).toLocaleDateString(undefined, {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
          })}
        </div>

        {deleteError && (
          <p className="mt-2 text-[11px] text-red-600 leading-snug">
            {deleteError}
          </p>
        )}
      </div>
    </div>
  );
}
