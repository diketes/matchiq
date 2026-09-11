// Backtesting: model liczony wyłącznie z danych sprzed każdego meczu (rolling), dopasowanie wag (log-loss),
// metryki: trafność, log-loss, Brier, kalibracja, porównanie z kursami bukmacherskimi.
import { DEFAULT_PARAMS, teamStrength, expectedGoals, predict, clamp, shrink, argmax } from './model.mjs';
import { xgOf } from './stats.mjs';

const r3 = (x) => Math.round(x * 1000) / 1000;

function emptyTeam() {
  return { gp: 0, gf: 0, ga: 0, pts: 0, w: 0, d: 0, l: 0, home: { gp: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0 }, away: { gp: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0 }, xgGp: 0, xgFor: 0, xgAgainst: 0 };
}

export function buildDataset(matches, elo, stats, xgCoef) {
  const teamSeason = new Map();
  const teamLast = new Map();
  const leagueSeason = new Map();
  const leagueXg = new Map();
  const h2hMap = new Map();
  const eloN = new Map(); // liczba meczów drużyny w bazie (do oceny, czy Elo jest już wiarygodne)
  const samples = [];
  const key2 = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);

  for (const m of matches) {
    eloN.set(m.homeId, (eloN.get(m.homeId) || 0) + 1);
    eloN.set(m.awayId, (eloN.get(m.awayId) || 0) + 1);
    const kH = `${m.homeId}|${m.season}`, kA = `${m.awayId}|${m.season}`;
    const H = teamSeason.get(kH) || emptyTeam();
    const A = teamSeason.get(kA) || emptyTeam();
    const lk = `${m.league}|${m.season}`;
    const ls = leagueSeason.get(lk) || { gp: 0, goals: 0 };
    const leagueAvg = ls.gp >= 30 ? clamp(ls.goals / ls.gp / 2, 1.0, 1.9) : 1.35;
    const lx = leagueXg.get(lk) || { gp: 0, xg: 0 };

    const pre = elo?.byMatch?.[m.id];
    const eloKnown = !!pre && (eloN.get(m.homeId) || 0) >= 10 && (eloN.get(m.awayId) || 0) >= 10;
    // próbka, gdy obie drużyny mają ≥3 mecze w sezonie albo (początek sezonu) ugruntowane Elo z poprzednich sezonów
    if ((H.gp >= 3 && A.gp >= 3) || (eloKnown && (teamLast.get(m.homeId) || []).length >= 3 && (teamLast.get(m.awayId) || []).length >= 3)) {
      const state = (T, side, id) => ({ gp: T.gp, gf: T.gf, ga: T.ga, pts: T.pts, last5: (teamLast.get(id) || []).slice(0, 5), split: T[side], overall: { gp: T.gp, gf: T.gf, ga: T.ga }, table: null });
      // h2h: poprzednie mecze tych drużyn (mecz u gospodarza x1.5)
      let h2h = 0;
      const prev = h2hMap.get(key2(m.homeId, m.awayId)) || [];
      if (prev.length >= 2) {
        let s = 0, w = 0;
        for (const g of prev.slice(-6)) { const wt = g.host === m.homeId ? 1.5 : 1; s += wt * g.sign * (g.host === m.homeId ? 1 : -1); w += wt; }
        h2h = w ? s / w : 0;
      }
      let xg = null;
      if (xgCoef && H.xgGp >= 3 && A.xgGp >= 3 && lx.gp >= 20) {
        const avg = lx.xg / lx.gp;
        const st = (T) => ({ att: shrink((T.xgFor / T.xgGp) / avg, T.xgGp, 5), def: shrink((T.xgAgainst / T.xgGp) / avg, T.xgGp, 5) });
        xg = { home: st(H), away: st(A) };
      }
      samples.push({
        id: m.id, league: m.league, season: m.season, date: m.date,
        result: m.hs > m.as ? 'home' : m.hs < m.as ? 'away' : 'draw',
        market: m.market || null, leagueAvg,
        H: state(H, 'home', m.homeId), A: state(A, 'away', m.awayId),
        eloDiff: pre ? pre.h - pre.a : null, h2h, xg, neutral: !!m.neutral,
      });
    }

    // aktualizacja stanów
    const resH = m.hs > m.as ? 'W' : m.hs < m.as ? 'L' : 'D';
    const resA = resH === 'W' ? 'L' : resH === 'L' ? 'W' : 'D';
    const upd = (T, gf, ga, res, side) => {
      T.gp++; T.gf += gf; T.ga += ga; T.pts += res === 'W' ? 3 : res === 'D' ? 1 : 0;
      T[res === 'W' ? 'w' : res === 'D' ? 'd' : 'l']++;
      const s = T[side]; s.gp++; s.gf += gf; s.ga += ga; s[res === 'W' ? 'w' : res === 'D' ? 'd' : 'l']++;
    };
    upd(H, m.hs, m.as, resH, m.neutral ? 'away' : 'home');
    upd(A, m.as, m.hs, resA, 'away');
    const st = stats?.[m.id];
    if (st && xgCoef) {
      const xh = xgOf(st.h, xgCoef), xa = xgOf(st.a, xgCoef);
      H.xgGp++; H.xgFor += xh; H.xgAgainst += xa; A.xgGp++; A.xgFor += xa; A.xgAgainst += xh;
      lx.gp += 2; lx.xg += xh + xa; leagueXg.set(lk, lx);
    }
    teamSeason.set(kH, H); teamSeason.set(kA, A);
    const push = (id, gf, ga, res) => { const arr = teamLast.get(id) || []; arr.unshift({ gf, ga, result: res, date: m.date }); if (arr.length > 8) arr.length = 8; teamLast.set(id, arr); };
    push(m.homeId, m.hs, m.as, resH); push(m.awayId, m.as, m.hs, resA);
    ls.gp++; ls.goals += m.hs + m.as; leagueSeason.set(lk, ls);
    const hk = key2(m.homeId, m.awayId);
    const arr = h2hMap.get(hk) || []; arr.push({ host: m.homeId, sign: m.hs > m.as ? 1 : m.hs < m.as ? -1 : 0 }); h2hMap.set(hk, arr);
  }
  return samples;
}

