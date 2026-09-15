// Shared types + utilities for the Arabic Plant Encyclopedia (موسوعة رَيّ).
// Kept in one place so the list page, the detail page, and any future
// Encyclopedia component all reuse the same image map / category metadata
// instead of duplicating it.

export interface Threshold {
  min: number;
  max: number;
  ideal: number;
}

export interface AiSupport {
  supported: boolean;
  model: string | null;
}

export interface SpeciesProfile {
  id: number;
  species: string; // stable English key, e.g. "Tomato"

  name_ar: string;
  name_en: string;
  scientific_name: string;
  family: string;
  category: CategoryKey;
  aliases?: string[] | null;
  image_url?: string | null;

  description_ar: string;
  watering_ar: string;
  fertilization_ar: string;
  greenhouse_guidance_ar: string;
  common_pests?: Record<string, string> | null;
  nutrient_deficiencies?: Record<string, string> | null;
  ai_support: AiSupport;

  // Preserved from the original architecture
  thresholds: Record<string, Threshold>;
  care_guide: string;
  seasonal_tips: string;
  common_diseases?: Record<string, string> | null;
}

export type CategoryKey =
  | 'all'
  | 'ornamental'
  | 'houseplant'
  | 'aromatic_medicinal'
  | 'vegetable'
  | 'fruit'
  | 'crop';

export interface Category {
  key: CategoryKey;
  label_ar: string;
  icon: string;
}

// Fallback categories (also served by GET /api/v1/encyclopedia/categories).
// Kept here too so the filter bar can render instantly before that request
// resolves, and as a safety net if the endpoint is unreachable.
export const DEFAULT_CATEGORIES: Category[] = [
  { key: 'all', label_ar: 'الكل', icon: '🌍' },
  { key: 'ornamental', label_ar: 'نباتات الزينة', icon: '🌸' },
  { key: 'houseplant', label_ar: 'النباتات المنزلية', icon: '🪴' },
  { key: 'aromatic_medicinal', label_ar: 'النباتات العطرية والطبية', icon: '🌿' },
  { key: 'vegetable', label_ar: 'الخضروات', icon: '🥬' },
  { key: 'fruit', label_ar: 'الفواكه', icon: '🍎' },
  { key: 'crop', label_ar: 'المحاصيل الزراعية', icon: '🌾' },
];

// Reusable plant image mapping — single source of truth (do not duplicate
// this map in other components). The original six point at the existing local
// assets in frontend/public/plants/. The 14 newly added agricultural species
// also use local assets downloaded at build time, so the Encyclopedia never
// depends on a live third-party CDN to render a card.
export const PLANT_IMAGES: Record<string, string> = {
  Rose: '/plants/rose.png',
  Hibiscus: '/plants/hibiscus.png',
  'Aloe Vera': '/plants/aloe-vera.png',
  'Money Plant': '/plants/money-plant.png',
  Chrysanthemum: '/plants/chrysanthemum.png',
  Turmeric: '/plants/turmeric.png',

  Apple: '/plants/apple.png',
  Blueberry: '/plants/blueberry.png',
  Cherry: '/plants/cherry.png',
  Corn: '/plants/corn.png',
  Grape: '/plants/grape.png',
  Orange: '/plants/orange.png',
  Peach: '/plants/peach.png',
  'Bell Pepper': '/plants/bell-pepper.png',
  Potato: '/plants/potato.png',
  Raspberry: '/plants/raspberry.png',
  Soybean: '/plants/soybean.png',
  Squash: '/plants/squash.png',
  Strawberry: '/plants/strawberry.png',
  Tomato: '/plants/tomato.png',
};

const FALLBACK_IMAGE = 'https://images.unsplash.com/photo-1416879595882-3373a0480b5b?w=600';

export function getPlantImage(profile: Pick<SpeciesProfile, 'species' | 'image_url'>): string {
  return profile.image_url || PLANT_IMAGES[profile.species] || FALLBACK_IMAGE;
}

// Simple Arabic-aware normalization so searches like "طماطم" / "Tomato" /
// "Solanum lycopersicum" all match regardless of Arabic diacritics or case.
export function normalizeSearchText(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u064B-\u065F\u0670]/g, '') // Arabic diacritics (tashkeel)
    .replace(/[إأآا]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .trim();
}

export function speciesMatchesQuery(profile: SpeciesProfile, query: string): boolean {
  const needle = normalizeSearchText(query);
  if (!needle) return true;
  const haystacks = [
    profile.species,
    profile.name_ar,
    profile.name_en,
    profile.scientific_name,
    profile.family,
    ...(profile.aliases || []),
  ];
  return haystacks.some((h) => h && normalizeSearchText(h).includes(needle));
}

export const METRIC_CONFIG: Record<string, { label_ar: string; unit: string; color: string; icon: string }> = {
  temperature: { label_ar: 'درجة الحرارة', unit: '°م', color: 'from-orange-400 to-red-500', icon: '🌡️' },
  humidity: { label_ar: 'الرطوبة', unit: '%', color: 'from-blue-400 to-cyan-500', icon: '💨' },
  soil_moisture: { label_ar: 'رطوبة التربة', unit: '%', color: 'from-amber-500 to-yellow-600', icon: '💧' },
  light: { label_ar: 'الإضاءة', unit: 'lux', color: 'from-yellow-300 to-orange-400', icon: '☀️' },
};
