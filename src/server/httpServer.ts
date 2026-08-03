// ============================================================
// Minimal demo API server — wraps the Phase 1 services so the
// Phase 2 frontend (public/index.html) has something real to call.
//
// Deliberately built on Node's built-in `http` module, not Express —
// zero new dependencies to install, so `npm run web` works immediately
// with what's already in this project.
//
// Single-demo-student simplification: one student is auto-created at
// startup (no auth). This is a demo skeleton, not a multi-tenant
// backend — see README's Phase 2 section for what real auth needs.
// ============================================================

import http from 'http';
import fs from 'fs';
import path from 'path';
import { loadEnvFile } from '../loadEnv';
loadEnvFile();

import { InMemoryStore } from '../store/InMemoryStore';
import { MockLlmClient, AnthropicLlmClient, LlmClient, ConversationTurn, completeJsonWithRetry, sanitizeMathText } from '../llm/llmClient';
import { MissionInterviewService } from '../services/missionInterviewService';
import { DiagnosticService } from '../services/diagnosticService';
import { ZpdSelector } from '../services/zpdSelector';
import { LessonGeneratorService } from '../services/lessonGeneratorService';
import { LearningRecordWriterService } from '../services/learningRecordWriterService';
import { SrsService } from '../services/srsService';
import { PracticeService } from '../services/practiceService';
import { MockExamService } from '../services/mockExamService';
import { ReferenceSheetService } from '../services/referenceSheetService';
import { AskTeacherService } from '../services/askTeacherService';
import { AuthService, AuthError } from '../services/authService';
import { GamificationService } from '../services/gamificationService';
import { StudentProfileService } from '../services/studentProfileService';
import { NotificationService } from '../services/notificationService';
import { GroundingService } from '../services/groundingService';
import { seedDiagnosticItemBank } from '../data/seedDiagnosticBank';
import { seedTrustedResources } from '../data/seedResources';
import { Student } from '../types';

const PORT = Number(process.env.PORT ?? 3300);
const PUBLIC_DIR = path.join(__dirname, '..', '..', 'public');

// ---------- shared demo state (assigned inside main() below, before the server starts listening) ----------
let store: InMemoryStore;
let usingRealLlm: boolean;
let llm: LlmClient;
let missionService: MissionInterviewService;
let diagnosticService: DiagnosticService;
let zpdSelector: ZpdSelector;
let lessonGenerator: LessonGeneratorService;
let writer: LearningRecordWriterService;
let srsService: SrsService;
let practiceService: PracticeService;
let mockExamService: MockExamService;
let referenceSheetService: ReferenceSheetService;
let askTeacherService: AskTeacherService;
let authService: AuthService;
let gamificationService: GamificationService;
let studentProfileService: StudentProfileService;
let notificationService: NotificationService;
let groundingService: GroundingService;

let demoStudentId: string | null = null;
async function getOrCreateDemoStudent() {
  if (demoStudentId) return store.students.find((s) => s.id === demoStudentId)!;
  const student = await store.createStudent({
    display_name: 'الطالب/ة',
    auth_user_id: crypto.randomUUID(), // must be a real UUID — the students.auth_user_id column is typed `uuid` in Postgres
    locale: 'ar',
    grade_level: 12,
    parental_consent_at: new Date().toISOString(),
  });
  demoStudentId = student.id;
  return student;
}

/** Product-redesign Phase 6: resolves the acting student from a bearer session
 *  token when present, and falls back to the existing single-demo-student
 *  behavior when it's not — this is the specific mechanism that keeps every
 *  existing no-login route working exactly as before while enabling real
 *  per-student identity for anyone who registers. No route's business logic
 *  changes; only how `student` gets resolved at the top of each handler. */
async function resolveStudentFromRequest(req: http.IncomingMessage): Promise<Student> {
  const authHeader = req.headers['authorization'];
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice('Bearer '.length).trim() : null;
  if (token) {
    const student = authService.resolveStudent(token);
    if (student) return student;
  }
  return getOrCreateDemoStudent();
}

/** Per-student conversation state (mission interview, ask-the-teacher). Was a
 *  single module-level array — correct only because there was ever exactly one
 *  active student. Now keyed by student ID so concurrent distinct logged-in
 *  students don't share/clobber each other's chat history. */
const missionConversations = new Map<string, ConversationTurn[]>();
const askTeacherConversations = new Map<string, ConversationTurn[]>();
// Keyed by `${studentId}:${skillId}` — a lesson-scoped conversation is
// distinct per student per lesson, unlike the two global chats above.
const lessonAskConversations = new Map<string, ConversationTurn[]>();

const HINT_SYSTEM_PROMPT = `HINT_GENERATOR
Generate ONE short hint (not the full answer) for the given Qudrat practice
question, grounded only in the concept it tests. The hint should nudge the
student toward the right technique without revealing the final answer.
FORMATTING RULE (non-negotiable): plain Unicode math only (x², √x, ×, ÷, ½),
no LaTeX delimiters, no Markdown. 1-2 sentences.
GENDER NEUTRALITY (non-negotiable): the student's gender is unknown by
default — never use gendered Arabic verb forms or adjectives (avoid
"تقدرين"/"جاهزة"). Prefer impersonal phrasing over direct address.
Respond ONLY with JSON: {"hint_ar": "..."}`;

