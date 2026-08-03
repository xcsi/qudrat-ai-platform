# Qudrat AI Tutor — Engineering Review
**Reviewer stance:** Staff Software Engineer, adversarial review. No compliments. Every claim below was verified against the actual code in this repository, not inferred from documentation.

**Scope reviewed:** `src/` (services, store, server, harness, llm), `public/` (HTML/CSS/JS), `data-model/` (schema + design docs), `.claude/` and `.agents/` skill directories, `MISSION.md` / `GLOSSARY.md` / `RESOURCES.md` / `NOTES.md`, `learning-records/`, `lessons/*.html`, `PEDAGOGY-ENGINE-README.md`, `POSTGRES-MIGRATION.md`.

---

## P0 — Critical

### P0-1. No authentication; the entire application is one hardcoded user
**Where:** `httpServer.ts`, `getOrCreateDemoStudent()`.
**Why it's a problem:** There is no login, no session, no per-request identity. Every request from every browser tab talks to the same single `demoStudentId` module-level variable. This isn't a missing feature at the edges — it's a load-bearing assumption baked into every service call (`missionService.conductInterview(student.id, ...)`, `writer.processSession(sessionId, student.id, ...)`) that only works because there is exactly one student, ever, per running process.
**Impact:** The app cannot serve two real students without them silently overwriting each other's mission, learning records, and dashboard. This is not a "Phase 2 polish item" — it's the difference between a demo and a product. Every architectural decision downstream (in-memory caching, session state for mission/ask-teacher conversations as module-level `let` variables) will need to be revisited once real auth exists, not just extended.
**Solution:** Supabase Auth (already provisioned) + a `student_id` derived from the verified JWT on every request, not a global variable. Conversation state (`missionConversation`, `askTeacherConversation`) needs to move from process-global strings to a per-session store (Redis, or a `conversations` table) keyed by student ID.
**Effort:** Large (3–5 days) — this is a genuine rewrite of the server's state model, not a bolt-on.

### P0-2. Unescaped LLM/user content injected via `innerHTML` — real XSS surface
**Where:** `public/app.js`, 19 separate `innerHTML` assignments, including lines rendering `block.text_ar`, `t.termAr`, `t.definitionAr`, `r.stemAr`, and lesson/glossary/reference-sheet content directly into the DOM with template literals.
**Why it's a problem:** This content originates from an LLM that is, in the ask-the-teacher flow, directly conditioned on raw student input (`conversationSoFar` includes the student's literal message). A student typing something like `<img src=x onerror=alert(1)>` as a "question" has a non-zero chance of getting it echoed back verbatim or reconstructed by the model in its reply, which is then written straight into `innerHTML` with zero escaping. Even without malicious intent, a model that ever emits HTML-like text (it has emitted raw LaTeX and Markdown despite explicit instructions not to, repeatedly, in this exact project) can break rendering or worse.
**Impact:** Stored/reflected XSS is a real classification here, not a theoretical one — the attack surface is "type a message," the lowest possible bar.
**Solution:** Replace every content-bearing `innerHTML` assignment with `textContent` for plain strings, or build DOM nodes explicitly (`createElement` + `textContent`) for the structured cases (concept blocks, glossary entries). If HTML structure is genuinely needed, sanitize with a real library (DOMPurify) — do not hand-roll escaping.
**Effort:** Medium (1 day) — mechanical but must touch every one of the 19 call sites and be tested per screen.

