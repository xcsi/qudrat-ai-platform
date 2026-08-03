# Qudrat AI Tutor — Implementation Roadmap
**Status: PLANNING ONLY. No code has been changed as part of this document.**
Built directly on the findings in `ENGINEERING-REVIEW.md`. Every item below is sorted by priority within its phase; phases themselves are sequenced by dependency (Phase 2 depends on Phase 1's foundations; Phase 5 depends on everything before it).

Legend — **Risk:** Low / Medium / High (chance of breaking existing behavior). **Backward compatible:** does existing data/API/UI keep working during and after this change without a coordinated cutover.

---

## Phase 1 — Critical Engineering Fixes

### 1.1 Real authentication (Supabase Auth)
- **Why:** The entire app is architecturally one hardcoded student (`getOrCreateDemoStudent()`). Every other Phase 1 item and all of Phase 5 depend on this existing first.
- **Impact:** Unblocks real multi-student use — currently impossible.
- **Risk:** High — touches every route (all 18 handlers currently assume a single implicit student).
- **Estimated time:** 3–5 days.
- **Files modified:** `httpServer.ts` (every handler), `PostgresStore.ts`, new `authMiddleware.ts`, `public/index.html` + `app.js` (login screen), `02-schema.sql` (link `students.auth_user_id` to Supabase Auth's `auth.users`).
- **Database impact:** Yes — `students.auth_user_id` already exists as a column; needs a real foreign key/trigger tying it to Supabase Auth signup.
- **Backward compatible:** No — this is a breaking change to how every request identifies its student. Requires a coordinated cutover, not a gradual rollout.

### 1.2 Per-student rate limiting and LLM cost budget
- **Why:** No route currently limits how many LLM calls a student (or a bug, or a retry loop) can trigger. This already cost real money once (the diagnostic-duplication bug).
- **Impact:** Prevents runaway API spend; directly financial risk otherwise.
- **Risk:** Low.
- **Estimated time:** 1 day.
- **Files modified:** `httpServer.ts` (wrap LLM-calling routes), new `rateLimiter.ts`.
- **Database impact:** Optional — a `students.daily_llm_calls` counter table makes limits persistent across restarts; an in-memory token bucket does not need one but resets on deploy.
- **Backward compatible:** Yes — additive; existing flows work identically until a limit is actually hit.

### 1.3 Input validation at the HTTP boundary (Zod schemas)
- **Why:** Every handler currently does `body.field ?? default` instead of rejecting malformed requests. Bad client data becomes bad application state silently.
- **Impact:** Fails loudly and correctly instead of silently propagating bad data (this is exactly the class of bug — malformed model JSON, missing fields — that consumed most of this project's debugging time, just moved one layer over to client input).
- **Risk:** Low.
- **Estimated time:** 1 day.
- **Files modified:** `httpServer.ts` (add a schema per route), new `schemas.ts`.
- **Database impact:** No.
- **Backward compatible:** Yes, provided the frontend already sends well-formed requests (it does) — only genuinely malformed requests start being rejected.

### 1.4 Integration tests for the HTTP/API layer
- **Why:** Every real bug found this session (JSON-fence parsing, diagnostic duplication, UUID type mismatch, hidden-attribute CSS regression) was caught by manual human testing. Zero automated coverage exists above the service layer.
- **Impact:** A regression safety net for every future change — currently there isn't one.
- **Risk:** Low (tests don't touch production code paths by definition, only add coverage).
- **Estimated time:** 2–3 days for first meaningful coverage of all 18 routes.
- **Files modified:** New `src/server/httpServer.test.ts` (or per-route test files), no changes to existing source.
- **Database impact:** No (tests should run against a disposable test DB or the in-memory store).
- **Backward compatible:** Yes — pure addition.

### 1.5 Database-level idempotency + constraints (remaining pieces)
- **Why:** `02-schema.sql`/`03-seed-skills.sql` and the `practice_items` unique index were already patched in the last session; this item is the remaining sweep — checking every other table (`lessons`, `glossary_terms`, `student_glossary_unlocks`) for the same class of missing `ON CONFLICT` protection.
- **Impact:** Closes the rest of the "duplicate row" bug class before it recurs somewhere else.
- **Risk:** Low.
- **Estimated time:** Half a day.
- **Files modified:** `02-schema.sql`, `PostgresStore.ts` (any insert methods missing conflict handling).
- **Database impact:** Yes — new constraints/indexes.
- **Backward compatible:** Yes, as long as no existing duplicate data violates the new constraint (needs a one-time cleanup query first if so).

---

## Phase 2 — Architecture Improvements

### 2.1 Adopt a real HTTP framework (Express or Fastify)
- **Why:** `httpServer.ts` is a 450+ line hand-rolled router with string-matched `if` chains. This does not scale past its current 18 routes.
- **Impact:** Enables middleware (auth, validation, logging) to be declared once instead of repeated per-handler; makes route addition mechanical instead of error-prone.
- **Risk:** Medium — every route needs to be ported, though business logic underneath is untouched.
- **Estimated time:** 1–2 days.
- **Files modified:** `httpServer.ts` (replaced), all route handlers (signature changes only).
- **Database impact:** No.
- **Backward compatible:** Yes for API consumers (same URLs/payloads) if done carefully; No for the server's internal structure.

### 2.2 Rearchitect `PostgresStore` to query the database directly instead of mirroring it in memory
- **Why:** Every read currently filters a JS array holding a full in-memory copy of the entire database, hydrated once at startup and never evicted. This was a deliberate demo-stage tradeoff and does not scale past a handful of students.
- **Impact:** Removes the single biggest scalability ceiling in the codebase.
- **Risk:** High — every service method built against synchronous array-filtering (`getActiveLearningRecords`, `getPrerequisites`, etc.) becomes async and per-student-scoped; this touches every service file.
- **Estimated time:** 3–4 days.
- **Files modified:** `PostgresStore.ts` (rewritten), `InMemoryStore.ts` (interface kept as the local-dev/test fallback), every file in `services/`.
- **Database impact:** No schema changes, but query patterns change substantially (indexed lookups instead of full-table scans in memory).
- **Backward compatible:** Yes for `InMemoryStore`-based local dev and the test harness; No for any code currently relying on `PostgresStore`'s synchronous getters.

### 2.3 Consistent API response casing (camelCase everywhere)
- **Why:** Some endpoints return camelCase, others pass raw DB snake_case straight through — no single rule a contributor can learn once.
- **Impact:** Smaller, mostly a maintainability/onboarding win.
- **Risk:** Medium — this is a breaking change for the frontend, which currently reads some snake_case fields directly (`stem_ar`, `correct_option_index`).
- **Estimated time:** Half a day (mechanical, but every response shape and every `app.js` consumer of it must be updated together).
- **Files modified:** `httpServer.ts` (every `sendJson` call), `public/app.js` (every field access).
- **Database impact:** No — this is a serialization-layer concern only, DB columns stay snake_case.
- **Backward compatible:** No — must ship server and client changes atomically.

### 2.4 Structured logging
- **Why:** 60+ scattered `console.*` calls with no levels, no request IDs, no way to trace a warning back to the request/student that triggered it.
- **Impact:** Makes production incidents investigable; currently they aren't.
- **Risk:** Low.
- **Estimated time:** 1 day.
- **Files modified:** New `logger.ts`, every file currently calling `console.*` (mechanical find-replace with structured fields added).
- **Database impact:** No (unless logs are also persisted to a table, which is optional).
- **Backward compatible:** Yes.

### 2.5 Move conversation state (mission interview, ask-the-teacher) from process-global variables to persistent per-student storage
- **Why:** `missionConversation` and `askTeacherConversation` are currently module-level `let` strings — this only works because there is one student per process (see 1.1). It also means conversation history is lost on every server restart.
- **Impact:** Required for Phase 1.1 to actually work with multiple concurrent students; also fixes conversations silently resetting on deploy.
- **Risk:** Medium.
- **Estimated time:** 1 day (depends on 1.1 being done first).
- **Files modified:** `httpServer.ts`, new `conversations` table or Redis-backed store.
- **Database impact:** Yes, if persisted relationally — a new table.
- **Backward compatible:** No — depends on and ships together with 1.1.

### 2.6 Client-side TypeScript + minimal build step
- **Why:** `app.js` is 650+ untyped lines; roughly half of this project's actual bugs (the bottom-nav visibility regression, the chat-layout issue, the practice-badge ID mismatch) were frontend bugs with zero compile-time protection.
- **Impact:** Catches an entire class of bug before it ships, matching the safety net the backend already has.
- **Risk:** Low — additive tooling, doesn't change runtime behavior if done as a straight conversion.
- **Estimated time:** 1 day for tooling setup + incremental conversion.
- **Files modified:** New `vite.config.ts` (or esbuild equivalent), `app.js` → `app.ts` (split into modules).
- **Database impact:** No.
- **Backward compatible:** Yes.

---

## Phase 3 — UI/UX Improvements

### 3.1 Typography and spacing system audit (toward the "premium SaaS" bar)
- **Why:** Current spacing/type scale was built incrementally screen-by-screen rather than from a defined system; consistency has drifted (confirmed during the engineering review: hardcoded hex colors outside the token system, ad hoc spacing values).
- **Impact:** This is the single highest-leverage visual change for the "does this look like Linear/Stripe" bar the brief is asking for.
- **Risk:** Low — CSS-only.
- **Estimated time:** 1–2 days.
- **Files modified:** `style.css` (systematic pass, not additive patches).
- **Database impact:** No.
- **Backward compatible:** Yes.

### 3.2 Accessibility pass
- **Why:** No verified color contrast, incomplete `aria-*` labeling, keyboard navigation of the more-sheet/modal pattern untested. Explicitly named in the brief's own NFRs ("WCAG-aware color contrast... keyboard navigability").
- **Impact:** Compliance with the brief's own stated requirement; also broadens who can actually use the product.
- **Risk:** Low.
- **Estimated time:** 1–2 days.
- **Files modified:** `index.html`, `style.css`, `app.js` (focus management).
- **Database impact:** No.
- **Backward compatible:** Yes.

### 3.3 Dark mode
- **Why:** Named explicitly in the brief's Phase 3 scope, not built.
- **Impact:** Polish item, not functionally required.
- **Risk:** Low.
- **Estimated time:** 1 day (the CSS custom-property system already in place makes this tractable).
- **Files modified:** `style.css` (a dark token set), `app.js` (a toggle + persisted preference, which needs a backend field or local-only storage — see note: no localStorage in some environments, would need a DB field for real persistence).
- **Database impact:** Optional (a `students.theme_preference` column if persisted server-side).
- **Backward compatible:** Yes.

### 3.4 Score-estimate UI honesty
- **Why:** The dashboard shows a bare percentage from an explicitly uncalibrated formula (`baseline + masteredCount * 0.6`), documented as a placeholder in code comments the student never sees.
- **Impact:** Closes a real gap between what the product claims and what the math actually supports.
- **Risk:** Low.
- **Estimated time:** A few hours.
- **Files modified:** `app.js` (dashboard rendering), `index.html` (add a visible caveat/tooltip).
- **Database impact:** No.
- **Backward compatible:** Yes.

### 3.5 Print-quality reference sheets
- **Why:** The brief explicitly asks for reference sheets a student "would pin above her desk" — currently they're an in-app scrollable list, not a print-optimized layout.
- **Impact:** Direct brief requirement, currently only partially met.
- **Risk:** Low.
- **Estimated time:** 1 day.
- **Files modified:** `style.css` (a `@media print` stylesheet), possibly a dedicated print-view route.
- **Database impact:** No.
- **Backward compatible:** Yes.

### 3.6 Consistent loading/empty/error states across all screens
- **Why:** These were added incrementally per-feature (practice queue, reference sheets, glossary each have their own empty-state copy/pattern) rather than from one shared component/style.
- **Impact:** Visual and tonal consistency; smaller but compounds with 3.1.
- **Risk:** Low.
- **Estimated time:** 1 day.
- **Files modified:** `app.js` (extract a shared empty-state/error-state renderer), `style.css`.
- **Database impact:** No.
- **Backward compatible:** Yes.

---

## Phase 4 — AI & Pedagogy Improvements

### 4.1 Scale item generation to the brief's real targets (~30 diagnostic, ~120 mock exam)
- **Why:** Both are currently scaled down (12 and 20 respectively) for demo cost/speed. The sampling logic already supports the real numbers — this is a config change, not new logic — but it has real cost implications (Phase 1.2's rate limiting should land first).
- **Impact:** Matches the brief's actual specification; a scaled-down diagnostic gives a materially noisier baseline estimate.
- **Risk:** Low (logic-wise) / Medium (cost-wise without 1.2 done first).
- **Estimated time:** Half a day, but should not ship before 1.2.
- **Files modified:** `diagnosticService.ts`, `mockExamService.ts` (two constant changes), `public/app.js` (timer duration scaling).
- **Database impact:** No.
- **Backward compatible:** Yes.

### 4.2 Human-review queue for generated content
- **Why:** The brief's own Phase 3 scope and its quality bar ("a sample of 50 generated questions, reviewed blind by a Qudrat-experienced teacher") require a review workflow that doesn't exist yet — `practice_items.validation_status` and `lessons.review_status` fields exist in the schema specifically for this but have no UI or process built on top of them.
- **Impact:** This is the actual mechanism the brief's quality bar depends on; without it, "validated" only means "passed automated checks," not human-reviewed.
- **Risk:** Medium.
- **Estimated time:** 2–3 days (a review queue UI + reviewer role).
- **Files modified:** New `services/reviewQueueService.ts`, new admin-facing routes/UI, `httpServer.ts`.
- **Database impact:** Possibly — a `reviewer_id`/`reviewed_at` field on `practice_items`/`lessons` if not already sufficient.
- **Backward compatible:** Yes — additive.

### 4.3 Content-quality benchmark / eval set
- **Why:** No prompt change in this project has ever been validated against a fixed set of cases — every change was eyeballed once, manually, by a human. This is the same gap named in the engineering review's prompt-engineering finding.
- **Impact:** Makes prompt iteration measurable instead of vibes-based; would have caught the `\dfrac`-vs-`\frac` gap and the JSON-escaping regression before a live user did.
- **Risk:** Low.
- **Estimated time:** 1–2 days to build a first 15–20 case eval set across skill categories.
- **Files modified:** New `eval/` directory with fixed test cases, new `eval/runEval.ts` script.
- **Database impact:** No.
- **Backward compatible:** Yes.

### 4.4 Deepen interleaving in the spaced-repetition queue
- **Why:** The current practice queue pulls one due item per skill independently; the brief's own pedagogy section calls for interleaving *related* question types within a session, which isn't explicitly implemented — skills are due/not-due individually with no deliberate mixing logic.
- **Impact:** Closer fidelity to the `/teach` methodology's "storage strength over fluency" principle.
- **Risk:** Low.
- **Estimated time:** 1 day.
- **Files modified:** `practiceService.ts` (queue ordering logic).
- **Database impact:** No.
- **Backward compatible:** Yes.

### 4.5 Tahsili-ready configuration abstraction (FR-14)
- **Why:** The brief explicitly wants "nothing hard-codes Qudrat; a second exam should be addable as configuration plus content." Currently the syllabus graph, taxonomy categories, and prompts are Qudrat-specific throughout, not parameterized by exam type.
- **Impact:** Directly enables (or blocks) a stated future requirement; cheaper to address now than after more Qudrat-specific assumptions accumulate.
- **Risk:** Medium — touches the data model (`skills.section` and category taxonomy would need an `exam_type` dimension) and every prompt that currently says "Qudrat" by name.
- **Estimated time:** 2–3 days.
- **Files modified:** `02-schema.sql` (add `exam_type` to relevant tables), all prompt constants, `seedSkills.ts`.
- **Database impact:** Yes — schema change plus a data migration for existing rows (defaulted to `exam_type = 'qudrat'`).
- **Backward compatible:** Yes if the new column defaults sensibly for existing data.

### 4.6 Parent/guardian progress summary (FR-13)
- **Why:** Named as a "Could"-priority requirement in the brief, not started.
- **Impact:** Lowest priority of the functional requirements list; genuinely optional.
- **Risk:** Low.
- **Estimated time:** 2 days (email/PDF generation + a guardian-contact data model).
- **Files modified:** New `services/guardianSummaryService.ts`, `02-schema.sql` (`guardian_contacts` table), a scheduled job.
- **Database impact:** Yes — new table.
- **Backward compatible:** Yes — additive.

---

## Phase 5 — Production Readiness

### 5.1 Parental consent flow for minors (brief §10 — non-negotiable per the brief itself)
- **Why:** The brief states this as a hard requirement before moving past a pilot; `students.parental_consent_at` exists in the schema but nothing currently blocks a mission from being saved without it in the real (non-demo) flow once real auth exists.
- **Impact:** Legal/compliance requirement, not optional once real users are involved.
- **Risk:** Medium — depends on 1.1 (real auth) landing first.
- **Estimated time:** 1–2 days.
- **Files modified:** `missionInterviewService.ts` (the guardrail already exists in code — needs to be exercised by a real onboarding flow), new consent-collection UI.
- **Database impact:** No new columns (already present), but this is the first time it's actually enforced end-to-end.
- **Backward compatible:** Yes.

### 5.2 PDPL compliance audit
- **Why:** Brief NFR requires Saudi Personal Data Protection Law compliance, in-Kingdom or compliant-region hosting, and no student PII in model prompts. This hasn't been formally audited — Supabase's region setting, what's actually sent to Anthropic's API, and data retention policy all need a deliberate review, not an assumption.
- **Impact:** Legal exposure if skipped; not optional for real students.
- **Risk:** Low (audit itself) / unknown until findings are in.
- **Estimated time:** 1–2 days for the audit; remediation time depends on findings.
- **Files modified:** Unknown until audit completes; likely candidates are the Supabase project region setting and any prompt that includes more student context than strictly necessary.
- **Database impact:** Possibly (data retention/deletion policy implementation).
- **Backward compatible:** Depends on findings.

### 5.3 Error tracking and monitoring (e.g., Sentry)
- **Why:** No current mechanism surfaces a production error except a live terminal someone happens to be watching — the exact situation this entire project has been operating under (every bug found by a human staring at output).
- **Impact:** Makes the gap between "bug happens" and "someone finds out" hours/days instead of "whenever a human notices."
- **Risk:** Low.
- **Estimated time:** Half a day.
- **Files modified:** `httpServer.ts` (error boundary hook), new monitoring config.
- **Database impact:** No.
- **Backward compatible:** Yes.

### 5.4 CI/CD pipeline
- **Why:** No automated build/test/deploy currently exists — every change in this project has been manually run locally by one person.
- **Impact:** Prerequisite for safely shipping any of the above changes with more than one contributor.
- **Risk:** Low.
- **Estimated time:** 1 day.
- **Files modified:** New `.github/workflows/` (or equivalent), `package.json` (scripts).
- **Database impact:** No.
- **Backward compatible:** Yes.

### 5.5 Database backup and disaster recovery plan
- **Why:** No verified backup/restore process for the Supabase project has been established or tested.
- **Impact:** A single data-loss event currently has no recovery path.
- **Risk:** Low (process/config work, not code).
- **Estimated time:** Half a day (Supabase has built-in backup on paid tiers; this is largely configuration + a documented, tested restore drill).
- **Files modified:** `POSTGRES-MIGRATION.md` (documentation), Supabase project settings.
- **Database impact:** Configuration only.
- **Backward compatible:** Yes.

### 5.6 Load testing
- **Why:** No load has ever been simulated beyond one manual tester; real per-request cost (LLM latency, DB round-trips) at even modest concurrency (10–20 simultaneous students) is unverified.
- **Impact:** Surfaces the Phase 2.2 scalability ceiling (in-memory store) under realistic load before real users do.
- **Risk:** Low (testing itself); findings may require additional Phase 2 work.
- **Estimated time:** 1 day for a first pass.
- **Files modified:** New `load-test/` scripts, no production code changes.
- **Database impact:** No (should run against a disposable test environment).
- **Backward compatible:** Yes.

---

## Summary table (priority order across all phases)

| Phase | Item | Risk | Est. time | DB impact | Backward compatible |
|---|---|---|---|---|---|
| 1 | 1.1 Real authentication | High | 3–5 days | Yes | No |
| 1 | 1.2 Rate limiting / cost budget | Low | 1 day | Optional | Yes |
| 1 | 1.3 Input validation (Zod) | Low | 1 day | No | Yes |
| 1 | 1.4 HTTP integration tests | Low | 2–3 days | No | Yes |
| 1 | 1.5 Remaining DB idempotency sweep | Low | 0.5 day | Yes | Yes |
| 2 | 2.1 Real HTTP framework | Medium | 1–2 days | No | Mixed |
| 2 | 2.2 PostgresStore rearchitecture | High | 3–4 days | No | Mixed |
| 2 | 2.3 Consistent API casing | Medium | 0.5 day | No | No |
| 2 | 2.4 Structured logging | Low | 1 day | No | Yes |
| 2 | 2.5 Persistent conversation state | Medium | 1 day | Yes | No |
| 2 | 2.6 Client-side TypeScript | Low | 1 day | No | Yes |
| 3 | 3.1 Typography/spacing system | Low | 1–2 days | No | Yes |
| 3 | 3.2 Accessibility pass | Low | 1–2 days | No | Yes |
| 3 | 3.3 Dark mode | Low | 1 day | Optional | Yes |
| 3 | 3.4 Score-estimate UI honesty | Low | Hours | No | Yes |
| 3 | 3.5 Print-quality reference sheets | Low | 1 day | No | Yes |
| 3 | 3.6 Consistent empty/error states | Low | 1 day | No | Yes |
| 4 | 4.1 Scale item counts to brief targets | Low/Medium | 0.5 day | No | Yes |
| 4 | 4.2 Human-review queue | Medium | 2–3 days | Maybe | Yes |
| 4 | 4.3 Content-quality eval set | Low | 1–2 days | No | Yes |
| 4 | 4.4 Deeper interleaving | Low | 1 day | No | Yes |
| 4 | 4.5 Tahsili-ready abstraction | Medium | 2–3 days | Yes | Yes |
| 4 | 4.6 Parent/guardian summary | Low | 2 days | Yes | Yes |
| 5 | 5.1 Parental consent flow | Medium | 1–2 days | No | Yes |
| 5 | 5.2 PDPL audit | Low/Unknown | 1–2 days | Maybe | Depends |
| 5 | 5.3 Error tracking | Low | 0.5 day | No | Yes |
| 5 | 5.4 CI/CD pipeline | Low | 1 day | No | Yes |
| 5 | 5.5 Backup/DR plan | Low | 0.5 day | Config | Yes |
| 5 | 5.6 Load testing | Low | 1 day | No | Yes |

**Total estimated effort:** roughly 6–8 weeks of focused, sequential work if done by one person; meaningfully parallelizable across phases 3/4 (UI and pedagogy work) while phases 1/2 (foundational engineering) are underway, since they touch mostly disjoint files.

---

**Waiting for your approval before implementing anything above.** Tell me which phase(s) or specific items to proceed with, and in what order — I'd recommend Phase 1 in full before touching Phase 2, since 2.2 and 2.5 both assume 1.1 already exists.
