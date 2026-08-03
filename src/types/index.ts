// ============================================================
// Qudrat AI Tutor — Phase 1 Pedagogy Engine
// Type definitions mirroring database/02-schema.sql exactly.
// When this project moves to real Postgres/Supabase, these types
// stay the same — only store/InMemoryStore.ts gets swapped for a
// real DB-backed repository implementing the same interfaces.
// ============================================================

export type UUID = string;

export interface Student {
  id: UUID;
  display_name: string;
  auth_user_id: UUID;
  locale: string;
  grade_level: number | null;
  parental_consent_at: string | null; // ISO timestamp
  created_at: string;
  // Product-redesign addition: lightweight real auth (not the Supabase Auth
  // `auth_user_id` above, which stays reserved for that future migration).
  // Nullable — demo students created without registering stay valid.
  email: string | null;
  password_hash: string | null;
  // Onboarding gender-address preference — nullable/'unspecified' by design.
  // The app must never assume a gender before this is set; every AI prompt
  // and every static string defaults to neutral Arabic phrasing regardless.
  // This exists purely so a FUTURE pass could optionally use gendered forms
  // once a student has explicitly opted in, not something built this sprint.
  gender: 'male' | 'female' | 'unspecified' | null;
  // Version 2 addition: optional daily/weekly study goals, set from Settings.
  // Nullable — no goal set is a valid, common state, not an error.
  daily_goal_minutes: number | null;
  weekly_goal_lessons: number | null;
}

export interface StudentSession {
  token: UUID;
  student_id: UUID;
  created_at: string;
  expires_at: string;
}

export type MissionStatus = 'active' | 'superseded';

export interface Mission {
  id: UUID;
  student_id: UUID;
  target_university: string | null;
  target_program: string | null;
  target_score: number;
  exam_date: string; // ISO date
  weekly_study_hours: number;
  current_level_self_report: string | null;
  success_criteria: string[];
  constraints: Record<string, unknown>;
  out_of_scope: string | null;
  status: MissionStatus;
  superseded_by: UUID | null;
  needs_followup: boolean;
  created_at: string;
}

export type Section = 'verbal' | 'quantitative';

export interface Skill {
  id: UUID;
  section: Section;
  category: string;
  subskill: string;
  name_ar: string;
  base_difficulty: number; // 1-5
  created_at: string;
}

export interface SkillPrerequisite {
  skill_id: UUID;
  prerequisite_skill_id: UUID;
}

export type ResourceKind = 'knowledge' | 'wisdom';

export interface Resource {
  id: UUID;
  title: string;
  url: string | null;
  kind: ResourceKind;
  annotation: string;
  verified_at: string;
  is_official_etec: boolean;
}

export type SessionType = 'diagnostic' | 'lesson' | 'practice' | 'mock_exam';

export interface Session {
  id: UUID;
  student_id: UUID;
  session_type: SessionType;
  lesson_id: UUID | null;
  started_at: string;
  completed_at: string | null;
  score_estimate: number | null;
}

export type RecordType =
  | 'mastery'
  | 'misconception_corrected'
  | 'prior_knowledge_revealed'
  | 'goal_changed';

export type Confidence = 'tentative' | 'confirmed';
export type RecordStatus = 'active' | 'superseded';

export interface LearningRecord {
  id: UUID;
  student_id: UUID;
  skill_id: UUID | null; // nullable: goal_changed records are mission-level
  record_type: RecordType;
  evidence: string;
  source_session_id: UUID | null;
  confidence: Confidence;
  status: RecordStatus;
  superseded_by: UUID | null;
  created_at: string;
}

export interface GlossaryTerm {
  id: UUID;
  term_ar: string;
  definition_ar: string;
  aliases_to_avoid: string[];
  skill_id: UUID | null;
  created_at: string;
}

export interface StudentGlossaryUnlock {
  student_id: UUID;
  glossary_term_id: UUID;
  unlocked_via_learning_record_id: UUID;
  unlocked_at: string;
}

export type ReviewStatus = 'ai_generated' | 'human_reviewed' | 'published' | 'rejected';

