-- ============================================================
-- Migration 001: Initial Schema
-- CS2 Alchemy Manager — all core tables
-- ============================================================

-- Account / authentication
CREATE TABLE IF NOT EXISTS accounts (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    steam_id        TEXT NOT NULL UNIQUE,
    account_name    TEXT NOT NULL,
    refresh_token   TEXT,             -- Encrypted JWT refresh token
    machine_token   TEXT,             -- Machine auth token (sentry)
    shared_secret   TEXT,             -- TOTP shared secret (auto-2FA)
    proxy_url       TEXT,             -- socks5:// or http:// proxy
    web_compat      INTEGER DEFAULT 0,
    last_login_at   TEXT,
    created_at      TEXT DEFAULT (datetime('now')),
    updated_at      TEXT DEFAULT (datetime('now'))
);

-- Resolved inventory items
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
    -- Resolved fields
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
    -- Extra metadata as JSON (stickers, keychains)
    extra_json      TEXT
);

CREATE INDEX IF NOT EXISTS idx_inventory_items_account ON inventory_items(account_id);
CREATE INDEX IF NOT EXISTS idx_inventory_items_type ON inventory_items(resolved_type);
CREATE INDEX IF NOT EXISTS idx_inventory_items_rarity ON inventory_items(rarity);
CREATE INDEX IF NOT EXISTS idx_inventory_items_weapon ON inventory_items(weapon_type);

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

CREATE INDEX IF NOT EXISTS idx_tradeup_history_account ON tradeup_history(account_id);

-- Items used in a trade-up (the 10 inputs)
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

-- Items received from a trade-up
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

-- Recipes (saved trade-up configurations)
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

CREATE INDEX IF NOT EXISTS idx_price_cache_source ON price_cache(source);
CREATE INDEX IF NOT EXISTS idx_price_cache_updated ON price_cache(updated_at);

-- Price history for trend charts
CREATE TABLE IF NOT EXISTS price_history (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    item_hash_name  TEXT NOT NULL,
    source          TEXT NOT NULL,
    price           REAL NOT NULL,
    volume          INTEGER,
    recorded_at     TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_price_history_item ON price_history(item_hash_name, source);
CREATE INDEX IF NOT EXISTS idx_price_history_recorded ON price_history(recorded_at);

-- App settings (key-value store)
CREATE TABLE IF NOT EXISTS app_settings (
    key             TEXT PRIMARY KEY,
    value           TEXT NOT NULL,
    updated_at      TEXT DEFAULT (datetime('now'))
);

-- Migration tracking table
CREATE TABLE IF NOT EXISTS _migrations (
    name        TEXT PRIMARY KEY,
    applied_at  TEXT DEFAULT (datetime('now'))
);
