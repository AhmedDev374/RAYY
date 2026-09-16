import { Link } from 'react-router-dom';
import { useState, useEffect } from 'react';

const NAV_LINKS = [
  { label: 'المميزات', href: '#features' },
  { label: 'كيف يعمل', href: '#how-it-works' },
  { label: 'حول المنصة', href: '#about' },
];

const STATS = [
  { value: '13', label: 'نباتات مدعومة' },
  { value: '26', label: 'فئة من الأمراض' },
  { value: '92.37%', label: 'الدقة' },
  { value: '24/7', label: 'مراقبة لحظية' },
];

const FEATURES = [
  {
    icon: '📡',
    title: 'المراقبة اللحظية',
    description:
      'تقوم أجهزة الاستشعار المدعومة بتقنية ESP32 بإرسال بيانات درجة الحرارة والرطوبة ورطوبة التربة والإضاءة مباشرة إلى لوحة التحكم.',
  },
  {
    icon: '🔬',
    title: 'اكتشاف الأمراض بالذكاء الاصطناعي',
    description:
      'التقط صورة لأي ورقة نبات، وسيقوم نموذج التعلم العميق لدينا بتحديد الأمراض بدقة تتجاوز 92% خلال ثوانٍ.',
  },
  {
    icon: '💬',
    title: 'المساعد الذكي',
    description:
      'اسأل عن أي شيء يتعلق بنباتاتك. يستخدم مساعد الذكاء الاصطناعي بيانات المستشعرات المباشرة والسجل السابق لتقديم نصائح مخصصة.',
  },
  {
    icon: '📓',
    title: 'سجل العناية',
    description:
      'سجّل عمليات الري والتسميد وإعادة الزراعة. تابع روتين العناية بنباتاتك واحصل على تذكيرات.',
  },
  {
    icon: '📖',
    title: 'موسوعة النباتات',
    description:
      'أدلة شاملة للعناية بكل نبات مدعوم — احتياجات الإضاءة، جداول الري، والمشكلات الشائعة.',
  },
  {
    icon: '🗺️',
    title: 'خريطة الأمراض',
    description:
      'شاهد المشكلات الصحية للنباتات التي أبلغ عنها المستخدمون على خريطة تفاعلية، وابقَ على اطلاع بتفشي الأمراض في منطقتك.',
  },
];

const STEPS = [
  {
    number: '01',
    icon: '📡',
    title: 'وصّل جهاز الاستشعار',
    description:
      'وصّل جهاز ESP32 الخاص بك، واربطه بشبكة Wi-Fi، وسيبدأ فورًا في إرسال البيانات البيئية.',
  },
  {
    number: '02',
    icon: '📸',
    title: 'ارفع صورة',
    description:
      'التقط صورة لورقة تظهر عليها أعراض. سيحلل الذكاء الاصطناعي الصورة ويقدم التشخيص خلال ثوانٍ.',
  },
  {
    number: '03',
    icon: '🌱',
    title: 'احصل على التحليلات',
    description:
      'احصل على خطط علاج عملية، وتعديلات على روتين العناية، وتنبيهات استباقية بناءً على بياناتك.',
  },
];

const SUPPORTED_PLANTS = [
  { name: 'التفاح', emoji: '🍎', diseases: 3 },
  { name: 'الكرز', emoji: '🍒', diseases: 1 },
  { name: 'الذرة', emoji: '🌽', diseases: 3 },
  { name: 'العنب', emoji: '🍇', diseases: 3 },
  { name: 'البرتقال', emoji: '🍊', diseases: 1 },
  { name: 'الخوخ', emoji: '🍑', diseases: 1 },
  { name: 'الفلفل', emoji: '🫑', diseases: 1 },
  { name: 'البطاطس', emoji: '🥔', diseases: 2 },
  { name: 'التوت العليق', emoji: '🫐', diseases: 0 },
  { name: 'فول الصويا', emoji: '🌱', diseases: 0 },
  { name: 'القرع', emoji: '🎃', diseases: 1 },
  { name: 'الفراولة', emoji: '🍓', diseases: 1 },
  { name: 'الطماطم', emoji: '🍅', diseases: 9 },
];

