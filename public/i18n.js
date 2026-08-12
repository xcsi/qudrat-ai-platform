// ============================================================
// Localization infrastructure (hybrid strategy, per product decision):
// UI chrome (nav, buttons, menus, profile, settings, notifications,
// dashboard, onboarding) fully supports Arabic + English. Educational
// CONTENT (lessons, diagnostic items, practice items, curated concept
// text) stays Arabic-only — the Qudrat exam itself is Arabic, so
// translating exam content would misrepresent what the student will
// actually face. AI assistant replies (Ask the Teacher / Ask About
// This Lesson) follow the UI language, except quoted exam wording,
// which always stays in its original Arabic.
//
// Architecture: a flat key->string dictionary per language + a single
// `t(key)` lookup, applied to static markup via `data-i18n` attributes
// and to dynamically-built card labels via direct `I18N.t()` calls in
// cards.js/app.js. Adding a third language later is "add a dict entry
// + a selector option," not a rewrite — the seam this sprint asked for.
//
// Document `dir` is deliberately NEVER flipped to ltr even in English
// mode: Arabic educational content dominates the visual surface no
// matter which chrome language is active, and this app's CSS (logical
// properties: border-inline-start, inset-inline-end, etc.) is built
// RTL-first. Short English chrome labels render correctly left-to-right
// inside an RTL container via the standard Unicode bidi algorithm
// without needing a layout flip — the same reasoning already applied
// to the existing `.counter-ltr` numeral treatment.
// ============================================================

