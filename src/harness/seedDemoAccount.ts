// ============================================================
// Seeds one dedicated, clearly-scoped demo/presentation account with
// believable, internally-consistent progress — for the recorded
// university demo. Idempotent: re-running this script deletes and
// recreates the SAME account (matched by email) rather than piling up
// duplicates. Touches ONLY rows belonging to that one student_id
// (schema's `on delete cascade` from students handles the cleanup) —
// never any other student's data.
//
// Run: npx tsx src/harness/seedDemoAccount.ts
// ============================================================

import { loadEnvFile } from '../loadEnv';
loadEnvFile();

import { PostgresStore } from '../store/PostgresStore';
import { getPool } from '../store/db';
import { AuthService } from '../services/authService';
import { GamificationService } from '../services/gamificationService';

export const DEMO_EMAIL = 'demo.qiyasy@example.com';
export const DEMO_PASSWORD = 'QiyasyDemo2026!';

// Fixed skill UUIDs — copied from src/data/seedSkills.ts / database/03-seed-skills.sql
// (single source of truth for the real DB too), not looked up by name, so a
// name_ar copy edit elsewhere can never silently break this script.
const SKILL = {
  verbalAnalogyPair: '00000000-0000-0000-0000-000000000001', // تحديد العلاقة بين زوج الكلمات — flagship verbal (match)
  functionalRelationships: '00000000-0000-0000-0000-000000000002',
  abstractRelationships: '00000000-0000-0000-0000-000000000003',
  mainIdea: '00000000-0000-0000-0000-000000000007',          // استخراج الفكرة الرئيسية (classify)
  inference: '00000000-0000-0000-0000-000000000008',
  detailVerification: '00000000-0000-0000-0000-000000000010', // التحقق من تفاصيل النص (highlight)
  orderOfOperations: '00000000-0000-0000-0000-000000000020',  // ترتيب العمليات الحسابية — flagship quant (sequence)
  numberProperties: '00000000-0000-0000-0000-000000000021',
  mentalMath: '00000000-0000-0000-0000-000000000022',
  fractionsAddSub: '00000000-0000-0000-0000-000000000023',
  fractionsCompare: '00000000-0000-0000-0000-000000000025',
  anglesTriangles: '00000000-0000-0000-0000-000000000041',
  meanMedianMode: '00000000-0000-0000-0000-000000000045',
  linearEquations: '00000000-0000-0000-0000-000000000034',   // left deliberately weak
} as const;

