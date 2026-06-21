import SteamUser from 'steam-user';
import GlobalOffensive from 'globaloffensive';
import { EventEmitter } from 'events';
import { AccountRepo } from '../db/repositories/account.repo';

export interface SteamBotStatus {
  state: 'idle' | 'connecting' | 'logged_in' | 'gc_ready' | 'error';
  steamId: string | null;
  accountName: string | null;
  nickname: string | null;
  errorMessage?: string;
}

export class SteamBotService extends EventEmitter {
  private client: any;
  csgo: any;
  private status: SteamBotStatus = { state: 'idle', steamId: null, accountName: null, nickname: null };
  private loginResolve: ((result: LoginResult) => void) | null = null;
  private pendingPassword: string | null = null;
  private pendingAccountName: string | null = null;
  private steamGuardCallback: ((code: string) => void) | null = null;

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
    // ── Logged in ──
    this.client.on('loggedOn', (_body: unknown) => {
      console.log(`[SteamBot] Logged in: ${this.status.accountName}`);
      this.updateStatus({ state: 'logged_in' });
      this.client.setPersona(SteamUser.EPersonaState.Online);
      this.client.gamesPlayed([730]);
    });

    // ── Refresh token — persist immediately ──
    this.client.on('refreshToken', (token: string) => {
      console.log('[SteamBot] Refresh token received, saving...');
      if (this.status.steamId) {
        AccountRepo.updateToken(this.status.steamId, token);
      }
    });

    // ── Machine auth token (email Steam Guard bypass) ──
    this.client.on('machineAuthToken', (token: string) => {
      console.log('[SteamBot] Machine token received, saving...');
      if (this.status.steamId) {
        AccountRepo.updateMachineToken(this.status.steamId, token);
      }
    });

    // ── Steam Guard ──
    this.client.on('steamGuard', (domain: string | null, callback: (code: string) => void, lastWrong: boolean) => {
      this.steamGuardCallback = callback;
      if (lastWrong) {
        console.warn('[SteamBot] Last Steam Guard code was wrong — wait 30s before retry');
      }
      this.emit('steamGuard', domain, lastWrong);
    });

    // ── Disconnected (non-fatal) ──
    this.client.on('disconnected', (eresult: number, msg: string) => {
      console.log(`[SteamBot] Disconnected: ${msg} (${eresult})`);

      // Token expired/invalid — clear and fallback to password
      if (eresult === 84 && this.status.steamId) {
        console.log('[SteamBot] Token expired, clearing and retrying with password...');
        AccountRepo.updateToken(this.status.steamId, '');
        if (this.pendingPassword && this.pendingAccountName) {
          this.doPasswordLogin(this.pendingAccountName, this.pendingPassword);
          return;
        }
      }

      if (this.status.state !== 'error') {
        this.updateStatus({ state: 'idle' });
      }

      this.loginResolve?.({
        success: false,
        error: `${msg} (${SteamUser.EResult?.[eresult] || eresult})`,
      });
    });

    // ── Fatal error ──
    this.client.on('error', (err: any) => {
      console.error('[SteamBot] Fatal error:', err.message || err);
      const isTokenExpired = err.eresult === 84 || err.message?.includes('InvalidToken');
      if (isTokenExpired && this.status.steamId) {
        AccountRepo.updateToken(this.status.steamId, '');
      }
      this.updateStatus({ state: 'error', errorMessage: err.message });
      this.loginResolve?.({ success: false, error: err.message });
    });

    // ── GC events ──
    this.csgo.on('connectedToGC', () => {
      console.log(`[SteamBot] GC ready — ${this.csgo.inventory?.length || 0} items in inventory`);
      this.updateStatus({ state: 'gc_ready' });
      this.emit('inventoryReady', this.csgo.inventory);
    });

    this.csgo.on('disconnectedFromGC', (reason: number) => {
      console.log(`[SteamBot] GC disconnected: ${reason}`);
      this.updateStatus({ state: 'logged_in' });
    });

    this.csgo.on('itemAcquired', (item: unknown) => this.emit('itemAcquired', item));
    this.csgo.on('itemChanged', (oldItem: unknown, newItem: unknown) => this.emit('itemChanged', oldItem, newItem));
    this.csgo.on('itemRemoved', (item: unknown) => this.emit('itemRemoved', item));
    this.csgo.on('craftingComplete', (recipe: number, items: unknown[]) => this.emit('craftingComplete', recipe, items));
  }

  // ── Public API ──

  getClient(): any { return this.client; }
  getStatus(): SteamBotStatus { return { ...this.status }; }
  isGCReady(): boolean { return this.status.state === 'gc_ready' && this.csgo.haveGCSession; }

  /** Submit Steam Guard code during login */
  submitSteamGuard(code: string): void {
    this.steamGuardCallback?.(code);
    this.steamGuardCallback = null;
  }

  /**
   * Login with token-first strategy.
   * 1. Check DB for saved refresh_token → try token login
   * 2. Token absent/expired → password login
   * 3. On success → save token + update accounts table
   */
  async login(params: {
    accountName: string;
    password: string;
    proxyUrl?: string;
    nickname?: string;
  }): Promise<LoginResult> {
    this.updateStatus({ state: 'connecting', accountName: params.accountName });

    // Apply proxy
    if (params.proxyUrl) {
      if (params.proxyUrl.startsWith('socks')) {
        this.client.options.socksProxy = params.proxyUrl;
      } else {
        this.client.options.httpProxy = params.proxyUrl;
      }
    }

    return new Promise((resolve) => {
      this.loginResolve = (result) => {
        this.loginResolve = null;
        resolve(result);
      };

      // Check for saved token
      const saved = AccountRepo.getAll().find(
        a => a.account_name === params.accountName
      );

      if (saved?.refresh_token) {
        console.log(`[SteamBot] Attempting token login for ${params.accountName}`);
        this.pendingPassword = params.password;
        this.pendingAccountName = params.accountName;
        this.client.logOn({
          refreshToken: saved.refresh_token,
          steamID: saved.steam_id,
        });
      } else {
        console.log(`[SteamBot] No saved token — password login for ${params.accountName}`);
        this.doPasswordLogin(params.accountName, params.password);
        // Also save pending for potential token retry after first success
        this.pendingPassword = params.password;
        this.pendingAccountName = params.accountName;
      }
    });
  }

  private doPasswordLogin(accountName: string, password: string): void {
    this.client.logOn({ accountName, password });
  }

  logout(): void {
    this.client.gamesPlayed([]);
    setTimeout(() => {
      this.client.logOff();
      this.updateStatus({ state: 'idle', steamId: null });
    }, 500);
  }

  // ── Internal ──

  private updateStatus(partial: Partial<SteamBotStatus>): void {
    this.status = { ...this.status, ...partial };

    // On successful login, update/sync account in DB
    if (partial.state === 'logged_in' && this.status.steamId && this.pendingAccountName) {
      const saved = AccountRepo.getBySteamId(this.status.steamId);
      AccountRepo.upsert({
        steamId: this.status.steamId,
        accountName: this.pendingAccountName,
        nickname: saved?.nickname || this.pendingAccountName,
        proxyUrl: saved?.proxy_url || undefined,
      });

      // Set as active
      AccountRepo.setActive(this.status.steamId);

      this.status.nickname = saved?.nickname || this.pendingAccountName;
    }

    this.emit('statusChanged', this.status);
  }
}

export interface LoginResult {
  success: boolean;
  steamId?: string;
  error?: string;
}
