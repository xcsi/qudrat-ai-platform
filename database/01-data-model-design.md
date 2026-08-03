# Qudrat AI Tutor — Phase 1 Data Model Design

**Purpose:** Port the /teach skill's file-based state (SKILL.md, MISSION.md, RESOURCES.md, learning-records/, GLOSSARY.md, lessons/) into a relational schema that the pedagogy engine's service layer can query and update. No UI in this phase — this model is the thing Phase 1 proves works, via a test harness (mission → diagnostic → next-lesson → lesson → learning record).

**Stack assumption (from Discovery Report):** PostgreSQL via Supabase.

---

## 1. Design Principles Carried Over From /teach

Before the tables, the rules that shaped every design decision below:

1. **Learning records are evidence, not activity logs.** A record is written only when the skill's four criteria are met (mastery, misconception correction, prior-knowledge disclosure, goal change). Most attempts produce *no* record. The schema must make "no record written" the default path, not an exception.
2. **Supersession, not deletion.** When understanding changes, the skill marks the old record `status: superseded by <new record>` rather than deleting it — preserving the learning history. Every mutable-truth table (`learning_records`, `missions`) needs this pattern.
3. **Resources are trusted, not assumed.** The model must never let generated content claim a fact without a traceable source, per RESOURCES-FORMAT.md's Knowledge/Wisdom split.
4. **Fluency ≠ storage strength.** Correctness in the same session an item was taught is a weak signal. The schema needs a first-class place to track spaced-repetition state per student per skill, separate from raw attempts.
5. **The syllabus is a graph, not a list.** The brief explicitly asks for "a syllabus graph of Qudrat question types and sub-skills" for the ZPD selector — proportional reasoning underlies percentages, ratios, and probability simultaneously, so prerequisites must support many-to-many, not a tree.

---

## 2. Entity Overview

| Table | Maps to /teach file | One-line purpose |
|---|---|---|
| `students` | — (new, product-only) | Minimal account record; PDPL-minimal PII |
| `missions` | `MISSION.md` | Why the student is studying, target score/date, constraints |
| `skills` | — (new; syllabus graph) | Qudrat question types & sub-skills, with prerequisites |
| `resources` | `RESOURCES.md` | Curated Knowledge/Wisdom sources, annotated |
| `learning_records` | `learning-records/*.md` | Evidence-gated proof of understanding, supersedable |
| `glossary_terms` | `GLOSSARY.md` | Canonical Arabic terminology, introduced on mastery |
| `student_glossary_unlocks` | — (join table) | Which student has "earned" which glossary term |
| `lessons` | `lessons/*.md` | Generated concept + worked example + practice set |
| `practice_items` | (part of lesson files) | Individual MCQ items, reusable across lessons/exams |
| `attempts` | — (new; raw signal) | Every answer a student submits, correct or not |
| `sessions` | — (new) | Groups attempts: diagnostic / lesson / practice / mock exam |
| `srs_state` | — (new; spaced repetition) | Per-student-per-skill review scheduling (SM-2-style) |

12 tables. Each is detailed below with fields, types, and the *why*.

---

## 3. Table-by-Table Detail

### 3.1 `students`
Minimal by design — NFR says no PII in model prompts and PDPL compliance.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid, PK | |
| `display_name` | text | First name or nickname only |
| `auth_user_id` | uuid | FK to Supabase Auth user |
| `locale` | text, default `'ar'` | |
| `grade_level` | smallint, nullable | e.g. 11, 12 |
| `parental_consent_at` | timestamptz, nullable | required if under 18, per §10 |
| `created_at` | timestamptz | |

### 3.2 `missions`
Direct port of MISSION-FORMAT.md. **Supersedable**, not editable-in-place — if a student changes her target score mid-program, the old mission row is closed, a new one opens. This mirrors the skill's own convention and preserves history for the ZPD selector to reason about ("her goal changed on day 12").

| Column | Type | Notes |
|---|---|---|
| `id` | uuid, PK | |
| `student_id` | uuid, FK | |
| `target_university` | text, nullable | |
| `target_program` | text, nullable | |
| `target_score` | smallint | 0–100 scale |
| `exam_date` | date | |
| `weekly_study_hours` | numeric | |
| `current_level_self_report` | text, nullable | student's own words at onboarding |
| `success_criteria` | jsonb | free-form list, as MISSION-FORMAT.md specifies |
| `constraints` | jsonb | e.g. "no study on Fridays" |
| `out_of_scope` | text, nullable | explicitly what NOT to teach (e.g. Tahsili) |
| `status` | text | `active` \| `superseded` |
| `superseded_by` | uuid, FK → `missions.id`, nullable | self-referencing |
| `created_at` | timestamptz | |

