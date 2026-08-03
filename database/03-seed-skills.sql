-- ============================================================
-- Qudrat AI Tutor — Phase 1 Pedagogy Engine
-- Seed: skills (syllabus graph) + skill_prerequisites
--
-- Source: Discovery Report §4.1–4.2 question taxonomy.
-- Fixed UUIDs are used deliberately (not gen_random_uuid()) so
-- that lessons/practice_items seeded later, and this file itself,
-- can be re-run idempotently and cross-referenced by code below.
-- Run this AFTER 02-schema.sql.
--
-- REV 2 (engineering review P0-3): both insert blocks now end with
-- ON CONFLICT DO NOTHING. WHY: this script was previously run twice
-- against the live Supabase instance with no protection, producing
-- 49 skill rows instead of the intended 44 (and 37 prerequisite rows
-- instead of 32) — silently corrupting the ZPD graph (orphaned
-- duplicate skills with no incoming prerequisite edges become
-- immediately "eligible" regardless of actual student mastery) and
-- inflating diagnostic/mock-exam sampling pools. WHAT changed: added
-- ON CONFLICT (section, category, subskill) DO NOTHING to the skills
-- inserts and ON CONFLICT (skill_id, prerequisite_skill_id) DO NOTHING
-- to the prerequisites insert, matching the unique/primary-key
-- constraints already defined in 02-schema.sql. Re-running this file
-- any number of times now converges to exactly 44 + 32 rows.
-- ============================================================

-- ------------------------------------------------------------
-- VERBAL SECTION
-- ------------------------------------------------------------

insert into skills (id, section, category, subskill, name_ar, base_difficulty) values
-- Verbal Analogies (تناظر لفظي)
('00000000-0000-0000-0000-000000000001','verbal','verbal_analogy','relationship_identification','تحديد العلاقة بين زوج الكلمات',2),
('00000000-0000-0000-0000-000000000002','verbal','verbal_analogy','functional_relationships','علاقات وظيفية (جزء-كل، سبب-نتيجة)',3),
('00000000-0000-0000-0000-000000000003','verbal','verbal_analogy','abstract_relationships','علاقات مجردة (درجة، خاصية)',4),

-- Sentence Completion (إكمال الجمل)
('00000000-0000-0000-0000-000000000004','verbal','sentence_completion','single_blank_vocabulary','إكمال فراغ واحد بالمفردة المناسبة',2),
('00000000-0000-0000-0000-000000000005','verbal','sentence_completion','contextual_tone_inference','استنتاج النبرة من السياق',3),
('00000000-0000-0000-0000-000000000006','verbal','sentence_completion','double_blank_logical_consistency','إكمال فراغين بترابط منطقي',4),

-- Reading Comprehension (استيعاب المقروء)
('00000000-0000-0000-0000-000000000007','verbal','reading_comprehension','main_idea_extraction','استخراج الفكرة الرئيسية',2),
('00000000-0000-0000-0000-000000000008','verbal','reading_comprehension','inference_from_passage','الاستنتاج من النص',3),
('00000000-0000-0000-0000-000000000009','verbal','reading_comprehension','authors_purpose_tone','غرض الكاتب ونبرته',3),
('00000000-0000-0000-0000-000000000010','verbal','reading_comprehension','detail_verification','التحقق من تفاصيل النص',2),

-- Contextual Error / Odd Word Out (الخطأ السياقي)
('00000000-0000-0000-0000-000000000011','verbal','contextual_error','semantic_category_matching','مطابقة الفئة الدلالية',2),
('00000000-0000-0000-0000-000000000012','verbal','contextual_error','odd_one_out_by_function','تحديد الكلمة الشاذة وظيفيًا',3)
on conflict (section, category, subskill) do nothing;

-- ------------------------------------------------------------
-- QUANTITATIVE SECTION
-- ------------------------------------------------------------

