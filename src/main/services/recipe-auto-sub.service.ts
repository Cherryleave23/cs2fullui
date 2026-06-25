/**
 * Sub-Recipe Auto-Generator (Optimized)
 *
 * Generates sub-recipes from a parent recipe by matching inventory items
 * to the parent's collection distribution and wear profile.
 *
 * Strict constraints enforced:
 *  1. Sub-recipe belongs to parent (parent_id)
 *  2. Sub-recipe is built from current Steam inventory (real type)
 *  3. Items must come from the same collections as parent items
 *  4. All output wear categories must match parent exactly
 *  5. Normalized wear should be as close to parent as possible
 *  6. Collection distribution (count per collection) must be identical to parent
 *  7. Items cannot be reused across sub-recipes of the same parent
 *  8. If parent is real, parent's items are also excluded (by asset_id)
 *  9. Generate as many valid sub-recipes as possible
 */

import { RecipeRepo, type RecipeItemRow } from '../db/repositories/recipe.repo';
import { InventoryRepo } from '../db/repositories/inventory.repo';
import { PriceRepo } from '../db/repositories/price.repo';
import { dbAll } from '../db/connection';
import { simulateTradeUp, getCollectionOutputData, type SimInputItem } from './tradeup-simulator';
import { csgoResolver } from './csgoapi-resolver.service';
import type { ResolvedItem } from '../../shared/types/item';

// ═══════════════════════════════════════════════════════════
//  Types
// ═══════════════════════════════════════════════════════════

interface GenerationResult {
  success: boolean;
  subRecipes: SubRecipeCandidate[];
  error?: string;
  stats?: {
    candidatesTotal: number;
    combinationsTried: number;
    combinationsPruned: number;
    combinationsValid: number;
    timeMs: number;
  };
}

interface SubRecipeCandidate {
  items: ResolvedItem[];
  avgWearNorm: number;
  normDiff: number;
  targetRarity: string;
  targetRarityZh: string;
}

/** Pre-computed candidate info to avoid repeated wear normalization */
interface CandidateInfo {
  item: ResolvedItem;
  wearNorm: number;
  /** Absolute difference from parent's normalized wear */
  normDiff: number;
}

// ═══════════════════════════════════════════════════════════
//  Utility Functions
// ═══════════════════════════════════════════════════════════

/** Calculate normalized wear: clamp((wear - min) / (max - min), 0, 1) */
function getWearNorm(item: ResolvedItem): number {
  const range = (item.maxFloat || 1) - (item.minFloat || 0);
  return range > 0 ? Math.max(0, Math.min(1, (item.paintWear - (item.minFloat || 0)) / range)) : 0;
}

/** Get wear category name (Chinese) from a float value */
function getWearCategoryName(floatValue: number): string {
  if (floatValue < 0.07) return '崭新出厂';
  if (floatValue < 0.15) return '略有磨损';
  if (floatValue < 0.38) return '久经沙场';
  if (floatValue < 0.45) return '破损不堪';
  return '战痕累累';
}

/** Convert ResolvedItem → SimInputItem for simulation */
function toSimInput(item: ResolvedItem): SimInputItem {
  return {
    name: item.resolvedName,
    rarity: item.rarityName || '',
    paintIndex: item.paintIndex,
    defIndex: item.defIndex,
    wearFloat: item.paintWear,
    minFloat: item.minFloat,
    maxFloat: item.maxFloat,
    collection: item.collectionName || '',
    isStatTrak: item.isStatTrak,
    isSouvenir: item.isSouvenir,
  };
}

// ═══════════════════════════════════════════════════════════
//  Combination Enumerator: C(n, k) — iterative, no recursion
// ═══════════════════════════════════════════════════════════

/**
 * Enumerate all C(n, k) combinations from a sorted candidate list.
 * Uses iterative index-based enumeration to avoid recursion stack overflow.
 *
 * @param items       Sorted candidate list (best first)
 * @param k           Number of items to select
 * @param maxResults  Safety cap to prevent combinatorial explosion
 * @returns Array of combinations, each containing k CandidateInfo entries
 */
