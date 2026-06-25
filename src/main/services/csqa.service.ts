/**
 * CSQAQ Price Service — 市场聚合价格拉取
 *
 * 从 CSQAQ API 拉取价格，存入 SQLite（PriceRepo）
 * 支持 SOCKS5 代理（从账号设置读取）
 *
 * 多账号并行策略：
 *  - CSQAQ 服务器对单账号有短时间请求频率限制
 *  - 单账号：串行处理（批次间 200ms 延迟），避免触发限流
 *  - 多账号：每个账号分配若干批次，各账号并行处理
 *    并行度 = min(token 数, 批次数)
 *
 * API: https://docs.csqaq.com/api-283470032
 * POST https://api.csqaq.com/api/v1/goods/getPriceByMarketHashName
 * Body: { marketHashNameList: string[] }  (max 50 per request)
 * Response: { code: 200, msg, data: { success: { [name]: PriceData }, error: string[] } }
 */

import { SocksProxyAgent } from 'socks-proxy-agent';
import * as https from 'https';
import { PriceRepo } from '../db/repositories/price.repo';
import { SettingsRepo } from '../db/repositories/settings.repo';

const API_URL = 'https://api.csqaq.com/api/v1/goods/getPriceByMarketHashName';
const SOURCE = 'csqaq';

/** Max price threshold (CNY) — filter obviously invalid values */
const MAX_VALID_PRICE = 10_000_000;

/** Delay between batches for the same token (ms) — respects CSQAQ rate limit */
const BATCH_DELAY_MS = 200;

class CsqaPriceService {
  private tokens: string[] = [];
  private proxyUrl = '';

  /**
   * 从设置中加载 Token 列表和代理。
   *
   * Token 来源优先级：
   *  1. csqaq_api_tokens (JSON 数组) — 新格式，支持多账号
   *  2. csqaq_api_token (单个字符串) — 旧格式，向后兼容
   */
  private loadConfig(): void {
    // 优先读取新格式：带备注的账号列表
    const accounts = SettingsRepo.getJson<Array<{ label: string; token: string }>>('csqaq_api_accounts');
    if (accounts && Array.isArray(accounts) && accounts.length > 0) {
      this.tokens = accounts.filter(a => a && a.token && a.token.trim()).map(a => a.token.trim());
    } else {
      // 向后兼容：旧格式纯 token 数组
      const tokensJson = SettingsRepo.getJson<string[]>('csqaq_api_tokens');
      if (tokensJson && Array.isArray(tokensJson) && tokensJson.length > 0) {
        this.tokens = tokensJson.filter(t => t && t.trim());
      } else {
        // 最旧格式：单 token
        const single = SettingsRepo.get('csqaq_api_token', '') || '';
        this.tokens = single.trim() ? [single.trim()] : [];
      }
    }

    // CSQAQ 是国内服务，不需要代理
    // 代理仅用于 Steam 连接（Steam 在国内被墙）
    // 如果使用海外代理访问 CSQAQ，反而会导致 TLS 握手失败
    this.proxyUrl = '';
  }

  /**
   * 批量拉取价格，自动分批（每批最多50个）。
   *
   * 并行策略：
   *  - 1 个 token：串行（逐批处理，批次间 200ms 延迟）
   *  - N 个 token：将批次按 round-robin 分配给各 token，各 token 并行处理
   *    每个 token 内部仍然串行 + 延迟，避免单账号触发限流
   */
  async fetch(marketHashNames: string[]): Promise<{ fetched: number; failed: number }> {
    this.loadConfig();

    if (this.tokens.length === 0) {
      console.warn('[CsqaService] 未配置 CSQAQ API Token');
      return { fetched: 0, failed: 0 };
    }

    const unique = [...new Set(marketHashNames)];
    const batchSize = 50;

    // Split into batches
    const batches: string[][] = [];
    for (let i = 0; i < unique.length; i += batchSize) {
      batches.push(unique.slice(i, i + batchSize));
    }

    console.log(`[CsqaService] 共 ${unique.length} 个物品，分 ${batches.length} 批，使用 ${this.tokens.length} 个账号`);

    // Distribute batches across tokens using round-robin
    const tokenBatches: Map<string, string[][]> = new Map();
    this.tokens.forEach(t => tokenBatches.set(t, []));

    for (let i = 0; i < batches.length; i++) {
      const token = this.tokens[i % this.tokens.length];
      tokenBatches.get(token)!.push(batches[i]);
    }

    // Each token processes its batches in parallel with other tokens
    const results = await Promise.all(
      [...tokenBatches.entries()].map(([token, tokenBatchList]) =>
        this._processTokenBatches(token, tokenBatchList)
      )
    );

    let fetched = 0;
    let failed = 0;
    for (const r of results) {
      fetched += r.fetched;
      failed += r.failed;
    }

    console.log(`[CsqaService] 完成: fetched=${fetched}, failed=${failed}`);
    return { fetched, failed };
  }

  /**
   * Process all batches assigned to one token, serially with delay.
   * This runs in parallel with other tokens' processing.
   */
  private async _processTokenBatches(
    token: string,
    batchList: string[][],
  ): Promise<{ fetched: number; failed: number }> {
    let fetched = 0;
    let failed = 0;

    for (let i = 0; i < batchList.length; i++) {
      const batch = batchList[i];
      const result = await this._processBatch(batch, token);
      fetched += result.fetched;
      failed += result.failed;

      // Delay between batches for the same token (rate limit protection)
      if (i < batchList.length - 1) {
        await new Promise(r => setTimeout(r, BATCH_DELAY_MS));
      }
    }

    return { fetched, failed };
  }