### 3.3 `skills` (the syllabus graph)
This is new relative to /teach's files — the skill assumes a human teacher already knows the curriculum graph; we have to encode it. Many-to-many prerequisites via a join table, because proportional reasoning (§4.3 of the Discovery Report) feeds percentages, ratios, *and* probability at once — a tree can't express that.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid, PK | |
| `section` | text | `verbal` \| `quantitative` |
| `category` | text | e.g. `quantitative_comparison`, `verbal_analogy` |
| `subskill` | text | e.g. `critical_values_testing`, `sign_of_negative_exponents` |
| `name_ar` | text | canonical Arabic name, consistent with glossary |
| `base_difficulty` | smallint | 1–5, author-assigned starting estimate |
| `created_at` | timestamptz | |

**`skill_prerequisites`** (join table): `skill_id`, `prerequisite_skill_id` — many-to-many, self-referencing on `skills`.

### 3.4 `resources`
Direct port of RESOURCES-FORMAT.md.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid, PK | |
| `title` | text | |
| `url` | text, nullable | |
| `kind` | text | `knowledge` \| `wisdom` |
| `annotation` | text | *when* to use it — required by the format, not optional |
| `verified_at` | date | last cross-check date, per the Discovery Report's own "ETEC wins" rule |
| `is_official_etec` | boolean | flags primary-source status for content-integrity checks |

### 3.5 `learning_records`
The heart of personalization. Evidence-gated, supersedable, and typed to the skill's four criteria — not a free-text log.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid, PK | |
| `student_id` | uuid, FK | |
| `skill_id` | uuid, FK | |
| `record_type` | text | `mastery` \| `misconception_corrected` \| `prior_knowledge_revealed` \| `goal_changed` |
| `evidence` | text | short description of *what happened* (e.g. "corrected −x² vs (−x)² after one miss, then got the retest right") |
| `source_session_id` | uuid, FK → `sessions.id` | traceability: which lesson/diagnostic produced this |
| `confidence` | text | `tentative` \| `confirmed` — a single correction is tentative until retested, matching Lesson 0002→0003 in your own Discovery Report |
| `status` | text | `active` \| `superseded` |
| `superseded_by` | uuid, FK → `learning_records.id`, nullable | |
| `created_at` | timestamptz | |

**Why no record on a perfect diagnostic score:** enforced in the service layer, not the schema — the write path only fires on one of the four `record_type`s, and "answered correctly" alone is not one of them. This is the exact distinction your Discovery Report's §3.5 flagged (no record after Lesson 0001 despite a perfect score).

### 3.6 `glossary_terms` + `student_glossary_unlocks`
Canonical terms live once (global); each student *unlocks* a term individually when she demonstrates understanding — mirroring "new terms are only added after the learner demonstrates understanding" while keeping terminology consistent product-wide (FR-08).

