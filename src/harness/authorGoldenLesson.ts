// ============================================================
// Golden Lesson authoring script — Supervisor Feedback Sprint, area 9.
//
// Writes ONE fully-curated, hand-authored lesson (skill: "اختبار القيم
// الحرجة" — critical-values testing, the exact technique MISSION.md names
// as a core Qudrat quantitative-comparison speed technique) that exercises
// the complete lesson rhythm this sprint asks for: objective -> visual ->
// mini explanation -> worked example -> interactive activity -> hint ->
// reflection -> summary, via `lessons.sections` (see
// database/07-lesson-generator.md §6) and public/lesson-renderer.js's
// COMPONENT_REGISTRY. It also authors 6 curated practice items (source:
// 'curated', validation_status: 'passed') so the lesson's mini-challenge
// and formal quiz never fall back to live generation.
//
// Deliberately makes ZERO LLM calls — every fact here was hand-verified
// (see the algebra notes inline), matching the project's own "curated beats
// generated" quality bar. Idempotent: re-running finds the existing lesson
// for this skill (if any) and enriches it via updateLessonSections rather
// than creating a duplicate.
//
// Run: npx tsx src/harness/authorGoldenLesson.ts
// ============================================================

import { loadEnvFile } from '../loadEnv';
loadEnvFile();

import { PostgresStore } from '../store/PostgresStore';
import { Lesson, LessonSection, ConceptBlock } from '../types';

const SKILL_ID = '00000000-0000-0000-0000-000000000050'; // اختبار القيم الحرجة (critical_values_testing)
const DIFFICULTY = 3; // matches this skill's seeded base_difficulty

const CONCEPT_EXPLANATION: ConceptBlock[] = [
  {
    kind: 'principle',
    text_ar:
      'في أسئلة المقارنة الكمية اللي فيها متغير غير محدد (مثل س)، لا تحاولي حساب قيمة دقيقة — النتيجة غالبًا تعتمد على أي فئة تقع فيها قيمة المتغير.',
  },
  {
    kind: 'technique',
    text_ar:
      'اختبري أربع قيم حرجة فقط: عدد سالب، صفر، كسر بين صفر وواحد، وعدد أكبر من واحد. إذا تكررت نفس النتيجة في الأربع، فهذي إجابتك. إذا اختلفت النتيجة بين حالة وأخرى، فالإجابة "لا يمكن الحكم على العلاقة".',
  },
  {
    kind: 'caution',
    text_ar:
      'قبل ما تبدئين بتجربة القيم، افحصي إذا كانت العبارتان متطابقتين جبريًا (مثل (-س)² و س²، دائمًا متساويتان) — إذا كانت متطابقة، ما تحتاجين تجربة أي قيمة أصلًا.',
  },
];

const WORKED_EXAMPLE = {
  problem_ar: 'قارن: العمود أ = س²      العمود ب = س   (حيث س عدد حقيقي غير محدد)',
  solution_steps_ar: [
    'جربي س = -2 (سالب): العمود أ = 4، العمود ب = -2 ← العمود أ أكبر.',
    'جربي س = 0 (صفر): العمود أ = 0، العمود ب = 0 ← العمودان متساويان.',
    'جربي س = 0.5 (كسر بين صفر وواحد): العمود أ = 0.25، العمود ب = 0.5 ← العمود ب أكبر.',
    'بما إن النتيجة تغيّرت بين الحالات الثلاث (أحيانًا أ أكبر، أحيانًا متساويان، أحيانًا ب أكبر)، فالإجابة الصحيحة: لا يمكن الحكم على العلاقة.',
  ],
};

