// ============================================================
// Diagnostic Assessment service — implements
// database/05-diagnostic-assessment.md
// FR-02: diagnostic covering all question types, seeds baseline
// score and initial (tentative) learning records.
// ============================================================

import { InMemoryStore } from '../store/InMemoryStore';
import { Session } from '../types';
import { LlmClient, sanitizeMathText, completeJsonWithRetry, getFallbackItem } from '../llm/llmClient';
import { SrsService } from './srsService';
import { GroundingService } from './groundingService';

const DIAGNOSTIC_ITEM_SYSTEM_PROMPT = `DIAGNOSTIC_ITEM_GENERATOR
Generate ONE multiple-choice diagnostic question (exactly 4 options, roughly equal
length, formal Arabic MSA) testing the given Qudrat skill at a basic-to-moderate
level appropriate for a quick diagnostic (not a full lesson).

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

export class DiagnosticService {
  constructor(private store: InMemoryStore, private grounding: GroundingService) {}

  /**
   * §1 sampling rule: entry-point skills (base_difficulty <= 2) get one item each;
   * a handful of high-out-degree difficulty-3 skills get one item each too.
   * Falls back gracefully if the practice_item bank doesn't yet have an item for
   * a given skill (expected in a fresh Phase-1 harness run before any lessons exist).
   */
  selectDiagnosticSkills(maxItems = 30): string[] {
    const entryPoints = this.store.skills.filter((s) => s.base_difficulty <= 2);
    const highOutDegree = this.store.skills
      .filter((s) => s.base_difficulty === 3)
      .map((s) => ({ skill: s, unlocks: this.store.getDependents(s.id).length }))
      .sort((a, b) => b.unlocks - a.unlocks)
      .slice(0, 8)
      .map((x) => x.skill);

    const combined = [...entryPoints, ...highOutDegree];
    const deduped = Array.from(new Map(combined.map((s) => [s.id, s])).values());
    return deduped.slice(0, maxItems).map((s) => s.id);
  }

  async startDiagnostic(studentId: string): Promise<Session> {
    return this.store.createSession({ student_id: studentId, session_type: 'diagnostic', lesson_id: null });
  }

  /**
   * Real-content variant of the diagnostic item bank — one live LLM call per skill.
   * Used instead of seedDiagnosticBank.ts's static placeholders once a real
   * AnthropicLlmClient (ANTHROPIC_API_KEY) is available. NOTE: unlike the lesson
   * generator's practice items, these are NOT run through the full validation
   * pipeline (independent-solver check, etc. — see 07-lesson-generator.md §1) —
   * that's a scope simplification for the diagnostic in this demo, not something
   * to carry into a real production diagnostic without adding that check back.
   */
  async generateRealDiagnosticItems(skillIds: string[], llm: LlmClient): Promise<void> {
    await Promise.all(skillIds.map((skillId) => this.generateOneRealDiagnosticItem(skillId, llm)));
  }

  private async generateOneRealDiagnosticItem(skillId: string, llm: LlmClient): Promise<void> {
    const skill = this.store.getSkill(skillId);
    if (!skill) return;

    // Reuse an already-generated item for this skill instead of generating a new
    // one every time — per the brief's own §7 rule ("never regenerate the same
    // item live for every student"). This was previously missing here (though
    // mockExamService already had it), which caused items to accumulate across
    // every repeated diagnostic attempt AND wasted API calls unnecessarily.
    const existing = this.store.practiceItems.find(
      (p) => p.skill_id === skillId && p.lesson_id === null && p.validation_status === 'passed'
    );
    if (existing) return;

    try {
      const parsed = await completeJsonWithRetry(
        llm,
        `${DIAGNOSTIC_ITEM_SYSTEM_PROMPT}\n\n${this.grounding.build({ skillId })}`,
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
        2048 // headroom over the 1500 default — a stem + 4 options + explanation in Arabic can run long
      );
      await this.store.createPracticeItem({
        skill_id: skillId,
        lesson_id: null,
        stem_ar: sanitizeMathText(parsed.stem_ar),
        options: parsed.options.map(sanitizeMathText) as [string, string, string, string],
        correct_option_index: parsed.correct_option_index as 0 | 1 | 2 | 3,
        explanation_ar: sanitizeMathText(parsed.explanation_ar ?? ''),
        difficulty_level: skill.base_difficulty,
        validation_status: 'passed',
        validation_checks: { generated_live: true, full_validation_pipeline_applied: false },
      });
    } catch (err) {
      // Every retry failed — fall back to a real, legitimate Qudrat-style item
      // instead of visible "تعذّر التوليد" placeholder text (demo-stabilization
      // sprint: students must never see proof that generation failed).
      console.error(`Diagnostic item generation failed for "${skill.name_ar}" after all retries, using a static fallback item instead:`, err);
      const fallback = getFallbackItem(skill.section);
      await this.store.createPracticeItem({
        skill_id: skillId,
        lesson_id: null,
        stem_ar: fallback.stem_ar,
        options: fallback.options,
        correct_option_index: fallback.correct_option_index,
        explanation_ar: fallback.explanation_ar,
        difficulty_level: skill.base_difficulty,
        validation_status: 'passed',
        validation_checks: { fallback_after_generation_failure: true },
      });
    }
  }

  /**
   * §3 seeding pass: writes a tentative mastery record for every correctly-answered
   * skill, and computes a raw-percentage score_estimate (flagged uncalibrated per §5.1).
   * Deliberately does NOT write anything for incorrectly-answered skills (data-model
   * principle: absence of a record is itself informative, not a gap to fill).
   */
  async completeDiagnostic(
    sessionId: string,
    studentId: string,
    srsService?: SrsService
  ): Promise<{ scoreEstimate: number; recordsWritten: number }> {
    const attempts = this.store.getAttemptsForSession(sessionId);
    if (attempts.length === 0) throw new Error('Cannot complete a diagnostic with zero attempts');

    const correctCount = attempts.filter((a) => a.is_correct).length;
    const scoreEstimate = Math.round((correctCount / attempts.length) * 100);

    let recordsWritten = 0;
    for (const attempt of attempts) {
      if (!attempt.is_correct) continue; // §3: no record on incorrect — absence is informative
      const item = this.store.practiceItems.find((p) => p.id === attempt.practice_item_id);
      if (!item) continue;

      // Don't overwrite an already-confirmed record with a weaker tentative diagnostic signal.
      const existing = this.store.getActiveRecordForSkill(studentId, item.skill_id);
      if (existing?.confidence === 'confirmed') continue;

      await this.store.writeLearningRecord({
        student_id: studentId,
        skill_id: item.skill_id,
        record_type: 'mastery',
        evidence: 'التشخيص الأولي: إجابة صحيحة على سؤال في هذه المهارة',
        source_session_id: sessionId,
        confidence: 'tentative', // §3: always tentative — one item is the weakest evidence tier
      });
      recordsWritten++;
      if (srsService) await srsService.initializeIfAbsent(studentId, item.skill_id);
    }

    await this.store.completeSession(sessionId, scoreEstimate);
    return { scoreEstimate, recordsWritten };
  }
}
