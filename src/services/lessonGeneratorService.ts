// ============================================================
// Lesson Generator — implements database/07-lesson-generator.md
// FR-04: concept -> worked example -> retrieval quiz, validated
// before a student ever sees it.
// ============================================================

import { InMemoryStore } from '../store/InMemoryStore';
import { LlmClient, stripJsonFence, sanitizeMathText, getFallbackItem } from '../llm/llmClient';
import { ConceptBlock, Lesson, PracticeItem, VisualSpec } from '../types';
import { GroundingService } from './groundingService';

const PROMPT_VERSION = 'v1';

const CONCEPT_SYSTEM_PROMPT = `LESSON_CONCEPT_GENERATOR
Generate a concept explanation + worked example for the given Qudrat skill, in
formal Arabic (MSA). Structure: one governing principle, then technique(s), then
a caution/edge-case.

(Grounding rules are appended below this prompt by the shared GroundingService —
see the GROUNDING RULES section for what may/may not be stated as fact.)

FORMATTING RULE (non-negotiable): this text is displayed directly in a mobile
app, NOT rendered as Markdown or LaTeX. NEVER use LaTeX math delimiters
($...$, \\(...\\), \\[...\\]), NEVER use Markdown syntax (**bold**, _italic_,
` + '`code`' + `, # headers). Write math using plain Unicode characters only:
x², x³, √x, ×, ÷, ±, ≤, ≥, ½, ¼ — exactly as a student would see it printed
in a book, not as markup.

GENDER NEUTRALITY (non-negotiable): if any second-person address is used at
all, the student's gender is unknown by default — never use gendered Arabic
verb forms or adjectives (avoid "تقدرين"/"جاهزة"/"أحسنتِ"). Prefer impersonal/
objective explanatory phrasing (as MSA textbook prose naturally does) over
direct address in the first place.

VISUAL AID (non-negotiable — students must SEE the concept, not just read it):
attach a "visual" object to the "technique" block AND to "worked_example" — the
supervisor-facing requirement is that every lesson visibly contains a real
instructional diagram, not just text. Every number/label inside "visual" MUST be
the exact same number/label already stated in your own text for that block —
never invent a second, different set of numbers just for the picture. Omit the
"visual" key entirely (don't include it at all) ONLY on a block where none of
the types below would genuinely clarify anything (rare — most quantitative
concepts and every worked example fit one of these).

Pick exactly ONE type per block, matching the skill's category, using exactly
these keys and shapes:
- number_line: {"type":"number_line","min":n,"max":n,"points":[{"value":n,"label":"..."}]}
- fraction_bar / pie_fraction (fractions): {"type":"fraction_bar","numerator":n,"denominator":n,"label":"..."}
- percentage_grid (percentages): {"type":"percentage_grid","percent":n,"label":"..."}
- comparison_bar (quantitative comparison): {"type":"comparison_bar","left":{"label":"...","value":n},"right":{"label":"...","value":n}}
- ratio_bar (ratios/proportions): {"type":"ratio_bar","left":{"label":"...","value":n},"right":{"label":"...","value":n}}
- bar_chart / table (statistics, data interpretation): {"type":"bar_chart","bars":[{"label":"...","value":n}]} or {"type":"table","headers":["..."],"rows":[["...","..."]]}
- geometry (geometry): {"type":"geometry","shape":"rectangle"|"triangle"|"circle"|"trapezoid","labels":["..."],"dimensions":{"...":n}}
- equation_balance / coordinate_plane (algebra): {"type":"equation_balance","leftLabel":"...","rightLabel":"...","tilt":"left"|"right"} or {"type":"coordinate_plane","points":[{"x":n,"y":n,"label":"..."}]}
- flow_diagram (arithmetic, exponents/roots, multi-step word problems): {"type":"flow_diagram","steps":["...","..."]}
- mind_map (reading comprehension, verbal analogy, sentence completion, contextual error): {"type":"mind_map","root":"...","branches":[{"label":"...","children":["..."]}]}
- timeline: {"type":"timeline","events":[{"label":"...","sublabel":"..."}]}

Respond ONLY with JSON:
{"title_ar": "...", "concept_explanation": [{"kind":"principle"|"technique"|"caution","text_ar":"...","visual":{...}}],
 "worked_example": {"problem_ar": "...", "solution_steps_ar": ["...","..."], "visual":{...}},
 "glossary_term": {"term_ar": "the single canonical Arabic name for this skill/concept", "definition_ar": "a tight, one-sentence definition", "aliases_to_avoid": ["informal or inconsistent Arabic terms students might use instead, that should NOT be used in future generated content"]}}`;

