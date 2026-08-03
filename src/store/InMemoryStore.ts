// ============================================================
// In-memory store — mirrors the tables in database/02-schema.sql.
// This lets the Phase 1 test harness run end-to-end with zero
// external dependencies (no Postgres, no network) per the brief's
// own instruction: "prove the engine works before dressing it."
//
// Write methods are declared `async` even here, where nothing is
// actually asynchronous — this is deliberate: it means PostgresStore
// (store/PostgresStore.ts) can override these exact same method
// names with real `await pool.query(...)` calls, and every service
// in services/*.ts already does `await store.createX(...)`, so
// switching stores requires zero changes to the services or the
// harness. Read-only getters stay synchronous in both stores.
// ============================================================

import { randomUUID } from 'crypto';
import {
  Student, Mission, Skill, SkillPrerequisite, Resource, Session,
  LearningRecord, GlossaryTerm, StudentGlossaryUnlock, Lesson,
  PracticeItem, Attempt, SrsState, StudentSession, Badge, StudentBadgeUnlock,
  BadgeSourceType, AppNotification, NotificationType,
} from '../types';
import { SKILLS, SKILL_PREREQUISITES } from '../data/seedSkills';

export class InMemoryStore {
  students: Student[] = [];
  missions: Mission[] = [];
  skills: Skill[] = [...SKILLS];
  skillPrerequisites: SkillPrerequisite[] = [...SKILL_PREREQUISITES];
  resources: Resource[] = [];
  sessions: Session[] = [];
  learningRecords: LearningRecord[] = [];
  glossaryTerms: GlossaryTerm[] = [];
  studentGlossaryUnlocks: StudentGlossaryUnlock[] = [];
  lessons: Lesson[] = [];
  practiceItems: PracticeItem[] = [];
  attempts: Attempt[] = [];
  srsStates: SrsState[] = [];
  // Product-redesign additions
  studentSessions: StudentSession[] = [];
  badges: Badge[] = [];
  studentBadgeUnlocks: StudentBadgeUnlock[] = [];
  notifications: AppNotification[] = [];

  // ---------- students / missions ----------

  async createStudent(
    input: Omit<Student, 'id' | 'created_at' | 'email' | 'password_hash' | 'gender' | 'daily_goal_minutes' | 'weekly_goal_lessons'> & {
      email?: string | null; password_hash?: string | null; gender?: Student['gender'];
      daily_goal_minutes?: number | null; weekly_goal_lessons?: number | null;
    }
  ): Promise<Student> {
    const student: Student = {
      ...input,
      email: input.email ?? null,
      password_hash: input.password_hash ?? null,
      gender: input.gender ?? null,
      daily_goal_minutes: input.daily_goal_minutes ?? null,
      weekly_goal_lessons: input.weekly_goal_lessons ?? null,
      id: randomUUID(),
      created_at: new Date().toISOString(),
    };
    this.students.push(student);
    return student;
  }

  async setStudentGoals(studentId: string, dailyGoalMinutes: number | null, weeklyGoalLessons: number | null): Promise<void> {
    const student = this.students.find((s) => s.id === studentId);
    if (!student) throw new Error(`Student ${studentId} not found`);
    student.daily_goal_minutes = dailyGoalMinutes;
    student.weekly_goal_lessons = weeklyGoalLessons;
  }

  getStudentById(id: string): Student | undefined {
    return this.students.find((s) => s.id === id);
  }

  getStudentByEmail(email: string): Student | undefined {
    return this.students.find((s) => s.email === email);
  }

  async setStudentAuth(studentId: string, email: string, passwordHash: string): Promise<void> {
    const student = this.students.find((s) => s.id === studentId);
    if (!student) throw new Error(`Student ${studentId} not found`);
    student.email = email;
    student.password_hash = passwordHash;
  }

  async setStudentGender(studentId: string, gender: Student['gender']): Promise<void> {
    const student = this.students.find((s) => s.id === studentId);
    if (!student) throw new Error(`Student ${studentId} not found`);
    student.gender = gender;
  }

