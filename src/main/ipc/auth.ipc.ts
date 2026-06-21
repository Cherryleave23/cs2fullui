import { ipcMain, BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '../../shared/ipc-channels';
import { AccountRepo } from '../db/repositories/account.repo';
import type { SteamBotService } from '../services/steam-bot.service';

let pendingSteamGuardCallback: ((code: string) => void) | null = null;

/**
 * Register authentication IPC handlers.
 * @param botGetter Function returning the current SteamBotService instance
 */
export function registerAuthIpc(botGetter: () => SteamBotService | null): void {
  // ── Login ──
  ipcMain.handle(IPC_CHANNELS.AUTH_LOGIN, async (_event, params: {
    accountName: string;
    password: string;
    proxyUrl?: string;
    webCompatibilityMode?: boolean;
  }) => {
    try {
      const bot = botGetter();
      if (!bot) {
        return { success: false, error: 'SteamBot 服务未初始化' };
      }

      // Hook Steam Guard before login
      bot.on('steamGuard', (_domain: any, callback: (code: string) => void, _lastWrong: boolean) => {
        pendingSteamGuardCallback = callback;
        const mainWindow = BrowserWindow.getAllWindows()[0];
        if (mainWindow) {
          mainWindow.webContents.send(IPC_CHANNELS.PUSH_STEAM_STATUS, {
            state: 'steam_guard_required',
            lastCodeWrong: _lastWrong,
          });
        }
      });

      const result = await bot.login(params);

      if (result.success && result.steamId) {
        // Save/update account in DB
        AccountRepo.upsert({
          steamId: result.steamId,
          accountName: params.accountName,
          proxyUrl: params.proxyUrl || null,
          webCompat: params.webCompatibilityMode,
        });
      }

      return result;
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // ── Submit Steam Guard Code ──
  ipcMain.handle(IPC_CHANNELS.AUTH_SUBMIT_STEAM_GUARD, async (_event, code: string) => {
    if (pendingSteamGuardCallback) {
      pendingSteamGuardCallback(code);
      pendingSteamGuardCallback = null;
      return { success: true };
    }
    return { success: false, error: '没有待处理的 Steam Guard 验证' };
  });

  // ── Logout ──
  ipcMain.handle(IPC_CHANNELS.AUTH_LOGOUT, async () => {
    try {
      const bot = botGetter();
      bot?.logout();
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // ── Get Status ──
  ipcMain.handle(IPC_CHANNELS.AUTH_GET_STATUS, async () => {
    const bot = botGetter();
    if (!bot) {
      return { status: 'idle', steamId: null };
    }
    const botStatus = bot.getStatus();
    return {
      status: botStatus.state,
      steamId: botStatus.steamId,
      accountName: botStatus.accountName,
      errorMessage: botStatus.errorMessage,
    };
  });

  // ── Proxy Config ──
  ipcMain.handle(IPC_CHANNELS.AUTH_GET_PROXY_CONFIG, async () => {
    const accounts = AccountRepo.getAll();
    const active = accounts[0];
    return {
      proxyUrl: active?.proxy_url ?? '',
    };
  });

  ipcMain.handle(IPC_CHANNELS.AUTH_SET_PROXY_CONFIG, async (_event, config: { proxyUrl: string }) => {
    const accounts = AccountRepo.getAll();
    const active = accounts[0];
    if (active) {
      AccountRepo.setProxy(active.steam_id, config.proxyUrl || null);
    }
    return { success: true };
  });

  // ── List Accounts ──
  ipcMain.handle(IPC_CHANNELS.AUTH_GET_ACCOUNTS, async () => {
    return AccountRepo.getAll().map(a => ({
      id: a.id,
      steamId: a.steam_id,
      accountName: a.account_name,
      lastLoginAt: a.last_login_at,
    }));
  });
}
