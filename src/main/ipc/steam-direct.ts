/**
 * steam-direct — Steam login + token persistence per tech reference.
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

function w() { return BrowserWindow.getAllWindows()[0]; }
function send(data: unknown) { w()?.webContents.send('push:steam-log', data); }

function destroy() {
  if (loginTimer) { clearTimeout(loginTimer); loginTimer = null; }
  if (client) { try { client.removeAllListeners(); } catch (_) {} client = null; }
  if (csgo) { try { csgo.removeAllListeners(); } catch (_) {} csgo = null; }
  guardCallback = null;
}

/** Shared event bindings — used by both login and auto-login */
function bindEvents(c: any, g: any, accountName: string): void {
  c.on('loggedOn', () => {
    if (loginTimer) clearTimeout(loginTimer);
    const steamId = c.steamID?.getSteamID64?.();
    console.log(`[SteamDirect] Logged on: ${steamId}`);
    try { AccountRepo.upsert({ steamId, accountName }); } catch (_) {}
    try { AccountRepo.setActive(steamId); } catch (_) {}
    c.setPersona(SteamUser.EPersonaState.Online);
    c.gamesPlayed([730]);
    send({ type: 'logged-in', steamId, accountName });
  });

  c.on('refreshToken', (token: string) => {
    const steamId = c.steamID?.getSteamID64?.();
    try { if (steamId) AccountRepo.updateToken(steamId, token); } catch (_) {}
    send({ type: 'token-saved' });
  });

  c.on('machineAuthToken', (token: string) => {
    const steamId = c.steamID?.getSteamID64?.();
    try { if (steamId) AccountRepo.updateMachineToken(steamId, token); } catch (_) {}
  });

  c.on('steamGuard', (domain: string | null, cb: (code: string) => void, lastWrong: boolean) => {
    console.log(`[SteamDirect] Guard domain:${domain} wrong:${lastWrong}`);
    if (lastWrong) {
      send({ type: 'guard', lastWrong: true, cooldown: 30, domain });
      setTimeout(() => { guardCallback = cb; send({ type: 'guard', lastWrong: false, cooldown: 0, domain }); }, 30000);
    } else {
      guardCallback = cb;
      send({ type: 'guard', lastWrong: false, cooldown: 0, domain });
    }
  });

  c.on('disconnected', (eresult: number, msg: string) => {
    // steam-user disconnects are NORMAL (CM server rotation).
    // autoRelogin:true handles reconnection automatically.
    // Do NOT destroy — only clear token on expiry.
    console.log(`[SteamDirect] Disconnected: ${msg} (${eresult})`);
    if (eresult === 84 || eresult === 63) {
      const steamId = c.steamID?.getSteamID64?.();
      try { if (steamId) AccountRepo.updateToken(steamId, ''); } catch (_) {}
    }
  });

  c.on('error', (err: any) => {
    console.error(`[SteamDirect] Error: ${err.message}`);
    if (err.eresult === 84) {
      const steamId = c.steamID?.getSteamID64?.();
      try { if (steamId) AccountRepo.updateToken(steamId, ''); } catch (_) {}
    }
    send({ type: 'error', message: err.message });
    destroy();
  });

  if (g) {
    g.on('connectedToGC', () => {
      const rawCount = g.inventory?.length || 0;
      console.log(`[SteamDirect] GC ready — ${rawCount} items`);
      try {
        const { csgoResolver } = require('../services/csgoapi-resolver.service');
        const { InventoryRepo } = require('../db/repositories/inventory.repo');
        const loaded = csgoResolver.load();
        console.log(`[SteamDirect] Resolver loaded: ${loaded}, inventory: ${g.inventory?.length || 0}`);
        if (loaded && g.inventory) {
          const loose = g.inventory.filter((i: any) => !i.casket_id);
          // Sample: log first 3 raw items
          for (let i = 0; i < Math.min(3, loose.length); i++) {
            const raw = loose[i];
            console.log(`[SteamDirect] Raw[${i}]: id=${raw.id} def=${raw.def_index} paint=${raw.paint_index} rarity=${raw.rarity} quality=${raw.quality} stickers=${raw.stickers?.length || 0}`);
          }
          const resolved = csgoResolver.resolveAll(loose);
          // Sample: log first 3 resolved items
          for (let i = 0; i < Math.min(3, resolved.length); i++) {
            const r = resolved[i];
            console.log(`[SteamDirect] Resolved[${i}]: type=${r.resolvedType} name=${r.resolvedName} rarity=${r.rarityName} paint=${r.paintIndex}`);
          }
          InventoryRepo.clearAll();
          for (const item of resolved) InventoryRepo.upsertItem(item);
          console.log(`[SteamDirect] Synced ${resolved.length} items`);
          send({ type: 'inventory-synced', count: resolved.length });
        } else {
          send({ type: 'gc-ready', itemCount: rawCount });
        }
      } catch (err: any) {
        send({ type: 'gc-ready', itemCount: rawCount, error: err.message });
      }
    });
  }
}

