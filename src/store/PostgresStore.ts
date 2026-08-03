// ============================================================
// Postgres-backed store.
//
// DESIGN CHOICE (documented, not hidden): rather than building a
// fully "thin" repository where every read hits the database, this
// class extends InMemoryStore and keeps its exact same public shape
// (same arrays, same method names — all write methods are `async`
// on the base class too, specifically so this override works with
// zero changes required in services/*.ts or harness/runTestHarness.ts).
//
// On construction it hydrates the in-memory arrays from Postgres;
// every write method persists to Postgres FIRST, then updates the
// in-memory mirror so the inherited read methods (filters, finds)
// keep working unchanged. This is a write-through cache, not a
// fully "thin" repository — a legitimate, common pattern for a
// service with modest per-student data volume.
//
// NOT executed against a live database in the sandbox that produced
// this file (no network access there — see POSTGRES-MIGRATION.md).
// Test this against a real Supabase instance before relying on it.
// ============================================================

import { Pool } from 'pg';
import { InMemoryStore } from './InMemoryStore';
import { getPool } from './db';
import {
  Student, Mission, LearningRecord, Session, Lesson, PracticeItem, Attempt, SrsState, GlossaryTerm,
  Badge, BadgeSourceType, AppNotification,
} from '../types';

export class PostgresStore extends InMemoryStore {
  private constructor(private pool: Pool) {
    super();
  }

  /** Async factory — hydrates all tables from Postgres. Use this instead of `new PostgresStore()`. */
  static async create(): Promise<PostgresStore> {
    const pool = getPool();
    const store = new PostgresStore(pool);
    await store.hydrate();
    return store;
  }

  private async hydrate(): Promise<void> {
    const [
      students, missions, skills, prereqs, resources, sessions, records, glossary, unlocks,
      lessons, items, attempts, srs, studentSessions, badges, badgeUnlocks, notifications,
    ] =
      await Promise.all([
        this.pool.query('select * from students'),
        this.pool.query('select * from missions'),
        this.pool.query('select * from skills'),
        this.pool.query('select * from skill_prerequisites'),
        this.pool.query('select * from resources'),
        this.pool.query('select * from sessions'),
        this.pool.query('select * from learning_records'),
        this.pool.query('select * from glossary_terms'),
        this.pool.query('select * from student_glossary_unlocks'),
        this.pool.query('select * from lessons'),
        this.pool.query('select * from practice_items'),
        this.pool.query('select * from attempts'),
        this.pool.query('select * from srs_state'),
        this.pool.query('select * from student_sessions'),
        this.pool.query('select * from badges'),
        this.pool.query('select * from student_badge_unlocks'),
        this.pool.query('select * from notifications'),
      ]);

    this.students = students.rows;
    this.missions = missions.rows;
    if (skills.rows.length > 0) this.skills = skills.rows; // else keep the bundled seed constants as a fallback
    if (prereqs.rows.length > 0) this.skillPrerequisites = prereqs.rows;
    this.resources = resources.rows;
    this.sessions = sessions.rows;
    this.learningRecords = records.rows;
    this.glossaryTerms = glossary.rows;
    this.studentGlossaryUnlocks = unlocks.rows;
    this.lessons = lessons.rows;
    this.practiceItems = items.rows;
    this.attempts = attempts.rows;
    this.srsStates = srs.rows;
    this.studentSessions = studentSessions.rows;
    this.badges = badges.rows;
    this.studentBadgeUnlocks = badgeUnlocks.rows;
    this.notifications = notifications.rows;
  }

  // ---------- overridden write methods (same names/signatures as InMemoryStore) ----------

