/**
 * CSQAQ Price Service — 市场聚合价格拉取
 *
 * 从 CSQAQ API 拉取价格，存入 SQLite（PriceRepo）
 * 支持 SOCKS5 代理（从账号设置读取）
 */

import { SocksProxyAgent } from 'socks-proxy-agent';
import * as https from 'https';
import * as http from 'http';
import { PriceRepo } from '../db/repositories/price.repo';
import { SettingsRepo } from '../db/repositories/settings.repo';
import { AccountRepo } from '../db/repositories/account.repo';

const API_URL = 'https://api.csqaq.com/api/v1/goods/getPriceByMarketHashName';
const SOURCE = 'csqaq';

class CsqaPriceService {
  private token = '';
  private proxyUrl = '';

  /** 从设置中加载 Token 和代理 */
  private loadConfig(): void {
    this.token = SettingsRepo.get('csqaq_api_token', '') || '';
    this.proxyUrl = '';
    const active = AccountRepo.getActive();
    if (active?.proxy_url) {
      this.proxyUrl = active.proxy_url;
    }
  }

  /** 批量拉取价格，自动分批（每批最多50个） */
  async fetch(marketHashNames: string[]): Promise<{ fetched: number; failed: number }> {
    this.loadConfig();

    if (!this.token) {
      console.warn('[CsqaService] 未配置 CSQAQ API Token');
      return { fetched: 0, failed: 0 };
    }

    const unique = [...new Set(marketHashNames)];
    const batchSize = 50;
    let fetched = 0;
    let failed = 0;

    for (let i = 0; i < unique.length; i += batchSize) {
      const batch = unique.slice(i, i + batchSize);
      try {
        const result = await this._requestBatch(batch);
        if (result.success && result.data) {
          const entries: Array<{
            itemHashName: string;
            source: string;
            currentPrice: number | null;
            lowestPrice?: number;
            medianPrice?: number;
            dataJson?: string;
          }> = [];

          // 成功的数据
          for (const [name, priceData] of Object.entries(result.data.success || {})) {
            const pd = priceData as any;
            entries.push({
              itemHashName: name,
              source: SOURCE,
              currentPrice: pd.buffSellPrice ?? null,
              lowestPrice: pd.steamSellPrice ?? null,
              dataJson: JSON.stringify(pd),
            });
            fetched++;
          }

          // 失败的数据
          if (Array.isArray(result.data.error)) {
            for (const errName of result.data.error) {
              // 记录为 null 价格
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
        } else {
          failed += batch.length;
        }
      } catch (err: any) {
        console.error(`[CsqaService] 批次请求失败: ${err.message}`);
        failed += batch.length;
      }

      // 批次间延迟 200ms
      if (i + batchSize < unique.length) {
        await new Promise(r => setTimeout(r, 200));
      }
    }

    return { fetched, failed };
  }

  /** 发送单次批次请求 */
  private _requestBatch(names: string[]): Promise<{
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
          'ApiToken': this.token,
          'User-Agent': 'CS2TradeTool/1.0',
        },
        timeout: 15000,
        rejectUnauthorized: false,
      };

      if (this.proxyUrl) {
        (options as any).agent = new SocksProxyAgent(this.proxyUrl);
      }

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (parsed.code === 200) {
              resolve({ success: true, data: parsed.data, msg: parsed.msg });
            } else {
              resolve({ success: false, msg: parsed.msg || `HTTP ${res.statusCode}` });
            }
          } catch {
            resolve({ success: false, msg: 'JSON 解析失败' });
          }
        });
      });

      req.on('error', (err) => resolve({ success: false, msg: err.message }));
      req.on('timeout', () => { req.destroy(); resolve({ success: false, msg: '超时' }); });
      req.write(body);
      req.end();
    });
  }
}

export const csqaService = new CsqaPriceService();
