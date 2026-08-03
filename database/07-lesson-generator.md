# Qudrat AI Tutor — Phase 1: Lesson Generator

**Requirement traced:** FR-04 — "AI-generated interactive lessons: concept → worked example → retrieval quiz with instant feedback; completable in 10–15 minutes."
**Input:** a single `skill_id` (from the ZPD selector) + the student's `learning_records` for context.
**Output:** one `lessons` row + 5–8 `practice_items` rows, validated before the student ever sees them.

---

## 1. Pipeline Shape (three sequential API calls, not one)

Splitting into three calls instead of one big prompt, because each has a different failure mode and needs its own retry/validation logic — a single monolithic call would mean re-generating a good concept explanation just because one distractor option was too long.

```
Call 1: Concept + Worked Example  →  Call 2: Practice Items  →  Call 3: Validation pass
                                                                        │
                                                                        ▼
                                                          fail → regenerate just the failing item(s)
                                                          pass → persist, mark review_status
```

### Call 1 — Concept + Worked Example
- **Input context:** skill's `name_ar`, `category`, `base_difficulty`; the student's prior learning_record evidence for *prerequisite* skills (so the explanation can reference what she already knows — "بما إنك تعرفين قوانين الأسس، لاحظي كيف..."); the ZPD selector's one-sentence explanation (so tone is consistent between "why this lesson" and the lesson itself).
- **Output:** `concept_explanation` (jsonb — structured as an ordered list of short blocks: principle statement, then technique(s), then caution/edge-case, mirroring the style your own Discovery Report documented in Lesson 0001 §3.2 — "governing principle first, then techniques, then a caution about when NOT to apply them") and `worked_example` (jsonb — one fully solved problem showing the technique applied).
- **Grounding rule:** if the concept touches an ETEC-specific fact (exam structure, timing, scoring) rather than pure mathematics/language reasoning, the prompt must require citing a `resources` row (`is_official_etec = true`) — never generate exam-logistics claims from parametric knowledge. Pure math/verbal technique content (e.g., "critical values testing") doesn't need this, since it's general reasoning, not an ETEC-specific fact.

### Call 2 — Practice Items (5–8 items)
- **Input:** the concept explanation just generated (so questions test *that* explanation, not a generic version of the skill) + explicit formatting constraints from the skill's own quiz rule.
- **Hard constraints passed as instructions, not suggestions:**
  - Exactly 4 options per item.
  - All 4 options within the same character-length band (±20%) — "no formatting clues," per SKILL.md's quiz rule.
  - No two items share the same correct-option index more than ~60% of the time across the set (avoids a "always C" pattern a test-savvy student could exploit).
  - Arabic only, formal MSA, matching the glossary's canonical terms for this skill (pull `glossary_terms` where `skill_id` matches, pass as a term list the model must use consistently).
- **Output:** array of `{stem_ar, options[4], correct_option_index, explanation_ar, difficulty_level}` — one entry per `practice_items` row, `validation_status = 'pending'` initially.

### Call 3 — Validation Pass
This is **not** a third LLM call asking "is this right?" (an LLM grading its own sibling output is weak validation — it can confidently confirm its own mistake). Instead:

- **Answer-key check:** deterministic, not AI — for pure arithmetic/algebra items, actually compute the answer server-side where the item type allows it (e.g., parse a generated arithmetic expression and evaluate it) and compare to `correct_option_index`. For items where server-side computation isn't feasible (verbal analogies, reading comprehension), fall back to a **second, independent** Claude API call — different prompt, given *only* the stem and options (not told which one was "intended") — asked to solve it cold and state which option it picks. Flag a mismatch for human review rather than auto-rejecting (an independent-solver disagreement is a signal, not proof of error).
- **Option-length parity check:** deterministic string-length comparison, no AI needed.
- **Duplicate/near-duplicate check:** compare new items against existing `practice_items` for the same `skill_id` (embedding similarity or simple stem overlap) to avoid the item bank filling with near-copies over time.
- Each check writes into `practice_items.validation_checks` (jsonb) and sets `validation_status = 'passed'` only if **all** checks pass; otherwise `'failed'` and the item is regenerated (Call 2, just for the failing item) up to 2 retries before escalating to the human-review queue (§Phase 3 of the brief, but the `review_status`/`validation_status` columns already support queuing this from Phase 1).

This is the concrete mechanism behind §6's non-functional requirement: *"a wrong answer key is a trust-destroying event and is treated as a sev-1 bug."* — validation is structural, not a hope that the generation prompt was good enough.

---

## 2. Persisting Instead of Regenerating Live

Per §7 of the brief ("generated lessons and questions are persisted and reused ... never regenerate the same item live for every student"):

