// ============================================================
// Notification service — in-app center only (product-redesign Phase 7).
// No service worker, no push subscriptions, no VAPID keys, no external
// dependency — real browser push was explicitly deferred in favor of
// this. Reminders are computed live on dashboard/profile load (same
// "compute on read, don't schedule" philosophy the ZPD selector already
// uses) and persisted only the first time each is actually surfaced,
// via hasNotificationToday's idempotency check, so the same reminder
// never appears twice in one day no matter how many times the
// dashboard is loaded.
//
// "Daily reminder" here means an in-app banner/badge the student sees
// next time she opens the app — not a push notification while the app
// is closed, since no such infrastructure exists or is being added.
// ============================================================

import { InMemoryStore } from '../store/InMemoryStore';
import { AppNotification } from '../types';
import { SrsService } from './srsService';
import { GamificationService } from './gamificationService';

export class NotificationService {
  constructor(
    private store: InMemoryStore,
    private srs: SrsService,
    private gamification: GamificationService
  ) {}

  getNotificationsForStudent(studentId: string): AppNotification[] {
    return this.store.getNotificationsForStudent(studentId);
  }

  getUnreadCount(studentId: string): number {
    return this.store.getUnreadNotificationCount(studentId);
  }

  async markRead(notificationId: string): Promise<void> {
    await this.store.markNotificationRead(notificationId);
  }

  /** Called once per dashboard/profile load. Each check is isolated — a
   *  reminder that fails to write (bad data for one student, a future schema
   *  drift like the notifications_type_check mismatch this project already
   *  hit once — see 02-schema.sql) logs and is skipped instead of taking
   *  down the entire dashboard/profile request for every student. Reminders
   *  are a nice-to-have layered on top of the dashboard, not something the
   *  dashboard's own availability should ever depend on. */
  async checkAndCreateReminders(studentId: string, examDate: string | null): Promise<void> {
    const checks: Array<[string, () => Promise<void>]> = [
      ['revision', () => this.checkRevisionReminder(studentId)],
      ['streak', () => this.checkStreakReminder(studentId)],
      ['exam', () => (examDate ? this.checkExamReminder(studentId, examDate) : Promise.resolve())],
      ['skill_staleness', () => this.checkSkillStaleness(studentId)],
      ['daily_challenge', () => this.checkDailyChallengeReady(studentId)],
      ['timing_trend', () => this.checkTimingTrend(studentId)],
    ];
    for (const [label, check] of checks) {
      try {
        await check();
      } catch (err) {
        console.error(`Reminder check "${label}" failed for student ${studentId} (skipped, dashboard unaffected):`, err);
      }
    }
  }

  private async checkRevisionReminder(studentId: string): Promise<void> {
    const dueSkillIds = this.srs.getDueSkillIds(studentId);
    if (dueSkillIds.length === 0) return;
    if (this.store.hasNotificationToday(studentId, 'revision_reminder', null)) return;
    const skill = this.store.getSkill(dueSkillIds[0]);
    await this.store.createNotification({
      student_id: studentId,
      type: 'revision_reminder',
      title_ar: 'حان وقت المراجعة',
      body_ar:
        dueSkillIds.length === 1
          ? `مهارة "${skill?.name_ar ?? ''}" جاهزة للمراجعة.`
          : `${dueSkillIds.length} مهارات جاهزة للمراجعة اليوم.`,
      related_skill_id: dueSkillIds[0],
    });
  }

  private async checkStreakReminder(studentId: string): Promise<void> {
    const streak = this.gamification.computeStreak(studentId);
    if (streak.current < 2) return; // only worth nudging once there's a streak worth protecting
    const today = new Date().toISOString().slice(0, 10);
    // new Date(...) wrapper, not a raw .slice — see gamificationService.computeStreak
    // for why: pg returns timestamptz columns as Date objects, not strings.
    const studiedToday = this.store.getSessionsForStudent(studentId).some((s) => new Date(s.started_at).toISOString().slice(0, 10) === today);
    if (studiedToday) return; // nothing to protect today — already studied
    if (this.store.hasNotificationToday(studentId, 'streak_reminder', null)) return;
    await this.store.createNotification({
      student_id: studentId,
      type: 'streak_reminder',
      title_ar: 'حافظي على سلسلتك! 🔥',
      body_ar: `عندك سلسلة ${streak.current} يوم متتالي — ذاكري اليوم عشان ما تنكسر.`,
      related_skill_id: null,
    });
  }

  private async checkExamReminder(studentId: string, examDate: string): Promise<void> {
    const daysLeft = Math.ceil((new Date(examDate).getTime() - Date.now()) / 86400000);
    if (![7, 3, 1].includes(daysLeft)) return;
    if (this.store.hasNotificationToday(studentId, 'exam_reminder', null)) return;
    await this.store.createNotification({
      student_id: studentId,
      type: 'exam_reminder',
      title_ar: daysLeft === 1 ? 'الاختبار غدًا!' : `باقي ${daysLeft} أيام على الاختبار`,
      body_ar: 'راجعي أوراقك المرجعية، وخذي اختبارًا تجريبيًا أخيرًا إذا ما جربتِ واحدًا مؤخرًا.',
      related_skill_id: null,
    });
  }

