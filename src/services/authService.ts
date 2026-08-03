// ============================================================
// Auth service — real but intentionally lightweight (product-redesign
// Phase 6). Email+password with Node's built-in crypto.scrypt (no new
// dependency — consistent with this codebase's existing preference for
// stdlib over new packages, e.g. no Express, no dotenv) and an opaque
// bearer-token session (not JWT — matches the project's demonstrated
// preference for simple relational rows over cryptographic complexity
// elsewhere, e.g. srs_state, glossary unlocks).
//
// Deliberately NOT a replacement for the real Supabase Auth migration
// already scoped in IMPLEMENTATION-ROADMAP.md 1.1 — `students.auth_user_id`
// stays reserved for that. This is additive: students who never register
// keep working exactly as before (see httpServer.ts's resolveStudentFromRequest,
// which falls back to the existing demo-student behavior when no session
// token is present).
// ============================================================

import { randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from 'crypto';
import { promisify } from 'util';
import { InMemoryStore } from '../store/InMemoryStore';
import { Student, StudentSession } from '../types';

const scrypt = promisify(scryptCallback) as (password: string, salt: string, keylen: number) => Promise<Buffer>;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const derivedKey = await scrypt(password, salt, 64);
  return `${salt}:${derivedKey.toString('hex')}`;
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [salt, hashHex] = stored.split(':');
  if (!salt || !hashHex) return false;
  const derivedKey = await scrypt(password, salt, 64);
  const storedBuffer = Buffer.from(hashHex, 'hex');
  if (storedBuffer.length !== derivedKey.length) return false;
  return timingSafeEqual(derivedKey, storedBuffer);
}

/** Thrown for any user-facing auth failure (bad input, duplicate email, wrong
 *  credentials) — httpServer.ts catches this specifically and returns a safe
 *  Arabic message, same pattern as the rest of the app's error handling. */
export class AuthError extends Error {}

export interface AuthResult {
  student: Student;
  session: StudentSession;
}

export class AuthService {
  constructor(private store: InMemoryStore) {}

  async register(email: string, password: string, displayName: string): Promise<AuthResult> {
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail || !normalizedEmail.includes('@')) {
      throw new AuthError('البريد الإلكتروني غير صالح.');
    }
    if (password.length < 8) {
      throw new AuthError('كلمة المرور يجب أن تكون 8 أحرف على الأقل.');
    }
    if (this.store.getStudentByEmail(normalizedEmail)) {
      throw new AuthError('هذا البريد الإلكتروني مسجّل بالفعل.');
    }

    const passwordHash = await hashPassword(password);
    const student = await this.store.createStudent({
      display_name: displayName.trim() || 'الطالب/ة',
      auth_user_id: randomUUID(), // reserved for the future real Supabase Auth migration — not read by this lightweight auth
      locale: 'ar',
      grade_level: null,
      parental_consent_at: null,
      email: normalizedEmail,
      password_hash: passwordHash,
    });
    const session = await this.store.createStudentSession(student.id, SESSION_TTL_MS);
    return { student, session };
  }

  async login(email: string, password: string): Promise<AuthResult> {
    const normalizedEmail = email.trim().toLowerCase();
    const student = this.store.getStudentByEmail(normalizedEmail);
    // Deliberately the same error for "no such email" and "wrong password" —
    // distinguishing them lets an attacker enumerate registered emails.
    if (!student || !student.password_hash || !(await verifyPassword(password, student.password_hash))) {
      throw new AuthError('البريد الإلكتروني أو كلمة المرور غير صحيحة.');
    }
    const session = await this.store.createStudentSession(student.id, SESSION_TTL_MS);
    return { student, session };
  }

  async logout(token: string): Promise<void> {
    await this.store.deleteStudentSession(token);
  }

  /** Version 5 Phase L: account management, scoped to change-password only
   *  (the safe, universally-expected piece — delete-account is a real
   *  destructive/data-retention operation out of scope for this pass, see
   *  the final audit's named remaining limitations). Reuses the exact
   *  hash/verify pair register()/login() already use. */
  async changePassword(studentId: string, currentPassword: string, newPassword: string): Promise<void> {
    const student = this.store.getStudentById(studentId);
    if (!student || !student.email || !student.password_hash) {
      throw new AuthError('لا يمكن تغيير كلمة المرور لهذا الحساب.');
    }
    if (!(await verifyPassword(currentPassword, student.password_hash))) {
      throw new AuthError('كلمة المرور الحالية غير صحيحة.');
    }
    if (newPassword.length < 8) {
      throw new AuthError('كلمة المرور الجديدة يجب أن تكون 8 أحرف على الأقل.');
    }
    const newHash = await hashPassword(newPassword);
    await this.store.setStudentAuth(studentId, student.email, newHash);
  }

  /** Returns undefined for a missing/expired/invalid token — callers treat that
   *  identically to "not logged in", never as an error. */
  resolveStudent(token: string): Student | undefined {
    const session = this.store.getValidStudentSession(token);
    if (!session) return undefined;
    return this.store.getStudentById(session.student_id);
  }
}
