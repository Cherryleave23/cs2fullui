/**
 * CS:GO Item Resolver — maps raw CSOEconItem data to human-readable ResolvedItem.
 *
 * Three-way dispatch (from cs2tradetool v2):
 *   1. stickers[0] exists → sticker/graffiti container, resolve by sticker_id
 *   2. paint_index ≠ 0   → weapon skin, resolve by paint_index|weapon_id
 *   3. Otherwise          → crate/agent/keychain/etc., resolve by type precision scoring
 *
 * Data source: data/csgoapi/all.json (ByMykel/CSGO-API, 71MB, 45,756 entries)
 */
import * as fs from 'fs';
import { join } from 'path';
import { app } from 'electron';
import { getWearCategory } from '../db/seed';
import type { ResolvedItem } from '../../shared/types/item';

// Category precision scores (10,000 / entry_count)
const CATEGORY_PRECISION: Record<string, number> = {
  tool: 2500, key: 256, agent: 159, keychain: 128, patch: 112,
  music_kit: 53, crate: 20.9, collectible: 15.9, graffiti: 4.7,
  sticker_slab: 0.96, sticker: 0.96,
};

// Known weapon def_index values (populated from all.json)
const KNOWN_WEAPON_IDS = new Set<number>();

class CsgoapiResolver {
  // skin lookup: "{paint_index}|{weapon_id}" → SkinEntry
  private skinByKey = new Map<string, any>();
  // sticker lookup: "{sticker_id}" → StickerEntry
  private stickerById = new Map<string, any>();
  // category → def_index → entry (non-skin items)
  private byTypeAndDef = new Map<string, Map<number, any>>();
  // All entries keyed by CSGO-API ID
  private allEntries = new Map<string, any>();

  private loaded = false;

  /** Load all.json from data directory. Called once at startup. */
  load(): boolean {
    if (this.loaded) return true;

    const dataDir = join(app.getPath('userData'), '..', '..', 'data');
    // Try project-relative path first, then userData
    const basePaths = [process.cwd(), app.getAppPath()];
    const paths: string[] = [];
    for (const base of basePaths) {
      paths.push(join(base, 'data', 'all.json'));
      paths.push(join(base, 'data', 'csgoapi', 'all.json'));
    }

    let allPath = '';
    for (const p of paths) {
      if (fs.existsSync(p)) { allPath = p; break; }
    }

    if (!allPath) {
      console.warn('[CsgoResolver] all.json not found. Searched:');
      for (const p of paths) {
        console.warn(`  ${p} → ${require('fs').existsSync(p) ? 'EXISTS' : 'MISSING'}`);
      }
      return false;
    }

    console.log(`[CsgoResolver] Loading ${allPath}...`);
    const start = Date.now();

    try {
      const raw = fs.readFileSync(allPath, 'utf-8');
      const all = JSON.parse(raw);
      let skinCount = 0, stickerCount = 0, otherCount = 0;

      for (const [key, item] of Object.entries(all)) {
        if (!item || typeof item !== 'object') continue;
        const entry = item as any;
        this.allEntries.set(key, entry);

        const type = key.split('-')[0];

        // Index skins: key = "paint_index|weapon_id"
        if (type === 'skin' && entry.paint_index && entry.weapon?.weapon_id) {
          const skinKey = `${entry.paint_index}|${entry.weapon.weapon_id}`;
          this.skinByKey.set(skinKey, entry);
          KNOWN_WEAPON_IDS.add(entry.weapon.weapon_id);
          skinCount++;
        }

        // Index stickers: key = sticker_id
        if (type === 'sticker') {
          const stickerId = key.replace('sticker-', '');
          this.stickerById.set(stickerId, entry);
          stickerCount++;
        }

        // Index other categories by type + def_index
        // CRITICAL: all.json def_index is STRING, GC item def_index is NUMBER
        // Normalize to number for Map key matching
        if (entry.def_index !== undefined) {
          const defIdx = Number(entry.def_index);
          if (!this.byTypeAndDef.has(type)) {
            this.byTypeAndDef.set(type, new Map());
          }
          this.byTypeAndDef.get(type)!.set(defIdx, entry);
          otherCount++;
        }
      }

      this.loaded = true;
      console.log(`[CsgoResolver] Indexed ${skinCount} skins, ${stickerCount} stickers, ${otherCount} others (${Date.now() - start}ms)`);
      return true;
    } catch (err) {
      console.error('[CsgoResolver] Failed to load all.json:', err);
      return false;
    }
  }

