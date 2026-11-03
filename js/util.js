// Small shared helpers: dates, formatting, statistics, HTML escaping.

export const DAY = 864e5;

export const pad2 = (n) => String(n).padStart(2, '0');
export const ymd = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
export const parseYmd = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
export const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
export const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
export const today = () => startOfDay(new Date());
export const daysAgo = (n) => addDays(today(), -n);
export const dayDiff = (a, b) => Math.round((startOfDay(a) - startOfDay(b)) / DAY);
export const dateObj = (d) => ({ year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() });
export const fromDateObj = (o) => `${o.year}-${pad2(o.month)}-${pad2(o.day)}`;
export const secs = (s) => (s == null ? 0 : parseFloat(String(s).replace('s', '')) || 0);
export const WEEK = '日一二三四五六';
export const wk = (d) => WEEK[d.getDay()];
// Monday-based weekday index: 0 = Monday … 6 = Sunday
export const wd = (d) => (d.getDay() + 6) % 7;
export const isWeekend = (d) => d.getDay() === 0 || d.getDay() === 6;

export const hm = (d) => `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
export const md = (d) => `${d.getMonth() + 1}月${d.getDate()}日`;
export const mdShort = (d) => `${d.getMonth() + 1}/${d.getDate()}`;
// minutes since local midnight, for clock positions
export const minOfDay = (d) => d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
// clock minutes shifted so that the evening sorts before the morning (18:00 → -360, 06:00 → 360)
export const nightMin = (d) => { const m = minOfDay(d); return m >= 12 * 60 ? m - 1440 : m; };
export const clockLabel = (m) => { m = Math.round(((m % 1440) + 1440) % 1440); return `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`; };

// One way to write a duration everywhere: 452 → "7 小时 32 分钟", 480 → "8 小时", 50 → "50 分钟"
export const hmDur = (min) => {
  min = Math.round(Math.abs(min || 0));
  const h = Math.floor(min / 60), m = min % 60;
  return h ? (m ? `${h} 小时 ${m} 分钟` : `${h} 小时`) : `${m} 分钟`;
};
// the evening a night started on: the night that ends on 11月2日 is "11月1日晚"
export const eveOf = (date) => addDays(parseYmd(date), -1);
export const nightName = (date) => { const e = eveOf(date); return `${md(e)} 周${wk(e)}晚上`; };
export const minLabel = (min) => `${Math.round(min)} 分钟`;
export const fmtInt = (n) => (n == null ? '–' : Math.round(n).toLocaleString('en-US'));
export const fmt1 = (n) => (n == null ? '–' : (Math.round(n * 10) / 10).toFixed(1));
export const signed = (n, digits = 1) => { const v = Math.round(n * 10 ** digits) / 10 ** digits; return (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(digits); };
export const kg = (n) => `${+(Math.round(n * 4) / 4).toFixed(2)}`;

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const sum = (xs) => xs.reduce((a, x) => a + (x || 0), 0);
export const mean = (xs) => { const v = xs.filter((x) => x != null && !Number.isNaN(x)); return v.length ? sum(v) / v.length : null; };
export const sd = (xs) => {
  const v = xs.filter((x) => x != null && !Number.isNaN(x));
  if (v.length < 2) return null;
  const m = sum(v) / v.length;
  return Math.sqrt(sum(v.map((x) => (x - m) ** 2)) / (v.length - 1));
};
export const median = (xs) => {
  const v = xs.filter((x) => x != null).sort((a, b) => a - b);
  if (!v.length) return null;
  const i = (v.length - 1) / 2;
  return (v[Math.floor(i)] + v[Math.ceil(i)]) / 2;
};

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

// Run async jobs with at most n in flight (the API allows ~5 requests/second per user).
export function limiter(n) {
  let active = 0;
  const queue = [];
  const next = () => {
    if (active >= n || !queue.length) return;
    active++;
    const { fn, res, rej } = queue.shift();
    fn().then(res, rej).finally(() => { active--; next(); });
  };
  return (fn) => new Promise((res, rej) => { queue.push({ fn, res, rej }); next(); });
}

// Rolling 7-day mean over a date-sorted series [{date, v}] (date = 'YYYY-MM-DD').
export function rolling(series, days = 7) {
  const out = [];
  for (let i = 0; i < series.length; i++) {
    const t = parseYmd(series[i].date);
    const win = series.filter((p) => { const d = dayDiff(t, parseYmd(p.date)); return d >= 0 && d < days && p.v != null; });
    out.push({ date: series[i].date, v: win.length ? mean(win.map((p) => p.v)) : null });
  }
  return out;
}

// Personal normal range for one day: mean ± 1.5 SD of the 30 days before it (at least `minN` values).
// At 1.5 SD a value lands outside on the worse side about once in 15 days, so a mark means something.
export function baselineAt(byDate, date, { window = 30, minN = 7, minHalf = 0, k = 1.5 } = {}) {
  const t = parseYmd(date);
  const vals = [];
  for (let i = 1; i <= window; i++) { const v = byDate[ymd(addDays(t, -i))]; if (v != null) vals.push(v); }
  if (vals.length < minN) return null;
  const m = mean(vals), s = sd(vals) || 0;
  const half = k * Math.max(s, minHalf);
  return { mean: m, sd: s, lo: m - half, hi: m + half, n: vals.length };
}

// p-th percentile (0–1) of a list, for "多数晚上 22:55–00:10"
export const quantile = (xs, p) => {
  const v = xs.filter((x) => x != null).sort((a, b) => a - b);
  if (!v.length) return null;
  const i = (v.length - 1) * p, a = Math.floor(i), b = Math.ceil(i);
  return v[a] + (v[b] - v[a]) * (i - a);
};
