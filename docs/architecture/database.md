# Database

`database/02-schema.sql` (schema), `database/03-seed-skills.sql` (seed data),
`src/store/InMemoryStore.ts` / `src/store/PostgresStore.ts` (access layer)

## Two interchangeable stores, one interface

Every service (`missionInterviewService`, `diagnosticService`,
`zpdSelector`, `lessonGeneratorService`, `learningRecordWriterService`,
`gamificationService`, etc.) is written against the same store interface, so
swapping the backing store is a one-line change at construction time:

- **`InMemoryStore`** — plain JS arrays/objects mirroring every table. Zero
  setup, resets on process restart. Used by default and by the test harness.
- **`PostgresStore`** — real queries against a Postgres/Supabase database via
  the [`pg`](https://node-postgres.com/) driver, matching the exact schema
  below. Selected automatically when `DATABASE_URL` is set (see
  `src/loadEnv.ts` and `httpServer.ts`'s startup logic).

## Schema (17 tables)

| Table | Purpose |
|---|---|
| `students` | one row per learner; `auth_user_id` links to Supabase Auth |
| `missions` | goal/timeline intake; **supersedable** — a new mission supersedes the old one rather than overwriting it, preserving history |
| `skills` | the 44-node curriculum graph (`section`, `category`, `base_difficulty`) |
| `skill_prerequisites` | the 32 prerequisite edges between skills |
| `resources` | trusted/community sources used for [AI grounding](grounded-ai-pipeline.md) (`kind`: knowledge vs. wisdom) |
| `sessions` | one row per diagnostic/lesson/practice/mock-exam attempt session |
| `learning_records` | the evidence ledger — mastery/misconception/goal-changed/prior-knowledge, **supersedable**, never mutated in place |
| `glossary_terms` | one canonical term per skill, auto-produced alongside lesson generation |
| `student_glossary_unlocks` | gates a glossary term's visibility to a student until they've actually mastered its skill |
| `lessons` | curated or generated lesson content (`review_status`: ai_generated → human_reviewed → published) |
| `practice_items` | MCQ items, validated (deterministic + independent-solver checks) before use |
| `attempts` | every individual answer a student submits |
| `srs_state` | SM-2-style spaced-repetition scheduling per student/skill |
| `student_sessions` | auth session tokens |
| `badges` | fixed badge catalog, seeded once at boot |
| `student_badge_unlocks` | the only real gamification storage — XP/level/streak are computed at read time, see [Dashboard](dashboard.md) |
| `notifications` | exam-date-driven reminders |

See `database/01-data-model-design.md` for the full rationale behind each
table, and `database/0{4-8}-*.md` for the design docs behind each of the six
pedagogy-engine services.

## Design principles worth knowing before extending the schema

- **Supersession over mutation.** `missions` and `learning_records` are both
  append-and-supersede: a new row marks the old one inactive rather than
  updating it, so history is never lost and "what did we believe and when"
  stays answerable.
- **Nullable `learning_records.skill_id`.** Needed specifically for
  `goal_changed` records, which aren't about any one skill.
- **Compiled views, not duplicated storage.** Gamification (XP/level/streak)
  and reference sheets are both computed from existing tables at read time
  rather than given their own storage — see [Dashboard](dashboard.md).
- **`gen_random_uuid()`** (via the `pgcrypto` extension) for every primary
  key — no client-generated or sequential IDs.

## Running against a real database

```bash
cp .env.example .env   # fill in DATABASE_URL (Supabase "Transaction pooler" URI)
npm run test-db         # verifies connectivity + seed counts
```

`npm run test-db` (`src/harness/testDbConnection.ts`) confirms the `skills`
table has the expected 44 rows and `skill_prerequisites` has 32, then prints
a few sample rows — the fastest way to confirm a fresh Supabase project is
correctly seeded before pointing the app at it.
