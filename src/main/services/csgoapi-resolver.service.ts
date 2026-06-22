/**
 * CsgoapiResolver — constraint-based matching engine per cs2tradetool v2.
 *
 * Architecture:
 *   Phase 1: _collectSignals() — 14 feature signals from CSOEconItem
 *   Phase 2: TYPE_RULES — required ALL met + forbidden NONE violated
 *   Phase 3: Precision selection for multiple candidates
 *   Phase 4: Name resolution + ST/SV formatting
 *
 * Data source: all.json (71MB, 45,756 entries, zh-CN)
 * Fallback: items_game.txt for sticker gaps (1695-1738 range)
 */
import * as fs from 'fs';
import { join } from 'path';
import { app } from 'electron';
import { getWearCategory } from '../db/seed';
import { loadCollectionData } from './tradeup-simulator';
import type { ResolvedItem } from '../../shared/types/item';

// Category precision in descending order (10,000 / entry_count)
const CATEGORY_PRECISION: Record<string, number> = {
  tool: 2500, key: 256, agent: 159, keychain: 128, patch: 112,
  music_kit: 53, crate: 20.9, collectible: 15.9, graffiti: 4.7,
  sticker_slab: 0.96, sticker: 0.96,
};

const SINGULAR_CATEGORIES = [
  'crate', 'collectible', 'agent', 'music_kit', 'graffiti',
  'patch', 'keychain', 'key', 'tool', 'sticker_slab',
];

const KNOWN_WEAPON_IDS = new Set<number>();

// ═══════════════════════════════════════════
//  TYPE_RULES — per cs2tradetool v2 (immutable)
// ═══════════════════════════════════════════
interface Signals {
  hasSticker: boolean;
  hasPaint: boolean;
  hasWear: boolean;
  isWeapon: boolean;
  hasMusicIndex: boolean;
  hasGraffitiTint: boolean;
  isStatTrak: boolean;
  isSouvenir: boolean;
  defIndex: number;
  paintIndex: number;
  quality: number;
}

interface TypeRule {
  required: (keyof Signals)[];
  forbidden: (keyof Signals)[];
}

const TYPE_RULES: Record<string, TypeRule> = {
  skin:       { required: ['hasPaint'],                      forbidden: ['hasGraffitiTint', 'hasMusicIndex'] },
  weapon:     { required: ['isWeapon'],                      forbidden: ['hasPaint', 'hasGraffitiTint', 'hasMusicIndex'] },
  sticker:    { required: ['hasSticker'],                    forbidden: ['hasGraffitiTint', 'hasMusicIndex', 'hasPaint'] },
  graffiti:   { required: ['hasGraffitiTint'],              forbidden: [] },
  music_kit:  { required: ['hasMusicIndex'],                 forbidden: ['hasPaint'] },
  crate:      { required: [],                                forbidden: ['hasSticker', 'hasPaint', 'hasMusicIndex', 'hasGraffitiTint'] },
  collectible:{ required: [],                                forbidden: ['hasPaint', 'hasMusicIndex', 'hasGraffitiTint'] },
  agent:      { required: [],                                forbidden: ['hasPaint', 'hasMusicIndex', 'hasGraffitiTint'] },
  keychain:   { required: [],                                forbidden: ['hasPaint', 'hasSticker', 'hasMusicIndex', 'hasGraffitiTint'] },
  patch:      { required: [],                                forbidden: ['hasPaint', 'hasMusicIndex', 'hasGraffitiTint'] },
};

// Optional: def_index range validation (crate/collectible/agent/keychain/patch must exist in all.json for their category)
function categoryHasDef(category: string, defIndex: number, byTypeAndDef: Map<string, Map<number, any>>): boolean {
  return byTypeAndDef.get(category)?.has(defIndex) ?? false;
}

class CsgoapiResolver {
  private skinByKey = new Map<string, any>();
  private stickerById = new Map<string, any>();
  private byTypeAndDef = new Map<string, Map<number, any>>();
  private loaded = false;

