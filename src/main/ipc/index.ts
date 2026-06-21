import { ipcMain, shell } from 'electron';
import { IPC_CHANNELS } from '../../shared/ipc-channels';
import { registerAuthIpc } from './auth.ipc';
import { registerInventoryIpc } from './inventory.ipc';
import { registerTradeUpIpc } from './tradeup.ipc';
import { registerRecipeIpc } from './recipe.ipc';
import { registerPriceIpc } from './price.ipc';
import { registerSteamDirect } from './steam-direct';
import { accountManager } from '../services/account-manager';

export function registerAllIpcHandlers(): void {
  // Minimal Steam login — direct, per tech reference
  registerSteamDirect();
  // ── App ──
  ipcMain.handle(IPC_CHANNELS.APP_GET_VERSION, () => '1.0.0');
  ipcMain.handle(IPC_CHANNELS.APP_OPEN_DATA_DIR, () => {
    const { getDbPath } = require('../db/connection');
    shell.showItemInFolder(getDbPath());
  });

  // ── Data ──
  ipcMain.handle(IPC_CHANNELS.DATA_GET_STATUS, () => {
    const fs = require('fs');
    const path = require('path');
    const paths = [
      path.join(process.cwd(), 'data', 'all.json'),
      path.join(process.cwd(), 'data', 'csgoapi', 'all.json'),
    ];
    let downloaded = false;
    let lang = '';
    for (const p of paths) {
      if (fs.existsSync(p)) {
        downloaded = true;
        lang = 'zh-CN';
        break;
      }
    }
    return { csgoapiDownloaded: downloaded, csgoapiLang: lang };
  });

  ipcMain.handle(IPC_CHANNELS.DATA_CLEAR_CACHE, () => {
    const { getDbPath } = require('../db/connection');
    const fs = require('fs');
    try { fs.unlinkSync(getDbPath()); } catch (_) { /* ignore */ }
    return { success: true };
  });

  // ── Domain handlers ──
  registerAuthIpc();
  registerInventoryIpc(() => accountManager.getActive() ?? null);
  registerTradeUpIpc(() => accountManager.getActive() ?? null);
  registerRecipeIpc();
  registerPriceIpc();
}
