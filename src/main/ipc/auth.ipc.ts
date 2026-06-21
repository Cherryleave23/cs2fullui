import { ipcMain, BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '../../shared/ipc-channels';
import { AccountRepo } from '../db/repositories/account.repo';
import { accountManager } from '../services/account-manager';
import { bindInventorySync } from '../services/inventory-sync.service';

export function registerAuthIpc(): void {
  // ── Login ──
  ipcMain.handle(IPC_CHANNELS.AUTH_LOGIN, async (_event: any, params: {
    accountName: string;
    password: string;
    proxyUrl?: string;
    nickname?: string;
    webCompatibilityMode?: boolean;
  }) => {
    try {
      // Try to find existing account by accountName
      const existing = AccountRepo.getAll().find(a => a.account_name === params.accountName);

      const bot = accountManager.getOrCreate(existing?.steam_id || params.accountName);
      const botStatus = bot.getStatus();

      // If already logged in or connecting, don't re-login
      if (botStatus.state === 'logged_in' || botStatus.state === 'gc_ready') {
        return {
          success: true,
          steamId: botStatus.steamId,
          alreadyLoggedIn: true,
        };
      }

      // Hook Steam Guard — use once() to avoid listener leak on repeated logins
      const guardHandler = (_domain: string | null, lastWrong: boolean) => {
        const mainWindow = BrowserWindow.getAllWindows()[0];
        if (mainWindow) {
          mainWindow.webContents.send(IPC_CHANNELS.PUSH_STEAM_STATUS, {
            steamGuardNeeded: true,
            lastCodeWrong: lastWrong,
            accountName: params.accountName,
          });
        }
      };
      bot.on('steamGuard', guardHandler);

      const result = await bot.login({
        accountName: params.accountName,
        password: params.password,
        proxyUrl: params.proxyUrl,
        nickname: params.nickname || existing?.nickname || params.accountName,
      });

      // Cleanup guard listener after login completes (success or fail)
      bot.removeListener('steamGuard', guardHandler);

      if (result.success && result.steamId) {
        // Update nickname if provided
        if (params.nickname) {
          AccountRepo.updateNickname(result.steamId, params.nickname);
        }
        AccountRepo.setActive(result.steamId);

        // Bind inventory sync on first GC connect
        bindInventorySync(bot, existing?.id || 0, {
          onSyncComplete: (count) => {
            const mainWindow = BrowserWindow.getAllWindows()[0];
            mainWindow?.webContents.send(IPC_CHANNELS.PUSH_STEAM_STATUS, {
              inventorySynced: true, count, accountName: params.accountName,
            });
          },
          onItemUpdate: (_item) => {
            BrowserWindow.getAllWindows()[0]?.webContents.send(IPC_CHANNELS.PUSH_ITEM_CHANGED, _item);
          },
          onItemRemove: (assetId) => {
            BrowserWindow.getAllWindows()[0]?.webContents.send(IPC_CHANNELS.PUSH_ITEM_REMOVED, assetId);
          },
        });
      }

      return result;
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // ── Submit Steam Guard code ──
  ipcMain.handle(IPC_CHANNELS.AUTH_SUBMIT_STEAM_GUARD, async (_event: any, params: {
    accountName: string;
    code: string;
  }) => {
    const existing = AccountRepo.getAll().find(a => a.account_name === params.accountName);
    const bot = accountManager.get(existing?.steam_id || params.accountName);
    if (bot) {
      bot.submitSteamGuard(params.code);
      return { success: true };
    }
    return { success: false, error: 'No pending Steam Guard for this account' };
  });

  // ── Logout ──
  ipcMain.handle(IPC_CHANNELS.AUTH_LOGOUT, async (_event: any, params?: { accountName?: string }) => {
    if (params?.accountName) {
      const existing = AccountRepo.getAll().find(a => a.account_name === params.accountName);
      if (existing) accountManager.remove(existing.steam_id);
    } else {
      // Logout all
      const all = AccountRepo.getAll();
      for (const a of all) accountManager.remove(a.steam_id);
    }
    return { success: true };
  });

  // ── Get status ──
  ipcMain.handle(IPC_CHANNELS.AUTH_GET_STATUS, async () => {
    const active = accountManager.getActive();
    const status = active?.getStatus();
    return {
      state: status?.state || 'idle',
      steamId: status?.steamId || null,
      accountName: status?.accountName || null,
      nickname: status?.nickname || null,
      isGCReady: active?.isGCReady() || false,
    };
  });

  // ── List all accounts ──
  ipcMain.handle(IPC_CHANNELS.AUTH_GET_ACCOUNTS, async () => {
    return AccountRepo.getAll().map(a => ({
      id: a.id,
      steamId: a.steam_id,
      accountName: a.account_name,
      nickname: a.nickname || a.account_name,
      isActive: a.is_active === 1,
      lastLoginAt: a.last_login_at,
      hasToken: !!a.refresh_token,
    }));
  });

  // ── Switch active account ──
  ipcMain.handle('auth:switch', async (_event: any, steamId: string) => {
    try {
      await accountManager.switchTo(steamId);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // ── Update nickname ──
  ipcMain.handle('auth:update-nickname', async (_event: any, params: {
    steamId: string;
    nickname: string;
  }) => {
    AccountRepo.updateNickname(params.steamId, params.nickname);
    return { success: true };
  });

  // ── Delete account ──
  ipcMain.handle('auth:delete-account', async (_event: any, steamId: string) => {
    accountManager.remove(steamId);
    return { success: true };
  });

  // ── Proxy config (per account) ──
  ipcMain.handle(IPC_CHANNELS.AUTH_GET_PROXY_CONFIG, async (_event: any, steamId?: string) => {
    if (steamId) {
      const account = AccountRepo.getBySteamId(steamId);
      return { proxyUrl: account?.proxy_url || '' };
    }
    const active = AccountRepo.getActive();
    return { proxyUrl: active?.proxy_url || '' };
  });

  ipcMain.handle(IPC_CHANNELS.AUTH_SET_PROXY_CONFIG, async (_event: any, params: {
    steamId?: string;
    proxyUrl: string;
  }) => {
    if (params.steamId) {
      AccountRepo.setProxy(params.steamId, params.proxyUrl || null);
    } else {
      const active = AccountRepo.getActive();
      if (active) AccountRepo.setProxy(active.steam_id, params.proxyUrl || null);
    }
    return { success: true };
  });
}
