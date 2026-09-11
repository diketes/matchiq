// Rdzeń modelu piłkarskiego: siła drużyn -> oczekiwane gole -> Poisson z korektą Dixona-Colesa.
// Używany przez backtesting (pipeline) i przez analizę na żywo (server/football.mjs), więc te same wagi
// obowiązują w aplikacji, w backteście i w trackerze skuteczności. Bez zależności od Node – działa też w aplikacji mobilnej.

export const DEFAULT_PARAMS = {
  homeAtt: 1.1,        // typowy gospodarz strzela x więcej
  awayAtt: 0.92,       // typowy gość strzela x mniej
  formWeight: 0.25,    // wpływ formy z 5 ostatnich meczów
  recencyWeight: 0.35, // udział ostatnich 5 meczów w sile ataku/obrony (reszta = sezon)
  shrinkK: 5,          // regularyzacja przy małej liczbie meczów
  rho: -0.08,          // Dixon-Coles (remisy 0:0, 1:1)
  eloWeight: 0.6,      // wpływ różnicy Elo (na 400 pkt)
  venueWeight: 1,      // wpływ bilansu konkretnej drużyny u siebie / na wyjeździe
  restWeight: 1,       // wpływ zmęczenia (dni przerwy, natłok)
  h2hWeight: 0.06,     // bezpośrednie mecze
  xgWeight: 0.35,      // udział xG (ze strzałów) w sile ataku/obrony
  stakesWeight: 0.03,  // stawka meczu (końcówka sezonu)
  absenceWeight: 0.04, // każdy brakujący zawodnik z podstawowego składu
  newsWeight: 1,       // sygnały z sieci (kontuzje, zawieszenia)
};

export const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
export const shrink = (x, n, k = 5) => (x * n + 1 * k) / (n + k);
export const argmax = (o) => Object.keys(o).reduce((b, k) => (o[k] > o[b] ? k : b), Object.keys(o)[0]);

// ---------- rozkłady ----------
export function poissonPmf(lambda, k) {
  let p = Math.exp(-lambda);
  for (let i = 1; i <= k; i++) p *= lambda / i;
  return p;
}

export function scoreMatrix(lh, la, max = 8) {
  const M = [];
  let sum = 0;
  const ph = [], pa = [];
  for (let i = 0; i <= max; i++) { ph[i] = poissonPmf(lh, i); pa[i] = poissonPmf(la, i); }
  for (let i = 0; i <= max; i++) {
    M[i] = [];
    for (let j = 0; j <= max; j++) { M[i][j] = ph[i] * pa[j]; sum += M[i][j]; }
  }
  for (let i = 0; i <= max; i++) for (let j = 0; j <= max; j++) M[i][j] /= sum;
  return M;
}

/** Korekta Dixona-Colesa: Poisson zaniża remisy 0:0 i 1:1, zawyża 1:0 / 0:1 */
export function dixonColes(M, lh, la, rho = -0.08) {
  if (!rho) return M;
  const tau = (x, y) => {
    if (x === 0 && y === 0) return 1 - lh * la * rho;
    if (x === 0 && y === 1) return 1 + lh * rho;
    if (x === 1 && y === 0) return 1 + la * rho;
    if (x === 1 && y === 1) return 1 - rho;
    return 1;
  };
  let sum = 0;
  for (let i = 0; i < M.length; i++) for (let j = 0; j < M[i].length; j++) { M[i][j] *= tau(i, j); sum += M[i][j]; }
  for (let i = 0; i < M.length; i++) for (let j = 0; j < M[i].length; j++) M[i][j] /= sum;
  return M;
}

export function outcomesFromMatrix(M, curH = 0, curA = 0) {
  let home = 0, draw = 0, away = 0, over25 = 0, btts = 0;
  const finals = {};
  for (let i = 0; i < M.length; i++) for (let j = 0; j < M[i].length; j++) {
    const p = M[i][j];
    const h = curH + i, a = curA + j;
    if (h > a) home += p; else if (h < a) away += p; else draw += p;
    if (h + a >= 3) over25 += p;
    if (h >= 1 && a >= 1) btts += p;
    const key = `${h}:${a}`;
    finals[key] = (finals[key] || 0) + p;
  }
  const topScores = Object.entries(finals).map(([score, p]) => ({ score, p })).sort((a, b) => b.p - a.p).slice(0, 6);
  return { home, draw, away, over25, btts, topScores };
}