const SECTIONS: LessonSection[] = [
  {
    sectionType: 'objective',
    component: 'LearningObjective',
    body_ar: 'بنهاية هذا الدرس، بتقدر تحسم أي سؤال مقارنة بين س و س² خلال أقل من 20 ثانية، بتجربة أربع قيم حرجة بدل الحل الكامل.',
  },
  {
    sectionType: 'concept',
    component: 'RuleCard',
    title_ar: 'القيم الحرجة الأربع',
    body_ar: 'أربع قيم بس تكفي لحسم أي مقارنة فيها متغير غير محدد — لأن سلوك التعبير (مثل س²) يختلف جذريًا حسب الفئة اللي تقع فيها س.',
    visual: 'number_line',
    parameters: {
      min: -3,
      max: 4,
      points: [
        { value: -2, label: 'سالب' },
        { value: 0, label: 'صفر' },
        { value: 0.5, label: 'كسر' },
        { value: 3, label: 'أكبر من 1' },
      ],
    },
  },
  {
    sectionType: 'worked_example',
    component: 'WorkedExample',
    title_ar: 'مثال محلول',
    body_ar: WORKED_EXAMPLE.problem_ar,
    visual: 'table',
    parameters: {
      problem_ar: WORKED_EXAMPLE.problem_ar,
      solution_steps_ar: WORKED_EXAMPLE.solution_steps_ar,
      // A scannable summary of the three tested values, right next to the
      // prose steps above — same numbers, second (tabular) representation,
      // not a new/different fact.
      visualSpec: {
        headers: ['س', 'العمود أ = س²', 'العمود ب = س', 'الأكبر'],
        rows: [
          ['-2', '4', '-2', 'أ'],
          ['0', '0', '0', 'متساويان'],
          ['0.5', '0.25', '0.5', 'ب'],
        ],
      },
    },
  },
  {
    sectionType: 'activity',
    component: 'InteractiveActivityCard',
    body_ar: 'صنّفي كل قيمة لـ س: هل تخلي س² أكبر، ولا س أكبر؟',
    parameters: {
      variant: 'classify',
      prompt_ar: 'صنّفي كل قيمة لـ س: هل تخلي س² أكبر، ولا س أكبر؟',
      categories: ['س² أكبر', 'س أكبر'],
      // Verified by hand: (-3)²=9>-3 | 0.2²=0.04<0.2 | 5²=25>5 | 0.8²=0.64<0.8
      items: [
        { text_ar: 'س = -3', correctCategory: 0 },
        { text_ar: 'س = 0.2', correctCategory: 1 },
        { text_ar: 'س = 5', correctCategory: 0 },
        { text_ar: 'س = 0.8', correctCategory: 1 },
      ],
    },
  },
  {
    sectionType: 'hint',
    component: 'HintCard',
    body_ar: 'إذا نسيتِ وش القيم تجربين، اسألي نفسك بالترتيب: هل جربت رقم سالب؟ هل جربت صفر؟ هل جربت كسر؟ هل جربت رقم أكبر من واحد؟ إذا "نعم" على الأربعة وطلعت نفس النتيجة كل مرة، فأنتِ متأكدة من إجابتك.',
  },
  {
    sectionType: 'reflection',
    component: 'CheckpointCard',
    body_ar: 'قبل ما تكملين: جربتِ تتوقعين النتيجة في ذهنك قبل ما تحسبين رقميًا؟ هذي الخطوة هي اللي توفر عليك ثواني ثمينة في الاختبار الحقيقي.',
  },
  {
    sectionType: 'summary',
    component: 'SummaryCard',
    title_ar: 'اختبار القيم الحرجة',
    parameters: {
      points: [
        'اختبري 4 قيم بس: سالب، صفر، كسر بين صفر وواحد، وعدد أكبر من واحد.',
        'إذا تغيّرت النتيجة بين الحالات، فالإجابة: لا يمكن الحكم على العلاقة.',
        'افحصي التطابق الجبري أولًا (مثل (-س)²=س²) — يوفر عليك تجربة القيم كلها.',
      ],
    },
  },
];

interface CuratedItem {
  stem_ar: string;
  options: [string, string, string, string];
  correct_option_index: 0 | 1 | 2 | 3;
  explanation_ar: string;
  difficulty_level: number;
  hint_1_ar?: string;
  hint_2_ar?: string;
  common_mistake_ar?: string;
  memory_tip_ar?: string;
}

