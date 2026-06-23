/**
 * CS2 Trade-Up Simulation Engine
 *
 * Pure algorithm — no GC calls, no side effects.
 * Based on Valve's trade-up contract rules:
 *  - 10 items of identical rarity
 *  - Output rarity = input rarity + 1
 *  - Output is from one of the collections of the input items
 *  - Probability per collection = count_in_collection / 10
 *  - Float = lerp(output_min, output_max, avg_wear_norm)
 *  - StatTrak: all 10 must be StatTrak for ST output
 */

import { RARITY_DATA, WEAR_DATA, getNextRarity, getWearCategory } from '../db/seed';

// Rarity ordering for trade-up progression
const RARITY_ORDER = ['消费级', '工业级', '军规级', '受限级', '保密级', '隐秘级'];

/**
 * Collection → target rarity → output skin list
 * Populated from CSGO-API all.json collection-set entries via loadCollectionData().
 */
const COLLECTION_OUTPUTS: Record<string, Record<string, {
  name: string;
  marketHashName: string;
  /** Minimum possible float for this output skin (0–1) */
  minFloat: number;
  /** Maximum possible float for this output skin (0–1) */
  maxFloat: number;
}[]>> = {};

export interface SimInputItem {
  assetId?: string;
  name: string;
  nameZh?: string;
  rarity: string;
  rarityZh?: string;
  paintIndex: number;
  defIndex: number;
  wearFloat: number;
  minFloat: number;
  maxFloat: number;
  collection: string;
  weaponType?: string;
  isStatTrak: boolean;
  isSouvenir: boolean;
}

export interface SimOutcome {
  /** Skin name */
  name: string;
  /** Chinese name */
  nameZh?: string;
  /** market_hash_name for price lookup */
  marketHashName?: string;
  /** Collection this outcome comes from */
  collection: string;
  /** Probability (0–1) */
  probability: number;
  /** Estimated output float */
  estWearFloat: number;
  /** Estimated wear category */
  estWearCategory: string;
  /** Rarity of output */
  rarity: string;
  /** Image URL if available */
  imageUrl?: string;
}

export interface SimulationResult {
  success: boolean;
  error?: string;
  inputs: SimInputItem[];
  avgWearNorm: number;
  targetRarity: string;
  targetRarityZh: string;
  allStatTrak: boolean;
  collectionsUsed: string[];
  outcomes: SimOutcome[];
}

/**
 * Execute a full trade-up simulation on 10 items.
 */
