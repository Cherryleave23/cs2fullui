import { getDatabase, saveDatabase, dbGet, dbRun } from '../connection';

/**
 * All migration SQL embedded inline (not loaded from filesystem).
 * sql.js db.run() only executes ONE statement — must split by semicolons.
 */

const MIGRATION_001 = `
-- Accounts
CREATE TABLE IF NOT EXISTS accounts (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    steam_id        TEXT NOT NULL UNIQUE,
    account_name    TEXT NOT NULL,
    nickname        TEXT,
    avatar_url      TEXT,
    refresh_token   TEXT,
    machine_token   TEXT,
    shared_secret   TEXT,
    proxy_url       TEXT,
    web_compat      INTEGER DEFAULT 0,
    is_active       INTEGER DEFAULT 0,
    last_login_at   TEXT,
    created_at      TEXT DEFAULT (datetime('now')),
    updated_at      TEXT DEFAULT (datetime('now'))
);

-- Inventory items
CREATE TABLE IF NOT EXISTS inventory_items (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id      INTEGER NOT NULL REFERENCES accounts(id),
    asset_id        TEXT NOT NULL UNIQUE,
    def_index       INTEGER NOT NULL,
    paint_index     REAL,
    paint_seed      INTEGER,
    paint_wear      REAL,
    rarity          INTEGER,
    quality         INTEGER,
    origin          INTEGER,
    custom_name     TEXT,
    kill_eater_value INTEGER,
    kill_eater_score_type INTEGER,
    casket_id       TEXT,
    tradable_after  TEXT,
    position        INTEGER,
    in_use          INTEGER DEFAULT 0,
    resolved_type   TEXT NOT NULL,
    resolved_name   TEXT NOT NULL,
    resolved_name_zh TEXT,
    rarity_name     TEXT,
    rarity_name_zh  TEXT,
    rarity_color    TEXT,
    wear_category   TEXT,
    wear_category_zh TEXT,
    min_float       REAL DEFAULT 0.0,
    max_float       REAL DEFAULT 1.0,
    market_hash_name TEXT,
    weapon_type     TEXT,
    collection_name TEXT,
    image_url       TEXT,
    is_stattrak     INTEGER DEFAULT 0,
    is_souvenir     INTEGER DEFAULT 0,
    extra_json      TEXT
);

-- Trade-up history
CREATE TABLE IF NOT EXISTS tradeup_history (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id      INTEGER NOT NULL REFERENCES accounts(id),
    recipe_id       INTEGER REFERENCES recipes(id),
    recipe_index    INTEGER NOT NULL,
    input_rarity    TEXT NOT NULL,
    target_rarity   TEXT NOT NULL,
    avg_wear_norm   REAL,
    status          TEXT NOT NULL DEFAULT 'pending',
    outcome_json    TEXT,
    started_at      TEXT,
    completed_at    TEXT,
    error_message   TEXT,
    created_at      TEXT DEFAULT (datetime('now'))
);

-- Trade-up input items
CREATE TABLE IF NOT EXISTS tradeup_input_items (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    tradeup_id      INTEGER NOT NULL REFERENCES tradeup_history(id) ON DELETE CASCADE,
    asset_id        TEXT NOT NULL,
    paint_index     REAL NOT NULL,
    weapon_id       INTEGER NOT NULL,
    wear_float      REAL NOT NULL,
    item_name       TEXT NOT NULL,
    rarity_name     TEXT NOT NULL,
    UNIQUE(tradeup_id, asset_id)
);

-- Trade-up outcome items
CREATE TABLE IF NOT EXISTS tradeup_outcome_items (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    tradeup_id      INTEGER NOT NULL REFERENCES tradeup_history(id) ON DELETE CASCADE,
    asset_id        TEXT NOT NULL,
    item_name       TEXT NOT NULL,
    paint_index     REAL,
    wear_float      REAL,
    rarity_name     TEXT,
    wear_category   TEXT,
    collection_name TEXT,
    UNIQUE(tradeup_id, asset_id)
);

-- Recipes
CREATE TABLE IF NOT EXISTS recipes (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    name            TEXT NOT NULL,
    description     TEXT,
    type            TEXT NOT NULL DEFAULT 'virtual',
    rarity          TEXT NOT NULL,
    target_rarity   TEXT NOT NULL,
    is_stattrak     INTEGER DEFAULT 0,
    avg_wear_norm   REAL,
    outcome_summary TEXT,
    tags            TEXT,
    created_at      TEXT DEFAULT (datetime('now')),
    updated_at      TEXT DEFAULT (datetime('now'))
);

-- Recipe items
CREATE TABLE IF NOT EXISTS recipe_items (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    recipe_id       INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
    paint_index     REAL NOT NULL,
    weapon_id       INTEGER NOT NULL,
    wear_float      REAL NOT NULL,
    asset_id        TEXT,
    stattrak        INTEGER DEFAULT 0,
    souvenir        INTEGER DEFAULT 0,
    position        INTEGER NOT NULL
);

-- Price cache
CREATE TABLE IF NOT EXISTS price_cache (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    item_hash_name  TEXT NOT NULL UNIQUE,
    source          TEXT NOT NULL,
    current_price   REAL,
    lowest_price    REAL,
    median_price    REAL,
    volume_24h      INTEGER,
    currency        TEXT DEFAULT 'CNY',
    last_fetched_at TEXT,
    data_json       TEXT,
    created_at      TEXT DEFAULT (datetime('now')),
    updated_at      TEXT DEFAULT (datetime('now'))
);

-- Price history
CREATE TABLE IF NOT EXISTS price_history (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    item_hash_name  TEXT NOT NULL,
    source          TEXT NOT NULL,
    price           REAL NOT NULL,
    volume          INTEGER,
    recorded_at     TEXT DEFAULT (datetime('now'))
);

-- App settings
CREATE TABLE IF NOT EXISTS app_settings (
    key             TEXT PRIMARY KEY,
    value           TEXT NOT NULL,
    updated_at      TEXT DEFAULT (datetime('now'))
);
`;

