-- ============================================================
-- Qudrat AI Tutor — Phase 1 Pedagogy Engine
-- PostgreSQL / Supabase schema
-- Companion to 01-data-model-design.md — read that first for rationale.
--
-- Rev 2: incorporates two addenda surfaced during design of later
-- pieces (06-mission-interview.md §5, 08-learning-record-writer.md §6):
--   - missions.needs_followup added
--   - learning_records.skill_id made nullable (for goal_changed records)
-- ============================================================

create extension if not exists "pgcrypto"; -- for gen_random_uuid()

-- ------------------------------------------------------------
-- 1. students
-- ------------------------------------------------------------
create table students (
    id                     uuid primary key default gen_random_uuid(),
    display_name           text not null,
    auth_user_id           uuid not null unique,
    locale                 text not null default 'ar',
    grade_level            smallint,
    parental_consent_at    timestamptz,
    created_at             timestamptz not null default now()
);

-- ------------------------------------------------------------
-- 2. missions  (supersedable — see design doc §3.2)
-- ------------------------------------------------------------
create table missions (
    id                          uuid primary key default gen_random_uuid(),
    student_id                  uuid not null references students(id) on delete cascade,
    target_university           text,
    target_program              text,
    target_score                smallint not null check (target_score between 0 and 100),
    exam_date                   date not null,
    weekly_study_hours          numeric not null check (weekly_study_hours >= 0),
    current_level_self_report   text,
    success_criteria            jsonb not null default '[]',
    constraints                 jsonb not null default '{}',
    out_of_scope                text,
    status                      text not null default 'active' check (status in ('active','superseded')),
    superseded_by               uuid references missions(id),
    needs_followup              boolean not null default false, -- set true if interview exited without all required fields confirmed (06-mission-interview.md §5)
    created_at                  timestamptz not null default now()
);

create index idx_missions_student_active
    on missions(student_id)
    where status = 'active';

-- ------------------------------------------------------------
-- 3. skills (syllabus graph)
-- ------------------------------------------------------------
create table skills (
    id              uuid primary key default gen_random_uuid(),
    section         text not null check (section in ('verbal','quantitative')),
    category        text not null,
    subskill        text not null,
    name_ar         text not null,
    base_difficulty smallint not null check (base_difficulty between 1 and 5),
    created_at      timestamptz not null default now(),
    unique (section, category, subskill)
);

create table skill_prerequisites (
    skill_id              uuid not null references skills(id) on delete cascade,
    prerequisite_skill_id uuid not null references skills(id) on delete cascade,
    primary key (skill_id, prerequisite_skill_id),
    check (skill_id <> prerequisite_skill_id)
);

-- ------------------------------------------------------------
-- 4. resources
-- ------------------------------------------------------------
create table resources (
    id              uuid primary key default gen_random_uuid(),
    title           text not null,
    url             text,
    kind            text not null check (kind in ('knowledge','wisdom')),
    annotation      text not null,
    verified_at     date not null,
    is_official_etec boolean not null default false,
    created_at      timestamptz not null default now()
);

-- ------------------------------------------------------------
-- 5. sessions (needs to exist before learning_records references it)
-- ------------------------------------------------------------
create table sessions (
    id              uuid primary key default gen_random_uuid(),
    student_id      uuid not null references students(id) on delete cascade,
    session_type    text not null check (session_type in ('diagnostic','lesson','practice','mock_exam')),
    lesson_id       uuid, -- FK added after lessons table exists
    started_at      timestamptz not null default now(),
    completed_at    timestamptz,
    score_estimate  numeric
);

-- ------------------------------------------------------------
-- 6. learning_records (supersedable, evidence-typed)
-- ------------------------------------------------------------
create table learning_records (
    id                  uuid primary key default gen_random_uuid(),
    student_id          uuid not null references students(id) on delete cascade,
    skill_id            uuid references skills(id), -- nullable: goal_changed records are mission-level, not skill-level (08-learning-record-writer.md §2.4)
    record_type         text not null check (
        record_type in ('mastery','misconception_corrected','prior_knowledge_revealed','goal_changed')
    ),
    evidence            text not null,
    source_session_id   uuid references sessions(id),
    confidence          text not null default 'tentative' check (confidence in ('tentative','confirmed')),
    status              text not null default 'active' check (status in ('active','superseded')),
    superseded_by       uuid references learning_records(id),
    created_at          timestamptz not null default now()
);

create index idx_learning_records_student_active
    on learning_records(student_id, skill_id)
    where status = 'active';

-- ------------------------------------------------------------
-- 7. glossary_terms + student_glossary_unlocks
-- ------------------------------------------------------------
create table glossary_terms (
    id                  uuid primary key default gen_random_uuid(),
    term_ar             text not null,
    definition_ar       text not null,
    aliases_to_avoid    text[] not null default '{}',
    skill_id            uuid references skills(id),
    created_at          timestamptz not null default now()
);

