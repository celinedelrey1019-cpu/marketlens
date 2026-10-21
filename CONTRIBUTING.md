# 贡献指南

欢迎参与盘镜。门槛尽量低：不用先读完所有代码，选一个小问题动手就行。

---

## 环境

```bash
git clone https://github.com/celinedelrey1019-cpu/marketlens.git
cd marketlens
npm start        # → http://127.0.0.1:4173
```

**本项目零运行时依赖**，不需要 `npm install`。只有跑测试和 CI 时才用到 Node 内置的 `node:test`。

| Node 版本 | 支持 |
|---|---|
| ≥ 18.17 | ✅ |
| 22 LTS | ✅ 推荐 |
| < 18 | ❌（`AbortSignal.timeout` 等特性缺失） |

---

## 提交前必跑

```bash
npm run lint   # 语法自检
npm test       # 技术指标单元测试
```

CI 会自动跑这两项，外加一个「启动服务 + 请求 /api/health」的冒烟测试。

---

## 代码约定

- **不要引入运行时依赖。** 盘镜零依赖是有意为之：装完就能跑。写图表、格式化、路由都用原生实现。
- **前端是原生 ES Module**，没有打包步骤。`public/js/` 下的文件之间用相对路径 `import`。
- **技术指标写成纯函数**放在 `public/js/core/indicators.js`，不碰 DOM，这样能直接跑单元测试。
- **外部数据进模板前必须 `esc()` 转义。** 所有来自 Yahoo 的字段都是不可信输入。
- **中文优先。** 界面文案、注释、文档都用中文；变量名和 API 字段名保持英文。
- **颜色只引用 `var(--up)` / `var(--down)` / `var(--amber)`**，不要写死具体色值，
  这样深浅主题和红涨绿跌切换才能生效。

---

## 数据层的规矩

新增一个 Yahoo 接口时，请同时做三件事：

1. 在 `server.js` 的 `ALLOWED_PATH` 里确认路径能通过白名单（注意代码里的 `^` `=` `.` 会被 URL 编码，
   校验前记得 `decodeURIComponent`）。
2. 在 `TTL_RULES` 里给它一个合适的缓存时长。
3. 考虑上游限流：接口返回结构不一致时，用 `Promise.allSettled` 让单个接口失败不影响整页。

接口细节见 [docs/DATA-SOURCES.md](docs/DATA-SOURCES.md)。

---

## 提 PR 前

- 一个 PR 只做一件事。
- 改了界面请附截图。
- 改了指标计算请补单元测试。
- 描述里写清楚「为什么」，不只是「改了什么」。

---

## 需要知道的限制

盘镜拿的是 Yahoo 的公开接口，有两个硬约束：

1. **CORS**：Yahoo 不发 `Access-Control-Allow-Origin`，所以前端不能直连，必须走 `/api/yf/*` 反代。
   新增数据请求时不要绕过反代。
2. **限流**：Yahoo 按 IP 限流且会持续一段时间。新增接口调用请复用 `yfGet()`，不要自己 `fetch` 上游。

如果遇到 429，先把 `YF_MIN_GAP_MS` 调大，别去改重试逻辑。

---

## 认领任务

打开 [Issues](https://github.com/celinedelrey1019-cpu/marketlens/issues)，认领前先留言，避免重复劳动。

---

**免责声明：盘镜仅供研究与学习，不构成投资建议。**