export function evaluate(samples, params, { useXg = true, useElo = true, keep = false } = {}) {
  let ll = 0, brier = 0, hit = 0, n = 0;
  const preds = keep ? [] : null;
  for (const s of samples) {
    const H = teamStrength(s.H, s.leagueAvg, 'home', params, s.date);
    const A = teamStrength(s.A, s.leagueAvg, 'away', params, s.date);
    const { lh, la } = expectedGoals({ H, A, leagueAvg: s.leagueAvg, params, eloDiff: useElo ? s.eloDiff : null, h2h: s.h2h, xg: useXg ? s.xg : null, neutral: s.neutral });
    const p = predict(lh, la, params);
    const probs = { home: p.home, draw: p.draw, away: p.away };
    const pr = Math.max(1e-6, probs[s.result]);
    ll -= Math.log(pr);
    brier += (probs.home - (s.result === 'home' ? 1 : 0)) ** 2 + (probs.draw - (s.result === 'draw' ? 1 : 0)) ** 2 + (probs.away - (s.result === 'away' ? 1 : 0)) ** 2;
    const fav = argmax(probs);
    if (fav === s.result) hit++;
    n++;
    if (preds) preds.push({ id: s.id, league: s.league, season: s.season, date: s.date, result: s.result, market: s.market, probs, fav });
  }
  return { n, logloss: n ? ll / n : 0, brier: n ? brier / n : 0, accuracy: n ? hit / n : 0, preds };
}

