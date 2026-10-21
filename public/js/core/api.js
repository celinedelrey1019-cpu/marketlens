/**
 * 盘镜 MarketLens — 数据层
 *
 * 浏览器直连 Yahoo 是走不通的：query1 接口不回 Access-Control-Allow-Origin，
 * fetch 会被 CORS 拦掉。所以正常路径是同源反代 /api/yf/*（见 server.js）。
 *
 * 兜底路径：仓库里带了一份真实行情快照 public/js/data/snapshot.json。
 * 拿不到实时数据时用它渲染，界面不会开天窗，并明确提示「离线快照」。
 */

import { esc } from './dom.js';

const PROXY_BASE = '/api/yf';
const SNAPSHOT_URL = '/js/data/snapshot.json';

/** Yahoo spark 接口单次最多 20 个代码 */
const SPARK_CHUNK_SIZE = 20;

export const source = {
  mode: 'unknown', // live | snapshot | error
  latency: 0,
  lastError: null,
  lastUpdated: 0,
  proxyAvailable: null,
};

let snapshotPromise = null;

/** 客户端短缓存，避免同一路径在一次渲染里被重复请求 */
const clientCache = new Map();
const CLIENT_TTL = 8_000;

function cacheGet(path) {
  const hit = clientCache.get(path);
  if (!hit) return null;
  if (Date.now() - hit.ts > CLIENT_TTL) {
    clientCache.delete(path);
    return null;
  }
  return hit;
}

function loadSnapshot() {
  if (!snapshotPromise) {
    snapshotPromise = fetch(SNAPSHOT_URL)
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
  }
  return snapshotPromise;
}

/** 预热快照（首屏并行拉，不阻塞渲染） */
export function warmSnapshot() {
  return loadSnapshot();
}

/**
 * 统一的取数入口。
 * @param {string} path Yahoo 路径，如 '/v8/finance/chart/AAPL?range=1y&interval=1d'
 * @returns {Promise<{data: any, mode: 'live'|'snapshot'}>}
 */
