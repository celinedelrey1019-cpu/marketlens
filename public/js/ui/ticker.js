/**
 * 盘镜 MarketLens — 顶部行情跑马灯
 */

import { esc } from '../core/dom.js';
import { fmtPrice, fmtPct, dirClass } from '../core/format.js';

function itemHtml(symbol, name, quote) {
  const price = quote.price;
  const pct = quote.changePercent;
  const cls = dirClass(pct);
  return `<span class="ticker-item">
    <span class="t-sym">${esc(symbol)}</span>
    <span class="t-px">${fmtPrice(price)}</span>
    <span class="t-chg ${cls}">${fmtPct(pct)}</span>
  </span>`;
}

/**
 * @param {HTMLElement} track 跑马灯容器
 * @param {Array<{symbol:string,name:string,price:number,changePercent:number}>} list
 */
export function renderTicker(track, list) {
  if (!track) return;
  if (!list || !list.length) {
    track.innerHTML = '<span class="ticker-item"><span class="t-sym">行情加载中…</span></span>';
    return;
  }
  // 复制一份用于无缝滚动
  const html = list.map((row) => itemHtml(row.symbol, row.name, row)).join('');
  track.innerHTML = html + html;
}
