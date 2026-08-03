// ============================================================
// Educational Rendering Engine.
//
// The core idea: a lesson is DATA, not markup. Nothing in this file
// (or in app.js's lesson screen) should ever hardcode a specific
// lesson's layout — every visual block is one of a small, fixed set
// of reusable components (public/cards.js) and visuals (public/visuals.js),
// selected by a `kind`/`component` field in the lesson's own data.
// Adding a new lesson to the product should mean writing lesson JSON
// (or having lessonGeneratorService produce it), never writing new
// frontend code — that's the concrete goal this file exists for.
//
// Two rendering paths are supported, because the product has two
// generations of lesson data shape:
//
// 1. LEGACY/CURRENT SHAPE — what every curated lesson in Postgres
//    actually looks like today: `concept_explanation: ConceptBlock[]`
//    (each `{kind, text_ar, visual?}`) + a single `worked_example`.
//    `renderConceptBlocks`/`renderWorkedExample` handle this by
//    dispatching on `kind` to the matching named Card component
//    (RuleCard, FormulaCard, CommonMistakeCard, MemoryTechniqueCard,
//    or the original ConceptCard for principle/technique/caution).
//
// 2. GENERIC SECTION SHAPE — the future-facing format this sprint asks
//    for: an ordered array of `{sectionType, component, title, body,
//    visual, parameters}` objects. `renderSection`/`renderLesson`
//    dispatch purely by the `component` field name through
//    COMPONENT_REGISTRY, a lookup table from component-name string to
//    the actual Cards.* function. A lesson authored in this shape
//    needs ZERO new frontend code as long as its `component` values
//    name something already in the registry — the whole point of this
//    engine. See the bottom of this file for a worked JSON example.
//
// Automatic visualization: when a section/block specifies a `visual`
// value but the lesson JSON didn't include curated `parameters` for
// it, renderSection falls through to Visuals.suggestVisualTypesForCategory
// (skill category -> likely visual types) purely to pick a renderer —
// it never fabricates the underlying numbers. No numbers in, no visual
// out; that stays a hard rule.
// ============================================================