  async createStudent(
    input: Omit<Student, 'id' | 'created_at' | 'email' | 'password_hash' | 'gender' | 'daily_goal_minutes' | 'weekly_goal_lessons'> & {
      email?: string | null; password_hash?: string | null; gender?: Student['gender'];
      daily_goal_minutes?: number | null; weekly_goal_lessons?: number | null;
    }
  ): Promise<Student> {
    const result = await this.pool.query(
      `insert into students (display_name, auth_user_id, locale, grade_level, parental_consent_at, email, password_hash, gender, daily_goal_minutes, weekly_goal_lessons)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning *`,
      [
        input.display_name, input.auth_user_id, input.locale, input.grade_level, input.parental_consent_at,
        input.email ?? null, input.password_hash ?? null, input.gender ?? null,
        input.daily_goal_minutes ?? null, input.weekly_goal_lessons ?? null,
      ]
    );
    const student: Student = result.rows[0];
    this.students.push(student);
    return student;
  }

  async setStudentAuth(studentId: string, email: string, passwordHash: string): Promise<void> {
    await this.pool.query(
      `update students set email = $1, password_hash = $2 where id = $3`,
      [email, passwordHash, studentId]
    );
    const student = this.students.find((s) => s.id === studentId);
    if (student) {
      student.email = email;
      student.password_hash = passwordHash;
    }
  }

  async setStudentGender(studentId: string, gender: Student['gender']): Promise<void> {
    await this.pool.query(`update students set gender = $1 where id = $2`, [gender, studentId]);
    const student = this.students.find((s) => s.id === studentId);
    if (student) student.gender = gender;
  }

  async setStudentGrade(studentId: string, gradeLevel: number): Promise<void> {
    // See InMemoryStore.setStudentGrade's full comment for why this also
    // stamps parental_consent_at (a demo-appropriate stand-in, not real
    // consent UI) — only when not already set, never overwriting a real one.
    const student = this.students.find((s) => s.id === studentId);
    const consentAt = student?.parental_consent_at ?? new Date().toISOString();
    await this.pool.query(
      `update students set grade_level = $1, parental_consent_at = coalesce(parental_consent_at, $2) where id = $3`,
      [gradeLevel, consentAt, studentId]
    );
    if (student) {
      student.grade_level = gradeLevel;
      if (!student.parental_consent_at) student.parental_consent_at = consentAt;
    }
  }

  async setStudentGoals(studentId: string, dailyGoalMinutes: number | null, weeklyGoalLessons: number | null): Promise<void> {
    await this.pool.query(
      `update students set daily_goal_minutes = $1, weekly_goal_lessons = $2 where id = $3`,
      [dailyGoalMinutes, weeklyGoalLessons, studentId]
    );
    const student = this.students.find((s) => s.id === studentId);
    if (student) { student.daily_goal_minutes = dailyGoalMinutes; student.weekly_goal_lessons = weeklyGoalLessons; }
  }

  async createMission(
    input: Omit<Mission, 'id' | 'created_at' | 'status' | 'superseded_by'>
  ): Promise<Mission> {
    const existingActive = this.missions.find(
      (m) => m.student_id === input.student_id && m.status === 'active'
    );

    const result = await this.pool.query(
      `insert into missions
        (student_id, target_university, target_program, target_score, exam_date,
         weekly_study_hours, current_level_self_report, success_criteria, constraints,
         out_of_scope, needs_followup)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       returning *`,
      [
        input.student_id, input.target_university, input.target_program, input.target_score,
        input.exam_date, input.weekly_study_hours, input.current_level_self_report,
        JSON.stringify(input.success_criteria), JSON.stringify(input.constraints),
        input.out_of_scope, input.needs_followup,
      ]
    );
    const mission: Mission = result.rows[0];
    this.missions.push(mission);

    if (existingActive) {
      await this.pool.query(
        `update missions set status = 'superseded', superseded_by = $1 where id = $2`,
        [mission.id, existingActive.id]
      );
      existingActive.status = 'superseded';
      existingActive.superseded_by = mission.id;

      const recordResult = await this.pool.query(
        `insert into learning_records
          (student_id, skill_id, record_type, evidence, source_session_id, confidence)
         values ($1, null, 'goal_changed', $2, null, 'confirmed')
         returning *`,
        [input.student_id, 'تم تحديث بيانات المهمة (mission) — هدف أو جدول زمني جديد']
      );
      this.learningRecords.push(recordResult.rows[0]);
    }
    return mission;
  }