create table student_glossary_unlocks (
    student_id                      uuid not null references students(id) on delete cascade,
    glossary_term_id                uuid not null references glossary_terms(id) on delete cascade,
    unlocked_via_learning_record_id uuid not null references learning_records(id),
    unlocked_at                     timestamptz not null default now(),
    primary key (student_id, glossary_term_id)
);

-- ------------------------------------------------------------
-- 8. lessons
-- ------------------------------------------------------------
create table lessons (
    id                          uuid primary key default gen_random_uuid(),
    skill_id                    uuid not null references skills(id),
    title_ar                    text not null,
    concept_explanation         jsonb not null,
    worked_example              jsonb not null,
    difficulty_level            smallint not null check (difficulty_level between 1 and 5),
    generation_prompt_version   text not null,
    review_status               text not null default 'ai_generated' check (
        review_status in ('ai_generated','human_reviewed','published','rejected')
    ),
    created_at                  timestamptz not null default now(),
    -- Version 6 Phase O: additive, nullable — the structured-content-block
    -- shape (an ordered array of {sectionType, component, title, body,
    -- visual, parameters}) described in 07-lesson-generator.md §6. NULL means
    -- "render via the legacy concept_explanation/worked_example path," so
    -- every existing row is unaffected. Applied live via `alter table lessons
    -- add column if not exists sections jsonb` — no backfill needed.
    sections                    jsonb
);

alter table sessions
    add constraint fk_sessions_lesson
    foreign key (lesson_id) references lessons(id);

-- ------------------------------------------------------------
-- 9. practice_items
-- ------------------------------------------------------------
create table practice_items (
    id                      uuid primary key default gen_random_uuid(),
    skill_id                uuid not null references skills(id),
    lesson_id               uuid references lessons(id),
    stem_ar                 text not null,
    options                 jsonb not null, -- array of 4 strings, equal length
    correct_option_index    smallint not null check (correct_option_index between 0 and 3),
    explanation_ar          text not null,
    difficulty_level        smallint not null check (difficulty_level between 1 and 5),
    validation_status       text not null default 'pending' check (
        validation_status in ('pending','passed','failed')
    ),
    validation_checks       jsonb not null default '{}',
    created_at              timestamptz not null default now()
);

create index idx_practice_items_skill_validated
    on practice_items(skill_id)
    where validation_status = 'passed';

-- Engineering review P0-4: the application layer's "reuse instead of
-- regenerate" logic (diagnosticService.ts, mockExamService.ts) is a
-- check-then-insert pattern with an `await` (the LLM call) between the
-- check and the write. Under concurrency this is a real race condition —
-- it was structurally the same bug that caused diagnostic item counts to
-- multiply across repeated attempts. This partial unique index is the
-- actual fix: it makes a second concurrent insert for the same skill's
-- item-bank entry (lesson_id is null) fail at the database level instead
-- of silently succeeding as a duplicate. Lesson-linked items are exempt
-- (lesson_id not null) since a lesson intentionally has multiple items,
-- and multiple lessons can exist per skill across difficulty levels.
create unique index idx_practice_items_one_bank_item_per_skill
    on practice_items(skill_id)
    where lesson_id is null and validation_status = 'passed';

-- ------------------------------------------------------------
-- 10. attempts
-- ------------------------------------------------------------
create table attempts (
    id                      uuid primary key default gen_random_uuid(),
    session_id              uuid not null references sessions(id) on delete cascade,
    student_id              uuid not null references students(id) on delete cascade,
    practice_item_id        uuid not null references practice_items(id),
    selected_option_index   smallint not null check (selected_option_index between 0 and 3),
    is_correct              boolean not null,
    response_time_ms        integer not null check (response_time_ms >= 0),
    attempted_at            timestamptz not null default now()
);

create index idx_attempts_student_item on attempts(student_id, practice_item_id);

-- ------------------------------------------------------------
-- 11. srs_state (spaced repetition, one row per student per skill)
-- ------------------------------------------------------------
create table srs_state (
    student_id      uuid not null references students(id) on delete cascade,
    skill_id        uuid not null references skills(id) on delete cascade,
    ease_factor     numeric not null default 2.5,
    interval_days   integer not null default 1,
    repetitions     integer not null default 0,
    next_review_at  date not null default current_date,
    last_result     text check (last_result in ('correct','lapsed')),
    updated_at      timestamptz not null default now(),
    primary key (student_id, skill_id)
);

create index idx_srs_due on srs_state(student_id, next_review_at);

-- ============================================================
-- End of Phase 1 schema.
-- ============================================================

