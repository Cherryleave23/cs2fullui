import { ipcMain, shell } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { IPC_CHANNELS } from '../../shared/ipc-channels';
import { registerAuthIpc } from './auth.ipc';
import { registerInventoryIpc } from './inventory.ipc';
import { registerTradeUpIpc } from './tradeup.ipc';
import { registerRecipeIpc } from './recipe.ipc';
import { registerPriceIpc } from './price.ipc';
import { registerSteamDirect } from './steam-direct';
import { getDbPath } from '../db/connection';

export function registerAllIpcHandlers(): void {
  registerSteamDirect();

  ipcMain.handle(IPC_CHANNELS.APP_GET_VERSION, () => '1.0.0');
  ipcMain.handle(IPC_CHANNELS.APP_OPEN_DATA_DIR, () => {
    shell.showItemInFolder(getDbPath());
  });

  ipcMain.handle(IPC_CHANNELS.DATA_GET_STATUS, () => {
    const paths = [
      path.join(process.cwd(), 'data', 'all.json'),
      path.join(process.cwd(), 'data', 'csgoapi', 'all.json'),
    ];
    let downloaded = false;
    for (const p of paths) {
      if (fs.existsSync(p)) { downloaded = true; break; }
    }
    return { csgoapiDownloaded: downloaded, csgoapiLang: 'zh-CN' };
  });

  ipcMain.handle(IPC_CHANNELS.DATA_CLEAR_CACHE, () => {
    try { fs.unlinkSync(getDbPath()); } catch (_) { /* ignore */ }
    return { success: true };
  });

  // ── Domain handlers ──
  registerAuthIpc();
  registerInventoryIpc();
  registerTradeUpIpc();
  registerRecipeIpc();
  registerPriceIpc();
}