  async writeLearningRecord(
    input: Omit<LearningRecord, 'id' | 'created_at' | 'status' | 'superseded_by'>
  ): Promise<LearningRecord> {
    const existing = input.skill_id ? this.getActiveRecordForSkill(input.student_id, input.skill_id) : undefined;

    const result = await this.pool.query(
      `insert into learning_records
        (student_id, skill_id, record_type, evidence, source_session_id, confidence)
       values ($1,$2,$3,$4,$5,$6)
       returning *`,
      [input.student_id, input.skill_id, input.record_type, input.evidence, input.source_session_id, input.confidence]
    );
    const record: LearningRecord = result.rows[0];

    if (existing) {
      await this.pool.query(
        `update learning_records set status = 'superseded', superseded_by = $1 where id = $2`,
        [record.id, existing.id]
      );
      existing.status = 'superseded';
      existing.superseded_by = record.id;
    }
    this.learningRecords.push(record);
    return record;
  }

  async createSession(
    input: Omit<Session, 'id' | 'started_at' | 'completed_at' | 'score_estimate'>
  ): Promise<Session> {
    const result = await this.pool.query(
      `insert into sessions (student_id, session_type, lesson_id) values ($1,$2,$3) returning *`,
      [input.student_id, input.session_type, input.lesson_id]
    );
    const session: Session = result.rows[0];
    this.sessions.push(session);
    return session;
  }

  async recordAttempt(input: Omit<Attempt, 'id' | 'attempted_at'>): Promise<Attempt> {
    const result = await this.pool.query(
      `insert into attempts
        (session_id, student_id, practice_item_id, selected_option_index, is_correct, response_time_ms)
       values ($1,$2,$3,$4,$5,$6)
       returning *`,
      [input.session_id, input.student_id, input.practice_item_id, input.selected_option_index, input.is_correct, input.response_time_ms]
    );
    const attempt: Attempt = result.rows[0];
    this.attempts.push(attempt);
    return attempt;
  }

  async completeSession(sessionId: string, scoreEstimate: number | null): Promise<void> {
    await this.pool.query(
      `update sessions set completed_at = now(), score_estimate = $1 where id = $2`,
      [scoreEstimate, sessionId]
    );
    const session = this.sessions.find((s) => s.id === sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);
    session.completed_at = new Date().toISOString();
    session.score_estimate = scoreEstimate;
  }

  async createLesson(input: Omit<Lesson, 'id' | 'created_at'>): Promise<Lesson> {
    const result = await this.pool.query(
      `insert into lessons
        (skill_id, title_ar, concept_explanation, worked_example, difficulty_level,
         generation_prompt_version, review_status, sections)
       values ($1,$2,$3,$4,$5,$6,$7,$8)
       returning *`,
      [
        input.skill_id, input.title_ar, JSON.stringify(input.concept_explanation),
        JSON.stringify(input.worked_example), input.difficulty_level,
        input.generation_prompt_version, input.review_status,
        input.sections ? JSON.stringify(input.sections) : null,
      ]
    );
    const lesson: Lesson = result.rows[0];
    this.lessons.push(lesson);
    return lesson;
  }

  /** Version 6 Phase P: writes authored `sections[]` content for a lesson
   *  that already exists (the Golden Lesson batch-authoring script uses this
   *  — it never re-runs the generation pipeline, just enriches the existing
   *  curated row). */
  async updateLessonSections(lessonId: string, sections: Lesson['sections']): Promise<void> {
    await this.pool.query(`update lessons set sections = $1 where id = $2`, [JSON.stringify(sections), lessonId]);
    const lesson = this.lessons.find((l) => l.id === lessonId);
    if (lesson) lesson.sections = sections;
  }

