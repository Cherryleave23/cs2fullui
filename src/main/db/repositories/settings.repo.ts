import { dbAll, dbGet, dbRun, saveDatabase } from '../connection';

export interface SettingRow {
  key: string;
  value: string;
  updated_at: string;
}

export const SettingsRepo = {
  /** Get a setting value by key */
  get(key: string, defaultValue?: string): string | null {
    const row = dbGet<SettingRow>('SELECT * FROM app_settings WHERE key = ?', [key]);
    return row?.value ?? defaultValue ?? null;
  },

  /** Get a setting as a number */
  getNumber(key: string, defaultValue = 0): number {
    const val = this.get(key);
    return val !== null ? Number(val) : defaultValue;
  },

  /** Get a setting as a boolean */
  getBool(key: string, defaultValue = false): boolean {
    const val = this.get(key);
    if (val === null) return defaultValue;
    return val === 'true' || val === '1';
  },

  /** Get a setting as parsed JSON */
  getJson<T = unknown>(key: string, defaultValue?: T): T | null {
    const val = this.get(key);
    if (val === null) return defaultValue ?? null;
    try {
      return JSON.parse(val) as T;
    } catch {
      return defaultValue ?? null;
    }
  },

  /** Set a setting value */
  set(key: string, value: string | number | boolean | object): void {
    const strValue = typeof value === 'object' ? JSON.stringify(value) : String(value);
    dbRun(
      `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      [key, strValue]
    );
    saveDatabase();
  },

  /** Get all settings */
  getAll(): Record<string, string> {
    const rows = dbAll<SettingRow>('SELECT * FROM app_settings ORDER BY key');
    return Object.fromEntries(rows.map(r => [r.key, r.value]));
  },

  /** Delete a setting */
  delete(key: string): void {
    dbRun('DELETE FROM app_settings WHERE key = ?', [key]);
    saveDatabase();
  },
};
