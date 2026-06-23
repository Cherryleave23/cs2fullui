import { dbAll, dbGet, dbRun, saveDatabase, getDatabase } from '../connection';

export interface TradeUpHistoryRow {
  id: number;
  account_id: number;
  recipe_id: number | null;
  recipe_index: number;
  input_rarity: string;
  target_rarity: string;
  avg_wear_norm: number | null;
  status: string;
  outcome_json: string | null;
  started_at: string | null;
  completed_at: string | null;
  error_message: string | null;
  created_at: string;
}

export interface TradeUpInputItemRow {
  id: number;
  tradeup_id: number;
  asset_id: string;
  paint_index: number;
  weapon_id: number;
  wear_float: number;
  item_name: string;
  rarity_name: string;
}

export interface TradeUpOutcomeItemRow {
  id: number;
  tradeup_id: number;
  asset_id: string;
  item_name: string;
  paint_index: number | null;
  wear_float: number | null;
  rarity_name: string | null;
  wear_category: string | null;
  collection_name: string | null;
}

export const TradeUpRepo = {
  /** Create a new trade-up history entry */
  create(params: {
    accountId: number;
    recipeId?: number | null;
    recipeIndex: number;
    inputRarity: string;
    targetRarity: string;
    avgWearNorm?: number | null;
    status?: string;
    totalCost?: number | null;
    totalProfit?: number | null;
    roi?: number | null;
  }): number {
    dbRun(
      `INSERT INTO tradeup_history (account_id, recipe_id, recipe_index, input_rarity, target_rarity, avg_wear_norm, total_cost, total_profit, roi, status, started_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      [
        params.accountId, params.recipeId ?? null, params.recipeIndex,
        params.inputRarity, params.targetRarity,
        params.avgWearNorm ?? null,
        params.totalCost ?? null, params.totalProfit ?? null, params.roi ?? null,
        params.status ?? 'pending',
      ]
    );
    saveDatabase();
    return (dbGet<{ id: number }>('SELECT last_insert_rowid() as id'))?.id ?? 0;
  },

  /** Get trade-up history with pagination */
  getHistory(page = 1, pageSize = 20): { items: TradeUpHistoryRow[]; total: number } {
    const total = (dbGet<{ cnt: number }>('SELECT COUNT(*) as cnt FROM tradeup_history'))?.cnt ?? 0;
    const offset = (page - 1) * pageSize;
    const items = dbAll<TradeUpHistoryRow>(
      'SELECT * FROM tradeup_history ORDER BY created_at DESC LIMIT ? OFFSET ?',
      [pageSize, offset]
    );
    return { items, total };
  },

  /** Get a single trade-up by ID */
  getById(id: number): TradeUpHistoryRow | null {
    return dbGet<TradeUpHistoryRow>('SELECT * FROM tradeup_history WHERE id = ?', [id]);
  },

  /** Add input items to a trade-up */
  addInputItems(tradeupId: number, items: Omit<TradeUpInputItemRow, 'id' | 'tradeup_id'>[]): void {
    const stmt = getDatabase().prepare(
      `INSERT INTO tradeup_input_items (tradeup_id, asset_id, paint_index, weapon_id, wear_float, item_name, rarity_name)
      VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    for (const item of items) {
      stmt.run([tradeupId, item.asset_id, item.paint_index, item.weapon_id, item.wear_float, item.item_name, item.rarity_name]);
    }
    stmt.free();
    saveDatabase();
  },

  /** Add outcome items to a trade-up */
  addOutcomeItems(tradeupId: number, items: Omit<TradeUpOutcomeItemRow, 'id' | 'tradeup_id'>[]): void {
    const stmt = getDatabase().prepare(
      `INSERT INTO tradeup_outcome_items (tradeup_id, asset_id, item_name, paint_index, wear_float, rarity_name, wear_category, collection_name)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const item of items) {
      stmt.run([tradeupId, item.asset_id, item.item_name, item.paint_index ?? null, item.wear_float ?? null, item.rarity_name ?? null, item.wear_category ?? null, item.collection_name ?? null]);
    }
    stmt.free();
    saveDatabase();
  },

  /** Update trade-up status (e.g., after execution completes) */
  updateStatus(id: number, status: string, errorMessage?: string): void {
    if (status === 'completed') {
      dbRun(
        `UPDATE tradeup_history SET status = ?, completed_at = datetime('now'), error_message = ? WHERE id = ?`,
        [status, errorMessage ?? null, id]
      );
    } else if (status === 'failed') {
      dbRun(
        `UPDATE tradeup_history SET status = ?, error_message = ?, completed_at = datetime('now') WHERE id = ?`,
        [status, errorMessage ?? null, id]
      );
    } else {
      dbRun('UPDATE tradeup_history SET status = ? WHERE id = ?', [status, id]);
    }
    saveDatabase();
  },

  /** Set outcome JSON on a trade-up */
  setOutcome(id: number, outcomeJson: string): void {
    dbRun('UPDATE tradeup_history SET outcome_json = ? WHERE id = ?', [outcomeJson, id]);
    saveDatabase();
  },

  /** Get input items for a trade-up */
  getInputItems(tradeupId: number): TradeUpInputItemRow[] {
    return dbAll<TradeUpInputItemRow>(
      'SELECT * FROM tradeup_input_items WHERE tradeup_id = ?',
      [tradeupId]
    );
  },

  /** Get outcome items for a trade-up */
  getOutcomeItems(tradeupId: number): TradeUpOutcomeItemRow[] {
    return dbAll<TradeUpOutcomeItemRow>(
      'SELECT * FROM tradeup_outcome_items WHERE tradeup_id = ?',
      [tradeupId]
    );
  },

  /** Delete a trade-up and its items */
  delete(id: number): void {
    dbRun('DELETE FROM tradeup_outcome_items WHERE tradeup_id = ?', [id]);
    dbRun('DELETE FROM tradeup_input_items WHERE tradeup_id = ?', [id]);
    dbRun('DELETE FROM tradeup_history WHERE id = ?', [id]);
    saveDatabase();
  },

  /** Get trade-up stats for dashboard */
  getStats(): { total: number; completed: number; failed: number; pending: number } {
    const byStatus = dbAll<{ status: string; cnt: number }>(
      'SELECT status, COUNT(*) as cnt FROM tradeup_history GROUP BY status'
    );
    const map = Object.fromEntries(byStatus.map(r => [r.status, r.cnt]));
    return {
      total: Object.values(map).reduce((a, b) => a + b, 0),
      completed: map.completed ?? 0,
      failed: map.failed ?? 0,
      pending: map.pending ?? 0,
    };
  },
};
