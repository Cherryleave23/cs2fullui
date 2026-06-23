---
name: steam-cs2-bot
description: 'Reference for steam-user, globaloffensive, steam-session, and ByMykel/CSGO-API. Use when writing or debugging Steam bots, CS2 trade tools, or any code that needs to resolve CS2 item IDs to human-readable names/rarities/images.'
argument-hint: '[topic: auth|trade|inventory|chat|friends|cs2|cdn|tickets|crafting|storage|csgoapi|skins|stickers|crates]'
allowed-tools: 'Bash(git:*), Bash(npm:*), Read, Write, Edit, Glob, Grep, WebFetch, WebSearch'
disable-model-invocation: false
license: MIT
compatibility: 'Node.js v14+, steam-user v5.x, globaloffensive v3.3.0, steam-session v1.9.4, @node-steam/vdf'
---

# Steam + CS2 Bot Development

Integrated reference for `steam-user` (v5.x), `globaloffensive` (v3.3.0),
`steam-session` (v1.9.4), and `CSGO-API` (latest).
Node.js v14+ required, steam-user ≥ v4.2.0 for globaloffensive.

**Source repositories:**
- [`steam-user`](https://github.com/DoctorMcKay/node-steam-user) — Steam client protocol
- [`globaloffensive`](https://github.com/DoctorMcKay/node-globaloffensive) — CS2 Game Coordinator
- [`CSGO-API`](https://github.com/ByMykel/CSGO-API) — static JSON data: skins, stickers, crates, etc.
- [`steam-session`](https://github.com/DoctorMcKay/node-steam-session) — Steam authentication

**Reference files (loaded on demand):**
- `references/steam-session.md` — Authentication library
- `references/steam-user.md` — SteamUser API (connection, chat, friends, CDN, tickets, etc.)
- `references/globaloffensive.md` — CS2 GC reference (items, inspection, events)
- `references/csgo-api.md` — CSGO-API data source + local inventory matching

---

## When to Use

Invoke this skill whenever you are:
- Writing code that imports `steam-user` or `globaloffensive`
- Debugging Steam authentication, connection, or session issues
- Working with CS2 inventory, item inspection, crafting, or storage units
- Implementing Steam chat, friends, or persona features
- Setting up CDN depot downloads or app auth tickets
- Configuring family sharing or trade URLs
- Looking up Steam/CS2 enum values, event signatures, or method parameters
- Resolving CS2 weapon `def_index`, `paint_index`, `sticker_id`, `rarity`, or `crate` IDs
- Looking up skin wear ranges, market hash names, or collection/crate contents
- Fetching static CS2 item data via CSGO-API JSON endpoints

---

## Quick Start / Skeleton

```js
const SteamUser = require('steam-user');
const GlobalOffensive = require('globaloffensive');

const client = new SteamUser({
  enablePicsCache: true,         // REQUIRED for ownership checks
  changelistUpdateInterval: 60000,
  language: 'english',
});

const csgo = new GlobalOffensive(client);
// Validates steam-user >= 4.2.0

client.on('loggedOn', () => {
  client.setPersona(SteamUser.EPersonaState.Online);
  client.gamesPlayed([730]);         // → CS2 GC connection
});

client.on('error', (err) => {        // MUST handle — unhandled = crash
  console.error('Fatal:', err.eresult);
  process.exit(1);
});

client.logOn({ refreshToken: '...' });
```

---

## cs2tradetool — 项目范式 (v2, 必须严格遵守)

以下为 cs2tradetool 项目的完整架构与实现范式。**所有修改必须遵循此处定义
的代码结构、数据流、命名约定和逻辑规则。** 此范式是经过 40+ 轮实战调试验证的
最终版本。

### 架构总览

```
cs2tradetool/
├── index.js              ← 主程序: 登录/库存导出/汰换执行/模拟 (~900行)
│   数据流: Steam GC → CSOEconItem → CsgoResolver → processInventory → JSON
├── generate_dict.js       ← 数据下载: all.json + items_game.txt + csgo_english.txt
├── lib/
│   ├── tradeup-sim.js    ← 汰换模拟器 (TradeUpSimulator 类, 纯算法)
│   └── recipe-manager.js ← 配方管理 (RecipeManager 类, 持久化+验证)
├── data/
│   ├── all.json          ← 单一数据源 (71MB, 45,756条, zh-CN)
│   ├── tokens.json       ← Refresh Token 持久化 (多账户: { name: token })
│   └── game/
│       ├── items_game.txt    ← VDF 格式, 断层回退
│       └── csgo_english.txt  ← 英文翻译, 断层回退
└── .claude/skills/steam-cs2-bot/
    ├── SKILL.md           ← 本文件 (核心指令+范式)
    └── references/        ← 按需加载的 API 参考
```

### 铁律 (不可变更)

1. **`def_index` 永远不是物品身份** — GC 中 `def_index=1209` 是通用贴纸容器,
   `stickers[0].sticker_id` 才是真实身份。512 件物品共用 `def_index=1209` 但有
   101 种不同 `sticker_id` 证实了这一点。
2. **all.json 是唯一数据源** — 不允许多文件回退到旧的 CSGO-API 分散文件。
3. **约束制引擎不可降级为计分制** — TYPE_RULES 定义每种物品的 required/forbidden 特征，全部满足才确认。不可回到 if/else 顺序分派。
4. **类别搜索必须用单数形式** — `crate` 非 `crates`, 匹配 all.json key 前缀。
5. **items_game.txt 断层回退不可移除** — 填补 CSGO-API 贴纸断层 (1695-1738 等)。
6. **磨损输入必须校验合法性** — `wearFloat ∈ [minFloat, maxFloat]`, 否则拒绝。
7. **产出磨损必须 clamp** — `outWear ∈ [outMin, outMax]`
8. **ST/Souvenir 名称必须与 all.json 格式一致** —
   `AK-47（StatTrak™）| 翔鹤`, `AK-47（纪念品）| 翔鹤`

---

### 模块 1: CsgoResolver — 物品解析器

单一数据源 (all.json) + 断层回退。**范式代码 (不可改结构):**

```js
class CsgoResolver {
  constructor() {
    this._all = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'all.json'), 'utf8'));
    this._allKeys = Object.keys(this._all);
    this._buildIndexes();
  }

  _buildIndexes() {
    this._skinByKey = {};    // "paint_index|weapon_id" → entry
    this._stickerById = {};  // sticker_id → entry
    this._byTypeAndDef = {}; // "type|def_index" → entry
    this._weaponIds = new Set();

    for (const key of this._allKeys) {
      const item = this._all[key];
      const type = key.split('-')[0];

      if (type === 'skin' && item.paint_index && item.weapon?.weapon_id) {
        this._skinByKey[`${item.paint_index}|${item.weapon.weapon_id}`] = item;
        this._weaponIds.add(item.weapon.weapon_id);
      }
      if (type === 'sticker') {
        this._stickerById[key.replace('sticker-', '')] = item;
      }
      if (item.def_index) {
        (this._byTypeAndDef[type] ??= {})[item.def_index] = item;
      }
    }
  }

  resolveSkin(paintIndex, weaponId) {
    return this._skinByKey[`${paintIndex}|${weaponId}`] || null;
  }

  resolveSticker(stickerId) {
    if (this._stickerById[stickerId]) return this._stickerById[stickerId];
    // 断层回退: items_game.txt
    if (gameDataFallback) {
      const name = gameDataFallback.getStickerName(stickerId);
      if (name) return { name: `印花 | ${name}`, _source: 'gamefile' };
    }
    return null;
  }

  resolveByDef(type, defIndex) {
    return this._byTypeAndDef[type]?.[String(defIndex)] || null;
  }

  // 单数形式, 匹配 all.json key 前缀
  getAllCategories() {
    return ['crate', 'collectible', 'agent', 'music_kit', 'graffiti',
            'patch', 'keychain', 'key', 'tool', 'sticker_slab'];
  }

  isKnownWeapon(defIndex) { return this._weaponIds.has(defIndex); }
}
```

**items_game.txt 断层回退加载:**

```js
const VDF = require('@node-steam/vdf');
const gameVdf = VDF.parse(fs.readFileSync('data/game/items_game.txt', 'utf8'));
this.stickerKits = gameVdf.items_game.sticker_kits;
this.getStickerName = (id) => translate(this.stickerKits[id]?.item_name);
```

---

### 模块 2: 约束制匹配引擎 — GC 物品识别核心

文件: `lib/item-matcher.js`。**不再使用顺序分派或计分制。**

每种物品类型在 `TYPE_RULES` 中定义两组特征:
- `required`: **必须全部满足** — 任一项不满足 → 拒绝此类型
- `forbidden`: **绝对不能出现** — 任一项出现 → 拒绝此类型

**完整规则表 (不可更改):**

| 类型 | required | forbidden |
|------|----------|-----------|
| skin | hasPaint | hasGraffitiTint, hasMusicIndex |
| weapon | isWeapon | hasPaint, hasGraffitiTint, hasMusicIndex |
| sticker | hasSticker | hasGraffitiTint, hasMusicIndex, hasPaint |
| graffiti | hasGraffitiTint | (无) |
| music_kit | hasMusicIndex | hasPaint |
| crate | inCrateDefRange | hasSticker, hasPaint, hasMusicIndex, hasGraffitiTint |
| collectible | inCollectibleDefRange | hasPaint, hasMusicIndex, hasGraffitiTint |
| agent | inAgentDefRange | hasPaint, hasMusicIndex, hasGraffitiTint |
| keychain | inKeychainDefRange | hasPaint, hasSticker, hasMusicIndex, hasGraffitiTint |
| patch | inPatchDefRange | hasPaint, hasMusicIndex, hasGraffitiTint |

**匹配流程 (不可更改):**

```
CSOEconItem
  │
  ├─ Phase 1: _collectSignals() — 收集 14 种特征信号
  │     hasSticker, hasPaint, hasWear, isWeapon,
  │     hasMusicIndex, hasGraffitiTint, isStatTrak, isSouvenir, ...
  │
  ├─ Phase 2: 并行检查所有 TYPE_RULES
  │     for each type:
  │       required 全部满足? AND forbidden 无一违反?
  │       → YES: 加入候选列表
  │       → NO:  直接拒绝
  │
  ├─ Phase 3: 多候选时按精度基数选择
  │     agent(159) > music_kit(53) > crate(20.9)
  │     > collectible(15.9) > graffiti(4.7) > sticker(0.96)
  │
  └─ Phase 4: 名称解析
        skin → paint_index|weapon_id → all.json
        sticker → sticker_id → all.json / items_game.txt 回退
        graffiti → all.json key: graffiti-{sticker_id}_{tint_id}
        music_kit → music_index → all.json
        crate/collectible/agent → def_index → all.json
```

**约束制 vs 旧计分制 (关键区别):**

| 场景 | 旧计分制 | 约束制 |
|------|---------|--------|
| def=1349, 有 sticker+graffiti_tint | sticker +25, graffiti +50 → 比分数 | graffiti 匹配 ✅, sticker 因 forbidden=hasGraffitiTint 被拒 |
| def=4799, 有 sticker, no paint | sticker +25, collectible -10 → sticker 赢 | collectible 匹配 ✅, sticker 因 forbidden=hasPaint/hasGraffitiTint 不全满足仍被拒 |
| def=4236, no sticker, no paint | 精度分排序: crate 20.9 > collectible 15.9 | crate 匹配 ✅ |

**特征信号的真相:**

- `hasSticker` = `item.stickers && item.stickers.length > 0` — 物品有 applied sticker
- `hasGraffitiTint` = `attribute[233]` 存在 — 这是涂鸦容器的身份编码，不是"贴纸"
- `hasMusicIndex` = `attribute[166]` 存在 — 音乐盒的身份编码
- `hasPaint` = `item.paint_index != null && item.paint_index !== 0`
- `isWeapon` = `def_index` 在武器 ID 集合中 (all.json skin 条目 + items_game.txt baseitem==1)
- `inCrateDefRange` = `def_index` 在 all.json crate 条目中，且不在 sticker 条目中（或精度更高）

**StatTrak/Souvenir 检测与名称格式化 (不可更改):**

```js
const isST = item.quality === 9 || item.kill_eater_value != null
  || (item.attribute || []).some(a => a.def_index === 80);
const isSV = item.quality === 12
  || (item.attribute || []).some(a => a.def_index === 140);

// 名称格式化 — 与 all.json 格式严格一致
// ST: "AK-47 | 精英之作" → "AK-47（StatTrak™） | 精英之作"
// SV: "AK-47 | 精英之作" → "AK-47（纪念品） | 精英之作"
if (entry.name) {
  if (isST) entry.name = entry.name.replace(/\s*\|\s*/, '（StatTrak™） | ');
  if (isSV) entry.name = entry.name.replace(/\s*\|\s*/, '（纪念品） | ');
}
```

杀敌数: `item.kill_eater_value != null` → `entry.stattrakKills = item.kill_eater_value`。

**processInventory 范式代码 (不可改结构):**

```js
function processInventory(rawItems) {
  for (const item of rawItems) {
    if (item.casket_id) continue;
    const match = matcher.match(item);        // 约束制引擎判定类型
    entry.itemType = match.itemType;

    if (match.itemType === 'skin') { /* paint_index|weapon_id → all.json */ }
    else if (match.itemType === 'sticker') { /* sticker_id → all.json / fallback */ }
    else if (match.itemType === 'graffiti') { /* graffiti-{sticker_id}_{tint} → all.json */ }
    else if (match.itemType === 'music_kit') { /* music_index → all.json */ }
    else if (match.itemType === 'weapon') { /* 原版武器 */ }
    else { /* crate/collectible/agent → def_index → all.json */ }
  }
}
```

---

### 模块 3: TradeUpSimulator — 汰换模拟器

文件: `lib/tradeup-sim.js`。纯算法, 不依赖 Steam/GC/I/O。

**核心算法 (不可更改顺序和公式):**

```
simulate(items):
  1. _resolveItem ×10          → 从 GC 解析皮肤元数据
  2. _validate                 → 稀有度一致 + ST合法性 + wear ∈ [min,max]
  3. norms = (wear-min)/(max-min) → clamp [0,1]
  4. avgNorm = sum(norms) / 10
  5. targetRarity = RARITY_ORDER[currentIdx + 1]
  6. 集合分组: skin_id → collection → 输入物品分组
  7. 产出计算:
     for each (collection, items):
       possibleOutputs = col.outputsByRarity[targetRarity]
       inputRatio = items.length / 10
       for each output:
         prob = (inputRatio / possibleOutputs.length) × 100
         outWear = avgNorm × (outMax - outMin) + outMin
         clamp → [outMin, outMax]
         name = skinMeta.name 去默认磨损 + 实际磨损后缀
         if allST: name = name.replace(' | ', '（StatTrak™） | ')
  8. sort by probability DESC
```

**Recipe (不可更改):**

```js
const RARITY_ORDER = ['消费级', '工业级', '军规级', '受限级', '保密级', '隐秘级'];
const rarityToRecipe = { '消费级': 0, '工业级': 1, '军规级': 2, '受限级': 3, '保密级': 4 };
// recipe = rarityToRecipe[当前稀有度];  if (allStatTrak) recipe += 10;
```

**名称格式化 (与 all.json 一致):**

```js
displayName = skinName.replace(/\s*\([^)]*\)\s*$/, ''); // 去默认磨损
if (stattrak) displayName = displayName.replace(' | ', '（StatTrak™） | ');
if (souvenir) displayName = displayName.replace(' | ', '（纪念品） | ');
displayName += ' (' + classifyWear(actualWear).nameZh + ')';
```

**手动规格 API (可高频调用):**

```js
const sim = new TradeUpSimulator(allData);  // 初始化一次, 复用无限次
sim.simulateBySpec([
  { paintIndex: 836, weaponId: 7, wearFloat: 0.228, stattrak: false },
  // ... ×10
]);
```

---

### 模块 4: RecipeManager — 配方管理

文件: `lib/recipe-manager.js`。

**配方 JSON 标准格式 (不可更改):**

```json
{
  "name": "10× 军规级 → 受限",
  "type": "virtual",
  "rarity": "军规级",
  "targetRarity": "受限级",
  "items": [
    { "paintIndex": 836, "weaponId": 7, "wearFloat": 0.228, "assetId": null }
  ],
  "simulation": { "avgWearNorm": 0.397, "outcomes": [...] },
  "createdAt": "2026-06-20T..."
}
```

- `type: "virtual"` = 虚假配方 (无 assetId, 可模拟不可执行)
- `type: "real"` = 真实配方 (有 assetId, 可模拟也可执行)
- 混合配方 (部分有 assetId 部分无) 必须报错

---

### 模块 5: 登录与 Token 持久化

文件: `index.js` §1, §8。

**范式 (不可更改逻辑):**

```
启动 → 读 data/tokens.json[accountName]
  ├─ 有 → logOn({ refreshToken })           // 免密免2FA
  └─ 无 → logOn({ accountName, password })
       ├─ 'steamGuard' 事件 → 用户输入验证码
       └─ 'refreshToken' 事件 → 写入 tokens.json

tokens.json 格式 (多账户支持):
{ "account1": "eyAidHlwIjogIkpXVCIs...", "account2": "eyAidHlwIjog..." }

Token 失效自动清除:
  client.on('error') / client.on('disconnected'):
    if eresult === 84 || InvalidToken/Expired →
      delete savedTokens[accountName]       // 下次自动降级密码
```

**代理:** `.env` → `SOCKS_PROXY`/`HTTP_PROXY` → `client.options`。
`webCompatibilityMode: true` 强制 WebSocket:443。

---

### 模块 6: 汰换执行引擎

**范式 (不可更改):**

```
--trade-up=id1,...,id10;id11,...,id20
  → 分号分隔多组 → 每组验证10件
  → 顺序执行 (递归 next())
  → 每组: 定位物品 → 稀有度验证 → 推断recipe → csgo.craft()
  → 组间 500ms 间隔 (防GC限速)
  → 失败不中断后续组
```

---

### 模块 7: CLI 命令体系

所有命令的精确行为 (不可更改):

```bash
# 库存导出 (需 Steam + GC)
node index.js                          # Token优先 → 密码降级
node index.js --password               # 强制密码

# 真实汰换 (需 Steam + GC)
node index.js --trade-up=id1,...,id10                     # 单组
node index.js --trade-up=id1,...,id10;id11,...,id20       # 多组

# 模拟 (纯本地, 不连Steam)
node index.js --sim-by-spec=file.json                     # 手动规格文件
node index.js --sim-by-spec=file.json --save-recipe=name  # 保存为配方
node index.js --sim-trade-up=id1,...,id10                 # 库存物品
node index.js --load-recipe=file.json                     # 加载配方+模拟
node index.js --list-recipes                              # 列出配方

# 执行 (需 Steam + GC)
node index.js --execute-recipe=file.json                  # 加载真实配方+执行
```

**SIM 模式早退规则:** `--sim-by-spec` / `--sim-trade-up` / `--load-recipe`
/ `--list-recipes` 在 `CsgoResolver` 初始化后立即执行并 `process.exit(0)`,
**绝不**连接 Steam。

---

### 模块 8: 数据下载

文件: `generate_dict.js`。

```bash
node generate_dict.js --force          # 强制下载最新 all.json + game files
```

下载目标: `data/all.json` (~71MB, zh-CN), `data/game/items_game.txt` (~6.6MB),
`data/game/csgo_english.txt` (~3.6MB)。

---

## Common Patterns

### Login + Token 持久化 (完整生产级)

```js
require('dotenv').config();
const SteamUser = require('steam-user');
const GlobalOffensive = require('globaloffensive');
const readline = require('readline');

const client = new SteamUser({
  enablePicsCache: true,
  webCompatibilityMode: true,
});
if (process.env.SOCKS_PROXY) client.options.socksProxy = process.env.SOCKS_PROXY;
if (process.env.HTTP_PROXY) client.options.httpProxy = process.env.HTTP_PROXY;

const csgo = new GlobalOffensive(client);
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

// Token 持久化 (多账户)
const tokenPath = './data/tokens.json';
let savedTokens = {};
if (fs.existsSync(tokenPath)) {
  try { savedTokens = JSON.parse(fs.readFileSync(tokenPath, 'utf8')); } catch {}
}
function saveToken(accountName, token) {
  savedTokens[accountName] = token;
  fs.writeFileSync(tokenPath, JSON.stringify(savedTokens, null, 2));
}

const accountName = process.env.STEAM_ACCOUNT;
const savedToken = savedTokens[accountName];
let logonOptions;

if (savedToken && !process.argv.includes('--password')) {
  logonOptions = { refreshToken: savedToken };
} else {
  logonOptions = { accountName, password: process.env.STEAM_PASSWORD };
}

client.on('refreshToken', (token) => saveToken(accountName, token));

client.on('steamGuard', (domain, callback, lastCodeWrong) => {
  if (lastCodeWrong) {
    setTimeout(() => callback(getTOTPCode()), 30000);  // CRITICAL: wait 30s
  } else {
    callback(getTOTPCode());
  }
});

client.on('loggedOn', () => {
  client.setPersona(SteamUser.EPersonaState.Online);
  client.gamesPlayed([730]);
});

client.on('disconnected', (eresult, msg) => {
  if (eresult === 84) {
    delete savedTokens[accountName];
    fs.writeFileSync(tokenPath, JSON.stringify(savedTokens));
  }
});

client.on('error', (err) => {
  if (err.message?.includes('InvalidToken') || err.eresult === 84) {
    delete savedTokens[accountName];
    fs.writeFileSync(tokenPath, JSON.stringify(savedTokens));
  }
  process.exit(1);
});

csgo.on('error', (err) => { console.error('GC error:', err.message); process.exit(1); });

client.logOn(logonOptions);
```

### 汰换交易 (Trade-Up / Craft)

```bash
node index.js --trade-up=id1,...,id10                      # 单组
node index.js --trade-up=id1,...,id10;id11,...,id20         # 多组 (; 分隔)
```

Recipe 速查:

| INPUT | Recipe | OUTPUT | ST Recipe |
|-------|--------|--------|-----------|
| 消费级 | 0 | 工业级 | 10 |
| 工业级 | 1 | 军规级 | 11 |
| 军规级 | 2 | 受限 | 12 |
| 受限 | 3 | 保密 | 13 |
| 保密 | 4 | 隐秘 | 14 |

### 汰换模拟 (纯本地)

```bash
node index.js --sim-by-spec=file.json           # 手动规格
node index.js --sim-trade-up=id1,...,id10        # 库存物品
node index.js --load-recipe=file.json            # 加载配方
```

```js
const { TradeUpSimulator } = require('./lib/tradeup-sim');
const sim = new TradeUpSimulator(allData);
sim.simulateBySpec([
  { paintIndex: 836, weaponId: 7, wearFloat: 0.228 },
  // ... ×10
]);
```

### Item Inspection

```js
csgo.inspectItem('steam://rungame/730/...S{owner}A{assetid}D{d}');     // standard
csgo.inspectItem('steam://rungame/730/...M{hex}');                      // masked (sync!)
csgo.inspectItem(ownerSteamID, assetid, d, (item) => { ... });         // individual

csgo.on('inspectItemInfo', (item) => {
  console.log(`Float: ${item.paintwear.toFixed(6)} | Paint: ${item.paintindex} | Seed: ${item.paintseed}`);
  if (item.stickers) item.stickers.forEach(s => console.log(`  Slot ${s.slot}: id=${s.sticker_id}`));
});
```

### Storage Units

```js
csgo.getCasketContents('casketId', (err, items) => { ... });
const loose = csgo.inventory.filter(i => !i.casket_id);
csgo.addToCasket('casketId', 'itemId');
csgo.removeFromCasket('casketId', 'itemId');
```

---

## Critical Gotchas

1. **Always handle `error` events** on both SteamUser and GlobalOffensive. Unhandled = process crash.
2. **Do NOT call GC methods before `connectedToGC`** — check `csgo.haveGCSession`.
3. **TOTP `lastCodeWrong === true`** — MUST wait 30 seconds before new code. Failure = IP ban.
4. **`enablePicsCache: true`** required for `getOwnedApps()`, `ownsApp()`, `ownsDepot()`.
5. **Set persona state after logon**: `client.setPersona(SteamUser.EPersonaState.Online)`.
6. **Casket items still appear in `csgo.inventory`** — filter by `!item.casket_id`.
7. **GC can reconnect silently** — `connectedToGC` may fire without `disconnectedFromGC`.
8. **Masked inspect links are synchronous** — decode locally, no GC round-trip.
9. **Use `client.chat` (SteamChatRoomClient)**, NOT deprecated `chatMessage()`/`joinChat()`.
10. **`craft()` requires exactly 10 items** of the same grade.
11. **Category keys must be singular** — `crate` not `crates`. Matches all.json key prefixes.
12. **`def_index` is NOT item identity** — use `stickers[0].sticker_id` for stickers.
13. **ST/SV names must match all.json format** — `AK-47（StatTrak™）| 翔鹤`.
14. **SOCKS proxy forces WebSocket protocol** — incompatible with TCP transport.
15. **SIM modes exit before Steam connection** — `--sim-*` / `--load-recipe` / `--list-recipes`.

---

## CS2-UIfull — Electron 桌面应用开发关键经验

本项目为 Electron + React + Ant Design + sql.js + electron-vite (esbuild) 构建
的 CS2 炼金管理器。以下为开发中遇到的**高频陷阱和已验证解决方案**。

---

### 一、esbuild 打包铁律

**绝对禁止 `require()` 动态引用。**

esbuild 打包后模块路径完全变化，`require('../db/seed')` 等动态引用
在打包产物中必报 `MODULE_NOT_FOUND`。所有模块引用必须使用顶层静态 `import`：

```ts
// ❌ 错误 — 打包后 crash
const { getWearCategory } = require('../db/seed');

// ✅ 正确
import { getWearCategory } from '../db/seed';
```

排查方法：`grep -r "require(" src/` 检查是否还有残留的 require。

---

### 二、CS2 汰换磨损公式 (已验证)

```
1. norm_i = clamp((wear_i - min_i) / (max_i - min_i), 0, 1)
2. avgNorm = sum(norm_i) / 10
3. outputFloat = outputSkin.minFloat + avgNorm × (outputSkin.maxFloat - outputSkin.minFloat)
4. outputWearCategory = getWearCategory(outputFloat)
5. 名称: marketHashName 去掉固定磨损后缀 + 加上实际磨损后缀
```

**关键修正**：旧实现用 `norm × 0.78 + 0.02` 对所有产出物统一计算，
完全忽略了不同皮肤的 float 范围差异。必须从 all.json 取
每个皮肤的 `min_float`/`max_float` 计算。

---

### 三、all.json 数据结构关键发现

| 条目类型 | Key 格式 | 包含字段 | 不包含 |
|---------|---------|---------|--------|
| 皮肤详情 | `skin-{id}_{variant}` | `paint_index`, `weapon.weapon_id`, `min_float`, `max_float`, `market_hash_name`, `rarity`, `image` | `collections` (空!) |
| 收藏品引用 | `collection-set-*` | `contains[]`: `{id, name, paint_index, rarity}` | `min_float`, `max_float`, `market_hash_name`, `weapon_id` |

**结论：两套 key 体系互不重叠，必须跨引用。**
- 收藏品产出 → 用 `paint_index` 前缀匹配 `skinByKey` 获取完整数据
- 收藏品归属 → 用 `name` 去重后缀后匹配 `nameToColl` 反向索引

```ts
// 跨引用范式
const byPaintIndex = new Map<string, Entry>();
for (const [key, entry] of skinByKey) {
  const paintIdx = key.split('|')[0];  // "303|30" → "303"
  if (!byPaintIndex.has(paintIdx)) byPaintIndex.set(paintIdx, entry);
}
const full = byPaintIndex.get(String(ref.paint_index));
// full 现在有 min_float, max_float, market_hash_name
```

---

### 四、库存物品名称修复

**问题**：`skinByKey` 每 `paint_index|weapon_id` 只存一个变体
(非 ST/SV 的第一个，通常是崭新出厂)。导致所有库存物品都显示为 FN。

**解决**：在 `resolveOne` 中根据实际 `paintWear` 修正名称和 market_hash_name：

```ts
const w = getWearCategory(paintWear);
const stripWear = (s: string) => s.replace(/\s*[（(][^)）]*[)）]\s*$/, '');
rName = stripWear(rName) + ' (' + w.nameZh + ')';
rHash = stripWear(rHash) + ' (' + w.name + ')';
```

**这同时修复了价格查询** — 价格按 market_hash_name 匹配，
名称不对则查不到正确价格。ST/SV 的 market_hash_name 还需加上
`'StatTrak™ '` 或 `'Souvenir '` 前缀。

---

### 五、价格系统常见陷阱

**#1 跳过逻辑反转**
```ts
// ❌ 错误：取过期条目 → 排除它们 → 反而拉取新鲜条目
const cached = getCache({ olderThanMinutes: 60 });
const needFetch = mhns.filter(n => !cachedSet.has(n));

// ✅ 正确：取新鲜条目 → 排除它们 → 拉取过期和未缓存的
const freshSet = new Set(all.filter(isFresh).map(c => c.item_hash_name));
const needFetch = mhns.filter(n => !freshSet.has(n));
```

**#2 输入物品缺少 marketHashName**
模拟时渲染进程只发 `paintIndex + weaponId + wearFloat`，不含 `marketHashName`。
IPC 层必须自行解析，否则成本计算 (`calcProfit`) 返回 null。

```ts
const skin = csgoResolver.resolveSkinByKey(paintIndex, defIndex);
const wear = getWearCategory(wearFloat);
const mhn = stripWear(skin.marketHashName) + ' (' + wear.name + ')';
```

**#3 产出 price 用错磨损**
产出 `marketHashName` 来自 collection-set 数据，后缀固定为 FN。
必须替换为实际预估磨损：

```ts
const correctMhn = output.marketHashName
  .replace(/\s*[（(][^)）]*[)）]\s*$/, '') + ' (' + getWearCategory(estFloat).name + ')';
```

**#4 Token 未配置时静默失败**
`csqaService.fetch()` 无 token 时直接返回 `{0, 0}`，不报错。
IPC 层应在调用前检查并返回明确提示。

---

### 六、子配方自动生成算法

**核心约束**：
1. 收藏品分布严格一致 (父 3A+7B → 子必须 3A+7B)
2. 产出磨损等级集合完全一致 (`estWearCategory` 集合匹配)
3. 归一化磨损尽量贴近父配方
4. 同父配方下 assetId 不重复 (父为 real 时父的物品也禁止引用)
5. 尽量多组合

**关键 Bug 修复**：
- 统计收藏品数量时用 `collectionsUsed`(去重集合) 导致只选 2 件
  → 改用 `simInputs`(10 条目原始数组) 统计
- 父配方模拟的 `minFloat/maxFloat` 硬编码 0-1 导致 norm 基准错误
  → 用 `resolveSkinByKey` 取实际值
- 单轮只试一种组合 → 引入 offset 多次尝试机制

---

### 七、Preload IPC 路由

所有 IPC 方法必须在 `src/preload/index.ts` 中正确声明。
渲染进程只能通过 `window.electronAPI` 调用预加载暴露的方法。
`ipcRenderer.invoke(channel, ...)` 的 channel 必须与主进程
`ipcMain.handle(channel, ...)` 完全一致。

---

### 八、sql.js 注意事项

- 不支持 `DEFAULT datetime('now')` — 只在 INSERT VALUES 中使用
- DB 返回 snake_case，应用层 `toCamel()` 映射
- 写入后必须调用 `saveDatabase()` 持久化
- 批量操作用 `BEGIN TRANSACTION` / `COMMIT` / `ROLLBACK`
