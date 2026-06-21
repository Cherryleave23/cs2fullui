import SteamUser from 'steam-user';
import GlobalOffensive from 'globaloffensive';
import { EventEmitter } from 'events';
import { AccountRepo } from '../db/repositories/account.repo';

export interface SteamBotStatus {
  state: 'idle' | 'connecting' | 'logged_in' | 'gc_connecting' | 'gc_ready' | 'error';
  steamId: string | null;
  accountName: string | null;
  errorMessage?: string;
}

export class SteamBotService extends EventEmitter {
  private client: any;
  private csgo: any;
  private status: SteamBotStatus = { state: 'idle', steamId: null, accountName: null };
  private loginResolver: (() => void) | null = null;
  private loginRejecter: ((err: Error) => void) | null = null;

  constructor() {
    super();

    this.client = new SteamUser({
      enablePicsCache: true,
      changelistUpdateInterval: 60000,
      webCompatibilityMode: true,
    });

    this.csgo = new GlobalOffensive(this.client);
    this.setupEvents();
  }

  private setupEvents(): void {
    // ── Steam Client Events ──
    this.client.on('loggedOn', (_body: unknown) => {
      console.log('[SteamBot] Logged in to Steam');
      this.updateStatus({ state: 'logged_in' });
      this.client.setPersona(SteamUser.EPersonaState.Online);
      this.client.gamesPlayed([730]); // Trigger GC connection
    });

    this.client.on('error', (err: Error) => {
      console.error('[SteamBot] Fatal error:', err);
      this.updateStatus({ state: 'error', errorMessage: err.message });
      this.loginRejecter?.(err);
    });

    this.client.on('disconnected', (eresult: number, msg: string) => {
      console.log(`[SteamBot] Disconnected: ${msg} (${eresult})`);
      if (this.status.state !== 'error') {
        this.updateStatus({ state: 'idle' });
      }
    });

    this.client.on('refreshToken', (token: string) => {
      console.log('[SteamBot] New refresh token received');
      if (this.status.steamId) {
        AccountRepo.updateToken(this.status.steamId, token);
      }
    });

    // ── Steam Guard ──
    this.client.on('steamGuard', (domain: string | null, callback: (code: string) => void, lastCodeWrong: boolean) => {
      this.emit('steamGuard', domain, callback, lastCodeWrong);
    });

    // ── GC Events ──
    this.csgo.on('connectedToGC', () => {
      console.log('[SteamBot] Connected to CS2 Game Coordinator');
      this.updateStatus({ state: 'gc_ready' });

      // Re-read inventory on every GC connect (handles silent reconnect)
      this.emit('inventoryChanged', this.csgo.inventory);
    });

    this.csgo.on('disconnectedFromGC', (reason: number) => {
      console.log(`[SteamBot] Disconnected from GC: ${reason}`);
      this.updateStatus({ state: 'logged_in' });
    });

    // ── Inventory Change Events ──
    this.csgo.on('itemAcquired', (item: unknown) => {
      this.emit('itemAcquired', item);
    });

    this.csgo.on('itemChanged', (oldItem: unknown, newItem: unknown) => {
      this.emit('itemChanged', oldItem, newItem);
    });

    this.csgo.on('itemRemoved', (item: unknown) => {
      this.emit('itemRemoved', item);
    });

    // ── Crafting Events ──
    this.csgo.on('craftingComplete', (recipe: number, itemsGained: unknown[]) => {
      this.emit('craftingComplete', recipe, itemsGained);
    });
  }

  private updateStatus(partial: Partial<SteamBotStatus>): void {
    this.status = { ...this.status, ...partial };
    this.emit('statusChanged', this.status);
  }

  /** Get SteamBot client (for use by other services) */
  getClient(): any {
    return this.client;
  }

  /** Get GlobalOffensive instance */
  getCSGO(): any {
    return this.csgo;
  }

  /** Get current status */
  getStatus(): SteamBotStatus {
    return { ...this.status };
  }

  /** Check if GC is ready */
  isGCReady(): boolean {
    return this.status.state === 'gc_ready' && this.csgo.haveGCSession;
  }

  /**
   * Login using saved refresh token or password.
   */
  async login(params: {
    accountName: string;
    password: string;
    proxyUrl?: string;
    webCompatibilityMode?: boolean;
  }): Promise<{ success: boolean; steamId?: string; needSteamGuard?: boolean; error?: string }> {
    // Apply proxy if configured
    if (params.proxyUrl) {
      if (params.proxyUrl.startsWith('socks')) {
        this.client.options.socksProxy = params.proxyUrl;
      } else {
        this.client.options.httpProxy = params.proxyUrl;
      }
    }

    if (params.webCompatibilityMode) {
      this.client.options.webCompatibilityMode = true;
    }

    return new Promise((resolve, reject) => {
      this.loginResolver = () => {
        resolve({
          success: true,
          steamId: this.status.steamId!,
        });
      };
      this.loginRejecter = (err) => {
        resolve({
          success: false,
          error: err.message || String(err),
        });
      };

      this.updateStatus({ state: 'connecting', accountName: params.accountName });

      // Try saved refresh token first
      const savedAccount = AccountRepo.getBySteamId(params.accountName);
      if (savedAccount?.refresh_token) {
        console.log('[SteamBot] Attempting login with saved token');
        this.client.logOn({
          refreshToken: savedAccount.refresh_token,
          steamID: savedAccount.steam_id,
        });
      } else {
        console.log('[SteamBot] Attempting password login');
        this.client.logOn({
          accountName: params.accountName,
          password: params.password,
        });
      }
    });
  }

  /** Submit Steam Guard code */
  submitSteamGuard(code: string): void {
    this.emit('submitSteamGuard', code);
  }

  /** Logout and clear session */
  logout(): void {
    this.client.gamesPlayed([]);
    setTimeout(() => {
      this.client.logOff();
      this.updateStatus({ state: 'idle', steamId: null });
    }, 500);
  }
}
