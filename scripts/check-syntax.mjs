#!/usr/bin/env node
/**
 * 盘镜 MarketLens — 语法自检
 * 逐个解析仓库里的 JS 文件，确保没有语法错误（不依赖任何第三方 linter）。
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const TARGETS = ['server.js', 'scripts', 'public/js', 'tests'];

async function walk(dir, out = []) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(full, out);
    else if (entry.name.endsWith('.js') || entry.name.endsWith('.mjs')) out.push(full);
  }
  return out;
}

const files = [];
for (const target of TARGETS) {
  const full = path.join(ROOT, target);
  const stat = await fs.stat(full).catch(() => null);
  if (!stat) continue;
  if (stat.isDirectory()) await walk(full, files);
  else files.push(full);
}

let failed = 0;
for (const file of files) {
  try {
    // package.json 里 type: module，node --check 会按 ES Module 解析。
    await run(process.execPath, ['--check', file]);
  } catch (err) {
    failed += 1;
    const detail = (err.stderr || err.message || '').split('\n').slice(0, 4).join(' ').trim();
    console.error(`✗ ${path.relative(ROOT, file)}: ${detail}`);
  }
}

if (failed) {
  console.error(`\n${failed} 个文件有语法错误。`);
  process.exit(1);
}
console.log(`✓ ${files.length} 个文件语法检查通过`);
