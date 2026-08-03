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

import { Pool } from 'pg';

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
