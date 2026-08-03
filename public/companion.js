// ============================================================
// Educational Companion System (Version 2 Phase 2, mount-lifecycle rewrite
// in Version 3 Phase A).
// "قِيس" — a persistent, named companion, NOT the ask-teacher chat and not a
// new AI backend. A presentation + orchestration layer any screen can invoke
// via the named triggers below. Pure vanilla JS, no framework, matching the
// rest of this project's zero-build-step architecture — same IIFE-exposing-
// a-global-const pattern as Cards/Visuals/Voice (a top-level lexical global,
// not a `window.Companion` property; reference the bare identifier).
//
// Version 3 addition: the companion used to be created once and permanently
// docked bottom-corner forever (a real floating WIDGET). It now has a mount
// lifecycle — `enter(mode, anchorSelector)` / `leave()` — so it can actually
// appear near a lesson title or an exam timer, or disappear entirely while
// the student reads, instead of always sitting in the same corner. Face/
// animation states (idle/thinking/celebrating/pointing/typing) are unchanged.
//
// Memory is populated entirely from data screens already fetch (see
// updateMemory() callers in app.js) — no new backend fields exist purely for
// companion memory. References are template strings built from that memory,
// never free-form AI text, except when a caller explicitly hands it an actual
// AI-service reply to relay (e.g. explainMistake with a curated explanation).
// ============================================================

