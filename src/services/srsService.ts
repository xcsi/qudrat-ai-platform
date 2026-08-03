// ============================================================
// Spaced Repetition Service — implements FR-06:
// "Spaced-repetition practice queue with interleaving across
// related question types" + the quality bar's explicit test:
// "an item answered correctly today reappears at an expanding
// interval, and a lapse resets it."
//
// SM-2-style scheduling (simplified — no explicit 0-5 quality
// rating from the student, just correct/incorrect, since Qudrat
// practice items are binary MCQ).
// ============================================================

import { InMemoryStore } from '../store/InMemoryStore';
import { SrsState } from '../types';

const MIN_EASE_FACTOR = 1.3;

export class SrsService {
  constructor(private store: InMemoryStore) {}

  /**
   * Called once when a skill first becomes eligible for spaced review —
   * i.e. right after a `mastery` learning_record is written for it (from a
   * lesson or diagnostic). Initializes interval=1 day, first review tomorrow.
   * Safe to call again for an already-tracked skill (no-op via upsert).
   */
  async initializeIfAbsent(studentId: string, skillId: string): Promise<void> {
    const existing = this.store.getSrsState(studentId, skillId);
    if (existing) return;
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    await this.store.upsertSrsState({
      student_id: studentId,
      skill_id: skillId,
      ease_factor: 2.5,
      interval_days: 1,
      repetitions: 0,
      next_review_at: tomorrow,
      last_result: null,
      updated_at: new Date().toISOString(),
    });
  }

  /**
   * The actual SM-2-style update, run after a practice-queue attempt.
   * Correct -> interval expands (1 -> 6 -> interval*ease_factor...).
   * Incorrect -> "a lapse resets it": repetitions back to 0, interval back to 1.
   */
  async recordReviewResult(studentId: string, skillId: string, isCorrect: boolean): Promise<SrsState> {
    const existing = this.store.getSrsState(studentId, skillId) ?? {
      student_id: studentId,
      skill_id: skillId,
      ease_factor: 2.5,
      interval_days: 1,
      repetitions: 0,
      next_review_at: new Date().toISOString().slice(0, 10),
      last_result: null,
      updated_at: new Date().toISOString(),
    };

    let { ease_factor, interval_days, repetitions } = existing;

    if (isCorrect) {
      repetitions += 1;
      if (repetitions === 1) interval_days = 1;
      else if (repetitions === 2) interval_days = 6;
      else interval_days = Math.round(interval_days * ease_factor);
      ease_factor = Math.max(MIN_EASE_FACTOR, ease_factor + 0.1); // small bump on success
    } else {
      // "A lapse resets it" — per the brief's own quality-bar wording, verbatim.
      repetitions = 0;
      interval_days = 1;
      ease_factor = Math.max(MIN_EASE_FACTOR, ease_factor - 0.2);
    }

    const nextReviewAt = new Date(Date.now() + interval_days * 86400000).toISOString().slice(0, 10);

    const updated: SrsState = {
      student_id: studentId,
      skill_id: skillId,
      ease_factor,
      interval_days,
      repetitions,
      next_review_at: nextReviewAt,
      last_result: isCorrect ? 'correct' : 'lapsed',
      updated_at: new Date().toISOString(),
    };
    await this.store.upsertSrsState(updated);
    return updated;
  }

  /** Skills due for review today (or overdue), for the practice-queue screen. */
  getDueSkillIds(studentId: string): string[] {
    const today = new Date().toISOString().slice(0, 10);
    return this.store
      .getDueSrsStates(studentId, today)
      .sort((a, b) => a.next_review_at.localeCompare(b.next_review_at)) // most overdue first
      .map((s) => s.skill_id);
  }
}
