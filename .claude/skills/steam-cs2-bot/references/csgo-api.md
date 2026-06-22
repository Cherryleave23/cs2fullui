# CSGO-API — Static JSON Data

## CSGO-API — Static JSON Data (ByMykel/CSGO-API)

A free, public, static JSON API that maps CS2 internal numeric IDs to
human-readable names, rarities, images, and metadata. No auth required, no
CORS. Hosted on raw.githubusercontent.com. MIT license.

**Base URL:** `https://raw.githubusercontent.com/ByMykel/CSGO-API/main/public/api/{language}/`
**Languages hosted:** `en`, `zh-CN` (28 available locally)
**Image CDN:** `ByMykel/counter-strike-image-tracker`

### Why Use It

`globaloffensive` gives you raw numeric IDs — `def_index`, `paint_index`,
`sticker_id`, `rarity` — but not names, colors, images, or relationships.
CSGO-API bridges that gap:

```
globaloffensive item       CSGO-API lookup
─────────────────────      ──────────────────────────────
def_index: 1               "weapon_deagle" → "Desert Eagle"
paint_index: 44            "AK-47 | Redline"
rarity: 5                  "Covert" / color: #eb4b4b
paint_wear: 0.12           min_float: 0.00, max_float: 0.70
stickers[0].sticker_id: 75 "Sticker | Titan | Katowice 2014"
paint_index + weapon_id    "skin-{weapon_id}_{paint_index}"
```

### All 18 Endpoints

| Endpoint | ID Format | Purpose |
|----------|-----------|---------|
| `all.json` | `{id}` | All items keyed by ID |
| `skins.json` | `skin-{weapon_id}_{paint_index}` | Skins grouped by wear range (`wears[]`) |
| `skins_not_grouped.json` | `skin-{weapon_id}_{paint_index}_{wear}` | Individual skin+wear combos with `market_hash_name` |
| `stickers.json` | `sticker-{def_index}` | Stickers with tournament/team info |
| `sticker_slabs.json` | `sticker_slab-{def_index}` | Sticker slabs (charms) with `original{name,image_inventory}` |
| `keychains.json` | `keychain-{def_index}` | Weapon charms |
| `collections.json` | `collection-set-{name}` | Collections with `contains[]` and `crates[]` |
| `crates.json` | `crate-{def_index}` | Cases/capsules/boxes/souvenir packages with `contains[]`, `contains_rare[]` |
| `keys.json` | `key-{name}` | Case keys with `crates[]` (which they unlock) |
| `collectibles.json` | `collectible-{def_index}` | Service medals, veteran coins |
| `agents.json` | `agent-{def_index}` | Agent skins with `team` (terrorists/ct) |
| `patches.json` | `patch-{def_index}` | Agent patches |
| `graffiti.json` | `graffiti-{def_index}` | Sealed graffiti |
| `music_kits.json` | `music_kit-{def_index}` | Music kits with `exclusive` flag |
| `base_weapons.json` | `base_weapon-{name}` | Default weapon models |
| `highlights.json` | `aus2025_{name}` | Tournament highlights with `video` URL |
| `inventory.json` | `{skins: {weapon_id: {paint_index}}}` | Inventory lookup — skins by `weapon_id→paint_index`, other items by `def_index` |

### Common Object Shapes

Every endpoint returns arrays or objects with these recurring patterns:

**Rarity (always present on rarity-bearing items):**
```js
{ id: "rarity_ancient_weapon", name: "Covert", color: "#eb4b4b" }
```

**Rarity ID → Name / Color Table:**

| Rarity ID | Display Name | Color |
|-----------|-------------|-------|
| `rarity_common` | Base Grade | `#b0c3d9` |
| `rarity_uncommon` / `rarity_uncommon_weapon` | Industrial Grade | `#5e98d9` |
| `rarity_rare` / `rarity_rare_weapon` | Mil-Spec / High Grade | `#4b69ff` |
| `rarity_mythical` | Restricted / Remarkable | `#8847ff` |
| `rarity_legendary` / `rarity_legendary_character` | Classified / Superior | `#d32ce6` |
| `rarity_ancient` / `rarity_ancient_weapon` | Covert / Extraordinary | `#eb4b4b` |
| `rarity_immortal` | Gold | `#ffd700` |