const I18N = (() => {
  const STORAGE_KEY = 'qudrat_lang';

  const dict = {
    ar: {
      // NOTE on gender neutrality: Arabic conjugates 2nd-person verbs and some
      // adjectives for gender, and the app's original Arabic content defaulted
      // to feminine forms (سجّلي، اكتبي، جاهزة...) throughout. Every string
      // below is rephrased to avoid direct 2nd-person address — masdar/noun-
      // phrase constructions ("تسجيل الدخول" not "سجّلي الدخول"), passive voice,
      // or "يُرجى/الرجاء + masdar" — rather than guessing a gender. Possessive
      // "ك" suffixes (هدفك، تقدمك) are kept: they're written identically for
      // both genders in unvocalized Arabic, so they carry no gender assumption.

      // splash / language selection
      splash_tagline: 'منصتك نحو التميز',
      lang_select_title: 'لغة الواجهة',
      lang_select_sub: 'يمكن تغيير هذا لاحقًا من الإعدادات',
      lang_option_ar: 'العربية',
      lang_option_en: 'English',
      lang_continue: 'متابعة',

      // gender personalization — kept neutral even in its own question text,
      // since gender is by definition unknown at the moment this is asked.
      gender_title: 'طريقة المخاطبة المفضّلة',
      gender_sub: 'هذا يساعد على استخدام الصيغة المناسبة أثناء المحادثة — يمكن تخطي هذا السؤال في أي وقت.',
      gender_male: 'ذكر',
      gender_female: 'أنثى',
      gender_skip: 'أفضّل عدم التحديد',
      gender_continue: 'متابعة',

      // welcome
      welcome_eyebrow: 'قبل ما نبدأ',
      welcome_title_line1: 'معلّمك الشخصي',
      welcome_title_line2: 'لاختبار القدرات',
      welcome_sub: 'يعرف مستوى الإتقان الحالي، وش لسا يحتاج شغل، ويختار أنسب خطوة تالية — مو أسئلة عشوائية.',
      welcome_cta_register: 'إنشاء حساب جديد',
      welcome_cta_login: 'عندك حساب؟ تسجيل الدخول',
      welcome_cta_guest: 'تجربة سريعة بدون حساب',

      // auth
      register_eyebrow: 'حساب جديد',
      register_title: 'التسجيل يحفظ تقدمك',
      register_name_label: 'الاسم',
      register_email_label: 'البريد الإلكتروني',
      register_password_label: 'كلمة المرور',
      register_submit: 'إنشاء الحساب',
      register_have_account: 'عندك حساب؟ تسجيل الدخول',
      login_eyebrow: 'مرحبًا بعودتك',
      login_title: 'تسجيل الدخول',
      login_email_label: 'البريد الإلكتروني',
      login_password_label: 'كلمة المرور',
      login_submit: 'تسجيل الدخول',
      login_no_account: 'ما عندك حساب؟ إنشاء حساب جديد',

      // target score / exam date (explicit onboarding steps, before the mission chat)
      target_score_eyebrow: 'قبل ما نبدأ',
      target_score_title: 'وش درجتك المستهدفة؟',
      target_score_sub: 'من 100 — نبني خطتك على أساسها.',
      target_score_cta: 'متابعة ←',
      exam_date_eyebrow: 'خطوة أخيرة',
      exam_date_title: 'متى موعد اختبارك؟',
      exam_date_sub: 'يساعدنا نحسب خطة مذاكرة واقعية.',
      exam_date_cta: 'متابعة ←',

      // mission
      mission_title: 'لنتحدث عن هدفك',
      mission_sub: 'كم ساعة بتقدر تذاكر أسبوعيًا؟ وأي تخصص أو كلية بذهنك؟',
      mission_placeholder: 'مثال: أبي كلية طب، باقي شهر ونص على القدرات',
      mission_kicker: 'قِيس',
      mission_tagline: 'خلني أعرف هدفك',
      onboarding_visual_tagline: 'قِيس معك خطوة بخطوة نحو القدرات',
      mission_seed_question: 'لنتحدث عن هدفك — وش التخصص المطلوب وليش القدرات مهم الحين؟',
      mission_continue: 'متابعة ←',
      mission_done_continue: 'متابعة ←',

      // mission transition
      transition_eyebrow: 'تم حفظ هدفك ✓',
      transition_title: 'جاري تجهيز رحلة التعلّم...',
      transition_step_mission: 'حفظ المهمة',
      transition_step_profile: 'بناء الملف التعليمي',
      transition_step_plan: 'تجهيز خطة الدراسة',

      // diagnostic
      diagnostic_done_eyebrow: 'التشخيص خلص',
      diagnostic_done_cta: 'عرض الدرس الأول',

      // current grade (onboarding-redesign sprint)
      grade_select_eyebrow: 'قبل ما نبدأ',
      grade_select_title: 'وش صفّك الدراسي؟',
      grade_select_sub: 'يساعدنا نخصّص المحتوى المناسب لك.',
      grade_select_11: 'الحادي عشر',
      grade_select_12: 'الثاني عشر',

      // choose learning path
      path_select_eyebrow: 'قبل ما نبدأ',
      path_select_title: 'اختر مسارك التعليمي',
      path_select_sub: 'كل مسار له رحلته ودروسه وتمارينه الخاصة — تقدر تبدّل لاحقًا من صفحة رحلتك التعليمية.',
      path_select_quant_title: 'الكمّي',
      path_select_quant_sub: 'حساب، جبر، هندسة، نسب ومقارنات',
      path_select_verbal_title: 'اللفظي',
      path_select_verbal_sub: 'تناظر، إكمال جمل، استيعاب مقروء',

      // lesson
      lesson_review_badge: '✨ محتوى قيد المراجعة',
      lesson_start_quiz: 'بدء التدريب',
      lesson_ask_toggle: '💬 اسأل عن هذا الدرس',
      lesson_ask_placeholder: 'سؤال عن هذا الدرس بالذات...',
      lesson_hint_btn: '💡 تلميح',
      lesson_result_cta: 'عرض التقدم',
      // Version 6 Phase N: relabeled as the "Mastery Check" moment the target
      // lesson sequence calls for — the verdict logic underneath (finishLesson()
      // in app.js) was already real and evidence-based, this is copy/framing only.
      lesson_result_eyebrow: 'فحص الإتقان',

      // dashboard (Version 2 Phase 3 — home screen redesign)
      continue_card_eyebrow: 'تابع التعلّم',
      continue_card_btn: 'ابدأ ←',
      dashboard_journey_title: 'رحلتك التعليمية',
      dashboard_mission_title: 'مهمة اليوم',
      dashboard_achievements: 'إنجازاتك',
      dashboard_skill_progress_title: 'مستوى الإتقان',
      dashboard_upcoming_title: 'القادم',
      dashboard_recent_activity: 'نشاطك الأخير',

      // notifications
      notifications_title: 'الإشعارات',
      notifications_empty: 'ما فيه إشعارات جديدة الآن.',

      // ask the teacher
      ask_teacher_title: 'اسأل المعلم',
      ask_teacher_sub: 'أي سؤال متابعة عندك على أي درس؟',
      ask_teacher_placeholder: 'السؤال هنا...',

      // resources / glossary / reference / practice
      resources_eyebrow: 'مصادر معتمدة',
      resources_title: 'من أين نتحقق',
      glossary_eyebrow: 'مصطلحاتك',
      glossary_title: 'قاموسي',
      glossary_empty: 'ما فيه مصطلحات مفتوحة بعد — تفتح تلقائيًا بعد إتقان أول مهارة.',
      reference_eyebrow: 'تكبر مع تعلّمك',
      reference_title: 'أوراقي المرجعية',
      reference_empty: 'ما فيه أوراق مرجعية بعد — تظهر تلقائيًا بعد إتقان أول مهارة بكل موضوع.',
      practice_eyebrow: 'مراجعة متباعدة',
      practice_title: 'مراجعة اليوم',
      practice_empty: 'ما فيه شي مستحق اليوم — المراجعة المتباعدة تجدول أول مراجعة لأي مهارة "بكرة" وليس نفس يوم التعلم (هذا مبدأ علمي أساسي، مو نقص بالنظام). الرجاء المحاولة مرة أخرى غدًا.',

      // mock exam
      mock_exam_eyebrow: 'اختبار تجريبي كامل',
      mock_exam_title: 'وقت اختبار النفس؟',
      mock_exam_sub: 'اختبار مؤقّت يحاكي تجربة القدرات الحقيقية — يُرجى عدم إغلاق المتصفح أثناءه.',
      mock_exam_cta: 'البدء الآن',
      mock_exam_review_eyebrow: 'نتيجة الاختبار التجريبي',
      mock_exam_review_sub: 'مراجعة كل سؤال أدناه',
      mock_exam_review_cta: 'رجوع للتقدم',

      // nav
      nav_home: 'الرئيسية', nav_practice: 'مراجعة', nav_exam: 'اختبار', nav_ask: 'اسأل', nav_more: 'المزيد',

      // more sheet
      more_reference: 'أوراقي المرجعية', more_glossary: 'قاموسي', more_resources: 'مصادر موثوقة', more_settings: 'الإعدادات', more_logout: 'تسجيل الخروج',

      // settings
      settings_title: 'الإعدادات', settings_language: 'لغة الواجهة', settings_gender: 'طريقة المخاطبة',
    },
    en: {
      splash_tagline: 'Your Platform Towards Excellence',
      lang_select_title: 'Choose your interface language',
      lang_select_sub: 'You can change this later in Settings',
      lang_option_ar: 'العربية',
      lang_option_en: 'English',
      lang_continue: 'Continue',

      gender_title: 'How would you like to be addressed?',
      gender_sub: "This helps us phrase things naturally for you — you can skip this anytime.",
      gender_male: 'Male',
      gender_female: 'Female',
      gender_skip: "Prefer not to say",
      gender_continue: 'Continue',

      welcome_eyebrow: 'Before we start',
      welcome_title_line1: 'Your Personal Tutor',
      welcome_title_line2: 'for the Qudrat Exam',
      welcome_sub: "Knows what you've mastered, what still needs work, and picks your best next step — not random questions.",
      welcome_cta_register: 'Create your account and start',
      welcome_cta_login: 'Have an account? Log in',
      welcome_cta_guest: 'Quick trial without an account',

      register_eyebrow: 'New account',
      register_title: 'Sign up to save your progress',
      register_name_label: 'Your name',
      register_email_label: 'Email',
      register_password_label: 'Password',
      register_submit: 'Create account',
      register_have_account: 'Have an account? Log in',
      login_eyebrow: 'Welcome back',
      login_title: 'Log in',
      login_email_label: 'Email',
      login_password_label: 'Password',
      login_submit: 'Log in',
      login_no_account: "Don't have an account? Sign up",

      target_score_eyebrow: 'Before we start',
      target_score_title: "What's your target score?",
      target_score_sub: 'Out of 100 — we build your plan around it.',
      target_score_cta: 'Continue →',
      exam_date_eyebrow: 'One last step',
      exam_date_title: "When's your exam?",
      exam_date_sub: 'Helps us calculate a realistic study plan.',
      exam_date_cta: 'Continue →',

      mission_title: "Let's talk about your goal",
      mission_sub: 'How many hours can you study weekly? Any target program in mind?',
      mission_placeholder: 'Example: I want medical school, exam is in 6 weeks',
      mission_kicker: 'Qiyas',
      mission_tagline: "Let's map out your goal",
      onboarding_visual_tagline: 'Qiyas is with you, step by step, toward Qudrat',
      mission_seed_question: "Let's talk about your goal — what program are you aiming for, and why does Qudrat matter right now?",
      mission_continue: 'Continue →',
      mission_done_continue: 'Continue →',

      transition_eyebrow: 'Your goal is saved ✓',
      transition_title: 'Preparing your learning journey...',
      transition_step_mission: 'Saving your mission',
      transition_step_profile: 'Building your learning profile',
      transition_step_plan: 'Preparing your study plan',

      diagnostic_done_eyebrow: 'Diagnostic complete',
      diagnostic_done_cta: 'View your first lesson',

      grade_select_eyebrow: 'Before we start',
      grade_select_title: "What's your current grade?",
      grade_select_sub: 'Helps us tailor content to your level.',
      grade_select_11: 'Grade 11',
      grade_select_12: 'Grade 12',

      path_select_eyebrow: 'Before we start',
      path_select_title: 'Choose your learning path',
      path_select_sub: 'Each path has its own roadmap, lessons, and practice — you can switch later from your learning journey.',
      path_select_quant_title: 'Quantitative',
      path_select_quant_sub: 'Arithmetic, algebra, geometry, ratios and comparisons',
      path_select_verbal_title: 'Verbal',
      path_select_verbal_sub: 'Analogy, sentence completion, reading comprehension',

      lesson_review_badge: '✨ Content under review',
      lesson_start_quiz: 'Start practice',
      lesson_ask_toggle: '💬 Ask about this lesson',
      lesson_ask_placeholder: 'Ask about this specific lesson...',
      lesson_hint_btn: '💡 Hint',
      lesson_result_cta: 'View progress',

      continue_card_eyebrow: 'Continue Learning',
      continue_card_btn: 'Start ←',
      dashboard_journey_title: 'Your Learning Journey',
      dashboard_mission_title: "Today's Mission",
      dashboard_achievements: 'Your achievements',
      dashboard_skill_progress_title: 'Skill Mastery',
      dashboard_upcoming_title: 'Upcoming',
      dashboard_recent_activity: 'Recent activity',

      notifications_title: 'Notifications',
      notifications_empty: 'No new notifications right now.',

      ask_teacher_title: 'Ask the Teacher',
      ask_teacher_sub: 'Any follow-up question about any lesson?',
      ask_teacher_placeholder: 'Type your question here...',

      resources_eyebrow: 'Verified sources',
      resources_title: 'Where we fact-check',
      glossary_eyebrow: 'Your terms',
      glossary_title: 'My Glossary',
      glossary_empty: 'No terms unlocked yet — they unlock automatically after mastering your first skill.',
      reference_eyebrow: 'Grows with your learning',
      reference_title: 'My Reference Sheets',
      reference_empty: 'No reference sheets yet — they appear automatically after mastering the first skill in each topic.',
      practice_eyebrow: 'Spaced review',
      practice_title: "Today's review",
      practice_empty: 'Nothing due today — spaced review schedules the first review for "tomorrow," not the same day you learned it (this is a deliberate learning-science principle, not a system gap). Check back tomorrow.',

      mock_exam_eyebrow: 'Full mock exam',
      mock_exam_title: 'Ready to test yourself?',
      mock_exam_sub: "A timed exam that mirrors the real Qudrat experience — don't close the browser during it.",
      mock_exam_cta: 'Start now',
      mock_exam_review_eyebrow: 'Mock exam results',
      mock_exam_review_sub: 'Review every question below',
      mock_exam_review_cta: 'Back to progress',

      nav_home: 'Home', nav_practice: 'Practice', nav_exam: 'Exam', nav_ask: 'Ask', nav_more: 'More',

      more_reference: 'Reference Sheets', more_glossary: 'Glossary', more_resources: 'Trusted Sources', more_settings: 'Settings', more_logout: 'Log out',

      settings_title: 'Settings', settings_language: 'Interface language', settings_gender: 'How to address you',
    },
  };

  function getLang() {
    try { return localStorage.getItem(STORAGE_KEY) || 'ar'; } catch (e) { return 'ar'; }
  }

  function setLang(lang) {
    try { localStorage.setItem(STORAGE_KEY, lang); } catch (e) { /* ignore */ }
    applyLang();
  }

  function t(key) {
    const lang = getLang();
    return (dict[lang] && dict[lang][key]) || dict.ar[key] || key;
  }

  /** Walks every [data-i18n] / [data-i18n-placeholder] element and applies the
   *  current language's string. Called once on boot and again whenever the
   *  language changes — cheap (a few dozen DOM nodes), no framework needed. */
  function applyLang() {
    const lang = getLang();
    document.documentElement.lang = lang;
    // Deliberately NOT flipping dir to ltr — see file header comment.
    document.querySelectorAll('[data-i18n]').forEach((el) => {
      el.textContent = t(el.dataset.i18n);
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
      el.placeholder = t(el.dataset.i18nPlaceholder);
    });
    document.querySelectorAll('.lang-option').forEach((el) => {
      el.classList.toggle('active', el.dataset.lang === lang);
    });
  }

  return { getLang, setLang, t, applyLang };
})();
