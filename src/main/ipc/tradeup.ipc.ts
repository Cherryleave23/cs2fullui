import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/ipc-channels';
import { executeTradeUp } from '../services/tradeup.service';
import { simulateTradeUp } from '../services/tradeup-simulator';
import { TradeUpRepo } from '../db/repositories/tradeup.repo';
import { InventoryRepo } from '../db/repositories/inventory.repo';
import { PriceRepo } from '../db/repositories/price.repo';
import { csqaService } from '../services/csqa.service';
import { csgoResolver } from '../services/csgoapi-resolver.service';
import { getWearCategory } from '../db/seed';
import type { SteamBotService } from '../services/steam-bot.service';

/** 计算收益数据：总成本、EV、ROI、保本率 */
function calcProfit(inputs: { marketHashName?: string; price?: number }[], outcomes: { marketHashName?: string; probability: number }[]) {
  // 从 PriceRepo 获取输入物品价格
  let totalCost = 0;
  for (const inp of inputs) {
    if (inp.price != null) {
      totalCost += inp.price;
    } else if (inp.marketHashName) {
      const cached = PriceRepo.getCache({ itemHashNames: [inp.marketHashName] });
      const p = cached?.[0]?.current_price;
      if (p != null) totalCost += p;
    }
  }

  // 计算 EV（从 PriceRepo 获取产出物价格）
  let ev = 0;
  for (const out of outcomes) {
    if (!out.marketHashName || !out.probability) continue;
    const cached = PriceRepo.getCache({ itemHashNames: [out.marketHashName] });
    const price = cached?.[0]?.current_price;
    if (price != null) {
      ev += price * out.probability;
    }
  }

  if (totalCost <= 0) return null;

  // 保本率：产出物中 price >= totalCost 的概率之和
  let breakEvenProb = 0;
  for (const out of outcomes) {
    if (!out.marketHashName || !out.probability) continue;
    const cached = PriceRepo.getCache({ itemHashNames: [out.marketHashName] });
    const price = cached?.[0]?.current_price;
    if (price != null && price >= totalCost) {
      breakEvenProb += out.probability;
    }
  }

  return {
    totalCost: Math.round(totalCost * 100) / 100,
    expectedValue: Math.round(ev * 100) / 100,
    profit: Math.round((ev - totalCost) * 100) / 100,
    roi: totalCost > 0 ? Math.round((ev - totalCost) / totalCost * 10000) / 100 : 0,
    breakEvenRate: Math.round(breakEvenProb * 10000) / 100,
  };
}

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
      // Resolve marketHashName for price lookup (renderer sends paintIndex+weaponId+wear but not mhn)
      const stripWear = (s: string) => s.replace(/\s*[（(][^)）]*[)）]\s*$/g, '');
      const inputs = simItems.map((i: any) => {
        const skin = csgoResolver.resolveSkinByKey(i.paintIndex ?? 0, i.defIndex ?? 0);
        const wearFloat = i.paintWear ?? i.wearFloat ?? 0;
        const wear = getWearCategory(wearFloat);
        const mhn = skin?.marketHashName
          ? stripWear(skin.marketHashName) + ' (' + wear.name + ')'
          : '';
        return {
          assetId: i.assetId || '',
          name: i.resolvedName || i.name || 'Unknown',
          nameZh: i.resolvedNameZh || i.nameZh,
          rarity: i.rarityName || i.rarity || 'Unknown',
          rarityZh: i.rarityNameZh || i.rarityZh,
          paintIndex: i.paintIndex ?? 0,
          defIndex: i.defIndex ?? 0,
          wearFloat,
          minFloat: i.minFloat ?? 0,
          maxFloat: i.maxFloat ?? 1,
          collection: i.collectionName || i.collection || '未知',
          weaponType: i.weaponType,
          isStatTrak: i.isStatTrak || i.is_stattrak || false,
          isSouvenir: i.isSouvenir || i.is_souvenir || false,
          marketHashName: mhn,
        };
      });

      const result = simulateTradeUp(inputs);

      // 自动补价：收集缺失价格，按需拉取
      if (result.success) {
        const needFetch = new Set<string>();
        // 输入物品
        for (const inp of inputs) {
          const mhn = (inp as any).marketHashName || '';
          if (!mhn) continue;
          const cached = PriceRepo.getCache({ itemHashNames: [mhn] });
          if (!cached?.[0]?.current_price) needFetch.add(mhn);
        }
        // 产出物
        for (const out of result.outcomes) {
          const mhn = (out as any).marketHashName || '';
          if (!mhn) continue;
          const cached = PriceRepo.getCache({ itemHashNames: [mhn] });
          if (!cached?.[0]?.current_price) needFetch.add(mhn);
        }
        // 拉取缺失价格
        if (needFetch.size > 0) {
          await csqaService.fetch([...needFetch]);
        }

        // Attach prices to outcomes
        for (const out of result.outcomes) {
          const mhn = (out as any).marketHashName || '';
          if (mhn) {
            const cached = PriceRepo.getCache({ itemHashNames: [mhn] });
            (out as any).price = cached?.[0]?.current_price ?? null;
          }
        }

        // Build input price map (keyed by assetId for renderer matching)
        const inputPrices: Record<string, number> = {};
        for (const inp of inputs) {
          const mhn = (inp as any).marketHashName || '';
          const assetId = (inp as any).assetId || '';
          if (mhn) {
            const cached = PriceRepo.getCache({ itemHashNames: [mhn] });
            if (cached?.[0]?.current_price != null) {
              inputPrices[assetId || mhn] = cached[0].current_price;
            }
          }
        }

        const profit = calcProfit(inputs as any, result.outcomes.map(o => ({
          marketHashName: (o as any).marketHashName || '',
          probability: o.probability,
        })));
        (result as any).profit = profit;
        (result as any).inputPrices = inputPrices;
      }

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
