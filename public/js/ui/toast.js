/**
 * 盘镜 MarketLens — 轻提示
 */

import { esc } from '../core/dom.js';

const host = () => document.getElementById('toasts');

export function toast(title, body = '', kind = '') {
  const container = host();
  if (!container) return;

  const node = document.createElement('div');
  node.className = `toast ${kind}`.trim();
  node.innerHTML = `<div class="t-title">${esc(title)}</div>${body ? `<div class="t-body">${esc(body)}</div>` : ''}`;
  container.appendChild(node);

  const remove = () => {
    node.classList.add('leaving');
    setTimeout(() => node.remove(), 220);
  };
  setTimeout(remove, 4200);
  node.addEventListener('click', remove);
}

/** 系统通知（用于价格提醒；未授权时静默降级为页面内提示） */
export function notify(title, body) {
  try {
    if (!('Notification' in window)) return false;
    if (Notification.permission === 'granted') {
      new Notification(title, { body });
      return true;
    }
    if (Notification.permission === 'default') {
      Notification.requestPermission().then((perm) => {
        if (perm === 'granted') new Notification(title, { body });
      });
    }
  } catch {
    /* 忽略 */
  }
  return false;
}
