// ============================================================
// ZPD Next-Lesson Selector — implements database/04-zpd-selector.md
// FR-03: ZPD-driven recommendation, explainable in one sentence.
//
// Includes the fix flagged in 05-diagnostic-assessment.md §4: Priority 1
// now also covers tentative-mastery records whose only evidence is a
// diagnostic (not just tentative misconception_corrected records).
// ============================================================

import { InMemoryStore } from '../store/InMemoryStore';
import { LearningRecord, Section } from '../types';

export interface ZpdRecommendation {
  skillId: string;
  skillNameAr: string;
  reasonAr: string;
  priorityTier: 1 | 2 | 3;
}

// Demo-polish sprint: a real bug found via live testing — the frontier-expansion
// "no prerequisite" reason fell back to the raw English category slug (e.g. a
// literal "arithmetic" inside an otherwise all-Arabic sentence). Mirrors
// public/Cards.js's own CATEGORY_LABELS so the two stay consistent.
const CATEGORY_LABELS_AR: Record<string, string> = {
  verbal_analogy: 'التناظر اللفظي', sentence_completion: 'إكمال الجمل',
  reading_comprehension: 'استيعاب المقروء', contextual_error: 'الخطأ السياقي',
  arithmetic: 'الحساب', fractions: 'الكسور', decimals: 'الأعداد العشرية',
  percentages: 'النسب المئوية', ratios_and_proportions: 'النسبة والتناسب',
  algebra: 'الجبر', exponents_and_roots: 'الأسس والجذور', geometry: 'الهندسة',
  statistics: 'الإحصاء', probability: 'الاحتمال', quantitative_comparison: 'المقارنات الكمية',
  data_interpretation: 'تحليل البيانات', multi_step_word_problems: 'المسائل اللفظية',
};

export class ZpdSelector {
  constructor(private store: InMemoryStore) {}

  /** Step 1 & 2: build the ZPD candidate pool (not mastered, all prerequisites mastered).
   *  `section` (demo-polish sprint): once a student has explicitly chosen a
   *  curriculum (Quantitative/Verbal — see public's path-select screen), every
   *  recommendation stays confined to that section instead of picking whichever
   *  skill is next across both curricula interchangeably. Omitted = unfiltered,
   *  today's original behavior (used only before a student has chosen). */
  private getCandidates(studentId: string, section?: Section): string[] {
    const activeRecords = this.store.getActiveLearningRecords(studentId);
    const masteredSkillIds = new Set(
      activeRecords.filter((r) => r.record_type === 'mastery' && r.skill_id).map((r) => r.skill_id as string)
    );

    return this.store.skills
      .filter((skill) => {
        if (section && skill.section !== section) return false;
        if (masteredSkillIds.has(skill.id)) return false;
        const prereqs = this.store.getPrerequisites(skill.id);
        return prereqs.every((p) => masteredSkillIds.has(p));
      })
      .map((s) => s.id);
  }

