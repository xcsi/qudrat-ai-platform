// ============================================================
// Curated interaction content ("interactive learning system" pass).
// Deterministic, fixed-answer interaction specs, keyed by lesson title —
// no live LLM call needed to author OR grade any of these. A lesson whose
// title matches an entry here gets its multiple-choice mini-challenge step
// REPLACED with this richer interaction instead (see loadNextLesson() in
// app.js); every other lesson is completely unaffected, and this file is
// additive-only — deleting it (or a lookup miss) falls back to exactly
// today's MCQ behavior, nothing breaks.
//
// Schema per entry: { variant, data } — `variant` is one of the
// Cards.InteractiveActivityCard variants ('sequence' | 'classify' |
// 'match' | 'highlight' | 'fill'), `data` is that variant's own data shape
// (see the doc comment on InteractiveActivityCard in Cards.js). Keyed by
// exact `lesson.title_ar` today; swapping to a stable skill-id key is a
// one-line change once curated authoring needs many more entries than this.
// ============================================================

const CuratedInteractions = (() => {
  const BY_TITLE = {
    // Quant A — order of operations: the concept itself IS a sequence, so
    // let the student build that sequence instead of reading it and then
    // answering an unrelated multiple-choice question below it.
    'ترتيب العمليات الحسابية': {
      variant: 'sequence',
      data: {
        prompt_ar: 'رتّب خطوات حل أي عملية حسابية مركّبة — من الخطوة الأولى إلى الأخيرة.',
        items: [
          { text_ar: 'الأقواس' },
          { text_ar: 'الأسس والجذور' },
          { text_ar: 'الضرب والقسمة (من اليسار لليمين)' },
          { text_ar: 'الجمع والطرح (من اليسار لليمين)' },
        ],
      },
    },

    // Quant B — mental math & estimation: classify real numbers by rounding
    // direction. A genuine estimation judgment, not a lookup.
    'الحساب الذهني والتقدير': {
      variant: 'classify',
      data: {
        prompt_ar: 'صنّف كل عدد حسب اتجاه تقريبه إلى أقرب عشرة.',
        categories: ['يُقرَّب للأعلى ⬆', 'يُقرَّب للأسفل ⬇'],
        items: [
          { text_ar: '47', correctCategory: 0 },
          { text_ar: '42', correctCategory: 1 },
          { text_ar: '68', correctCategory: 0 },
          { text_ar: '31', correctCategory: 1 },
          { text_ar: '95', correctCategory: 0 },
          { text_ar: '24', correctCategory: 1 },
        ],
      },
    },

    // Verbal A — main idea extraction: classify sentences from one short
    // passage into main idea / supporting detail / not-the-main-idea — the
    // exact 3-way distinction the lesson's own concept mind-map teaches,
    // now something the student actually DOES instead of just reading.
    'استخراج الفكرة الرئيسية من النص': {
      variant: 'classify',
      data: {
        prompt_ar: 'اقرأ كل جملة من الفقرة التالية وصنّفها: «تراجع استخدام الأكياس البلاستيكية في المتاجر الكبرى بسبب الوعي البيئي المتزايد، حيث انخفضت مبيعاتها بنسبة 30% خلال عامين، وبدأت متاجر عديدة بتوفير أكياس قماشية قابلة لإعادة الاستخدام.»',
        categories: ['الفكرة الرئيسية', 'تفاصيل داعمة', 'ليست الفكرة الرئيسية'],
        items: [
          { text_ar: 'تراجع استخدام الأكياس البلاستيكية في المتاجر الكبرى بسبب الوعي البيئي المتزايد.', correctCategory: 0 },
          { text_ar: 'انخفضت مبيعات الأكياس البلاستيكية بنسبة 30% خلال عامين.', correctCategory: 1 },
          { text_ar: 'بدأت متاجر عديدة بتوفير أكياس قماشية قابلة لإعادة الاستخدام.', correctCategory: 1 },
          { text_ar: 'الأكياس البلاستيكية', correctCategory: 2 },
          { text_ar: 'يفضّل بعض الزبائن الدفع نقدًا بدلاً من البطاقات.', correctCategory: 2 },
        ],
      },
    },

    // Verbal B — detail verification: select the sentence that actually
    // verifies a claim ("evidence selection") instead of picking an answer
    // ABOUT the passage from a menu below it.
    'التحقق من تفاصيل النص': {
      variant: 'highlight',
      data: {
        prompt_ar: 'اقرأ الفقرة، ثم اختر الجملة التي تؤكّد هذه العبارة: «عدد الكتب في المكتبة الجديدة يتجاوز 50 ألف كتاب.»',
        segments: [
          { text_ar: 'افتُتحت المكتبة العامة الجديدة في وسط المدينة الأسبوع الماضي.', isCorrect: false },
          { text_ar: 'تحتوي المكتبة على أكثر من 50 ألف كتاب ومساحات مخصصة للدراسة الجماعية.', isCorrect: true },
          { text_ar: 'أعلنت إدارة المكتبة أن الدخول سيكون مجانيًا لجميع الطلاب حتى نهاية العام.', isCorrect: false },
        ],
        explanation_ar: 'هذه الجملة هي الوحيدة التي تذكر رقمًا محددًا لعدد الكتب.',
      },
    },

    // Verbal — word-pair relationship identification: this skill IS matching
    // (pair a word-relationship to its category), so `match` fits the concept
    // more directly than a multiple-choice menu ever could.
    'تحديد العلاقة بين زوج الكلمات': {
      variant: 'match',
      data: {
        prompt_ar: 'طابق كل زوج كلمات مع نوع العلاقة التي تربط بينهما.',
        pairs: [
          { left_ar: 'إصبع : يد', right_ar: 'جزء من كل' },
          { left_ar: 'مطر : فيضان', right_ar: 'سبب ونتيجة' },
          { left_ar: 'سكين : تقطيع', right_ar: 'أداة ووظيفتها' },
          { left_ar: 'طبيب : مستشفى', right_ar: 'شخص ومكان عمله' },
          { left_ar: 'أسد : غابة', right_ar: 'كائن وموطنه' },
        ],
      },
    },

    // Quant — basic percentage calculation: a short deterministic numeric
    // result is the actual skill (not a menu of 4 plausible-looking
    // percentages), so `fill` matches the concept better than an MCQ.
    'حساب النسبة المئوية الأساسي': {
      variant: 'fill',
      data: {
        prompt_ar: 'احسب: كم يساوي 20% من 150؟',
        placeholder_ar: 'اكتب الناتج...',
        accepted: ['30'],
        hint_ar: '20% تعني 20 من كل 100 — حوّلها إلى كسر عشري (0.2) واضربها في 150.',
        explanation_ar: '20% من 150 = 150 × 0.2 = 30.',
      },
    },
  };

  function forLessonTitle(title) {
    return BY_TITLE[title] || null;
  }

  return { forLessonTitle };
})();
