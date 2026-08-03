# Dashboard

`GET /api/dashboard` (src/server/httpServer.ts) + the dashboard screen in
`public/app.js`

## What it serves

`handleDashboard` assembles a single read-model combining several services —
nothing here is stored as its own "dashboard" table:

- **Score projection** — `baseline` (the student's diagnostic score
  estimate), `current` (a transparent, explicitly-non-calibrated placeholder
  projection: baseline nudged up proportionally to skills mastered since the
  diagnostic — see `database/05-diagnostic-assessment.md` §5 for why
  this is flagged, not treated as a real psychometric model), and `target`
  (from the student's active mission).
- **Timeline** — `daysToExam`, derived from the mission's `exam_date`.
- **Mastery roadmap** — every skill with its current status
  (`untouched`/`misconception_corrected`/`mastery`), confidence
  (`tentative`/`confirmed`), and `section` (`quantitative`/`verbal`) so the
  client can split the roadmap into separate per-section journeys.
- **`duePracticeCount`** — from `practiceService.getDueQueue`, feeding the
  spaced-repetition entry point (see [Curriculum System](curriculum-system.md)).
- **Reminders** — `notificationService.checkAndCreateReminders` runs as a
  side effect of loading the dashboard, so exam-date-driven nudges appear
  without a separate polling endpoint.

## Gamification layer

`gamificationService` (src/services/gamificationService.ts) computes XP,
level, and streak **at read time** rather than storing them — the same
"compiled view, don't duplicate storage" approach `referenceSheetService`
uses. XP is derived from append-only event tables (attempts, sessions,
learning_records ever created, badge unlocks), never from currently-active
state, which is a deliberate correctness choice: `writeLearningRecord()`
supersedes old records regardless of type, so counting only *active* mastery
records could make a student's XP decrease after a later interaction. XP
counts *all-time events*, making it monotonically non-decreasing by
construction — the near-universal "XP never goes down" gamification rule.

Only **badges/unlocks** are real stored rows (`badges`,
`student_badge_unlocks`) — everything else in the gamification layer is
computed from existing tables.

## Client rendering

The dashboard screen in `app.js` renders:

- A progress arc (hand-coded inline SVG, the same technique later
  generalized into [the visual learning engine](visual-learning-engine.md)).
- A per-section skill roadmap (quantitative/verbal split, per the `section`
  field above).
- The companion ([قِيس](companion.md)) surfaces weak-skill warnings and
  encouragement using the same data this endpoint returns — no separate
  companion-specific API call.

## Related endpoints

`GET /api/practice/queue`, `GET /api/reference-sheets`, `GET /api/glossary`,
and `GET /api/notifications` are the dashboard's satellite reads — see
[API Flow](api-flow.md) for the full route list.
