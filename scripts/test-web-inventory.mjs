/**
 * test-web-inventory.mjs — Steam Web API 库存拉取最小验证
 *
 * 用法: node scripts/test-web-inventory.mjs
 *
 * 流程:
 *   1. 从 DB 读取 saved refreshToken + proxyUrl
 *   2. login → webSession → 获取 cookies
 *   3. GET steamcommunity.com/inventory/... 拿库存
 *   4. 解析前5件，打印字段
 */

import SteamUser from 'steam-user';
import GlobalOffensive from 'globaloffensive';
import https from 'https';
import * as fs from 'fs';
import * as path from 'path';
import { SocksProxyAgent } from 'socks-proxy-agent';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// DB path: Electron userData directory (same as app.getPath('userData'))
function findDbPath() {
  const appData = process.env.APPDATA || path.join(process.env.HOME || '', 'AppData', 'Roaming');
  const candidates = [
    path.join(appData, 'cs2-alchemy-manager', 'cs2-alchemy.db'),
    path.join(appData, 'cs2-alchemy', 'cs2-alchemy.db'),
    path.join(appData, 'CS2-UIfull', 'cs2-alchemy.db'),
    path.join(__dirname, '..', 'out', 'main', 'cs2-alchemy.db'),
    path.join(__dirname, '..', 'cs2-alchemy.db'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

const DB_PATH = findDbPath();
if (!DB_PATH) {
  console.error('Database not found. Tried:');
  const appData = process.env.APPDATA || path.join(process.env.HOME || '', 'AppData', 'Roaming');
  console.error(`  ${path.join(appData, 'cs2-alchemy', 'cs2-alchemy.db')} (standard)`);
  process.exit(1);
}

console.log(`[Test] DB found: ${DB_PATH}`);

// ── 1. 读取 DB (sql.js 需要 wasm，这里直接用 better-sqlite3 或 node sqlite3)
// 兼容方案: 直接读 json 备份 或 手写 sqlite 读取
const { DatabaseSync } = await import('node:sqlite');
const db = new DatabaseSync(DB_PATH);

const active = db.prepare(
  'SELECT * FROM accounts WHERE is_active = 1 AND refresh_token IS NOT NULL LIMIT 1'
).get();

if (!active) {
  console.error('No active account with refresh_token found in DB.');
  console.log('Available accounts:');
  for (const a of db.prepare('SELECT account_name, is_active, refresh_token IS NOT NULL as has_token FROM accounts').all()) {
    console.log(`  ${a.account_name} active=${a.is_active} has_token=${a.has_token}`);
  }
  process.exit(1);
}

console.log(`[Test] Account: ${active.account_name} (${active.steam_id})`);

const proxyUrl = active.proxy_url || '';
if (proxyUrl) {
  console.log(`[Test] Proxy: ${proxyUrl}`);
} else {
  console.log('[Test] No proxy configured — direct connect');
}

// ── 2. 登录获取 webSession cookies ──
console.log('[Test] Logging in...');
const client = new SteamUser({
  enablePicsCache: true,
  webCompatibilityMode: true,
});
const csgo = new GlobalOffensive(client);

if (proxyUrl) {
  if (proxyUrl.startsWith('socks')) {
    Object.assign(client.options, { socksProxy: proxyUrl });
  } else {
    Object.assign(client.options, { httpProxy: proxyUrl });
  }
}

let webCookies = null;
let loginResolve = null;
const loginDone = new Promise((resolve) => { loginResolve = resolve; });

client.on('loggedOn', () => {
  console.log(`[Test] Logged on: ${client.steamID?.getSteamID64()}`);
  client.setPersona(SteamUser.EPersonaState.Online);
});

client.on('webSession', (sessionID, cookies) => {
  console.log(`[Test] Web session established, ${cookies.length} cookies`);
  webCookies = cookies;
});

client.on('refreshToken', (token) => {
  console.log('[Test] Got new refreshToken');
  // Save back
  db.prepare(
    'UPDATE accounts SET refresh_token = ?, updated_at = datetime(\'now\') WHERE steam_id = ?'
  ).run(token, active.steam_id);
});

client.on('steamGuard', (domain, cb) => {
  console.log('[Test] Steam Guard needed — please enter code:');
  process.stdin.once('data', (d) => {
    cb(d.toString().trim());
  });
});

client.on('error', (err) => {
  console.error(`[Test] Steam error: ${err.message} (${err.eresult})`);
  loginResolve?.();
  process.exit(1);
});

const connectedToGC = new Promise((resolve) => {
  csgo.on('connectedToGC', () => {
    console.log(`[Test] GC connected — ${csgo.inventory?.length || 0} items`);
    resolve();
  });
});

// Login with saved token
client.logOn({
  refreshToken: active.refresh_token,
  steamID: active.steam_id,
});

// Wait for both webSession AND 10s timeout for GC
await Promise.race([
  new Promise((resolve) => {
    const check = () => {
      if (webCookies) { setTimeout(resolve, 3000); return; }
      setTimeout(check, 500);
    };
    check();
  }),
  new Promise((resolve) => setTimeout(resolve, 15000)),
]);

client.gamesPlayed([]);
if (csgo) csgo.removeAllListeners();

console.log(`[Test] webCookies: ${webCookies ? `${webCookies.length} cookies` : 'NOT OBTAINED'}`);

if (!webCookies) {
  console.error('Failed to get webSession cookies — cannot proceed with Web API test');
  loginResolve?.();
  process.exit(1);
}

// ── 3. 调用 Web API ──
const steamId = active.steam_id;
const cookieStr = webCookies.join('; ');
console.log(`[Test] Cookie preview: ${cookieStr.slice(0, 100)}...`);

const apiUrl = `https://steamcommunity.com/inventory/${steamId}/730/2?l=schinese&count=100`;

console.log(`[Test] Fetching: ${apiUrl}`);
const fetchResult = await new Promise((resolve) => {
  const url = new URL(apiUrl);
  const options = {
    hostname: url.hostname,
    path: url.pathname + url.search,
    method: 'GET',
    headers: {
      'Cookie': cookieStr,
      'User-Agent': 'CS2TradeTool/1.0 (Valve/Steam HTTP Client 1.0)',
      'Accept': 'application/json',
    },
    rejectUnauthorized: false,
    timeout: 30000,
  };
  if (proxyUrl) {
    // Use socks5h:// for remote DNS resolution (Steam domains blocked by GFW)
    const remoteDnsProxy = proxyUrl.replace(/^socks5?:\/\//, 'socks5h://');
    options.agent = new SocksProxyAgent(remoteDnsProxy);
  }

  https.get(options, (res) => {
    let data = '';
    res.on('data', (chunk) => data += chunk);
    res.on('end', () => {
      try {
        const parsed = JSON.parse(data);
        resolve({ success: parsed.success, total: parsed.total_inventory_count, assets: parsed.assets, descriptions: parsed.descriptions });
      } catch (err) {
        resolve({ error: err.message, raw: data.slice(0, 500) });
      }
    });
  }).on('error', (err) => resolve({ error: err.message }));
});

console.log('[Test] Result:', fetchResult.success ? `✓ ${fetchResult.total} items` : `✗ ${fetchResult.error}`);

if (fetchResult.success) {
  // ── 4. 解析前5件 ──
  const descMap = new Map();
  for (const d of fetchResult.descriptions || []) {
    descMap.set(`${d.classid}_${d.instanceid}`, d);
  }

  const sample = (fetchResult.assets || []).slice(0, 5);
  console.log(`\n=== Sample ${sample.length} of ${fetchResult.total} items ===\n`);

  for (const asset of sample) {
    const descKey = `${asset.classid}_${asset.instanceid}`;
    const desc = descMap.get(descKey);

    const tags = {};
    for (const tag of desc?.tags || []) {
      tags[tag.category] = tag.name;
    }

    console.log(`AssetID:  ${asset.assetid}`);
    console.log(`  Name:         ${desc?.market_hash_name || '-'}`);
    console.log(`  NameZh:       ${desc?.name || '-'}`);
    console.log(`  Type:         ${desc?.type || '-'}`);
    console.log(`  Rarity:       ${tags['Rarity'] || '-'}`);
    console.log(`  Collection:   ${tags['Collection'] || '-'}`);
    console.log(`  Quality:      ${tags['Quality'] || 'Normal'}`);
    console.log(`  Tradable:     ${asset.tradable}`);
    console.log(`  MarketTrade:  ${asset.market_tradable_restriction ?? 'none'}`);
    console.log(`  ClassID:      ${asset.classid}  InstanceID: ${asset.instanceid}`);
    console.log(`  Icon:         ${desc?.icon_url || '-'}`);

    // Check if paint_wear is available
    const wearDesc = desc?.descriptions?.find(d => d.value?.includes('磨损'));
    console.log(`  Wear (text):  ${wearDesc?.value || 'NOT AVAILABLE'}`);
    console.log('---');
  }
}

client.logOff();
loginResolve?.();
process.exit(0);
