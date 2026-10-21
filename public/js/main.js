/**
 * 盘镜 MarketLens — 应用入口
 * 路由、顶栏 / 左轨 / 状态栏、自动刷新、价格提醒检查。
 */

import { MARKETS, REFRESH_MS, MOVER_TYPES } from './config.js';
import { state, update, on, persist, markAlertTriggered } from './core/store.js';
import { fetchMovers, source, warmSnapshot } from './core/api.js';
import { esc, delegate, $ } from './core/dom.js';
import { fmtPct, fmtPrice, fmtClock, dirClass, marketPhase } from './core/format.js';
import { renderTicker } from './ui/ticker.js';
import { initPalette } from './ui/palette.js';
import { toast, notify } from './ui/toast.js';
import { renderOverview } from './views/overview.js';
import { renderQuote } from './views/quote.js';
import { renderWatchlist } from './views/watchlist.js';
import { renderMovers } from './views/movers.js';
import { renderMonitor, renderAlerts } from './views/monitor.js';
import { feed, loadMarketQuotes } from './data/feed.js';

const center = $('#center');
const monitor = $('#monitor');
const railMarkets = $('#rail-markets');

/* ── 主题 / 配色 ───────────────────────────────────────────── */
function applyTheme() {
  document.documentElement.dataset.theme = state.theme;
  document.documentElement.dataset.direction = state.direction;
  $('#updown-glyph').textContent = state.direction === 'cn' ? '红涨' : '绿涨';
  localStorage.setItem('marketlens.theme', state.theme);
}

/* ── 市场状态灯 ─────────────────────────────────────────────── */
function renderSessionLeds() {
  const host = $('#session-leds');
  if (!host) return;
  const now = Date.now();
  host.innerHTML = MARKETS.map((market) => {
    const phase = marketPhase(now, market.open, market.close);
    const label = phase === 'open' ? '交易中' : phase === 'pre' ? '盘前' : '休市';
    return `<span class="session-led ${phase === 'open' ? 'open' : ''}">
      <i class="dot"></i>
      <span class="led-name">${esc(market.name)}</span>
      <span class="led-time">${esc(label)}</span>
    </span>`;
  }).join('');
}

/* ── 左轨市场列表 ───────────────────────────────────────────── */
function renderRailMarkets() {
  if (!railMarkets) return;
  const items = [{ id: 'all', name: '全部市场', index: null }];
  MARKETS.forEach((m) => {
    const first = m.indices[0];
    items.push({ id: m.id, name: m.name, index: first ? first.symbol : null });
  });

  railMarkets.innerHTML = items
    .map((item) => {
      const q = item.index ? feed.quotes.get(item.index) : null;
      const pct = q ? q.changePercent : null;
      return `<span class="rail-market ${state.market === item.id ? 'active' : ''}" data-market="${esc(item.id)}">
        <span>${esc(item.name)}</span>
        <span class="rm-chg ${dirClass(pct)}">${pct === null ? '—' : fmtPct(pct)}</span>
      </span>`;
    })
    .join('');
}

/* ── 状态栏 ─────────────────────────────────────────────────── */
function renderStatus() {
  const conn = $('#status-connection');
  const src = $('#status-source');
  const upd = $('#status-updated');
  const cdn = $('#status-countdown');

  const mode = source.mode;
  if (mode === 'live') {
    conn.innerHTML = '<i class="dot live"></i>行情服务已连接';
  } else if (mode === 'snapshot') {
    conn.innerHTML = '<i class="dot degraded"></i>离线快照模式';
  } else {
    conn.innerHTML = '<i class="dot offline"></i>行情服务不可用';
  }
  src.textContent = `数据源 Yahoo Finance · ${fmtLatency()}`;
  upd.textContent = source.lastUpdated ? `上次刷新 ${fmtClock(source.lastUpdated)}` : '上次刷新 —';
  cdn.textContent = countdownText;
}

function fmtLatency() {
  return source.latency ? `${Math.round(source.latency)}ms` : '—';
}

let countdownText = '自动刷新 —';
let countdownTimer = null;

/* ── 跑马灯 ─────────────────────────────────────────────────── */
async function refreshTicker() {
  const symbols = [];
  const seen = new Set();
  const push = (s) => {
    if (s && !seen.has(s)) {
      seen.add(s);
      symbols.push(s);
    }
  };

  // 跑马灯只用指数 + 自选股，不额外去拉成交活跃榜，省一次上游请求。
  MARKETS.forEach((m) => m.indices.forEach((i) => push(i.symbol)));
  state.watchlist.slice(0, 8).forEach(push);

  await loadMarketQuotes();

  const list = symbols
    .map((symbol) => {
      const q = feed.quotes.get(symbol);
      if (!q || q.price === null) return null;
      return { symbol, name: symbol, price: q.price, changePercent: q.changePercent };
    })
    .filter(Boolean);

  renderTicker($('#ticker-track'), list);
  renderRailMarkets();
}

/* ── 价格提醒检查 ───────────────────────────────────────────── */
function checkAlerts() {
  for (const alert of state.alerts) {
    if (alert.triggered) continue;
    const q = feed.quotes.get(alert.symbol);
    if (!q || q.price === null) continue;
    const hit = alert.type === 'above' ? q.price >= alert.price : q.price <= alert.price;
    if (!hit) continue;
    markAlertTriggered(alert.id);
    const title = `${alert.symbol} ${alert.type === 'above' ? '涨破' : '跌破'} ${fmtPrice(alert.price)}`;
    const body = `当前价 ${fmtPrice(q.price)}`;
    toast(title, body, alert.type === 'above' ? 'up' : 'down');
    notify(title, body);
  }
  if (monitor) renderAlerts(monitor);
}

