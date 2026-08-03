# Grounded AI Pipeline

## The problem this solves

Before `GroundingService` existed, every LLM call site built its own
grounding independently: the lesson generator and the ask-the-teacher
service each filtered `store.resources` for trusted sources and joined the
same block, copy-pasted across files — while the mission interview, hint
prompts, and item-generation prompts injected no grounding at all. That's how
a tutoring product accidentally lets a model state an unsourced "fact" about
the real exam.

`GroundingService` (src/services/groundingService.ts) is the single place
that decides **what context an LLM call gets handed**, for any reason, by any
endpoint. It owns a different concern than the "reuse curated content before
generating" logic in `lessonGeneratorService`/`diagnosticService` — that
decides *which content to serve*; `GroundingService` decides *what the model
is told* whenever it's actually invoked.

## What `build()` assembles

```ts
groundingService.build({ skillId?, lessonId?, practiceItemId? })
```

returns a ready-to-append string built from up to three sections, always in
this order:

1. **Trusted sources block** — every `resources` row where `kind ===
   'knowledge'` (never `'wisdom'`/community sources for factual grounding),
   each flagged `[OFFICIAL ETEC]` or `[secondary, corroborating only]`. Empty
   context still returns this block — correct for e.g. the mission interview,
   which has no specific lesson/question attached yet.
2. **Lesson context block** *(if a lesson resolves)* — the lesson's concept
   blocks and worked example, so the model never contradicts what's already
   been taught for that skill.
3. **Question context block** *(if `practiceItemId` is given)* — the item's
   stem, correct answer, explanation, and any already-authored hints/common
   mistake/memory tip, so a live AI call about a curated question can never
   contradict content some students have already seen.

Every section is followed by a fixed, non-negotiable rules block:

- Any claim about the exam itself (structure, question counts, timing,
  scoring, official policy) **must** come from the trusted sources above, or
  be omitted entirely.
- General academic/reasoning techniques don't need a citation.
- Provided lesson/question context is the primary source of truth for that
  content.
- If something is outside both the grounding context and general academic
  knowledge, the model should say so rather than guess.

## Lesson resolution

If `lessonId` is given, that exact lesson is used. If only `skillId` is
given, `GroundingService` picks that skill's best available lesson using the
same quality ordering as `findReusableLesson`: `published` beats
`human_reviewed` beats `ai_generated`. This keeps grounding consistently
pointed at the most trustworthy version of a skill's content.

## Every real call site follows the same pattern

```ts
const systemPrompt = `${TASK_SPECIFIC_INSTRUCTIONS}\n\n${groundingService.build(context)}`;
```

No endpoint builds its own trusted-sources block or grounding language
independently — `missionInterviewService`, `diagnosticService`,
`lessonGeneratorService`, `mockExamService`, `askTeacherService`, and the
hint-generation path in `httpServer.ts` all call `build()` and append the
result.

## Downstream reliability

Grounding decides *what* the model is told; [AI Architecture](ai-architecture.md)
covers *how* that call is made reliable once it returns — JSON-fence
stripping, retry policy, math-text sanitization, and the never-visibly-broken
fallback content.
