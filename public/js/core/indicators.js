/**
 * 盘镜 MarketLens — 技术指标计算
 * 纯函数，无 DOM 依赖，可在 Node 里直接跑测试。
 * 所有输出数组与输入等长，前置不足的位置填 null。
 */

/** 简单移动平均 */
export function sma(values, period) {
  const out = new Array(values.length).fill(null);
  if (period <= 0 || values.length < period) return out;
  let sum = 0;
  for (let i = 0; i < values.length; i += 1) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

/** 指数移动平均 */
export function ema(values, period) {
  const out = new Array(values.length).fill(null);
  if (period <= 0 || values.length < period) return out;
  const k = 2 / (period + 1);
  let prev = 0;
  for (let i = 0; i < period; i += 1) prev += values[i];
  prev /= period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i += 1) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

/** 布林带 */
export function bollinger(values, period = 20, mult = 2) {
  const mid = sma(values, period);
  const upper = new Array(values.length).fill(null);
  const lower = new Array(values.length).fill(null);
  for (let i = period - 1; i < values.length; i += 1) {
    let variance = 0;
    for (let j = i - period + 1; j <= i; j += 1) {
      const d = values[j] - mid[i];
      variance += d * d;
    }
    const sd = Math.sqrt(variance / period);
    upper[i] = mid[i] + mult * sd;
    lower[i] = mid[i] - mult * sd;
  }
  return { mid, upper, lower };
}

/** 相对强弱指标 */
export function rsi(values, period = 14) {
  const out = new Array(values.length).fill(null);
  if (values.length <= period) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i += 1) {
    const d = values[i] - values[i - 1];
    if (d >= 0) gain += d;
    else loss -= d;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < values.length; i += 1) {
    const d = values[i] - values[i - 1];
    const g = d > 0 ? d : 0;
    const l = d < 0 ? -d : 0;
    avgGain = (avgGain * (period - 1) + g) / period;
    avgLoss = (avgLoss * (period - 1) + l) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

/** MACD */
export function macd(values, fast = 12, slow = 26, signal = 9) {
  const emaFast = ema(values, fast);
  const emaSlow = ema(values, slow);
  const line = values.map((_, i) =>
    emaFast[i] === null || emaSlow[i] === null ? null : emaFast[i] - emaSlow[i],
  );
  const defined = line.filter((v) => v !== null);
  const signalRaw = ema(defined, signal);
  const start = line.findIndex((v) => v !== null);
  const signalArr = new Array(values.length).fill(null);
  if (start >= 0) {
    for (let i = 0; i < signalRaw.length; i += 1) {
      if (signalRaw[i] !== null) signalArr[start + i] = signalRaw[i];
    }
  }
  const hist = line.map((v, i) =>
    v === null || signalArr[i] === null ? null : v - signalArr[i],
  );
  return { line, signal: signalArr, hist };
}

/** 真实波幅均值 */
export function atr(high, low, close, period = 14) {
  const tr = new Array(high.length).fill(null);
  for (let i = 0; i < high.length; i += 1) {
    if (i === 0) {
      tr[i] = high[i] - low[i];
    } else {
      tr[i] = Math.max(
        high[i] - low[i],
        Math.abs(high[i] - close[i - 1]),
        Math.abs(low[i] - close[i - 1]),
      );
    }
  }
  return sma(tr, period);
}

/** 成交量加权均价 */
export function vwap(high, low, close, volume) {
  const out = new Array(close.length).fill(null);
  let pv = 0;
  let vol = 0;
  for (let i = 0; i < close.length; i += 1) {
    const typical = (high[i] + low[i] + close[i]) / 3;
    pv += typical * volume[i];
    vol += volume[i];
    out[i] = vol > 0 ? pv / vol : null;
  }
  return out;
}

/** 随机指标 %K / %D */
export function stochastic(high, low, close, period = 14, smoothK = 3, smoothD = 3) {
  const raw = new Array(close.length).fill(null);
  for (let i = period - 1; i < close.length; i += 1) {
    let hh = -Infinity;
    let ll = Infinity;
    for (let j = i - period + 1; j <= i; j += 1) {
      if (high[j] > hh) hh = high[j];
      if (low[j] < ll) ll = low[j];
    }
    raw[i] = hh === ll ? 50 : ((close[i] - ll) / (hh - ll)) * 100;
  }
  const k = sma(raw.map((v) => (v === null ? 0 : v)), smoothK).map((v, i) =>
    raw[i] === null ? null : v,
  );
  const d = sma(k.map((v) => (v === null ? 0 : v)), smoothD).map((v, i) =>
    k[i] === null ? null : v,
  );
  return { k, d };
}

/**
 * 按指标定义算出叠加线。
 * @param {string[]} activeIds 启用的指标 id
 * @param {object} defs 指标定义表
 * @param {object} bars K 线数组 [{open,high,low,close,volume}]
 * @returns {Array<{id,name,color,values}>}
 */
export function computeOverlays(activeIds, defs, bars) {
  const closes = bars.map((b) => b.close);
  const out = [];
  for (const id of activeIds) {
    const def = defs.find((d) => d.id === id);
    if (!def) continue;
    if (def.type === 'ma') {
      out.push({ id, name: def.name, color: def.color, values: sma(closes, def.period) });
    } else if (def.type === 'ema') {
      out.push({ id, name: def.name, color: def.color, values: ema(closes, def.period) });
    } else if (def.type === 'boll') {
      const b = bollinger(closes, def.period, def.mult);
      out.push({ id: `${id}-up`, name: 'BOLL上轨', color: def.color, values: b.upper, band: 'upper' });
      out.push({ id: `${id}-mid`, name: 'BOLL中轨', color: def.color, values: b.mid, band: 'mid' });
      out.push({ id: `${id}-low`, name: 'BOLL下轨', color: def.color, values: b.lower, band: 'lower' });
    } else if (def.type === 'vwap') {
      out.push({
        id,
        name: def.name,
        color: def.color,
        values: vwap(
          bars.map((b) => b.high),
          bars.map((b) => b.low),
          closes,
          bars.map((b) => b.volume),
        ),
      });
    }
  }
  return out;
}
