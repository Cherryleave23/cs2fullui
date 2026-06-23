# cs2tradetool — CLI 项目范式 (v2)

Node.js CLI 工具。纯文件操作 + Steam 连接，无 Electron。

## 架构总览

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

## 铁律 (不可变更)

1. **`def_index` 永远不是物品身份** — GC 中 `def_index=1209` 是通用贴纸容器, `stickers[0].sticker_id` 才是真实身份
2. **all.json 是唯一数据源** — 不允许多文件回退到旧的 CSGO-API 分散文件
3. **约束制引擎不可降级为计分制** — TYPE_RULES 定义每种物品的 required/forbidden 特征，全部满足才确认
4. **类别搜索必须用单数形式** — `crate` 非 `crates`, 匹配 all.json key 前缀
5. **items_game.txt 断层回退不可移除** — 填补 CSGO-API 贴纸断层 (1695-1738 等)
6. **磨损输入必须校验合法性** — `wearFloat ∈ [minFloat, maxFloat]`
7. **产出磨损必须 clamp** — `outWear ∈ [outMin, outMax]`
8. **ST/Souvenir 名称必须与 all.json 格式一致** — `AK-47（StatTrak™）| 翔鹤`

## 模块 1: CsgoResolver — 物品解析器

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
    if (gameDataFallback) {
      const name = gameDataFallback.getStickerName(stickerId);
      if (name) return { name: `印花 | ${name}`, _source: 'gamefile' };
    }
    return null;
  }

  resolveByDef(type, defIndex) {
    return this._byTypeAndDef[type]?.[String(defIndex)] || null;
  }

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

## 模块 2: 约束制匹配引擎 — GC 物品识别核心

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

**特征信号:**

- `hasSticker` = `item.stickers && item.stickers.length > 0`
- `hasGraffitiTint` = `attribute[233]` 存在
- `hasMusicIndex` = `attribute[166]` 存在
- `hasPaint` = `item.paint_index != null && item.paint_index !== 0`
- `isWeapon` = `def_index` 在武器 ID 集合中

**StatTrak/Souvenir 检测:**

```js
const isST = item.quality === 9 || item.kill_eater_value != null
  || (item.attribute || []).some(a => a.def_index === 80);
const isSV = item.quality === 12
  || (item.attribute || []).some(a => a.def_index === 140);

// 名称格式化
if (isST) entry.name = entry.name.replace(/\s*\|\s*/, '（StatTrak™） | ');
if (isSV) entry.name = entry.name.replace(/\s*\|\s*/, '（纪念品） | ');
```

## 模块 3: TradeUpSimulator — 汰换模拟器

文件: `lib/tradeup-sim.js`。纯算法, 不依赖 Steam/GC/I/O。

**核心算法:**

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

**Recipe:**

```js
const RARITY_ORDER = ['消费级', '工业级', '军规级', '受限级', '保密级', '隐秘级'];
const rarityToRecipe = { '消费级': 0, '工业级': 1, '军规级': 2, '受限级': 3, '保密级': 4 };
// recipe = rarityToRecipe[当前稀有度];  if (allStatTrak) recipe += 10;
```

**手动规格 API:**

```js
const sim = new TradeUpSimulator(allData);
sim.simulateBySpec([
  { paintIndex: 836, weaponId: 7, wearFloat: 0.228, stattrak: false },
  // ... ×10
]);
```

## 模块 4: RecipeManager — 配方管理

文件: `lib/recipe-manager.js`。

**配方 JSON 标准格式:**

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

## 模块 5: 登录与 Token 持久化

```
启动 → 读 data/tokens.json[accountName]
  ├─ 有 → logOn({ refreshToken })           // 免密免2FA
  └─ 无 → logOn({ accountName, password })
       ├─ 'steamGuard' 事件 → 用户输入验证码
       └─ 'refreshToken' 事件 → 写入 tokens.json

tokens.json 格式: { "account1": "eyAidHlw...", "account2": "eyAidHlw..." }

Token 失效清除:
  eresult === 84 || InvalidToken → delete savedTokens[accountName]
```

代理: `.env` → `SOCKS_PROXY`/`HTTP_PROXY` → `client.options`。`webCompatibilityMode: true` 强制 WebSocket:443。