  async createPracticeItem(
    input: Omit<PracticeItem, 'id' | 'created_at' | 'hint_1_ar' | 'hint_2_ar' | 'common_mistake_ar' | 'memory_tip_ar' | 'wrong_answer_explanations' | 'source'> &
      Partial<Pick<PracticeItem, 'hint_1_ar' | 'hint_2_ar' | 'common_mistake_ar' | 'memory_tip_ar' | 'wrong_answer_explanations' | 'source'>>
  ): Promise<PracticeItem> {
    const result = await this.pool.query(
      `insert into practice_items
        (skill_id, lesson_id, stem_ar, options, correct_option_index, explanation_ar,
         difficulty_level, validation_status, validation_checks,
         hint_1_ar, hint_2_ar, common_mistake_ar, memory_tip_ar, wrong_answer_explanations, source)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       on conflict (skill_id) where lesson_id is null and validation_status = 'passed'
       do nothing
       returning *`,
      [
        input.skill_id, input.lesson_id, input.stem_ar, JSON.stringify(input.options),
        input.correct_option_index, input.explanation_ar, input.difficulty_level,
        input.validation_status, JSON.stringify(input.validation_checks),
        input.hint_1_ar ?? null, input.hint_2_ar ?? null, input.common_mistake_ar ?? null,
        input.memory_tip_ar ?? null,
        input.wrong_answer_explanations ? JSON.stringify(input.wrong_answer_explanations) : null,
        input.source ?? 'ai_generated',
      ]
    );

    if (result.rows.length === 0) {
      // Lost the race to a concurrent insert for the same skill (see 02-schema.sql's
      // idx_practice_items_one_bank_item_per_skill, added for exactly this case) —
      // fetch and reuse whatever the winning insert created instead of erroring.
      const existing = await this.pool.query(
        `select * from practice_items where skill_id = $1 and lesson_id is null and validation_status = 'passed' limit 1`,
        [input.skill_id]
      );
      const item: PracticeItem = existing.rows[0];
      if (!this.practiceItems.some((p) => p.id === item.id)) this.practiceItems.push(item);
      return item;
    }

    const item: PracticeItem = result.rows[0];
    this.practiceItems.push(item);
    return item;
  }

  async upsertSrsState(state: SrsState): Promise<void> {
    await this.pool.query(
      `insert into srs_state (student_id, skill_id, ease_factor, interval_days, repetitions, next_review_at, last_result)
       values ($1,$2,$3,$4,$5,$6,$7)
       on conflict (student_id, skill_id) do update set
         ease_factor = excluded.ease_factor,
         interval_days = excluded.interval_days,
         repetitions = excluded.repetitions,
         next_review_at = excluded.next_review_at,
         last_result = excluded.last_result,
         updated_at = now()`,
      [state.student_id, state.skill_id, state.ease_factor, state.interval_days, state.repetitions, state.next_review_at, state.last_result]
    );
    const idx = this.srsStates.findIndex(
      (s) => s.student_id === state.student_id && s.skill_id === state.skill_id
    );
    if (idx >= 0) this.srsStates[idx] = state;
    else this.srsStates.push(state);
  }

  async createGlossaryTerm(input: Omit<GlossaryTerm, 'id' | 'created_at'>): Promise<GlossaryTerm> {
    const result = await this.pool.query(
      `insert into glossary_terms (term_ar, definition_ar, aliases_to_avoid, skill_id)
       values ($1,$2,$3,$4) returning *`,
      [input.term_ar, input.definition_ar, input.aliases_to_avoid, input.skill_id]
    );
    const term: GlossaryTerm = result.rows[0];
    this.glossaryTerms.push(term);
    return term;
  }