// Version 2, Phase 1: a second, more direct hint, only ever reached live for
// an un-batched item on a second tap (batched items serve their curated
// hint_2_ar instantly instead — see handleHint below).
const HINT_SYSTEM_PROMPT_LEVEL_2 = `HINT_GENERATOR_LEVEL_2
The student already received a gentle first hint for this Qudrat practice
question and is asking for a MORE DIRECT one. Get closer to the actual
technique needed — still without stating the final answer outright.
FORMATTING RULE (non-negotiable): plain Unicode math only (x², √x, ×, ÷, ½),
no LaTeX delimiters, no Markdown. 1-2 sentences.
GENDER NEUTRALITY (non-negotiable): never use gendered Arabic verb forms or
adjectives (avoid "تقدرين"/"جاهزة"). Prefer impersonal phrasing.
Respond ONLY with JSON: {"hint_ar": "..."}`;

// ---------- tiny request helpers (no framework) ----------
function sendJson(res: http.ServerResponse, status: number, body: unknown) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function readJsonBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

function serveStatic(_req: http.IncomingMessage, res: http.ServerResponse, urlPath: string): boolean {
  const filePath = urlPath === '/' ? '/index.html' : urlPath;
  const resolved = path.join(PUBLIC_DIR, filePath);
  if (!resolved.startsWith(PUBLIC_DIR)) return false; // basic path-traversal guard
  if (!fs.existsSync(resolved) || fs.statSync(resolved).isDirectory()) return false;
  const ext = path.extname(resolved);
  res.writeHead(200, { 'Content-Type': MIME[ext] ?? 'application/octet-stream' });
  fs.createReadStream(resolved).pipe(res);
  return true;
}

// ---------- route handlers ----------

async function handleMission(req: http.IncomingMessage, res: http.ServerResponse) {
  try {
    const body = await readJsonBody(req);
    const student = await resolveStudentFromRequest(req);
    const studentMessage = typeof body.message === 'string' ? body.message : '';

    const updatedConversation: ConversationTurn[] = [
      ...(missionConversations.get(student.id) ?? []),
      { role: 'user', content: studentMessage },
    ];
    missionConversations.set(student.id, updatedConversation);

    // missionService.processTurn() already retries internally and never throws on a
    // bad model response — this outer try/catch is a last-resort net for anything
    // truly unexpected (e.g. resolveStudentFromRequest, finalizeMission's minor-consent
    // guardrail), so a single hiccup here can never surface as a raw error/stack
    // trace to the student either.
    const extraction = await missionService.processTurn(updatedConversation);

    if (!extraction.interview_complete) {
      missionConversations.set(student.id, [...updatedConversation, { role: 'assistant', content: extraction.next_message_to_student }]);
      return sendJson(res, 200, { done: false, message: extraction.next_message_to_student });
    }

    const mission = await missionService.finalizeMission(student.id, extraction);
    missionConversations.delete(student.id); // reset for next time
    sendJson(res, 200, { done: true, message: extraction.next_message_to_student, mission });
  } catch (err) {
    console.error('Mission interview turn failed unexpectedly:', err);
    // Respond as if the tutor just didn't catch that — never a JSON/error payload —
    // so the chat keeps flowing instead of surfacing a broken-looking error state.
    sendJson(res, 200, { done: false, message: 'عذرًا، صار عندي تعليق بسيط — تقدرين تعيدين آخر رسالة؟' });
  }
}

async function handleDiagnosticStart(req: http.IncomingMessage, res: http.ServerResponse) {
  const student = await resolveStudentFromRequest(req);
  const skillIds = diagnosticService.selectDiagnosticSkills(12); // shortened for a quick demo (brief's ~30 is the production target)
  if (usingRealLlm) {
    await diagnosticService.generateRealDiagnosticItems(skillIds, llm);
  } else {
    await seedDiagnosticItemBank(store, skillIds);
  }
  const session = await diagnosticService.startDiagnostic(student.id);
  // Runtime-robustness fix: this never filtered on validation_status, so it served
  // EVERY row for a skill — including ones marked 'failed' (superseded duplicates,
  // or items that failed validation) — which is exactly how stale placeholder/
  // duplicate content kept reaching the diagnostic screen. One passed item per
  // skill, matching the same pattern already used in handleMockExamStart below.
  const items = skillIds
    .map((skillId) => store.practiceItems.find((p) => p.skill_id === skillId && p.lesson_id === null && p.validation_status === 'passed'))
    .filter((p): p is NonNullable<typeof p> => !!p)
    .map((p) => ({ id: p.id, stem_ar: p.stem_ar, options: p.options })); // correct_option_index withheld from client
  sendJson(res, 200, { sessionId: session.id, items });
}

async function handleDiagnosticAnswer(req: http.IncomingMessage, res: http.ServerResponse, sessionId: string) {
  const body = await readJsonBody(req);
  const student = await resolveStudentFromRequest(req);
  const item = store.practiceItems.find((p) => p.id === body.itemId);
  if (!item) return sendJson(res, 404, { error: 'item_not_found', message: 'تعذر العثور على هذا السؤال — الرجاء تحديث الصفحة.' });
  const isCorrect = body.selectedIndex === item.correct_option_index;
  await store.recordAttempt({
    session_id: sessionId,
    student_id: student.id,
    practice_item_id: item.id,
    selected_option_index: body.selectedIndex,
    is_correct: isCorrect,
    response_time_ms: body.responseTimeMs ?? 10000,
  });
  sendJson(res, 200, { isCorrect, correctOptionIndex: item.correct_option_index, explanation: item.explanation_ar });
}

async function handleDiagnosticComplete(req: http.IncomingMessage, res: http.ServerResponse, sessionId: string) {
  const student = await resolveStudentFromRequest(req);
  const result = await diagnosticService.completeDiagnostic(sessionId, student.id, srsService);
  await gamificationService.checkAndAwardBadges(student.id);
  sendJson(res, 200, result);
}

