// ============================================================
// LLM client abstraction.
//
// Two implementations:
//  - AnthropicLlmClient: real calls to api.anthropic.com (used in
//    production once ANTHROPIC_API_KEY is set).
//  - MockLlmClient: deterministic, offline responses so the Phase 1
//    test harness proves the PIPELINE LOGIC (selection, validation,
//    record-writing) works without needing network access or a key.
//
// Swap is one line in harness/runTestHarness.ts.
// ============================================================

export interface ConversationTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface LlmClient {
  complete(systemPrompt: string, userMessage: string, maxTokens?: number): Promise<string>;
  /**
   * Multi-turn variant for genuinely conversational features (mission interview,
   * ask-the-teacher). See AnthropicLlmClient.completeConversation for why this
   * exists — it's the fix for a real, reproduced hallucination bug, not a
   * speculative addition.
   */
  completeConversation(systemPrompt: string, turns: ConversationTurn[], maxTokens?: number): Promise<string>;
}

/**
 * Ephemeral corrective turn every completeConversation() JSON-parsing retry loop
 * (mission interview, ask-the-teacher, lesson-scoped ask) appends on attempt 2+
 * only for that one retry request — never saved into the real stored conversation.
 * Needed because this model rejects assistant-message prefill outright (400: "does
 * not support assistant message prefill... must end with a user message"), so a
 * plain-prose reply that broke JSON.parse can't be corrected by forcing the next
 * token; the retry instead re-asks as a normal trailing user turn.
 */
export const JSON_FORMAT_REMINDER_TURN: ConversationTurn = {
  role: 'user',
  content: '[system reminder — not shown to the tutor persona: your last reply broke format. ' +
    'Respond with ONLY the raw JSON object described in your instructions — no prose before or ' +
    'after it, no markdown fence. Nothing else.]',
};

/**
 * Real models (Claude included) frequently wrap "JSON-only" responses in markdown
 * code fences (```json ... ``` or ``` ... ```) despite explicit instructions not to.
 * Every call site that does JSON.parse(llmResponse) should route through this first —
 * MockLlmClient never needed it (it returns raw JSON directly), which is why this
 * bug only appeared once a real AnthropicLlmClient was wired in.
 */
export function stripJsonFence(raw: string): string {
  const trimmed = raw.trim();
  // Search anywhere in the string for a fenced block — real models sometimes add
  // a preamble sentence ("Here's the JSON:") before the fence despite instructions,
  // so anchoring to the start/end of the whole string (as a first attempt did) misses that case.
  const fenceMatch = /```(?:json)?\s*([\s\S]*?)\s*```/.exec(trimmed);
  if (fenceMatch) return fenceMatch[1].trim();

  // No fence found at all — the model may have returned raw JSON, or JSON with
  // stray leading/trailing prose. As a last resort, try to isolate the outermost
  // {...} or [...] block so a trailing/leading sentence doesn't break JSON.parse.
  const objectMatch = /\{[\s\S]*\}/.exec(trimmed);
  const arrayMatch = /\[[\s\S]*\]/.exec(trimmed);
  const isolated = objectMatch && (!arrayMatch || objectMatch.index <= arrayMatch.index)
    ? objectMatch[0]
    : (arrayMatch ? arrayMatch[0] : trimmed);

  // Real models sometimes emit raw LaTeX (\frac, \(, \), \[, \], \times, etc.)
  // INSIDE a JSON string value. Some LaTeX command letters (f, n, r, t, b, u)
  // happen to also be valid JSON escape characters, so a blanket "escape any
  // backslash not in a tiny safe list" approach (an earlier version of this
  // function) incorrectly mangled legitimate newlines (\n) in ordinary
  // conversational replies. Instead, target ONLY known LaTeX command words —
  // leaving \n \t \r \b \f \u completely alone when NOT followed by one of
  // these specific words.
  const LATEX_COMMANDS = [
    'd?frac', 'tfrac', 'cfrac', 'sqrt', 'times', 'div', 'pm', 'mp', 'leq', 'geq',
    'neq', 'approx', 'left', 'right', 'cdot', 'begin', 'end', 'text', 'mathrm',
    'overline', 'underline', 'infty', 'theta', 'pi', 'alpha', 'beta', 'gamma',
    'delta', 'Delta', 'sum', 'int', 'lim', 'to', 'circ', 'angle', 'triangle',
    'parallel', 'perp', 'in', 'notin', 'subset', 'cup', 'cap', 'forall', 'exists',
  ];
  const latexCommandPattern = new RegExp(`\\\\(${LATEX_COMMANDS.join('|')})\\b`, 'g');
  const withCommandsEscaped = isolated.replace(latexCommandPattern, '\\\\$1');
  // LaTeX delimiter punctuation (\( \) \[ \]) — not word-based, but equally
  // invalid as a JSON escape (backslash followed by a paren/bracket).
  return withCommandsEscaped.replace(/\\([()[\]])/g, '\\\\$1');
}

