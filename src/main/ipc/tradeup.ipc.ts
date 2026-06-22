import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/ipc-channels';
import { executeTradeUp } from '../services/tradeup.service';
import { simulateTradeUp } from '../services/tradeup-simulator';
import { TradeUpRepo } from '../db/repositories/tradeup.repo';
import { InventoryRepo } from '../db/repositories/inventory.repo';
import type { SteamBotService } from '../services/steam-bot.service';

/**
 * Register trade-up IPC handlers.
 * @param botGetter Function that returns the current SteamBotService singleton
 */
export function registerTradeUpIpc(botGetter: () => SteamBotService | null): void {
  // ── Simulate a trade-up (no GC call, pure math) ──
  ipcMain.handle(IPC_CHANNELS.TRADEUP_SIMULATE, async (_event, items: any[]) => {
    try {
      if (!items || items.length !== 10) {
        return { success: false, error: '需要恰好10件物品进行模拟', outcomes: [] };
      }

      // Resolve items from DB if assetIds provided
      const simItems: any[] = [];
      for (const item of items) {
        if (typeof item === 'string') {
          const cached = InventoryRepo.getByAssetId(item);
          if (cached) simItems.push(cached);
        } else if (item.assetId) {
          const cached = InventoryRepo.getByAssetId(String(item.assetId));
          if (cached) {
            simItems.push(cached);
          } else {
            simItems.push(item); // Use as-is from renderer
          }
        } else {
          simItems.push(item);
        }
      }

      // Convert ResolvedItem → SimInputItem
      const inputs = simItems.map((i: any) => ({
        assetId: i.assetId || '',
        name: i.resolvedName || i.name || 'Unknown',
        nameZh: i.resolvedNameZh || i.nameZh,
        rarity: i.rarityName || i.rarity || 'Unknown',
        rarityZh: i.rarityNameZh || i.rarityZh,
        paintIndex: i.paintIndex ?? 0,
        defIndex: i.defIndex ?? 0,
        wearFloat: i.paintWear ?? i.wearFloat ?? 0,
        minFloat: i.minFloat ?? 0,
        maxFloat: i.maxFloat ?? 1,
        collection: i.collectionName || i.collection || '未知',
        weaponType: i.weaponType,
        isStatTrak: i.isStatTrak || i.is_stattrak || false,
        isSouvenir: i.isSouvenir || i.is_souvenir || false,
      }));

      const result = simulateTradeUp(inputs);

      return result;
    } catch (err: any) {
      return { success: false, error: err.message, outcomes: [] };
    }
  });

  // ── Execute a real trade-up via GC ──
  ipcMain.handle(IPC_CHANNELS.TRADEUP_EXECUTE, async (_event, assetIds: string[]) => {
    try {
      const bot = botGetter();
      if (!bot) {
        return { success: false, error: 'Steam 未连接，请先登录' };
      }

      const result = await executeTradeUp(bot, { assetIds });
      return result;
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // ── Get trade-up history ──
  ipcMain.handle(IPC_CHANNELS.TRADEUP_GET_HISTORY, async (_event, page?: number) => {
    try {
      const history = TradeUpRepo.getHistory(page ?? 1, 20);
      // Enrich with input/output items
      const enriched = history.items.map(h => ({
        ...h,
        inputItems: TradeUpRepo.getInputItems(h.id),
        outcomeItems: TradeUpRepo.getOutcomeItems(h.id),
      }));
      return { items: enriched, total: history.total };
    } catch (err: any) {
      return { items: [], total: 0 };
    }
  });

  // ── Get single trade-up detail ──
  ipcMain.handle(IPC_CHANNELS.TRADEUP_GET_HISTORY_ITEM, async (_event, id: number) => {
    try {
      const record = TradeUpRepo.getById(id);
      if (!record) return null;
      return {
        ...record,
        inputItems: TradeUpRepo.getInputItems(id),
        outcomeItems: TradeUpRepo.getOutcomeItems(id),
      };
    } catch {
      return null;
    }
  });
}

function getNextRarityZh(rarityName: string): string {
  const order = ['消费级', '工业级', '军规级', '受限级', '保密级', '隐秘级'];
  const idx = order.indexOf(rarityName);
  return idx >= 0 && idx < order.length - 1 ? order[idx + 1] : '未知';
}