async function handleNextLesson(req: http.IncomingMessage, res: http.ServerResponse) {
  const student = await resolveStudentFromRequest(req);
  // Demo-polish sprint: ?section=quantitative|verbal confines the recommendation
  // to the student's explicitly-chosen curriculum (see public/index.html's
  // path-select screen) — omitted/unrecognized falls back to the original
  // unfiltered behavior, so this is additive and backward compatible.
  const sectionParam = new URL(req.url ?? '/', `http://localhost:${PORT}`).searchParams.get('section');
  const section = sectionParam === 'quantitative' || sectionParam === 'verbal' ? sectionParam : undefined;
  const recommendation = zpdSelector.selectNext(student.id, section);
  // Product-redesign addition: lets the frontend know, before the student taps in,
  // whether this will be an instant curated-content load or a live-generation wait —
  // a free synchronous lookup, no LLM cost.
  const reusableLesson = recommendation
    ? store.findReusableLesson(recommendation.skillId, store.getSkill(recommendation.skillId)?.base_difficulty ?? 3)
    : undefined;

  // Version 5 Phase L: a real derived estimate replacing the old hardcoded
  // "٥-١٠ دقائق" string — computed from the actual curated lesson's own content
  // length (never fabricated). If the lesson still needs live generation, its
  // real size isn't known yet, so no specific number is claimed at all.
  let estimatedMinutes: number | null = null;
  if (reusableLesson) {
    const itemCount = store.getPracticeItemsForLesson(reusableLesson.id).length;
    // ~1 minute per concept block read + ~1 minute per practice item answered +
    // 2 fixed minutes for the worked example/summary steps every lesson has.
    estimatedMinutes = Math.max(3, Math.min(15, reusableLesson.concept_explanation.length + itemCount + 2));
  }

  sendJson(res, 200, { recommendation, hasPrebuiltLesson: !!reusableLesson, estimatedMinutes });
}

async function handleGenerateLesson(req: http.IncomingMessage, res: http.ServerResponse, skillId: string) {
  try {
    const { lesson, items } = await lessonGenerator.generateOrReuse(skillId, 3);
    const student = await resolveStudentFromRequest(req);
    const session = await store.createSession({ student_id: student.id, session_type: 'lesson', lesson_id: lesson.id });
    const passedItems = items.filter((i) => i.validation_status === 'passed');
    sendJson(res, 200, {
      sessionId: session.id,
      lesson: {
        title_ar: lesson.title_ar,
        concept_explanation: lesson.concept_explanation,
        worked_example: lesson.worked_example,
        review_status: lesson.review_status, // additive: lets the frontend show a subtle "being reviewed" tag on non-curated content
        // Version 6 Phase O: additive — populated only for lessons authored with
        // the new structured content model (currently just the Golden Lesson).
        // app.js's stepper renders from this when present, legacy path otherwise.
        sections: lesson.sections,
      },
      items: passedItems.map((i) => ({ id: i.id, stem_ar: i.stem_ar, options: i.options, difficulty_level: i.difficulty_level, source: i.source })),
    });
  } catch (err) {
    // generateOrReuse() already retries internally (concept call, items call) and
    // has a static-item last resort — reaching here means every retry genuinely
    // failed (e.g. the API was unreachable for the whole window). Never leak the
    // underlying error; give the student something actionable instead.
    console.error(`Lesson generation failed for skill ${skillId}:`, err);
    sendJson(res, 503, {
      error: 'lesson_generation_failed',
      message: 'تعذّر تحضير الدرس الآن — الرجاء المحاولة مرة أخرى بعد قليل.',
    });
  }
}

// Performance sprint, area 4: background content preloading. Deliberately
// calls ONLY lessonGenerator.generateOrReuse() — never store.createSession()
// — so warming a lesson the student hasn't actually opened yet can never
// fabricate a study session (which would corrupt gamificationService's
// streak/XP calculations, both derived live from real session rows). By the
// time the student actually taps through to handleGenerateLesson above,
// generateOrReuse's own "reuse instead of regenerate" check finds the
// now-already-persisted lesson and returns instantly — same mechanism that
// already makes every curated lesson load with no LLM wait, just triggered
// a little earlier. Errors are swallowed: a failed warm attempt just means
// the student's later real request falls back to today's normal (slower)
// live-generation path, exactly as if warming had never been attempted.
async function handleWarmLesson(_req: http.IncomingMessage, res: http.ServerResponse, skillId: string) {
  sendJson(res, 202, { warming: true }); // ack immediately — this is fire-and-forget from the client's side
  try {
    await lessonGenerator.generateOrReuse(skillId, store.getSkill(skillId)?.base_difficulty ?? 3);
  } catch (err) {
    console.warn(`Background lesson warm-up failed for skill ${skillId} (non-fatal — will retry on real request):`, err);
  }
}

async function handleLessonAnswer(req: http.IncomingMessage, res: http.ServerResponse, sessionId: string) {
  const body = await readJsonBody(req);
  const student = await resolveStudentFromRequest(req);
  const item = store.practiceItems.find((p) => p.id === body.itemId);
  if (!item) return sendJson(res, 404, { error: 'item_not_found', message: 'تعذر العثور على هذا السؤال — الرجاء تحديث الصفحة.' });
  const isCorrect = body.selectedIndex === item.correct_option_index;
  await store.recordAttempt({
    session_id: sessionId,
    student_id: student.id,
    practice_item_id: item.id,
    selected_option_index: body.selectedIndex,
    is_correct: isCorrect,
    response_time_ms: body.responseTimeMs ?? 15000,
  });
  // Version 2, Phase 1: curated mistake/memory-tip content is only ever surfaced
  // AFTER the student answers (never beforehand, where it could hint at the
  // correct option) — safe to include unconditionally here.
  sendJson(res, 200, {
    isCorrect,
    correctOptionIndex: item.correct_option_index,
    explanation: item.explanation_ar,
    commonMistake: item.common_mistake_ar,
    memoryTip: item.memory_tip_ar,
    wrongAnswerExplanation: !isCorrect ? item.wrong_answer_explanations?.[body.selectedIndex as 0 | 1 | 2 | 3] ?? null : null,
  });
}

