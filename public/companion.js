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
  let mascotInstanceCount = 0;
  // Where a REACTIVE trigger (reactCorrect, celebrate, warnWeakSkill, ...)
  // should surface the widget when the current screen keeps it 'hidden' by
  // default (see COMPANION_PLACEMENT in app.js) — e.g. the dashboard wants
  // that speech to appear next to its own hero avatar, not in a bottom
  // corner that can overlap real content. Set per-screen via
  // `setReactiveFallback()`; defaults to the historical floating corner.
  let reactiveFallback = { mode: 'floating', anchor: null, size: 'passive' };
  function setReactiveFallback(mode, anchor, size) {
    reactiveFallback = { mode: mode || 'floating', anchor: anchor || null, size: size || 'passive' };
  }

  /** Qiyas — "Compass-Star Beacon": the platform's original mascot (Visual
   *  Identity Overhaul, corrective visual-QA pass). An intentionally
   *  NON-circular, non-chatbot, non-robot silhouette: a soft rounded
   *  4-point compass/star, brand gradient fill, ONE pair of small geometric
   *  eye marks — no swapped cartoon eye/mouth shapes per state, and no
   *  mouth at all. Corrective-QA finding: even the old "neutral" face (two
   *  flat closed-eye dashes) read as a permanent smiling emoji by
   *  pareidolia alone, with zero mouth path involved — the fix isn't a
   *  different mouth, it's not encoding "closed happy eyes" as the resting
   *  state. Expression now comes ONLY from transforms (rotate/scale/
   *  translate) applied to these same two marks per `qiyas-anim-*` state —
   *  see the "Qiyas mascot" CSS section in style.css — plus body tilt,
   *  glow, sparkle accents and motion. See public/mascot-preview.html for
   *  the full state × size showcase this was designed and approved
   *  against; this markup is that exact SVG. One shared source of truth
   *  for every consumer (floating widget, dashboard hero avatar, companion
   *  card, panel header, mission-interview header, etc.) — each call gets
   *  a unique gradient id since SVG `url(#id)` refs resolve to the first
   *  match in the WHOLE document, and multiple mascot instances on one
   *  page would otherwise break every instance after the first. */
  function mascotMarkup() {
    const id = `qiyas${mascotInstanceCount++}`;
    return `
      <svg viewBox="0 0 64 64" class="qiyas-svg" aria-hidden="true">
        <defs>
          <linearGradient id="grad${id}" x1="8%" y1="4%" x2="92%" y2="96%">
            <stop offset="0%" stop-color="#1E3A8A"/>
            <stop offset="100%" stop-color="#14B8A6"/>
          </linearGradient>
          <radialGradient id="glow${id}" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stop-color="#14B8A6" stop-opacity="0.5"/>
            <stop offset="100%" stop-color="#14B8A6" stop-opacity="0"/>
          </radialGradient>
        </defs>
        <circle class="qiyas-glow" cx="32" cy="32" r="31" fill="url(#glow${id})"/>
        <circle class="qiyas-ring" cx="32" cy="32" r="28.5" fill="none" stroke="#14B8A6" stroke-width="2"/>
        <g class="qiyas-float">
          <g class="qiyas-body-group">
            <path class="qiyas-body" fill="url(#grad${id})" d="
              M28.02 13.72
              Q32 6 35.98 13.72
              L38.01 17.67
              Q40.84 23.16 46.33 25.99
              L50.28 28.02
              Q58 32 50.28 35.98
              L46.33 38.01
              Q40.84 40.84 38.01 46.33
              L35.98 50.28
              Q32 58 28.02 50.28
              L25.99 46.33
              Q23.16 40.84 17.67 38.01
              L13.72 35.98
              Q6 32 13.72 28.02
              L17.67 25.99
              Q23.16 23.16 25.99 17.67
              L28.02 13.72 Z"/>
            <g class="qiyas-eyes">
              <rect class="qiyas-eye qiyas-eye-l" x="26.85" y="26.2" width="2.9" height="7.6" rx="1.45"/>
              <rect class="qiyas-eye qiyas-eye-r" x="34.25" y="26.2" width="2.9" height="7.6" rx="1.45"/>
            </g>
          </g>
        </g>
        <path class="qiyas-sparkle qiyas-sparkle-1" fill="#14B8A6" stroke="#fff" stroke-width="1" stroke-linejoin="round"
          d="M49 9 L50.5 13.2 L54.5 14.8 L50.5 16.4 L49 20.6 L47.5 16.4 L43.5 14.8 L47.5 13.2 Z"/>
        <path class="qiyas-sparkle qiyas-sparkle-2" fill="#14B8A6" stroke="#fff" stroke-width="0.8" stroke-linejoin="round"
          d="M15 44 L16 46.6 L18.6 47.6 L16 48.6 L15 51.2 L14 48.6 L11.4 47.6 L14 46.6 Z"/>
      </svg>`;
  }

  /** Applies a named Qiyas state to one already-rendered mascot instance —
   *  swaps its `qiyas-anim-*` motion class. Every visual difference between
   *  states (eye angle/scale/position, body tilt, glow, sparkle) lives
   *  entirely in CSS — no DOM face-group swapping. `root` is any element
   *  containing (or being) a `.qiyas-svg` — works on the floating widget,
   *  the panel header, etc. alike.
   *
   *  Root-cause fix for the reported "Qiyas snaps back to its original
   *  position/pose" bug: `thinking` and `concerned` are continuous
   *  `@keyframes` loops (they're meant to visibly persist for as long as
   *  the state is active) that are essentially NEVER at rest when a new
   *  state interrupts them — and CSS gives a running `animation` priority
   *  over any `transition` on the same property, so swapping straight out
   *  of one used to make the browser jump the body-group INSTANTLY from
   *  wherever the loop currently was to the next state's target, in the
   *  same repaint (confirmed by sampling computed transforms across the
   *  swap — every other state, which is transition-driven, already
   *  interpolates smoothly; only a swap OUT of thinking/concerned didn't).
   *  Fix: a small FLIP (First-Last-Invert-Play) — snapshot the body-group's
   *  ACTUAL current rendered transform, remove the old state (stopping its
   *  animation) and pin that snapshot as a plain inline style with
   *  transitions off, force one reflow so the browser commits it as the
   *  real starting point, then add the new state and hand control back to
   *  the stylesheet. The result: motion always continues smoothly from
   *  wherever Qiyas actually is, in both directions, no matter which state
   *  was interrupted mid-flight. */
  function applyQiyasState(root, state) {
    if (!root) return;
    const svg = root.classList && root.classList.contains('qiyas-svg') ? root : root.querySelector('.qiyas-svg');
    if (!svg) return;
    const wrapper = svg.parentElement || svg;
    const bodyGroup = svg.querySelector('.qiyas-body-group');

    let snapshot = null;
    if (bodyGroup) {
      const rendered = getComputedStyle(bodyGroup).transform;
      if (rendered && rendered !== 'none') snapshot = rendered;
    }

    wrapper.className = (wrapper.className || '').toString().replace(/\bqiyas-anim-\S+/g, '').trim();

    // NOTE: `bodyGroup` is an SVG <g> — SVGElement has no `.offsetWidth`
    // (that's HTMLElement-only; reading it on a <g> is silently `undefined`
    // and forces nothing). `getBoundingClientRect()` is the SVG-safe
    // equivalent for forcing a synchronous layout/style flush.
    if (bodyGroup && snapshot) {
      bodyGroup.style.transition = 'none';
      bodyGroup.style.transform = snapshot;
      bodyGroup.getBoundingClientRect(); // commit the snapshot (with transitions off) as the real starting frame
    }

    wrapper.classList.add(`qiyas-anim-${state}`);

    if (bodyGroup && snapshot) {
      // Re-enable the transition and let it settle as "current" BEFORE releasing
      // the transform override — two separate flushes either side of restoring
      // `transition` is what actually makes the engine treat the upcoming
      // transform change as a fresh, transitionable value change instead of
      // folding every mutation in this task into one untransitioned jump.
      bodyGroup.style.transition = '';
      bodyGroup.getBoundingClientRect();
      bodyGroup.style.transform = '';
    }
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
    widgetEl.className = 'companion-widget';
    widgetEl.innerHTML = `
      <div class="companion-bubble" id="companionBubble" hidden>
        <p class="companion-bubble-text" id="companionBubbleText"></p>
      </div>
      <button type="button" class="companion-avatar-btn" id="companionAvatarBtn" aria-label="قِيس — مرافقك التعليمي">
        ${mascotMarkup()}
      </button>
    `;
    applyQiyasState(widgetEl.querySelector('#companionAvatarBtn'), 'idle');
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

  /** Corrective visual-QA pass: contextual SIZE joins contextual PLACEMENT.
   *  Every consumer of the floating widget picks one of these instead of the
   *  widget always rendering at one fixed size regardless of context —
   *  'passive' (48-56px desktop guidance — background presence: diagnostic,
   *  mock-exam intro, the idle welcome greet), 'coach' (64-80px — actively
   *  guiding but not the primary focus: the practice screen), 'teaching'
   *  (80-96px — the mascot IS the current focal point: inline next to a
   *  lesson title). Onboarding/celebration (120-160px) never uses the
   *  floating widget at all — those are dedicated static avatars sized via
   *  --mascot-xl directly (see .onboarding-visual-avatar, the result-screen
   *  celebration avatars). */
  const WIDGET_SIZE_CLASSES = ['companion-size-passive', 'companion-size-coach', 'companion-size-teaching'];

  /** Mounts (or re-mounts/repositions) the companion. `mode`: 'floating' (the
   *  default fixed bottom-corner), 'inline' (positioned next to `anchorSelector`
   *  — a lesson title, a practice counter), or 'hidden' (fully invisible —
   *  most screens: a screen that wants Qiyas present says so explicitly
   *  instead of the widget defaulting to visible everywhere). `size`: one of
   *  'passive' | 'coach' | 'teaching', default 'passive'. Plays a slide+fade
   *  entrance each time it (re)appears — "enters and leaves the screen
   *  naturally" instead of always sitting in the same spot. */
  function enter(mode = 'floating', anchorSelector = null, size = 'passive') {
    createWidgetIfNeeded();
    const phone = document.querySelector('.phone');
    if (!phone) return;
    clearTimeout(leaveTimer);
    if (!widgetEl.isConnected) phone.appendChild(widgetEl);

    widgetEl.classList.remove('companion-mode-floating', 'companion-mode-inline', 'companion-mode-hidden', 'companion-leaving');
    widgetEl.classList.remove(...WIDGET_SIZE_CLASSES);
    widgetEl.classList.add(`companion-size-${size}`);

    if (mode === 'hidden') {
      widgetEl.classList.add('companion-mode-hidden');
      return;
    }

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

  /** Called by `say()`. Most screens keep the floating widget 'hidden' by
   *  default now (see COMPANION_PLACEMENT in app.js — contextual placement,
   *  not a permanent corner pin) so a REACTIVE trigger firing on one of
   *  those screens (a struggle nudge, a dashboard milestone) needs its own
   *  fallback rather than trusting stale placement from whatever screen was
   *  last visited. Speaking always means "be seen" — floating, passive size,
   *  bottom corner — regardless of what the current screen's base placement
   *  is. A screen that already mounted the widget in 'inline'/'coach' mode
   *  is left exactly as it is (no redundant re-placement mid-conversation). */
  function ensureMounted() {
    createWidgetIfNeeded();
    if (!widgetEl.isConnected || widgetEl.classList.contains('companion-mode-hidden')) {
      enter(reactiveFallback.mode, reactiveFallback.anchor, reactiveFallback.size);
    }
  }

  /** `typing` has no dedicated Qiyas face — it's the "about to say
   *  something" moment, so the mascot just glances (looking) while the
   *  bubble text itself gets the pulse. Every other value is a real Qiyas
   *  state name (see QIYAS_FACE_FOR_STATE) and passes through unchanged. */
  function mascotStateFor(animation) {
    return animation === 'typing' ? 'looking' : animation;
  }

  /** animation: any Qiyas state name — 'idle' | 'blink' | 'looking' |
   *  'thinking' | 'encouraging' | 'happy' | 'celebrating' | 'concerned' |
   *  'pointing' | 'success' — plus 'typing' (bubble-text pulse + a subtle
   *  mascot glance, see mascotStateFor above). */
  function say(text, { animation = 'typing', voice = true, autoHideMs = 6500 } = {}) {
    ensureMounted();
    if (!widgetEl) return;
    const bubble = widgetEl.querySelector('#companionBubble');
    const bubbleText = widgetEl.querySelector('#companionBubbleText');
    const avatarBtn = widgetEl.querySelector('#companionAvatarBtn');
    bubbleText.textContent = text;
    bubble.hidden = false;

    widgetEl.classList.toggle('companion-typing', animation === 'typing');
    applyQiyasState(avatarBtn, mascotStateFor(animation));

    if (voice && window.Voice && Voice.supported) Voice.speak(text);

    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      bubble.hidden = true;
      widgetEl.classList.remove('companion-typing');
      applyQiyasState(avatarBtn, 'idle');
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
    applyQiyasState(avatar, 'encouraging');
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
    applyQiyasState(panelEl.querySelector('.companion-panel-avatar'), 'happy');
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
    say(text, { animation: 'happy' });
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
    say(ENCOURAGEMENTS[Math.floor(Math.random() * ENCOURAGEMENTS.length)], { animation: 'encouraging' });
  }

  function warnWeakSkill(skillNameAr) {
    say(`يبدو إن "${skillNameAr}" محتاجة شوي تركيز — نراجعها اليوم؟`, { animation: 'concerned' });
  }

  function introduceQuiz() {
    say('جاهز نطبّق اللي تعلمناه؟ خذ وقتك بكل سؤال.', { animation: 'pointing' });
  }

  function explainMistake(text) {
    memory.recentMistake = text;
    say(text, { animation: 'concerned' });
  }

  // ---------- Version 3 Phase A: reactive triggers ----------
  // Short, frequent reactions (per-answer, per-tick, per-idle-window) — kept
  // deliberately brief and voice-off by default so they don't pile up TTS
  // queues or nag on every single question.

  const CORRECT_REACTIONS = ['ممتاز! 🌟', 'أحسنت!', 'بالضبط!', 'قوي! 💪', 'كذا بالضبط!'];

  /** Reacts to a correct answer — today NOTHING reacted positively per-question
   *  (only `explainMistake` reacted to wrong ones); this closes that gap.
   *  Uses `success` (a calm ring-pulse), not the bigger `celebrating` burst —
   *  this fires on every single correct answer, so it stays low-key; the big
   *  reaction is reserved for real milestones (see celebrate() above). */
  function reactCorrect() {
    say(CORRECT_REACTIONS[Math.floor(Math.random() * CORRECT_REACTIONS.length)], {
      animation: 'success', autoHideMs: 2200, voice: false,
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
    say('لاحظت إن هذا الجزء يحتاج شوي تركيز — خلني أساعدك.', { animation: 'concerned', autoHideMs: 3000 });
    setTimeout(() => openPanel(), 1400);
  }

  return {
    updateMemory, greet, introduceTopic, explain, celebrate, encourage,
    warnWeakSkill, introduceQuiz, explainMistake, hide, mascotMarkup, renderInlineCard,
    enter, leave, reactCorrect, reactTimerPressure, reactInactivity, reactStruggle,
    openPanel, closePanel, setReactiveFallback,
    // Exposed so any screen that renders a static (non-floating-widget) Qiyas
    // instance via mascotMarkup() — the dashboard hero avatar, etc. — can set
    // which of the 10 named states it should display.
    applyState: applyQiyasState,
  };
})();
