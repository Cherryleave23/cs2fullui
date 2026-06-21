import * as fs from 'fs';
import { join } from 'path';
import { getDatabase, saveDatabase, dbGet, dbRun } from '../connection';

/**
 * Run all pending migrations.
 * Migrations are idempotent (use IF NOT EXISTS) — safe to run multiple times.
 */
export function runMigrations(): void {
  const db = getDatabase();

  // Ensure _migrations tracking table exists
  db.run(`CREATE TABLE IF NOT EXISTS _migrations (
    name TEXT PRIMARY KEY,
    applied_at TEXT DEFAULT (datetime('now'))
  )`);

  // Read migration files from this directory
  const migrationsDir = __dirname;
  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.match(/^\d+_.*\.sql$/))
    .sort();

  let appliedCount = 0;

  for (const file of files) {
    const alreadyApplied = dbGet<{ name: string }>(
      'SELECT name FROM _migrations WHERE name = ?',
      [file]
    );

    if (alreadyApplied) {
      continue;
    }

    console.log(`[DB] Applying migration: ${file}`);
    const sql = fs.readFileSync(join(migrationsDir, file), 'utf-8');
    db.run(sql);
    dbRun('INSERT INTO _migrations (name) VALUES (?)', [file]);
    appliedCount++;
  }

  if (appliedCount > 0) {
    saveDatabase();
    console.log(`[DB] ${appliedCount} migration(s) applied`);
  } else {
    console.log('[DB] All migrations up to date');
  }
}