async function handleLessonComplete(req: http.IncomingMessage, res: http.ServerResponse, sessionId: string) {
  const body = await readJsonBody(req);
  const student = await resolveStudentFromRequest(req);
  await store.completeSession(sessionId, null);
  const result = await writer.processSession(sessionId, student.id, body.skillId);
  for (const r of result.recordsWritten) {
    if (r.type === 'mastery') {
      await srsService.initializeIfAbsent(student.id, r.skillId);
      const glossaryTerm = store.getGlossaryTermForSkill(r.skillId);
      if (glossaryTerm) {
        const record = store.getActiveRecordForSkill(student.id, r.skillId);
        if (record) await store.unlockGlossaryTermForStudent(student.id, glossaryTerm.id, record.id);
      }
    }
  }
  // Product-redesign hooks — additive, don't change this route's response shape.
  const skill = typeof body.skillId === 'string' ? store.getSkill(body.skillId) : undefined;
  if (skill) await notificationService.notifyLessonComplete(student.id, skill.id, skill.name_ar);
  const newBadges = await gamificationService.checkAndAwardBadges(student.id);

  // Version 3 Phase C: same one-field-surfaced pattern as the mock exam's
  // review builder — real, already-stored response_time_ms per attempt,
  // joined to its skill name, so the client can group/average it. No new
  // storage, no schema change; getAttemptsForSession already existed.
  const timingBySkill = store.getAttemptsForSession(sessionId).map((a) => {
    const item = store.practiceItems.find((p) => p.id === a.practice_item_id);
    const itemSkill = item ? store.getSkill(item.skill_id) : undefined;
    return { skillNameAr: itemSkill?.name_ar ?? '—', responseTimeMs: a.response_time_ms };
  });

  sendJson(res, 200, { ...result, newBadges, timingBySkill });
}

async function handleDashboard(req: http.IncomingMessage, res: http.ServerResponse) {
  const student = await resolveStudentFromRequest(req);
  const mission = store.getActiveMission(student.id);
  await notificationService.checkAndCreateReminders(student.id, mission?.exam_date ?? null);
  const diagnosticSession = store.sessions.find(
    (s) => s.student_id === student.id && s.session_type === 'diagnostic' && s.completed_at
  );
  const activeRecords = store.getActiveLearningRecords(student.id);
  const masteredCount = activeRecords.filter((r) => r.record_type === 'mastery').length;
  const totalSkills = store.skills.length;

  // Simple, transparent placeholder projection (NOT a calibrated model — see 05-diagnostic-assessment.md §5):
  // current estimate nudges up from baseline proportionally to skills mastered since the diagnostic.
  const baseline = diagnosticSession?.score_estimate ?? null;
  const current = baseline !== null ? Math.min(100, Math.round(baseline + masteredCount * 0.6)) : null;
  const target = mission?.target_score ?? null;

  const examDate = mission?.exam_date ?? null;
  const daysToExam = examDate ? Math.max(0, Math.ceil((new Date(examDate).getTime() - Date.now()) / 86400000)) : null;

  const duePracticeCount = practiceService.getDueQueue(student.id, 999).length;

  sendJson(res, 200, {
    baseline, current, target, daysToExam,
    masteredCount, totalSkills, duePracticeCount,
    skills: store.skills.map((s) => {
      const record = activeRecords.find((r) => r.skill_id === s.id);
      return {
        id: s.id, name_ar: s.name_ar, status: record?.record_type ?? 'untouched', confidence: record?.confidence ?? null,
        // Version 3 Phase D: lets the client split the roadmap into separate
        // Quantitative/Verbal journeys — data already in memory server-side
        // (Skill.section), just never serialized to the client before now.
        section: s.section, baseDifficulty: s.base_difficulty,
      };
    }),
  });
}

// ---------- practice queue (FR-06) ----------

async function handlePracticeQueue(req: http.IncomingMessage, res: http.ServerResponse) {
  const student = await resolveStudentFromRequest(req);
  const queue = practiceService.getDueQueue(student.id, 8);
  sendJson(res, 200, {
    queue: queue.map((q) => ({ skillId: q.skillId, itemId: q.item.id, stem_ar: q.item.stem_ar, options: q.item.options })),
  });
}

async function handlePracticeAnswer(req: http.IncomingMessage, res: http.ServerResponse) {
  const body = await readJsonBody(req);
  const student = await resolveStudentFromRequest(req);
  const item = store.practiceItems.find((p) => p.id === body.itemId);
  if (!item) return sendJson(res, 404, { error: 'item_not_found', message: 'تعذر العثور على هذا السؤال — الرجاء تحديث الصفحة.' });
  const isCorrect = body.selectedIndex === item.correct_option_index;

  // Practice attempts are logged like any other (needs a session — create one lightweight session per queue run if not provided).
  let sessionId = body.sessionId as string | undefined;
  if (!sessionId) {
    const session = await store.createSession({ student_id: student.id, session_type: 'practice', lesson_id: null });
    sessionId = session.id;
  }
  await store.recordAttempt({
    session_id: sessionId,
    student_id: student.id,
    practice_item_id: item.id,
    selected_option_index: body.selectedIndex,
    is_correct: isCorrect,
    response_time_ms: body.responseTimeMs ?? 10000,
  });
  await practiceService.recordPracticeAnswer(student.id, item.skill_id, isCorrect);
  const newBadges = await gamificationService.checkAndAwardBadges(student.id);
  sendJson(res, 200, {
    sessionId, isCorrect, correctOptionIndex: item.correct_option_index, explanation: item.explanation_ar, newBadges,
    commonMistake: item.common_mistake_ar,
    memoryTip: item.memory_tip_ar,
    wrongAnswerExplanation: !isCorrect ? item.wrong_answer_explanations?.[body.selectedIndex as 0 | 1 | 2 | 3] ?? null : null,
  });
}

