// Small UI pieces shared by the shell and the training editor: bottom sheet, toast, tooltip.
import { hover, clearHover } from './charts.js';

const $ = (s, el = document) => el.querySelector(s);

// ---------- bottom sheet ----------
let sheet = null;
export function openSheet(html, { cls = '', onClose } = {}) {
  closeSheet();
  const bg = document.createElement('div');
  bg.className = 'sheet-bg';
  const el = document.createElement('div');
  el.className = `sheet ${cls}`;
  el.setAttribute('role', 'dialog');
  el.innerHTML = `<div class="grab"></div>${html}`;
  bg.addEventListener('click', () => closeSheet());
  document.body.append(bg, el);
  document.body.classList.add('has-sheet');
  sheet = { bg, el, onClose };
  // drag the grab handle down to close
  let y0 = null;
  el.addEventListener('touchstart', (e) => { y0 = el.scrollTop <= 0 && e.target.closest('.grab, h3') ? e.touches[0].clientY : null; }, { passive: true });
  el.addEventListener('touchmove', (e) => { if (y0 != null) { const dy = Math.max(0, e.touches[0].clientY - y0); el.style.transform = `translateY(${dy}px)`; } }, { passive: true });
  el.addEventListener('touchend', (e) => {
    if (y0 == null) return;
    const dy = e.changedTouches[0].clientY - y0;
    y0 = null;
    if (dy > 90) closeSheet(); else el.style.transform = '';
  });
  return el;
}
export function closeSheet() {
  if (!sheet) return;
  const { bg, el, onClose } = sheet;
  sheet = null;
  bg.remove(); el.remove();
  document.body.classList.remove('has-sheet');
  hideTip();
  onClose?.();
}
export const sheetEl = () => sheet?.el || null;

// ---------- toast ----------
let toastTimer;
export function toast(msg, { action, onAction, ms = 3500 } = {}) {
  let el = $('#toast');
  if (!el) { el = document.createElement('div'); el.id = 'toast'; el.className = 'toast'; document.body.append(el); }
  el.innerHTML = `<span></span>${action ? '<button type="button"></button>' : ''}`;
  el.firstChild.textContent = msg;
  if (action) {
    const b = el.querySelector('button');
    b.textContent = action;
    b.onclick = () => { el.classList.remove('on'); onAction?.(); };
  }
  requestAnimationFrame(() => el.classList.add('on'));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('on'), ms);
}

// ---------- tooltip (tap a mark, or press and drag across a curve) ----------
let tip, tipTimer;
function showTip(html, x, y) {
  tip ||= $('#tip');
  if (!tip) return;
  tip.innerHTML = html;
  tip.hidden = false;
  const r = tip.getBoundingClientRect();
  tip.style.left = Math.max(8, Math.min(innerWidth - r.width - 8, x - r.width / 2)) + 'px';
  tip.style.top = (y - r.height - 16 < 8 ? y + 22 : y - r.height - 16) + 'px';
  clearTimeout(tipTimer);
  tipTimer = setTimeout(hideTip, 3500);
}
export function hideTip() { tip ||= $('#tip'); if (tip) tip.hidden = true; clearHover(); }

function pointer(ev) {
  const el = ev.target;
  if (!(el instanceof Element)) return false;
  const h = el.closest('[data-hover]');
  if (h) { const html = hover(h, ev.clientX); if (html) showTip(html, ev.clientX, ev.clientY); return true; }
  const t = el.closest('[data-tip]');
  if (t) { showTip(t.dataset.tip, ev.clientX, ev.clientY); return true; }
  return false;
}
export function initTips() {
  document.addEventListener('pointermove', (ev) => { if (ev.pointerType === 'mouse' || ev.buttons) pointer(ev); });
  document.addEventListener('pointerdown', (ev) => { if (!pointer(ev)) hideTip(); });
  addEventListener('scroll', () => { if (tip && !tip.hidden) hideTip(); }, { passive: true });
}