### P0-3. Skills table has no enforced idempotency; duplicate rows already exist in the live database and were never actually fixed
**Where:** `data-model/03-seed-skills.sql`, `skills` table definition in `02-schema.sql`.
**Why it's a problem:** The table has a `unique (section, category, subskill)` constraint, but the seed script uses plain `INSERT INTO skills (...) VALUES (...)` with no `ON CONFLICT DO NOTHING`. Running the seed twice against the same database — which is exactly what happened during this project's own setup — produces duplicate rows with different UUIDs but identical semantic content. This was observed directly (49 rows instead of 44) and the resolution was "truncate and re-seed once," which is a workaround, not a fix: the underlying script still has no protection against the same operator error happening again.
**Impact:** Duplicate skill rows are not cosmetic. They corrupt the `skill_prerequisites` graph (a duplicate skill has no incoming prerequisite edges pointing at *it*, so it's immediately "eligible" in the ZPD selector regardless of what the student has actually mastered), inflate diagnostic/mock-exam sampling pools, and were the direct root cause of one of the session's worst bugs (diagnostic item counts silently multiplying).
**Solution:** Add `ON CONFLICT (section, category, subskill) DO NOTHING` to every insert in `03-seed-skills.sql`. This is a two-line fix that was never applied even after the duplicate-row problem was directly observed and discussed.
**Effort:** Trivial (15 minutes) — the fact that this is still trivial and still unfixed is itself the finding.

### P0-4. "Reuse instead of regenerate" is enforced by an application-level check-then-insert with no database constraint — a real, already-triggered race condition class
**Where:** `diagnosticService.generateOneRealDiagnosticItem`, `mockExamService.ensureItemsForSkills`, `lessonGeneratorService.findReusableLesson`.
**Why it's a problem:** Every one of these "don't regenerate if one already exists" guards is: read (does an item exist for this skill?) → if not, call the LLM → write. Between the read and the write there is an `await` on a network call that can take seconds. `diagnosticService.generateRealDiagnosticItems` explicitly fires these checks in parallel via `Promise.all`. Two concurrent calls for the same skill will both see "no existing item" and both write — this is the textbook check-then-act race condition, and it is not hypothetical: it is structurally the same bug that caused item counts to multiply across repeated diagnostic starts, just at a smaller blast radius (per-skill instead of per-diagnostic-run).
**Impact:** Under any real concurrency — two students, or one student double-clicking, or a retried request — duplicate practice items get generated and stored, silently, with no error.
**Solution:** Either (a) a unique constraint on `practice_items (skill_id)` where `lesson_id is null` (partial unique index) with `ON CONFLICT DO NOTHING`, or (b) an application-level mutex/lock per skill during generation. The DB constraint is simpler and should be the first line of defense regardless of what the application layer does.
**Effort:** Small (2–3 hours) including a migration and a re-test of the affected services.

---

## P1 — High

### P1-1. `httpServer.ts` is a 453-line monolith with zero framework, zero middleware, zero input validation
**Where:** `src/server/httpServer.ts` — 18 handler functions, all in one file, hand-rolled routing via `if (req.method === 'POST' && ...)` chains.
**Why it's a problem:** There is no request validation anywhere. `readJsonBody` returns `{}` on empty input and every handler does `body.message ?? ''` or equivalent — a malformed or missing field is silently coerced into a default rather than rejected with a 400. There is no middleware layer (no logging middleware, no error-boundary middleware beyond one top-level `try/catch` in the router), and routing is string-matched by hand rather than declared.
**Impact:** This will not scale past its current 18 routes without becoming unmaintainable, and the lack of input validation means bad client data becomes bad application state silently rather than failing loudly at the boundary.
**Solution:** A real framework (Express/Fastify/Hono) with a schema validator (Zod) on every request body. This is exactly the kind of decision that's cheap now and expensive to retrofit once the route count doubles.
**Effort:** Medium (1–2 days) to migrate the existing 18 routes; the business logic underneath doesn't change.

### P1-2. Zero automated test coverage on the HTTP/API layer
**Where:** `src/harness/` contains `runTestHarness.ts` and `verifyProgression.ts`, both of which call *services* directly, never through HTTP.
**Why it's a problem:** Every bug found and fixed during this project's actual testing (the JSON-fence issue, the `\dfrac` gap, the diagnostic item duplication, the UUID type mismatch, the missing-hidden-attribute CSS regression) was caught by manual, human, live testing — not by any automated test. The service-level harness is genuinely good (it's the strongest part of this codebase), but it tests a layer that has never once been the source of a real bug in this project; the actual bugs all lived in the HTTP handlers, the LLM-response parsing, and the frontend — none of which have a single automated test.
**Impact:** Every future change to `httpServer.ts` or `app.js` has no regression safety net. The project has been shipping fixes purely on "the human tester will find it eventually."
**Solution:** Integration tests hitting the actual HTTP server (supertest-style) for every route, and at minimum snapshot/unit tests for `stripJsonFence` / `sanitizeMathText` given how many times those two functions specifically have been the source of production-visible bugs.
**Effort:** Medium (2–3 days) for a first meaningful pass covering the 18 routes and the two highest-risk pure functions.

### P1-3. Prompt engineering is ad hoc, unversioned in any real sense, and has no evaluation harness
**Where:** Every `*_SYSTEM_PROMPT` constant across `lessonGeneratorService.ts`, `diagnosticService.ts`, `mockExamService.ts`, `missionInterviewService.ts`, `askTeacherService.ts`.
**Why it's a problem:** The brief this project was built against explicitly says "prompts are code" and instructs keeping them in version control with a tracked version per generation. In practice, prompts are inline string literals with a single hardcoded `PROMPT_VERSION = 'v1'` constant that has never been incremented despite the prompts themselves being edited repeatedly during this session (the formatting rule, the grounding rule, and the LaTeX prohibition were all added *after* `v1` was set, with no version bump). There is no prompt eval suite — every prompt change in this project was validated by one human manually running the app once and eyeballing the output.
**Impact:** There is no way to know if a prompt change improves or regresses output quality except by manual spot-check, and the version field that exists for exactly this purpose (`lessons.generation_prompt_version`) is now lying — it says `v1` for lessons generated under at least three materially different prompt versions.
**Solution:** Move prompts to standalone files (as the design docs themselves recommended: `prompts/lesson-concept-v1.md` etc.), bump the version constant on every substantive prompt edit, and build even a minimal eval set (10–20 fixed skill/input pairs, re-run against every prompt change, diffed by a human).
**Effort:** Medium (1 day to extract + version; ongoing discipline after that, which is the harder part).

### P1-4. Sanitization is a reactive patchwork, not a designed system
**Where:** `llmClient.ts` — `stripJsonFence` and `sanitizeMathText`, both rewritten multiple times mid-session in response to specific screenshots of specific failures (fence-with-preamble, `\dfrac` vs `\frac`, `\f`/`\t` colliding with JSON escapes, real newlines getting mangled).
**Why it's a problem:** Every fix here was a targeted patch for one observed failure mode, discovered by a user pasting a broken screenshot — not a principled solution. The current implementation is a hardcoded list of ~30 known LaTeX command names (`LATEX_COMMANDS` array) that will silently fail to catch command #31 the first time the model uses one not on the list, producing the exact same class of bug that has already occupied a large fraction of this project's total debugging time.
**Impact:** This is structurally unbounded — regex-patching known LaTeX commands one at a time is a losing strategy against a model that can emit arbitrary LaTeX.
**Solution:** The actually correct fix is upstream, not downstream: constrain the model's output format at generation time via a stricter instruction plus a validation-and-retry loop that specifically checks for LaTeX/Markdown artifacts and re-prompts on detection (the retry infrastructure for validation failures already exists in `lessonGeneratorService` — this is the same pattern, just not applied to this failure mode), rather than trying to clean up arbitrary LaTeX after the fact with regex.
**Effort:** Medium (1 day) to add a "contains LaTeX/Markdown artifact" detector as one more validation check in the existing retry loop.

### P1-5. No cost controls or rate limiting on LLM calls
**Where:** Every route that calls `llm.complete(...)` — `handleMission`, `handleDiagnosticStart` (up to 12 parallel calls), `handleGenerateLesson` (up to 1 + 1 + 6 + retries calls per lesson), `handleMockExamStart` (up to 20 parallel calls), `handleAskTeacher`.
**Why it's a problem:** There is no per-student budget, no global rate limit, no circuit breaker. A student (or a script, or a bug in the frontend causing a retry loop) can call `/api/mock-exam/start` repeatedly and each call fires up to 20 real, billed API requests with no throttle.
**Impact:** Directly financial. This is not a hypothetical — this exact project already burned real API credits on a duplicate-generation bug (P0-4) that a rate limit or idempotency check would have caught immediately from the cost dashboard.
**Solution:** Per-student daily request budget tracked in the DB, enforced before any LLM call; a global rate limiter (even a simple in-memory token bucket) in front of the LLM client.
**Effort:** Small–Medium (1 day).

### P1-6. Three separate copies of the `/teach` skill exist in the repo with no indication which is authoritative
**Where:** `.claude/skills/qudrat-teach/`, `.claude/skills/teach/`, `.agents/skills/teach/` — all containing the same five files (`SKILL.md`, `MISSION-FORMAT.md`, `RESOURCES-FORMAT.md`, `GLOSSARY-FORMAT.md`, `LEARNING-RECORD-FORMAT.md`).
**Why it's a problem:** This is pure accumulated clutter from tool setup across the project's history, never cleaned up. Anyone opening this repo cold has no way to know which of the three is live, whether they've drifted apart, or whether editing one has any effect.
**Impact:** Low functional risk today (nothing in `src/` reads these at runtime), but it's a maintainability and onboarding tax, and a direct contradiction of the "prompts/methodology docs are code, keep them clean" principle the whole project claims to follow.
**Solution:** Delete two of the three, keep one, document which.
**Effort:** Trivial (30 minutes).

### P1-7. `PostgresStore` holds a full in-memory mirror of every table it touches — this does not scale past a demo
**Where:** `PostgresStore.ts` extends `InMemoryStore` and every read path (`store.skills.filter(...)`, `store.getActiveLearningRecords(...)`) operates on JS arrays hydrated once at startup and appended to on every write, never evicted.
**Why it's a problem:** This was a deliberate, documented tradeoff ("write-through cache... legitimate for modest data volume") — but "modest" here means the entire database's `learning_records`, `attempts`, and `sessions` tables grow unboundedly in every running process's memory for as long as the process lives, for every student who has ever used the app, not just the active ones.
**Impact:** This is fine for a single-digit-student demo and actively wrong as an architecture to build on for anything real — it directly contradicts the point of moving to Postgres at all, which was presumably to get real persistence and scale beyond in-memory limits.
**Solution:** Real read paths should query Postgres directly with proper `WHERE student_id = ?` filters, not filter an in-memory array of every student's data. This is a genuine rearchitecture of the store layer, not a tweak.
**Effort:** Large (3–4 days) — every service currently written against synchronous array-filtering methods (`getActiveLearningRecords`, `getPrerequisites`, etc.) would need to become async and per-student-scoped.

---

## P2 — Medium

### P2-1. Type safety is asserted, not verified, at every LLM response boundary
**Where:** `lessonGeneratorService.ts` and others cast parsed JSON directly to typed interfaces (`JSON.parse(...) as MissionExtraction`, `raw.options as [string, string, string, string]`) with no runtime schema check.
**Why it's a problem:** TypeScript types are compile-time only. A model response with 3 options instead of 4, or a `correct_option_index` of 7, passes straight through the type system and only fails (if at all) deep inside rendering logic, far from the actual point of failure.
**Solution:** Runtime validation (Zod) on every parsed LLM response, at the parse boundary, with a clear error rather than a downstream crash or silent misrender.
**Effort:** Medium (1 day) to add schemas for the ~6 distinct response shapes in use.

### P2-2. The dashboard presents an uncalibrated number as if it were a real score
**Where:** `handleDashboard`'s `current = baseline + masteredCount * 0.6` formula, documented in code comments as a placeholder but surfaced to the student as a bare percentage with no visible caveat.
**Why it's a problem:** The honesty about this number's limitations lives entirely in a code comment the student will never see. The product-facing claim ("your current estimated score is X%") is stronger than the underlying math supports, and nothing in the UI hedges it.
**Solution:** Either visibly label it as a rough estimate in the UI itself, or don't show a specific number until real calibration data exists.
**Effort:** Small (a few hours for the UI copy change; the real fix — actual calibration — is out of scope until pilot data exists).

### P2-3. Inconsistent API casing convention between backend and frontend
**Where:** Some endpoints return camelCase (`scoreEstimate`, `isCorrect`), others pass through raw DB snake_case fields directly (`stem_ar`, `correct_option_index`) with no mapping layer.
**Why it's a problem:** There's no single rule a new contributor could learn once and apply everywhere; the API contract has to be memorized field-by-field.
**Solution:** Pick one convention (camelCase is more idiomatic for a JS/TS API) and add a thin serialization layer at the HTTP boundary.
**Effort:** Small–Medium (a few hours, mechanical, but touches every response shape).

### P2-4. CSS color values duplicated as raw hex instead of referencing the design tokens that already exist
**Where:** `#EAF4F2` and `#FBEEEC` each appear hardcoded in 4–5 separate rules in `style.css`, despite `:root` already defining `--teal` and `--coral` as the base colors these are tinted from.
**Why it's a problem:** These are clearly meant to be "light tint of teal" / "light tint of coral" but are hand-picked hex values with no relationship encoded to the base palette — changing the brand teal requires manually finding and updating 4+ separate hardcoded values that will silently drift out of sync.
**Solution:** Define `--teal-tint` / `--coral-tint` custom properties once, reference everywhere.
**Effort:** Trivial (30 minutes).

### P2-5. Frontend has no build step, no bundler, no client-side type checking
**Where:** `public/app.js` — 656 lines, one IIFE, plain script tag, no TypeScript.
**Why it's a problem:** Every class of bug that TypeScript exists to catch on the backend (the `NAV_MAP` typo class, undefined-variable-at-runtime, wrong-shape-object-passed-to-function) has zero compile-time protection on the client, where roughly half of this project's actual bugs were found (the bottom-nav visibility regression, the chat layout issue).
**Solution:** At minimum, a lightweight bundler (esbuild/Vite) with the client code also in TypeScript, even without a framework.
**Effort:** Medium (1 day to set up tooling + convert existing JS to TS incrementally).

### P2-6. No structured logging or observability
**Where:** 61 separate `console.log`/`console.warn`/`console.error` calls across `src/`, no log levels, no request IDs, no correlation between a logged warning and the request that triggered it.
**Why it's a problem:** When the diagnostic item generation silently fails and falls back to a placeholder (a real, designed code path — `console.error` in `diagnosticService.ts`), there is no way to see this happening in aggregate or trace it back to which student/session hit it, short of watching the terminal live.
**Solution:** A real logging library (pino) with levels and structured fields (student ID, session ID, route) at minimum.
**Effort:** Medium (1 day).

---

## P3 — Nice to have

### P3-1. Mock-mode content is too repetitive to demo credibly
Every skill's mock-generated glossary term is identical ("المقارنة الكمية...") regardless of the actual skill, because `MockLlmClient.mockConcept()` returns one hardcoded response. Fine for testing pipeline mechanics, an obvious tell if anyone demos this without a real API key. *(Effort: trivial — vary the mock by skill category.)*

### P3-2. No dark mode
Explicitly named in the original brief's Phase 3 scope, not present. *(Effort: medium — CSS custom properties are already centralized enough to make this tractable.)*

### P3-3. No accessibility pass
No `aria-*` labels on icon-only nav buttons beyond the visible `<span>` text (which does help, but hasn't been verified against a screen reader), no contrast ratio verification, no keyboard-navigation test of the more-sheet/modal patterns. *(Effort: medium.)*

### P3-4. No i18n layer
Arabic strings are hardcoded throughout both backend prompts and frontend markup with no extraction/translation mechanism, despite the brief listing English UI as an optional secondary requirement. *(Effort: large if ever needed — this would essentially require touching every user-facing string in the codebase.)*

---

## Coverage crosswalk (the 17 requested dimensions)

| # | Dimension | Primary issues above |
|---|---|---|
| 1 | Architecture | P0-1, P1-7 |
| 2 | Folder structure | P1-6 |
| 3 | Naming | P2-3 |
| 4 | Separation of concerns | P1-1 |
| 5 | Scalability | P0-1, P1-7 |
| 6 | Prompt engineering | P1-3, P1-4 |
| 7 | AI workflow | P1-3, P1-4, P1-5 |
| 8 | Pedagogy fidelity vs. original /teach | See note below |
| 9 | Code quality | P1-1, P2-1, P2-5 |
| 10 | Maintainability | P1-2, P1-3, P2-6 |
| 11 | Security | P0-1, P0-2 |
| 12 | Performance | P1-7 |
| 13 | Technical debt | P1-4, P1-6, P2-4 |
| 14 | UX | P2-2 |
| 15 | Missing features | Real accounts, reference-sheet/glossary write access, i18n (P3-4) |
| 16 | Over-engineering | None found — if anything the opposite (see #17) |
| 17 | Under-engineering | P1-1 (no framework), P1-2 (no tests), P2-5 (no client build step) |

**Note on #8, pedagogy fidelity:** this is the one dimension where the implementation is genuinely faithful to the source methodology — the evidence-gating rule in the learning-record writer, the ZPD selector's tiered logic, and the supersession pattern all mirror the original `/teach` skill's stated principles accurately and are backed by passing automated assertions (`verifyProgression.ts`). This is the strongest part of the codebase. Everything wrapped around it — the HTTP layer, the frontend, the sanitization — is where the actual problems live.

---

## Overall assessment

The pedagogical core (services + data model + Phase 1 test harness) was built carefully and is genuinely well-tested for what it covers. Everything built after that core — the HTTP layer, the LLM-response parsing, the frontend — was built reactively, screenshot-by-screenshot, in response to live bugs rather than from a stable design, and it shows: no input validation, no auth, no tests above the service layer, and a sanitization strategy that is a running list of patches rather than a solved problem. The project is currently held together by the fact that one person has been manually testing every change; it has no safety net for the next change nobody manually tests.
