// „Moje prognozy”: zapis analiz przedmeczowych, które użytkownik otworzył, i ich rozliczenie po meczach.
// Zapis przez adapter (plik na serwerze / localStorage w aplikacji).
import { fetchFootballWindow, localDateKey } from './espn.mjs';

let persist = { read: () => null, write: () => {} };
let state = null;
let lastSettle = 0;

export function configureTrackerStorage(adapter) {
  persist = { ...persist, ...adapter };
  state = null;
}

function load() {
  if (state) return state;
  try {
    const raw = persist.read();
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!parsed || !Array.isArray(parsed.items)) throw new Error('empty');
    state = parsed;
  } catch {
    state = { version: 1, items: [] };
  }
  return state;
}

function save() {
  try { persist.write(JSON.stringify(state)); } catch (e) { console.error('[tracker] zapis nieudany:', e.message); }
}

const argmax = (o) => Object.keys(o).reduce((b, k) => (o[k] > o[b] ? k : b), Object.keys(o)[0]);

export function recordPrediction(p) {
  if (!p || !p.matchId || !p.probs || p.probs.home == null) { const e = new Error('Niepełna prognoza'); e.status = 400; throw e; }
  const st = load();
  if (st.items.some((x) => x.matchId === String(p.matchId))) return { ok: true, duplicate: true };
  st.items.push({
    matchId: String(p.matchId), leagueId: p.leagueId, leagueName: p.leagueName, date: p.date,
    home: p.home, away: p.away, homeLogo: p.homeLogo, awayLogo: p.awayLogo,
    probs: { home: +p.probs.home, draw: +p.probs.draw, away: +p.probs.away },
    fav: p.fav || argmax(p.probs), confidence: p.confidence ?? null,
    market: p.market ? { home: +p.market.home, draw: +p.market.draw, away: +p.market.away } : null,
    why: p.why || '', recordedAt: new Date().toISOString(),
  });
  if (st.items.length > 400) st.items.splice(0, st.items.length - 400);
  save();
  return { ok: true };
}

export async function settleTracker(force = false) {
  if (!force && Date.now() - lastSettle < 2 * 60_000) return 0;
  lastSettle = Date.now();
  const st = load();
  const now = Date.now();
  const open = st.items.filter((x) => !x.result && !x.void && new Date(x.date).getTime() < now - 100 * 60_000);
  if (!open.length) return 0;
  const days = new Set(open.map((x) => localDateKey(x.date)));
  const byId = new Map();
  for (const d of days) {
    try { const { events } = await fetchFootballWindow(d); for (const e of events) byId.set(e.id, e); } catch { /* następnym razem */ }
  }
  let n = 0;
  for (const x of open) {
    const e = byId.get(x.matchId);
    if (e && e.state === 'post') {
      if (/Przełożony|Odwołany|Przerwany/.test(e.statusText)) x.void = true;
      else {
        const h = Number(e.home.score ?? 0), a = Number(e.away.score ?? 0);
        x.result = h > a ? 'home' : h < a ? 'away' : 'draw';
        x.score = `${h}:${a}`;
        x.hit = x.fav === x.result;
      }
      n++;
    } else if (now - new Date(x.date).getTime() > 6 * 86400_000) {
      x.void = true; n++;
    }
  }
  if (n) save();
  return n;
}

export function trackerStats() {
  const st = load();
  const items = [...st.items].sort((a, b) => b.date.localeCompare(a.date));
  const done = items.filter((x) => x.result && !x.void);
  let hit = 0, brier = 0, mN = 0, mHit = 0, disagreeN = 0, disagreeHit = 0, disagreeMarketHit = 0;
  for (const x of done) {
    if (x.hit) hit++;
    brier += (x.probs.home - (x.result === 'home' ? 1 : 0)) ** 2 + (x.probs.draw - (x.result === 'draw' ? 1 : 0)) ** 2 + (x.probs.away - (x.result === 'away' ? 1 : 0)) ** 2;
    if (x.market) {
      mN++;
      const mf = argmax(x.market);
      if (mf === x.result) mHit++;
      if (mf !== x.fav) { disagreeN++; if (x.hit) disagreeHit++; if (mf === x.result) disagreeMarketHit++; }
    }
  }
  const r3 = (v) => Math.round(v * 1000) / 1000;
  return {
    n: done.length,
    pending: items.filter((x) => !x.result && !x.void).length,
    accuracy: done.length ? r3(hit / done.length) : 0,
    brier: done.length ? r3(brier / done.length) : 0,
    marketN: mN,
    marketAccuracy: mN ? r3(mHit / mN) : 0,
    disagree: { n: disagreeN, modelAccuracy: disagreeN ? r3(disagreeHit / disagreeN) : 0, marketAccuracy: disagreeN ? r3(disagreeMarketHit / disagreeN) : 0 },
    items: items.slice(0, 120),
  };
}

export function clearTracker() {
  state = { version: 1, items: [] };
  save();
  return trackerStats();
}
