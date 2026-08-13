// ============================================================
// Reusable card component library (product redesign, Phase 3/5).
// Pure functions that take data and return DOM nodes — no framework,
// no build step, matching app.js's existing manual-DOM-building
// pattern (createElement/innerHTML + escapeHtml). Plain global script,
// exposes a global `Cards` binding (a top-level `const`, not a
// `window.Cards` property — reference the bare identifier, same as `App`).
// ============================================================

const Cards = (() => {
  function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function el(tag, className, children) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    (children || []).forEach((c) => c && node.appendChild(c));
    return node;
  }

  function textNode(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    node.textContent = text;
    return node;
  }

  const CONCEPT_LABELS = {
    principle: 'المبدأ', technique: 'التقنية', caution: 'تنبيه',
    rule: 'قاعدة', formula: 'قانون', mistake: 'خطأ شائع', memory_technique: 'وسيلة تذكّر',
  };
  const CONCEPT_ICONS = {
    principle: '💡', technique: '🎯', caution: '⚠️',
    rule: '📐', formula: '🧮', mistake: '🚫', memory_technique: '🧠',
  };

  /** One concept block (principle/technique/caution), visual-aware — renders
   *  the block's diagram inline via Visuals.render() when present, otherwise
   *  stays text-only exactly as before. A block with no visual (any lesson that
   *  fell back to live generation instead of curated content) still gets a
   *  per-kind icon next to its label — found via UX review that four text-only
   *  concept cards in a row, differentiated only by a subtle border color, read
   *  as a wall of paragraphs rather than distinct, scannable ideas. */
  /** Visual-first layout (demo-quality sprint): the diagram is the first thing
   *  a student sees on this card — large, above the fold of the card — with
   *  the label as a small "chapter" tag and the text condensed beneath it,
   *  not the other way around. "Small text, large visuals": the old order
   *  (label -> full paragraph -> small diagram at the bottom) read as a text
   *  page with an illustration attached; a student's first glance should land
   *  on the picture, not a wall of Arabic prose. */
  function ConceptCard(block) {
    const card = el('div', `card concept-card concept-card-${block.kind}`);
    const label = textNode('span', 'concept-card-label', `${CONCEPT_ICONS[block.kind] || ''} ${CONCEPT_LABELS[block.kind] || ''}`);
    card.appendChild(label);

    // NOTE: `Visuals` is a top-level `const` in visuals.js, which is a global
    // *lexical* binding, not a `window.Visuals` property (classic JS quirk —
    // `const`/`let` at script top level never attach to `window`, unlike `var`).
    // Reference the bare identifier, not `window.Visuals` (found via live
    // browser testing: `window.Visuals` was always undefined, silently
    // skipping every visual regardless of whether a spec existed).
    const visual = Visuals.render(block.visual);
    if (visual) card.appendChild(visual);

    // Version 4: "replace reading with interaction whenever possible" — a
    // long block starts collapsed to its first sentence with a real tap-to-
    // expand toggle, instead of presenting the whole paragraph as something
    // to just read top to bottom. Threshold tightened (was 90 chars) now that
    // the visual usually already carries the concept — text is a caption,
    // not the primary explanation, so it collapses sooner.
    const fullText = block.text_ar || '';
    const firstSentence = fullText.split(/(?<=[.؟!])\s/)[0] || fullText;
    const isLong = fullText.length > 70 && firstSentence.length < fullText.length;
    const textEl = textNode('p', 'concept-card-text', isLong ? firstSentence : fullText);
    card.appendChild(textEl);
    if (isLong) {
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'concept-card-expand';
      toggle.textContent = 'اقرأ المزيد ▾';
      let expanded = false;
      toggle.onclick = () => {
        expanded = !expanded;
        textEl.textContent = expanded ? fullText : firstSentence;
        toggle.textContent = expanded ? 'عرض أقل ▴' : 'اقرأ المزيد ▾';
      };
      card.appendChild(toggle);
    }
    return card;
  }

  // ---------- Educational Rendering Engine: named concept-block variants ----------
  // Each is a thin, explicitly-named entry point over the same ConceptCard
  // renderer (same visual-aware behavior, same card chrome) — the lesson
  // renderer dispatches to these by name so a lesson's data decides which
  // component it needs without any lesson-specific markup ever being written.
  function RuleCard(block) { return ConceptCard({ ...block, kind: 'rule' }); }
  function FormulaCard(block) { return ConceptCard({ ...block, kind: 'formula' }); }
  function CommonMistakeCard(block) { return ConceptCard({ ...block, kind: 'mistake' }); }
  function MemoryTechniqueCard(block) { return ConceptCard({ ...block, kind: 'memory_technique' }); }

  // ---------- Version 4 Phase F: new visual components ----------

  /** A solving strategy as numbered steps with an icon header — same
   *  concept-card chrome/visual-awareness as RuleCard etc., a numbered list
   *  body instead of one paragraph (no new visual primitive needed). */
  function StrategyCard(title, steps, visual) {
    const card = el('div', 'card concept-card concept-card-rule');
    card.appendChild(textNode('span', 'concept-card-label', `🧩 ${title}`));
    const list = el('ol', 'strategy-card-list');
    (steps || []).forEach((s) => list.appendChild(textNode('li', null, s)));
    card.appendChild(list);
    const visualEl = Visuals.render(visual);
    if (visualEl) card.appendChild(visualEl);
    return card;
  }

  /** Thin wrapper over Visuals' new `equation_balance` renderer. */
  function EquationBalanceCard(leftLabel, rightLabel, tilt) {
    const card = el('div', 'card equation-balance-card');
    const visual = Visuals.render({ type: 'equation_balance', leftLabel, rightLabel, tilt });
    if (visual) card.appendChild(visual);
    return card;
  }

  /** Thin wrapper over Visuals' new `coordinate_plane` renderer. */
  function GraphCard(points, options) {
    const card = el('div', 'card graph-card');
    const visual = Visuals.render({ type: 'coordinate_plane', points, ...(options || {}) });
    if (visual) card.appendChild(visual);
    return card;
  }

  // ---------- Version 6 Phase M: named wrappers for renderers that already
  // existed in visuals.js but had no dedicated Cards.* entry point (same thin-
  // wrapper pattern as EquationBalanceCard/GraphCard above). ----------

  function NumberLineCard(min, max, points) {
    const card = el('div', 'card number-line-card');
    const visual = Visuals.render({ type: 'number_line', min, max, points });
    if (visual) card.appendChild(visual);
    return card;
  }

  /** `style: 'bar'|'pie'` (default 'bar') picks between the two existing
   *  fraction renderers — both take the same numerator/denominator/label shape. */
  function FractionCard(numerator, denominator, label, style) {
    const card = el('div', 'card fraction-card');
    const visual = Visuals.render({ type: style === 'pie' ? 'pie_fraction' : 'fraction_bar', numerator, denominator, label });
    if (visual) card.appendChild(visual);
    return card;
  }

  function PercentageGridCard(percent, label) {
    const card = el('div', 'card percentage-grid-card');
    const visual = Visuals.render({ type: 'percentage_grid', percent, label });
    if (visual) card.appendChild(visual);
    return card;
  }

  function ComparisonCard(left, right) {
    const card = el('div', 'card comparison-card');
    const visual = Visuals.render({ type: 'comparison_bar', left, right });
    if (visual) card.appendChild(visual);
    return card;
  }

  function FlowDiagramCard(steps) {
    const card = el('div', 'card flow-diagram-card');
    const visual = Visuals.render({ type: 'flow_diagram', steps });
    if (visual) card.appendChild(visual);
    return card;
  }

  function MindMapCard(root, branches) {
    const card = el('div', 'card mind-map-card');
    const visual = Visuals.render({ type: 'mind_map', root, branches });
    if (visual) card.appendChild(visual);
    return card;
  }

  function GeometrySVGCard(shape, labels, dimensions) {
    const card = el('div', 'card geometry-svg-card');
    const visual = Visuals.render({ type: 'geometry', shape, labels, dimensions });
    if (visual) card.appendChild(visual);
    return card;
  }

  /** Thin wrapper over the new `ratio_bar` renderer (closes the RatioCard
   *  wishlist gap — see visuals.js's renderRatioBar). */
  function RatioCard(left, right) {
    const card = el('div', 'card ratio-card');
    const visual = Visuals.render({ type: 'ratio_bar', left, right });
    if (visual) card.appendChild(visual);
    return card;
  }

  /** Thin wrapper over the new `timeline` renderer (closes the TimelineCard
   *  wishlist gap — see visuals.js's renderTimeline). */
  function TimelineCard(events) {
    const card = el('div', 'card timeline-card');
    const visual = Visuals.render({ type: 'timeline', events });
    if (visual) card.appendChild(visual);
    return card;
  }

  /** A reading passage with specific substrings visually highlighted — the
   *  component the two 0%-visual verbal lessons actually need (a fraction/
   *  geometry diagram doesn't help "which sentence supports the main idea").
   *  `highlights` is a list of exact substrings to wrap in a highlight span —
   *  both the passage and each highlight are escaped BEFORE insertion, same
   *  XSS-safety discipline as every other innerHTML site in this app. */
  function ReadingHighlightCard(passageText, highlights) {
    const card = el('div', 'card reading-highlight-card');
    card.appendChild(textNode('span', 'concept-card-label', '📖 النص'));
    const p = document.createElement('p');
    p.className = 'reading-highlight-text';
    let html = escapeHtml(passageText);
    (highlights || []).forEach((h) => {
      const escaped = escapeHtml(h);
      if (escaped) html = html.split(escaped).join(`<mark class="reading-highlight-mark">${escaped}</mark>`);
    });
    p.innerHTML = html;
    card.appendChild(p);
    return card;
  }

  /** Word / pronunciation / meaning / example / synonym — the other
   *  component the 0%-visual verbal lessons need. */
  function VocabularyCard(vocab) {
    const card = el('div', 'card vocabulary-card');
    const head = el('div', 'vocabulary-card-head');
    head.appendChild(textNode('span', 'vocabulary-card-word', vocab.word));
    if (vocab.pronunciation) head.appendChild(textNode('span', 'vocabulary-card-pronunciation', vocab.pronunciation));
    card.appendChild(head);
    if (vocab.meaning) card.appendChild(textNode('p', 'vocabulary-card-meaning', vocab.meaning));
    if (vocab.example) card.appendChild(textNode('p', 'vocabulary-card-example', `مثال: ${vocab.example}`));
    if (vocab.synonym) card.appendChild(textNode('p', 'vocabulary-card-synonym', `مرادف: ${vocab.synonym}`));
    return card;
  }

  /** Tap-to-flip revision card — a CSS 3D transform, same
   *  transition-based-reveal spirit as the worked-example step reveal,
   *  just a flip instead of an append. */
  function Flashcard(front, back) {
    const card = el('div', 'flashcard');
    const inner = el('div', 'flashcard-inner');
    const frontEl = el('div', 'flashcard-face flashcard-front');
    frontEl.appendChild(textNode('p', null, front));
    const backEl = el('div', 'flashcard-face flashcard-back');
    backEl.appendChild(textNode('p', null, back));
    inner.append(frontEl, backEl);
    card.appendChild(inner);
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');
    card.onclick = () => card.classList.toggle('flashcard-flipped');
    card.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); card.click(); } };
    return card;
  }

  /** Worked example as an interactive step-by-step reveal instead of dumping
   *  every step at once — each step is revealed by tapping "الخطوة التالية"
   *  until the final result. Visual-aware, same as ConceptCard. */
  function WorkedExampleCard(workedExample) {
    const card = el('div', 'card worked-example-card');
    card.appendChild(textNode('span', 'concept-card-label', 'مثال محلول'));
    card.appendChild(textNode('p', 'we-problem', workedExample.problem_ar));

    const visual = Visuals.render(workedExample.visual);
    if (visual) card.appendChild(visual);

    const stepsContainer = el('div', 'we-steps');
    card.appendChild(stepsContainer);

    let revealed = 0;
    const steps = workedExample.solution_steps_ar;
    const nextBtn = document.createElement('button');
    nextBtn.type = 'button';
    nextBtn.className = 'btn-reveal-step';

    function renderNext() {
      if (revealed < steps.length) {
        const stepEl = textNode('div', 'we-step we-step-in', `${revealed + 1}. ${steps[revealed]}`);
        stepsContainer.appendChild(stepEl);
        revealed += 1;
      }
      if (revealed >= steps.length) {
        nextBtn.remove();
      } else {
        nextBtn.textContent = `الخطوة التالية (${revealed}/${steps.length}) ←`;
      }
    }

    nextBtn.textContent = `شوفي الخطوة الأولى (0/${steps.length}) ←`;
    nextBtn.onclick = renderNext;
    card.appendChild(nextBtn);
    return card;
  }

  /** Version 6 Phase M/P: the "Interactive Activity" primitive — real
   *  manipulation with immediate feedback, distinct from both the MCQ
   *  challenge (read-then-pick) and WorkedExampleCard's passive tap-to-reveal.
   *  Two variants sharing one component:
   *  - 'classify': tap each item into one of two real category buckets, one
   *    item at a time; a wrong tap gets a brief shake and another try, never
   *    a silent "wrong, moving on."
   *  - 'sequence': tap items (shown shuffled) into what you believe is the
   *    correct order; once all are placed, right/wrong is checked as a whole
   *    and a wrong attempt can be reset and retried.
   *  Ungraded/exploratory by design — mistakes prompt a retry, never a
   *  penalty. `data` shapes:
   *    classify:  { prompt_ar, categories: [labelA, labelB], items: [{text_ar, correctCategory: 0|1}] }
   *    sequence:  { prompt_ar, items: [{text_ar}] } — already given in correct order
   *  `onComplete()` fires once every item is correctly placed.
   *  NOTE: named `InteractiveActivityCard`, not `ActivityCard` — that name is
   *  already taken by the dashboard's recent-activity-row component below. */
  function InteractiveActivityCard(variant, data, onComplete) {
    const card = el('div', 'card activity-card');
    card.appendChild(textNode('span', 'activity-card-label', '🎮 جرّب بنفسك'));
    if (data.prompt_ar) card.appendChild(textNode('p', 'activity-card-prompt', data.prompt_ar));

    if (variant === 'classify') {
      const items = data.items || [];
      let currentIndex = 0;
      const itemEl = textNode('p', 'activity-classify-item', '');
      const btnRow = el('div', 'activity-classify-buttons');
      const progressEl = textNode('span', 'activity-card-progress', '');
      card.append(itemEl, btnRow, progressEl);

      function renderCurrent() {
        if (currentIndex >= items.length) {
          itemEl.remove(); btnRow.remove(); progressEl.remove();
          card.appendChild(textNode('p', 'activity-card-complete', '🎉 أحسنت! صنّفتها كلها بشكل صحيح.'));
          if (onComplete) onComplete();
          return;
        }
        itemEl.textContent = items[currentIndex].text_ar;
        itemEl.className = 'activity-classify-item';
        progressEl.textContent = `${currentIndex + 1} / ${items.length}`;
        btnRow.innerHTML = '';
        (data.categories || []).forEach((catLabel, catIdx) => {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'activity-classify-btn';
          btn.textContent = catLabel;
          btn.onclick = () => {
            const correct = items[currentIndex].correctCategory === catIdx;
            if (correct) {
              itemEl.className = 'activity-classify-item activity-classify-correct';
              btnRow.querySelectorAll('button').forEach((b) => (b.disabled = true));
              setTimeout(() => { currentIndex++; renderCurrent(); }, 600);
            } else {
              itemEl.className = 'activity-classify-item activity-classify-incorrect';
              setTimeout(() => { itemEl.className = 'activity-classify-item'; }, 450);
            }
          };
          btnRow.appendChild(btn);
        });
      }
      renderCurrent();
    } else if (variant === 'sequence') {
      const correctOrder = (data.items || []).map((it) => it.text_ar);
      const shuffled = [...correctOrder].sort(() => Math.random() - 0.5);
      const chosen = [];
      const poolEl = el('div', 'activity-sequence-pool');
      const chosenEl = el('div', 'activity-sequence-chosen');
      const statusEl = el('div', 'activity-sequence-status');
      card.append(poolEl, chosenEl, statusEl);

      function renderChosen() {
        chosenEl.innerHTML = '';
        chosen.forEach((text, i) => chosenEl.appendChild(textNode('div', 'activity-sequence-chosen-item', `${i + 1}. ${text}`)));
      }
      function renderPool() {
        poolEl.innerHTML = '';
        shuffled.filter((t) => !chosen.includes(t)).forEach((text) => {
          const chip = document.createElement('button');
          chip.type = 'button';
          chip.className = 'activity-sequence-chip';
          chip.textContent = text;
          chip.onclick = () => {
            chosen.push(text);
            renderChosen();
            renderPool();
            if (chosen.length === correctOrder.length) checkOrder();
          };
          poolEl.appendChild(chip);
        });
      }
      function checkOrder() {
        statusEl.innerHTML = '';
        const isCorrect = chosen.every((t, i) => t === correctOrder[i]);
        if (isCorrect) {
          statusEl.appendChild(textNode('p', 'activity-card-complete', '🎉 أحسنت! هذا هو الترتيب الصحيح.'));
          if (onComplete) onComplete();
        } else {
          statusEl.appendChild(textNode('p', 'activity-card-retry', 'مو الترتيب الصحيح — حاول مرة ثانية.'));
          const retryBtn = document.createElement('button');
          retryBtn.type = 'button';
          retryBtn.className = 'btn-text';
          retryBtn.textContent = 'إعادة المحاولة ↺';
          retryBtn.onclick = () => {
            chosen.length = 0;
            statusEl.innerHTML = '';
            renderChosen();
            renderPool();
          };
          statusEl.appendChild(retryBtn);
        }
      }
      renderPool();
      renderChosen();
    }
    return card;
  }

  /** Consolidates the option-rendering logic that used to be duplicated across
   *  renderDiagnosticItem/renderLessonItem/renderPracticeItem/renderExamItem
   *  in app.js. `onAnswer(selectedIndex, btnEl)` is called on click; this
   *  component does not know about correctness — the caller still owns that
   *  (it depends on a server round-trip). */
  function QuizOptions(options, onAnswer) {
    const container = el('div', 'options');
    const letters = ['أ', 'ب', 'ج', 'د'];
    options.forEach((optText, idx) => {
      const btn = document.createElement('button');
      btn.className = 'option-btn';
      btn.dataset.letter = letters[idx] || '';
      btn.textContent = optText;
      btn.onclick = () => onAnswer(idx, btn);
      container.appendChild(btn);
    });
    return container;
  }

  /** Small inline hint bubble — shown on demand inside a quiz card, not a
   *  full-screen loading state (Phase 8: only genuinely async AI-assist calls
   *  get a loading affordance, and it's local to this card). */
  function HintCard(hintText, source) {
    const card = el('div', 'card hint-card');
    card.appendChild(textNode('span', 'hint-card-label', '💡 تلميح'));
    card.appendChild(textNode('p', 'hint-card-text', hintText));
    // Version 5 Phase I: visible attribution — surfaces the `source` field the
    // hint endpoint already returns (curated vs. live AI fallback, grounded via
    // the shared GroundingService) but which was previously fetched and discarded.
    if (source) {
      // Final AI-wrapper audit: this used to literally say "من الذكاء
      // الاصطناعي" (from Artificial Intelligence) — exposing the underlying
      // infrastructure as a user-facing brand instead of keeping it inside
      // Qiyas's own voice, the one AI-wrapper pattern a grep audit of every
      // user-visible string in this file still caught.
      const tag = source === 'curated'
        ? { cls: 'hint-source-tag--verified', text: '✓ من بنك الأسئلة' }
        : { cls: 'hint-source-tag--ai', text: '✨ شرح من قِيس' };
      const tagEl = textNode('span', `hint-source-tag ${tag.cls}`, tag.text);
      card.appendChild(tagEl);
    }
    return card;
  }

  /** Version 6 Phase M/N: consolidates QuizOptions + FeedbackCard + an
   *  optional hint button + HintCard into one reusable component — replaces
   *  the ad hoc composition renderLessonChallenge() used to hand-build (same
   *  consolidation spirit as QuizOptions itself). `item` needs `{id, stem_ar,
   *  options}`. `onAnswer(selectedIndex)` must return a Promise resolving to
   *  `{isCorrect, explanation, correctOptionIndex}` — the caller still owns
   *  the real scoring round-trip and any side effects (XP, companion
   *  reactions, advancing to the next step); this component only renders the
   *  resulting feedback. `onHint()` (optional) must return a Promise
   *  resolving to `{hint, source, hasMore}` — omit it to hide the hint
   *  button entirely (e.g. contexts that already have their own hint flow). */
  function QuizCard(item, { onAnswer, onHint } = {}) {
    const card = el('div', 'card quiz-card');
    card.appendChild(textNode('p', 'quiz-card-stem', item.stem_ar));

    const feedbackEl = el('div', 'quiz-card-feedback');
    const optionsEl = QuizOptions(item.options, async (idx, btn) => {
      optionsEl.querySelectorAll('.option-btn').forEach((b) => (b.disabled = true));
      if (hintBtn) hintBtn.disabled = true;
      const result = await onAnswer(idx);
      btn.classList.add(result.isCorrect ? 'correct' : 'incorrect', 'answer-pop');
      if (!result.isCorrect) {
        optionsEl.querySelectorAll('.option-btn')[result.correctOptionIndex]?.classList.add('correct');
      }
      feedbackEl.appendChild(FeedbackCard(
        result.isCorrect, result.isCorrect ? 'أحسنت! بالضبط كذا 🎉' : 'قريبة! هذي أول تجربة بس.', result.explanation
      ));
    });
    card.appendChild(optionsEl);
    card.appendChild(feedbackEl);

    let hintBtn = null;
    if (onHint) {
      hintBtn = document.createElement('button');
      hintBtn.type = 'button';
      hintBtn.className = 'btn-hint';
      hintBtn.textContent = '💡 تلميح';
      const hintContainer = el('div', 'quiz-card-hint-container');
      hintBtn.onclick = async () => {
        hintBtn.disabled = true;
        try {
          const { hint, source, hasMore } = await onHint();
          hintContainer.innerHTML = '';
          hintContainer.appendChild(HintCard(hint, source));
          if (hasMore) { hintBtn.disabled = false; hintBtn.textContent = '💡 تلميح إضافي'; }
          else hintBtn.hidden = true;
        } catch (e) {
          hintBtn.disabled = false;
        }
      };
      card.appendChild(hintBtn);
      card.appendChild(hintContainer);
    }
    return card;
  }

  /** End-of-concept "quick revision" recap — a condensed bullet list shown
   *  right before practice starts, so the last thing read before the quiz
   *  is a tight summary, not a fresh wall of text. */
  function QuickRevisionCard(points) {
    const card = el('div', 'card quick-revision-card');
    card.appendChild(textNode('span', 'quick-revision-label', '⚡ مراجعة سريعة'));
    const list = el('ul', 'quick-revision-list');
    (points || []).forEach((p) => list.appendChild(textNode('li', null, p)));
    card.appendChild(list);
    return card;
  }

  /** A single "confirm you followed that" gate between concept and practice —
   *  lightweight, no scoring, just a tap to continue. Distinct from QuizCard,
   *  which is scored; this is a comprehension checkpoint, not an assessment. */
  function CheckpointCard(promptText, onContinue) {
    const card = el('div', 'card checkpoint-card');
    card.appendChild(textNode('span', 'checkpoint-card-label', '✅ نقطة تحقّق'));
    card.appendChild(textNode('p', 'checkpoint-card-text', promptText));
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn-reveal-step';
    btn.textContent = 'فهمت، متابعة ←';
    btn.onclick = () => { onContinue(); btn.remove(); };
    card.appendChild(btn);
    return card;
  }

  /** Consolidates the correct/incorrect feedback markup that used to be built
   *  inline in app.js's answerLesson() as a raw innerHTML template — same
   *  visual result, now a reusable component instead of lesson-specific markup. */
  function FeedbackCard(isCorrect, headline, explanationText) {
    const card = el('div', `feedback-card ${isCorrect ? 'correct' : 'incorrect'}`);
    card.appendChild(textNode('span', 'feedback-headline', headline));
    card.appendChild(textNode('p', 'feedback-card-text', explanationText));
    return card;
  }

  /** End-of-lesson "key takeaways" summary — same shape as QuickRevisionCard
   *  but framed as a closing recap rather than a pre-practice nudge. */
  function SummaryCard(title, points) {
    const card = el('div', 'card summary-card');
    card.appendChild(textNode('span', 'summary-card-label', `📋 ${title}`));
    const list = el('ul', 'quick-revision-list');
    (points || []).forEach((p) => list.appendChild(textNode('li', null, p)));
    card.appendChild(list);
    return card;
  }

  /** XP + level bar for the dashboard. Starts its bar at 0% width and its
   *  total at "0 XP" — app.js's countUp()/animateFillBars() helpers animate
   *  both up to the real values right after insertion (Version 2 Phase 3:
   *  "animate XP increasing, never instantly jump"). */
  function XPCard(xp, level) {
    // Human-centered art-direction pass: no longer its own dark "card" —
    // lives inside the shared .stat-cards-row strip alongside StreakCard
    // (see index.html/style.css) instead of stacking two full, separately-
    // bordered dark/light cards. One container, two halves.
    const card = el('div', 'xp-card');
    const top = el('div', 'xp-card-top');
    top.appendChild(textNode('span', 'xp-card-level', `المستوى ${level.level}`));
    const total = textNode('span', 'xp-card-total', '0 XP');
    total.dataset.targetXp = xp;
    top.appendChild(total);
    card.appendChild(top);
    const barTrack = el('div', 'xp-bar-track');
    const barFill = el('div', 'xp-bar-fill');
    barFill.style.width = '0%';
    barFill.dataset.targetWidth = Math.round(level.progress * 100);
    barTrack.appendChild(barFill);
    card.appendChild(barTrack);
    card.appendChild(textNode('span', 'xp-card-remaining', `${Math.max(0, level.xpForNextLevel - level.xpIntoLevel)} XP للمستوى التالي`));
    return card;
  }

  /** Streak flame — celebrates an active streak, stays quiet (not alarming) at 0.
   *  The flame flickers gently while a streak is active (Version 2 Phase 3 —
   *  "make the streak feel rewarding"). Copy rewritten to drop the gendered
   *  imperative verbs ("ابدأي"/"حافظي") the original text used — this app
   *  never assumes a gender before the student opts in (see Student.gender). */
  function StreakCard(streak) {
    const card = el('div', 'streak-card');
    const active = streak.current > 0;
    const icon = textNode('span', `streak-card-icon${active ? ' active' : ''}`, active ? '🔥' : '🌱');
    card.appendChild(icon);
    const text = el('div', 'streak-card-text');
    text.appendChild(textNode('strong', null, active ? `سلسلة ${streak.current} يوم 🔥` : 'أول يوم بالسلسلة يبدأ اليوم'));
    text.appendChild(textNode('span', null, streak.longest > streak.current ? `أطول سلسلة وصلتها: ${streak.longest} يوم` : 'كل يوم مذاكرة يبني عادة تدوم'));
    card.appendChild(text);
    return card;
  }

  /** One row per category in the mastery-by-topic / weak-topics lists. */
  function MasteryCard(category) {
    const card = el('div', 'card mastery-row');
    const top = el('div', 'mastery-row-top');
    top.appendChild(textNode('span', 'mastery-row-label', CATEGORY_LABELS[category.category] || category.category));
    top.appendChild(textNode('span', 'mastery-row-percent', `${category.masteryPercent}%`));
    card.appendChild(top);
    const track = el('div', 'mastery-row-track');
    const fill = el('div', 'mastery-row-fill');
    fill.style.width = `${category.masteryPercent}%`;
    track.appendChild(fill);
    card.appendChild(track);
    return card;
  }

  // ---------- Version 2 Phase 3: home-dashboard components ----------

  /** One stop on the "learning journey" roadmap (replaces the old static
   *  progress arc). `state` is one of 'done' | 'current' | 'upcoming' | 'exam'.
   *  Purely a presentation of `d.skills[]`/priority order already returned by
   *  GET /api/dashboard + GET /api/next-lesson — no new data.
   *  `wide` (Version 3 Phase D): the dashboard's compact preview truncates
   *  long labels to fit a horizontal scroller; the full "خريطتك التعليمية"
   *  screen has room to show them in full — same component, same status
   *  semantics, just not truncated. */
  /** Human-centered art-direction pass: geometric state icons instead of
   *  emoji glyphs (⬜/🟢/✅ rendered as an inconsistent mix of the platform's
   *  own emoji font — "random emoji UI," and every "upcoming" node looked
   *  identical regardless of how far into the roadmap it was). 'done' is a
   *  solid filled circle with a check — the more of these appear in a row,
   *  the more the roadmap itself reads as a trail already walked, even
   *  without a literal connecting line. 'exam' keeps a single trophy glyph
   *  since it's a genuine one-off milestone, not a systematic icon set. */
  function journeyNodeIcon(state) {
    if (state === 'done') {
      return '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 12.5 10 17.5 19 7.5" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    }
    if (state === 'current') {
      return '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="5" fill="currentColor"/></svg>';
    }
    if (state === 'exam') return '🏆';
    return '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="4" fill="currentColor"/></svg>';
  }

  function JourneyNode(label, state, wide) {
    const node = el('div', `journey-node ${state}${wide ? ' journey-node-wide' : ''}`);
    const icon = el('div', 'journey-node-icon');
    icon.innerHTML = journeyNodeIcon(state);
    node.appendChild(icon);
    node.appendChild(textNode('span', 'journey-node-label', label));
    return node;
  }

  /** One checklist row in "Today's Mission." Purely a checkbox — completion
   *  is derived client-side from data already fetched (see app.js), not a
   *  new stored flag. */
  function MissionItem(text, done) {
    const li = el('li', `mission-item${done ? ' done' : ''}`);
    li.appendChild(textNode('span', 'mission-item-check', done ? '✓' : ''));
    li.appendChild(textNode('span', null, text));
    return li;
  }

  /** One row of the "timing by skill" analytics recap (Version 3 Phase C) —
   *  real per-attempt `response_time_ms`, averaged per skill and grouped
   *  client-side from data an endpoint already returns (no new endpoint).
   *  `tag` is an optional short label ("⚡ الأسرع" / "🐢 الأبطأ") for the
   *  fastest/slowest skill in the set. */
  function TimingBar(skillNameAr, avgSeconds, tag) {
    const row = el('div', 'timing-row');
    const top = el('div', 'timing-row-top');
    const label = tag ? `${skillNameAr} ${tag}` : skillNameAr;
    top.appendChild(textNode('span', 'timing-row-label', label));
    top.appendChild(textNode('span', 'timing-row-value', `${avgSeconds} ثانية`));
    row.appendChild(top);
    return row;
  }

  /** An animated skill-mastery bar — same data as MasteryCard (CategoryMastery)
   *  but color-coded by strength and starting at 0% width so app.js's
   *  animateFillBars() can trigger a real fill-in animation on first paint. */
  function SkillProgressBar(category) {
    const row = el('div', 'skill-progress-row');
    const top = el('div', 'skill-progress-top');
    top.appendChild(textNode('span', 'skill-progress-label', CATEGORY_LABELS[category.category] || category.category));
    top.appendChild(textNode('span', 'skill-progress-percent', `${category.masteryPercent}%`));
    row.appendChild(top);
    const track = el('div', 'skill-progress-track');
    const strength = category.masteryPercent >= 70 ? 'strong' : category.masteryPercent >= 40 ? 'medium' : 'weak';
    const fill = el('div', `skill-progress-fill ${strength}`);
    fill.style.width = '0%';
    fill.dataset.targetWidth = category.masteryPercent;
    track.appendChild(fill);
    row.appendChild(track);
    return row;
  }

  /** One row in the "Upcoming" card (next review, mock exam, study reminder). */
  function UpcomingItem(icon, title, subtitle, onClick) {
    const item = el('div', 'upcoming-item');
    item.appendChild(textNode('span', 'upcoming-item-icon', icon));
    const text = el('div', 'upcoming-item-text');
    text.appendChild(textNode('strong', null, title));
    text.appendChild(textNode('span', null, subtitle));
    item.appendChild(text);
    if (onClick) item.onclick = onClick;
    return item;
  }

  /** A shared empty-state card — Supervisor Feedback Sprint: several dashboard
   *  sections (achievements, skill progress, recent activity) used to just
   *  `.hidden = true` themselves away entirely when a student had nothing yet,
   *  which reads as "broken/missing" rather than "intentional, come back
   *  later." One reusable component instead of each screen inventing its own
   *  empty copy — pass a short, encouraging line, never a bare "لا يوجد شيء". */
  function EmptyState(icon, text) {
    const card = el('div', 'card empty-state-card', [
      textNode('span', 'empty-state-icon', icon),
      textNode('p', 'empty-state-text', text),
    ]);
    return card;
  }

  /** Badge/achievement chip. */
  function AchievementCard(badge) {
    const card = el('div', 'card achievement-card');
    card.appendChild(textNode('span', 'achievement-card-icon', badge.icon));
    const text = el('div', 'achievement-card-text');
    text.appendChild(textNode('strong', null, badge.title_ar));
    text.appendChild(textNode('span', null, badge.description_ar));
    card.appendChild(text);
    return card;
  }

  // NOTE: 🎓 not 📘 for "lesson" — found via visual QA that U+1F4D8 (blue book)
  // renders as a plain solid-color box (missing glyph) in some environments while
  // every other emoji here renders fine; 🎓 is a safer, equally on-theme choice.
  const NOTIFICATION_TYPE_ICONS = {
    daily_reminder: '👋', exam_reminder: '⏰', lesson_complete: '🎓',
    revision_reminder: '🔁', streak_reminder: '🔥',
    // Version 5 Phase L additions.
    skill_staleness: '🌙', daily_challenge_ready: '🎯', timing_trend: '⚡',
  };

  /** One notification row — icon-per-type mirrors ActivityCard's convention below,
   *  so the notification list doesn't read as a plain unadorned text list. */
  function NotificationCard(notification, onMarkRead) {
    const card = el('div', `card notification-card${notification.isRead ? '' : ' unread'}`);
    if (!notification.isRead) card.onclick = () => onMarkRead(notification.id);
    card.appendChild(textNode('span', 'notification-card-icon', NOTIFICATION_TYPE_ICONS[notification.type] || '🔔'));
    const text = el('div', 'notification-card-text');
    text.appendChild(textNode('strong', 'notification-card-title', notification.title));
    text.appendChild(textNode('p', 'notification-card-body', notification.body));
    card.appendChild(text);
    return card;
  }

  const SESSION_TYPE_LABELS = { diagnostic: 'تشخيص', lesson: 'درس', practice: 'مراجعة', mock_exam: 'اختبار تجريبي' };
  const SESSION_TYPE_ICONS = { diagnostic: '📝', lesson: '🎓', practice: '🔁', mock_exam: '🎯' };

  /** One row in the dashboard's "recent activity" list. */
  function ActivityCard(session) {
    const card = el('div', 'card activity-item');
    card.appendChild(textNode('span', 'activity-item-icon', SESSION_TYPE_ICONS[session.sessionType] || '•'));
    const text = el('div', 'activity-item-text');
    const date = session.completedAt ? new Date(session.completedAt) : null;
    const dateLabel = date ? date.toLocaleDateString('ar-SA', { month: 'short', day: 'numeric' }) : '';
    text.appendChild(textNode('strong', null, SESSION_TYPE_LABELS[session.sessionType] || session.sessionType));
    text.appendChild(textNode('span', null, dateLabel));
    card.appendChild(text);
    if (session.scoreEstimate !== null && session.scoreEstimate !== undefined) {
      card.appendChild(textNode('span', 'activity-item-score', `${session.scoreEstimate}%`));
    }
    return card;
  }

  const CATEGORY_LABELS = {
    verbal_analogy: 'التناظر اللفظي', sentence_completion: 'إكمال الجمل',
    reading_comprehension: 'استيعاب المقروء', contextual_error: 'الخطأ السياقي',
    arithmetic: 'الحساب', fractions: 'الكسور', decimals: 'الأعداد العشرية',
    percentages: 'النسب المئوية', ratios_and_proportions: 'النسبة والتناسب',
    algebra: 'الجبر', exponents_and_roots: 'الأسس والجذور', geometry: 'الهندسة',
    statistics: 'الإحصاء', probability: 'الاحتمال', quantitative_comparison: 'المقارنات الكمية',
    data_interpretation: 'تحليل البيانات', multi_step_word_problems: 'المسائل اللفظية',
  };

  return {
    escapeHtml, ConceptCard, WorkedExampleCard, QuizOptions, HintCard, EmptyState,
    XPCard, StreakCard, MasteryCard, AchievementCard, NotificationCard, ActivityCard,
    RuleCard, FormulaCard, CommonMistakeCard, MemoryTechniqueCard,
    QuickRevisionCard, CheckpointCard, FeedbackCard, SummaryCard,
    JourneyNode, MissionItem, SkillProgressBar, UpcomingItem, TimingBar,
    StrategyCard, EquationBalanceCard, GraphCard, ReadingHighlightCard, VocabularyCard, Flashcard,
    // Version 6 Phase M additions.
    NumberLineCard, FractionCard, PercentageGridCard, ComparisonCard, FlowDiagramCard,
    MindMapCard, GeometrySVGCard, RatioCard, TimelineCard, InteractiveActivityCard, QuizCard,
    CATEGORY_LABELS,
  };
})();