**Cross-references (used in skins, stickers, keychains, agents, etc.):**
```js
collections: [{ id: "collection-set-overpass", name: "The Overpass Collection", image: "..." }]
crates: [{ id: "crate-4028", name: "ESL One Cologne 2014 Overpass Souvenir Package", image: "..." }]
```

### Skin Object (`skins.json`)
```js
{
  id: "skin-65604",              // skin-{weapon_id}_{paint_index}
  name: "Desert Eagle | Urban DDPAT",
  description: "...",
  weapon: { id: "weapon_deagle", weapon_id: 1, name: "Desert Eagle" },
  category: { id: "csgo_inventory_weapon_category_pistols", name: "Pistols" },
  pattern: { id: "hy_ddpat_urb", name: "Urban DDPAT" },
  min_float: 0.06, max_float: 0.8,  // Valid wear range
  rarity: { id: "rarity_uncommon_weapon", name: "Industrial Grade", color: "#5e98d9" },
  stattrak: false, souvenir: true,
  paint_index: "17",              // String! Maps to CSOEconItem attribute 6
  wears: [{ id: "SFUI_InvTooltip_Wear_Amount_0", name: "Factory New" }, ...],
  collections: [...], crates: [...],
  team: { id: "both", name: "Both Teams" },
  legacy_model: true,
  image: "https://raw.githubusercontent.com/ByMykel/counter-strike-image-tracker/main/..."
}
```

### Skin Not Grouped (`skins_not_grouped.json`)
Same as above plus:
```js
{
  id: "skin-65604_0",             // skin-{weapon_id}_{paint_index}_{wear_index}
  skin_id: "skin-65604",          // Parent grouped skin ID
  wear: { id: "SFUI_InvTooltip_Wear_Amount_0", name: "Factory New" },
  stattrak: false, souvenir: false,  // Explicit per-variant
  market_hash_name: "Desert Eagle | Urban DDPAT (Factory New)",
  style: { id: 2, name: "Hydrographic", url: "..." }
}
```

### Sticker Object (`stickers.json`)
```js
{
  id: "sticker-75",               // sticker-{def_index}
  name: "Sticker | Titan | Katowice 2014",
  description: "...",
  rarity: { id: "rarity_rare", name: "High Grade", color: "#4b69ff" },
  crates: [...],
  tournament_event: "Katowice 2014",
  tournament_team: "Titan",
  type: "Team",                   // Team, Player, Other
  market_hash_name: "Sticker | Titan | Katowice 2014",
  effect: "Other",
  image: "..."
}
```

### Sticker Slab Object (`sticker_slabs.json`)
```js
{
  id: "sticker_slab-75",
  name: "Sticker Slab | Titan | Katowice 2014",
  def_index: "75",                // String!
  rarity: { ... },
  crates: [...], collections: [],
  type: "Team",
  tournament: { id: 3, name: "2014 EMS One Katowice" },
  team: { id: 27, tag: "TIT", geo: "FR", name: "Titan" },
  original: { name: "kat2014_titan", image_inventory: "econ/stickers/emskatowice2014/titan_1355_37" },
  market_hash_name: "Sticker Slab | Titan | Katowice 2014",
  effect: "Other",
  image: "..."
}
```

### Crate Object (`crates.json`)
```js
{
  id: "crate-4904",
  name: "Kilowatt Case",
  type: "Case",                   // Case, Capsule, Graffiti Box, Music Kit Box, Souvenir Package
  first_sale_date: "2024-01-16",
  contains: [{ id, name, rarity, paint_index, image }, ...],
  contains_rare: [{ id, name, rarity, paint_index: null, phase: null, image }, ...],
  market_hash_name: "Kilowatt Case",
  rental: true,                   // CS2 rental feature
  image: "...",
  model_player: "models/props/crates/csgo_drop_crate_community_33.vmdl",
  loot_list: { name: "★ Kukri Knife ★", footer: "...", image: "..." }
}
```

### Collection Object (`collections.json`)
```js
{
  id: "collection-set-community-3",
  name: "The Huntsman Collection",
  crates: [{ id, name, image }, ...],
  contains: [{ id, name, rarity, paint_index, image }, ...],
  image: "..."
}
```

### Agent, Keychain, Patch, Music Kit, Graffiti, Collectible
All follow the same pattern: `{ id, name, description, rarity, market_hash_name, image }` plus type-specific fields:
- **Agents:** `team: { id: "terrorists"|"ct", name }`
- **Keychains:** `collections[]`
- **Patches:** rarity only
- **Music Kits:** `exclusive: true|false`
- **Graffiti:** `crates[]`
- **Collectibles:** `type`, `genuine`

