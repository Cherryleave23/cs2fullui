/**
 * CsgoapiResolver — exact match to tech reference "三路分派规则".
 *
 * Dispatch order (per manual):
 *   1. paint_index != null && paint_index !== 0 → weapon skin
 *   2. stickers[0] exists                        → sticker/graffiti container
 *   3. isKnownWeapon(def_index)                  → base weapon
 *   4. precision scoring by category             → crate/agent/keychain/etc.
 *
 * Key detail: paint_index/def_index are STRINGS in all.json, NUMBERS from GC.
 */
import * as fs from 'fs';
import { join } from 'path';
import { app } from 'electron';
import { getWearCategory } from '../db/seed';
import type { ResolvedItem } from '../../shared/types/item';

// Category precision: 10000 / entry_count (per manual)
const CATEGORY_PRECISION: Record<string, number> = {
  tool: 2500, key: 256, agent: 159, keychain: 128, patch: 112,
  music_kit: 53, crate: 20.9, collectible: 15.9, graffiti: 4.7,
  sticker_slab: 0.96, sticker: 0.96,
};

const KNOWN_WEAPON_IDS = new Set<number>();

class CsgoapiResolver {
  private skinByKey = new Map<string, any>();      // "paint_index|weapon_id" → entry
  private stickerById = new Map<string, any>();     // "sticker_id" → entry
  private byTypeAndDef = new Map<string, Map<number, any>>(); // type → def_index(number) → entry
  private loaded = false;

