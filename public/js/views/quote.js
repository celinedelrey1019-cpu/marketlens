/**
 * 盘镜 MarketLens — 个股行情视图
 * K 线 + 技术指标 + 关键指标 + 财务摘要 + 相关新闻 + 自选 / 提醒。
 */

import { TIMEFRAMES, OVERLAY_INDICATORS, SUBPANEL_INDICATORS } from '../config.js';
import { fetchChart, fetchFundamentals, fetchNews, source } from '../core/api.js';
import { state, update, addToWatchlist, removeFromWatchlist, addAlert } from '../core/store.js';
import { esc, delegate } from '../core/dom.js';
import { fmtPrice, fmtPct, fmtSigned, fmtVolume, fmtCap, dirClass, fmtDateTime, fmtCompact } from '../core/format.js';
import { computeOverlays, rsi, macd, atr } from '../core/indicators.js';
import { createChart } from '../ui/chart.js';
import { toast } from '../ui/toast.js';

let chart = null;

function barsFromChart(payload, symbol) {
  const result = payload?.chart?.result?.[0];
  if (!result) return { bars: [], meta: {} };
  const stamps = result.timestamp || [];
  const q = result.indicators?.quote?.[0] || {};
  const prev = result.meta?.chartPreviousClose ?? result.meta?.previousClose ?? null;
  const bars = stamps
    .map((t, i) => ({
      time: t * 1000,
      open: q.open?.[i],
      high: q.high?.[i],
      low: q.low?.[i],
      close: q.close?.[i],
      volume: q.volume?.[i] ?? 0,
      previousClose: prev,
      symbol,
    }))
    .filter((b) => b.close !== null && b.close !== undefined);
  return { bars, meta: result.meta || {} };
}

function subpanelFor(id, bars) {
  const def = SUBPANEL_INDICATORS.find((d) => d.id === id);
  if (!def || !bars.length) return null;
  const closes = bars.map((b) => b.close);
  if (def.type === 'rsi') {
    return { name: `RSI(${def.period})`, type: 'rsi', values: rsi(closes, def.period) };
  }
  if (def.type === 'macd') {
    const m = macd(closes, def.fast, def.slow, def.signal);
    return { name: `MACD(${def.fast},${def.slow},${def.signal})`, type: 'macd', values: m.line, signal: m.signal, hist: m.hist };
  }
  if (def.type === 'atr') {
    return {
      name: `ATR(${def.period})`,
      type: 'atr',
      values: atr(bars.map((b) => b.high), bars.map((b) => b.low), closes, def.period),
    };
  }
  return null;
}

function statCell(label, value, cls = '') {
  return `<div class="stat-cell"><span class="st-k">${esc(label)}</span><span class="st-v ${cls}">${value}</span></div>`;
}

function rangeBar(meta, price) {
  const hi = meta.fiftyTwoWeekHigh;
  const lo = meta.fiftyTwoWeekLow;
  if (!hi || !lo || !price) {
    return '<div class="range-bar"><div class="rb-labels"><span>52 周区间 —</span></div></div>';
  }
  const ratio = Math.max(0, Math.min(1, (price - lo) / (hi - lo || 1)));
  return `<div class="range-bar">
    <div class="rb-track">
      <div class="rb-fill" style="left:0;right:${((1 - ratio) * 100).toFixed(1)}%"></div>
      <div class="rb-knob" style="left:${(ratio * 100).toFixed(1)}%"></div>
    </div>
    <div class="rb-labels"><span>${fmtPrice(lo)}</span><span>52 周区间</span><span>${fmtPrice(hi)}</span></div>
  </div>`;
}

function overlayChips() {
  return OVERLAY_INDICATORS.map(
    (ind) =>
      `<span class="chip chip-btn ${state.overlays.includes(ind.id) ? 'on' : ''}" data-overlay="${esc(ind.id)}" title="叠加 ${esc(ind.name)}">${esc(ind.name)}</span>`,
  ).join('');
}

function subChips() {
  return SUBPANEL_INDICATORS.map(
    (ind) =>
      `<span class="chip chip-btn ${state.subpanel === ind.id ? 'on' : ''}" data-sub="${esc(ind.id)}">${esc(ind.name)}</span>`,
  ).join('');
}