// ---------- siła drużyny ----------
export function formScore(last5) {
  if (!last5?.length) return { score: 0.5, n: 0 };
  const w = [1, 0.85, 0.7, 0.6, 0.5];
  let num = 0, den = 0;
  last5.slice(0, 5).forEach((g, i) => {
    const pts = g.result === 'W' ? 3 : g.result === 'D' ? 1 : 0;
    num += w[i] * pts; den += w[i] * 3;
  });
  return { score: den ? num / den : 0.5, n: Math.min(5, last5.length) };
}

/**
 * Stan drużyny -> składowe siły.
 * state: { gp, gf, ga, pts, noGoals?, last5: [{gf, ga, result, date}], split: {gp,w,d,l,gf,ga}|null (bilans po tej stronie boiska),
 *          overall: {gp,gf,ga}|null, table: {rank, teams, gp}|null }
 */
export function teamStrength(state, leagueAvg, side, params = DEFAULT_PARAMS, matchDate = null) {
  const p = params;
  let gp = state.gp || 0, gf = state.gf || 0, ga = state.ga || 0, pts = state.pts || 0;
  const lf = state.last5 || [];
  if (state.noGoals && gp > 0) { gf = leagueAvg * gp; ga = leagueAvg * gp; }
  if (gp < 3 && lf.length) {
    gp += lf.length; gf += lf.reduce((s, g) => s + g.gf, 0); ga += lf.reduce((s, g) => s + g.ga, 0);
    pts += lf.reduce((s, g) => s + (g.result === 'W' ? 3 : g.result === 'D' ? 1 : 0), 0);
  }
  const attackSeason = gp ? shrink((gf / gp) / leagueAvg, gp, p.shrinkK) : 1;
  const defenseSeason = gp ? shrink((ga / gp) / leagueAvg, gp, p.shrinkK) : 1;
  const recent = lf.slice(0, 5);
  let attackRecent = attackSeason, defenseRecent = defenseSeason, wRecent = 0;
  if (recent.length >= 3) {
    const n = recent.length;
    attackRecent = shrink((recent.reduce((s, g) => s + g.gf, 0) / n) / leagueAvg, n, 4);
    defenseRecent = shrink((recent.reduce((s, g) => s + g.ga, 0) / n) / leagueAvg, n, 4);
    wRecent = p.recencyWeight;
  }
  const attack = attackSeason * (1 - wRecent) + attackRecent * wRecent;
  const defense = defenseSeason * (1 - wRecent) + defenseRecent * wRecent;
  const ppg = gp ? pts / gp : 1.3;
  const fs = formScore(lf);

  // atut boiska konkretnej drużyny
  const split = state.split;
  const r = state.overall;
  let venueFactor = 1, venueAttack = 1, venueDefense = 1;
  if (split && split.gp >= 2) {
    const sppg = (split.w * 3 + split.d) / split.gp;
    venueFactor = clamp(1 + (sppg - ppg) * 0.05 * p.venueWeight, 0.9, 1.1);
  }
  if (split && split.gp >= 3 && r && r.gp > split.gp && r.gf > 0 && r.ga > 0) {
    const typAtt = side === 'home' ? p.homeAtt : p.awayAtt, typDef = side === 'home' ? p.awayAtt : p.homeAtt;
    const ratioAtt = ((split.gf / split.gp) / (r.gf / r.gp)) / typAtt;
    const ratioDef = ((split.ga / split.gp) / (r.ga / r.gp)) / typDef;
    venueAttack = clamp(shrink(ratioAtt, split.gp, 8), 0.85, 1.18) ** p.venueWeight;
    venueDefense = clamp(shrink(ratioDef, split.gp, 8), 0.85, 1.18) ** p.venueWeight;
  }

  // świeżość
  let restDays = null, matches14 = 0, fatigue = 1;
  if (lf.length && matchDate) {
    const md = new Date(matchDate).getTime();
    const played = lf.map((g) => new Date(g.date).getTime()).filter((x) => Number.isFinite(x) && x < md);
    if (played.length) {
      restDays = Math.max(0, Math.round((md - Math.max(...played)) / 86400_000));
      matches14 = played.filter((x) => md - x <= 14 * 86400_000).length;
      let pen = 0;
      if (restDays <= 2) pen += 0.04; else if (restDays === 3) pen += 0.015;
      if (matches14 >= 5) pen += 0.03;
      fatigue = 1 - pen * p.restWeight;
    }
  }

  // stawka meczu
  let stakes = 0;
  const t = state.table;
  if (t && t.gp > 0 && t.teams >= 8 && t.rank) {
    const progress = clamp(t.gp / ((t.teams - 1) * 2), 0, 1);
    if (progress >= 0.6) {
      if (t.rank <= 4 || t.rank >= t.teams - 3) stakes = 0.5;
      else if (t.rank > 7 && t.rank < t.teams - 5) stakes = -0.3;
    }
  }
  return { attack, defense, ppg, gp, gf, ga, pts, formScore: fs.score, formN: fs.n, venueFactor, venueAttack, venueDefense, attackRecent, defenseRecent, attackSeason, defenseSeason, restDays, matches14, fatigue, stakes };
}