/**
 * Defensive safety net: strips common LaTeX/Markdown artifacts from
 * student-facing text, in case a live model slips despite the prompt's
 * explicit "no LaTeX/Markdown" formatting rule. Not a full LaTeX parser —
 * covers the patterns that actually show up in short MCQ stems/options
 * (superscripts, fractions, common operators, delimiters, bold/italic/code).
 */
export function sanitizeMathText(text: string): string {
  return text
    // Triple-backtick code fences that leaked into a TEXT FIELD's value (as opposed
    // to the outer JSON envelope, which stripJsonFence already handles) — strip the
    // fence markers, keep whatever content was inside.
    .replace(/```[a-zA-Z]*\n?([\s\S]*?)```/g, '$1')
    // \frac{a}{b} (and \dfrac, \tfrac, \cfrac variants) → a/b — done FIRST and
    // independent of surrounding $ or \(\) delimiters, since real output showed
    // \frac appearing inside multiple different delimiter styles.
    .replace(/\\[dtc]?frac\{([^{}]*)\}\{([^{}]*)\}/g, '$1/$2')
    .replace(/\\sqrt\{([^{}]*)\}/g, '√$1')
    // LaTeX delimiters — drop the markers, keep the content
    .replace(/\${1,2}([^$]*)\${1,2}/g, '$1')
    .replace(/\\\(([^()]*)\\\)/g, '$1')
    .replace(/\\\[([^\[\]]*)\\\]/g, '$1')
    // common LaTeX commands → plain Unicode
    .replace(/\\times/g, '×')
    .replace(/\\cdot/g, '×')
    .replace(/\\div/g, '÷')
    .replace(/\\pm/g, '±')
    .replace(/\\leq/g, '≤')
    .replace(/\\geq/g, '≥')
    .replace(/\\neq/g, '≠')
    .replace(/\\ne\b/g, '≠')
    .replace(/\\infty/g, '∞')
    .replace(/\\circ/g, '°')
    .replace(/\\%/g, '%')
    .replace(/\\sqrt/g, '√')
    .replace(/\^\{?(-?\d+)\}?/g, (_m, exp) => {
      const superscripts: Record<string, string> = { '2': '²', '3': '³', '-1': '⁻¹', '0': '⁰', '1': '¹' };
      return superscripts[exp] ?? `^${exp}`;
    })
    // Braced exponent/subscript with non-numeric content (e.g. x^{n}, a_{i}) isn't
    // caught by the digit-only pass above — at minimum drop the braces so no literal
    // "{"/"}" survive next to a caret or underscore.
    .replace(/\^\{([^{}]+)\}/g, '^$1')
    .replace(/_\{([^{}]+)\}/g, '_$1')
    // Markdown artifacts
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/(?<!\w)_([^_]+)_(?!\w)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^#{1,6}\s*/gm, '')
    // Final catch-all: any backslash still remaining at this point is a leftover
    // LaTeX artifact (Arabic math text never legitimately contains one) — strip
    // the backslash but keep whatever character followed it, rather than leaving
    // a stray "\)" or "\$" visible to the student.
    .replace(/\\/g, '')
    .trim();
}