// ---------- mock exam (FR-07) ----------

async function handleMockExamStart(req: http.IncomingMessage, res: http.ServerResponse) {
  const student = await resolveStudentFromRequest(req);
  const skillIds = mockExamService.selectMockExamSkills(20); // scaled down from the brief's ~120 — see mockExamService.ts header
  await mockExamService.ensureItemsForSkills(skillIds, llm, usingRealLlm);
  const session = await mockExamService.startMockExam(student.id);
  const items = skillIds
    .map((skillId) => store.practiceItems.find((p) => p.skill_id === skillId && p.validation_status === 'passed'))
    .filter((p): p is NonNullable<typeof p> => !!p)
    .map((p) => ({ id: p.id, stem_ar: p.stem_ar, options: p.options }));
  sendJson(res, 200, { sessionId: session.id, items, durationMinutes: 45 }); // scaled-down timer to match the scaled-down item count
}

async function handleMockExamAnswer(req: http.IncomingMessage, res: http.ServerResponse, sessionId: string) {
  const body = await readJsonBody(req);
  const student = await resolveStudentFromRequest(req);
  const item = store.practiceItems.find((p) => p.id === body.itemId);
  if (!item) return sendJson(res, 404, { error: 'item_not_found', message: 'تعذر العثور على هذا السؤال — الرجاء تحديث الصفحة.' });
  const isCorrect = body.selectedIndex === item.correct_option_index;
  await store.recordAttempt({
    session_id: sessionId,
    student_id: student.id,
    practice_item_id: item.id,
    selected_option_index: body.selectedIndex,
    is_correct: isCorrect,
    response_time_ms: body.responseTimeMs ?? 20000,
  });
  sendJson(res, 200, { recorded: true }); // deliberately no immediate feedback during a real exam — review comes at the end
}

async function handleMockExamComplete(req: http.IncomingMessage, res: http.ServerResponse, sessionId: string) {
  const student = await resolveStudentFromRequest(req);
  const result = await mockExamService.completeMockExam(sessionId);
  const newBadges = await gamificationService.checkAndAwardBadges(student.id);
  sendJson(res, 200, { ...result, newBadges });
}

// ---------- reference sheets (FR-10) ----------

async function handleReferenceSheets(req: http.IncomingMessage, res: http.ServerResponse) {
  const student = await resolveStudentFromRequest(req);
  const sheets = referenceSheetService.getSheetsForStudent(student.id);
  sendJson(res, 200, { sheets });
}

// ---------- glossary (FR-08) ----------

async function handleGlossary(req: http.IncomingMessage, res: http.ServerResponse) {
  const student = await resolveStudentFromRequest(req);
  const terms = store.getUnlockedGlossaryTerms(student.id);
  sendJson(res, 200, {
    terms: terms.map((t) => ({ termAr: t.term_ar, definitionAr: t.definition_ar, aliasesToAvoid: t.aliases_to_avoid })),
  });
}

// ---------- resources (FR-11) ----------

async function handleResources(_req: http.IncomingMessage, res: http.ServerResponse) {
  sendJson(res, 200, {
    resources: store.resources.map((r) => ({
      title: r.title, url: r.url, kind: r.kind, annotation: r.annotation, isOfficialEtec: r.is_official_etec,
    })),
  });
}

// ---------- ask the teacher (FR-12) ----------

async function handleAskTeacher(req: http.IncomingMessage, res: http.ServerResponse) {
  try {
    const body = await readJsonBody(req);
    const student = await resolveStudentFromRequest(req);
    const studentMessage = typeof body.message === 'string' ? body.message : '';
    const conversation = [...(askTeacherConversations.get(student.id) ?? []), { role: 'user' as const, content: studentMessage }];
    askTeacherConversations.set(student.id, conversation);

    const { replyAr, priorKnowledgeDetected } = await askTeacherService.processTurn(student.id, conversation);
    askTeacherConversations.set(student.id, [...conversation, { role: 'assistant', content: replyAr }]);
    sendJson(res, 200, { reply: replyAr, priorKnowledgeDetected });
  } catch (err) {
    console.error('Ask-the-teacher turn failed unexpectedly:', err);
    sendJson(res, 200, { reply: 'عذرًا، ما وصلني سؤالك بوضوح — تقدرين تعيدين صياغته؟', priorKnowledgeDetected: false });
  }
}

// ---------- auth (product-redesign Phase 6) ----------

async function handleAuthRegister(req: http.IncomingMessage, res: http.ServerResponse) {
  try {
    const body = await readJsonBody(req);
    const { student, session } = await authService.register(
      typeof body.email === 'string' ? body.email : '',
      typeof body.password === 'string' ? body.password : '',
      typeof body.displayName === 'string' ? body.displayName : ''
    );
    sendJson(res, 200, { token: session.token, student: { id: student.id, displayName: student.display_name, email: student.email } });
  } catch (err) {
    if (err instanceof AuthError) return sendJson(res, 400, { error: 'auth_error', message: err.message });
    console.error('Registration failed unexpectedly:', err);
    sendJson(res, 500, { error: 'internal_error', message: 'تعذّر إنشاء الحساب الآن. الرجاء المحاولة مرة أخرى.' });
  }
}