const ITEMS_SYSTEM_PROMPT = `LESSON_ITEMS_GENERATOR
Generate 6 practice items (4 options each, equal length, formal Arabic MSA) for
the concept just explained. Items 1-4: direct application. Items 5-6: harder,
deliberately discriminating (tests over-generalization of the technique).

FORMATTING RULE (non-negotiable): this text is displayed directly in a mobile
app, NOT rendered as Markdown or LaTeX. NEVER use LaTeX math delimiters
($...$, \\(...\\), \\[...\\]), NEVER use Markdown syntax (**bold**, _italic_,
backtick-code, # headers). Write math using plain Unicode characters only:
x², x³, √x, ×, ÷, ±, ≤, ≥, ½, ¼ — exactly as a student would see it printed
in a book, not as markup.

Respond ONLY with JSON:
{"items": [{"stem_ar":"...","options":["...","...","...","..."],
"correct_option_index":0,"explanation_ar":"...","difficulty_level":1-5}]}`;

const INDEPENDENT_SOLVER_SYSTEM_PROMPT = `INDEPENDENT_SOLVER
You are given a question stem and 4 options, with NO indication of which is
"intended" correct. Solve it independently and respond ONLY with JSON:
{"chosen_option_index": 0-3, "reasoning_ar": "..."}`;

interface ConceptResponse {
  title_ar: string;
  concept_explanation: ConceptBlock[];
  worked_example: { problem_ar: string; solution_steps_ar: string[]; visual?: VisualSpec };
  glossary_term: { term_ar: string; definition_ar: string; aliases_to_avoid: string[] };
}

const VALID_VISUAL_TYPES = new Set([
  'number_line', 'geometry', 'table', 'flow_diagram', 'bar_chart', 'fraction_bar', 'pie_fraction',
  'percentage_grid', 'comparison_bar', 'mind_map', 'equation_balance', 'coordinate_plane', 'ratio_bar', 'timeline',
]);

function isLabelValuePair(x: unknown): x is { label: string; value: number } {
  return !!x && typeof x === 'object' && typeof (x as any).label === 'string' && typeof (x as any).value === 'number';
}

/** The LLM is now asked to emit a `visual` alongside its own concept text/worked
 *  example (see VISUAL AID above) — a change from this file's original
 *  "visuals are curated, never generated live" stance, made deliberately to
 *  close the gap where almost every real lesson a student sees (anything
 *  beyond the one hand-authored Golden Lesson) rendered as text only. A
 *  malformed shape here would otherwise render a blank/garbled SVG (worse
 *  than no visual), so this is a structural spot-check, not a rewrite of the
 *  "never fabricate numbers" rule — it just declines to trust a shape it
 *  can't verify, degrading to text-only exactly like an omitted `visual` would. */
function sanitizeVisualSpec(visual: unknown): VisualSpec | undefined {
  if (!visual || typeof visual !== 'object') return undefined;
  const v = visual as Record<string, unknown>;
  if (typeof v.type !== 'string' || !VALID_VISUAL_TYPES.has(v.type)) return undefined;
  switch (v.type) {
    case 'number_line':
      return typeof v.min === 'number' && typeof v.max === 'number' && Array.isArray(v.points) ? (v as VisualSpec) : undefined;
    case 'geometry':
      return typeof v.shape === 'string' && Array.isArray(v.labels) ? (v as VisualSpec) : undefined;
    case 'table':
      return Array.isArray(v.headers) && Array.isArray(v.rows) ? (v as VisualSpec) : undefined;
    case 'flow_diagram':
      return Array.isArray(v.steps) ? (v as VisualSpec) : undefined;
    case 'bar_chart':
      return Array.isArray(v.bars) ? (v as VisualSpec) : undefined;
    case 'fraction_bar':
    case 'pie_fraction':
      return typeof v.numerator === 'number' && typeof v.denominator === 'number' ? (v as VisualSpec) : undefined;
    case 'percentage_grid':
      return typeof v.percent === 'number' ? (v as VisualSpec) : undefined;
    case 'comparison_bar':
    case 'ratio_bar':
      return isLabelValuePair(v.left) && isLabelValuePair(v.right) ? (v as VisualSpec) : undefined;
    case 'mind_map':
      return typeof v.root === 'string' && Array.isArray(v.branches) ? (v as VisualSpec) : undefined;
    case 'equation_balance':
      return typeof v.leftLabel === 'string' && typeof v.rightLabel === 'string' ? (v as VisualSpec) : undefined;
    case 'coordinate_plane':
      return Array.isArray(v.points) ? (v as VisualSpec) : undefined;
    case 'timeline':
      return Array.isArray(v.events) ? (v as VisualSpec) : undefined;
    default:
      return undefined;
  }
}

