# CS2-UIfull — Electron 桌面应用开发关键经验

**技术栈**: Electron + React 18 + Ant Design 5 + TypeScript + Zustand + sql.js + electron-vite (esbuild)

## 一、esbuild 打包铁律

**绝对禁止 `require()` 动态引用。** esbuild 打包后模块路径完全变化，`require('../db/seed')` 必报 `MODULE_NOT_FOUND`。

```ts
// ❌ 打包后 crash
const { getWearCategory } = require('../db/seed');
// ✅ 正确
import { getWearCategory } from '../db/seed';
```

排查: `grep -r "require(" src/`

## 二、CS2 汰换磨损公式 (已验证)

```
1. norm_i = clamp((wear_i - min_i) / (max_i - min_i), 0, 1)
2. avgNorm = sum(norm_i) / 10
3. outputFloat = outputSkin.minFloat + avgNorm × (outputSkin.maxFloat - outputSkin.minFloat)
4. outputWearCategory = getWearCategory(outputFloat)
5. 名称: marketHashName 去掉固定磨损后缀 + 加上实际磨损后缀
```

旧实现用 `norm × 0.78 + 0.02` 统一计算，忽略了不同皮肤 float 范围差异。必须从 all.json 取每个皮肤的 `min_float`/`max_float`。

## 三、all.json 数据结构

| 条目类型 | Key 格式 | 包含 | **不包含** |
|---------|---------|------|-----------|
| 皮肤详情 | `skin-{id}_{variant}` | `paint_index`, `weapon_id`, `min_float`, `max_float`, `market_hash_name`, `rarity` | `collections` (空!) |
| 收藏品引用 | `collection-set-*` | `contains[]`: `{id, name, paint_index, rarity}` | `min_float`, `max_float`, `market_hash_name`, `weapon_id` |

**必须跨引用** — 用 `paint_index` 前缀匹配 `skinByKey`:

```ts
const byPaintIndex = new Map<string, Entry>();
for (const [key, entry] of skinByKey) {
  const paintIdx = key.split('|')[0];
  if (!byPaintIndex.has(paintIdx)) byPaintIndex.set(paintIdx, entry);
}
const full = byPaintIndex.get(String(ref.paint_index));
// full 现在有 min_float, max_float, market_hash_name
```

## 四、库存物品名称修复

`skinByKey` 每 `paint_index|weapon_id` 只存一个变体 (非 ST/SV 的第一个，通常是 FN) → 所有物品显示为 崭新出厂。

在 `resolveOne` 中根据实际 `paintWear` 修正:

```ts
const w = getWearCategory(paintWear);
const strip = (s: string) => s.replace(/\s*[（(][^)）]*[)）]\s*$/, '');
rName = strip(rName) + ' (' + w.nameZh + ')';
rHash = strip(rHash) + ' (' + w.name + ')';
// ST/SV: rHash = 'StatTrak™ ' + rHash 或 'Souvenir ' + rHash
```

这同时修复价格查询 — 名字不对则查不到正确价格。

## 五、价格系统陷阱

**#1 跳过逻辑反转** — 必须取新鲜条目后排除:

```ts
const freshSet = new Set(allCached.filter(isFresh).map(c => c.item_hash_name));
const needFetch = mhns.filter(n => !freshSet.has(n)); // 跳过新鲜的
```

**#2 输入物品缺少 marketHashName** — 渲染进程只发 `paintIndex + weaponId + wearFloat`:

```ts
const skin = csgoResolver.resolveSkinByKey(paintIndex, defIndex);
const mhn = stripWear(skin.marketHashName) + ' (' + getWearCategory(wearFloat).name + ')';
```

**#3 产出 marketHashName 用错磨损** — collection-set 数据后缀固定为 FN:

```ts
const correctMhn = output.marketHashName
  .replace(/\s*[（(][^)）]*[)）]\s*$/, '') + ' (' + getWearCategory(estFloat).name + ')';
```

**#4 Token 未配置时静默失败** — IPC 层应在调用前检查。

## 六、子配方自动生成

核心约束: (1) 收藏品分布严格一致 (2) 产出磨损等级集合匹配 (3) 归一化磨损贴近 (4) assetId 不重复 (5) 多组合

关键 Bug 修复:
- `collectionsUsed`(去重) → `simInputs`(原始10条目) 统计
- 父配方模拟 `minFloat/maxFloat` 硬编码 0-1 → `resolveSkinByKey` 取实际值
- 单轮一种组合 → offset 多尝试

## 七、Preload IPC 路由

IPC 方法必须在 `src/preload/index.ts` 声明，channel 必须与主进程 `ipcMain.handle(channel, ...)` 完全一致。

## 八、sql.js 注意事项

- 不支持 `DEFAULT datetime('now')` — 只在 INSERT VALUES 中使用
- DB 返回 snake_case → `toCamel()` 映射
- 写入后必须 `saveDatabase()`
- 批量操作用 `BEGIN TRANSACTION` / `COMMIT` / `ROLLBACK`
