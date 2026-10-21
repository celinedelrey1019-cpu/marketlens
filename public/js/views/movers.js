/**
 * 盘镜 MarketLens — 榜单视图
 */

import { MOVER_TYPES } from '../config.js';
import { fetchMovers } from '../core/api.js';
import { state, update } from '../core/store.js';
import { esc, delegate } from '../core/dom.js';
import { fmtPrice, fmtPct, fmtSigned, fmtVolume, fmtCap, dirClass } from '../core/format.js';

function rowsHtml(list) {
  if (!list || !list.length) {
    return '<tr><td colspan="8" class="tbl-empty">暂无数据</td></tr>';
  }
  return list
    .map(
      (m, i) => `<tr>
        <td class="c">${i + 1}</td>
        <td class="l"><span class="cell-sym" data-sym="${esc(m.symbol)}">${esc(m.symbol)}</span></td>
        <td class="l"><span class="cell-name">${esc(m.shortName || m.displayName || m.longName || '')}</span></td>
        <td class="px">${fmtPrice(m.regularMarketPrice)}</td>
        <td class="px ${dirClass(m.regularMarketChange)}">${fmtSigned(m.regularMarketChange)}</td>
        <td class="px ${dirClass(m.regularMarketChangePercent)}">${fmtPct(m.regularMarketChangePercent)}</td>
        <td class="px">${fmtVolume(m.regularMarketVolume)}</td>
        <td class="px">${fmtCap(m.marketCap)}</td>
      </tr>`,
    )
    .join('');
}

export async function renderMovers(center) {
  const tab = MOVER_TYPES.find((t) => t.id === state.moverTab) || MOVER_TYPES[0];

  center.innerHTML = `
    <div class="view-head">
      <div>
        <div class="view-title"><h1>榜单</h1><span class="vt-en">Market Movers</span></div>
        <p class="view-sub">美股盘前盘后扫描 · 数据来自 Yahoo Finance 预设筛选器</p>
      </div>
      <div class="chart-tools"><span class="chip" id="mv-time">—</span></div>
    </div>

    <div class="tabs" id="mv-tabs">
      ${MOVER_TYPES.map(
        (t) => `<button data-tab="${t.id}" class="${t.id === tab.id ? 'on' : ''}">${esc(t.name)} <span class="micro">${esc(t.en)}</span></button>`,
      ).join('')}
    </div>

    <section class="panel">
      <div class="panel-hd">
        <span class="ph-cn">${esc(tab.name)}</span><span class="ph-en">${esc(tab.en)}</span><span class="ph-rule"></span>
        <div class="ph-tools"><span class="chip">前 25 名</span></div>
      </div>
      <div class="panel-bd flush">
        <table class="tbl">
          <thead><tr>
            <th class="c">#</th><th class="l">代码</th><th class="l">名称</th>
            <th>最新</th><th>涨跌</th><th>涨跌幅</th><th>成交量</th><th>市值</th>
          </tr></thead>
          <tbody id="mv-body"><tr><td colspan="8" class="tbl-empty">加载中…</td></tr></tbody>
        </table>
      </div>
    </section>
  `;

  const body = center.querySelector('#mv-body');
  try {
    const { data } = await fetchMovers(tab.id, 25);
    const list = data?.finance?.result?.[0]?.quotes || [];
    body.innerHTML = rowsHtml(list);
  } catch (err) {
    body.innerHTML = `<tr><td colspan="8" class="tbl-empty">加载失败：${esc(err.message)}</td></tr>`;
  }
  center.querySelector('#mv-time').textContent = new Date().toLocaleTimeString('zh-CN', { hour12: false });

  delegate(center, 'click', '[data-tab]', (event, node) => {
    update({ moverTab: node.dataset.tab });
    center.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === node.dataset.tab));
    renderMovers(center);
  });

  delegate(center, 'click', '.cell-sym', (event, node) => {
    location.hash = `#/quote/${encodeURIComponent(node.dataset.sym)}`;
  });
}