function enumerateCombinations(
  items: CandidateInfo[],
  k: number,
  maxResults: number = 200,
): CandidateInfo[][] {
  const n = items.length;
  if (k > n || k === 0) return k === 0 ? [[]] : [];

  const results: CandidateInfo[][] = [];
  const indices: number[] = Array.from({ length: k }, (_, i) => i);

  while (true) {
    // Collect current combination
    results.push(indices.map(i => items[i]));
    if (results.length >= maxResults) break;

    // Find rightmost index that can be incremented
    let i = k - 1;
    while (i >= 0 && indices[i] === n - k + i) i--;
    if (i < 0) break; // All combinations enumerated

    // Increment and reset subsequent indices
    indices[i]++;
    for (let j = i + 1; j < k; j++) {
      indices[j] = indices[j - 1] + 1;
    }
  }

  return results;
}

// ═══════════════════════════════════════════════════════════
//  Quick Wear Check: lightweight validation without full simulation
// ═══════════════════════════════════════════════════════════

/**
 * Quickly predict output wear categories using math only (no full simulation).
 * This is used as a pruning filter before running the expensive simulateTradeUp().
 *
 * @param combo             10 candidate items
 * @param parentNorm        Parent's average normalized wear
 * @param collectionOutputs Collection output data from simulator
 * @param targetRarityZh    Target rarity (Chinese)
 * @returns Predicted wear categories set, or null if cannot compute
 */
function quickWearCheck(
  combo: CandidateInfo[],
  parentNorm: number,
  collectionOutputs: ReturnType<typeof getCollectionOutputData>,
  targetRarityZh: string,
): { avgNorm: number; wearCategories: Set<string> } | null {
  // Calculate average normalized wear
  const avgNorm = combo.reduce((sum, c) => sum + c.wearNorm, 0) / combo.length;

  // Group by collection to determine output sources
  const collCounts = new Map<string, number>();
  for (const c of combo) {
    const coll = c.item.collectionName || 'unknown';
    collCounts.set(coll, (collCounts.get(coll) || 0) + 1);
  }

  const wearCategories = new Set<string>();

  for (const [coll] of collCounts) {
    const outputs = collectionOutputs[coll]?.[targetRarityZh];
    if (!outputs || outputs.length === 0) {
      // Unknown collection output — use generic estimate
      const genericFloat = avgNorm * 0.78 + 0.02;
      wearCategories.add(getWearCategoryName(genericFloat));
      continue;
    }

    // For each output skin, predict its wear category
    for (const output of outputs) {
      const range = output.maxFloat - output.minFloat;
      const estFloat = range > 0
        ? output.minFloat + avgNorm * range
        : output.minFloat;
      wearCategories.add(getWearCategoryName(estFloat));
    }
  }

  return { avgNorm, wearCategories };
}

// ═══════════════════════════════════════════════════════════
//  Batch Price Prefetch: avoid per-item DB queries in loops
// ═══════════════════════════════════════════════════════════

/**
 * Batch-fetch all prices for candidate items and parent outcomes into a Map.
 * This replaces the old pattern of calling PriceRepo.getCache() per item inside loops.
 */
function prefetchPrices(
  candidates: ResolvedItem[],
  parentOutcomes: { marketHashName?: string }[],
): Map<string, number> {
  const needFetch = new Set<string>();

  for (const c of candidates) {
    if (c.marketHashName) needFetch.add(c.marketHashName);
  }
  for (const out of parentOutcomes) {
    if (out.marketHashName) needFetch.add(out.marketHashName);
  }

  if (needFetch.size === 0) return new Map();

  // Single batch query instead of N individual queries
  const prices = PriceRepo.getCache({ itemHashNames: [...needFetch] });
  const priceMap = new Map<string, number>();
  for (const p of prices) {
    if (p.current_price != null) {
      priceMap.set(p.item_hash_name, p.current_price);
    }
  }

  console.log(`[AutoSub] Price prefetch: ${priceMap.size}/${needFetch.size} prices loaded`);
  return priceMap;
}

/**
 * Calculate profit using pre-fetched price Map (no DB queries).
 */