  load(): boolean {
    if (this.loaded) return true;
    const paths = [
      join(process.cwd(), 'data', 'all.json'),
      join(process.cwd(), 'data', 'csgoapi', 'all.json'),
      join(app.getAppPath(), 'data', 'all.json'),
    ];
    let allPath = '';
    for (const p of paths) { if (fs.existsSync(p)) { allPath = p; break; } }
    if (!allPath) { console.warn('[CsgoResolver] all.json not found'); return false; }

    console.log(`[CsgoResolver] Loading ${allPath}...`);
    const start = Date.now();
    try {
      const all = JSON.parse(fs.readFileSync(allPath, 'utf-8'));
      let skinCount = 0, stickerCount = 0, otherCount = 0;

      for (const [key, item] of Object.entries(all)) {
        if (!item || typeof item !== 'object') continue;
        const entry = item as any;
        const type = key.split('-')[0];

        // Skin index: prefer base variant over ST/SV
        if (type === 'skin' && entry.paint_index && entry.weapon?.weapon_id) {
          const skinKey = `${entry.paint_index}|${entry.weapon.weapon_id}`;
          const existing = this.skinByKey.get(skinKey);
          const isSpecial = entry.souvenir || entry.stattrak;
          if (!existing || (!isSpecial && (existing.souvenir || existing.stattrak))) {
            this.skinByKey.set(skinKey, entry);
          }
          KNOWN_WEAPON_IDS.add(entry.weapon.weapon_id);
          skinCount++;
        }

        // Sticker: sticker_id → entry
        if (type === 'sticker') {
          this.stickerById.set(key.replace('sticker-', ''), entry);
          stickerCount++;
        }

        // All other types: type → def_index (normalized to number)
        if (entry.def_index !== undefined) {
          const defIdx = Number(entry.def_index);
          let map = this.byTypeAndDef.get(type);
          if (!map) { map = new Map(); this.byTypeAndDef.set(type, map); }
          map.set(defIdx, entry);
          otherCount++;
        }
      }

      this.loaded = true;
      // Build collection output data from collection-set entries
      this._buildCollectionOutputs(all);
      console.log(`[CsgoResolver] ${skinCount} skins, ${stickerCount} stickers, ${otherCount} others (${Date.now() - start}ms)`);
      return true;
    } catch (err) { console.error('[CsgoResolver] Load error:', err); return false; }
  }

  // ═══════════════════════════════════════════
  //  Signal collection (Phase 1)
  // ═══════════════════════════════════════════
  private _collectSignals(item: any): Signals {
    const attrs = item.attribute || [];
    const defIndex = item.def_index ?? 0;
    const paintIndex = item.paint_index ?? 0;

    // Per manual: ST = quality 9 or kill_eater_value or attr[80]
    const isST = item.quality === 9
      || item.kill_eater_value != null
      || attrs.some((a: any) => a.def_index === 80);
    // Per manual: SV = quality 12 or attr[140]
    const isSV = item.quality === 12
      || attrs.some((a: any) => a.def_index === 140);

    return {
      hasSticker: !!(item.stickers && item.stickers.length > 0),
      hasPaint: paintIndex != null && paintIndex !== 0,
      hasWear: item.paint_wear != null,
      isWeapon: KNOWN_WEAPON_IDS.has(defIndex),
      hasMusicIndex: attrs.some((a: any) => a.def_index === 166),
      hasGraffitiTint: attrs.some((a: any) => a.def_index === 233),
      isStatTrak: isST,
      isSouvenir: isSV,
      defIndex,
      paintIndex,
      quality: item.quality ?? 4,
    };
  }

  // ═══════════════════════════════════════════
  //  Constraint-based matching (Phase 2 + 3)
  // ═══════════════════════════════════════════
  private _match(signals: Signals, item: any): { type: string; entry: any } | null {
    const candidates: { type: string; score: number }[] = [];

    for (const [type, rule] of Object.entries(TYPE_RULES)) {
      const reqOk = rule.required.every(f => signals[f as keyof Signals] === true);
      if (!reqOk) continue;
      const forbOk = rule.forbidden.every(f => signals[f as keyof Signals] !== true);
      if (!forbOk) continue;
      if (SINGULAR_CATEGORIES.includes(type) && !categoryHasDef(type, signals.defIndex, this.byTypeAndDef)) continue;
      candidates.push({ type, score: CATEGORY_PRECISION[type] || 0 });
    }

    if (candidates.length === 0) return null;
    candidates.sort((a, b) => b.score - a.score);
    const winner = candidates[0];

    let entry: any = null;
    if (winner.type === 'skin') {
      entry = this.skinByKey.get(`${signals.paintIndex}|${signals.defIndex}`);
    } else if (winner.type === 'sticker') {
      const sid = item.stickers?.[0]?.sticker_id;
      if (sid != null) entry = this.stickerById.get(String(sid));
    } else if (winner.type !== 'weapon') {
      entry = this.byTypeAndDef.get(winner.type)?.get(signals.defIndex) || null;
    }

    return { type: winner.type, entry };
  }