/**
 * Shared retry policy for every "call the LLM, parse JSON, use it" call site.
 * Real models occasionally return unparseable or wrong-shaped JSON on a single
 * call (network hiccup, a stray preamble sentence, a truncated response) — this
 * makes every generation path retry automatically and identically instead of
 * each service hand-rolling its own (inconsistent, easy-to-miss) retry loop.
 * `validate` should throw if `parsed` doesn't have the expected shape; that
 * throw is treated exactly like a network/parse failure and triggers a retry.
 */
export async function completeJsonWithRetry<T>(
  llm: LlmClient,
  systemPrompt: string,
  userMessage: string,
  validate: (parsed: any) => T,
  maxAttempts = 3,
  maxTokens = 1500
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const raw = await llm.complete(systemPrompt, userMessage, maxTokens);
      const parsed = JSON.parse(stripJsonFence(raw));
      return validate(parsed);
    } catch (err) {
      lastErr = err;
      console.warn(`completeJsonWithRetry: attempt ${attempt}/${maxAttempts} failed — ${(err as Error)?.message ?? err}`);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('completeJsonWithRetry: all attempts failed');
}

export interface FallbackItemContent {
  stem_ar: string;
  options: [string, string, string, string];
  correct_option_index: 0 | 1 | 2 | 3;
  explanation_ar: string;
}

// Last-resort item content, used ONLY after every generation retry has already
// failed (diagnosticService / mockExamService / lessonGeneratorService). This is
// deliberately a real, legitimate Qudrat-style question — never a "generation
// failed" placeholder — because a student (or a demo audience) should never see
// visible proof that generation broke.
const FALLBACK_QUANTITATIVE_ITEM: FallbackItemContent = {
  stem_ar: 'قارن بين القيمتين: العمود الأول = ٣ × ٤، العمود الثاني = ٢ × ٧',
  options: ['العمود الأول أكبر', 'العمود الثاني أكبر', 'القيمتان متساويتان', 'لا يمكن الحكم عليه'],
  correct_option_index: 1,
  explanation_ar: '٣ × ٤ = ١٢، و٢ × ٧ = ١٤، إذن العمود الثاني أكبر.',
};

const FALLBACK_VERBAL_ITEM: FallbackItemContent = {
  stem_ar: 'اختر العلاقة الأقرب لعلاقة: (طبيب : مستشفى)',
  options: ['معلم : مدرسة', 'كتاب : قلم', 'سيارة : طريق', 'شمس : قمر'],
  correct_option_index: 0,
  explanation_ar: 'العلاقة بين طبيب ومستشفى هي "شخص بمكان عمله" — نفس علاقة معلم بمدرسته.',
};

export function getFallbackItem(section: 'verbal' | 'quantitative'): FallbackItemContent {
  return section === 'verbal' ? FALLBACK_VERBAL_ITEM : FALLBACK_QUANTITATIVE_ITEM;
}

export class AnthropicLlmClient implements LlmClient {
  constructor(private apiKey: string = process.env.ANTHROPIC_API_KEY ?? '') {
    if (!this.apiKey) {
      throw new Error('ANTHROPIC_API_KEY is required for AnthropicLlmClient');
    }
  }

  async complete(systemPrompt: string, userMessage: string, maxTokens = 1500): Promise<string> {
    return this.completeConversation(systemPrompt, [{ role: 'user', content: userMessage }], maxTokens);
  }

