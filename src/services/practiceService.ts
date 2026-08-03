// ============================================================
// Practice Queue Service — implements FR-06's session flow on top
// of SrsService's scheduling math. Per 08-learning-record-writer.md
// §5: practice sessions are lighter-weight than lesson sessions —
// they update srs_state and can CONFIRM an existing tentative
// misconception_corrected record on a successful retest, but never
// originate a brand-new mastery record from scratch (new mastery
// only comes from lessons or the diagnostic).
// ============================================================

import { InMemoryStore } from '../store/InMemoryStore';
import { SrsService } from './srsService';
import { PracticeItem } from '../types';

export class PracticeService {
  constructor(private store: InMemoryStore, private srs: SrsService) {}

  /** One item per due skill, reusing the item bank (never generates fresh content here — reuse only). */
  getDueQueue(studentId: string, maxItems = 8): { skillId: string; item: PracticeItem }[] {
    const dueSkillIds = this.srs.getDueSkillIds(studentId).slice(0, maxItems);
    const queue: { skillId: string; item: PracticeItem }[] = [];
    for (const skillId of dueSkillIds) {
      const item = this.store.practiceItems.find((p) => p.skill_id === skillId && p.validation_status === 'passed');
      if (item) queue.push({ skillId, item });
    }
    return queue;
  }

  /** Records the review result in srs_state, and confirms a tentative misconception-correction if this retest passes. */
  async recordPracticeAnswer(studentId: string, skillId: string, isCorrect: boolean): Promise<void> {
    await this.srs.recordReviewResult(studentId, skillId, isCorrect);

    if (!isCorrect) return; // a lapse doesn't confirm anything — see 08-learning-record-writer.md §4 (no auto-downgrade either)

    const existing = this.store.getActiveRecordForSkill(studentId, skillId);
    if (existing && existing.record_type === 'misconception_corrected' && existing.confidence === 'tentative') {
      await this.store.writeLearningRecord({
        student_id: studentId,
        skill_id: skillId,
        record_type: 'misconception_corrected',
        evidence: 'تأكيد عبر مراجعة متباعدة: أُجيب صح على هذه المهارة بعد فترة، ما يؤكد ثبات التصحيح السابق.',
        source_session_id: null,
        confidence: 'confirmed',
      });
    }
  }
}
