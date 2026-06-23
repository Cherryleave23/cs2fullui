/**
 * Auth IPC — multi-account login, switch, logout.
 */
import { ipcMain, BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '../../shared/ipc-channels';
import { AccountRepo } from '../db/repositories/account.repo';
import { accountManager } from '../services/account-manager';
import { bindInventorySync } from '../services/inventory-sync.service';

function mainWindow() { return BrowserWindow.getAllWindows()[0]; }

export function registerAuthIpc(): void {
  // ═══════════════════════════════════════
  //  LOGIN (single account)
  // ═══════════════════════════════════════
  ipcMain.handle(IPC_CHANNELS.AUTH_LOGIN, async (_e: any, params: {
    accountName: string; password: string;
    proxyUrl?: string; nickname?: string;
  }) => {
    try {
      const existing = AccountRepo.getAll().find(a => a.account_name === params.accountName);
      const bot = accountManager.getOrCreate(existing?.steam_id || params.accountName);

      // Already logged in
      if (bot.steamId) {
        return { success: true, steamId: bot.steamId, alreadyLoggedIn: true };
      }

      // Wire guard event
      bot.removeAllListeners('steamGuardNeeded');
      bot.on('steamGuardNeeded', (info: { domain: string | null; lastCodeWrong: boolean; cooldown: number }) => {
        mainWindow()?.webContents.send(IPC_CHANNELS.PUSH_STEAM_STATUS, {
          steamGuardNeeded: true,
          lastCodeWrong: info.lastCodeWrong,
          cooldown: info.cooldown,
        });
      });

      const result = await bot.login(params);
      if (result.success && result.steamId) {
        // Connect GC
        await accountManager.connectGC(result.steamId);
      }
      return result;
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // ═══════════════════════════════════════
  //  LOGIN ALL SAVED (startup)
  // ═══════════════════════════════════════
  ipcMain.handle('auth:login-all', async () => {
    try {
      const loggedIn = await accountManager.loginAllSaved();
      // Sync inventory for active account
      const activeSteamId = accountManager.getActiveSteamId();
      if (activeSteamId) {
        const acc = AccountRepo.getBySteamId(activeSteamId);
        if (acc) {
          const bot = accountManager.get(activeSteamId);
          if (bot?.isGCReady) {
            mainWindow()?.webContents.send(IPC_CHANNELS.PUSH_STEAM_STATUS, { inventorySynced: true });
          }
        }
      }
      return { success: true, count: loggedIn.length };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // ═══════════════════════════════════════
  //  SUBMIT STEAM GUARD CODE
  // ═══════════════════════════════════════
  ipcMain.handle(IPC_CHANNELS.AUTH_SUBMIT_STEAM_GUARD, async (_e: any, params: {
    accountName: string; code: string;
  }) => {
    const existing = AccountRepo.getAll().find(a => a.account_name === params.accountName);
    const bot = accountManager.get(existing?.steam_id || params.accountName);
    if (bot) {
      bot.submitSteamGuard(params.code);
      return { success: true };
    }
    return { success: false, error: 'No pending Steam Guard for this account' };
  });

  // ═══════════════════════════════════════
  //  LOGOUT
  // ═══════════════════════════════════════
  ipcMain.handle(IPC_CHANNELS.AUTH_LOGOUT, async (_e: any, params?: { steamId?: string }) => {
    if (params?.steamId) {
      accountManager.remove(params.steamId);
    } else {
      // Logout all
      for (const state of accountManager.listStates()) {
        accountManager.remove(state.steamId);
      }
    }
    return { success: true };
  });

  // ═══════════════════════════════════════
  //  STATUS
  // ═══════════════════════════════════════
  ipcMain.handle(IPC_CHANNELS.AUTH_GET_STATUS, async () => {
    const steamId = accountManager.getActiveSteamId();
    const bot = steamId ? accountManager.get(steamId) : undefined;
    return {
      state: bot?.isGCReady ? 'gc_ready' : bot?.steamId ? 'logged_in' : 'idle',
      steamId: bot?.steamId || null,
      accountName: bot?.accountName || null,
      nickname: bot?.nickname || null,
      isGCReady: bot?.isGCReady || false,
      accounts: accountManager.listStates(),
    };
  });

  // ═══════════════════════════════════════
  //  ACCOUNTS LIST
  // ═══════════════════════════════════════
  ipcMain.handle(IPC_CHANNELS.AUTH_GET_ACCOUNTS, async () => {
    const states = accountManager.listStates();
    return AccountRepo.getAll().map(a => {
      const s = states.find(st => st.steamId === a.steam_id);
      return {
        id: a.id, steamId: a.steam_id, accountName: a.account_name,
        nickname: a.nickname || a.account_name, isActive: a.is_active === 1,
        lastLoginAt: a.last_login_at, hasToken: !!a.refresh_token,
        isOnline: s?.loggedIn ?? false, gcReady: s?.gcReady ?? false,
      };
    });
  });

  // ═══════════════════════════════════════
  //  SWITCH active GC account
  // ═══════════════════════════════════════
  ipcMain.handle('auth:switch', async (_e: any, steamId: string) => {
    try {
      await accountManager.connectGC(steamId);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // ═══════════════════════════════════════
  //  NICKNAME / DELETE / PROXY
  // ═══════════════════════════════════════
  ipcMain.handle('auth:update-nickname', async (_e: any, p: { steamId: string; nickname: string }) => {
    AccountRepo.updateNickname(p.steamId, p.nickname); return { success: true };
  });
  ipcMain.handle('auth:delete-account', async (_e: any, steamId: string) => {
    accountManager.remove(steamId); return { success: true };
  });
  ipcMain.handle(IPC_CHANNELS.AUTH_GET_PROXY_CONFIG, async (_e: any, steamId?: string) => {
    if (steamId) return { proxyUrl: AccountRepo.getBySteamId(steamId)?.proxy_url || '' };
    return { proxyUrl: AccountRepo.getActive()?.proxy_url || '' };
  });
  ipcMain.handle(IPC_CHANNELS.AUTH_SET_PROXY_CONFIG, async (_e: any, p: { steamId?: string; proxyUrl: string }) => {
    if (p.steamId) AccountRepo.setProxy(p.steamId, p.proxyUrl || null);
    else { const a = AccountRepo.getActive(); if (a) AccountRepo.setProxy(a.steam_id, p.proxyUrl || null); }
    return { success: true };
  });
}
