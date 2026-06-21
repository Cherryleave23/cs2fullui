import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS } from '../shared/ipc-channels';

/**
 * Typed API exposed to the renderer process via contextBridge.
 * The renderer accesses all Electron functionality through window.electronAPI.
 */
const electronAPI = {
  // ── Auth ──
  auth: {
    login: (params: {
      accountName: string;
      password: string;
      proxyUrl?: string;
      nickname?: string;
      webCompatibilityMode?: boolean;
    }) => ipcRenderer.invoke(IPC_CHANNELS.AUTH_LOGIN, params),
    logout: (params?: { accountName?: string }) =>
      ipcRenderer.invoke(IPC_CHANNELS.AUTH_LOGOUT, params),
    getStatus: () => ipcRenderer.invoke(IPC_CHANNELS.AUTH_GET_STATUS),
    submitSteamGuard: (params: { accountName: string; code: string }) =>
      ipcRenderer.invoke(IPC_CHANNELS.AUTH_SUBMIT_STEAM_GUARD, params),
    getProxyConfig: (steamId?: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.AUTH_GET_PROXY_CONFIG, steamId),
    setProxyConfig: (params: { steamId?: string; proxyUrl: string }) =>
      ipcRenderer.invoke(IPC_CHANNELS.AUTH_SET_PROXY_CONFIG, params),
    getAccounts: () => ipcRenderer.invoke(IPC_CHANNELS.AUTH_GET_ACCOUNTS),
    switchAccount: (steamId: string) =>
      ipcRenderer.invoke('auth:switch', steamId),
    updateNickname: (params: { steamId: string; nickname: string }) =>
      ipcRenderer.invoke('auth:update-nickname', params),
    deleteAccount: (steamId: string) =>
      ipcRenderer.invoke('auth:delete-account', steamId),
  },

  // ── Inventory ──
  inventory: {
    getItems: (filter?: Record<string, unknown>) =>
      ipcRenderer.invoke(IPC_CHANNELS.INVENTORY_GET_ITEMS, filter),
    refresh: () => ipcRenderer.invoke(IPC_CHANNELS.INVENTORY_REFRESH),
    inspectItem: (assetId: string, mode?: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.INVENTORY_INSPECT_ITEM, assetId, mode),
    export: () => ipcRenderer.invoke(IPC_CHANNELS.INVENTORY_EXPORT),
    getStats: () => ipcRenderer.invoke(IPC_CHANNELS.INVENTORY_GET_STATS),
  },

  // ── Trade-Up ──
  tradeup: {
    simulate: (items: unknown[]) =>
      ipcRenderer.invoke(IPC_CHANNELS.TRADEUP_SIMULATE, items),
    execute: (assetIds: string[], recipeIndex?: number) =>
      ipcRenderer.invoke(IPC_CHANNELS.TRADEUP_EXECUTE, assetIds, recipeIndex),
    getHistory: (page?: number) =>
      ipcRenderer.invoke(IPC_CHANNELS.TRADEUP_GET_HISTORY, page),
    getHistoryItem: (id: number) =>
      ipcRenderer.invoke(IPC_CHANNELS.TRADEUP_GET_HISTORY_ITEM, id),
  },

  // ── Recipes ──
  recipe: {
    list: () => ipcRenderer.invoke(IPC_CHANNELS.RECIPE_LIST),
    get: (id: number) => ipcRenderer.invoke(IPC_CHANNELS.RECIPE_GET, id),
    save: (recipe: unknown) => ipcRenderer.invoke(IPC_CHANNELS.RECIPE_SAVE, recipe),
    delete: (id: number) => ipcRenderer.invoke(IPC_CHANNELS.RECIPE_DELETE, id),
    export: (id: number) => ipcRenderer.invoke(IPC_CHANNELS.RECIPE_EXPORT, id),
    import: (json: string) => ipcRenderer.invoke(IPC_CHANNELS.RECIPE_IMPORT, json),
  },

  // ── Prices ──
  price: {
    fetch: (marketHashNames: string[]) =>
      ipcRenderer.invoke(IPC_CHANNELS.PRICE_FETCH, marketHashNames),
    getCache: (filter?: Record<string, unknown>) =>
      ipcRenderer.invoke(IPC_CHANNELS.PRICE_GET_CACHE, filter),
    getHistory: (marketHashName: string, days?: number) =>
      ipcRenderer.invoke(IPC_CHANNELS.PRICE_GET_HISTORY, marketHashName, days),
    refreshAll: () => ipcRenderer.invoke(IPC_CHANNELS.PRICE_REFRESH_ALL),
    getSummary: () => ipcRenderer.invoke(IPC_CHANNELS.PRICE_GET_SUMMARY),
  },

  // ── Data ──
  data: {
    downloadCSGOAPI: (lang?: 'en' | 'zh-CN') =>
      ipcRenderer.invoke(IPC_CHANNELS.DATA_DOWNLOAD_CSGOAPI, lang),
    getStatus: () => ipcRenderer.invoke(IPC_CHANNELS.DATA_GET_STATUS),
    clearCache: () => ipcRenderer.invoke(IPC_CHANNELS.DATA_CLEAR_CACHE),
  },

  // ── App ──
  app: {
    getVersion: () => ipcRenderer.invoke(IPC_CHANNELS.APP_GET_VERSION),
    openDataDir: () => ipcRenderer.invoke(IPC_CHANNELS.APP_OPEN_DATA_DIR),
    openLogsDir: () => ipcRenderer.invoke(IPC_CHANNELS.APP_OPEN_LOGS_DIR),
  },

  // ── Direct Steam login + token persistence ──
  steamLogin: (params: { accountName: string; password: string; proxyUrl?: string; nickname?: string }) =>
    ipcRenderer.invoke('steam:login', params),
  steamGuard: (params: { code: string }) =>
    ipcRenderer.invoke('steam:guard', params),
  steamListSaved: () => ipcRenderer.invoke('steam:list-saved'),
  steamStatus: () => ipcRenderer.invoke('steam:status'),
  onSteamLog: (callback: (data: unknown) => void) => {
    const handler = (_event: any, data: unknown) => callback(data);
    ipcRenderer.on('push:steam-log', handler);
    return () => ipcRenderer.removeListener('push:steam-log', handler);
  },

  // ── Event Subscriptions (returns unsubscribe function) ──
  onSteamStatus: (callback: (status: unknown) => void) => {
    const handler = (_event: any, status: unknown) => callback(status);
    ipcRenderer.on(IPC_CHANNELS.PUSH_STEAM_STATUS, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.PUSH_STEAM_STATUS, handler);
  },
  onGcStatus: (callback: (status: unknown) => void) => {
    const handler = (_event: any, status: unknown) => callback(status);
    ipcRenderer.on(IPC_CHANNELS.PUSH_GC_STATUS, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.PUSH_GC_STATUS, handler);
  },
  onItemChanged: (callback: (item: unknown) => void) => {
    const handler = (_event: any, item: unknown) => callback(item);
    ipcRenderer.on(IPC_CHANNELS.PUSH_ITEM_CHANGED, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.PUSH_ITEM_CHANGED, handler);
  },
  onItemRemoved: (callback: (assetId: string) => void) => {
    const handler = (_event: any, assetId: string) => callback(assetId);
    ipcRenderer.on(IPC_CHANNELS.PUSH_ITEM_REMOVED, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.PUSH_ITEM_REMOVED, handler);
  },
  onCraftComplete: (callback: (result: unknown) => void) => {
    const handler = (_event: any, result: unknown) => callback(result);
    ipcRenderer.on(IPC_CHANNELS.PUSH_CRAFT_COMPLETE, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.PUSH_CRAFT_COMPLETE, handler);
  },
  onPriceUpdated: (callback: (data: unknown[]) => void) => {
    const handler = (_event: any, data: unknown[]) => callback(data);
    ipcRenderer.on(IPC_CHANNELS.PUSH_PRICE_UPDATED, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.PUSH_PRICE_UPDATED, handler);
  },
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);

export type ElectronAPI = typeof electronAPI;
