import { RecipeRepo, type RecipeItemRow } from '../db/repositories/recipe.repo';
import { InventoryRepo } from '../db/repositories/inventory.repo';
import { simulateTradeUp, type SimInputItem } from './tradeup-simulator';
import { csgoResolver } from './csgoapi-resolver.service';
import type { ResolvedItem } from '../../shared/types/item';

interface GenerationResult { success: boolean; subRecipes: SubRecipeCandidate[]; error?: string; }
interface SubRecipeCandidate { items: ResolvedItem[]; avgWearNorm: number; normDiff: number; targetRarity: string; targetRarityZh: string; }

/** Look up collection name for a paint_index|weapon_id pair */
function getCollection(paintIndex: number, weaponId: number): string {
  const skin = csgoResolver.resolveSkinByKey(paintIndex, weaponId);
  return skin?.collection || '';
}

export function generateSubRecipes(parentId: number): GenerationResult {
  console.log('[AutoSub] === Starting for parent:', parentId);
  const parent = RecipeRepo.getById(parentId);
  if (!parent) return { success: false, subRecipes: [], error: 'Parent not found' };
  if (parent.parent_id != null) return { success: false, subRecipes: [], error: 'Cannot generate subs for a sub-recipe' };

  const parentItems = RecipeRepo.getItems(parentId);
  console.log(`[AutoSub] Items: ${parentItems.length}, rarity: ${parent.rarity}, target: ${parent.target_rarity}, type: ${parent.type}`);

  // Simulate parent — resolve real collection names from CsgoapiResolver
  const simInputs: SimInputItem[] = parentItems.map(i => ({
    name: '', rarity: parent.rarity, paintIndex: i.paint_index,
    defIndex: i.weapon_id, wearFloat: i.wear_float,
    minFloat: 0, maxFloat: 1,
    collection: getCollection(i.paint_index, i.weapon_id),
    isStatTrak: false, isSouvenir: false,
  }));
  console.log('[AutoSub] Parent collections:', simInputs.map(s => s.collection).filter(Boolean).slice(0, 5));
  const parentSim = simulateTradeUp(simInputs);
  console.log(`[AutoSub] Parent sim ok=${parentSim.success} target=${parentSim.targetRarityZh} colls=${parentSim.collectionsUsed}`);

  const parentNorm = parent.avg_wear_norm ?? parentSim.avgWearNorm;
  const parentColls = new Set(parentSim.collectionsUsed);

  // Find candidates
  const allInv = InventoryRepo.getAllItems();
  console.log(`[AutoSub] Inv skins: ${allInv.filter(i => i.resolvedType === 'skin').length}, parent colls: ${[...parentColls]}`);
  const candidates = allInv.filter(i => {
    if (i.resolvedType !== 'skin') return false;
    if (i.rarityNameZh !== parent.rarity && i.rarityName !== parent.rarity) return false;
    if (!parentColls.has(i.collectionName)) return false;
    if (parent.is_stattrak === 1 && !i.isStatTrak) return false;
    if (parent.type === 'real' && i.assetId) {
      if (parentItems.some(pi => pi.asset_id === i.assetId)) return false;
    }
    return true;
  });
  console.log(`[AutoSub] Candidates: ${candidates.length}`);
  if (candidates.length < 10) return { success: false, subRecipes: [], error: `Need 10 candidates, got ${candidates.length}` };

  const usedIds = new Set<string>();
  if (parent.type === 'real') for (const pi of parentItems) { if (pi.asset_id) usedIds.add(pi.asset_id); }
  // Also exclude items already used in existing children
  const existingChildren = RecipeRepo.getByParent(parentId);
  for (const child of existingChildren) {
    for (const ci of RecipeRepo.getItems(child.id)) {
      if (ci.asset_id) usedIds.add(ci.asset_id);
    }
  }
  console.log('[AutoSub] Used IDs (parent + existing children): ' + usedIds.size);

  const subs: SubRecipeCandidate[] = [];
  for (let r = 0; r < 20; r++) {
    const byColl = new Map<string, ResolvedItem[]>();
    for (const c of candidates) {
      if (usedIds.has(c.assetId)) continue;
      const cn = c.collectionName || 'unknown';
      if (!byColl.has(cn)) byColl.set(cn, []);
      byColl.get(cn)!.push(c);
    }

    // Sort each collection's items by wear norm proximity to parent norm
    const sortedByColl = new Map<string, ResolvedItem[]>();
    for (const [coll, items] of byColl) {
      sortedByColl.set(coll, [...items].sort((a, b) => {
        const na = ((a.paintWear - (a.minFloat || 0)) / Math.max(0.001, (a.maxFloat || 1) - (a.minFloat || 0)));
        const nb = ((b.paintWear - (b.minFloat || 0)) / Math.max(0.001, (b.maxFloat || 1) - (b.minFloat || 0)));
        return Math.abs(na - parentNorm) - Math.abs(nb - parentNorm);
      }));
    }

    const sel: ResolvedItem[] = [];
    // Pass 1: fill proportionally from each parent collection
    for (const [coll, items] of sortedByColl) {
      const parentCount = parentSim.collectionsUsed.filter(cc => cc === coll).length;
      const need = parentCount;
      for (let i = 0; i < Math.min(need, items.length) && sel.length < 10; i++) sel.push(items[i]);
    }
    // Pass 2: if still short, fill from any available collection
    if (sel.length < 10) {
      for (const items of sortedByColl.values()) {
        for (const item of items) {
          if (sel.length >= 10) break;
          if (!sel.includes(item)) sel.push(item);
        }
        if (sel.length >= 10) break;
      }
    }
    console.log(`[AutoSub] R${r}: selected ${sel.length} items (strict=${sel.length===10})`);

    if (sel.length < 10) { console.log(`[AutoSub] Round ${r}: only ${sel.length} items left`); break; }


    const norms = sel.map(i => {
      const range = (i.maxFloat || 1) - (i.minFloat || 0);
      return range > 0 ? Math.max(0, Math.min(1, (i.paintWear - (i.minFloat || 0)) / range)) : 0;
    });
    const avgN = norms.reduce((a, b) => a + b, 0) / 10;
    console.log(`[AutoSub] R${r}: avgNorm=${avgN.toFixed(4)} parentNorm=${parentNorm?.toFixed(4)}`);

    const subSim = simulateTradeUp(sel.map(i => ({
      name: i.resolvedName, rarity: i.rarityName || '',
      paintIndex: i.paintIndex, defIndex: i.defIndex,
      wearFloat: i.paintWear, minFloat: i.minFloat, maxFloat: i.maxFloat,
      collection: i.collectionName || '', isStatTrak: i.isStatTrak, isSouvenir: i.isSouvenir,
    })));

    if (subSim.success && subSim.targetRarityZh === parentSim.targetRarityZh) {
      for (const s of sel) usedIds.add(s.assetId);
      RecipeRepo.create({
        name: parent.name + ' - 子方案' + (r + 1),
        type: 'real', rarity: parent.rarity, targetRarity: parent.target_rarity,
        isStatTrak: parent.is_stattrak === 1, avgWearNorm: avgN,
        avgTargetWear: parentNorm, parentId,
        items: sel.map((item, idx) => ({
          paint_index: item.paintIndex, weapon_id: item.defIndex,
          wear_float: item.paintWear, asset_id: item.assetId || null,
          stattrak: item.isStatTrak ? 1 : 0, souvenir: item.isSouvenir ? 1 : 0,
          position: idx,
        })),
      });
      subs.push({ items: sel, avgWearNorm: avgN, normDiff: Math.abs(avgN - parentNorm),
        targetRarity: subSim.targetRarity, targetRarityZh: subSim.targetRarityZh });
      console.log(`[AutoSub] R${r}: created sub-recipe`);
    }
  }
  console.log(`[AutoSub] Done: ${subs.length} sub-recipes`);
  return { success: true, subRecipes: subs };
}
