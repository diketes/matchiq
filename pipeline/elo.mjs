// Rankingi Elo liczone z historii wyników: piłka (wszystkie ligi, powiązane przez puchary europejskie)
// i tenis (ogólnie + osobno per nawierzchnia).
import { FOOTBALL_LEAGUES } from '../server/espn.mjs';

const TIER_INIT = { 1: 1500, 2: 1420, 3: 1350, 4: 1300 };
const isDomestic = (slug) => !/^(uefa|fifa|conmebol|club\.friendly)/.test(slug);

export function computeFootballElo(matches, { K = 20, home = 60, carry = 0.7 } = {}) {
  const tierOf = new Map(FOOTBALL_LEAGUES.map((l) => [l.slug, l.tier]));
  const teams = new Map();
  const byMatch = {};
  let currentSeason = null;

  const leagueMeans = () => {
    const acc = {};
    for (const t of teams.values()) {
      if (!t.league) continue;
      acc[t.league] = acc[t.league] || { s: 0, n: 0 };
      acc[t.league].s += t.elo; acc[t.league].n++;
    }
    return Object.fromEntries(Object.entries(acc).map(([k, v]) => [k, v.s / v.n]));
  };
  const regress = () => {
    const means = leagueMeans();
    for (const t of teams.values()) {
      const mean = (t.league && means[t.league]) || 1450;
      t.elo = mean + carry * (t.elo - mean);
    }
  };

  for (const m of matches) {
    if (m.season !== currentSeason) { if (currentSeason) regress(); currentSeason = m.season; }
    for (const [id, name] of [[m.homeId, m.homeName], [m.awayId, m.awayName]]) {
      if (!teams.has(id)) teams.set(id, { elo: TIER_INIT[tierOf.get(m.league) ?? 3] || 1400, name, league: isDomestic(m.league) ? m.league : null, n: 0, last: m.date });
      const t = teams.get(id);
      t.name = name || t.name;
      if (isDomestic(m.league)) t.league = m.league;
    }
    const th = teams.get(m.homeId), ta = teams.get(m.awayId);
    byMatch[m.id] = { h: Math.round(th.elo), a: Math.round(ta.elo) };
    const adv = m.neutral ? 0 : home;
    const dr = th.elo + adv - ta.elo;
    const eH = 1 / (1 + 10 ** (-dr / 400));
    const sH = m.hs > m.as ? 1 : m.hs < m.as ? 0 : 0.5;
    const gd = Math.abs(m.hs - m.as);
    const winnerDr = sH === 1 ? dr : sH === 0 ? -dr : 0;
    const mov = gd ? Math.log(gd + 1) * (2.2 / (winnerDr * 0.001 + 2.2)) : 1;
    const delta = K * mov * (sH - eH);
    th.elo += delta; ta.elo -= delta;
    th.n++; ta.n++; th.last = m.date; ta.last = m.date;
  }
  const out = {};
  for (const [id, t] of teams) out[id] = { elo: Math.round(t.elo), name: t.name, league: t.league, n: t.n, last: t.last.slice(0, 10) };
  return { teams: out, byMatch, leagueMean: Object.fromEntries(Object.entries(leagueMeans()).map(([k, v]) => [k, Math.round(v)])), params: { K, home, carry } };
}

const SURFACES = ['hard', 'clay', 'grass'];

export function computeTennisElo(matches, { K = 32, Ksurface = 40 } = {}) {
  const players = new Map();
  const byMatch = {};
  const get = (p, tour) => {
    if (!players.has(p.id)) players.set(p.id, { name: p.name, tour, all: 1500, hard: 1500, clay: 1500, grass: 1500, n: 0, nHard: 0, nClay: 0, nGrass: 0, last: '' });
    const x = players.get(p.id);
    x.name = p.name || x.name;
    return x;
  };
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  for (const m of matches) {
    const a = get(m.p1, m.tour), b = get(m.p2, m.tour);
    const surf = SURFACES.includes(m.surface) ? m.surface : 'hard';
    byMatch[m.id] = { p1: { all: Math.round(a.all), surf: Math.round(a[surf]) }, p2: { all: Math.round(b.all), surf: Math.round(b[surf]) }, surface: surf };
    const s1 = m.winner === 'p1' ? 1 : 0;
    // ogólny
    const e1 = 1 / (1 + 10 ** ((b.all - a.all) / 400));
    const k = m.retired ? K * 0.5 : K;
    a.all += k * (s1 - e1); b.all -= k * (s1 - e1);
    // nawierzchnia
    const es = 1 / (1 + 10 ** ((b[surf] - a[surf]) / 400));
    const ks = m.retired ? Ksurface * 0.5 : Ksurface;
    a[surf] += ks * (s1 - es); b[surf] -= ks * (s1 - es);
    a.n++; b.n++; a[`n${cap(surf)}`]++; b[`n${cap(surf)}`]++;
    a.last = m.date; b.last = m.date;
  }
  const out = {};
  for (const [id, p] of players) {
    if (p.n < 3) continue;
    out[id] = { name: p.name, tour: p.tour, all: Math.round(p.all), hard: Math.round(p.hard), clay: Math.round(p.clay), grass: Math.round(p.grass), n: p.n, nHard: p.nHard, nClay: p.nClay, nGrass: p.nGrass, last: p.last.slice(0, 10) };
  }
  return { players: out, byMatch, params: { K, Ksurface } };
}