export async function renderQuote(center, symbol) {
  const sym = (symbol || state.symbol || 'AAPL').toUpperCase();
  update({ symbol: sym });

  const tf = TIMEFRAMES.find((t) => t.id === state.timeframe) || TIMEFRAMES[2];
  const inWatch = state.watchlist.includes(sym);

  center.innerHTML = `
    <div class="quote-head">
      <div class="quote-id">
        <span class="qi-sym" id="q-sym">${esc(sym)}</span>
        <span class="qi-name" id="q-name">加载中…</span>
        <span class="qi-meta">
          <span id="q-exchange">—</span>
          <span id="q-currency">—</span>
          <span id="q-time">—</span>
        </span>
      </div>
      <div class="quote-px">
        <span class="qp-last" id="q-last">—</span>
        <span class="qp-delta" id="q-delta">—</span>
        <span class="qp-time" id="q-state">—</span>
      </div>
      <div id="q-range" style="align-self:center"></div>
    </div>

    <div class="chart-tools" style="margin-bottom:var(--sp-4)">
      <div class="tf-group" id="tf-group">
        ${TIMEFRAMES.map(
          (t) => `<button data-tf="${t.id}" class="${t.id === tf.id ? 'on' : ''}">${esc(t.label)}</button>`,
        ).join('')}
      </div>
      <span style="width:10px"></span>
      ${overlayChips()}
      <span style="width:10px"></span>
      ${subChips()}
      <span style="flex:1"></span>
      <button class="btn" id="q-watch">${inWatch ? '移出自选' : '加入自选'}</button>
      <button class="btn primary" id="q-alert">设置提醒</button>
    </div>

    <section class="panel">
      <div class="panel-hd">
        <span class="ph-cn">价格走势</span><span class="ph-en">Price Action</span><span class="ph-rule"></span>
        <div class="ph-tools"><span class="chip" id="q-mode">实时</span></div>
      </div>
      <div class="panel-bd flush">
        <div class="chart-stage" id="q-stage" style="height:430px">
          <canvas></canvas>
          <div class="chart-tooltip"></div>
        </div>
      </div>
    </section>

    <section class="panel">
      <div class="panel-hd"><span class="ph-cn">关键指标</span><span class="ph-en">Key Statistics</span><span class="ph-rule"></span></div>
      <div class="panel-bd flush"><div class="stat-grid" id="q-stats"></div></div>
    </section>

    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:var(--sp-5)">
      <section class="panel">
        <div class="panel-hd"><span class="ph-cn">财务摘要</span><span class="ph-en">Financials</span><span class="ph-rule"></span>
          <span class="chip">年度营收</span></div>
        <div class="panel-bd" id="q-fin"><div class="loading-line"><i class="spinner"></i>加载中…</div></div>
      </section>
      <section class="panel">
        <div class="panel-hd"><span class="ph-cn">相关资讯</span><span class="ph-en">Related News</span><span class="ph-rule"></span></div>
        <div class="panel-bd flush" id="q-news"><div class="loading-line"><i class="spinner"></i>加载中…</div></div>
      </section>
    </div>
  `;

  chart?.destroy();
  chart = createChart(center.querySelector('#q-stage'));

  const stage = center.querySelector('#q-stage');
  const overlayHost = center.querySelector('#q-mode');

  async function loadChart() {
    stage.querySelector('.loading-line')?.remove();
    try {
      const { data } = await fetchChart(sym, tf.range, tf.interval);
      const { bars, meta } = barsFromChart(data, sym);
      if (!bars.length) {
        stage.innerHTML = '<div class="loading-line">该周期暂无可用数据</div>';
        return;
      }
      const overlays = computeOverlays(state.overlays, OVERLAY_INDICATORS, bars);
      chart.setData(bars, overlays, subpanelFor(state.subpanel, bars));

      const last = bars[bars.length - 1];
      const prev = meta.chartPreviousClose ?? meta.previousClose ?? last.open;
      const pct = prev ? ((last.close - prev) / prev) * 100 : 0;
      const diff = last.close - prev;

      center.querySelector('#q-last').textContent = fmtPrice(last.close);
      center.querySelector('#q-last').className = `qp-last ${dirClass(pct)}`;
      center.querySelector('#q-delta').textContent = `${fmtSigned(diff)} (${fmtPct(pct)})`;
      center.querySelector('#q-delta').className = `qp-delta ${dirClass(pct)}`;
      center.querySelector('#q-name').textContent = meta.longName || meta.shortName || sym;
      center.querySelector('#q-exchange').textContent = meta.fullExchangeName || meta.exchangeName || '—';
      center.querySelector('#q-currency').textContent = meta.currency || '—';
      center.querySelector('#q-time').textContent = `更新 ${fmtDateTime(meta.regularMarketTime ? meta.regularMarketTime * 1000 : Date.now())}`;
      center.querySelector('#q-state').textContent = source.mode === 'live' ? '实时行情' : '离线快照';
      overlayHost.textContent = source.mode === 'live' ? '实时' : '快照';
      center.querySelector('#q-range').innerHTML = rangeBar(meta, last.close);

      const stats = [
        statCell('今开', fmtPrice(meta.regularMarketOpen ?? last.open)),
        statCell('最高', fmtPrice(meta.regularMarketDayHigh ?? last.high)),
        statCell('最低', fmtPrice(meta.regularMarketDayLow ?? last.low)),
        statCell('昨收', fmtPrice(prev)),
        statCell('成交量', fmtVolume(meta.regularMarketVolume ?? last.volume)),
        statCell('52周高', fmtPrice(meta.fiftyTwoWeekHigh)),
        statCell('52周低', fmtPrice(meta.fiftyTwoWeekLow)),
        statCell('数据粒度', `${tf.label} · ${tf.interval}`),
      ];
      center.querySelector('#q-stats').innerHTML = stats.join('');
    } catch (err) {
      stage.innerHTML = `<div class="loading-line">行情加载失败：${esc(err.message)}</div>`;
    }
  }

  await loadChart();

  /* 财务摘要 */
  fetchFundamentals(sym, ['annualTotalRevenue', 'annualDilutedEPS'])
    .then(({ data }) => {
      const host = center.querySelector('#q-fin');
      const result = data?.timeseries?.result || [];
      const revEntry = result.find((r) => r.meta?.type?.includes('annualTotalRevenue'));
      const epsEntry = result.find((r) => r.meta?.type?.includes('annualDilutedEPS'));
      const revs = revEntry?.annualTotalRevenue || [];
      const epss = epsEntry?.annualDilutedEPS || [];
      if (!revs.length) {
        host.innerHTML = '<div class="tbl-empty">暂无离线可用的财务数据</div>';
        return;
      }
      const max = Math.max(...revs.map((r) => r.reportedValue?.raw || 0));
      const epsMap = new Map(epss.map((e) => [e.asOfDate, e.reportedValue?.raw]));
      host.innerHTML = `
        <div class="fin-bars">
          ${revs
            .map(
              (r) => `<div class="fin-bar" title="财年 ${esc(r.asOfDate)}">
                <span class="fb-label">${esc((r.asOfDate || '').slice(0, 4))}</span>
                <div class="fb-rect" style="height:${Math.max(3, ((r.reportedValue?.raw || 0) / max) * 62)}px"></div>
                <span class="fb-label">${esc(r.reportedValue?.fmt || '')}</span>
                <span class="fb-label">EPS ${epsMap.has(r.asOfDate) ? epsMap.get(r.asOfDate).toFixed(2) : '—'}</span>
              </div>`,
            )
            .join('')}
        </div>`;
    })
    .catch(() => {
      center.querySelector('#q-fin').innerHTML = '<div class="tbl-empty">财务数据加载失败</div>';
    });

  /* 相关资讯 */
  fetchNews(sym, 8)
    .then(({ data }) => {
      const host = center.querySelector('#q-news');
      const news = data?.news || [];
      host.innerHTML = news.length
        ? news
            .map(
              (n) => `<a class="news-item" href="${esc(n.link || '#')}" target="_blank" rel="noopener noreferrer">
                <div class="ni-top">
                  <span class="ni-pub">${esc(n.publisher || '')}</span>
                  <span class="ni-time">${esc(new Date((n.providerPublishTime || 0) * 1000).toLocaleString('zh-CN'))}</span>
                </div>
                <div class="ni-title">${esc(n.title || '')}</div>
              </a>`,
            )
            .join('')
        : '<div class="tbl-empty">暂无相关资讯</div>';
    })
    .catch(() => {
      center.querySelector('#q-news').innerHTML = '<div class="tbl-empty">资讯加载失败</div>';
    });

  /* 交互 */
  delegate(center, 'click', '[data-tf]', (event, node) => {
    const id = node.dataset.tf;
    update({ timeframe: id });
    center.querySelectorAll('[data-tf]').forEach((b) => b.classList.toggle('on', b.dataset.tf === id));
    const next = TIMEFRAMES.find((t) => t.id === id);
    if (next) {
      tf.range = next.range;
      tf.interval = next.interval;
      loadChart();
    }
  });

  delegate(center, 'click', '[data-overlay]', (event, node) => {
    const id = node.dataset.overlay;
    const list = [...state.overlays];
    const idx = list.indexOf(id);
    if (idx >= 0) list.splice(idx, 1);
    else list.push(id);
    update({ overlays: list });
    node.classList.toggle('on');
    loadChart();
  });

  delegate(center, 'click', '[data-sub]', (event, node) => {
    update({ subpanel: node.dataset.sub });
    center.querySelectorAll('[data-sub]').forEach((b) => b.classList.toggle('on', b.dataset.sub === node.dataset.sub));
    loadChart();
  });

  center.querySelector('#q-watch').addEventListener('click', () => {
    if (state.watchlist.includes(sym)) {
      removeFromWatchlist(sym);
      center.querySelector('#q-watch').textContent = '加入自选';
      toast('已移出自选', sym);
    } else {
      if (addToWatchlist(sym)) {
        center.querySelector('#q-watch').textContent = '移出自选';
        toast('已加入自选', sym);
      } else {
        toast('自选股已满', '上限 50 只', 'err');
      }
    }
  });

  center.querySelector('#q-alert').addEventListener('click', () => {
    openAlertDialog(sym, center.querySelector('#q-last').textContent);
  });
}

