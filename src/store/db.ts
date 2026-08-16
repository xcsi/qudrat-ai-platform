// ============================================================
// Postgres connection pool.
// Reads DATABASE_URL from the environment (Supabase connection
// string, "Session pooler" or "Transaction pooler" URI — see
// Supabase dashboard > Project Settings > Database).
//
// NOTE: this file was NOT executed in the sandbox that produced
// the rest of this project — that sandbox has no network access,
// so `pg` could not be installed or connected to a live database.
// Run `npm install pg @types/pg` in your own environment first.
// ============================================================

import { Pool, types } from 'pg';

// Postgres OID 1082 = the `date` type (used by srs_state.next_review_at).
// node-postgres's DEFAULT parser turns this into a JS Date object — but
// every consumer in this codebase (SrsService, the InMemoryStore base class
// it shares with PostgresStore, next_review_at's own `string` type in
// types/index.ts) treats it as a plain 'YYYY-MM-DD' string: string `<=`
// comparisons, `.localeCompare()`, string concatenation. `Date <= string`
// is NOT a date comparison in JS — it's `NaN <= NaN` (ToNumber on a date
// string literal is NaN), which is always false. The practical effect,
// found live: getDueSrsStates()'s `next_review_at <= today` was ALWAYS
// false against real Postgres data, so the entire spaced-repetition due
// queue silently returned empty for every student — no due-practice badge,
// no practice queue, ever — even though the raw SQL clearly showed rows
// due. Overriding the OID 1082 parser to identity (the raw wire text is
// already 'YYYY-MM-DD') makes reality match what every consumer assumes.
const DATE_OID = 1082;
types.setTypeParser(DATE_OID, (val: string) => val);

// Postgres OID 1700 = `numeric`/`decimal` (sessions.score_estimate,
// srs_state.ease_factor). node-postgres's default parser leaves these as
// STRINGS on the wire — deliberately, to avoid silent float-precision loss
// for callers who need exact decimal arithmetic — but every consumer here
// (Session.score_estimate, SrsState.ease_factor in types/index.ts) is typed
// `number` and does plain arithmetic on it. `+` on a string operand is
// concatenation, not addition: found live on the dashboard hero screen,
// where `baseline + masteredCount * 0.6` (httpServer.ts's handleDashboard)
// silently became `"62" + 7.8` = `"627.8"` after a real server restart
// re-hydrated sessions from Postgres — Math.round/min then clamped that to
// a nonsensical "100% current score" against an 88 target. SrsService's
// `ease_factor + 0.1` on a correct review has the same failure mode, via
// Math.max coercing the resulting garbled string to NaN. This project has
// no currency/financial use of `numeric` (scores and ease factors only),
// so parsing eagerly to a JS float here — once, at the connection layer,
// same fix shape as the DATE_OID override above — is safe and matches what
// every consumer already assumes.
const NUMERIC_OID = 1700;
types.setTypeParser(NUMERIC_OID, (val: string) => parseFloat(val));

let pool: Pool | null = null;

export function getPool(): Pool {
  if (pool) return pool;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      'DATABASE_URL is not set. Copy .env.example to .env and paste your Supabase connection string.'
    );
  }
  pool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false }, // Supabase requires SSL; adjust per your provider's docs
  });
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
