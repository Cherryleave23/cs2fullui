import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/ipc-channels';
import { InventoryRepo } from '../db/repositories/inventory.repo';
import type { SteamBotService } from '../services/steam-bot.service';
import type { ResolvedItem } from '../../shared/types/item';

export function registerInventoryIpc(botGetter: () => SteamBotService | null): void {
  // ── Get items ──
  ipcMain.handle(IPC_CHANNELS.INVENTORY_GET_ITEMS, async (_event, filter?: {
    rarity?: number;
    resolvedType?: string;
    weaponType?: string;
    collectionName?: string;
    isStatTrak?: boolean;
    isSouvenir?: boolean;
  }) => {
    try {
      const items = InventoryRepo.getAllItems(filter);
      const stats = InventoryRepo.getStats();
      return { items, total: stats.totalItems, stats };
    } catch (err: any) {
      return { items: [], total: 0, stats: { totalItems: 0, byRarity: {}, byType: {} }, error: err.message };
    }
  });

  // ── Refresh inventory from GC ──
  ipcMain.handle(IPC_CHANNELS.INVENTORY_REFRESH, async () => {
    try {
      const bot = botGetter();
      if (!bot || !bot.isGCReady()) {
        return { success: false, error: 'GC 未连接' };
      }

      const csgo = bot.csgo;
      const rawItems = csgo.inventory || [];

      InventoryRepo.clearAll();
      for (const item of rawItems) {
        // Basic resolution without CsgoResolver (full resolver in Phase 4)
        const resolved: Partial<ResolvedItem> = {
          assetId: String(item.id),
          defIndex: item.def_index ?? 0,
          paintIndex: item.paint_index ?? 0,
          paintSeed: item.paint_seed ?? 0,
          paintWear: item.paint_wear ?? 0,
          rarity: item.rarity ?? 0,
          quality: item.quality ?? 4,
          origin: item.origin ?? 0,
          customName: item.custom_name ?? '',
          killEaterValue: item.kill_eater_value ?? 0,
          killEaterScoreType: item.kill_eater_score_type ?? 0,
          casketId: item.casket_id ?? '',
          tradableAfter: item.tradable_after?.toISOString() ?? '',
          isStatTrak: (item.quality ?? 4) === 9,
          isSouvenir: (item.quality ?? 4) === 12,
          position: (item as any).position ?? 0,
          inUse: item.in_use ?? false,
          resolvedType: 'unknown',
          resolvedName: `Item ${item.def_index}`,
          resolvedNameZh: `物品 ${item.def_index}`,
          marketHashName: '',
          weaponType: '',
          collectionName: '',
          imageUrl: '',
          rarityName: '',
          rarityNameZh: '',
          rarityColor: '#b0c4d8',
          wearCategory: '',
          wearCategoryZh: '',
          minFloat: 0,
          maxFloat: 1,
          extraJson: '',
        };
        InventoryRepo.upsertItem(resolved as ResolvedItem);
      }

      return { success: true, count: rawItems.length };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // ── Inspect single item via GC ──
  ipcMain.handle(IPC_CHANNELS.INVENTORY_INSPECT_ITEM, async (_event, assetId: string, mode?: string) => {
    try {
      const bot = botGetter();
      if (!bot || !bot.isGCReady()) {
        return { error: 'GC 未连接' };
      }

      // Find item in inventory to get owner info
      const csgo = bot.csgo;
      const item = csgo.inventory.find((i: any) => String(i.id) === String(assetId));
      if (!item) {
        return { error: '物品未在库存中找到' };
      }

      return new Promise((resolve) => {
        const timeout = setTimeout(() => {
          resolve({ error: '检视超时 (10秒)' });
        }, 10000);

        csgo.once('inspectItemInfo', (inspectResult: any) => {
          clearTimeout(timeout);
          resolve({
            paintWear: inspectResult.paintwear,
            paintIndex: inspectResult.paintindex,
            paintSeed: inspectResult.paintseed,
            stickers: inspectResult.stickers || [],
            keychains: inspectResult.keychains || [],
          });
        });

        // Use individual params form
        try {
          csgo.inspectItem(
            bot.getClient().steamID?.getSteamID64() || bot.getStatus().steamId,
            assetId,
            String(item.def_index)
          );
        } catch (err: any) {
          clearTimeout(timeout);
          resolve({ error: err.message });
        }
      });
    } catch (err: any) {
      return { error: err.message };
    }
  });

  // ── Export inventory ──
  ipcMain.handle(IPC_CHANNELS.INVENTORY_EXPORT, async () => {
    try {
      const items = InventoryRepo.getAllItems();
      const exportData = JSON.stringify(items, null, 2);
      return exportData;
    } catch (err: any) {
      return '[]';
    }
  });

  // ── Get stats ──
  ipcMain.handle(IPC_CHANNELS.INVENTORY_GET_STATS, async () => {
    return InventoryRepo.getStats();
  });
}
