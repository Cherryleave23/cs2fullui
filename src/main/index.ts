import { app, BrowserWindow } from 'electron';
import { createMainWindow } from './windows';
import { registerAllIpcHandlers } from './ipc';
import { initDatabase, closeDatabase, saveDatabase } from './db/connection';
import { runMigrations } from './db/migrations';
import { seedReferenceData } from './db/seed';
import { initServices } from './services';
import { accountManager } from './services/account-manager';

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

app.on('second-instance', () => {
  const win = BrowserWindow.getAllWindows()[0];
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

app.whenReady().then(async () => {
  await initDatabase();
  runMigrations();
  seedReferenceData();
  initServices();

  registerAllIpcHandlers();
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

const saveInterval = setInterval(() => {
  try { saveDatabase(); } catch (_) { /* ignore */ }
}, 5 * 60 * 1000);

app.on('before-quit', () => {
  clearInterval(saveInterval);
  closeDatabase();
});
