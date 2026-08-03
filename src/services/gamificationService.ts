// ============================================================
// Gamification service (product-redesign Phase 4/6).
//
// XP, level, and streak are DELIBERATELY not stored anywhere — they're
// computed at read time from tables that already exist (attempts,
// sessions, learning_records), the same "compiled view, don't
// duplicate storage" philosophy referenceSheetService.ts already uses
// for reference sheets. Only badges/unlocks are real storage.
//
// Critical correctness point: XP counts events that HAPPENED
// (learning_records rows ever created, correct attempts, completed
// sessions, badge unlocks) — all append-only — rather than currently-
// active state. writeLearningRecord() supersedes old records regardless
// of record_type, so a later misconception_corrected record can
// supersede an earlier mastery record for the same skill. If XP only
// counted ACTIVE mastery records, a student's XP could decrease on a
// later interaction, breaking the near-universal "XP never goes down"
// rule. Counting all-time events instead makes XP monotonically
// non-decreasing by construction.
// ============================================================

import { InMemoryStore } from '../store/InMemoryStore';
import { Badge } from '../types';

const LEVEL_THRESHOLDS = [0, 50, 120, 220, 350, 520, 730, 1000, 1350, 1800, 2350, 3000, 3800, 4800, 6000];

export interface XpBreakdown {
  total: number;
  fromCorrectAttempts: number;
  fromMastery: number;
  fromLessonSessions: number;
  fromMockExams: number;
  fromBadges: number;
}

export interface LevelInfo {
  level: number;
  xp: number;
  xpIntoLevel: number;
  xpForNextLevel: number;
  progress: number; // 0-1
}

export interface StreakInfo {
  current: number;
  longest: number;
}

/** Fixed badge catalog, seeded once at boot (see gamificationService.ensureBadgeCatalogSeeded,
 *  called from httpServer.ts's main()) — mirrors the seedSkills.ts/seedDiagnosticBank.ts
 *  convention of bundling static content as a TS constant rather than requiring a manual
 *  DB setup step. `category_master_<category>` badges are created dynamically instead,
 *  since they depend on the live skill taxonomy. */
export const BADGE_DEFINITIONS: Array<Omit<Badge, 'id' | 'created_at'>> = [
  // NOTE: 🎓 not 📘 — U+1F4D8 (blue book) renders as a plain solid-color box in
  // some environments (found via visual QA) while every other icon here renders fine.
  { code: 'first_lesson_complete', title_ar: 'أول درس!', description_ar: 'تم إكمال أول درس.', icon: '🎓', category: 'milestone' },
  { code: 'diagnostic_complete', title_ar: 'التشخيص الأول', description_ar: 'تم إكمال التشخيص الأولي.', icon: '📝', category: 'milestone' },
  { code: 'first_mastery', title_ar: 'أول إتقان', description_ar: 'تم إتقان أول مهارة.', icon: '⭐', category: 'mastery' },
  { code: 'misconception_fixed', title_ar: 'تصحيح ذكي', description_ar: 'تصحيح فهم خاطئ بالاعتماد على النفس.', icon: '💡', category: 'mastery' },
  { code: 'streak_3', title_ar: 'ثلاثة أيام متتالية', description_ar: 'مذاكرة 3 أيام متتالية.', icon: '🔥', category: 'streak' },
  { code: 'streak_7', title_ar: 'أسبوع كامل', description_ar: 'مذاكرة 7 أيام متتالية.', icon: '🔥', category: 'streak' },
  // streak_14/50/100 close a gap found in the Supervisor Feedback Sprint: the
  // dashboard (app.js's STREAK_MILESTONES) already celebrates 14/50/100-day
  // streaks with confetti, but no badge existed to make that milestone a
  // permanent, collectible achievement — only 3/7/30 did.
  { code: 'streak_14', title_ar: 'أسبوعان بلا انقطاع', description_ar: 'مذاكرة 14 يومًا متتاليًا.', icon: '🔥', category: 'streak' },
  { code: 'streak_30', title_ar: 'شهر من الالتزام', description_ar: 'مذاكرة 30 يومًا متتاليًا.', icon: '🏆', category: 'streak' },
  { code: 'streak_50', title_ar: 'خمسون يومًا من الانضباط', description_ar: 'مذاكرة 50 يومًا متتاليًا.', icon: '🏆', category: 'streak' },
  { code: 'streak_100', title_ar: 'مئة يوم! التزام استثنائي', description_ar: 'مذاكرة 100 يوم متتالٍ.', icon: '💎', category: 'streak' },
  { code: 'mock_exam_complete', title_ar: 'اختبار تجريبي كامل', description_ar: 'تم إكمال اختبار تجريبي كامل.', icon: '🎯', category: 'exam' },
  { code: 'glossary_collector_10', title_ar: 'جمع المصطلحات', description_ar: 'جمع 10 مصطلحات في القاموس.', icon: '📖', category: 'practice' },
];