- Before running the pipeline for a given `skill_id`, check: does a `published`-or-`ai_generated`-and-`passed` lesson already exist for this skill at a similar `difficulty_level`? If yes, and no student-specific personalization is needed beyond what's already parameterized (see §3), **reuse it** — set the new `sessions.lesson_id` to the existing row instead of calling the pipeline again.
- The main thing that *would* force a fresh generation despite an existing lesson: the "reference prior mastered skills" personalization in Call 1 (the "بما إنك تعرفين..." framing) is student-specific. **Design choice: keep the core `concept_explanation` and `worked_example` reusable/shared, and generate the personalized framing sentence as a small separate field** (`lessons` doesn't need a new column for this — it's assembled at *render* time by prepending a one-line personalization string computed from the student's own learning_records, not stored per-lesson). This keeps the expensive generation reusable while the cheap personalization stays dynamic.

---

## 3. Practice Set Composition Within One Lesson (interleaving, in miniature)

FR-06 asks for interleaving across the broader practice queue, but even within a single lesson's 5-8 items, the brief's Lesson 0001 example (§3.2 of your Discovery Report) mixed straightforward applications with one deliberately harder edge case (the x³ vs x² comparison). Reproduce that shape explicitly in Call 2's instructions:
- Items 1–3: direct application of the concept just explained (confidence-building).
- Items 4–6: the same technique under a slightly varied setup.
- Items 7–8 (if 8 total): one item that resembles a *related but distinct* skill just enough to test whether the student over-generalizes the technique — this is deliberately the "hardest, most instructive" item, and per §4 below, answering it correctly is treated as **stronger** evidence than the earlier items.

---

## 4. Handoff to the Learning-Record Writer (next piece)

The lesson generator's output must carry enough structure for the writer (not built yet) to distinguish "got the easy items right" from "got the hard, discriminating item right" — this is why `practice_items.difficulty_level` exists per-item, not just per-lesson. The writer will need this to implement the exact distinction your own Discovery Report drew in §3.5 ("a perfect score alone is coverage, not evidence... "). That piece is next.

---

## 5. Prompt Versioning (per §7: "prompts are code")

- Every system prompt used in Calls 1–3 lives in a `prompts/` directory in version control, not inline in application code — e.g. `prompts/lesson-concept-v1.md`, `prompts/lesson-items-v1.md`, `prompts/lesson-validation-solver-v1.md`.
- `lessons.generation_prompt_version` (already in the schema) stores which version produced each lesson, so a prompt regression can be traced to exactly which lessons need regenerating.

---

## 6. Structured Content Blocks (Version 6 — Content Studio foundation)

**Added this sprint, additive only** — everything in §1–5 above is unchanged and still
governs the live-generation pipeline exactly as before. This section documents a second,
richer content shape for **curated** lessons, in preparation for a future no-code
authoring tool ("Content Studio").

### 6.1 Why a second shape

The original `concept_explanation`/`worked_example` shape (§1) is what the 3-call
generation pipeline produces and is what every live-generated lesson still uses. But a
premium, "experienced not read" lesson needs more structure than that — a hero moment, a
distinct visual concept, a mini explanation, an interactive activity, etc. Rather than
redesigning the generation pipeline (and its hardened retry/validation logic) around this
richer shape, curated lessons get an **additive** `lessons.sections` column instead.

### 6.2 The shape

`lessons.sections` is `jsonb`, nullable, an ordered array. Each entry:

```ts
interface LessonSection {
  sectionType: 'hero' | 'objective' | 'concept' | 'worked_example' | 'activity' | 'hint' | 'summary';
  component: string;         // a public/lesson-renderer.js COMPONENT_REGISTRY key
  title_ar?: string;
  body_ar?: string;
  visual?: VisualSpec;       // see src/types/index.ts
  parameters?: Record<string, unknown>; // component-specific curated data
}
```

`public/lesson-renderer.js`'s `renderSection`/`renderLessonSections` already implement the
"automatic assembly" this format promises: given an ordered `sections[]` array, each entry
is rendered by looking up `component` in `COMPONENT_REGISTRY` — a plain name → render-
function table already covering every card in `public/Cards.js` (concept/rule/formula/
mistake/memory-technique cards, worked examples, hints, checkpoints, summaries, strategy/
equation-balance/graph/reading-highlight/vocabulary/flashcard, and — as of Version 6 Phase
M — number-line/fraction/percentage-grid/comparison/flow-diagram/mind-map/geometry/ratio/
timeline/coordinate-plane wrappers and the interactive-activity primitive). **Authoring a
new lesson in this shape requires zero new frontend code**, as long as every `component`
value names something already in the registry — new lesson content becomes pure data.

### 6.3 Authoring today vs. the future Content Studio

Today, `sections[]` is authored the same way every other piece of curated content in this
project is: hand-reviewed, LLM-assisted restructuring of a lesson's own real material
(never fabricated facts), written via `PostgresStore.updateLessonSections(lessonId,
sections)`, one lesson at a time. A future Content Studio would target this exact same
shape as its output format — an educator fills in Lesson → Visual → Example → Hint →
Question → Publish, and the tool serializes that into a `LessonSection[]` array written to
this same column. The rendering engine (`lesson-renderer.js`) needs no changes to support
that future tool; only the authoring surface (a UI, instead of a script) would be new.

### 6.4 What stays untouched

- The 3-call generation pipeline (§1–4) and its validation/retry logic: unchanged. Live-
  generated lessons never populate `sections` and keep rendering via the legacy path.
- `concept_explanation`/`worked_example`: still the source of truth for every lesson
  without `sections` — never removed, never migrated away from.
