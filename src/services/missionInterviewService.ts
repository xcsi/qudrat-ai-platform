// ============================================================
// Mission Interview service — implements database/06-mission-interview.md
// FR-01: conversational onboarding producing a structured, editable mission.
// ============================================================

import { InMemoryStore } from '../store/InMemoryStore';
import { LlmClient, ConversationTurn, stripJsonFence, sanitizeMathText, JSON_FORMAT_REMINDER_TURN } from '../llm/llmClient';
import { Mission } from '../types';
import { GroundingService } from './groundingService';

const MISSION_INTERVIEWER_SYSTEM_PROMPT = `MISSION_INTERVIEWER
You are a real Qudrat tutor texting with a Saudi student for the first time —
warm, curious, human. Your job: extract target_score, exam_date, and
weekly_study_hours (required), plus target_program/university, constraints, and
success_criteria if volunteered (not required).

CONTEXT YOU ALREADY KNOW: this app exists for ONE exam only — the Saudi Qudrat
exam (اختبار القدرات / GAT), quantitative section. The student is already here
for that reason; they do not need to say which exam, and you must NEVER
ask "which exam" or express any doubt/confusion about it. Any mention of
"القدرات" or "قدرات" — however brief or loosely phrased — always means this
exam; treat it as already known context, not something to extract or confirm.

GENDER NEUTRALITY (non-negotiable): the student's gender is unknown by default.
Never use gendered second-person Arabic verb forms or adjectives (e.g. avoid
"تقدرين"/"جاهزة"/"أحسنتِ"). Phrase every message so it works for anyone —
rephrase around the pronoun (masdar/noun-phrase constructions like "تسجيل
الدخول" not "سجّلي الدخول"), use plural/impersonal forms, or restructure the
sentence entirely. This applies to "next_message_to_student" specifically.

TONE (non-negotiable): sound like a person texting on WhatsApp, not an AI
assistant and not a form. Never say "As an AI", never summarize back everything
you've extracted so far, never sound like you're reading a checklist out loud.
React briefly to what the student just said before asking the next thing (e.g.
"طب جميل!" / "تمام"), the way a real tutor would, then ask ONE small, natural
question — never a list of questions.

CRITICAL — read the ENTIRE conversation history before deciding a field's status.
If the student already gave a value for a field in ANY earlier turn (even a short
one like "100" or "20/8" or "8 hours"), mark that field "confirmed" — do NOT ask
for it again, ever, under any phrasing. Re-asking for information already given
is the single most important mistake to avoid here — a real tutor remembers
what you just told them.

DATE HANDLING: today's actual date is provided in the user message context below.
Resolve any relative date the student gives ("next month", "20/8", "in three
weeks") against THAT actual date, never against your own training data's sense
of "today."

FORMATTING RULE (non-negotiable): this text is displayed directly in a mobile
chat bubble, NOT rendered as Markdown. NEVER use Markdown syntax (**bold**,
numbered-emoji lists like 1️⃣2️⃣3️⃣, # headers, bullet lists). Write ONE short,
natural, conversational message — 1-2 sentences, asking for AT MOST one missing
piece of information at a time, the way a real person texts, not a form with
multiple numbered questions at once.

Respond ONLY with JSON:
{
  "next_message_to_student": "...",
  "extracted": {
    "target_score": {"value": number|null, "status": "confirmed"|"inferred"|"missing"},
    "exam_date": {"value": "YYYY-MM-DD"|null, "status": "..."},
    "weekly_study_hours": {"value": number|null, "status": "..."},
    "target_program": {"value": string|null, "status": "..."}
  },
  "interview_complete": boolean
}
interview_complete is true only when target_score, exam_date, and weekly_study_hours
are all "confirmed" (not merely "inferred") — but as soon as all three are confirmed,
set this true immediately, don't keep chatting.`;

export interface ExtractedField<T> {
  value: T | null;
  status: 'confirmed' | 'inferred' | 'missing';
}

export interface MissionExtraction {
  next_message_to_student: string;
  extracted: {
    target_score: ExtractedField<number>;
    exam_date: ExtractedField<string>;
    weekly_study_hours: ExtractedField<number>;
    target_program: ExtractedField<string>;
  };
  interview_complete: boolean;
}

const REQUIRED_FIELDS = ['target_score', 'exam_date', 'weekly_study_hours'] as const;

/** Runtime shape check on the model's response — TypeScript's `as MissionExtraction`
 *  cast only checks types at compile time; a real model can return valid JSON that's
 *  still missing a field or has the wrong shape, which used to crash downstream
 *  (finalizeMission reading `.status` off `undefined`) instead of triggering a retry. */
function isValidExtraction(parsed: any): parsed is MissionExtraction {
  if (!parsed || typeof parsed !== 'object') return false;
  if (typeof parsed.next_message_to_student !== 'string' || !parsed.next_message_to_student.trim()) return false;
  if (typeof parsed.interview_complete !== 'boolean') return false;
  const ex = parsed.extracted;
  if (!ex || typeof ex !== 'object') return false;
  return ['target_score', 'exam_date', 'weekly_study_hours', 'target_program'].every(
    (field) => ex[field] && typeof ex[field] === 'object' && typeof ex[field].status === 'string'
  );
}

/** Shown only if every retry below is exhausted — an in-character line a real tutor
 *  would actually say, never a JSON blob, an English apology, or a stack trace. */
