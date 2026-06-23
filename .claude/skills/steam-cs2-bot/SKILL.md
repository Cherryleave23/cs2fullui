---
name: steam-cs2-bot
description: 'Reference for steam-user, globaloffensive, steam-session, and ByMykel/CSGO-API. Use when writing or debugging Steam bots, CS2 trade tools, or any code that needs to resolve CS2 item IDs to human-readable names/rarities/images.'
argument-hint: '[topic: auth|trade|inventory|chat|friends|cs2|cdn|tickets|crafting|storage|csgoapi|skins|stickers|crates|electron|cli]'
allowed-tools: 'Bash(git:*), Bash(npm:*), Read, Write, Edit, Glob, Grep, WebFetch, WebSearch'
disable-model-invocation: false
license: MIT
compatibility: 'Node.js v14+, steam-user v5.x, globaloffensive v3.3.0'
---

# Steam + CS2 Bot Development

**Source repos:** [`steam-user`](https://github.com/DoctorMcKay/node-steam-user), [`globaloffensive`](https://github.com/DoctorMcKay/node-globaloffensive), [`CSGO-API`](https://github.com/ByMykel/CSGO-API), [`steam-session`](https://github.com/DoctorMcKay/node-steam-session)

## On-Demand References

Load only when the task matches. Each file is a self-contained deep-dive.

| File | Content | Load when... |
|------|---------|--------------|
| `references/steam-user.md` | SteamUser API (connection, chat, friends, CDN, tickets) | Writing/debugging steam-user code |
| `references/globaloffensive.md` | CS2 GC reference (items, inspection, events, craft, storage) | Working with csgo.* methods |
| `references/csgo-api.md` | CSGO-API data source + local inventory matching | Resolving CS2 item IDs |
| `references/steam-session.md` | Authentication library | Steam auth/session issues |
| `references/cs2tradetool-cli.md` | **CLI project**: architecture, CsgoResolver, matching engine, TradeUpSimulator, RecipeManager, login, CLI commands | Working on the Node.js CLI tool |
| `references/cs2-uitool-electron.md` | **Electron project**: esbuild rules, wear formula, all.json structure, price traps, sub-recipe algorithm, sql.js patterns | Working on the Electron desktop app |

## Quick Start

```js
const SteamUser = require('steam-user');
const GlobalOffensive = require('globaloffensive');

const client = new SteamUser({ enablePicsCache: true, webCompatibilityMode: true });
const csgo = new GlobalOffensive(client);

client.on('loggedOn', () => {
  client.setPersona(SteamUser.EPersonaState.Online);
  client.gamesPlayed([730]);  // → CS2 GC
});
client.on('error', (err) => { console.error(err); process.exit(1); });
client.logOn({ refreshToken: '...' });
```

## Critical Gotchas

1. **Always handle `error` events** on SteamUser + GlobalOffensive — unhandled → crash
2. **Do NOT call GC methods before `connectedToGC`** — check `csgo.haveGCSession`
3. **TOTP wrong code** → wait 30s before retry (IP ban risk)
4. **`craft()` needs exactly 10 items** of same grade
5. **`def_index` ≠ item identity** — use `stickers[0].sticker_id` for stickers
6. **`enablePicsCache: true`** required for ownership checks
7. **Casket items still in `csgo.inventory`** — filter `!item.casket_id`
8. **Category keys singular** — `crate` not `crates`
9. **ST/SV names**: `AK-47（StatTrak™）│ 翔鹤`
10. **Electron: no `require()` in esbuild bundles** — use static `import`
11. **all.json skin entries lack `collections`** — cross-reference `collection-set-*` entries