/* ── 路由 ───────────────────────────────────────────────────── */
function parseHash() {
  const raw = (location.hash || '').replace(/^#\/?/, '');
  const [view, param] = raw.split('/');
  const known = ['overview', 'quote', 'watchlist', 'movers'];
  return {
    view: known.includes(view) ? view : 'overview',
    param: param ? decodeURIComponent(param) : '',
  };
}

let rendering = false;

async function render() {
  if (rendering) return;
  rendering = true;
  const { view, param } = parseHash();
  state.view = view;

  document.querySelectorAll('.rail-item').forEach((item) => {
    item.classList.toggle('active', item.dataset.view === view);
  });
  document.title = `${view === 'overview' ? '总览' : view === 'quote' ? '行情' : view === 'watchlist' ? '自选' : '榜单'} · 盘镜 MarketLens`;

  // 中栏与右栏并行渲染：服务端本来就串行排队，并行发起不会增加上游压力，
  // 但能让用户少等一半时间。
  const centerTask = (async () => {
    try {
      if (view === 'quote') await renderQuote(center, param || state.symbol);
      else if (view === 'watchlist') await renderWatchlist(center);
      else if (view === 'movers') await renderMovers(center);
      else await renderOverview(center);
    } catch (err) {
      center.innerHTML = `<div class="banner"><span class="bn-tag">错误</span><span>页面渲染失败：${esc(err.message)}</span></div>`;
    }
  })();

  const monitorTask = (async () => {
    try {
      await renderMonitor(monitor);
    } catch (err) {
      console.error('[marketlens] 监控列渲染失败', err);
    }
  })();

  await Promise.all([centerTask, monitorTask]);

  renderStatus();
  rendering = false;
}

/* ── 自动刷新 ───────────────────────────────────────────────── */
async function refreshAll() {
  const { view } = parseHash();
  await render();
  await refreshTicker();
  checkAlerts();

  let remaining = REFRESH_MS / 1000;
  clearInterval(countdownTimer);
  countdownTimer = setInterval(() => {
    remaining -= 1;
    if (remaining <= 0) {
      clearInterval(countdownTimer);
      countdownText = '自动刷新中…';
      renderStatus();
      return;
    }
    countdownText = `${remaining} 秒后自动刷新`;
    renderStatus();
  }, 1000);
}

/* ── 事件绑定 ───────────────────────────────────────────────── */
function bindShell() {
  $('#theme-toggle')?.addEventListener('click', () => {
    update({ theme: state.theme === 'dark' ? 'light' : 'dark' });
    applyTheme();
    render();
  });

  $('#updown-toggle')?.addEventListener('click', () => {
    update({ direction: state.direction === 'cn' ? 'intl' : 'cn' });
    applyTheme();
    render();
  });

  document.addEventListener('ml:toggle-theme', () => {
    update({ theme: state.theme === 'dark' ? 'light' : 'dark' });
    applyTheme();
    render();
  });

  document.addEventListener('ml:toggle-direction', () => {
    update({ direction: state.direction === 'cn' ? 'intl' : 'cn' });
    applyTheme();
    render();
  });

  document.addEventListener('ml:refresh', () => {
    refreshAll();
    toast('正在刷新行情');
  });

  document.addEventListener('ml:focus-add', () => {
    setTimeout(() => $('#wl-input')?.focus(), 60);
  });

  delegate(railMarkets, 'click', '[data-market]', (event, node) => {
    update({ market: node.dataset.market });
    renderRailMarkets();
    if (parseHash().view !== 'overview') {
      location.hash = '#/overview';
    } else {
      render();
    }
  });

  window.addEventListener('hashchange', render);

  document.addEventListener('keydown', (event) => {
    if (event.target.matches('input, textarea, select')) return;
    const map = { 1: '#/overview', 2: '#/quote', 3: '#/watchlist', 4: '#/movers' };
    if (map[event.key]) {
      event.preventDefault();
      location.hash = map[event.key];
    }
    if (event.key === '/') {
      event.preventDefault();
      $('#cmdk-trigger')?.click();
    }
  });

  on('watchlist', () => {
    renderRailMarkets();
  });
}

/* ── 时钟 ───────────────────────────────────────────────────── */
function startClock() {
  const time = $('#clock-time');
  const zone = $('#clock-zone');
  const tick = () => {
    time.textContent = fmtClock(Date.now());
    zone.textContent = `北京 ${new Date().toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })}`;
    renderSessionLeds();
  };
  tick();
  setInterval(tick, 1000);
}

/* ── 启动 ───────────────────────────────────────────────────── */
async function boot() {
  applyTheme();
  bindShell();
  startClock();
  initPalette({
    onOpenSymbol: (symbol) => {
      location.hash = `#/quote/${encodeURIComponent(symbol)}`;
    },
  });

  warmSnapshot();
  await render();
  await refreshTicker();
  checkAlerts();

  // 自动刷新
  let remaining = REFRESH_MS / 1000;
  countdownText = `${remaining} 秒后自动刷新`;
  renderStatus();
  countdownTimer = setInterval(() => {
    remaining -= 1;
    if (remaining <= 0) {
      clearInterval(countdownTimer);
      refreshAll();
      return;
    }
    countdownText = `${remaining} 秒后自动刷新`;
    renderStatus();
  }, 1000);

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refreshAll();
  });
}

boot().catch((err) => {
  console.error('[marketlens] 启动失败', err);
  center.innerHTML = `<div class="banner"><span class="bn-tag">启动失败</span><span>${esc(err.message)}</span></div>`;
});