export async function yfGet(path, { timeout = 30000, noCache = false } = {}) {
  const started = performance.now();
  if (!noCache) {
    const cached = cacheGet(path);
    if (cached) {
      source.mode = 'live';
      source.latency = performance.now() - started;
      source.lastUpdated = Date.now();
      return { data: cached.data, mode: 'live' };
    }
  }
  try {
    const res = await fetch(PROXY_BASE + path, {
      signal: AbortSignal.timeout(timeout),
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) {
      // 502 通常是上游被限流，等一下再试一次。
      if (res.status === 502 || res.status === 429) {
        await new Promise((r) => setTimeout(r, 2500));
        const retry = await fetch(PROXY_BASE + path, {
          signal: AbortSignal.timeout(timeout),
          headers: { Accept: 'application/json' },
        });
        if (retry.ok) {
          const data = await retry.json();
          source.mode = 'live';
          source.proxyAvailable = true;
          source.latency = performance.now() - started;
          source.lastError = null;
          source.lastUpdated = Date.now();
          clientCache.set(path, { ts: Date.now(), data });
          return { data, mode: 'live' };
        }
        throw new Error(`行情服务返回 ${retry.status}`);
      }
      throw new Error(`行情服务返回 ${res.status}`);
    }
    const data = await res.json();
    source.mode = 'live';
    source.proxyAvailable = true;
    source.latency = performance.now() - started;
    source.lastError = null;
    source.lastUpdated = Date.now();
    clientCache.set(path, { ts: Date.now(), data });
    return { data, mode: 'live' };
  } catch (err) {
    source.lastError = err.message;
    const snap = await loadSnapshot();
    const fallback = snap ? buildFallback(path, snap) : null;
    if (fallback) {
      source.mode = 'snapshot';
      source.proxyAvailable = false;
      source.latency = performance.now() - started;
      source.lastUpdated = Date.now();
      return { data: fallback, mode: 'snapshot' };
    }
    source.mode = 'error';
    throw err;
  }
}

/* ------------------------------------------------------------------ *
 * 快照 → Yahoo 形状的适配
 * ------------------------------------------------------------------ */
function parsePath(path) {
  const [pathname, search = ''] = path.split('?');
  const params = new URLSearchParams(search);
  return { pathname, params };
}

function buildFallback(path, snap) {
  const { pathname, params } = parsePath(path);

  if (pathname.startsWith('/v8/finance/spark')) {
    const symbols = (params.get('symbols') || '').split(',').map((s) => s.trim()).filter(Boolean);
    const out = {};
    for (const symbol of symbols) {
      const q = snap.symbols?.[symbol];
      if (!q) continue;
      out[symbol] = {
        symbol,
        previousClose: q.previousClose,
        chartPreviousClose: q.previousClose,
        fulldayPrice: q.price,
        fulldayChange: q.change,
        fulldayChangePercent: q.changePercent,
        close: q.closes || [],
        timestamp: q.timestamps || [],
      };
    }
    return out;
  }

  if (pathname.startsWith('/v8/finance/chart/')) {
    const symbol = decodeURIComponent(pathname.split('/').pop() || '');
    const q = snap.symbols?.[symbol];
    if (!q) return null;
    const closes = q.closes || [];
    const stamps = q.timestamps || [];
    const meta = {
      currency: q.currency || 'USD',
      symbol,
      exchangeName: q.exchange || '',
      fullExchangeName: q.exchange || '',
      instrumentType: 'EQUITY',
      regularMarketPrice: q.price,
      regularMarketChangePercent: q.changePercent,
      chartPreviousClose: q.previousClose,
      previousClose: q.previousClose,
      fiftyTwoWeekHigh: q.fiftyTwoWeekHigh,
      fiftyTwoWeekLow: q.fiftyTwoWeekLow,
      regularMarketDayHigh: q.dayHigh,
      regularMarketDayLow: q.dayLow,
      regularMarketVolume: q.volume,
      longName: q.name,
      shortName: q.shortName || q.name,
    };
    return {
      chart: {
        result: [
          {
            meta,
            timestamp: stamps,
            indicators: {
              quote: [
                {
                  open: closes,
                  high: closes,
                  low: closes,
                  close: closes,
                  volume: closes.map(() => q.volume || 0),
                },
              ],
            },
          },
        ],
        error: null,
      },
    };
  }

  if (pathname.startsWith('/v1/finance/screener')) {
    const scrId = params.get('scrIds') || 'day_gainers';
    const list = snap.movers?.[scrId] || [];
    return {
      finance: {
        result: [
          {
            id: scrId,
            title: scrId,
            quotes: list.map((m) => ({
              symbol: m.symbol,
              shortName: m.name,
              longName: m.name,
              displayName: m.name,
              regularMarketPrice: m.price,
              regularMarketChange: m.change,
              regularMarketChangePercent: m.changePercent,
              regularMarketVolume: m.volume,
              currency: m.currency || 'USD',
              exchange: m.exchange || '',
              marketCap: m.marketCap,
              sector: m.sector || '',
              industry: m.industry || '',
              fiftyTwoWeekHigh: m.fiftyTwoWeekHigh,
              fiftyTwoWeekLow: m.fiftyTwoWeekLow,
              trailingPE: m.trailingPE,
              marketState: 'CLOSED',
            })),
          },
        ],
        error: null,
      },
    };
  }

  if (pathname.startsWith('/v1/finance/trending')) {
    const list = snap.trending || [];
    return {
      finance: {
        result: [{ count: list.length, quotes: list.map((s) => ({ symbol: s })) }],
        error: null,
      },
    };
  }

  if (pathname.startsWith('/v1/finance/search')) {
    const q = (params.get('q') || '').trim().toLowerCase();
    const quotes = Object.values(snap.symbols || {})
      .filter(
        (s) =>
          !q ||
          s.symbol.toLowerCase().includes(q) ||
          (s.name || '').toLowerCase().includes(q),
      )
      .slice(0, 10)
      .map((s) => ({
        symbol: s.symbol,
        shortname: s.name,
        longname: s.name,
        exchange: s.exchange || '',
        exchDisp: s.exchange || '',
        quoteType: 'EQUITY',
        typeDisp: 'Equity',
      }));
    const news = (snap.news || [])
      .filter((n) => !q || n.title.toLowerCase().includes(q) || (n.tickers || []).some((t) => t.toLowerCase().includes(q)))
      .map((n) => ({
        uuid: n.id,
        title: n.title,
        publisher: n.publisher,
        link: n.link,
        providerPublishTime: Math.floor((n.time || 0) / 1000),
        type: 'STORY',
        relatedTickers: n.tickers || [],
      }));
    return { quotes, news, count: quotes.length };
  }

  return null;
}

/* ------------------------------------------------------------------ *
 * 业务级封装
 * ------------------------------------------------------------------ */

/**
 * 批量报价（一次 spark 请求拿到价格 + 日内走势）
 *
 * 注意：Yahoo 的 spark 接口单次最多接受 20 个代码，超了直接 400。
 * 所以这里按 20 个一组切片，再把结果合并。
 *
 * 同一组代码的并发请求会共享同一个在途 Promise，
 * 避免总览页和右栏为同一批代码各打一次上游。
 */
const inflightChunks = new Map();

export async function fetchQuotes(symbols) {
  const list = [...new Set((symbols || []).filter(Boolean))];
  if (!list.length) return { data: {}, mode: 'snapshot' };

  const chunks = [];
  for (let i = 0; i < list.length; i += SPARK_CHUNK_SIZE) {
    chunks.push(list.slice(i, i + SPARK_CHUNK_SIZE));
  }

  const results = await Promise.all(
    chunks.map((chunk) => {
      const path = `/v8/finance/spark?symbols=${encodeURIComponent(chunk.join(','))}&range=1d&interval=5m&indicators=close`;
      const pending = inflightChunks.get(path);
      if (pending) return pending;
      const promise = yfGet(path).finally(() => inflightChunks.delete(path));
      inflightChunks.set(path, promise);
      return promise;
    }),
  );

  const merged = {};
  let mode = 'live';
  for (const res of results) {
    Object.assign(merged, res.data || {});
    if (res.mode === 'snapshot') mode = 'snapshot';
  }
  return { data: merged, mode };
}

/** K 线 */
export async function fetchChart(symbol, range = '1y', interval = '1d') {
  const path = `/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}&includePrePost=false&events=div%2Csplit`;
  return yfGet(path);
}

/** 搜索（代码 + 新闻） */
export async function fetchSearch(query, quotesCount = 8, newsCount = 12) {
  const path = `/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=${quotesCount}&newsCount=${newsCount}&enableFuzzyQuery=false&quotesQueryId=tss_match_phrase_query&newsQueryId=news_cie_vespa`;
  return yfGet(path);
}

/** 榜单 */
export async function fetchMovers(scrId = 'day_gainers', count = 25) {
  const path = `/v1/finance/screener/predefined/saved?scrIds=${scrId}&count=${count}&start=0`;
  return yfGet(path);
}

/** 热门榜 */
export async function fetchTrending(region = 'US', count = 12) {
  const path = `/v1/finance/trending/${region}?count=${count}`;
  return yfGet(path);
}

/** 财务时间序列（营收 / 每股收益） */
export async function fetchFundamentals(symbol, types = ['annualTotalRevenue', 'annualDilutedEPS']) {
  const period1 = Math.floor(Date.now() / 1000) - 6 * 365 * 24 * 3600;
  const period2 = Math.floor(Date.now() / 1000) + 24 * 3600;
  const path = `/ws/fundamentals-timeseries/v1/finance/timeseries/${encodeURIComponent(symbol)}?symbol=${encodeURIComponent(symbol)}&type=${types.join(',')}&period1=${period1}&period2=${period2}&merge=false`;
  return yfGet(path);
}

/** 新闻（用搜索接口的 news 部分取） */
export async function fetchNews(query = 'stock market', count = 14) {
  const path = `/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=0&newsCount=${count}&enableFuzzyQuery=false&newsQueryId=news_cie_vespa`;
  return yfGet(path);
}

export { esc };
