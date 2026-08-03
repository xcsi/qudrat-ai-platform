# Migrating from InMemoryStore to Real Postgres/Supabase

## What's already done

- `data-model/02-schema.sql` and `data-model/03-seed-skills.sql` — tested SQL, ready to run.
- `src/store/db.ts` — connection pool reading `DATABASE_URL`.
- `src/store/PostgresStore.ts` — extends `InMemoryStore`, overrides every write method
  to persist to Postgres and mirror the change in memory, so all the read-side filter/find
  logic in `services/*.ts` keeps working with zero changes.
- All write methods across the codebase (`InMemoryStore`, every service, the harness) are
  already `async`/`await`-based — this was done specifically so this migration is a
  **one-line swap**, not a rewrite.

## What is NOT done, and why

The sandbox that produced this project has **no network access** — `pg` could not be
installed, and there is no live Postgres/Supabase instance to connect to and test against.
`PostgresStore.ts` and `src/store/db.ts` were written carefully, matching the tested schema
exactly, but they have **not been run against a real database**. Treat them as a strong
first draft, not a verified deliverable — test them yourself before trusting them in the
demo for Review 3.

## Steps to complete the migration

### 1. Create the Supabase project and run the SQL

In the Supabase SQL Editor, run in this exact order:
```sql
-- paste and run data-model/02-schema.sql
-- then paste and run data-model/03-seed-skills.sql
```

### 2. Get your connection string

Supabase dashboard → Project Settings → Database → Connection string → **URI** (use the
"Transaction pooler" string for serverless/short-lived connections, "Session pooler" if
you're running this as a long-lived Node process — the test harness is short-lived, so
Transaction pooler is the better default).

### 3. Set up environment variables

```bash
cp .env.example .env
# edit .env and paste your connection string into DATABASE_URL
```

### 4. Install the new dependency

```bash
npm install
```
(`pg` and `@types/pg` are already listed in `package.json` — this just fetches them.)

### 5. Swap the store in the harness

In `src/harness/runTestHarness.ts`, change:
```typescript
const store = new InMemoryStore();
```
to:
```typescript
import { PostgresStore } from '../store/PostgresStore';
// ...
const store = await PostgresStore.create();
```
That's the only code change needed in the harness.

### 6. Run it and actually check the data landed

```bash
npm run harness
```
Then, in the Supabase SQL Editor:
```sql
select * from students order by created_at desc limit 5;
select * from learning_records order by created_at desc limit 20;
```
Confirm the student, mission, session, and learning records from your harness run are
actually there — don't just trust a clean console output, verify in the database directly.

## Known risk areas to test carefully (not verified in this sandbox)

1. **JSONB round-tripping.** `missions.success_criteria`, `missions.constraints`,
   `lessons.concept_explanation`, `lessons.worked_example`, `practice_items.options`, and
   `practice_items.validation_checks` are all stored as `jsonb` and stringified with
   `JSON.stringify(...)` before insert. Confirm the `pg` driver returns these already
   parsed as objects/arrays on read (it usually does for `jsonb` columns), not as raw
   strings — if it returns strings, `PostgresStore.hydrate()`'s direct assignment
   (`this.missions = missions.rows`) will produce shapes that don't match the `Mission`
   type, and downstream code expecting `mission.success_criteria` to be an array will break.
2. **`options` as a 4-tuple.** The `PracticeItem.options` type is `[string,string,string,string]`
   in TypeScript but `jsonb` in Postgres — after hydration this is a plain array at runtime;
   the tuple typing is a compile-time-only guarantee and won't be re-validated at runtime.
3. **Connection pool lifecycle.** `getPool()` in `db.ts` never calls `closePool()` — for a
   short harness run this is fine (the process exits and the pool closes with it), but if
   this code is reused inside a long-running API server, make sure `closePool()` is called
   on graceful shutdown, or connections will leak.
4. **`on conflict (student_id, skill_id)` in `upsertSrsState`.** This assumes the
   `(student_id, skill_id)` composite primary key from `02-schema.sql` is intact — confirm
   the constraint exists (`\d srs_state` in `psql`, or check the table definition in the
   Supabase table editor) before relying on the upsert.

## After this works

Once `PostgresStore` is verified against a real Supabase instance, the natural next steps
are: (1) swap `MockLlmClient` for `AnthropicLlmClient` in the same harness file, and (2) begin
wrapping both behind an actual API layer (Express/Next.js API routes) for Phase 2.
