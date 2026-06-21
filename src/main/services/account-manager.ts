/**
 * Multi-account manager.
 * Manages multiple SteamBotService instances, one per Steam account.
 * Only ONE account can be actively connected to CS2 GC at a time.
 */
import { SteamBotService } from './steam-bot.service';
import { AccountRepo, type AccountRow } from '../db/repositories/account.repo';

class AccountManager {
  private bots = new Map<string, SteamBotService>();
  private activeSteamId: string | null = null;

  /** Get or create a bot for a Steam account */
  getOrCreate(steamId: string): SteamBotService {
    let bot = this.bots.get(steamId);
    if (!bot) {
      bot = new SteamBotService();
      this.bots.set(steamId, bot);
    }
    return bot;
  }

  /** Get an existing bot (doesn't create) */
  get(steamId: string): SteamBotService | undefined {
    return this.bots.get(steamId);
  }

  /** Get the currently active bot */
  getActive(): SteamBotService | undefined {
    if (!this.activeSteamId) {
      // Try to restore from DB
      const active = AccountRepo.getActive();
      if (active) this.activeSteamId = active.steam_id;
    }
    return this.activeSteamId ? this.bots.get(this.activeSteamId) : undefined;
  }

  /** Set which account is active and switch GC connection */
  async switchTo(steamId: string): Promise<void> {
    const oldBot = this.activeSteamId ? this.bots.get(this.activeSteamId) : undefined;
    const newBot = this.bots.get(steamId);
    if (!newBot) throw new Error('Account not found');

    // Disconnect old account from GC
    if (oldBot && oldBot !== newBot) {
      try { oldBot.client.gamesPlayed([]); } catch (_) { /* ignore */ }
    }

    // Connect new account to GC (if logged in)
    if (newBot.steamId) {
      newBot.client.gamesPlayed([730]);
    }

    this.activeSteamId = steamId;
    AccountRepo.setActive(steamId);
  }

  /** Remove an account completely */
  remove(steamId: string): void {
    const bot = this.bots.get(steamId);
    if (bot) {
      bot.logout();
      bot.removeAllListeners();
      this.bots.delete(steamId);
    }
    if (this.activeSteamId === steamId) {
      this.activeSteamId = null;
    }
    AccountRepo.delete(steamId);
  }

  /** List all saved accounts from DB */
  listAccounts(): AccountRow[] {
    return AccountRepo.getAll();
  }
}

export const accountManager = new AccountManager();
