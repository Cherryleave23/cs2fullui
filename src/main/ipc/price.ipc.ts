import { ipcMain, BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '../../shared/ipc-channels';
import { PriceRepo } from '../db/repositories/price.repo';
import { InventoryRepo } from '../db/repositories/inventory.repo';
import { SettingsRepo } from '../db/repositories/settings.repo';
import { csqaService } from '../services/csqa.service';

export function registerPriceIpc(): void {
  // 拉取指定物品的价格（可通过不同数据源）
  ipcMain.handle(IPC_CHANNELS.PRICE_FETCH, async (_event, marketHashNames: string[], source?: string) => {
    try {
      const result = await csqaService.fetch(marketHashNames);
      return { success: true, ...result };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // 获取缓存的价格数据
  ipcMain.handle(IPC_CHANNELS.PRICE_GET_CACHE, async (_event, filter?: { source?: string; itemHashNames?: string[] }) => {
    try {
      return PriceRepo.getCache(filter);
    } catch {
      return [];
    }
  });

  // 获取价格历史趋势
  ipcMain.handle(IPC_CHANNELS.PRICE_GET_HISTORY, async (_event, marketHashName: string, days?: number) => {
    try {
      return PriceRepo.getHistory(marketHashName, days ?? 30);
    } catch {
      return [];
    }
  });

  // 刷新全部库存物品的价格
  ipcMain.handle(IPC_CHANNELS.PRICE_REFRESH_ALL, async () => {
    try {
      // 从 PriceCache 中获取所有已缓存的物品名
      const cached = PriceRepo.getCache();
      const names = cached.map(c => c.item_hash_name).filter(Boolean) as string[];

      if (names.length === 0) {
        return { note: '缓存中无物品，请先导入库存', fetched: 0, failed: 0 };
      }

      const result = await csqaService.fetch(names);

      // 通知渲染进程价格已更新
      const wins = BrowserWindow.getAllWindows();
      for (const win of wins) {
        win.webContents.send(IPC_CHANNELS.PUSH_PRICE_UPDATED, {
          fetched: result.fetched,
          timestamp: new Date().toISOString(),
        });
      }

      return { ...result, note: `成功更新 ${result.fetched} 个物品价格` };
    } catch (err: any) {
      return { error: err.message, fetched: 0, failed: 0 };
    }
  });

  // 获取价格摘要统计
  ipcMain.handle(IPC_CHANNELS.PRICE_GET_SUMMARY, async () => {
    try {
      return PriceRepo.getSummary();
    } catch {
      return { totalCached: 0, lastUpdated: null, avgPriceAll: null };
    }
  });

  // ── 设置 ──
  ipcMain.handle(IPC_CHANNELS.SETTINGS_GET_CSQA_TOKEN, async () => {
    return { token: SettingsRepo.get('csqaq_api_token', '') || '' };
  });

  ipcMain.handle(IPC_CHANNELS.SETTINGS_SET_CSQA_TOKEN, async (_event, token: string) => {
    SettingsRepo.set('csqaq_api_token', token);
    return { success: true };
  });

  // 从库存拉取价格（跳过 1 小时内已更新的）
  ipcMain.handle(IPC_CHANNELS.PRICE_FETCH_INVENTORY, async () => {
    try {
      const items = InventoryRepo.getAllItems();
      console.log(`[Price] Inventory items count: ${items.length}`);
      const mhns = [...new Set(items.map(i => (i as any).marketHashName).filter(Boolean))] as string[];
      console.log(`[Price] Items with marketHashName: ${mhns.length}`);
      if (mhns.length === 0) {
        const sample = items.slice(0, 3).map(i => ({ name: (i as any).resolvedName, mhn: (i as any).marketHashName }));
        return { note: `库存无物品或缺少 marketHashName (共${items.length}件, 示例: ${JSON.stringify(sample)})`, fetched: 0 };
      }

      // 跳过 1 小时内更新的
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const cached = PriceRepo.getCache({ olderThanMinutes: 60 });
      const cachedSet = new Set(cached.map(c => c.item_hash_name));
      const needFetch = mhns.filter(n => !cachedSet.has(n));

      if (needFetch.length === 0) {
        return { note: `所有 ${mhns.length} 个物品均在 1 小时内更新过，无需拉取`, fetched: 0, skipped: mhns.length };
      }

      const result = await csqaService.fetch(needFetch);
      return { note: `从库存 ${mhns.length} 个物品中拉取了 ${result.fetched} 个`, ...result };
    } catch (err: any) {
      return { error: err.message, fetched: 0 };
    }
  });
}
