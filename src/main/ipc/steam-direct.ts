/**
 * steam-direct — minimal Steam login exactly per tech reference.
 * No DB, no AccountManager, no multi-account.
 *
 * IPC channel: 'steam:login'
 *   request:  { accountName, password, proxyUrl? }
 *   response: { success, steamId?, error?, needGuard? }
 *
 * IPC channel: 'steam:guard'
 *   request:  { code }
 *   response: { success, error? }
 *
 * Push events (main → renderer):
 *   'push:steam-log' { type: 'guard' | 'logged-in' | 'error' | 'disconnected', data }
 */
import { ipcMain, BrowserWindow } from 'electron';
import SteamUser from 'steam-user';
import GlobalOffensive from 'globaloffensive';

let client: any = null;
let csgo: any = null;
let guardCallback: ((code: string) => void) | null = null;

function win() { return BrowserWindow.getAllWindows()[0]; }

export function registerSteamDirect(): void {
  // ── LOGIN ──
  ipcMain.handle('steam:login', async (_e, params: {
    accountName: string; password: string; proxyUrl?: string;
  }) => {
    try {
      // Create client — per tech reference Quick Start
      client = new SteamUser({
        enablePicsCache: true,
        changelistUpdateInterval: 60000,
        webCompatibilityMode: true,
      });
      csgo = new GlobalOffensive(client);

      // Proxy — per tech reference Object.assign pattern
      if (params.proxyUrl) {
        if (params.proxyUrl.startsWith('socks')) {
          Object.assign(client.options, { socksProxy: params.proxyUrl });
        } else {
          Object.assign(client.options, { httpProxy: params.proxyUrl });
        }
      }

      // ── Events: strictly per tech reference order ──

      // loggedOn: setPersona + gamesPlayed
      client.on('loggedOn', () => {
        const steamId = client.steamID?.getSteamID64?.();
        console.log(`[SteamDirect] Logged on as ${steamId}`);
        client.setPersona(SteamUser.EPersonaState.Online);
        client.gamesPlayed([730]); // → GC
        win()?.webContents.send('push:steam-log', {
          type: 'logged-in', steamId,
        });
      });

      // refreshToken: save (log it, user can persist later)
      client.on('refreshToken', (token: string) => {
        console.log(`[SteamDirect] refreshToken: ${token.substring(0, 20)}...`);
        win()?.webContents.send('push:steam-log', {
          type: 'token', token,
        });
      });

      // machineAuthToken
      client.on('machineAuthToken', (token: string) => {
        console.log(`[SteamDirect] machineAuthToken received`);
      });

      // steamGuard: enforce 30s cooldown on wrong
      client.on('steamGuard', (
        domain: string | null,
        cb: (code: string) => void,
        lastWrong: boolean,
      ) => {
        if (lastWrong) {
          console.warn('[SteamDirect] Wrong guard code — enforcing 30s cooldown');
          win()?.webContents.send('push:steam-log', {
            type: 'guard', lastWrong: true, cooldown: 30, domain,
          });
          setTimeout(() => {
            guardCallback = cb;
            win()?.webContents.send('push:steam-log', {
              type: 'guard', lastWrong: false, cooldown: 0, domain,
            });
          }, 30000);
        } else {
          guardCallback = cb;
          win()?.webContents.send('push:steam-log', {
            type: 'guard', lastWrong: false, cooldown: 0, domain,
          });
        }
      });

      // disconnected: non-fatal
      client.on('disconnected', (eresult: number, msg: string) => {
        console.log(`[SteamDirect] Disconnected: ${msg} (${eresult})`);
        win()?.webContents.send('push:steam-log', {
          type: 'disconnected', eresult, msg,
        });
      });

      // error: fatal
      client.on('error', (err: any) => {
        console.error(`[SteamDirect] Error: ${err.message || err}`);
        win()?.webContents.send('push:steam-log', {
          type: 'error', message: err.message || String(err),
        });
      });

      // GC
      csgo.on('connectedToGC', () => {
        console.log(`[SteamDirect] GC ready — ${csgo.inventory?.length || 0} items`);
        win()?.webContents.send('push:steam-log', {
          type: 'gc-ready', itemCount: csgo.inventory?.length || 0,
        });
      });

      // ── Log on — per tech reference ──
      return new Promise((resolve) => {
        // Temporary resolve on the first loggedOn or error/disconnect
        const cleanup = () => {
          client.removeAllListeners('loggedOn');
          client.removeAllListeners('error');
        };

        client.on('loggedOn', () => {
          cleanup();
          resolve({
            success: true,
            steamId: client.steamID?.getSteamID64?.(),
          });
        });

        client.on('error', (err: any) => {
          cleanup();
          resolve({ success: false, error: err.message || String(err) });
        });

        // Wait for guard or immediate login
        // The guard event fires BEFORE loggedOn if needed
        // We don't resolve here — the loggedOn handler above resolves

        client.logOn({
          accountName: params.accountName,
          password: params.password,
        });
      });
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // ── SUBMIT GUARD CODE ──
  ipcMain.handle('steam:guard', async (_e, params: { code: string }) => {
    if (!guardCallback) {
      return { success: false, error: 'No pending Steam Guard' };
    }
    const cb = guardCallback;
    guardCallback = null;
    cb(params.code);
    return { success: true };
  });
}
