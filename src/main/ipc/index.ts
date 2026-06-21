import { ipcMain, shell } from 'electron';
import { IPC_CHANNELS } from '../../shared/ipc-channels';
import { accountManager } from '../services/account-manager';
import { registerAuthIpc } from './auth.ipc';
import { registerInventoryIpc } from './inventory.ipc';
import { registerTradeUpIpc } from './tradeup.ipc';
import { registerRecipeIpc } from './recipe.ipc';
import { registerPriceIpc } from './price.ipc';

export function registerAllIpcHandlers(): void {
  // ── App ──
  ipcMain.handle(IPC_CHANNELS.APP_GET_VERSION, () => '1.0.0');
  ipcMain.handle(IPC_CHANNELS.APP_OPEN_DATA_DIR, () => {
    const { getDbPath } = require('../db/connection');
    shell.showItemInFolder(getDbPath());
  });

  // ── Data ──
  ipcMain.handle(IPC_CHANNELS.DATA_GET_STATUS, () => ({
    csgoapiDownloaded: true,
    csgoapiLang: 'zh-CN',
  }));

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
