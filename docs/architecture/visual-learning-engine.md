# Visual Learning Engine

`public/visuals.js`

## Purpose

Math and verbal-reasoning concepts are frequently easier to grasp visually
than in prose (a number line for critical values, a fraction bar for
comparing fractions, an equation-balance diagram for solving for `x`). This
module renders a `VisualSpec` (typed in `src/types/index.ts`) as hand-coded
inline SVG — the same technique the dashboard's progress arc already used in
`index.html`/`app.js` before this module existed. No charting library, no
build step.

Visuals are authored as curated lesson content (real numbers baked into the
spec by whoever/whatever authors the lesson), never generated live
per-request — a visual either faithfully represents real data or isn't
rendered at all.

## Supported visual types

| `spec.type` | Renderer | Typical use |
|---|---|---|
| `number_line` | `renderNumberLine` | critical values, inequalities |
| `geometry` | `renderGeometry` | shapes with labeled dimensions |
| `table` | `renderTable` | statistics, data interpretation |
| `flow_diagram` | `renderFlowDiagram` | multi-step arithmetic/algebra |
| `bar_chart` | `renderBarChart` | statistics comparisons |
| `fraction_bar` | `renderFractionBar` | fraction magnitude/comparison |
| `pie_fraction` | `renderPieFraction` | fraction-of-whole |
| `percentage_grid` | `renderPercentageGrid` | percentage/probability |
| `comparison_bar` | `renderComparisonBar` | quantitative comparison, ratios |
| `ratio_bar` | `renderRatioBar` | ratios and proportions |
| `mind_map` | `renderMindMap` | verbal analogy/reading structure |
| `equation_balance` | `renderEquationBalance` | algebra (solving for x) |
| `coordinate_plane` | `renderCoordinatePlane` | algebra, linear/quadratic graphs |
| `timeline` | `renderTimeline` | sequenced events/steps |

`Visuals.render(spec)` dispatches on `spec.type`, wraps the result in a
`.visual-container`, and returns `null` for an unrecognized/missing spec so
callers can cleanly fall back to text-only content.

## RTL-aware rendering detail

Number lines are inherently a left-to-right convention even inside an RTL
(Arabic) page. `renderNumberLine` sets `dir="ltr"` explicitly, matching the
existing `.counter-ltr` convention already used elsewhere in `style.css` for
exam timers and digit sequences — everything else in the UI stays RTL.

## Automatic visual-type suggestion — never fabricated data

`suggestVisualTypesForCategory(category)` maps a skill's category (e.g.
`fractions`, `algebra`, `geometry`) to the visual types most likely to help,
via a static `CATEGORY_VISUAL_HINTS` lookup table. This exists purely so
[the lesson rendering engine](lesson-rendering-engine.md) can pick a sensible
**renderer** when a section names a `visual` but no curated `parameters` —
it never invents the underlying numbers/data. If there's no real data for a
visual, no visual is rendered; text-only content is always the fallback.

## Design constraints

- Zero dependencies — every visual is hand-built `document.createElementNS`
  SVG.
- Arabic labels use `'IBM Plex Sans Arabic', sans-serif` consistently across
  every renderer.
- Same IIFE-global pattern as `Cards`/`LessonRenderer`/`Companion` — a
  top-level `const Visuals`, referenced as the bare identifier, not
  `window.Visuals`.