async function handleAuthLogin(req: http.IncomingMessage, res: http.ServerResponse) {
  try {
    const body = await readJsonBody(req);
    const { student, session } = await authService.login(
      typeof body.email === 'string' ? body.email : '',
      typeof body.password === 'string' ? body.password : ''
    );
    sendJson(res, 200, { token: session.token, student: { id: student.id, displayName: student.display_name, email: student.email } });
  } catch (err) {
    if (err instanceof AuthError) return sendJson(res, 401, { error: 'auth_error', message: err.message });
    console.error('Login failed unexpectedly:', err);
    sendJson(res, 500, { error: 'internal_error', message: 'تعذّر تسجيل الدخول الآن. الرجاء المحاولة مرة أخرى.' });
  }
}

async function handleAuthLogout(req: http.IncomingMessage, res: http.ServerResponse) {
  const authHeader = req.headers['authorization'];
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice('Bearer '.length).trim() : null;
  if (token) await authService.logout(token);
  sendJson(res, 200, { loggedOut: true });
}

// Version 5 Phase L: account management, scoped to change-password only (see
// AuthService.changePassword's own comment for why delete-account is out of scope).
async function handleChangePassword(req: http.IncomingMessage, res: http.ServerResponse) {
  try {
    const body = await readJsonBody(req);
    const student = await resolveStudentFromRequest(req);
    await authService.changePassword(
      student.id,
      typeof body.currentPassword === 'string' ? body.currentPassword : '',
      typeof body.newPassword === 'string' ? body.newPassword : ''
    );
    sendJson(res, 200, { changed: true });
  } catch (err) {
    if (err instanceof AuthError) return sendJson(res, 400, { error: 'auth_error', message: err.message });
    console.error('Change-password failed unexpectedly:', err);
    sendJson(res, 500, { error: 'internal_error', message: 'تعذّر تغيير كلمة المرور الآن. الرجاء المحاولة مرة أخرى.' });
  }
}

// Onboarding gender-address preference (additive, always optional/skippable —
// the app defaults to neutral Arabic regardless of whether this is ever set).
async function handleSetGender(req: http.IncomingMessage, res: http.ServerResponse) {
  const body = await readJsonBody(req);
  const student = await resolveStudentFromRequest(req);
  const gender = body.gender;
  if (gender !== 'male' && gender !== 'female' && gender !== 'unspecified') {
    return sendJson(res, 400, { error: 'invalid_gender', message: 'قيمة غير صالحة.' });
  }
  await store.setStudentGender(student.id, gender);
  sendJson(res, 200, { gender });
}

/** Onboarding-redesign sprint: the explicit "Current Grade" step (registration
 *  itself leaves grade_level null — see authService.register). Scoped to
 *  11/12 only, matching this app's own Grade-11/12 Qudrat-prep audience. */
async function handleSetGrade(req: http.IncomingMessage, res: http.ServerResponse) {
  const body = await readJsonBody(req);
  const student = await resolveStudentFromRequest(req);
  const gradeLevel = Number(body.gradeLevel);
  if (gradeLevel !== 11 && gradeLevel !== 12) {
    return sendJson(res, 400, { error: 'invalid_grade', message: 'قيمة غير صالحة.' });
  }
  await store.setStudentGrade(student.id, gradeLevel);
  sendJson(res, 200, { gradeLevel });
}

// ---------- profile / gamification (product-redesign Phase 4/6) ----------

async function handleProfile(req: http.IncomingMessage, res: http.ServerResponse) {
  const student = await resolveStudentFromRequest(req);
  const xp = gamificationService.computeXp(student.id);
  const level = gamificationService.computeLevel(xp.total);
  const streak = gamificationService.computeStreak(student.id);
  const badges = gamificationService.getBadgesForStudent(student.id);
  sendJson(res, 200, {
    displayName: student.display_name,
    gender: student.gender,
    xp: xp.total,
    xpBreakdown: xp,
    level,
    streak,
    badges,
    masteryByTopic: studentProfileService.getMasteryByTopic(student.id),
    weakTopics: studentProfileService.getWeakTopics(student.id),
    strengths: studentProfileService.getStrengths(student.id),
    studyHistory: studentProfileService.getStudyHistory(student.id).map((s) => ({
      sessionType: s.session_type,
      completedAt: s.completed_at,
      scoreEstimate: s.score_estimate,
    })),
  });
}

// ---------- notifications (product-redesign Phase 7) ----------

async function handleNotifications(req: http.IncomingMessage, res: http.ServerResponse) {
  const student = await resolveStudentFromRequest(req);
  const notifications = notificationService.getNotificationsForStudent(student.id);
  sendJson(res, 200, {
    notifications: notifications.map((n) => ({
      id: n.id, type: n.type, title: n.title_ar, body: n.body_ar, isRead: n.is_read, createdAt: n.created_at,
    })),
    unreadCount: notificationService.getUnreadCount(student.id),
  });
}

async function handleNotificationRead(_req: http.IncomingMessage, res: http.ServerResponse, notificationId: string) {
  await notificationService.markRead(notificationId);
  sendJson(res, 200, { marked: true });
}

// ---------- ask about this lesson (product-redesign Phase 8) ----------

async function handleAskAboutLesson(req: http.IncomingMessage, res: http.ServerResponse, skillId: string) {
  try {
    const body = await readJsonBody(req);
    const student = await resolveStudentFromRequest(req);
    const studentMessage = typeof body.message === 'string' ? body.message : '';

    const lesson = store.lessons.find((l) => l.skill_id === skillId);
    if (!lesson) {
      return sendJson(res, 404, { error: 'lesson_not_found', message: 'تعذر العثور على محتوى هذا الدرس.' });
    }

    const key = `${student.id}:${skillId}`;
    const conversation: ConversationTurn[] = [...(lessonAskConversations.get(key) ?? []), { role: 'user', content: studentMessage }];
    lessonAskConversations.set(key, conversation);

    const { replyAr, onTopic } = await askTeacherService.processLessonScopedTurn(lesson.id, conversation);
    lessonAskConversations.set(key, [...conversation, { role: 'assistant', content: replyAr }]);
    sendJson(res, 200, { reply: replyAr, onTopic });
  } catch (err) {
    console.error('Ask-about-this-lesson turn failed unexpectedly:', err);
    sendJson(res, 200, { reply: 'عذرًا، ما وصلني سؤالك بوضوح — تقدرين تعيدين صياغته؟', onTopic: true });
  }
}

