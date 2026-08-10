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
