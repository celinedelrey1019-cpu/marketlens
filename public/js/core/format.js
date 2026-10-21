/**
 * 盘镜 MarketLens — 格式化工具
 * 数字一律等宽对齐；中文语境下用「亿 / 万」压缩大数。
 */

const NBSP = ' ';

export function isNum(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

/** 普通数字，固定小数位 */
export function fmtNum(v, digits = 2) {
  if (!isNum(v)) return '—';
  return v.toLocaleString('zh-CN', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/** 价格：按数值量级自动决定小数位 */
export function fmtPrice(v) {
  if (!isNum(v)) return '—';
  const abs = Math.abs(v);
  const digits = abs >= 1000 ? 2 : abs >= 1 ? 2 : abs >= 0.01 ? 4 : 6;
  return v.toLocaleString('zh-CN', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/** 带正负号的数值 */
export function fmtSigned(v, digits = 2) {
  if (!isNum(v)) return '—';
  return `${v > 0 ? '+' : v < 0 ? '−' : ''}${fmtNum(Math.abs(v), digits)}`;
}

/** 带正负号的百分比 */
export function fmtPct(v, digits = 2) {
  if (!isNum(v)) return '—';
  const sign = v > 0 ? '+' : v < 0 ? '−' : '';
  return `${sign}${Math.abs(v).toFixed(digits)}%`;
}

/** 涨跌方向 → CSS 类 */
export function dirClass(v) {
  if (!isNum(v) || v === 0) return 'flat';
  return v > 0 ? 'up' : 'down';
}

/** 中文大数压缩：1.23亿 / 4567万 */
export function fmtCompact(v) {
  if (!isNum(v)) return '—';
  const abs = Math.abs(v);
  const sign = v < 0 ? '−' : '';
  if (abs >= 1e12) return `${sign}${(abs / 1e12).toFixed(2)}万亿`;
  if (abs >= 1e8) return `${sign}${(abs / 1e8).toFixed(2)}亿`;
  if (abs >= 1e4) return `${sign}${(abs / 1e4).toFixed(2)}万`;
  return `${sign}${abs.toFixed(abs < 10 ? 2 : 0)}`;
}

/** 成交量 */
export function fmtVolume(v) {
  if (!isNum(v)) return '—';
  return fmtCompact(v);
}

/** 市值 */
export function fmtCap(v) {
  if (!isNum(v)) return '—';
  return `$${fmtCompact(v)}`;
}

/** 时分秒 */
export function fmtClock(ts) {
  if (!ts) return '--:--:--';
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** 日期 YYYY-MM-DD */
export function fmtDate(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 月日 */
export function fmtMonthDay(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 日期时间 */
export function fmtDateTime(ts) {
  if (!ts) return '—';
  return `${fmtDate(ts)} ${fmtClock(ts).slice(0, 5)}`;
}

/** 相对时间：刚刚 / 12 分钟前 / 3 小时前 / 2 天前 */
export function fmtRel(ts) {
  if (!ts) return '—';
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60000);
  if (min < 1) return '刚刚';
  if (min < 60) return `${min} 分钟前`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour} 小时前`;
  const day = Math.floor(hour / 24);
  if (day < 30) return `${day} 天前`;
  return fmtDate(ts);
}

/** 毫秒 → 0.42s */
export function fmtLatency(ms) {
  if (!isNum(ms)) return '—';
  return `${(ms / 1000).toFixed(2)}s`;
}

/** 交易时段状态 */
export function marketPhase(now, openHour, closeHour) {
  if (openHour === 0 && closeHour === 24) return 'closed';
  const d = new Date(now);
  const hour = d.getHours() + d.getMinutes() / 60;
  const day = d.getDay();
  if (day === 0 || day === 6) return 'closed';
  if (hour < openHour) return 'pre';
  if (hour >= closeHour) return 'closed';
  return 'open';
}

export { NBSP };
