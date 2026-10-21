/**
 * 盘镜 MarketLens — 应用状态
 * 轻量发布订阅 + localStorage 持久化。
 */

import { DEFAULT_WATCHLIST, DEFAULT_SYMBOL, STORAGE_KEY } from '../config.js';

function loadPersisted() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

const persisted = loadPersisted();

export const state = {
  view: 'overview',
  market: persisted.market || 'us',
  symbol: persisted.symbol || DEFAULT_SYMBOL,
  timeframe: persisted.timeframe || '1mo',
  overlays: Array.isArray(persisted.overlays) ? persisted.overlays : ['ma20'],
  subpanel: persisted.subpanel || 'rsi',
  watchlist: Array.isArray(persisted.watchlist) && persisted.watchlist.length
    ? persisted.watchlist
    : [...DEFAULT_WATCHLIST],
  alerts: Array.isArray(persisted.alerts) ? persisted.alerts : [],
  theme: persisted.theme || 'dark',
  direction: persisted.direction || 'cn',
  moverTab: persisted.moverTab || 'day_gainers',
  watchSort: persisted.watchSort || { key: 'changePercent', dir: 'desc' },
  quoteCache: new Map(),
  loading: false,
  lastRefresh: 0,
};

const PERSIST_KEYS = [
  'market',
  'symbol',
  'timeframe',
  'overlays',
  'subpanel',
  'watchlist',
  'alerts',
  'theme',
  'direction',
  'moverTab',
  'watchSort',
];

export function persist() {
  const out = {};
  for (const key of PERSIST_KEYS) out[key] = state[key];
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(out));
  } catch {
    /* 隐私模式下 localStorage 可能不可用，忽略 */
  }
}

const listeners = new Map();

/** 订阅某个事件；返回退订函数 */
export function on(event, handler) {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add(handler);
  return () => listeners.get(event)?.delete(handler);
}

export function emit(event, payload) {
  listeners.get(event)?.forEach((fn) => {
    try {
      fn(payload);
    } catch (err) {
      console.error('[marketlens] 事件处理出错', event, err);
    }
  });
  listeners.get('*')?.forEach((fn) => fn(event, payload));
}

/** 更新状态并广播 */
export function update(patch, event = 'state') {
  Object.assign(state, patch);
  persist();
  emit(event, patch);
}

/* ── 自选股 ─────────────────────────────────────────────────── */
export function addToWatchlist(symbol) {
  const s = symbol.trim().toUpperCase();
  if (!s) return false;
  if (state.watchlist.includes(s)) return false;
  if (state.watchlist.length >= 50) return false; // 与原版一致：上限 50
  state.watchlist.push(s);
  persist();
  emit('watchlist');
  return true;
}

export function removeFromWatchlist(symbol) {
  const idx = state.watchlist.indexOf(symbol);
  if (idx < 0) return;
  state.watchlist.splice(idx, 1);
  persist();
  emit('watchlist');
}

export function moveInWatchlist(from, to) {
  if (from === to) return;
  const list = state.watchlist;
  if (from < 0 || from >= list.length) return;
  const [item] = list.splice(from, 1);
  list.splice(Math.max(0, Math.min(list.length, to)), 0, item);
  persist();
  emit('watchlist');
}

/* ── 价格提醒 ───────────────────────────────────────────────── */
export function addAlert({ symbol, type, price }) {
  const alert = {
    id: `al_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    symbol: symbol.trim().toUpperCase(),
    type,
    price: Number(price),
    createdAt: Date.now(),
    triggered: false,
  };
  state.alerts.push(alert);
  persist();
  emit('alerts');
  return alert;
}

export function removeAlert(id) {
  const idx = state.alerts.findIndex((a) => a.id === id);
  if (idx < 0) return;
  state.alerts.splice(idx, 1);
  persist();
  emit('alerts');
}

export function markAlertTriggered(id) {
  const alert = state.alerts.find((a) => a.id === id);
  if (!alert) return;
  alert.triggered = true;
  persist();
  emit('alerts');
}
