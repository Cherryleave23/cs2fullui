/**
 * SteamBotService — strictly follows the steam-cs2-bot tech reference.
 *
 * Reference pattern: "Login + Token 持久化 (完整生产级)"
 *   - enablePicsCache: true
 *   - webCompatibilityMode: true (WebSocket:443 through firewalls)
 *   - Proxy via Object.assign(client.options, {httpProxy, socksProxy})
 *   - Token-first: reload saved token → password fallback
 *   - Events: refreshToken/machineAuthToken → save; steamGuard → enforce 30s cooldown;
 *             loggedOn → setPersona + gamesPlayed; disconnected/error → clear expired token
 */
import SteamUser from 'steam-user';
import GlobalOffensive from 'globaloffensive';
import { EventEmitter } from 'events';
import { AccountRepo } from '../db/repositories/account.repo';

export interface LoginResult {
  success: boolean;
  steamId?: string;
  error?: string;
}

interface PendingLogin {
  accountName: string;
  password: string;
  nickname?: string;
  resolve: (r: LoginResult) => void;
  loginDone: boolean;
}

export class SteamBotService extends EventEmitter {
  client: any;
  csgo: any;
  private _steamId: string | null = null;
  private _accountName: string | null = null;
  private _nickname: string | null = null;
  private _gcReady = false;
  private _pendingLogin: PendingLogin | null = null;

  constructor() {
    super();
    // ── Per tech reference: SteamUser constructor ──
    this.client = new SteamUser({
      enablePicsCache: true,          // REQUIRED for ownership/owns checks
      changelistUpdateInterval: 60000,
      webCompatibilityMode: true,     // WebSocket:443 through restrictive firewalls
    });
    this.csgo = new GlobalOffensive(this.client);
    this._bindEvents();
  }

  // ═══════════════════════════════════════════════
  //  Event bindings — exactly matching tech reference
  // ═══════════════════════════════════════════════

  private _bindEvents(): void {
    // ── loggedOn: setPersona + gamesPlayed ──
    this.client.on('loggedOn', () => {
      this._steamId = this.client.steamID?.getSteamID64?.() || null;
      console.log(`[SteamBot] Logged on as ${this._steamId}`);
      this.client.setPersona(SteamUser.EPersonaState.Online);
      this.client.gamesPlayed([730]);    // → triggers GC connection

      if (this._pendingLogin) {
        this._pendingLogin.loginDone = true;
        this._pendingLogin.resolve({ success: true, steamId: this._steamId! });
        this._syncAccount();
        this._pendingLogin = null;
      }
    });

    // ── refreshToken: persist immediately ──
    this.client.on('refreshToken', (token: string) => {
      const sid = this._steamId || this.client.steamID?.getSteamID64?.();
      if (sid && this._pendingLogin?.accountName) {
        AccountRepo.upsert({
          steamId: sid,
          accountName: this._pendingLogin.accountName,
          nickname: this._nickname || this._pendingLogin.accountName,
          refreshToken: token,
        });
        console.log(`[SteamBot] refreshToken saved for ${sid}`);
      }
      this.emit('refreshToken', token);
    });

    // ── machineAuthToken: save sentry file ──
    this.client.on('machineAuthToken', (token: string) => {
      const sid = this._steamId || this.client.steamID?.getSteamID64?.();
      if (sid) {
        AccountRepo.updateMachineToken(sid, token);
        console.log(`[SteamBot] machineAuthToken saved for ${sid}`);
      }
    });

    // ── steamGuard: enforce 30s cooldown on wrong code ──
    this.client.on('steamGuard', (
      domain: string | null,
      callback: (code: string) => void,
      lastCodeWrong: boolean,
    ) => {
      if (lastCodeWrong) {
        // Per tech reference: MUST wait 30 seconds on wrong TOTP to avoid IP ban
        console.warn(`[SteamBot] Wrong guard code — waiting 30s before accepting new code`);
        this.emit('steamGuardNeeded', { domain, lastCodeWrong: true, cooldown: 30 });
        setTimeout(() => {
          this.emit('steamGuardNeeded', { domain, lastCodeWrong: false, cooldown: 0 });
          this._guardCallback = callback;
        }, 30000);
      } else {
        this.emit('steamGuardNeeded', { domain, lastCodeWrong: false, cooldown: 0 });
        this._guardCallback = callback;
      }
    });
    this.client.on('steamGuard', () => {}); // ensure listener bound (avoids stdin prompt)

    // ── disconnected: token expiry → clear, else autoRelogin ──
    this.client.on('disconnected', (eresult: number, msg: string) => {
      const eresultName = SteamUser.EResult?.[eresult] || String(eresult);
      console.log(`[SteamBot] Disconnected: ${msg} (${eresultName})`);

      if (eresult === 84 || eresult === 63) {
        // Token expired/invalid — clear it
        const sid = this._steamId || this.client.steamID?.getSteamID64?.();
        if (sid) {
          AccountRepo.updateToken(sid, '');
          console.log(`[SteamBot] Cleared expired token for ${sid}`);
        }
      }

      if (this._pendingLogin && !this._pendingLogin.loginDone) {
        // Login never completed
        this._pendingLogin.resolve({ success: false, error: `${msg} (${eresultName})` });
        this._pendingLogin = null;
      }
      // autoRelogin is true by default — steam-user handles reconnection
    });

    // ── error: fatal — clear token, notify ──
    this.client.on('error', (err: any) => {
      console.error(`[SteamBot] Fatal error: ${err.message || err} (eresult=${err.eresult})`);
      if (err.eresult === 84 || err.message?.includes('InvalidToken')) {
        const sid = this._steamId || this.client.steamID?.getSteamID64?.();
        if (sid) AccountRepo.updateToken(sid, '');
      }
      if (this._pendingLogin && !this._pendingLogin.loginDone) {
        this._pendingLogin.resolve({ success: false, error: err.message || String(err) });
        this._pendingLogin = null;
      }
    });

    // ── GC events ──
    this.csgo.on('connectedToGC', () => {
      this._gcReady = true;
      console.log(`[SteamBot] GC ready — ${this.csgo.inventory?.length || 0} items`);
      this.emit('inventoryReady', this.csgo.inventory);
    });
    this.csgo.on('disconnectedFromGC', () => { this._gcReady = false; });
    this.csgo.on('itemAcquired', (item: unknown) => this.emit('itemAcquired', item));
    this.csgo.on('itemChanged', (oldItem: unknown, newItem: unknown) => this.emit('itemChanged', oldItem, newItem));
    this.csgo.on('itemRemoved', (item: unknown) => this.emit('itemRemoved', item));
    this.csgo.on('craftingComplete', (recipe: number, items: unknown[]) => this.emit('craftingComplete', recipe, items));
  }

