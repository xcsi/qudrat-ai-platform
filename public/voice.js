// ============================================================
// Voice support (product redesign, Phase 9 + Qiyasy polish pass).
// Real, working text-to-speech via the browser's native SpeechSynthesis
// API — zero backend change, zero new dependency. Speech-to-text (asking
// a question by voice) is a documented future seam, not built here: it
// would hook into the Ask-the-Teacher and "ask about this lesson" chat
// inputs via SpeechRecognition/webkitSpeechRecognition, gated on mic
// permission and Arabic recognition accuracy — deliberately out of scope.
//
// Polish pass: added real pause/resume (window.speechSynthesis natively
// supports both — the previous version only ever exposed stop/cancel,
// so "pausing" actually threw away playback position entirely) and a
// three-state UI (idle / speaking / paused) with a visible text label,
// not just an icon swap, so "is it reading right now?" is never a guess.
// ============================================================

const Voice = (() => {
  const supported = 'speechSynthesis' in window;
  let currentUtterance = null;

  function pickArabicVoice() {
    const voices = window.speechSynthesis.getVoices();
    return voices.find((v) => v.lang && v.lang.toLowerCase().startsWith('ar')) || null;
  }

  /** Speaks the given Arabic text aloud. Calling this again while already
   *  speaking stops the previous utterance first (never overlaps). Returns
   *  false if the browser has no speech synthesis support at all, so callers
   *  can hide/disable the voice button entirely rather than showing a dead one. */
  function speak(text, onEnd) {
    if (!supported || !text) return false;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'ar-SA';
    const arabicVoice = pickArabicVoice();
    if (arabicVoice) utterance.voice = arabicVoice;
    utterance.rate = 0.95;
    if (onEnd) utterance.onend = onEnd;
    currentUtterance = utterance;
    window.speechSynthesis.speak(utterance);
    return true;
  }

  function pause() {
    if (supported && window.speechSynthesis.speaking) window.speechSynthesis.pause();
  }

  function resume() {
    if (supported && window.speechSynthesis.paused) window.speechSynthesis.resume();
  }

  function stop() {
    if (supported) window.speechSynthesis.cancel();
    currentUtterance = null;
  }

  function isSpeaking() {
    return supported && window.speechSynthesis.speaking && !window.speechSynthesis.paused;
  }

  function isPaused() {
    return supported && window.speechSynthesis.paused;
  }

  /** Builds a self-contained "read aloud" control: an icon button plus a text
   *  label that names the current state explicitly (لقراءة / يقرأ الآن... /
   *  ...متوقف مؤقتًا), cycling idle -> speaking -> paused -> speaking -> ...
   *  `getText()` is called lazily on first play so the button can be created
   *  before the real content is ready. Returns null if TTS isn't supported. */
  function createReadAloudControl(getText) {
    if (!supported) return null;
    const wrap = document.createElement('div');
    wrap.className = 'voice-control';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn-voice';

    const label = document.createElement('span');
    label.className = 'voice-control-label';

    function render(state) {
      if (state === 'speaking') {
        btn.textContent = '⏸';
        btn.setAttribute('aria-label', 'إيقاف القراءة مؤقتًا');
        label.textContent = '🔊 يقرأ الآن...';
        label.className = 'voice-control-label voice-control-label-active';
      } else if (state === 'paused') {
        btn.textContent = '▶';
        btn.setAttribute('aria-label', 'متابعة القراءة');
        label.textContent = 'متوقف مؤقتًا — اضغطي للمتابعة';
        label.className = 'voice-control-label voice-control-label-paused';
      } else {
        btn.textContent = '🔊';
        btn.setAttribute('aria-label', 'استمعي لهذا الدرس');
        label.textContent = 'استمعي للدرس';
        label.className = 'voice-control-label';
      }
    }

    btn.onclick = () => {
      if (isSpeaking()) {
        pause();
        render('paused');
      } else if (isPaused()) {
        resume();
        render('speaking');
      } else {
        const started = speak(getText(), () => render('idle'));
        if (started) render('speaking');
      }
    };

    render('idle');
    wrap.appendChild(btn);
    wrap.appendChild(label);
    return wrap;
  }

  /**
   * Version 5 Phase L: the documented extension seam for speech-to-text, honestly
   * NOT a working feature today — the brief asks to "design the architecture for
   * future integration," not ship a half-working mic. Returns unsupported
   * unconditionally so no caller can currently rely on this doing anything.
   *
   * How a real implementation would plug in, when built:
   * - Feature-detect `window.SpeechRecognition || window.webkitSpeechRecognition`
   *   (same supported-detection pattern as `speak()` above uses for TTS).
   * - Construct one recognizer per call, set `lang = 'ar-SA'`, `interimResults = false`.
   * - `onresult` -> call `onTranscript(text)`; `onerror`/`onend` -> call `onEnd()`
   *   so callers can restore their input UI regardless of outcome.
   * - Wire into the two existing free-text inputs that would benefit: the
   *   Ask-the-Teacher chat box (app.js's `goToAskTeacher`/message-submit handler)
   *   and the lesson-scoped "اسأل عن هذا الدرس" panel (`toggleAskAboutLesson`) —
   *   both already take arbitrary typed text, so a transcript would drop in via
   *   the exact same submit path with no other change needed.
   * - Gate behind an explicit mic-permission prompt and an Arabic-recognition-
   *   accuracy check before ever showing the control by default.
   */
  function startListening(_onTranscript, _onEnd) {
    return { supported: false };
  }

  return { supported, speak, pause, resume, stop, isSpeaking, isPaused, createReadAloudControl, startListening };
})();
