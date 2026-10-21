# 盘镜 MarketLens

**免费开源的中文行情终端** · 数据来自 Yahoo Finance · 界面参考 Bloomberg / LSEG Workspace / S&P Global 的专业终端范式

> Markets, minus the paywall — 中文版。

盘镜是一个自建的开源行情工作台：实时报价、K 线与技术指标、板块热力图、涨跌榜、自选股、价格提醒、财经要闻，
全部界面中文，所有数据实时取自 Yahoo Finance。

它不是某个商业产品的换皮，而是一次重新设计：**把「看盘」这件事按专业终端的逻辑重新排布一遍。**

---

## 目录

- [为什么需要它](#为什么需要它)
- [快速开始](#快速开始)
- [功能清单](#功能清单)
- [界面设计](#界面设计)
- [技术架构](#技术架构)
- [数据来源与限制](#数据来源与限制)
- [项目结构](#项目结构)
- [开发](#开发)
- [部署](#部署)
- [许可](#许可)

---

## 为什么需要它

市面上的行情终端要么是收费的（Bloomberg、Refinitiv Workspace、Wind），要么是功能被砍到只剩「涨跌颜色」的免费行情 App。
开源自带的行情产品往往卡在登录墙、数据库和 API Key 后面，装起来比看盘本身还费劲。

盘镜的选择很直接：

- **零依赖、零构建**。`node server.js` 就跑起来了，不需要 npm install，不需要数据库，不需要注册。
- **不需要任何 API Key**。Yahoo Finance 的公开查询接口拿来就用。
- **数据留在本地**。自选股、提醒、主题偏好全在浏览器 localStorage 里。
- **界面全中文**，术语按国内交易员的习惯走（红涨绿跌、成交量、52 周区间）。

---

## 快速开始

需要 **Node.js ≥ 18.17**（推荐 22 LTS）。不需要装任何依赖。

```bash
git clone https://github.com/celinedelrey1019-cpu/marketlens.git
cd marketlens
npm start
```

打开 <http://127.0.0.1:4173>。

就这样。没有 `npm install`，没有 `.env`，没有数据库。

### Docker

```bash
docker compose up -d --build
# → http://127.0.0.1:4173
```

---

## 功能清单

| 模块 | 说明 |
|---|---|
| **总览** | 七大市场脉冲（美股 / A股港股 / 日本 / 欧洲 / 加密 / 外汇 / 商品）、标普板块热力图、涨跌幅榜、热门搜索 |
| **行情** | K 线（7 档周期）、MA/EMA/BOLL/VWAP 叠加，RSI/MACD/ATR 副图，十字光标、滚轮缩放、拖拽平移，关键指标、财务摘要、相关资讯 |
| **自选** | 最多 50 只，本地存储，按列排序，迷你走势线，一键增删 |
| **榜单** | 涨幅榜 / 跌幅榜 / 成交活跃榜 |
| **提醒** | 价格涨破 / 跌破提醒，浏览器通知 + 站内提示 |
| **命令面板** | `⌘K` 全局搜索：证券代码、名称，以及切换主题 / 配色 / 刷新等命令 |
| **行情跑马灯** | 顶部连续滚动的实时报价带 |
| **主题** | 深色（终端） / 浅色（纸白）双主题；红涨绿跌 / 绿涨红跌可切换 |

### 键盘快捷键

| 按键 | 作用 |
|---|---|
| `⌘K` / `Ctrl+K` | 打开命令面板 |
| `/` | 快速搜索 |
| `1` `2` `3` `4` | 总览 / 行情 / 自选 / 榜单 |
| `↑` `↓` `↵` | 命令面板内导航与选择 |
| `ESC` | 关闭命令面板 |

---

## 界面设计

盘镜的视觉语言参考专业金融终端，而不是消费级 App：

- **近黑底 + 发丝级边框 + 直角面板**，没有圆角卡片、没有渐变、没有阴影堆叠。
- **等宽表格数字**：所有价格、涨跌幅、成交量用 `tabular-nums` 对齐，扫一眼就能比较。
- **双语微标签**：面板标题是「市场脉冲 · MARKET PULSE」这种中文 + 大写拉丁的组合。
- **三栏工作区**：左侧导航轨、中间主工作区、右侧监控列（自选 / 涨跌 / 要闻 / 提醒），底部状态栏常驻显示数据源、延迟和刷新倒计时。
- **信息密度优先**：11–13px 字号，紧凑行高，滚动条细窄。

配色遵循国内交易习惯（默认红涨绿跌），可一键切换为国际惯例。

---

## 技术架构

```
浏览器 ──同源──► 本地 Node 服务 ──HTTPS──► query1.finance.yahoo.com
                 │
                 ├─ 出口限速（最小间隔 + 并发上限）
                 ├─ 429 全局冷却 + 指数退避重试
                 ├─ 内存 TTL 缓存
                 └─ 磁盘缓存（.cache/），上游挂了用陈旧数据兜底
```

### 为什么必须有服务端这一层

Yahoo 的 `query1` 接口**不返回 `Access-Control-Allow-Origin` 响应头**。
浏览器里的 `fetch()` 会被 CORS 直接拦掉，所以「前端直连 Yahoo」这条路根本走不通，
必须由服务端代取再同源下发。这也是盘镜不用纯静态部署的原因。

### 前端

- 原生 ES Module，**零运行时依赖、零构建步骤**
- Canvas 自绘 K 线引擎（蜡烛、成交量、指标叠加、副图、十字光标、缩放平移）
- 技术指标是纯函数（`public/js/core/indicators.js`），有单元测试

### 服务端

- Node 内置模块，无第三方依赖
- `/api/yf/*` 反向代理，路径白名单校验，固定上游域名（不构成 SSRF 面）
- `/api/health` 返回缓存命中、冷却次数等运行指标

---

## 数据来源与限制

所有行情数据来自 **Yahoo Finance** 公开查询接口。详细接口清单见 [docs/DATA-SOURCES.md](docs/DATA-SOURCES.md)。

**必须知道的几件事：**

1. **盘镜是社区项目，不是券商。** 行情可能延迟，也可能出错。
2. **不构成任何投资建议。**
3. Yahoo 的接口有频率限制。服务端已经做了限速和冷却，但如果你自己改小 `YF_MIN_GAP_MS`，可能会拿到 429。
4. 仓库里内置了一份真实行情快照（`public/js/data/snapshot.json`）。当行情服务不可用时（离线、被限流、直接打开静态文件），
   界面会自动降级到这份快照，并明确提示「离线快照」模式。刷新快照：`npm run snapshot`。

---

## 项目结构

```
marketlens/
├── server.js                 静态托管 + /api/yf 反代（零依赖）
├── scripts/
│   ├── refresh-snapshot.mjs  生成离线行情快照
│   └── check-syntax.mjs      语法自检
├── tests/                    指标计算单元测试
├── docs/
│   ├── DATA-SOURCES.md       Yahoo 接口清单与限流说明
│   └── DESIGN.md             设计语言与布局说明
└── public/
    ├── index.html
    ├── styles/               tokens / base / layout / components
    └── js/
        ├── main.js            入口、路由、自动刷新
        ├── config.js          市场、指数、板块、周期、指标定义
        ├── core/              api / store / format / indicators / dom
        ├── data/              feed / snapshot.json
        ├── ui/                chart / sparkline / palette / ticker / toast
        └── views/             overview / quote / watchlist / movers / monitor
```

---

## 开发

```bash
npm start          # 启动服务
npm test           # 单元测试（技术指标）
npm run lint       # 语法自检
npm run snapshot   # 重新生成离线行情快照
```

### 可调环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `PORT` | `4173` | 监听端口 |
| `HOST` | `127.0.0.1` | 监听地址 |
| `YF_MIN_GAP_MS` | `900` | 打往 Yahoo 的最小间隔，被 429 时调大 |
| `YF_MAX_CONCURRENT` | `2` | 并发上限 |
| `YF_MAX_RETRIES` | `4` | 失败重试次数 |
| `YF_COOLDOWN_MS` | `4000` | 收到 429 后的全局冷却基数 |
| `YF_TIMEOUT_MS` | `12000` | 上游超时 |

---

## 部署

因为需要服务端反代，纯静态托管（GitHub Pages）拿不到实时数据。可选方案：

- **Render / Railway / Fly.io**：直接部署本仓库，`npm start` 作为启动命令。
- **自有服务器**：Node 18+ 直接跑，或用 `Dockerfile`。
- **离线演示**：直接用 `public/` 下的静态文件，界面会自动使用内置快照。

---

## 许可

[MIT](LICENSE) © Celine Delrey

行情数据归 Yahoo Finance 所有。本项目与 Yahoo、Refinitiv、Bloomberg、S&P Global 无任何关联。

**免责声明：盘镜仅供研究与学习，不构成投资建议。**