export default function LandingPage() {
  const [scrolled, setScrolled] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <div dir="rtl" lang="ar" className="font-arabic min-h-screen bg-gray-950 text-white overflow-x-hidden">
      {/* ── Navbar ── */}
      <nav
        className={`fixed top-0 inset-x-0 z-50 transition-all duration-300 ${scrolled
            ? 'bg-gray-950/70 backdrop-blur-xl border-b border-white/10 shadow-lg shadow-black/20'
            : 'bg-transparent'
          }`}
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
<Link
  to="/"
  dir="ltr"
  className="flex items-center gap-3 group ps-2 sm:ps-4"
  aria-label="رَيّ — RAYY"
>
  <svg
    viewBox="0 0 32 40"
className="h-6 w-5 shrink-0 group-hover:scale-105 transition-transform duration-300"

    aria-hidden="true"
  >
    <defs>
      <linearGradient id="rayyDropGradient" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor="#38bdf8" />
        <stop offset="55%" stopColor="#0ea5e9" />
        <stop offset="100%" stopColor="#2563eb" />
      </linearGradient>
    </defs>

    <path
      d="M16 1C16 1 3 16 3 25C3 32.2 8.8 38 16 38C23.2 38 29 32.2 29 25C29 16 16 1 16 1Z"
      fill="url(#rayyDropGradient)"
    />
  </svg>

  <span className="flex items-center gap-2 whitespace-nowrap">
    <span dir="rtl" className="text-xl font-bold text-white">
      رَيّ
    </span>

    <span className="text-white/50">—</span>

    <span dir="ltr" className="text-xl font-extrabold tracking-wide text-white">
      RAYY
    </span>
  </span>
</Link>




          {/* Desktop links */}
          <div className="hidden md:flex items-center gap-8">
            {NAV_LINKS.map((l) => (
              <a
                key={l.label}
                href={l.href}
                className="text-sm text-gray-300 hover:text-white transition-colors"
              >
                {l.label}
              </a>
            ))}
          </div>

          <div className="hidden md:flex items-center gap-3">
            <Link
              to="/login"
              className="text-sm text-gray-300 hover:text-white px-4 py-2 transition-colors"
            >
              تسجيل الدخول
            </Link>
            <Link
              to="/login"
              className="text-sm font-semibold bg-leaf-600 hover:bg-leaf-500 text-white px-5 py-2 rounded-full transition-colors shadow-lg shadow-leaf-600/25"
            >
              ابدأ الآن
            </Link>
          </div>

          {/* Mobile hamburger */}
          <button
            className="md:hidden text-gray-300 hover:text-white p-2"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            aria-label="تبديل القائمة"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              {mobileMenuOpen ? (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              )}
            </svg>
          </button>
        </div>

        {/* Mobile menu dropdown */}
        {mobileMenuOpen && (
          <div className="md:hidden bg-gray-950/90 backdrop-blur-xl border-b border-white/10 px-4 pb-4 space-y-2">
            {NAV_LINKS.map((l) => (
              <a
                key={l.label}
                href={l.href}
                onClick={() => setMobileMenuOpen(false)}
                className="block text-sm text-gray-300 hover:text-white py-2"
              >
                {l.label}
              </a>
            ))}
            <div className="pt-2 flex-col gap-2">
              <Link to="/login" className="text-sm text-gray-300 hover:text-white py-2">
                تسجيل الدخول
              </Link>
              <Link
                to="/login"
                className="text-sm font-semibold bg-leaf-600 hover:bg-leaf-500 text-white px-5 py-2 rounded-full text-center transition-colors"
              >
                ابدأ الآن
              </Link>
            </div>
          </div>
        )}
      </nav>

      {/* ── Hero Section ── */}
      <section className="relative flex items-center justify-center pt-28 pb-20">
        {/* Animated gradient background */}
        <div className="absolute inset-0 bg-gradient-to-br from-green-900 via-emerald-800 to-teal-900" />
        <div
          className="absolute inset-0 opacity-30"
          style={{
            backgroundImage:
              'radial-gradient(ellipse at 20% 50%, rgba(16,185,129,0.4) 0%, transparent 50%), radial-gradient(ellipse at 80% 20%, rgba(6,182,212,0.3) 0%, transparent 50%), radial-gradient(ellipse at 50% 80%, rgba(34,197,94,0.3) 0%, transparent 50%)',
          }}
        />
        {/* Subtle grid overlay */}
        <div
          className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage:
              'linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)',
            backgroundSize: '60px 60px',
          }}
        />

        <div className="relative z-10 max-w-5xl mx-auto px-4 sm:px-6 text-center py-10">
          <div className="inline-flex items-center gap-2 bg-white/10 backdrop-blur-xl border-white/20 rounded-full px-4 py-1.5 mb-8">
            <span className="w-2 h-2 bg-leaf-400 rounded-full animate-pulse" />
            <span className="text-sm text-leaf-200 font-medium">
              نظام الري الذكي وإدارة مياه الري
            </span>
          </div>

          <h1
            dir="rtl"
            className="mb-6 text-center text-4xl font-bold !leading-[1.45] tracking-tight sm:text-5xl md:text-7xl"
          >
            <span className="block text-white">
              اعرف حالة نباتاتك.
            </span>
            <span className="block mt-[0px] bg-gradient-to-r from-leaf-400 via-emerald-300 to-teal-300 bg-clip-text text-transparent">
              قبل أن تواجه مشكلة.
            </span>
          </h1>

          <p className="text-lg sm:text-xl text-gray-300 max-w-2xl mx-auto mb-10 leading-relaxed">
            رَيّ — RAYY منصة زراعية ذكية لمراقبة وإدارة البيئة الزراعية، مع فحص النباتات بالصور والذكاء الاصطناعي، وتوفر موسوعة زراعية ومساعدًا ذكيًا لدعم صحة ونمو النباتات.
          </p>

          <div className="flex flex-wrap justify-center gap-4">
            <Link
              to="/login"
              className="bg-leaf-500 hover:bg-leaf-400 text-white font-semibold px-8 py-3.5 rounded-full transition-all shadow-lg shadow-leaf-500/30 hover:shadow-leaf-400/40 hover:-translate-y-0.5"
            >
              ابدأ مجانًا ←
            </Link>
            <a
              href="#features"
              className="backdrop-blur-xl bg-white/10 border-white/20 hover:bg-white/20 text-white font-semibold px-8 py-3.5 rounded-full transition-all hover:-translate-y-0.5"
            >
              استكشف المميزات
            </a>
          </div>
        </div>

        {/* Bottom fade into stats */}
        <div className="pointer-events-none absolute bottom-0 inset-x-0 h-24 bg-gradient-to-t from-gray-950 to-transparent" />
      </section>

      {/* ── Stats Bar ── */}
      <section className="relative z-10 pb-16">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="grid grid-cols-2 sm:grid-cols-4 backdrop-blur-xl bg-white/[0.07] border-white/[0.12] rounded-2xl p-6 sm:p-8 gap-y-8 gap-x-4">
            {STATS.map((s, i) => (
              <div
                key={s.label}
                className={`flex flex-col items-center justify-center text-center px-2 ${
                  i % 2 === 1 ? 'border-r border-white/[0.08]' : ''
                } ${i === 2 ? 'sm:border-r' : ''}`}
              >
                <div dir="ltr" className="text-3xl sm:text-4xl font-bold text-white mb-1.5 tracking-tight">{s.value}</div>
                <div className="text-xs sm:text-sm text-gray-400 leading-snug">{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Features Section ── */}
      <section id="features" className="py-16 sm:py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <span className="block text-leaf-400 font-semibold text-sm tracking-wide">المميزات</span>
            <h2 className="mt-3 text-3xl sm:text-4xl font-bold text-white">
              كل ما تحتاجه نباتاتك
            </h2>
            <p className="mt-4 text-gray-400 max-w-2xl mx-auto">
              من أجهزة الاستشعار إلى التعلم العميق — منظومة متكاملة لصحة النباتات.
            </p>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {FEATURES.map((f) => (
              <div
                key={f.title}
                className="group backdrop-blur-xl bg-white/[0.04] border-white/[0.08] rounded-2xl p-6 hover:bg-white/[0.08] hover:border-white/[0.16] transition-all duration-300 hover:-translate-y-1"
              >
                <div className="text-4xl mb-4">{f.icon}</div>
                <h3 className="text-lg font-semibold text-white mb-2 group-hover:text-leaf-400 transition-colors">
                  {f.title}
                </h3>
                <p className="text-sm text-gray-400 leading-relaxed">{f.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── How It Works ── */}
      <section id="how-it-works" className="py-16 sm:py-20 bg-gradient-to-b from-gray-950 via-gray-900 to-gray-950">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <span className="block text-leaf-400 font-semibold text-sm tracking-wide">كيف يعمل</span>
            <h2 className="mt-3 text-3xl sm:text-4xl font-bold text-white">
              ثلاث خطوات لنباتات أكثر صحة
            </h2>
          </div>

          <div className="grid md:grid-cols-3 gap-8 relative">
            {/* Connector line (desktop) */}
            <div className="hidden md:block absolute top-16 left-[16.67%] right-[16.67%] h-px bg-gradient-to-r from-leaf-600/0 via-leaf-600/40 to-leaf-600/0" />
            {STEPS.map((s) => (
              <div key={s.number} className="text-center relative">
                <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-leaf-600/20 border-leaf-500/30 text-2xl mb-6">
                  {s.icon}
                </div>
                <div className="text-xs font-bold text-leaf-500 tracking-widest mb-2">
                  الخطوة <span dir="ltr">{s.number}</span>
                </div>
                <h3 className="text-xl font-semibold text-white mb-3">{s.title}</h3>
                <p className="text-sm text-gray-400 leading-relaxed max-w-xs mx-auto">{s.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Supported Plants ── */}
      <section id="about" className="py-16 sm:py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <span className="block text-leaf-400 font-semibold text-sm tracking-wide">النباتات المدعومة</span>
            <h2 className="mt-3 text-3xl sm:text-4xl font-bold text-white">
              مدرّب على 13 نوع من النباتات
            </h2>
            <p className="mt-4 text-gray-400 max-w-2xl mx-auto">
              يتعرف نموذجنا على الأوراق السليمة و26 فئة من الأمراض عبر هذه المحاصيل — والمزيد قادم.
            </p>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
            {SUPPORTED_PLANTS.map((p) => (
              <div
                key={p.name}
                className="backdrop-blur-xl bg-white/[0.04] border-white/[0.08] rounded-2xl p-6 text-center hover:bg-white/[0.08] hover:border-white/[0.16] transition-all duration-300 hover:-translate-y-1"
              >
                <div className="text-5xl mb-3">{p.emoji}</div>
                <div className="text-sm font-medium text-gray-300">{p.name}</div>
                <div className="text-xs text-gray-500 mt-1">{p.diseases} أمراض</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Bottom CTA ── */}
      <section className="py-16 sm:py-20">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 text-center">
          <div className="backdrop-blur-xl bg-white/[0.05] border-white/[0.1] rounded-3xl p-10 sm:p-16 relative overflow-hidden">
            {/* Glow accents */}
            <div className="absolute -top-24 -right-24 w-64 h-64 bg-leaf-500/20 rounded-full blur-3xl" />
            <div className="absolute -bottom-24 -left-24 w-64 h-64 bg-teal-500/20 rounded-full blur-3xl" />

            <div className="relative z-10">
              <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4">
                هل أنت مستعد للنمو بذكاء أكبر؟
              </h2>
              <p className="text-gray-400 mb-8 max-w-lg mx-auto">
                انضم إلى المزارعين الذين يستخدمون أجهزة الاستشعار والذكاء الاصطناعي لريّ
                ذكي وإدارة مثلى للمياه. ابدأ مجانًا، ولا تحتاج إلى بطاقة ائتمانية.
              </p>
              <Link
                to="/login"
                className="inline-block bg-leaf-500 hover:bg-leaf-400 text-white font-semibold px-10 py-4 rounded-full transition-all shadow-lg shadow-leaf-500/30 hover:shadow-leaf-400/40 hover:-translate-y-0.5"
              >
                أنشئ حسابك المجاني ←
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="border-t border-white/[0.06] py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-8 mb-10">
            {/* Brand */}
            <div>
              <div className="flex items-center mb-4">
                <img
                  src="/rayy-logo.svg"
                  alt="رَيّ — RAYY"
                  className="h-8 w-auto"
                />
              </div>
              <p className="text-sm text-gray-500 leading-relaxed">
                نظام ري ذكي وإدارة لمياه الري: يراقب الظروف الزراعية ويُدير الري لتحسين استهلاك المياه.
              </p>
            </div>

            {/* Product */}
            <div>
              <h4 className="text-sm font-semibold text-gray-300 mb-4">المنتج</h4>
              <ul className="space-y-2 text-sm text-gray-500">
                <li><a href="#features" className="hover:text-gray-300 transition-colors">المميزات</a></li>
                <li><a href="#how-it-works" className="hover:text-gray-300 transition-colors">كيف يعمل</a></li>
                <li><a href="#about" className="hover:text-gray-300 transition-colors">النباتات المدعومة</a></li>
              </ul>
            </div>

            {/* Resources */}
            <div>
              <h4 className="text-sm font-semibold text-gray-300 mb-4">المصادر</h4>
              <ul className="space-y-2 text-sm text-gray-500">
                <li><a href="#" className="hover:text-gray-300 transition-colors">التوثيق</a></li>
                <li><a href="#" className="hover:text-gray-300 transition-colors">مرجع API</a></li>
                <li><a href="#" className="hover:text-gray-300 transition-colors">دليل البرنامج الثابت</a></li>
              </ul>
            </div>

            {/* Account */}
            <div>
              <h4 className="text-sm font-semibold text-gray-300 mb-4">الحساب</h4>
              <ul className="space-y-2 text-sm text-gray-500">
                <li><Link to="/login" className="hover:text-gray-300 transition-colors">تسجيل الدخول</Link></li>
                <li><Link to="/login" className="hover:text-gray-300 transition-colors">إنشاء حساب</Link></li>
              </ul>
            </div>
          </div>

          <div className="border-t border-white/[0.06] pt-8 flex-col sm:flex-row items-center justify-between gap-4">
            <p className="text-xs text-gray-600">
              &copy; {new Date().getFullYear()} رَيّ — RAYY. جميع الحقوق محفوظة.
            </p>
            <div className="flex gap-6 text-xs text-gray-600">
              <a href="#" className="hover:text-gray-400 transition-colors">الخصوصية</a>
              <a href="#" className="hover:text-gray-400 transition-colors">الشروط والأحكام</a>
              <a href="#" className="hover:text-gray-400 transition-colors">تواصل معنا</a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