  /**
   * Process a single batch: request with retry → parse → validate → upsert.
   */
  private async _processBatch(
    batch: string[],
    token: string,
  ): Promise<{ fetched: number; failed: number }> {
    const result = await this._requestBatchWithRetry(batch, token, 3);

    if (!result.success || !result.data) {
      return { fetched: 0, failed: batch.length };
    }

    const entries: Array<{
      itemHashName: string;
      source: string;
      currentPrice: number | null;
      lowestPrice?: number | null;
      medianPrice?: number | null;
      dataJson?: string;
    }> = [];

    let fetched = 0;
    let failed = 0;

    // Parse successful price data
    for (const [name, priceData] of Object.entries(result.data.success || {})) {
      const pd = priceData as any;

      const buffPrice = pd.buffSellPrice ?? null;
      const steamPrice = pd.steamSellPrice ?? null;
      const yyypPrice = pd.yyypSellPrice ?? null;

      const validBuff = this._validatePrice(buffPrice);
      const validSteam = this._validatePrice(steamPrice);
      const validYyyp = this._validatePrice(yyypPrice);

      entries.push({
        itemHashName: name,
        source: SOURCE,
        currentPrice: validBuff,
        lowestPrice: validSteam,
        medianPrice: validYyyp,
        dataJson: JSON.stringify(pd),
      });

      if (validBuff != null) fetched++;
      else failed++;
    }

    // Parse error list (items CSQAQ couldn't find)
    if (Array.isArray(result.data.error)) {
      for (const errName of result.data.error) {
        entries.push({
          itemHashName: errName,
          source: SOURCE,
          currentPrice: null,
        });
        failed++;
      }
    }

    if (entries.length > 0) {
      PriceRepo.batchUpsert(entries);
    }

    return { fetched, failed };
  }

  /**
   * Validate a price value: must be a positive number below MAX_VALID_PRICE.
   */
  private _validatePrice(price: unknown): number | null {
    if (price == null) return null;
    const n = typeof price === 'number' ? price : Number(price);
    if (!isFinite(n) || n <= 0 || n > MAX_VALID_PRICE) return null;
    return n;
  }

  /**
   * Request with retry (max 3 attempts, exponential backoff: 1s → 2s → 4s).
   * Auth errors (401/Token) are not retried.
   */
  private async _requestBatchWithRetry(
    names: string[],
    token: string,
    maxRetries: number,
  ): Promise<{
    success: boolean;
    data?: { success?: Record<string, unknown>; error?: string[] };
    msg?: string;
  }> {
    let lastResult: { success: boolean; data?: any; msg?: string } = { success: false, msg: 'no attempt' };

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      lastResult = await this._requestBatch(names, token);

      if (lastResult.success) return lastResult;

      // Don't retry on auth errors
      const msg = lastResult.msg || '';
      if (msg.includes('Token') || msg.includes('token') || msg.includes('401') || msg.includes('授权')) {
        console.error(`[CsqaService] 认证错误，不重试: ${msg}`);
        return lastResult;
      }

      if (attempt < maxRetries - 1) {
        const delay = Math.pow(2, attempt) * 1000; // 1s, 2s, 4s
        console.warn(`[CsqaService] 批次失败 (尝试 ${attempt + 1}/${maxRetries}): ${msg}, ${delay}ms 后重试`);
        await new Promise(r => setTimeout(r, delay));
      }
    }

    return lastResult;
  }

  /** 发送单次批次请求 */
  private _requestBatch(
    names: string[],
    token: string,
  ): Promise<{
    success: boolean;
    data?: { success?: Record<string, unknown>; error?: string[] };
    msg?: string;
  }> {
    return new Promise((resolve) => {
      const body = JSON.stringify({ marketHashNameList: names });
      const urlObj = new URL(API_URL);

      const options: https.RequestOptions = {
        hostname: urlObj.hostname,
        path: urlObj.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          'ApiToken': token,
          'User-Agent': 'CS2TradeTool/1.0',
        },
        timeout: 15000,
        // CSQAQ 服务器证书链可能不完整，需要跳过严格验证
        rejectUnauthorized: false,
        // 兼容性 TLS 选项
        minVersion: 'TLSv1.2',
        ciphers: 'DEFAULT:!aNULL:!eNULL:!MD5',
      };

      if (this.proxyUrl) {
        const agent = new SocksProxyAgent(this.proxyUrl);
        (options as any).agent = agent;
      }

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          // 空响应或 HTML 错误页 → JSON 解析会失败
          if (!data || data.trim().startsWith('<')) {
            console.warn(`[CsqaService] 非JSON响应 (HTTP ${res.statusCode}), 长度=${data.length}, 前100字符: ${data.slice(0, 100)}`);
            resolve({ success: false, msg: `非JSON响应 (HTTP ${res.statusCode})` });
            return;
          }
          try {
            const parsed = JSON.parse(data);
            if (parsed.code === 200) {
              resolve({ success: true, data: parsed.data, msg: parsed.msg });
            } else {
              resolve({ success: false, msg: parsed.msg || `HTTP ${res.statusCode}` });
            }
          } catch {
            console.warn(`[CsqaService] JSON解析失败 (HTTP ${res.statusCode}), 前200字符: ${data.slice(0, 200)}`);
            resolve({ success: false, msg: 'JSON 解析失败' });
          }
        });
      });

      req.on('error', (err) => {
        console.error(`[CsqaService] 请求错误: ${err.message}`);
        resolve({ success: false, msg: err.message });
      });
      req.on('timeout', () => { req.destroy(); resolve({ success: false, msg: '超时' }); });
      req.write(body);
      req.end();
    });
  }
}

export const csqaService = new CsqaPriceService();
