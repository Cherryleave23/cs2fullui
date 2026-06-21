import { SteamBotService } from './steam-bot.service';

let botInstance: SteamBotService | null = null;

/** Get or create the SteamBotService singleton */
export function getBotService(): SteamBotService {
  if (!botInstance) {
    botInstance = new SteamBotService();
  }
  return botInstance;
}

/** Get current bot instance (may be null if not created yet) */
export function tryGetBotService(): SteamBotService | null {
  return botInstance;
}

/** Destroy the bot service (on app quit) */
export function destroyBotService(): void {
  if (botInstance) {
    botInstance.logout();
    botInstance.removeAllListeners();
    botInstance = null;
  }
}