export function registerSteamDirect(): void {
  // ═══════════════════════════════════
  //  AUTO-LOGIN on startup
  // ═══════════════════════════════════
  ipcMain.handle('steam:auto-login', async () => {
    try {
      const accounts = AccountRepo.getAll();
      const active = accounts.find(a => a.is_active === 1 && a.refresh_token);
      if (!active) return { success: false, error: 'No saved active account' };

      destroy();
      currentAccountName = active.account_name;
      client = new SteamUser({ enablePicsCache: true, changelistUpdateInterval: 60000, webCompatibilityMode: true });
      if (active.proxy_url) {
        Object.assign(client.options, active.proxy_url.startsWith('socks')
          ? { socksProxy: active.proxy_url } : { httpProxy: active.proxy_url });
      }
      csgo = new GlobalOffensive(client);
      bindEvents(client, csgo, active.account_name);

      console.log(`[SteamDirect] Auto-login token: ${active.account_name}`);
      return new Promise((resolve) => {
        loginTimer = setTimeout(() => resolve({ success: false, error: 'timeout' }), 30000);
        client.on('loggedOn', () => { clearTimeout(loginTimer!); resolve({ success: true, steamId: client.steamID?.getSteamID64?.() }); });
        client.on('error', (err: any) => { clearTimeout(loginTimer!); resolve({ success: false, error: err.message }); });
        client.logOn({ refreshToken: active.refresh_token!, steamID: active.steam_id });
      });
    } catch (err: any) { return { success: false, error: err.message }; }
  });

  // ═══════════════════════════════════
  //  GET CURRENT STATUS (for UI restore after navigation)
  // ═══════════════════════════════════
  ipcMain.handle('steam:status', async () => {
    const steamId = client?.steamID?.getSteamID64?.() || null;
    const gcOk = !!(csgo?.haveGCSession);
    return { steamId, gcReady: gcOk, itemCount: csgo?.inventory?.length || 0 };
  });

  // ═══════════════════════════════════
  //  LIST SAVED
  // ═══════════════════════════════════
  ipcMain.handle('steam:list-saved', async () => {
    try {
      return AccountRepo.getAll().map(a => ({
        steamId: a.steam_id, accountName: a.account_name,
        nickname: a.nickname || a.account_name,
        hasToken: !!a.refresh_token, isActive: a.is_active === 1, lastLogin: a.last_login_at,
      }));
    } catch (_) { return []; }
  });

  // ═══════════════════════════════════
  //  LOGIN
  // ═══════════════════════════════════
  ipcMain.handle('steam:login', async (_e, params: {
    accountName: string; password: string; proxyUrl?: string; nickname?: string;
  }) => {
    try {
      destroy();
      currentAccountName = params.accountName;

      client = new SteamUser({ enablePicsCache: true, changelistUpdateInterval: 60000, webCompatibilityMode: true, autoRelogin: true });
      if (params.proxyUrl) {
        Object.assign(client.options, params.proxyUrl.startsWith('socks')
          ? { socksProxy: params.proxyUrl } : { httpProxy: params.proxyUrl });
      }
      csgo = new GlobalOffensive(client);
      bindEvents(client, csgo, params.accountName);

      return new Promise((resolve) => {
        loginTimer = setTimeout(() => {
          send({ type: 'error', message: '连接 Steam 超时 (60s) — 请检查网络或代理' });
          resolve({ success: false, error: 'timeout' });
        }, 60000);

        client.on('loggedOn', () => { clearTimeout(loginTimer!); resolve({ success: true, steamId: client.steamID?.getSteamID64?.() }); });
        client.on('error', (err: any) => { clearTimeout(loginTimer!); resolve({ success: false, error: err.message }); });
        client.on('disconnected', (eresult: number, msg: string) => { clearTimeout(loginTimer!); resolve({ success: false, error: `${msg} (${eresult})` }); });

        // Token-first
        let savedToken: string | null = null, savedSteamId: string | null = null;
        try {
          const saved = AccountRepo.getAll().find(a => a.account_name === params.accountName);
          if (saved?.refresh_token) { savedToken = saved.refresh_token; savedSteamId = saved.steam_id; }
        } catch (_) {}

        if (savedToken && savedSteamId) {
          console.log(`[SteamDirect] Token login: ${params.accountName}`);
          client.logOn({ refreshToken: savedToken, steamID: savedSteamId });
        } else {
          console.log(`[SteamDirect] Password login: ${params.accountName}`);
          client.logOn({ accountName: params.accountName, password: params.password });
        }
      });
    } catch (err: any) { return { success: false, error: err.message }; }
  });

  // ═══════════════════════════════════
  //  GUARD
  // ═══════════════════════════════════
  ipcMain.handle('steam:guard', async (_e, params: { code: string }) => {
    if (!guardCallback) return { success: false, error: 'No pending guard' };
    const cb = guardCallback; guardCallback = null; cb(params.code);
    return { success: true };
  });
}
