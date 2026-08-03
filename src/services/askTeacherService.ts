// ============================================================
// Ask-the-Teacher Service — implements FR-12: "free-form chat
// grounded in the student's mission and records, for follow-up
// questions after any lesson."
//
// This also unlocks the one learning-record type that was deferred
// in 08-learning-record-writer.md §2.3 (prior_knowledge_revealed),
// which explicitly depends on this chat feature existing.
// ============================================================

import { InMemoryStore } from '../store/InMemoryStore';
import { LlmClient, ConversationTurn, sanitizeMathText, stripJsonFence, JSON_FORMAT_REMINDER_TURN } from '../llm/llmClient';
import { GroundingService } from './groundingService';

const ASK_TEACHER_SYSTEM_PROMPT = `ASK_THE_TEACHER
You are a warm, encouraging Qudrat tutor answering a student's free-form
follow-up question in formal Arabic (MSA). For math/verbal reasoning
questions, answer from general academic knowledge.

(Grounding rules for exam-fact claims are appended below this prompt by the
shared GroundingService — see the GROUNDING RULES section.)

FORMATTING RULE (non-negotiable): this text is displayed directly in a mobile
chat bubble, NOT rendered as Markdown or LaTeX. NEVER use Markdown syntax
(**bold**, numbered-emoji lists, # headers), NEVER use LaTeX math delimiters
($...$, \\(...\\)). Write math using plain Unicode characters only: x², √x,
×, ÷, ½ — exactly as a student would see it printed in a book. Keep the reply
short and conversational (2-4 sentences), like a real chat message, not an
essay.

You are also watching for one specific signal: does the student's message
reveal that they ALREADY understood a concept before it was taught here
(e.g. "we covered this in my advanced track at school", "I already know
this from math olympiad prep")? This is different from just answering a
question correctly — it is an explicit disclosure of pre-existing
knowledge. If so, and if you can match it to ONE specific skill from the
list provided, flag it. If uncertain or it's a generic "I understand" with
no specific prior-learning claim, do NOT flag it — false positives here are
worse than missing one.

GENDER NEUTRALITY (non-negotiable): the student's gender is unknown by
default. Never use gendered second-person Arabic verb forms or adjectives
(avoid "تقدرين"/"جاهزة"/"أحسنتِ"). Rephrase around the pronoun (masdar/noun-
phrase constructions), use plural/impersonal forms, or restructure the
sentence — never guess a gender.

Respond ONLY with JSON:
{"reply_ar": "...",
 "prior_knowledge_signal": {"skill_id": "...", "evidence_ar": "..."} | null}`;

interface AskTeacherResponse {
  reply_ar: string;
  prior_knowledge_signal: { skill_id: string; evidence_ar: string } | null;
}

// ============================================================
// Product-redesign addition: "Ask About This Lesson" — a lesson-scoped
// assistant, deliberately stricter than the general Ask-the-Teacher
// chat above. Grounded ONLY in the specific lesson's own content
// (concept_explanation + worked_example) plus relevant trusted
// resources — this is the concrete mechanism behind "AI must use
// curated lessons as its primary source of truth" and "do not answer
// unrelated topics from the global model." Reuses the same
// completeConversation/retry infrastructure, not a new architecture.
// ============================================================
const LESSON_SCOPED_ASSISTANT_PROMPT = `LESSON_SCOPED_ASSISTANT
You are a Qudrat tutor answering a student's question about ONE SPECIFIC
lesson — not a general tutor. The lesson's full content (concept explanation,
worked example) is provided below in the context (appended by the shared
GroundingService); that content, plus any trusted sources also provided, is
your ONLY source of truth.

STRICT GROUNDING RULE (non-negotiable): answer using ONLY the lesson content
and sources given below — never your own general/parametric knowledge, even
if you know the answer. If the student's question is genuinely unrelated to
this lesson's content (a different topic, a different skill, something the
lesson never covers), do NOT answer it — instead, gently say this assistant
only covers this specific lesson, and suggest using the general "اسأل
المعلم" chat for other questions. Do not guess what the question "probably
means" to stretch an unrelated question into something you can answer from
the lesson.

FORMATTING RULE (non-negotiable): displayed directly in a mobile chat bubble,
NOT rendered as Markdown or LaTeX. NEVER use Markdown syntax (**bold**, #
headers), NEVER use LaTeX math delimiters ($...$, \\(...\\)). Write math using
plain Unicode characters only: x², √x, ×, ÷, ½. Keep the reply short (2-4
sentences), like a real chat message.

GENDER NEUTRALITY (non-negotiable): the student's gender is unknown by
default. Never use gendered second-person Arabic verb forms or adjectives
(avoid "تقدرين"/"جاهزة"/"أحسنتِ"). Rephrase around the pronoun (masdar/noun-
phrase constructions), use plural/impersonal forms, or restructure the
sentence — never guess a gender.

Respond ONLY with JSON:
{"reply_ar": "...", "on_topic": boolean}`;

interface LessonScopedResponse {
  reply_ar: string;
  on_topic: boolean;
}

export class AskTeacherService {
  constructor(private store: InMemoryStore, private llm: LlmClient, private grounding: GroundingService) {}