  /**
   * Version 5 Phase L: per-skill staleness. Distinct from checkRevisionReminder
   * (which fires the moment ANYTHING becomes due, however slightly) — this one
   * specifically calls out significant neglect, matching the brief's own example
   * ("لم تتدرب على ratios لخمسة أيام"). A skill whose SRS interval is overdue by
   * >= 5 days necessarily hasn't been attempted since it became due (attempting
   * it recomputes `next_review_at` into the future — see srsService.recordReviewResult),
   * so "overdue by >= 5 days" already IS "no attempt since," no extra query needed.
   */
  private async checkSkillStaleness(studentId: string): Promise<void> {
    const today = new Date();
    const staleStates = this.store.srsStates
      .filter((s) => s.student_id === studentId)
      .map((s) => ({ state: s, overdueDays: Math.floor((today.getTime() - new Date(s.next_review_at).getTime()) / 86400000) }))
      .filter((x) => x.overdueDays >= 5)
      .sort((a, b) => b.overdueDays - a.overdueDays);
    if (staleStates.length === 0) return;

    const { state, overdueDays } = staleStates[0];
    if (this.store.hasNotificationToday(studentId, 'skill_staleness', state.skill_id)) return;
    const skill = this.store.getSkill(state.skill_id);
    await this.store.createNotification({
      student_id: studentId,
      type: 'skill_staleness',
      title_ar: 'مهارة تحتاج انتباهك',
      body_ar: `لم تتدرب على "${skill?.name_ar ?? ''}" منذ ${overdueDays} ${overdueDays === 1 ? 'يوم' : 'أيام'}.`,
      related_skill_id: state.skill_id,
    });
  }

  /**
   * Version 5 Phase L: daily-challenge-ready. Unlike checkRevisionReminder (fires
   * once regardless of same-day completion), this specifically checks the student
   * hasn't attempted ANYTHING yet today — a fresh "here's today's challenge" nudge.
   */
  private async checkDailyChallengeReady(studentId: string): Promise<void> {
    const dueSkillIds = this.srs.getDueSkillIds(studentId);
    if (dueSkillIds.length === 0) return;
    const today = new Date().toISOString().slice(0, 10);
    const attemptedToday = this.store
      .getAttemptsForStudent(studentId)
      .some((a) => new Date(a.attempted_at).toISOString().slice(0, 10) === today);
    if (attemptedToday) return;
    if (this.store.hasNotificationToday(studentId, 'daily_challenge_ready', null)) return;
    await this.store.createNotification({
      student_id: studentId,
      type: 'daily_challenge_ready',
      title_ar: 'تحدي اليوم جاهز',
      body_ar: `تحدي اليوم جاهز — ${dueSkillIds.length} ${dueSkillIds.length === 1 ? 'سؤال ينتظرك' : 'أسئلة تنتظرك'}.`,
      related_skill_id: null,
    });
  }

  /**
   * Version 5 Phase L: timing-trend. Real comparison of this week's vs. last
   * week's average response_time_ms per section (verbal/quantitative) — never a
   * fabricated claim. Silently skipped (no notification, no error) if either
   * window lacks enough attempts for an honest comparison.
   */
  private async checkTimingTrend(studentId: string): Promise<void> {
    if (this.store.hasNotificationToday(studentId, 'timing_trend', null)) return;

    const MIN_ATTEMPTS_PER_WINDOW = 3;
    const IMPROVEMENT_THRESHOLD = 0.1; // at least 10% faster to count as a genuine trend, not noise
    const now = Date.now();
    const thisWeekStart = now - 7 * 86400000;
    const lastWeekStart = now - 14 * 86400000;

    const attempts = this.store.getAttemptsForStudent(studentId);
    const sections: Array<'verbal' | 'quantitative'> = ['verbal', 'quantitative'];
    const sectionLabels: Record<string, string> = { verbal: 'اللفظي', quantitative: 'الكمي' };

    let best: { section: string; label: string; improvementPct: number } | null = null;
    for (const section of sections) {
      const sectionAttempts = attempts.filter((a) => {
        const item = this.store.practiceItems.find((p) => p.id === a.practice_item_id);
        const skill = item ? this.store.getSkill(item.skill_id) : undefined;
        return skill?.section === section;
      });
      const thisWeek = sectionAttempts.filter((a) => new Date(a.attempted_at).getTime() >= thisWeekStart);
      const lastWeek = sectionAttempts.filter((a) => {
        const t = new Date(a.attempted_at).getTime();
        return t >= lastWeekStart && t < thisWeekStart;
      });
      if (thisWeek.length < MIN_ATTEMPTS_PER_WINDOW || lastWeek.length < MIN_ATTEMPTS_PER_WINDOW) continue;

      const avg = (arr: typeof attempts) => arr.reduce((sum, a) => sum + a.response_time_ms, 0) / arr.length;
      const thisAvg = avg(thisWeek);
      const lastAvg = avg(lastWeek);
      const improvementPct = (lastAvg - thisAvg) / lastAvg;
      if (improvementPct >= IMPROVEMENT_THRESHOLD && (!best || improvementPct > best.improvementPct)) {
        best = { section, label: sectionLabels[section], improvementPct };
      }
    }

    if (!best) return; // no section improved enough, or not enough data in both windows — say nothing rather than guess
    await this.store.createNotification({
      student_id: studentId,
      type: 'timing_trend',
      title_ar: 'تحسّن ملحوظ في سرعتك',
      body_ar: `تحسّنت سرعتك في القسم ${best.label} بنسبة ${Math.round(best.improvementPct * 100)}% هذا الأسبوع مقارنة بالأسبوع الماضي.`,
      related_skill_id: null,
    });
  }

  /** Directly event-driven, called right when a lesson session completes
   *  (httpServer.ts's handleLessonComplete) — a genuine one-time event, not a
   *  recurring condition to poll for on every dashboard load. */
  async notifyLessonComplete(studentId: string, skillId: string, skillNameAr: string): Promise<void> {
    await this.store.createNotification({
      student_id: studentId,
      type: 'lesson_complete',
      title_ar: 'أحسنتِ! 🎉',
      body_ar: `أكملتِ درس "${skillNameAr}".`,
      related_skill_id: skillId,
    });
  }
}
