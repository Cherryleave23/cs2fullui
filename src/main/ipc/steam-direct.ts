/**
 * steam-direct — Steam login + token persistence per tech reference.
 *
 * Tech reference "Login + Token 持久化" pattern:
 *   savedToken ? client.logOn({ refreshToken, steamID })
 *              : client.logOn({ accountName, password })
 *   client.on('refreshToken', (token) => saveToken(name, token))
 *   client.on('disconnected', (eresult) => { if (eresult === 84) deleteToken })
 */
import { ipcMain, BrowserWindow } from 'electron';
import SteamUser from 'steam-user';
import GlobalOffensive from 'globaloffensive';
import { AccountRepo } from '../db/repositories/account.repo';

let client: any = null;
let csgo: any = null;
let guardCallback: ((code: string) => void) | null = null;
let loginTimer: ReturnType<typeof setTimeout> | null = null;
let currentAccountName = '';

function win() { return BrowserWindow.getAllWindows()[0]; }
function send(data: unknown) { win()?.webContents.send('push:steam-log', data); }

function destroy() {
  if (loginTimer) { clearTimeout(loginTimer); loginTimer = null; }
  if (client) { try { client.removeAllListeners(); } catch (_) { /* ignore */ } client = null; }
  if (csgo) { try { csgo.removeAllListeners(); } catch (_) { /* ignore */ } csgo = null; }
  guardCallback = null;
}