  selectNext(studentId: string, section?: Section): ZpdRecommendation | null {
    const candidates = this.getCandidates(studentId, section);
    if (candidates.length === 0) return null;

    // Priority 1a: due retests — tentative misconception_corrected records (oldest first)
    const retestPool = this.store
      .getActiveLearningRecords(studentId)
      .filter(
        (r): r is LearningRecord =>
          r.record_type === 'misconception_corrected' &&
          r.confidence === 'tentative' &&
          !!r.skill_id &&
          candidates.includes(r.skill_id)
      )
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

    if (retestPool.length > 0) {
      const record = retestPool[0];
      const skill = this.store.getSkill(record.skill_id as string)!;
      return {
        skillId: skill.id,
        skillNameAr: skill.name_ar,
        reasonAr: `لأنك صححتِ فهمك في "${skill.name_ar}" سابقًا، نعيد اختبارها للتأكد أنها ثابتة.`,
        priorityTier: 1,
      };
    }

    // Priority 1b (gap fix from 05-diagnostic-assessment.md §4): tentative mastery
    // records whose only evidence is a diagnostic session — due for lesson-based
    // confirmation. Real bug found via live testing: this never checked section
    // membership at all, so once a `section` filter existed, a diagnostic-
    // confirmed skill from the OTHER curriculum could still be recommended —
    // completely bypassing a student's explicit Quantitative/Verbal choice.
    // NOTE: can't reuse `candidates.includes()` here like Priority 1a does — a
    // "tentative mastery" record's skill is, by construction, EXCLUDED from
    // `candidates` (getCandidates() drops any skill with a `mastery` record,
    // tentative or not), so that check would always be false and this priority
    // would never fire again. Check the skill's own `section` directly instead.
    const tentativeDiagnosticMastery = this.store
      .getActiveLearningRecords(studentId)
      .filter((r) => {
        if (r.record_type !== 'mastery' || r.confidence !== 'tentative' || !r.skill_id) return false;
        if (section && this.store.getSkill(r.skill_id)?.section !== section) return false;
        const session = this.store.sessions.find((s) => s.id === r.source_session_id);
        return session?.session_type === 'diagnostic';
      })
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

    if (tentativeDiagnosticMastery.length > 0) {
      const record = tentativeDiagnosticMastery[0];
      const skill = this.store.getSkill(record.skill_id as string)!;
      return {
        skillId: skill.id,
        skillNameAr: skill.name_ar,
        reasonAr: `التشخيص أظهر إتقانًا في "${skill.name_ar}" — درس قصير يؤكد ذلك رسميًا.`,
        priorityTier: 1,
      };
    }

    // Priority 2: SRS-due items, most overdue first. Same fix as Priority 1b
    // above and for the same reason: an SRS state only exists for a skill AFTER
    // its `mastery` learning_record is written (see srsService.initializeIfAbsent),
    // so it's always excluded from `candidates` — `candidates.includes()` here
    // was dead code (always false) even before section filtering existed. Check
    // the skill's own `section` directly instead.
    const today = new Date().toISOString().slice(0, 10);
    const dueStates = this.store
      .getDueSrsStates(studentId, today)
      .filter((s) => !section || this.store.getSkill(s.skill_id)?.section === section)
      .sort(
        (a, b) =>
          new Date(a.next_review_at).getTime() - new Date(b.next_review_at).getTime()
      );

    if (dueStates.length > 0) {
      const skill = this.store.getSkill(dueStates[0].skill_id)!;
      return {
        skillId: skill.id,
        skillNameAr: skill.name_ar,
        reasonAr: `حان وقت مراجعة "${skill.name_ar}" حتى لا تُنسى.`,
        priorityTier: 2,
      };
    }

    // Priority 3: frontier expansion — deterministic tiebreak, now ALSO preferring
    // a skill that already has a published/human_reviewed lesson over one that
    // would need live generation. Real demo latency found via testing: most
    // skills have no curated content yet, so live generation (multiple sequential
    // LLM calls) could make "the next lesson" take well over a minute — a
    // published lesson loads from the database with none of that wait. This is a
    // ranking preference among otherwise-equal candidates, not a hard requirement
    // (a skill with no curated content anywhere is still recommended when it's
    // genuinely the only/best option) — live generation stays as the real
    // fallback, per 07-lesson-generator.md, it's just no longer preferred over
    // instant content when both are viable.
    const ranked = candidates
      .map((id) => this.store.getSkill(id)!)
      .sort((a, b) => {
        const aHasContent = this.hasPublishedLesson(a.id, a.base_difficulty) ? 0 : 1;
        const bHasContent = this.hasPublishedLesson(b.id, b.base_difficulty) ? 0 : 1;
        if (aHasContent !== bHasContent) return aHasContent - bHasContent;
        if (a.base_difficulty !== b.base_difficulty) return a.base_difficulty - b.base_difficulty;
        const prereqCountDiff = this.store.getPrerequisites(a.id).length - this.store.getPrerequisites(b.id).length;
        if (prereqCountDiff !== 0) return prereqCountDiff;
        return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      });

    const chosen = ranked[0];
    const prereqs = this.store.getPrerequisites(chosen.id);
    const reasonAr =
      prereqs.length > 0
        ? `لأنك أتقنت "${this.store.getSkill(prereqs[0])!.name_ar}"، الخطوة التالية المنطقية هي "${chosen.name_ar}".`
        : `هذه نقطة بداية جيدة في "${CATEGORY_LABELS_AR[chosen.category] || chosen.category}".`;

    return { skillId: chosen.id, skillNameAr: chosen.name_ar, reasonAr, priorityTier: 3 };
  }

  /** True when the skill already has a reusable published/human_reviewed lesson
   *  — i.e. `generateOrReuse` will load it straight from the database with zero
   *  LLM calls (see lessonGeneratorService.ts's own reuse-first contract). */
  private hasPublishedLesson(skillId: string, baseDifficulty: number): boolean {
    const lesson = this.store.findReusableLesson(skillId, baseDifficulty);
    return !!lesson && (lesson.review_status === 'published' || lesson.review_status === 'human_reviewed');
  }
}