// ============================================================
// Product-redesign addition (Phase 3, extended by the Educational
// Rendering Engine pass): visual learning components. Optional field,
// additive to the existing jsonb shape — a ConceptBlock or worked_example
// without a `visual` renders exactly as before (text-only). Visual specs
// are curated content authored/reviewed alongside the lesson text during
// the batch-seed pass, never generated live per-request (see
// public/visuals.js for the renderers, public/lesson-renderer.js for the
// dispatcher that turns this data into on-screen components).
// ============================================================
export type VisualSpec =
  | { type: 'number_line'; min: number; max: number; points: Array<{ value: number; label: string }> }
  | { type: 'geometry'; shape: 'rectangle' | 'triangle' | 'circle' | 'trapezoid'; labels: string[]; dimensions?: Record<string, number> }
  | { type: 'table'; headers: string[]; rows: string[][] }
  | { type: 'flow_diagram'; steps: string[] }
  | { type: 'bar_chart'; bars: Array<{ label: string; value: number }> }
  // Educational Rendering Engine additions — same "curated, never invented
  // live" contract as the five visuals above.
  | { type: 'fraction_bar'; numerator: number; denominator: number; label?: string }
  | { type: 'pie_fraction'; numerator: number; denominator: number; label?: string }
  | { type: 'percentage_grid'; percent: number; label?: string }
  | { type: 'comparison_bar'; left: { label: string; value: number }; right: { label: string; value: number } }
  | { type: 'mind_map'; root: string; branches: Array<{ label: string; children?: string[] }> }
  // Version 4 Phase F additions — same contract: curated parameters only,
  // never a live-computed number.
  | { type: 'equation_balance'; leftLabel: string; rightLabel: string; tilt?: 'left' | 'right' }
  | { type: 'coordinate_plane'; points: Array<{ x: number; y: number; label?: string }>; minX?: number; maxX?: number; minY?: number; maxY?: number }
  // Version 6 Phase M additions — closes the RatioCard/TimelineCard wishlist
  // gaps (ratio_bar was previously a dangling reference in visuals.js's own
  // CATEGORY_VISUAL_HINTS with no renderer behind it). Same contract.
  | { type: 'ratio_bar'; left: { label: string; value: number }; right: { label: string; value: number } }
  | { type: 'timeline'; events: Array<{ label: string; sublabel?: string }> };

export interface ConceptBlock {
  // 'principle'/'technique'/'caution' are the original three (still the
  // only ones any currently-published lesson uses). The Educational
  // Rendering Engine adds four more, each mapping to its own card
  // component in public/cards.js: 'rule' -> RuleCard, 'formula' ->
  // FormulaCard, 'mistake' -> CommonMistakeCard, 'memory_technique' ->
  // MemoryTechniqueCard. Purely additive — existing rows are unaffected.
  kind: 'principle' | 'technique' | 'caution' | 'rule' | 'formula' | 'mistake' | 'memory_technique';
  text_ar: string;
  visual?: VisualSpec;
}

// ============================================================
// Version 6 Phase O — the "Content Studio" content model. Formalizes the
// generic {sectionType, component, title, body, visual, parameters} shape
// public/lesson-renderer.js already documented and dispatched (COMPONENT_REGISTRY)
// but that no backend type/DB column/generator ever produced. An ordered
// array of these IS a lesson's teaching sequence — the rendering engine
// assembles it automatically by looking up `component` in COMPONENT_REGISTRY,
// so authoring a new lesson in this shape needs zero new frontend code as
// long as `component` names something already registered. See
// database/07-lesson-generator.md §6 for the full authoring contract.
// ============================================================
export interface LessonSection {
  // 'reflection' added by the Golden Lesson (a self-check gate between the
  // interactive activity and the summary, rendered via CheckpointCard) —
  // purely a categorization label, never dispatched on (rendering keys off
  // `component`), so this is additive and doesn't touch existing rows.
  sectionType: 'hero' | 'objective' | 'concept' | 'worked_example' | 'activity' | 'hint' | 'reflection' | 'summary';
  component: string; // a public/lesson-renderer.js COMPONENT_REGISTRY key
  title_ar?: string;
  body_ar?: string;
  // A VisualSpec type-name tag (e.g. "number_line"), NOT a nested VisualSpec
  // object — public/lesson-renderer.js's resolveVisual() assembles the real
  // spec at render time as `{ type: visual, ...parameters }`, matching how
  // the data-model doc's own worked example authors it. Put the remaining
  // VisualSpec fields (min/max/points, numerator/denominator, etc.) flat on
  // `parameters`; use `parameters.visualSpec` instead only when `parameters`
  // is already needed for a different curated shape (e.g. WorkedExample's
  // problem_ar/solution_steps_ar).
  visual?: VisualSpec['type'];
  parameters?: Record<string, unknown>; // component-specific curated data (never fabricated at render time)
}

