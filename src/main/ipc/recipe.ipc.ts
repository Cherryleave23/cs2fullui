import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/ipc-channels';
import { RecipeRepo } from '../db/repositories/recipe.repo';
import { InventoryRepo } from '../db/repositories/inventory.repo';
import { csgoResolver } from '../services/csgoapi-resolver.service';
import { generateSubRecipes } from '../services/recipe-auto-sub.service';
import { getWearCategory } from '../db/seed';

const stripWear = (s: string) => s.replace(/\s*[（(][^)）]*[)）]\s*$/, '');

export function registerRecipeIpc(): void {
  // ── List all recipes (parent + children) ──
  ipcMain.handle(IPC_CHANNELS.RECIPE_LIST, async () => {
    return RecipeRepo.getTree();
  });

  // ── Get single recipe with items ──
  ipcMain.handle(IPC_CHANNELS.RECIPE_GET, async (_e, id: number) => {
    const recipe = RecipeRepo.getById(id);
    if (!recipe) return null;
    const items = RecipeRepo.getItems(id);
    // Enrich items with real skin names + correct-wear marketHashName for price lookup

    const enriched = items.map(i => {
      const skin = csgoResolver.resolveSkinByKey(i.paint_index, i.weapon_id);
      const rawName = skin?.nameZh || skin?.name || `#${i.paint_index}|${i.weapon_id}`;
      const displayName = rawName.replace(/\s*[（(][^)）]*[)）]\s*$/, '');
      // Build correct market_hash_name: strip fixed wear from stored entry, apply actual wear
      const wear = getWearCategory(i.wear_float);
      const baseMhn = skin?.marketHashName || '';
      const correctMhn = baseMhn
        ? stripWear(baseMhn) + ' (' + wear.name + ')'
        : '';
      return {
        ...i,
        skinName: displayName,
        skinColor: skin?.rarityColor,
        marketHashName: correctMhn || undefined,
      };
    });
    return { ...recipe, items: enriched, children: RecipeRepo.getByParent(id) };
  });

  // ── Save recipe (with duplicate check) ──
  ipcMain.handle(IPC_CHANNELS.RECIPE_SAVE, async (_e, recipe: any) => {
    try {
      const paintKeys = (recipe.items || [])
        .map((i: any) => `${i.paintIndex || i.paint_index}|${i.weaponId || i.weapon_id}`)
        .sort().join(',');
      const dup = RecipeRepo.findDuplicate({ name: recipe.name, rarity: recipe.rarity, paintKeys });
      if (dup) return { duplicate: true, id: dup.id, message: '同名同内容配方已存在，是否替换？' };

      const saved = RecipeRepo.create({
        name: recipe.name, description: recipe.description,
        type: recipe.type || 'virtual', rarity: recipe.rarity,
        targetRarity: recipe.targetRarity || recipe.target_rarity,
        isStatTrak: recipe.isStatTrak, avgWearNorm: recipe.avgWearNorm,
        avgTargetWear: recipe.avgTargetWear,
        parentId: recipe.parentId || null,
        outcomeSummary: recipe.outcomeSummary ? JSON.stringify(recipe.outcomeSummary) : null,
        profitJson: recipe.profit ? JSON.stringify(recipe.profit) : null,
        items: (recipe.items || []).map((i: any, idx: number) => ({
          paint_index: i.paintIndex || i.paint_index || 0,
          weapon_id: i.weaponId || i.weapon_id || 0,
          wear_float: i.wearFloat || i.wear_float || 0,
          asset_id: i.assetId || i.asset_id || null,
          stattrak: i.stattrak ? 1 : 0, souvenir: i.souvenir ? 1 : 0,
          position: i.position ?? idx,
        })),
      });
      return { ...saved, items: RecipeRepo.getItems(saved.id) };
    } catch (err: any) { return { error: err.message }; }
  });

  // ── Replace existing recipe ──
  ipcMain.handle('recipe:replace', async (_e, params: { id: number; recipe: any }) => {
    try {
      RecipeRepo.updateItems(params.id, (params.recipe.items || []).map((i: any, idx: number) => ({
        paint_index: i.paintIndex || i.paint_index || 0,
        weapon_id: i.weaponId || i.weapon_id || 0,
        wear_float: i.wearFloat || i.wear_float || 0,
        asset_id: i.assetId || i.asset_id || null,
        stattrak: i.stattrak ? 1 : 0, souvenir: i.souvenir ? 1 : 0,
        position: i.position ?? idx,
      })));
      return { success: true };
    } catch (err: any) { return { error: err.message }; }
  });

  // ── Delete ──
  ipcMain.handle(IPC_CHANNELS.RECIPE_DELETE, async (_e, id: number) => {
    // Cascade delete children
    const children = RecipeRepo.getByParent(id);
    for (const c of children) RecipeRepo.delete(c.id);
    RecipeRepo.delete(id);
    return { success: true };
  });

  // ── Export / Import ──
  ipcMain.handle(IPC_CHANNELS.RECIPE_EXPORT, async (_e, id: number) => {
    const data = RecipeRepo.exportJson(id);
    return data ? JSON.stringify(data, null, 2) : null;
  });

  ipcMain.handle(IPC_CHANNELS.RECIPE_IMPORT, async (_e, json: string) => {
    try {
      const data = JSON.parse(json);
      if (!data.version || !data.name || !data.items) return { error: '无效格式' };
      const saved = RecipeRepo.create({
        name: data.name, rarity: data.rarity, targetRarity: data.targetRarity,
        type: data.type || 'virtual', isStatTrak: data.isStatTrak,
        avgWearNorm: data.avgWearNorm,
        items: (data.items || []).map((i: any, idx: number) => ({
          paint_index: i.paintIndex, weapon_id: i.weaponId,
          wear_float: i.wearFloat, asset_id: i.assetId || null,
          stattrak: i.statTrak ? 1 : 0, souvenir: i.souvenir ? 1 : 0,
          position: i.position ?? idx,
        })),
      });
      return { ...saved, items: RecipeRepo.getItems(saved.id) };
    } catch (err: any) { return { error: err.message }; }
  });

  // ── Resolve skin by paintIndex + weaponId ──
  ipcMain.handle('tradeup:resolve-skin', async (_e, params: { paintIndex: number; weaponId: number }) => {
    return csgoResolver.resolveSkinByKey(params.paintIndex, params.weaponId);
  });

  // ── Autocomplete: search skins by name ──
  ipcMain.handle('tradeup:autocomplete', async (_e, query: string) => {
    if (!query || query.length < 1) return [];
    const skins = csgoResolver.getAllSkins();
    const q = query.toLowerCase();
    return skins
      .filter(s => s.nameZh.toLowerCase().includes(q) || s.name.toLowerCase().includes(q))
      .slice(0, 20);
  });

  // ── Auto-sub-recipe generation ──
  ipcMain.handle('recipe:auto-sub', async (_e, parentId: number) => {
    try {
      return generateSubRecipes(parentId);
    } catch (err: any) {
      return { success: false, error: err.message, subRecipes: [] };
    }
  });
}