-- ============================================================
-- Product-experience redesign additions (additive only — no existing
-- table's meaning changes). Rev: adds real lightweight auth, an
-- in-app notification center, and a badge/achievement catalog.
-- Gamification (XP, level, streak, mastery-by-topic, weak topics,
-- study history) is DELIBERATELY not modeled here — it's computed at
-- read time from tables that already exist (attempts, sessions,
-- learning_records, skills), same "compiled view" philosophy
-- referenceSheetService.ts already uses. See gamificationService.ts /
-- studentProfileService.ts.
-- ============================================================

-- ------------------------------------------------------------
-- 12. auth: email/password on students (nullable — demo students
-- created without registering stay valid), + session tokens.
-- ------------------------------------------------------------
alter table students add column email text unique;
alter table students add column password_hash text;

create table student_sessions (
    token       uuid primary key default gen_random_uuid(),
    student_id  uuid not null references students(id) on delete cascade,
    created_at  timestamptz not null default now(),
    expires_at  timestamptz not null
);

create index idx_student_sessions_student on student_sessions(student_id);

-- ------------------------------------------------------------
-- 13. badges (catalog) + student_badge_unlocks (join) — mirrors the
-- existing glossary_terms / student_glossary_unlocks pattern, but
-- source_type/source_id generalizes provenance instead of forcing a
-- single non-null FK, since streak/exam-completion unlocks have no
-- single learning_record behind them the way glossary unlocks always do.
-- ------------------------------------------------------------
create table badges (
    id              uuid primary key default gen_random_uuid(),
    code            text not null unique,
    title_ar        text not null,
    description_ar  text not null,
    icon            text not null,
    category        text not null check (category in ('mastery','streak','practice','exam','milestone')),
    created_at      timestamptz not null default now()
);

create table student_badge_unlocks (
    student_id   uuid not null references students(id) on delete cascade,
    badge_id     uuid not null references badges(id) on delete cascade,
    source_type  text not null check (source_type in ('learning_record','session','streak','manual')),
    source_id    uuid,
    unlocked_at  timestamptz not null default now(),
    primary key (student_id, badge_id)
);

-- ------------------------------------------------------------
-- 14. notifications (in-app center). Reminder types are computed at
-- read time (see notificationService.ts) and persisted only once
-- actually surfaced, for read/unread tracking — not scheduled/pushed.
-- ------------------------------------------------------------
create table notifications (
    id               uuid primary key default gen_random_uuid(),
    student_id       uuid not null references students(id) on delete cascade,
    type             text not null check (
        -- Kept in sync by hand with every `type:` literal notificationService.ts
        -- emits (checkAndCreateReminders' six checks) — three of these
        -- ('skill_staleness','daily_challenge_ready','timing_trend') were added
        -- to the service without updating this constraint, so any student whose
        -- dashboard load reached one of them got a hard 500 on every
        -- GET /api/dashboard (an uncaught constraint violation crashed the
        -- whole request). Found live via a real 500 during the responsive audit.
        type in ('daily_reminder','exam_reminder','lesson_complete','revision_reminder','streak_reminder',
                 'skill_staleness','daily_challenge_ready','timing_trend')
    ),
    title_ar         text not null,
    body_ar          text not null,
    related_skill_id uuid references skills(id),
    is_read          boolean not null default false,
    created_at       timestamptz not null default now()
);

create index idx_notifications_student on notifications(student_id, created_at desc);

-- ------------------------------------------------------------
-- 15. gender-address preference (onboarding personalization). Nullable —
-- the app must never assume a gender before this is explicitly set, and
-- every AI prompt/static string defaults to neutral Arabic regardless of
-- whether this is set at all. Exists so a future pass could optionally
-- use gendered forms once a student has actually opted in.
-- ------------------------------------------------------------
alter table students add column gender text check (gender in ('male','female','unspecified'));

-- ------------------------------------------------------------
-- 16. Version 2: pre-authored hint/mistake/memory-tip bank on practice_items
-- (so hints stop requiring a live LLM call for curated skills — AI is only
-- used as a fallback for skills not yet in the curated batch, or when a
-- student explicitly asks to "explain differently"), and optional
-- daily/weekly study goals on students. All nullable/additive.
-- ------------------------------------------------------------
alter table practice_items add column hint_1_ar text;
alter table practice_items add column hint_2_ar text;
alter table practice_items add column common_mistake_ar text;
alter table practice_items add column memory_tip_ar text;
alter table practice_items add column wrong_answer_explanations jsonb;
alter table practice_items add column source text not null default 'ai_generated' check (source in ('curated','ai_generated'));

alter table students add column daily_goal_minutes integer;
alter table students add column weekly_goal_lessons integer;
