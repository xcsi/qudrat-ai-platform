// ============================================================
// Client-side logic for the Qudrat AI Tutor demo. Vanilla JS,
// no framework, no build step — open index.html via the demo
// server and it just works.
// ============================================================

const App = (() => {
  // Engineering review P0-2: every place below that builds an innerHTML template
  // literal from AI-generated text (lesson content, glossary terms, review items,
  // ask-the-teacher replies which are directly conditioned on raw student input)
  // now escapes that text first. WHY: unescaped interpolation into innerHTML is a
  // real stored/reflected XSS vector — the model has already demonstrated it will
  // emit unexpected raw text (LaTeX, Markdown) despite instructions not to, and
  // the ask-the-teacher flow's input is literally "whatever the student types."
  // WHAT changed: added this escaper and wrapped every untrusted interpolation
  // site in it, rather than a broader rewrite to full DOM-node construction —
  // this closes the actual vulnerability with a small, testable, reviewable diff.
  function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  let state = {
    diagnosticSessionId: null,
    diagnosticItems: [],
    diagnosticIndex: 0,
    lessonSessionId: null,
    lessonSkillId: null,
    lessonItems: [],
    lessonIndex: 0,
    lessonCorrectCount: 0,
    lessonHintLevel: 0, // Version 2 Phase 1: 0 = not yet requested, 1 = first hint shown, 2 = second shown
    companionGreetedDashboard: false, // Version 2 Phase 2: greet on the FIRST dashboard visit this session only
    lastKnownXp: null, // Version 2 Phase 3: lets the XP counter animate FROM the previous value, not from 0, on repeat visits
    lastKnownLevel: null, // Version 2 Phase 3: detects a level-up between dashboard visits so it can be celebrated exactly once
    currentLesson: null, // Version 3 Phase B: the full lesson object (title/concept blocks/worked example), stepped through incrementally
    lessonSteps: [], // Version 3 Phase B: [{type:'objective'}, {type:'concept',block}, ..., {type:'challenge',item}, {type:'worked_example'}, {type:'summary'}]
    lessonStepIndex: 0,
    companionReturnTimer: null, // Version 3 Phase B: the "hide while reading, return shortly after" timer, re-armed every step
    questionShownAt: null, // Version 3 Phase C: real per-question timing — set by markQuestionShown(), read by elapsedSinceShown()
    consecutiveWrongCount: 0, // Version 4: struggle detection — the companion proactively offers help after 2 wrong in a row, reset on any correct answer
    journeySection: 'quantitative', // Version 3 Phase D: which of the two separate roadmaps is showing
    journeyDashboardData: null,
    journeyNextLessonData: null,
    // Version 5 Phase J: a real prefetch, stashed while the student is reading
    // their diagnostic score (genuine idle time) so loadNextLesson()'s own
    // GET /api/next-lesson can be skipped on the very next screen. Cleared
    // immediately on use so it can never serve a stale recommendation.
    nextLessonPrefetch: null,
    // Demo-polish sprint: which of the two curricula (Quantitative/Verbal) the
    // student explicitly chose — persisted across sessions so it isn't asked
    // again every visit. null means "not chosen yet," which gates
    // loadNextLesson() into the path-select screen rather than silently
    // picking a section for the student.
    selectedTrack: localStorage.getItem('qudrat_selected_track') || null,
    // Demo-stabilization sprint: captured by the target-score/exam-date screens,
    // consumed once by beginMissionWithPrefill() to seed the mission interview.
    pendingTargetScore: null,
    pendingExamDate: null,
  };

  // ---------- Version 3 Phase C: real per-question timing ----------
  // Only one question is ever on screen at a time across the whole app
  // (diagnostic/lesson-quiz/lesson-challenge/practice/mock-exam never overlap),
  // so a single shared timestamp is enough — no per-screen state needed.
  function markQuestionShown() { state.questionShownAt = Date.now(); }
  function elapsedSinceShown() { return state.questionShownAt ? Date.now() - state.questionShownAt : 12000; }

  // Learning Mode (lesson-quiz + practice): a SUGGESTED, non-forcing 60s
  // per-question countdown — reaching 0 just recolors and nudges once via the
  // companion, it never blocks or auto-submits. Simulation Mode (mock exam)
  // keeps its own real, already-built, strict whole-session timer unchanged
  // (see startExamTimer) — this is a separate, deliberately gentler timer.
  const LEARNING_MODE_SECONDS = 60;
  let learningTimerInterval = null;

  function startLearningTimer(displayEl) {
    clearInterval(learningTimerInterval);
    if (!displayEl) return;
    let secondsLeft = LEARNING_MODE_SECONDS;
    let pressureReacted = false;
    const render = () => {
      displayEl.textContent = `⏱ ${secondsLeft}`;
      displayEl.classList.toggle('learning-timer-low', secondsLeft <= 10);
    };
    render();
    learningTimerInterval = setInterval(() => {
      secondsLeft = Math.max(0, secondsLeft - 1);
      if (secondsLeft === 10 && !pressureReacted) {
        pressureReacted = true;
        Companion.reactTimerPressure();
      }
      render();
      if (secondsLeft === 0) clearInterval(learningTimerInterval);
    }, 1000);
  }

  function stopLearningTimer() {
    clearInterval(learningTimerInterval);
  }

  /** Version 4: "the companion returns naturally... offers help, without
   *  requiring a click" — tracks real struggle (2 wrong answers in a row,
   *  not a timer) across lesson/practice screens and proactively calls
   *  Companion.reactStruggle(). Delayed so it doesn't overwrite whatever
   *  per-question mistake explanation is already showing in the bubble. */
  function noteAnswerOutcome(isCorrect) {
    if (isCorrect) { state.consecutiveWrongCount = 0; return; }
    state.consecutiveWrongCount++;
    if (state.consecutiveWrongCount >= 2) {
      state.consecutiveWrongCount = 0;
      setTimeout(() => Companion.reactStruggle(), 2500);
    }
  }

  /** Groups a review/attempt array (each item needs `skillNameAr` +
   *  `responseTimeMs`) by skill and renders an average-time recap — shared by
   *  the mock-exam review (many skills in one session, real per-skill
   *  comparison) and the lesson-result screen. A single Lesson always has
   *  exactly one `skill_id` (every item in it shares that skill), so grouping
   *  by skill there would always collapse to one meaningless row — in that
   *  case this falls back to a per-QUESTION breakdown instead, which is the
   *  comparison that's actually meaningful within one lesson. */
  function renderTimingBySkill(items, sectionId, listId) {
    const section = document.getElementById(sectionId);
    const list = document.getElementById(listId);
    list.innerHTML = '';
    if (items.length < 2) { section.hidden = true; return; }

    const bySkill = {};
    items.forEach((r) => {
      if (!bySkill[r.skillNameAr]) bySkill[r.skillNameAr] = [];
      bySkill[r.skillNameAr].push(r.responseTimeMs);
    });
    const skillNames = Object.keys(bySkill);

    let rows, sortable;
    if (skillNames.length >= 2) {
      rows = skillNames.map((skillNameAr) => ({
        label: skillNameAr,
        avgSeconds: Math.round(bySkill[skillNameAr].reduce((a, b) => a + b, 0) / bySkill[skillNameAr].length / 1000),
      }));
      sortable = true;
    } else {
      rows = items.map((r, i) => ({ label: `سؤال ${i + 1}`, avgSeconds: Math.round(r.responseTimeMs / 1000) }));
      sortable = false; // question order matters more than speed order here
    }

    section.hidden = false;
    const fastest = rows.reduce((a, b) => (b.avgSeconds < a.avgSeconds ? b : a));
    const slowest = rows.reduce((a, b) => (b.avgSeconds > a.avgSeconds ? b : a));
    (sortable ? [...rows].sort((a, b) => a.avgSeconds - b.avgSeconds) : rows).forEach((r) => {
      const tag = r === fastest && fastest !== slowest ? '⚡ الأسرع' : r === slowest && fastest !== slowest ? '🐢 الأبطأ' : '';
      list.appendChild(Cards.TimingBar(r.label, r.avgSeconds, tag));
    });
  }

  const HERO_MOTIVATIONS = [
    'جاهز نكمل رحلتنا؟',
    'كل يوم مذاكرة يقرّبك من هدفك خطوة.',
    'خطوة صغيرة اليوم، فرق كبير يوم الاختبار.',
    'يلا نشوف وش نتعلم اليوم؟',
  ];

  const NAV_SCREENS = ['dashboard', 'practice', 'mock-exam-intro', 'ask-teacher', 'reference-sheets', 'glossary', 'resources', 'notifications', 'settings', 'journey'];
  const NAV_MAP = {
    'dashboard': 'dashboard',
    'practice': 'practice',
    'mock-exam-intro': 'mock-exam-intro',
    'ask-teacher': 'ask-teacher',
    'reference-sheets': 'more',
    'glossary': 'more',
    'resources': 'more',
    'settings': 'more',
    'notifications': null,
    'journey': 'dashboard', // reached via a link off the dashboard, not its own nav item — "الرئيسية" stays highlighted so there's an obvious way back
  };

  // Educational Companion (Version 3 Phase A; corrective visual-QA pass):
  // where the mascot lives — and how big it is — is a property of the
  // SCREEN, decided in one place. Corrective-QA finding: the old fallback
  // was ['floating', null] — meaning every screen NOT listed here got the
  // same bottom-corner floating widget by default, which is exactly the
  // "feels like a floating support chatbot pinned to one corner everywhere"
  // complaint. The default below is now ['hidden', null] instead: a screen
  // only gets a companion presence by explicitly earning one, each with the
  // placement AND size (`passive` 48-56 / `coach` 64-80 / `teaching` 80-96,
  // desktop guidance) that fits its actual role on that screen. Screens
  // that already render their OWN dedicated Qiyas avatar in-flow (mission's
  // .interview-avatar, dashboard's hero + companion-card avatars, the
  // results screens' .result-mascot) deliberately stay 'hidden' here too —
  // otherwise the floating widget would double up a second Qiyas on top of
  // the one already integrated into that screen's composition.
  const COMPANION_PLACEMENT = {
    // ONBOARDING / auth: the desktop-only .onboarding-visual panel (a
    // dedicated 144px avatar, "part of the main composition") already
    // covers this screen group — see the :has() block at the end of
    // style.css. 'welcome' is the one deliberate exception: it's the single
    // screen that greets out loud (see showScreen below), so it keeps the
    // floating widget as the vehicle for that speech bubble.
    welcome: ['floating', null, 'passive'],
    'language-select': ['hidden', null],
    'gender-select': ['hidden', null],
    register: ['hidden', null],
    login: ['hidden', null],
    'grade-select': ['hidden', null],
    'target-score-select': ['hidden', null],
    'exam-date-select': ['hidden', null],
    'path-select': ['hidden', null],

    // MISSION: "beside/inside the guided interview card" — already true via
    // the dedicated .interview-avatar in the card header; no floating dupe.
    mission: ['hidden', null],
    'mission-transition': ['hidden', null],

    // DIAGNOSTIC: assessment-like — minimal/passive presence, same
    // treatment as the mock exam below, never inline over the question.
    diagnostic: ['floating', null, 'passive'],
    // Results moments get their own large .result-mascot (see
    // renderResultMascot() calls) — no floating dupe here either.
    'diagnostic-done': ['hidden', null],

    // LESSON: "near the relevant concept or guidance area" — inline next to
    // the lesson title, sized as the active teaching moment it is.
    'lesson-intro': ['inline', '#lessonTitle', 'teaching'],
    // Real bug found via rendered screenshot: '#lessonTitle' only exists on
    // the lesson-intro screen, not lesson-quiz — positionNear() was
    // measuring a hidden, zero-size element on a DIFFERENT (hidden) screen,
    // so the widget pinned itself near the very top of the viewport instead
    // of near this screen's own content. '#lessonCounter' is this screen's
    // real anchor.
    'lesson-quiz': ['inline', '#lessonCounter', 'teaching'],
    // finishLesson() calls Companion.celebrate() right after showing this
    // screen — surface that speech next to the big .result-mascot instead
    // of a separate bottom-corner popup.
    'lesson-result': ['hidden', null, 'passive', ['inline', '#lessonResultMascot', 'passive']],

    // Base presence is 'hidden' (the hero + companion-card avatars already
    // give Qiyas a controlled, contextual presence here — see the "DASHBOARD"
    // spec) but reactive speech (greet/celebrate/warnWeakSkill/encourage)
    // still needs somewhere to surface — anchor it to the hero avatar
    // instead of the historical bottom-left corner, which could overlap the
    // streak/XP cards. See the reactiveFallback 4th slot below.
    dashboard: ['hidden', null, 'passive', ['inline', '#heroCompanionAvatar', 'passive']],
    journey: ['hidden', null],
    notifications: ['hidden', null],
    'ask-teacher': ['hidden', null],
    resources: ['hidden', null],
    glossary: ['hidden', null],
    'reference-sheets': ['hidden', null],
    settings: ['hidden', null],

    // PRACTICE: "near feedback/progress, without covering answers" — inline
    // next to the screen's own title (top of the card, never over options).
    practice: ['inline', '#practiceTitle', 'coach'],

    // MOCK EXAM: "minimal/passive; exam focus takes priority." The intro is
    // a calm passive presence; the timed quiz itself hides Qiyas entirely
    // so nothing competes with the timer/question during a real attempt;
    // the review gets its own .result-mascot like the other results screens.
    'mock-exam-intro': ['floating', null, 'passive'],
    'mock-exam-quiz': ['hidden', null],
    'mock-exam-review': ['hidden', null],
  };

  // Educational Companion (Version 3 Phase A): reacts once after a stretch of
  // no interaction — only on screens where "are you still there?" is actually
  // useful (mid-lesson/mid-practice), not on e.g. settings or reference sheets.
  const INACTIVITY_SCREENS = ['lesson-intro', 'lesson-quiz', 'practice'];
  let inactivityTimer = null;

  function armInactivityTimer(screenName) {
    clearTimeout(inactivityTimer);
    if (!INACTIVITY_SCREENS.includes(screenName)) return;
    inactivityTimer = setTimeout(() => Companion.reactInactivity(), 20000);
  }

  /** Re-arms the SAME screen's timer — called by the global interaction
   *  listener below, which fires on any click/keydown regardless of screen. */
  function resetInactivityTimer() {
    const current = document.querySelector('.screen:not([hidden])');
    armInactivityTimer(current ? current.dataset.screen : null);
  }

  function showScreen(name) {
    // Stop any in-progress lesson narration when leaving the lesson screen —
    // otherwise voice keeps reading over whatever screen the student moves to.
    if (name !== 'lesson-intro' && Voice.supported && (Voice.isSpeaking() || Voice.isPaused())) Voice.stop();
    // Educational Companion (Version 2 Phase 2): welcome is the one screen the
    // companion greets on every single time it's shown (a returning, logged-out
    // visitor) — every other trigger point is called explicitly by the screen
    // that owns it (dashboard, lesson-intro, etc.), not generically here.
    if (name === 'welcome') Companion.greet();
    armInactivityTimer(name);
    document.querySelectorAll('.screen').forEach((el) => (el.hidden = el.dataset.screen !== name));
    document.getElementById('app').scrollTop = 0;

    // Placement runs AFTER the target screen is revealed — an 'inline' anchor
    // (e.g. #lessonTitle) is still hidden (a zero-size rect) until the line above
    // toggles it visible, so measuring it any earlier silently collapses to (0,0).
    const [placementMode, placementAnchor, placementSize, reactiveFallback] = COMPANION_PLACEMENT[name] || ['hidden', null];
    Companion.enter(placementMode, placementAnchor, placementSize);
    // Where a REACTIVE trigger should surface Qiyas if this screen keeps it
    // hidden by default (see the 4th COMPANION_PLACEMENT slot above) — falls
    // back to the classic floating corner when a screen doesn't specify one.
    const [rMode, rAnchor, rSize] = reactiveFallback || ['floating', null, 'passive'];
    Companion.setReactiveFallback(rMode, rAnchor, rSize);

    const showNav = NAV_SCREENS.includes(name);
    const nav = document.getElementById('bottomNav');
    nav.hidden = !showNav;
    // Sidebar nav (>=1024px app shell, see style.css) mirrors bottomNav's
    // visibility exactly — which one is actually ON SCREEN is a pure CSS
    // media-query decision, not something this function needs to know.
    document.getElementById('sidebarNav').hidden = !showNav;
    document.getElementById('app').classList.toggle('with-nav', showNav);

    const activeKey = NAV_MAP[name];
    document.querySelectorAll('.nav-item').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.nav === activeKey);
    });
    // The sidebar's four "more"-sheet destinations (reference sheets, glossary,
    // resources, settings) get their own row each instead of sharing one
    // collapsed "more" nav-item — so they need a per-SCREEN active state
    // (data-nav-screen), separate from NAV_MAP's shared 'more' bucket above.
    document.querySelectorAll('[data-nav-screen]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.navScreen === name);
    });
  }

  function toggleMoreSheet() {
    const sheet = document.getElementById('moreSheet');
    const backdrop = document.getElementById('moreSheetBackdrop');
    const willShow = sheet.hidden;
    sheet.hidden = !willShow;
    backdrop.hidden = !willShow;
  }

  function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

  /** Corrective visual-QA pass — "RESULTS: visible celebration/encouragement."
   *  Renders a real, celebration-sized (120-160px) Qiyas directly into a
   *  result screen's `.result-mascot` slot (idempotent: renders once per
   *  page load, then just re-applies the state on repeat calls — same
   *  pattern as the dashboard hero avatar). `qiyasState`: any Companion
   *  state name, typically 'celebrating' or 'happy'. */
  function renderResultMascot(containerId, qiyasState) {
    const el = document.getElementById(containerId);
    if (!el) return;
    if (!el.dataset.rendered) {
      el.innerHTML = Companion.mascotMarkup();
      el.dataset.rendered = 'true';
    }
    Companion.applyState(el, qiyasState);
  }

  // ---------- first-launch onboarding: splash / language / gender ----------
  // Splash always shows briefly (feels like a real app launching, not a bare
  // page load). Language + gender selection only show once ever — tracked by
  // a dedicated flag, separate from the language preference itself, since the
  // language default ('ar') exists independently of whether onboarding ran.
  const ONBOARDED_KEY = 'qudrat_onboarded';
  function hasOnboarded() { try { return localStorage.getItem(ONBOARDED_KEY) === 'true'; } catch (e) { return false; } }
  function markOnboarded() { try { localStorage.setItem(ONBOARDED_KEY, 'true'); } catch (e) { /* ignore */ } }

  function selectLanguage(lang) {
    I18N.setLang(lang);
  }

  function goToGenderSelect() {
    showScreen('gender-select');
  }

  async function selectGender(gender) {
    document.querySelectorAll('.gender-option').forEach((el) => el.classList.toggle('active', el.dataset.gender === gender));
    // Best-effort, silent — a failed save here shouldn't block onboarding or
    // alarm the student; neutral phrasing stays the safe default regardless.
    if (getAuthToken()) {
      try {
        await fetch('/api/profile/gender', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getAuthToken()}` },
          body: JSON.stringify({ gender }),
        });
      } catch (e) { /* ignore */ }
    }
  }

  function completeOnboarding() {
    markOnboarded();
    showScreen('welcome');
  }

  function goToSettings() {
    showScreen('settings');
    document.getElementById('changePasswordForm').reset();
    document.getElementById('changePasswordMessage').hidden = true;
  }

  /** Renders Qiyas once into the desktop-only onboarding/auth visual panel
   *  (see index.html's #onboardingVisualPanel + style.css's ":has()"-gated
   *  composition rules) — same idempotent render-once pattern as the
   *  dashboard hero avatar. Harmless to call on every boot even on mobile,
   *  where the panel is simply never shown (display:none). */
  function renderOnboardingVisual() {
    const avatarEl = document.getElementById('onboardingVisualAvatar');
    if (!avatarEl || avatarEl.dataset.rendered) return;
    avatarEl.innerHTML = Companion.mascotMarkup();
    Companion.applyState(avatarEl, 'encouraging');
    avatarEl.dataset.rendered = 'true';
  }

  /** Renders Qiyas once into the splash screen's brand-moment composition
   *  (see .splash-mascot in style.css) — same idempotent render-once
   *  pattern as the onboarding visual panel and dashboard hero avatar. */
  function renderSplashMascot() {
    const el = document.getElementById('splashMascot');
    if (!el || el.dataset.rendered) return;
    el.innerHTML = Companion.mascotMarkup();
    Companion.applyState(el, 'encouraging');
    el.dataset.rendered = 'true';
  }

  async function boot() {
    I18N.applyLang();
    renderOnboardingVisual();
    renderSplashMascot();
    showScreen('splash');
    await sleep(1100);
    if (!hasOnboarded()) {
      showScreen('language-select');
      return;
    }
    if (getAuthToken()) {
      await afterAuthSuccess();
    } else {
      showScreen('welcome');
    }
  }

  // ---------- auth token (product redesign — student accounts) ----------
  // Falls back cleanly to the existing no-login demo behavior when absent —
  // resolveStudentFromRequest on the server does the same fallback, so every
  // route keeps working with zero token exactly as it always has.
  const TOKEN_KEY = 'qudrat_auth_token';
  function getAuthToken() { try { return localStorage.getItem(TOKEN_KEY); } catch (e) { return null; } }
  function setAuthToken(token) { try { localStorage.setItem(TOKEN_KEY, token); } catch (e) {} }
  function clearAuthToken() { try { localStorage.removeItem(TOKEN_KEY); } catch (e) {} }

  async function api(method, url, body) {
    try {
      const token = getAuthToken();
      const headers = {};
      if (body) headers['Content-Type'] = 'application/json';
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const res = await fetch(url, {
        method,
        headers: Object.keys(headers).length ? headers : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        // Prefer the server's friendly Arabic `message` (added for demo-stabilization)
        // over the technical `error` code, and never surface a raw status/route string.
        throw new Error(errBody.message || errBody.error || 'حدث خطأ غير متوقع. حاولي مرة أخرى.');
      }
      return await res.json();
    } catch (err) {
      showErrorBanner(err.message || 'حدث خطأ غير متوقع. حاولي مرة ثانية.');
      throw err;
    }
  }

  function showErrorBanner(message) {
    let banner = document.getElementById('errorBanner');
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'errorBanner';
      banner.className = 'error-banner';
      document.querySelector('.phone').prepend(banner);
    }
    banner.textContent = `تعذّر إكمال الطلب: ${message}`;
    banner.hidden = false;
    clearTimeout(banner._hideTimer);
    banner._hideTimer = setTimeout(() => { banner.hidden = true; }, 6000);
  }

  function setLoading(isLoading, label) {
    let overlay = document.getElementById('loadingOverlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'loadingOverlay';
      overlay.className = 'loading-overlay';
      // Static innerHTML skeleton (no user data ever goes here — every setLoading()
      // caller passes a literal Arabic string constant) so a bouncing-dots spinner
      // can persist across calls instead of a frozen wall of text implying the app hung.
      overlay.innerHTML = '<div class="loading-dots"><span></span><span></span><span></span></div><p class="loading-label"></p>';
      document.querySelector('.phone').appendChild(overlay);
    }
    overlay.querySelector('.loading-label').textContent = label || 'جاري التحميل...';
    overlay.hidden = !isLoading;
  }

  // ---------- auth (product redesign — student accounts) ----------
  function goToLogin() {
    showScreen('login');
    document.getElementById('loginError').hidden = true;
  }

  function goToRegister() {
    showScreen('register');
    document.getElementById('registerError').hidden = true;
  }

  function updateLogoutMenuVisibility() {
    const loggedIn = !!getAuthToken();
    document.getElementById('logoutMenuItem').hidden = !loggedIn;
    document.getElementById('sidebarLogoutItem').hidden = !loggedIn;
  }

  async function afterAuthSuccess() {
    updateLogoutMenuVisibility();
    // A returning student may already have a mission — check before deciding
    // whether to start the mission interview again or go straight to her dashboard.
    try {
      const d = await api('GET', '/api/dashboard');
      if (d.target !== null && d.baseline !== null) {
        goToDashboard();
        return;
      }
      if (d.target !== null) {
        // Mission interview is done (target score saved) but the diagnostic
        // never completed — e.g. the student closed the tab or lost connection
        // mid-quiz. Resume the diagnostic instead of silently dropping into a
        // dashboard with no real data behind it.
        startDiagnostic();
        return;
      }
    } catch (err) {
      // fall through to onboarding below
    }
    goToGradeSelect();
  }

  function logout() {
    clearAuthToken();
    updateLogoutMenuVisibility();
    showScreen('welcome');
  }

  // ---------- welcome -> grade -> target score -> exam date -> mission ----------
  // Onboarding-redesign sprint: registration leaves grade_level unset (see
  // authService.register) — this is the explicit "current grade" step,
  // asked first since it's the simplest fact and this app is scoped to
  // Grade 11/12 specifically.
  function goToGradeSelect() {
    showScreen('grade-select');
  }

  async function confirmGrade(gradeLevel) {
    try { await api('POST', '/api/profile/grade', { gradeLevel }); } catch (e) { /* non-blocking */ }
    goToTargetScoreSelect();
  }

  // ---------- target score -> exam date -> mission ----------
  // Demo-stabilization sprint: target score and exam date used to be captured
  // ONLY conversationally inside the mission interview chat — a first-time
  // student got no explicit "here's what we're setting up" moment, and every
  // one of the two facts cost a full LLM round-trip to extract. Two direct-
  // input screens replace that: instant to fill in, and the results are handed
  // to the mission interview as an already-answered opener (see
  // beginMissionWithPrefill) — the exact same /api/mission contract the real
  // chat form uses, no backend change, just a head start on the conversation.
  function goToTargetScoreSelect() {
    showScreen('target-score-select');
    document.getElementById('targetScoreSlider').value = 80;
    document.getElementById('targetScoreValue').textContent = '80';
    state.pendingTargetScore = 80;
  }

  function onTargetScoreInput(value) {
    document.getElementById('targetScoreValue').textContent = value;
    state.pendingTargetScore = Number(value);
  }

  function confirmTargetScore() {
    goToExamDateSelect();
  }

  function goToExamDateSelect() {
    showScreen('exam-date-select');
    const input = document.getElementById('examDateInput');
    if (!input.value) {
      const d = new Date();
      d.setDate(d.getDate() + 90); // a reasonable default: ~3 months out
      input.value = d.toISOString().slice(0, 10);
    }
  }

  async function confirmExamDate() {
    state.pendingExamDate = document.getElementById('examDateInput').value || null;
    await beginMissionWithPrefill();
  }

  const MISSION_SEED_QUESTION = 'لنتحدث عن هدفك — وش التخصص المطلوب وليش القدرات مهم الحين؟';

  /** Guided-interview-card setup shared by goToMission() and
   *  beginMissionWithPrefill() below — resets the "answered so far" strip,
   *  chips, counter and question text, and renders Qiyas's static header
   *  avatar (once — same pattern as the dashboard hero avatar). */
  function resetMissionScreen() {
    showScreen('mission');
    state.missionQuestionCount = 1;
    document.getElementById('missionAnswered').innerHTML = '';
    document.getElementById('missionForm').hidden = false;
    document.getElementById('missionContinueBtn').hidden = true;
    document.getElementById('missionInput').disabled = false;
    document.getElementById('missionInput').value = '';
    setMissionCounter(1);
    setMissionQuestion(MISSION_SEED_QUESTION);
    const avatarEl = document.getElementById('missionAvatar');
    if (!avatarEl.dataset.rendered) {
      avatarEl.innerHTML = Companion.mascotMarkup();
      avatarEl.dataset.rendered = 'true';
    }
    Companion.applyState(avatarEl, 'pointing');
  }

  function goToMission() {
    resetMissionScreen();
  }

  /** Opens the interview already "one turn in" — the target score and exam
   *  date the student just picked, phrased as if she said them herself. The
   *  mission-interview prompt already treats any value given in an earlier
   *  turn as confirmed and never re-asks for it, so this reliably skips
   *  straight to whatever's genuinely still missing (weekly study hours,
   *  target program) instead of asking about a score/date already picked. */
  async function beginMissionWithPrefill() {
    resetMissionScreen();
    const targetScore = state.pendingTargetScore ?? 80;
    const examDate = state.pendingExamDate;
    const seedMessage = examDate
      ? `درجتي المستهدفة ${targetScore} من 100، وموعد اختباري بتاريخ ${examDate}.`
      : `درجتي المستهدفة ${targetScore} من 100.`;
    await sendMissionMessage(seedMessage, 'جاري تجهيز خطتك...');
  }

  function setMissionQuestion(text) {
    document.getElementById('missionQuestion').textContent = text;
    renderMissionChips(text);
  }

  function setMissionCounter(n) {
    document.getElementById('missionCounter').textContent = `سؤال ${n}`;
  }

  /** Adds the student's just-given answer to the collapsed "answered so far"
   *  strip — replaces the old scrolling chat-bubble history. Only the
   *  answer is shown (not the question text) to stay compact. */
  function addMissionAnsweredItem(answerText) {
    const list = document.getElementById('missionAnswered');
    const item = document.createElement('div');
    item.className = 'interview-answered-item';
    item.innerHTML = `<span class="interview-answered-item-check">✓</span><span></span>`;
    item.lastElementChild.textContent = answerText;
    list.appendChild(item);
  }

  /** Optional quick-reply chips over the exact same free-text message the
   *  backend already accepts (POST /api/mission has no structured-option
   *  schema — this is presentation only, never a new API shape). Pattern-
   *  matched from the question text itself; returns null when no safe
   *  pattern applies, and the free-text field remains the only path. */
  function missionChipsFor(questionText) {
    if (/ساع/.test(questionText)) {
      return ['2–4 ساعات أسبوعيًا', '5–7 ساعات أسبوعيًا', '8–10 ساعات أسبوعيًا', 'أكثر من 10 ساعات'];
    }
    return null;
  }

  function renderMissionChips(questionText) {
    const container = document.getElementById('missionChips');
    const chips = missionChipsFor(questionText);
    container.innerHTML = '';
    if (!chips) { container.hidden = true; return; }
    chips.forEach((label) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'interview-chip';
      btn.textContent = label;
      btn.onclick = () => sendMissionMessage(label);
      container.appendChild(btn);
    });
    container.hidden = false;
  }

  /** Shared send path for both the real form and the pre-filled opener /
   *  chip clicks above — same request, same done/continue handling either
   *  way. Records the answer in the "answered so far" strip, then shows the
   *  next question as the new active card (or hands off to the continue
   *  button once the interview is actually done). */
  async function sendMissionMessage(message, loadingLabel) {
    const input = document.getElementById('missionInput');
    addMissionAnsweredItem(message);
    document.getElementById('missionChips').hidden = true;
    input.value = '';
    input.disabled = true;
    Companion.applyState(document.getElementById('missionAvatar'), 'thinking');
    // Human-centered art-direction pass: "thinking about your answer" reads
    // as an AI-processing status, not a tutor replying — same fix as the
    // ask-teacher loading label below.
    setLoading(true, loadingLabel || 'قِيس يكتب ردّه...');
    try {
      const result = await api('POST', '/api/mission', { message });
      setMissionQuestion(result.message);
      if (result.done) {
        // Real bug found via product feedback: this used to auto-transition
        // on a flat 900ms timer regardless of how long the final message
        // was — a longer closing reply would still get yanked away before
        // the student finished reading it. Never auto-transition: show a
        // "متابعة" button and let the student decide when they're ready.
        Companion.applyState(document.getElementById('missionAvatar'), 'happy');
        document.getElementById('missionForm').hidden = true;
        document.getElementById('missionContinueBtn').hidden = false;
      } else {
        state.missionQuestionCount = (state.missionQuestionCount || 1) + 1;
        setMissionCounter(state.missionQuestionCount);
        Companion.applyState(document.getElementById('missionAvatar'), 'pointing');
        input.disabled = false;
        input.focus();
      }
    } catch (err) {
      input.disabled = false;
      Companion.applyState(document.getElementById('missionAvatar'), 'concerned');
    } finally {
      setLoading(false);
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    updateLogoutMenuVisibility();
    boot();

    // Educational Companion: any real interaction postpones the inactivity
    // nudge — capture phase so it fires even for clicks inside e.g. the quiz
    // options (which don't bubble past their own handlers in every browser).
    document.addEventListener('click', resetInactivityTimer, true);
    document.addEventListener('keydown', resetInactivityTimer, true);

    // Never trap the student inside the "more" sheet either — same Escape
    // affordance as the companion panel (see companion.js).
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !document.getElementById('moreSheet').hidden) toggleMoreSheet();
    });

    const registerForm = document.getElementById('registerForm');
    if (registerForm) {
      registerForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const errorEl = document.getElementById('registerError');
        errorEl.hidden = true;
        const displayName = document.getElementById('registerName').value.trim();
        const email = document.getElementById('registerEmail').value.trim();
        const password = document.getElementById('registerPassword').value;
        try {
          const result = await api('POST', '/api/auth/register', { email, password, displayName });
          setAuthToken(result.token);
          await afterAuthSuccess();
        } catch (err) {
          errorEl.textContent = err.message;
          errorEl.hidden = false;
        }
      });
    }

    const loginForm = document.getElementById('loginForm');
    if (loginForm) {
      loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const errorEl = document.getElementById('loginError');
        errorEl.hidden = true;
        const email = document.getElementById('loginEmail').value.trim();
        const password = document.getElementById('loginPassword').value;
        try {
          const result = await api('POST', '/api/auth/login', { email, password });
          setAuthToken(result.token);
          await afterAuthSuccess();
        } catch (err) {
          errorEl.textContent = err.message;
          errorEl.hidden = false;
        }
      });
    }

    // Version 5 Phase L: account management, scoped to change-password only.
    const changePasswordForm = document.getElementById('changePasswordForm');
    if (changePasswordForm) {
      changePasswordForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const currentPassword = document.getElementById('currentPasswordInput').value;
        const newPassword = document.getElementById('newPasswordInput').value;
        const messageEl = document.getElementById('changePasswordMessage');
        try {
          await api('PATCH', '/api/profile/password', { currentPassword, newPassword });
          messageEl.textContent = 'تم تحديث كلمة المرور بنجاح.';
          messageEl.className = 'settings-password-message settings-password-message--success';
          messageEl.hidden = false;
          changePasswordForm.reset();
        } catch (err) {
          messageEl.textContent = err.message || 'تعذّر تحديث كلمة المرور.';
          messageEl.className = 'settings-password-message settings-password-message--error';
          messageEl.hidden = false;
        }
      });
    }

    document.getElementById('missionForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const input = document.getElementById('missionInput');
      const message = input.value.trim();
      if (!message) return;
      input.value = '';
      await sendMissionMessage(message);
    });

    const askTeacherForm = document.getElementById('askTeacherForm');
    if (askTeacherForm) {
      askTeacherForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const input = document.getElementById('askTeacherInput');
        const message = input.value.trim();
        if (!message) return;
        addChatBubble('askTeacherChat', 'user', message);
        input.value = '';
        input.disabled = true;
        // Human-centered art-direction pass: an inline "typing" bubble inside
        // the chat itself — same pattern as ask-lesson below — instead of a
        // full-screen blocking overlay reading "thinking about your
        // question," which looked exactly like an AI-generation wait screen
        // for what is, from the student's side, just a chat reply.
        const chat = document.getElementById('askTeacherChat');
        const typingBubble = document.createElement('div');
        typingBubble.className = 'bubble bubble-assistant bubble-typing';
        typingBubble.textContent = 'قِيس يكتب...';
        chat.appendChild(typingBubble);
        chat.scrollTop = chat.scrollHeight;
        try {
          const result = await api('POST', '/api/ask-teacher', { message });
          typingBubble.remove();
          addChatBubble('askTeacherChat', 'assistant', result.reply);
          if (result.priorKnowledgeDetected) {
            addChatBubble('askTeacherChat', 'assistant', '(لاحظت إنك تعرفين هذا الموضوع مسبقًا — سجّلت هذا كدليل بملفك.)');
          }
        } catch (err) {
          typingBubble.remove();
        } finally {
          input.disabled = false;
          input.focus();
        }
      });
    }

    // Ask About This Lesson (product redesign) — grounded ONLY in the current lesson.
    const askLessonForm = document.getElementById('askLessonForm');
    if (askLessonForm) {
      askLessonForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const input = document.getElementById('askLessonInput');
        const message = input.value.trim();
        if (!message) return;
        addChatBubble('askLessonChat', 'user', message);
        input.value = '';
        input.disabled = true;
        // Inline "typing" bubble instead of the full-screen setLoading overlay — this
        // panel is a compact in-context chat, not a full-screen wait state, and the
        // real grounded call (with its own JSON-retry) can take several seconds.
        const chat = document.getElementById('askLessonChat');
        const typingBubble = document.createElement('div');
        typingBubble.className = 'bubble bubble-assistant bubble-typing';
        typingBubble.textContent = 'قِيس يكتب...';
        chat.appendChild(typingBubble);
        chat.scrollTop = chat.scrollHeight;
        try {
          const result = await api('POST', `/api/lesson/${state.lessonSkillId}/ask-about`, { message });
          typingBubble.remove();
          addChatBubble('askLessonChat', 'assistant', result.reply);
        } catch (err) {
          typingBubble.remove();
        } finally {
          input.disabled = false;
          input.focus();
        }
      });
    }
  });

  function toggleAskAboutLesson() {
    const panel = document.getElementById('askLessonPanel');
    const chevron = document.getElementById('askLessonChevron');
    const willShow = panel.hidden;
    panel.hidden = !willShow;
    chevron.textContent = willShow ? '▴' : '▾';
    if (willShow && document.getElementById('askLessonChat').children.length === 0) {
      addChatBubble('askLessonChat', 'assistant', 'يمكن سؤالي عن أي شي بهذا الدرس بالذات — المفهوم أو المثال أو أي خطوة.');
    }
  }

  function addChatBubble(containerId, role, text) {
    const chat = document.getElementById(containerId);
    const div = document.createElement('div');
    div.className = `bubble bubble-${role}`;
    div.textContent = text;
    chat.appendChild(div);
    chat.scrollTop = chat.scrollHeight;
  }

  function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

  /** Fires only when the student taps "متابعة" after actually reading the
   *  mission interview's closing message — see the submit handler above for
   *  why this replaced a flat auto-transition timer. */
  function continueFromMission() {
    document.getElementById('missionContinueBtn').hidden = true;
    document.getElementById('missionForm').hidden = false; // reset for the next student's mission interview
    showMissionTransition();
  }

  // Onboarding ceremony between the mission interview finishing and the diagnostic
  // starting — was previously an instant, jarring cut straight to the quiz screen
  // with no acknowledgement that the mission was even saved. Reveals each prep
  // step in sequence so the handoff reads as "your journey is being built," not
  // as a broken transition.
  async function showMissionTransition() {
    showScreen('mission-transition');
    Companion.encourage();
    document.querySelectorAll('.prep-step').forEach((el) => el.classList.remove('done'));
    const steps = ['mission', 'profile', 'plan'];
    for (const step of steps) {
      await sleep(700);
      const el = document.querySelector(`.prep-step[data-step="${step}"]`);
      if (el) el.classList.add('done');
    }
    await sleep(500);
    startDiagnostic();
  }

  // ---------- diagnostic ----------
  async function startDiagnostic() {
    showScreen('diagnostic');
    setLoading(true, 'جاري تجهيز أسئلة التشخيص...');
    try {
      const { sessionId, items, resumeFromIndex } = await api('POST', '/api/diagnostic/start');
      state.diagnosticSessionId = sessionId;
      state.diagnosticItems = items;
      // Returning to an in-progress diagnostic (closed tab, refreshed mid-quiz)
      // picks up at the first unanswered question instead of restarting —
      // resumeFromIndex is how many of `items`, in this same server-guaranteed
      // order, already have a recorded attempt against this session.
      state.diagnosticIndex = resumeFromIndex ?? 0;
      if (state.diagnosticIndex >= state.diagnosticItems.length) {
        // Every item already has an attempt but the session was never marked
        // complete (e.g. the /complete call dropped mid-flight) — finish it
        // now rather than rendering a question that doesn't exist.
        await finishDiagnostic();
      } else {
        renderDiagnosticItem();
      }
    } finally {
      setLoading(false);
    }
  }

  function renderDiagnosticItem() {
    markQuestionShown();
    const item = state.diagnosticItems[state.diagnosticIndex];
    document.getElementById('diagCounter').textContent = `سؤال ${state.diagnosticIndex + 1} من ${state.diagnosticItems.length}`;
    document.getElementById('diagProgressFill').style.width = `${(state.diagnosticIndex / state.diagnosticItems.length) * 100}%`;
    document.getElementById('diagStem').textContent = item.stem_ar;
    document.getElementById('diagFeedback').hidden = true;

    const optionsEl = document.getElementById('diagOptions');
    optionsEl.innerHTML = '';
    item.options.forEach((optText, idx) => {
      const btn = document.createElement('button');
      btn.className = 'option-btn';
      btn.dataset.letter = ['أ','ب','ج','د'][idx] ?? '';
      btn.textContent = optText;
      btn.onclick = () => answerDiagnostic(item.id, idx, btn);
      optionsEl.appendChild(btn);
    });
  }

  async function answerDiagnostic(itemId, selectedIndex, btnEl) {
    document.querySelectorAll('#diagOptions .option-btn').forEach((b) => (b.disabled = true));
    btnEl.classList.add('selected'); // immediate feedback while the network round-trip is in flight
    const result = await api('POST', `/api/diagnostic/${state.diagnosticSessionId}/answer`, {
      itemId, selectedIndex, responseTimeMs: elapsedSinceShown(),
    });
    btnEl.classList.remove('selected');
    btnEl.classList.add(result.isCorrect ? 'correct' : 'incorrect');
    if (!result.isCorrect) {
      document.querySelectorAll('#diagOptions .option-btn')[result.correctOptionIndex]?.classList.add('correct');
    }

    setTimeout(() => {
      state.diagnosticIndex++;
      if (state.diagnosticIndex < state.diagnosticItems.length) {
        renderDiagnosticItem();
      } else {
        finishDiagnostic();
      }
    }, 700);
  }

  async function finishDiagnostic() {
    const result = await api('POST', `/api/diagnostic/${state.diagnosticSessionId}/complete`);
    showScreen('diagnostic-done');
    renderResultMascot('diagResultMascot', 'celebrating');
    document.getElementById('diagScoreHeadline').textContent = `${result.scoreEstimate}%`;
    document.getElementById('diagScoreSub').textContent =
      `تقدير أولي غير معاير — بنيت عليه ${result.recordsWritten} نقطة بداية لخطتك الشخصية.`;

    // Version 5 Phase J: real prefetch. This is the first point where the ZPD
    // recommendation is actually valid (the diagnostic's learning records were
    // just written above) — the student now spends genuine idle time reading
    // their score before tapping through, so fire the next-lesson lookup now
    // instead of waiting for loadNextLesson() to request it from a cold start.
    // Only fires for a RETURNING student who already picked a track — a new
    // student's next stop is path-select (see goToPathSelect below), which
    // doesn't know the section yet, so prefetching without one would risk
    // caching a recommendation from the wrong curriculum.
    if (state.selectedTrack) {
      api('GET', `/api/next-lesson${nextLessonQuery()}`).then((r) => { state.nextLessonPrefetch = r; }).catch(() => {});
    }
  }

  /** Demo-polish sprint: query-string suffix (including the leading "?") for
   *  every /api/next-lesson call, once a track is chosen — keeps the ZPD
   *  recommendation confined to the student's chosen curriculum instead of
   *  picking across Quantitative and Verbal interchangeably. Empty string
   *  before a track is chosen, matching the endpoint's existing (backward
   *  compatible) unfiltered behavior. */
  function nextLessonQuery() {
    return state.selectedTrack ? `?section=${state.selectedTrack}` : '';
  }

  function goToPathSelect() {
    showScreen('path-select');
  }

  /** The one place a track is set. Persists across sessions (a student
   *  shouldn't be asked again every visit) and immediately continues into
   *  the lesson flow — "only after choosing should the lesson begin." */
  function choosePath(section) {
    state.selectedTrack = section;
    state.journeySection = section;
    localStorage.setItem('qudrat_selected_track', section);
    loadNextLesson();
  }

  // ---------- next lesson (Version 3 Phase B — micro-learning stepper) ----------
  function renderLessonSkeleton(reasonAr) {
    showScreen('lesson-intro');
    document.getElementById('lessonReasonCard').hidden = false;
    document.getElementById('lessonReasonText').textContent = reasonAr || 'جاري تجهيز درسك...';
    document.getElementById('lessonTitle').textContent = 'جاري تحضير الدرس...';
    document.getElementById('lessonVoiceContainer').innerHTML = '';
    document.getElementById('lessonReviewBadge').hidden = true;
    document.getElementById('lessonVerifiedBadge').hidden = true;
    document.getElementById('lessonStepDots').innerHTML = '';

    const stepEl = document.getElementById('lessonStepContainer');
    stepEl.innerHTML = '<div class="card skeleton-card">' +
      '<div class="skeleton skeleton-line short"></div>' +
      '<div class="skeleton skeleton-line"></div>' +
      '<div class="skeleton skeleton-line" style="width:70%"></div>' +
      '</div>';

    document.getElementById('askLessonPanel').hidden = true;
    document.getElementById('askLessonChevron').textContent = '▾';
    document.getElementById('askLessonChat').innerHTML = '';

    // Real bug found during visual QA (still applies): the skeleton used to leave
    // the step-nav buttons and "اسأل عن هذا الدرس" fully clickable while
    // state.lessonItems still held the PREVIOUS lesson's items (or nothing at
    // all, on a student's very first lesson) — tapping either mid-skeleton would
    // advance into a broken/empty step or open a chat panel for content that
    // isn't loaded yet. Disable/hide both until real content lands.
    document.getElementById('lessonNextBtn').disabled = true;
    document.getElementById('lessonSkipBtn').disabled = true;
    document.getElementById('askLessonSection').hidden = true;
  }

  async function loadNextLesson() {
    // Never silently pick a curriculum for the student — if she hasn't chosen
    // Quantitative or Verbal yet, send her to that explicit choice first.
    if (!state.selectedTrack) { goToPathSelect(); return; }
    try {
      // Version 5 Phase J: consume the diagnostic-done prefetch if one landed
      // (cleared immediately so it's used at most once and never goes stale).
      let recPayload = state.nextLessonPrefetch;
      state.nextLessonPrefetch = null;
      if (!recPayload) recPayload = await api('GET', `/api/next-lesson${nextLessonQuery()}`);
      const { recommendation, hasPrebuiltLesson } = recPayload;
      if (!recommendation) return;
      state.lessonSkillId = recommendation.skillId;

      // Performance (Phase 8): a curated lesson loads from the database with no
      // LLM call — no loading state needed at all. A skill without curated
      // content yet still falls back to live generation (already hardened with
      // retries) and genuinely needs a wait — that path now shows an inline
      // skeleton shaped like the real lesson layout instead of a blocking
      // full-screen "AI is thinking" overlay, so the wait still feels like a
      // content page loading, not a chatbot.
      if (!hasPrebuiltLesson) renderLessonSkeleton(recommendation.reasonAr);
      const genResult = await api('POST', `/api/lesson/${recommendation.skillId}`);

      state.lessonSessionId = genResult.sessionId;
      state.currentLesson = genResult.lesson;
      state.lessonItems = genResult.items;
      state.lessonCorrectCount = 0;

      // Version 3 Phase B: the teaching phase is a sequence of small steps —
      // objective, one concept block at a time, an inline mini-challenge (the
      // lesson's own first practice item, reused rather than inventing new
      // content), the worked example, then a summary — instead of one long
      // scroll. The formal quiz phase afterward starts from item index 1 (the
      // mini-challenge already consumed item 0); its correctness was already
      // folded into lessonCorrectCount by the challenge step's own handler, so
      // the final accuracy % still reflects every item in the lesson.
      //
      // Version 6 Phase N: a real Hero step for EVERY lesson (universal,
      // code-driven, not authored content) — promotes the already-computed
      // ZPD reason into a genuine first step instead of a banner shown
      // outside the sequence.
      const steps = [{ type: 'hero', reasonAr: recommendation.reasonAr }];

      // Version 6 Phase O: sections[]-driven path for lessons authored with
      // the new structured content model (currently only the Golden Lesson)
      // — every other lesson (live-generated, or one of the other 7 curated
      // ones) falls back to exactly today's legacy per-block logic, unchanged.
      const hasSections = genResult.lesson.sections && genResult.lesson.sections.length > 0;
      if (hasSections) {
        genResult.lesson.sections.forEach((section) => steps.push({ type: 'section', section }));
      } else {
        steps.push({ type: 'objective' });
        genResult.lesson.concept_explanation.forEach((block) => steps.push({ type: 'concept', block }));
      }
      if (genResult.items.length > 0) steps.push({ type: 'challenge', item: genResult.items[0] });
      if (hasSections) {
        // The authored sections already included a real 'summary' section
        // (content-only) — this step is just the CTA into practice.
        steps.push({ type: 'practice_cta' });
      } else {
        steps.push({ type: 'worked_example' });
        steps.push({ type: 'summary' });
      }
      state.lessonSteps = steps;
      state.lessonStepIndex = 0;
      state.lessonIndex = genResult.items.length > 0 ? 1 : 0;

      showScreen('lesson-intro');
      // The stepper's own 'hero' step (steps[0], above) now shows this same
      // reason as real step-1 content — hide the skeleton-only static banner
      // so the sentence doesn't appear twice on screen at once.
      document.getElementById('lessonReasonCard').hidden = true;
      document.getElementById('lessonTitle').textContent = genResult.lesson.title_ar;
      // Educational Companion: a companion-voiced version of the exact same
      // zpdSelector-produced reason string already shown in the hero step
      // above — not a separate/different message, just spoken by the companion too.
      Companion.introduceTopic(genResult.lesson.title_ar, recommendation.reasonAr);

      // Version 5 Phase I: visible attribution — a real 3-state badge instead of a
      // binary ai_generated/nothing toggle, so the GroundingService's priority order
      // (published/human_reviewed content over AI generation) is demonstrable in the UI.
      const reviewBadge = document.getElementById('lessonReviewBadge');
      const verifiedBadge = document.getElementById('lessonVerifiedBadge');
      const isVerified = genResult.lesson.review_status === 'published' || genResult.lesson.review_status === 'human_reviewed';
      reviewBadge.hidden = genResult.lesson.review_status !== 'ai_generated';
      verifiedBadge.hidden = !isVerified;

      // Voice (Phase 9 + Qiyasy polish, step-scoped in Phase B): `getText()` is
      // called lazily on every play, so making it read `state.lessonStepIndex`
      // dynamically means ONE control (built once per lesson) always reads
      // whichever step is currently showing — no rebuild needed per step.
      const voiceContainer = document.getElementById('lessonVoiceContainer');
      voiceContainer.innerHTML = '';
      const voiceControl = Voice.createReadAloudControl(() => {
        const step = state.lessonSteps[state.lessonStepIndex];
        if (!step) return '';
        if (step.type === 'hero') return step.reasonAr || state.currentLesson.title_ar;
        if (step.type === 'objective') return `الهدف بنهاية هذا الدرس: إتقان "${state.currentLesson.title_ar}".`;
        if (step.type === 'concept') return step.block.text_ar;
        if (step.type === 'section') return step.section.body_ar || step.section.title_ar || state.currentLesson.title_ar;
        if (step.type === 'challenge') return step.item.stem_ar;
        if (step.type === 'worked_example') return [state.currentLesson.title_ar, ...state.currentLesson.worked_example.solution_steps_ar].join('. ');
        return state.currentLesson.title_ar;
      });
      if (voiceControl) {
        voiceContainer.appendChild(voiceControl);
        // Companion improvement: never cover the content the student is reading —
        // close the floating bubble the moment lesson narration starts (a separate
        // listener from Voice's own onclick, so it doesn't interfere with playback).
        const voiceBtn = voiceControl.querySelector('.btn-voice');
        if (voiceBtn) voiceBtn.addEventListener('click', () => Companion.hide());
      }

      // Ask About This Lesson: fresh panel per lesson, collapsed by default.
      document.getElementById('askLessonPanel').hidden = true;
      document.getElementById('askLessonChevron').textContent = '▾';
      document.getElementById('askLessonChat').innerHTML = '';

      // Real content has landed — undo the skeleton's disabled/hidden state.
      document.getElementById('lessonNextBtn').disabled = false;
      document.getElementById('lessonSkipBtn').disabled = false;
      document.getElementById('askLessonSection').hidden = false;

      renderLessonStep();
    } catch (err) {
      // api() already surfaced this via the top error banner — nothing else to do here.
    }
  }

  /** Renders whichever step is current (`state.lessonStepIndex`) — the single
   *  dispatch point every step type goes through. Reuses existing renderers/
   *  cards per block kind; nothing here is new rendering logic. */
  /** Demo-quality sprint: "progressing through levels, not reading chapters" —
   *  each step gets a short, game-like stage label instead of an anonymous
   *  dot position. Purely presentational (reads the same step data every
   *  other branch of renderLessonStep already switches on). */
  function lessonLevelLabel(step) {
    if (step.type === 'hero') return '✦ البداية';
    if (step.type === 'objective') return '🎯 الهدف';
    if (step.type === 'concept') return `${CONCEPT_ICONS[step.block.kind] || '💡'} المفهوم`;
    if (step.type === 'section') {
      const c = step.section.component;
      if (c === 'InteractiveActivityCard') return '🎮 تفاعل';
      if (c === 'WorkedExample' || c === 'StepByStepSolution') return '📐 مثال محلول';
      if (c === 'HintCard') return '💡 تلميح';
      if (c === 'CheckpointCard') return '✅ تحقّق';
      if (c === 'SummaryCard') return '📋 خلاصة';
      if (c === 'LearningObjective') return '🎯 الهدف';
      return '💡 المفهوم';
    }
    if (step.type === 'challenge') return '✍️ جرّب بنفسك';
    if (step.type === 'worked_example') return '📐 مثال محلول';
    if (step.type === 'summary') return '📋 خلاصة';
    if (step.type === 'practice_cta') return '🚀 يلا نبدأ';
    return '';
  }

  const CONCEPT_ICONS = { principle: '💡', technique: '🎯', caution: '⚠️', rule: '📐', formula: '🧮', mistake: '🚫', memory_technique: '🧠' };

  function renderLessonStep() {
    if (Voice.supported && (Voice.isSpeaking() || Voice.isPaused())) Voice.stop();

    const step = state.lessonSteps[state.lessonStepIndex];
    const container = document.getElementById('lessonStepContainer');
    container.innerHTML = '';

    document.getElementById('lessonStepDots').innerHTML = state.lessonSteps.map((_, i) => {
      const cls = i === state.lessonStepIndex ? 'active' : i < state.lessonStepIndex ? 'done' : '';
      return `<span class="lesson-step-dot ${cls}"></span>`;
    }).join('');
    document.getElementById('lessonLevelBadge').textContent = lessonLevelLabel(step);

    const nextBtn = document.getElementById('lessonNextBtn');
    const skipBtn = document.getElementById('lessonSkipBtn');
    const isLastStep = state.lessonStepIndex === state.lessonSteps.length - 1;

    // Companion: hide while this step's text first appears, return to its
    // usual spot near the lesson title shortly after — "hide while reading,
    // return when useful" happening on every single step, not just once.
    Companion.enter('hidden');
    clearTimeout(state.companionReturnTimer);
    state.companionReturnTimer = setTimeout(() => Companion.enter('inline', '#lessonTitle', 'teaching'), 1200);

    if (step.type === 'hero') {
      // Version 6 Phase N: a real Hero step, universal to every lesson —
      // uses the existing (previously unused) HeroCard via LessonRenderer,
      // sourced from the same ZPD reason string the old static banner showed.
      nextBtn.hidden = false; skipBtn.hidden = false;
      container.appendChild(LessonRenderer.renderSection({
        // Real bug found via actual rendered output (not code review): buildHeroCard
        // reads `body_ar`/`title_ar` — passing `body` here left the hero step's
        // ZPD-reason card rendering with an empty <p>, invisible on screen.
        component: 'HeroCard', body_ar: step.reasonAr,
      }));
    } else if (step.type === 'objective') {
      nextBtn.hidden = false; skipBtn.hidden = false;
      const card = document.createElement('div');
      card.className = 'card lesson-step-card';
      card.innerHTML = `<span class="concept-card-label">🎯 الهدف</span><p class="concept-card-text"></p>`;
      card.querySelector('p').textContent = `بنهاية هذا الدرس، بتكون متقن "${state.currentLesson.title_ar}".`;
      container.appendChild(card);
    } else if (step.type === 'concept') {
      nextBtn.hidden = false; skipBtn.hidden = false;
      // Educational Rendering Engine: still hands data to the SAME renderer,
      // just one block at a time instead of the whole array at once — zero
      // change to lesson-renderer.js, which already handles any block kind.
      LessonRenderer.renderConceptBlocks(container, [step.block]);
    } else if (step.type === 'section') {
      // Version 6 Phase O: sections[]-driven content (currently only the
      // Golden Lesson). The interactive-activity section is the one case
      // where "the answer IS the advance" (same convention as 'challenge')
      // — every other section type behaves like 'concept'/'worked_example'.
      const isActivity = step.section.component === 'InteractiveActivityCard';
      nextBtn.hidden = isActivity;
      skipBtn.hidden = false;
      if (isActivity) {
        container.appendChild(Cards.InteractiveActivityCard(
          step.section.parameters?.variant, step.section.parameters || {},
          () => { nextBtn.hidden = false; }
        ));
      } else {
        const node = LessonRenderer.renderSection(step.section);
        if (node) container.appendChild(node);
      }
    } else if (step.type === 'challenge') {
      nextBtn.hidden = true; skipBtn.hidden = false; // the answer tap IS the advance
      renderLessonChallenge(step.item, container);
    } else if (step.type === 'worked_example') {
      nextBtn.hidden = false; skipBtn.hidden = false;
      LessonRenderer.renderWorkedExample(container, state.currentLesson.worked_example);
    } else if (step.type === 'summary') {
      nextBtn.hidden = true; skipBtn.hidden = true;
      const points = state.currentLesson.concept_explanation.map((b) => {
        const firstSentence = b.text_ar.split(/(?<=[.؟!])\s/)[0];
        return firstSentence.length < b.text_ar.length ? firstSentence : b.text_ar;
      });
      container.appendChild(Cards.SummaryCard(state.currentLesson.title_ar, points));
      const startBtn = document.createElement('button');
      startBtn.type = 'button';
      startBtn.className = 'btn-primary';
      startBtn.textContent = 'ابدأ التدريب ←';
      startBtn.onclick = () => startLessonQuiz();
      container.appendChild(startBtn);
    } else if (step.type === 'practice_cta') {
      // Version 6 Phase O: the sections[]-driven path's authored 'summary'
      // section already showed the recap (content-only, via renderSection) —
      // this step is just the CTA into practice, mirroring 'summary''s button.
      nextBtn.hidden = true; skipBtn.hidden = true;
      const startBtn = document.createElement('button');
      startBtn.type = 'button';
      startBtn.className = 'btn-primary';
      startBtn.textContent = 'ابدأ التدريب ←';
      startBtn.onclick = () => startLessonQuiz();
      container.appendChild(startBtn);
    }

    if (isLastStep) nextBtn.hidden = true;
  }

  function goToNextLessonStep() {
    if (state.lessonStepIndex < state.lessonSteps.length - 1) {
      state.lessonStepIndex++;
      renderLessonStep();
    }
  }

  /** Escape hatch for students who don't want the guided walkthrough — jumps
   *  straight to the formal quiz. Deliberately not removed: forcing every
   *  step with no way out would trap returning/confident students.
   *  Real bug found via testing: `state.lessonIndex` starts at 1 (skipping
   *  item 0, which the mini-challenge step would have answered) — if that
   *  step never actually ran because the student skipped past it, item 0
   *  would silently never be asked at all. Reset to 0 here so skipping still
   *  covers every item, just without the guided pacing. */
  function skipToLessonQuiz() {
    clearTimeout(state.companionReturnTimer);
    state.lessonIndex = 0;
    startLessonQuiz();
  }

  /** The mini-challenge step: the lesson's OWN first practice item, answered
   *  inline through the exact same lesson-session answer endpoint the formal
   *  quiz already uses — real scoring, real feedback, zero new content.
   *  Version 6 Phase N: rebuilt on the new Cards.QuizCard (consolidates what
   *  used to be a hand-built QuizOptions+FeedbackCard composition) and now
   *  offers an in-flow hint — this step previously had zero hint UI even
   *  though the identically-shaped formal quiz question right after it does. */
  function renderLessonChallenge(item, container) {
    markQuestionShown();
    const label = document.createElement('span');
    label.className = 'concept-card-label';
    label.textContent = '⚡ جرّب الآن';
    container.appendChild(label);

    let hintLevel = 0;
    const quizCard = Cards.QuizCard(item, {
      onAnswer: async (selectedIndex) => {
        const result = await api('POST', `/api/lesson-session/${state.lessonSessionId}/answer`, {
          itemId: item.id, selectedIndex, responseTimeMs: elapsedSinceShown(),
        });
        if (result.isCorrect) state.lessonCorrectCount++;
        if (!result.isCorrect) {
          Companion.explainMistake(result.wrongAnswerExplanation || result.commonMistake || result.explanation);
        } else {
          Companion.reactCorrect();
        }
        noteAnswerOutcome(result.isCorrect);
        setTimeout(() => {
          state.lessonStepIndex++;
          renderLessonStep();
        }, 1800);
        return result;
      },
      onHint: async () => {
        hintLevel++;
        return api('POST', `/api/practice-item/${item.id}/hint`, { level: hintLevel });
      },
    });
    container.appendChild(quizCard);
  }

  function startLessonQuiz() {
    showScreen('lesson-quiz');
    Companion.introduceQuiz();
    renderLessonItem();
    // Snapshot XP before the quiz (non-blocking, doesn't delay quiz start, and
    // deliberately bypasses api()'s error banner — this is a best-effort snapshot
    // for a celebration extra, not something worth alarming the student over)
    // so the result screen can show a real "+N XP" gain instead of just accuracy %.
    fetchProfileQuiet().then((p) => { if (p) state.xpBeforeLesson = p.xp; });
  }

  async function fetchProfileQuiet() {
    try {
      const token = getAuthToken();
      const headers = token ? { Authorization: `Bearer ${token}` } : undefined;
      const res = await fetch('/api/profile', { headers });
      if (!res.ok) return null;
      return await res.json();
    } catch (e) {
      return null;
    }
  }

  function renderLessonItem() {
    markQuestionShown();
    startLearningTimer(document.getElementById('lessonTimer'));
    const item = state.lessonItems[state.lessonIndex];
    document.getElementById('lessonCounter').textContent = `سؤال ${state.lessonIndex + 1} من ${state.lessonItems.length}`;
    document.getElementById('lessonProgressFill').style.width = `${(state.lessonIndex / state.lessonItems.length) * 100}%`;
    document.getElementById('lessonStem').textContent = item.stem_ar;
    document.getElementById('lessonFeedback').hidden = true;

    const optionsEl = document.getElementById('lessonOptions');
    optionsEl.innerHTML = '';
    optionsEl.appendChild(Cards.QuizOptions(item.options, (idx, btn) => answerLesson(item.id, idx, btn)));

    // Hint (Version 2 Phase 1): fresh per item, up to two taps — first tap
    // serves hint_1_ar, second tap serves hint_2_ar (both instant for curated
    // items, no LLM call). Un-batched items fall back to live AI generation.
    state.lessonHintLevel = 0;
    document.getElementById('lessonHintBtn').hidden = false;
    document.getElementById('lessonHintBtn').textContent = '💡 تلميح';
    document.getElementById('lessonHintContainer').innerHTML = '';
  }

  async function requestLessonHint() {
    const item = state.lessonItems[state.lessonIndex];
    const hintBtn = document.getElementById('lessonHintBtn');
    const hintContainer = document.getElementById('lessonHintContainer');
    const nextLevel = state.lessonHintLevel + 1;
    hintBtn.disabled = true;
    const isCurated = item.source === 'curated';
    if (!isCurated) hintBtn.textContent = '💡 جاري التحضير...';
    try {
      const { hint, hasMore, source } = await api('POST', `/api/practice-item/${item.id}/hint`, { level: nextLevel });
      state.lessonHintLevel = nextLevel;
      hintContainer.innerHTML = '';
      hintContainer.appendChild(Cards.HintCard(hint, source));
      if (hasMore) {
        hintBtn.disabled = false;
        hintBtn.textContent = '💡 تلميح إضافي';
      } else {
        hintBtn.hidden = true;
      }
    } catch (err) {
      hintBtn.disabled = false;
      hintBtn.textContent = '💡 تلميح';
    }
  }

  async function answerLesson(itemId, selectedIndex, btnEl) {
    stopLearningTimer();
    document.querySelectorAll('#lessonOptions .option-btn').forEach((b) => (b.disabled = true));
    btnEl.classList.add('selected');
    const item = state.lessonItems[state.lessonIndex];
    const result = await api('POST', `/api/lesson-session/${state.lessonSessionId}/answer`, {
      itemId, selectedIndex, responseTimeMs: elapsedSinceShown(),
    });
    if (result.isCorrect) state.lessonCorrectCount++;
    btnEl.classList.remove('selected');
    btnEl.classList.add(result.isCorrect ? 'correct' : 'incorrect', 'answer-pop');
    if (!result.isCorrect) {
      document.querySelectorAll('#lessonOptions .option-btn')[result.correctOptionIndex]?.classList.add('correct');
    }

    const isHardItem = (item?.difficulty_level ?? 0) >= 4;
    const headline = result.isCorrect
      ? (isHardItem ? 'ممتاز! هذا كان السؤال الأصعب بالمجموعة 🌟' : 'إجابة ممتازة!')
      : (isHardItem ? 'إجابة قريبة من الصحيح — هذا سؤال يخدع كثير من الطلاب' : 'الإجابة مو صحيحة، بس هذي بالضبط طريقة نتعلم فيها');

    const feedbackEl = document.getElementById('lessonFeedback');
    feedbackEl.hidden = false;
    feedbackEl.innerHTML = '';
    feedbackEl.appendChild(Cards.FeedbackCard(result.isCorrect, headline, result.explanation));

    // Version 2, Phase 1: curated mistake/memory-tip content, only ever shown
    // after the answer is revealed — never before, where it could hint at the
    // correct option.
    let extraCardShown = false;
    if (!result.isCorrect && result.wrongAnswerExplanation) {
      feedbackEl.appendChild(Cards.CommonMistakeCard({ text_ar: result.wrongAnswerExplanation }));
      extraCardShown = true;
    }
    if (!result.isCorrect && result.commonMistake) {
      feedbackEl.appendChild(Cards.CommonMistakeCard({ text_ar: result.commonMistake }));
      extraCardShown = true;
    }
    if (result.memoryTip) {
      feedbackEl.appendChild(Cards.MemoryTechniqueCard({ text_ar: result.memoryTip }));
      extraCardShown = true;
    }

    if (!result.isCorrect) {
      Companion.explainMistake(result.wrongAnswerExplanation || result.commonMistake || result.explanation);
    } else {
      Companion.reactCorrect();
    }
    noteAnswerOutcome(result.isCorrect);

    setTimeout(() => {
      state.lessonIndex++;
      if (state.lessonIndex < state.lessonItems.length) {
        renderLessonItem();
      } else {
        finishLesson();
      }
    }, extraCardShown ? 4200 : 1600);
  }

  async function finishLesson() {
    const result = await api('POST', `/api/lesson-session/${state.lessonSessionId}/complete`, {
      skillId: state.lessonSkillId,
    });
    showScreen('lesson-result');
    const accuracy = Math.round((state.lessonCorrectCount / state.lessonItems.length) * 100);
    document.getElementById('lessonResultHeadline').textContent = `${accuracy}%`;
    const badge = document.getElementById('celebrationBadge');
    renderResultMascot('lessonResultMascot', accuracy >= 60 ? 'celebrating' : 'encouraging');

    if (result.recordsWritten.length > 0) {
      const r = result.recordsWritten[0];
      if (r.type === 'mastery' && r.confidence === 'confirmed') {
        badge.textContent = '🏆';
        badge.className = 'celebration-badge celebrate-big';
        document.getElementById('lessonResultSub').textContent = 'تم إتقان هذي المهارة فعلاً — تأكدنا منها بدليلين منفصلين، مو مجرد إجابة صح.';
      } else if (r.type === 'mastery') {
        badge.textContent = '🌱';
        badge.className = 'celebration-badge celebrate-small';
        document.getElementById('lessonResultSub').textContent = 'بداية قوية! هذا أول دليل على إتقانك — بنتأكد منه مرة ثانية قريبًا.';
      } else {
        badge.textContent = '💡';
        badge.className = 'celebration-badge celebrate-small';
        document.getElementById('lessonResultSub').textContent = 'تصحيح الفهم بالاعتماد على النفس — هذا أهم فعليًا من الإجابة الصحيحة من أول محاولة.';
      }
    } else {
      badge.textContent = '📘';
      badge.className = 'celebration-badge';
      document.getElementById('lessonResultSub').textContent =
        'أداء جيد، لكن نحتاج دليل أقوى قبل ما نسجّل إتقان رسمي — بنعيد اختبار هذي المهارة قريبًا.';
    }
    Companion.celebrate(document.getElementById('lessonResultSub').textContent);

    // Celebration extras: real "+N XP" (diffed client-side against the pre-quiz
    // snapshot) and any badge newly unlocked by this lesson — both already exist
    // server-side (GET /api/profile, result.newBadges) but were never surfaced at
    // this moment before, so a completed lesson felt like just a percentage.
    const xpContainer = document.getElementById('lessonResultXp');
    xpContainer.innerHTML = '';
    const afterProfile = await fetchProfileQuiet();
    if (afterProfile && state.xpBeforeLesson != null) {
      const gained = Math.max(0, afterProfile.xp - state.xpBeforeLesson);
      if (gained > 0) {
        const pill = document.createElement('div');
        pill.className = 'xp-gain-pill';
        pill.innerHTML = `<span class="xp-gain-pill-icon">⚡</span><span>+${gained} XP</span>`;
        xpContainer.appendChild(pill);
      }
    }
    state.xpBeforeLesson = null;

    const badgesContainer = document.getElementById('lessonResultBadges');
    badgesContainer.innerHTML = '';
    if (result.newBadges && result.newBadges.length > 0) {
      const heading = document.createElement('p');
      heading.className = 'new-badge-heading';
      heading.textContent = '🎉 إنجاز جديد!';
      badgesContainer.appendChild(heading);
      result.newBadges.forEach((b) => badgesContainer.appendChild(Cards.AchievementCard(b)));
    }

    // Timing analytics (Version 3 Phase C) — real, already-stored per-attempt
    // timing, surfaced the same way the mock exam's review screen does.
    if (result.timingBySkill) renderTimingBySkill(result.timingBySkill, 'lessonTimingSection', 'lessonTimingList');
  }

  // ---------- home-dashboard microinteraction helpers (Version 2 Phase 3) ----------

  function isToday(isoString) {
    if (!isoString) return false;
    const d = new Date(isoString);
    const now = new Date();
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  }

  /** Counts a number up (never an instant jump) — used for the XP total. */
  function countUp(el, from, to, { suffix = '', duration = 900 } = {}) {
    if (from === to) { el.textContent = `${to}${suffix}`; return; }
    const start = performance.now();
    function tick(now) {
      const progress = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      const value = Math.round(from + (to - from) * eased);
      el.textContent = `${value}${suffix}`;
      if (progress < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  /** Animates every [data-target-width] bar inside `root` from 0 -> its real
   *  width. Double rAF so the browser paints the 0% state first — otherwise
   *  the CSS transition has nothing to animate FROM (set-and-transition in
   *  the same paint frame renders as an instant jump, not a fill-in). */
  function animateFillBars(root) {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        root.querySelectorAll('[data-target-width]').forEach((fillEl) => {
          fillEl.style.width = `${fillEl.dataset.targetWidth}%`;
        });
      });
    });
  }

  /** A small, tasteful confetti burst — pure CSS/JS, no library — for real
   *  milestones only (today's mission complete, badge unlock, level up). */
  function spawnConfetti() {
    const phone = document.querySelector('.phone');
    if (!phone) return;
    const colors = ['#1E3A8A', '#14B8A6', '#197998', '#FFD166', '#C1443B'];
    for (let i = 0; i < 24; i++) {
      const piece = document.createElement('div');
      piece.className = 'confetti-piece';
      piece.style.left = `${Math.random() * 100}%`;
      piece.style.background = colors[i % colors.length];
      piece.style.borderRadius = Math.random() > 0.5 ? '50%' : '2px';
      piece.style.animationDelay = `${(Math.random() * 0.3).toFixed(2)}s`;
      piece.style.animationDuration = `${(1.2 + Math.random() * 0.8).toFixed(2)}s`;
      phone.appendChild(piece);
      piece.addEventListener('animationend', () => piece.remove());
    }
  }

  // ---------- dashboard: a HOME screen, not a stats page (Version 2 Phase 3) ----------
  async function goToDashboard() {
    showScreen('dashboard');
    const [d, profile, nextLesson] = await Promise.all([
      api('GET', '/api/dashboard'), api('GET', '/api/profile'), api('GET', `/api/next-lesson${nextLessonQuery()}`),
    ]);
    const categoryLabel = (c) => Cards.CATEGORY_LABELS[c.category] || c.category;

    // Performance (Phase 8, sprint area 4): a curated lesson already loads with
    // no LLM wait — `hasPrebuiltLesson` tells us the ONE case that still needs a
    // live generation call. Warm it in the background the moment we know which
    // skill is next, so by the time the student actually taps "continue," the
    // lesson generator's own "reuse instead of regenerate" check (already what
    // makes curated lessons instant) finds it already sitting in the database.
    // Fire-and-forget, once per skill per page load — /api/lesson/:id/warm never
    // creates a session, so this can never fabricate a study day or affect streak.
    if (nextLesson.recommendation && !nextLesson.hasPrebuiltLesson) {
      const skillId = nextLesson.recommendation.skillId;
      if (!state.warmedLessonSkillIds) state.warmedLessonSkillIds = new Set();
      if (!state.warmedLessonSkillIds.has(skillId)) {
        state.warmedLessonSkillIds.add(skillId);
        api('POST', `/api/lesson/${skillId}/warm`).catch(() => {});
      }
    }

    renderProfileWidgets(profile);
    refreshNotificationBadge();

    // ---------- 1. hero ----------
    const heroAvatar = document.getElementById('heroCompanionAvatar');
    if (!heroAvatar.dataset.rendered) {
      heroAvatar.innerHTML = Companion.mascotMarkup();
      Companion.applyState(heroAvatar, 'idle');
      heroAvatar.dataset.rendered = 'true';
    }
    // The hero's subline doubles as "today's recommendation" when one exists —
    // a generic motivational line otherwise (e.g. every skill currently mastered).
    document.getElementById('dashboardMotivation').textContent = nextLesson.recommendation
      ? `اليوم نركّز على "${nextLesson.recommendation.skillNameAr}"`
      : HERO_MOTIVATIONS[Math.floor(Math.random() * HERO_MOTIVATIONS.length)];
    document.getElementById('heroTarget').textContent = d.target ?? '—';
    document.getElementById('heroCurrent').textContent = d.current ?? '—';
    document.getElementById('heroDays').textContent = d.daysToExam !== null ? d.daysToExam : '—';
    if (d.baseline !== null && d.target !== null) {
      const progress = Math.max(0, Math.min(1, (d.current - d.baseline) / (d.target - d.baseline || 1)));
      const circumference = 326.7; // 2 * PI * 52 (the ring's radius)
      requestAnimationFrame(() => {
        document.getElementById('heroRingFill').style.strokeDashoffset = `${circumference * (1 - progress)}`;
      });
    }

    // ---------- 2. continue learning (the biggest, unmissable card) ----------
    const continueTitleEl = document.getElementById('continueCardTitle');
    const continueTierEl = document.getElementById('continueCardTier');
    const continueIconEl = document.getElementById('continueCardIcon');
    const continueDurationEl = document.getElementById('continueCardDuration');
    if (nextLesson.recommendation) {
      continueTitleEl.textContent = nextLesson.recommendation.skillNameAr;
      const tierLabels = { 1: '🔁 مراجعة سريعة', 2: '⏰ مراجعة مستحقة', 3: '✨ مهارة جديدة' };
      continueTierEl.textContent = tierLabels[nextLesson.recommendation.priorityTier] || '📘 الدرس التالي';
      continueIconEl.textContent = nextLesson.hasPrebuiltLesson ? '📘' : '🛠️';
      // Version 5 Phase L: a real estimate derived server-side from the actual
      // lesson's content length — never a fabricated number. When the lesson
      // still needs live generation, its real size isn't known yet, so this
      // honestly says "depends on pace" instead of guessing a range.
      continueDurationEl.textContent = nextLesson.estimatedMinutes
        ? `⏱ ${nextLesson.estimatedMinutes} دقائق تقريبًا`
        : '⏱ يعتمد على سرعتك';
    } else {
      continueTitleEl.textContent = 'أتممت كل ما هو متاح حاليًا 🎉';
      continueTierEl.textContent = 'عمل رائع';
      continueDurationEl.textContent = '';
    }

    // ---------- 3. learning journey (roadmap, replaces the static arc) ----------
    const journeyTrack = document.getElementById('journeyTrack');
    journeyTrack.innerHTML = '';
    const doneSkills = d.skills.filter((s) => s.status === 'mastery' && s.confidence === 'confirmed').slice(-5);
    doneSkills.forEach((s) => journeyTrack.appendChild(Cards.JourneyNode(s.name_ar, 'done')));
    if (nextLesson.recommendation) {
      journeyTrack.appendChild(Cards.JourneyNode(nextLesson.recommendation.skillNameAr, 'current'));
    }
    d.skills
      .filter((s) => s.status === 'untouched' && (!nextLesson.recommendation || s.id !== nextLesson.recommendation.skillId))
      .slice(0, 4)
      .forEach((s) => journeyTrack.appendChild(Cards.JourneyNode(s.name_ar, 'upcoming')));
    journeyTrack.appendChild(Cards.JourneyNode('الاختبار التجريبي', 'exam'));

    // ---------- 4. today's mission (derived client-side, no new backend flags) ----------
    const todayLesson = profile.studyHistory.some((s) => s.sessionType === 'lesson' && isToday(s.completedAt));
    const todayPractice = profile.studyHistory.some((s) => (s.sessionType === 'practice' || s.sessionType === 'lesson') && isToday(s.completedAt));
    const todayAny = profile.studyHistory.some((s) => isToday(s.completedAt));
    const missionItems = [
      { text: 'أكمل درسًا اليوم', done: todayLesson },
      { text: 'تدرّب على أسئلة إضافية', done: todayPractice },
      { text: 'حافظ على سلسلتك', done: todayAny && profile.streak.current > 0 },
      { text: 'اكسب نقاط خبرة جديدة', done: todayAny },
    ];
    const missionListEl = document.getElementById('missionList');
    missionListEl.innerHTML = '';
    missionItems.forEach((m) => missionListEl.appendChild(Cards.MissionItem(m.text, m.done)));
    const missionPercent = Math.round((missionItems.filter((m) => m.done).length / missionItems.length) * 100);
    document.getElementById('missionPercent').textContent = `${missionPercent}%`;
    requestAnimationFrame(() => { document.getElementById('missionProgressFill').style.width = `${missionPercent}%`; });
    if (missionPercent === 100) {
      const celebratedKey = `qudrat_mission_celebrated_${new Date().toISOString().slice(0, 10)}`;
      let alreadyCelebrated = false;
      try { alreadyCelebrated = localStorage.getItem(celebratedKey) === 'true'; } catch (e) { /* ignore */ }
      if (!alreadyCelebrated) {
        spawnConfetti();
        Companion.celebrate('أنجزت مهمة اليوم بالكامل! 🎉 استمرارك هذا هو اللي يصنع الفرق.');
        try { localStorage.setItem(celebratedKey, 'true'); } catch (e) { /* ignore */ }
      }
    }

    // ---------- 5. companion card (integrated in the page, not floating) ----------
    const companionCardContainer = document.getElementById('companionCardContainer');
    companionCardContainer.innerHTML = '';
    const xpToNextLevel = Math.max(0, profile.level.xpForNextLevel - profile.level.xpIntoLevel);
    let companionMsg;
    if (xpToNextLevel > 0 && xpToNextLevel <= 30) {
      companionMsg = `ممتاز! بقي لك ${xpToNextLevel} نقطة خبرة بس علشان توصل المستوى ${profile.level.level + 1} 🚀`;
    } else if (profile.weakTopics.length > 0) {
      companionMsg = `لاحظت إن "${categoryLabel(profile.weakTopics[0])}" محتاجة شوي مراجعة — نبدأ فيها اليوم؟`;
    } else {
      companionMsg = 'كل خطوة تسويها اليوم تقرّبك من هدفك أكثر. يلا نكمل 💪';
    }
    companionCardContainer.appendChild(Companion.renderInlineCard(companionMsg));

    // "مراجعة" nav badge — unrelated to any single dashboard section, stays
    // visible across every screen, so it's kept updated here regardless of
    // what else changed in this redesign. Bottom-nav and sidebar-nav are two
    // separate DOM elements (only one is ever visually shown, per CSS
    // breakpoint), so both copies need the same update.
    document.querySelectorAll('#practiceBadge, #practiceBadgeSidebar').forEach((navPracticeBadge) => {
      navPracticeBadge.textContent = d.duePracticeCount;
      navPracticeBadge.hidden = d.duePracticeCount === 0;
    });

    // ---------- 10. upcoming ----------
    const upcomingListEl = document.getElementById('upcomingList');
    upcomingListEl.innerHTML = '';
    if (d.duePracticeCount > 0) {
      upcomingListEl.appendChild(Cards.UpcomingItem('⏰',
        d.duePracticeCount === 1 ? 'مهارة واحدة تحتاج مراجعة' : `${d.duePracticeCount} مهارات تحتاج مراجعة`,
        'مراجعة قصيرة تحافظ على قوة تذكّرك', () => App.goToPracticeQueue()));
    }
    if (d.daysToExam !== null && d.daysToExam <= 14) {
      upcomingListEl.appendChild(Cards.UpcomingItem('📅', 'اقترب موعد اختبارك',
        `باقي ${d.daysToExam} يوم — وقت زيادة وتيرة المراجعة`, null));
    }
    upcomingListEl.appendChild(Cards.UpcomingItem('🏆', 'اختبار تجريبي كامل',
      'يحاكي تجربة القدرات الحقيقية', () => App.startMockExam()));
    document.getElementById('upcomingSection').hidden = upcomingListEl.children.length === 0;

    // Educational Companion (Version 2 Phase 2): memory refreshed opportunistically
    // from data this call already fetched — no new polling. First dashboard visit
    // this session gets a floating greeting; later visits surface whichever is most
    // useful right now (a weak skill to revisit, a streak worth celebrating, or a
    // plain nudge) — never repeating the same greeting every time. This is the
    // FLOATING layer; the hero/companion-card above are the "integrated" layer —
    // the companion appears in all three modes the product spec asks for.
    Companion.updateMemory({
      name: profile.displayName || null,
      targetScore: d.target,
      daysToExam: d.daysToExam,
      weakSkills: profile.weakTopics.map(categoryLabel),
      strongSkills: profile.strengths.map(categoryLabel),
      streak: profile.streak,
      recentBadges: profile.badges,
      // Companion panel action "راجع جلسة اليوم" (Review today's session) —
      // reuses the same studyHistory the recent-activity list already renders,
      // no new endpoint.
      studyHistory: profile.studyHistory,
    });
    if (!state.companionGreetedDashboard) {
      state.companionGreetedDashboard = true;
      Companion.greet();
    } else if (profile.weakTopics.length > 0) {
      Companion.warnWeakSkill(categoryLabel(profile.weakTopics[0]));
    } else if (profile.streak.current >= 3) {
      Companion.celebrate(`${profile.streak.current} أيام متتالية من المذاكرة! استمر 🔥`);
    } else {
      Companion.encourage();
    }
  }

  // ---------- gamification / profile widgets (product redesign) ----------
  function renderProfileWidgets(profile) {
    const hour = new Date().getHours();
    const greeting = hour < 12 ? 'صباح الخير' : hour < 18 ? 'مساء الخير' : 'مساء النور';
    document.getElementById('dashboardWelcome').textContent =
      profile.displayName ? `${greeting}، ${profile.displayName} 👋` : `${greeting} 👋`;

    const xpContainer = document.getElementById('xpCardContainer');
    xpContainer.innerHTML = '';
    xpContainer.appendChild(Cards.XPCard(profile.xp, profile.level));
    const xpTotalEl = xpContainer.querySelector('.xp-card-total');
    countUp(xpTotalEl, state.lastKnownXp ?? 0, profile.xp, { suffix: ' XP' });

    // Celebrate a real level-up exactly once (only when we actually witnessed
    // the transition — a brand-new session's first load isn't "a level up").
    if (state.lastKnownLevel !== null && profile.level.level > state.lastKnownLevel) {
      spawnConfetti();
      Companion.celebrate(`وصلت المستوى ${profile.level.level}! 🎉 تقدمك واضح.`);
    }
    state.lastKnownXp = profile.xp;
    state.lastKnownLevel = profile.level.level;
    animateFillBars(xpContainer);

    const streakContainer = document.getElementById('streakCardContainer');
    streakContainer.innerHTML = '';
    streakContainer.appendChild(Cards.StreakCard(profile.streak));

    // Streak milestone celebration (once per milestone, remembered per browser —
    // no new backend flag needed, this is purely a "have I shown this before" note).
    const STREAK_MILESTONES = [3, 7, 14, 30, 50, 100];
    if (STREAK_MILESTONES.includes(profile.streak.current)) {
      const milestoneKey = `qudrat_streak_celebrated_${profile.streak.current}`;
      let alreadyCelebrated = false;
      try { alreadyCelebrated = localStorage.getItem(milestoneKey) === 'true'; } catch (e) { /* ignore */ }
      if (!alreadyCelebrated) {
        spawnConfetti();
        Companion.celebrate(`${profile.streak.current} يوم متتالي! 🔥 سلسلة تستاهل الفخر.`);
        try { localStorage.setItem(milestoneKey, 'true'); } catch (e) { /* ignore */ }
      }
    }

    const achievementsSection = document.getElementById('achievementsSection');
    const achievementsList = document.getElementById('achievementsList');
    achievementsList.innerHTML = '';
    achievementsSection.hidden = false;
    if (profile.badges.length > 0) {
      profile.badges.forEach((b) => achievementsList.appendChild(Cards.AchievementCard(b)));
    } else {
      achievementsList.appendChild(Cards.EmptyState('🏅', 'أول إنجاز لك بانتظارك — أكملي أول درس أو تشخيص وبيظهر هنا.'));
    }

    // Skill progress (Version 2 Phase 3): masteryByTopic covers EVERY category
    // including ones never attempted (0%, attemptedSkills===0) — filtered out
    // here the same way getWeakTopics() already does server-side ("untouched
    // is 'not started,' not 'weak'"), so a brand-new student sees a handful of
    // real bars instead of a wall of empty ones.
    const skillProgressSection = document.getElementById('skillProgressSection');
    const skillProgressList = document.getElementById('skillProgressList');
    skillProgressList.innerHTML = '';
    const touchedTopics = profile.masteryByTopic.filter((c) => c.attemptedSkills > 0);
    skillProgressSection.hidden = false;
    if (touchedTopics.length > 0) {
      touchedTopics.forEach((c) => skillProgressList.appendChild(Cards.SkillProgressBar(c)));
      animateFillBars(skillProgressList);
    } else {
      skillProgressList.appendChild(Cards.EmptyState('📊', 'رح تشوفين تقدمك بكل مهارة هنا أول ما تبدئين المذاكرة.'));
    }

    const activitySection = document.getElementById('recentActivitySection');
    const activityList = document.getElementById('recentActivityList');
    activityList.innerHTML = '';
    activitySection.hidden = false;
    if (profile.studyHistory.length > 0) {
      profile.studyHistory.slice(0, 6).forEach((s) => activityList.appendChild(Cards.ActivityCard(s)));
    } else {
      activityList.appendChild(Cards.EmptyState('🕓', 'نشاطك الأخير بيظهر هنا — درس، تمرين، أو اختبار تجريبي.'));
    }
  }

  // ---------- Version 3 Phase D: full curriculum journey (Quant / Verbal) ----------
  async function goToJourney(section) {
    showScreen('journey');
    const [d, nextLesson] = await Promise.all([api('GET', '/api/dashboard'), api('GET', `/api/next-lesson${nextLessonQuery()}`)]);
    state.journeyDashboardData = d;
    state.journeyNextLessonData = nextLesson;
    selectJourneySection(section || state.journeySection || 'quantitative');
  }

  function selectJourneySection(section) {
    state.journeySection = section;
    document.querySelectorAll('.journey-tab').forEach((t) => t.classList.toggle('active', t.dataset.section === section));
    if (!state.journeyDashboardData) return; // tab tapped before the initial fetch landed — goToJourney's own call will render once it does
    renderJourneySection(section, state.journeyDashboardData, state.journeyNextLessonData);
  }

  function renderJourneySection(section, d, nextLesson) {
    const sectionSkills = d.skills
      .filter((s) => s.section === section)
      .sort((a, b) => a.baseDifficulty - b.baseDifficulty);
    const masteredCount = sectionSkills.filter((s) => s.status === 'mastery' && s.confidence === 'confirmed').length;

    document.getElementById('journeySummary').textContent = `${masteredCount} من ${sectionSkills.length} مهارة`;
    const percent = sectionSkills.length > 0 ? Math.round((masteredCount / sectionSkills.length) * 100) : 0;
    requestAnimationFrame(() => {
      document.getElementById('journeySectionProgressFill').style.width = `${percent}%`;
    });

    const currentSkillId = nextLesson.recommendation && sectionSkills.some((s) => s.id === nextLesson.recommendation.skillId)
      ? nextLesson.recommendation.skillId
      : null;

    const track = document.getElementById('journeyFullTrack');
    track.innerHTML = '';
    sectionSkills.forEach((s) => {
      let nodeState;
      if (s.status === 'mastery' && s.confidence === 'confirmed') nodeState = 'done';
      else if (s.id === currentSkillId) nodeState = 'current';
      else nodeState = 'upcoming';
      track.appendChild(Cards.JourneyNode(s.name_ar, nodeState, true));
    });
    track.appendChild(Cards.JourneyNode('الاختبار التجريبي', 'exam', true));
  }

  // ---------- notifications ----------
  async function refreshNotificationBadge() {
    try {
      const { unreadCount } = await api('GET', '/api/notifications');
      const badge = document.getElementById('notificationBadge');
      badge.hidden = unreadCount === 0;
    } catch (err) {
      // non-critical — the bell just won't show a badge this load
    }
  }

  async function goToNotifications() {
    showScreen('notifications');
    const { notifications } = await api('GET', '/api/notifications');
    const emptyNote = document.getElementById('notificationsEmptyNote');
    const list = document.getElementById('notificationsList');
    list.innerHTML = '';
    if (notifications.length === 0) {
      emptyNote.hidden = false;
      return;
    }
    emptyNote.hidden = true;
    notifications.forEach((n) => list.appendChild(Cards.NotificationCard(n, markNotificationRead)));
    document.getElementById('notificationBadge').hidden = true;

    if (notifications.some((n) => n.type === 'streak_reminder' && !n.isRead)) Companion.encourage();
  }

  async function markNotificationRead(notificationId) {
    await api('POST', `/api/notifications/${notificationId}/read`, {});
    goToNotifications();
  }

  // ---------- practice queue (spaced repetition) ----------
  let practiceQueueState = { items: [], index: 0, sessionId: null };

  // Version 5 Phase J: this is a pure synchronous DB read (no LLM involved) — a
  // full-screen "جاري التحميل" overlay implied an AI wait that was never happening.
  // Removed; the screen now shows its real content directly, near-instantly.
  async function goToPracticeQueue() {
    showScreen('practice');
    const { queue } = await api('GET', '/api/practice/queue');
    practiceQueueState = { items: queue, index: 0, sessionId: null };
    const emptyNote = document.getElementById('practiceEmptyNote');
    const quizArea = document.getElementById('practiceQuizArea');
    if (queue.length === 0) {
      emptyNote.hidden = false;
      quizArea.innerHTML = '';
    } else {
      emptyNote.hidden = true;
      renderPracticeItem();
    }
  }

  function renderPracticeItem() {
    markQuestionShown();
    const entry = practiceQueueState.items[practiceQueueState.index];
    const quizArea = document.getElementById('practiceQuizArea');
    const pct = (practiceQueueState.index / practiceQueueState.items.length) * 100;
    quizArea.innerHTML = `
      <div class="quiz-progress-header">
        <div class="quiz-counter-row">
          <p class="quiz-progress-label counter-ltr">${practiceQueueState.index + 1} / ${practiceQueueState.items.length}</p>
          <span class="learning-mode-badge">وضع التعلّم</span>
          <span class="learning-timer" id="practiceTimer">⏱ 60</span>
        </div>
        <div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>
      </div>
      <h2 class="quiz-stem">${escapeHtml(entry.stem_ar)}</h2>
      <div class="options" id="practiceOptions"></div>
      <p class="feedback" id="practiceFeedback" hidden></p>
    `;
    const optionsEl = document.getElementById('practiceOptions');
    entry.options.forEach((optText, idx) => {
      const btn = document.createElement('button');
      btn.className = 'option-btn';
      btn.dataset.letter = ['أ','ب','ج','د'][idx] ?? '';
      btn.textContent = optText;
      btn.onclick = () => answerPractice(entry.itemId, idx, btn);
      optionsEl.appendChild(btn);
    });
    startLearningTimer(document.getElementById('practiceTimer'));
    // Real bug found via rendered screenshot: this screen's content (and the
    // #practiceTitle anchor's resulting position) only exists once this
    // function runs — showScreen('practice')'s own Companion.enter() call
    // measured the anchor while #practiceQuizArea was still empty, pinning
    // the widget ~300px away from where the title actually ended up once
    // real content made the centered flex column taller. Re-measure now.
    Companion.reposition();
  }

  async function answerPractice(itemId, selectedIndex, btnEl) {
    stopLearningTimer();
    document.querySelectorAll('#practiceOptions .option-btn').forEach((b) => (b.disabled = true));
    btnEl.classList.add('selected');
    const result = await api('POST', '/api/practice/answer', {
      itemId, selectedIndex, responseTimeMs: elapsedSinceShown(), sessionId: practiceQueueState.sessionId,
    });
    practiceQueueState.sessionId = result.sessionId;
    btnEl.classList.remove('selected');
    btnEl.classList.add(result.isCorrect ? 'correct' : 'incorrect');
    if (!result.isCorrect) {
      document.querySelectorAll('#practiceOptions .option-btn')[result.correctOptionIndex]?.classList.add('correct');
      if (result.wrongAnswerExplanation || result.commonMistake) {
        Companion.explainMistake(result.wrongAnswerExplanation || result.commonMistake);
      }
    } else {
      Companion.reactCorrect();
    }
    noteAnswerOutcome(result.isCorrect);
    setTimeout(() => {
      practiceQueueState.index++;
      if (practiceQueueState.index < practiceQueueState.items.length) {
        renderPracticeItem();
      } else {
        goToDashboard();
      }
    }, 900);
  }

  // ---------- mock exam ----------
  let mockExamState = { sessionId: null, items: [], index: 0, timerInterval: null, secondsLeft: 0 };

  function startMockExam() {
    showScreen('mock-exam-intro');
  }

  async function beginMockExam() {
    setLoading(true, 'جاري تجهيز الاختبار التجريبي...');
    try {
      const { sessionId, items, durationMinutes } = await api('POST', '/api/mock-exam/start');
      mockExamState = { sessionId, items, index: 0, timerInterval: null, secondsLeft: durationMinutes * 60 };
      showScreen('mock-exam-quiz');
      startExamTimer();
      renderExamItem();
    } finally {
      setLoading(false);
    }
  }

  function startExamTimer() {
    updateTimerDisplay();
    mockExamState.timerInterval = setInterval(() => {
      mockExamState.secondsLeft--;
      updateTimerDisplay();
      if (mockExamState.secondsLeft <= 0) {
        clearInterval(mockExamState.timerInterval);
        finishMockExam();
      }
    }, 1000);
  }

  function updateTimerDisplay() {
    const m = Math.floor(mockExamState.secondsLeft / 60);
    const s = mockExamState.secondsLeft % 60;
    const el = document.getElementById('examTimer');
    el.textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    el.classList.toggle('low-time', mockExamState.secondsLeft < 60);
  }

  function renderExamItem() {
    markQuestionShown();
    const item = mockExamState.items[mockExamState.index];
    document.getElementById('examCounter').textContent = `${mockExamState.index + 1} / ${mockExamState.items.length}`;
    document.getElementById('examProgressFill').style.width = `${(mockExamState.index / mockExamState.items.length) * 100}%`;
    document.getElementById('examStem').textContent = item.stem_ar;
    const optionsEl = document.getElementById('examOptions');
    optionsEl.innerHTML = '';
    item.options.forEach((optText, idx) => {
      const btn = document.createElement('button');
      btn.className = 'option-btn';
      btn.dataset.letter = ['أ','ب','ج','د'][idx] ?? '';
      btn.textContent = optText;
      btn.onclick = () => answerExamItem(item.id, idx, btn);
      optionsEl.appendChild(btn);
    });
  }

  async function answerExamItem(itemId, selectedIndex, btnEl) {
    // Deliberately no per-question feedback during a real exam — matches the brief's
    // "review comes after," per FR-07's "score estimate and review" (not instant feedback).
    // A 'selected' highlight (never correct/incorrect) still gives the tap an immediate,
    // visible response instead of feeling unresponsive during the network round-trip.
    document.querySelectorAll('#examOptions .option-btn').forEach((b) => (b.disabled = true));
    if (btnEl) btnEl.classList.add('selected');
    await api('POST', `/api/mock-exam/${mockExamState.sessionId}/answer`, {
      itemId, selectedIndex, responseTimeMs: elapsedSinceShown(),
    });
    mockExamState.index++;
    if (mockExamState.index < mockExamState.items.length) {
      renderExamItem();
    } else {
      finishMockExam();
    }
  }

  async function finishMockExam() {
    if (mockExamState.timerInterval) clearInterval(mockExamState.timerInterval);
    setLoading(true, 'جاري تصحيح الاختبار...');
    try {
      const result = await api('POST', `/api/mock-exam/${mockExamState.sessionId}/complete`);
      showScreen('mock-exam-review');
      renderResultMascot('examResultMascot', result.scoreEstimate >= 60 ? 'celebrating' : 'encouraging');
      document.getElementById('examScoreHeadline').textContent = `${result.scoreEstimate}%`;

      // Timing analytics (Version 3 Phase C): grouped client-side from the
      // SAME review array already returned — responseTimeMs is a real,
      // already-stored per-attempt value, not a new endpoint.
      renderTimingBySkill(result.review, 'examTimingSection', 'examTimingList');

      const listEl = document.getElementById('examReviewList');
      listEl.innerHTML = '';
      result.review.forEach((r, i) => {
        const div = document.createElement('div');
        div.className = `review-item ${r.isCorrect ? 'correct' : 'incorrect'}`;
        div.innerHTML = `
          <div class="review-item-header">
            <span class="review-item-skill">${escapeHtml(r.skillNameAr)}</span>
            <span class="review-item-mark ${r.isCorrect ? 'correct' : 'incorrect'}">${r.isCorrect ? '✓ صحيح' : '✗ خطأ'}</span>
          </div>
          <div class="review-item-stem">${i + 1}. ${escapeHtml(r.stemAr)}</div>
          <div class="review-item-answer">الإجابة الصحيحة: ${escapeHtml(r.options[r.correctIndex])}</div>
        `;
        listEl.appendChild(div);
      });
    } finally {
      setLoading(false);
    }
  }

  // ---------- reference sheets ----------
  // Version 5 Phase J: pure sync DB read, no LLM — overlay removed (see goToPracticeQueue).
  async function goToReferenceSheets() {
    showScreen('reference-sheets');
    const { sheets } = await api('GET', '/api/reference-sheets');
    const emptyNote = document.getElementById('referenceSheetsEmptyNote');
    const listEl = document.getElementById('referenceSheetsList');
    listEl.innerHTML = '';
    if (sheets.length === 0) {
      emptyNote.hidden = false;
      return;
    }
    emptyNote.hidden = true;
    const categoryLabels = {
      verbal_analogy: 'التناظر اللفظي', sentence_completion: 'إكمال الجمل',
      reading_comprehension: 'استيعاب المقروء', contextual_error: 'الخطأ السياقي',
      arithmetic: 'الحساب', fractions: 'الكسور', decimals: 'الأعداد العشرية',
      percentages: 'النسب المئوية', ratios_and_proportions: 'النسبة والتناسب',
      algebra: 'الجبر', exponents_and_roots: 'الأسس والجذور', geometry: 'الهندسة',
      statistics: 'الإحصاء', probability: 'الاحتمال', quantitative_comparison: 'المقارنات الكمية',
      data_interpretation: 'تحليل البيانات', multi_step_word_problems: 'المسائل اللفظية',
    };
    sheets.forEach((sheet) => {
      const div = document.createElement('div');
      div.className = 'ref-sheet-category';
      const entriesHtml = sheet.entries.map((e) => `
        <div class="ref-sheet-entry">
          <div class="ref-sheet-skill-name">${escapeHtml(e.skillNameAr)}</div>
          ${e.principles.map((p) => `<div class="ref-sheet-line">◆ ${escapeHtml(p)}</div>`).join('')}
          ${e.techniques.map((t) => `<div class="ref-sheet-line">→ ${escapeHtml(t)}</div>`).join('')}
          ${e.cautions.map((c) => `<div class="ref-sheet-line caution">⚠ ${escapeHtml(c)}</div>`).join('')}
        </div>
      `).join('');
      div.innerHTML = `<div class="ref-sheet-category-title">${escapeHtml(categoryLabels[sheet.category] ?? sheet.category)}</div>${entriesHtml}`;
      listEl.appendChild(div);
    });
  }

  // ---------- glossary ----------
  // Version 5 Phase J: pure sync DB read, no LLM — overlay removed (see goToPracticeQueue).
  async function goToGlossary() {
    showScreen('glossary');
    const { terms } = await api('GET', '/api/glossary');
    const emptyNote = document.getElementById('glossaryEmptyNote');
    const listEl = document.getElementById('glossaryList');
    listEl.innerHTML = '';
    if (terms.length === 0) {
      emptyNote.hidden = false;
      return;
    }
    emptyNote.hidden = true;
    terms.forEach((t) => {
      const div = document.createElement('div');
      div.className = 'glossary-entry';
      div.innerHTML = `<div class="glossary-term">${escapeHtml(t.termAr)}</div><div class="glossary-definition">${escapeHtml(t.definitionAr)}</div>`;
      listEl.appendChild(div);
    });
  }

  // ---------- resources ----------
  // Version 5 Phase J: pure sync DB read, no LLM — overlay removed (see goToPracticeQueue).
  async function goToResources() {
    showScreen('resources');
    const { resources } = await api('GET', '/api/resources');
    const listEl = document.getElementById('resourcesList');
    listEl.innerHTML = '';
    resources.forEach((r) => {
      const div = document.createElement('div');
      div.className = 'resource-entry';
      const badge = r.isOfficialEtec
        ? '<span class="resource-badge official">مصدر رسمي</span>'
        : '<span class="resource-badge secondary">ثانوي</span>';
      div.innerHTML = `
        <div class="resource-title">${escapeHtml(r.title)}${badge}</div>
        <div class="resource-annotation">${escapeHtml(r.annotation)}</div>
        ${r.url ? `<div class="resource-link">${escapeHtml(r.url)}</div>` : ''}
      `;
      listEl.appendChild(div);
    });
  }

  // ---------- ask the teacher ----------
  function goToAskTeacher() {
    showScreen('ask-teacher');
    const chat = document.getElementById('askTeacherChat');
    if (chat.children.length === 0) {
      addChatBubble('askTeacherChat', 'assistant', 'مرحبًا! يمكن طرح أي سؤال متابعة يحتاج توضيحًا هنا.');
    }
  }

  return {
    goToMission, loadNextLesson, startLessonQuiz, goToDashboard,
    goToPracticeQueue, startMockExam, beginMockExam, goToReferenceSheets, goToGlossary, goToResources, goToAskTeacher,
    toggleMoreSheet, toggleAskAboutLesson, requestLessonHint, goToNotifications,
    goToLogin, goToRegister, logout,
    selectLanguage, goToGenderSelect, selectGender, completeOnboarding, goToSettings,
    goToNextLessonStep, skipToLessonQuiz,
    goToJourney, selectJourneySection, continueFromMission,
    goToPathSelect, choosePath, getJourneySection: () => state.journeySection,
    goToGradeSelect, confirmGrade,
    goToTargetScoreSelect, onTargetScoreInput, confirmTargetScore, confirmExamDate,
  };
})();
