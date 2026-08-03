# Qudrat AI Tutor

An adaptive, AI-grounded tutoring engine for the quantitative and verbal
sections of the Saudi **Qudrat** (GAT) exam — built around a pedagogy engine
that tracks what a student has actually demonstrated (not just "seen"),
selects the next lesson inside their zone of proximal development, and
generates or reuses grounded lesson content through Claude.

> **Status:** working end-to-end demo (Phase 1 pedagogy engine + Phase 2/3
> browser MVP). See [`docs/IMPLEMENTATION-ROADMAP.md`](docs/IMPLEMENTATION-ROADMAP.md)
> for what's built vs. planned.

---

## Overview

Most exam-prep products track *coverage* ("did the student see this topic?").
Qudrat AI Tutor tracks **evidence**: a skill is only marked mastered when a
student answers the hardest discriminating item correctly at ≥80% accuracy in
a session, and every mastery/misconception claim is backed by a
`learning_record` row with real source data. That record is what drives
everything downstream — the next lesson, the spaced-repetition queue, the
glossary, the dashboard, and the reference sheets.

The system is organized around six core pieces:

1. **Mission interview** — a short conversational intake that captures the
   student's goal, timeline, and target score.
2. **Diagnostic assessment** — a short adaptive item set that produces a
   first, honestly-uncalibrated estimate of where the student stands.
3. **ZPD selector** — decides the single next-best skill to teach, using
   prerequisite mastery, spaced-repetition due dates, and retest priority.
4. **Lesson generator** — reuses curated/published lesson content when it
   exists, or generates a new grounded lesson (with an independent-solver
   validation pass) when it doesn't.
5. **Learning-record writer** — the only place mastery/misconception records
   get written, and only from real evidence (§ see
   [`docs/architecture/curriculum-system.md`](docs/architecture/curriculum-system.md)).
6. **Companion, dashboard, practice queue, mock exam, glossary, reference
   sheets** — the browser-facing layer built on top of the six services above.

## Features

- **Adaptive mission → diagnostic → lesson → practice loop**, ZPD-driven, not
  a fixed curriculum sequence.
- **Grounded AI generation** — every LLM call is assembled by a single
  `GroundingService` so exam-fact claims are traceable to trusted sources
  (never fabricated), and existing curated hints/explanations are never
  contradicted.
- **Reusable, data-driven lesson rendering** — a lesson is data (a set of
  typed sections), not hardcoded markup; new lessons never require new
  frontend code.
- **Hand-built visual learning engine** — number lines, geometry, bar/pie
  charts, fraction bars, equation balances, coordinate planes, timelines, and
  more, all inline SVG with zero charting dependencies.
- **A persistent companion ("قِيس")** with a mount lifecycle, contextual
  memory, and Arabic-first micro-copy — not a chat widget bolted onto the
  corner of every screen.
- **Spaced-repetition practice queue** (SM-2-style scheduling), **full timed
  mock exams**, **auto-compiled reference sheets**, and an **auto-maintained
  glossary** gated by actual mastery.
- **Swappable persistence layer** — the exact same service code runs against
  an `InMemoryStore` (zero setup, offline demo) or a real `PostgresStore`
  (Supabase-ready).
- **Swappable LLM layer** — `MockLlmClient` (deterministic, offline, free) vs.
  `AnthropicLlmClient` (real Claude calls) behind one interface.

## Screenshots

> Add real screenshots to [`docs/screenshots/`](docs/screenshots/) and
> reference them below before publishing. Placeholders:

| Dashboard | Lesson | Companion |
|---|---|---|
| `docs/screenshots/dashboard.png` | `docs/screenshots/lesson.png` | `docs/screenshots/companion.png` |

| Diagnostic | Mock Exam |
|---|---|
| `docs/screenshots/diagnostic.png` | `docs/screenshots/mock-exam.png` |

## Technologies used

- **Language:** TypeScript (backend/services), vanilla JavaScript (frontend,
  zero build step)