  load(): boolean {
    if (this.loaded) return true;

    const paths = [
      join(process.cwd(), 'data', 'all.json'),
      join(process.cwd(), 'data', 'csgoapi', 'all.json'),
      join(app.getAppPath(), 'data', 'all.json'),
    ];

    let allPath = '';
    for (const p of paths) {
      if (fs.existsSync(p)) { allPath = p; break; }
    }
    if (!allPath) {
      console.warn('[CsgoResolver] all.json not found. Searched:');
      for (const p of paths) console.warn(`  ${p}`);
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
        const type = key.split('-')[0];

        // Skin: key = paint_index|weapon_id  (paint_index is STRING in all.json)
        if (type === 'skin' && entry.paint_index && entry.weapon?.weapon_id) {
          this.skinByKey.set(`${entry.paint_index}|${entry.weapon.weapon_id}`, entry);
          KNOWN_WEAPON_IDS.add(entry.weapon.weapon_id);
          skinCount++;
        }

        // Sticker: key = sticker_id (from key "sticker-{id}")
        if (type === 'sticker') {
          this.stickerById.set(key.replace('sticker-', ''), entry);
          stickerCount++;
        }

        // All other types: type → def_index (NORMALIZED to number)
        if (entry.def_index !== undefined) {
          const defIdx = Number(entry.def_index);
          let map = this.byTypeAndDef.get(type);
          if (!map) { map = new Map(); this.byTypeAndDef.set(type, map); }
          map.set(defIdx, entry);
          otherCount++;
        }
      }

      this.loaded = true;
      console.log(`[CsgoResolver] ${skinCount} skins, ${stickerCount} stickers, ${otherCount} others (${Date.now() - start}ms)`);
      return true;
    } catch (err) {
      console.error('[CsgoResolver] Load error:', err);
      return false;
    }
  }

  /** Resolve a single CSOEconItem → ResolvedItem */
  resolveOne(rawItem: any): ResolvedItem {
    const assetId = String(rawItem.id || '');
    const defIndex = rawItem.def_index ?? 0;
    const paintIndex = rawItem.paint_index ?? 0;
    const paintWear = rawItem.paint_wear ?? 0;
    const paintSeed = rawItem.paint_seed ?? 0;
    const rarity = rawItem.rarity ?? 0;
    const quality = rawItem.quality ?? 4;
    const origin = rawItem.origin ?? 0;
    const stickers = rawItem.stickers;
    // Per manual: quality 4=Normal, 9=StatTrak, 12=Souvenir
    const isStatTrak = quality === 9;
    const isSouvenir = quality === 12;

    // ── Three-way dispatch (EXACTLY per manual) ──
    let rType = 'unknown';
    let rName = `Item ${defIndex}`;
    let rNameZh = `物品 ${defIndex}`;
    let rRarity = ''; let rRarityZh = ''; let rColor = '#b0c4d8';
    let rMinF = 0.0; let rMaxF = 1.0;
    let rWep = ''; let rColl = ''; let rHash = ''; let rImg = '';
    let entry: any = null;

    // 1. paint_index != null && paint_index !== 0 → weapon skin
    if (paintIndex && paintIndex !== 0) {
      entry = this.skinByKey.get(`${paintIndex}|${defIndex}`);
      if (!entry && paintIndex !== Math.floor(paintIndex)) {
        entry = this.skinByKey.get(`${Math.floor(paintIndex)}|${defIndex}`);
      }
      if (entry) rType = 'skin';
    }
    // 2. stickers[0] exists (and no paint_index) → sticker container
    else if (stickers?.length > 0 && stickers[0]?.sticker_id) {
      entry = this.stickerById.get(String(stickers[0].sticker_id));
      if (entry) rType = 'sticker';
    }
    // 3. isKnownWeapon(def_index) → base weapon
    else if (KNOWN_WEAPON_IDS.has(defIndex)) {
      rType = 'weapon';
      rName = `Weapon ${defIndex}`;
      rNameZh = `原版武器 ${defIndex}`;
      rWep = `Weapon ${defIndex}`;
    }
    // 4. Precision scoring by category
    else {
      let bestScore = -1;
      for (const [type, defMap] of this.byTypeAndDef) {
        if (type === 'skin' || type === 'sticker') continue;
        const e = defMap.get(defIndex);
        if (e) {
          const score = CATEGORY_PRECISION[type] || 0;
          if (score > bestScore) { bestScore = score; entry = e; rType = type; }
        }
      }
    }

    // Fill from resolved entry
    if (entry) {
      rName = entry.name || rName;
      rNameZh = entry.name || rNameZh;
      rRarity = entry.rarity?.name || '';
      rRarityZh = rRarity;
      rColor = entry.rarity?.color || '#b0c4d8';
      rImg = entry.image || '';
      rColl = entry.collections?.[0]?.name || '';
      rHash = entry.market_hash_name || '';
      if (rType === 'skin') {
        rMinF = entry.min_float ?? 0;
        rMaxF = entry.max_float ?? 1;
        rWep = entry.category?.name || entry.weapon?.name || '';
      }
    }

    // Wear (skins only)
    let wearCat = '', wearCatZh = '';
    if (rType === 'skin') {
      const w = getWearCategory(paintWear);
      wearCat = w.name; wearCatZh = w.nameZh;
    }

    // Extra JSON (stickers on the item)
    let extra = '';
    try {
      if (stickers?.length > 0) {
        extra = JSON.stringify({ stickers: stickers.map((s: any) => ({
          slot: s.slot, sticker_id: s.sticker_id, wear: s.wear,
          scale: s.scale, rotation: s.rotation,
        })) });
      }
    } catch (_) { /* ignore */ }

    return {
      assetId, defIndex, resolvedType: rType, resolvedName: rName, resolvedNameZh: rNameZh,
      paintIndex, paintSeed, paintWear, rarity, rarityName: rRarity, rarityNameZh: rRarityZh,
      rarityColor: rColor, quality, origin, customName: rawItem.custom_name || '',
      wearCategory: wearCat, wearCategoryZh: wearCatZh, minFloat: rMinF, maxFloat: rMaxF,
      marketHashName: rHash, weaponType: rWep, collectionName: rColl, imageUrl: rImg,
      killEaterValue: rawItem.kill_eater_value ?? 0,
      killEaterScoreType: rawItem.kill_eater_score_type ?? 0,
      casketId: rawItem.casket_id ? String(rawItem.casket_id) : '',
      tradableAfter: rawItem.tradable_after instanceof Date ? rawItem.tradable_after.toISOString() : '',
      position: rawItem.position ?? 0, inUse: rawItem.in_use ?? false,
      isStatTrak, isSouvenir, extraJson: extra,
    };
  }

  resolveAll(rawItems: any[]): ResolvedItem[] {
    return rawItems.map(i => this.resolveOne(i));
  }
}

export const csgoResolver = new CsgoapiResolver();