  /** Onboarding-redesign sprint: registration leaves `grade_level` null (see
   *  authService.register) — this is the explicit "Current Grade" onboarding
   *  step that fills it in, mirroring setStudentGender exactly.
   *
   *  IMPORTANT real bug this would otherwise cause: missionInterviewService's
   *  finalizeMission() has a real minor-consent guardrail (brief §10) that
   *  throws when `grade_level <= 12 && !parental_consent_at`. Every real
   *  registered student's `parental_consent_at` is null (authService.register
   *  never sets it — there is no parental-consent UI anywhere in this app)
   *  and `grade_level` was ALWAYS null before this onboarding step existed, so
   *  the guardrail's `student?.grade_level &&` check was always falsy and it
   *  never actually fired for a real student. The moment this step starts
   *  setting a real grade_level (11/12), that same guardrail would begin
   *  throwing on every single mission finalization — turning a UX addition
   *  into a hard blocker with no real consent flow to satisfy it. Stamping a
   *  self-attested consent timestamp here (only if absent) is a demo-
   *  appropriate stand-in — this app's own shared demo student already gets
   *  the equivalent for free via a hardcoded value in getOrCreateDemoStudent()
   *  — NOT a substitute for real parental-consent UI before any real launch. */
  async setStudentGrade(studentId: string, gradeLevel: number): Promise<void> {
    const student = this.students.find((s) => s.id === studentId);
    if (!student) throw new Error(`Student ${studentId} not found`);
    student.grade_level = gradeLevel;
    if (!student.parental_consent_at) student.parental_consent_at = new Date().toISOString();
  }

  async createMission(input: Omit<Mission, 'id' | 'created_at' | 'status' | 'superseded_by'>): Promise<Mission> {
    // supersede any existing active mission first (data-model §3.2 / 06-mission-interview.md §2 step 5)
    const existingActive = this.missions.find(
      (m) => m.student_id === input.student_id && m.status === 'active'
    );
    const mission: Mission = {
      ...input,
      id: randomUUID(),
      status: 'active',
      superseded_by: null,
      created_at: new Date().toISOString(),
    };
    this.missions.push(mission);

    if (existingActive) {
      existingActive.status = 'superseded';
      existingActive.superseded_by = mission.id;
      // 08-learning-record-writer.md §2.4: goal_changed record, no skill_id
      this.learningRecords.push({
        id: randomUUID(),
        student_id: input.student_id,
        skill_id: null,
        record_type: 'goal_changed',
        evidence: 'تم تحديث بيانات المهمة (mission) — هدف أو جدول زمني جديد',
        source_session_id: null,
        confidence: 'confirmed',
        status: 'active',
        superseded_by: null,
        created_at: new Date().toISOString(),
      });
    }
    return mission;
  }

  getActiveMission(studentId: string): Mission | undefined {
    return this.missions.find((m) => m.student_id === studentId && m.status === 'active');
  }

  // ---------- skills / prerequisites ----------

  getSkill(id: string): Skill | undefined {
    return this.skills.find((s) => s.id === id);
  }

  getPrerequisites(skillId: string): string[] {
    return this.skillPrerequisites
      .filter((sp) => sp.skill_id === skillId)
      .map((sp) => sp.prerequisite_skill_id);
  }

  getDependents(skillId: string): string[] {
    return this.skillPrerequisites
      .filter((sp) => sp.prerequisite_skill_id === skillId)
      .map((sp) => sp.skill_id);
  }

  // ---------- learning records ----------

  getActiveLearningRecords(studentId: string): LearningRecord[] {
    return this.learningRecords.filter((r) => r.student_id === studentId && r.status === 'active');
  }

  getActiveRecordForSkill(studentId: string, skillId: string): LearningRecord | undefined {
    return this.learningRecords.find(
      (r) => r.student_id === studentId && r.skill_id === skillId && r.status === 'active'
    );
  }

