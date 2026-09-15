/**
 * Arabic localization layer for AgroScan plant-disease class names.
 *
 * The model keeps returning the original English class identifiers internally
 * (e.g. ``Grape___Leaf_blight_(Isariopsis_Leaf_Spot)``). This module is the
 * ONLY place those raw strings are translated into Arabic for display. The
 * original English class name remains available on every returned object via
 * the ``class_name`` field so it can still be logged/debugged.
 */

// ---------------------------------------------------------------------------
// Plant name translations (the segment before the first "___").
// ---------------------------------------------------------------------------
const PLANT_AR: Record<string, string> = {
  Apple: "تفاح",
  Blueberry: "توت أزرق",
  "Cherry_(including_sour)": "كرز",
  "Corn_(maize)": "ذرة",
  Grape: "عنب",
  Orange: "برتقال",
  Peach: "خوخ",
  "Pepper,_bell": "فلفل",
  Potato: "بطاطس",
  Raspberry: "توت-العليق",
  Soybean: "فول صويا",
  Squash: "قرع",
  Strawberry: "فراولة",
  Tomato: "طماطم",
};

// ---------------------------------------------------------------------------
// Full-class translations keyed by the exact AgroScan class string.
// ---------------------------------------------------------------------------
const CLASS_AR: Record<string, string> = {
  "Apple___Apple_scab": "جرب التفاح",
  "Apple___Black_rot": "الفن الأسود في التفاح",
  "Apple___Cedar_apple_rust": "صدأ التفاح",
  "Apple___healthy": "ورقة تفاح سليمة",

  "Blueberry___healthy": "ورقة توت أزرق سليمة",

  "Cherry_(including_sour)___Powdery_mildew": "البياض الدقيق في الكرز",
  "Cherry_(including_sour)___healthy": "ورقة كرز سليمة",

  "Corn_(maize)___Cercospora_leaf_spot_Gray_leaf_spot": "تبقع الأوراق الرمادي في الذرة",
  "Corn_(maize)___Common_rust": "الصدأ الشائع في الذرة",
  "Corn_(maize)___Northern_Leaf_Blight": "لفحة الأوراق الشمالية في الذرة",
  "Corn_(maize)___healthy": "ورقة ذرة سليمة",

  "Grape___Black_rot": "الفن الأسود في العنب",
  "Grape___Esca_(Black_Measles)": "إيسكا (الحصبة السوداء) في العنب",
  "Grape___Leaf_blight_(Isariopsis_Leaf_Spot)": "لفحة الأوراق (تبقع الأوراق الإيزاريوبسيسي) في العنب",
  "Grape___healthy": "ورقة عنب سليمة",

  "Orange___Haunglongbing_(Citrus_greening)": "أخضرار الحمضيات",
  "Orange___healthy": "ورقة برتقال سليمة",

  "Peach___Bacterial_spot": "التبقع البكتيري في الخوخ",
  "Peach___healthy": "ورقة خوخ سليمة",

  "Pepper,_bell___Bacterial_spot": "التبقع البكتيري في الفلفل",
  "Pepper,_bell___healthy": "ورقة فلفل سليمة",

  "Potato___Early_blight": "اللفحة المبكرة في البطاطس",
  "Potato___Late_blight": "اللفحة المتأخرة في البطاطس",
  "Potato___healthy": "ورقة بطاطس سليمة",

  "Raspberry___healthy": "ورقة توت-totalyq سليمة",

  "Soybean___healthy": "ورقة فول صويا سليمة",

  "Squash___Powdery_mildew": "البياض الدقيق في القرع",
  "Squash___healthy": "ورقة قرع سليمة",

  "Strawberry___Leaf_scorch": "لفحة أوراق الفراولة",
  "Strawberry___healthy": "ورقة فراولة سليمة",

  "Tomato___Bacterial_spot": "التبقع البكتيري في الطماطم",
  "Tomato___Early_blight": "اللفحة المبكرة في الطماطم",
  "Tomato___Late_blight": "اللفحة المتأخرة في الطماطم",
  "Tomato___Leaf_Mold": "عفن الأوراق في الطماطم",
  "Tomato___Septoria_leaf_spot": "تبقع أوراق السيبتوريا في الطماطم",
  "Tomato___Spider_mites_Two_spotted_spider_mite": "العنكبوت الأحمر ذو البقعتين في الطماطم",
  "Tomato___Target_Spot": "التبقع الهدف في الطماطم",
  "Tomato___Tomato_Yellow_Leaf_Curl_Virus": "فيروس تجعد الأوراق الأصفر في الطماطم",
  "Tomato___Tomato_mosaic_virus": "فيروس موزاييك الطماطم",
  "Tomato___healthy": "ورقة طماطم سليمة",

  "Non_leaf_or_unknown": "صورة غير مناسبة (ليست ورقة نباتية واضحة)",
};

// ---------------------------------------------------------------------------
// UI label translations.
// ---------------------------------------------------------------------------
export const UI_AR = {
  plantDiagnosed: "النبات المشخّص",
  confidence: "درجة الثقة",
  closestDiagnosis: "التشخيص الأقرب",
  diagnosisHistory: "سجل التش诊断ات",
  healthy: "سليم",
  diseaseDetected: "توجد علامات مرضية",
  healthyPlant: "النبات سليم",
  unableToIdentifyPlant: "تعذر تحديد نوع النبات أو المرض بدقة",
  unableToIdentifyDiagnosis: "تعذر تحديد التش diagnosis بدقة",
  analysisFailed: "فشل تحليل الصورة",
  nonLeafImage: "الصورة لا تحتوي على ورقة نبات واضحة",
  unknown: "غير معروف",
  diagnosisLabel: "Diagnosis / Class",
  confidenceLabel: "Confidence",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function splitClass(class_name?: string | null): { plant: string; disease: string } {
  if (!class_name) return { plant: "", disease: "" };
  const idx = class_name.indexOf("___");
  if (idx === -1) return { plant: class_name, disease: "" };
  return {
    plant: class_name.slice(0, idx),
    disease: class_name.slice(idx + 3),
  };
}

function translatePlant(plant: string): string {
  if (!plant) return "";
  return PLANT_AR[plant] || plant;
}

/**
 * Translate a raw AgroScan class name into Arabic.
 *
 * Priority:
 * 1. Exact full-class match in CLASS_AR.
 * 2. Split into plant + disease and translate the plant segment.
 * 3. Fallback to raw English string (never hidden, never faked).
 */
export function toArabicClass(class_name?: string | null): string {
  if (!class_name) return "";
  if (CLASS_AR[class_name]) return CLASS_AR[class_name];
  const { plant, disease } = splitClass(class_name);
  if (plant && PLANT_AR[plant]) {
    return disease ? `${disease} في ${PLANT_AR[plant]}` : PLANT_AR[plant];
  }
  return class_name;
}

/** Returns the Arabic plant name for a raw AgroScan class, or the raw plant. */
export function toArabicPlant(class_name?: string | null): string {
  if (!class_name) return "";
  const { plant } = splitClass(class_name);
  return translatePlant(plant);
}

/** True when the class is the AgroScan non-leaf / unknown placeholder. */
export function isNonLeafClass(class_name?: string | null): boolean {
  if (!class_name) return false;
  return class_name.trim().toLowerCase() === "non_leaf_or_unknown";
}

/** True when the class represents a healthy leaf. */
export function isHealthyClass(class_name?: string | null): boolean {
  if (!class_name) return false;
  return class_name.toLowerCase().endsWith("___healthy");
}