const Companion = (() => {
  const memory = {
    name: null,
    targetScore: null,
    daysToExam: null,
    weakSkills: [],
    strongSkills: [],
    streak: 0,
    recentBadges: [],
    currentLessonTitle: null,
    recentMistake: null,
    studyHistory: [],
  };

  const SESSION_TYPE_LABELS_AR = { diagnostic: 'تشخيص', lesson: 'درس', practice: 'مراجعة', mock_exam: 'اختبار تجريبي' };

  let widgetEl = null;
  let hideTimer = null;
  let enterTimer = null;
  let leaveTimer = null;
  let lastVisibleMode = 'floating';
  let lastVisibleAnchor = null;
  const ANIMATION_STATES = ['idle', 'thinking', 'celebrating', 'pointing', 'typing'];

  let mascotInstanceCount = 0;

  /** The mascot's SVG markup, shared by the floating widget, the dashboard
   *  hero's inline avatar, and the companion card — one visual source of
   *  truth, matching how public/visuals.js owns every diagram's markup.
   *  Each call gets a unique gradient id (SVG `url(#id)` refs resolve to the
   *  FIRST matching id in the whole document, so reusing one id across
   *  multiple mascot instances on the same page would silently break every
   *  instance after the first). */
  function mascotMarkup() {
    const gradId = `companionGradient${mascotInstanceCount++}`;
    return `
      <svg viewBox="0 0 64 64" class="companion-avatar-svg" aria-hidden="true">
        <defs>
          <linearGradient id="${gradId}" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#1E3A8A"/>
            <stop offset="100%" stop-color="#14B8A6"/>
          </linearGradient>
        </defs>
        <circle cx="32" cy="32" r="30" fill="url(#${gradId})"/>
        <path class="companion-swirl" d="M32 8a24 24 0 0 1 24 24" fill="none" stroke="rgba(255,255,255,0.45)" stroke-width="2.5" stroke-linecap="round"/>
        <g class="companion-face companion-face-default">
          <circle class="companion-eye" cx="23.5" cy="30" r="3.4" fill="white"/>
          <circle class="companion-eye" cx="40.5" cy="30" r="3.4" fill="white"/>
          <path d="M22 40q10 8 20 0" stroke="white" stroke-width="2.6" stroke-linecap="round" fill="none"/>
        </g>
        <g class="companion-face companion-face-thinking" hidden>
          <path d="M20 30h7" stroke="white" stroke-width="2.6" stroke-linecap="round"/>
          <path d="M37 30h7" stroke="white" stroke-width="2.6" stroke-linecap="round"/>
          <circle cx="32" cy="41" r="2.6" fill="white"/>
        </g>
        <g class="companion-face companion-face-celebrating" hidden>
          <path d="M19 29q4.5-5 9 0" stroke="white" stroke-width="2.6" stroke-linecap="round" fill="none"/>
          <path d="M36 29q4.5-5 9 0" stroke="white" stroke-width="2.6" stroke-linecap="round" fill="none"/>
          <path d="M21 38q11 11 22 0" stroke="white" stroke-width="2.8" stroke-linecap="round" fill="none"/>
        </g>
      </svg>`;
  }

  const ENCOURAGEMENTS = [
    'خطوة بخطوة، وبتوصل لهدفك.',
    'كل سؤال تحله يقربك من هدفك.',
    'استمر، التقدم يبان بالنتايج مو بالسرعة.',
    'ثقتك بنفسك تكبر كل ما تتمرن أكثر.',
  ];

  /** Builds the one reusable DOM node (idempotent) — does NOT attach it to the
   *  page. Attaching/detaching is `enter()`/`leave()`'s job, separated out so
   *  the widget's identity (and its listeners) survive being moved between
   *  screens instead of being torn down and rebuilt every time. */
  function createWidgetIfNeeded() {
    if (widgetEl) return;
    widgetEl = document.createElement('div');
    widgetEl.className = 'companion-widget companion-idle';
    widgetEl.innerHTML = `
      <div class="companion-bubble" id="companionBubble" hidden>
        <p class="companion-bubble-text" id="companionBubbleText"></p>
      </div>
      <button type="button" class="companion-avatar-btn" id="companionAvatarBtn" aria-label="قِيس — مرافقك التعليمي">
        ${mascotMarkup()}
      </button>
    `;
    // Version 3 Phase E: tapping the avatar opens the action panel (see
    // openPanel() below) instead of just toggling the last-spoken bubble —
    // "the companion should become useful, not decorative." The bubble still
    // manages its own visibility via say()'s auto-hide timer regardless.
    widgetEl.querySelector('#companionAvatarBtn').addEventListener('click', () => openPanel());
  }

  /** Clears any inline positioning so the base `.companion-widget` CSS rule
   *  (fixed bottom-corner) takes back over. */
  function resetFloatingPosition() {
    widgetEl.style.position = '';
    widgetEl.style.top = '';
    widgetEl.style.left = '';
    widgetEl.style.bottom = '';
    widgetEl.style.insetInlineEnd = '';
  }

  /** Positions the widget just below a given anchor element, measured against
   *  `.phone` (the widget's offset parent) — not the viewport. Horizontally it
   *  keeps the EXACT same safe inset-inline-end margin as floating mode rather
   *  than deriving an x-offset from the anchor: the widget's own width is
   *  content-based (up to the bubble's 220px max-width, flush against its
   *  right edge), so anchoring near an arbitrary point on a wide heading like
   *  a lesson title risks pushing the bubble past the phone's edge — pinning
   *  the horizontal position to the proven-safe default and only moving
   *  vertically avoids that entirely. Computed once per `enter()` call, not on
   *  scroll: the anchors this project targets (a lesson title, an exam timer)
   *  sit near the top of their screen and don't meaningfully scroll away. */
  function positionNear(anchorEl) {
    const phone = document.querySelector('.phone');
    if (!phone) return;
    const phoneRect = phone.getBoundingClientRect();
    const anchorRect = anchorEl.getBoundingClientRect();
    widgetEl.style.position = 'absolute';
    widgetEl.style.bottom = 'auto';
    widgetEl.style.left = 'auto';
    widgetEl.style.insetInlineEnd = '16px';
    widgetEl.style.top = `${Math.max(8, anchorRect.bottom - phoneRect.top + 10)}px`;
  }

  /** Mounts (or re-mounts/repositions) the companion. `mode`: 'floating' (the
   *  default fixed bottom-corner), 'inline' (positioned next to `anchorSelector`
   *  — a lesson title, an exam timer), or 'hidden' (fully invisible — while a
   *  lesson step's text is actively being read). Plays a slide+fade entrance
   *  each time it (re)appears — "enters and leaves the screen naturally"
   *  instead of always sitting in the same spot. */
  function enter(mode = 'floating', anchorSelector = null) {
    createWidgetIfNeeded();
    const phone = document.querySelector('.phone');
    if (!phone) return;
    clearTimeout(leaveTimer);
    if (!widgetEl.isConnected) phone.appendChild(widgetEl);

    widgetEl.classList.remove('companion-mode-floating', 'companion-mode-inline', 'companion-mode-hidden', 'companion-leaving');

    if (mode === 'hidden') {
      widgetEl.classList.add('companion-mode-hidden');
      return;
    }
    lastVisibleMode = mode;
    lastVisibleAnchor = anchorSelector;

    const anchor = mode === 'inline' && anchorSelector ? document.querySelector(anchorSelector) : null;
    if (anchor) {
      widgetEl.classList.add('companion-mode-inline');
      positionNear(anchor);
    } else {
      widgetEl.classList.add('companion-mode-floating');
      resetFloatingPosition();
    }

    clearTimeout(enterTimer);
    widgetEl.classList.remove('companion-entering');
    void widgetEl.offsetWidth; // restart the animation even if it's already mid-transition
    widgetEl.classList.add('companion-entering');
    enterTimer = setTimeout(() => { if (widgetEl) widgetEl.classList.remove('companion-entering'); }, 450);
  }

  /** Fully removes the companion from the page (not just its speech bubble) —
   *  the counterpart to `enter()`. Plays an exit transition first. */
  function leave() {
    if (!widgetEl || !widgetEl.isConnected) return;
    const bubble = widgetEl.querySelector('#companionBubble');
    if (bubble) bubble.hidden = true;
    clearTimeout(hideTimer);
    clearTimeout(enterTimer);
    widgetEl.classList.remove('companion-entering');
    widgetEl.classList.add('companion-leaving');
    clearTimeout(leaveTimer);
    leaveTimer = setTimeout(() => {
      if (widgetEl && widgetEl.parentNode) widgetEl.parentNode.removeChild(widgetEl);
      if (widgetEl) widgetEl.classList.remove('companion-leaving');
    }, 300);
  }

  /** Called by `say()` — if a screen never explicitly called `enter()`, fall
   *  back to floating (today's default behavior). If it's currently hidden
   *  (mid-"hide while reading"), speaking implies wanting to be seen, so it
   *  returns to wherever it was last deliberately placed — "return when
   *  useful" happening automatically the moment there's something to say. */
  function ensureMounted() {
    createWidgetIfNeeded();
    if (!widgetEl.isConnected || widgetEl.classList.contains('companion-mode-hidden')) {
      enter(lastVisibleMode, lastVisibleAnchor);
    }
  }

  function setFace(state) {
    if (!widgetEl) return;
    widgetEl.querySelectorAll('.companion-face').forEach((g) => {
      g.hidden = !g.classList.contains(`companion-face-${state === 'celebrating' ? 'celebrating' : state === 'thinking' ? 'thinking' : 'default'}`);
    });
  }

  /** animation: 'idle' | 'thinking' | 'celebrating' | 'pointing' | 'typing' —
   *  each maps to a CSS class reusing an existing keyframe technique (see
   *  style.css's "Educational Companion" section) rather than a new one.
   *  Uses classList add/remove (not a full `className` replace) so it never
   *  clobbers the `companion-mode-*` mount-state classes `enter()` set. */
  function say(text, { animation = 'typing', voice = true, autoHideMs = 6500 } = {}) {
    ensureMounted();
    if (!widgetEl) return;
    const bubble = widgetEl.querySelector('#companionBubble');
    const bubbleText = widgetEl.querySelector('#companionBubbleText');
    bubbleText.textContent = text;
    bubble.hidden = false;

    ANIMATION_STATES.forEach((s) => widgetEl.classList.remove(`companion-${s}`));
    widgetEl.classList.add(`companion-${animation}`);
    setFace(animation);

    if (voice && window.Voice && Voice.supported) Voice.speak(text);

    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      bubble.hidden = true;
      ANIMATION_STATES.forEach((s) => widgetEl.classList.remove(`companion-${s}`));
      widgetEl.classList.add('companion-idle');
      setFace('idle');
    }, autoHideMs);
  }

  function updateMemory(partial) {
    Object.assign(memory, partial);
  }

  /** Closes the speech bubble immediately without hiding the avatar itself —
   *  "hide when reading, return when needed": called while lesson voice
   *  narration is playing so the companion never covers the text being read. */
  function hide() {
    if (!widgetEl) return;
    const bubble = widgetEl.querySelector('#companionBubble');
    if (bubble) bubble.hidden = true;
    clearTimeout(hideTimer);
  }

  /** Builds a small, self-contained "companion lives inside the card" element
   *  (mini avatar + message) for embedding directly in the page flow — e.g.
   *  the dashboard's Companion Card — as opposed to the one floating widget.
   *  A separate, non-interactive instance: it doesn't touch the floating
   *  widget's state, doesn't speak aloud, and has no tap-to-expand behavior —
   *  it's already fully expanded, being a normal part of the page. */
  function renderInlineCard(text) {
    const card = document.createElement('div');
    card.className = 'companion-inline-card';
    const avatar = document.createElement('div');
    avatar.className = 'companion-inline-card-avatar';
    avatar.innerHTML = mascotMarkup();
    card.appendChild(avatar);
    const p = document.createElement('p');
    p.className = 'companion-inline-card-text';
    p.textContent = text;
    card.appendChild(p);
    return card;
  }

  // ---------- Version 3 Phase E: Companion Panel (interactive, not decorative) ----------
  // A bottom-sheet action menu, same slide-up interaction technique as the
  // nav's existing "المزيد" sheet (public/index.html's #moreSheet /
  // #moreSheetBackdrop) — a separate DOM instance (Companion owns its own
  // DOM end to end, per the established architecture), not a shared element.
  // Every action below calls something that already exists — no new backend,
  // no new AI call; this is a presentation layer over real capabilities.

  let panelEl = null;

  const STUDY_TIPS = [
    'قسّمي وقت المذاكرة لفترات قصيرة مع فواصل راحة — يثبّت المعلومة أكثر من جلسة طويلة متواصلة.',
    'جربي تشرحي المفهوم لنفسك بصوت عالٍ بعد كل درس — إذا قدرتي تشرحينه، معناها فهمتيه فعلاً.',
    'راجعي أخطاءك القديمة بدل تجاهلها — الخطأ اللي تفهمين سببه ما يتكرر بسهولة.',
    'التمرين على نفس المهارة على فترات متباعدة يثبّتها أطول من التكرار المتلاصق في يوم واحد.',
    'قبل الحل، اقرئي السؤال مرتين — كثير من الأخطاء سببها فهم خاطئ للسؤال نفسه، مو ضعف بالمهارة.',
  ];

  function createPanelIfNeeded() {
    if (panelEl) return;
    panelEl = document.createElement('div');
    panelEl.className = 'companion-panel-backdrop';
    panelEl.hidden = true;
    panelEl.innerHTML = `
      <div class="companion-panel">
        <div class="companion-panel-handle"></div>
        <div class="companion-panel-header">
          <div class="companion-panel-avatar">${mascotMarkup()}</div>
          <p class="companion-panel-title">وش أقدر أساعدك فيه؟</p>
          <button type="button" class="companion-panel-close" id="companionPanelCloseBtn" aria-label="إغلاق">✕</button>
        </div>
        <div class="companion-panel-items" id="companionPanelItems"></div>
      </div>
    `;
    // Never trap the student inside: backdrop click, the X button, and (on
    // desktop) Escape all close the panel — see the keydown listener below.
    panelEl.addEventListener('click', (e) => { if (e.target === panelEl) closePanel(); });
    panelEl.querySelector('#companionPanelCloseBtn').addEventListener('click', () => closePanel());
    document.querySelector('.phone')?.appendChild(panelEl);
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && panelEl && !panelEl.hidden) closePanel();
  });

  /** Version 4: the panel became a conversational assistant surface — larger
   *  cards with an icon, a title, and a real "mini preview" line built from
   *  actual `memory` data (not a static label repeated every time), so each
   *  action shows a hint of what it'll actually do before it's tapped. */
  function buildPanelItem(icon, label, subtitle, onClick) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'companion-panel-item';
    btn.innerHTML = `
      <span class="companion-panel-item-icon">${icon}</span>
      <span class="companion-panel-item-text">
        <span class="companion-panel-item-title">${label}</span>
        <span class="companion-panel-item-subtitle">${subtitle}</span>
      </span>
    `;
    btn.onclick = () => { closePanel(); onClick(); };
    return btn;
  }

  function esc(s) {
    return (window.Cards && Cards.escapeHtml) ? Cards.escapeHtml(s) : String(s ?? '');
  }

  /** Sessions from `memory.studyHistory` (the same list the dashboard's
   *  recent-activity card already renders) that started today, local time. */
  function getTodaysSessions() {
    const todayKey = new Date().toDateString();
    return (memory.studyHistory || []).filter((s) => s.completedAt && new Date(s.completedAt).toDateString() === todayKey);
  }

  function todaysSessionsPreview() {
    const sessions = getTodaysSessions();
    if (sessions.length === 0) return 'لسا ما بدأتِ اليوم — يوم جديد يبدأ بخطوة وحدة';
    return `اليوم: ${sessions.length} جلسة مذاكرة`;
  }

  /** Companion panel action: "راجع جلسة اليوم" — a spoken recap of the
   *  student's own already-fetched activity for today, not a new AI call. */
  function reviewTodaysSession() {
    const sessions = getTodaysSessions();
    if (sessions.length === 0) {
      say('لسا ما بدأتِ المذاكرة اليوم — تبين نبدأ بدرس قصير الحين؟', { animation: 'pointing' });
      return;
    }
    const counts = {};
    sessions.forEach((s) => { counts[s.sessionType] = (counts[s.sessionType] || 0) + 1; });
    const parts = Object.entries(counts).map(([type, n]) => `${n} ${SESSION_TYPE_LABELS_AR[type] || type}`);
    const scored = sessions.filter((s) => s.scoreEstimate !== null && s.scoreEstimate !== undefined);
    const avgScore = scored.length > 0
      ? Math.round(scored.reduce((sum, s) => sum + s.scoreEstimate, 0) / scored.length)
      : null;
    const scoreLine = avgScore !== null ? ` — بمتوسط ${avgScore}%` : '';
    say(`اليوم أنجزتِ: ${parts.join('، ')}${scoreLine}. استمري على هالوتيرة 👏`, { animation: 'celebrating', autoHideMs: 5500 });
  }

  function openPanel() {
    createPanelIfNeeded();
    const itemsEl = panelEl.querySelector('#companionPanelItems');
    itemsEl.innerHTML = '';

    itemsEl.appendChild(buildPanelItem('📖', 'اشرح هذا الدرس',
      memory.currentLessonTitle ? `الدرس الحالي: ${esc(memory.currentLessonTitle)}` : 'افتح أي درس وأبدأ أشرحه معك',
      () => {
        if (memory.currentLessonTitle) explain(`خلنا نراجع "${memory.currentLessonTitle}" — أي جزء تبين أوضحه أكثر؟`);
        else explain('افتحي أي درس وبكون جاهز أشرح لك أي جزء منه خطوة بخطوة.');
      }));

    itemsEl.appendChild(buildPanelItem('✏️', 'اختبرني', 'أسئلة قصيرة، خذ وقتك بكل وحدة', () => {
      const onLessonIntro = !document.querySelector('.screen[data-screen="lesson-intro"]')?.hidden;
      if (onLessonIntro && typeof App !== 'undefined' && App.startLessonQuiz) App.startLessonQuiz();
      else if (typeof App !== 'undefined' && App.goToPracticeQueue) App.goToPracticeQueue();
    }));

    itemsEl.appendChild(buildPanelItem('🔍', 'راجع أخطائي',
      memory.recentMistake ? esc(memory.recentMistake).slice(0, 48) + '…' : 'ما فيه أخطاء أخيرة — سجل نظيف 🌟',
      () => {
        if (memory.recentMistake) explainMistake(memory.recentMistake);
        else say('ما فيه أخطاء أخيرة مسجلة — سجل نظيف! استمري كذا 🌟', { animation: 'celebrating' });
      }));

    itemsEl.appendChild(buildPanelItem('🧭', 'وش أذاكر بعدين؟',
      memory.weakSkills && memory.weakSkills.length > 0 ? `يقترح البدء بـ ${esc(memory.weakSkills[0])}` : 'بناءً على أدائك الحالي',
      () => { if (typeof App !== 'undefined' && App.loadNextLesson) App.loadNextLesson(); }));

    itemsEl.appendChild(buildPanelItem('📊', 'اعرض تقدمي',
      memory.streak && memory.streak.current > 0 ? `سلسلة ${memory.streak.current} يوم مستمرة 🔥` : 'شوف تقدمك بكل التفاصيل',
      () => { if (typeof App !== 'undefined' && App.goToDashboard) App.goToDashboard(); }));

    itemsEl.appendChild(buildPanelItem('🗓️', 'راجع جلسة اليوم', todaysSessionsPreview(), () => reviewTodaysSession()));

    itemsEl.appendChild(buildPanelItem('💪', 'شجعني', 'جرعة تحفيز سريعة', () => encourage()));

    itemsEl.appendChild(buildPanelItem('💡', 'نصائح للمذاكرة', 'طريقة مثبتة تساعدك تذاكر أذكى', () => {
      say(STUDY_TIPS[Math.floor(Math.random() * STUDY_TIPS.length)], { animation: 'idle' });
    }));

    panelEl.hidden = false;
    requestAnimationFrame(() => panelEl.classList.add('open'));
  }

  function closePanel() {
    if (!panelEl) return;
    panelEl.classList.remove('open');
    setTimeout(() => { if (panelEl) panelEl.hidden = true; }, 250);
  }

  // ---------- named triggers (the only surface screens call) ----------

  function greet() {
    const text = memory.name
      ? `أهلًا ${memory.name}! جاهز نكمل رحلتك نحو القدرات؟`
      : 'أهلًا فيك! أنا قِيس، بكون معك خطوة بخطوة لين يوم الاختبار.';
    say(text, { animation: 'idle' });
  }

  function introduceTopic(skillNameAr, reasonAr) {
    memory.currentLessonTitle = skillNameAr;
    say(reasonAr || `خلنا نتعلم "${skillNameAr}" اليوم.`, { animation: 'pointing' });
  }

  function explain(text) {
    say(text, { animation: 'typing' });
  }

  function celebrate(achievementText) {
    say(achievementText || 'إنجاز رائع! فخور فيك 🎉', { animation: 'celebrating', autoHideMs: 5500 });
  }

  function encourage() {
    say(ENCOURAGEMENTS[Math.floor(Math.random() * ENCOURAGEMENTS.length)], { animation: 'idle' });
  }

  function warnWeakSkill(skillNameAr) {
    say(`يبدو إن "${skillNameAr}" محتاجة شوي تركيز — نراجعها اليوم؟`, { animation: 'pointing' });
  }

  function introduceQuiz() {
    say('جاهز نطبّق اللي تعلمناه؟ خذ وقتك بكل سؤال.', { animation: 'pointing' });
  }

  function explainMistake(text) {
    memory.recentMistake = text;
    say(text, { animation: 'thinking' });
  }

  // ---------- Version 3 Phase A: reactive triggers ----------
  // Short, frequent reactions (per-answer, per-tick, per-idle-window) — kept
  // deliberately brief and voice-off by default so they don't pile up TTS
  // queues or nag on every single question.

  const CORRECT_REACTIONS = ['ممتاز! 🌟', 'أحسنت!', 'بالضبط!', 'قوي! 💪', 'كذا بالضبط!'];

  /** Reacts to a correct answer — today NOTHING reacted positively per-question
   *  (only `explainMistake` reacted to wrong ones); this closes that gap. */
  function reactCorrect() {
    say(CORRECT_REACTIONS[Math.floor(Math.random() * CORRECT_REACTIONS.length)], {
      animation: 'celebrating', autoHideMs: 2200, voice: false,
    });
  }

  /** Called once when a Learning-Mode per-question countdown runs low —
   *  a gentle nudge, never alarming, never forceful (Learning Mode never
   *  forces submission). */
  function reactTimerPressure() {
    say('خذ وقتك، بس حاول تسرّع شوي ⏱️', { animation: 'pointing', autoHideMs: 4000, voice: false });
  }

  /** Called once after a stretch of no interaction on the active screen. */
  function reactInactivity() {
    say('لسا هنا؟ خذ وقتك، وإذا احتجت مساعدة أنا موجود.', { animation: 'idle', autoHideMs: 5000 });
  }

  /** Version 4: "the companion returns naturally... offers help, without
   *  requiring a click." Called after real struggle signals (consecutive
   *  wrong answers — see answerLesson()/answerPractice() in app.js), not on
   *  a timer. Speaks first, then opens the action panel itself a moment
   *  later — so "offers help" is a concrete, tappable set of options
   *  (اشرح هذا الدرس / راجع أخطائي / اختبرني...), not just a sympathetic line. */
  function reactStruggle() {
    say('لاحظت إن هذا الجزء يحتاج شوي تركيز — خلني أساعدك.', { animation: 'thinking', autoHideMs: 3000 });
    setTimeout(() => openPanel(), 1400);
  }

  return {
    updateMemory, greet, introduceTopic, explain, celebrate, encourage,
    warnWeakSkill, introduceQuiz, explainMistake, hide, mascotMarkup, renderInlineCard,
    enter, leave, reactCorrect, reactTimerPressure, reactInactivity, reactStruggle,
    openPanel, closePanel,
  };
})();
