// ============================================================
// PHASE 1 TEST HARNESS
// Proves the pedagogy engine works end-to-end, per the brief's
// Week 2-3 milestone: "mission -> diagnostic -> next-lesson ->
// lesson -> learning record" — no UI, exactly as instructed.
//
// Run: npx tsx src/harness/runTestHarness.ts
// (or: npm run harness)
//
// To run against real Postgres instead of the in-memory store,
// see POSTGRES-MIGRATION.md — the only change needed in this file
// is the one line marked below.
// ============================================================

import { InMemoryStore } from '../store/InMemoryStore';
import { MockLlmClient } from '../llm/llmClient';
import { MissionInterviewService } from '../services/missionInterviewService';
import { DiagnosticService } from '../services/diagnosticService';
import { ZpdSelector } from '../services/zpdSelector';
import { LessonGeneratorService } from '../services/lessonGeneratorService';
import { LearningRecordWriterService } from '../services/learningRecordWriterService';
import { GroundingService } from '../services/groundingService';
import { seedDiagnosticItemBank } from '../data/seedDiagnosticBank';
import { seedTrustedResources } from '../data/seedResources';

function section(title: string) {
  console.log('\n' + '='.repeat(70));
  console.log(title);
  console.log('='.repeat(70));
}

function check(label: string, condition: boolean) {
  console.log(`  ${condition ? '✅ PASS' : '❌ FAIL'} — ${label}`);
  return condition;
}

async function runEndToEndDemo() {
  section('STEP 0 — Setup: student + LLM client (mock, offline)');
  const store = new InMemoryStore(); // <-- swap for `await PostgresStore.create()` to run against real Postgres
  seedTrustedResources(store);
  const llm = new MockLlmClient(); // swap for AnthropicLlmClient() in production
  const groundingService = new GroundingService(store);
  const student = await store.createStudent({
    display_name: 'سارة',
    auth_user_id: 'auth-0001',
    locale: 'ar',
    grade_level: 12,
    parental_consent_at: new Date().toISOString(), // consent pre-set for harness purposes
  });
  console.log(`  Student created: ${student.display_name} (${student.id})`);

  section('STEP 1 — Mission Interview (FR-01)');
  const missionService = new MissionInterviewService(store, llm, groundingService);
  const mission = await missionService.conductInterview(
    student.id,
    'أبي أدخل كلية طب، والقدرات باقي عليه شهر ونص تقريبًا'
  );
  console.log(`  Mission saved: target_score=${mission.target_score}, exam_date=${mission.exam_date}, needs_followup=${mission.needs_followup}`);

  section('STEP 2 — Diagnostic Assessment (FR-02)');
  const diagnosticService = new DiagnosticService(store, groundingService);
  const diagnosticSkillIds = diagnosticService.selectDiagnosticSkills(30);
  await seedDiagnosticItemBank(store, diagnosticSkillIds);
  console.log(`  Sampled ${diagnosticSkillIds.length} skills for the diagnostic; item bank seeded.`);

  const diagnosticSession = await diagnosticService.startDiagnostic(student.id);
  const diagnosticItems = store.practiceItems.filter((p) =>
    diagnosticSkillIds.includes(p.skill_id) && p.lesson_id === null
  );

  // Simulate answers: correct on ~90% of items (deterministic pattern, not random, for reproducibility)
  for (let i = 0; i < diagnosticItems.length; i++) {
    const item = diagnosticItems[i];
    const isCorrect = i % 10 !== 0;
    await store.recordAttempt({
      session_id: diagnosticSession.id,
      student_id: student.id,
      practice_item_id: item.id,
      selected_option_index: isCorrect ? item.correct_option_index : ((item.correct_option_index + 1) % 4) as 0 | 1 | 2 | 3,
      is_correct: isCorrect,
      response_time_ms: 15000,
    });
  }

  const { scoreEstimate, recordsWritten } = await diagnosticService.completeDiagnostic(diagnosticSession.id, student.id);
  console.log(`  Diagnostic complete: raw score_estimate=${scoreEstimate}% (uncalibrated — see 05-diagnostic-assessment.md §5)`);
  console.log(`  Tentative mastery records seeded: ${recordsWritten}`);

  section('STEP 3 — ZPD Next-Lesson Selector (FR-03)');
  const zpd = new ZpdSelector(store);
  const recommendation = zpd.selectNext(student.id);
  if (!recommendation) throw new Error('ZPD selector returned no candidate — unexpected after diagnostic seeding');
  console.log(`  Recommended skill: ${recommendation.skillNameAr} (priority tier ${recommendation.priorityTier})`);
  console.log(`  Explanation shown to student: "${recommendation.reasonAr}"`);

  section('STEP 4 — Lesson Generator (FR-04)');
  const lessonGenerator = new LessonGeneratorService(store, llm, groundingService);
  const { lesson, items } = await lessonGenerator.generateOrReuse(recommendation.skillId, 3);
  console.log(`  Lesson generated: "${lesson.title_ar}" (${items.length} practice items)`);
  const passedItems = items.filter((i) => i.validation_status === 'passed');
  console.log(`  Validation: ${passedItems.length}/${items.length} items passed (answer-key + option-length checks)`);
  items.forEach((it, i) =>
    console.log(`    [${i + 1}] difficulty=${it.difficulty_level} status=${it.validation_status} — ${it.stem_ar}`)
  );

  section('STEP 5 — Simulated Lesson Session + Attempts');
  const lessonSession = await store.createSession({ student_id: student.id, session_type: 'lesson', lesson_id: lesson.id });
  const usableItems = items.filter((i) => i.validation_status === 'passed');
  // Simulate: get everything right, INCLUDING the hardest (discriminating) item — a real mastery signal.
  for (const item of usableItems) {
    await store.recordAttempt({
      session_id: lessonSession.id,
      student_id: student.id,
      practice_item_id: item.id,
      selected_option_index: item.correct_option_index,
      is_correct: true,
      response_time_ms: 20000,
    });
  }
  await store.completeSession(lessonSession.id, null);
  console.log(`  Simulated ${usableItems.length} correct attempts (including the hardest item) and completed the session.`);

  section('STEP 6 — Learning-Record Writer (FR-05)');
  const writer = new LearningRecordWriterService(store);
  const writerResult = await writer.processSession(lessonSession.id, student.id, recommendation.skillId);
  console.log(`  Records written this session: ${writerResult.recordsWritten.length}`);
  writerResult.recordsWritten.forEach((r) => console.log(`    - ${r.type} (${r.confidence}) for skill ${r.skillId}`));

  section('STEP 7 — Full learning_records timeline for this student');
  store
    .getActiveLearningRecords(student.id)
    .forEach((r) =>
      console.log(
        `  [${r.record_type}/${r.confidence}] skill=${r.skill_id ? store.getSkill(r.skill_id)?.name_ar : '(mission-level)'} — ${r.evidence}`
      )
    );

  return { store, student, recommendation, lessonSession };
}