// ---------- hints (product-redesign Phase 7 — AI as assistant, not content source) ----------

// Performance sprint, area 4: "reusable explanation cache." An AI-generated
// hint for a given (item, level) is the same regardless of which student asks
// for it — the underlying question never changes — so the first live
// generation for a pair is reused for every subsequent request instead of
// re-calling the LLM every time. Deliberately process-memory-only (not
// written into hint_1_ar/hint_2_ar, which are reserved for genuinely
// human-reviewed content and drive the "✓ من بنك الأسئلة" UI badge — caching
// here must never claim reviewed provenance a live-generated hint doesn't
// have). Resets on restart, which is an acceptable, honestly-labeled
// tradeoff: source stays 'ai_generated' either way.
const liveHintCache = new Map<string, string>();

async function handleHint(req: http.IncomingMessage, res: http.ServerResponse, itemId: string) {
  const item = store.practiceItems.find((p) => p.id === itemId);
  if (!item) return sendJson(res, 404, { error: 'item_not_found', message: 'تعذر العثور على هذا السؤال.' });
  const body = await readJsonBody(req);
  const level = body?.level === 2 ? 2 : 1;

  // Version 2, Phase 1: curated hints (batch-seeded, human-reviewed) are served
  // straight from the row — no LLM call, no latency, exactly the "hints never
  // require AI" behavior this phase exists for. Live generation is now only a
  // fallback for the un-batched majority of skills, or a level-2 request on an
  // item whose curated bank doesn't include a second hint.
  if (level === 1 && item.hint_1_ar) {
    return sendJson(res, 200, { hint: item.hint_1_ar, source: 'curated', hasMore: !!item.hint_2_ar });
  }
  if (level === 2 && item.hint_2_ar) {
    return sendJson(res, 200, { hint: item.hint_2_ar, source: 'curated', hasMore: false });
  }

  const cacheKey = `${itemId}:${level}`;
  const cached = liveHintCache.get(cacheKey);
  if (cached) {
    return sendJson(res, 200, { hint: cached, source: 'ai_generated', hasMore: level === 1 });
  }

  try {
    const skill = store.getSkill(item.skill_id);
    // Version 5: previously the ONE prompt in this app with zero grounding at
    // all — now routed through the same shared GroundingService every other
    // AI call site uses, including the item's own curated hint bank (if a
    // level-1 hint exists but level-2 doesn't, the live level-2 generation
    // now sees and stays consistent with it, instead of contradicting it).
    const groundingBlock = groundingService.build({ practiceItemId: item.id, skillId: item.skill_id });
    const hint = await completeJsonWithRetry(
      llm,
      `${level === 2 ? HINT_SYSTEM_PROMPT_LEVEL_2 : HINT_SYSTEM_PROMPT}\n\n${groundingBlock}`,
      `Stem: ${item.stem_ar}\nSkill: ${skill?.name_ar ?? ''}`,
      (raw) => {
        if (!raw || typeof raw.hint_ar !== 'string' || !raw.hint_ar.trim()) throw new Error('Malformed hint response');
        return raw as { hint_ar: string };
      }
    );
    const cleanHint = sanitizeMathText(hint.hint_ar);
    liveHintCache.set(cacheKey, cleanHint);
    sendJson(res, 200, { hint: cleanHint, source: 'ai_generated', hasMore: level === 1 });
  } catch (err) {
    console.error(`Hint generation failed for item ${itemId}, using a graceful fallback:`, err);
    sendJson(res, 200, {
      hint: 'التفكير في المفهوم الأساسي الذي يختبره هذا السؤال، ومحاولة تبسيط المسألة خطوة بخطوة، قد يساعد.',
      source: 'ai_generated',
      hasMore: false,
    });
  }
}

