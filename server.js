#!/usr/bin/env node
/**
 * 盘镜 MarketLens — 本地服务器
 *
 * 职责：
 *   1. 托管 public/ 下的静态前端（零构建、零依赖）。
 *   2. 把 /api/yf/* 反向代理到 Yahoo Finance 查询接口。
 *
 * 为什么必须有这一层代理：
 *   Yahoo 的 query1 接口不返回 Access-Control-Allow-Origin 响应头，
 *   浏览器里的 fetch() 会被 CORS 直接拦截。所以「前端直连 Yahoo」这条路走不通，
 *   必须由服务端代取再同源下发。
 *
 * 反代的三条工程约束：
 *   - 限速：Yahoo 对突发请求返回 429，这里用最小间隔串行化出口。
 *   - 重试：429 / 5xx 走指数退避，最多 3 次。
 *   - 缓存：内存 TTL + 磁盘落盘。上游挂掉时用陈旧缓存兜底，保证界面不空。
 *
 * 用法：
 *   node server.js                 # 默认 http://127.0.0.1:4173
 *   PORT=8080 node server.js       # 换端口
 *   YF_MIN_GAP_MS=1200 node server.js   # 更保守地请求 Yahoo
 */

import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || '127.0.0.1';
const PUBLIC_DIR = path.join(__dirname, 'public');
const CACHE_DIR = path.join(__dirname, '.cache');
const UPSTREAM_HOST = 'query1.finance.yahoo.com';
const UPSTREAM_BASE = `https://${UPSTREAM_HOST}/`;

/**
 * 出口最小间隔（毫秒）。
 * 实测：1.5 秒间隔连续 8 个请求全部成功；请求重叠（并发 > 1）则很快触发 429。
 * 所以默认完全串行，宁可慢也不要被限流。
 */
const MIN_GAP_MS = Number(process.env.YF_MIN_GAP_MS || 1400);
/** 同时在途的请求上限。Yahoo 对「在途」比「发起速率」更敏感，默认 1。 */
const MAX_CONCURRENT = Number(process.env.YF_MAX_CONCURRENT || 1);
/** 失败重试次数。 */
const MAX_RETRIES = Number(process.env.YF_MAX_RETRIES || 4);
/** 收到 429 后的全局冷却基数（毫秒），按重试次数递增。 */
const COOLDOWN_MS = Number(process.env.YF_COOLDOWN_MS || 4000);
/** 上游超时（毫秒）。 */
const UPSTREAM_TIMEOUT_MS = Number(process.env.YF_TIMEOUT_MS || 12000);

// 只放行 Yahoo 查询接口的固定前缀。代码里会出现的字符：字母数字、. ^ = - _ /
// （例如 ^GSPC、399001.SZ、EURUSD=X、GC=F、BTC-USD）
const ALLOWED_PATH =
  /^(v8|v7|v10|v1|v6)\/finance\/[A-Za-z0-9._^=\-/]+$|^ws\/fundamentals-timeseries\/[A-Za-z0-9._^=\-/]+$/;

/** 不同接口的缓存时长（毫秒）。行情要新，财务可以久一点。 */
const TTL_RULES = [
  [/^\/v8\/finance\/spark/, 15_000],
  [/^\/v8\/finance\/chart/, 60_000],
  [/^\/v1\/finance\/screener/, 120_000],
  [/^\/v1\/finance\/search/, 120_000],
  [/^\/v1\/finance\/trending/, 300_000],
  [/^\/v1\/finance\/quote/, 20_000],
  [/^\/ws\/fundamentals-timeseries/, 3_600_000],
];
const DEFAULT_TTL = 60_000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function ttlFor(pathname) {
  for (const [pattern, ttl] of TTL_RULES) if (pattern.test(pathname)) return ttl;
  return DEFAULT_TTL;
}

/* ------------------------------------------------------------------ *
 * 出口调度：限制并发 + 控制最小间隔 + 429 全局冷却
 *
 * Yahoo 的限流是按 IP 计的，而且触发之后会持续一段时间。
 * 所以这里除了「最小间隔」之外，还要在收到 429 时给整个出口设一段冷却期，
 * 让排队中的请求一起等，而不是各自去撞墙。
 * ------------------------------------------------------------------ */
const queue = [];
let inflight = 0;
let lastStart = 0;
let pumpScheduled = false;
let cooldownUntil = 0;

