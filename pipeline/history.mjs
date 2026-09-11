// Historia wyników z ESPN (piłka: 2 sezony wszystkich lig; tenis: ostatnie ~13 miesięcy ATP/WTA).
// Wyniki są cache'owane (gałąź `data` w repo), więc codzienny bieg pobiera tylko bieżący sezon / ostatnie miesiące.
import { FOOTBALL_LEAGUES, SITE, moneylineToProbs, localDateKey, guessSurface, mapLimit } from '../server/espn.mjs';

const compact = (k) => k.replaceAll('-', '');
const todayKey = () => new Date().toISOString().slice(0, 10);
const r3 = (x) => Math.round(x * 1000) / 1000;

export const SEASONS = [
  { key: '2024-25', from: '2024-07-01', to: '2025-06-30' },
  { key: '2025-26', from: '2025-07-01', to: '2026-06-30' },
  { key: '2026-27', from: '2026-07-01', to: null }, // null = bieżący sezon, do dziś
];
export const CURRENT_SEASON = SEASONS.find((s) => !s.to).key;

export function seasonOf(dateKey) {
  for (const s of SEASONS) if (dateKey >= s.from && (!s.to || dateKey <= s.to)) return s.key;
  return dateKey.slice(0, 4);
}

export async function getRaw(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 MatchIQ/2.0 (data pipeline)' } });
      if (r.ok) return await r.json();
      if (r.status === 404 || r.status === 400) return null;
    } catch { /* ponów */ }
    await new Promise((res) => setTimeout(res, 800 * (i + 1)));
  }
  return null;
}

// ---------- piłka nożna ----------
function normalizeFootball(ev, slug, seasonKey) {
  const comp = ev.competitions?.[0];
  if (!comp) return null;
  const st = ev.status?.type || comp.status?.type || {};
  if (st.state !== 'post') return null;
  const name = st.name || '';
  if (/POSTPONED|CANCELED|ABANDONED|SUSPENDED/.test(name)) return null;
  const comps = comp.competitors || [];
  const home = comps.find((c) => c.homeAway === 'home') || comps[0];
  const away = comps.find((c) => c.homeAway === 'away') || comps[1];
  if (!home?.team?.id || !away?.team?.id) return null;
  const hs = Number(home.score), as = Number(away.score);
  if (!Number.isFinite(hs) || !Number.isFinite(as)) return null;
  let market = null;
  const odds = (comp.odds || []).find((o) => o && (o.homeTeamOdds || o.awayTeamOdds));
  if (odds) {
    const m = moneylineToProbs({ home: odds.homeTeamOdds?.moneyLine, away: odds.awayTeamOdds?.moneyLine, draw: odds.drawOdds?.moneyLine });
    if (m && m.draw != null) market = { home: r3(m.home), draw: r3(m.draw), away: r3(m.away) };
  }
  const out = {
    id: String(ev.id), league: slug, season: seasonKey, date: ev.date, dateKey: localDateKey(ev.date),
    homeId: String(home.team.id), awayId: String(away.team.id), homeName: home.team.displayName || home.team.name, awayName: away.team.displayName || away.team.name,
    hs, as,
  };
  if (market) out.market = market;
  if (comp.neutralSite) out.neutral = true;
  if (/SHOOTOUT|PEN/.test(name)) out.penalties = true;
  return out;
}

export async function fetchFootballHistory(cache = {}) {
  const byId = new Map(Object.entries(cache.football || {}));
  const done = new Set(cache.footballSeasonsDone || []);
  const tasks = [];
  for (const l of FOOTBALL_LEAGUES) {
    for (const s of SEASONS) {
      const key = `${l.slug}|${s.key}`;
      const current = !s.to;
      if (!current && done.has(key)) continue;
      tasks.push({ l, s, key, current });
    }
  }
  const results = await mapLimit(tasks, 6, async (t) => {
    const to = t.s.to || todayKey();
    const data = await getRaw(`${SITE}/soccer/${t.l.slug}/scoreboard?dates=${compact(t.s.from)}-${compact(to)}&limit=1000`);
    if (!data) return { key: t.key, ok: false };
    let n = 0;
    for (const ev of data.events || []) {
      const m = normalizeFootball(ev, t.l.slug, t.s.key);
      if (m) { byId.set(m.id, m); n++; }
    }
    return { key: t.key, ok: true, n, current: t.current, total: (data.events || []).length };
  });
  let fetched = 0, failed = 0;
  for (const r of results) {
    if (r && r.ok) { fetched++; if (!r.current) done.add(r.key); } else failed++;
  }
  const matches = [...byId.values()].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  const seasons = {};
  for (const m of matches) seasons[m.season] = (seasons[m.season] || 0) + 1;
  return { matches, seasons, cache: { football: Object.fromEntries(byId), footballSeasonsDone: [...done] }, fetched, failed, tasks: tasks.length };
}