  /**
   * Takes a real array of alternating user/assistant turns (not a flattened
   * string) — same fix as the mission interview, and for the same reason: a
   * single flattened "user" message was the actual cause of the model losing
   * conversational context. Session-level context (mission, trusted sources,
   * skill list) is folded into the system prompt instead of the user content,
   * since it's not something the student "said".
   */
  async processTurn(studentId: string, turns: ConversationTurn[]): Promise<{ replyAr: string; priorKnowledgeDetected: boolean }> {
    const mission = this.store.getActiveMission(studentId);
    const skillsList = this.store.skills.map((s) => `${s.id}: ${s.name_ar} (${s.category})`).join('\n');

    // Version 5: the shared GroundingService replaces this method's own inline
    // trusted-sources block. No specific lesson/item is relevant to a general
    // ask-teacher question, so an empty context is correct here — it still
    // returns trusted sources + the grounding rules.
    const systemPromptWithContext =
      `${ASK_TEACHER_SYSTEM_PROMPT}\n\n` +
      `Student mission: target_score=${mission?.target_score ?? 'unknown'}, exam_date=${mission?.exam_date ?? 'unknown'}\n\n` +
      `${this.grounding.build({})}\n\n` +
      `Available skill IDs (use one of these EXACTLY if flagging prior knowledge):\n${skillsList}`;

    const MAX_ATTEMPTS = 3;
    let parsed: AskTeacherResponse | null = null;
    let lastErr: unknown;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const attemptTurns = attempt === 1 ? turns : [...turns, JSON_FORMAT_REMINDER_TURN];
        const raw = await this.llm.completeConversation(systemPromptWithContext, attemptTurns);
        const candidate = JSON.parse(stripJsonFence(raw));
        if (!candidate || typeof candidate.reply_ar !== 'string' || !candidate.reply_ar.trim()) {
          throw new Error('Malformed ask-the-teacher response');
        }
        parsed = candidate as AskTeacherResponse;
        break;
      } catch (err) {
        lastErr = err;
        console.warn(`Ask-the-teacher attempt ${attempt}/${MAX_ATTEMPTS} failed: ${(err as Error)?.message ?? err}`);
      }
    }
    if (!parsed) {
      console.error('Ask-the-teacher: all attempts failed, using a graceful fallback reply.', lastErr);
      return {
        replyAr: 'عذرًا، ما قدرت أوصل لجواب واضح على سؤالك الحين — ممكن إعادة صياغته أو المحاولة مرة ثانية بعد شوي؟',
        priorKnowledgeDetected: false,
      };
    }

    let priorKnowledgeDetected = false;
    if (parsed.prior_knowledge_signal) {
      const { skill_id, evidence_ar } = parsed.prior_knowledge_signal;
      const skill = this.store.getSkill(skill_id);
      const existing = skill ? this.store.getActiveRecordForSkill(studentId, skill_id) : undefined;

      // Don't overwrite an already-confirmed record — a disclosure is weaker evidence
      // than demonstrated mastery, per the supersession principle in 08-learning-record-writer.md §4.
      if (skill && existing?.confidence !== 'confirmed') {
        await this.store.writeLearningRecord({
          student_id: studentId,
          skill_id,
          record_type: 'prior_knowledge_revealed',
          evidence: evidence_ar,
          source_session_id: null,
          confidence: 'tentative', // unverified disclosure — a lesson touch can later confirm it, same pattern as other record types
        });
        priorKnowledgeDetected = true;
      }
    }

    return { replyAr: sanitizeMathText(parsed.reply_ar), priorKnowledgeDetected };
  }

  /** "Ask About This Lesson" — grounded ONLY in the given lesson's own content
   *  plus matching trusted resources, never the general Ask-the-Teacher
   *  context (mission, full skill list). Version 5: takes `lessonId` (not the
   *  lesson's content spelled out as 3 loose params) — the shared
   *  GroundingService looks up and assembles the lesson's own content
   *  internally, the same way every other grounded call site does now. */
  async processLessonScopedTurn(lessonId: string, turns: ConversationTurn[]): Promise<{ replyAr: string; onTopic: boolean }> {
    const systemPromptWithLessonContext = `${LESSON_SCOPED_ASSISTANT_PROMPT}\n\n${this.grounding.build({ lessonId })}`;

    const MAX_ATTEMPTS = 3;
    let parsed: LessonScopedResponse | null = null;
    let lastErr: unknown;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const attemptTurns = attempt === 1 ? turns : [...turns, JSON_FORMAT_REMINDER_TURN];
        const raw = await this.llm.completeConversation(systemPromptWithLessonContext, attemptTurns);
        const candidate = JSON.parse(stripJsonFence(raw));
        if (!candidate || typeof candidate.reply_ar !== 'string' || !candidate.reply_ar.trim() || typeof candidate.on_topic !== 'boolean') {
          throw new Error('Malformed lesson-scoped assistant response');
        }
        parsed = candidate as LessonScopedResponse;
        break;
      } catch (err) {
        lastErr = err;
        console.warn(`Lesson-scoped assistant attempt ${attempt}/${MAX_ATTEMPTS} failed: ${(err as Error)?.message ?? err}`);
      }
    }
    if (!parsed) {
      console.error('Lesson-scoped assistant: all attempts failed, using a graceful fallback reply.', lastErr);
      return {
        replyAr: 'عذرًا، ما قدرت أفهم سؤالك بوضوح — ممكن إعادة صياغته؟',
        onTopic: true, // don't wrongly claim "off-topic" on a plain technical failure
      };
    }
    return { replyAr: sanitizeMathText(parsed.reply_ar), onTopic: parsed.on_topic };
  }
}
