// ============================================================
// Seed data — direct TypeScript translation of
// database/03-seed-skills.sql (same fixed UUIDs, same rationale).
// Keeping the SQL file as the source of truth for the real DB;
// this file lets the in-memory test harness run without Postgres.
// ============================================================

import { Skill, SkillPrerequisite } from '../types';

const now = new Date().toISOString();

export const SKILLS: Skill[] = [
  // Verbal Analogies
  { id: '00000000-0000-0000-0000-000000000001', section: 'verbal', category: 'verbal_analogy', subskill: 'relationship_identification', name_ar: 'تحديد العلاقة بين زوج الكلمات', base_difficulty: 2, created_at: now },
  { id: '00000000-0000-0000-0000-000000000002', section: 'verbal', category: 'verbal_analogy', subskill: 'functional_relationships', name_ar: 'علاقات وظيفية (جزء-كل، سبب-نتيجة)', base_difficulty: 3, created_at: now },
  { id: '00000000-0000-0000-0000-000000000003', section: 'verbal', category: 'verbal_analogy', subskill: 'abstract_relationships', name_ar: 'علاقات مجردة (درجة، خاصية)', base_difficulty: 4, created_at: now },
  // Sentence Completion
  { id: '00000000-0000-0000-0000-000000000004', section: 'verbal', category: 'sentence_completion', subskill: 'single_blank_vocabulary', name_ar: 'إكمال فراغ واحد بالمفردة المناسبة', base_difficulty: 2, created_at: now },
  { id: '00000000-0000-0000-0000-000000000005', section: 'verbal', category: 'sentence_completion', subskill: 'contextual_tone_inference', name_ar: 'استنتاج النبرة من السياق', base_difficulty: 3, created_at: now },
  { id: '00000000-0000-0000-0000-000000000006', section: 'verbal', category: 'sentence_completion', subskill: 'double_blank_logical_consistency', name_ar: 'إكمال فراغين بترابط منطقي', base_difficulty: 4, created_at: now },
  // Reading Comprehension
  { id: '00000000-0000-0000-0000-000000000007', section: 'verbal', category: 'reading_comprehension', subskill: 'main_idea_extraction', name_ar: 'استخراج الفكرة الرئيسية', base_difficulty: 2, created_at: now },
  { id: '00000000-0000-0000-0000-000000000008', section: 'verbal', category: 'reading_comprehension', subskill: 'inference_from_passage', name_ar: 'الاستنتاج من النص', base_difficulty: 3, created_at: now },
  { id: '00000000-0000-0000-0000-000000000009', section: 'verbal', category: 'reading_comprehension', subskill: 'authors_purpose_tone', name_ar: 'غرض الكاتب ونبرته', base_difficulty: 3, created_at: now },
  { id: '00000000-0000-0000-0000-000000000010', section: 'verbal', category: 'reading_comprehension', subskill: 'detail_verification', name_ar: 'التحقق من تفاصيل النص', base_difficulty: 2, created_at: now },
  // Contextual Error / Odd Word Out
  { id: '00000000-0000-0000-0000-000000000011', section: 'verbal', category: 'contextual_error', subskill: 'semantic_category_matching', name_ar: 'مطابقة الفئة الدلالية', base_difficulty: 2, created_at: now },
  { id: '00000000-0000-0000-0000-000000000012', section: 'verbal', category: 'contextual_error', subskill: 'odd_one_out_by_function', name_ar: 'تحديد الكلمة الشاذة وظيفيًا', base_difficulty: 3, created_at: now },

  // Arithmetic
  { id: '00000000-0000-0000-0000-000000000020', section: 'quantitative', category: 'arithmetic', subskill: 'order_of_operations', name_ar: 'ترتيب العمليات الحسابية', base_difficulty: 1, created_at: now },
  { id: '00000000-0000-0000-0000-000000000021', section: 'quantitative', category: 'arithmetic', subskill: 'number_properties_divisibility', name_ar: 'خصائص الأعداد وقابلية القسمة', base_difficulty: 2, created_at: now },
  { id: '00000000-0000-0000-0000-000000000022', section: 'quantitative', category: 'arithmetic', subskill: 'mental_math_estimation', name_ar: 'الحساب الذهني والتقدير', base_difficulty: 2, created_at: now },
  // Fractions
  { id: '00000000-0000-0000-0000-000000000023', section: 'quantitative', category: 'fractions', subskill: 'operations_add_sub', name_ar: 'جمع وطرح الكسور', base_difficulty: 1, created_at: now },
  { id: '00000000-0000-0000-0000-000000000024', section: 'quantitative', category: 'fractions', subskill: 'operations_mul_div', name_ar: 'ضرب وقسمة الكسور', base_difficulty: 2, created_at: now },
  { id: '00000000-0000-0000-0000-000000000025', section: 'quantitative', category: 'fractions', subskill: 'comparison_ordering', name_ar: 'مقارنة وترتيب الكسور', base_difficulty: 2, created_at: now },
  // Decimals
  { id: '00000000-0000-0000-0000-000000000026', section: 'quantitative', category: 'decimals', subskill: 'conversion_fraction_decimal', name_ar: 'التحويل بين الكسور والأعداد العشرية', base_difficulty: 2, created_at: now },
  { id: '00000000-0000-0000-0000-000000000027', section: 'quantitative', category: 'decimals', subskill: 'operations', name_ar: 'العمليات على الأعداد العشرية', base_difficulty: 1, created_at: now },
  // Percentages
  { id: '00000000-0000-0000-0000-000000000028', section: 'quantitative', category: 'percentages', subskill: 'basic_percentage_calculation', name_ar: 'حساب النسبة المئوية الأساسي', base_difficulty: 2, created_at: now },
  { id: '00000000-0000-0000-0000-000000000029', section: 'quantitative', category: 'percentages', subskill: 'percentage_change', name_ar: 'نسبة الزيادة والنقصان', base_difficulty: 3, created_at: now },
  { id: '00000000-0000-0000-0000-000000000030', section: 'quantitative', category: 'percentages', subskill: 'reverse_percentage', name_ar: 'إيجاد الأصل من النسبة', base_difficulty: 3, created_at: now },
  // Ratios & Proportions
  { id: '00000000-0000-0000-0000-000000000031', section: 'quantitative', category: 'ratios_and_proportions', subskill: 'direct_proportion', name_ar: 'التناسب الطردي', base_difficulty: 2, created_at: now },
  { id: '00000000-0000-0000-0000-000000000032', section: 'quantitative', category: 'ratios_and_proportions', subskill: 'inverse_proportion', name_ar: 'التناسب العكسي', base_difficulty: 3, created_at: now },
  { id: '00000000-0000-0000-0000-000000000033', section: 'quantitative', category: 'ratios_and_proportions', subskill: 'dividing_in_a_ratio', name_ar: 'تقسيم كمية حسب نسبة', base_difficulty: 2, created_at: now },
  // Algebra
  { id: '00000000-0000-0000-0000-000000000034', section: 'quantitative', category: 'algebra', subskill: 'linear_equations', name_ar: 'حل المعادلات الخطية', base_difficulty: 2, created_at: now },
  { id: '00000000-0000-0000-0000-000000000035', section: 'quantitative', category: 'algebra', subskill: 'quadratic_equations', name_ar: 'حل المعادلات التربيعية', base_difficulty: 3, created_at: now },
  { id: '00000000-0000-0000-0000-000000000036', section: 'quantitative', category: 'algebra', subskill: 'inequalities', name_ar: 'حل المتباينات', base_difficulty: 3, created_at: now },
  { id: '00000000-0000-0000-0000-000000000037', section: 'quantitative', category: 'algebra', subskill: 'sum_product_of_roots', name_ar: 'مجموع وحاصل ضرب الجذور', base_difficulty: 4, created_at: now },
  // Exponents & Roots
  { id: '00000000-0000-0000-0000-000000000038', section: 'quantitative', category: 'exponents_and_roots', subskill: 'exponent_rules', name_ar: 'قوانين الأسس', base_difficulty: 2, created_at: now },
  { id: '00000000-0000-0000-0000-000000000039', section: 'quantitative', category: 'exponents_and_roots', subskill: 'sign_behavior_by_region', name_ar: 'سلوك الإشارة حسب فئة العدد (موجب/سالب/كسري)', base_difficulty: 3, created_at: now },
  { id: '00000000-0000-0000-0000-000000000040', section: 'quantitative', category: 'exponents_and_roots', subskill: 'radical_simplification', name_ar: 'تبسيط الجذور', base_difficulty: 3, created_at: now },
  // Geometry
  { id: '00000000-0000-0000-0000-000000000041', section: 'quantitative', category: 'geometry', subskill: 'angles_and_triangles', name_ar: 'الزوايا والمثلثات', base_difficulty: 2, created_at: now },
  { id: '00000000-0000-0000-0000-000000000042', section: 'quantitative', category: 'geometry', subskill: 'area_and_perimeter', name_ar: 'المساحة والمحيط', base_difficulty: 2, created_at: now },
  { id: '00000000-0000-0000-0000-000000000043', section: 'quantitative', category: 'geometry', subskill: 'volume_3d_shapes', name_ar: 'حجوم المجسمات', base_difficulty: 3, created_at: now },
  { id: '00000000-0000-0000-0000-000000000044', section: 'quantitative', category: 'geometry', subskill: 'coordinate_geometry', name_ar: 'الهندسة الإحداثية', base_difficulty: 3, created_at: now },
  // Statistics
  { id: '00000000-0000-0000-0000-000000000045', section: 'quantitative', category: 'statistics', subskill: 'mean_median_mode', name_ar: 'الوسط والوسيط والمنوال', base_difficulty: 1, created_at: now },
  { id: '00000000-0000-0000-0000-000000000046', section: 'quantitative', category: 'statistics', subskill: 'range_and_spread', name_ar: 'المدى والتشتت', base_difficulty: 2, created_at: now },
  // Probability
  { id: '00000000-0000-0000-0000-000000000047', section: 'quantitative', category: 'probability', subskill: 'basic_probability', name_ar: 'الاحتمال الأساسي', base_difficulty: 2, created_at: now },
  { id: '00000000-0000-0000-0000-000000000048', section: 'quantitative', category: 'probability', subskill: 'compound_events', name_ar: 'الأحداث المركبة', base_difficulty: 3, created_at: now },
  // Quantitative Comparison
  { id: '00000000-0000-0000-0000-000000000049', section: 'quantitative', category: 'quantitative_comparison', subskill: 'simplify_by_difference', name_ar: 'التبسيط بالفرق بدل الجمع', base_difficulty: 2, created_at: now },
  { id: '00000000-0000-0000-0000-000000000050', section: 'quantitative', category: 'quantitative_comparison', subskill: 'critical_values_testing', name_ar: 'اختبار القيم الحرجة', base_difficulty: 3, created_at: now },
  { id: '00000000-0000-0000-0000-000000000051', section: 'quantitative', category: 'quantitative_comparison', subskill: 'squaring_validity_check', name_ar: 'التحقق من صحة التربيع لطرفي المقارنة', base_difficulty: 3, created_at: now },
  // Data Interpretation
  { id: '00000000-0000-0000-0000-000000000052', section: 'quantitative', category: 'data_interpretation', subskill: 'reading_charts_and_tables', name_ar: 'قراءة الرسوم والجداول', base_difficulty: 2, created_at: now },
  { id: '00000000-0000-0000-0000-000000000053', section: 'quantitative', category: 'data_interpretation', subskill: 'percentage_change_from_data', name_ar: 'حساب التغير النسبي من بيانات', base_difficulty: 3, created_at: now },
  // Multi-step Word Problems
  { id: '00000000-0000-0000-0000-000000000054', section: 'quantitative', category: 'multi_step_word_problems', subskill: 'rate_time_distance', name_ar: 'مسائل السرعة والزمن والمسافة', base_difficulty: 3, created_at: now },
  { id: '00000000-0000-0000-0000-000000000055', section: 'quantitative', category: 'multi_step_word_problems', subskill: 'multi_step_percentage_profit', name_ar: 'مسائل الربح والخصم متعددة الخطوات', base_difficulty: 3, created_at: now },
  { id: '00000000-0000-0000-0000-000000000056', section: 'quantitative', category: 'multi_step_word_problems', subskill: 'combined_proportional_reasoning', name_ar: 'مسائل تجمع بين أكثر من نوع تناسب', base_difficulty: 4, created_at: now },
];

