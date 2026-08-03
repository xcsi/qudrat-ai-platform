# Curriculum System

`src/services/zpdSelector.ts`, `src/services/learningRecordWriterService.ts`,
`src/data/seedSkills.ts`, `database/03-seed-skills.sql`

## Skills and prerequisites

The curriculum is a directed graph of **44 skills** (`src/data/seedSkills.ts`,
mirrored in `database/03-seed-skills.sql`) spanning two `section`s
(`quantitative`, `verbal`) and 17 `category` values (arithmetic, fractions,
algebra, geometry, statistics, verbal analogy, reading comprehension, etc.),
connected by **32 prerequisite edges** (`skill_prerequisites`). A skill only
becomes eligible for teaching once every one of its prerequisites is
mastered.

## Evidence, not coverage

`learningRecordWriterService` is described in its own header comment as "the
most important" of the six pedagogy-engine pieces, because it's what stops
the product from degrading into coverage-tracking with extra steps. It writes
exactly two record types automatically from quiz performance:

- **`misconception_corrected`** — an incorrect attempt followed by a later
  correct attempt on an item in the same skill, same session. Always written
  as `tentative` confidence.
- **`mastery`** — requires **both** (a) the hardest discriminating item in
  the session (difficulty ≥ 4) answered correctly, **and** (b) ≥80% overall
  accuracy in that session. Confidence is `confirmed` only if this is the
  second independent piece of evidence for the skill (e.g. a prior
  diagnostic tentative-mastery, or a prior misconception-correction);
  otherwise `tentative`.

A third type, `goal_changed`, is written elsewhere (on mission
supersession, in the store layer) — not from quiz performance. A fourth,
`prior_knowledge_revealed`, depends on the ask-the-teacher chat explicitly
detecting a student's disclosure that they already knew a concept.

Records are **superseded**, not mutated — `getActiveLearningRecords` always
resolves to the latest active record per skill, which is what both the ZPD
selector and the gamification XP calculation (see [Dashboard](dashboard.md))
read from.

## The ZPD selector

`ZpdSelector.selectNext(studentId, section?)` picks exactly one next skill,
in strict priority order:

1. **Priority 1a — due retests.** The oldest `tentative` `misconception_corrected`
   record whose skill is still a valid candidate. Re-tests understanding that
   was only tentatively corrected.
2. **Priority 1b — diagnostic-confirmed mastery.** A `tentative` `mastery`
   record whose only evidence came from a diagnostic session (not yet
   confirmed by an actual lesson). This closes a gap: such a skill's own
   `mastery` record already excludes it from the general candidate pool, so
   this tier checks the skill's `section` directly instead of the candidate
   list.
3. **Priority 2 — SRS-due review.** The most-overdue spaced-repetition state
   (see `srsService`), most overdue first.
4. **Priority 3 — frontier expansion.** Among ZPD candidates (not mastered,
   all prerequisites mastered), rank by: has a published/human-reviewed
   lesson already (preferred, to avoid live-generation latency) → lower base
   difficulty → fewer prerequisites → oldest skill row. This is a *preference*
   among otherwise-equal candidates, not a hard requirement — a skill with no
   curated content anywhere is still recommended if it's genuinely the best
   option.

Every recommendation includes a one-sentence Arabic explanation
(`reasonAr`) shown directly to the student — the ZPD selector is required to
be explainable, not a black box.

### Section confinement

Once a student explicitly picks a curriculum track (Quantitative or Verbal,
via the client's path-select screen), `section` confines every subsequent
recommendation to that track. Two real bugs, found via live testing and
fixed, are documented directly in the code: without an explicit `section`
check inside priorities 1b and 2, a diagnostic-confirmed or SRS-due skill
from the *other* section could still be recommended, silently bypassing the
student's choice — because those tiers can't reuse the general `candidates`
list (a skill with an active mastery record, tentative or not, is by
definition excluded from it).

## From selection to lesson

The skill ID `ZpdSelector` returns feeds directly into
`lessonGeneratorService.generateOrReuse(skillId, baseDifficulty)` — see
[API Flow](api-flow.md) for the full request path, and
[Grounded AI Pipeline](grounded-ai-pipeline.md) for how that generation call
is grounded when it isn't served from curated content.