export interface Lesson {
  id: UUID;
  skill_id: UUID;
  title_ar: string;
  concept_explanation: ConceptBlock[];
  worked_example: { problem_ar: string; solution_steps_ar: string[]; visual?: VisualSpec };
  difficulty_level: number;
  generation_prompt_version: string;
  review_status: ReviewStatus;
  created_at: string;
  // Version 6 Phase O: additive, optional — populated only for lessons
  // authored with the new structured content model (currently just the
  // Golden Lesson). undefined/empty means "render via the legacy
  // concept_explanation/worked_example path," exactly as before this sprint.
  sections?: LessonSection[];
}

export type ValidationStatus = 'pending' | 'passed' | 'failed';

export interface PracticeItem {
  id: UUID;
  skill_id: UUID;
  lesson_id: UUID | null;
  stem_ar: string;
  options: [string, string, string, string];
  correct_option_index: 0 | 1 | 2 | 3;
  explanation_ar: string;
  difficulty_level: number;
  validation_status: ValidationStatus;
  validation_checks: Record<string, boolean>;
  created_at: string;
  // Version 2 addition: a pre-authored hint/mistake/memory-tip bank, curated the
  // same way as lesson content (batch-seeded + human-reviewed), so hints stop
  // requiring a live LLM call for every request. All optional/nullable — existing
  // rows (and any skill not yet in the second curated batch) are unaffected and
  // keep falling back to live AI generation exactly as before.
  hint_1_ar: string | null;
  hint_2_ar: string | null;
  common_mistake_ar: string | null;
  memory_tip_ar: string | null;
  wrong_answer_explanations: Partial<Record<0 | 1 | 2 | 3, string>> | null;
  source: 'curated' | 'ai_generated';
}

export interface Attempt {
  id: UUID;
  session_id: UUID;
  student_id: UUID;
  practice_item_id: UUID;
  selected_option_index: 0 | 1 | 2 | 3;
  is_correct: boolean;
  response_time_ms: number;
  attempted_at: string;
}

export interface SrsState {
  student_id: UUID;
  skill_id: UUID;
  ease_factor: number;
  interval_days: number;
  repetitions: number;
  next_review_at: string; // ISO date
  last_result: 'correct' | 'lapsed' | null;
  updated_at: string;
}

// ============================================================
// Product-experience redesign — gamification + notifications.
// XP/level/streak/mastery-by-topic are NOT modeled here: they're
// computed at read time from the tables above (see
// gamificationService.ts / studentProfileService.ts). Only the badge
// catalog + unlock join and the notification log are real storage.
// ============================================================

export type BadgeCategory = 'mastery' | 'streak' | 'practice' | 'exam' | 'milestone';

export interface Badge {
  id: UUID;
  code: string;
  title_ar: string;
  description_ar: string;
  icon: string;
  category: BadgeCategory;
  created_at: string;
}

export type BadgeSourceType = 'learning_record' | 'session' | 'streak' | 'manual';

export interface StudentBadgeUnlock {
  student_id: UUID;
  badge_id: UUID;
  source_type: BadgeSourceType;
  source_id: UUID | null;
  unlocked_at: string;
}

export type NotificationType =
  | 'daily_reminder'
  | 'exam_reminder'
  | 'lesson_complete'
  | 'revision_reminder'
  | 'streak_reminder'
  // Version 5 Phase L additions — each grounded in data that already exists
  // (SRS state, due-queue, real per-attempt timing), never a generic nudge.
  | 'skill_staleness'
  | 'daily_challenge_ready'
  | 'timing_trend';

export interface AppNotification {
  id: UUID;
  student_id: UUID;
  type: NotificationType;
  title_ar: string;
  body_ar: string;
  related_skill_id: UUID | null;
  is_read: boolean;
  created_at: string;
}
