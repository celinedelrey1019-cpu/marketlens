/**
 * 盘镜 MarketLens — 自选股视图
 */

import { state, update, addToWatchlist, removeFromWatchlist } from '../core/store.js';
import { fetchQuotes, fetchSearch } from '../core/api.js';
import { esc, delegate } from '../core/dom.js';
import { fmtPrice, fmtPct, fmtSigned, dirClass } from '../core/format.js';
import { drawSparkline } from '../ui/sparkline.js';
import { toast } from '../ui/toast.js';

const COLUMNS = [
  { key: 'symbol', label: '代码', align: 'l' },
  { key: 'name', label: '名称', align: 'l' },
  { key: 'price', label: '最新', align: 'r' },
  { key: 'change', label: '涨跌', align: 'r' },
  { key: 'changePercent', label: '涨跌幅', align: 'r' },
  { key: 'spark', label: '走势', align: 'r', sortable: false },
];

function sortRows(rows) {
  const { key, dir } = state.watchSort;
  const sorted = [...rows].sort((a, b) => {
    const av = a[key];
    const bv = b[key];
    if (typeof av === 'number' && typeof bv === 'number') return av - bv;
    return String(av ?? '').localeCompare(String(bv ?? ''));
  });
  return dir === 'desc' ? sorted.reverse() : sorted;
}

export async function renderWatchlist(center) {
  center.innerHTML = `
    <div class="view-head">
      <div>
        <div class="view-title"><h1>自选股</h1><span class="vt-en">Watchlist</span></div>
        <p class="view-sub">最多 50 只 · 保存在本地浏览器 · 点击代码进入行情页</p>
      </div>
      <div class="chart-tools"><span class="chip" id="wl-count">—</span></div>
    </div>

    <div class="add-row">
      <input id="wl-input" type="text" placeholder="输入代码添加，例如 AAPL / 0700.HK / BTC-USD" autocomplete="off" spellcheck="false" />
      <button class="btn primary" id="wl-add">加入自选</button>
    </div>

    <section class="panel">
      <div class="panel-hd">
        <span class="ph-cn">持仓与关注</span><span class="ph-en">My Symbols</span><span class="ph-rule"></span>
        <div class="ph-tools"><span class="chip" id="wl-mode">实时</span></div>
      </div>
      <div class="panel-bd flush">
        <table class="tbl">
          <thead><tr id="wl-head"></tr></thead>
          <tbody id="wl-body"><tr><td colspan="6" class="tbl-empty">加载中…</td></tr></tbody>
        </table>
      </div>
    </section>
  `;

  const input = center.querySelector('#wl-input');
  const body = center.querySelector('#wl-body');
  const head = center.querySelector('#wl-head');

  function renderHead() {
    head.innerHTML = COLUMNS.map((c) => {
      const sorted = state.watchSort.key === c.key;
      const arrow = sorted ? (state.watchSort.dir === 'desc' ? ' ↓' : ' ↑') : '';
      return `<th class="${c.align === 'l' ? 'l' : ''} ${c.sortable === false ? '' : 'sortable'} ${sorted ? 'sorted' : ''}"
        ${c.sortable === false ? '' : `data-sort="${esc(c.key)}"`}>${esc(c.label)}${arrow}</th>`;
    }).join('');
  }

  async function load() {
    const symbols = state.watchlist;
    center.querySelector('#wl-count').textContent = `${symbols.length}/50`;

    if (!symbols.length) {
      body.innerHTML = '<tr><td colspan="6" class="tbl-empty">自选股是空的。用上面的输入框添加，或按 ⌘K 搜索添加。</td></tr>';
      renderHead();
      return;
    }

    let quotes = {};
    let names = {};
    try {
      const res = await fetchQuotes(symbols);
      quotes = res.data || {};
    } catch (err) {
      body.innerHTML = `<tr><td colspan="6" class="tbl-empty">行情加载失败：${esc(err.message)}</td></tr>`;
      return;
    }

    // 用搜索接口补齐名称（只在缺失时批量查前 8 个）
    const missing = symbols.filter((s) => !quotes[s]).slice(0, 8);
    if (missing.length) {
      try {
        const res = await fetchSearch(missing.join(' '), 8, 0);
        (res.data?.quotes || []).forEach((q) => {
          names[q.symbol] = q.longname || q.shortname || '';
        });
      } catch {
        /* 名称拿不到就算了 */
      }
    }

    const rows = symbols.map((symbol) => {
      const q = quotes[symbol] || {};
      const price = q.fulldayPrice ?? null;
      const change = q.fulldayChange ?? null;
      const changePercent = q.fulldayChangePercent ?? null;
      return {
        symbol,
        name: names[symbol] || symbol,
        price,
        change,
        changePercent,
        series: q.close || [],
      };
    });

    const sorted = sortRows(rows);
    body.innerHTML = sorted
      .map(
        (row) => `<tr data-sym="${esc(row.symbol)}">
          <td class="l"><span class="cell-sym">${esc(row.symbol)}</span></td>
          <td class="l"><span class="cell-name">${esc(row.name)}</span></td>
          <td class="px">${row.price === null ? '—' : fmtPrice(row.price)}</td>
          <td class="px ${dirClass(row.change)}">${row.change === null ? '—' : fmtSigned(row.change)}</td>
          <td class="px ${dirClass(row.changePercent)}">${row.changePercent === null ? '—' : fmtPct(row.changePercent)}</td>
          <td class="spark-cell"><canvas data-sym="${esc(row.symbol)}"></canvas></td>
        </tr>`,
      )
      .join('');

    body.querySelectorAll('canvas[data-sym]').forEach((canvas) => {
      const row = sorted.find((r) => r.symbol === canvas.dataset.sym);
      drawSparkline(canvas, row?.series || [], { baseline: true });
    });

    renderHead();
  }

  async function addFromInput() {
    const raw = input.value.trim();
    if (!raw) return;
    const symbol = raw.toUpperCase();
    if (state.watchlist.includes(symbol)) {
      toast('已在自选中', symbol);
      input.value = '';
      return;
    }
    if (state.watchlist.length >= 50) {
      toast('自选股已满', '上限 50 只', 'err');
      return;
    }
    // 先确认代码有效，再落库
    try {
      const res = await fetchSearch(symbol, 5, 0);
      const hit = (res.data?.quotes || []).find((q) => q.symbol.toUpperCase() === symbol);
      const target = hit ? hit.symbol : symbol;
      if (addToWatchlist(target)) {
        toast('已加入自选', target);
        input.value = '';
        await load();
      }
    } catch {
      addToWatchlist(symbol);
      toast('已加入自选', symbol);
      input.value = '';
      await load();
    }
  }

  center.querySelector('#wl-add').addEventListener('click', addFromInput);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') addFromInput();
  });
  input.addEventListener('focus', () => input.select());

  delegate(center, 'click', '[data-sort]', (event, node) => {
    const key = node.dataset.sort;
    const dir = state.watchSort.key === key && state.watchSort.dir === 'desc' ? 'asc' : 'desc';
    update({ watchSort: { key, dir } });
    load();
  });

  delegate(center, 'click', '.cell-sym', (event, node) => {
    const symbol = node.dataset.sym || node.closest('tr')?.dataset.sym;
    if (symbol) location.hash = `#/quote/${encodeURIComponent(symbol)}`;
  });

  await load();
}