function daysAgo(n: number, hour = 19, minute = 30): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(hour, minute, 0, 0);
  return d;
}
function daysFromNow(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Creates a session + immediately backdates started_at/completed_at to a
 *  specific past moment (createSession/completeSession always stamp "now",
 *  by design — see PostgresStore.ts — so a direct, targeted update is the
 *  only way to seed the multi-day history a believable streak needs). */
async function backdatedCompletedSession(
  store: PostgresStore,
  studentId: string,
  sessionType: 'diagnostic' | 'lesson' | 'practice' | 'mock_exam',
  when: Date,
  scoreEstimate: number | null = null
) {
  const session = await store.createSession({ student_id: studentId, session_type: sessionType, lesson_id: null });
  await store.completeSession(session.id, scoreEstimate);
  const pool = getPool();
  await pool.query(`update sessions set started_at = $1, completed_at = $2 where id = $3`, [
    when.toISOString(),
    new Date(when.getTime() + 6 * 60 * 1000).toISOString(),
    session.id,
  ]);
  return session;
}

async function main() {
  const store = await PostgresStore.create();
  const auth = new AuthService(store);
  const gamification = new GamificationService(store);
  await gamification.ensureBadgeCatalogSeeded();

  const pool = getPool();

  // ---- idempotent reset: same email, fresh rows every run ----
  const existing = store.getStudentByEmail(DEMO_EMAIL);
  if (existing) {
    console.log(`Existing demo account found (${existing.id}) — deleting before reseeding...`);
    await pool.query(`delete from students where id = $1`, [existing.id]); // cascades everywhere per schema
    // The write-through in-memory mirror (store.students) doesn't know about a
    // raw delete issued outside its own methods — drop it there too, or the
    // upcoming register() call's own getStudentByEmail() check still finds the
    // (now Postgres-deleted) row and rejects as "already registered".
    store.students = store.students.filter((s) => s.id !== existing.id);
  }

  const { student, session } = await auth.register(DEMO_EMAIL, DEMO_PASSWORD, 'سارة العتيبي');
  await store.setStudentGrade(student.id, 12);
  await store.setStudentGender(student.id, 'female');
  await store.setStudentGoals(student.id, 30, 5);
  console.log(`Created demo student ${student.id} (${DEMO_EMAIL})`);

  // ---- mission ----
  await store.createMission({
    student_id: student.id,
    target_university: 'جامعة الملك سعود',
    target_program: 'كلية الطب',
    target_score: 88,
    exam_date: daysFromNow(75),
    weekly_study_hours: 7,
    current_level_self_report: 'متوسط',
    success_criteria: ['اجتياز اختبار القدرات بدرجة 88 أو أعلى'],
    constraints: {},
    out_of_scope: null,
    needs_followup: false,
  });
  console.log('Mission created: target 88, exam in 75 days.');

  // ---- 7-day study history -> streak, XP, mastery, all from real rows ----
  const masterySkills: Array<{ id: string; day: number; label: string }> = [
    { id: SKILL.functionalRelationships, day: 6, label: 'علاقات وظيفية' },
    { id: SKILL.abstractRelationships, day: 6, label: 'علاقات مجردة' },
    { id: SKILL.mainIdea, day: 5, label: 'استخراج الفكرة الرئيسية' },
    { id: SKILL.inference, day: 5, label: 'الاستنتاج من النص' },
    { id: SKILL.orderOfOperations, day: 4, label: 'ترتيب العمليات الحسابية' },
    { id: SKILL.numberProperties, day: 4, label: 'خصائص الأعداد وقابلية القسمة' },
    { id: SKILL.mentalMath, day: 3, label: 'الحساب الذهني والتقدير' },
    { id: SKILL.fractionsAddSub, day: 3, label: 'جمع وطرح الكسور' },
    { id: SKILL.fractionsCompare, day: 2, label: 'مقارنة وترتيب الكسور' },
    { id: SKILL.anglesTriangles, day: 2, label: 'الزوايا والمثلثات' },
    { id: SKILL.meanMedianMode, day: 1, label: 'الوسط والوسيط والمنوال' },
    { id: SKILL.verbalAnalogyPair, day: 1, label: 'تحديد العلاقة بين زوج الكلمات' },
    { id: SKILL.detailVerification, day: 0, label: 'التحقق من تفاصيل النص' },
  ];

  // Day -7: the very first session — diagnostic.
  await backdatedCompletedSession(store, student.id, 'diagnostic', daysAgo(7, 18, 0), 62);

  for (const s of masterySkills) {
    const lessonSession = await backdatedCompletedSession(store, student.id, 'lesson', daysAgo(s.day));
    await store.writeLearningRecord({
      student_id: student.id,
      skill_id: s.id,
      record_type: 'mastery',
      evidence: `أكملت الدرس التفاعلي وحقّقت أداءً صحيحًا متكررًا في "${s.label}".`,
      source_session_id: lessonSession.id,
      confidence: 'confirmed',
    });
  }
  console.log(`Wrote ${masterySkills.length} mastery records across the last 7 days (streak + mastery-by-topic).`);

  // ---- one deliberately weak topic (algebra): attempted, not mastered ----
  const algebraItem = await store.createPracticeItem({
    skill_id: SKILL.linearEquations,
    lesson_id: null,
    stem_ar: 'إذا كان 3س + 5 = 20، فما قيمة س؟',
    options: ['3', '5', '10', '15'],
    correct_option_index: 1,
    explanation_ar: '3س = 20 - 5 = 15، إذن س = 15 ÷ 3 = 5.',
    difficulty_level: 2,
    validation_status: 'passed',
    validation_checks: {},
    hint_1_ar: 'اعزلي الحد الذي يحتوي على س أولًا بطرح 5 من الطرفين.',
    common_mistake_ar: 'قسمة 20 على 3 مباشرة قبل طرح 5 من الطرفين.',
    source: 'curated',
  });
  const algebraSession = await backdatedCompletedSession(store, student.id, 'practice', daysAgo(1, 21, 0));
  const algebraAttempts: Array<{ selected: 0 | 1 | 2 | 3; correct: boolean; ms: number }> = [
    { selected: 0, correct: false, ms: 18000 },
    { selected: 2, correct: false, ms: 12500 },
    { selected: 1, correct: true, ms: 22000 },
  ];
  for (const { selected, correct, ms } of algebraAttempts) {
    await store.recordAttempt({
      session_id: algebraSession.id,
      student_id: student.id,
      practice_item_id: algebraItem.id,
      selected_option_index: selected,
      is_correct: correct,
      response_time_ms: ms,
    });
  }
  console.log('Seeded one attempted-but-not-yet-mastered skill (حل المعادلات الخطية / algebra) — a real weak topic.');

  // ---- mock exam: one completed attempt today (XP + badge; live re-take still needed for a fresh Results screen on camera) ----
  await backdatedCompletedSession(store, student.id, 'mock_exam', daysAgo(0, 17, 0), 72);
  console.log('Seeded one completed mock exam session (score 72%).');

  // ---- spaced-repetition review queue: a handful of skills due today ----
  // Order matters here beyond cosmetics: ZpdSelector's Priority 2 (due review)
  // sorts by next_review_at, and ties break on insertion order — every entry
  // below shares today's date, so the FIRST skill per section listed here is
  // exactly what "ابدأ درسًا في هذا المسار" opens on the journey page. The two
  // flagship demo lessons are listed first in their section on purpose.
  const dueToday = [
    SKILL.orderOfOperations, SKILL.mentalMath, SKILL.anglesTriangles, // quantitative
    SKILL.verbalAnalogyPair, SKILL.functionalRelationships, SKILL.mainIdea, // verbal
  ];
  for (const skillId of dueToday) {
    await store.upsertSrsState({
      student_id: student.id,
      skill_id: skillId,
      ease_factor: 2.4,
      interval_days: 3,
      repetitions: 1,
      next_review_at: daysFromNow(0),
      last_result: 'correct',
      updated_at: new Date().toISOString(),
    });
  }
  console.log(`Seeded ${dueToday.length} skills due for review today.`);

  // ---- notifications: a small, non-duplicated, realistic set ----
  await store.createNotification({
    student_id: student.id,
    type: 'streak_reminder',
    title_ar: 'حافظي على سلسلتك! 🔥',
    body_ar: 'عندك سلسلة 7 أيام متتالية — ذاكري اليوم عشان ما تنكسر.',
    related_skill_id: null,
  });
  await store.createNotification({
    student_id: student.id,
    type: 'lesson_complete',
    title_ar: 'أحسنتِ! 🎉',
    body_ar: 'أكملتِ درس "التحقق من تفاصيل النص".',
    related_skill_id: SKILL.detailVerification,
  });
  const readNotif1 = await store.createNotification({
    student_id: student.id,
    type: 'lesson_complete',
    title_ar: 'أحسنتِ! 🎉',
    body_ar: 'أكملتِ درس "تحديد العلاقة بين زوج الكلمات".',
    related_skill_id: SKILL.verbalAnalogyPair,
  });
  const readNotif2 = await store.createNotification({
    student_id: student.id,
    type: 'exam_reminder',
    title_ar: 'باقي 75 يومًا على الاختبار',
    body_ar: 'راجعي أوراقك المرجعية، وخذي اختبارًا تجريبيًا أخيرًا إذا ما جربتِ واحدًا مؤخرًا.',
    related_skill_id: null,
  });
  await store.markNotificationRead(readNotif1.id);
  await store.markNotificationRead(readNotif2.id);
  console.log('Seeded 4 notifications (2 unread, 2 read).');

  // ---- badges: award via the real service so every unlock is a genuine, consistent computation ----
  const newBadges = await gamification.checkAndAwardBadges(student.id);
  console.log(`Awarded ${newBadges.length} badges: ${newBadges.map((b) => b.title_ar).join('، ')}`);

  // ---- final summary, computed the exact same way the dashboard will read it ----
  const xp = gamification.computeXp(student.id);
  const level = gamification.computeLevel(xp.total);
  const streak = gamification.computeStreak(student.id);
  console.log('\n========================================');
  console.log('DEMO ACCOUNT READY');
  console.log('========================================');
  console.log(`Email:    ${DEMO_EMAIL}`);
  console.log(`Password: ${DEMO_PASSWORD}`);
  console.log(`Student ID: ${student.id}`);
  console.log(`XP: ${xp.total} (level ${level.level}, ${Math.round(level.progress * 100)}% into level)`);
  console.log(`Streak: ${streak.current} days (longest ${streak.longest})`);
  console.log(`Auth session token (unused — login live via the real form instead): ${session.token}`);
  console.log('========================================\n');

  process.exit(0);
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