const GRID = {
  homeAtt: [1.0, 1.05, 1.1, 1.15, 1.2, 1.25],
  awayAtt: [0.8, 0.85, 0.9, 0.95, 1.0],
  formWeight: [0, 0.1, 0.2, 0.3, 0.45, 0.6],
  recencyWeight: [0, 0.15, 0.3, 0.45, 0.6],
  shrinkK: [2, 4, 6, 9, 13, 20],
  rho: [-0.16, -0.12, -0.08, -0.05, -0.02, 0],
  eloWeight: [0, 0.3, 0.6, 0.9, 1.2, 1.6, 2.0],
  venueWeight: [0, 0.5, 1, 1.5],
  restWeight: [0, 0.5, 1, 1.5, 2],
  h2hWeight: [0, 0.03, 0.06, 0.1],
  xgWeight: [0, 0.2, 0.35, 0.5, 0.7],
};

export function fitParams(samples, start = DEFAULT_PARAMS, passes = 2, log = () => {}) {
  let best = { ...start };
  let bestLL = evaluate(samples, best).logloss;
  for (let pass = 0; pass < passes; pass++) {
    for (const key of Object.keys(GRID)) {
      for (const v of GRID[key]) {
        if (v === best[key]) continue;
        const cand = { ...best, [key]: v };
        const ll = evaluate(samples, cand).logloss;
        if (ll < bestLL - 1e-6) { bestLL = ll; best = cand; }
      }
      log(`pass ${pass + 1} ${key}=${best[key]} logloss=${bestLL.toFixed(5)}`);
    }
  }
  return { params: best, logloss: bestLL };
}

/** Metryki z listy predykcji (model vs kursy, kalibracja, per liga). */
export function summarize(preds, leagueNames = {}) {
  const base = { n: 0, hit: 0, ll: 0, brier: 0 };
  const mk = () => ({ ...base });
  const add = (acc, probs, result) => {
    acc.n++;
    if (argmax(probs) === result) acc.hit++;
    acc.ll -= Math.log(Math.max(1e-6, probs[result]));
    acc.brier += (probs.home - (result === 'home' ? 1 : 0)) ** 2 + (probs.draw - (result === 'draw' ? 1 : 0)) ** 2 + (probs.away - (result === 'away' ? 1 : 0)) ** 2;
  };
  const fin = (acc) => (acc.n ? { n: acc.n, accuracy: r3(acc.hit / acc.n), logloss: r3(acc.ll / acc.n), brier: r3(acc.brier / acc.n) } : { n: 0, accuracy: 0, logloss: 0, brier: 0 });

  const model = mk(), modelM = mk(), market = mk();
  const disagree = { n: 0, modelHit: 0, marketHit: 0 };
  const agree = { n: 0, hit: 0 };
  const bins = [[0.33, 0.4], [0.4, 0.45], [0.45, 0.5], [0.5, 0.55], [0.55, 0.6], [0.6, 0.7], [0.7, 1.01]].map(([lo, hi]) => ({ lo, hi, n: 0, sumP: 0, hit: 0 }));
  const perLeague = {};
  const byOutcome = { home: { n: 0, hit: 0, pred: 0 }, draw: { n: 0, hit: 0, pred: 0 }, away: { n: 0, hit: 0, pred: 0 } };
  for (const p of preds) {
    add(model, p.probs, p.result);
    const fav = argmax(p.probs);
    const pf = p.probs[fav];
    const bin = bins.find((b) => pf >= b.lo && pf < b.hi);
    if (bin) { bin.n++; bin.sumP += pf; if (fav === p.result) bin.hit++; }
    byOutcome[p.result].n++;
    byOutcome[fav].pred++;
    if (fav === p.result) byOutcome[fav].hit++;
    const L = perLeague[p.league] || (perLeague[p.league] = { league: p.league, name: leagueNames[p.league] || p.league, model: mk(), market: mk() });
    add(L.model, p.probs, p.result);
    if (p.market) {
      add(modelM, p.probs, p.result);
      add(market, p.market, p.result);
      add(L.market, p.market, p.result);
      const mf = argmax(p.market);
      if (mf !== fav) { disagree.n++; if (fav === p.result) disagree.modelHit++; if (mf === p.result) disagree.marketHit++; }
      else { agree.n++; if (fav === p.result) agree.hit++; }
    }
  }
  return {
    model: fin(model),
    modelWithMarket: fin(modelM),
    market: fin(market),
    disagree: { n: disagree.n, modelAccuracy: disagree.n ? r3(disagree.modelHit / disagree.n) : 0, marketAccuracy: disagree.n ? r3(disagree.marketHit / disagree.n) : 0 },
    agree: { n: agree.n, accuracy: agree.n ? r3(agree.hit / agree.n) : 0 },
    calibration: bins.filter((b) => b.n > 0).map((b) => ({ range: `${Math.round(b.lo * 100)}–${Math.round(Math.min(b.hi, 1) * 100)}%`, n: b.n, predicted: r3(b.sumP / b.n), actual: r3(b.hit / b.n) })),
    byOutcome: Object.fromEntries(Object.entries(byOutcome).map(([k, v]) => [k, { n: v.n, predicted: v.pred, hit: v.hit, precision: v.pred ? r3(v.hit / v.pred) : 0 }])),
    perLeague: Object.values(perLeague).map((L) => ({ league: L.league, name: L.name, model: fin(L.model), market: fin(L.market) })).sort((a, b) => b.model.n - a.model.n),
  };
}

