// ============================================================
// Grounding Service — Version 5, Phase I.
//
// The ONE place that assembles what an LLM call is grounded in. Before this
// file existed, every real LLM call site in this app built its own grounding
// independently: `lessonGeneratorService.ts` and both methods in
// `askTeacherService.ts` each filtered `store.resources` by kind==='knowledge'
// and joined the SAME 4-line trusted-sources block, copy-pasted three times —
// while `httpServer.ts`'s hint prompts, `mockExamService.ts`'s and
// `diagnosticService.ts`'s item-generation prompts, and
// `missionInterviewService.ts`'s system prompt injected NO grounding at all.
//
// This service owns a different concern than `findReusableLesson`/
// `diagnosticService`/`practiceService`/`mockExamService`'s existing "reuse
// curated content before generating" logic (which stays untouched — that
// decides WHICH content to serve). GroundingService decides WHAT CONTEXT the
// LLM gets handed whenever it IS invoked, for any reason, by any endpoint.
//
// Every real LLM call site in this app calls `build()` and appends the result
// to its own task-specific instructions — no endpoint builds its own trusted-
// sources block or grounding language independently anymore.
// ============================================================

import { InMemoryStore } from '../store/InMemoryStore';
import { Lesson, PracticeItem } from '../types';

export interface GroundingContext {
  skillId?: string;
  lessonId?: string;
  practiceItemId?: string;
}

const GROUNDING_RULES = `GROUNDING RULES (non-negotiable, applies to this entire response):
- Any claim about the Qudrat/GAT exam itself (its structure, number of questions, timing,
  scoring scale, section names, or official policy) MUST come only from the trusted
  sources listed above. If no trusted source covers a claim you were about to make about
  the exam, omit that claim entirely rather than guessing.
- Pure mathematical/verbal reasoning techniques (e.g. "test critical values", "compare by
  difference") are general academic knowledge and do not need a citation.
- If lesson or question context is provided above, treat it as your primary source of
  truth for THIS specific content — never contradict a curated hint, common mistake, or
  explanation already shown to the student for this exact lesson/item.
- If something is genuinely outside the grounding context provided and outside general
  academic knowledge, say so plainly rather than guessing.`;

export class GroundingService {
  constructor(private store: InMemoryStore) {}

  /** The single entry point every AI call site in this app uses. Returns a
   *  ready-to-append block; callers do
   *  `${TASK_SPECIFIC_SYSTEM_PROMPT}\n\n${groundingService.build(context)}`.
   *  Only assembles sections relevant to the given context — never guesses
   *  data that isn't there (an empty context still returns trusted sources +
   *  the grounding rules, which is exactly right for a call with no specific
   *  lesson/question attached, e.g. the mission interview). */
  build(context: GroundingContext = {}): string {
    const sections: string[] = [this.buildTrustedSourcesBlock()];

    const lesson = this.resolveLesson(context);
    if (lesson) sections.push(this.buildLessonContextBlock(lesson));

    if (context.practiceItemId) {
      const item = this.store.practiceItems.find((p) => p.id === context.practiceItemId);
      if (item) sections.push(this.buildQuestionContextBlock(item));
    }

    sections.push(GROUNDING_RULES);
    return sections.join('\n\n');
  }

  /** Trusted curriculum content — "knowledge"-kind resources only (never
   *  "wisdom"/community sources for factual grounding, per the same rule
   *  every prior call site already followed). The one block that used to be
   *  copy-pasted across 3 different files. */
  private buildTrustedSourcesBlock(): string {
    const block = this.store.resources
      .filter((r) => r.kind === 'knowledge')
      .map((r) => `- ${r.title}${r.is_official_etec ? ' [OFFICIAL ETEC]' : ' [secondary, corroborating only]'}: ${r.annotation}`)
      .join('\n');
    return `Trusted sources for grounding any exam-fact claims (empty means none available — omit exam facts entirely):\n${block || '(none loaded)'}`;
  }

  /** If `lessonId` is given, use that exact lesson. Otherwise, if only
   *  `skillId` is given, find that skill's best available lesson — mirrors
   *  `findReusableLesson`'s own quality ordering (published beats
   *  human_reviewed beats ai_generated) so grounding always prefers the most
   *  trustworthy version of the content that exists. */
  private resolveLesson(context: GroundingContext): Lesson | undefined {
    if (context.lessonId) {
      return this.store.lessons.find((l) => l.id === context.lessonId);
    }
    if (context.skillId) {
      const candidates = this.store.lessons.filter((l) => l.skill_id === context.skillId && l.review_status !== 'rejected');
      const rank: Record<string, number> = { published: 0, human_reviewed: 1, ai_generated: 2 };
      candidates.sort((a, b) => rank[a.review_status] - rank[b.review_status]);
      return candidates[0];
    }
    return undefined;
  }

  private buildLessonContextBlock(lesson: Lesson): string {
    const concepts = lesson.concept_explanation.map((b) => `- (${b.kind}) ${b.text_ar}`).join('\n');
    return (
      `Lesson context — "${lesson.title_ar}" (content status: ${lesson.review_status}):\n${concepts}\n\n` +
      `Worked example: ${lesson.worked_example.problem_ar}\n` +
      `Solution steps: ${lesson.worked_example.solution_steps_ar.join(' → ')}`
    );
  }

  /** Includes the item's own curated hint bank when present — new: nothing
   *  did this before. A live AI call about a curated question can now never
   *  contradict the curated hint/mistake/memory-tip already authored for it. */
  private buildQuestionContextBlock(item: PracticeItem): string {
    const lines = [
      `Question context — stem: "${item.stem_ar}"`,
      `Correct answer: ${item.options[item.correct_option_index]}`,
      `Explanation: ${item.explanation_ar}`,
    ];
    if (item.hint_1_ar) lines.push(`Existing curated hint (level 1, already shown to some students): ${item.hint_1_ar}`);
    if (item.hint_2_ar) lines.push(`Existing curated hint (level 2, already shown to some students): ${item.hint_2_ar}`);
    if (item.common_mistake_ar) lines.push(`Known common mistake for this question: ${item.common_mistake_ar}`);
    if (item.memory_tip_ar) lines.push(`Known memory tip for this question: ${item.memory_tip_ar}`);
    return lines.join('\n');
  }
}