const COMPARISON_OPTIONS: [string, string, string, string] = [
  'العمود الأول أكبر',
  'العمود الثاني أكبر',
  'القيمتان متساويتان',
  'لا يمكن الحكم عليه',
];

// Every item hand-verified — see the inline algebra in each explanation.
// Items 1-4: direct application (difficulty 2). Items 5-6: deliberately
// harder, discriminating pair that punishes over-generalizing the 4-value
// rule as purely mechanical (difficulty 4) — matches
// database/07-lesson-generator.md §1's "5-8 items... harder discriminating"
// composition, same convention MockLlmClient.mockItems() already follows.
const ITEMS: CuratedItem[] = [
  {
    stem_ar: 'قارن: العمود الأول = س، العمود الثاني = س²   (حيث س عدد حقيقي، ومعلوم أن س > 1)',
    options: COMPARISON_OPTIONS,
    correct_option_index: 1,
    explanation_ar: 'بما إن س محصورة في فئة واحدة فقط (أكبر من 1)، فسلوك س² > س ثابت في هذه الفئة بالكامل — لا حاجة لتجربة باقي القيم الحرجة لأن القيد استبعدها مسبقًا.',
    difficulty_level: 2,
    hint_1_ar: 'القيد "س > 1" يحصر س في فئة واحدة بس من الفئات الأربع — جربي رقم من نفس الفئة، مثل س = 2.',
  },
  {
    stem_ar: 'قارن: العمود الأول = س²، العمود الثاني = س   (حيث 0 < س < 1)',
    options: COMPARISON_OPTIONS,
    correct_option_index: 1,
    explanation_ar: 'س محصورة في فئة الكسور بين صفر وواحد فقط. جربي س = 0.5: س² = 0.25 أصغر من س = 0.5 — إذن العمود الثاني أكبر في هذه الفئة بالكامل.',
    difficulty_level: 2,
  },
  {
    stem_ar: 'قارن: العمود الأول = س، العمود الثاني = س²   (حيث س عدد حقيقي غير محدد)',
    options: COMPARISON_OPTIONS,
    correct_option_index: 3,
    explanation_ar: 'بدون أي قيد على س، النتيجة تختلف حسب الفئة (جربي القيم الحرجة الأربع من الدرس) — إذن لا يمكن الحكم على العلاقة.',
    difficulty_level: 2,
    hint_1_ar: 'هذا بالضبط المثال المحلول في الدرس — جربي القيم الحرجة الأربع.',
    common_mistake_ar: 'خطأ شائع: افتراض أن س² دائمًا أكبر من س، بينما هذا صحيح فقط عندما س سالبة أو أكبر من واحد.',
  },
  {
    stem_ar: 'قارن: العمود الأول = (-س)²، العمود الثاني = س²   (حيث س عدد حقيقي لا يساوي صفر)',
    options: COMPARISON_OPTIONS,
    correct_option_index: 2,
    explanation_ar: '(-س)² = س² لأي قيمة لـ س — هذا تطابق جبري، ليس محتاج تجربة قيم أصلًا. العمودان متساويان دائمًا.',
    difficulty_level: 2,
    memory_tip_ar: 'قبل تجربة القيم، اسألي نفسك: هل العبارتان متطابقتان جبريًا أصلًا؟ توفر عليك وقت.',
  },
  {
    stem_ar: 'قارن: العمود الأول = س، العمود الثاني = س³   (حيث س عدد حقيقي غير محدد)',
    options: COMPARISON_OPTIONS,
    correct_option_index: 3,
    explanation_ar: 'جربي س = -2: العمود الأول = -2، العمود الثاني = -8 ← الأول أكبر. جربي س = 2: الأول = 2، الثاني = 8 ← الثاني أكبر. النتيجة تختلف، فلا يمكن الحكم على العلاقة.',
    difficulty_level: 4,
    hint_1_ar: 'أربع القيم الحرجة المعتادة (سالب صغير مثل -2) كافية هنا لإظهار أن النتيجة تختلف.',
    common_mistake_ar: 'خطأ شائع: تطبيق قاعدة "س مقابل س²" حرفيًا على "س مقابل س³" بدون تجربة فعلية — القوة الفردية (³) تتصرف بشكل مختلف عن الزوجية (²).',
  },
  {
    stem_ar: 'قارن: العمود الأول = √س، العمود الثاني = س   (حيث س ≥ صفر)',
    options: COMPARISON_OPTIONS,
    correct_option_index: 3,
    explanation_ar: 'جربي س = 0.25: √س = 0.5 أكبر من س = 0.25 ← الأول أكبر. جربي س = 4: √س = 2 أصغر من س = 4 ← الثاني أكبر. النتيجة تختلف، فلا يمكن الحكم على العلاقة.',
    difficulty_level: 4,
    hint_1_ar: 'جربي قيمة كسرية بين صفر وواحد، ثم قيمة أكبر من واحد — قارني النتيجتين.',
    common_mistake_ar: 'خطأ شائع: افتراض أن الجذر التربيعي "يصغّر" العدد دائمًا — هذا صحيح فقط لما س > 1، والعكس صحيح لما س كسر بين صفر وواحد.',
  },
];

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL not found in .env — cannot author the Golden Lesson without a live database.');
    process.exit(1);
  }

  console.log('Connecting to Supabase...');
  const store = await PostgresStore.create();

  const skill = store.getSkill(SKILL_ID);
  if (!skill) {
    console.error(`Skill ${SKILL_ID} not found — is the skills table seeded (03-seed-skills.sql)?`);
    process.exit(1);
  }
  console.log(`Skill: ${skill.name_ar} (${skill.category})`);

  let lesson: Lesson | undefined = store.findReusableLesson(SKILL_ID, DIFFICULTY);

  if (lesson) {
    console.log(`Existing lesson found (${lesson.id}, status: ${lesson.review_status}) — enriching with sections[] only, leaving its legacy content untouched.`);
    await store.updateLessonSections(lesson.id, SECTIONS);
  } else {
    console.log('No existing lesson for this skill — creating a new curated, published lesson.');
    lesson = await store.createLesson({
      skill_id: SKILL_ID,
      title_ar: 'اختبار القيم الحرجة',
      concept_explanation: CONCEPT_EXPLANATION,
      worked_example: WORKED_EXAMPLE,
      difficulty_level: DIFFICULTY,
      generation_prompt_version: 'golden-lesson-v1',
      review_status: 'published',
      sections: SECTIONS,
    });
    console.log(`Created lesson ${lesson.id}.`);
  }

  const existingItems = store.getPracticeItemsForLesson(lesson.id);
  if (existingItems.length > 0) {
    console.log(`Lesson already has ${existingItems.length} practice item(s) — leaving them as-is (idempotent re-run).`);
  } else {
    console.log(`Creating ${ITEMS.length} curated practice items...`);
    for (const item of ITEMS) {
      await store.createPracticeItem({
        skill_id: SKILL_ID,
        lesson_id: lesson.id,
        stem_ar: item.stem_ar,
        options: item.options,
        correct_option_index: item.correct_option_index,
        explanation_ar: item.explanation_ar,
        difficulty_level: item.difficulty_level,
        validation_status: 'passed',
        validation_checks: { hand_authored_and_reviewed: true },
        hint_1_ar: item.hint_1_ar ?? null,
        hint_2_ar: item.hint_2_ar ?? null,
        common_mistake_ar: item.common_mistake_ar ?? null,
        memory_tip_ar: item.memory_tip_ar ?? null,
        wrong_answer_explanations: null,
        source: 'curated',
      });
    }
  }

  console.log('\n✅ Golden Lesson authored successfully.');
  console.log(`   Lesson ID: ${lesson.id}`);
  console.log(`   Sections: ${SECTIONS.length} (objective, visual+concept, worked example, interactive activity, hint, reflection, summary)`);
  console.log(`   Practice items: ${ITEMS.length}`);
  console.log('   Any student whose ZPD path reaches "اختبار القيم الحرجة" now gets the full structured lesson experience.');
  process.exit(0);
}

main().catch((err) => {
  console.error('Golden Lesson authoring failed:', err);
  process.exit(1);
});