  // ═══════════════════════════════════════════
  //  Resolve one CSOEconItem (Phase 1-4)
  // ═══════════════════════════════════════════
  resolveOne(item: any): ResolvedItem {
    const signals = this._collectSignals(item);
    const match = this._match(signals, item);

    const assetId = String(item.id || '');
    const paintWear = item.paint_wear ?? 0;
    const paintSeed = item.paint_seed ?? 0;
    const stickers = item.stickers;
    const isStatTrak = signals.isStatTrak;
    const isSouvenir = signals.isSouvenir;

    let rType = match?.type || 'unknown';
    let rName = `Item ${signals.defIndex}`;
    let rNameZh = `物品 ${signals.defIndex}`;
    let rRarity = ''; let rRarityZh = ''; let rColor = '#b0c4d8';
    let rMinF = 0.0; let rMaxF = 1.0;
    let rWep = ''; let rColl = ''; let rHash = ''; let rImg = '';
    let entry = match?.entry || null;

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

      // ═══════════════════════════════════════════
      //  ST/SV name formatting (per manual, immutable)
      // ═══════════════════════════════════════════
      if (rName.includes(' | ')) {
        if (isStatTrak) {
          rName = rName.replace(/\s*\|\s*/, '（StatTrak™） | ');
          rNameZh = rNameZh.replace(/\s*\|\s*/, '（StatTrak™） | ');
        }
        if (isSouvenir) {
          rName = rName.replace(/\s*\|\s*/, '（纪念品） | ');
          rNameZh = rNameZh.replace(/\s*\|\s*/, '（纪念品） | ');
        }
      }
    }

    // Wear (skins only)
    let wearCat = '', wearCatZh = '';
    if (rType === 'skin') {
      const w = getWearCategory(paintWear);
      wearCat = w.name; wearCatZh = w.nameZh;
    }

    // Extra JSON (stickers on item)
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
      assetId, defIndex: signals.defIndex, resolvedType: rType, resolvedName: rName, resolvedNameZh: rNameZh,
      paintIndex: signals.paintIndex, paintSeed, paintWear, rarity: item.rarity ?? 0,
      rarityName: rRarity, rarityNameZh: rRarityZh, rarityColor: rColor,
      quality: signals.quality, origin: item.origin ?? 0,
      customName: item.custom_name || '',
      wearCategory: wearCat, wearCategoryZh: wearCatZh, minFloat: rMinF, maxFloat: rMaxF,
      marketHashName: rHash, weaponType: rWep, collectionName: rColl, imageUrl: rImg,
      killEaterValue: item.kill_eater_value ?? 0,
      killEaterScoreType: item.kill_eater_score_type ?? 0,
      casketId: item.casket_id ? String(item.casket_id) : '',
      tradableAfter: item.tradable_after instanceof Date ? item.tradable_after.toISOString() : '',
      position: item.position ?? 0, inUse: item.in_use ?? false,
      isStatTrak, isSouvenir, extraJson: extra,
    };
  }

  resolveAll(items: any[]): ResolvedItem[] { return items.map(i => this.resolveOne(i)); }

  /** Get all skin entries for autocomplete */
  getAllSkins(): Array<{
    name: string; nameZh: string; paintIndex: string; weaponId: number;
    minFloat: number; maxFloat: number; collection: string; imageUrl: string;
    rarity: string; rarityColor: string;
  }> {
    const result: any[] = [];
    for (const entry of this.skinByKey.values()) {
      result.push({
        name: entry.name || '',
        nameZh: entry.name || '',
        paintIndex: entry.paint_index || '0',
        weaponId: entry.weapon?.weapon_id || 0,
        minFloat: entry.min_float ?? 0,
        maxFloat: entry.max_float ?? 1,
        collection: entry.collections?.[0]?.name || '',
        imageUrl: entry.image || '',
        rarity: entry.rarity?.name || '',
        rarityColor: entry.rarity?.color || '#b0c4d8',
      });
    }
    return result;
  }

  private _buildCollectionOutputs(all: any): void {
    const data: any[] = [];
    // Build reverse index: skin name → collection name
    const nameToColl = new Map<string, string>();
    for (const [key, entry] of Object.entries(all)) {
      if (!key.startsWith('collection-set-') || !entry || typeof entry !== 'object') continue;
      const coll = entry as any;
      if (!coll.contains) continue;
      data.push({ id: coll.name || key, name: coll.name || key, contains: coll.contains });
      // Map each skin in this collection back to the collection name
      for (const skin of coll.contains) {
        if (skin.name) nameToColl.set(skin.name, coll.name);
      }
    }
    // Now update skinByKey entries with collection names
    // Collection skin names lack wear suffixes → strip suffix before lookup
    for (const entry of this.skinByKey.values()) {
      const name = entry.name || '';
      const stripped = name.replace(/\s*[（(][^)）]*[)）]\s*$/g, '');
      const collName = nameToColl.get(name) || nameToColl.get(stripped);
      if (collName && !entry.collections) {
        entry.collections = [{ name: collName }];
      }
    }
    loadCollectionData(data);
    console.log('[CsgoResolver] Collection data: ' + data.length + ' collections, ' + nameToColl.size + ' skin mappings');
  }
}

export const csgoResolver = new CsgoapiResolver();