  async unlockGlossaryTermForStudent(studentId: string, glossaryTermId: string, learningRecordId: string): Promise<void> {
    const already = this.studentGlossaryUnlocks.some(
      (u) => u.student_id === studentId && u.glossary_term_id === glossaryTermId
    );
    if (already) return;
    await this.pool.query(
      `insert into student_glossary_unlocks (student_id, glossary_term_id, unlocked_via_learning_record_id)
       values ($1,$2,$3)
       on conflict (student_id, glossary_term_id) do nothing`,
      [studentId, glossaryTermId, learningRecordId]
    );
    this.studentGlossaryUnlocks.push({
      student_id: studentId,
      glossary_term_id: glossaryTermId,
      unlocked_via_learning_record_id: learningRecordId,
      unlocked_at: new Date().toISOString(),
    });
  }

  // ---------- auth sessions ----------

  async createStudentSession(studentId: string, ttlMs: number) {
    const expiresAt = new Date(Date.now() + ttlMs);
    const result = await this.pool.query(
      `insert into student_sessions (student_id, expires_at) values ($1, $2) returning *`,
      [studentId, expiresAt.toISOString()]
    );
    const session = result.rows[0];
    this.studentSessions.push(session);
    return session;
  }

  async deleteStudentSession(token: string): Promise<void> {
    await this.pool.query(`delete from student_sessions where token = $1`, [token]);
    this.studentSessions = this.studentSessions.filter((s) => s.token !== token);
  }

  // ---------- badges ----------

  async createBadge(input: Omit<Badge, 'id' | 'created_at'>): Promise<Badge> {
    // The prior "do update set code = excluded.code" on conflict was a no-op —
    // it let RETURNING work on an existing row but never actually applied any
    // BADGE_DEFINITIONS edit (title/description/icon) to a row already seeded in
    // a previous run. Found via a real case: fixing a badge's icon in source and
    // restarting never changed what was already in Postgres. Update every
    // editable field on conflict so catalog edits actually take effect on reseed.
    const result = await this.pool.query(
      `insert into badges (code, title_ar, description_ar, icon, category)
       values ($1,$2,$3,$4,$5)
       on conflict (code) do update set
         title_ar = excluded.title_ar,
         description_ar = excluded.description_ar,
         icon = excluded.icon,
         category = excluded.category
       returning *`,
      [input.code, input.title_ar, input.description_ar, input.icon, input.category]
    );
    const badge: Badge = result.rows[0];
    const idx = this.badges.findIndex((b) => b.id === badge.id);
    if (idx === -1) this.badges.push(badge); else this.badges[idx] = badge;
    return badge;
  }

  async awardBadge(
    studentId: string,
    badgeId: string,
    sourceType: BadgeSourceType,
    sourceId: string | null
  ): Promise<void> {
    if (this.hasBadge(studentId, badgeId)) return;
    await this.pool.query(
      `insert into student_badge_unlocks (student_id, badge_id, source_type, source_id)
       values ($1,$2,$3,$4)
       on conflict (student_id, badge_id) do nothing`,
      [studentId, badgeId, sourceType, sourceId]
    );
    this.studentBadgeUnlocks.push({
      student_id: studentId,
      badge_id: badgeId,
      source_type: sourceType,
      source_id: sourceId,
      unlocked_at: new Date().toISOString(),
    });
  }

  // ---------- notifications ----------

  async createNotification(input: Omit<AppNotification, 'id' | 'created_at' | 'is_read'>): Promise<AppNotification> {
    const result = await this.pool.query(
      `insert into notifications (student_id, type, title_ar, body_ar, related_skill_id)
       values ($1,$2,$3,$4,$5) returning *`,
      [input.student_id, input.type, input.title_ar, input.body_ar, input.related_skill_id]
    );
    const notification: AppNotification = result.rows[0];
    this.notifications.push(notification);
    return notification;
  }

  async markNotificationRead(notificationId: string): Promise<void> {
    await this.pool.query(`update notifications set is_read = true where id = $1`, [notificationId]);
    const notification = this.notifications.find((n) => n.id === notificationId);
    if (notification) notification.is_read = true;
  }
}