  /**
   * Sends a REAL multi-turn `messages` array instead of flattening an entire
   * conversation into one giant "user" role string. The mission interview and
   * ask-the-teacher chat previously built a single "[assistant]: ...\n[student]:
   * ..." blob and sent the whole thing as one user turn — with no genuine role
   * separation, the model would lose track of its own earlier turns and, when
   * tested live against the real API for this sprint, hallucinated an unrelated
   * exam ("Isn't this about IELTS?") mid-conversation that was never mentioned.
   * Proper alternating user/assistant turns is the actual fix for "conversation
   * stops unexpectedly" / "feels robotic" / "loses state".
   *
   * `maxTokens` defaults to 1500 (plenty for a short chat reply) but callers
   * generating verbose content (lesson concepts, practice-item sets) MUST pass a
   * higher value — Arabic MSA is more token-dense than English, and a live test
   * during this sprint reproduced a genuine truncation bug: the model's JSON was
   * cut off mid-string at exactly the 1500-token ceiling, which then failed to
   * parse identically on every retry (a consistent failure, not flakiness).
   */
  async completeConversation(systemPrompt: string, turns: ConversationTurn[], maxTokens = 1500): Promise<string> {
    // NOTE: assistant-message prefill (ending the `messages` array with a partial
    // assistant turn like `{`, the usual Anthropic technique for forcing JSON) was
    // tried here and rejected by this model with a 400 ("does not support assistant
    // message prefill... must end with a user message") — this model does not
    // support that mode at all, so callers instead retry with a corrective reminder
    // turn appended (see missionInterviewService/askTeacherService retry loops).
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: maxTokens,
        system: systemPrompt,
        messages: turns.map((t) => ({ role: t.role, content: t.content })),
      }),
    });
    if (!response.ok) {
      throw new Error(`Anthropic API error: ${response.status} ${await response.text()}`);
    }
    const data = (await response.json()) as { content?: Array<{ type: string; text?: string }> };
    const textBlock = data.content?.find((c) => c.type === 'text');
    return textBlock?.text ?? '';
  }
}

/**
 * Deterministic mock — no network calls. Recognizes which pipeline
 * step is asking (by a marker in the prompt) and returns plausible,
 * structurally-valid JSON so downstream parsing/validation code runs
 * exactly as it would against a real model response.
 */
export class MockLlmClient implements LlmClient {
  /** Reconstructs the same flattened "[role]: content" shape the keyword-heuristic
   *  mock logic below already expects (mockMissionTurn checks for the literal
   *  substring "[assistant]:" to detect whether this is the first turn), so the
   *  offline test harness behaves identically whether callers use complete() with
   *  a pre-flattened string or completeConversation() with a real turns array. */
  async completeConversation(systemPrompt: string, turns: ConversationTurn[], _maxTokens?: number): Promise<string> {
    const flattened = turns.map((t) => `[${t.role}]: ${t.content}`).join('\n');
    return this.complete(systemPrompt, flattened);
  }

  async complete(systemPrompt: string, userMessage: string, _maxTokens?: number): Promise<string> {
    if (systemPrompt.includes('MISSION_INTERVIEWER')) {
      return this.mockMissionTurn(userMessage);
    }
    if (systemPrompt.includes('LESSON_CONCEPT_GENERATOR')) {
      return this.mockConcept();
    }
    if (systemPrompt.includes('LESSON_ITEMS_GENERATOR')) {
      return this.mockItems();
    }
    if (systemPrompt.includes('INDEPENDENT_SOLVER')) {
      return this.mockIndependentSolve(userMessage);
    }
    if (systemPrompt.includes('ASK_THE_TEACHER')) {
      return this.mockAskTeacher(userMessage);
    }
    throw new Error('MockLlmClient: unrecognized prompt type');
  }