export function simulateTradeUp(items: SimInputItem[]): SimulationResult {
  // ── 1. Validate count ──
  if (items.length !== 10) {
    return { success: false, error: `需要恰好 10 件物品，当前 ${items.length} 件`, ...emptyResult(items) };
  }

  // ── 2. Validate rarity consistency ──
  const rarities = new Set(items.map(i => i.rarity));
  if (rarities.size > 1) {
    return {
      success: false,
      error: `所有物品必须同一稀有度，当前包含: ${[...rarities].join(', ')}`,
      ...emptyResult(items),
    };
  }

  // ── 3. Validate StatTrak consistency ──
  const hasStatTrak = items.some(i => i.isStatTrak);
  const hasNonStatTrak = items.some(i => !i.isStatTrak);
  if (hasStatTrak && hasNonStatTrak && !items.every(i => i.isSouvenir)) {
    return {
      success: false,
      error: 'StatTrak 物品不能与非 StatTrak 物品混合汰换',
      ...emptyResult(items),
    };
  }

  // ── 4. Determine target rarity ──
  const inputRarity = items[0].rarity;
  const inputRarityZh = items[0].rarityZh || inputRarity;
  const inputIdx = RARITY_ORDER.indexOf(inputRarityZh);
  if (inputIdx < 0 || inputIdx >= RARITY_ORDER.length - 1) {
    return {
      success: false,
      error: `稀有度 "${inputRarityZh}" 无法进行汰换（已是最顶级或未知）`,
      ...emptyResult(items),
    };
  }
  const targetRarityZh = RARITY_ORDER[inputIdx + 1];
  const nextRarity = getNextRarity(inputIdx);
  const targetRarity = nextRarity?.name || 'Unknown';

  // ── 5. Calculate avg_wear_norm ──
  // Norm_i = clamp((wear_i - min_i) / (max_i - min_i), 0, 1)
  // If min == max, norm = 0
  const norms = items.map(i => {
    const range = i.maxFloat - i.minFloat;
    if (range <= 0) return 0;
    return Math.max(0, Math.min(1, (i.wearFloat - i.minFloat) / range));
  });
  const avgWearNorm = norms.reduce((a, b) => a + b, 0) / norms.length;

  // ── 6. Group by collection ──
  const collectionCounts = new Map<string, SimInputItem[]>();
  for (const item of items) {
    const coll = item.collection || '未知收藏品';
    if (!collectionCounts.has(coll)) collectionCounts.set(coll, []);
    collectionCounts.get(coll)!.push(item);
  }

  const collectionsUsed = [...collectionCounts.keys()];

  // ── 7. Generate outcomes ──
  const outcomes: SimOutcome[] = [];
  const allStatTrak = items.every(i => i.isStatTrak);

  for (const [collection, collItems] of collectionCounts) {
    const collectionProb = collItems.length / 10;
    const outputs = COLLECTION_OUTPUTS[collection]?.[targetRarityZh] || [];

    // Diagnostic on first call
    if (!(globalThis as any)._simDiag) {
      (globalThis as any)._simDiag = true;
      console.log('[Simulator] Collections in inputs:', [...collectionCounts.keys()]);
      console.log('[Simulator] Target rarity:', targetRarityZh);
      const availColls = Object.keys(COLLECTION_OUTPUTS).slice(0, 10);
      console.log('[Simulator] Available collections (first 10):', availColls);
      for (const [c, _] of collectionCounts) {
        const avail = COLLECTION_OUTPUTS[c];
        console.log(`[Simulator] "${c}" → ${avail ? Object.keys(avail).join(', ') : 'NOT FOUND'}`);
      }
    }

    if (outputs.length > 0) {
      // Known outputs — distribute probability evenly
      // Correct float formula: lerp(output.minFloat, output.maxFloat, avgWearNorm)
      const perOutputProb = collectionProb / outputs.length;
      for (const output of outputs) {
        const range = output.maxFloat - output.minFloat;
        const estFloat = range > 0
          ? output.minFloat + avgWearNorm * range
          : output.minFloat;
        const estWearCat = getWearCategory(estFloat);
        // Fix marketHashName: stored entry has fixed wear suffix, replace with actual
        const correctMhn = output.marketHashName
          ? output.marketHashName.replace(/\s*[（(][^)）]*[)）]\s*$/, '') + ' (' + estWearCat.name + ')'
          : '';
        outcomes.push({
          name: output.name,
          marketHashName: correctMhn,
          collection,
          probability: perOutputProb,
          estWearFloat: Math.round(estFloat * 100000) / 100000,
          estWearCategory: estWearCat.nameZh,
          rarity: targetRarity,
        });
      }
    } else {
      // Unknown outputs — use a generic range estimate (most skins fall in 0–0.8)
      const genericFloat = avgWearNorm * 0.78 + 0.02;
      outcomes.push({
        name: `${collection} (${targetRarityZh})`,
        nameZh: `${collection} (${targetRarityZh})`,
        collection,
        probability: collectionProb,
        estWearFloat: Math.round(genericFloat * 100000) / 100000,
        estWearCategory: getWearCategory(genericFloat).nameZh,
        rarity: targetRarity,
      });
    }
  }

  // Sort by probability descending
  outcomes.sort((a, b) => b.probability - a.probability);

  return {
    success: true,
    inputs: items,
    avgWearNorm,
    targetRarity,
    targetRarityZh,
    allStatTrak,
    collectionsUsed,
    outcomes,
  };
}

/**
 * Load collection output data from CSGO-API all.json collection-set entries.
 * Each skin in a collection's `contains` array provides min_float / max_float.
 */
export function loadCollectionData(collectionsData: any[]): void {
  for (const coll of collectionsData) {
    if (!coll.id || !coll.contains) continue;
    const collName = coll.name;
    if (!COLLECTION_OUTPUTS[collName]) COLLECTION_OUTPUTS[collName] = {};

    for (const skin of coll.contains) {
      const rarityName = skin.rarity?.name || '';
      if (!COLLECTION_OUTPUTS[collName][rarityName]) {
        COLLECTION_OUTPUTS[collName][rarityName] = [];
      }
      COLLECTION_OUTPUTS[collName][rarityName].push({
        name: skin.name,
        marketHashName: skin.market_hash_name || '',
        minFloat: typeof skin.min_float === 'number' ? skin.min_float : 0,
        maxFloat: typeof skin.max_float === 'number' ? skin.max_float : 1,
      });
    }
  }
  console.log(`[Simulator] Collection data loaded: ${Object.keys(COLLECTION_OUTPUTS).length} collections`);
}

function emptyResult(inputs: SimInputItem[]): Omit<SimulationResult, 'success'> {
  return {
    inputs,
    avgWearNorm: 0,
    targetRarity: '',
    targetRarityZh: '',
    allStatTrak: false,
    collectionsUsed: [],
    outcomes: [],
  };
}

