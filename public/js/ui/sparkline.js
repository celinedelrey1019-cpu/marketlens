/**
 * 盘镜 MarketLens — 迷你走势线（自选股 / 指数卡片）
 */

import { fitCanvas } from '../core/dom.js';

const css = (name, fallback) => {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
};

/**
 * @param {HTMLCanvasElement} canvas
 * @param {number[]} values 收盘价序列
 * @param {{color?: string, fill?: boolean, baseline?: boolean}} options
 */
export function drawSparkline(canvas, values, options = {}) {
  const { width, height, ctx } = fitCanvas(canvas, canvas.clientHeight || 18);
  ctx.clearRect(0, 0, width, height);

  const clean = (values || []).filter((v) => typeof v === 'number' && Number.isFinite(v));
  if (clean.length < 2) {
    ctx.strokeStyle = css('--fg-4', '#3b4859');
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, height / 2);
    ctx.lineTo(width, height / 2);
    ctx.stroke();
    return;
  }

  const first = clean[0];
  const last = clean[clean.length - 1];
  const rising = last >= first;
  const color = options.color || (rising ? css('--up', '#ff4d4f') : css('--down', '#0fc17e'));

  let min = Infinity;
  let max = -Infinity;
  for (const v of clean) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const span = max - min || Math.abs(max) * 0.002 || 1;
  const pad = 2;
  const h = height - pad * 2;

  const xAt = (i) => (i / (clean.length - 1)) * (width - 2) + 1;
  const yAt = (v) => pad + h - ((v - min) / span) * h;

  if (options.fill !== false) {
    const grad = ctx.createLinearGradient(0, 0, 0, height);
    grad.addColorStop(0, `${color}44`);
    grad.addColorStop(1, `${color}00`);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(xAt(0), yAt(clean[0]));
    for (let i = 1; i < clean.length; i += 1) ctx.lineTo(xAt(i), yAt(clean[i]));
    ctx.lineTo(xAt(clean.length - 1), height);
    ctx.lineTo(xAt(0), height);
    ctx.closePath();
    ctx.fill();
  }

  ctx.strokeStyle = color;
  ctx.lineWidth = 1.1;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  for (let i = 0; i < clean.length; i += 1) {
    const x = xAt(i);
    const y = yAt(clean[i]);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  if (options.baseline) {
    ctx.strokeStyle = css('--line-2', '#26324a');
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, yAt(first));
    ctx.lineTo(width, yAt(first));
    ctx.stroke();
  }
}