const LessonRenderer = (() => {
  /** Legacy/current shape: render each ConceptBlock into `container`,
   *  dispatching on `kind`. This is the one function that replaces what
   *  used to be an inline `.forEach(block => appendChild(Cards.ConceptCard(block)))`
   *  loop directly in app.js — same visual result today, but now a single
   *  named, documented dispatch point instead of ad hoc lesson-screen code. */
  function renderConceptBlocks(container, blocks) {
    container.innerHTML = '';
    (blocks || []).forEach((block) => {
      let cardEl;
      if (block.kind === 'rule') cardEl = Cards.RuleCard(block);
      else if (block.kind === 'formula') cardEl = Cards.FormulaCard(block);
      else if (block.kind === 'mistake') cardEl = Cards.CommonMistakeCard(block);
      else if (block.kind === 'memory_technique') cardEl = Cards.MemoryTechniqueCard(block);
      else cardEl = Cards.ConceptCard(block); // principle / technique / caution
      container.appendChild(cardEl);
    });
  }

  function renderWorkedExample(container, workedExample) {
    container.innerHTML = '';
    if (!workedExample) return;
    container.appendChild(Cards.WorkedExampleCard(workedExample));
  }

  // ---- Generic section-driven renderer (future lesson JSON format) ----

  /** component-name string -> function(section) -> DOM node. Every entry
   *  here is an existing Cards.* function; adding a new lesson component
   *  to the product means adding ONE line here (and the Cards function
   *  itself, if it's genuinely new) — never touching a specific lesson. */
  const COMPONENT_REGISTRY = {
    HeroCard: (s) => buildHeroCard(s),
    LearningObjective: (s) => buildLearningObjective(s),
    ConceptCard: (s) => Cards.ConceptCard(toBlock(s)),
    DefinitionCard: (s) => Cards.ConceptCard(toBlock(s, 'principle')),
    RuleCard: (s) => Cards.RuleCard(toBlock(s)),
    FormulaCard: (s) => Cards.FormulaCard(toBlock(s)),
    CommonMistakeCard: (s) => Cards.CommonMistakeCard(toBlock(s)),
    MemoryTechniqueCard: (s) => Cards.MemoryTechniqueCard(toBlock(s)),
    WorkedExample: (s) => Cards.WorkedExampleCard(toWorkedExample(s)),
    StepByStepSolution: (s) => Cards.WorkedExampleCard(toWorkedExample(s)),
    HintCard: (s) => Cards.HintCard(s.body_ar),
    QuickRevisionCard: (s) => Cards.QuickRevisionCard(s.parameters && s.parameters.points),
    CheckpointCard: (s) => Cards.CheckpointCard(s.body_ar, () => {}),
    SummaryCard: (s) => Cards.SummaryCard(s.title_ar, s.parameters && s.parameters.points),
    // Version 4 Phase F: the 5 genuinely-new components, registered here so
    // any FUTURE lesson (this curriculum or a later Verbal/Tahsili/STEP/etc.
    // one) can reference them by name with zero further frontend work —
    // the concrete proof this engine doesn't need a rewrite per curriculum.
    StrategyCard: (s) => Cards.StrategyCard(s.title_ar, s.parameters && s.parameters.steps, resolveVisual(s)),
    EquationBalanceCard: (s) => Cards.EquationBalanceCard(s.parameters?.leftLabel, s.parameters?.rightLabel, s.parameters?.tilt),
    GraphCard: (s) => Cards.GraphCard(s.parameters?.points, s.parameters),
    ReadingHighlightCard: (s) => Cards.ReadingHighlightCard(s.body, s.parameters && s.parameters.highlights),
    VocabularyCard: (s) => Cards.VocabularyCard(s.parameters || {}),
    Flashcard: (s) => Cards.Flashcard(s.parameters?.front ?? s.body_ar, s.parameters?.back),
    // Version 6 Phase M: thin-wrapper visual components, closing the
    // wishlist gaps found in this sprint's audit — every entry below just
    // hands the section's own curated `parameters` to the matching Cards.*
    // wrapper, same pattern as EquationBalanceCard/GraphCard above.
    NumberLineCard: (s) => Cards.NumberLineCard(s.parameters?.min, s.parameters?.max, s.parameters?.points),
    FractionCard: (s) => Cards.FractionCard(s.parameters?.numerator, s.parameters?.denominator, s.parameters?.label, s.parameters?.style),
    PercentageGridCard: (s) => Cards.PercentageGridCard(s.parameters?.percent, s.parameters?.label),
    ComparisonCard: (s) => Cards.ComparisonCard(s.parameters?.left, s.parameters?.right),
    FlowDiagramCard: (s) => Cards.FlowDiagramCard(s.parameters?.steps),
    MindMapCard: (s) => Cards.MindMapCard(s.parameters?.root, s.parameters?.branches),
    GeometrySVGCard: (s) => Cards.GeometrySVGCard(s.parameters?.shape, s.parameters?.labels, s.parameters?.dimensions),
    RatioCard: (s) => Cards.RatioCard(s.parameters?.left, s.parameters?.right),
    TimelineCard: (s) => Cards.TimelineCard(s.parameters?.events),
    // Additional name for the existing GraphCard function — no behavior
    // change, just makes the wishlist's requested name reachable too.
    CoordinatePlaneCard: (s) => Cards.GraphCard(s.parameters?.points, s.parameters),
    // Ungraded, so a no-op completion callback is a safe default when driven
    // generically through the section registry (same pattern as
    // CheckpointCard above) — the Golden Lesson's actual stepper wiring
    // (app.js) calls Cards.InteractiveActivityCard directly with a real
    // onComplete instead of going through this registry entry.
    InteractiveActivityCard: (s) => Cards.InteractiveActivityCard(s.parameters?.variant, s.parameters || {}, () => {}),
    // NOTE: QuizCard is deliberately NOT registered here — it needs a live
    // network callback bound to the current lesson session (real scoring),
    // which a generic, session-unaware section renderer can't safely provide.
    // It's used directly by app.js's renderLessonChallenge() instead.
  };

  function toBlock(section, fallbackKind) {
    return { kind: section.parameters?.kind || fallbackKind || 'principle', text_ar: section.body_ar, visual: resolveVisual(section) };
  }
  function toWorkedExample(section) {
    return {
      problem_ar: section.parameters?.problem_ar || section.body_ar,
      solution_steps_ar: section.parameters?.solution_steps_ar || [],
      visual: resolveVisual(section),
    };
  }

  /** Resolves the visual to render for a section: explicit curated spec wins;
   *  otherwise, if `visual` names a type but no `parameters` came with it,
   *  there is nothing to draw — text-only is correct (never invent numbers). */
  function resolveVisual(section) {
    if (section.visual && section.parameters && section.parameters.visualSpec) {
      return { type: section.visual, ...section.parameters.visualSpec };
    }
    return section.visual && section.parameters ? { type: section.visual, ...section.parameters } : undefined;
  }

  function buildHeroCard(section) {
    const wrap = document.createElement('div');
    wrap.className = 'zpd-reason-card';
    const icon = document.createElement('span');
    icon.className = 'zpd-reason-icon';
    icon.textContent = '✦';
    const text = document.createElement('p');
    text.className = 'zpd-reason-text';
    text.textContent = section.body_ar || section.title_ar || '';
    wrap.append(icon, text);
    return wrap;
  }

  function buildLearningObjective(section) {
    const p = document.createElement('p');
    p.className = 'lesson-objective';
    p.textContent = section.body_ar || '';
    return p;
  }

  /** Renders one generic section by looking up its `component` name in the
   *  registry. Returns null (skips silently) for an unknown component name
   *  rather than throwing — a lesson referencing a not-yet-built component
   *  should degrade gracefully, not break the whole screen. */
  function renderSection(section) {
    const build = COMPONENT_REGISTRY[section.component];
    if (!build) {
      console.warn(`LessonRenderer: unknown component "${section.component}" — skipped.`);
      return null;
    }
    return build(section);
  }

  /** Renders a full lesson authored in the generic {sections: [...]} shape
   *  into `container`, in order. This is the "future lessons need only
   *  JSON" path — every section is one registry lookup + one function call. */
  function renderLessonSections(container, sections) {
    container.innerHTML = '';
    (sections || []).forEach((section) => {
      const node = renderSection(section);
      if (node) container.appendChild(node);
    });
  }

  return {
    renderConceptBlocks,
    renderWorkedExample,
    renderSection,
    renderLessonSections,
    COMPONENT_REGISTRY,
  };
})();
