/**
 * steam-direct — Steam login + token persistence per tech reference.
 */
import { ipcMain, BrowserWindow } from 'electron';
import SteamUser from 'steam-user';
import GlobalOffensive from 'globaloffensive';
import { AccountRepo } from '../db/repositories/account.repo';
import { csgoResolver } from '../services/csgoapi-resolver.service';
import { InventoryRepo } from '../db/repositories/inventory.repo';

let client: any = null;
let csgo: any = null;

/** Getter for inventory.ipc.ts to access the live GC connection */
export function getCsgo(): any { return csgo?.haveGCSession ? csgo : null; }
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
  let pendingToken: string | null = null;

  c.on('loggedOn', () => {
    if (loginTimer) clearTimeout(loginTimer);
    const steamId = c.steamID?.getSteamID64?.();
    console.log(`[SteamDirect] Logged on: ${steamId}`);
    // Upsert with refreshToken if received (refreshToken fires before loggedOn)
    try { AccountRepo.upsert({ steamId, accountName, refreshToken: pendingToken }); } catch (_) {}
    try { AccountRepo.setActive(steamId); } catch (_) {}
    pendingToken = null;
    c.setPersona(SteamUser.EPersonaState.Online);
    c.gamesPlayed([730]);
    send({ type: 'logged-in', steamId, accountName });
  });

  c.on('refreshToken', (token: string) => {
    const steamId = c.steamID?.getSteamID64?.();
    console.log(`[SteamDirect] refreshToken: steamId=${steamId} hasToken=${!!token}`);
    if (steamId && token) {
      try {
        // Use upsert (not updateToken) — account may not exist in DB yet
        AccountRepo.upsert({ steamId, accountName, refreshToken: token });
      } catch (_) { /* ignore */ }
    } else {
      // steamId not available yet — store temporarily for loggedOn to save
      pendingToken = token;
    }
    send({ type: 'token-saved' });
  });

  c.on('machineAuthToken', (token: string) => {
    const steamId = c.steamID?.getSteamID64?.();
    try { if (steamId) AccountRepo.upsert({ steamId, accountName, machineToken: token }); } catch (_) {}
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
    console.log(`[SteamDirect] Disconnected: ${msg} (${eresult})`);
    if (eresult === 84 || eresult === 63) {
      const steamId = c.steamID?.getSteamID64?.();
      try { if (steamId) AccountRepo.upsert({ steamId, accountName, refreshToken: '' }); } catch (_) {}
    }
  });

  c.on('error', (err: any) => {
    console.error(`[SteamDirect] Error: ${err.message} (eresult=${err.eresult})`);
    const isTokenExpired = err.eresult === 84 || err.eresult === 63;
    const isSessionConflict = err.eresult === 6; // LoggedInElsewhere
    if (isTokenExpired || isSessionConflict) {
      const steamId = c.steamID?.getSteamID64?.();
      try { if (steamId) AccountRepo.upsert({ steamId, accountName, refreshToken: '' }); } catch (_) {}
    }
    if (isTokenExpired || err.eresult === 15 || err.eresult === 5) {
      send({ type: 'error', message: err.message }); destroy();
    } else if (isSessionConflict) {
      // LoggedInElsewhere: auto-relogin will reconnect with new session
      console.log(`[SteamDirect] Session conflict — autoRelogin will reconnect`);
    } else {
      console.log(`[SteamDirect] Non-fatal error, keeping session alive`);
    }
  });

  if (g) {
    g.on('connectedToGC', () => {
      const rawCount = g.inventory?.length || 0;
      console.log(`[SteamDirect] GC ready — ${rawCount} items`);
      try {
        const loaded = csgoResolver.load();
        console.log(`[SteamDirect] Resolver loaded: ${loaded}, inventory: ${g.inventory?.length || 0}`);
        if (loaded && g.inventory) {
          const loose = g.inventory.filter((i: any) => !i.casket_id);
          // Sample: log first 3 raw items
          for (let i = 0; i < Math.min(3, loose.length); i++) {
            const raw = loose[i];
            console.log(`[SteamDirect] Raw[${i}]: id=${raw.id} def=${raw.def_index} paint=${raw.paint_index} rarity=${raw.rarity} quality=${raw.quality} stickers=${raw.stickers?.length || 0}`);
          }
          // One-time sample: quality distribution
          if (!(globalThis as any)._qualityLogged) {
            (globalThis as any)._qualityLogged = true;
            const qCounts: Record<number, number> = {};
            for (const raw of loose) {
              const q = raw.quality ?? 0;
              qCounts[q] = (qCounts[q] || 0) + 1;
            }
            console.log(`[SteamDirect] Quality distribution: ${JSON.stringify(qCounts)}`);
            const stSample = loose.filter((i: any) => i.quality === 9).slice(0, 3);
            const svSample = loose.filter((i: any) => i.quality === 12).slice(0, 3);
            for (const s of stSample) console.log(`[SteamDirect] ST sample: id=${s.id} def=${s.def_index} paint=${s.paint_index} quality=${s.quality}`);
            for (const s of svSample) console.log(`[SteamDirect] SV sample: id=${s.id} def=${s.def_index} paint=${s.paint_index} quality=${s.quality}`);
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
  //  TRADE-UP EXECUTION (per tech reference)
  // ═══════════════════════════════════
  ipcMain.handle('steam:tradeup-execute', async (_e, params: { assetIds: string[]; recipe: number }) => {
    if (!csgo?.haveGCSession) return { success: false, error: 'GC 未连接' };
    const assetIds = params.assetIds;
    if (assetIds.length !== 10) return { success: false, error: '需要10件物品' };

    // Validate items exist in inventory
    const items = assetIds.map(id => csgo.inventory?.find((i: any) => String(i.id) === String(id))).filter(Boolean);
    if (items.length !== 10) return { success: false, error: '部分物品未在库存中找到' };

    console.log(`[SteamDirect] Executing trade-up: recipe=${params.recipe} items=${assetIds.join(',')}`);

    return new Promise((resolve) => {
      const timeout = setTimeout(() => resolve({ success: false, error: '汰换超时 (15s)' }), 15000);

      const handler = (recipeResult: number, gained: any[]) => {
        clearTimeout(timeout);
        csgo.removeListener('craftingComplete', handler);
        if (recipeResult === -1) {
          resolve({ success: false, error: 'GC 拒绝汰换 (recipe=-1)，请检查物品稀有度是否一致' });
          return;
        }
        // Resolve gained items — 'gained' is item IDs, look up from inventory
        const gainedItems: any[] = [];
        for (const id of gained) {
          const item = csgo.inventory?.find((i: any) => String(i.id) === String(id));
          if (item) {
            const resolved = csgoResolver.resolveOne(item);
            // Strip wear suffix from name (actual wear is displayed separately)
            const name = resolved.resolvedName.replace(/\s*[（(][^)）]*[)）]\s*$/, '');
            gainedItems.push({
              name,
              wearFloat: resolved.paintWear,
              imageUrl: resolved.imageUrl,
              wearCategory: resolved.wearCategoryZh || '',
              rarity: resolved.rarityNameZh || '',
            });
          } else {
            gainedItems.push({ name: `Item ${id}`, wearFloat: 0, imageUrl: '', wearCategory: '', rarity: '' });
          }
        }
        resolve({ success: true, gainedItems });
      };

      csgo.on('craftingComplete', handler);
      try {
        csgo.craft(items.map((i: any) => i.id), params.recipe);
      } catch (err: any) {
        clearTimeout(timeout);
        csgo.removeListener('craftingComplete', handler);
        resolve({ success: false, error: err.message });
      }
    });
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