/** Isolated assertions per 08-learning-record-writer.md §7 — each on a fresh mini-scenario. */
async function runWriterAssertions() {
  section('WRITER ASSERTIONS (08-learning-record-writer.md §7)');
  const store = new InMemoryStore();
  const student = await store.createStudent({
    display_name: 'اختبار',
    auth_user_id: 'auth-test',
    locale: 'ar',
    grade_level: null,
    parental_consent_at: null,
  });
  const skillId = '00000000-0000-0000-0000-000000000049'; // quantitative_comparison / simplify_by_difference
  const writer = new LearningRecordWriterService(store);

  const makeItem = (difficulty: number) =>
    store.createPracticeItem({
      skill_id: skillId,
      lesson_id: null,
      stem_ar: `عنصر اختبار صعوبة ${difficulty}`,
      options: ['أ', 'ب', 'ج', 'د'],
      correct_option_index: 0,
      explanation_ar: 'تفسير تجريبي',
      difficulty_level: difficulty,
      validation_status: 'passed',
      validation_checks: {},
    });

  let allPassed = true;

  // Assertion 1: all-easy-correct, no hard item attempted -> zero new records
  {
    const session = await store.createSession({ student_id: student.id, session_type: 'lesson', lesson_id: null });
    const easyItems = [await makeItem(2), await makeItem(2), await makeItem(2)];
    for (const it of easyItems) {
      await store.recordAttempt({
        session_id: session.id, student_id: student.id, practice_item_id: it.id,
        selected_option_index: 0, is_correct: true, response_time_ms: 8000,
      });
    }
    await store.completeSession(session.id, null);
    const result = await writer.processSession(session.id, student.id, skillId);
    allPassed = check('All-easy-correct, no hard item -> zero new records', result.recordsWritten.length === 0) && allPassed;
  }

  // Assertion 2: hard item correct + 80%+ overall -> one mastery record (tentative, first evidence)
  {
    const session = await store.createSession({ student_id: student.id, session_type: 'lesson', lesson_id: null });
    const setItems = [await makeItem(2), await makeItem(2), await makeItem(2), await makeItem(4)];
    for (const it of setItems) {
      await store.recordAttempt({
        session_id: session.id, student_id: student.id, practice_item_id: it.id,
        selected_option_index: 0, is_correct: true, response_time_ms: 12000,
      });
    }
    await store.completeSession(session.id, null);
    const result = await writer.processSession(session.id, student.id, skillId);
    const masteryRecord = result.recordsWritten.find((r) => r.type === 'mastery');
    allPassed = check(
      'Hard item correct + 80%+ -> one tentative mastery record (first evidence)',
      !!masteryRecord && masteryRecord.confidence === 'tentative'
    ) && allPassed;
  }

  // Assertion 3: wrong-then-right on same skill -> one misconception_corrected (tentative)
  {
    const skillId2 = '00000000-0000-0000-0000-000000000039'; // sign_behavior_by_region
    const session = await store.createSession({ student_id: student.id, session_type: 'lesson', lesson_id: null });
    const wrongItem = await store.createPracticeItem({
      skill_id: skillId2, lesson_id: null, stem_ar: 'قارن: -x² مقابل (-x)²',
      options: ['أ', 'ب', 'ج', 'د'], correct_option_index: 0, explanation_ar: '...',
      difficulty_level: 3, validation_status: 'passed', validation_checks: {},
    });
    const rightItem = await store.createPracticeItem({
      skill_id: skillId2, lesson_id: null, stem_ar: 'إذا كان -x² = -25 فأوجد x',
      options: ['أ', 'ب', 'ج', 'د'], correct_option_index: 0, explanation_ar: '...',
      difficulty_level: 3, validation_status: 'passed', validation_checks: {},
    });
    await store.recordAttempt({
      session_id: session.id, student_id: student.id, practice_item_id: wrongItem.id,
      selected_option_index: 1, is_correct: false, response_time_ms: 9000,
    });
    // ensure a later timestamp for ordering
    await new Promise((r) => setTimeout(r, 2));
    await store.recordAttempt({
      session_id: session.id, student_id: student.id, practice_item_id: rightItem.id,
      selected_option_index: 0, is_correct: true, response_time_ms: 11000,
    });
    await store.completeSession(session.id, null);
    const result = await writer.processSession(session.id, student.id, skillId2);
    const correction = result.recordsWritten.find((r) => r.type === 'misconception_corrected');
    allPassed = check(
      'Wrong-then-right on same skill -> one tentative misconception_corrected record',
      !!correction && correction.confidence === 'tentative'
    ) && allPassed;
  }

  // Assertion 4: abandoned session (no completed_at) -> zero records, writer never really invoked
  {
    const session = await store.createSession({ student_id: student.id, session_type: 'lesson', lesson_id: null });
    const it = await makeItem(2);
    await store.recordAttempt({
      session_id: session.id, student_id: student.id, practice_item_id: it.id,
      selected_option_index: 0, is_correct: true, response_time_ms: 7000,
    });
    // deliberately do NOT call store.completeSession()
    const result = await writer.processSession(session.id, student.id, skillId);
    allPassed = check('Abandoned session (no completed_at) -> zero records', result.recordsWritten.length === 0) && allPassed;
  }

  return allPassed;
}

async function main() {
  const { recommendation } = await runEndToEndDemo();
  const assertionsPassed = await runWriterAssertions();

  section('SUMMARY');
  console.log(`  End-to-end pipeline: mission → diagnostic → ZPD → lesson → learning record ✅`);
  console.log(`  Final ZPD-selected skill this run: ${recommendation.skillNameAr}`);
  console.log(`  Writer assertions: ${assertionsPassed ? 'ALL PASSED ✅' : 'SOME FAILED ❌'}`);
  process.exit(assertionsPassed ? 0 : 1);
}

main().catch((err) => {
  console.error('Harness failed with an error:', err);
  process.exit(1);
});
