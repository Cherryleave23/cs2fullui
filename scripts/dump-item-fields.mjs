// Dump full Web API item description to find wear/paint fields
import https from 'https';
import { SocksProxyAgent } from 'socks-proxy-agent';
import * as fs from 'fs';
import * as path from 'path';
import SteamUser from 'steam-user';

const { DatabaseSync } = await import('node:sqlite');
const appData = process.env.APPDATA;
const dbPath = path.join(appData, 'cs2-alchemy-manager', 'cs2-alchemy.db');
const db = new DatabaseSync(dbPath);
const active = db.prepare(
  'SELECT * FROM accounts WHERE is_active=1 AND refresh_token IS NOT NULL LIMIT 1'
).get();

// Login
const client = new SteamUser({ enablePicsCache: true, webCompatibilityMode: true });
if (active.proxy_url) {
  Object.assign(client.options, active.proxy_url.startsWith('socks')
    ? { socksProxy: active.proxy_url } : { httpProxy: active.proxy_url });
}

let cookies = null;
client.on('webSession', (_sid, c) => { cookies = c; });
client.logOn({ refreshToken: active.refresh_token, steamID: active.steam_id });

// Wait up to 30s for webSession (do NOT logOff — that kills the session!)
for (let i = 0; i < 60 && !cookies; i++) {
  await new Promise(r => setTimeout(r, 500));
}

if (!cookies) { console.error('No cookies after 30s'); process.exit(1); }
console.log('Got', cookies.length, 'cookies');

// Fetch
const rawProxy = active.proxy_url || 'socks5://127.0.0.1:10808';
const remoteProxy = rawProxy.replace(/^socks5?:\/\//, 'socks5h://');
const agent = new SocksProxyAgent(remoteProxy);
console.log('Proxy:', remoteProxy);

const apiUrl = `https://steamcommunity.com/inventory/${active.steam_id}/730/2?l=schinese&count=20`;
console.log('Fetching:', apiUrl);

const req = https.get(apiUrl, {
  agent,
  timeout: 30000,
  headers: { 'Cookie': cookies.join('; '), 'User-Agent': 'CS2TradeTool/1.0' },
}, (res) => {
  let data = '';
  res.on('data', c => data += c);
  res.on('end', () => {
    const p = JSON.parse(data);
    const descMap = new Map();
    for (const d of p.descriptions) descMap.set(`${d.classid}_${d.instanceid}`, d);

    let n = 0;
    for (const asset of p.assets) {
      const d = descMap.get(`${asset.classid}_${asset.instanceid}`);
      if (!d || d.type !== 'Base Grade') continue;
      n++;
      if (n > 3) break;
      console.log(`\n=== Item ${n}: ${d.market_hash_name} ===`);

      // Dump ALL keys
      console.log('Top-level keys:', Object.keys(d));

      // Dump descriptions array (often has detailed info)
      if (d.descriptions) {
        console.log(`\ndescriptions array (${d.descriptions.length} entries):`);
        for (const dd of d.descriptions) {
          console.log(`  value="${dd.value}"`);
        }
      }

      // Dump actions
      if (d.actions) {
        console.log('\nactions:');
        for (const a of d.actions) {
          console.log(`  name="${a.name}" link="${a.link}"`);
        }
      }

      // Dump app_data
      if (d.app_data) {
        console.log('\napp_data:', JSON.stringify(d.app_data));
      }

      // Tags
      console.log('\ntags:');
      for (const t of d.tags || []) {
        console.log(`  [${t.category}] ${t.internal_name} = "${t.localized_tag_name}"`);
      }
    }
  });
}).on('error', e => console.error('Error:', e.message));
