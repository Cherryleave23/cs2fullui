/**
 * Type declaration for window.electronAPI exposed by the preload script.
 */
export interface ElectronAPI {
  auth: {
    login(params: {
      accountName: string;
      password: string;
      proxyUrl?: string;
      nickname?: string;
      webCompatibilityMode?: boolean;
    }): Promise<{ success: boolean; steamId?: string; error?: string; needSteamGuard?: boolean; alreadyLoggedIn?: boolean }>;
    logout(params?: { accountName?: string }): Promise<void>;
    getStatus(): Promise<{ state: string; steamId: string | null; accountName: string | null; nickname: string | null; isGCReady: boolean }>;
    submitSteamGuard(params: { accountName: string; code: string }): Promise<void>;
    getProxyConfig(steamId?: string): Promise<{ proxyUrl: string }>;
    setProxyConfig(params: { steamId?: string; proxyUrl: string }): Promise<void>;
    getAccounts(): Promise<Array<{ id: number; steamId: string; accountName: string; nickname: string; isActive: boolean; lastLoginAt: string | null; hasToken: boolean }>>;
    switchAccount(steamId: string): Promise<{ success: boolean; error?: string }>;
    updateNickname(params: { steamId: string; nickname: string }): Promise<{ success: boolean }>;
    deleteAccount(steamId: string): Promise<{ success: boolean }>;
  };
  inventory: {
    getItems(filter?: Record<string, unknown>): Promise<{ items: unknown[]; total: number; stats: unknown }>;
    refresh(): Promise<void>;
    inspectItem(assetId: string, mode?: string): Promise<unknown>;
    export(): Promise<string>;
    getStats(): Promise<unknown>;
  };
  tradeup: {
    simulate(items: unknown[]): Promise<unknown>;
    execute(assetIds: string[], recipeIndex?: number): Promise<unknown>;
    getHistory(page?: number): Promise<unknown>;
    getHistoryItem(id: number): Promise<unknown>;
  };
  recipe: {
    list(): Promise<unknown[]>;
    get(id: number): Promise<unknown>;
    save(recipe: unknown): Promise<unknown>;
    delete(id: number): Promise<void>;
    export(id: number): Promise<string>;
    import(json: string): Promise<unknown>;
  };
  price: {
    fetch(marketHashNames: string[]): Promise<unknown[]>;
    getCache(filter?: Record<string, unknown>): Promise<unknown[]>;
    getHistory(marketHashName: string, days?: number): Promise<unknown[]>;
    refreshAll(): Promise<void>;
    getSummary(): Promise<unknown>;
  };
  data: {
    downloadCSGOAPI(lang?: 'en' | 'zh-CN'): Promise<{ progress: number; done: boolean }>;
    getStatus(): Promise<{ csgoapiDownloaded: boolean; csgoapiLang: string }>;
    clearCache(): Promise<void>;
  };
  app: {
    getVersion(): Promise<string>;
    openDataDir(): Promise<void>;
    openLogsDir(): Promise<void>;
  };
  onSteamStatus(callback: (status: unknown) => void): () => void;
  onGcStatus(callback: (status: unknown) => void): () => void;
  onItemChanged(callback: (item: unknown) => void): () => void;
  onItemRemoved(callback: (assetId: string) => void): () => void;
  onCraftComplete(callback: (result: unknown) => void): () => void;
  onPriceUpdated(callback: (data: unknown[]) => void): () => void;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
