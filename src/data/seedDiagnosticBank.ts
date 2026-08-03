// ============================================================
// Seeds a minimal diagnostic item bank: one practice_item per skill
// likely to be sampled by DiagnosticService.selectDiagnosticSkills().
// These are authored directly for the item bank (lesson_id = null),
// per database/01-data-model-design.md §3.8 — a real deployment
// would have a human-reviewed bank here; this harness generates
// simple placeholder items so the diagnostic step is runnable.
// ============================================================

import { InMemoryStore } from '../store/InMemoryStore';

export async function seedDiagnosticItemBank(store: InMemoryStore, skillIds: string[]): Promise<void> {
  const options: [string, string, string, string] = [
    'الخيار الأول',
    'الخيار الثاني',
    'الخيار الثالث',
    'الخيار الرابع',
  ];
  for (const skillId of skillIds) {
    const skill = store.getSkill(skillId);
    if (!skill) continue;

    // Same dedup rule as the real-generation path (diagnosticService.ts): reuse
    // an existing item for this skill instead of creating another one every
    // time the diagnostic is (re)started — this was the actual root cause of
    // item counts inflating across repeated attempts (e.g. 12 → 24 → 36...).
    const existing = store.practiceItems.find(
      (p) => p.skill_id === skillId && p.lesson_id === null && p.validation_status === 'passed'
    );
    if (existing) continue;

    await store.createPracticeItem({
      skill_id: skillId,
      lesson_id: null,
      stem_ar: `[سؤال تجريبي مؤقت] أي إجابة تتعلق بمهارة "${skill.name_ar}"؟`,
      options,
      correct_option_index: 0,
      explanation_ar: 'هذا عنصر تجريبي مؤقت لاختبار تدفق النظام فقط — سيُستبدل بأسئلة حقيقية عند تفعيل Claude API.',
      difficulty_level: skill.base_difficulty,
      validation_status: 'passed',
      validation_checks: { seeded_placeholder: true },
    });
  }
}
