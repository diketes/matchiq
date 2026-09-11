// Statystyki strzałów z zakończonych meczów (boxscore ESPN) -> własny wskaźnik xG.
// Pobierane dla lig 1. poziomu (2 sezony) i 2. poziomu (bieżący sezon); cache w gałęzi data.
import { SITE, FOOTBALL_LEAGUES, mapLimit } from '../server/espn.mjs';
import { getRaw, SEASONS, CURRENT_SEASON } from './history.mjs';
import { shrink, clamp } from './model.mjs';

const tierOf = new Map(FOOTBALL_LEAGUES.map((l) => [l.slug, l.tier]));
const FIRST_SEASON = SEASONS[0].key;

export function wantsStats(m) {
  const tier = tierOf.get(m.league) ?? 4;
  return tier === 1 || (tier === 2 && m.season !== FIRST_SEASON);
}

function pickStats(t) {
  if (!t) return null;
  const v = (n) => {
    const x = (t.statistics || []).find((s) => s.name === n);
    const num = Number(String(x?.displayValue ?? x?.value ?? '').replace(',', '.'));
    return Number.isFinite(num) ? num : null;
  };
  const sh = v('totalShots'), sot = v('shotsOnTarget');
  if (sh == null || sot == null || sh + sot === 0) return null;
  return { sh, sot, corners: v('wonCorners') ?? 0, poss: v('possessionPct') };
}

export async function fetchMatchStats(matches, cache = {}, { maxNew = 2500 } = {}) {
  const store = { ...(cache.stats || {}) };
  // najpierw najnowsze mecze (bieżący sezon do xG na żywo), potem starsze do backtestu
  const wanted = matches.filter((m) => wantsStats(m) && !(m.id in store)).sort((a, b) => b.date.localeCompare(a.date)).slice(0, maxNew);
  const results = await mapLimit(wanted, 6, async (m) => {
    const s = await getRaw(`${SITE}/soccer/${m.league}/summary?event=${m.id}`, 2);
    if (!s) return [m.id, null, false];
    const teams = s.boxscore?.teams || [];
    const h = pickStats(teams.find((t) => t.homeAway === 'home'));
    const a = pickStats(teams.find((t) => t.homeAway === 'away'));
    return [m.id, h && a ? { h, a } : null, true];
  });
  let fetched = 0, withStats = 0;
  for (const r of results) {
    if (!Array.isArray(r)) continue;
    const [id, v, ok] = r;
    if (!ok) continue;
    store[id] = v; fetched++;
    if (v) withStats++;
  }
  return { stats: store, fetched, withStats, wanted: wanted.length };
}

/** Dopasowanie gole ~ b1*celne + b2*niecelne + b3*rożne (bez wyrazu wolnego, najmniejsze kwadraty). */
export function fitXgModel(matches, stats) {
  const rows = [];
  for (const m of matches) {
    const s = stats[m.id];
    if (!s) continue;
    rows.push([[s.h.sot, s.h.sh - s.h.sot, s.h.corners], m.hs]);
    rows.push([[s.a.sot, s.a.sh - s.a.sot, s.a.corners], m.as]);
  }
  if (rows.length < 200) return { coef: { sot: 0.3, other: 0.04, corners: 0.01 }, n: rows.length, fitted: false };
  // równania normalne 3x3
  const XtX = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], Xty = [0, 0, 0];
  for (const [x, y] of rows) for (let i = 0; i < 3; i++) { Xty[i] += x[i] * y; for (let j = 0; j < 3; j++) XtX[i][j] += x[i] * x[j]; }
  const b = solve3(XtX, Xty) || [0.3, 0.04, 0.01];
  const coef = { sot: clamp(b[0], 0.05, 0.6), other: clamp(b[1], 0, 0.2), corners: clamp(b[2], -0.05, 0.1) };
  // jakość: korelacja xG vs gole
  let sxy = 0, sxx = 0, syy = 0, mx = 0, my = 0;
  for (const [x, y] of rows) { mx += xgOf({ sot: x[0], sh: x[0] + x[1], corners: x[2] }, coef); my += y; }
  mx /= rows.length; my /= rows.length;
  for (const [x, y] of rows) { const xg = xgOf({ sot: x[0], sh: x[0] + x[1], corners: x[2] }, coef); sxy += (xg - mx) * (y - my); sxx += (xg - mx) ** 2; syy += (y - my) ** 2; }
  return { coef, n: rows.length, fitted: true, corr: Math.round((sxy / Math.sqrt(sxx * syy)) * 1000) / 1000 };
}

function solve3(A, b) {
  const M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < 3; c++) {
    let piv = c;
    for (let r = c + 1; r < 3; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    if (Math.abs(M[piv][c]) < 1e-9) return null;
    [M[c], M[piv]] = [M[piv], M[c]];
    for (let r = 0; r < 3; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k < 4; k++) M[r][k] -= f * M[c][k];
    }
  }
  return [M[0][3] / M[0][0], M[1][3] / M[1][1], M[2][3] / M[2][2]];
}

export const xgOf = (row, coef) => coef.sot * row.sot + coef.other * Math.max(0, row.sh - row.sot) + coef.corners * (row.corners || 0);

/** Bieżące (sezon 2025-26) siły xG per drużyna do użycia na żywo. */
export function currentXgStrengths(matches, stats, coef, season = CURRENT_SEASON) {
  const team = new Map(); // id -> { gp, xgFor, xgAgainst, league }
  const league = new Map(); // slug -> { gp, xg }
  for (const m of matches) {
    if (m.season !== season) continue;
    const s = stats[m.id];
    if (!s) continue;
    const xh = xgOf(s.h, coef), xa = xgOf(s.a, coef);
    const bump = (id, f, a) => { const t = team.get(id) || { gp: 0, xgFor: 0, xgAgainst: 0, league: m.league }; t.gp++; t.xgFor += f; t.xgAgainst += a; team.set(id, t); };
    bump(m.homeId, xh, xa); bump(m.awayId, xa, xh);
    const l = league.get(m.league) || { gp: 0, xg: 0 };
    l.gp += 2; l.xg += xh + xa; league.set(m.league, l);
  }
  const out = {};
  for (const [id, t] of team) {
    if (t.gp < 3) continue;
    const l = league.get(t.league);
    const avg = l && l.gp >= 20 ? l.xg / l.gp : 1.35;
    out[id] = { gp: t.gp, xgFor: Math.round((t.xgFor / t.gp) * 100) / 100, xgAgainst: Math.round((t.xgAgainst / t.gp) * 100) / 100, att: Math.round(shrink((t.xgFor / t.gp) / avg, t.gp, 5) * 1000) / 1000, def: Math.round(shrink((t.xgAgainst / t.gp) / avg, t.gp, 5) * 1000) / 1000 };
  }
  return out;
}
