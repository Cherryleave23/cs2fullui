import { ipcMain, BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '../../shared/ipc-channels';
import { PriceRepo } from '../db/repositories/price.repo';
import { InventoryRepo } from '../db/repositories/inventory.repo';
import { SettingsRepo } from '../db/repositories/settings.repo';
import { csqaService } from '../services/csqa.service';

export function registerPriceIpc(): void {
  // 拉取指定物品的价格（可通过不同数据源）
  ipcMain.handle(IPC_CHANNELS.PRICE_FETCH, async (_event, marketHashNames: string[], source?: string) => {
    try {
      const result = await csqaService.fetch(marketHashNames);
      return { success: true, ...result };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // 获取缓存的价格数据
  ipcMain.handle(IPC_CHANNELS.PRICE_GET_CACHE, async (_event, filter?: { source?: string; itemHashNames?: string[] }) => {
    try {
      return PriceRepo.getCache(filter);
    } catch {
      return [];
    }
  });

  // 获取价格历史趋势
  ipcMain.handle(IPC_CHANNELS.PRICE_GET_HISTORY, async (_event, marketHashName: string, days?: number) => {
    try {
      return PriceRepo.getHistory(marketHashName, days ?? 30);
    } catch {
      return [];
    }
  });

  // 刷新全部库存物品的价格
  ipcMain.handle(IPC_CHANNELS.PRICE_REFRESH_ALL, async () => {
    try {
      // 检查是否配置了至少一个 CSQAQ Token（兼容所有格式）
      const accounts = SettingsRepo.getJson<Array<{ label: string; token: string }>>('csqaq_api_accounts');
      const hasAccounts = accounts && Array.isArray(accounts) && accounts.some(a => a && a.token && a.token.trim());
      const tokensJson = !hasAccounts ? SettingsRepo.getJson<string[]>('csqaq_api_tokens') : null;
      const hasTokens = !hasAccounts && tokensJson && Array.isArray(tokensJson) && tokensJson.some(t => t && t.trim());
      const hasLegacyToken = !hasAccounts && !hasTokens && (SettingsRepo.get('csqaq_api_token', '') || '').trim();

      if (!hasAccounts && !hasTokens && !hasLegacyToken) {
        return { error: '请先在设置页面配置 CSQAQ API Token', fetched: 0, failed: 0 };
      }

      // Collect names from inventory (always works, no dependency on prior cache)
      const items = InventoryRepo.getAllItems();
      const mhns = [...new Set(items.map(i => i.marketHashName).filter(Boolean))] as string[];

      if (mhns.length === 0) {
        return { note: '库存无物品或缺少市场名称，请先同步库存', fetched: 0, failed: 0 };
      }

      const result = await csqaService.fetch(mhns);

      // 通知渲染进程价格已更新
      const wins = BrowserWindow.getAllWindows();
      for (const win of wins) {
        win.webContents.send(IPC_CHANNELS.PUSH_PRICE_UPDATED, {
          fetched: result.fetched,
          timestamp: new Date().toISOString(),
        });
      }

      return { ...result, note: `成功更新 ${result.fetched} 个物品价格（共 ${mhns.length} 个）` };
    } catch (err: any) {
      return { error: err.message, fetched: 0, failed: 0 };
    }
  });

  // 获取价格摘要统计
  ipcMain.handle(IPC_CHANNELS.PRICE_GET_SUMMARY, async () => {
    try {
      return PriceRepo.getSummary();
    } catch {
      return { totalCached: 0, lastUpdated: null, avgPriceAll: null };
    }
  });

  // ── 设置 ──
  // 旧接口：单个 token（向后兼容）
  ipcMain.handle(IPC_CHANNELS.SETTINGS_GET_CSQA_TOKEN, async () => {
    return { token: SettingsRepo.get('csqaq_api_token', '') || '' };
  });

  ipcMain.handle(IPC_CHANNELS.SETTINGS_SET_CSQA_TOKEN, async (_event, token: string) => {
    SettingsRepo.set('csqaq_api_token', token);
    return { success: true };
  });

  // 新接口：多 token 列表（支持多账号并行）
  ipcMain.handle(IPC_CHANNELS.SETTINGS_GET_CSQA_TOKENS, async () => {
    const tokensJson = SettingsRepo.getJson<string[]>('csqaq_api_tokens');
    if (tokensJson && Array.isArray(tokensJson) && tokensJson.length > 0) {
      return { tokens: tokensJson };
    }
    // 向后兼容：旧格式单 token 转为数组
    const single = SettingsRepo.get('csqaq_api_token', '') || '';
    return { tokens: single.trim() ? [single.trim()] : [] };
  });

  ipcMain.handle(IPC_CHANNELS.SETTINGS_SET_CSQA_TOKENS, async (_event, tokens: string[]) => {
    const clean = (tokens || []).map(t => (t || '').trim()).filter(Boolean);
    SettingsRepo.set('csqaq_api_tokens', clean);
    return { success: true, count: clean.length };
  });

  // ── CSQAQ 账号（带备注） ──
  ipcMain.handle(IPC_CHANNELS.SETTINGS_GET_CSQA_ACCOUNTS, async () => {
    // 优先读取新格式
    const accounts = SettingsRepo.getJson<Array<{ label: string; token: string }>>('csqaq_api_accounts');
    if (accounts && Array.isArray(accounts) && accounts.length > 0) {
      return { accounts };
    }
    // 向后兼容：从旧格式 tokens 转换
    const tokensJson = SettingsRepo.getJson<string[]>('csqaq_api_tokens');
    if (tokensJson && Array.isArray(tokensJson) && tokensJson.length > 0) {
      return { accounts: tokensJson.map((t, i) => ({ label: `账号 ${i + 1}`, token: t })) };
    }
    // 最旧格式：单 token
    const single = SettingsRepo.get('csqaq_api_token', '') || '';
    return { accounts: single.trim() ? [{ label: '默认账号', token: single.trim() }] : [] };
  });

  ipcMain.handle(IPC_CHANNELS.SETTINGS_SET_CSQA_ACCOUNTS, async (_event, accounts: Array<{ label: string; token: string }>) => {
    const clean = (accounts || [])
      .filter(a => a && a.token && a.token.trim())
      .map(a => ({ label: (a.label || '').trim() || '未命名账号', token: a.token.trim() }));
    // 同时写入新格式和旧格式（兼容 csqa.service.ts 的 loadConfig）
    SettingsRepo.set('csqaq_api_accounts', clean);
    SettingsRepo.set('csqaq_api_tokens', clean.map(a => a.token));
    return { success: true, count: clean.length };
  });

  // ── C5 账号（带备注） ──
  ipcMain.handle(IPC_CHANNELS.SETTINGS_GET_C5_ACCOUNTS, async () => {
    const accounts = SettingsRepo.getJson<Array<{ label: string; appKey: string }>>('c5_api_accounts');
    return { accounts: accounts && Array.isArray(accounts) ? accounts : [] };
  });

  ipcMain.handle(IPC_CHANNELS.SETTINGS_SET_C5_ACCOUNTS, async (_event, accounts: Array<{ label: string; appKey: string }>) => {
    const clean = (accounts || [])
      .filter(a => a && a.appKey && a.appKey.trim())
      .map(a => ({ label: (a.label || '').trim() || '未命名账号', appKey: a.appKey.trim() }));
    SettingsRepo.set('c5_api_accounts', clean);
    return { success: true, count: clean.length };
  });

  // 从库存拉取价格：仅拉取 1 小时内未更新过价格的物品，通过 CSQAQ API 获取
  ipcMain.handle(IPC_CHANNELS.PRICE_FETCH_INVENTORY, async () => {
    try {
      // 检查是否配置了至少一个 CSQAQ Token（兼容所有格式）
      const accounts = SettingsRepo.getJson<Array<{ label: string; token: string }>>('csqaq_api_accounts');
      const hasAccounts = accounts && Array.isArray(accounts) && accounts.some(a => a && a.token && a.token.trim());
      const tokensJson = !hasAccounts ? SettingsRepo.getJson<string[]>('csqaq_api_tokens') : null;
      const hasTokens = !hasAccounts && tokensJson && Array.isArray(tokensJson) && tokensJson.some(t => t && t.trim());
      const hasLegacyToken = !hasAccounts && !hasTokens && (SettingsRepo.get('csqaq_api_token', '') || '').trim();

      if (!hasAccounts && !hasTokens && !hasLegacyToken) {
        return { error: '请先在设置页面配置 CSQAQ API Token', fetched: 0, failed: 0 };
      }

      // 1. 从库存获取所有物品的 marketHashName
      const items = InventoryRepo.getAllItems();
      console.log(`[Price] 库存物品数: ${items.length}`);
      const mhns = [...new Set(items.map(i => i.marketHashName).filter(Boolean))] as string[];
      console.log(`[Price] 去重后 marketHashName 数: ${mhns.length}`);

      if (mhns.length === 0) {
        const sample = items.slice(0, 3).map(i => ({ name: i.resolvedName, mhn: i.marketHashName }));
        return {
          note: `库存无物品或缺少 marketHashName（共 ${items.length} 件，示例: ${JSON.stringify(sample)}）`,
          fetched: 0, failed: 0,
        };
      }

      // 2. 查询已缓存的价格，筛选出 1 小时内未更新过的物品
      const allCached = PriceRepo.getCache();
      const oneHourAgo = Date.now() - 60 * 60 * 1000;

      const freshSet = new Set(
        allCached
          .filter(c => c.last_fetched_at && new Date(c.last_fetched_at + 'Z').getTime() > oneHourAgo)
          .map(c => c.item_hash_name),
      );

      const needFetch = mhns.filter(n => !freshSet.has(n));
      const skipped = mhns.length - needFetch.length;

      console.log(`[Price] 需拉取: ${needFetch.length}, 跳过(1小时内已更新): ${skipped}`);

      if (needFetch.length === 0) {
        return {
          note: `所有 ${mhns.length} 个物品的价格均在 1 小时内更新过，无需拉取`,
          fetched: 0, failed: 0, skipped,
        };
      }

      // 3. 通过 CSQAQ API 批量拉取缺失价格
      const result = await csqaService.fetch(needFetch);

      // 4. 通知渲染进程价格已更新
      const wins = BrowserWindow.getAllWindows();
      for (const win of wins) {
        win.webContents.send(IPC_CHANNELS.PUSH_PRICE_UPDATED, {
          fetched: result.fetched,
          timestamp: new Date().toISOString(),
        });
      }

      return {
        note: `库存共 ${mhns.length} 个物品，拉取 ${needFetch.length} 个（跳过 ${skipped} 个 1 小时内已更新），成功 ${result.fetched} 个`,
        fetched: result.fetched,
        failed: result.failed,
        skipped,
      };
    } catch (err: any) {
      return { error: err.message, fetched: 0, failed: 0 };
    }
  });
}
