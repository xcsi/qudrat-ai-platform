// ============================================================
// Learning-Record Writer — implements
// database/08-learning-record-writer.md
// FR-05: records written only on evidence, with supersession.
// This is the most important of the six pieces — it's what stops
// the product from degrading into "coverage tracking with extra
// steps" (the exact competitor weakness identified in the
// Discovery Report §5.2).
// ============================================================

import { InMemoryStore } from '../store/InMemoryStore';
import { Attempt, PracticeItem } from '../types';

export interface WriterResult {
  recordsWritten: Array<{ skillId: string; type: string; confidence: string }>;
}

export class LearningRecordWriterService {
  constructor(private store: InMemoryStore) {}

  /**
   * Runs once per completed lesson (or practice) session. §2: only two of the four
   * record types are auto-detectable from quiz performance in Phase 1 scope —
   * prior_knowledge_revealed is explicitly deferred (§2.3, needs the Ask-the-Teacher
   * chat feature which is Phase 2+), and goal_changed is written elsewhere
   * (InMemoryStore.createMission, on mission supersession).
   */
  async processSession(sessionId: string, studentId: string, skillId: string): Promise<WriterResult> {
    const session = this.store.sessions.find((s) => s.id === sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);
    if (!session.completed_at) {
      // §3 non-trigger: abandoned sessions never reach the writer at all.
      return { recordsWritten: [] };
    }

    const attempts = this.store.getAttemptsForSession(sessionId);
    if (attempts.length === 0) return { recordsWritten: [] };

    const itemsById = new Map<string, PracticeItem>();
    for (const a of attempts) {
      const item = this.store.practiceItems.find((p) => p.id === a.practice_item_id);
      if (item) itemsById.set(item.id, item);
    }

    const result: WriterResult = { recordsWritten: [] };

    await this.tryWriteMisconceptionCorrected(studentId, sessionId, attempts, itemsById, result);
    await this.tryWriteMastery(studentId, skillId, sessionId, attempts, itemsById, result);

    return result;
  }

  /** §2.2: an incorrect attempt followed by a correct attempt on the same sub-skill, same session. */
  private async tryWriteMisconceptionCorrected(
    studentId: string,
    sessionId: string,
    attempts: Attempt[],
    itemsById: Map<string, PracticeItem>,
    result: WriterResult
  ): Promise<void> {
    const ordered = [...attempts].sort(
      (a, b) => new Date(a.attempted_at).getTime() - new Date(b.attempted_at).getTime()
    );

    for (let i = 0; i < ordered.length; i++) {
      const first = ordered[i];
      if (first.is_correct) continue;
      const firstItem = itemsById.get(first.practice_item_id);
      if (!firstItem) continue;

      // Look for a LATER correct attempt on an item in the same skill (proxy for "same sub-skill" —
      // v1 simplification: the design doc calls for near-duplicate-concept pairing at generation
      // time; here we approximate with same-skill same-session, which is the information available).
      const laterCorrect = ordered
        .slice(i + 1)
        .find((a) => {
          const item = itemsById.get(a.practice_item_id);
          return a.is_correct && item && item.skill_id === firstItem.skill_id;
        });

      if (laterCorrect) {
        const correctedItem = itemsById.get(laterCorrect.practice_item_id)!;
        await this.store.writeLearningRecord({
          student_id: studentId,
          skill_id: firstItem.skill_id,
          record_type: 'misconception_corrected',
          evidence: `أخطأت في "${firstItem.stem_ar.slice(0, 40)}..." ثم صححت في "${correctedItem.stem_ar.slice(0, 40)}..."`,
          source_session_id: sessionId,
          confidence: 'tentative', // §2.2: always tentative on first correction
        });
        result.recordsWritten.push({ skillId: firstItem.skill_id, type: 'misconception_corrected', confidence: 'tentative' });
        return; // one correction record per session is enough signal
      }
    }
  }

  /**
   * §2.1: mastery requires (a) the hardest item in the set answered correctly, AND
   * (b) overall accuracy >= 80%. Confidence is 'confirmed' if this is the second
   * independent piece of evidence for the skill (e.g. diagnostic already gave
   * tentative mastery, or a prior misconception_corrected exists) — else 'tentative'.
   */
  private async tryWriteMastery(
    studentId: string,
    skillId: string,
    sessionId: string,
    attempts: Attempt[],
    itemsById: Map<string, PracticeItem>,
    result: WriterResult
  ): Promise<void> {
    const relevantAttempts = attempts.filter((a) => {
      const item = itemsById.get(a.practice_item_id);
      return item && item.skill_id === skillId;
    });
    if (relevantAttempts.length === 0) return;

    const accuracy = relevantAttempts.filter((a) => a.is_correct).length / relevantAttempts.length;

    // §2.1: mastery requires the deliberately-discriminating item (difficulty >= 4, per
    // 07-lesson-generator.md §3's "hardest, most instructive item") to be present AND correct.
    // If no such item was attempted, there is no discriminating evidence, regardless of
    // how many easy items were answered correctly (§3 non-trigger).
    const DISCRIMINATING_THRESHOLD = 4;
    const hardAttempts = relevantAttempts.filter(
      (a) => itemsById.get(a.practice_item_id)!.difficulty_level >= DISCRIMINATING_THRESHOLD
    );
    if (hardAttempts.length === 0) return; // no discriminating item in this session — write nothing

    const hardestDifficulty = Math.max(
      ...hardAttempts.map((a) => itemsById.get(a.practice_item_id)!.difficulty_level)
    );
    const hardestItemAttempt = hardAttempts.find(
      (a) => itemsById.get(a.practice_item_id)!.difficulty_level === hardestDifficulty
    );
    const hardestCorrect = hardestItemAttempt?.is_correct ?? false;

    if (!hardestCorrect || accuracy < 0.8) {
      // §3 non-trigger: partial evidence — write nothing, let the next touch decide.
      return;
    }

    const existing = this.store.getActiveRecordForSkill(studentId, skillId);
    const hasPriorEvidence =
      !!existing && (existing.record_type === 'mastery' || existing.record_type === 'misconception_corrected');
    const confidence = hasPriorEvidence ? 'confirmed' : 'tentative';

    await this.store.writeLearningRecord({
      student_id: studentId,
      skill_id: skillId,
      record_type: 'mastery',
      evidence: `إجابة بدقة ${Math.round(accuracy * 100)}% مع إصابة العنصر الأصعب في المجموعة (صعوبة ${hardestDifficulty})`,
      source_session_id: sessionId,
      confidence,
    });
    result.recordsWritten.push({ skillId, type: 'mastery', confidence });
  }
}
