# Qudrat AI Tutor — Phase 1: Mission Interview

**Requirement traced:** FR-01 — "Conversational mission onboarding producing a structured, editable mission (target program, target score, exam date, weekly time budget)."
**Source format:** MISSION-FORMAT.md, adapted per Discovery Report §2.2 — captures why the student is studying, not just what.

This is the **first** step in the brief's own architecture diagram (§6.1 of the Discovery Report): `Student → Mission Interview → Diagnostic Assessment → ...`. Every later piece (diagnostic sampling, ZPD selection, lesson tone) reads from the `missions` row this produces.

---

## 1. Why This Can't Be a Form

The brief is explicit: "conversational," not "onboarding form." The /teach skill's own MISSION.md rule is that the interview should *understand*, not just *collect* — a form asks "target score?"; an interview notices if a student says "I need medicine at KFU" and infers a high target score and tight competition, then confirms it rather than making her type a number cold. This is a genuine UX difference the brief is asking for, not decoration.

That said, the **output must still be structured** (FR-01: "producing a structured, editable mission") — so this is a bounded conversation with a hard exit condition, not open-ended chat.

---

## 2. Flow

1. **Open-ended opener.** A single Claude API call, system-prompted as an admissions-counselor-style interviewer (not a form-bot). Opener question, in Arabic: something like *"حدثيني عن هدفك — وش تبين تدرسين وليش القدرات مهم لك الحين؟"*
2. **Multi-turn extraction.** Each student turn is passed, with conversation history, to a Claude API call whose system prompt has two jobs done in a single structured-output call:
   - (a) Continue the conversation naturally (next question, or acknowledgment + follow-up), **and**
   - (b) Emit a running structured extraction of every MISSION-FORMAT.md field detected so far, each tagged `confirmed` or `inferred`.
3. **Exit condition.** The interview ends once all **required** fields (see §3 below) are `confirmed` — either because the student stated them directly, or because she confirmed an inference the assistant proposed ("يعني هدفك 90+ في القدرات؟" → "أيوه"). Typically 4–7 turns.
4. **Structured output → editable review screen.** Before writing to `missions`, the extracted structure is shown back to the student as an editable summary (satisfies "editable" in FR-01) — she can correct any field before it's saved.
5. **Write.** On confirmation, insert into `missions` with `status = 'active'`. If a prior mission exists for this student, set its `status = 'superseded'` and its `superseded_by` to the new row's id (per the schema's supersession pattern).

---

## 3. Field Requirements (mapped to `missions` columns)

| Field | `missions` column | Required to exit interview? | Extraction strategy |
|---|---|---|---|
| Target program/university | `target_program`, `target_university` | No — nullable in schema | Extract if mentioned; don't force it (some students genuinely don't know yet) |
| Target score | `target_score` | **Yes** | If student names a program instead of a score, infer a typical threshold and *confirm* it explicitly rather than silently substituting it |
| Exam date | `exam_date` | **Yes** | If vague ("this semester"), ask a direct follow-up — this field feeds pacing logic downstream, so it can't stay fuzzy |
| Weekly study hours | `weekly_study_hours` | **Yes** | Direct question if not volunteered |
| Current level (self-report) | `current_level_self_report` | No | Free text, captured verbatim, not parsed into structure — it's context for the diagnostic, not a hard constraint |
| Success criteria | `success_criteria` (jsonb array) | No | Anything phrase like "I just need to pass" or "I want a full scholarship" — captured as a short list |
| Constraints | `constraints` (jsonb) | No | e.g., "no study on Fridays," "only evenings" — volunteered, never asked for by default (avoid making the interview feel like an interrogation) |
| Out of scope | `out_of_scope` | No | Rare; e.g., a student who's already strong in verbal and explicitly wants quantitative-only focus |

Only 3 of 8 fields are hard-required to exit — keeps the interview short (brief's own quality bar: "first visit to first personalized lesson in under ten minutes," and the interview is only one part of that budget).

---

## 4. API Call Shape (structured output pattern)

Every turn after the opener uses one Claude API call with a JSON-only system prompt (per the platform's structured-outputs pattern), so the service layer never has to regex-parse prose:

```javascript
const response = await fetch("https://api.anthropic.com/v1/messages", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    model: "claude-sonnet-4-6",
    max_tokens: 1000,
    system: MISSION_INTERVIEWER_SYSTEM_PROMPT, // versioned in prompts/ per §7's "prompts are code"
    messages: [...conversationHistory, { role: "user", content: studentMessage }],
  })
});
```

Expected structured content back (JSON-only, per the system prompt's instruction):
```json
{
  "next_message_to_student": "يعني تقريبًا شهر ونص باقي على الاختبار؟",
  "extracted": {
    "target_score": { "value": 92, "status": "inferred" },
    "exam_date": { "value": "2026-08-25", "status": "inferred" },
    "weekly_study_hours": { "value": null, "status": "missing" },
    "target_program": { "value": "طب", "status": "confirmed" }
  },
  "interview_complete": false
}
```

The service layer checks `interview_complete` (all required fields `confirmed`, not `inferred`) rather than trying to infer completion itself — this keeps the "when do we stop asking" decision inside the versioned prompt, where it's easy to tune, rather than hardcoded service logic.

---

## 5. Guardrails Specific to This Flow

- **No PII beyond `display_name` reaches the model** (NFR, §6): the conversation history sent to the API contains only what the student typed in the interview itself — never her account email, auth ID, or `student_id`.
- **Minors.** Per §10 of the brief, this flow does not proceed past mission-save for students under 18 without `parental_consent_at` set on the `students` row — the interview can run, but the final write step checks this first and blocks/redirects to a consent step if missing.
- **The assistant must not invent an exam date or score if the student won't give one.** After 2 follow-up attempts on a required field, exit anyway with that field `null` and flag the mission as `needs_followup = true` (this requires one more nullable boolean column — small addition, listed in §6 below) rather than looping indefinitely or fabricating a plausible-sounding default.

---

## 6. Schema Addendum

One small addition surfaced by this design — add to `02-schema.sql`'s `missions` table:

```sql
alter table missions add column needs_followup boolean not null default false;
```

Set `true` if the interview exited without all three required fields confirmed (per the guardrail above). The dashboard (Phase 2) should surface this as a gentle prompt to complete onboarding, rather than silently operating on incomplete data.

---

## 7. What Happens Right After (handoff to Diagnostic)

Once `missions.status = 'active'` and `needs_followup = false`, the service layer immediately creates the `sessions` row for the diagnostic (per `05-diagnostic-assessment.md`) — no separate "start diagnostic" button needed for the first-ever mission, since the brief's quality bar wants first-lesson-in-under-ten-minutes with no unnecessary stops.

If `needs_followup = true`, diagnostic still starts (missing fields don't block learning), but the dashboard flags the incomplete mission for later completion.
