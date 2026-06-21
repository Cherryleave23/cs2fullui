/** CS2 item rarity values (matching proto_enum EItemRarity) */
export enum ItemRarity {
  Consumer = 0,
  Industrial = 1,
  MilSpec = 2,
  Restricted = 3,
  Classified = 4,
  Covert = 5,
  RareSpecial = 6, // knives, gloves
  Contraband = 7,
}

/** CS2 item quality values */
export enum ItemQuality {
  Normal = 4,
  StatTrak = 9,
  Souvenir = 12,
}

/** Wear / float categories */
export enum WearCategory {
  FactoryNew = 'Factory New',
  MinimalWear = 'Minimal Wear',
  FieldTested = 'Field-Tested',
  WellWorn = 'Well-Worn',
  BattleScarred = 'Battle-Scarred',
}

/** GC connection status */
export enum GcConnectionStatus {
  DISCONNECTED = 0,
  CONNECTING = 1,
  CONNECTED = 2,
}

/** Steam login status */
export enum SteamLoginStatus {
  IDLE = 'idle',
  CONNECTING = 'connecting',
  LOGGED_IN = 'logged_in',
  GC_CONNECTING = 'gc_connecting',
  GC_READY = 'gc_ready',
  ERROR = 'error',
}

/** Price data sources */
export enum PriceSource {
  BUFF = 'buff',
  STEAM_MARKET = 'steam_market',
}
