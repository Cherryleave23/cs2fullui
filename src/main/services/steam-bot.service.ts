/**
 * SteamBotService — canonical login flow per steam-cs2-bot tech reference.
 *
 * Reference: "Login + Token 持久化 (完整生产级)"
 *   - enablePicsCache: true  (REQUIRED)
 *   - webCompatibilityMode: true  (WebSocket:443 through firewalls)
 *   - autoRelogin: true  (reconnect on non-fatal disconnect)
 *   - Proxy via applyProxy() before logOn
 *   - Token-first: reload saved token → password fallback
 *   - refreshToken/machineAuthToken → persist immediately
 *   - steamGuard → enforce 30s cooldown on wrong code
 *   - loggedOn → setPersona + gamesPlayed
 *   - disconnected/error → clear expired token (eresult 84/63)
 *   - machineAuthToken passback on password login (skip email guard)
 */
import SteamUser from 'steam-user';
import GlobalOffensive from 'globaloffensive';
import { EventEmitter } from 'events';
import { AccountRepo } from '../db/repositories/account.repo';

export interface LoginResult { success: boolean; steamId?: string; error?: string; }

interface PendingLogin {
  accountName: string;
  password: string;
  nickname?: string;
  resolve: (r: LoginResult) => void;
  loginDone: boolean;
  timeout: ReturnType<typeof setTimeout>;
}

/** Apply proxy to SteamUser client per canonical Object.assign pattern */
export function applyProxy(client: SteamUser, proxyUrl?: string): void {
  if (!proxyUrl) return;
  Object.assign(client.options, proxyUrl.startsWith('socks')
    ? { socksProxy: proxyUrl } : { httpProxy: proxyUrl });
}

export class SteamBotService extends EventEmitter {
  client: any;
  csgo: any;
  private _steamId: string | null = null;
  private _accountName: string | null = null;
  private _nickname: string | null = null;
  private _gcReady = false;
  private _pendingLogin: PendingLogin | null = null;
  private _guardCallback: ((code: string) => void) | null = null;
  private _lastNonFatalLog = new Map<string, number>();
  private _connectAttempts = 0;

  private _logThrottled(key: string, msg: string, interval = 30000): void {
    const now = Date.now();
    const last = this._lastNonFatalLog.get(key) || 0;
    if (now - last > interval) {
      console.log(msg);
      this._lastNonFatalLog.set(key, now);
    }
  }