/**
 * Execute a multi-statement SQL block.
 * sql.js db.exec() handles semicolon-separated statements correctly.
 */
function execSQL(sql: string): void {
  const db = getDatabase();
  const statements = sql
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0 && !s.startsWith('--'));

  for (const stmt of statements) {
    try {
      db.run(stmt + ';');
    } catch (err: any) {
      // Ignore "duplicate column" errors from ALTER TABLE
      if (err.message?.includes('duplicate column')) continue;
      // Ignore IF NOT EXISTS already-existing-object errors
      if (err.message?.includes('already exists')) continue;
      console.warn(`[DB] SQL statement warning: ${err.message}`);
    }
  }
}

/**
 * Run all pending migrations.
 * Now with inline SQL — no filesystem dependency.
 */
export function runMigrations(): void {
  const db = getDatabase();

  // Ensure tracking table
  db.run(`CREATE TABLE IF NOT EXISTS _migrations (
    name TEXT PRIMARY KEY,
    applied_at TEXT DEFAULT (datetime('now'))
  )`);

  // ── Migration 001 ──
  const applied001 = dbGet<{ name: string }>(
    'SELECT name FROM _migrations WHERE name = ?', ['001_initial']
  );

  if (!applied001) {
    console.log('[DB] Applying migration 001_initial (inline)');
    execSQL(MIGRATION_001);
    dbRun('INSERT INTO _migrations (name) VALUES (?)', ['001_initial']);
    saveDatabase();
    console.log('[DB] Migration 001 applied');
  } else {
    // Verify core tables actually exist (corruption check)
    const check = dbGet<{ cnt: number }>(
      "SELECT COUNT(*) as cnt FROM sqlite_master WHERE type='table' AND name='accounts'"
    );
    if (!check || check.cnt === 0) {
      console.warn('[DB] CORRUPTION: migration marked applied but accounts table missing — reapplying');
      db.run("DELETE FROM _migrations WHERE name = '001_initial'");
      execSQL(MIGRATION_001);
      dbRun('INSERT INTO _migrations (name) VALUES (?)', ['001_initial']);
      saveDatabase();
      console.log('[DB] Migration 001 reapplied');
    }
  }

  console.log('[DB] Migrations ready');
}
