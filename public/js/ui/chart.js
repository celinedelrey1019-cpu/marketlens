/**
 * 盘镜 MarketLens — K 线图表引擎
 *
 * 自绘 Canvas，不引第三方图表库。功能：
 *   · 蜡烛图 + 成交量柱 + 右侧价格/涨跌幅双轴
 *   · 叠加指标（MA / EMA / BOLL / VWAP）与副图指标（RSI / MACD / ATR）
 *   · 十字光标 + 浮动 OHLC 提示框
 *   · 滚轮缩放、拖拽平移、窗口自适应
 */

import { fitCanvas } from '../core/dom.js';
import { fmtPrice, fmtPct, fmtVolume, fmtMonthDay, fmtDateTime } from '../core/format.js';

const cssVar = (name, fallback) => {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
};

const PAD_RIGHT = 62;
const PAD_TOP = 10;
const PAD_BOTTOM = 18;
const GAP = 8;

export function createChart(stage, options = {}) {
  const canvas = stage.querySelector('canvas');
  const tooltip = stage.querySelector('.chart-tooltip');
  if (!canvas) return { setData() {}, destroy() {} };

  let bars = [];
  let overlays = [];
  let subpanel = null;
  let view = { offset: 0, count: 120 };
  let hoverIndex = null;
  let dragging = null;
  let disposed = false;

  /* ── 几何 ────────────────────────────────────────────────── */
  function geometry() {
    const width = canvas.clientWidth || stage.clientWidth || 800;
    const height = canvas.clientHeight || stage.clientHeight || 420;
    const volumeH = 54;
    const subH = subpanel ? 72 : 0;
    const priceH = Math.max(80, height - PAD_TOP - PAD_BOTTOM - volumeH - subH - GAP * 2);
    return {
      width,
      height,
      volumeH,
      subH,
      priceTop: PAD_TOP,
      priceH,
      volumeTop: PAD_TOP + priceH + GAP,
      subTop: PAD_TOP + priceH + GAP + volumeH + GAP,
      plotW: width - PAD_RIGHT,
    };
  }

  function visibleBars() {
    const count = Math.max(10, Math.min(view.count, bars.length || 1));
    const maxOffset = Math.max(0, bars.length - count);
    const offset = Math.max(0, Math.min(view.offset, maxOffset));
    view.offset = offset;
    view.count = count;
    return bars.slice(offset, offset + count);
  }

  /* ── 绘制 ────────────────────────────────────────────────── */
  function draw() {
    if (disposed) return;
    const { ctx, width, height } = fitCanvas(canvas, stage.clientHeight || 420);
    const g = geometry();
    ctx.clearRect(0, 0, width, height);

    const vis = visibleBars();
    if (!vis.length) {
      ctx.fillStyle = cssVar('--fg-4', '#3b4859');
      ctx.font = '11px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.fillText('暂无行情数据', width / 2, height / 2);
      return;
    }

    const up = cssVar('--up', '#ff4d4f');
    const down = cssVar('--down', '#0fc17e');
    const grid = cssVar('--grid', 'rgba(255,255,255,.03)');
    const line2 = cssVar('--line-2', '#26324a');
    const fg3 = cssVar('--fg-3', '#56657c');
    const fg4 = cssVar('--fg-4', '#3b4859');
    const fg2 = cssVar('--fg-2', '#8496ae');

    /* 价格区间 */
    let hi = -Infinity;
    let lo = Infinity;
    for (const b of vis) {
      if (b.high > hi) hi = b.high;
      if (b.low < lo) lo = b.low;
    }
    for (const ov of overlays) {
      for (const v of ov.values) {
        if (v === null || v === undefined) continue;
        if (v > hi) hi = v;
        if (v < lo) lo = v;
      }
    }
    if (!Number.isFinite(hi) || !Number.isFinite(lo)) {
      hi = 1;
      lo = 0;
    }
    const pad = (hi - lo) * 0.06 || Math.abs(hi) * 0.02 || 1;
    hi += pad;
    lo -= pad;
    const span = hi - lo || 1;

    const yPrice = (v) => g.priceTop + g.priceH - ((v - lo) / span) * g.priceH;
    const slot = g.plotW / vis.length;
    const bodyW = Math.max(1, Math.min(14, slot * 0.62));
    const xAt = (i) => i * slot + slot / 2;

    /* 网格 + 右侧价格轴 */
    const rows = 5;
    ctx.strokeStyle = grid;
    ctx.fillStyle = fg4;
    ctx.font = '9px ui-monospace, monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 1;
    const first = vis[0];
    const baseClose = first.previousClose ?? first.close;
    for (let r = 0; r <= rows; r += 1) {
      const y = g.priceTop + (g.priceH / rows) * r;
      ctx.beginPath();
      ctx.moveTo(0, Math.round(y) + 0.5);
      ctx.lineTo(g.plotW, Math.round(y) + 0.5);
      ctx.stroke();
      const value = hi - (span / rows) * r;
      ctx.fillText(fmtPrice(value), g.plotW + 6, y);
      if (baseClose) {
        const pct = ((value - baseClose) / baseClose) * 100;
        ctx.fillStyle = pct >= 0 ? up : down;
        ctx.fillText(fmtPct(pct, 1), g.plotW + 6, y + 9);
        ctx.fillStyle = fg4;
      }
    }

    /* 垂直网格 + 时间轴 */
    const every = Math.max(1, Math.round(vis.length / 6));
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let i = 0; i < vis.length; i += every) {
      const x = Math.round(xAt(i)) + 0.5;
      ctx.strokeStyle = grid;
      ctx.beginPath();
      ctx.moveTo(x, g.priceTop);
      ctx.lineTo(x, g.priceTop + g.priceH);
      ctx.stroke();
      ctx.fillStyle = fg4;
      const label =
        vis[i].interval === '5m' || vis[i].interval === '15m'
          ? `${String(new Date(vis[i].time).getHours()).padStart(2, '0')}:${String(new Date(vis[i].time).getMinutes()).padStart(2, '0')}`
          : fmtMonthDay(vis[i].time);
      ctx.fillText(label, x, g.priceTop + g.priceH + 4);
    }

    /* 蜡烛 */
    vis.forEach((bar, i) => {
      const rising = bar.close >= bar.open;
      const color = bar.close === bar.open ? fg2 : rising ? up : down;
      const x = xAt(i);
      const yO = yPrice(bar.open);
      const yC = yPrice(bar.close);
      const yH = yPrice(bar.high);
      const yL = yPrice(bar.low);

      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(Math.round(x) + 0.5, yH);
      ctx.lineTo(Math.round(x) + 0.5, yL);
      ctx.stroke();

      const top = Math.min(yO, yC);
      const h = Math.max(1, Math.abs(yC - yO));
      if (rising) {
        ctx.fillStyle = 'transparent';
        ctx.strokeRect(Math.round(x - bodyW / 2) + 0.5, Math.round(top) + 0.5, Math.round(bodyW), Math.round(h));
      } else {
        ctx.fillRect(Math.round(x - bodyW / 2), Math.round(top), Math.round(bodyW), Math.round(h));
      }
    });

    /* 叠加指标 */
    for (const ov of overlays) {
      if (ov.band === 'mid') continue;
      ctx.strokeStyle = ov.color;
      ctx.lineWidth = ov.band ? 1 : 1.2;
      if (ov.band) ctx.setLineDash([3, 3]);
      ctx.beginPath();
      let started = false;
      ov.values.forEach((v, idx) => {
        if (v === null || v === undefined) return;
        const x = xAt(idx);
        const y = yPrice(v);
        if (!started) {
          ctx.moveTo(x, y);
          started = true;
        } else {
          ctx.lineTo(x, y);
        }
      });
      ctx.stroke();
      ctx.setLineDash([]);
    }

    /* 最新价标线 */
    const lastBar = vis[vis.length - 1];
    const lastY = yPrice(lastBar.close);
    const lastUp = lastBar.close >= (lastBar.previousClose ?? lastBar.open);
    ctx.strokeStyle = lastUp ? up : down;
    ctx.setLineDash([2, 3]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, Math.round(lastY) + 0.5);
    ctx.lineTo(g.plotW, Math.round(lastY) + 0.5);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = lastUp ? up : down;
    ctx.fillRect(g.plotW, lastY - 8, PAD_RIGHT - 4, 16);
    ctx.fillStyle = '#06080c';
    ctx.font = '9px ui-monospace, monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(fmtPrice(lastBar.close), g.plotW + 5, lastY);

    /* 成交量 */
    let volMax = 0;
    for (const b of vis) if (b.volume > volMax) volMax = b.volume;
    if (volMax > 0) {
      const vTop = g.volumeTop;
      const vH = g.volumeH;
      ctx.strokeStyle = grid;
      ctx.beginPath();
      ctx.moveTo(0, Math.round(vTop + vH) + 0.5);
      ctx.lineTo(g.plotW, Math.round(vTop + vH) + 0.5);
      ctx.stroke();
      ctx.fillStyle = fg4;
      ctx.font = '9px ui-monospace, monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText('VOL', 4, vTop + 2);
      ctx.fillText(fmtVolume(volMax), g.plotW + 6, vTop + 2);

      vis.forEach((bar, i) => {
        const h = (bar.volume / volMax) * (vH - 14);
        const rising = bar.close >= bar.open;
        ctx.fillStyle = rising ? up : down;
        ctx.globalAlpha = 0.55;
        ctx.fillRect(
          Math.round(xAt(i) - bodyW / 2),
          Math.round(vTop + vH - h),
          Math.max(1, Math.round(bodyW)),
          Math.max(1, Math.round(h)),
        );
        ctx.globalAlpha = 1;
      });
    }

    /* 副图 */
    if (subpanel && subpanel.values) {
      const sTop = g.subTop;
      const sH = g.subH;
      ctx.strokeStyle = grid;
      ctx.beginPath();
      ctx.moveTo(0, Math.round(sTop + sH) + 0.5);
      ctx.lineTo(g.plotW, Math.round(sTop + sH) + 0.5);
      ctx.stroke();

      ctx.fillStyle = fg4;
      ctx.font = '9px ui-monospace, monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(subpanel.name, 4, sTop + 2);

      if (subpanel.type === 'rsi') {
        const y = (v) => sTop + 14 + (100 - v) * ((sH - 18) / 100);
        ctx.strokeStyle = line2;
        ctx.setLineDash([3, 3]);
        [30, 70].forEach((lvl) => {
          ctx.beginPath();
          ctx.moveTo(0, Math.round(y(lvl)) + 0.5);
          ctx.lineTo(g.plotW, Math.round(y(lvl)) + 0.5);
          ctx.stroke();
        });
        ctx.setLineDash([]);
        ctx.strokeStyle = cssVar('--violet', '#8f82f5');
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        let started = false;
        subpanel.values.forEach((v, idx) => {
          if (v === null) return;
          const x = xAt(idx);
          const yy = y(v);
          if (!started) { ctx.moveTo(x, yy); started = true; } else ctx.lineTo(x, yy);
        });
        ctx.stroke();
      } else if (subpanel.type === 'macd') {
        const hist = subpanel.hist || [];
        let mMax = 0;
        for (const v of hist) if (v !== null && Math.abs(v) > mMax) mMax = Math.abs(v);
        for (const arr of [subpanel.values, subpanel.signal]) {
          for (const v of arr || []) if (v !== null && Math.abs(v) > mMax) mMax = Math.abs(v);
        }
        mMax = mMax || 1;
        const y = (v) => sTop + sH / 2 - (v / mMax) * (sH / 2 - 6);
        hist.forEach((v, idx) => {
          if (v === null) return;
          ctx.fillStyle = v >= 0 ? up : down;
          ctx.globalAlpha = 0.5;
          const yy = y(v);
          ctx.fillRect(
            Math.round(xAt(idx) - bodyW / 2),
            Math.round(Math.min(y(0), yy)),
            Math.max(1, Math.round(bodyW)),
            Math.max(1, Math.round(Math.abs(yy - y(0)))),
          );
          ctx.globalAlpha = 1;
        });
        const drawLine = (arr, color) => {
          ctx.strokeStyle = color;
          ctx.lineWidth = 1.1;
          ctx.beginPath();
          let started = false;
          (arr || []).forEach((v, idx) => {
            if (v === null) return;
            const x = xAt(idx);
            const yy = y(v);
            if (!started) { ctx.moveTo(x, yy); started = true; } else ctx.lineTo(x, yy);
          });
          ctx.stroke();
        };
        drawLine(subpanel.values, cssVar('--cyan', '#3ec9e8'));
        drawLine(subpanel.signal, cssVar('--amber', '#ffb020'));
      } else if (subpanel.type === 'atr') {
        let aMax = 0;
        for (const v of subpanel.values) if (v !== null && v > aMax) aMax = v;
        aMax = aMax || 1;
        const y = (v) => sTop + sH - 12 - (v / aMax) * (sH - 20);
        ctx.strokeStyle = cssVar('--teal', '#2fb8a6');
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        let started = false;
        subpanel.values.forEach((v, idx) => {
          if (v === null) return;
          const x = xAt(idx);
          const yy = y(v);
          if (!started) { ctx.moveTo(x, yy); started = true; } else ctx.lineTo(x, yy);
        });
        ctx.stroke();
      }
    }

    /* 十字光标 */
    if (hoverIndex !== null && hoverIndex >= 0 && hoverIndex < vis.length) {
      const x = Math.round(xAt(hoverIndex)) + 0.5;
      ctx.strokeStyle = cssVar('--fg-3', '#56657c');
      ctx.setLineDash([3, 3]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, g.priceTop);
      ctx.lineTo(x, g.subTop + g.subH);
      ctx.stroke();

      const bar = vis[hoverIndex];
      const y = Math.round(yPrice(bar.close)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(g.plotW, y);
      ctx.stroke();
      ctx.setLineDash([]);

      if (tooltip) {
        const rows = [
          ['开', fmtPrice(bar.open)],
          ['高', fmtPrice(bar.high)],
          ['低', fmtPrice(bar.low)],
          ['收', fmtPrice(bar.close)],
          ['量', fmtVolume(bar.volume)],
        ];
        if (bar.previousClose) {
          const pct = ((bar.close - bar.previousClose) / bar.previousClose) * 100;
          rows.push(['涨跌', fmtPct(pct)]);
        }
        tooltip.innerHTML =
          `<div class="tt-row"><span class="tt-k">${bar.symbol || ''} ${fmtDateTime(bar.time)}</span></div>` +
          rows.map(([k, v]) => `<div class="tt-row"><span class="tt-k">${k}</span><span>${v}</span></div>`).join('');
        tooltip.classList.add('show');
        const tw = tooltip.offsetWidth || 170;
        const left = x + 14 + tw > width ? x - tw - 14 : x + 14;
        tooltip.style.left = `${Math.max(4, left)}px`;
        tooltip.style.top = `${Math.max(4, Math.min(y - 30, height - tooltip.offsetHeight - 4))}px`;
      }
    } else if (tooltip) {
      tooltip.classList.remove('show');
    }
  }

  /* ── 交互 ────────────────────────────────────────────────── */
  function indexFromX(clientX) {
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const g = geometry();
    const slot = g.plotW / Math.max(1, view.count);
    return Math.max(0, Math.min(Math.round(x / slot) - 0, view.count - 1));
  }

  function onMove(event) {
    if (dragging) {
      const dx = event.clientX - dragging.x;
      const g = geometry();
      const slot = g.plotW / Math.max(1, view.count);
      const shift = Math.round(dx / slot);
      view.offset = dragging.offset - shift;
      hoverIndex = indexFromX(event.clientX);
      draw();
      return;
    }
    hoverIndex = indexFromX(event.clientX);
    draw();
  }

  function onLeave() {
    hoverIndex = null;
    dragging = null;
    draw();
  }

  function onWheel(event) {
    event.preventDefault();
    const factor = event.deltaY > 0 ? 1.15 : 0.87;
    const next = Math.round(view.count * factor);
    const maxCount = Math.max(20, bars.length || 20);
    view.count = Math.max(10, Math.min(maxCount, next));
    draw();
  }

  function onDown(event) {
    dragging = { x: event.clientX, offset: view.offset };
    canvas.style.cursor = 'grabbing';
  }

  function onUp() {
    dragging = null;
    canvas.style.cursor = 'crosshair';
  }

  canvas.addEventListener('mousemove', onMove);
  canvas.addEventListener('mouseleave', onLeave);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('mousedown', onDown);
  window.addEventListener('mouseup', onUp);

  const observer = new ResizeObserver(() => draw());
  observer.observe(stage);

  return {
    setData(nextBars, nextOverlays = [], nextSubpanel = null, resetView = true) {
      bars = nextBars || [];
      overlays = nextOverlays || [];
      subpanel = nextSubpanel;
      if (resetView) {
        const visible = Math.min(bars.length || 120, 90);
        view.count = Math.max(10, visible);
        view.offset = Math.max(0, bars.length - view.count);
      }
      draw();
    },
    redraw: draw,
    destroy() {
      disposed = true;
      observer.disconnect();
      canvas.removeEventListener('mousemove', onMove);
      canvas.removeEventListener('mouseleave', onLeave);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('mousedown', onDown);
      window.removeEventListener('mouseup', onUp);
    },
  };
}
