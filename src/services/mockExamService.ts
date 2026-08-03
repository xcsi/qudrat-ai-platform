// ============================================================
// Mock Exam Service — implements FR-07:
// "Full-length timed mock exam (about 120 questions / 2.5 hours)
// with score estimate and review."
//
// Scaled down to ~20 items for this demo (same principle as the
// diagnostic's scale-down from ~30 to 12) — real production would
// use the full ~120, proportioned across all taxonomy categories
// per the Discovery Report's §4.1 structure. Timing (2.5 hours) is
// enforced client-side via a countdown; this service only handles
// item selection, scoring, and the post-exam review compilation.
// ============================================================

import { InMemoryStore } from '../store/InMemoryStore';
import { Session } from '../types';
import { LlmClient, sanitizeMathText, completeJsonWithRetry, getFallbackItem } from '../llm/llmClient';
import { GroundingService } from './groundingService';

const MOCK_EXAM_ITEM_SYSTEM_PROMPT = `MOCK_EXAM_ITEM_GENERATOR
Generate ONE multiple-choice exam question (exactly 4 options, roughly equal
length, formal Arabic MSA) testing the given Qudrat skill, styled like an
official Qudrat/GAT exam item — original content only, never a copy of a real
exam question.

(Grounding rules are appended below this prompt by the shared GroundingService
— previously this prompt had NO grounding at all.)

FORMATTING RULE (non-negotiable): this text is displayed directly in a mobile
app, NOT rendered as Markdown or LaTeX. NEVER use LaTeX math delimiters
($...$, \\(...\\), \\[...\\]), NEVER use Markdown syntax (**bold**, _italic_,
backtick-code, # headers). Write math using plain Unicode characters only:
x², x³, √x, ×, ÷, ±, ≤, ≥, ½, ¼ — exactly as a student would see it printed
in a book, not as markup.

Respond ONLY with JSON:
{"stem_ar": "...", "options": ["...","...","...","..."], "correct_option_index": 0-3, "explanation_ar": "..."}`;

export interface MockExamReviewItem {
  stemAr: string;
  options: string[];
  selectedIndex: number;
  correctIndex: number;
  isCorrect: boolean;
  explanationAr: string;
  skillNameAr: string;
  // Version 3 Phase C: surfaces the real per-attempt timing (already stored,
  // never read back anywhere before this) so the review screen can show
  // timing-by-skill analytics — no schema change, one field exposed.
  responseTimeMs: number;
}

export class MockExamService {
  constructor(private store: InMemoryStore, private grounding: GroundingService) {}

  /** Samples across the FULL taxonomy (not just entry-point skills, unlike the diagnostic) proportional to section. */
  selectMockExamSkills(count = 20): string[] {
    const verbal = this.store.skills.filter((s) => s.section === 'verbal');
    const quantitative = this.store.skills.filter((s) => s.section === 'quantitative');
    const verbalCount = Math.round(count * (verbal.length / (verbal.length + quantitative.length)));
    const quantCount = count - verbalCount;

    const pick = (arr: typeof verbal, n: number) => {
      const shuffled = [...arr].sort(() => Math.random() - 0.5);
      return shuffled.slice(0, n);
    };

    return [...pick(verbal, verbalCount), ...pick(quantitative, quantCount)].map((s) => s.id);
  }

  async startMockExam(studentId: string): Promise<Session> {
    return this.store.createSession({ student_id: studentId, session_type: 'mock_exam', lesson_id: null });
  }

