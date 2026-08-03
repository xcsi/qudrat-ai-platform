# Qudrat AI Tutor — Phase 1: Diagnostic Assessment

**Requirement traced:** FR-02 — "Diagnostic assessment covering all Qudrat question types; seeds baseline score and initial learning records."
**Assumption locked in (per your "كمل"):** the diagnostic pre-seeds initial `mastery` records so the ZPD selector's first call doesn't face the entire 44-skill frontier at once. Flag if you want this revisited.

---

## 1. Composition

~30 questions total (brief's number), sampled from `practice_items` where `validation_status = 'passed'`, tagged to a **breadth-first** subset of the syllabus graph — not depth. The goal of a diagnostic is coverage, not mastery-proving; one question per "entry-point" skill (skills with zero or few prerequisites) plus a handful of deeper checks.

**Sampling rule:**
- 1 item from every skill with `base_difficulty <= 2` (the "entry points") → this covers most of arithmetic, fractions, basic percentages, basic geometry, basic verbal categories. With the current 44-skill seed, that's roughly 18–20 skills → 18–20 items.
- 1 item each from a handful of `base_difficulty 3` skills already flagged as diagnostically informative because they gate several downstream skills (high out-degree in `skill_prerequisites`): `direct_proportion`, `linear_equations`, `exponent_rules`, `sign_behavior_by_region`, `simplify_by_difference`. → +5 items.
- Remainder (~5–7 items) split proportionally between verbal and quantitative to hit ~30 total, prioritizing skills with the most downstream dependents (query: `order by prereq_count desc` from the seed's own sanity-check pattern).

This is a **selection query over the existing schema**, not a new table — the diagnostic is just a `sessions` row of `session_type = 'diagnostic'` whose `attempts` happen to be pre-selected this way rather than chosen live by the ZPD selector.

```sql
-- Entry-point skills (candidates for diagnostic coverage)
select s.id, s.name_ar, s.base_difficulty,
       (select count(*) from skill_prerequisites sp where sp.prerequisite_skill_id = s.id) as unlocks_count
from skills s
order by base_difficulty asc, unlocks_count desc;
```

---

## 2. Flow

1. Create `sessions` row: `session_type = 'diagnostic'`, `started_at = now()`.
2. Service layer selects ~30 `practice_items` per the sampling rule above (one query, run once at session creation — not adaptive within the diagnostic itself; adaptive diagnostics are a v2 idea, noted below).
3. Student answers all items; each answer → one `attempts` row as normal.
4. On completion (`completed_at` set):
   - Compute **raw score** = correct / total, scaled to the 0–100 norm-referenced range the brief describes (§2.1) — exact scaling formula needs ETEC-calibration data you don't have yet; **use raw percentage as a placeholder `score_estimate`** and flag it as uncalibrated until real norm data exists (see Open Question below).
   - Write `sessions.score_estimate`.
   - Run the **learning-record seeding pass** (step 3 below) — this is the diagnostic's real product, more than the score.

---

## 3. Learning-Record Seeding Pass (the important part)

This is where FR-02's "seeds ... initial learning records" actually happens, and it must respect the same evidence-gating rule as every other learning record (Principle #1 from the data model doc) — a single correct answer on ONE diagnostic item is weaker evidence than a lesson's 5-8 question retrieval set, so the bar for writing a `mastery` record here is **deliberately stricter** than after a full lesson.

**Rule:** write a `mastery` learning_record for a skill **only if**:
- The diagnostic item for that skill was answered correctly, **and**
- `response_time_ms` is not in the bottom 10th percentile of *fast* (suggesting a guess) — a fast wrong-looking pattern needs a second signal, which the diagnostic doesn't have. **v1 simplification: skip the timing check entirely and require correctness only**, since a single-item diagnostic can't reliably distinguish genuine speed from lucky guessing anyway. Flagged as a known v1 limitation, not solved here.
- Confidence is set to `'tentative'`, not `'confirmed'` — a diagnostic answer is the weakest form of evidence the schema supports, and the first *lesson* touching that skill should be the one to confirm it (mirroring how your own Lesson 0003 confirmed what Lesson 0002 had only tentatively fixed).

```sql
-- Pseudocode for the seeding pass, per diagnostic item answered correctly
insert into learning_records (student_id, skill_id, record_type, evidence, source_session_id, confidence)
select $student_id, pi.skill_id, 'mastery',
       'التشخيص الأولي: إجابة صحيحة على سؤال في هذه المهارة',
       $session_id, 'tentative'
from attempts a
join practice_items pi on pi.id = a.practice_item_id
where a.session_id = $session_id and a.is_correct = true;
```

**Skills answered incorrectly get no record at all** — absence of a record is itself informative to the ZPD selector (it's neither mastered nor explicitly flagged as a misconception; it's simply an open frontier skill, same as if the student were brand new to it). This matches the schema's existing default: "no record" is the common case, not an exception.

---

## 4. Why Diagnostic ≠ Lesson-Level Evidence (design tension worth stating explicitly)

The `learning_records` evidence-gating principle (from the main data model doc) was written with *lessons* in mind — 5-8 retrieval items give real signal. A diagnostic gives exactly **one** item per skill. Writing a `tentative` `mastery` record off one correct answer is a deliberate compromise:

- **Pro:** without it, Day 1's ZPD call has almost no mastered skills to build a frontier from, and would have to fall back to "just start with the easiest skill in the whole graph" — ignoring everything the diagnostic just measured.
- **Con:** one lucky guess on a 4-option MCQ = 25% chance of a false `mastery` record.
- **Mitigation:** `confidence = 'tentative'` means the ZPD selector's Priority 1 rule (due retests) doesn't apply here — a tentative *mastery* isn't a "misconception_corrected" retest candidate under the current selector logic. **This is a gap**: right now nothing schedules a follow-up check on a tentative *mastery* record, only on tentative *misconception_corrected* records. Recommend extending Priority 1 in the ZPD selector to also include: *"skills with a tentative mastery record whose only evidence is a diagnostic, due for confirmation via the first lesson that touches them."* This is a one-line addition to the selector's Step 3, not a schema change — flagging it for when we revisit `04-zpd-selector.md`.

---

## 5. Open Questions

1. **Score calibration.** Raw percentage ≠ the real 0–100 norm-referenced Qudrat scale (brief §2.1: "norm-referenced," "80+ competitive"). We have no norm table yet. Recommend: store raw percentage now, add a `calibration_version` column to `sessions` later once real norm data is available (from official sample tests or your pilot in Phase 3), and back-fill. Not blocking Phase 1's test harness.
2. **Verbal vs. quantitative starting point.** If a student's diagnostic is much stronger in one section, should Day 1's first *lesson* (not just the ZPD candidate pool) be steered toward her weaker section, or does the strict ZPD algorithm (lowest difficulty among candidates, section-agnostic) already handle this naturally? Current v1 selector is section-agnostic by design (per `04-zpd-selector.md` §4) — confirm this is acceptable, or add a section-balancing rule.
3. **Retake behavior.** The brief notes students sit Qudrat itself multiple times. Does *our* diagnostic ever re-run (e.g., after a mission is superseded with a new target date), or is it strictly once-per-student? If it can re-run, need a rule for how new tentative-mastery records interact with existing confirmed ones (should never downgrade a `confirmed` record based on a single diagnostic item).

---

## 6. What Phase 1's Test Harness Needs to Prove (per the brief: "prove the engine works before dressing it")

End-to-end script, no UI:
1. Create a `student` + `mission`.
2. Run the diagnostic sampling query → get ~30 items.
3. Simulate answers (hardcoded correct/incorrect pattern for a test run) → `attempts` rows.
4. Run the seeding pass → confirm `learning_records` populated as expected.
5. Call the ZPD selector → confirm it returns a sensible, explainable next skill (not one already mastered, not one missing prerequisites).
6. Call the lesson generator (next piece) for that skill → confirm a `lessons` + `practice_items` row is produced.
7. Simulate the lesson's practice attempts → confirm the learning-record writer (separate piece, still pending) behaves per the four-criteria rule.

This six-step script *is* the Phase 1 deliverable per the Milestones table (Week 2–3: "mission → diagnostic → next-lesson → lesson → learning record").