- **Runtime:** Node.js, [`tsx`](https://github.com/privatenumber/tsx) for
  direct TS execution (no bundler)
- **HTTP layer:** Node's built-in `http` module — no Express, zero extra
  server dependencies
- **Database:** PostgreSQL (Supabase-hosted), via the [`pg`](https://node-postgres.com/)
  driver; an in-memory store implementing the same interface for offline
  development
- **AI:** Anthropic Claude (`claude-sonnet-4-6`), via direct REST calls (no
  SDK dependency) — swappable for a deterministic mock client
- **Frontend:** hand-written HTML/CSS/JS, RTL-first (Arabic UI), inline SVG
  for all charts/diagrams — no framework, no build step

## System architecture

```
┌─────────────────────────────┐
│   public/ (browser client)  │  index.html, app.js, companion.js,
│                              │  lesson-renderer.js, Cards.js, visuals.js
└──────────────┬───────────────┘
               │ REST (JSON over HTTP)
┌──────────────▼───────────────┐
│   src/server/httpServer.ts   │  routing, auth, session resolution
└──────────────┬───────────────┘
               │
┌──────────────▼───────────────────────────────────────────┐
│                      src/services/                       │
│  missionInterviewService · diagnosticService · zpdSelector│
│  lessonGeneratorService · learningRecordWriterService     │
│  practiceService · mockExamService · srsService           │
│  gamificationService · notificationService · authService  │
│  askTeacherService · referenceSheetService                │
└──────┬──────────────────────────────────────┬─────────────┘
       │                                       │
┌──────▼──────────────┐              ┌─────────▼─────────────┐
│ src/llm/llmClient.ts │              │  src/store/            │
│ GroundingService     │              │  InMemoryStore /       │
│ (AnthropicLlmClient  │              │  PostgresStore         │
│  or MockLlmClient)   │              │  (Supabase-backed)     │
└──────────────────────┘              └────────────────────────┘
```

A rendered diagram (system flow + a full onboarding-to-lesson sequence
diagram) is at [`docs/diagrams/system-architecture.md`](docs/diagrams/system-architecture.md).

See [`docs/architecture/`](docs/architecture/) for a full deep dive into
every subsystem:

- [AI Architecture](docs/architecture/ai-architecture.md)
- [Grounded AI Pipeline](docs/architecture/grounded-ai-pipeline.md)
- [Lesson Rendering Engine](docs/architecture/lesson-rendering-engine.md)
- [Visual Learning Engine](docs/architecture/visual-learning-engine.md)
- [Companion (قِيس)](docs/architecture/companion.md)
- [Dashboard](docs/architecture/dashboard.md)
- [Curriculum System](docs/architecture/curriculum-system.md)
- [Database](docs/architecture/database.md)
- [API Flow](docs/architecture/api-flow.md)

### Grounded AI

Every LLM call in this app is assembled by one shared `GroundingService`
(`src/services/groundingService.ts`) rather than each service building its
own prompt context independently. `build({ skillId?, lessonId?,
practiceItemId? })` returns a block containing: (1) trusted-source citations
— only official/corroborating `resources` rows, never fabricated; (2) the
resolved lesson's own concept explanation and worked example, if relevant;
(3) the specific question's stem/answer/existing curated hints, if relevant;
followed by a fixed rule set that forbids any exam-fact claim not traceable
to a trusted source. Full write-up: [Grounded AI Pipeline](docs/architecture/grounded-ai-pipeline.md).

### Visual Learning Engine

`public/visuals.js` renders typed `VisualSpec` objects as hand-coded inline
SVG — number lines, geometry, bar/pie charts, fraction bars, percentage
grids, equation balances, coordinate planes, mind maps, and more — with zero
charting dependencies. Visuals are authored with real curated numbers, never
generated live; `Visuals.render(spec)` returns `null` for anything
unrecognized so callers fall back to text-only content instead of rendering
something fabricated. Full write-up: [Visual Learning Engine](docs/architecture/visual-learning-engine.md).

### Companion (قِيس)

A persistent, named companion (`public/companion.js`) — not a chat widget,
not a second AI backend. It has a real mount lifecycle (`enter(mode,
anchorSelector)` / `leave()`) so it can appear anchored near a lesson title
or exam timer instead of permanently occupying one corner, and a memory
object populated entirely from data the app already fetches (streaks, weak
skills, target score, recent mistakes). Every line is a template string built
from that memory — the one exception is `explainMistake()`, which can relay
an actual AI-generated explanation handed to it by its caller. Full
write-up: [Companion (قِيس)](docs/architecture/companion.md).

## Installation

Requires **Node.js 20+**.

```bash
git clone <your-repo-url>
cd qudrat-ai-tutor
npm install
```

## Configuration

Copy `.env.example` to `.env` and fill in real values. Both variables are
optional — the app runs fully offline with sensible defaults if neither is
set.

```bash
cp .env.example .env
```

| Variable | Required? | Purpose |
|---|---|---|
| `DATABASE_URL` | No | Postgres/Supabase connection string. Omit to run on the built-in in-memory store (resets on restart). |
| `ANTHROPIC_API_KEY` | No | Enables real Claude generation. Omit to run on `MockLlmClient` (deterministic, offline, free). |

Setting either variable swaps the corresponding layer at server startup
(`src/server/httpServer.ts`'s `main()`) — no code changes needed:

- `DATABASE_URL` set → `PostgresStore` (persists across restarts).
  Unset → `InMemoryStore` (resets on restart).
- `ANTHROPIC_API_KEY` set → `AnthropicLlmClient` (real Claude generation).
  Unset → `MockLlmClient` (deterministic, offline, free).

**Never commit `.env`** — it's gitignored (`.gitignore` blocks any `*.env`
file except `.env.example`). See `.env.example` for the exact shape
expected, and [Database](docs/architecture/database.md) /
[AI Architecture](docs/architecture/ai-architecture.md) for what each layer
does.

## Running locally

```bash
npm run web                 # starts the browser demo at http://localhost:3300
npm run harness              # runs the full end-to-end pipeline in the terminal
npm run verify-progression   # proves the ZPD selector advances correctly across rounds
npm run test-db              # verifies a configured DATABASE_URL is reachable and seeded
npm run typecheck            # tsc --noEmit
npm run build                # compiles src/ to dist/
```

`npm run web` works immediately with no configuration: no `DATABASE_URL`
means data resets on restart (in-memory store), and no `ANTHROPIC_API_KEY`
means lesson/question content comes from the deterministic mock LLM instead
of live Claude generation. Add either (or both) via `.env` to switch to
persistent storage and/or real AI generation.

## Folder structure

```
.
├── docs/                    # design docs, engineering review, roadmap
│   ├── architecture/         # subsystem deep-dives (see System architecture above)
│   ├── diagrams/              # mermaid architecture + sequence diagrams
│   └── screenshots/            # product screenshots for this README
├── database/                # schema.sql, seed SQL, and the data-model design docs
├── src/
│   ├── data/                 # seed data (skills, prerequisites, resources)
│   ├── harness/               # CLI scripts: end-to-end harness, DB test, golden-lesson author
│   ├── llm/                   # LLM client abstraction (Anthropic + mock)
│   ├── server/                 # HTTP server + all API route handlers
│   ├── services/                # the pedagogy engine's core services
│   ├── store/                    # InMemoryStore / PostgresStore (same interface)
│   └── types/                     # shared TypeScript types (mirrors the DB schema)
├── public/                  # browser client: HTML/CSS/vanilla JS, zero build step
├── assets/                  # standalone lesson-page assets (referenced by lessons/*.html)
├── lessons/                 # exported static HTML snapshots of curated "golden" lessons
└── learning-records/        # example learning-record output from real harness runs
```

## Future improvements

- Real user accounts via Supabase Auth (current demo runs a single hardcoded
  student).
- Full-scale item banks (diagnostic/mock-exam counts are currently scaled
  down for demo speed and API cost; the sampling logic already supports the
  full target counts).
- Calibrate the diagnostic score against the real Qudrat norm-referenced 0–100
  scale (currently an honestly-flagged raw percentage).
- Parent/guardian progress summary.
- Broader live-database test coverage for `PostgresStore` write paths.

## License

MIT — see [`LICENSE`](LICENSE).
