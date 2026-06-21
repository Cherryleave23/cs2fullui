/**
 * Type declaration for window.electronAPI exposed by the preload script.
 */
export interface ElectronAPI {
  auth: {
    login(params: {
      accountName: string;
      password: string;
      proxyUrl?: string;
      webCompatibilityMode?: boolean;
    }): Promise<{ success: boolean; steamId?: string; error?: string; needSteamGuard?: boolean }>;
    logout(): Promise<void>;
    getStatus(): Promise<{ status: string; steamId: string | null }>;
    submitSteamGuard(code: string): Promise<void>;
    getProxyConfig(): Promise<{ proxyUrl: string }>;
    setProxyConfig(config: { proxyUrl: string }): Promise<void>;
    getAccounts(): Promise<Array<{ id: number; steamId: string; accountName: string }>>;
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