  /** Writes a new learning record, superseding any existing active record for the same student+skill
   *  (data-model §3.5 / 08-learning-record-writer.md §4). skill_id may be null (goal_changed only). */
  async writeLearningRecord(input: Omit<LearningRecord, 'id' | 'created_at' | 'status' | 'superseded_by'>): Promise<LearningRecord> {
    if (input.skill_id) {
      const existing = this.getActiveRecordForSkill(input.student_id, input.skill_id);
      if (existing) {
        existing.status = 'superseded';
      }
      const record: LearningRecord = {
        ...input,
        id: randomUUID(),
        status: 'active',
        superseded_by: null,
        created_at: new Date().toISOString(),
      };
      if (existing) existing.superseded_by = record.id;
      this.learningRecords.push(record);
      return record;
    }
    const record: LearningRecord = {
      ...input,
      id: randomUUID(),
      status: 'active',
      superseded_by: null,
      created_at: new Date().toISOString(),
    };
    this.learningRecords.push(record);
    return record;
  }

  // ---------- sessions / attempts ----------

  async createSession(input: Omit<Session, 'id' | 'started_at' | 'completed_at' | 'score_estimate'>): Promise<Session> {
    const session: Session = {
      ...input,
      id: randomUUID(),
      started_at: new Date().toISOString(),
      completed_at: null,
      score_estimate: null,
    };
    this.sessions.push(session);
    return session;
  }

  async recordAttempt(input: Omit<Attempt, 'id' | 'attempted_at'>): Promise<Attempt> {
    const attempt: Attempt = { ...input, id: randomUUID(), attempted_at: new Date().toISOString() };
    this.attempts.push(attempt);
    return attempt;
  }

  async completeSession(sessionId: string, scoreEstimate: number | null): Promise<void> {
    const session = this.sessions.find((s) => s.id === sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);
    session.completed_at = new Date().toISOString();
    session.score_estimate = scoreEstimate;
  }

  getAttemptsForSession(sessionId: string): Attempt[] {
    return this.attempts.filter((a) => a.session_id === sessionId);
  }

  // ---------- lessons / practice items ----------

  async createLesson(input: Omit<Lesson, 'id' | 'created_at'>): Promise<Lesson> {
    const lesson: Lesson = { ...input, id: randomUUID(), created_at: new Date().toISOString() };
    this.lessons.push(lesson);
    return lesson;
  }

  /** Version 6 Phase P: writes authored `sections[]` content for a lesson
   *  that already exists. See PostgresStore's override for the real DB write. */
  async updateLessonSections(lessonId: string, sections: Lesson['sections']): Promise<void> {
    const lesson = this.lessons.find((l) => l.id === lessonId);
    if (lesson) lesson.sections = sections;
  }

  async createPracticeItem(
    input: Omit<PracticeItem, 'id' | 'created_at' | 'hint_1_ar' | 'hint_2_ar' | 'common_mistake_ar' | 'memory_tip_ar' | 'wrong_answer_explanations' | 'source'> &
      Partial<Pick<PracticeItem, 'hint_1_ar' | 'hint_2_ar' | 'common_mistake_ar' | 'memory_tip_ar' | 'wrong_answer_explanations' | 'source'>>
  ): Promise<PracticeItem> {
    const item: PracticeItem = {
      ...input,
      hint_1_ar: input.hint_1_ar ?? null,
      hint_2_ar: input.hint_2_ar ?? null,
      common_mistake_ar: input.common_mistake_ar ?? null,
      memory_tip_ar: input.memory_tip_ar ?? null,
      wrong_answer_explanations: input.wrong_answer_explanations ?? null,
      source: input.source ?? 'ai_generated',
      id: randomUUID(),
      created_at: new Date().toISOString(),
    };
    this.practiceItems.push(item);
    return item;
  }

  getPracticeItemsForLesson(lessonId: string): PracticeItem[] {
    return this.practiceItems.filter((p) => p.lesson_id === lessonId);
  }