// ---------- router ----------

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
    const segments = url.pathname.split('/').filter(Boolean);

    if (req.method === 'GET' && !url.pathname.startsWith('/api/')) {
      if (serveStatic(req, res, url.pathname)) return;
      return sendJson(res, 404, { error: 'not found' });
    }

    if (req.method === 'POST' && url.pathname === '/api/mission') return await handleMission(req, res);
    if (req.method === 'POST' && url.pathname === '/api/diagnostic/start') return await handleDiagnosticStart(req, res);
    if (req.method === 'POST' && segments[1] === 'diagnostic' && segments[3] === 'answer') return await handleDiagnosticAnswer(req, res, segments[2]);
    if (req.method === 'POST' && segments[1] === 'diagnostic' && segments[3] === 'complete') return await handleDiagnosticComplete(req, res, segments[2]);
    if (req.method === 'GET' && url.pathname === '/api/next-lesson') return await handleNextLesson(req, res);
    if (req.method === 'POST' && segments[1] === 'lesson' && segments.length === 3) return await handleGenerateLesson(req, res, segments[2]);
    if (req.method === 'POST' && segments[1] === 'lesson' && segments[3] === 'warm') return await handleWarmLesson(req, res, segments[2]);
    if (req.method === 'POST' && segments[1] === 'lesson-session' && segments[3] === 'answer') return await handleLessonAnswer(req, res, segments[2]);
    if (req.method === 'POST' && segments[1] === 'lesson-session' && segments[3] === 'complete') return await handleLessonComplete(req, res, segments[2]);
    if (req.method === 'GET' && url.pathname === '/api/dashboard') return await handleDashboard(req, res);
    if (req.method === 'GET' && url.pathname === '/api/practice/queue') return await handlePracticeQueue(req, res);
    if (req.method === 'POST' && url.pathname === '/api/practice/answer') return await handlePracticeAnswer(req, res);
    if (req.method === 'POST' && url.pathname === '/api/mock-exam/start') return await handleMockExamStart(req, res);
    if (req.method === 'POST' && segments[1] === 'mock-exam' && segments[3] === 'answer') return await handleMockExamAnswer(req, res, segments[2]);
    if (req.method === 'POST' && segments[1] === 'mock-exam' && segments[3] === 'complete') return await handleMockExamComplete(req, res, segments[2]);
    if (req.method === 'GET' && url.pathname === '/api/reference-sheets') return await handleReferenceSheets(req, res);
    if (req.method === 'GET' && url.pathname === '/api/glossary') return await handleGlossary(req, res);
    if (req.method === 'GET' && url.pathname === '/api/resources') return await handleResources(req, res);
    if (req.method === 'POST' && url.pathname === '/api/ask-teacher') return await handleAskTeacher(req, res);

    if (req.method === 'POST' && url.pathname === '/api/auth/register') return await handleAuthRegister(req, res);
    if (req.method === 'POST' && url.pathname === '/api/auth/login') return await handleAuthLogin(req, res);
    if (req.method === 'POST' && url.pathname === '/api/auth/logout') return await handleAuthLogout(req, res);
    if (req.method === 'PATCH' && url.pathname === '/api/profile/password') return await handleChangePassword(req, res);
    if (req.method === 'POST' && url.pathname === '/api/profile/gender') return await handleSetGender(req, res);
    if (req.method === 'POST' && url.pathname === '/api/profile/grade') return await handleSetGrade(req, res);
    if (req.method === 'GET' && url.pathname === '/api/profile') return await handleProfile(req, res);
    if (req.method === 'GET' && url.pathname === '/api/notifications') return await handleNotifications(req, res);
    if (req.method === 'POST' && segments[1] === 'notifications' && segments[3] === 'read') return await handleNotificationRead(req, res, segments[2]);
    if (req.method === 'POST' && segments[1] === 'lesson' && segments[3] === 'ask-about') return await handleAskAboutLesson(req, res, segments[2]);
    if (req.method === 'POST' && segments[1] === 'practice-item' && segments[3] === 'hint') return await handleHint(req, res, segments[2]);

    sendJson(res, 404, { error: 'no_route_matched', message: 'المسار غير موجود.' });
  } catch (err: any) {
    // Runtime-robustness fix: this used to return `err.message` (and implicitly,
    // stack traces logged nowhere but the terminal) straight to the client for ANY
    // unhandled exception across all 18 routes — the single biggest source of raw
    // errors/JSON reaching the student. Log the full error server-side; the client
    // only ever gets a safe, generic, Arabic message.
    console.error('Unhandled server error:', err);
    if (!res.headersSent) {
      sendJson(res, 500, {
        error: 'internal_error',
        message: 'حدث خطأ غير متوقع من جهتنا. الرجاء المحاولة مرة أخرى بعد قليل.',
      });
    }
  }
});

async function main() {
  const useRealDb = !!process.env.DATABASE_URL;
  if (useRealDb) {
    console.log('DATABASE_URL detected — connecting to Postgres/Supabase...');
    const { PostgresStore } = await import('../store/PostgresStore'); // dynamic: keeps `pg` optional when not using a real DB
    store = await PostgresStore.create();
    console.log(`Connected. Hydrated ${store.skills.length} skills from the database.`);
  } else {
    console.log('No DATABASE_URL found — using in-memory store (data resets on restart).');
    store = new InMemoryStore();
  }

  seedTrustedResources(store); // load Knowledge/Wisdom sources so lesson generation can ground exam-fact claims
  usingRealLlm = !!process.env.ANTHROPIC_API_KEY;
  llm = usingRealLlm ? new AnthropicLlmClient() : new MockLlmClient();
  groundingService = new GroundingService(store); // Version 5: the one grounding pipeline every LLM call site below routes through
  missionService = new MissionInterviewService(store, llm, groundingService);
  diagnosticService = new DiagnosticService(store, groundingService);
  zpdSelector = new ZpdSelector(store);
  lessonGenerator = new LessonGeneratorService(store, llm, groundingService);
  writer = new LearningRecordWriterService(store);
  srsService = new SrsService(store);
  practiceService = new PracticeService(store, srsService);
  mockExamService = new MockExamService(store, groundingService);
  referenceSheetService = new ReferenceSheetService(store);
  askTeacherService = new AskTeacherService(store, llm, groundingService);
  authService = new AuthService(store);
  gamificationService = new GamificationService(store);
  studentProfileService = new StudentProfileService(store);
  notificationService = new NotificationService(store, srsService, gamificationService);
  await gamificationService.ensureBadgeCatalogSeeded();

  server.listen(PORT, () => {
    console.log(`Qudrat AI Tutor demo server running: http://localhost:${PORT}`);
    console.log(useRealDb ? 'Data store: REAL Postgres/Supabase (persists across restarts).' : 'Data store: in-memory (resets on restart).');
    if (usingRealLlm) {
      console.log('Using REAL Claude API (AnthropicLlmClient) — ANTHROPIC_API_KEY detected.');
    } else {
      console.log('Using MOCK LLM (no API key found in .env or environment) — content will look placeholder-ish.');
      console.log('Add ANTHROPIC_API_KEY to a .env file (copy .env.example) to switch to real generation.');
    }
  });
}

main().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
