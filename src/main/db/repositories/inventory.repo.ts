import { dbAll, dbGet, dbRun, saveDatabase, getDatabase } from '../connection';
import { AccountRepo } from './account.repo';
import type { ResolvedItem } from '../../../shared/types/item';

// DB returns snake_case; app uses camelCase
function toCamel(row: Record<string, any>): ResolvedItem {
  return {
    assetId: row.asset_id, defIndex: row.def_index,
    resolvedType: row.resolved_type, resolvedName: row.resolved_name,
    resolvedNameZh: row.resolved_name_zh,
    paintIndex: row.paint_index, paintSeed: row.paint_seed, paintWear: row.paint_wear,
    rarity: row.rarity, rarityName: row.rarity_name, rarityNameZh: row.rarity_name_zh,
    rarityColor: row.rarity_color, quality: row.quality, origin: row.origin,
    customName: row.custom_name,
    wearCategory: row.wear_category, wearCategoryZh: row.wear_category_zh,
    minFloat: row.min_float, maxFloat: row.max_float,
    marketHashName: row.market_hash_name, weaponType: row.weapon_type,
    collectionName: row.collection_name, imageUrl: row.image_url,
    killEaterValue: row.kill_eater_value, killEaterScoreType: row.kill_eater_score_type,
    casketId: row.casket_id, tradableAfter: row.tradable_after,
    position: row.position, inUse: row.in_use === 1,
    isStatTrak: row.is_stattrak === 1, isSouvenir: row.is_souvenir === 1,
    extraJson: row.extra_json,
  };
}

/** Get current active account_id (from active steam_id, default 1) */
function activeAccountId(): number {
  const a = AccountRepo.getActive();
  return a?.id ?? 1;
}

