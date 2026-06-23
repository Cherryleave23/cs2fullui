import { RecipeRepo, type RecipeItemRow } from '../db/repositories/recipe.repo';
import { InventoryRepo } from '../db/repositories/inventory.repo';
import { simulateTradeUp, type SimInputItem } from './tradeup-simulator';
import { csgoResolver } from './csgoapi-resolver.service';
import type { ResolvedItem } from '../../shared/types/item';

interface GenerationResult { success: boolean; subRecipes: SubRecipeCandidate[]; error?: string; }
interface SubRecipeCandidate { items: ResolvedItem[]; avgWearNorm: number; normDiff: number; targetRarity: string; targetRarityZh: string; }

/** Calculate normalized wear: clamp((wear - min) / (max - min), 0, 1) */
function getWearNorm(item: ResolvedItem): number {
  const range = (item.maxFloat || 1) - (item.minFloat || 0);
  return range > 0 ? Math.max(0, Math.min(1, (item.paintWear - (item.minFloat || 0)) / range)) : 0;
}

/**
 * Build a 10-item combination strictly matching the parent's collection distribution.
 * If parent has 3 items from collection A and 7 from B, the sub-recipe must also have
 * exactly 3 from A and 7 from B — no cross-collection borrowing.
 *
 * @param offset — skip the first `offset` best-matching items in each collection
 *                 to generate alternative combinations for the same round.
 */
