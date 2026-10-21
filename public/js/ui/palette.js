/**
 * 盘镜 MarketLens — 命令面板（⌘K）
 * 证券搜索 + 快捷命令。
 */

import { $, esc, clear } from '../core/dom.js';
import { fetchSearch } from '../core/api.js';
import { debounce } from '../core/dom.js';

const COMMANDS = [
  { id: 'cmd-theme', name: '切换深色 / 浅色主题', en: 'TOGGLE THEME', run: () => document.dispatchEvent(new CustomEvent('ml:toggle-theme')) },
  { id: 'cmd-direction', name: '切换涨跌配色（红涨绿跌 / 绿涨红跌）', en: 'TOGGLE UP/DOWN', run: () => document.dispatchEvent(new CustomEvent('ml:toggle-direction')) },
  { id: 'cmd-refresh', name: '立即刷新行情', en: 'REFRESH DATA', run: () => document.dispatchEvent(new CustomEvent('ml:refresh')) },
  { id: 'cmd-overview', name: '前往总览', en: 'GO OVERVIEW', run: () => { location.hash = '#/overview'; } },
  { id: 'cmd-watchlist', name: '前往自选股', en: 'GO WATCHLIST', run: () => { location.hash = '#/watchlist'; } },
  { id: 'cmd-movers', name: '前往榜单', en: 'GO MOVERS', run: () => { location.hash = '#/movers'; } },
  { id: 'cmd-add', name: '添加代码到自选股', en: 'ADD TO WATCHLIST', run: () => { location.hash = '#/watchlist'; document.dispatchEvent(new CustomEvent('ml:focus-add')); } },
];

let panel;
let input;
let results;
let open = false;
let items = [];
let cursor = 0;
let onOpenSymbol = () => {};
let searchToken = 0;

function renderList() {
  clear(results);
  if (!items.length) {
    results.innerHTML = '<div class="cmdk-empty">没有匹配结果</div>';
    return;
  }
  const groups = [];
  for (const item of items) {
    const g = groups.find((x) => x.name === item.group);
    if (g) g.rows.push(item);
    else groups.push({ name: item.group, rows: [item] });
  }
  let flat = 0;
  results.innerHTML = groups
    .map(
      (g) =>
        `<div class="cmdk-group">${esc(g.name)}</div>` +
        g.rows
          .map((item) => {
            const idx = flat++;
            const cls = idx === cursor ? 'on' : '';
            return `<div class="cmdk-item ${cls}" data-idx="${idx}">
              <span class="ci-sym">${esc(item.symbol || item.id)}</span>
              <span class="ci-name">${esc(item.name)}</span>
              ${item.price !== undefined ? `<span class="ci-px ${item.changePercent >= 0 ? 'up' : 'down'}">${item.price}</span>` : ''}
            </div>`;
          })
          .join(''),
    )
    .join('');
}

function setCursor(next) {
  if (!items.length) return;
  cursor = (next + items.length) % items.length;
  renderList();
  const active = results.querySelector('.cmdk-item.on');
  if (active) active.scrollIntoView({ block: 'nearest' });
}

function close() {
  open = false;
  panel.hidden = true;
  input.value = '';
  items = [];
  cursor = 0;
}

function openPalette() {
  open = true;
  panel.hidden = false;
  input.value = '';
  items = COMMANDS.map((c) => ({ ...c, group: '命令 COMMANDS', symbol: c.id }));
  cursor = 0;
  renderList();
  input.focus();
}

function choose(index) {
  const item = items[index];
  if (!item) return;
  close();
  if (item.run) item.run();
  else if (item.symbol) onOpenSymbol(item.symbol);
}

async function search(query) {
  const token = ++searchToken;
  if (!query.trim()) {
    items = COMMANDS.map((c) => ({ ...c, group: '命令 COMMANDS', symbol: c.id }));
    cursor = 0;
    renderList();
    return;
  }
  try {
    const { data } = await fetchSearch(query, 8, 0);
    if (token !== searchToken) return;
    const quotes = (data.quotes || []).map((q) => ({
      group: '证券 SECURITIES',
      symbol: q.symbol,
      name: q.longname || q.shortname || q.exchDisp || '',
      action: 'symbol',
    }));
    const cmds = COMMANDS.filter((c) => c.name.toLowerCase().includes(query.toLowerCase())).map((c) => ({
      ...c,
      group: '命令 COMMANDS',
      symbol: c.id,
    }));
    items = [...cmds, ...quotes];
    cursor = 0;
    renderList();
  } catch {
    if (token !== searchToken) return;
    items = [];
    renderList();
  }
}

export function initPalette(options = {}) {
  panel = $('#cmdk');
  input = $('#cmdk-input');
  results = $('#cmdk-results');
  if (!panel || !input || !results) return;

  onOpenSymbol = options.onOpenSymbol || (() => {});

  $('#cmdk-trigger')?.addEventListener('click', openPalette);
  panel.querySelectorAll('[data-cmdk-close]').forEach((node) => node.addEventListener('click', close));

  const onKey = (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      open ? close() : openPalette();
      return;
    }
    if (event.key === 'Escape' && open) {
      close();
      return;
    }
    if (!open) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setCursor(cursor + 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setCursor(cursor - 1);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      choose(cursor);
    }
  };
  window.addEventListener('keydown', onKey);

  input.addEventListener('input', debounce((event) => search(event.target.value), 220));
  results.addEventListener('click', (event) => {
    const node = event.target.closest('.cmdk-item');
    if (node) choose(Number(node.dataset.idx));
  });
}
