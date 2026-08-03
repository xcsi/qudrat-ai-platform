# Companion (قِيس)

`public/companion.js`

## What it is — and what it isn't

**قِيس** ("Qiyas"/"Qees") is a persistent, named companion character — a
presentation + orchestration layer any screen can invoke via named triggers.
It is explicitly **not**:

- the ask-the-teacher chat feature (`askTeacherService`), and
- a new AI backend of its own.

The companion never calls an LLM directly. Its lines are template strings
built from data the app already has in memory, with one deliberate exception:
`explainMistake(text)` can be handed an actual AI-generated explanation by
its caller to relay verbatim — the companion is a delivery mechanism there,
not the source of the text.

## Mount lifecycle

Earlier versions created the companion once and permanently docked it in a
bottom corner, like a typical chat widget. The current version has a real
mount lifecycle instead:

```js
Companion.enter(mode = 'floating', anchorSelector = null)
Companion.leave()
```

This lets the companion appear anchored near a lesson title or an exam
timer, or disappear entirely while the student is reading — instead of
always occupying the same corner regardless of context. Face/animation
states (`idle`, `thinking`, `celebrating`, `pointing`, `typing`) are
unchanged by the mount-lifecycle rewrite.

## Memory

```js
Companion.updateMemory({ name, targetScore, daysToExam, weakSkills, strongSkills,
                          streak, recentBadges, currentLessonTitle, recentMistake,
                          studyHistory })
```

Memory is populated entirely from data screens already fetch from the API
(dashboard, lesson, practice) — there are no backend fields that exist
purely to feed companion memory. Every companion line is a template string
built from this memory, never free-form AI text (again, except when a caller
explicitly hands `explainMistake` a real AI reply to relay).

## Trigger API

| Function | When it's called |
|---|---|
| `greet()` | First-time or returning student, shown once — every other trigger is called explicitly by the screen that owns it, not generically |
| `introduceTopic(skillNameAr, reasonAr)` | A new skill is about to be taught — surfaces the ZPD selector's own explanation (see [Curriculum System](curriculum-system.md)) |
| `explain(text)` / `explainMistake(text)` | Concept or mistake explanation, template-built or AI-relayed |
| `celebrate(achievementText)` | Badge/milestone earned |
| `encourage()` / `warnWeakSkill(skillNameAr)` | Motivational nudges |
| `introduceQuiz()` | Entering a quiz/practice phase |
| `reactCorrect()` / `reactStruggle()` | Immediate answer feedback (non-exam contexts only) |
| `reactTimerPressure()` / `reactInactivity()` | Mock-exam timer and idle-detection reactions |
| `openPanel()` / `closePanel()` | Full companion panel (today's sessions, memory-derived summary) |
| `hide()` | Dismiss without unmounting the underlying widget |

## Design constraints

- Pure vanilla JS, no framework — same IIFE-exposing-a-global-const pattern
  as `Cards`/`Visuals`/`Voice`. Reference the bare `Companion` identifier,
  not `window.Companion`.
- Never blocks or auto-submits during a real exam. The exam timer
  (`reactTimerPressure`) is a separate, deliberately gentler warning system
  from `startExamTimer`'s own hard countdown.
- All companion copy is Arabic-first, matching the RTL product.
