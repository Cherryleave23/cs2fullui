/**
 * All IPC channel name constants.
 * Pattern: {domain}:{action}
 * Push events: push:{event-name}
 */
export const IPC_CHANNELS = {
  // ── Authentication ──
  AUTH_LOGIN:               'auth:login',
  AUTH_LOGOUT:              'auth:logout',
  AUTH_GET_STATUS:          'auth:get-status',
  AUTH_SUBMIT_STEAM_GUARD:  'auth:submit-steam-guard',
  AUTH_GET_PROXY_CONFIG:    'auth:get-proxy-config',
  AUTH_SET_PROXY_CONFIG:    'auth:set-proxy-config',
  AUTH_GET_ACCOUNTS:        'auth:get-accounts',

  // ── Inventory ──
  INVENTORY_GET_ITEMS:      'inventory:get-items',
  INVENTORY_REFRESH:        'inventory:refresh',
  INVENTORY_INSPECT_ITEM:   'inventory:inspect-item',
  INVENTORY_EXPORT:         'inventory:export',
  INVENTORY_GET_STATS:      'inventory:get-stats',

  // ── Trade-Up ──
  TRADEUP_SIMULATE:         'tradeup:simulate',
  TRADEUP_EXECUTE:          'tradeup:execute',
  TRADEUP_GET_HISTORY:      'tradeup:get-history',
  TRADEUP_GET_HISTORY_ITEM: 'tradeup:get-history-item',

  // ── Recipes ──
  RECIPE_LIST:              'recipe:list',
  RECIPE_GET:               'recipe:get',
  RECIPE_SAVE:              'recipe:save',
  RECIPE_DELETE:            'recipe:delete',
  RECIPE_EXPORT:            'recipe:export',
  RECIPE_IMPORT:            'recipe:import',

  // ── Prices ──
  PRICE_FETCH:              'price:fetch',
  PRICE_GET_CACHE:          'price:get-cache',
  PRICE_GET_HISTORY:        'price:get-history',
  PRICE_REFRESH_ALL:        'price:refresh-all',
  PRICE_GET_SUMMARY:        'price:get-summary',

  // ── Data Management ──
  DATA_DOWNLOAD_CSGOAPI:    'data:download-csgoapi',
  DATA_GET_STATUS:          'data:get-status',
  DATA_CLEAR_CACHE:         'data:clear-cache',

  // ── Settings ──
  SETTINGS_GET_CSQA_TOKEN:  'settings:get-csqa-token',
  SETTINGS_SET_CSQA_TOKEN:  'settings:set-csqa-token',
  PRICE_FETCH_INVENTORY:    'price:fetch-inventory',

  // ── App ──
  APP_GET_VERSION:          'app:get-version',
  APP_OPEN_DATA_DIR:        'app:open-data-dir',
  APP_OPEN_LOGS_DIR:        'app:open-logs-dir',

  // ── Push Events (main → renderer) ──
  PUSH_STEAM_STATUS:        'push:steam-status',
  PUSH_GC_STATUS:           'push:gc-status',
  PUSH_ITEM_CHANGED:        'push:item-changed',
  PUSH_ITEM_REMOVED:        'push:item-removed',
  PUSH_CRAFT_COMPLETE:      'push:craft-complete',
  PUSH_PRICE_UPDATED:       'push:price-updated',
} as const;

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];
