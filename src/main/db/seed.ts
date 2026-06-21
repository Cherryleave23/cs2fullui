import { SettingsRepo } from './repositories/settings.repo';

/** Rarity order and metadata used throughout the app */
export const RARITY_DATA = [
  { id: 0, name: 'Consumer', nameZh: '消费级', color: '#b0c4d8', order: 0 },
  { id: 1, name: 'Industrial', nameZh: '工业级', color: '#5e98d9', order: 1 },
  { id: 2, name: 'Mil-Spec', nameZh: '军规级', color: '#4b69ff', order: 2 },
  { id: 3, name: 'Restricted', nameZh: '受限级', color: '#8847ff', order: 3 },
  { id: 4, name: 'Classified', nameZh: '保密级', color: '#d32ce6', order: 4 },
  { id: 5, name: 'Covert', nameZh: '隐秘级', color: '#eb4b4b', order: 5 },
  { id: 6, name: 'Rare Special', nameZh: '稀有特殊', color: '#ffd700', order: 6 },
  { id: 7, name: 'Contraband', nameZh: '违禁品', color: '#ffae39', order: 7 },
];

/** CS2 wear categories with float ranges */
export const WEAR_DATA = [
  { name: 'Factory New', nameZh: '崭新出厂', minFloat: 0.00, maxFloat: 0.07 },
  { name: 'Minimal Wear', nameZh: '略有磨损', minFloat: 0.07, maxFloat: 0.15 },
  { name: 'Field-Tested', nameZh: '久经沙场', minFloat: 0.15, maxFloat: 0.38 },
  { name: 'Well-Worn', nameZh: '破损不堪', minFloat: 0.38, maxFloat: 0.45 },
  { name: 'Battle-Scarred', nameZh: '战痕累累', minFloat: 0.45, maxFloat: 1.00 },
];

/** Rarity name → next rarity mapping (for trade-up targeting) */
export function getNextRarity(rarity: number): { id: number; name: string; nameZh: string } | null {
  const next = RARITY_DATA.find(r => r.order === rarity + 1);
  return next ? { id: next.id, name: next.name, nameZh: next.nameZh } : null;
}

/** Determine wear category from float value */
export function getWearCategory(floatValue: number): { name: string; nameZh: string } {
  for (const w of WEAR_DATA) {
    if (floatValue >= w.minFloat && floatValue < w.maxFloat) {
      return { name: w.name, nameZh: w.nameZh };
    }
  }
  return { name: 'Battle-Scarred', nameZh: '战痕累累' };
}

/** Seed reference data into app_settings (first run) */
export function seedReferenceData(): void {
  try {
    const seeded = SettingsRepo.get('_seed_version');
    if (seeded === '1') return;

    SettingsRepo.set('rarity_data', RARITY_DATA);
    SettingsRepo.set('wear_data', WEAR_DATA);
    SettingsRepo.set('_seed_version', '1');
    console.log('[DB] Reference data seeded');
  } catch (err: any) {
    // Table may not exist yet on fresh DB — migrations handle that
    if (err.message?.includes('no such table')) {
      console.log('[DB] Seed skipped — migrations will create tables');
      return;
    }
    console.error('[DB] Seed error:', err.message);
  }
}