function calcSubProfitFast(
  combo: CandidateInfo[],
  outcomes: { marketHashName?: string; probability?: number }[],
  priceMap: Map<string, number>,
): string | null {
  let totalCost = 0;
  for (const c of combo) {
    const mhn = c.item.marketHashName || '';
    if (!mhn) continue;
    const price = priceMap.get(mhn);
    if (price != null) totalCost += price;
  }

  if (totalCost <= 0) return null;

  let ev = 0;
  let breakEvenProb = 0;

  for (const out of outcomes) {
    const mhn = out.marketHashName || '';
    if (!mhn || !out.probability) continue;
    const price = priceMap.get(mhn);
    if (price != null) {
      ev += price * out.probability;
      if (price >= totalCost) breakEvenProb += out.probability;
    }
  }

  return JSON.stringify({
    totalCost: Math.round(totalCost * 100) / 100,
    expectedValue: Math.round(ev * 100) / 100,
    profit: Math.round((ev - totalCost) * 100) / 100,
    roi: totalCost > 0 ? Math.round((ev - totalCost) / totalCost * 10000) / 100 : 0,
    breakEvenRate: Math.round(breakEvenProb * 10000) / 100,
  });
}

// ═══════════════════════════════════════════════════════════
//  Iterative Cartesian Product Generator
// ═══════════════════════════════════════════════════════════

/**
 * Generate cartesian product of multiple arrays iteratively.
 * Uses a generator to avoid building the full product in memory.
 */
function* cartesianProduct<T>(...arrays: T[][]): Generator<T[]> {
  if (arrays.length === 0) { yield []; return; }
  const [first, ...rest] = arrays;
  for (const item of first) {
    for (const restCombo of cartesianProduct(...rest)) {
      yield [item, ...restCombo];
    }
  }
}

// ═══════════════════════════════════════════════════════════
//  Main: Generate Sub-Recipes
// ═══════════════════════════════════════════════════════════