  constructor() {
    super();
    this.client = new SteamUser({
      enablePicsCache: true,
      changelistUpdateInterval: 60000,
      webCompatibilityMode: true,
      autoRelogin: true,
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
      console.log(`[SteamBot] Logged on: ${this._steamId}`);
      this.client.setPersona(SteamUser.EPersonaState.Online);
      this.client.gamesPlayed([730]);

      if (this._pendingLogin) {
        clearTimeout(this._pendingLogin.timeout);
        this._pendingLogin.loginDone = true;
        this._pendingLogin.resolve({ success: true, steamId: this._steamId! });
        this._syncAccount();
        this._pendingLogin = null;
      }
      this.emit('loggedOn', this._steamId);
    });

    // ── refreshToken: persist immediately ──
    this.client.on('refreshToken', (token: string) => {
      const sid = this._steamId || this.client.steamID?.getSteamID64?.();
      if (sid && token) {
        AccountRepo.upsert({
          steamId: sid,
          accountName: this._accountName!,
          nickname: this._nickname || this._accountName!,
          refreshToken: token,
        });
        console.log(`[SteamBot] refreshToken saved: ${sid}`);
      }
      this.emit('refreshToken', token);
    });

    // ── machineAuthToken: save sentry file ──
    this.client.on('machineAuthToken', (token: string) => {
      const sid = this._steamId || this.client.steamID?.getSteamID64?.();
      if (sid) {
        AccountRepo.upsert({ steamId: sid, accountName: this._accountName!, machineToken: token });
        console.log(`[SteamBot] machineAuthToken saved: ${sid}`);
      }
      this.emit('machineAuthToken', token);
    });

    // ── steamGuard: enforce 30s cooldown on wrong code ──
    this.client.on('steamGuard', (
      domain: string | null,
      callback: (code: string) => void,
      lastCodeWrong: boolean,
    ) => {
      if (lastCodeWrong) {
        console.warn(`[SteamBot] Wrong guard — 30s cooldown`);
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

    // ── webSession: emit for UI ──
    this.client.on('webSession', (sessionID: string, cookies: string[]) => {
      console.log(`[SteamBot] Web session established`);
      this.emit('webSession', sessionID, cookies);
    });

    // ── disconnected: clear expired token, non-fatal → autoRelogin handles ──
    this.client.on('disconnected', (eresult: number, msg: string) => {
      const name = SteamUser.EResult?.[eresult] || String(eresult);
      // Throttle non-critical disconnects to avoid log spam
      if (eresult === 84 || eresult === 63) {
        console.log(`[SteamBot] Disconnected: ${msg} (${name})`);
        const sid = this._steamId || this.client.steamID?.getSteamID64?.();
        if (sid && this._accountName) {
          AccountRepo.upsert({ steamId: sid, accountName: this._accountName, refreshToken: '' });
        }
      } else {
        this._logThrottled('disconnect', `[SteamBot] Disconnected: ${msg} (${name})`, 60000);
      }
      if (this._pendingLogin && !this._pendingLogin.loginDone) {
        clearTimeout(this._pendingLogin.timeout);
        this._pendingLogin.resolve({ success: false, error: `${msg} (${name})` });
        this._pendingLogin = null;
      }
      this.emit('disconnected', eresult, msg);
    });

    // ── error: fatal → clear token (eresult 84/63), non-fatal → keep session ──
    this.client.on('error', (err: any) => {
      const isTokenExpired = err.eresult === 84 || err.eresult === 63;
      const isSessionConflict = err.eresult === 6;

      if (isTokenExpired || isSessionConflict) {
        console.error(`[SteamBot] Auth error: ${err.message} (eresult=${err.eresult})`);
        const sid = this._steamId || this.client.steamID?.getSteamID64?.();
        if (sid && this._accountName) {
          AccountRepo.upsert({ steamId: sid, accountName: this._accountName, refreshToken: '' });
        }
      } else {
        // Throttle non-fatal network errors (proxy instability)
        this._logThrottled('network', `[SteamBot] Network: ${err.message}`, 60000);
      }

      if (this._pendingLogin && !this._pendingLogin.loginDone) {
        clearTimeout(this._pendingLogin.timeout);
        this._pendingLogin.resolve({ success: false, error: err.message || String(err) });
        this._pendingLogin = null;
      }

      if (isTokenExpired || err.eresult === 15 || err.eresult === 5) {
        this.emit('fatalError', err);
      } else if (isSessionConflict) {
        console.log(`[SteamBot] LoggedInElsewhere — autoRelogin will reconnect`);
      }
      // Non-fatal: autoRelogin handles reconnection silently
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
    this.csgo.on('error', (err: any) => console.error(`[SteamBot] GC error: ${err.message}`));
  }

  // ═══════════════════════════════════════════════
  //  Guard callback
  // ═══════════════════════════════════════════════
  submitSteamGuard(code: string): void {
    if (this._guardCallback) { const cb = this._guardCallback; this._guardCallback = null; cb(code); }
  }

  // ═══════════════════════════════════════════════
  //  Public API
  // ═══════════════════════════════════════════════
  get steamId(): string | null { return this._steamId; }
  get accountName(): string | null { return this._accountName; }
  get nickname(): string | null { return this._nickname; }
  get isGCReady(): boolean { return this._gcReady && this.csgo?.haveGCSession; }
  get guardPending(): boolean { return this._guardCallback !== null; }

  /**
   * Login — canonical token-first strategy.
   *   1. DB lookup saved refresh_token + machine_token → try token login
   *   2. No token → password login with saved machineAuthToken (skip email guard)
   *   3. Proxy applied via applyProxy() before logOn
   */
  async login(params: {
    accountName: string;
    password: string;
    proxyUrl?: string;
    nickname?: string;
  }): Promise<LoginResult> {
    this._accountName = params.accountName;
    this._nickname = params.nickname || params.accountName;

    // Apply proxy before logOn
    applyProxy(this.client, params.proxyUrl);

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this._pendingLogin = null;
        resolve({ success: false, error: '连接超时 (60s) — 请检查网络或代理' });
      }, 60000);

      this._pendingLogin = {
        accountName: params.accountName,
        password: params.password,
        nickname: params.nickname,
        resolve,
        loginDone: false,
        timeout,
      };

      // Look up saved tokens by account_name
      const saved = AccountRepo.getAll().find(a => a.account_name === params.accountName);

      if (saved?.refresh_token) {
        console.log(`[SteamBot] Token login: ${params.accountName}`);
        this.client.logOn({
          refreshToken: saved.refresh_token,
          steamID: saved.steam_id,
        });
      } else {
        console.log(`[SteamBot] Password login: ${params.accountName}`);
        this.client.logOn({
          accountName: params.accountName,
          password: params.password,
          machineAuthToken: saved?.machine_token || undefined,
        });
      }
    });
  }

  /** Auto-login with stored refresh token (no password fallback) */
  async autoLogin(): Promise<LoginResult> {
    const accounts = AccountRepo.getAll();
    const active = accounts.find(a => a.is_active === 1 && a.refresh_token);
    if (!active) return { success: false, error: 'No saved active account' };

    this._accountName = active.account_name;
    this._nickname = active.nickname || active.account_name;

    if (active.proxy_url) {
      applyProxy(this.client, active.proxy_url);
    }

    return new Promise((resolve) => {
      const timeout = setTimeout(() => resolve({ success: false, error: '自动登录超时 (30s)' }), 30000);
      this._pendingLogin = {
        accountName: active.account_name,
        password: '',
        nickname: active.nickname,
        resolve,
        loginDone: false,
        timeout,
      };
      console.log(`[SteamBot] Auto-login: ${active.account_name}`);
      this.client.logOn({
        refreshToken: active.refresh_token!,
        steamID: active.steam_id,
      });
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

/** Singleton instance — shared between IPC handlers */
let _instance: SteamBotService | null = null;
export function getSteamBot(): SteamBotService {
  if (!_instance) _instance = new SteamBotService();
  return _instance;
}
