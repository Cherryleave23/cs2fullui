/**
 * Multi-account manager — manages multiple SteamBotService instances.
 * All accounts can be logged in simultaneously (CM connection).
 * Only ONE account connects to CS2 GC at a time (per Steam's limit).
 */
import { EventEmitter } from 'events';
import { SteamBotService, applyProxy } from './steam-bot.service';
import { AccountRepo, type AccountRow } from '../db/repositories/account.repo';
import { InventoryRepo } from '../db/repositories/inventory.repo';

interface AccountState {
  bot: SteamBotService;
  steamId: string;
  accountName: string;
  loggedIn: boolean;
  gcReady: boolean;
}

export type BotCreatedCallback = (steamId: string, bot: SteamBotService) => void;

class AccountManager extends EventEmitter {
  private accounts = new Map<string, AccountState>();
  private activeSteamId: string | null = null;
  private _onBotCreated: BotCreatedCallback | null = null;

  /** Register a callback invoked whenever a new bot is created via getOrCreate */
  onBotCreated(cb: BotCreatedCallback): void { this._onBotCreated = cb; }

  // ═══════════════════════════════════════════
  //  Account creation & retrieval
  // ═══════════════════════════════════════════

  getOrCreate(steamId: string): SteamBotService {
    let state = this.accounts.get(steamId);
    if (!state) {
      const bot = new SteamBotService();
      state = { bot, steamId, accountName: '', loggedIn: false, gcReady: false };
      this.accounts.set(steamId, state);
      this._bindBotEvents(state);
      if (this._onBotCreated) this._onBotCreated(steamId, bot);
    }
    return state.bot;
  }

  get(steamId: string): SteamBotService | undefined {
    return this.accounts.get(steamId)?.bot;
  }

  getState(steamId: string): AccountState | undefined {
    return this.accounts.get(steamId);
  }

  getActive(): SteamBotService | undefined {
    if (!this.activeSteamId) {
      const active = AccountRepo.getActive();
      if (active) this.activeSteamId = active.steam_id;
    }
    return this.activeSteamId ? this.accounts.get(this.activeSteamId)?.bot : undefined;
  }

  getActiveSteamId(): string | null { return this.activeSteamId; }

  listStates(): { steamId: string; accountName: string; loggedIn: boolean; gcReady: boolean; isActive: boolean }[] {
    return [...this.accounts.entries()].map(([id, s]) => ({
      steamId: id,
      accountName: s.accountName,
      loggedIn: s.loggedIn,
      gcReady: s.gcReady,
      isActive: id === this.activeSteamId,
    }));
  }

  // ═══════════════════════════════════════════
  //  Login all saved accounts (call on startup)
  // ═══════════════════════════════════════════
  async loginAllSaved(): Promise<string[]> {
    const accounts = AccountRepo.getAll().filter(a => a.refresh_token);
    const loggedIn: string[] = [];
    for (const acc of accounts) {
      try {
        const bot = this.getOrCreate(acc.steam_id);
        const state = this.accounts.get(acc.steam_id)!;
        state.accountName = acc.account_name;
        if (acc.proxy_url) applyProxy(bot.client, acc.proxy_url);
        const result = await new Promise<boolean>((resolve) => {
          const t = setTimeout(() => resolve(false), 30000);
          bot.once('loggedOn', () => { clearTimeout(t); resolve(true); });
          bot.client.logOn({ refreshToken: acc.refresh_token!, steamID: acc.steam_id });
        });
        if (result) {
          loggedIn.push(acc.steam_id);
          console.log(`[AccountManager] Auto-login OK: ${acc.account_name}`);
        }
      } catch (err: any) {
        console.error(`[AccountManager] Auto-login failed for ${acc.account_name}: ${err.message}`);
      }
    }
    // Connect GC for active account
    const active = AccountRepo.getActive();
    if (active?.steam_id && this.accounts.has(active.steam_id)) {
      await this.connectGC(active.steam_id);
    }
    return loggedIn;
  }

  // ═══════════════════════════════════════════
  //  GC connection management (only one at a time)
  // ═══════════════════════════════════════════

  /** Connect GC for an account (disconnects previous active) */
  async connectGC(steamId: string): Promise<void> {
    const newState = this.accounts.get(steamId);
    if (!newState || !newState.loggedIn) throw new Error('Account not logged in');

    // Disconnect old active
    if (this.activeSteamId && this.activeSteamId !== steamId) {
      const oldState = this.accounts.get(this.activeSteamId);
      if (oldState) {
        try { oldState.bot.client.gamesPlayed([]); } catch (_) {}
        oldState.gcReady = false;
      }
    }

    // Connect new account to GC
    newState.bot.client.gamesPlayed([730]);
    this.activeSteamId = steamId;
    AccountRepo.setActive(steamId);
    this.emit('gcSwitch', steamId, newState.accountName);

    // Note: Inventory sync binding is handled by steam-direct.ts wireBotEvents
    // (which listens for inventoryReady and calls bindInventorySync)
  }

  /** Disconnect GC from active account (keep login) */
  disconnectGC(): void {
    if (!this.activeSteamId) return;
    const state = this.accounts.get(this.activeSteamId);
    if (state) {
      try { state.bot.client.gamesPlayed([]); } catch (_) {}
      state.gcReady = false;
    }
  }

  // ═══════════════════════════════════════════
  //  Removal
  // ═══════════════════════════════════════════

  /** Remove an account completely (logout + delete from DB) */
  remove(steamId: string): void {
    const state = this.accounts.get(steamId);
    if (state) {
      state.bot.logout();
      state.bot.removeAllListeners();
      this.accounts.delete(steamId);
    }
    if (this.activeSteamId === steamId) {
      this.activeSteamId = null;
    }
    const acc = AccountRepo.getBySteamId(steamId);
    if (acc) {
      InventoryRepo.clearAll(acc.id ?? 0);
      AccountRepo.delete(steamId);
    }
  }

  // ═══════════════════════════════════════════
  //  Internal
  // ═══════════════════════════════════════════

  private _bindBotEvents(state: AccountState): void {
    state.bot.on('loggedOn', (sid: string) => {
      state.loggedIn = true;
      console.log(`[AccountManager] ${state.accountName || sid} logged in`);
    });
    state.bot.on('disconnected', () => {
      state.gcReady = false;
    });
    state.bot.on('inventoryReady', () => {
      state.gcReady = true;
    });
  }
}

export const accountManager = new AccountManager();