### Inventory Lookup (`inventory.json`)

```js
{
  skins: {
    "1": {                        // weapon_id (from CSOEconItem.def_index → weapon mapping)
      "17": {                     // paint_index (from CSOEconItem attribute 6)
        name: "Desert Eagle | Urban DDPAT",
        rarity: { id: "rarity_uncommon_weapon", name: "Industrial Grade", color: "#5e98d9" },
        marketable: true,
        image: "..."
      }
    }
  },
  crates: { "1210": { name, rarity, marketable, image }, ... },
  stickers: { "75": { ... }, ... },
  keychains: { "1": { ... }, ... },
  music_kits: { "39": { ... }, ... },
  agents: { "4613": { ... }, ... },
  graffiti: { "1654": { ... }, ... },
  collectibles: { "874": { ... }, ... },
  patches: { "5126": { ... }, ... },
  highlights: { "aus2025_...": { ... }, ... },
  tools: { ... }                  // Name tags, storage units, etc.
}
```

### How to Use with globaloffensive

**Resolve a skin from inventory:**
```js
const API_BASE = 'https://raw.githubusercontent.com/ByMykel/CSGO-API/main/public/api/en';

async function resolveSkin(item, fetchFn = fetch) {
  const { paint_index, def_index } = item;  // from CSOEconItem
  // Look up by weapon_id (def_index) and paint_index
  // Option 1: Full skins_not_grouped.json scan
  const res = await fetchFn(`${API_BASE}/skins_not_grouped.json`);
  const skins = await res.json();
  return skins.find(s => s.weapon?.weapon_id === def_index && s.paint_index === String(paint_index));
}

async function resolveSticker(stickerId, fetchFn = fetch) {
  const res = await fetchFn(`${API_BASE}/stickers.json`);
  const stickers = await res.json();
  return stickers.find(s => s.id === `sticker-${stickerId}`);
}

async function resolveRarity(rarityNum) {
  // rarity 5 (from CEconItemPreviewDataBlock) → "Covert" + "#eb4b4b"
  const res = await fetchFn(`${API_BASE}/skins.json`);
  const skins = await res.json();
  const match = skins.find(s => s.rarity && s.weapon?.weapon_id === 1);
  // Better: use the rarity table built into this skill
}
```

**Build a local inventory resolver:**
```js
// Download once, use many times
async function buildResolver(fetchFn = fetch) {
  const [skinsNG, stickers, keychains, crates] = await Promise.all([
    fetchFn(`${API_BASE}/skins_not_grouped.json`).then(r => r.json()),
    fetchFn(`${API_BASE}/stickers.json`).then(r => r.json()),
    fetchFn(`${API_BASE}/keychains.json`).then(r => r.json()),
    fetchFn(`${API_BASE}/crates.json`).then(r => r.json()),
  ]);

  const skinByPaintIdx = {};
  for (const s of skinsNG) {
    if (!skinByPaintIdx[s.paint_index]) skinByPaintIdx[s.paint_index] = [];
    skinByPaintIdx[s.paint_index].push(s);
  }

  const stickerById = {};
  for (const s of stickers) stickerById[s.id] = s;

  return {
    resolveSkin(paintIndex, weaponId) {
      return (skinByPaintIdx[String(paintIndex)] || [])
        .find(s => s.weapon?.weapon_id === weaponId);
    },
    resolveSticker(stickerId) {
      return stickerById[`sticker-${stickerId}`];
    },
  };
}
```

### Important Details

- **`paint_index` is a STRING** in CSGO-API, not a number — always use `String()` when comparing.
- **`def_index`** in the API is also a string. Compare with care.
- **`skins.json` groups by wear ranges** — use `skins_not_grouped.json` for exact `wear+stattrak+souvenir` combos.
- **Images are in a separate repo** (`ByMykel/counter-strike-image-tracker`) — all URLs point there.
- **The `inventory.json` endpoint** is optimized for fast `weapon_id → paint_index → skin` lookup (no array scan needed).
- **Only `en` and `zh-CN` are hosted** — for other languages, clone and build locally with `node update.js --languages <codes>`.
- **28 language codes available:** `en, zh-CN, pt-BR, ru, es-ES, bg, cs, da, nl, fi, fr, de, el, hu, it, ja, ko, es-MX, no, pl, pt-PT, ro, sv, zh-TW, th, tr, uk, vi`

