# AI Architecture

## Summary

Every place this app talks to an LLM goes through the same two-layer
abstraction: `LlmClient` (src/llm/llmClient.ts) for the transport, and
`GroundingService` (src/services/groundingService.ts) for what context that
call is given. No service builds its own prompt-grounding logic or talks to
`fetch`/the Anthropic API directly.

## The `LlmClient` interface

```ts
interface LlmClient {
  complete(systemPrompt: string, userMessage: string, maxTokens?: number): Promise<string>;
  completeConversation(systemPrompt: string, turns: ConversationTurn[], maxTokens?: number): Promise<string>;
}
```

Two implementations:

- **`MockLlmClient`** — deterministic, offline, free. Used by default and by
  the test harness, so the pipeline logic (selection, validation,
  record-writing) is provable without network access or an API key.
- **`AnthropicLlmClient`** — real calls to `api.anthropic.com` using
  `claude-sonnet-4-6`, no SDK dependency (plain `fetch`). Requires
  `ANTHROPIC_API_KEY`.

Swapping one for the other is a single line at each service's construction
site — every service is written against the interface, never the concrete
class.

### Why `completeConversation` exists

Early versions flattened an entire back-and-forth into one giant "user" role
string (`"[assistant]: ...\n[student]: ..."`). Tested live, this caused the
model to lose track of its own earlier turns mid-conversation. Real
alternating `user`/`assistant` turns fixed it — this is the shape both the
mission interview and the ask-the-teacher chat use.

### JSON reliability

Two problems show up only against a real model (never against the mock):

1. **Markdown fencing.** Models frequently wrap "JSON-only" responses in
   ` ```json ... ``` ` despite explicit instructions not to, sometimes with a
   preamble sentence first. `stripJsonFence()` finds and unwraps the fenced
   block, or isolates the outermost `{...}`/`[...]` as a fallback, before
   `JSON.parse`.
2. **Retry policy.** `completeJsonWithRetry()` is the one retry loop every
   "call the LLM, parse JSON, use it" call site shares (up to 3 attempts by
   default) instead of each service hand-rolling its own.

### Never a visibly broken response

If every retry still fails, generation call sites fall back to
`getFallbackItem()` — a real, legitimate Qudrat-style question, not a
"generation failed" placeholder. A student (or a demo audience) should never
see proof that generation broke.

### Math-text sanitization

`sanitizeMathText()` is a defensive net for LaTeX/Markdown artifacts
(`\frac{}{}`, `\sqrt{}`, `**bold**`, stray backslashes, etc.) that can leak
into student-facing Arabic text even with explicit "no LaTeX/Markdown"
instructions in the prompt. It is not a full LaTeX parser — it targets the
patterns that actually show up in short MCQ stems/options.

## Which services call the LLM

`missionInterviewService`, `diagnosticService`, `lessonGeneratorService`,
`mockExamService`, `askTeacherService`, and the hint-generation path in
`httpServer.ts` are the real LLM call sites. Every one of them appends
`groundingService.build(context)` to its own task-specific system prompt —
see [Grounded AI Pipeline](grounded-ai-pipeline.md) for what that block
contains and why it exists as a single shared service.

## Independent-solver validation

The lesson generator's practice items go through an independent-solver check
— the model is asked to solve its own generated question separately, and if
too many items disagree with their stated answer key, generation retries
(up to 2x) before falling back to deterministic-only checks. Against
`MockLlmClient` this uses a lookup table; against `AnthropicLlmClient` it's a
genuine independent solve.
