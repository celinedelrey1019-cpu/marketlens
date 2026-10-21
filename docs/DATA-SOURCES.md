# 盘镜 MarketLens — 数据来源说明

所有行情数据均来自 **Yahoo Finance 的公开查询接口**（`query1.finance.yahoo.com`）。
本文档记录本项目实际使用的接口、返回结构要点，以及遇到的限流特性。

---

## 为什么需要反代

Yahoo 的 `query1` 接口**不返回** `Access-Control-Allow-Origin` 响应头，但会返回 `Vary: Origin`。
浏览器里的跨域 `fetch()` 因此会被 CORS 策略直接拒绝。

结论：**前端不能直连 Yahoo，必须经由服务端同源转发。**

```bash
curl -sI https://query1.finance.yahoo.com/v8/finance/chart/AAPL?range=1d | grep -i access-control
# 无输出 —— 没有 ACAO
```

---

## 接口清单

| 用途 | 路径 | 备注 |
|---|---|---|
| 批量报价 + 日内走势 | `/v8/finance/spark?symbols=A,B&range=1d&interval=5m&indicators=close` | **单次最多 20 个代码**，超了返回 400 |
| K 线（含 meta） | `/v8/finance/chart/{symbol}?range={range}&interval={interval}` | meta 里带昨收、52 周高低、成交量等 |
| 代码 / 名称搜索 | `/v1/finance/search?q={query}&quotesCount=8&newsCount=0` | 同时返回 news 数组 |
| 财经新闻 | `/v1/finance/search?q={query}&quotesCount=0&newsCount={n}` | 标题为英文原文 |
| 预设榜单 | `/v1/finance/screener/predefined/saved?scrIds={id}&count={n}` | **scrId 一次只能传一个** |
| 热门榜 | `/v1/finance/trending/{region}?count={n}` | region 取 `US` / `CN` 等 |
| 财务时间序列 | `/ws/fundamentals-timeseries/v1/finance/timeseries/{symbol}?type=...` | 无需 crumb，可取营收 / EPS |

### 预设榜单 id

| id | 含义 | 界面名称 |
|---|---|---|
| `day_gainers` | 当日涨幅榜 | 涨幅榜 |
| `day_losers` | 当日跌幅榜 | 跌幅榜 |
| `most_actives` | 成交活跃榜 | 成交活跃 |

### 可用的 Yahoo 代码后缀

| 类型 | 例子 |
|---|---|
| 美股 | `AAPL` `BRK-B` |
| 指数 | `^GSPC` `^IXIC` `^DJI` `^VIX` |
| A股 / 港股 | `000001.SS` `399001.SZ` `0700.HK` |
| 日本 / 欧洲 | `^N225` `^STOXX50E` `^FTSE` `^GDAXI` |
| 加密 | `BTC-USD` `ETH-USD` |
| 外汇 | `EURUSD=X` `USDCNH=X` |
| 商品 | `GC=F` `CL=F` |
| 板块 ETF | `XLK` `XLF` `XLE` … |

---

## 限流特性（踩过的坑）

### 1. 按 IP 限流，会持续一段时间

短时间内并发请求会收到 `429 Too Many Requests`，并且**不会立刻恢复**。
表现是：前面几个请求正常，后面的全部 429。

### 2. 突发请求比均匀请求更容易被限

实测：6 个请求按 1.2s 间隔均匀发出，全部成功；
一次性并发 8 个，绝大部分失败。

### 3. 改写 User-Agent 反而更容易被拦

用 Node `fetch` 默认头请求成功；显式加上 Chrome 的 `User-Agent` 后立刻 429。
所以 `server.js` 里**故意不伪装浏览器 UA**：

```js
headers: {
  Accept: 'application/json,text/plain,*/*',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  // 注意：不要设置 User-Agent
}
```

### 4. spark 接口有代码数量上限

`/v8/finance/spark` 单次超过 20 个代码直接返回 400：

```json
{"spark":{"result":null,"error":{"code":"Bad Request",
 "description":"Number of symbols needs to be less than or equal to 20..."}}}
```

客户端 `fetchQuotes()` 与快照生成脚本都按 20 个一组切片。

---

## 盘镜的应对策略

| 手段 | 位置 | 作用 |
|---|---|---|
| 最小间隔出口 | `server.js` `MIN_GAP_MS`（默认 900ms） | 避免突发 |
| 并发上限 | `server.js` `MAX_CONCURRENT`（默认 2） | 限制在途请求 |
| 429 全局冷却 | `server.js` `cooldownUntil` | 被限流后整个出口一起等 |
| 指数退避重试 | `server.js` `fetchWithRetry` | 最多 4 次 |
| 内存 TTL 缓存 | `server.js` `memCache` | 行情 15s、K 线 60s、财务 1h |
| 磁盘缓存兜底 | `server.js` `.cache/` | 上游挂了用陈旧数据响应（`X-Cache: STALE`） |
| 离线快照 | `public/js/data/snapshot.json` | 服务端也挂了就用内置真实数据渲染 |
| 客户端重试 | `public/js/core/api.js` | 502 / 429 时等 2.5s 再试一次 |

---

## 不使用的数据源

以下接口**需要 crumb / cookie 鉴权**，纯服务端匿名调用会返回 `Unauthorized`，因此本项目没有使用：

- `/v7/finance/quote` → `{"code":"Unauthorized","description":"User is unable to access this feature..."}`
- `/v10/finance/quoteSummary` → `{"code":"Unauthorized","description":"Invalid Crumb"}`

替代方案：`/v8/finance/chart` 的 `meta` 已经包含价格、昨收、52 周高低、成交量、交易所名称等，
批量场景用 `/v8/finance/spark`，财务数据用 `/ws/fundamentals-timeseries`。

---

## 使用约束

- Yahoo Finance 的服务条款禁止对接口做高频自动化访问。请保持 `YF_MIN_GAP_MS` 在合理区间。
- 盘镜是社区项目，**不是券商**，行情可能延迟或不准确。
- 本项目与 Yahoo 无任何关联。
