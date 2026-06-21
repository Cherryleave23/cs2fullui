/**
 * steam-direct — minimal Steam login, strictly per tech reference.
 * No DB, no AccountManager, no multi-account.
 *
 * Tech reference pattern:
 *   const client = new SteamUser({ enablePicsCache, webCompatibilityMode })
 *   Object.assign(client.options, { httpProxy, socksProxy })   // before logOn
 *   const csgo = new GlobalOffensive(client)
 *   client.logOn({ accountName, password })
 */
import { ipcMain, BrowserWindow } from 'electron';
import SteamUser from 'steam-user';
import GlobalOffensive from 'globaloffensive';

let client: any = null;
let csgo: any = null;
let guardCallback: ((code: string) => void) | null = null;
let loginTimer: ReturnType<typeof setTimeout> | null = null;

function win() { return BrowserWindow.getAllWindows()[0]; }
function send(data: unknown) { win()?.webContents.send('push:steam-log', data); }

function destroy() {
  if (loginTimer) { clearTimeout(loginTimer); loginTimer = null; }
  if (client) {
    try { client.removeAllListeners(); } catch (_) { /* ignore */ }
    client = null;
  }
  if (csgo) {
    try { csgo.removeAllListeners(); } catch (_) { /* ignore */ }
    csgo = null;
  }
  guardCallback = null;
}

export function registerSteamDirect(): void {
  // ═══════════════════════════════════════
  //  LOGIN — per manual Quick Start + Common Patterns
  // ═══════════════════════════════════════
  ipcMain.handle('steam:login', async (_e, params: {
    accountName: string; password: string; proxyUrl?: string;
  }) => {
    try {
      // Clean up any previous session
      destroy();

      // ── 1. SteamUser — per tech reference ──
      client = new SteamUser({
        enablePicsCache: true,
        changelistUpdateInterval: 60000,
        webCompatibilityMode: true,       // WebSocket:443 through firewalls
      });

      // ── 2. Proxy — Object.assign BEFORE logOn, per tech reference ──
      if (params.proxyUrl) {
        if (params.proxyUrl.startsWith('socks')) {
          Object.assign(client.options, { socksProxy: params.proxyUrl });
          console.log(`[SteamDirect] Proxy: socksProxy = ${params.proxyUrl}`);
        } else {
          Object.assign(client.options, { httpProxy: params.proxyUrl });
          console.log(`[SteamDirect] Proxy: httpProxy = ${params.proxyUrl}`);
        }
      }

      // ── 3. GlobalOffensive — per tech reference ──
      csgo = new GlobalOffensive(client);

      // ═══════════════════════════════════════
      //  EVENTS — exactly per tech reference order
      // ═══════════════════════════════════════

      // loggedOn
      client.on('loggedOn', () => {
        if (loginTimer) clearTimeout(loginTimer);
        const steamId = client.steamID?.getSteamID64?.();
        console.log(`[SteamDirect] ✅ loggedOn: ${steamId}`);
        client.setPersona(SteamUser.EPersonaState.Online);
        client.gamesPlayed([730]);
        send({ type: 'logged-in', steamId });
      });

      // refreshToken
      client.on('refreshToken', (token: string) => {
        console.log(`[SteamDirect] refreshToken: ${token.substring(0, 20)}...`);
        send({ type: 'token', token });
      });

      // steamGuard — enforce 30s cooldown on wrong code
      client.on('steamGuard', (
        domain: string | null,
        cb: (code: string) => void,
        lastWrong: boolean,
      ) => {
        console.log(`[SteamDirect] steamGuard — domain:${domain} lastWrong:${lastWrong}`);
        if (lastWrong) {
          // Per manual: MUST wait 30s on wrong TOTP to avoid IP ban
          console.warn('[SteamDirect] Wrong code — 30s cooldown');
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

      // disconnected
      client.on('disconnected', (eresult: number, msg: string) => {
        console.log(`[SteamDirect] Disconnected: ${msg} (${eresult})`);
        send({ type: 'error', message: `断开: ${msg} (${eresult})` });
        destroy();
      });

      // error
      client.on('error', (err: any) => {
        console.error(`[SteamDirect] Error: ${err.message || err}`);
        send({ type: 'error', message: err.message || String(err) });
        destroy();
      });

      // GC — inventory sync: raw CSOEconItem → ResolvedItem → DB → renderer
      if (csgo) {
        csgo.on('connectedToGC', () => {
          const rawCount = csgo.inventory?.length || 0;
          console.log(`[SteamDirect] GC ready — ${rawCount} raw items`);

          // Resolve inventory using CsgoapiResolver + save to DB
          try {
            const { csgoResolver } = require('../services/csgoapi-resolver.service');
            const { InventoryRepo } = require('../db/repositories/inventory.repo');

            if (csgoResolver.load() && csgo.inventory) {
              const looseItems = csgo.inventory.filter((i: any) => !i.casket_id);
              const resolved = csgoResolver.resolveAll(looseItems);
              InventoryRepo.clearAll();
              for (const item of resolved) {
                InventoryRepo.upsertItem(item);
              }
              console.log(`[SteamDirect] Inventory synced: ${resolved.length} items`);
              send({ type: 'inventory-synced', count: resolved.length });
            } else {
              console.warn('[SteamDirect] CsgoResolver not loaded — inventory not resolved');
              send({ type: 'gc-ready', itemCount: rawCount, note: 'all.json not loaded' });
            }
          } catch (err: any) {
            console.error('[SteamDirect] Inventory sync error:', err.message);
            send({ type: 'gc-ready', itemCount: rawCount, error: err.message });
          }
        });
      }

      // ═══════════════════════════════════════
      //  LOG ON — per tech reference
      // ═══════════════════════════════════════
      console.log(`[SteamDirect] Logging in as ${params.accountName}...`);

      return new Promise((resolve) => {
        // 30s timeout — if nothing happens, report error
        loginTimer = setTimeout(() => {
          console.error('[SteamDirect] Login timeout (30s)');
          send({ type: 'error', message: '登录超时 — 请检查网络或代理设置' });
          resolve({ success: false, error: 'Login timeout (30s)' });
        }, 30000);

        client.on('loggedOn', () => {
          if (loginTimer) clearTimeout(loginTimer);
          resolve({ success: true, steamId: client.steamID?.getSteamID64?.() });
        });

        client.on('error', (err: any) => {
          if (loginTimer) clearTimeout(loginTimer);
          resolve({ success: false, error: err.message || String(err) });
        });

        client.on('disconnected', (eresult: number, msg: string) => {
          if (loginTimer) clearTimeout(loginTimer);
          resolve({ success: false, error: `断开: ${msg} (${eresult})` });
        });

        // ═══════════════════════════════════════
        //  THE ACTUAL LOGIN CALL
        // ═══════════════════════════════════════
        client.logOn({
          accountName: params.accountName,
          password: params.password,
        });
      });
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // ═══════════════════════════════════════
  //  SUBMIT GUARD CODE
  // ═══════════════════════════════════════
  ipcMain.handle('steam:guard', async (_e, params: { code: string }) => {
    if (!guardCallback) {
      return { success: false, error: '没有待处理的 Steam Guard 验证' };
    }
    console.log(`[SteamDirect] Guard code submitted: ${params.code}`);
    const cb = guardCallback;
    guardCallback = null;
    cb(params.code);
    return { success: true };
  });
}