function schedule(task) {
  return new Promise((resolve, reject) => {
    queue.push({ task, resolve, reject });
    pump();
  });
}

function pump() {
  if (inflight >= MAX_CONCURRENT || queue.length === 0) return;
  // 同一时刻只允许一个待触发的定时器，否则会多次 shift 出队导致空指针。
  if (pumpScheduled) return;
  pumpScheduled = true;

  const gapWait = Math.max(0, MIN_GAP_MS - (Date.now() - lastStart));
  const cooldownWait = Math.max(0, cooldownUntil - Date.now());
  const wait = Math.max(gapWait, cooldownWait);

  setTimeout(() => {
    pumpScheduled = false;
    if (inflight >= MAX_CONCURRENT || queue.length === 0) return;
    const item = queue.shift();
    if (!item) return;
    inflight += 1;
    lastStart = Date.now();
    // 再调度一次，让并发槽位在 MIN_GAP_MS 的间隔后依次启动。
    pump();
    Promise.resolve()
      .then(item.task)
      .then(item.resolve, item.reject)
      .finally(() => {
        inflight -= 1;
        pump();
      });
  }, wait);
}

/* ------------------------------------------------------------------ *
 * 缓存：内存 TTL + 磁盘落盘
 * ------------------------------------------------------------------ */
const memCache = new Map();

const cacheKey = (pathname, search) => `${pathname}${search || ''}`;
const diskKey = (key) => crypto.createHash('sha1').update(key).digest('hex');

async function readDisk(key) {
  try {
    const raw = await fsp.readFile(path.join(CACHE_DIR, `${diskKey(key)}.json`), 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed.body === 'string' ? parsed : null;
  } catch {
    return null;
  }
}

async function writeDisk(key, entry) {
  try {
    await fsp.mkdir(CACHE_DIR, { recursive: true });
    await fsp.writeFile(
      path.join(CACHE_DIR, `${diskKey(key)}.json`),
      JSON.stringify(entry),
      'utf8',
    );
  } catch {
    /* 磁盘缓存写失败不影响主流程 */
  }
}

function memGet(key) {
  const hit = memCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.ts > hit.ttl) {
    memCache.delete(key);
    return null;
  }
  return hit;
}

/* ------------------------------------------------------------------ *
 * 上游请求
 * ------------------------------------------------------------------ */
function fetchUpstream(pathname, search) {
  const target = new URL(pathname + (search || ''), UPSTREAM_BASE);
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        host: UPSTREAM_HOST,
        path: target.pathname + target.search,
        method: 'GET',
        headers: {
          // 不伪装浏览器 UA —— Yahoo 对改写过的指纹反而更容易触发风控。
          Accept: 'application/json,text/plain,*/*',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        },
        timeout: UPSTREAM_TIMEOUT_MS,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');
          resolve({ status: res.statusCode || 502, body, headers: res.headers });
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error('上游超时')));
    req.on('error', reject);
    req.end();
  });
}

async function fetchWithRetry(pathname, search) {
  let lastError = null;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      const res = await schedule(() => fetchUpstream(pathname, search));
      if (res.status === 200) return res;
      // 429 / 5xx 值得重试；其它状态码直接放弃。
      if (res.status === 429 || res.status >= 500) {
        lastError = new Error(`上游返回 ${res.status}`);
        if (res.status === 429) {
          // 给整个出口设冷却，避免排队请求一起撞墙。
          cooldownUntil = Math.max(cooldownUntil, Date.now() + COOLDOWN_MS * attempt);
          stats.cooldowns += 1;
        }
        await sleep(900 * 2 ** (attempt - 1));
        continue;
      }
      return res;
    } catch (err) {
      lastError = err;
      await sleep(700 * attempt);
    }
  }
  throw lastError || new Error('上游请求失败');
}

/* ------------------------------------------------------------------ *
 * HTTP 辅助
 * ------------------------------------------------------------------ */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

function sendJson(res, status, payload, extraHeaders = {}) {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...extraHeaders,
  });
  res.end(body);
}

