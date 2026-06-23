import { dbAll, dbGet, dbRun, saveDatabase, getDatabase } from '../connection';

export interface RecipeRow {
  id: number;
  parent_id: number | null;
  name: string;
  description: string | null;
  type: string;
  rarity: string;
  target_rarity: string;
  is_stattrak: number;
  avg_wear_norm: number | null;
  avg_target_wear: number | null;
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
    avgTargetWear?: number | null;
    parentId?: number | null;
    outcomeSummary?: string | null;
    profitJson?: string | null;
    tags?: string[] | null;
    items: Omit<RecipeItemRow, 'id' | 'recipe_id'>[];
  }): RecipeRow {
    dbRun(
      `INSERT INTO recipes (parent_id, name, description, type, rarity, target_rarity, is_stattrak, avg_wear_norm, avg_target_wear, outcome_summary, profit_json, tags)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        params.parentId ?? null,
        params.name,
        params.description ?? null,
        params.type ?? 'virtual',
        params.rarity,
        params.targetRarity,
        params.isStatTrak ? 1 : 0,
        params.avgWearNorm ?? null,
        params.avgTargetWear ?? null,
        params.outcomeSummary ?? null,
        params.profitJson ?? null,
        params.tags ? JSON.stringify(params.tags) : null,
      ]
    );
    const recipeId = (dbGet<{ id: number }>('SELECT last_insert_rowid() as id'))?.id ?? 0;

    if (params.items.length > 0) {
      const stmt = getDatabase().prepare(
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

  /** Get all recipes that are children of a parent */
  getByParent(parentId: number): RecipeRow[] {
    return dbAll<RecipeRow>('SELECT * FROM recipes WHERE parent_id = ? ORDER BY created_at', [parentId]);
  },

  /** Find duplicate recipe by name + rarity + item keys */
  findDuplicate(params: {
    name: string;
    rarity: string;
    paintKeys: string; // "paint1|weapon1,paint2|weapon2,..." sorted
  }): RecipeRow | null {
    const candidates = dbAll<RecipeRow>(
      'SELECT * FROM recipes WHERE name = ? AND rarity = ? AND parent_id IS NULL',
      [params.name, params.rarity]
    );
    for (const r of candidates) {
      const items = this.getItems(r.id);
      const existingKeys = items.map(i => `${i.paint_index}|${i.weapon_id}`).sort().join(',');
      if (existingKeys === params.paintKeys) return r;
    }
    return null;
  },

  /** Get full recipe tree: parent recipes with children */
  getTree(): Array<RecipeRow & { children: RecipeRow[] }> {
    const parents = dbAll<RecipeRow>(
      'SELECT * FROM recipes WHERE parent_id IS NULL ORDER BY updated_at DESC'
    );
    return parents.map(p => ({
      ...p,
      children: this.getByParent(p.id),
    }));
  },

  /** Replace items for a recipe */
  updateItems(recipeId: number, items: Omit<RecipeItemRow, 'id' | 'recipe_id'>[]): void {
    dbRun('DELETE FROM recipe_items WHERE recipe_id = ?', [recipeId]);
    if (items.length > 0) {
      const stmt = getDatabase().prepare(
        `INSERT INTO recipe_items (recipe_id, paint_index, weapon_id, wear_float, asset_id, stattrak, souvenir, position)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const item of items) {
        stmt.run([recipeId, item.paint_index, item.weapon_id, item.wear_float,
          item.asset_id ?? null, item.stattrak, item.souvenir, item.position]);
      }
      stmt.free();
    }
    saveDatabase();
  },
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