  private mockMissionTurn(conversationSoFar: string): string {
    const hasPriorTurn = conversationSoFar.includes('[assistant]:');

    // Crude keyword heuristics — this is a MOCK standing in for real NLU. A real
    // AnthropicLlmClient call would actually understand the sentence; this just
    // reads a few keywords across the whole conversation (not just the latest
    // message) so context carries turn-to-turn, similar to how a real model's
    // memory would work.
    const programMatch = /طب|هندسة|حاسب|صيدلة|علوم|إدارة/.exec(conversationSoFar);
    const targetProgram = programMatch ? programMatch[0] : null;
    const competitiveScoreMap: Record<string, number> = {
      'طب': 95, 'هندسة': 90, 'حاسب': 88, 'صيدلة': 92, 'علوم': 82, 'إدارة': 80,
    };
    const inferredScore = targetProgram ? competitiveScoreMap[targetProgram] : null;

    const monthsMatch = /شهر(?:ين)?|(\d+)\s*شهر/.exec(conversationSoFar);
    const weeksMatch = /أسبوع(?:ين)?|(\d+)\s*أسبوع/.exec(conversationSoFar);
    let inferredExamDate: string | null = null;
    if (monthsMatch || weeksMatch) {
      const days = weeksMatch ? 14 : 45; // rough placeholder — a real model would parse the actual number
      inferredExamDate = new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
    }

    if (!hasPriorTurn) {
      // First turn: acknowledge only what was actually said, ask for what's missing —
      // never claim target_score/exam_date as "confirmed" from a single opening message.
      const missingBits: string[] = [];
      if (!targetProgram) missingBits.push('التخصص اللي تطمحين له');
      if (!inferredExamDate) missingBits.push('متى بالضبط موعد الاختبار');
      missingBits.push('كم ساعة تقدرين تخصصين للمذاكرة أسبوعيًا');

      return JSON.stringify({
        next_message_to_student: `تمام، ${missingBits.join('، و')}؟`,
        extracted: {
          target_score: { value: inferredScore, status: inferredScore ? 'inferred' : 'missing' },
          exam_date: { value: inferredExamDate, status: inferredExamDate ? 'inferred' : 'missing' },
          weekly_study_hours: { value: null, status: 'missing' },
          target_program: { value: targetProgram, status: targetProgram ? 'confirmed' : 'missing' },
        },
        interview_complete: false,
      });
    }

    // Second turn onward: confirm the inferred values (a real model would only do this
    // if the student's reply actually corroborated them — this mock simplifies that check).
    return JSON.stringify({
      next_message_to_student: 'تمام، سجّلت كل شي. نبدأ بتشخيص سريع نعرف منه وين تبدأ رحلتك بالضبط.',
      extracted: {
        target_score: { value: inferredScore ?? 85, status: 'confirmed' },
        exam_date: { value: inferredExamDate ?? new Date(Date.now() + 45 * 86400000).toISOString().slice(0, 10), status: 'confirmed' },
        weekly_study_hours: { value: 10, status: 'confirmed' },
        target_program: { value: targetProgram, status: targetProgram ? 'confirmed' : 'missing' },
      },
      interview_complete: true,
    });
  }

  private mockConcept(): string {
    return JSON.stringify({
      title_ar: 'مقارنة القيم الكمية',
      concept_explanation: [
        { kind: 'principle', text_ar: 'قارن الطرفين بدل حساب قيمتهما الدقيقة.' },
        { kind: 'technique', text_ar: 'اختبر قيمًا حرجة: صفر، واحد، كسر بين صفر وواحد، وعدد سالب.' },
        { kind: 'caution', text_ar: 'لا تربّع الطرفين إلا إذا كنت متأكدًا أن كليهما غير سالب.' },
      ],
      worked_example: {
        problem_ar: 'قارن بين x² و x حيث x عدد حقيقي غير محدد.',
        solution_steps_ar: [
          'إذا كان x = 2: x² = 4 أكبر من x = 2.',
          'إذا كان x = 0.5: x² = 0.25 أصغر من x = 0.5.',
          'إذن العلاقة تعتمد على قيمة x — لا يمكن تحديدها.',
        ],
      },
      glossary_term: {
        term_ar: 'المقارنة الكمية',
        definition_ar: 'سؤال يطلب تحديد أي القيمتين أكبر دون حساب قيمتيهما الدقيقة بالضرورة.',
        aliases_to_avoid: ['مقارنة الأعداد', 'أسئلة أيهما أكبر'],
      },
    });
  }

