/**
 * 盘镜 MarketLens — 共享数据仓
 * 多个视图共用同一份报价，避免重复请求。
 */

import { fetchQuotes } from '../core/api.js';
import { ALL_INDICES, SECTORS } from '../config.js';
import { state } from '../core/store.js';

export const feed = {
  quotes: new Map(), // symbol -> { symbol, price, change, changePercent, previousClose }
  series: new Map(), // symbol -> number[]
  updatedAt: 0,
};

/**
 * 全站共用的报价集合：指数 + 板块 + 自选股。
 *
 * 所有需要报价的视图都用这一个集合，分片方式一致，
 * 服务端缓存命中同一条路径，Yahoo 那边也只会收到一次请求。
 */
export function marketSymbols() {
  return [
    ...ALL_INDICES.map((i) => i.symbol),
    ...SECTORS.map((s) => s.symbol),
    ...state.watchlist,
  ];
}

/** 把 spark 接口的一条记录转成统一报价 */
function toQuote(symbol, raw) {
  return {
    symbol,
    price: raw.fulldayPrice ?? raw.regularMarketPrice ?? null,
    change: raw.fulldayChange ?? null,
    changePercent: raw.fulldayChangePercent ?? null,
    previousClose: raw.previousClose ?? raw.chartPreviousClose ?? null,
  };
}

/**
 * 批量取报价并写入 feed。
 * @param {string[]} symbols
 * @returns {Promise<Map<string, object>>}
 */
export async function loadQuotes(symbols) {
  const list = [...new Set((symbols || []).filter(Boolean))];
  if (!list.length) return feed.quotes;
  const { data } = await fetchQuotes(list);
  for (const [symbol, raw] of Object.entries(data || {})) {
    feed.quotes.set(symbol, toQuote(symbol, raw));
    feed.series.set(symbol, raw.close || []);
  }
  feed.updatedAt = Date.now();
  return feed.quotes;
}

/** 载入全站共用的报价集合 */
export function loadMarketQuotes() {
  return loadQuotes(marketSymbols());
}

/** 取报价（可能为空） */
export function quote(symbol) {
  return feed.quotes.get(symbol) || null;
}

/** 取走势序列 */
export function series(symbol) {
  return feed.series.get(symbol) || [];
}
