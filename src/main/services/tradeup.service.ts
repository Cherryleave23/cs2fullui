import { SteamBotService } from './steam-bot.service';
import { TradeUpRepo } from '../db/repositories/tradeup.repo';
import { InventoryRepo } from '../db/repositories/inventory.repo';
import type { ResolvedItem } from '../../shared/types/item';

// Rarity → recipe index mapping
const RARITY_TO_RECIPE: Record<string, number> = {
  'Consumer': 0, '消费级': 0,
  'Industrial': 1, '工业级': 1,
  'Mil-Spec': 2, '军规级': 2,
  'Restricted': 3, '受限级': 3,
  'Classified': 4, '保密级': 4,
};

const STATTRAK_OFFSET = 10; // StatTrak recipes = base + 10
const TRADEUP_TIMEOUT = 15000; // 15 seconds timeout for GC response

export interface TradeUpInput {
  /** The 10 asset IDs to use in this trade-up */
  assetIds: string[];
}

export interface TradeUpResult {
  success: boolean;
  /** The recipe index that was used (for debugging) */
  recipeUsed: number;
  /** If success, the gained item IDs */
  gainedItemIds?: string[];
  /** If success, resolved details of gained items */
  gainedItems?: ResolvedItem[];
  /** If failed, error message */
  error?: string;
  /** Trade-up history record ID (stored in DB) */
  historyId?: number;
}

/**
 * Execute a CS2 trade-up contract with 10 items of the same rarity.
 *
 * This function:
 * 1. Validates the 10 input items exist and share the same rarity
 * 2. Determines the correct recipe index
 * 3. Sends the craft command to the CS2 Game Coordinator
 * 4. Waits for the result (with timeout)
 * 5. Saves the result to trade-up history
 *
 * Can be called repeatedly — each call executes one trade-up contract.
 */