const RECOVERY_EXTRACTION: MissionExtraction = {
  next_message_to_student: 'عذرًا، ما وصلتني بوضوح — ممكن إعادة الفكرة بطريقة ثانية؟',
  extracted: {
    target_score: { value: null, status: 'missing' },
    exam_date: { value: null, status: 'missing' },
    weekly_study_hours: { value: null, status: 'missing' },
    target_program: { value: null, status: 'missing' },
  },
  interview_complete: false,
};

export class MissionInterviewService {
  constructor(private store: InMemoryStore, private llm: LlmClient, private grounding: GroundingService) {}

  /**
   * Processes exactly ONE turn of the conversation — the real, HTTP-friendly shape.
   * Call this once per message the student sends; the caller (e.g. the web server)
   * keeps the running turns array and decides what to do with `interview_complete`
   * (show the next question, or call finalizeMission()).
   *
   * Takes a real array of alternating user/assistant turns (not a flattened string)
   * — see AnthropicLlmClient.completeConversation for why: a flattened single-message
   * transcript was the actual root cause of the model losing context mid-interview.
   *
   * Retries automatically (network error, unparseable JSON, or wrong shape all count
   * the same) before ever falling back to RECOVERY_EXTRACTION — this never throws,
   * so a single bad model response can no longer surface as a broken conversation.
   */
  async processTurn(turns: ConversationTurn[]): Promise<MissionExtraction> {
    // Version 5: routed through the same shared GroundingService as every
    // other AI call site — lower-stakes here (this is intake conversation,
    // not content-answering), but still not exempt: if the conversation
    // veers into "what's on the exam," the interviewer should still only
    // state facts the trusted sources actually support.
    const systemPromptWithDate =
      `${MISSION_INTERVIEWER_SYSTEM_PROMPT}\n\n[Today's actual date: ${new Date().toISOString().slice(0, 10)}]\n\n${this.grounding.build({})}`;
    const MAX_ATTEMPTS = 3;
    let lastErr: unknown;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        // On a retry, append an ephemeral corrective reminder as a trailing user
        // turn (not saved into the real conversation) — this model rejects
        // assistant-message prefill outright, so this is the fallback nudge back
        // into the required JSON shape after a plain-prose response.
        const attemptTurns = attempt === 1 ? turns : [...turns, JSON_FORMAT_REMINDER_TURN];
        const raw = await this.llm.completeConversation(systemPromptWithDate, attemptTurns);
        const parsed = JSON.parse(stripJsonFence(raw));
        if (!isValidExtraction(parsed)) throw new Error('Mission interview response failed shape validation');
        parsed.next_message_to_student = sanitizeMathText(parsed.next_message_to_student);
        return parsed;
      } catch (err) {
        lastErr = err;
        console.warn(`Mission interview turn attempt ${attempt}/${MAX_ATTEMPTS} failed: ${(err as Error)?.message ?? err}`);
      }
    }

    console.error('Mission interview: all attempts failed, using in-character recovery message.', lastErr);
    return RECOVERY_EXTRACTION;
  }

  /** Saves the final extraction as a Mission row. Call once processTurn() returns interview_complete=true. */
  async finalizeMission(studentId: string, extraction: MissionExtraction): Promise<Mission> {
    const needsFollowup = REQUIRED_FIELDS.some((f) => extraction.extracted[f]?.status !== 'confirmed');

    // §5 guardrail: for under-18 students, block save without parental consent.
    const student = this.store.students.find((s) => s.id === studentId);
    if (student?.grade_level && student.grade_level <= 12 && !student.parental_consent_at) {
      throw new Error(
        'Cannot save mission: student appears to be a minor and parental_consent_at is not set (brief §10 constraint).'
      );
    }

    return this.store.createMission({
      student_id: studentId,
      target_university: null,
      target_program: extraction.extracted.target_program.value,
      target_score: extraction.extracted.target_score.value ?? 0,
      exam_date: extraction.extracted.exam_date.value ?? new Date().toISOString().slice(0, 10),
      weekly_study_hours: extraction.extracted.weekly_study_hours.value ?? 0,
      current_level_self_report: null,
      success_criteria: [],
      constraints: {},
      out_of_scope: null,
      needs_followup: needsFollowup,
    });
  }

  /**
   * Convenience wrapper for the automated test harness only, where there's no real
   * human to reply turn-by-turn: it loops processTurn() with a synthetic placeholder
   * reply until the mock/real model reports completion, then finalizes. The real web
   * app should call processTurn() + finalizeMission() directly instead (see
   * server/httpServer.ts handleMission) so the student actually drives the conversation.
   */
  async conductInterview(studentId: string, openerFromStudent: string, maxTurns = 5): Promise<Mission> {
    let turnCount = 0;
    let lastExtraction: MissionExtraction | null = null;
    const turns: ConversationTurn[] = [{ role: 'user', content: openerFromStudent }];

    while (turnCount < maxTurns) {
      lastExtraction = await this.processTurn(turns);
      turnCount++;
      if (lastExtraction.interview_complete) break;
      turns.push({ role: 'assistant', content: lastExtraction.next_message_to_student });
      turns.push({ role: 'user', content: '(متابعة)' });
    }

    if (!lastExtraction) throw new Error('Mission interview produced no extraction');
    return this.finalizeMission(studentId, lastExtraction);
  }
}