export const InventoryRepo = {
  /** Upsert a single resolved item (matched by asset_id). Uses active account by default. */
  upsertItem(item: ResolvedItem, accountId?: number): void {
    const aid = accountId ?? activeAccountId();
    dbRun(
      `INSERT INTO inventory_items (
        account_id, asset_id, def_index, paint_index, paint_seed, paint_wear,
        rarity, quality, origin, custom_name, kill_eater_value, kill_eater_score_type,
        casket_id, tradable_after, position, in_use,
        resolved_type, resolved_name, resolved_name_zh,
        rarity_name, rarity_name_zh, rarity_color,
        wear_category, wear_category_zh,
        min_float, max_float, market_hash_name, weapon_type, collection_name, image_url,
        is_stattrak, is_souvenir, extra_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(asset_id) DO UPDATE SET
        account_id = excluded.account_id,
        paint_index = excluded.paint_index,
        paint_seed = excluded.paint_seed,
        paint_wear = excluded.paint_wear,
        rarity = excluded.rarity,
        quality = excluded.quality,
        origin = excluded.origin,
        custom_name = excluded.custom_name,
        kill_eater_value = excluded.kill_eater_value,
        kill_eater_score_type = excluded.kill_eater_score_type,
        casket_id = excluded.casket_id,
        tradable_after = excluded.tradable_after,
        position = excluded.position,
        in_use = excluded.in_use,
        resolved_name = excluded.resolved_name,
        resolved_name_zh = excluded.resolved_name_zh,
        rarity_name = excluded.rarity_name,
        rarity_name_zh = excluded.rarity_name_zh,
        rarity_color = excluded.rarity_color,
        wear_category = excluded.wear_category,
        wear_category_zh = excluded.wear_category_zh,
        min_float = excluded.min_float,
        max_float = excluded.max_float,
        market_hash_name = excluded.market_hash_name,
        weapon_type = excluded.weapon_type,
        collection_name = excluded.collection_name,
        image_url = excluded.image_url,
        is_stattrak = excluded.is_stattrak,
        is_souvenir = excluded.is_souvenir,
        extra_json = excluded.extra_json`,
      [
        aid, item.assetId, item.defIndex, item.paintIndex, item.paintSeed, item.paintWear,
        item.rarity, item.quality, item.origin,
        item.customName || null,
        item.killEaterValue, item.killEaterScoreType,
        item.casketId || null, item.tradableAfter || null, item.position, item.inUse ? 1 : 0,
        item.resolvedType, item.resolvedName, item.resolvedNameZh || null,
        item.rarityName || null, item.rarityNameZh || null, item.rarityColor || null,
        item.wearCategory || null, item.wearCategoryZh || null,
        item.minFloat, item.maxFloat,
        item.marketHashName || null,
        item.weaponType || null, item.collectionName || null, item.imageUrl || null,
        item.isStatTrak ? 1 : 0, item.isSouvenir ? 1 : 0,
        item.extraJson || null,
      ]
    );
  },

  /** Bulk upsert items (wraps in transaction) */
  upsertItems(items: ResolvedItem[], accountId?: number): void {
    const db = getDatabase();
    db.run('BEGIN TRANSACTION');
    try {
      for (const item of items) {
        this.upsertItem(item, accountId);
      }
      db.run('COMMIT');
      saveDatabase();
    } catch (err) {
      db.run('ROLLBACK');
      throw err;
    }
  },

  /** Get all items for the active account, optionally filtered */
  getAllItems(filter?: {
    rarity?: number;
    resolvedType?: string;
    weaponType?: string;
    collectionName?: string;
    isStatTrak?: boolean;
    isSouvenir?: boolean;
  }, accountId?: number): ResolvedItem[] {
    const aid = accountId ?? activeAccountId();
    let sql = 'SELECT * FROM inventory_items WHERE account_id = ?';
    const params: unknown[] = [aid];

    if (filter?.rarity !== undefined) {
      sql += ' AND rarity = ?';
      params.push(filter.rarity);
    }
    if (filter?.resolvedType) {
      sql += ' AND resolved_type = ?';
      params.push(filter.resolvedType);
    }
    if (filter?.weaponType) {
      sql += ' AND weapon_type = ?';
      params.push(filter.weaponType);
    }
    if (filter?.collectionName) {
      sql += ' AND collection_name = ?';
      params.push(filter.collectionName);
    }
    if (filter?.isStatTrak) {
      sql += ' AND is_stattrak = 1';
    }
    if (filter?.isSouvenir) {
      sql += ' AND is_souvenir = 1';
    }

    sql += ' ORDER BY rarity DESC, paint_wear ASC';
    return dbAll<Record<string, any>>(sql, params).map(toCamel);
  },

  /** Get a single item by asset_id */
  getByAssetId(assetId: string): ResolvedItem | null {
    const row = dbGet<Record<string, any>>('SELECT * FROM inventory_items WHERE asset_id = ?', [assetId]);
    return row ? toCamel(row) : null;
  },

  /** Remove an item by asset_id */
  removeItem(assetId: string): void {
    dbRun('DELETE FROM inventory_items WHERE asset_id = ?', [assetId]);
    saveDatabase();
  },

  /** Clear all items for the active account */
  clearAll(accountId?: number): void {
    const aid = accountId ?? activeAccountId();
    dbRun('DELETE FROM inventory_items WHERE account_id = ?', [aid]);
    saveDatabase();
  },

  /** Clear ALL items across all accounts (used at login for full resync) */
  clearAllAccounts(): void {
    dbRun('DELETE FROM inventory_items');
    saveDatabase();
  },

  /** Get inventory statistics for active account */
  getStats(accountId?: number): {
    totalItems: number;
    byRarity: Record<string, number>;
    byType: Record<string, number>;
  } {
    const aid = accountId ?? activeAccountId();
    const total = (dbGet<{ cnt: number }>('SELECT COUNT(*) as cnt FROM inventory_items WHERE account_id = ?', [aid]))?.cnt ?? 0;
    const byRarity = dbAll<{ rarity_name: string; cnt: number }>(
      'SELECT rarity_name, COUNT(*) as cnt FROM inventory_items WHERE account_id = ? GROUP BY rarity_name ORDER BY cnt DESC', [aid]
    );
    const byType = dbAll<{ resolved_type: string; cnt: number }>(
      'SELECT resolved_type, COUNT(*) as cnt FROM inventory_items WHERE account_id = ? GROUP BY resolved_type ORDER BY cnt DESC', [aid]
    );
    return {
      totalItems: total,
      byRarity: Object.fromEntries(byRarity.map(r => [r.rarity_name, r.cnt])),
      byType: Object.fromEntries(byType.map(r => [r.resolved_type, r.cnt])),
    };
  },

  /** Get distinct weapon types in inventory */
  getWeaponTypes(accountId?: number): string[] {
    const aid = accountId ?? activeAccountId();
    return dbAll<{ weapon_type: string }>(
      'SELECT DISTINCT weapon_type FROM inventory_items WHERE weapon_type IS NOT NULL AND account_id = ? ORDER BY weapon_type', [aid]
    ).map(r => r.weapon_type);
  },

  /** Get distinct collections in inventory */
  getCollections(accountId?: number): string[] {
    const aid = accountId ?? activeAccountId();
    return dbAll<{ collection_name: string }>(
      'SELECT DISTINCT collection_name FROM inventory_items WHERE collection_name IS NOT NULL AND account_id = ? ORDER BY collection_name', [aid]
    ).map(r => r.collection_name);
  },
};
