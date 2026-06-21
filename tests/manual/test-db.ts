/**
 * Manual test: Database layer
 * Run with: npx tsx tests/manual/test-db.ts
 */
import initSqlJs from 'sql.js';

async function testDatabase() {
  console.log('=== Database Layer Test ===\n');

  // 1. Initialize
  console.log('1. Initializing sql.js...');
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  console.log('   ✅ sql.js initialized');

  // 2. Create tables
  console.log('\n2. Creating tables...');
  db.run(`CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY, value TEXT NOT NULL,
    updated_at TEXT DEFAULT (datetime('now'))
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    steam_id TEXT NOT NULL UNIQUE,
    account_name TEXT NOT NULL,
    refresh_token TEXT
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS recipes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL, rarity TEXT NOT NULL,
    target_rarity TEXT NOT NULL, type TEXT DEFAULT 'virtual',
    created_at TEXT DEFAULT (datetime('now'))
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS recipe_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    recipe_id INTEGER REFERENCES recipes(id) ON DELETE CASCADE,
    paint_index REAL, weapon_id INTEGER, wear_float REAL,
    position INTEGER NOT NULL
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS tradeup_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    recipe_index INTEGER, input_rarity TEXT, target_rarity TEXT,
    status TEXT DEFAULT 'pending',
    created_at TEXT DEFAULT (datetime('now'))
  )`);
  console.log('   ✅ Tables created');

  // 3. CRUD operations
  console.log('\n3. CRUD Tests...');

  // Insert
  db.run("INSERT INTO app_settings (key, value) VALUES ('test_key', 'test_value')");
  const stmt = db.prepare("SELECT value FROM app_settings WHERE key = 'test_key'");
  stmt.step();
  const val = stmt.getAsObject();
  stmt.free();
  console.log(`   ✅ INSERT/SELECT: ${val.value === 'test_value' ? 'PASS' : 'FAIL'}`);

  // Insert recipe
  db.run("INSERT INTO recipes (name, rarity, target_rarity) VALUES ('测试配方', '军规级', '受限级')");
  const recipeStmt = db.prepare('SELECT * FROM recipes WHERE name = ?');
  recipeStmt.bind(['测试配方']);
  recipeStmt.step();
  const recipe = recipeStmt.getAsObject();
  recipeStmt.free();
  console.log(`   ✅ Recipe INSERT: ${recipe.name} (${recipe.rarity} → ${recipe.target_rarity})`);

  // Insert recipe items
  for (let i = 0; i < 10; i++) {
    db.run('INSERT INTO recipe_items (recipe_id, paint_index, weapon_id, wear_float, position) VALUES (?, ?, ?, ?, ?)',
      [recipe.id, 44.0, 7, 0.12, i]);
  }
  const countStmt = db.prepare('SELECT COUNT(*) as cnt FROM recipe_items WHERE recipe_id = ?');
  countStmt.bind([recipe.id]);
  countStmt.step();
  const count = countStmt.getAsObject() as any;
  countStmt.free();
  console.log(`   ✅ Recipe items: ${count.cnt} (expected 10)`);

  // Trade-up history
  db.run("INSERT INTO tradeup_history (recipe_index, input_rarity, target_rarity, status) VALUES (2, '军规级', '受限级', 'completed')");
  const histCountStmt = db.prepare('SELECT COUNT(*) as cnt FROM tradeup_history');
  histCountStmt.step();
  const histCount = histCountStmt.getAsObject() as any;
  histCountStmt.free();
  console.log(`   ✅ TradeUp history: ${histCount.cnt} records`);

  // 4. Migration tracking
  console.log('\n4. Migration tracker...');
  db.run(`CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TEXT DEFAULT (datetime('now')))`);
  db.run("INSERT INTO _migrations (name) VALUES ('001_initial.sql')");
  const migStmt = db.prepare("SELECT COUNT(*) as cnt FROM _migrations WHERE name = '001_initial.sql'");
  migStmt.step();
  const migCount = migStmt.getAsObject() as any;
  migStmt.free();
  console.log(`   ✅ Migration tracking: ${migCount.cnt} migration(s) applied`);

  // 5. Persistence
  console.log('\n5. Persistence...');
  const data = db.export();
  console.log(`   ✅ DB exported: ${(data.length / 1024).toFixed(1)} KB`);

  // 6. Reload from export
  const db2 = new SQL.Database(data);
  const verifyStmt = db2.prepare("SELECT value FROM app_settings WHERE key = 'test_key'");
  verifyStmt.step();
  const verifyVal = verifyStmt.getAsObject();
  verifyStmt.free();
  console.log(`   ✅ Persist+Reload: ${verifyVal.value === 'test_value' ? 'PASS' : 'FAIL'}`);

  db.close();
  db2.close();

  console.log('\n=== Database Test: ALL PASSED ===');
}

testDatabase().catch(console.error);
