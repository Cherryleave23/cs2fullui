/**
 * steam-direct — thin IPC layer. All Steam logic lives in SteamBotService.
 */
import { ipcMain, BrowserWindow } from 'electron';
import { accountManager } from '../services/account-manager';
import { AccountRepo } from '../db/repositories/account.repo';
import { csgoResolver } from '../services/csgoapi-resolver.service';
import { bindInventorySync } from '../services/inventory-sync.service';
import { InventoryRepo } from '../db/repositories/inventory.repo';

let unsubInventory: (() => void) | null = null;

function w() { return BrowserWindow.getAllWindows()[0]; }
function send(data: unknown) { w()?.webContents.send('push:steam-log', data); }
function sendStatus(state: string) { w()?.webContents.send('push:steam-status', { state }); }
function sendGcStatus(status: string) { w()?.webContents.send('push:gc-status', status); }

/** Get GC accessor for inventory page (active account) */
export function getCsgo(): any {
  const bot = accountManager.getActive();
  return bot?.isGCReady ? bot.csgo : null;
}

export function registerSteamDirect(): void {
  // ── AUTO-LOGIN all saved accounts on startup ──
  ipcMain.handle('steam:auto-login', async () => {
    try {
      const loggedIn = await accountManager.loginAllSaved();
      const active = accountManager.getActive();
      const bot = active;
      // Wire status events for the active bot
      if (bot) {
        bot.on('loggedOn', (steamId: string) => {
          sendStatus('logged_in');
          send({ type: 'logged-in', steamId, accountName: bot.accountName });
        });
        bot.on('steamGuardNeeded', (data: any) => send({ type: 'guard', ...data }));
        bot.on('fatalError', (err: any) => { sendStatus('error'); send({ type: 'error', message: err.message || String(err) }); });
        bot.on('refreshToken', () => send({ type: 'token-saved' }));
        bot.on('inventoryReady', (raw: any[]) => {
          sendGcStatus('HAVE_SESSION');
          const loose = raw.filter((i: any) => !i.casket_id);
          if (csgoResolver.load() && loose.length > 0) {
            const resolved = csgoResolver.resolveAll(loose);
            InventoryRepo.clearAll();
            for (const item of resolved) InventoryRepo.upsertItem(item);
          }
          send({ type: 'inventory-synced', count: loose.length });
        });
        bot.on('disconnected', (er: number, msg: string) => { sendStatus('idle'); sendGcStatus('GC_GOING_DOWN'); send({ type: 'disconnected', eresult: er, msg }); });
        bot.on('inventoryReady', () => {
          if (unsubInventory) unsubInventory();
          unsubInventory = bindInventorySync(bot, 0, { onSyncComplete: (count: number) => send({ type: 'inventory-synced', count }) });
        });
      }
      return { success: true, count: loggedIn.length, activeSteamId: active?.steamId };
    } catch (err: any) { return { success: false, error: err.message }; }
  });

  // ── STATUS (active account) ──
  ipcMain.handle('steam:status', async () => {
    const bot = accountManager.getActive();
    return {
      steamId: bot?.steamId || null,
      gcReady: bot?.isGCReady || false,
      itemCount: bot?.csgo?.inventory?.length || 0,
    };
  });

  // ── LIST SAVED ──
  ipcMain.handle('steam:list-saved', async () => {
    return AccountRepo.getAll().map(a => ({
      steamId: a.steam_id, accountName: a.account_name,
      nickname: a.nickname || a.account_name,
      hasToken: !!a.refresh_token, isActive: a.is_active === 1, lastLogin: a.last_login_at,
    }));
  });

  // ── LOGIN (single account) ──
  ipcMain.handle('steam:login', async (_e, params: {
    accountName: string; password: string; proxyUrl?: string; nickname?: string;
  }) => {
    try {
      const existing = AccountRepo.getAll().find(a => a.account_name === params.accountName);
      const bot = accountManager.getOrCreate(existing?.steam_id || params.accountName);
      const result = await bot.login(params);
      if (result.success && result.steamId) {
        await accountManager.connectGC(result.steamId);
      }
      return result;
    } catch (err: any) { return { success: false, error: err.message }; }
  });

  // ── GUARD ──
  ipcMain.handle('steam:guard', async (_e, params: { code: string }) => {
    const active = accountManager.getActive();
    if (!active?.guardPending) return { success: false, error: 'No pending guard' };
    active.submitSteamGuard(params.code);
    return { success: true };
  });

  // ── TRADE-UP EXECUTION ──
  ipcMain.handle('steam:tradeup-execute', async (_e, params: { assetIds: string[]; recipe: number }) => {
    const bot = accountManager.getActive();
    if (!bot?.isGCReady) return { success: false, error: 'GC 未连接' };
    const assetIds = params.assetIds;
    if (assetIds.length !== 10) return { success: false, error: '需要10件物品' };

    const items = assetIds.map(id => bot.csgo.inventory?.find((i: any) => String(i.id) === String(id))).filter(Boolean);
    if (items.length !== 10) return { success: false, error: '部分物品未在库存中找到' };

    return new Promise((resolve) => {
      const timeout = setTimeout(() => resolve({ success: false, error: '汰换超时 (15s)' }), 15000);
      const handler = (recipeResult: number, gained: any[]) => {
        clearTimeout(timeout);
        bot.csgo.removeListener('craftingComplete', handler);
        if (recipeResult === -1) {
          resolve({ success: false, error: 'GC 拒绝汰换 (recipe=-1)，请检查物品稀有度是否一致' });
          return;
        }
        const gainedItems: any[] = [];
        for (const id of gained) {
          const item = bot.csgo.inventory?.find((i: any) => String(i.id) === String(id));
          if (item) {
            const resolved = csgoResolver.resolveOne(item);
            const name = resolved.resolvedName.replace(/\s*[（(][^)）]*[)）]\s*$/, '');
            gainedItems.push({
              name, wearFloat: resolved.paintWear,
              imageUrl: resolved.imageUrl, wearCategory: resolved.wearCategoryZh || '',
              rarity: resolved.rarityNameZh || '',
            });
          } else {
            gainedItems.push({ name: `Item ${id}`, wearFloat: 0, imageUrl: '', wearCategory: '', rarity: '' });
          }
        }
        resolve({ success: true, gainedItems });
      };
      bot.csgo.on('craftingComplete', handler);
      try { bot.csgo.craft(items.map((i: any) => i.id), params.recipe); }
      catch (err: any) { clearTimeout(timeout); bot.csgo.removeListener('craftingComplete', handler); resolve({ success: false, error: err.message }); }
    });
  });
}
