import { create } from 'zustand';
import type { ResolvedItem } from '../../shared/types/item';

export interface TradeUpSlotItem {
  assetId: string;
  name: string;
  nameZh?: string;
  paintIndex: number;
  weaponId: number;
  rarity: string;
  rarityZh?: string;
  rarityColor?: string;
  wearFloat: number;
  minFloat: number;
  maxFloat: number;
  collection: string;
  weaponType?: string;
  isStatTrak: boolean;
  isSouvenir: boolean;
  imageUrl?: string;
}

export interface SimOutcome {
  name: string;
  nameZh?: string;
  marketHashName?: string;
  collection: string;
  probability: number;
  estWearFloat: number;
  estWearCategory: string;
  rarity: string;
  imageUrl?: string;
  /** Cached price from CSQAQ (CNY), null if not available */
  price?: number | null;
}

export interface ProfitData {
  totalCost: number;
  expectedValue: number;
  profit: number;
  roi: number;
  breakEvenRate: number;
}

export interface TradeUpState {
  slots: (TradeUpSlotItem | null)[];
  outcomes: SimOutcome[];
  avgWearNorm: number;
  targetRarity: string;
  targetRarityZh: string;
  simulating: boolean;
  error: string | null;
  /** Profit calculation result */
  profit: ProfitData | null;
  /** Per-input price map (assetId/marketHashName → price) */
  inputPrices: Record<string, number>;

  // Actions
  setSlot: (index: number, item: TradeUpSlotItem | null) => void;
  fillFromInventory: (items: ResolvedItem[]) => void;
  clearAll: () => void;
  removeSlot: (index: number) => void;
  setSimulationResult: (result: {
    outcomes: SimOutcome[];
    avgWearNorm: number;
    targetRarity: string;
    targetRarityZh: string;
    error?: string;
    profit?: ProfitData | null;
    inputPrices?: Record<string, number>;
  }) => void;
  setSimulating: (v: boolean) => void;
  getFilledItems: () => TradeUpSlotItem[];
}

export const useTradeUpStore = create<TradeUpState>((set, get) => ({
  slots: Array(10).fill(null),
  outcomes: [],
  avgWearNorm: 0,
  targetRarity: '',
  targetRarityZh: '',
  simulating: false,
  error: null,
  profit: null,
  inputPrices: {},

  setSlot: (index, item) => {
    const slots = [...get().slots];
    const old = slots[index];
    // 修改磨损后清除 assetId（变为虚拟配方）
    if (item && old && old.assetId && old.wearFloat !== item.wearFloat) {
      item = { ...item, assetId: '' };
    }
    slots[index] = item;
    set({ slots, error: null });
  },

  fillFromInventory: (items) => {
    const slots: (TradeUpSlotItem | null)[] = Array(10).fill(null);
    for (let i = 0; i < Math.min(items.length, 10); i++) {
      slots[i] = {
        assetId: items[i].assetId,
        name: items[i].resolvedNameZh || items[i].resolvedName,
        nameZh: items[i].resolvedNameZh,
        paintIndex: items[i].paintIndex,
        weaponId: items[i].defIndex,
        rarity: items[i].rarityName || '',
        rarityZh: items[i].rarityNameZh,
        rarityColor: items[i].rarityColor,
        wearFloat: items[i].paintWear,
        minFloat: items[i].minFloat,
        maxFloat: items[i].maxFloat,
        collection: items[i].collectionName || '未知',
        weaponType: items[i].weaponType,
        isStatTrak: items[i].isStatTrak,
        isSouvenir: items[i].isSouvenir,
        imageUrl: items[i].imageUrl,
      };
    }
    set({ slots, error: null });
  },

  clearAll: () => set({
    slots: Array(10).fill(null), outcomes: [], error: null,
    profit: null, inputPrices: {},
  }),

  removeSlot: (index) => {
    const slots = [...get().slots];
    slots[index] = null;
    set({ slots, error: null });
  },

  setSimulationResult: (result) => {
    set({
      outcomes: result.outcomes || [],
      avgWearNorm: result.avgWearNorm,
      targetRarity: result.targetRarity,
      targetRarityZh: result.targetRarityZh,
      error: result.error || null,
      profit: result.profit || null,
      inputPrices: result.inputPrices || {},
      simulating: false,
    });
  },

  setSimulating: (v) => set({ simulating: v, error: null }),

  getFilledItems: () => get().slots.filter(Boolean) as TradeUpSlotItem[],
}));
