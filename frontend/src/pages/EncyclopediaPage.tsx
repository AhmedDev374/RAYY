import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import MarkdownContent from '../components/MarkdownContent';
import {
  Category,
  DEFAULT_CATEGORIES,
  METRIC_CONFIG,
  SpeciesProfile,
  getPlantImage,
  speciesMatchesQuery,
} from '../lib/encyclopedia';

export default function EncyclopediaPage() {
  const [query, setQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState('all');

  const { data: species = [], isLoading, isError, refetch } = useQuery({
    queryKey: ['encyclopedia'],
    queryFn: () => api<SpeciesProfile[]>('/api/v1/encyclopedia'),
  });

  const { data: categories = DEFAULT_CATEGORIES } = useQuery({
    queryKey: ['encyclopedia-categories'],
    queryFn: () => api<Category[]>('/api/v1/encyclopedia/categories'),
    staleTime: Infinity,
  });

  const filtered = useMemo(() => {
    return species
      .filter((s) => activeCategory === 'all' || s.category === activeCategory)
      .filter((s) => speciesMatchesQuery(s, query));
  }, [species, query, activeCategory]);

  return (
    <div dir="rtl" lang="ar" className="font-arabic space-y-8">
      <div className="text-center max-w-2xl mx-auto">
        <h1 className="text-3xl font-bold text-leaf-800 mb-3">موسوعة رَيّ</h1>
        <p className="text-gray-600 leading-relaxed">
          مرجعك الشامل لأهم النباتات الزينة والمنزلية والمحاصيل الزراعية — تعرّف على الظروف
          المثالية، دليل العناية، الآفات والأمراض الشائعة لكل نبات.
        </p>
      </div>

      {/* Search */}
      <div className="max-w-xl mx-auto">
        <div className="relative">
          <svg
            className="absolute top-1/2 -translate-y-1/2 right-4 w-5 h-5 text-gray-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35m0 0A7.5 7.5 0 104.35 4.35a7.5 7.5 0 0012.3 12.3z" />
          </svg>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="ابحث عن نبات... (بالعربية أو الإنجليزية أو الاسم العلمي)"
            className="w-full rounded-2xl border border-gray-200 bg-white py-3 pr-12 pl-4 text-sm text-gray-800 shadow-sm focus:outline-none focus:ring-2 focus:ring-leaf-400 focus:border-leaf-400 transition-shadow"
          />
        </div>
      </div>

      {/* Category filters */}
      <div className="flex flex-wrap justify-center gap-2">
        {categories.map((c) => (
          <button
            key={c.key}
            onClick={() => setActiveCategory(c.key)}
            className={`inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium transition-colors border ${
              activeCategory === c.key
                ? 'bg-leaf-600 text-white border-leaf-600 shadow-sm'
                : 'bg-white text-gray-600 border-gray-200 hover:border-leaf-300 hover:text-leaf-700'
            }`}
          >
            <span aria-hidden>{c.icon}</span>
            {c.label_ar}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="bg-white rounded-2xl shadow-sm animate-pulse">
              <div className="h-48 bg-gray-200 rounded-t-2xl" />
              <div className="p-5 space-y-3">
                <div className="h-5 bg-gray-200 rounded w-2/3" />
                <div className="h-4 bg-gray-100 rounded w-full" />
                <div className="h-4 bg-gray-100 rounded w-4/5" />
              </div>
            </div>
          ))}
        </div>
      ) : isError ? (
        <div className="text-center py-16 max-w-md mx-auto">
          <p className="text-3xl mb-3">⚠️</p>
          <p className="text-gray-700 font-medium mb-1">تعذّر تحميل الموسوعة</p>
          <p className="text-sm text-gray-500 mb-4">حدث خطأ أثناء الاتصال بالخادم. حاول مرة أخرى.</p>
          <button
            onClick={() => refetch()}
            className="rounded-xl bg-leaf-600 text-white px-5 py-2 text-sm font-medium hover:bg-leaf-700 transition-colors"
          >
            إعادة المحاولة
          </button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 max-w-md mx-auto">
          <p className="text-3xl mb-3">🔍</p>
          <p className="text-gray-700 font-medium">لم يتم العثور على نباتات مطابقة</p>
          <p className="text-sm text-gray-500 mt-1">جرّب كلمة بحث مختلفة أو اختر فئة أخرى.</p>
        </div>
      ) : (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {filtered.map((s) => (
            <Link
              key={s.species}
              to={`/encyclopedia/${encodeURIComponent(s.species)}`}
              className="group bg-white rounded-2xl shadow-sm hover:shadow-xl transition-all duration-300 overflow-hidden border border-gray-100 hover:border-leaf-200 hover:-translate-y-1"
            >
              <div className="relative h-48 overflow-hidden">
                <img
                  src={getPlantImage(s)}
                  alt={s.name_ar}
                  loading="lazy"
                  className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent" />
                <span className="absolute top-3 right-3 rounded-full bg-white/90 backdrop-blur-xs px-2.5 py-1 text-xs font-medium text-leaf-800">
                  {categories.find((c) => c.key === s.category)?.icon ?? '🌱'}{' '}
                  {categories.find((c) => c.key === s.category)?.label_ar ?? ''}
                </span>
                <div className="absolute bottom-3 right-4 left-4 text-white drop-shadow-lg">
                  <p className="font-bold text-lg leading-tight">{s.name_ar}</p>
                  <p className="text-xs text-white/85 italic">{s.scientific_name}</p>
                </div>
              </div>
              <div className="p-5">
                <p className="text-sm text-gray-600 line-clamp-2 leading-relaxed">{s.description_ar}</p>
                <span className="inline-flex items-center gap-1 mt-3 text-sm font-medium text-leaf-700 group-hover:text-leaf-600 transition-colors">
                  عرض التفاصيل
                  <svg className="w-4 h-4 group-hover:-translate-x-1 transition-transform rotate-180" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

export function EncyclopediaDetailPage({ species: speciesProp }: { species?: string }) {
  const params = useParams<{ species: string }>();
  const decodedSpecies = speciesProp || decodeURIComponent(params.species || '');

  const { data: profile, isLoading, isError } = useQuery({
    queryKey: ['encyclopedia', decodedSpecies],
    queryFn: () => api<SpeciesProfile>(`/api/v1/encyclopedia/${encodeURIComponent(decodedSpecies)}`),
    enabled: !!decodedSpecies,
  });

  if (isLoading) {
    return (
      <div dir="rtl" lang="ar" className="font-arabic max-w-4xl mx-auto animate-pulse space-y-6">
        <div className="h-6 bg-gray-200 rounded w-24" />
        <div className="h-64 bg-gray-200 rounded-2xl" />
        <div className="space-y-3">
          <div className="h-5 bg-gray-200 rounded w-1/3" />
          <div className="h-4 bg-gray-100 rounded w-full" />
          <div className="h-4 bg-gray-100 rounded w-4/5" />
        </div>
      </div>
    );
  }

  if (isError || !profile) {
    return (
      <div dir="rtl" lang="ar" className="font-arabic text-center py-16 max-w-md mx-auto">
        <p className="text-3xl mb-3">🌱</p>
        <p className="text-gray-700 font-medium mb-4">لم يتم العثور على هذا النبات في الموسوعة.</p>
        <Link to="/encyclopedia" className="text-leaf-700 font-medium hover:text-leaf-800">
          العودة إلى موسوعة رَيّ
        </Link>
      </div>
    );
  }

  const imageUrl = getPlantImage(profile);

  return (
    <div dir="rtl" lang="ar" className="font-arabic max-w-4xl mx-auto space-y-8">
      <Link
        to="/encyclopedia"
        className="inline-flex items-center gap-2 text-leaf-700 hover:text-leaf-800 font-medium transition-colors"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
        العودة إلى الموسوعة
      </Link>

      {/* Hero */}
      <div className="relative rounded-2xl overflow-hidden shadow-lg">
        <img src={imageUrl} alt={profile.name_ar} className="w-full h-64 md:h-80 object-cover" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
        <div className="absolute bottom-6 right-6 left-6">
          <h1 className="text-3xl md:text-4xl font-bold text-white drop-shadow-lg">
            🌿 {profile.name_ar}
          </h1>
          <p className="text-white/90 mt-1">
            {profile.name_en} · <span className="italic">{profile.scientific_name}</span>
          </p>
        </div>
      </div>

      {/* Identity strip */}
      <section className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 flex flex-wrap gap-6">
        <div>
          <p className="text-xs text-gray-400 mb-1">الفئة</p>
          <p className="font-semibold text-gray-800">{CATEGORY_LABELS[profile.category] ?? profile.category}</p>
        </div>
        <div>
          <p className="text-xs text-gray-400 mb-1">الفصيلة</p>
          <p className="font-semibold text-gray-800">{profile.family}</p>
        </div>
        <div className="mr-auto">
          <p className="text-xs text-gray-400 mb-1">🤖 توافق التشخيص بالذكاء الاصطناعي</p>
          <p className={`font-semibold ${profile.ai_support.supported ? 'text-leaf-700' : 'text-gray-400'}`}>
            {profile.ai_support.supported
              ? `مدعوم${profile.ai_support.model ? ` (${profile.ai_support.model})` : ''}`
              : 'غير متاح حاليًا'}
          </p>
        </div>
      </section>

      {/* Description */}
      {profile.description_ar && (
        <section className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 md:p-8">
          <h2 className="text-xl font-bold text-leaf-800 mb-3">الوصف</h2>
          <p className="text-sm text-gray-700 leading-relaxed">{profile.description_ar}</p>
        </section>
      )}

      {/* Ideal Conditions */}
      {profile.thresholds && Object.keys(profile.thresholds).length > 0 && (
        <section>
          <h2 className="text-xl font-bold text-leaf-800 mb-4">الظروف المثالية</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {Object.entries(profile.thresholds).map(([key, val]) => {
              const config = METRIC_CONFIG[key] || { label_ar: key, unit: '', color: 'from-gray-400 to-gray-500', icon: '📊' };
              return (
                <div key={key} className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
                  <div className="flex items-center gap-3 mb-4">
                    <span className="text-2xl">{config.icon}</span>
                    <h3 className="font-semibold text-gray-800">{config.label_ar}</h3>
                  </div>
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm text-gray-500">
                      <span>الأدنى: {val.min}{config.unit}</span>
                      <span className="font-semibold text-leaf-700">المثالي: {val.ideal}{config.unit}</span>
                      <span>الأقصى: {val.max}{config.unit}</span>
                    </div>
                    <div className="relative h-3 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className={`absolute inset-y-0 rounded-full bg-gradient-to-r ${config.color} opacity-30`}
                        style={{ left: '0%', right: '0%' }}
                      />
                      <div
                        className={`absolute inset-y-0 rounded-full bg-gradient-to-r ${config.color}`}
                        style={{
                          left: `${(val.min / (val.max * 1.2)) * 100}%`,
                          right: `${100 - (val.max / (val.max * 1.2)) * 100}%`,
                        }}
                      />
                      <div
                        className="absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-white border-2 border-leaf-600 rounded-full shadow"
                        style={{ left: `${(val.ideal / (val.max * 1.2)) * 100}%` }}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Care Guide: watering + fertilization */}
      {(profile.watering_ar || profile.fertilization_ar) && (
        <section className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 md:p-8 space-y-6">
          <h2 className="text-xl font-bold text-leaf-800 flex items-center gap-2">
            <span>📖</span> دليل العناية
          </h2>
          {profile.watering_ar && (
            <div>
              <h3 className="font-semibold text-gray-800 mb-2 flex items-center gap-2">💧 الري</h3>
              <MarkdownContent content={profile.watering_ar} />
            </div>
          )}
          {profile.fertilization_ar && (
            <div>
              <h3 className="font-semibold text-gray-800 mb-2 flex items-center gap-2">🌱 التسميد</h3>
              <MarkdownContent content={profile.fertilization_ar} />
            </div>
          )}
        </section>
      )}

      {/* Greenhouse guidance */}
      {profile.greenhouse_guidance_ar && (
        <section className="bg-gradient-to-br from-leaf-50 to-emerald-50 rounded-2xl p-6 md:p-8 border border-leaf-100">
          <h2 className="text-xl font-bold text-leaf-800 mb-3 flex items-center gap-2">
            <span>🏡</span> إرشادات الصوبة الزراعية
          </h2>
          <p className="text-xs text-leaf-700/70 mb-3">
            قيم مرجعية إرشادية وليست قراءات حية من المستشعرات.
          </p>
          <MarkdownContent content={profile.greenhouse_guidance_ar} />
        </section>
      )}

      {/* Seasonal Tips */}
      {profile.seasonal_tips && (
        <section className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 md:p-8">
          <h2 className="text-xl font-bold text-leaf-800 mb-3 flex items-center gap-2">
            <span>🌦</span> النصائح الموسمية
          </h2>
          <MarkdownContent content={profile.seasonal_tips} />
        </section>
      )}

      {/* Common Diseases */}
      {profile.common_diseases && Object.keys(profile.common_diseases).length > 0 && (
        <section>
          <h2 className="text-xl font-bold text-leaf-800 mb-4 flex items-center gap-2">
            <span>🦠</span> الأمراض الشائعة
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {Object.entries(profile.common_diseases).map(([name, description]) => (
              <div key={name} className="bg-white rounded-2xl shadow-sm border border-red-100 p-5">
                <h3 className="font-semibold text-red-700 mb-2">{name}</h3>
                <p className="text-sm text-gray-600 leading-relaxed">{description}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Common Pests */}
      {profile.common_pests && Object.keys(profile.common_pests).length > 0 && (
        <section>
          <h2 className="text-xl font-bold text-leaf-800 mb-4 flex items-center gap-2">
            <span>🐛</span> الآفات الشائعة
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {Object.entries(profile.common_pests).map(([name, description]) => (
              <div key={name} className="bg-white rounded-2xl shadow-sm border border-amber-100 p-5">
                <h3 className="font-semibold text-amber-700 mb-2">{name}</h3>
                <p className="text-sm text-gray-600 leading-relaxed">{description}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Nutrient Deficiencies */}
      {profile.nutrient_deficiencies && Object.keys(profile.nutrient_deficiencies).length > 0 && (
        <section>
          <h2 className="text-xl font-bold text-leaf-800 mb-4 flex items-center gap-2">
            <span>🧪</span> نقص العناصر الغذائية
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {Object.entries(profile.nutrient_deficiencies).map(([name, description]) => (
              <div key={name} className="bg-white rounded-2xl shadow-sm border border-blue-100 p-5">
                <h3 className="font-semibold text-blue-700 mb-2">{name}</h3>
                <p className="text-sm text-gray-600 leading-relaxed">{description}</p>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

const CATEGORY_LABELS: Record<string, string> = {
  ornamental: '🌸 نباتات الزينة',
  houseplant: '🪴 النباتات المنزلية',
  aromatic_medicinal: '🌿 النباتات العطرية والطبية',
  vegetable: '🥬 الخضروات',
  fruit: '🍎 الفواكه',
  crop: '🌾 المحاصيل الزراعية',
};