`glossary_terms`: `id`, `term_ar`, `definition_ar` (tight, per the skill's style), `aliases_to_avoid` (text[]), `skill_id` (FK, nullable), `created_at`.

`student_glossary_unlocks`: `student_id`, `glossary_term_id`, `unlocked_via_learning_record_id` (FK), `unlocked_at`. Composite PK on `(student_id, glossary_term_id)`.

### 3.7 `lessons`
Generated content, persisted and reusable — per §7's explicit instruction to *never* regenerate the same item live for every student.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid, PK | |
| `skill_id` | uuid, FK | |
| `title_ar` | text | |
| `concept_explanation` | jsonb | structured content blocks, not raw markdown, so the frontend can render consistently |
| `worked_example` | jsonb | |
| `difficulty_level` | smallint | |
| `generation_prompt_version` | text | which versioned prompt produced this (prompts are code, per §7) |
| `review_status` | text | `ai_generated` \| `human_reviewed` \| `published` \| `rejected` |
| `created_at` | timestamptz | |

### 3.8 `practice_items`
Standalone from lessons so the same item bank feeds lessons, practice queue, *and* mock exams (§8, Week 6).

| Column | Type | Notes |
|---|---|---|
| `id` | uuid, PK | |
| `skill_id` | uuid, FK | |
| `lesson_id` | uuid, FK, nullable | null if authored directly for the item bank / mock exam |
| `stem_ar` | text | |
| `options` | jsonb | array of 4, equal-length per the skill's quiz rule |
| `correct_option_index` | smallint | |
| `explanation_ar` | text | |
| `difficulty_level` | smallint | |
| `validation_status` | text | `pending` \| `passed` \| `failed` — gates the content-integrity pipeline (§6, sev-1 rule) |
| `validation_checks` | jsonb | e.g. `{"answer_key_ok": true, "option_length_parity": true}` |
| `created_at` | timestamptz | |

### 3.9 `sessions`
One row per diagnostic / lesson / practice-queue pass / mock exam — the unit the dashboard and ZPD selector reason about.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid, PK | |
| `student_id` | uuid, FK | |
| `session_type` | text | `diagnostic` \| `lesson` \| `practice` \| `mock_exam` |
| `lesson_id` | uuid, FK, nullable | set when `session_type = 'lesson'` |
| `started_at` | timestamptz | |
| `completed_at` | timestamptz, nullable | |
| `score_estimate` | numeric, nullable | only meaningful for `diagnostic` / `mock_exam` |

### 3.10 `attempts`
Raw signal — every single answer. Deliberately *not* the same as a learning record (principle #1 above).

| Column | Type | Notes |
|---|---|---|
| `id` | uuid, PK | |
| `session_id` | uuid, FK | |
| `student_id` | uuid, FK | denormalized for query speed |
| `practice_item_id` | uuid, FK | |
| `selected_option_index` | smallint | |
| `is_correct` | boolean | |
| `response_time_ms` | integer | feeds fluency-vs-storage-strength analysis |
| `attempted_at` | timestamptz | |

### 3.11 `srs_state`
Implements FR-06 explicitly: "an item answered correctly today reappears at an expanding interval, and a lapse resets it." One row per student per skill (not per item — repetition scheduling operates at the sub-skill level so interleaving works across related items).

| Column | Type | Notes |
|---|---|---|
| `student_id` | uuid, FK | |
| `skill_id` | uuid, FK | composite PK `(student_id, skill_id)` |
| `ease_factor` | numeric, default `2.5` | SM-2 style |
| `interval_days` | integer, default `1` | |
| `repetitions` | integer, default `0` | resets to 0 on a lapse |
| `next_review_at` | date | |
| `last_result` | text | `correct` \| `lapsed` |
| `updated_at` | timestamptz | |

---

## 4. How the ZPD Selector Reads This Model (preview for the next piece of work)

Rule-based v1, as the brief asks for ("start simple ... document how it could evolve"):

1. Pull `active` learning_records for the student, joined to `skills`.
2. Find skills with **no** active mastery record whose prerequisites (via `skill_prerequisites`) **are** mastered → candidate pool (this *is* the ZPD: reachable, not yet done).
3. Within the pool, prioritize any skill tied to a `misconception_corrected` record with `confidence = 'tentative'` — i.e., due for a retest (this is exactly what your own Lesson 0002 → 0003 sequence did).
4. Else, prioritize by `srs_state.next_review_at` due today, then by lowest `base_difficulty` among untouched skills.
5. Output: one `skill_id` + a one-sentence explanation string (FR-03 requires this be explainable to the student).

This will become its own design note once we get to that piece — flagging it now so the schema above is already shaped to support it.

---

## 5. Open Decisions to Confirm Before Writing the DDL

1. **Mock exam composition** — do we pull `practice_items` live per section proportionally (§8 wants ~120 mixed items), or pre-assemble fixed mock-exam forms as a `mock_exam_forms` table for consistency across students? (Recommend: pre-assembled forms, versioned — easier to guarantee validated, review-passed items only.)
2. **Glossary term ↔ skill**: one term per skill, or many terms per skill (likely many — e.g. `quantitative_comparison` skill unlocks 3–4 terms)? Schema above already allows many via nullable FK, just confirming intent.
3. **Parent/guardian summary (FR-13, "Could")** — if in scope, needs a `guardian_contacts` table; deferred for now unless you want it modeled up front.

Reply with any changes and I'll adjust before we lock the DDL.