  /**
   * Ensures every sampled skill has at least one usable item, reusing already-
   * validated items from the bank where they exist (per the brief's own §7 rule:
   * "never regenerate the same item live for every student") and only generating
   * fresh ones for skills that don't have any yet.
   */
  async ensureItemsForSkills(skillIds: string[], llm: LlmClient, usingRealLlm: boolean): Promise<void> {
    await Promise.all(
      skillIds.map(async (skillId) => {
        const existing = this.store.practiceItems.find(
          (p) => p.skill_id === skillId && p.validation_status === 'passed'
        );
        if (existing) return;

        const skill = this.store.getSkill(skillId);
        if (!skill) return;

        if (!usingRealLlm) {
          await this.store.createPracticeItem({
            skill_id: skillId, lesson_id: null,
            stem_ar: `[سؤال اختبار تجريبي مؤقت] ${skill.name_ar}`,
            options: ['الخيار الأول', 'الخيار الثاني', 'الخيار الثالث', 'الخيار الرابع'],
            correct_option_index: 0,
            explanation_ar: 'عنصر مؤقت — سيُستبدل بمحتوى حقيقي عند تفعيل Claude API.',
            difficulty_level: skill.base_difficulty,
            validation_status: 'passed', validation_checks: { seeded_placeholder: true },
          });
          return;
        }

        try {
          const parsed = await completeJsonWithRetry(
            llm,
            `${MOCK_EXAM_ITEM_SYSTEM_PROMPT}\n\n${this.grounding.build({ skillId })}`,
            `Skill: ${skill.name_ar} (${skill.category}/${skill.subskill}), difficulty ${skill.base_difficulty}`,
            (raw) => {
              if (!raw || typeof raw.stem_ar !== 'string' || !Array.isArray(raw.options) || raw.options.length !== 4) {
                throw new Error('Malformed response shape (expected 4 options)');
              }
              // Runtime-robustness fix: found live — a response can have valid stem_ar/
              // options but an omitted/null correct_option_index, which used to reach
              // the database and fail there (NOT NULL violation) instead of retrying
              // here where a better response can actually be requested.
              if (!Number.isInteger(raw.correct_option_index) || raw.correct_option_index < 0 || raw.correct_option_index > 3) {
                throw new Error('Malformed response shape (correct_option_index missing or out of range)');
              }
              return raw as { stem_ar: string; options: string[]; correct_option_index: number; explanation_ar?: string };
            },
            3,
            2048 // headroom over the 1500 default — same truncation risk as the diagnostic item generator
          );
          await this.store.createPracticeItem({
            skill_id: skillId, lesson_id: null,
            stem_ar: sanitizeMathText(parsed.stem_ar), options: parsed.options.map(sanitizeMathText) as [string, string, string, string],
            correct_option_index: parsed.correct_option_index as 0 | 1 | 2 | 3,
            explanation_ar: sanitizeMathText(parsed.explanation_ar ?? ''),
            difficulty_level: skill.base_difficulty,
            validation_status: 'passed', validation_checks: { generated_live: true },
          });
        } catch (err) {
          // Every retry failed — fall back to a real, legitimate item instead of
          // visible "[تعذّر التوليد]" placeholder text (students must never see
          // proof that generation failed).
          console.error(`Mock exam item generation failed for "${skill.name_ar}" after all retries, using a static fallback item instead:`, err);
          const fallback = getFallbackItem(skill.section);
          await this.store.createPracticeItem({
            skill_id: skillId, lesson_id: null,
            stem_ar: fallback.stem_ar,
            options: fallback.options,
            correct_option_index: fallback.correct_option_index,
            explanation_ar: fallback.explanation_ar,
            difficulty_level: skill.base_difficulty,
            validation_status: 'passed', validation_checks: { fallback_after_generation_failure: true },
          });
        }
      })
    );
  }

  /** Norm-referenced score is NOT computed here — see 05-diagnostic-assessment.md §5; this returns the same honestly-flagged raw percentage. */
  async completeMockExam(sessionId: string): Promise<{ scoreEstimate: number; review: MockExamReviewItem[] }> {
    const attempts = this.store.getAttemptsForSession(sessionId);
    if (attempts.length === 0) throw new Error('Cannot complete a mock exam with zero attempts');

    const correctCount = attempts.filter((a) => a.is_correct).length;
    const scoreEstimate = Math.round((correctCount / attempts.length) * 100);
    await this.store.completeSession(sessionId, scoreEstimate);

    const review: MockExamReviewItem[] = attempts.map((a) => {
      const item = this.store.practiceItems.find((p) => p.id === a.practice_item_id)!;
      const skill = this.store.getSkill(item.skill_id);
      return {
        stemAr: item.stem_ar,
        options: item.options,
        selectedIndex: a.selected_option_index,
        correctIndex: item.correct_option_index,
        isCorrect: a.is_correct,
        explanationAr: item.explanation_ar,
        skillNameAr: skill?.name_ar ?? '—',
        responseTimeMs: a.response_time_ms,
      };
    });

    return { scoreEstimate, review };
  }
}