export function runBacktest(matches, elo, stats, xgCoef, leagueNames = {}, log = () => {}, splitDate = '2026-01-01') {
  const samples = buildDataset(matches, elo, stats, xgCoef);
  const train = samples.filter((s) => s.date < splitDate);
  const test = samples.filter((s) => s.date >= splitDate);
  log(`próbki: ${samples.length} (trening ${train.length}, test ${test.length}), z kursami: ${samples.filter((s) => s.market).length}, z xG: ${samples.filter((s) => s.xg).length}`);
  const fitTrain = fitParams(train, DEFAULT_PARAMS, 2, log);
  const evalTest = evaluate(test, fitTrain.params, { keep: true });
  const evalTestDefault = evaluate(test, DEFAULT_PARAMS, { keep: true });
  const evalTestNoElo = evaluate(test, fitTrain.params, { useElo: false, keep: false });
  const evalTestNoXg = evaluate(test, fitTrain.params, { useXg: false, keep: false });
  const fitAll = fitParams(samples, fitTrain.params, 1, log);
  const evalAll = evaluate(samples, fitAll.params, { keep: true });
  const testSummary = summarize(evalTest.preds, leagueNames);
  const allSummary = summarize(evalAll.preds, leagueNames);
  return {
    params: fitAll.params,
    trainParams: fitTrain.params,
    samples: samples.length,
    splitDate,
    train: { n: train.length, logloss: r3(fitTrain.logloss), from: train[0]?.date?.slice(0, 10), to: train[train.length - 1]?.date?.slice(0, 10) },
    test: {
      n: test.length,
      model: { accuracy: r3(evalTest.accuracy), logloss: r3(evalTest.logloss), brier: r3(evalTest.brier) },
      defaultParams: { accuracy: r3(evalTestDefault.accuracy), logloss: r3(evalTestDefault.logloss), brier: r3(evalTestDefault.brier) },
      withoutElo: { accuracy: r3(evalTestNoElo.accuracy), logloss: r3(evalTestNoElo.logloss) },
      withoutXg: { accuracy: r3(evalTestNoXg.accuracy), logloss: r3(evalTestNoXg.logloss) },
      summary: testSummary,
    },
    all: { n: samples.length, model: { accuracy: r3(evalAll.accuracy), logloss: r3(evalAll.logloss), brier: r3(evalAll.brier) }, summary: allSummary },
  };
}