insert into skills (id, section, category, subskill, name_ar, base_difficulty) values
-- Arithmetic
('00000000-0000-0000-0000-000000000020','quantitative','arithmetic','order_of_operations','ترتيب العمليات الحسابية',1),
('00000000-0000-0000-0000-000000000021','quantitative','arithmetic','number_properties_divisibility','خصائص الأعداد وقابلية القسمة',2),
('00000000-0000-0000-0000-000000000022','quantitative','arithmetic','mental_math_estimation','الحساب الذهني والتقدير',2),

-- Fractions
('00000000-0000-0000-0000-000000000023','quantitative','fractions','operations_add_sub','جمع وطرح الكسور',1),
('00000000-0000-0000-0000-000000000024','quantitative','fractions','operations_mul_div','ضرب وقسمة الكسور',2),
('00000000-0000-0000-0000-000000000025','quantitative','fractions','comparison_ordering','مقارنة وترتيب الكسور',2),

-- Decimals
('00000000-0000-0000-0000-000000000026','quantitative','decimals','conversion_fraction_decimal','التحويل بين الكسور والأعداد العشرية',2),
('00000000-0000-0000-0000-000000000027','quantitative','decimals','operations','العمليات على الأعداد العشرية',1),

-- Percentages
('00000000-0000-0000-0000-000000000028','quantitative','percentages','basic_percentage_calculation','حساب النسبة المئوية الأساسي',2),
('00000000-0000-0000-0000-000000000029','quantitative','percentages','percentage_change','نسبة الزيادة والنقصان',3),
('00000000-0000-0000-0000-000000000030','quantitative','percentages','reverse_percentage','إيجاد الأصل من النسبة',3),

-- Ratios & Proportions
('00000000-0000-0000-0000-000000000031','quantitative','ratios_and_proportions','direct_proportion','التناسب الطردي',2),
('00000000-0000-0000-0000-000000000032','quantitative','ratios_and_proportions','inverse_proportion','التناسب العكسي',3),
('00000000-0000-0000-0000-000000000033','quantitative','ratios_and_proportions','dividing_in_a_ratio','تقسيم كمية حسب نسبة',2),

-- Algebra
('00000000-0000-0000-0000-000000000034','quantitative','algebra','linear_equations','حل المعادلات الخطية',2),
('00000000-0000-0000-0000-000000000035','quantitative','algebra','quadratic_equations','حل المعادلات التربيعية',3),
('00000000-0000-0000-0000-000000000036','quantitative','algebra','inequalities','حل المتباينات',3),
('00000000-0000-0000-0000-000000000037','quantitative','algebra','sum_product_of_roots','مجموع وحاصل ضرب الجذور',4),

-- Exponents & Roots
('00000000-0000-0000-0000-000000000038','quantitative','exponents_and_roots','exponent_rules','قوانين الأسس',2),
('00000000-0000-0000-0000-000000000039','quantitative','exponents_and_roots','sign_behavior_by_region','سلوك الإشارة حسب فئة العدد (موجب/سالب/كسري)',3),
('00000000-0000-0000-0000-000000000040','quantitative','exponents_and_roots','radical_simplification','تبسيط الجذور',3),

-- Geometry
('00000000-0000-0000-0000-000000000041','quantitative','geometry','angles_and_triangles','الزوايا والمثلثات',2),
('00000000-0000-0000-0000-000000000042','quantitative','geometry','area_and_perimeter','المساحة والمحيط',2),
('00000000-0000-0000-0000-000000000043','quantitative','geometry','volume_3d_shapes','حجوم المجسمات',3),
('00000000-0000-0000-0000-000000000044','quantitative','geometry','coordinate_geometry','الهندسة الإحداثية',3),

-- Statistics
('00000000-0000-0000-0000-000000000045','quantitative','statistics','mean_median_mode','الوسط والوسيط والمنوال',1),
('00000000-0000-0000-0000-000000000046','quantitative','statistics','range_and_spread','المدى والتشتت',2),

