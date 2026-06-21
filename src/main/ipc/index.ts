import { ipcMain, shell } from 'electron';
import { IPC_CHANNELS } from '../../shared/ipc-channels';
import { tryGetBotService } from '../services';
import { registerAuthIpc } from './auth.ipc';
import { registerInventoryIpc } from './inventory.ipc';
import { registerTradeUpIpc } from './tradeup.ipc';
import { registerRecipeIpc } from './recipe.ipc';
import { registerPriceIpc } from './price.ipc';

/**
 * Register all IPC handlers.
 * Each domain module registers its own handlers.
 */
export function registerAllIpcHandlers(): void {
  // ── App ──
  ipcMain.handle(IPC_CHANNELS.APP_GET_VERSION, () => '1.0.0');
  ipcMain.handle(IPC_CHANNELS.APP_OPEN_DATA_DIR, () => {
    const path = require('../db/connection').getDbPath();
    shell.showItemInFolder(path);
  });
  ipcMain.handle(IPC_CHANNELS.APP_OPEN_LOGS_DIR, () => {
    const { app } = require('electron');
    shell.openPath(app.getPath('logs'));
  });

  // ── Data ──
  ipcMain.handle(IPC_CHANNELS.DATA_GET_STATUS, () => ({
    csgoapiDownloaded: false,
    csgoapiLang: 'en',
  }));
  ipcMain.handle(IPC_CHANNELS.DATA_CLEAR_CACHE, () => ({ success: true }));

  // ── Domain handlers ──
  registerAuthIpc(() => tryGetBotService());
  registerInventoryIpc(() => tryGetBotService());
  registerTradeUpIpc(() => tryGetBotService());
  registerRecipeIpc();
  registerPriceIpc();
}