  /** Get a raw CSOEconItem and return a ResolvedItem */
  resolveOne(rawItem: any): ResolvedItem {
    const assetId = String(rawItem.id || '');
    const defIndex = rawItem.def_index ?? 0;
    const paintIndex = rawItem.paint_index ?? 0;
    const paintWear = rawItem.paint_wear ?? 0;
    const paintSeed = rawItem.paint_seed ?? 0;
    const rarity = rawItem.rarity ?? 0;
    const quality = rawItem.quality ?? 4;
    const origin = rawItem.origin ?? 0;
    const customName = rawItem.custom_name || '';
    const killEaterValue = rawItem.kill_eater_value ?? 0;
    const killEaterScoreType = rawItem.kill_eater_score_type ?? 0;
    const casketId = rawItem.casket_id ? String(rawItem.casket_id) : '';
    const tradableAfter = rawItem.tradable_after instanceof Date
      ? rawItem.tradable_after.toISOString() : '';
    const position = (rawItem as any).position ?? 0;
    const inUse = rawItem.in_use ?? false;
    const isStatTrak = quality === 9;
    const isSouvenir = quality === 12;

    // ── Dispatch ──
    let resolvedType = 'unknown';
    let resolvedName = `Item ${defIndex}`;
    let resolvedNameZh = `物品 ${defIndex}`;
    let rarityName = '';
    let rarityNameZh = '';
    let rarityColor = '#b0c4d8';
    let wearCategory = '';
    let wearCategoryZh = '';
    let minFloat = 0;
    let maxFloat = 1;
    let marketHashName = '';
    let weaponType = '';
    let collectionName = '';
    let imageUrl = '';

    // Case 1: Sticker/crate container (has stickers)
    const stickers = rawItem.stickers;
    if (stickers && stickers.length > 0 && stickers[0].sticker_id) {
      const stickerId = String(stickers[0].sticker_id);
      const entry = this.stickerById.get(stickerId);
      if (entry) {
        resolvedType = 'sticker';
        resolvedName = entry.name || `Sticker ${stickerId}`;
        resolvedNameZh = entry.name || resolvedName;
        rarityName = entry.rarity?.name || '';
        rarityNameZh = rarityName;
        rarityColor = entry.rarity?.color || '#b0c4d8';
        imageUrl = entry.image || '';
        collectionName = entry.collections?.[0]?.name || '';
        marketHashName = entry.market_hash_name || '';
      }
    }
    // Case 2: Weapon skin (paint_index ≠ 0)
    else if (paintIndex !== 0 && paintIndex != null) {
      // Try with weapon_id from def_index, then with paint_index alone
      let entry: any = null;

      // Try exact match: paint_index|def_index
      entry = this.skinByKey.get(`${paintIndex}|${defIndex}`);

      // Try float paint_index
      if (!entry && paintIndex !== Math.floor(paintIndex)) {
        entry = this.skinByKey.get(`${Math.floor(paintIndex)}|${defIndex}`);
      }

      if (entry) {
        resolvedType = 'skin';
        resolvedName = entry.name || '';
        resolvedNameZh = entry.name || '';
        rarityName = entry.rarity?.name || '';
        rarityNameZh = rarityName;
        rarityColor = entry.rarity?.color || '#b0c4d8';
        minFloat = entry.min_float ?? 0;
        maxFloat = entry.max_float ?? 1;
        weaponType = entry.category?.name || entry.weapon?.name || '';
        collectionName = entry.collections?.[0]?.name || '';
        marketHashName = entry.market_hash_name || '';
        imageUrl = entry.image || '';
      }
    }
    // Case 3: Base weapon (known weapon def_index, no paint)
    else if (KNOWN_WEAPON_IDS.has(defIndex)) {
      resolvedType = 'weapon';
      resolvedName = `Weapon ${defIndex}`;
      resolvedNameZh = `原版武器 ${defIndex}`;
      weaponType = `Weapon ${defIndex}`;
    }
    // Case 4: Other item (crate, agent, keychain, collectible, etc.)
    else {
      // Precision scoring by category
      let bestScore = -1;
      let bestEntry: any = null;
      let bestType = '';

      for (const [type, defMap] of this.byTypeAndDef) {
        if (type === 'skin' || type === 'sticker') continue; // already handled
        const entry = defMap.get(defIndex);
        if (entry) {
          const score = CATEGORY_PRECISION[type] || 0;
          if (score > bestScore) {
            bestScore = score;
            bestEntry = entry;
            bestType = type;
          }
        }
      }

      if (bestEntry) {
        resolvedType = bestType;
        resolvedName = bestEntry.name || `${bestType} ${defIndex}`;
        resolvedNameZh = bestEntry.name || resolvedName;
        rarityName = bestEntry.rarity?.name || '';
        rarityNameZh = rarityName;
        rarityColor = bestEntry.rarity?.color || '#b0c4d8';
        collectionName = bestEntry.collections?.[0]?.name || '';
        marketHashName = bestEntry.market_hash_name || '';
        imageUrl = bestEntry.image || '';
      } else {
        resolvedType = `def_${defIndex}`;
      }
    }

    // ── Wear category ──
    if (resolvedType === 'skin' && minFloat !== maxFloat) {
      const wear = getWearCategory(paintWear);
      wearCategory = wear.name;
      wearCategoryZh = wear.nameZh;
    }

    // ── Extra JSON (stickers, keychains) ──
    let extraJson = '';
    try {
      if (stickers && stickers.length > 0) {
        extraJson = JSON.stringify({ stickers: stickers.map((s: any) => ({
          slot: s.slot, sticker_id: s.sticker_id, wear: s.wear,
          scale: s.scale, rotation: s.rotation,
        })) });
      }
    } catch (_) { /* ignore */ }

    return {
      assetId, defIndex, resolvedType, resolvedName, resolvedNameZh,
      paintIndex, paintSeed, paintWear, rarity, rarityName, rarityNameZh, rarityColor,
      quality, origin, customName, wearCategory, wearCategoryZh,
      minFloat, maxFloat, marketHashName, weaponType, collectionName, imageUrl,
      killEaterValue, killEaterScoreType, casketId, tradableAfter, position,
      inUse, isStatTrak, isSouvenir, extraJson,
    };
  }

  /** Resolve all items in bulk */
  resolveAll(rawItems: any[]): ResolvedItem[] {
    return rawItems.map(item => this.resolveOne(item));
  }
}

// Singleton
export const csgoResolver = new CsgoapiResolver();