-- Probability
('00000000-0000-0000-0000-000000000047','quantitative','probability','basic_probability','الاحتمال الأساسي',2),
('00000000-0000-0000-0000-000000000048','quantitative','probability','compound_events','الأحداث المركبة',3),

-- Quantitative Comparison
('00000000-0000-0000-0000-000000000049','quantitative','quantitative_comparison','simplify_by_difference','التبسيط بالفرق بدل الجمع',2),
('00000000-0000-0000-0000-000000000050','quantitative','quantitative_comparison','critical_values_testing','اختبار القيم الحرجة',3),
('00000000-0000-0000-0000-000000000051','quantitative','quantitative_comparison','squaring_validity_check','التحقق من صحة التربيع لطرفي المقارنة',3),

-- Data Interpretation
('00000000-0000-0000-0000-000000000052','quantitative','data_interpretation','reading_charts_and_tables','قراءة الرسوم والجداول',2),
('00000000-0000-0000-0000-000000000053','quantitative','data_interpretation','percentage_change_from_data','حساب التغير النسبي من بيانات',3),

-- Multi-step Word Problems
('00000000-0000-0000-0000-000000000054','quantitative','multi_step_word_problems','rate_time_distance','مسائل السرعة والزمن والمسافة',3),
('00000000-0000-0000-0000-000000000055','quantitative','multi_step_word_problems','multi_step_percentage_profit','مسائل الربح والخصم متعددة الخطوات',3),
('00000000-0000-0000-0000-000000000056','quantitative','multi_step_word_problems','combined_proportional_reasoning','مسائل تجمع بين أكثر من نوع تناسب',4)
on conflict (section, category, subskill) do nothing;

-- ------------------------------------------------------------
-- PREREQUISITES (many-to-many)
-- Encodes the Discovery Report's own insight (§4.3): proportional
-- reasoning underlies percentages, ratios, probability, and word
-- problems simultaneously — so this is a graph, not a tree.
-- ------------------------------------------------------------

insert into skill_prerequisites (skill_id, prerequisite_skill_id) values

-- Verbal
('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001'), -- functional analogies need relationship ID first
('00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000001'), -- abstract analogies too
('00000000-0000-0000-0000-000000000005','00000000-0000-0000-0000-000000000004'), -- tone inference needs single-blank vocab first
('00000000-0000-0000-0000-000000000006','00000000-0000-0000-0000-000000000004'), -- double-blank needs single-blank first
('00000000-0000-0000-0000-000000000008','00000000-0000-0000-0000-000000000007'), -- inference needs main-idea extraction
('00000000-0000-0000-0000-000000000009','00000000-0000-0000-0000-000000000007'),
('00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000007'),
('00000000-0000-0000-0000-000000000012','00000000-0000-0000-0000-000000000011'), -- odd-one-out needs category matching first

-- Arithmetic → Fractions/Decimals foundations
('00000000-0000-0000-0000-000000000034','00000000-0000-0000-0000-000000000020'), -- linear equations need order of operations

-- Fractions/Decimals → Percentages (core proportional-reasoning chain)
('00000000-0000-0000-0000-000000000028','00000000-0000-0000-0000-000000000024'), -- basic % calc needs fraction mul/div
('00000000-0000-0000-0000-000000000026','00000000-0000-0000-0000-000000000025'), -- decimal conversion needs fraction comparison
('00000000-0000-0000-0000-000000000029','00000000-0000-0000-0000-000000000028'), -- % change needs basic % calc
('00000000-0000-0000-0000-000000000030','00000000-0000-0000-0000-000000000028'), -- reverse % needs basic % calc

