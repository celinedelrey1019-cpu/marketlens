/**
 * 盘镜 MarketLens — 总览视图
 * 市场脉冲 + 板块热力图 + 涨跌榜 + 热门榜。
 */

import { ALL_INDICES, MARKETS, SECTORS } from '../config.js';
import { fetchMovers, fetchTrending, source } from '../core/api.js';
import { esc, delegate } from '../core/dom.js';
import { fmtPrice, fmtPct, fmtCompact, dirClass, fmtVolume } from '../core/format.js';
import { drawSparkline } from '../ui/sparkline.js';
import { feed, loadMarketQuotes, series } from '../data/feed.js';

function pulseCell(index) {
  const q = feed.quotes.get(index.symbol);
  const px = q ? q.price : null;
  const pct = q ? q.changePercent : null;
  return `<div class="pulse-cell" data-sym="${esc(index.symbol)}" title="点击查看 ${esc(index.name)} 详情">
    <div class="pc-top">
      <span class="pc-sym">${esc(index.symbol)}</span>
      <span class="pc-name">${esc(index.name)}</span>
    </div>
    <div class="pc-px ${dirClass(pct)}">${px === null ? '—' : fmtPrice(px)}</div>
    <div class="pc-foot">
      <span class="pc-chg ${dirClass(pct)}">${pct === null ? '—' : fmtPct(pct)}</span>
      <canvas class="pc-spark" data-sym="${esc(index.symbol)}"></canvas>
    </div>
  </div>`;
}

function heatTile(sector) {
  const q = feed.quotes.get(sector.symbol);
  const pct = q ? q.changePercent : null;
  const intensity = pct === null ? 0 : Math.min(0.46, Math.abs(pct) / 2.4);
  const wash = pct === null ? 'transparent' : pct >= 0 ? 'var(--up)' : 'var(--down)';
  return `<div class="heat-tile" data-sym="${esc(sector.symbol)}" title="点击查看 ${esc(sector.name)} 板块 ETF">
    <div class="heat-wash" style="background:${wash};opacity:${intensity.toFixed(3)}"></div>
    <div class="ht-top">
      <span class="ht-name">${esc(sector.name)}</span>
      <span class="ht-sym">${esc(sector.symbol)}</span>
    </div>
    <div class="ht-chg ${dirClass(pct)}">${pct === null ? '—' : fmtPct(pct)}</div>
  </div>`;
}

function moverRows(list) {
  if (!list || !list.length) {
    return '<tr><td colspan="5" class="tbl-empty">暂无数据</td></tr>';
  }
  return list
    .slice(0, 8)
    .map(
      (m) => `<tr>
        <td class="l"><span class="cell-sym" data-sym="${esc(m.symbol)}">${esc(m.symbol)}</span></td>
        <td class="l"><span class="cell-name">${esc(m.shortName || m.displayName || m.symbol)}</span></td>
        <td class="px">${fmtPrice(m.regularMarketPrice)}</td>
        <td class="px ${dirClass(m.regularMarketChangePercent)}">${fmtPct(m.regularMarketChangePercent)}</td>
        <td class="px">${fmtVolume(m.regularMarketVolume)}</td>
      </tr>`,
    )
    .join('');
}

