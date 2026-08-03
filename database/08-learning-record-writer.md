# Qudrat AI Tutor — Phase 1: Learning-Record Writer

**Requirement traced:** FR-05 — "Learning records written only on evidence of understanding, with supersession when understanding changes."
**Why this is the most important of the six pieces:** every other component — the ZPD selector, the diagnostic's seeding pass, the lesson's personalized framing, the dashboard's mastery map (Phase 2) — reads from `learning_records`. If this writer is too generous, the whole product degrades into "coverage tracking with extra steps," which is exactly the competitor weakness your own Discovery Report identified in Mujtahid and Tafawaq (§5.2). This piece *is* the product's differentiation, not a supporting utility.

---

## 1. Input

Runs once per completed `session` of `session_type = 'lesson'` (also applicable, in a stricter form, to `'practice'` sessions — see §5). Input: the full set of `attempts` from that session, joined to `practice_items` (for `difficulty_level`, `skill_id`) and the student's **existing** `learning_records` for the same skill (to detect contradiction/confirmation, not just first-time evidence).

---

## 2. The Four Criteria, Operationalized

The skill's four record types aren't equally easy to detect algorithmically. Each needs its own concrete trigger condition — vague "demonstrates understanding" is not implementable as-is.

### 2.1 `mastery`
**Trigger:** at least one item at the lesson's *highest* `difficulty_level` (the deliberately discriminating item from `07-lesson-generator.md` §3) was answered correctly, **and** overall session accuracy is ≥ 80%.

**Why not "100% correct" as the bar:** a perfect score on only *easy* items proves nothing about the discriminating case; conversely, one missed easy item alongside a correct hard item is a stronger mastery signal than five correct easy items with no hard item attempted. The rule is deliberately about *which* items were right, not just the count.

**Confidence:** `confirmed` if this is the **second** independent piece of evidence for this skill (e.g., a diagnostic already gave `tentative` mastery, and this lesson confirms it) — matching exactly the Lesson 0002→0003 pattern from your own Discovery Report, where the sign-confusion correction was only `confirmed` after the retest in Lesson 0003. If this is the **first** evidence, write `tentative` — even a good lesson performance deserves one confirming touch before being called settled, consistent with the diagnostic's own tentative-then-confirm logic.

### 2.2 `misconception_corrected`
**Trigger:** within the *same session*, at least one item was answered **incorrectly**, followed later in the same session by a **correct** answer on an item testing the **same underlying sub-skill** (not necessarily the identical item — the lesson's practice set should include at least one near-duplicate-concept pair for exactly this detection to be possible, which is a new instruction to add to the Lesson Generator's Call 2: *"include at least one pair of items testing the same specific technique, not just the same skill broadly"*).

**Evidence field, auto-composed:** *"أخطأت في [وصف قصير للسؤال الأول] ثم صححت في [وصف قصير للسؤال الثاني] — بالضبط النمط المطلوب."* — populated from the two items' `stem_ar` (truncated), not free-text authored by the writer itself.

**Confidence:** always `tentative` on first correction — per the skill's own rule (and your Discovery Report §3.3's explicit statement: *"precisely the kind of evidence the /teach methodology requires before writing a learning record"* — note it still says record, but the *correction itself* isn't yet the confirmed end-state; the confirmation comes from the retest). This creates the exact record the ZPD selector's Priority 1 rule (`04-zpd-selector.md`) is designed to pick up next session.

### 2.3 `prior_knowledge_revealed`
**Trigger:** hardest to detect from `attempts` alone, since it's about what the student volunteers, not what she answers. **v1 implementation:** this record type is **not auto-detected from quiz performance** — it's written from the "Ask-the-teacher" free-form chat (FR-12, Should-priority, Phase 2+) when a student states something like "I actually already learned this in my school's advanced track." **For Phase 1's scope** (no chat feature yet), this record type has no writer path — document it as **deferred**, not fake-implemented via a weak heuristic. Flagging honestly here rather than forcing a bad proxy signal (e.g., "answered the first item suspiciously fast" is not reliable evidence of prior knowledge, it's equally consistent with lucky guessing).

