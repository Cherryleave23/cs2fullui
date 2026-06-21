import { dbAll, dbGet, dbRun, saveDatabase } from '../connection';

export interface AccountRow {
  id: number;
  steam_id: string;
  account_name: string;
  nickname: string | null;
  avatar_url: string | null;
  refresh_token: string | null;
  machine_token: string | null;
  shared_secret: string | null;
  proxy_url: string | null;
  web_compat: number;
  is_active: number;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
}

export const AccountRepo = {
  getAll(): AccountRow[] {
    return dbAll<AccountRow>('SELECT * FROM accounts ORDER BY last_login_at DESC');
  },

  getById(id: number): AccountRow | null {
    return dbGet<AccountRow>('SELECT * FROM accounts WHERE id = ?', [id]);
  },

  getBySteamId(steamId: string): AccountRow | null {
    return dbGet<AccountRow>('SELECT * FROM accounts WHERE steam_id = ?', [steamId]);
  },

  upsert(params: {
    steamId: string;
    accountName: string;
    nickname?: string | null;
    refreshToken?: string | null;
    machineToken?: string | null;
    sharedSecret?: string | null;
    proxyUrl?: string | null;
    webCompat?: boolean;
  }): AccountRow {
    const existing = this.getBySteamId(params.steamId);
    if (existing) {
      dbRun(
        `UPDATE accounts SET
          account_name = ?,
          nickname = COALESCE(?, nickname),
          refresh_token = COALESCE(?, refresh_token),
          machine_token = COALESCE(?, machine_token),
          shared_secret = COALESCE(?, shared_secret),
          proxy_url = COALESCE(?, proxy_url),
          web_compat = ?,
          last_login_at = datetime('now'),
          updated_at = datetime('now')
        WHERE steam_id = ?`,
        [
          params.accountName,
          params.nickname ?? null,
          params.refreshToken ?? null,
          params.machineToken ?? null,
          params.sharedSecret ?? null,
          params.proxyUrl ?? null,
          params.webCompat ? 1 : 0,
          params.steamId,
        ]
      );
    } else {
      dbRun(
        `INSERT INTO accounts (steam_id, account_name, nickname, refresh_token, machine_token, shared_secret, proxy_url, web_compat, last_login_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
        [
          params.steamId,
          params.accountName,
          params.nickname ?? params.accountName,
          params.refreshToken ?? null,
          params.machineToken ?? null,
          params.sharedSecret ?? null,
          params.proxyUrl ?? null,
          params.webCompat ? 1 : 0,
        ]
      );
    }
    saveDatabase();
    return this.getBySteamId(params.steamId)!;
  },

  /** Mark account as active, deactivate others */
  setActive(steamId: string): void {
    dbRun('UPDATE accounts SET is_active = 0');
    dbRun('UPDATE accounts SET is_active = 1 WHERE steam_id = ?', [steamId]);
    saveDatabase();
  },

  /** Get the currently active account */
  getActive(): AccountRow | null {
    return dbGet<AccountRow>('SELECT * FROM accounts WHERE is_active = 1 LIMIT 1');
  },

  /** Update nickname for an account */
  updateNickname(steamId: string, nickname: string): void {
    dbRun('UPDATE accounts SET nickname = ?, updated_at = datetime(\'now\') WHERE steam_id = ?', [nickname, steamId]);
    saveDatabase();
  },

  updateToken(steamId: string, refreshToken: string): void {
    dbRun(
      `UPDATE accounts SET refresh_token = ?, updated_at = datetime('now') WHERE steam_id = ?`,
      [refreshToken, steamId]
    );
    saveDatabase();
  },

  updateMachineToken(steamId: string, machineToken: string): void {
    dbRun(
      `UPDATE accounts SET machine_token = ?, updated_at = datetime('now') WHERE steam_id = ?`,
      [machineToken, steamId]
    );
    saveDatabase();
  },

  updateSharedSecret(steamId: string, sharedSecret: string): void {
    dbRun(
      `UPDATE accounts SET shared_secret = ?, updated_at = datetime('now') WHERE steam_id = ?`,
      [sharedSecret, steamId]
    );
    saveDatabase();
  },

  setProxy(steamId: string, proxyUrl: string | null): void {
    dbRun(
      `UPDATE accounts SET proxy_url = ?, updated_at = datetime('now') WHERE steam_id = ?`,
      [proxyUrl, steamId]
    );
    saveDatabase();
  },

  delete(steamId: string): void {
    dbRun('DELETE FROM accounts WHERE steam_id = ?', [steamId]);
    saveDatabase();
  },
};