export async function renderOverview(center) {
  center.innerHTML = `
    <div class="view-head">
      <div>
        <div class="view-title"><h1>总览</h1><span class="vt-en">Market Overview</span></div>
        <p class="view-sub">七大市场脉冲 · 标普板块热力 · 涨跌与活跃榜</p>
      </div>
      <div class="chart-tools">
        <span class="chip" id="ov-mode">实时</span>
      </div>
    </div>

    <div id="ov-banner"></div>

    <section class="panel">
      <div class="panel-hd">
        <span class="ph-cn">市场脉冲</span>
        <span class="ph-en">Market Pulse</span>
        <span class="ph-rule"></span>
        <div class="ph-tools"><span class="chip" id="ov-time">—</span></div>
      </div>
      <div class="panel-bd flush" id="ov-pulse"><div class="loading-line"><i class="spinner"></i>正在拉取指数行情…</div></div>
    </section>

    <section class="panel">
      <div class="panel-hd">
        <span class="ph-cn">板块热力图</span>
        <span class="ph-en">Sector Heatmap</span>
        <span class="ph-rule"></span>
        <div class="ph-tools">
          <span class="heat-legend"><span>跌</span><i class="bar"></i><span>涨</span></span>
        </div>
      </div>
      <div class="panel-bd flush">
        <div class="heat-grid" id="ov-heat"><div class="loading-line"><i class="spinner"></i>加载中…</div></div>
      </div>
    </section>

    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:var(--sp-5)">
      <section class="panel">
        <div class="panel-hd">
          <span class="ph-cn">涨幅榜</span><span class="ph-en">Gainers</span><span class="ph-rule"></span>
          <span class="tool-link" data-goto="movers">全部 →</span>
        </div>
        <div class="panel-bd flush">
          <table class="tbl"><thead><tr>
            <th class="l">代码</th><th class="l">名称</th><th>最新</th><th>涨跌</th><th>成交量</th>
          </tr></thead><tbody id="ov-gainers"></tbody></table>
        </div>
      </section>

      <section class="panel">
        <div class="panel-hd">
          <span class="ph-cn">跌幅榜</span><span class="ph-en">Losers</span><span class="ph-rule"></span>
          <span class="tool-link" data-goto="movers">全部 →</span>
        </div>
        <div class="panel-bd flush">
          <table class="tbl"><thead><tr>
            <th class="l">代码</th><th class="l">名称</th><th>最新</th><th>涨跌</th><th>成交量</th>
          </tr></thead><tbody id="ov-losers"></tbody></table>
        </div>
      </section>
    </div>

    <section class="panel">
      <div class="panel-hd">
        <span class="ph-cn">热门搜索</span><span class="ph-en">Trending</span><span class="ph-rule"></span>
      </div>
      <div class="panel-bd" id="ov-trending"><div class="loading-line"><i class="spinner"></i>加载中…</div></div>
    </section>
  `;

  const banner = center.querySelector('#ov-banner');
  if (source.mode === 'snapshot') {
    banner.innerHTML = `<div class="banner"><span class="bn-tag">离线快照</span>
      <span>未能连接行情服务，当前展示仓库内置的行情快照。运行 <code>npm start</code> 启动本地服务后即可获取实时数据。</span></div>`;
  }

  const indexSymbols = ALL_INDICES.map((i) => i.symbol);
  const sectorSymbols = SECTORS.map((s) => s.symbol);

  const [gainersRes, losersRes, trendingRes] = await Promise.allSettled([
    fetchMovers('day_gainers', 10),
    fetchMovers('day_losers', 10),
    fetchTrending('US', 12),
  ]);

  await loadMarketQuotes();

  /* 市场脉冲 */
  const pulseRoot = center.querySelector('#ov-pulse');
  pulseRoot.innerHTML = MARKETS.map((market) => {
    const cells = market.indices
      .filter((i) => indexSymbols.includes(i.symbol))
      .map((i) => pulseCell(i))
      .join('');
    return `<div class="pulse-group">
      <div class="pulse-group-head">
        <span class="pgh-cn">${esc(market.name)}</span>
        <span class="pgh-en">${esc(market.en)}</span>
        <span class="pgh-tz">${esc(market.tzLabel)} ${esc(market.tz)}</span>
      </div>
      <div class="pulse-grid">${cells}</div>
    </div>`;
  }).join('');

  pulseRoot.querySelectorAll('canvas.pc-spark').forEach((canvas) => {
    drawSparkline(canvas, series(canvas.dataset.sym), { baseline: true });
  });

  /* 板块热力 */
  center.querySelector('#ov-heat').innerHTML = SECTORS.map(heatTile).join('');

  /* 榜单 */
  const gainers = gainersRes.status === 'fulfilled' ? gainersRes.value.data?.finance?.result?.[0]?.quotes || [] : [];
  const losers = losersRes.status === 'fulfilled' ? losersRes.value.data?.finance?.result?.[0]?.quotes || [] : [];
  center.querySelector('#ov-gainers').innerHTML = moverRows(gainers);
  center.querySelector('#ov-losers').innerHTML = moverRows(losers);

  /* 热门 */
  const trendingHost = center.querySelector('#ov-trending');
  if (trendingRes.status === 'fulfilled') {
    const symbols = trendingRes.value.data?.finance?.result?.[0]?.quotes || [];
    trendingHost.innerHTML = symbols.length
      ? symbols
          .map(
            (s) =>
              `<span class="chip chip-btn" data-sym="${esc(s.symbol)}" style="margin:0 6px 6px 0;display:inline-block">${esc(s.symbol)}</span>`,
          )
          .join('')
      : '<div class="tbl-empty">暂无数据</div>';
  } else {
    trendingHost.innerHTML = '<div class="tbl-empty">热门榜加载失败</div>';
  }

  center.querySelector('#ov-time').textContent = new Date().toLocaleTimeString('zh-CN', { hour12: false });

  /* 交互：点击代码 / 板块 / 热门 → 打开行情页 */
  delegate(center, 'click', '[data-sym]', (event, node) => {
    const symbol = node.dataset.sym;
    if (!symbol) return;
    location.hash = `#/quote/${encodeURIComponent(symbol)}`;
  });

  delegate(center, 'click', '[data-goto]', (event, node) => {
    location.hash = `#/${node.dataset.goto}`;
  });
}