async function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/' || rel === '') rel = '/index.html';

  const target = path.join(PUBLIC_DIR, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  if (!target.startsWith(PUBLIC_DIR)) {
    sendJson(res, 403, { error: '非法路径' });
    return;
  }

  let stat;
  try {
    stat = await fsp.stat(target);
  } catch {
    sendJson(res, 404, { error: '未找到', path: rel });
    return;
  }
  if (stat.isDirectory()) {
    res.writeHead(302, { Location: `${rel.replace(/\/$/, '')}/index.html` });
    res.end();
    return;
  }

  const ext = path.extname(target).toLowerCase();
  const isHtml = ext === '.html';
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Content-Length': stat.size,
    'Cache-Control': isHtml ? 'no-cache' : 'public, max-age=300',
  });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  fs.createReadStream(target).pipe(res);
}

/* ------------------------------------------------------------------ *
 * 反代入口
 * ------------------------------------------------------------------ */
const stats = { requests: 0, hits: 0, misses: 0, stale: 0, errors: 0, upstreamMs: 0, cooldowns: 0 };

async function handleProxy(req, res, url) {
  stats.requests += 1;

  let pathname = url.pathname.replace(/^\/api\/yf/, '');
  if (pathname.startsWith('/')) pathname = pathname.slice(1);
  // 代码里的 ^ = . 等字符会被 URL 编码，先还原再校验白名单。
  try {
    pathname = decodeURIComponent(pathname);
  } catch {
    sendJson(res, 400, { error: '路径编码非法', pathname });
    return;
  }
  if (!pathname || !ALLOWED_PATH.test(pathname)) {
    sendJson(res, 400, { error: '接口路径不在白名单内', pathname });
    return;
  }

  const key = cacheKey(pathname, url.search);
  const hit = memGet(key);
  if (hit) {
    stats.hits += 1;
    sendJson(res, 200, hit.body, { 'X-Cache': 'HIT', 'X-Cache-Age': String(Date.now() - hit.ts) });
    return;
  }

  const t0 = Date.now();
  try {
    const upstream = await fetchWithRetry(pathname, url.search);
    stats.upstreamMs += Date.now() - t0;
    if (upstream.status !== 200) {
      stats.errors += 1;
      const stale = await readDisk(key);
      if (stale) {
        stats.stale += 1;
        sendJson(res, 200, stale.body, { 'X-Cache': 'STALE', 'X-Upstream-Status': String(upstream.status) });
        return;
      }
      // 原样透传上游状态码：404 表示代码不存在，跟「服务端故障」区分开。
      sendJson(res, upstream.status, {
        error: `上游返回 ${upstream.status}`,
        pathname,
        detail: upstream.body.slice(0, 240),
      });
      return;
    }

    stats.misses += 1;
    const ttl = ttlFor(`/${pathname}`);
    memCache.set(key, { ts: Date.now(), ttl, body: upstream.body });
    await writeDisk(key, { ts: Date.now(), ttl, body: upstream.body });
    sendJson(res, 200, upstream.body, { 'X-Cache': 'MISS', 'X-Upstream-Ms': String(Date.now() - t0) });
  } catch (err) {
    stats.errors += 1;
    const stale = await readDisk(key);
    if (stale) {
      stats.stale += 1;
      // 注意：HTTP 头只能是 ASCII，错误详情放响应体里。
      sendJson(res, 200, stale.body, { 'X-Cache': 'STALE' });
      return;
    }
    sendJson(res, 502, { error: '无法获取行情数据', detail: err.message, pathname });
  }
}

/* ------------------------------------------------------------------ *
 * 服务器
 * ------------------------------------------------------------------ */
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendJson(res, 405, { error: '仅支持 GET' });
    return;
  }

  if (url.pathname === '/api/health') {
    sendJson(res, 200, {
      ok: true,
      mode: 'proxy',
      upstream: UPSTREAM_HOST,
      cacheEntries: memCache.size,
      stats,
      uptimeSeconds: Math.round(process.uptime()),
    });
    return;
  }

  if (url.pathname.startsWith('/api/yf')) {
    await handleProxy(req, res, url);
    return;
  }

  await serveStatic(req, res, url);
});

server.listen(PORT, HOST, () => {
  console.log('');
  console.log('  盘镜 MarketLens 已启动');
  console.log(`  → http://${HOST}:${PORT}`);
  console.log(`  行情来源: ${UPSTREAM_HOST} (经 /api/yf 反代)`);
  console.log('');
});

// 单个请求出错不应该拖垮整个服务
process.on('unhandledRejection', (err) => {
  console.error('[marketlens] 未处理的 Promise 拒绝：', err && err.message ? err.message : err);
});
process.on('uncaughtException', (err) => {
  console.error('[marketlens] 未捕获异常：', err && err.message ? err.message : err);
});
