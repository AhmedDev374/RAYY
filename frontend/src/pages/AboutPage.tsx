export default function AboutPage() {
  return (
    <div dir="rtl" lang="ar" className="font-arabic max-w-2xl prose">
      <h1 className="text-2xl font-bold text-leaf-800">حول رَيّ — RAYY</h1>
      <p>
        رَيّ — RAYY نظام ري ذكي وإدارة لمياه الري، يجمع بين إنترنت الأشياء والذكاء الاصطناعي
        لمراقبة الظروف الزراعية (رطوبة التربة، الحرارة، الرطوبة الجوية) وإدارة الري تلقائيًا
        لتحسين استهلاك المياه ودعم نموّ النباتات.
      </p>
      <h2 className="text-lg font-semibold mt-4">التقنيات المستخدمة</h2>
      <ul className="list-disc mr-5 text-sm">
        <li>واجهة أمامية React PWA (Vercel)</li>
        <li>خدمة خلفية FastAPI مع PostgreSQL (Railway/Render)</li>
        <li>مصنّف أمراض MobileNetV2 / EfficientNet</li>
        <li>أجهزة استشعار ESP32 مع تهيئة الجهاز</li>
      </ul>
    </div>
  );
}