// ---------- tenis ----------
function monthWindows(months) {
  const out = [];
  const now = new Date();
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const from = d.toISOString().slice(0, 10);
    const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
    const to = end.toISOString().slice(0, 10);
    out.push({ ym: from.slice(0, 7), from, to: to > todayKey() ? todayKey() : to, recent: i <= 1 });
  }
  return out;
}

function normalizeTennis(c, ev, groupName, tour, surface) {
  const st = c.status?.type || {};
  if (st.state !== 'post') return null;
  const comps = c.competitors || [];
  const p1 = comps.find((x) => x.homeAway === 'home') || comps[0];
  const p2 = comps.find((x) => x.homeAway === 'away') || comps[1];
  if (!p1?.id || !p2?.id || p1.roster || p2.roster) return null; // debel pomijamy
  const winner = p1.winner ? 'p1' : p2.winner ? 'p2' : null;
  if (!winner) return null;
  const note = c.notes?.[0]?.text || '';
  const detail = st.detail || '';
  const walkover = /w\/o|walkover/i.test(note) || /WALKOVER/i.test(st.name || '') || /w\/o/i.test(detail);
  if (walkover) return null;
  return {
    id: String(c.id), tour, date: c.date, event: ev.name, surface, round: c.round?.displayName || '',
    p1: { id: String(p1.id), name: p1.athlete?.displayName || p1.athlete?.shortName || '?' },
    p2: { id: String(p2.id), name: p2.athlete?.displayName || p2.athlete?.shortName || '?' },
    winner,
    retired: /ret\.|retired/i.test(note) || /RET/i.test(detail) || undefined,
  };
}

export async function fetchTennisHistory(cache = {}, months = 13) {
  const byId = new Map(Object.entries(cache.tennis || {}));
  const done = new Set(cache.tennisMonthsDone || []);
  const tasks = [];
  for (const tour of ['atp', 'wta']) {
    for (const w of monthWindows(months)) {
      const key = `${tour}|${w.ym}`;
      if (!w.recent && done.has(key)) continue;
      tasks.push({ tour, w, key });
    }
  }
  const results = await mapLimit(tasks, 3, async (t) => {
    const data = await getRaw(`${SITE}/tennis/${t.tour}/scoreboard?dates=${compact(t.w.from)}-${compact(t.w.to)}&limit=1000`);
    if (!data) return { key: t.key, ok: false };
    let n = 0;
    for (const ev of data.events || []) {
      const surface = guessSurface(ev.name, ev.date);
      for (const g of ev.groupings || []) {
        const gname = g.grouping?.displayName || '';
        if (/doubles/i.test(gname)) continue;
        const realTour = /women/i.test(gname) ? 'wta' : /men/i.test(gname) ? 'atp' : t.tour;
        for (const c of g.competitions || []) {
          const m = normalizeTennis(c, ev, gname, realTour, surface);
          if (m) { byId.set(m.id, m); n++; }
        }
      }
    }
    return { key: t.key, ok: true, n, recent: t.w.recent };
  });
  let fetched = 0, failed = 0;
  for (const r of results) {
    if (r && r.ok) { fetched++; if (!r.recent) done.add(r.key); } else failed++;
  }
  // przytnij cache do ~14 miesięcy
  const cutoff = new Date(Date.now() - 425 * 86400_000).toISOString();
  for (const [id, m] of byId) if (m.date < cutoff) byId.delete(id);
  const matches = [...byId.values()].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  return { matches, cache: { tennis: Object.fromEntries(byId), tennisMonthsDone: [...done] }, fetched, failed, tasks: tasks.length };
}