export class GamificationService {
  constructor(private store: InMemoryStore) {}

  async ensureBadgeCatalogSeeded(): Promise<void> {
    // Always upsert (not just "create if missing") — createBadge's on-conflict
    // clause updates every editable field, so a BADGE_DEFINITIONS edit (copy fix,
    // icon fix) actually reaches Postgres on the next boot instead of being
    // silently ignored because a same-code row already existed from a prior run.
    for (const def of BADGE_DEFINITIONS) {
      await this.store.createBadge(def);
    }
  }

  computeXp(studentId: string): XpBreakdown {
    const correctAttempts = this.store.getAttemptsForStudent(studentId).filter((a) => a.is_correct).length;
    const allRecords = this.store.getAllLearningRecordsForStudent(studentId);
    const masteryCount = allRecords.filter((r) => r.record_type === 'mastery').length;
    const completedSessions = this.store.getSessionsForStudent(studentId).filter((s) => s.completed_at);
    const lessonSessions = completedSessions.filter((s) => s.session_type === 'lesson').length;
    const mockExamSessions = completedSessions.filter((s) => s.session_type === 'mock_exam').length;
    const badgeCount = this.store.getBadgesForStudent(studentId).length;

    const fromCorrectAttempts = correctAttempts * 10;
    const fromMastery = masteryCount * 50;
    const fromLessonSessions = lessonSessions * 25;
    const fromMockExams = mockExamSessions * 100;
    const fromBadges = badgeCount * 15;

    return {
      total: fromCorrectAttempts + fromMastery + fromLessonSessions + fromMockExams + fromBadges,
      fromCorrectAttempts,
      fromMastery,
      fromLessonSessions,
      fromMockExams,
      fromBadges,
    };
  }

  computeLevel(xp: number): LevelInfo {
    let level = 1;
    for (let i = 1; i < LEVEL_THRESHOLDS.length; i++) {
      if (xp >= LEVEL_THRESHOLDS[i]) level = i + 1;
      else break;
    }
    const currentThreshold = LEVEL_THRESHOLDS[level - 1] ?? 0;
    // Graceful extrapolation past the hardcoded table so leveling never hard-stops.
    const nextThreshold =
      level < LEVEL_THRESHOLDS.length ? LEVEL_THRESHOLDS[level] : Math.round(50 * Math.pow(level + 1, 1.5));
    const xpIntoLevel = xp - currentThreshold;
    const xpForNextLevel = nextThreshold - currentThreshold;
    return {
      level,
      xp,
      xpIntoLevel,
      xpForNextLevel,
      progress: xpForNextLevel > 0 ? Math.min(1, xpIntoLevel / xpForNextLevel) : 1,
    };
  }

  /** Derived live from session dates — no stored counter (see plan rationale:
   *  matches referenceSheetService's precedent, avoids write-path drift bugs).
   *  A calendar day with no activity YET (i.e. today, before the student has
   *  studied) does not break the streak — only a full missed day does. */
  computeStreak(studentId: string): StreakInfo {
    // `new Date(...)` (not a raw `.slice`) because `started_at` is a `string` when it
    // comes from InMemoryStore but the real `pg` driver returns `timestamptz` columns
    // as native Date objects — found via live browser testing against real Postgres,
    // where a plain `.slice()` call threw ("started_at.slice is not a function").
    const activeDates = new Set(
      this.store.getSessionsForStudent(studentId).map((s) => new Date(s.started_at).toISOString().slice(0, 10))
    );
    const sortedDates = Array.from(activeDates).sort();

    let longest = 0;
    let run = 0;
    let prevMs: number | null = null;
    for (const dateStr of sortedDates) {
      const ms = Date.parse(`${dateStr}T00:00:00Z`);
      run = prevMs !== null && ms - prevMs === 86400000 ? run + 1 : 1;
      longest = Math.max(longest, run);
      prevMs = ms;
    }

    let cursorMs = Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
    if (!activeDates.has(new Date(cursorMs).toISOString().slice(0, 10))) {
      cursorMs -= 86400000; // today hasn't happened yet — start the backward walk from yesterday
    }
    let current = 0;
    while (activeDates.has(new Date(cursorMs).toISOString().slice(0, 10))) {
      current += 1;
      cursorMs -= 86400000;
    }

    return { current, longest };
  }

