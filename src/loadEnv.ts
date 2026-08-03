// ============================================================
// Minimal .env loader — no new dependency needed (no `dotenv` package).
// Reads KEY=VALUE lines from a .env file in the project root into
// process.env, if the file exists. Call this once, before anything
// reads process.env.ANTHROPIC_API_KEY or process.env.DATABASE_URL.
// ============================================================

import fs from 'fs';
import path from 'path';

export function loadEnvFile(envPath: string = path.join(__dirname, '..', '.env')): void {
  if (!fs.existsSync(envPath)) return;
  let content = fs.readFileSync(envPath, 'utf-8');
  if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1); // strip UTF-8 BOM (common on Windows-saved files)
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eqIndex = line.indexOf('=');
    if (eqIndex === -1) continue;
    const key = line.slice(0, eqIndex).trim();
    let value = line.slice(eqIndex + 1).trim();
    // strip surrounding quotes if present
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value; // don't override real shell-exported vars
  }
}
