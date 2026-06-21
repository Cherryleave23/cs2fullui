import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/ipc-channels';
import { RecipeRepo } from '../db/repositories/recipe.repo';

export function registerRecipeIpc(): void {
  ipcMain.handle(IPC_CHANNELS.RECIPE_LIST, async () => {
    return RecipeRepo.list();
  });

  ipcMain.handle(IPC_CHANNELS.RECIPE_GET, async (_event, id: number) => {
    const recipe = RecipeRepo.getById(id);
    if (!recipe) return null;
    return { ...recipe, items: RecipeRepo.getItems(id) };
  });

  ipcMain.handle(IPC_CHANNELS.RECIPE_SAVE, async (_event, recipe: any) => {
    try {
      const saved = RecipeRepo.create(recipe);
      return { ...saved, items: RecipeRepo.getItems(saved.id) };
    } catch (err: any) {
      return { error: err.message };
    }
  });

  ipcMain.handle(IPC_CHANNELS.RECIPE_DELETE, async (_event, id: number) => {
    RecipeRepo.delete(id);
    return { success: true };
  });

  ipcMain.handle(IPC_CHANNELS.RECIPE_EXPORT, async (_event, id: number) => {
    const data = RecipeRepo.exportJson(id);
    return data ? JSON.stringify(data, null, 2) : null;
  });

  ipcMain.handle(IPC_CHANNELS.RECIPE_IMPORT, async (_event, json: string) => {
    try {
      const data = JSON.parse(json);
      if (!data.version || !data.name || !data.rarity || !data.targetRarity || !Array.isArray(data.items)) {
        return { error: '无效的配方格式' };
      }
      const saved = RecipeRepo.create({
        name: data.name,
        description: data.description,
        rarity: data.rarity,
        targetRarity: data.targetRarity,
        isStatTrak: data.isStatTrak ?? false,
        avgWearNorm: data.avgWearNorm ?? null,
        outcomeSummary: data.simulation ? JSON.stringify(data.simulation) : null,
        items: data.items.map((i: any, idx: number) => ({
          paint_index: i.paintIndex,
          weapon_id: i.weaponId,
          wear_float: i.wearFloat,
          asset_id: i.assetId ?? null,
          stattrak: i.statTrak ? 1 : 0,
          souvenir: i.souvenir ? 1 : 0,
          position: i.position ?? idx,
        })),
      });
      return { ...saved, items: RecipeRepo.getItems(saved.id) };
    } catch (err: any) {
      return { error: err.message };
    }
  });
}
