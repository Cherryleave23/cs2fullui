import { app } from 'electron';
import { join } from 'path';
import * as fs from 'fs';
import initSqlJs, { Database as SqlJsDatabase } from 'sql.js';

// Use globalThis to guarantee single instance across esbuild bundle
const DB_KEY = '__cs2_alchemy_db__';
const DB_PATH_KEY = '__cs2_alchemy_db_path__';

function getGlobalDb(): SqlJsDatabase | null {
  return (globalThis as any)[DB_KEY] ?? null;
}

function setGlobalDb(database: SqlJsDatabase | null): void {
  (globalThis as any)[DB_KEY] = database;
}

/** Get the path to the SQLite database file */
export function getDbPath(): string {
  let dbPath = (globalThis as any)[DB_PATH_KEY];
  if (!dbPath) {
    const userDataPath = app.getPath('userData');
    dbPath = join(userDataPath, 'cs2-alchemy.db');
    (globalThis as any)[DB_PATH_KEY] = dbPath;
  }
  return dbPath;
}

/** Initialize the SQL.js database, loading from disk if available */
export async function initDatabase(): Promise<SqlJsDatabase> {
  const existing = getGlobalDb();
  if (existing) return existing;

  const SQL = await initSqlJs();
  const path = getDbPath();

  let database: SqlJsDatabase;
  if (fs.existsSync(path)) {
    try {
      const buffer = fs.readFileSync(path);
      database = new SQL.Database(buffer);
      console.log(`[DB] Loaded existing database: ${path} (${(buffer.length / 1024).toFixed(1)} KB)`);
    } catch (err) {
      console.error('[DB] Failed to load database, creating new:', err);
      database = new SQL.Database();
    }
  } else {
    console.log('[DB] Creating new database');
    database = new SQL.Database();
  }

  database.run('PRAGMA journal_mode=WAL');
  database.run('PRAGMA foreign_keys=ON');

  setGlobalDb(database);
  return database;
}

/** Get the current database instance (throws if not initialized) */
export function getDatabase(): SqlJsDatabase {
  const database = getGlobalDb();
  if (!database) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return database;
}

/** Persist the in-memory database to disk */
export function saveDatabase(): void {
  const database = getGlobalDb();
  if (!database) return;
  try {
    const path = getDbPath();
    const dir = join(path, '..');
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const data = database.export();
    fs.writeFileSync(path, Buffer.from(data));
  } catch (err) {
    console.error('[DB] Failed to save database:', err);
  }
}

/** Close the database connection (saves before closing) */
export function closeDatabase(): void {
  const database = getGlobalDb();
  if (!database) return;
  saveDatabase();
  database.close();
  setGlobalDb(null);
  console.log('[DB] Database closed');
}

export function dbRun(sql: string, params?: unknown[]): void {
  getDatabase().run(sql, params);
}

export function dbAll<T = Record<string, unknown>>(sql: string, params?: unknown[]): T[] {
  const database = getDatabase();
  const stmt = database.prepare(sql);
  if (params) stmt.bind(params);
  const results: T[] = [];
  while (stmt.step()) {
    results.push(stmt.getAsObject() as T);
  }
  stmt.free();
  return results;
}

export function dbGet<T = Record<string, unknown>>(sql: string, params?: unknown[]): T | null {
  const results = dbAll<T>(sql, params);
  return results.length > 0 ? results[0] : null;
}
