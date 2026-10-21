/**
 * 盘镜 MarketLens — 右侧监控列
 * 自选监控 / 涨跌速览 / 财经要闻 / 价格提醒。所有视图共用。
 */

import { state } from '../core/store.js';
import { fetchMovers, fetchNews } from '../core/api.js';
import { esc, delegate } from '../core/dom.js';
import { fmtPrice, fmtPct, dirClass, fmtRel } from '../core/format.js';
import { loadMarketQuotes, feed } from '../data/feed.js';

function watchRow(symbol) {
  const q = feed.quotes.get(symbol);
  const pct = q ? q.changePercent : null;
  return `<div class="mon-row" data-sym="${esc(symbol)}">
    <div class="mr-left">
      <span class="mr-sym">${esc(symbol)}</span>
      <span class="mr-name">${esc(q?.name || symbol)}</span>
    </div>
    <div class="mr-px">
      <div>${q && q.price !== null ? fmtPrice(q.price) : '—'}</div>
      <div class="mr-chg ${dirClass(pct)}">${pct === null ? '—' : fmtPct(pct)}</div>
    </div>
  </div>`;
}

function moverRow(m) {
  return `<div class="mon-row" data-sym="${esc(m.symbol)}">
    <div class="mr-left">
      <span class="mr-sym">${esc(m.symbol)}</span>
      <span class="mr-name">${esc(m.shortName || m.displayName || '')}</span>
    </div>
    <div class="mr-px">
      <div>${fmtPrice(m.regularMarketPrice)}</div>
      <div class="mr-chg ${dirClass(m.regularMarketChangePercent)}">${fmtPct(m.regularMarketChangePercent)}</div>
    </div>
  </div>`;
}

function newsItem(n) {
  const time = (n.providerPublishTime || 0) * 1000;
  const tags = (n.relatedTickers || []).slice(0, 3).map((t) => `<span class="ni-tag">${esc(t)}</span>`).join('');
  return `<a class="news-item" href="${esc(n.link || '#')}" target="_blank" rel="noopener noreferrer">
    <div class="ni-top">
      <span class="ni-pub">${esc(n.publisher || '')}</span>
      <span class="ni-time">${esc(fmtRel(time))}</span>
    </div>
    <div class="ni-title">${esc(n.title || '')}</div>
    ${tags ? `<div class="ni-tags">${tags}</div>` : ''}
  </a>`;
}

export async function renderMonitor(el) {
  el.innerHTML = `
    <div class="mon-block">
      <div class="mon-hd"><span class="mh-cn">自选监控</span><span class="mh-en">Watchlist</span><span class="mh-rule"></span>
        <span class="chip" id="mon-count">—</span></div>
      <div class="mon-list" id="mon-watch"><div class="loading-line"><i class="spinner"></i>加载中…</div></div>
    </div>

    <div class="mon-block">
      <div class="mon-hd"><span class="mh-cn">领涨</span><span class="mh-en">Gainers</span><span class="mh-rule"></span></div>
      <div class="mon-list" id="mon-gainers"></div>
    </div>

    <div class="mon-block">
      <div class="mon-hd"><span class="mh-cn">领跌</span><span class="mh-en">Losers</span><span class="mh-rule"></span></div>
      <div class="mon-list" id="mon-losers"></div>
    </div>

    <div class="mon-block">
      <div class="mon-hd"><span class="mh-cn">财经要闻</span><span class="mh-en">Top Stories</span><span class="mh-rule"></span></div>
      <div class="news-list" id="mon-news"></div>
    </div>

    <div class="mon-block">
      <div class="mon-hd"><span class="mh-cn">价格提醒</span><span class="mh-en">Alerts</span><span class="mh-rule"></span>
        <span class="chip" id="mon-alert-count">0</span></div>
      <div id="mon-alerts"></div>
    </div>
  `;

  const symbols = state.watchlist.slice(0, 20);

  const [gainersRes, losersRes, newsRes] = await Promise.allSettled([
    // 榜单数量与总览页保持一致，这样服务端缓存是同一份 key，不会重复打上游。
    fetchMovers('day_gainers', 10),
    fetchMovers('day_losers', 10),
    fetchNews('stock market', 10),
  ]);

  await loadMarketQuotes();

  const watchHost = el.querySelector('#mon-watch');
  watchHost.innerHTML = symbols.length
    ? symbols.map(watchRow).join('')
    : '<div class="mon-note">自选股是空的。去「自选」页添加代码，或按 ⌘K 搜索添加。</div>';
  el.querySelector('#mon-count').textContent = `${state.watchlist.length}/50`;

  const gainers = gainersRes.status === 'fulfilled' ? gainersRes.value.data?.finance?.result?.[0]?.quotes || [] : [];
  const losers = losersRes.status === 'fulfilled' ? losersRes.value.data?.finance?.result?.[0]?.quotes || [] : [];
  el.querySelector('#mon-gainers').innerHTML = gainers.length
    ? gainers.slice(0, 6).map(moverRow).join('')
    : '<div class="mon-note">暂无数据</div>';
  el.querySelector('#mon-losers').innerHTML = losers.length
    ? losers.slice(0, 6).map(moverRow).join('')
    : '<div class="mon-note">暂无数据</div>';

  const news = newsRes.status === 'fulfilled' ? newsRes.value.data?.news || [] : [];
  el.querySelector('#mon-news').innerHTML = news.length
    ? news.map(newsItem).join('')
    : '<div class="mon-note">暂无新闻</div>';

  renderAlerts(el);

  delegate(el, 'click', '.mon-row', (event, node) => {
    if (node.dataset.sym) location.hash = `#/quote/${encodeURIComponent(node.dataset.sym)}`;
  });
}

/** 价格提醒列表 */
export function renderAlerts(el) {
  const host = el.querySelector('#mon-alerts');
  if (!host) return;
  const counter = el.querySelector('#mon-alert-count');
  if (counter) counter.textContent = String(state.alerts.length);
  if (!state.alerts.length) {
    host.innerHTML = '<div class="mon-note">还没有设置提醒。进入任意个股行情页，点「设置提醒」即可。</div>';
    return;
  }
  host.innerHTML = state.alerts
    .map(
      (a) => `<div class="alert-row">
        <span class="ar-sym">${esc(a.symbol)}</span>
        <span class="ar-cond">${a.type === 'above' ? '≥' : '≤'} ${fmtPrice(a.price)}${a.triggered ? ' · 已触发' : ''}</span>
        <button class="row-btn" data-alert-remove="${esc(a.id)}">删除</button>
      </div>`,
    )
    .join('');
}
