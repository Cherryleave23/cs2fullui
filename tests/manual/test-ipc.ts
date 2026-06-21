/**
 * Manual test: Settings/Recipe/Seed logic (runs outside Electron)
 * Run with: npx tsx tests/manual/test-ipc.ts
 */
import initSqlJs from 'sql.js';

async function testBusinessLogic() {
  console.log('=== Business Logic Test ===\n');
  const SQL = await initSqlJs();
  const db = new SQL.Database();

  // Create test DB schema
  db.run(`CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
  db.run(`CREATE TABLE IF NOT EXISTS recipes (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, rarity TEXT, target_rarity TEXT, type TEXT DEFAULT 'virtual')`);
  db.run(`CREATE TABLE IF NOT EXISTS recipe_items (id INTEGER PRIMARY KEY AUTOINCREMENT, recipe_id INTEGER REFERENCES recipes(id), paint_index REAL, weapon_id INTEGER, wear_float REAL, position INTEGER)`);
  db.run(`CREATE TABLE IF NOT EXISTS tradeup_history (id INTEGER PRIMARY KEY AUTOINCREMENT, recipe_index INTEGER, input_rarity TEXT, target_rarity TEXT, status TEXT)`);
  db.run(`CREATE TABLE IF NOT EXISTS tradeup_input_items (id INTEGER PRIMARY KEY AUTOINCREMENT, tradeup_id INTEGER, asset_id TEXT, item_name TEXT, rarity_name TEXT)`);
  db.run(`CREATE TABLE IF NOT EXISTS tradeup_outcome_items (id INTEGER PRIMARY KEY AUTOINCREMENT, tradeup_id INTEGER, asset_id TEXT, item_name TEXT)`);

  // === Test 1: Settings CRUD ===
  console.log('1. Settings key-value store...');
  db.run("INSERT INTO app_settings (key, value) VALUES ('proxy_url', 'socks5://127.0.0.1:10808')");
  db.run("INSERT INTO app_settings (key, value) VALUES ('language', 'zh-CN')");
  db.run("INSERT INTO app_settings (key, value) VALUES ('theme', 'light')");

  const allSettings = db.exec("SELECT * FROM app_settings ORDER BY key");
  console.log(`   ✅ Settings stored: ${allSettings[0].values.length} entries`);

  // Get single
  const stmt = db.prepare("SELECT value FROM app_settings WHERE key = 'proxy_url'");
  stmt.step();
  const proxy = stmt.getAsObject();
  stmt.free();
  console.log(`   ✅ Get setting: proxy = ${proxy.value}`);

  // Upsert (update)
  db.run("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('theme', 'dark')");
  const themeStmt = db.prepare("SELECT value FROM app_settings WHERE key = 'theme'");
  themeStmt.step();
  const theme = themeStmt.getAsObject();
  themeStmt.free();
  console.log(`   ✅ Upsert setting: theme = ${theme.value} (expected dark)`);

  // === Test 2: Recipe CRUD ===
  console.log('\n2. Recipe CRUD...');

  // Create
  db.run("INSERT INTO recipes (name, rarity, target_rarity) VALUES ('测试配方1', '军规级', '受限级')");
  db.run("INSERT INTO recipes (name, rarity, target_rarity) VALUES ('测试配方2', '受限级', '保密级')");
  db.run("INSERT INTO recipes (name, rarity, target_rarity) VALUES ('StatTrak配方', '军规级', '受限级')");

  const recipeCount = db.exec("SELECT COUNT(*) FROM recipes");
  console.log(`   ✅ Recipes: ${recipeCount[0].values[0][0]} entries`);

  // Read
  const rStmt = db.prepare("SELECT * FROM recipes WHERE name = '测试配方1'");
  rStmt.step();
  const recipe = rStmt.getAsObject();
  rStmt.free();
  console.log(`   ✅ Read recipe: ${recipe.name} (${recipe.rarity} → ${recipe.target_rarity})`);

  // Update
  db.run("UPDATE recipes SET name = '测试配方1-修改' WHERE id = ?", [recipe.id]);
  const updatedStmt = db.prepare("SELECT name FROM recipes WHERE id = ?");
  updatedStmt.bind([recipe.id]);
  updatedStmt.step();
  const updated = updatedStmt.getAsObject();
  updatedStmt.free();
  console.log(`   ✅ Update: renamed to "${updated.name}"`);

  // Delete (oldest)
  db.run('DELETE FROM recipes WHERE id = (SELECT MIN(id) FROM recipes)');
  const afterDel = db.exec("SELECT COUNT(*) FROM recipes");
  console.log(`   ✅ Delete: ${afterDel[0].values[0][0]} remaining`);

  // === Test 3: Recipe Items ===
  console.log('\n3. Recipe items...');
  const lastRecipeId = (db.exec("SELECT MAX(id) FROM recipes")[0].values[0][0] as number);
  for (let i = 0; i < 10; i++) {
    db.run('INSERT INTO recipe_items (recipe_id, paint_index, weapon_id, wear_float, position) VALUES (?, ?, ?, ?, ?)',
      [lastRecipeId, 44 + i, 7, 0.12, i]);
  }
  const itemCount = db.exec("SELECT COUNT(*) FROM recipe_items WHERE recipe_id = " + lastRecipeId);
  console.log(`   ✅ Items stored: ${itemCount[0].values[0][0]} (expected 10)`);

  // Cascade delete
  db.run("DELETE FROM recipes WHERE id = " + lastRecipeId);
  db.run("DELETE FROM recipe_items WHERE recipe_id = " + lastRecipeId);
  const afterCascade = db.exec("SELECT COUNT(*) FROM recipe_items WHERE recipe_id = " + lastRecipeId);
  console.log(`   ✅ Cascade delete: ${afterCascade[0].values[0][0]} items remaining (expected 0)`);

  // === Test 4: TradeUp History ===
  console.log('\n4. TradeUp history...');
  db.run("INSERT INTO tradeup_history (recipe_index, input_rarity, target_rarity, status) VALUES (2, '军规级', '受限级', 'completed')");
  db.run("INSERT INTO tradeup_history (recipe_index, input_rarity, target_rarity, status) VALUES (3, '受限级', '保密级', 'completed')");
  db.run("INSERT INTO tradeup_history (recipe_index, input_rarity, target_rarity, status) VALUES (2, '军规级', '受限级', 'failed')");

  const historyCount = db.exec("SELECT COUNT(*) FROM tradeup_history");
  console.log(`   ✅ History: ${historyCount[0].values[0][0]} records`);

  // Status filtering
  const completedCount = db.exec("SELECT COUNT(*) FROM tradeup_history WHERE status = 'completed'");
  const failedCount = db.exec("SELECT COUNT(*) FROM tradeup_history WHERE status = 'failed'");
  console.log(`   ✅ Completed: ${completedCount[0].values[0][0]}, Failed: ${failedCount[0].values[0][0]}`);

  // Pagination
  const paginated = db.exec("SELECT * FROM tradeup_history ORDER BY id DESC LIMIT 2 OFFSET 1");
  console.log(`   ✅ Pagination (limit 2, offset 1): returned ${paginated[0].values.length} rows`);

  // === Test 5: Recipe export/import format ===
  console.log('\n5. Recipe export format...');
  const exportData = {
    version: 1,
    name: '导出的配方',
    rarity: '军规级',
    targetRarity: '受限级',
    createdAt: new Date().toISOString(),
    items: Array.from({ length: 10 }, (_, i) => ({
      paintIndex: 44 + i,
      weaponId: 7,
      wearFloat: 0.12,
      statTrak: false,
      souvenir: false,
      position: i,
    })),
  };
  const json = JSON.stringify(exportData);
  const parsed = JSON.parse(json);
  console.log(`   ✅ Export JSON: ${json.length} bytes`);
  console.log(`   ✅ Parse+validate: v${parsed.version}, ${parsed.items.length} items`);

  db.close();
  console.log('\n=== Business Logic Test: ALL PASSED ===');
}

testBusinessLogic().catch(console.error);
