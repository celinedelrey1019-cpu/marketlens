/**
 * 盘镜 MarketLens — 全局配置
 * 市场、指数、板块、默认自选、时间周期、指标定义。
 */

/** 市场分区：对应总览页的「市场脉冲」 */
export const MARKETS = [
  {
    id: 'us',
    name: '美国',
    en: 'UNITED STATES',
    tz: 'America/New_York',
    tzLabel: '纽约',
    open: 9.5,
    close: 16,
    indices: [
      { symbol: '^GSPC', name: '标普 500' },
      { symbol: '^IXIC', name: '纳斯达克' },
      { symbol: '^DJI', name: '道琼斯' },
      { symbol: '^RUT', name: '罗素 2000' },
    ],
  },
  {
    id: 'cn',
    name: '中国',
    en: 'CHINA / HK',
    tz: 'Asia/Shanghai',
    tzLabel: '北京',
    open: 9.5,
    close: 15,
    indices: [
      { symbol: '000001.SS', name: '上证指数' },
      { symbol: '399001.SZ', name: '深证成指' },
      { symbol: '^HSI', name: '恒生指数' },
    ],
  },
  {
    id: 'jp',
    name: '日本',
    en: 'JAPAN',
    tz: 'Asia/Tokyo',
    tzLabel: '东京',
    open: 9,
    close: 15,
    indices: [
      { symbol: '^N225', name: '日经 225' },
      { symbol: '^TOPX', name: '东证指数' },
    ],
  },
  {
    id: 'eu',
    name: '欧洲',
    en: 'EUROPE',
    tz: 'Europe/London',
    tzLabel: '伦敦',
    open: 8,
    close: 16.5,
    indices: [
      { symbol: '^STOXX50E', name: '欧洲斯托克 50' },
      { symbol: '^FTSE', name: '英国富时 100' },
      { symbol: '^GDAXI', name: '德国 DAX' },
    ],
  },
  {
    id: 'crypto',
    name: '加密货币',
    en: 'CRYPTO',
    tz: 'UTC',
    tzLabel: 'UTC',
    open: 0,
    close: 24,
    indices: [
      { symbol: 'BTC-USD', name: '比特币' },
      { symbol: 'ETH-USD', name: '以太坊' },
      { symbol: 'SOL-USD', name: 'Solana' },
    ],
  },
  {
    id: 'fx',
    name: '外汇',
    en: 'FOREX',
    tz: 'UTC',
    tzLabel: 'UTC',
    open: 0,
    close: 24,
    indices: [
      { symbol: 'EURUSD=X', name: '欧元 / 美元' },
      { symbol: 'USDJPY=X', name: '美元 / 日元' },
      { symbol: 'USDCNH=X', name: '美元 / 离岸人民币' },
    ],
  },
  {
    id: 'commodity',
    name: '商品',
    en: 'COMMODITIES',
    tz: 'UTC',
    tzLabel: 'UTC',
    open: 0,
    close: 24,
    indices: [
      { symbol: 'GC=F', name: '黄金' },
      { symbol: 'CL=F', name: '原油' },
      { symbol: 'SI=F', name: '白银' },
    ],
  },
];

/** 全部指数（总览页的市场脉冲） */
export const ALL_INDICES = MARKETS.flatMap((m) =>
  m.indices.map((i) => ({ ...i, market: m.id, marketName: m.name })),
);

/** 板块 ETF（S&P 500 板块口径） */
export const SECTORS = [
  { symbol: 'XLK', name: '科技' },
  { symbol: 'XLF', name: '金融' },
  { symbol: 'XLE', name: '能源' },
  { symbol: 'XLV', name: '医疗保健' },
  { symbol: 'XLY', name: '可选消费' },
  { symbol: 'XLP', name: '必需消费' },
  { symbol: 'XLI', name: '工业' },
  { symbol: 'XLB', name: '原材料' },
  { symbol: 'XLRE', name: '房地产' },
  { symbol: 'XLU', name: '公用事业' },
  { symbol: 'XLC', name: '通信服务' },
];

/** 默认自选股 */
export const DEFAULT_WATCHLIST = [
  'AAPL',
  'MSFT',
  'NVDA',
  'TSLA',
  'AMD',
  '0700.HK',
  '9988.HK',
  'BTC-USD',
  'EURUSD=X',
  'GC=F',
];

/** 默认行情标的 */
export const DEFAULT_SYMBOL = 'AAPL';

/** K 线周期 */
export const TIMEFRAMES = [
  { id: '1d', label: '分时', range: '1d', interval: '5m', bars: 78 },
  { id: '5d', label: '五日', range: '5d', interval: '15m', bars: 65 },
  { id: '1mo', label: '月线', range: '1mo', interval: '1d', bars: 22 },
  { id: '3mo', label: '季线', range: '3mo', interval: '1d', bars: 64 },
  { id: '6mo', label: '半年', range: '6mo', interval: '1d', bars: 128 },
  { id: '1y', label: '年线', range: '1y', interval: '1d', bars: 252 },
  { id: '5y', label: '五年', range: '5y', interval: '1wk', bars: 260 },
];

/** 可叠加的技术指标 */
export const OVERLAY_INDICATORS = [
  { id: 'ma5', name: 'MA5', type: 'ma', period: 5, color: '#ffb020' },
  { id: 'ma10', name: 'MA10', type: 'ma', period: 10, color: '#3ec9e8' },
  { id: 'ma20', name: 'MA20', type: 'ma', period: 20, color: '#8f82f5' },
  { id: 'ma60', name: 'MA60', type: 'ma', period: 60, color: '#2fb8a6' },
  { id: 'ema12', name: 'EMA12', type: 'ema', period: 12, color: '#ff8fa3' },
  { id: 'ema26', name: 'EMA26', type: 'ema', period: 26, color: '#c9a227' },
  { id: 'boll', name: 'BOLL', type: 'boll', period: 20, mult: 2, color: '#7f9bc4' },
  { id: 'vwap', name: 'VWAP', type: 'vwap', color: '#5ad2f4' },
];

/** 副图指标 */
export const SUBPANEL_INDICATORS = [
  { id: 'rsi', name: 'RSI', type: 'rsi', period: 14 },
  { id: 'macd', name: 'MACD', type: 'macd', fast: 12, slow: 26, signal: 9 },
  { id: 'atr', name: 'ATR', type: 'atr', period: 14 },
];

/** 榜单类型 */
export const MOVER_TYPES = [
  { id: 'day_gainers', name: '涨幅榜', en: 'GAINERS' },
  { id: 'day_losers', name: '跌幅榜', en: 'LOSERS' },
  { id: 'most_actives', name: '成交活跃', en: 'ACTIVE' },
];

/** 数据刷新间隔（毫秒） */
export const REFRESH_MS = 60_000;

/** 本地存储键 */
export const STORAGE_KEY = 'marketlens.v1';