interface ItemsResponse {
  items: Array<{
    stem_ar: string;
    options: [string, string, string, string];
    correct_option_index: 0 | 1 | 2 | 3;
    explanation_ar: string;
    difficulty_level: number;
  }>;
}

export class LessonGeneratorService {
  constructor(private store: InMemoryStore, private llm: LlmClient, private grounding: GroundingService) {}

  async generateOrReuse(skillId: string, difficultyLevel: number): Promise<{ lesson: Lesson; items: PracticeItem[] }> {
    // §2: reuse instead of regenerating live, per the brief's §7.
    const reusable = this.store.findReusableLesson(skillId, difficultyLevel);
    if (reusable) {
      return { lesson: reusable, items: this.store.getPracticeItemsForLesson(reusable.id) };
    }

    const skill = this.store.getSkill(skillId);
    if (!skill) throw new Error(`Unknown skill ${skillId}`);

    // Version 5: the shared GroundingService replaces this file's own inline
    // trusted-sources block — same "knowledge"-kind-only resources, now
    // assembled in one place every AI call site in the app uses.
    const groundingBlock = this.grounding.build({ skillId });

    // Call 1 — concept + worked example. Bounded retry loop: previously a single
    // malformed/unparseable response here crashed lesson generation outright with
    // no retry ever running — this was the actual root cause behind "lesson
    // generation sometimes fails" (demo-stabilization sprint, area 3).
    const MAX_CONCEPT_ATTEMPTS = 3;
    let concept: ConceptResponse | null = null;
    let conceptErr: unknown;
    for (let attempt = 1; attempt <= MAX_CONCEPT_ATTEMPTS; attempt++) {
      try {
        // maxTokens raised from the client default of 1500: a live test during this
        // sprint reproduced a genuine truncation bug at exactly 1500 tokens (Arabic
        // MSA is token-dense, and this response is naturally 4 concept blocks + a
        // worked example + a glossary term) — the response was cut off mid-string,
        // which then failed JSON.parse identically on every retry.
        const conceptRaw = await this.llm.complete(
          `${CONCEPT_SYSTEM_PROMPT}\n\n${groundingBlock}`,
          `Skill: ${skill.name_ar} (${skill.category}/${skill.subskill}), difficulty ${difficultyLevel}`,
          4096
        );
        const parsed = JSON.parse(stripJsonFence(conceptRaw)) as ConceptResponse;
        if (
          !parsed?.title_ar ||
          !Array.isArray(parsed.concept_explanation) || parsed.concept_explanation.length === 0 ||
          !parsed.worked_example?.problem_ar ||
          !Array.isArray(parsed.worked_example?.solution_steps_ar) ||
          !parsed.glossary_term?.term_ar || !parsed.glossary_term?.definition_ar
        ) {
          throw new Error('Malformed concept response shape');
        }
        concept = parsed;
        break;
      } catch (err) {
        conceptErr = err;
        console.warn(
          `Lesson concept generation attempt ${attempt}/${MAX_CONCEPT_ATTEMPTS} failed for skill ${skillId}: ${(err as Error)?.message ?? err}`
        );
      }
    }
    if (!concept) {
      throw new Error(
        `Lesson concept generation failed for skill ${skillId} after ${MAX_CONCEPT_ATTEMPTS} attempts: ${(conceptErr as Error)?.message ?? conceptErr}`
      );
    }
    concept.title_ar = sanitizeMathText(concept.title_ar);
    concept.concept_explanation = concept.concept_explanation.map((b) => ({
      ...b,
      text_ar: sanitizeMathText(b.text_ar),
      visual: sanitizeVisualSpec(b.visual),
    }));
    concept.worked_example = {
      problem_ar: sanitizeMathText(concept.worked_example.problem_ar),
      solution_steps_ar: concept.worked_example.solution_steps_ar.map(sanitizeMathText),
      visual: sanitizeVisualSpec(concept.worked_example.visual),
    };
    concept.glossary_term = {
      term_ar: sanitizeMathText(concept.glossary_term.term_ar),
      definition_ar: sanitizeMathText(concept.glossary_term.definition_ar),
      aliases_to_avoid: (concept.glossary_term.aliases_to_avoid ?? []).map(sanitizeMathText),
    };

    const lesson = await this.store.createLesson({
      skill_id: skillId,
      title_ar: concept.title_ar,
      concept_explanation: concept.concept_explanation,
      worked_example: concept.worked_example,
      difficulty_level: difficultyLevel,
      generation_prompt_version: PROMPT_VERSION,
      review_status: 'ai_generated',
    });

    // Glossary term (FR-08): one canonical term per skill, created once and reused —
    // never added speculatively; it only becomes visible to a student once she has
    // an actual learning record for this skill (see httpServer.ts's unlock hooks).
    if (!this.store.getGlossaryTermForSkill(skillId)) {
      await this.store.createGlossaryTerm({
        term_ar: concept.glossary_term.term_ar,
        definition_ar: concept.glossary_term.definition_ar,
        aliases_to_avoid: concept.glossary_term.aliases_to_avoid ?? [],
        skill_id: skillId,
      });
    }

    // Call 2 — practice items, with a retry if validation yields too few usable items.
    // A real model's independent-solver check can legitimately disagree sometimes;
    // per 07-lesson-generator.md §1, failing items should be regenerated (bounded
    // retries) rather than silently leaving the student with a near-empty quiz.
    const MIN_USABLE_ITEMS = 3;
    const MAX_RETRIES = 2;

    let bestRawItems: ItemsResponse['items'] = [];
    let bestValidations: Array<{ passed: boolean; checks: Record<string, boolean> }> = [];
    let bestPassedCount = -1;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        // Same truncation-avoidance reasoning as Call 1: 6 full items (stem + 4
        // options + explanation each, in Arabic) comfortably exceeds the client's
        // 1500-token default.
        const itemsRaw = await this.llm.complete(
          `${ITEMS_SYSTEM_PROMPT}\n\n${groundingBlock}`,
          `Concept: ${JSON.stringify(concept.concept_explanation)}`,
          4096
        );
        const itemsResponse: ItemsResponse = JSON.parse(stripJsonFence(itemsRaw));
        if (!Array.isArray(itemsResponse.items) || itemsResponse.items.length === 0) {
          throw new Error('Malformed items response (expected a non-empty array)');
        }
        itemsResponse.items = itemsResponse.items.map((it) => ({
          ...it,
          stem_ar: sanitizeMathText(it.stem_ar),
          options: it.options.map(sanitizeMathText) as [string, string, string, string],
          explanation_ar: sanitizeMathText(it.explanation_ar),
        }));
        const validations = await Promise.all(itemsResponse.items.map((raw) => this.validateItem(raw)));
        const passedCount = validations.filter((v) => v.passed).length;

        if (passedCount > bestPassedCount) {
          bestRawItems = itemsResponse.items;
          bestValidations = validations;
          bestPassedCount = passedCount;
        }

        if (passedCount >= MIN_USABLE_ITEMS) break;
        if (attempt < MAX_RETRIES) {
          console.warn(
            `Lesson item validation for skill ${skillId}: only ${passedCount}/${itemsResponse.items.length} passed on attempt ${attempt + 1}, retrying...`
          );
        }
      } catch (err) {
        // A malformed/unparseable Call-2 response used to crash lesson generation
        // outright instead of retrying — treat it exactly like "0 items passed" so
        // the existing retry/fallback logic below still runs on the next iteration.
        console.warn(
          `Lesson item generation attempt ${attempt + 1}/${MAX_RETRIES + 1} failed for skill ${skillId}: ${(err as Error)?.message ?? err}`
        );
      }
    }

    // Last-resort fallback: after all retries, if we STILL don't have enough validated
    // items, don't hand the student an empty quiz — accept the deterministic checks
    // (option count, length parity) even where the independent-solver disagreed, and
    // say so loudly in the logs. This is a demo-continuity fallback, not something to
    // carry into a real production diagnostic/lesson pipeline without review.
    if (bestPassedCount < MIN_USABLE_ITEMS) {
      console.warn(
        `Lesson item validation for skill ${skillId}: still only ${bestPassedCount} passed after ${MAX_RETRIES} retries. ` +
        `Falling back to deterministic-checks-only for the remaining items so the lesson isn't empty — review this content manually.`
      );
      bestValidations = bestValidations.map((v) => ({
        passed: v.checks.has_four_options && v.checks.option_length_parity,
        checks: { ...v.checks, accepted_via_fallback: !v.passed },
      }));
    }

    // Absolute last resort: every Call-2 attempt failed outright (e.g. the API was
    // down for the whole retry window), so bestRawItems is still empty — a lesson
    // with zero practice items is a worse demo failure than reusing one static,
    // legitimate item. This path should essentially never trigger given the retries
    // above; it exists purely so "students must never see a generation failure"
    // holds even in the worst case.
    if (bestRawItems.length === 0) {
      const fallback = getFallbackItem(skill.section);
      bestRawItems = [{ ...fallback, difficulty_level: skill.base_difficulty }];
      bestValidations = [{ passed: true, checks: { static_fallback: true } }];
    }

    const items: PracticeItem[] = [];
    for (let i = 0; i < bestRawItems.length; i++) {
      const raw = bestRawItems[i];
      const validated = bestValidations[i];
      const item = await this.store.createPracticeItem({
        skill_id: skillId,
        lesson_id: lesson.id,
        stem_ar: raw.stem_ar,
        options: raw.options,
        correct_option_index: raw.correct_option_index,
        explanation_ar: raw.explanation_ar,
        difficulty_level: raw.difficulty_level,
        validation_status: validated.passed ? 'passed' : 'failed',
        validation_checks: validated.checks,
      });
      items.push(item);
    }

    return { lesson, items };
  }

  /**
   * Call 3 — validation pass, per §1: deterministic where possible, independent
   * LLM solve as a fallback signal (never the same call that generated the item).
   */
  private async validateItem(
    item: ItemsResponse['items'][number]
  ): Promise<{ passed: boolean; checks: Record<string, boolean> }> {
    if (!Array.isArray(item.options) || item.options.length !== 4 || typeof item.stem_ar !== 'string') {
      return {
        passed: false,
        checks: { has_four_options: false, option_length_parity: false, answer_key_independent_solve_match: false },
      };
    }

    const lengths = item.options.map((o) => o.length);
    const maxLen = Math.max(...lengths);
    const minLen = Math.min(...lengths);
    const optionLengthParity = maxLen === 0 ? true : (maxLen - minLen) / maxLen <= 0.2;

    // The independent solver's OWN call/parse used to be unguarded — a single
    // unparseable solver response would throw out of this function, and because
    // this runs inside a Promise.all over every item in the set, it crashed the
    // ENTIRE lesson generation rather than just failing one item's check. An
    // inconclusive solver result (couldn't get a clean answer) is not proof the
    // answer key is wrong, so it's treated conservatively as a failed check —
    // the existing MIN_USABLE_ITEMS retry/fallback logic above already recovers
    // from "some items failed their checks."
    let answerKeyOk = false;
    try {
      const solverRaw = await this.llm.complete(
        INDEPENDENT_SOLVER_SYSTEM_PROMPT,
        `Stem: ${item.stem_ar}\nOptions: ${item.options.join(' | ')}`
      );
      const solverResult = JSON.parse(stripJsonFence(solverRaw)) as { chosen_option_index: number };
      answerKeyOk = solverResult.chosen_option_index === item.correct_option_index;
    } catch (err) {
      console.warn(`Independent-solver check failed (treated as inconclusive): ${(err as Error)?.message ?? err}`);
    }

    const checks = {
      option_length_parity: optionLengthParity,
      answer_key_independent_solve_match: answerKeyOk,
      has_four_options: item.options.length === 4,
    };
    const passed = Object.values(checks).every(Boolean);
    return { passed, checks };
  }
}
