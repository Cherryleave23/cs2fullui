import { dbAll, dbGet, dbRun, saveDatabase } from '../connection';

export interface PriceCacheRow {
  id: number;
  item_hash_name: string;
  source: string;
  current_price: number | null;
  lowest_price: number | null;
  median_price: number | null;
  volume_24h: number | null;
  currency: string;
  last_fetched_at: string | null;
  data_json: string | null;
  created_at: string;
  updated_at: string;
}

export interface PriceHistoryRow {
  id: number;
  item_hash_name: string;
  source: string;
  price: number;
  volume: number | null;
  recorded_at: string;
}

export const PriceRepo = {
  /** Upsert price data into cache */
  upsertPrice(params: {
    itemHashName: string;
    source: string;
    currentPrice?: number | null;
    lowestPrice?: number | null;
    medianPrice?: number | null;
    volume24h?: number | null;
    currency?: string;
    dataJson?: string | null;
  }): void {
    dbRun(
      `INSERT INTO price_cache (item_hash_name, source, current_price, lowest_price, median_price, volume_24h, currency, last_fetched_at, data_json, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), ?, datetime('now'))
      ON CONFLICT(item_hash_name) DO UPDATE SET
        source = excluded.source,
        current_price = excluded.current_price,
        lowest_price = excluded.lowest_price,
        median_price = excluded.median_price,
        volume_24h = excluded.volume_24h,
        currency = excluded.currency,
        last_fetched_at = excluded.last_fetched_at,
        data_json = excluded.data_json,
        updated_at = excluded.updated_at`,
      [
        params.itemHashName,
        params.source,
        params.currentPrice ?? null,
        params.lowestPrice ?? null,
        params.medianPrice ?? null,
        params.volume24h ?? null,
        params.currency ?? 'CNY',
        params.dataJson ?? null,
      ]
    );
  },

  /** Record a price history point */
  recordHistory(params: {
    itemHashName: string;
    source: string;
    price: number;
    volume?: number | null;
  }): void {
    dbRun(
      'INSERT INTO price_history (item_hash_name, source, price, volume, recorded_at) VALUES (?, ?, ?, ?, datetime(\'now\'))',
      [params.itemHashName, params.source, params.price, params.volume ?? null]
    );
  },

  /** Batch upsert prices + record history */
  batchUpsert(prices: Array<{
    itemHashName: string;
    source: string;
    currentPrice?: number | null;
    lowestPrice?: number | null;
    medianPrice?: number | null;
    volume24h?: number | null;
  }>): void {
    const db = require('../connection').getDatabase();
    db.run('BEGIN TRANSACTION');
    try {
      for (const p of prices) {
        PriceRepo.upsertPrice(p);
        if (p.currentPrice != null) {
          PriceRepo.recordHistory({
            itemHashName: p.itemHashName,
            source: p.source,
            price: p.currentPrice,
            volume: p.volume24h,
          });
        }
      }
      db.run('COMMIT');
      saveDatabase();
    } catch (err) {
      db.run('ROLLBACK');
      throw err;
    }
  },

  /** Get cached prices, optionally filtered by source and age */
  getCache(filter?: {
    source?: string;
    olderThanMinutes?: number;
    itemHashNames?: string[];
  }): PriceCacheRow[] {
    let sql = 'SELECT * FROM price_cache WHERE 1=1';
    const params: unknown[] = [];

    if (filter?.source) {
      sql += ' AND source = ?';
      params.push(filter.source);
    }
    if (filter?.olderThanMinutes) {
      sql += ` AND (last_fetched_at IS NULL OR last_fetched_at < datetime('now', '-' || ? || ' minutes'))`;
      params.push(filter.olderThanMinutes);
    }
    if (filter?.itemHashNames && filter.itemHashNames.length > 0) {
      sql += ` AND item_hash_name IN (${filter.itemHashNames.map(() => '?').join(',')})`;
      params.push(...filter.itemHashNames);
    }

    sql += ' ORDER BY updated_at DESC';
    return dbAll<PriceCacheRow>(sql, params);
  },

  /** Get price history for a specific item */
  getHistory(itemHashName: string, days = 30): PriceHistoryRow[] {
    return dbAll<PriceHistoryRow>(
      `SELECT * FROM price_history
      WHERE item_hash_name = ? AND recorded_at >= datetime('now', '-' || ? || ' days')
      ORDER BY recorded_at`,
      [itemHashName, days]
    );
  },

  /** Clear price cache */
  clearCache(source?: string): void {
    if (source) {
      dbRun('DELETE FROM price_cache WHERE source = ?', [source]);
    } else {
      dbRun('DELETE FROM price_cache');
    }
    saveDatabase();
  },

  /** Get a summary of latest prices */
  getSummary(): {
    totalCached: number;
    lastUpdated: string | null;
    avgPriceAll: number | null;
  } {
    const total = (dbGet<{ cnt: number }>('SELECT COUNT(*) as cnt FROM price_cache'))?.cnt ?? 0;
    const lastUpdated = (dbGet<{ ts: string }>('SELECT MAX(updated_at) as ts FROM price_cache'))?.ts ?? null;
    const avgPrice = (dbGet<{ avg: number }>('SELECT AVG(current_price) as avg FROM price_cache WHERE current_price IS NOT NULL'))?.avg ?? null;
    return { totalCached: total, lastUpdated, avgPriceAll: avgPrice };
  },
};
