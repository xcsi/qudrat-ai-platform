// ============================================================
// Standalone verification script: simulates a genuinely high-performing
// student across 3 lesson rounds to confirm the ZPD selector actually
// moves to a NEW skill each time (not stuck on the same one) and that
// the dashboard's mastered-count genuinely grows. Uses the store directly
// (knows the real correct answers) rather than the public API, which
// deliberately withholds correct_option_index from the client.
//
// Run: npx tsx src/harness/verifyProgression.ts
// ============================================================

import { InMemoryStore } from '../store/InMemoryStore';
import { MockLlmClient } from '../llm/llmClient';
import { MissionInterviewService } from '../services/missionInterviewService';
import { DiagnosticService } from '../services/diagnosticService';
import { ZpdSelector } from '../services/zpdSelector';
import { LessonGeneratorService } from '../services/lessonGeneratorService';
import { LearningRecordWriterService } from '../services/learningRecordWriterService';
import { ReferenceSheetService } from '../services/referenceSheetService';
import { GroundingService } from '../services/groundingService';
import { seedDiagnosticItemBank } from '../data/seedDiagnosticBank';

async function main() {
  const store = new InMemoryStore();
  const llm = new MockLlmClient();
  const groundingService = new GroundingService(store);
  const missionService = new MissionInterviewService(store, llm, groundingService);
  const diagnosticService = new DiagnosticService(store, groundingService);
  const zpd = new ZpdSelector(store);
  const lessonGenerator = new LessonGeneratorService(store, llm, groundingService);
  const writer = new LearningRecordWriterService(store);

  const student = await store.createStudent({
    display_name: 'test', auth_user_id: 'x', locale: 'ar', grade_level: 12,
    parental_consent_at: new Date().toISOString(),
  });

  await missionService.conductInterview(student.id, 'طب، شهرين');

  const skillIds = diagnosticService.selectDiagnosticSkills(12);
  await seedDiagnosticItemBank(store, skillIds);
  const diagSession = await diagnosticService.startDiagnostic(student.id);
  const diagItems = store.practiceItems.filter((p) => skillIds.includes(p.skill_id) && p.lesson_id === null);
  for (const item of diagItems) {
    await store.recordAttempt({
      session_id: diagSession.id, student_id: student.id, practice_item_id: item.id,
      selected_option_index: item.correct_option_index, is_correct: true, response_time_ms: 8000,
    });
  }
  await diagnosticService.completeDiagnostic(diagSession.id, student.id);

  for (let round = 1; round <= 3; round++) {
    const recommendation = zpd.selectNext(student.id);
    if (!recommendation) { console.log(`Round ${round}: no more candidates`); break; }
    console.log(`Round ${round}: recommended "${recommendation.skillNameAr}" (tier ${recommendation.priorityTier})`);

    const { lesson, items } = await lessonGenerator.generateOrReuse(recommendation.skillId, 3);
    const session = await store.createSession({ student_id: student.id, session_type: 'lesson', lesson_id: lesson.id });
    const usable = items.filter((i) => i.validation_status === 'passed');
    for (const item of usable) {
      await store.recordAttempt({
        session_id: session.id, student_id: student.id, practice_item_id: item.id,
        selected_option_index: item.correct_option_index, is_correct: true, response_time_ms: 15000,
      });
    }
    await store.completeSession(session.id, null);
    const result = await writer.processSession(session.id, student.id, recommendation.skillId);
    console.log(`  -> records written: ${JSON.stringify(result.recordsWritten)}`);

    // Mirror httpServer.ts's unlock hook (this script calls services directly, bypassing the HTTP layer).
    for (const r of result.recordsWritten) {
      if (r.type === 'mastery') {
        const glossaryTerm = store.getGlossaryTermForSkill(r.skillId);
        if (glossaryTerm) {
          const record = store.getActiveRecordForSkill(student.id, r.skillId);
          if (record) await store.unlockGlossaryTermForStudent(student.id, glossaryTerm.id, record.id);
        }
      }
    }
  }

  const activeRecords = store.getActiveLearningRecords(student.id);
  const masteredCount = activeRecords.filter((r) => r.record_type === 'mastery').length;
  console.log(`\nFinal mastered count: ${masteredCount} / ${store.skills.length}`);

  const referenceSheetService = new ReferenceSheetService(store);
  const sheets = referenceSheetService.getSheetsForStudent(student.id);
  console.log(`\nReference sheets generated: ${sheets.length}`);
  sheets.forEach((sheet) => {
    console.log(`  Category: ${sheet.category} (${sheet.entries.length} entries)`);
    sheet.entries.forEach((e) => console.log(`    - ${e.skillNameAr}: ${e.techniques.length} techniques, ${e.cautions.length} cautions`));
  });

  const unlockedTerms = store.getUnlockedGlossaryTerms(student.id);
  console.log(`\nGlossary terms unlocked: ${unlockedTerms.length}`);
  unlockedTerms.forEach((t) => console.log(`  - ${t.term_ar}: ${t.definition_ar}`));
}

main().catch((e) => { console.error(e); process.exit(1); });