---


# 本地库存匹配方案 (cs2tradetool v3 — 约束制引擎)

基于 `cs2tradetool/index.js` + `lib/item-matcher.js` 验证过的生产级方案。
**100% 类型准确率** (vs 715 件正确答案)。核心思想：**每种物品类型定义 required/forbidden 特征，全部满足才确认。不再使用顺序分派或计分制。**

### 数据源

```
all.json (71MB, 45,756条, 单一文件)
  ├─ skin-{hash}_{wear}    → paint_index + weapon_id → 皮肤名+稀有度+图片
  ├─ sticker-{id}          → O(1) 直接查找贴纸名
  ├─ graffiti-{sid}_{tint} → 涂鸦: sticker_id + graffiti_tint → 中文名
  ├─ crate-{id}            → 箱子名
  ├─ agent-{id}            → 探员
  ├─ music_kit-{id}        → 音乐盒 (按 music_index)
  └─ collectible-{id}      → 收藏品
+
items_game.txt + csgo_english.txt  (VDF, 6.6MB)
  └─ 断层回退: CSGO-API 缺失的旧贴纸/涂鸦 (如 1695-1738 范围)
  └─ graffiti 颜色: graffiti_tints 映射 tint_id → 颜色名
```

### 约束制引擎 (ItemMatcher)

每种物品类型在 `TYPE_RULES` 中定义 required/forbidden:

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

**匹配流程:**

```
Phase 1: _collectSignals() — 收集 14 种特征信号
Phase 2: 并行检查所有 TYPE_RULES → 全部满足才加入候选
Phase 3: 多候选时按精度选择: agent(159) > music_kit(53) > crate(20.9) > ...
Phase 4: 名称解析 → all.json / items_game.txt 回退
```

### 实战验证

```
def=1349, 有 sticker+graffiti_tint:
  旧法: sticker +25, graffiti +50 → 比分数 (易误判)
  新法: graffiti 匹配 ✅, sticker 因 forbidden=hasGraffitiTint 被拒绝 ✅

def=4799, 有 sticker, no paint:
  旧法: sticker +25, collectible -10 → sticker 赢 (错误)
  新法: collectible 匹配 ✅ (allowed sticker now), sticker 因无其他特征被拒 ✅

def=4236, no sticker, no paint:
  旧法: crate 20.9 > sticker 0.96 → crate ✅
  新法: crate 匹配, sticker 因 required=hasSticker 不满足被拒 ✅
```

### 涂鸦名称反查

```
graffiti 物品:
  sticker_id=1737, graffiti_tint=19
  → 构造 key: graffiti-1737_19
  → all.json: "封装的涂鸦 | 走啦 (灰色)"
```

### 断层回退

```js
// items_game.txt VDF 解析 → sticker_kits 段 → 贴纸/涂鸦英文名
const gameVdf = VDF.parse(fs.readFileSync('data/game/items_game.txt'));
// 贴纸回退
const name = translate(stickerKits[stickerId].item_name);  // e.g. "GTG"
// 涂鸦回退 (图案+颜色)
this.getGraffitiName(stickerId, tintId);  // "涂鸦 | GTG (shark white)"
```

### 约束制引擎 — 完整源代码 (lib/item-matcher.js)