const P = (skill: string, prereq: string): SkillPrerequisite => ({
  skill_id: skill,
  prerequisite_skill_id: prereq,
});

export const SKILL_PREREQUISITES: SkillPrerequisite[] = [
  P('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001'),
  P('00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001'),
  P('00000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000004'),
  P('00000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000004'),
  P('00000000-0000-0000-0000-000000000008', '00000000-0000-0000-0000-000000000007'),
  P('00000000-0000-0000-0000-000000000009', '00000000-0000-0000-0000-000000000007'),
  P('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000007'),
  P('00000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-000000000011'),

  P('00000000-0000-0000-0000-000000000034', '00000000-0000-0000-0000-000000000020'),

  P('00000000-0000-0000-0000-000000000028', '00000000-0000-0000-0000-000000000024'),
  P('00000000-0000-0000-0000-000000000026', '00000000-0000-0000-0000-000000000025'),
  P('00000000-0000-0000-0000-000000000029', '00000000-0000-0000-0000-000000000028'),
  P('00000000-0000-0000-0000-000000000030', '00000000-0000-0000-0000-000000000028'),

  P('00000000-0000-0000-0000-000000000031', '00000000-0000-0000-0000-000000000024'),
  P('00000000-0000-0000-0000-000000000032', '00000000-0000-0000-0000-000000000031'),
  P('00000000-0000-0000-0000-000000000033', '00000000-0000-0000-0000-000000000031'),

  P('00000000-0000-0000-0000-000000000035', '00000000-0000-0000-0000-000000000034'),
  P('00000000-0000-0000-0000-000000000036', '00000000-0000-0000-0000-000000000034'),
  P('00000000-0000-0000-0000-000000000037', '00000000-0000-0000-0000-000000000035'),

  P('00000000-0000-0000-0000-000000000039', '00000000-0000-0000-0000-000000000038'),
  P('00000000-0000-0000-0000-000000000040', '00000000-0000-0000-0000-000000000038'),

  P('00000000-0000-0000-0000-000000000043', '00000000-0000-0000-0000-000000000042'),
  P('00000000-0000-0000-0000-000000000044', '00000000-0000-0000-0000-000000000041'),

  P('00000000-0000-0000-0000-000000000046', '00000000-0000-0000-0000-000000000045'),
  P('00000000-0000-0000-0000-000000000048', '00000000-0000-0000-0000-000000000047'),
  P('00000000-0000-0000-0000-000000000047', '00000000-0000-0000-0000-000000000031'),

  P('00000000-0000-0000-0000-000000000050', '00000000-0000-0000-0000-000000000039'),
  P('00000000-0000-0000-0000-000000000050', '00000000-0000-0000-0000-000000000034'),
  P('00000000-0000-0000-0000-000000000051', '00000000-0000-0000-0000-000000000049'),

  P('00000000-0000-0000-0000-000000000053', '00000000-0000-0000-0000-000000000052'),
  P('00000000-0000-0000-0000-000000000053', '00000000-0000-0000-0000-000000000029'),

  P('00000000-0000-0000-0000-000000000054', '00000000-0000-0000-0000-000000000032'),
  P('00000000-0000-0000-0000-000000000055', '00000000-0000-0000-0000-000000000028'),
  P('00000000-0000-0000-0000-000000000055', '00000000-0000-0000-0000-000000000029'),
  P('00000000-0000-0000-0000-000000000056', '00000000-0000-0000-0000-000000000031'),
  P('00000000-0000-0000-0000-000000000056', '00000000-0000-0000-0000-000000000032'),
  P('00000000-0000-0000-0000-000000000056', '00000000-0000-0000-0000-000000000029'),
];