## 模块 6: 汰换执行引擎

```
--trade-up=id1,...,id10;id11,...,id20
  → 分号分隔多组 → 每组验证10件
  → 顺序执行 (递归 next())
  → 每组: 定位物品 → 稀有度验证 → 推断recipe → csgo.craft()
  → 组间 500ms 间隔 → 失败不中断后续组
```

## 模块 7: CLI 命令体系

```bash
# 库存导出
node index.js                          # Token优先 → 密码降级
node index.js --password               # 强制密码

# 真实汰换
node index.js --trade-up=id1,...,id10                     # 单组
node index.js --trade-up=id1,...,id10;id11,...,id20       # 多组

# 模拟 (纯本地, 不连Steam)
node index.js --sim-by-spec=file.json                     # 手动规格
node index.js --sim-by-spec=file.json --save-recipe=name  # 保存配方
node index.js --sim-trade-up=id1,...,id10                 # 库存物品
node index.js --load-recipe=file.json                     # 加载配方+模拟
node index.js --list-recipes                              # 列出配方

# 执行
node index.js --execute-recipe=file.json
```

SIM 模式在 `CsgoResolver` 初始化后立即 `process.exit(0)`，**绝不**连接 Steam。

## 模块 8: 数据下载

```bash
node generate_dict.js --force   # 强制下载 latest all.json + game files
```

## Common Patterns

### Login + Token 持久化

```js
require('dotenv').config();
const SteamUser = require('steam-user');
const GlobalOffensive = require('globaloffensive');
const client = new SteamUser({ enablePicsCache: true, webCompatibilityMode: true });
if (process.env.SOCKS_PROXY) client.options.socksProxy = process.env.SOCKS_PROXY;
const csgo = new GlobalOffensive(client);

const tokenPath = './data/tokens.json';
let savedTokens = {};
if (fs.existsSync(tokenPath)) try { savedTokens = JSON.parse(fs.readFileSync(tokenPath,'utf8')); } catch {}

function saveToken(name, token) { savedTokens[name] = token; fs.writeFileSync(tokenPath, JSON.stringify(savedTokens)); }

const accountName = process.env.STEAM_ACCOUNT;
client.logOn(savedTokens[accountName] && !process.argv.includes('--password')
  ? { refreshToken: savedTokens[accountName] }
  : { accountName, password: process.env.STEAM_PASSWORD });

client.on('refreshToken', (token) => saveToken(accountName, token));
client.on('steamGuard', (domain, cb, lastWrong) => {
  if (lastWrong) setTimeout(() => cb(getTOTPCode()), 30000); else cb(getTOTPCode());
});
client.on('loggedOn', () => { client.setPersona(SteamUser.EPersonaState.Online); client.gamesPlayed([730]); });
client.on('error', (err) => { if (err.eresult === 84) { delete savedTokens[accountName]; fs.writeFileSync(tokenPath, JSON.stringify(savedTokens)); } process.exit(1); });
csgo.on('error', (err) => { console.error('GC:', err.message); process.exit(1); });
```

### Trade-Up / Craft

```bash
node index.js --trade-up=id1,...,id10                      # 单组
node index.js --trade-up=id1,...,id10;id11,...,id20         # 多组 (; 分隔)
```

| INPUT | Recipe | OUTPUT | ST Recipe |
|-------|--------|--------|-----------|
| 消费级 | 0 | 工业级 | 10 |
| 工业级 | 1 | 军规级 | 11 |
| 军规级 | 2 | 受限 | 12 |
| 受限 | 3 | 保密 | 13 |
| 保密 | 4 | 隐秘 | 14 |

### Item Inspection

```js
csgo.inspectItem('steam://rungame/730/...S{owner}A{assetid}D{d}');
csgo.inspectItem('steam://rungame/730/...M{hex}');          // masked (sync!)
csgo.inspectItem(ownerSteamID, assetid, d, (item) => {...});
csgo.on('inspectItemInfo', (item) => {
  console.log(`Float: ${item.paintwear} Paint: ${item.paintindex} Seed: ${item.paintseed}`);
});
```

### Storage Units

```js
csgo.getCasketContents('casketId', (err, items) => {...});
const loose = csgo.inventory.filter(i => !i.casket_id);
```
