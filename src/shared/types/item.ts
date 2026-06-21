/** Core resolved CS2 item type — shared between main and renderer processes */
export interface ResolvedItem {
  /** CSOEconItem.id — unique identifier from GC */
  assetId: string;
  /** CSOEconItem.def_index — paint kit definition index */
  defIndex: number;
  /** Item type: skin, sticker, crate, agent, keychain, etc. */
  resolvedType: string;
  /** English human-readable name */
  resolvedName: string;
  /** Chinese human-readable name */
  resolvedNameZh: string;
  /** paint_index from attribute 6 (float value, not integer index) */
  paintIndex: number;
  /** paint_seed from attribute 7 */
  paintSeed: number;
  /** Float value (0.00 - 1.00) */
  paintWear: number;
  /** Numeric rarity (0-7) */
  rarity: number;
  /** Rarity name in English */
  rarityName: string;
  /** Rarity name in Chinese */
  rarityNameZh: string;
  /** Rarity hex color (e.g. #eb4b4b) */
  rarityColor: string;
  /** Numeric quality (4=normal, 9=StatTrak, 12=Souvenir) */
  quality: number;
  /** Numeric origin value */
  origin: number;
  /** Custom name set by user (if any) */
  customName: string;
  /** Wear category: Factory New, Minimal Wear, etc. */
  wearCategory: string;
  /** Wear category in Chinese */
  wearCategoryZh: string;
  /** Minimum possible float for this skin */
  minFloat: number;
  /** Maximum possible float for this skin */
  maxFloat: number;
  /** market_hash_name — used for price lookups */
  marketHashName: string;
  /** Weapon type category: Pistols, Rifles, SMGs, etc. */
  weaponType: string;
  /** Collection name */
  collectionName: string;
  /** Image URL from CSGO-API CDN */
  imageUrl: string;
  /** Kill eater value (StatTrak count) */
  killEaterValue: number;
  /** Kill eater score type */
  killEaterScoreType: number;
  /** Storage unit container ID (if stored in a casket) */
  casketId: string;
  /** When the item becomes tradable */
  tradableAfter: string;
  /** Inventory position */
  position: number;
  /** Whether item is equipped */
  inUse: boolean;
  /** Whether item is StatTrak */
  isStatTrak: boolean;
  /** Whether item is Souvenir */
  isSouvenir: boolean;
  /** Sticker/keychain data as parsed JSON */
  extraJson: string;
}