-- Ratios & Proportions (the report's "core" proportional skill)
('00000000-0000-0000-0000-000000000031','00000000-0000-0000-0000-000000000024'), -- direct proportion needs fraction mul/div
('00000000-0000-0000-0000-000000000032','00000000-0000-0000-0000-000000000031'), -- inverse proportion builds on direct
('00000000-0000-0000-0000-000000000033','00000000-0000-0000-0000-000000000031'),

-- Algebra chain
('00000000-0000-0000-0000-000000000035','00000000-0000-0000-0000-000000000034'), -- quadratics need linear equations
('00000000-0000-0000-0000-000000000036','00000000-0000-0000-0000-000000000034'), -- inequalities need linear equations
('00000000-0000-0000-0000-000000000037','00000000-0000-0000-0000-000000000035'), -- sum/product of roots needs quadratics

-- Exponents & Roots chain (this is the −x² vs (−x)² misconception line from your own Discovery Report §3.3)
('00000000-0000-0000-0000-000000000039','00000000-0000-0000-0000-000000000038'), -- sign-behavior needs exponent rules
('00000000-0000-0000-0000-000000000040','00000000-0000-0000-0000-000000000038'), -- radical simplification needs exponent rules

-- Geometry chain
('00000000-0000-0000-0000-000000000043','00000000-0000-0000-0000-000000000042'), -- volume needs area/perimeter
('00000000-0000-0000-0000-000000000044','00000000-0000-0000-0000-000000000041'), -- coordinate geometry needs angles/triangles

-- Statistics / Probability chains
('00000000-0000-0000-0000-000000000046','00000000-0000-0000-0000-000000000045'), -- spread needs mean/median/mode
('00000000-0000-0000-0000-000000000048','00000000-0000-0000-0000-000000000047'), -- compound events need basic probability
('00000000-0000-0000-0000-000000000047','00000000-0000-0000-0000-000000000031'), -- probability needs direct proportion (part/whole reasoning)

-- Quantitative Comparison chain (mirrors your Lesson 0001 → 0002 sequence exactly)
('00000000-0000-0000-0000-000000000050','00000000-0000-0000-0000-000000000039'), -- critical-values testing needs sign-behavior-by-region
('00000000-0000-0000-0000-000000000050','00000000-0000-0000-0000-000000000034'), -- and linear equations
('00000000-0000-0000-0000-000000000051','00000000-0000-0000-0000-000000000049'), -- squaring-validity needs simplify-by-difference

-- Data Interpretation chain
('00000000-0000-0000-0000-000000000053','00000000-0000-0000-0000-000000000052'), -- % change from data needs chart-reading
('00000000-0000-0000-0000-000000000053','00000000-0000-0000-0000-000000000029'), -- and general % change

-- Multi-step Word Problems — where the proportional-reasoning threads converge
('00000000-0000-0000-0000-000000000054','00000000-0000-0000-0000-000000000032'), -- rate/time/distance needs inverse proportion
('00000000-0000-0000-0000-000000000055','00000000-0000-0000-0000-000000000028'), -- profit/discount needs basic %
('00000000-0000-0000-0000-000000000055','00000000-0000-0000-0000-000000000029'), -- and % change
('00000000-0000-0000-0000-000000000056','00000000-0000-0000-0000-000000000031'), -- combined reasoning needs direct proportion
('00000000-0000-0000-0000-000000000056','00000000-0000-0000-0000-000000000032'), -- and inverse proportion
('00000000-0000-0000-0000-000000000056','00000000-0000-0000-0000-000000000029') -- and % change
on conflict (skill_id, prerequisite_skill_id) do nothing;

-- ============================================================
-- Sanity check queries (run after seeding, not part of the seed itself)
-- ============================================================
-- select count(*) from skills;                     -- expect 44
-- select count(*) from skill_prerequisites;         -- expect 32
-- select s.name_ar, count(sp.prerequisite_skill_id) as prereq_count
--   from skills s left join skill_prerequisites sp on sp.skill_id = s.id
--   group by s.id, s.name_ar order by prereq_count desc;