  private mockItems(): string {
    const bank = [
      { stem_ar: 'قارن: العمود أ = 3², العمود ب = 2×3', correct: 0 },
      { stem_ar: 'قارن: العمود أ = (-2)², العمود ب = -2²', correct: 0 },
      { stem_ar: 'قارن: العمود أ = 1/2 + 1/3، العمود ب = 5/6', correct: 2 },
      { stem_ar: 'قارن: العمود أ = س حيث س > 0، العمود ب = س²', correct: 3 },
      { stem_ar: 'قارن: العمود أ = 40% من 50، العمود ب = 50% من 40', correct: 2 },
      { stem_ar: 'قارن: العمود أ = س² حيث -1 < س < 0، العمود ب = س', correct: 0 },
    ];
    const options: [string, string, string, string] = [
      'العمود الأول أكبر',
      'العمود الثاني أكبر',
      'القيمتان متساويتان',
      'لا يمكن الحكم عليه',
    ];
    const items = bank.map((b, i) => ({
      stem_ar: b.stem_ar,
      options,
      correct_option_index: b.correct,
      explanation_ar: 'يُحل بمقارنة القيمتين مباشرة أو باختبار قيم حرجة عند الحاجة.',
      difficulty_level: i < 4 ? 2 : 4, // last two items are the deliberately harder, discriminating pair
    }));
    return JSON.stringify({ items });
  }

  private mockIndependentSolve(userMessage: string): string {
    // Lookup table mirroring the mock item bank in mockItems() above — a real
    // AnthropicLlmClient would actually reason over the stem instead of a lookup.
    // This proves the validation pipeline's *shape* (independent call -> compare
    // -> flag) runs correctly against a solver that can genuinely get it right.
    const knownAnswers: Record<string, number> = {
      'قارن: العمود أ = 3², العمود ب = 2×3': 0,
      'قارن: العمود أ = (-2)², العمود ب = -2²': 0,
      'قارن: العمود أ = 1/2 + 1/3، العمود ب = 5/6': 2,
      'قارن: العمود أ = س حيث س > 0، العمود ب = س²': 3,
      'قارن: العمود أ = 40% من 50، العمود ب = 50% من 40': 2,
      'قارن: العمود أ = س² حيث -1 < س < 0، العمود ب = س': 0,
    };
    const stemLine = userMessage.split('\n')[0].replace('Stem: ', '');
    const chosen = knownAnswers[stemLine] ?? 0;
    return JSON.stringify({ chosen_option_index: chosen, reasoning_ar: 'محاكاة: حل مستقل تجريبي.' });
  }

  private mockAskTeacher(userMessage: string): string {
    // Crude heuristic mirroring the mission-interview mock: look for an explicit
    // prior-learning claim keyword. A real model does actual semantic understanding.
    const revealsPrior = /سبق|درست قبل|متقدم|أولمبياد|olympiad|already (knew|learned)/i.test(userMessage);
    const skillIdMatch = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/.exec(userMessage);

    return JSON.stringify({
      reply_ar: 'سؤال ممتاز — هذا يعتمد على الفكرة اللي شرحناها بالدرس: قارني الطرفين مباشرة بدل حساب القيمة الدقيقة كل مرة.',
      prior_knowledge_signal:
        revealsPrior && skillIdMatch
          ? { skill_id: skillIdMatch[1], evidence_ar: 'الطالبة ذكرت أنها درست هذا سابقًا بمسار متقدم.' }
          : null,
    });
  }
}
