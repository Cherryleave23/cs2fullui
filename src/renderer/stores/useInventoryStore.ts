import { create } from 'zustand';
import type { ResolvedItem } from '../../shared/types/item';

export interface ItemFilter {
  rarity?: number;
  resolvedType?: string;
  weaponType?: string;
  collectionName?: string;
  isStatTrak?: boolean;
  isSouvenir?: boolean;
  search?: string;
}

export interface InventoryState {
  items: ResolvedItem[];
  filteredItems: ResolvedItem[];
  total: number;
  loading: boolean;
  filter: ItemFilter;
  sortField: keyof ResolvedItem | '';
  sortOrder: 'asc' | 'desc';
  selectedIds: Set<string>;

  // Stats
  stats: {
    totalItems: number;
    byRarity: Record<string, number>;
    byType: Record<string, number>;
  };

  // Actions
  setItems: (items: ResolvedItem[], stats?: InventoryState['stats']) => void;
  upsertItem: (item: ResolvedItem) => void;
  removeItem: (assetId: string) => void;
  setFilter: (filter: Partial<ItemFilter>) => void;
  clearFilters: () => void;
  setSort: (field: keyof ResolvedItem | '', order?: 'asc' | 'desc') => void;
  toggleSelect: (assetId: string) => void;
  selectAll: () => void;
  clearSelection: () => void;
  setLoading: (loading: boolean) => void;
}

function applyFilterAndSort(
  items: ResolvedItem[],
  filter: ItemFilter,
  sortField: string,
  sortOrder: 'asc' | 'desc'
): ResolvedItem[] {
  let result = [...items];

  // Apply filters
  if (filter.rarity !== undefined) {
    result = result.filter(i => i.rarity === filter.rarity);
  }
  if (filter.resolvedType) {
    result = result.filter(i => i.resolvedType === filter.resolvedType);
  }
  if (filter.weaponType) {
    result = result.filter(i => i.weaponType === filter.weaponType);
  }
  if (filter.collectionName) {
    result = result.filter(i => i.collectionName === filter.collectionName);
  }
  if (filter.isStatTrak) {
    result = result.filter(i => i.isStatTrak);
  }
  if (filter.isSouvenir) {
    result = result.filter(i => i.isSouvenir);
  }
  if (filter.search) {
    const q = filter.search.toLowerCase();
    result = result.filter(
      i =>
        i.resolvedName.toLowerCase().includes(q) ||
        (i.resolvedNameZh && i.resolvedNameZh.includes(q)) ||
        i.marketHashName?.toLowerCase().includes(q) ||
        i.weaponType?.toLowerCase().includes(q)
    );
  }

  // Apply sort
  if (sortField) {
    result.sort((a: any, b: any) => {
      const va = a[sortField] ?? '';
      const vb = b[sortField] ?? '';
      const cmp = va < vb ? -1 : va > vb ? 1 : 0;
      return sortOrder === 'desc' ? -cmp : cmp;
    });
  } else {
    // Default: rarity desc, then wear asc
    result.sort((a, b) => b.rarity - a.rarity || (a.paintWear ?? 0) - (b.paintWear ?? 0));
  }

  return result;
}

export const useInventoryStore = create<InventoryState>((set, get) => ({
  items: [],
  filteredItems: [],
  total: 0,
  loading: false,
  filter: {},
  sortField: '',
  sortOrder: 'asc',
  selectedIds: new Set(),
  stats: { totalItems: 0, byRarity: {}, byType: {} },

  setItems: (items, stats) => {
    const { filter, sortField, sortOrder } = get();
    const filtered = applyFilterAndSort(items, filter, sortField, sortOrder);
    set({
      items,
      filteredItems: filtered,
      total: items.length,
      stats: stats || {
        totalItems: items.length,
        byRarity: {},
        byType: {},
      },
      selectedIds: new Set(),
    });
  },

  upsertItem: (item) => {
    const { items, filter, sortField, sortOrder } = get();
    const idx = items.findIndex(i => i.assetId === item.assetId);
    const newItems = idx >= 0
      ? [...items.slice(0, idx), item, ...items.slice(idx + 1)]
      : [...items, item];
    const filtered = applyFilterAndSort(newItems, filter, sortField, sortOrder);
    set({ items: newItems, filteredItems: filtered, total: newItems.length });
  },

  removeItem: (assetId) => {
    const { items, filter, sortField, sortOrder, selectedIds } = get();
    const newItems = items.filter(i => i.assetId !== assetId);
    const filtered = applyFilterAndSort(newItems, filter, sortField, sortOrder);
    const newSelected = new Set(selectedIds);
    newSelected.delete(assetId);
    set({ items: newItems, filteredItems: filtered, total: newItems.length, selectedIds: newSelected });
  },

  setFilter: (partial) => {
    const filter = { ...get().filter, ...partial };
    const filtered = applyFilterAndSort(get().items, filter, get().sortField, get().sortOrder);
    set({ filter, filteredItems: filtered });
  },

  clearFilters: () => {
    const filtered = applyFilterAndSort(get().items, {}, get().sortField, get().sortOrder);
    set({ filter: {}, filteredItems: filtered });
  },

  setSort: (field, order) => {
    const sortOrder = order || (get().sortField === field && get().sortOrder === 'asc' ? 'desc' : 'asc');
    const sortField = field;
    const filtered = applyFilterAndSort(get().items, get().filter, sortField, sortOrder);
    set({ sortField, sortOrder, filteredItems: filtered });
  },

  toggleSelect: (assetId) => {
    const selected = new Set(get().selectedIds);
    if (selected.has(assetId)) selected.delete(assetId);
    else selected.add(assetId);
    set({ selectedIds: selected });
  },

  selectAll: () => {
    const allIds = new Set(get().filteredItems.map(i => i.assetId));
    set({ selectedIds: allIds });
  },

  clearSelection: () => set({ selectedIds: new Set() }),

  setLoading: (loading) => set({ loading }),
}));