export async function executeTradeUp(
  bot: SteamBotService,
  input: TradeUpInput
): Promise<TradeUpResult> {
  if (!bot.isGCReady()) {
    return { success: false, recipeUsed: -1, error: 'GC 未连接，请先登录 Steam 并等待 CS2 连接' };
  }

  // ── 1. Validate count ──
  if (input.assetIds.length !== 10) {
    return {
      success: false,
      recipeUsed: -1,
      error: `需要恰好 10 件物品，当前提供了 ${input.assetIds.length} 件`,
    };
  }

  // ── 2. Find items in inventory ──
  const csgo = bot.csgo;
  const rawItems = input.assetIds
    .map(id => csgo.inventory.find((i: any) => String(i.id) === String(id)))
    .filter(Boolean);

  if (rawItems.length !== 10) {
    const missing = input.assetIds.filter(
      id => !csgo.inventory.find((i: any) => String(i.id) === String(id))
    );
    return {
      success: false,
      recipeUsed: -1,
      error: `${missing.length} 件物品未在库存中找到: ${missing.slice(0, 3).join(', ')}...`,
    };
  }

  // ── 3. Resolve and validate rarity ──
  const resolvedItems: ResolvedItem[] = [];
  for (const item of rawItems) {
    const cached = InventoryRepo.getByAssetId(String(item.id));
    if (cached) {
      resolvedItems.push(cached);
    } else {
      return {
        success: false,
        recipeUsed: -1,
        error: `物品 ${item.id} 尚未解析，请先刷新库存`,
      };
    }
  }

  const rarities = [...new Set(resolvedItems.map(i => i.rarityName))];
  if (rarities.length > 1) {
    return {
      success: false,
      recipeUsed: -1,
      error: `所有物品必须同稀有度，当前包含: ${rarities.join(', ')}`,
    };
  }

  // ── 4. Determine recipe index ──
  const rarityName = rarities[0];
  const isStatTrak = resolvedItems.every(i => i.isStatTrak);
  let recipe = RARITY_TO_RECIPE[rarityName] ?? RARITY_TO_RECIPE[rarityName.split(' ')[0]];

  if (recipe === undefined) {
    return { success: false, recipeUsed: -1, error: `无法为稀有度 "${rarityName}" 确定汰换配方` };
  }

  if (isStatTrak) {
    recipe += STATTRAK_OFFSET;
  }

  // ── 5. Calculate avg wear norm ──
  let avgWearNorm = 0;
  if (resolvedItems.every(i => i.paintWear != null)) {
    const norms = resolvedItems.map(i => {
      const min = i.minFloat ?? 0;
      const max = i.maxFloat ?? 1;
      return Math.max(0, Math.min(1, ((i.paintWear ?? 0) - min) / (max - min || 0.001)));
    });
    avgWearNorm = norms.reduce((a, b) => a + b, 0) / norms.length;
  }

  // ── 6. Save to history (pending) ──
  const historyId = TradeUpRepo.create({
    accountId: 1, // TODO: get actual account ID
    recipeIndex: recipe,
    inputRarity: rarityName,
    targetRarity: getNextRarityName(rarityName),
    avgWearNorm,
    status: 'executing',
  });

  // Record input items
  TradeUpRepo.addInputItems(historyId, resolvedItems.map(i => ({
    asset_id: i.assetId,
    paint_index: i.paintIndex,
    weapon_id: i.defIndex,
    wear_float: i.paintWear,
    item_name: i.resolvedName,
    rarity_name: i.rarityName,
  })));

  // ── 7. Execute via GC ──
  return new Promise((resolve) => {
    let settled = false;

    const settle = (result: TradeUpResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(result);
    };

    // Timeout handler
    const timeout = setTimeout(() => {
      TradeUpRepo.updateStatus(historyId, 'failed', 'GC 响应超时 (15秒)');
      settle({ success: false, recipeUsed: recipe, historyId, error: 'GC 响应超时 (15秒)' });
    }, TRADEUP_TIMEOUT);

    // Craft completion handler
    const craftHandler = (craftRecipe: number, itemsGained: any[]) => {
      if (craftRecipe !== recipe) return; // Not our craft

      if (craftRecipe === -1) {
        TradeUpRepo.updateStatus(historyId, 'failed', 'GC 拒绝了汰换请求 (recipe=-1)');
        settle({
          success: false,
          recipeUsed: recipe,
          historyId,
          error: 'GC 拒绝了汰换请求，请检查物品稀有度是否一致或物品是否可交易',
        });
        return;
      }

      // Success — resolve gained items
      const gainedItemIds = itemsGained.map(i => String(i.id ?? i));
      const gainedItems: ResolvedItem[] = [];

      for (const id of gainedItemIds) {
        const cached = InventoryRepo.getByAssetId(id);
        if (cached) gainedItems.push(cached);
      }

      // Record outcome
      const outcomeItems = gainedItems.map(gi => ({
        asset_id: gi.assetId,
        item_name: gi.resolvedName,
        paint_index: gi.paintIndex,
        wear_float: gi.paintWear,
        rarity_name: gi.rarityName,
        wear_category: gi.wearCategory,
        collection_name: gi.collectionName,
      }));
      TradeUpRepo.addOutcomeItems(historyId, outcomeItems);
      TradeUpRepo.setOutcome(historyId, JSON.stringify(gainedItems.map(i => i.resolvedName)));
      TradeUpRepo.updateStatus(historyId, 'completed');

      settle({
        success: true,
        recipeUsed: recipe,
        gainedItemIds,
        gainedItems,
        historyId,
      });
    };

    bot.once('craftingComplete', craftHandler);

    // Send craft command
    try {
      csgo.craft(
        rawItems.map(i => i.id!),
        recipe
      );
      console.log(`[TradeUp] Craft sent: recipe=${recipe}, items=${input.assetIds.join(',')}`);
    } catch (err: any) {
      clearTimeout(timeout);
      bot.removeListener('craftingComplete', craftHandler);
      TradeUpRepo.updateStatus(historyId, 'failed', err.message);
      settle({ success: false, recipeUsed: recipe, historyId, error: err.message });
    }
  });
}

function getNextRarityName(rarity: string): string {
  const order = ['消费级', '工业级', '军规级', '受限级', '保密级', '隐秘级'];
  const idx = order.indexOf(rarity);
  return idx >= 0 && idx < order.length - 1 ? order[idx + 1] : '未知';
}
