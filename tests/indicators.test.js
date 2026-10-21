import test from 'node:test';
import assert from 'node:assert/strict';
import {
  sma,
  ema,
  bollinger,
  rsi,
  macd,
  atr,
  vwap,
  stochastic,
  computeOverlays,
} from '../public/js/core/indicators.js';

const closes = [10, 11, 12, 11, 13, 14, 13.5, 15, 16, 15.5, 17, 18, 17.5, 19, 20];

test('sma: 前 period-1 位为 null，之后是窗口均值', () => {
  const out = sma(closes, 5);
  assert.equal(out.length, closes.length);
  assert.equal(out[3], null);
  assert.equal(out[4], (10 + 11 + 12 + 11 + 13) / 5);
  // 最后一根：closes[10..14] = 17 + 18 + 17.5 + 19 + 20
  assert.equal(out[14], (17 + 18 + 17.5 + 19 + 20) / 5);
});

test('sma: 数据不足时全部为 null', () => {
  assert.deepEqual(sma([1, 2], 5), [null, null]);
});

test('ema: 以首个窗口的 sma 作为种子', () => {
  const out = ema(closes, 5);
  assert.equal(out[3], null);
  assert.equal(out[4], (10 + 11 + 12 + 11 + 13) / 5);
  const k = 2 / 6;
  assert.ok(Math.abs(out[5] - (closes[5] * k + out[4] * (1 - k))) < 1e-12);
});

test('bollinger: 中轨等于 sma，上下轨对称', () => {
  const b = bollinger(closes, 5, 2);
  assert.equal(b.mid.length, closes.length);
  for (let i = 4; i < closes.length; i += 1) {
    assert.ok(Math.abs(b.upper[i] - b.mid[i] - (b.mid[i] - b.lower[i])) < 1e-9);
  }
});

test('rsi: 单调上涨时接近 100', () => {
  const rising = Array.from({ length: 30 }, (_, i) => 100 + i);
  const out = rsi(rising, 14);
  assert.ok(out[29] > 99);
  assert.equal(out[12], null);
});

test('rsi: 完全无波动时为 100', () => {
  const flat = Array.from({ length: 20 }, () => 5);
  const out = rsi(flat, 14);
  assert.equal(out[19], 100);
});

test('macd: 线 / 信号 / 柱三者长度一致且对齐', () => {
  const long = Array.from({ length: 60 }, (_, i) => 100 + Math.sin(i / 3) * 10);
  const m = macd(long, 12, 26, 9);
  assert.equal(m.line.length, long.length);
  assert.equal(m.signal.length, long.length);
  assert.equal(m.hist.length, long.length);
  assert.equal(m.line[24], null, '前 25 位不足以算出 EMA26');
  assert.ok(m.line[25] !== null, '第 26 位起应能算出 MACD 线');
  // 信号线比 MACD 线晚 8 个点（MACD 线从第 26 位起）
  assert.equal(m.signal[32], null);
  assert.ok(m.signal[33] !== null);
  // 柱 = 线 - 信号
  assert.ok(Math.abs(m.hist[40] - (m.line[40] - m.signal[40])) < 1e-12);
});

test('atr: 不为负，且长度一致', () => {
  const high = closes.map((c) => c + 1);
  const low = closes.map((c) => c - 1);
  const out = atr(high, low, closes, 14);
  assert.equal(out.length, closes.length);
  assert.equal(out[12], null);
  assert.ok(out[14] >= 0);
});

test('vwap: 成交量为 0 时不产生 NaN', () => {
  const high = closes.map((c) => c + 1);
  const low = closes.map((c) => c - 1);
  const volume = closes.map(() => 0);
  const out = vwap(high, low, closes, volume);
  assert.ok(out.every((v) => v === null || Number.isFinite(v)));
});

test('stochastic: 输出长度与 %K / %D 对齐', () => {
  const high = closes.map((c) => c + 1);
  const low = closes.map((c) => c - 1);
  const s = stochastic(high, low, closes, 14, 3, 3);
  assert.equal(s.k.length, closes.length);
  assert.equal(s.d.length, closes.length);
});

test('computeOverlays: 按定义生成叠加线', () => {
  const bars = closes.map((c) => ({
    open: c,
    high: c + 1,
    low: c - 1,
    close: c,
    volume: 1000,
  }));
  const defs = [
    { id: 'ma5', name: 'MA5', type: 'ma', period: 5, color: '#fff' },
    { id: 'boll', name: 'BOLL', type: 'boll', period: 5, mult: 2, color: '#0f0' },
    { id: 'vwap', name: 'VWAP', type: 'vwap', color: '#0ff' },
  ];
  const out = computeOverlays(['ma5', 'boll', 'vwap'], defs, bars);
  const ids = out.map((o) => o.id);
  assert.ok(ids.includes('ma5'));
  assert.ok(ids.includes('boll-up'));
  assert.ok(ids.includes('boll-mid'));
  assert.ok(ids.includes('boll-low'));
  assert.ok(ids.includes('vwap'));
  assert.ok(out.every((o) => o.values.length === bars.length));
});

test('computeOverlays: 未启用的指标不产出', () => {
  const bars = closes.map((c) => ({ open: c, high: c, low: c, close: c, volume: 1 }));
  const out = computeOverlays([], [], bars);
  assert.equal(out.length, 0);
});
