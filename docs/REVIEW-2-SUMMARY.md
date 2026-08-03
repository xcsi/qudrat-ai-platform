# Review 2 — Pedagogy Engine, Working End-to-End

**Milestone (brief §8):** *"Pedagogy engine working end-to-end in a test harness: mission → diagnostic → next-lesson → lesson → learning record."*

**Status: ✅ Done.** Live demo below is the actual harness output, not a mockup.

---

## What was built

Six services, each implementing one functional requirement:

| Service | FR | What it proves |
|---|---|---|
| `MissionInterviewService` | FR-01 | Conversational onboarding → structured, editable mission |
| `DiagnosticService` | FR-02 | ~30-item diagnostic → baseline score + tentative learning records |
| `ZpdSelector` | FR-03 | Explainable next-lesson recommendation from the syllabus graph |
| `LessonGeneratorService` | FR-04 | Concept → worked example → validated practice items |
| `LearningRecordWriterService` | FR-05 | Evidence-gated records, not activity logs |
| `InMemoryStore` | — | Data layer, 1:1 with the Postgres schema (swap-ready) |

Backed by a 44-skill, 32-prerequisite syllabus graph seeded from the Discovery Report's own question taxonomy (§4.2).

## Why this isn't "just a quiz app" — the four things that prove it

1. **No record on a perfect score.** The diagnostic and lesson writer both require evidence beyond raw correctness — a session with all-easy-correct-and-no-hard-item produces **zero** new records. Verified by an automated assertion, not a design claim.
2. **Supersession is real, not decorative.** In the live run, the diagnostic's `tentative` mastery record for a skill was superseded by a `confirmed` record once the corresponding lesson gave stronger evidence — visible directly in the printed `learning_records` timeline.
3. **The ZPD explanation is traceable, not vibes.** Every recommendation carries a one-sentence reason generated from the exact rule that fired (retest due / SRS due / frontier expansion) — never an LLM-paraphrased guess.
4. **Answer-key validation is structural.** The lesson generator's practice items go through an independent-solver check and option-length parity check before `validation_status = 'passed'` — a wrong answer key fails automatically rather than relying on the generation prompt being good enough.

## Live output (this run)

```
STEP 1 — Mission Interview: target_score=92, exam_date=2026-08-25, needs_followup=false
STEP 2 — Diagnostic: 30 skills sampled, score_estimate=90% (uncalibrated, flagged), 27 tentative records seeded
STEP 3 — ZPD Selector: recommended "إكمال فراغ واحد بالمفردة المناسبة" (priority tier 1 — confirming a diagnostic-tentative skill)
STEP 4 — Lesson Generator: 6/6 practice items passed validation
STEP 5-6 — Simulated correct attempts incl. hardest item → 1 CONFIRMED mastery record written
STEP 7 — Timeline shows the diagnostic's tentative record for that skill correctly superseded

WRITER ASSERTIONS:
✅ All-easy-correct, no hard item → zero new records
✅ Hard item correct + 80%+ → one tentative mastery record (first evidence)
✅ Wrong-then-right on same skill → one tentative misconception_corrected record
✅ Abandoned session (no completed_at) → zero records
```

## Known, deliberate gaps (not oversights — documented decisions)

- **`prior_knowledge_revealed` records are not implemented yet.** They depend on the Ask-the-Teacher chat feature (FR-12, Phase 2+). Flagged rather than faked with a weak heuristic.
- **LLM calls are currently mocked (deterministic, offline)** so the harness runs without a key or network. `AnthropicLlmClient` is already written and ready — swapping it in is a one-line change per service once real generation is needed.
- **Diagnostic score is raw percentage**, explicitly flagged as uncalibrated against the real Qudrat 0–100 norm-referenced scale — needs real norm data (official sample tests or pilot results) to calibrate properly, tracked as an open item for Phase 3.

## What's next

- Swap `MockLlmClient` → `AnthropicLlmClient` and generate real lesson content end-to-end against the live Claude API.
- Migrate `InMemoryStore` → real Postgres/Supabase (schema + seed already written and tested — `data-model/02-schema.sql`, `03-seed-skills.sql`).
- Begin Phase 2: MVP Application (Weeks 4-6) — wrap this engine in the Arabic-first, mobile-first web app.