/** 价格提醒对话框 */
function openAlertDialog(symbol, lastText) {
  const wrap = document.createElement('div');
  wrap.className = 'dialog';
  wrap.innerHTML = `
    <div class="dlg-backdrop"></div>
    <div class="dlg-panel">
      <h3>设置价格提醒</h3>
      <p>当 ${esc(symbol)} 价格${'涨破或跌破'}设定价位时，浏览器会推送通知。</p>
      <div class="field">
        <label>条件</label>
        <select id="al-type">
          <option value="above">涨破（≥）</option>
          <option value="below">跌破（≤）</option>
        </select>
      </div>
      <div class="field">
        <label>目标价</label>
        <input id="al-price" type="number" step="0.01" value="${esc(String(lastText).replace(/[^\d.]/g, ''))}" />
      </div>
      <div class="dlg-actions">
        <button class="btn" data-close>取消</button>
        <button class="btn primary" data-save>保存提醒</button>
      </div>
    </div>`;
  document.body.appendChild(wrap);

  const close = () => wrap.remove();
  wrap.querySelector('[data-close]').addEventListener('click', close);
  wrap.querySelector('.dlg-backdrop').addEventListener('click', close);
  wrap.querySelector('[data-save]').addEventListener('click', () => {
    const type = wrap.querySelector('#al-type').value;
    const price = Number(wrap.querySelector('#al-price').value);
    if (!Number.isFinite(price) || price <= 0) {
      toast('请输入有效价格', '', 'err');
      return;
    }
    addAlert({ symbol, type, price });
    toast('提醒已设置', `${symbol} ${type === 'above' ? '≥' : '≤'} ${fmtPrice(price)}`);
    close();
  });
}