export function generateSubRecipes(parentId: number): GenerationResult {
  const startTime = Date.now();
  console.log('[AutoSub] === Starting for parent:', parentId);

  // ── 0. Load parent recipe ──
  const parent = RecipeRepo.getById(parentId);
  if (!parent) return { success: false, subRecipes: [], error: 'Parent not found' };
  if (parent.parent_id != null) {
    return { success: false, subRecipes: [], error: 'Cannot generate subs for a sub-recipe' };
  }

  const parentItems = RecipeRepo.getItems(parentId);
  console.log(`[AutoSub] Items: ${parentItems.length}, rarity: ${parent.rarity}, target: ${parent.target_rarity}, type: ${parent.type}`);

  // ── 1. Simulate parent to get baseline ──
  const simInputs: SimInputItem[] = parentItems.map(i => {
    const skin = csgoResolver.resolveSkinByKey(i.paint_index, i.weapon_id);
    return {
      name: '', rarity: parent.rarity, paintIndex: i.paint_index,
      defIndex: i.weapon_id, wearFloat: i.wear_float,
      minFloat: skin?.minFloat ?? 0, maxFloat: skin?.maxFloat ?? 1,
      collection: skin?.collection || '',
      isStatTrak: false, isSouvenir: false,
    };
  });
  console.log('[AutoSub] Parent items:', simInputs.map(s => `${s.collection} [${s.minFloat}-${s.maxFloat}] w=${s.wearFloat}`).join(', '));

  const parentSim = simulateTradeUp(simInputs);
  console.log(`[AutoSub] Parent sim ok=${parentSim.success} target=${parentSim.targetRarityZh} colls=${parentSim.collectionsUsed}`);

  if (!parentSim.success) {
    return { success: false, subRecipes: [], error: 'Parent simulation failed: ' + (parentSim.error || 'unknown') };
  }

  const parentNorm = parentSim.avgWearNorm;

  // ═══════════════════════════════════════════════════════════
  //  Constraint 4: Parent output wear categories (must match exactly)
  // ═══════════════════════════════════════════════════════════
  const parentWearCats = new Set(parentSim.outcomes.map(o => o.estWearCategory));
  console.log('[AutoSub] Parent wear categories:', [...parentWearCats], 'norm:', parentNorm?.toFixed(4));

  // ═══════════════════════════════════════════════════════════
  //  Constraint 6: Parent collection distribution (strictly immutable)
  //  e.g. { "武器箱A": 3, "武器箱B": 4, "武器箱C": 3 }
  // ═══════════════════════════════════════════════════════════
  const parentCollCounts = new Map<string, number>();
  for (const si of simInputs) {
    const coll = si.collection || 'unknown';
    parentCollCounts.set(coll, (parentCollCounts.get(coll) || 0) + 1);
  }
  const requiredStr = [...parentCollCounts].map(([c, n]) => `${c}:${n}`).join(', ');
  console.log('[AutoSub] Required distribution (10 items):', requiredStr);

  // ═══════════════════════════════════════════════════════════
  //  Constraint 7 & 8: Collect used asset_ids
  //  - Constraint 8: If parent is real, parent's items are excluded
  //  - Constraint 7: Existing children's items are excluded
  // ═══════════════════════════════════════════════════════════
  const usedIds = new Set<string>();

  // Constraint 8: parent is real → exclude parent's asset_ids
  if (parent.type === 'real') {
    for (const pi of parentItems) {
      if (pi.asset_id) usedIds.add(pi.asset_id);
    }
  }

  // Constraint 7: exclude existing children's asset_ids
  const existingChildren = RecipeRepo.getByParent(parentId);
  for (const child of existingChildren) {
    for (const ci of RecipeRepo.getItems(child.id)) {
      if (ci.asset_id) usedIds.add(ci.asset_id);
    }
  }

  // Constraint 10 (新增): 全局排重 — 排除所有其他 type='real' 配方已引用的 asset_id
  // 防止两个相似父配方生成相同子配方争抢同一件库存物品
  const globallyUsed = dbAll<{ asset_id: string }>(
    `SELECT DISTINCT ri.asset_id
     FROM recipe_items ri
     JOIN recipes r ON ri.recipe_id = r.id
     WHERE ri.asset_id IS NOT NULL
       AND r.type = 'real'
       AND r.id != ?
       AND r.parent_id != ?`,
    [parentId, parentId]
  );
  for (const row of globallyUsed) {
    usedIds.add(row.asset_id);
  }
  console.log('[AutoSub] Used IDs (parent + children + globally used): ' + usedIds.size
    + ' (global: ' + globallyUsed.length + ')');

  // ── 2. Filter inventory candidates ──
  // Constraint 3: must come from same collections as parent
  const allInv = InventoryRepo.getAllItems();
  const parentCollSet = new Set(parentSim.collectionsUsed);
  const candidates = allInv.filter(i => {
    if (i.resolvedType !== 'skin') return false;
    // Match rarity (check both Chinese and English names)
    if (i.rarityNameZh !== parent.rarity && i.rarityName !== parent.rarity) return false;
    // Constraint 3: same collection source
    if (!parentCollSet.has(i.collectionName)) return false;
    // StatTrak consistency
    if (parent.is_stattrak === 1 && !i.isStatTrak) return false;
    // Constraint 7 & 8: exclude already-used asset_ids
    if (i.assetId && usedIds.has(i.assetId)) return false;
    return true;
  });

  console.log(`[AutoSub] Candidates: ${candidates.length} (inv skins: ${allInv.filter(i => i.resolvedType === 'skin').length})`);
  if (candidates.length < 10) {
    return { success: false, subRecipes: [], error: `Need 10 candidates, got ${candidates.length}` };
  }

  // ═══════════════════════════════════════════════════════════
  //  Phase 1: Pre-computation (one-time, avoids repeated work)
  // ═══════════════════════════════════════════════════════════

  // 1a. Pre-compute normalized wear for all candidates (Constraint 5: normDiff)
  const candidateInfos: CandidateInfo[] = candidates.map(item => ({
    item,
    wearNorm: getWearNorm(item),
    normDiff: Math.abs(getWearNorm(item) - parentNorm),
  }));

  // 1b. Group by collection and pre-sort by normDiff ascending (best match first)
  // This sort happens ONCE, not per-round like the old code
  const byCollInfo = new Map<string, CandidateInfo[]>();
  for (const ci of candidateInfos) {
    const coll = ci.item.collectionName || 'unknown';
    if (!byCollInfo.has(coll)) byCollInfo.set(coll, []);
    byCollInfo.get(coll)!.push(ci);
  }

  const sortedByColl = new Map<string, CandidateInfo[]>();
  for (const [coll, infos] of byCollInfo) {
    sortedByColl.set(coll, [...infos].sort((a, b) => a.normDiff - b.normDiff));
  }

  // 1c. Batch prefetch all prices (replaces per-item DB queries in loops)
  const priceMap = prefetchPrices(candidates, parentSim.outcomes);

  // 1d. Get collection output data for quick wear check
  const collectionOutputs = getCollectionOutputData();

  // ═══════════════════════════════════════════════════════════
  //  Phase 2+3: Iterative Generation
  //
  //  OLD approach (bug): pre-generate all valid combos → sort → greedy select
  //    Problem: top combos share the same "best" items → after saving #1,
  //    remaining 49 combos all conflict → only 1 sub-recipe generated.
  //
  //  NEW approach: iterative loop — each round:
  //    1. Filter out asset_ids already used from candidate pool
  //    2. Re-enumerate C(n,k) from remaining candidates per collection
  //    3. Cartesian product + quick wear check → find best valid combo
  //    4. Full simulation validate → save sub-recipe
  //    5. Mark its asset_ids as used → repeat
  //
  //  This guarantees maximum sub-recipes because each round starts fresh
  //  with remaining items, naturally avoiding conflicts.
  // ═══════════════════════════════════════════════════════════

  const subs: SubRecipeCandidate[] = [];
  const usedInThisRun = new Set<string>();
  let combosTried = 0;
  let combosPruned = 0;

  const MAX_ROUNDS = 50;           // Maximum sub-recipes to generate
  const MAX_TRIES_PER_ROUND = 2000; // Max combinations to try per round

  for (let round = 0; round < MAX_ROUNDS; round++) {
    // ── Step 1: Filter out used asset_ids from candidate pool ──
    const availableByColl = new Map<string, CandidateInfo[]>();
    let canGenerate = true;

    for (const [coll, need] of parentCollCounts) {
      const all = sortedByColl.get(coll) || [];
      const available = all.filter(ci =>
        !ci.item.assetId || !usedInThisRun.has(ci.item.assetId)
      );
      if (available.length < need) {
        canGenerate = false;
        break;
      }
      availableByColl.set(coll, available);
    }
    if (!canGenerate) {
      console.log(`[AutoSub] Round ${round + 1}: 候选物品不足，停止生成`);
      break;
    }

    // ── Step 2: Enumerate C(n,k) per collection from remaining candidates ──
    const collCombosThisRound = new Map<string, CandidateInfo[][]>();
    for (const [coll, need] of parentCollCounts) {
      const available = availableByColl.get(coll) || [];
      const combos = enumerateCombinations(available, need, 100);
      collCombosThisRound.set(coll, combos);
    }

    // ── Step 3: Cartesian product + quick wear check → find best combo ──
    const comboListsThisRound = [...parentCollCounts.entries()].map(
      ([coll]) => collCombosThisRound.get(coll) || []
    );

    let bestCombo: { combo: CandidateInfo[]; avgNorm: number; normDiff: number } | null = null;
    let triesThisRound = 0;

    for (const comboParts of cartesianProduct(...comboListsThisRound)) {
      if (triesThisRound >= MAX_TRIES_PER_ROUND) break;
      triesThisRound++;
      combosTried++;

      const combo: CandidateInfo[] = comboParts.flat();

      // Pruning 1: asset_id uniqueness within this combo
      const comboAssetIds = new Set<string>();
      let hasDuplicate = false;
      for (const c of combo) {
        if (c.item.assetId) {
          if (comboAssetIds.has(c.item.assetId)) {
            hasDuplicate = true;
            break;
          }
          comboAssetIds.add(c.item.assetId);
        }
      }
      if (hasDuplicate) { combosPruned++; continue; }

      // Pruning 2: quick wear check (Constraint 4)
      const quickResult = quickWearCheck(
        combo, parentNorm, collectionOutputs, parentSim.targetRarityZh
      );
      if (!quickResult) { combosPruned++; continue; }

      const wearMatch = parentWearCats.size === quickResult.wearCategories.size &&
        [...parentWearCats].every(c => quickResult.wearCategories.has(c));
      if (!wearMatch) { combosPruned++; continue; }

      const normDiff = Math.abs(quickResult.avgNorm - parentNorm);

      // Keep the best (lowest normDiff) combo found this round
      if (!bestCombo || normDiff < bestCombo.normDiff) {
        bestCombo = { combo, avgNorm: quickResult.avgNorm, normDiff };
      }

      // Early exit if near-perfect match found
      if (normDiff < 0.001) break;
    }

    if (!bestCombo) {
      console.log(`[AutoSub] Round ${round + 1}: 无有效组合，停止生成`);
      break;
    }

    // ── Step 4: Full simulation validation (double-check Constraint 4) ──
    const subSim = simulateTradeUp(bestCombo.combo.map(c => toSimInput(c.item)));
    if (!subSim.success) {
      console.log(`[AutoSub] Round ${round + 1}: 全模拟失败，跳过`);
      continue;
    }
    if (subSim.targetRarityZh !== parentSim.targetRarityZh) continue;

    const subWearCats = new Set(subSim.outcomes.map(o => o.estWearCategory));
    const wearMatch = parentWearCats.size === subWearCats.size &&
      [...parentWearCats].every(c => subWearCats.has(c));
    if (!wearMatch) continue;

    // ── Step 5: Save sub-recipe + mark asset_ids as used ──
    for (const c of bestCombo.combo) {
      if (c.item.assetId) usedInThisRun.add(c.item.assetId);
    }

    const childIdx = subs.length + 1;
    const profitJson = calcSubProfitFast(bestCombo.combo, subSim.outcomes, priceMap);

    // Constraint 1: parentId links sub-recipe to parent
    // Constraint 2: type = 'real' (built from Steam inventory)
    RecipeRepo.create({
      name: parent.name + ' - 子方案' + childIdx,
      type: 'real',
      rarity: parent.rarity,
      targetRarity: parent.target_rarity,
      isStatTrak: parent.is_stattrak === 1,
      avgWearNorm: bestCombo.avgNorm,
      avgTargetWear: parentNorm,
      parentId,
      outcomeSummary: JSON.stringify(subSim.outcomes),
      profitJson,
      items: bestCombo.combo.map((c, idx) => ({
        paint_index: c.item.paintIndex,
        weapon_id: c.item.defIndex,
        wear_float: c.item.paintWear,
        asset_id: c.item.assetId || null,
        stattrak: c.item.isStatTrak ? 1 : 0,
        souvenir: c.item.isSouvenir ? 1 : 0,
        position: idx,
      })),
    });

    subs.push({
      items: bestCombo.combo.map(c => c.item),
      avgWearNorm: bestCombo.avgNorm,
      normDiff: bestCombo.normDiff,
      targetRarity: subSim.targetRarity,
      targetRarityZh: subSim.targetRarityZh,
    });

    console.log(`[AutoSub] Round ${round + 1}: ✓ sub #${childIdx} norm=${bestCombo.avgNorm.toFixed(4)} diff=${bestCombo.normDiff.toFixed(4)} tries=${triesThisRound}`);
  }

  console.log(`[AutoSub] Phase 2+3: rounds=${subs.length}, tried=${combosTried}, pruned=${combosPruned}`);

  const elapsed = Date.now() - startTime;
  console.log(`[AutoSub] Done: ${subs.length} sub-recipes in ${elapsed}ms`);

  return {
    success: true,
    subRecipes: subs,
    stats: {
      candidatesTotal: candidates.length,
      combinationsTried: combosTried,
      combinationsPruned: combosPruned,
      combinationsValid: subs.length,
      timeMs: elapsed,
    },
  };
}