export function registerSteamDirect(): void {
  // ═══════════════════════════════════════
  //  LIST SAVED ACCOUNTS
  // ═══════════════════════════════════════
  ipcMain.handle('steam:list-saved', async () => {
    try {
      return AccountRepo.getAll().map(a => ({
        steamId: a.steam_id, accountName: a.account_name,
        nickname: a.nickname || a.account_name,
        hasToken: !!a.refresh_token, isActive: a.is_active === 1, lastLogin: a.last_login_at,
      }));
    } catch (_) { return []; }
  });

  // ═══════════════════════════════════════
  //  LOGIN — token-first per tech reference
  // ═══════════════════════════════════════
  ipcMain.handle('steam:login', async (_e, params: {
    accountName: string; password: string; proxyUrl?: string; nickname?: string;
  }) => {
    try {
      destroy();
      currentAccountName = params.accountName;

      // ── 1. SteamUser + GlobalOffensive ──
      client = new SteamUser({
        enablePicsCache: true,
        changelistUpdateInterval: 60000,
        webCompatibilityMode: true,
      });

      if (params.proxyUrl) {
        if (params.proxyUrl.startsWith('socks')) {
          Object.assign(client.options, { socksProxy: params.proxyUrl });
        } else {
          Object.assign(client.options, { httpProxy: params.proxyUrl });
        }
      }

      csgo = new GlobalOffensive(client);

      // ═══════════════════════════════════
      //  EVENTS — exactly per tech reference
      // ═══════════════════════════════════

      // loggedOn
      client.on('loggedOn', () => {
        if (loginTimer) clearTimeout(loginTimer);
        const steamId = client.steamID?.getSteamID64?.();
        console.log(`[SteamDirect] Logged on: ${steamId}`);

        // Persist account (non-blocking — DB errors don't affect login)
        try { AccountRepo.upsert({ steamId, accountName: currentAccountName, nickname: params.nickname || currentAccountName, proxyUrl: params.proxyUrl || undefined }); } catch (_) {}
        try { AccountRepo.setActive(steamId); } catch (_) {}

        client.setPersona(SteamUser.EPersonaState.Online);
        client.gamesPlayed([730]);
        send({ type: 'logged-in', steamId, accountName: currentAccountName });
      });

      // refreshToken — persist (non-blocking)
      client.on('refreshToken', (token: string) => {
        const steamId = client.steamID?.getSteamID64?.();
        try { if (steamId) AccountRepo.updateToken(steamId, token); } catch (_) {}
        send({ type: 'token-saved' });
      });

      // machineAuthToken
      client.on('machineAuthToken', (token: string) => {
        const steamId = client.steamID?.getSteamID64?.();
        try { if (steamId) AccountRepo.updateMachineToken(steamId, token); } catch (_) {}
      });

      // steamGuard — 30s cooldown on wrong code
      client.on('steamGuard', (
        domain: string | null,
        cb: (code: string) => void,
        lastWrong: boolean,
      ) => {
        console.log(`[SteamDirect] Guard — domain:${domain} lastWrong:${lastWrong}`);
        if (lastWrong) {
          send({ type: 'guard', lastWrong: true, cooldown: 30, domain });
          setTimeout(() => {
            guardCallback = cb;
            send({ type: 'guard', lastWrong: false, cooldown: 0, domain });
          }, 30000);
        } else {
          guardCallback = cb;
          send({ type: 'guard', lastWrong: false, cooldown: 0, domain });
        }
      });

      // disconnected — clear token if expired (non-blocking)
      client.on('disconnected', (eresult: number, msg: string) => {
        console.log(`[SteamDirect] Disconnected: ${msg} (${eresult})`);
        if (eresult === 84 || eresult === 63) {
          const steamId = client.steamID?.getSteamID64?.();
          try { if (steamId) AccountRepo.updateToken(steamId, ''); } catch (_) {}
        }
        send({ type: 'error', message: `断开: ${msg}` });
        destroy();
      });

      // error
      client.on('error', (err: any) => {
        console.error(`[SteamDirect] Error: ${err.message}`);
        if (err.eresult === 84) {
          const steamId = client.steamID?.getSteamID64?.();
          try { if (steamId) AccountRepo.updateToken(steamId, ''); } catch (_) {}
        }
        send({ type: 'error', message: err.message });
        destroy();
      });

      // GC + inventory sync
      if (csgo) {
        csgo.on('connectedToGC', () => {
          const rawCount = csgo.inventory?.length || 0;
          console.log(`[SteamDirect] GC ready — ${rawCount} items`);
          try {
            const { csgoResolver } = require('../services/csgoapi-resolver.service');
            const { InventoryRepo } = require('../db/repositories/inventory.repo');
            if (csgoResolver.load() && csgo.inventory) {
              const looseItems = csgo.inventory.filter((i: any) => !i.casket_id);
              const resolved = csgoResolver.resolveAll(looseItems);
              InventoryRepo.clearAll();
              for (const item of resolved) InventoryRepo.upsertItem(item);
              console.log(`[SteamDirect] Synced ${resolved.length} items`);
              send({ type: 'inventory-synced', count: resolved.length });
            } else {
              send({ type: 'gc-ready', itemCount: rawCount, note: 'resolver not loaded' });
            }
          } catch (err: any) {
            send({ type: 'gc-ready', itemCount: rawCount, error: err.message });
          }
        });
      }

      // ═══════════════════════════════════
      //  LOG ON — token-first strategy
      // ═══════════════════════════════════
      return new Promise((resolve) => {
        loginTimer = setTimeout(() => {
          send({ type: 'error', message: '登录超时 (30s)' });
          resolve({ success: false, error: 'Login timeout' });
        }, 30000);

        client.on('loggedOn', () => {
          if (loginTimer) clearTimeout(loginTimer);
          resolve({ success: true, steamId: client.steamID?.getSteamID64?.() });
        });
        client.on('error', (err: any) => {
          if (loginTimer) clearTimeout(loginTimer);
          resolve({ success: false, error: err.message });
        });
        client.on('disconnected', (eresult: number, msg: string) => {
          if (loginTimer) clearTimeout(loginTimer);
          resolve({ success: false, error: `断开: ${msg} (${eresult})` });
        });

        // ── Token-first: check DB for saved token (non-blocking) ──
        let savedToken: string | null = null;
        let savedSteamId: string | null = null;
        try {
          const saved = AccountRepo.getAll().find(a => a.account_name === params.accountName);
          if (saved?.refresh_token) { savedToken = saved.refresh_token; savedSteamId = saved.steam_id; }
        } catch (_) { /* DB unavailable — fall through to password */ }

        if (savedToken && savedSteamId) {
          console.log(`[SteamDirect] Token login: ${params.accountName}`);
          client.logOn({ refreshToken: savedToken, steamID: savedSteamId });
        } else {
          console.log(`[SteamDirect] Password login: ${params.accountName}`);
          client.logOn({ accountName: params.accountName, password: params.password });
        }
      });
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // ═══════════════════════════════════════
  //  SUBMIT GUARD CODE
  // ═══════════════════════════════════════
  ipcMain.handle('steam:guard', async (_e, params: { code: string }) => {
    if (!guardCallback) return { success: false, error: '没有待处理的 Steam Guard 验证' };
    const cb = guardCallback;
    guardCallback = null;
    cb(params.code);
    return { success: true };
  });
}
