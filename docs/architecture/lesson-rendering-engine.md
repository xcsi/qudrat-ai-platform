# Lesson Rendering Engine

`public/lesson-renderer.js` + `public/Cards.js`

## Core idea

A lesson is **data**, not markup. Nothing in the renderer or in `app.js`'s
lesson screen hardcodes a specific lesson's layout — every visual block is
one of a small, fixed set of reusable components (`Cards.js`) and visuals
(`visuals.js`), selected by a `kind`/`component` field in the lesson's own
data. Adding a new lesson to the product means writing lesson JSON (or having
`lessonGeneratorService` produce it) — never writing new frontend code.

## Two supported shapes

The product has two generations of lesson data shape, and the renderer
supports both:

### 1. Legacy/current shape

What every curated lesson in Postgres actually looks like today:
`concept_explanation: ConceptBlock[]` (each `{kind, text_ar, visual?}`) plus a
single `worked_example`.

`renderConceptBlocks(container, blocks)` dispatches on `kind`:

| `kind` | Component |
|---|---|
| `rule` | `Cards.RuleCard` |
| `formula` | `Cards.FormulaCard` |
| `mistake` | `Cards.CommonMistakeCard` |
| `memory_technique` | `Cards.MemoryTechniqueCard` |
| anything else (`principle`, `technique`, `caution`) | `Cards.ConceptCard` |

`renderWorkedExample(container, workedExample)` renders the single worked
example via `Cards.WorkedExampleCard`.

### 2. Generic section shape (forward-looking format)

An ordered array of section objects:

```json
{ "sectionType": "...", "component": "...", "title_ar": "...", "body_ar": "...", "visual": "...", "parameters": {} }
```

`renderSection`/`renderLessonSections` dispatch purely by the `component`
field name through `COMPONENT_REGISTRY` — a lookup table from component-name
string to the matching `Cards.*` function (`HeroCard`, `LearningObjective`,
`RuleCard`, `FormulaCard`, `WorkedExample`, `SummaryCard`, and others). A
lesson authored in this shape needs **zero new frontend code** as long as its
`component` values already exist in the registry — that's the entire point
of this engine. Extending it to support a genuinely new component is one
line in `COMPONENT_REGISTRY` plus the `Cards.*` function itself.

The Golden Lesson authoring script (`src/harness/authorGoldenLesson.ts`) is
the current real producer of this shape: objective → concept/visual blocks →
worked example → interactive activity → hint → reflection → summary.

## Automatic visualization

When a section specifies a `visual` value but the lesson JSON didn't include
curated `parameters` for it, `renderSection` falls through to
`Visuals.suggestVisualTypesForCategory` (skill category → likely visual
types) purely to **pick a renderer** — it never fabricates the underlying
numbers. No numbers in, no visual out is a hard rule; see
[Visual Learning Engine](visual-learning-engine.md).

## Card components (`Cards.js`)

`Cards.js` is the full component library the renderer dispatches into:
concept cards (rule/formula/mistake/memory-technique), a worked-example card,
an interactive-activity card, quiz/hint/quick-revision cards, and
visualization-backed cards (equation balance, graph, number line, fraction,
percentage grid, comparison, flow diagram, mind map, geometry SVG, ratio,
timeline, reading-highlight, vocabulary, flashcard). Every card is a plain
DOM-building function — no template strings for structure, `escapeHtml` used
anywhere untrusted/AI-generated text is interpolated (see
[AI Architecture](ai-architecture.md) for why untrusted text handling
matters here).

## Why no framework

This matches the rest of the project's zero-build-step architecture: plain
IIFE-exposed globals (`Cards`, `LessonRenderer`, `Visuals`, `Companion`), no
bundler, no virtual DOM. Every script is a top-level lexical `const`, not a
`window.X` property — other scripts reference the bare identifier.
