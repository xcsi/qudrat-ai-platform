# API Flow

`src/server/httpServer.ts` — Node's built-in `http` module, hand-rolled
routing (no Express), zero extra server dependencies.

## Auth model

Every route resolves the current student via `resolveStudentFromRequest`:

1. If an `Authorization: Bearer <token>` header is present and
   `authService.resolveStudent(token)` finds an active `student_sessions`
   row, use that student.
2. Otherwise, fall back to a single auto-created **demo student** —
   `getOrCreateDemoStudent()` — so the browser demo works immediately with
   no login required.

This means the same API works both for an anonymous demo visitor and for a
registered student, without separate code paths in every handler.

## Full route table

| Method | Path | Handler | Purpose |
|---|---|---|---|
| POST | `/api/mission` | `handleMission` | Mission interview turn (conversational intake) |
| POST | `/api/diagnostic/start` | `handleDiagnosticStart` | Begin diagnostic assessment |
| POST | `/api/diagnostic/:sessionId/answer` | `handleDiagnosticAnswer` | Submit a diagnostic answer |
| POST | `/api/diagnostic/:sessionId/complete` | `handleDiagnosticComplete` | Finalize diagnostic, write tentative records |
| GET | `/api/next-lesson` | `handleNextLesson` | Run the [ZPD selector](curriculum-system.md) |
| POST | `/api/lesson/:skillId` | `handleGenerateLesson` | Reuse or generate a lesson for a skill |
| POST | `/api/lesson/:skillId/warm` | `handleWarmLesson` | Fire-and-forget background pre-generation (see below) |
| POST | `/api/lesson-session/:sessionId/answer` | `handleLessonAnswer` | Submit a lesson-quiz answer |
| POST | `/api/lesson-session/:sessionId/complete` | `handleLessonComplete` | Complete session → [learning-record writer](curriculum-system.md) runs |
| GET | `/api/dashboard` | `handleDashboard` | Full [dashboard](dashboard.md) read-model |
| GET | `/api/practice/queue` | `handlePracticeQueue` | Spaced-repetition due queue |
| POST | `/api/practice/answer` | `handlePracticeAnswer` | Submit a practice-queue answer |
| POST | `/api/mock-exam/start` | `handleMockExamStart` | Begin a full timed mock exam |
| POST | `/api/mock-exam/:sessionId/answer` | `handleMockExamAnswer` | Submit a mock-exam answer (no mid-exam feedback) |
| POST | `/api/mock-exam/:sessionId/complete` | `handleMockExamComplete` | Score + per-question review |
| GET | `/api/reference-sheets` | `handleReferenceSheets` | Auto-compiled from mastered-skill lesson content |
| GET | `/api/glossary` | `handleGlossary` | Terms unlocked by actual mastery |
| GET | `/api/resources` | `handleResources` | Same trusted sources used for [AI grounding](grounded-ai-pipeline.md) |
| POST | `/api/ask-teacher` | `handleAskTeacher` | Grounded free-form Q&A |
| POST | `/api/auth/register` | `handleAuthRegister` | Create account |
| POST | `/api/auth/login` | `handleAuthLogin` | Issue a session token |
| POST | `/api/auth/logout` | `handleAuthLogout` | Invalidate a session token |
| PATCH | `/api/profile/password` | `handleChangePassword` | Change password |
| POST | `/api/profile/gender` | `handleSetGender` | One-time onboarding field |
| POST | `/api/profile/grade` | `handleSetGrade` | One-time onboarding field |
| GET | `/api/profile` | `handleProfile` | Current student profile |
| GET | `/api/notifications` | `handleNotifications` | Exam-date-driven reminders |
| POST | `/api/notifications/:id/read` | `handleNotificationRead` | Mark a notification read |
| POST | `/api/lesson/:skillId/ask-about` | `handleAskAboutLesson` | Lesson-scoped grounded Q&A |
| POST | `/api/practice-item/:itemId/hint` | `handleHint` | Progressive hint generation |
| GET | `/*` (static) | `serveStatic` | Serves `public/` (path-traversal guarded) |

## Representative end-to-end path: onboarding → first lesson

```
POST /api/mission              → missionInterviewService (conversational intake)
POST /api/diagnostic/start     → diagnosticService (samples item bank)
POST /api/diagnostic/:id/answer   (repeated per item)
POST /api/diagnostic/:id/complete → learningRecordWriterService (tentative records)
GET  /api/next-lesson          → zpdSelector.selectNext (see Curriculum System)
POST /api/lesson/:skillId      → lessonGeneratorService.generateOrReuse
                                  (curated reuse, or grounded generation — see
                                  Grounded AI Pipeline)
POST /api/lesson-session/:id/answer  (repeated per quiz item)
POST /api/lesson-session/:id/complete → learningRecordWriterService (real evidence)
GET  /api/dashboard            → updated roadmap, XP, streak
```

## Background lesson warming

`POST /api/lesson/:skillId/warm` acknowledges immediately (`202`) and
triggers `lessonGeneratorService.generateOrReuse` in the background,
swallowing any error — a failed warm attempt just means the student's later
real request falls back to normal (slower) live generation, exactly as if
warming had never been attempted. It deliberately does **not** create a
session, to avoid corrupting `gamificationService`'s streak/XP calculations
(which are derived live from real session rows — see
[Dashboard](dashboard.md)).

## Error handling

Every route is wrapped in a single top-level `try`/`catch`. Unhandled
exceptions are logged server-side but never return raw `err.message`/stack
traces to the client — a fixed, generic Arabic error message is returned
instead. This replaced an earlier version that leaked exception details
across all routes, the single largest source of information disclosure risk
in the server before the fix.
