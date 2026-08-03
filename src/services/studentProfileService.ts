// ============================================================
// Student profile service (product-redesign Phase 4).
//
// Pure read-time aggregation over data that already exists — same
// "compile a view, don't duplicate storage" philosophy
// referenceSheetService.ts already uses for reference sheets. No new
// tables, no caching (single-demo-scale for now; a materialized cache
// is a documented future optimization only if this becomes a real
// perf problem at multi-student production scale).
//
// Deliberately kept separate from practiceService.getDueQueue()'s "due
// for review" concept: due-for-review (SRS scheduling) and weak-topic
// (mastery-based) are orthogonal signals. A skill can be simultaneously
// "due for review" and "mastered" — conflating them would make this
// profile contradict the practice queue's own recommendations.
// ============================================================

import { InMemoryStore } from '../store/InMemoryStore';
import { Session } from '../types';

export interface CategoryMastery {
  category: string;
  section: 'verbal' | 'quantitative';
  totalSkills: number;
  masteredSkills: number;
  attemptedSkills: number;
  masteryPercent: number; // 0-100
}

export class StudentProfileService {
  constructor(private store: InMemoryStore) {}

  private computeCategoryMastery(studentId: string): CategoryMastery[] {
    const masteredSkillIds = new Set(
      this.store
        .getActiveLearningRecords(studentId)
        .filter((r) => r.record_type === 'mastery' && r.skill_id)
        .map((r) => r.skill_id as string)
    );

    const attemptedSkillIds = new Set<string>();
    for (const attempt of this.store.getAttemptsForStudent(studentId)) {
      const item = this.store.practiceItems.find((p) => p.id === attempt.practice_item_id);
      if (item) attemptedSkillIds.add(item.skill_id);
    }

    const byCategory = new Map<string, { section: 'verbal' | 'quantitative'; skillIds: string[] }>();
    for (const skill of this.store.skills) {
      if (!byCategory.has(skill.category)) byCategory.set(skill.category, { section: skill.section, skillIds: [] });
      byCategory.get(skill.category)!.skillIds.push(skill.id);
    }

    const result: CategoryMastery[] = [];
    for (const [category, { section, skillIds }] of byCategory) {
      const masteredCount = skillIds.filter((id) => masteredSkillIds.has(id)).length;
      const attemptedCount = skillIds.filter((id) => attemptedSkillIds.has(id) || masteredSkillIds.has(id)).length;
      result.push({
        category,
        section,
        totalSkills: skillIds.length,
        masteredSkills: masteredCount,
        attemptedSkills: attemptedCount,
        masteryPercent: skillIds.length > 0 ? Math.round((masteredCount / skillIds.length) * 100) : 0,
      });
    }
    return result;
  }

  getMasteryByTopic(studentId: string): CategoryMastery[] {
    return this.computeCategoryMastery(studentId).sort((a, b) => b.masteryPercent - a.masteryPercent);
  }

  /** Categories the student has actually engaged with but hasn't mastered much of yet —
   *  an untouched category is "not started," not "weak," so it's excluded here. */
  getWeakTopics(studentId: string, thresholdPercent = 50): CategoryMastery[] {
    return this.computeCategoryMastery(studentId)
      .filter((c) => c.attemptedSkills > 0 && c.masteryPercent < thresholdPercent)
      .sort((a, b) => a.masteryPercent - b.masteryPercent);
  }

  getStrengths(studentId: string, thresholdPercent = 70): CategoryMastery[] {
    return this.computeCategoryMastery(studentId)
      .filter((c) => c.masteryPercent >= thresholdPercent)
      .sort((a, b) => b.masteryPercent - a.masteryPercent);
  }

  getStudyHistory(studentId: string, limit = 20): Session[] {
    return this.store
      .getSessionsForStudent(studentId)
      .filter((s) => s.completed_at)
      .sort((a, b) => new Date(b.completed_at as string).getTime() - new Date(a.completed_at as string).getTime())
      .slice(0, limit);
  }
}