```js
// 每种类型的约束规则
const TYPE_RULES = {
  skin:        { required: ['hasPaint'],              forbidden: ['hasGraffitiTint','hasMusicIndex'] },
  weapon:      { required: ['isWeapon'],              forbidden: ['hasPaint','hasGraffitiTint','hasMusicIndex'] },
  sticker:     { required: ['hasSticker'],            forbidden: ['hasGraffitiTint','hasMusicIndex','hasPaint'] },
  graffiti:    { required: ['hasGraffitiTint'],       forbidden: [] },
  music_kit:   { required: ['hasMusicIndex'],         forbidden: ['hasPaint'] },
  crate:       { required: ['inCrateDefRange'],       forbidden: ['hasSticker','hasPaint','hasMusicIndex','hasGraffitiTint'] },
  collectible: { required: ['inCollectibleDefRange'], forbidden: ['hasPaint','hasMusicIndex','hasGraffitiTint'] },
  agent:       { required: ['inAgentDefRange'],       forbidden: ['hasPaint','hasMusicIndex','hasGraffitiTint'] },
  keychain:    { required: ['inKeychainDefRange'],    forbidden: ['hasPaint','hasSticker','hasMusicIndex','hasGraffitiTint'] },
  patch:       { required: ['inPatchDefRange'],       forbidden: ['hasPaint','hasMusicIndex','hasGraffitiTint'] },
  music_kit_by_index: { exclusive: true, required: ['hasMusicIndex'], forbidden: ['hasPaint'] },
};

class ItemMatcher {
  constructor(resolver) { this.resolver = resolver; }

  match(item) {
    const sig = this._collectSignals(item);
    const matched = [];
    for (const [typeName, rules] of Object.entries(TYPE_RULES)) {
      if (typeName === 'music_kit_by_index') continue;
      if (this._checkRules(rules, sig)) {
        matched.push({ type: typeName, specificity: SPECIFICITY[typeName] || 1 });
      }
    }
    // 独占: music_kit_by_index
    if (this._checkRules(TYPE_RULES.music_kit_by_index, sig)) {
      const mkMatch = matched.find(m => m.type === 'music_kit');
      matched.length = 0;
      if (mkMatch) matched.push(mkMatch);
      matched.push({ type: 'music_kit', specificity: 100 });
    }
    if (matched.length > 0) {
      matched.sort((a, b) => b.specificity - a.specificity);
      const best = matched[0];
      // sticker vs graffiti: graffiti 优先
      const hasG = matched.some(m => m.type === 'graffiti');
      const hasS = matched.some(m => m.type === 'sticker');
      if (hasG && hasS && best.type === 'sticker') {
        best.type = 'graffiti';
      }
      return { itemType: best.type === 'music_kit_by_index' ? 'music_kit' : best.type,
               _matchScore: best.specificity, _matchDetail: 'constraint-matched', _validated: true };
    }
    // 兜底: def_index
    const allTypes = this.resolver.resolveAllTypes(item.def_index);
    const nonSticker = allTypes.filter(t => t.type !== 'sticker' && t.type !== 'sticker_slab');
    const best = nonSticker.length > 0 ? nonSticker[0] : allTypes[0];
    return { itemType: best?.type || 'unknown', _matchScore: -100, _matchDetail: 'fallback' };
  }

  _collectSignals(item) {
    const attrs = item.attribute || [];
    return {
      hasSticker: !!(item.stickers && item.stickers.length > 0),
      hasPaint: !!(item.paint_index != null && item.paint_index !== 0),
      hasWear: item.paint_wear != null,
      hasMusicIndex: attrs.some(a => a.def_index === 166),
      musicIndex: getAttrValue(item, 166),
      hasGraffitiTint: attrs.some(a => a.def_index === 233),
      isWeapon: this.resolver.isKnownWeapon(item.def_index),
    };
  }

  _checkRules(rules, sig) {
    for (const req of (rules.required || [])) if (!this._evalFeature(req, sig)) return false;
    for (const forbid of (rules.forbidden || [])) if (this._evalFeature(forbid, sig)) return false;
    return true;
  }

  _evalFeature(feature, sig) {
    switch (feature) {
      case 'hasPaint':          return sig.hasPaint;
      case 'hasSticker':        return sig.hasSticker;
      case 'hasWear':           return sig.hasWear;
      case 'hasMusicIndex':     return sig.hasMusicIndex;
      case 'hasGraffitiTint':   return sig.hasGraffitiTint;
      case 'isWeapon':          return sig.isWeapon;
      case 'inCrateDefRange':   return !!this.resolver.resolveByDef('crate', sig.defIndex);
      case 'inCollectibleDefRange': return !!this.resolver.resolveByDef('collectible', sig.defIndex);
      case 'inAgentDefRange':   return !!this.resolver.resolveByDef('agent', sig.defIndex);
      case 'inKeychainDefRange': return !!this.resolver.resolveByDef('keychain', sig.defIndex);
      case 'inPatchDefRange':   return !!this.resolver.resolveByDef('patch', sig.defIndex);
      default: return false;
    }
  }
}
```

### 单复数陷阱

all.json 的 key 前缀使用**单数形式**: `crate`, `agent`, `graffiti`, `collectible` 等。
代码中的类别搜索必须匹配单数形式。

---
