export const tabs = (on) => `<nav class="tabs">${['今天', '睡眠', '运动', '心率'].map((t) => `<span class="${t === on ? 'on' : ''}"><b></b>${t}</span>`).join('')}</nav>`;
const q = new URLSearchParams(location.search);
if (q.get('theme') === 'dark') document.documentElement.dataset.theme = 'dark';
export const Q = q;