### 2.4 `goal_changed`
**Trigger:** not a lesson-session event at all — this is written when a **new `missions` row supersedes an old one** (already handled structurally in `06-mission-interview.md` §2 step 5). **Design decision:** should the mission-supersession event *also* auto-write a `goal_changed` learning_record, separate from the mission row itself? **Recommendation: yes** — even though the mission table already tracks its own supersession, a `goal_changed` learning_record makes the goal-change visible in the *same* timeline the ZPD selector and dashboard already read (`learning_records`), rather than requiring every consumer to also separately query `missions` history. Small addition: the Mission Interview's save step, on detecting an existing active mission, writes both the mission supersession **and** one `goal_changed` learning_record (no `skill_id` — this is the one record type where `skill_id` is conceptually mission-level, not skill-level; **schema implication:** `learning_records.skill_id` must become **nullable**, a one-line change to `02-schema.sql`).

---

## 3. Non-Triggers (equally important to specify)

Explicitly **do not** write any record when:
- All items correct but none at the lesson's highest difficulty level (partial evidence — log nothing, let the *next* touch on this skill provide the missing signal).
- A single incorrect-then-correct pair exists but on items testing genuinely different sub-skills (not a correction, just two unrelated data points).
- Session was abandoned (`completed_at is null`) — incomplete sessions produce attempts but no writer pass runs at all until completion.

This is the direct implementation of your own Discovery Report's §3.5 finding: *"no record was written after the first lesson despite a perfect score... a perfect score alone is coverage, not evidence."*

---

## 4. Supersession Logic

When a **new** record is written for a skill that already has an `active` record:

```sql
-- Pseudocode, run inside the same transaction as the new insert
update learning_records
set status = 'superseded', superseded_by = :new_record_id
where student_id = :student_id and skill_id = :skill_id and status = 'active';

insert into learning_records (student_id, skill_id, record_type, evidence, source_session_id, confidence)
values (:student_id, :skill_id, :new_type, :evidence, :session_id, :new_confidence);
```

**Contradiction case worth naming explicitly:** a student has a `confirmed` `mastery` record, then later a lesson touching the same skill shows a wrong answer on an easy item. Does this *downgrade* mastery? **Recommendation: no automatic downgrade from a single miss** — one slip doesn't erase confirmed evidence (matches the skill's spirit: records represent genuine, demonstrated shifts, and a single lapse is exactly what `srs_state`'s "lapse resets interval" mechanism already handles at the spaced-repetition layer, not the learning-record layer). A downgrade should require the **same evidentiary bar as any other record**: e.g., a *pattern* of misses on that skill across a session, which would itself qualify as a fresh `misconception_corrected`-eligible situation only once *corrected* — until then, no new record is written at all (per §3's non-triggers), and the confirmed mastery record simply stands, slightly stale, until re-touched.

---

## 5. Practice-Session Variant (lighter-weight)

Practice-queue sessions (`session_type = 'practice'`, spaced-repetition driven) run a narrower version of this writer:
- Only checks the `misconception_corrected` confirmation path (a `tentative` record's retest passing → flip to `confirmed`) and `srs_state` updates (interval/ease-factor per standard SM-2 update rules, not part of `learning_records` at all).
- Does **not** originate brand-new `mastery` records from a practice session — practice is for retention, not discovery of new mastery; new mastery only originates from `lesson` or `diagnostic` sessions, which are the only session types designed to introduce a skill for the first time.

---

## 6. Schema Addenda Surfaced by This Design

Two small changes to carry back to `02-schema.sql`:

```sql
-- 1. Support goal_changed records without a specific skill
alter table learning_records alter column skill_id drop not null;

-- 2. (Already noted in 06-mission-interview.md) needs_followup on missions
alter table missions add column needs_followup boolean not null default false;
```

---

## 7. Test-Harness Assertions (closing the loop from `05-diagnostic-assessment.md` §6)

The six-step Phase 1 test script now has a concrete final step:
> "Simulate the lesson's practice attempts → confirm the learning-record writer behaves per the four-criteria rule."

Concretely, the harness should assert:
- A simulated session with all-easy-correct, no hard item attempted → **zero** new records.
- A simulated session with the hard item correct + 80%+ overall → **one** `mastery` record, `tentative` if first evidence, `confirmed` if a prior `tentative` mastery/misconception record exists for that skill.
- A simulated wrong-then-right pair on the same sub-skill → **one** `misconception_corrected` record, `tentative`.
- A simulated abandoned session (no `completed_at`) → **zero** records, writer never invoked.

This is the actual, checkable definition of "the /teach principles are visibly alive in the product, not just named in the README" — the evaluation criterion from §12 of the brief ("Pedagogical fidelity," 20% of the grade).