  // ═══════════════════════════════════════════════
  //  Guard code — stored callback pattern
  // ═══════════════════════════════════════════════

  private _guardCallback: ((code: string) => void) | null = null;

  submitSteamGuard(code: string): void {
    if (this._guardCallback) {
      const cb = this._guardCallback;
      this._guardCallback = null;
      cb(code);
    }
  }

  // ═══════════════════════════════════════════════
  //  Public API
  // ═══════════════════════════════════════════════

  get steamId(): string | null { return this._steamId; }
  get accountName(): string | null { return this._accountName; }
  get nickname(): string | null { return this._nickname; }
  get isGCReady(): boolean { return this._gcReady && this.csgo.haveGCSession; }

  /**
   * Login — per tech reference token-first strategy.
   *   1. Check DB for saved refresh_token → try token login
   *   2. No token → password login
   *   3. Proxy applied via Object.assign before logOn
   */
  async login(params: {
    accountName: string;
    password: string;
    proxyUrl?: string;
    nickname?: string;
  }): Promise<LoginResult> {
    this._accountName = params.accountName;
    this._nickname = params.nickname || params.accountName;

    // ── Proxy: Object.assign pattern from tech reference ──
    if (params.proxyUrl) {
      if (params.proxyUrl.startsWith('socks')) {
        Object.assign(this.client.options, { socksProxy: params.proxyUrl });
      } else {
        Object.assign(this.client.options, { httpProxy: params.proxyUrl });
      }
    }

    return new Promise((resolve) => {
      this._pendingLogin = {
        accountName: params.accountName,
        password: params.password,
        nickname: params.nickname,
        resolve,
        loginDone: false,
      };

      // Look up saved token by account_name
      const saved = AccountRepo.getAll().find(a => a.account_name === params.accountName);

      if (saved?.refresh_token) {
        console.log(`[SteamBot] Token login for ${params.accountName}`);
        this.client.logOn({
          refreshToken: saved.refresh_token,
          steamID: saved.steam_id,
        });
      } else {
        console.log(`[SteamBot] Password login for ${params.accountName}`);
        this.client.logOn({
          accountName: params.accountName,
          password: params.password,
        });
      }
    });
  }

  logout(): void {
    this.client.gamesPlayed([]);
    setTimeout(() => {
      this.client.logOff();
      this._steamId = null;
      this._gcReady = false;
    }, 500);
  }

  // ═══════════════════════════════════════════════
  //  Internal
  // ═══════════════════════════════════════════════

  private _syncAccount(): void {
    if (!this._steamId || !this._accountName) return;
    const existing = AccountRepo.getBySteamId(this._steamId)
      || AccountRepo.getByAccountName(this._accountName);
    AccountRepo.upsert({
      steamId: this._steamId,
      accountName: this._accountName,
      nickname: existing?.nickname || this._nickname || this._accountName,
      proxyUrl: existing?.proxy_url || undefined,
    });
    AccountRepo.setActive(this._steamId);
  }
}
