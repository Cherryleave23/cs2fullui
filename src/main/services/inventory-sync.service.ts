/**
 * Inventory sync service — bridges GC inventory events to local DB storage.
 *
 * Flow:
 *   connectedToGC → full sync (csgo.inventory → DB)
 *   itemAcquired  → resolve + upsert single item
 *   itemChanged   → resolve + upsert single item
 *   itemRemoved   → delete from DB
 */
import { csgoResolver } from './csgoapi-resolver.service';
import { InventoryRepo } from '../db/repositories/inventory.repo';
import type { SteamBotService } from './steam-bot.service';

export interface InventorySyncEvents {
  onSyncComplete: (count: number) => void;
  onItemUpdate: (item: any) => void;
  onItemRemove: (assetId: string) => void;
}

/**
 * Bind inventory sync to a SteamBotService instance.
 * Call this once per account after GC connects.
 */
export function bindInventorySync(
  bot: SteamBotService,
  accountId: number,
  events?: Partial<InventorySyncEvents>
): () => void {
  const resolvers: Array<() => void> = [];

  // ── Full sync on GC connect ──
  const onInventoryReady = (rawInventory: any[]) => {
    console.log(`[InvSync] Full sync: ${rawInventory.length} raw items`);

    if (!csgoResolver.load()) {
      console.warn('[InvSync] CsgoResolver data not loaded — skipping sync');
      events?.onSyncComplete?.(0);
      return;
    }

    // Resolve all items, exclude items in storage units
    const looseItems = rawInventory.filter((i: any) => !i.casket_id);
    const resolved = csgoResolver.resolveAll(looseItems);

    // Replace all items in DB
    InventoryRepo.clearAll();
    for (const item of resolved) {
      InventoryRepo.upsertItem(item);
    }

    console.log(`[InvSync] Synced ${resolved.length} resolved items to DB`);
    events?.onSyncComplete?.(resolved.length);
  };
  bot.on('inventoryReady', onInventoryReady);
  resolvers.push(() => bot.removeListener('inventoryReady', onInventoryReady));

  // ── Single item acquired ──
  const onItemAcquired = (rawItem: any) => {
    if (!csgoResolver.load()) return;
    const resolved = csgoResolver.resolveOne(rawItem);
    InventoryRepo.upsertItem(resolved);
    events?.onItemUpdate?.(resolved);
  };
  bot.on('itemAcquired', onItemAcquired);
  resolvers.push(() => bot.removeListener('itemAcquired', onItemAcquired));

  // ── Single item changed ──
  const onItemChanged = (_old: unknown, rawItem: any) => {
    if (!csgoResolver.load()) return;
    const resolved = csgoResolver.resolveOne(rawItem);
    InventoryRepo.upsertItem(resolved);
    events?.onItemUpdate?.(resolved);
  };
  bot.on('itemChanged', onItemChanged);
  resolvers.push(() => bot.removeListener('itemChanged', onItemChanged));

  // ── Single item removed ──
  const onItemRemoved = (rawItem: any) => {
    const assetId = String(rawItem.id || '');
    InventoryRepo.removeItem(assetId);
    events?.onItemRemove?.(assetId);
  };
  bot.on('itemRemoved', onItemRemoved);
  resolvers.push(() => bot.removeListener('itemRemoved', onItemRemoved));

  // Return unbind function
  return () => resolvers.forEach(fn => fn());
}