function buildCombination(
  sortedByColl: Map<string, ResolvedItem[]>,
  parentCollCounts: Map<string, number>,
  offset: number,
): ResolvedItem[] | null {
  const sel: ResolvedItem[] = [];
  const selAssetIds = new Set<string>();

  // First pass: check every required collection has enough items at this offset
  for (const [coll, need] of parentCollCounts) {
    const items = sortedByColl.get(coll);
    if (!items || items.length < offset + need) {
      console.log(`[AutoSub] buildCombination: collection "${coll}" needs ${need}, has ${items?.length ?? 0}, offset=${offset} → impossible`);
      return null;
    }
  }

  // Second pass: fill exactly parentCount items from each collection, starting at offset
  for (const [coll, need] of parentCollCounts) {
    const items = sortedByColl.get(coll)!;
    for (let i = offset; i < offset + need; i++) {
      if (!selAssetIds.has(items[i].assetId)) {
        sel.push(items[i]);
        selAssetIds.add(items[i].assetId);
      }
    }
  }

  return sel;
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

export function generateSubRecipes(parentId: number): GenerationResult {
  console.log('[AutoSub] === Starting for parent:', parentId);
  const parent = RecipeRepo.getById(parentId);
  if (!parent) return { success: false, subRecipes: [], error: 'Parent not found' };
  if (parent.parent_id != null) return { success: false, subRecipes: [], error: 'Cannot generate subs for a sub-recipe' };

  const parentItems = RecipeRepo.getItems(parentId);
  console.log(`[AutoSub] Items: ${parentItems.length}, rarity: ${parent.rarity}, target: ${parent.target_rarity}, type: ${parent.type}`);

  // ── 1. Simulate parent to get baseline ──
  // Use actual min/max from skin data — these affect avgWearNorm and output wear categories
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

  if (!parentSim.success) return { success: false, subRecipes: [], error: 'Parent simulation failed: ' + (parentSim.error || 'unknown') };

  // Always use fresh simulation result — the stored DB value may be from before the float fix
  const parentNorm = parentSim.avgWearNorm;

  // Collect parent output wear categories — sub-recipes must match this exactly
  const parentWearCats = new Set(parentSim.outcomes.map(o => o.estWearCategory));
  console.log('[AutoSub] Parent wear categories:', [...parentWearCats], 'norm:', parentNorm?.toFixed(4));

  // Build parent collection counts for proportional fill
  const parentCollCounts = new Map<string, number>();
  for (const coll of parentSim.collectionsUsed) {
    parentCollCounts.set(coll, (parentCollCounts.get(coll) || 0) + 1);
  }
  const requiredStr = [...parentCollCounts].map(([c, n]) => `${c}:${n}`).join(', ');
  console.log('[AutoSub] Required distribution:', requiredStr);

  // ── 2. Find inventory candidates ──
  const allInv = InventoryRepo.getAllItems();
  const parentCollSet = new Set(parentSim.collectionsUsed);
  const candidates = allInv.filter(i => {
    if (i.resolvedType !== 'skin') return false;
    if (i.rarityNameZh !== parent.rarity && i.rarityName !== parent.rarity) return false;
    if (!parentCollSet.has(i.collectionName)) return false;
    if (parent.is_stattrak === 1 && !i.isStatTrak) return false;
    if (parent.type === 'real' && i.assetId) {
      if (parentItems.some(pi => pi.asset_id === i.assetId)) return false;
    }
    return true;
  });
  console.log(`[AutoSub] Candidates: ${candidates.length} (inv skins: ${allInv.filter(i => i.resolvedType === 'skin').length})`);
  if (candidates.length < 10) return { success: false, subRecipes: [], error: `Need 10 candidates, got ${candidates.length}` };

  // ── 3. Track used assetIds ──
  const usedIds = new Set<string>();
  if (parent.type === 'real') {
    for (const pi of parentItems) { if (pi.asset_id) usedIds.add(pi.asset_id); }
  }
  const existingChildren = RecipeRepo.getByParent(parentId);
  for (const child of existingChildren) {
    for (const ci of RecipeRepo.getItems(child.id)) {
      if (ci.asset_id) usedIds.add(ci.asset_id);
    }
  }
  console.log('[AutoSub] Used IDs (parent + existing children): ' + usedIds.size);

  // ── 4. Generate sub-recipes ──
  const subs: SubRecipeCandidate[] = [];
  const MAX_ROUNDS = 30;
  const MAX_ATTEMPTS = 5;

  for (let r = 0; r < MAX_ROUNDS; r++) {
    // Group remaining candidates by collection
    const byColl = new Map<string, ResolvedItem[]>();
    for (const c of candidates) {
      if (usedIds.has(c.assetId)) continue;
      const cn = c.collectionName || 'unknown';
      if (!byColl.has(cn)) byColl.set(cn, []);
      byColl.get(cn)!.push(c);
    }

    // Sort each collection by wear norm proximity to parent norm
    const sortedByColl = new Map<string, ResolvedItem[]>();
    for (const [coll, items] of byColl) {
      sortedByColl.set(coll, [...items].sort((a, b) => {
        return Math.abs(getWearNorm(a) - parentNorm) - Math.abs(getWearNorm(b) - parentNorm);
      }));
    }

    // Check total available
    let totalAvail = 0;
    const collCounts: string[] = [];
    for (const [coll, items] of sortedByColl) {
      totalAvail += items.length;
      collCounts.push(`${coll}:${items.length}`);
    }
    console.log(`[AutoSub] Round ${r}: ${totalAvail} available (${collCounts.join(', ')})`);
    if (totalAvail < 10) {
      console.log(`[AutoSub] Round ${r}: only ${totalAvail} items left, stopping`);
      break;
    }

    let found = false;
    for (let attempt = 0; attempt < MAX_ATTEMPTS && !found; attempt++) {
      const sel = buildCombination(sortedByColl, parentCollCounts, attempt);
      if (!sel) {
        console.log(`[AutoSub] R${r}A${attempt}: insufficient items at offset ${attempt} to match parent distribution`);
        continue;
      }

      // Calculate avg wear norm
      const norms = sel.map(i => getWearNorm(i));
      const avgN = norms.reduce((a, b) => a + b, 0) / 10;

      // Simulate sub-recipe
      const subSim = simulateTradeUp(sel.map(i => toSimInput(i)));

      if (!subSim.success) {
        console.log(`[AutoSub] R${r}A${attempt}: sim failed`);
        continue;
      }
      if (subSim.targetRarityZh !== parentSim.targetRarityZh) {
        console.log(`[AutoSub] R${r}A${attempt}: rarity mismatch ${subSim.targetRarityZh} vs ${parentSim.targetRarityZh}`);
        continue;
      }

      // ═══════════════════════════════════════════
      //  Wear level validation:
      //  All possible output wear categories must match exactly
      // ═══════════════════════════════════════════
      const subWearCats = new Set(subSim.outcomes.map(o => o.estWearCategory));
      const wearMatch = parentWearCats.size === subWearCats.size &&
        [...parentWearCats].every(c => subWearCats.has(c));

      if (!wearMatch) {
        console.log(`[AutoSub] R${r}A${attempt}: wear mismatch parent:[${[...parentWearCats]}] sub:[${[...subWearCats]}] norm=${avgN.toFixed(4)}`);
        continue;
      }

      // ── Valid sub-recipe! ──
      for (const s of sel) usedIds.add(s.assetId);

      const childIdx = subs.length + 1;
      RecipeRepo.create({
        name: parent.name + ' - 子方案' + childIdx,
        type: 'real',
        rarity: parent.rarity,
        targetRarity: parent.target_rarity,
        isStatTrak: parent.is_stattrak === 1,
        avgWearNorm: avgN,
        avgTargetWear: parentNorm,
        parentId,
        items: sel.map((item, idx) => ({
          paint_index: item.paintIndex,
          weapon_id: item.defIndex,
          wear_float: item.paintWear,
          asset_id: item.assetId || null,
          stattrak: item.isStatTrak ? 1 : 0,
          souvenir: item.isSouvenir ? 1 : 0,
          position: idx,
        })),
      });

      subs.push({
        items: sel,
        avgWearNorm: avgN,
        normDiff: Math.abs(avgN - parentNorm),
        targetRarity: subSim.targetRarity,
        targetRarityZh: subSim.targetRarityZh,
      });
      console.log(`[AutoSub] R${r}A${attempt}: ✓ sub #${childIdx} norm=${avgN.toFixed(4)} diff=${Math.abs(avgN - parentNorm).toFixed(4)}`);
      found = true;
    }

    if (!found) {
      console.log(`[AutoSub] Round ${r}: no valid combination after ${MAX_ATTEMPTS} attempts, stopping`);
      break;
    }
  }

  console.log(`[AutoSub] Done: ${subs.length} sub-recipes`);
  return { success: true, subRecipes: subs };
}