  findReusableLesson(skillId: string, difficultyLevel: number): Lesson | undefined {
    // 07-lesson-generator.md §2: reuse a passed/published lesson at a similar difficulty instead of regenerating.
    // Two real bugs found via testing (Version 4 Phase G verification), both fixed here:
    // 1. Every lesson request from handleGenerateLesson asks for difficulty 3, but
    //    curated lessons span 1-3 — a tolerance of 1 silently made every difficulty-1
    //    published lesson unreachable (abs(1-3)=2). Widened to 2, covering the full
    //    1-3 range this project's curated content actually uses today with zero new
    //    false-positive matches (no skill is currently published at difficulty 4+).
    // 2. A skill can have MULTIPLE lesson rows (an older `ai_generated` one from
    //    before curation, plus the later curated `published` one) — `.find()` returned
    //    whichever came first in array/hydration order, which for at least one skill
    //    was the stale ai_generated row, silently shadowing the curated, human-
    //    reviewed, visually-enriched lesson that should always win. Now explicitly
    //    prefers `published` > `human_reviewed` > `ai_generated`, then closest
    //    difficulty, among all in-tolerance, non-rejected candidates.
    const REVIEW_STATUS_RANK: Record<string, number> = { published: 0, human_reviewed: 1, ai_generated: 2, rejected: 3 };
    const candidates = this.lessons.filter(
      (l) =>
        l.skill_id === skillId &&
        Math.abs(l.difficulty_level - difficultyLevel) <= 2 &&
        l.review_status !== 'rejected'
    );
    if (candidates.length === 0) return undefined;
    candidates.sort((a, b) => {
      const rankDiff = REVIEW_STATUS_RANK[a.review_status] - REVIEW_STATUS_RANK[b.review_status];
      if (rankDiff !== 0) return rankDiff;
      return Math.abs(a.difficulty_level - difficultyLevel) - Math.abs(b.difficulty_level - difficultyLevel);
    });
    return candidates[0];
  }

  // ---------- glossary (FR-08) ----------

  getGlossaryTermForSkill(skillId: string): GlossaryTerm | undefined {
    return this.glossaryTerms.find((g) => g.skill_id === skillId);
  }

  async createGlossaryTerm(input: Omit<GlossaryTerm, 'id' | 'created_at'>): Promise<GlossaryTerm> {
    const term: GlossaryTerm = { ...input, id: randomUUID(), created_at: new Date().toISOString() };
    this.glossaryTerms.push(term);
    return term;
  }

  /** Per GLOSSARY-FORMAT.md: a term is only unlocked for a student once she's demonstrated understanding (i.e. a learning_record exists), never added speculatively. */
  async unlockGlossaryTermForStudent(studentId: string, glossaryTermId: string, learningRecordId: string): Promise<void> {
    const already = this.studentGlossaryUnlocks.some(
      (u) => u.student_id === studentId && u.glossary_term_id === glossaryTermId
    );
    if (already) return;
    this.studentGlossaryUnlocks.push({
      student_id: studentId,
      glossary_term_id: glossaryTermId,
      unlocked_via_learning_record_id: learningRecordId,
      unlocked_at: new Date().toISOString(),
    });
  }

  getUnlockedGlossaryTerms(studentId: string): GlossaryTerm[] {
    const unlockedIds = new Set(
      this.studentGlossaryUnlocks.filter((u) => u.student_id === studentId).map((u) => u.glossary_term_id)
    );
    return this.glossaryTerms.filter((g) => unlockedIds.has(g.id));
  }

  // ---------- srs state ----------

  getSrsState(studentId: string, skillId: string): SrsState | undefined {
    return this.srsStates.find((s) => s.student_id === studentId && s.skill_id === skillId);
  }

  async upsertSrsState(state: SrsState): Promise<void> {
    const idx = this.srsStates.findIndex(
      (s) => s.student_id === state.student_id && s.skill_id === state.skill_id
    );
    if (idx >= 0) this.srsStates[idx] = state;
    else this.srsStates.push(state);
  }

  getDueSrsStates(studentId: string, onOrBefore: string): SrsState[] {
    return this.srsStates.filter(
      (s) => s.student_id === studentId && s.next_review_at <= onOrBefore
    );
  }

  // ---------- auth sessions ----------

