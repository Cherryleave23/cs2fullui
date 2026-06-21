import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/ipc-channels';
import { PriceRepo } from '../db/repositories/price.repo';

export function registerPriceIpc(): void {
  ipcMain.handle(IPC_CHANNELS.PRICE_FETCH, async (_event, marketHashNames: string[]) => {
    // Price fetching from external APIs will be implemented in Phase 7
    // For now, return empty placeholder
    return { items: [], note: '价格获取将在 Phase 7 实现' };
  });

  ipcMain.handle(IPC_CHANNELS.PRICE_GET_CACHE, async (_event, filter?: { source?: string; itemHashNames?: string[] }) => {
    try {
      const prices = PriceRepo.getCache(filter);
      return prices;
    } catch (err: any) {
      return [];
    }
  });

  ipcMain.handle(IPC_CHANNELS.PRICE_GET_HISTORY, async (_event, marketHashName: string, days?: number) => {
    try {
      return PriceRepo.getHistory(marketHashName, days ?? 30);
    } catch {
      return [];
    }
  });

  ipcMain.handle(IPC_CHANNELS.PRICE_REFRESH_ALL, async () => {
    // Will trigger price refresh in Phase 7
    return { note: '批量价格刷新将在 Phase 7 实现' };
  });

  ipcMain.handle(IPC_CHANNELS.PRICE_GET_SUMMARY, async () => {
    try {
      return PriceRepo.getSummary();
    } catch {
      return { totalCached: 0, lastUpdated: null, avgPriceAll: null };
    }
  });
}