  listBadgeCatalog(): Badge[] {
    return this.store.getBadgeCatalog();
  }

  getBadgesForStudent(studentId: string): Badge[] {
    const unlocks = this.store.getBadgesForStudent(studentId);
    return unlocks
      .map((u) => this.store.badges.find((b) => b.id === u.badge_id))
      .filter((b): b is Badge => !!b);
  }

  /** Call additively at the same points other side effects already happen
   *  (lesson/mock-exam completion, learning-record writes, practice answers) —
   *  see httpServer.ts. Returns newly-awarded badges only, for a celebration UI. */
  async checkAndAwardBadges(studentId: string): Promise<Badge[]> {
    const newlyAwarded: Badge[] = [];
    const award = async (code: string) => {
      const badge = this.store.getBadgeByCode(code);
      if (!badge || this.store.hasBadge(studentId, badge.id)) return;
      await this.store.awardBadge(studentId, badge.id, 'manual', null);
      newlyAwarded.push(badge);
    };

    const completedSessions = this.store.getSessionsForStudent(studentId).filter((s) => s.completed_at);
    if (completedSessions.some((s) => s.session_type === 'lesson')) await award('first_lesson_complete');
    if (completedSessions.some((s) => s.session_type === 'diagnostic')) await award('diagnostic_complete');
    if (completedSessions.some((s) => s.session_type === 'mock_exam')) await award('mock_exam_complete');

    const allRecords = this.store.getAllLearningRecordsForStudent(studentId);
    if (allRecords.some((r) => r.record_type === 'mastery')) await award('first_mastery');
    if (allRecords.some((r) => r.record_type === 'misconception_corrected')) await award('misconception_fixed');

    const streak = this.computeStreak(studentId);
    if (streak.current >= 3) await award('streak_3');
    if (streak.current >= 7) await award('streak_7');
    if (streak.current >= 14) await award('streak_14');
    if (streak.current >= 30) await award('streak_30');
    if (streak.current >= 50) await award('streak_50');
    if (streak.current >= 100) await award('streak_100');

    if (this.store.getUnlockedGlossaryTerms(studentId).length >= 10) await award('glossary_collector_10');

    // Category-mastery badges are created on demand (one per skills.category, the
    // first time it's actually earned) since they depend on the live skill taxonomy
    // rather than a fixed catalog entry.
    const masteredSkillIds = new Set(
      this.store.getActiveLearningRecords(studentId).filter((r) => r.record_type === 'mastery' && r.skill_id).map((r) => r.skill_id as string)
    );
    const categories = new Set(this.store.skills.map((s) => s.category));
    for (const category of categories) {
      const skillsInCategory = this.store.skills.filter((s) => s.category === category);
      if (skillsInCategory.length === 0 || !skillsInCategory.every((s) => masteredSkillIds.has(s.id))) continue;
      const code = `category_master_${category}`;
      let badge = this.store.getBadgeByCode(code);
      if (!badge) {
        badge = await this.store.createBadge({
          code,
          title_ar: `إتقان فئة كاملة`,
          description_ar: `تم إتقان كل مهارات هذه الفئة.`,
          icon: '🏅',
          category: 'mastery',
        });
      }
      if (!this.store.hasBadge(studentId, badge.id)) {
        await this.store.awardBadge(studentId, badge.id, 'manual', null);
        newlyAwarded.push(badge);
      }
    }

    return newlyAwarded;
  }
}