/**
 * Oczekiwane gole obu drużyn.
 * eloDiff: elo gospodarza - elo gościa (bez atutu boiska); h2h: -1..1 (dodatnie = gospodarz wygrywał);
 * xg: { home: {att, def}, away: {att, def} } siły z xG (1 = średnia); absences: { home, away } liczba brakujących z podstawy;
 * news: { home, away } korekty (np. -0.04 na negatywny nagłówek)
 */
export function expectedGoals({ H, A, leagueAvg, params = DEFAULT_PARAMS, eloDiff = null, h2h = 0, xg = null, absences = null, news = null, neutral = false }) {
  const p = params;
  const formAdj = (fs) => 1 + p.formWeight * (fs - 0.5);
  let hAtt = H.attack, hDef = H.defense, aAtt = A.attack, aDef = A.defense;
  if (xg && p.xgWeight > 0 && xg.home && xg.away) {
    const w = p.xgWeight;
    hAtt = hAtt ** (1 - w) * xg.home.att ** w; hDef = hDef ** (1 - w) * xg.home.def ** w;
    aAtt = aAtt ** (1 - w) * xg.away.att ** w; aDef = aDef ** (1 - w) * xg.away.def ** w;
  }
  const homeAtt = neutral ? 1 : p.homeAtt, awayAtt = neutral ? 1 : p.awayAtt;
  let lh = leagueAvg * hAtt * aDef * homeAtt * H.venueAttack * A.venueDefense * formAdj(H.formScore) * H.venueFactor * H.fatigue * (1 + p.stakesWeight * H.stakes);
  let la = leagueAvg * aAtt * hDef * awayAtt * A.venueAttack * H.venueDefense * formAdj(A.formScore) * A.venueFactor * A.fatigue * (1 + p.stakesWeight * A.stakes);
  if (h2h) { lh *= 1 + p.h2hWeight * h2h; la *= 1 - p.h2hWeight * h2h; }
  if (eloDiff != null && p.eloWeight) {
    const d = clamp(eloDiff / 400, -1.5, 1.5);
    lh *= Math.exp(p.eloWeight * d * 0.5); la *= Math.exp(-p.eloWeight * d * 0.5);
  }
  if (absences) {
    lh *= 1 - p.absenceWeight * Math.min(absences.home || 0, 4);
    la *= 1 - p.absenceWeight * Math.min(absences.away || 0, 4);
  }
  if (news) { lh *= 1 + p.newsWeight * (news.home || 0); la *= 1 + p.newsWeight * (news.away || 0); }
  lh = clamp(lh, 0.25, 4.2); la = clamp(la, 0.25, 4.2);
  return { lh, la };
}

export function predict(lh, la, params = DEFAULT_PARAMS, curH = 0, curA = 0) {
  const M = dixonColes(scoreMatrix(lh, la), lh, la, params.rho);
  return { ...outcomesFromMatrix(M, curH, curA), matrix: M };
}

/** Szansa z różnicy Elo (dla tabel/insightów) */
export const eloWinProb = (diff) => 1 / (1 + 10 ** (-diff / 400));
