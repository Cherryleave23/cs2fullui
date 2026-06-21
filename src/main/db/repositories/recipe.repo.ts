import { dbAll, dbGet, dbRun, saveDatabase } from '../connection';

export interface RecipeRow {
  id: number;
  name: string;
  description: string | null;
  type: string;
  rarity: string;
  target_rarity: string;
  is_stattrak: number;
  avg_wear_norm: number | null;
  outcome_summary: string | null;
  tags: string | null;
  created_at: string;
  updated_at: string;
}

export interface RecipeItemRow {
  id: number;
  recipe_id: number;
  paint_index: number;
  weapon_id: number;
  wear_float: number;
  asset_id: string | null;
  stattrak: number;
  souvenir: number;
  position: number;
}

export const RecipeRepo = {
  /** List all recipes */
  list(): RecipeRow[] {
    return dbAll<RecipeRow>('SELECT * FROM recipes ORDER BY updated_at DESC');
  },

  /** Get a single recipe */
  getById(id: number): RecipeRow | null {
    return dbGet<RecipeRow>('SELECT * FROM recipes WHERE id = ?', [id]);
  },

  /** Create a recipe and its items */
  create(params: {
    name: string;
    description?: string | null;
    type?: string;
    rarity: string;
    targetRarity: string;
    isStatTrak?: boolean;
    avgWearNorm?: number | null;
    outcomeSummary?: string | null;
    tags?: string[] | null;
    items: Omit<RecipeItemRow, 'id' | 'recipe_id'>[];
  }): RecipeRow {
    dbRun(
      `INSERT INTO recipes (name, description, type, rarity, target_rarity, is_stattrak, avg_wear_norm, outcome_summary, tags)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        params.name,
        params.description ?? null,
        params.type ?? 'virtual',
        params.rarity,
        params.targetRarity,
        params.isStatTrak ? 1 : 0,
        params.avgWearNorm ?? null,
        params.outcomeSummary ?? null,
        params.tags ? JSON.stringify(params.tags) : null,
      ]
    );
    const recipeId = (dbGet<{ id: number }>('SELECT last_insert_rowid() as id'))?.id ?? 0;

    if (params.items.length > 0) {
      const stmt = require('../connection').getDatabase().prepare(
        `INSERT INTO recipe_items (recipe_id, paint_index, weapon_id, wear_float, asset_id, stattrak, souvenir, position)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const item of params.items) {
        stmt.run([recipeId, item.paint_index, item.weapon_id, item.wear_float, item.asset_id ?? null, item.stattrak, item.souvenir, item.position]);
      }
      stmt.free();
    }

    saveDatabase();
    return this.getById(recipeId)!;
  },

  /** Update a recipe */
  update(id: number, params: {
    name?: string;
    description?: string | null;
    avgWearNorm?: number | null;
    outcomeSummary?: string | null;
    tags?: string[] | null;
  }): void {
    const sets: string[] = [];
    const values: unknown[] = [];

    if (params.name !== undefined) { sets.push('name = ?'); values.push(params.name); }
    if (params.description !== undefined) { sets.push('description = ?'); values.push(params.description); }
    if (params.avgWearNorm !== undefined) { sets.push('avg_wear_norm = ?'); values.push(params.avgWearNorm); }
    if (params.outcomeSummary !== undefined) { sets.push('outcome_summary = ?'); values.push(params.outcomeSummary); }
    if (params.tags !== undefined) { sets.push('tags = ?'); values.push(JSON.stringify(params.tags)); }

    if (sets.length > 0) {
      sets.push(`updated_at = datetime('now')`);
      values.push(id);
      dbRun(`UPDATE recipes SET ${sets.join(', ')} WHERE id = ?`, values);
      saveDatabase();
    }
  },

  /** Delete a recipe (cascade deletes items) */
  delete(id: number): void {
    dbRun('DELETE FROM recipe_items WHERE recipe_id = ?', [id]);
    dbRun('DELETE FROM recipes WHERE id = ?', [id]);
    saveDatabase();
  },

  /** Get items for a recipe */
  getItems(recipeId: number): RecipeItemRow[] {
    return dbAll<RecipeItemRow>(
      'SELECT * FROM recipe_items WHERE recipe_id = ? ORDER BY position',
      [recipeId]
    );
  },

  /** Export a recipe as JSON (for sharing) */
  exportJson(id: number): object | null {
    const recipe = this.getById(id);
    if (!recipe) return null;
    const items = this.getItems(id);
    return {
      version: 1,
      name: recipe.name,
      description: recipe.description,
      rarity: recipe.rarity,
      targetRarity: recipe.target_rarity,
      isStatTrak: recipe.is_stattrak === 1,
      avgWearNorm: recipe.avg_wear_norm,
      createdAt: recipe.created_at,
      items: items.map(i => ({
        paintIndex: i.paint_index,
        weaponId: i.weapon_id,
        wearFloat: i.wear_float,
        assetId: i.asset_id,
        statTrak: i.stattrak === 1,
        souvenir: i.souvenir === 1,
        position: i.position,
      })),
      simulation: recipe.outcome_summary ? JSON.parse(recipe.outcome_summary) : null,
    };
  },
};
