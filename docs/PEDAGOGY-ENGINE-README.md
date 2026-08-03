# Qudrat AI Tutor — Phase 1 Pedagogy Engine

Working code implementing the six pieces designed in `data-model/`, proving the
brief's Week 2-3 milestone end-to-end:
**mission → diagnostic → next-lesson → lesson → learning record**

No UI here — the brief is explicit that Phase 1 has none: *"prove the engine
works before dressing it."*

## Run it

```bash
npm install       # first time only
npm run harness    # runs the full end-to-end demo + writer assertions
npm run web        # starts a browser-based demo you can click through
```

`npm run web` starts a local server at http://localhost:3300 — open that in
your browser for a click-through Phase 2 MVP: mission interview → diagnostic →
lesson → dashboard (with a progress-arc view) → spaced-repetition practice
queue → full timed mock exam with review, all running against the same six
core services proven by the harness (mock LLM by default, no API key needed
to try it; real Claude generation once `ANTHROPIC_API_KEY` is set).

Or run the harness directly, if you have `tsx` globally installed already:
```bash
tsx src/harness/runTestHarness.ts
```

You should see 7 sections print (mission, diagnostic, ZPD selection, lesson
generation, simulated attempts, learning-record writer, final timeline),
followed by 4 writer assertions, all passing, and exit code 0.

## Project structure

```
src/
  types/index.ts                    -- every entity type, mirrors data-model/02-schema.sql exactly
  data/
    seedSkills.ts                   -- 44 skills + 32 prerequisites, TS translation of 03-seed-skills.sql
    seedDiagnosticBank.ts           -- placeholder diagnostic items (harness-only, not real content)
  store/
    InMemoryStore.ts                -- in-memory tables; swap for real Postgres/Supabase queries later
  llm/
    llmClient.ts                    -- LlmClient interface: AnthropicLlmClient (real) + MockLlmClient (offline demo)
  services/
    missionInterviewService.ts      -- FR-01, implements 06-mission-interview.md
    diagnosticService.ts            -- FR-02, implements 05-diagnostic-assessment.md
    zpdSelector.ts                  -- FR-03, implements 04-zpd-selector.md
    lessonGeneratorService.ts       -- FR-04, implements 07-lesson-generator.md
    learningRecordWriterService.ts  -- FR-05, implements 08-learning-record-writer.md (the most important file)
  harness/
    runTestHarness.ts               -- the 7-step proof + 4 assertions
  server/
    httpServer.ts                   -- minimal demo API (Node's built-in http, zero new deps)
public/
  index.html, style.css, app.js     -- Phase 2 MVP skeleton: mission, diagnostic, lesson, dashboard screens
```

## Going from this to a real backend

Three things change, nothing else:

1. **`InMemoryStore` → `PostgresStore`.** Already written — see `POSTGRES-MIGRATION.md`
   for the full step-by-step guide, environment setup, and known risk areas that still
   need testing against a real Supabase instance (this could not be done in the sandbox
   that produced this project — no network access there).
2. **`MockLlmClient` → `AnthropicLlmClient`.** Already implemented and ready —
   just set `ANTHROPIC_API_KEY` and pass `new AnthropicLlmClient()` instead of
   `new MockLlmClient()` wherever a service is constructed.
3. **The harness becomes an API layer.** Each service method
   (`conductInterview`, `startDiagnostic`, `selectNext`, `generateOrReuse`,
   `processSession`) is already the exact shape an Express/Next.js API route
   would call — the harness just calls them directly instead of over HTTP.

## What's genuinely still missing (Phase 2 scope, not yet built)

- **Real user accounts** — this demo runs one hardcoded student with no login.
  Real accounts need Supabase Auth wired to `PostgresStore` (see
  `POSTGRES-MIGRATION.md`), which requires your own live Supabase project.
- **Live Postgres verification** — `PostgresStore.ts` is written and matches
  the tested schema, and has now been confirmed connecting successfully
  against a live Supabase instance. Some write paths (glossary unlocks, etc.)
  are written but not yet exercised against the live database — test
  thoroughly before relying on it for anything real.
- **Full-scale item bank** — the diagnostic (12 items) and mock exam (20 items)
  are both scaled down from the brief's ~30/~120 for demo speed and API cost;
  the sampling logic itself already supports the full counts, it's one number
  to change in `diagnosticService.ts` / `mockExamService.ts` when ready.
- **Parent/guardian progress summary (FR-13, "Could" priority)** — not started.

## What's new since the original MVP skeleton

- **Spaced-repetition practice queue (FR-06)** — real SM-2-style scheduling
  (`services/srsService.ts`): correct answers expand the review interval,
  a lapse resets it to 1 day, exactly per the brief's own quality-bar wording.
  Initializes automatically the moment a skill reaches `mastery`.
- **Full mock exam mode (FR-07)** — timed (client-side countdown, scaled to
  match the scaled-down item count), samples across the whole taxonomy
  (not just entry-point skills like the diagnostic), and produces a full
  per-question review after submission — no mid-exam feedback, matching how
  a real exam works.
- **Resource-grounded lesson generation** — `data/seedResources.ts` loads real,
  previously-identified trusted sources (ETEC's own pages, cited in the
  Discovery Report) and the lesson generator's prompt now explicitly forbids
  stating any exam-specific fact not traceable to one of them.
- **Retry + fallback on validation failure** — if a real model's independent-
  solver check disagrees with too many generated items, the pipeline retries
  (up to 2x) before falling back to deterministic-only checks, so a lesson is
  never silently empty.
- **`verify-progression` script** (`npm run verify-progression`) — proves the
  ZPD selector genuinely moves to a new skill each round (not stuck repeating
  one) across a simulated 3-lesson sequence, and now also confirms reference
  sheets compile correctly from real mastered-skill lesson content.
- **Reference sheets (FR-10)** — auto-compiled from lesson content the
  student has already earned through mastery, grouped by category. No new
  LLM calls: it aggregates `lessons.concept_explanation` for every mastered
  skill, so the sheet is guaranteed consistent with what was actually taught
  (`services/referenceSheetService.ts`).
- **Auto-maintained glossary (FR-08)** — every generated lesson now also
  produces one canonical glossary term for its skill (`services/lessonGeneratorService.ts`),
  stored once and reused across students. A term only becomes visible to a
  given student once she actually has a `mastery` learning_record for that
  skill — never added speculatively, per `GLOSSARY-FORMAT.md`'s own rule.
- **Curated resources page (FR-11)** — surfaces the same trusted-source data
  used to ground lesson generation, so the student can see where facts come from.
- **Ask-the-teacher chat (FR-12)** — grounded free-form Q&A, and the final
  learning-record type (`prior_knowledge_revealed`) that depended on this
  feature is now implemented: if a student explicitly discloses she already
  knew a concept before it was taught, a tentative record is written
  (`services/askTeacherService.ts`). False positives are treated as worse
  than misses — the model is instructed to only flag explicit, specific claims.


- `prior_knowledge_revealed` learning records are **not implemented** — they
  depend on the Ask-the-Teacher chat feature (FR-12), which is Phase 2+.
  See `data-model/08-learning-record-writer.md` §2.3.
- The independent-solver validation step in the lesson generator uses a
  lookup table in `MockLlmClient` rather than real reasoning — swapping to
  `AnthropicLlmClient` makes this a genuine independent solve.
- Diagnostic score is raw percentage, explicitly flagged as uncalibrated
  against the real Qudrat 0–100 norm-referenced scale — see
  `data-model/05-diagnostic-assessment.md` §5, open question 1.
