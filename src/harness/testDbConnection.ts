// ============================================================
// Quick connection test — run this FIRST before anything else,
// to confirm DATABASE_URL actually connects and the schema/seed
// SQL you ran in Supabase landed correctly.
//
// Run: npx tsx src/harness/testDbConnection.ts
// ============================================================

import { loadEnvFile } from '../loadEnv';
loadEnvFile();

import { Pool } from 'pg';

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('❌ DATABASE_URL not found in .env — add it first (see POSTGRES-MIGRATION.md).');
    process.exit(1);
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  try {
    console.log('Connecting to Supabase...');
    const skillsResult = await pool.query('select count(*) as count from skills');
    const prereqResult = await pool.query('select count(*) as count from skill_prerequisites');

    console.log('✅ Connected successfully!\n');
    console.log(`  skills table: ${skillsResult.rows[0].count} rows (expected: 44)`);
    console.log(`  skill_prerequisites table: ${prereqResult.rows[0].count} rows (expected: 32)`);

    const sample = await pool.query('select name_ar, category from skills limit 3');
    console.log('\n  Sample rows:');
    sample.rows.forEach((r) => console.log(`    - ${r.name_ar} (${r.category})`));

    const skillCount = Number(skillsResult.rows[0].count);
    const prereqCount = Number(prereqResult.rows[0].count);

    if (skillCount === 44 && prereqCount === 32) {
      console.log('\n✅ Everything matches expected counts. Database is ready.');
    } else {
      console.log('\n⚠️  Counts don\'t match expected values — re-check that both SQL files ran successfully.');
    }
  } catch (err: any) {
    console.error('❌ Connection or query failed:');
    console.error(`   ${err.message}`);
    console.error('\n   Common causes:');
    console.error('   - DATABASE_URL password not substituted (still says [YOUR-PASSWORD])');
    console.error('   - Wrong connection string type (use "Direct connection" or "Transaction pooler" URI)');
    console.error('   - 02-schema.sql or 03-seed-skills.sql did not actually run successfully');
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
