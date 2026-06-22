/**
 * Auto-sub-recipe generator.
 * Given a parent recipe, finds inventory items to create sub-recipes that:
 *   - Match the same output rarity as parent
 *   - Minimize avgWearNorm difference from parent
 *   - Have no duplicate asset_ids across sub-recipes
 */
import { RecipeRepo, type RecipeItemRow } from '../db/repositories/recipe.repo';
import { InventoryRepo } from '../db/repositories/inventory.repo';
import { simulateTradeUp, type SimInputItem } from './tradeup-simulator';
import type { ResolvedItem } from '../../shared/types/item';

interface GenerationResult {
  success: boolean;
  subRecipes: SubRecipeCandidate[];
  error?: string;
}

interface SubRecipeCandidate {
  items: ResolvedItem[];
  avgWearNorm: number;
  normDiff: number; // |candidate - parent|
  targetRarity: string;
  targetRarityZh: string;
}

/** Generate sub-recipes for a parent recipe */
export function generateSubRecipes(parentId: number): GenerationResult {
  const parent = RecipeRepo.getById(parentId);
  if (!parent) return { success: false, subRecipes: [], error: 'Parent not found' };
  if (parent.parent_id != null) return { success: false, subRecipes: [], error: 'Cannot generate subs for a sub-recipe' };

  const parentItems = RecipeRepo.getItems(parentId);
  if (parentItems.length !== 10) return { success: false, subRecipes: [], error: 'Parent must have exactly 10 items' };

  // ── 1. Simulate parent to get target rarity + collections ──
  const simInputs: SimInputItem[] = parentItems.map(i => ({
    name: '', rarity: parent.rarity, paintIndex: i.paint_index,
    defIndex: i.weapon_id, wearFloat: i.wear_float,
    minFloat: 0, maxFloat: 1, collection: '', isStatTrak: false, isSouvenir: false,
  }));
  const parentSim = simulateTradeUp(simInputs);
  if (!parentSim.success) return { success: false, subRecipes: [], error: 'Parent simulation failed' };

  const parentNorm = parent.avg_wear_norm ?? parentSim.avgWearNorm;
  const parentCollections = new Set(parentSim.collectionsUsed);
  const parentTargetRarity = parent.target_rarity;

  // ── 2. Find candidates from inventory ──
  const allInv = InventoryRepo.getAllItems();
  const candidates = allInv.filter(i => {
    if (i.resolvedType !== 'skin') return false;
    if (i.rarityNameZh !== parent.rarity && i.rarityName !== parent.rarity) return false;
    if (!parentCollections.has(i.collectionName)) return false;
    if (parent.is_stattrak === 1 && !i.isStatTrak) return false;
    // Exclude parent item asset_ids for real recipes
    if (parent.type === 'real' && i.assetId) {
      if (parentItems.some(pi => pi.asset_id === i.assetId)) return false;
    }
    return true;
  });

  if (candidates.length < 10) return { success: false, subRecipes: [], error: `Not enough candidates: ${candidates.length} < 10` };

  // ── 3. Track used asset_ids across all sub-recipes ──
  const usedIds = new Set<string>();
  if (parent.type === 'real') {
    for (const pi of parentItems) {
      if (pi.asset_id) usedIds.add(pi.asset_id);
    }
  }

  // ── 4. Generate sub-recipes greedily ──
  const subRecipes: SubRecipeCandidate[] = [];
  const MAX_SUBS = 20;

  for (let round = 0; round < MAX_SUBS && candidates.length >= 10; round++) {
    // Group by collection, exclude already-used
    const byColl = new Map<string, ResolvedItem[]>();
    for (const c of candidates) {
      if (usedIds.has(c.assetId)) continue;
      const coll = c.collectionName || 'unknown';
      if (!byColl.has(coll)) byColl.set(coll, []);
      byColl.get(coll)!.push(c);
    }

    // Try to build 10 items matching parent collection distribution
    const selected: ResolvedItem[] = [];
    for (const [coll, items] of byColl) {
      const needed = Math.round(parentSim.collectionsUsed.filter(c => c === coll).length / parentSim.collectionsUsed.length * 10);
      // Simplified: take from each collection proportionally
      for (let i = 0; i < Math.min(needed, items.length) && selected.length < 10; i++) {
        selected.push(items[i]);
      }
      if (selected.length >= 10) break;
    }

    // Fill remaining from any collection
    for (const items of byColl.values()) {
      for (const item of items) {
        if (selected.length >= 10) break;
        if (!selected.includes(item)) selected.push(item);
      }
      if (selected.length >= 10) break;
    }

    if (selected.length < 10) break; // Not enough unused items left

    // ── 5. Calculate norm + validate ──
    const norms = selected.map(i => {
      const range = (i.maxFloat || 1) - (i.minFloat || 0);
      return range > 0 ? Math.max(0, Math.min(1, (i.paintWear - (i.minFloat || 0)) / range)) : 0;
    });
    const avgNorm = norms.reduce((a, b) => a + b, 0) / norms.length;

    // Validate output rarity matches parent
    const subSimInputs: SimInputItem[] = selected.map(i => ({
      name: i.resolvedName, rarity: i.rarityName || '',
      paintIndex: i.paintIndex, defIndex: i.defIndex,
      wearFloat: i.paintWear, minFloat: i.minFloat, maxFloat: i.maxFloat,
      collection: i.collectionName || '', isStatTrak: i.isStatTrak, isSouvenir: i.isSouvenir,
    }));
    const subSim = simulateTradeUp(subSimInputs);

    if (subSim.success && subSim.targetRarityZh === parentSim.targetRarityZh) {
      // Mark as used
      for (const s of selected) usedIds.add(s.assetId);

      const subRecipe = RecipeRepo.create({
        name: `${parent.name} - 子方案${round + 1}`,
        type: selected.some(i => i.assetId && i.resolvedType === 'skin') ? 'real' : 'virtual',
        rarity: parent.rarity, targetRarity: parent.target_rarity,
        isStatTrak: parent.is_stattrak === 1, avgWearNorm: avgNorm,
        avgTargetWear: parentNorm, parentId,
        items: selected.map((item, idx) => ({
          paint_index: item.paintIndex, weapon_id: item.defIndex,
          wear_float: item.paintWear, asset_id: item.assetId || null,
          stattrak: item.isStatTrak ? 1 : 0, souvenir: item.isSouvenir ? 1 : 0,
          position: idx,
        })),
      });

      subRecipes.push({
        items: selected,
        avgWearNorm: avgNorm,
        normDiff: Math.abs(avgNorm - parentNorm),
        targetRarity: subSim.targetRarity,
        targetRarityZh: subSim.targetRarityZh,
      });
    }
  }

  return { success: true, subRecipes };
}
