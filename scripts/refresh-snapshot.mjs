#!/usr/bin/env node
/**
 * 盘镜 MarketLens — 行情快照生成器
 *
 * 从 Yahoo Finance 拉一份真实行情，写入 public/js/data/snapshot.json。
 * 用途：行情服务不可用（离线 / 被限流 / 直接开静态文件）时，界面仍然有真实数据可看。
 *
 * 用法：npm run snapshot
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALL_INDICES, SECTORS, DEFAULT_WATCHLIST } from '../public/js/config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, '..', 'public', 'js', 'data', 'snapshot.json');
const BASE = 'https://query1.finance.yahoo.com';
const GAP = 700;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let lastCall = 0;
async function get(pathname, search = '') {
  const wait = Math.max(0, GAP - (Date.now() - lastCall));
  if (wait) await sleep(wait);
  lastCall = Date.now();
  const url = `${BASE}${pathname}${search}`;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (res.status === 200) return await res.json();
      if (res.status === 429 || res.status >= 500) {
        await sleep(1200 * attempt);
        continue;
      }
      throw new Error(`HTTP ${res.status} @ ${pathname}`);
    } catch (err) {
      if (attempt === 3) throw err;
      await sleep(1200 * attempt);
    }
  }
  throw new Error(`无法获取 ${pathname}`);
}

const symbols = [
  ...new Set([...ALL_INDICES.map((i) => i.symbol), ...SECTORS.map((s) => s.symbol), ...DEFAULT_WATCHLIST]),
];

async function main() {
  console.log(`拉取 ${symbols.length} 个标的的报价…`);
  // Yahoo 的 spark 接口单次最多 20 个代码，超了会 400，所以分批取。
  const spark = {};
  for (let i = 0; i < symbols.length; i += 20) {
    const chunk = symbols.slice(i, i + 20);
    const payload = await get(
      '/v8/finance/spark',
      `?symbols=${encodeURIComponent(chunk.join(','))}&range=3mo&interval=1d&indicators=close`,
    );
    Object.assign(spark, payload || {});
  }

  const names = new Map();
  ALL_INDICES.forEach((i) => names.set(i.symbol, i.name));
  SECTORS.forEach((s) => names.set(s.symbol, s.name));

  console.log('拉取榜单…');
  const [gainers, losers, actives] = await Promise.all([
    get('/v1/finance/screener/predefined/saved', '?scrIds=day_gainers&count=10&start=0'),
    get('/v1/finance/screener/predefined/saved', '?scrIds=day_losers&count=10&start=0'),
    get('/v1/finance/screener/predefined/saved', '?scrIds=most_actives&count=10&start=0'),
  ]);

  const movers = {};
  for (const [key, payload] of Object.entries({ day_gainers: gainers, day_losers: losers, most_actives: actives })) {
    const quotes = payload?.finance?.result?.[0]?.quotes || [];
    movers[key] = quotes.map((q) => {
      names.set(q.symbol, q.shortName || q.displayName || q.symbol);
      return {
        symbol: q.symbol,
        name: q.shortName || q.displayName || q.symbol,
        price: q.regularMarketPrice,
        change: q.regularMarketChange,
        changePercent: q.regularMarketChangePercent,
        volume: q.regularMarketVolume,
        marketCap: q.marketCap,
        currency: q.currency,
        exchange: q.exchange,
        sector: q.sector,
        industry: q.industry,
        fiftyTwoWeekHigh: q.fiftyTwoWeekHigh,
        fiftyTwoWeekLow: q.fiftyTwoWeekLow,
        trailingPE: q.trailingPE,
      };
    });
  }

  console.log('拉取热门榜与新闻…');
  const trending = await get('/v1/finance/trending/US', '?count=12');
  const newsPayload = await get('/v1/finance/search', '?q=stock%20market&quotesCount=0&newsCount=12');

  // 补齐默认自选股的中文/英文名称
  for (const symbol of DEFAULT_WATCHLIST) {
    if (names.has(symbol)) continue;
    try {
      const res = await get('/v1/finance/search', `?q=${encodeURIComponent(symbol)}&quotesCount=3&newsCount=0`);
      const hit = (res.quotes || []).find((q) => q.symbol === symbol);
      if (hit) names.set(symbol, hit.longname || hit.shortname || symbol);
    } catch {
      names.set(symbol, symbol);
    }
  }

  const out = {
    generatedAt: Date.now(),
    source: 'Yahoo Finance',
    note: '离线快照，仅在行情服务不可用时使用。运行 npm start 可获取实时行情。',
    symbols: {},
    movers,
    trending: (trending?.finance?.result?.[0]?.quotes || []).map((q) => q.symbol),
    news: (newsPayload?.news || []).map((n) => ({
      id: n.uuid,
      title: n.title,
      publisher: n.publisher,
      link: n.link,
      time: (n.providerPublishTime || 0) * 1000,
      tickers: n.relatedTickers || [],
    })),
  };

  for (const symbol of symbols) {
    const raw = spark?.[symbol];
    if (!raw) continue;
    const closes = (raw.close || []).filter((v) => typeof v === 'number');
    const timestamps = raw.timestamp || [];
    out.symbols[symbol] = {
      symbol,
      name: names.get(symbol) || symbol,
      price: raw.fulldayPrice ?? null,
      previousClose: raw.previousClose ?? raw.chartPreviousClose ?? null,
      change: raw.fulldayChange ?? null,
      changePercent: raw.fulldayChangePercent ?? null,
      currency: 'USD',
      exchange: '',
      closes: closes.slice(-64),
      timestamps: timestamps.slice(-64),
    };
  }

  await fs.mkdir(path.dirname(OUT), { recursive: true });
  await fs.writeFile(OUT, `${JSON.stringify(out, null, 2)}\n`, 'utf8');
  console.log(`已写入 ${OUT}`);
  console.log(`  标的 ${Object.keys(out.symbols).length} 个 · 榜单 ${Object.keys(movers).length} 组 · 新闻 ${out.news.length} 条`);
}

main().catch((err) => {
  console.error('快照生成失败：', err.message);
  process.exit(1);
});