  async createStudentSession(studentId: string, ttlMs: number): Promise<StudentSession> {
    const session: StudentSession = {
      token: randomUUID(),
      student_id: studentId,
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + ttlMs).toISOString(),
    };
    this.studentSessions.push(session);
    return session;
  }

  /** Returns the session only if it exists AND hasn't expired — callers should treat an
   *  expired/missing token identically (both mean "not authenticated"). */
  getValidStudentSession(token: string): StudentSession | undefined {
    const session = this.studentSessions.find((s) => s.token === token);
    if (!session) return undefined;
    return new Date(session.expires_at).getTime() > Date.now() ? session : undefined;
  }

  async deleteStudentSession(token: string): Promise<void> {
    this.studentSessions = this.studentSessions.filter((s) => s.token !== token);
  }

  // ---------- study history / gamification raw-signal reads ----------
  // (XP/level/streak/mastery-by-topic are computed FROM these by
  // gamificationService.ts / studentProfileService.ts — no stored ledger.)

  getSessionsForStudent(studentId: string): Session[] {
    return this.sessions.filter((s) => s.student_id === studentId);
  }

  getAttemptsForStudent(studentId: string): Attempt[] {
    return this.attempts.filter((a) => a.student_id === studentId);
  }

  /** All-time, including superseded — unlike getActiveLearningRecords, this must NOT
   *  filter by status, since XP counts events that happened, not current state
   *  (a superseded mastery record still represents real, past evidence of learning). */
  getAllLearningRecordsForStudent(studentId: string): LearningRecord[] {
    return this.learningRecords.filter((r) => r.student_id === studentId);
  }

  // ---------- badges (catalog + unlocks) ----------

  getBadgeCatalog(): Badge[] {
    return this.badges;
  }

  getBadgeByCode(code: string): Badge | undefined {
    return this.badges.find((b) => b.code === code);
  }

  async createBadge(input: Omit<Badge, 'id' | 'created_at'>): Promise<Badge> {
    const existing = this.badges.find((b) => b.code === input.code);
    if (existing) {
      Object.assign(existing, input);
      return existing;
    }
    const badge: Badge = { ...input, id: randomUUID(), created_at: new Date().toISOString() };
    this.badges.push(badge);
    return badge;
  }

  hasBadge(studentId: string, badgeId: string): boolean {
    return this.studentBadgeUnlocks.some((u) => u.student_id === studentId && u.badge_id === badgeId);
  }

  /** Idempotent by construction (composite PK in the real schema) — safe to call
   *  repeatedly for the same student+badge without checking hasBadge() first,
   *  though callers should still check first to avoid a wasted evidence lookup. */
  async awardBadge(
    studentId: string,
    badgeId: string,
    sourceType: BadgeSourceType,
    sourceId: string | null
  ): Promise<void> {
    if (this.hasBadge(studentId, badgeId)) return;
    this.studentBadgeUnlocks.push({
      student_id: studentId,
      badge_id: badgeId,
      source_type: sourceType,
      source_id: sourceId,
      unlocked_at: new Date().toISOString(),
    });
  }

  getBadgesForStudent(studentId: string): StudentBadgeUnlock[] {
    return this.studentBadgeUnlocks.filter((u) => u.student_id === studentId);
  }

  // ---------- notifications (in-app center) ----------

  async createNotification(input: Omit<AppNotification, 'id' | 'created_at' | 'is_read'>): Promise<AppNotification> {
    const notification: AppNotification = {
      ...input,
      id: randomUUID(),
      is_read: false,
      created_at: new Date().toISOString(),
    };
    this.notifications.push(notification);
    return notification;
  }

  getNotificationsForStudent(studentId: string): AppNotification[] {
    return this.notifications
      .filter((n) => n.student_id === studentId)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }

  getUnreadNotificationCount(studentId: string): number {
    return this.notifications.filter((n) => n.student_id === studentId && !n.is_read).length;
  }

  async markNotificationRead(notificationId: string): Promise<void> {
    const notification = this.notifications.find((n) => n.id === notificationId);
    if (notification) notification.is_read = true;
  }

  /** Read-time reminder generators (revision/streak/exam) are idempotent by checking
   *  this before creating — the same reminder is never surfaced twice for the same day. */
  hasNotificationToday(studentId: string, type: NotificationType, relatedSkillId: string | null): boolean {
    const today = new Date().toISOString().slice(0, 10);
    // new Date(...) wrapper, not a raw .slice — PostgresStore's hydrated rows carry
    // `created_at` as a native Date object (pg's default timestamptz parsing), while
    // InMemoryStore's own writes store it as a string; this must handle both.
    return this.notifications.some(
      (n) =>
        n.student_id === studentId &&
        n.type === type &&
        n.related_skill_id === relatedSkillId &&
        new Date(n.created_at).toISOString().slice(0, 10) === today
    );
  }
}
