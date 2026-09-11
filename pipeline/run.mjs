// Codzienny pipeline danych MatchIQ:
//  1. historia wyników (piłka 2 sezony, tenis 13 mies.)  2. Elo (piłka, tenis per nawierzchnia)
//  3. statystyki strzałów -> xG            4. backtest + dopasowanie wag
//  5. tracker skuteczności (prognozy na 48 h + rozliczenie)  6. zapis JSON (gałąź data w repo)
// Użycie: node pipeline/run.mjs [katalog_wyjściowy] [--skip-track] [--skip-stats]
import fs from 'node:fs';
import path from 'node:path';
import { fetchFootballHistory, fetchTennisHistory } from './history.mjs';
import { computeFootballElo, computeTennisElo } from './elo.mjs';
import { fetchMatchStats, fitXgModel, currentXgStrengths } from './stats.mjs';
import { runBacktest } from './backtest.mjs';
import { updateTracker } from './track.mjs';
import { FOOTBALL_LEAGUES } from '../server/espn.mjs';

const args = process.argv.slice(2);
const OUT = path.resolve(args.find((a) => !a.startsWith('--')) || 'pipeline/out');
const SKIP_TRACK = args.includes('--skip-track');
const SKIP_STATS = args.includes('--skip-stats');
const MAX_STATS = Number((args.find((a) => a.startsWith('--max-stats=')) || '').split('=')[1]) || 2500;
fs.mkdirSync(OUT, { recursive: true });

const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s]`, ...a);
const readJson = (name, fallback) => { try { return JSON.parse(fs.readFileSync(path.join(OUT, name), 'utf8')); } catch { return fallback; } };
const writeJson = (name, data, pretty = false) => fs.writeFileSync(path.join(OUT, name), pretty ? JSON.stringify(data, null, 1) : JSON.stringify(data));
const leagueNames = Object.fromEntries(FOOTBALL_LEAGUES.map((l) => [l.slug, l.name]));

// 1. historia
const histCache = readJson('history.json', {});
const fb = await fetchFootballHistory(histCache);
log(`piłka: ${fb.matches.length} meczów (pobrano ${fb.fetched}/${fb.tasks} zapytań, błędy ${fb.failed})`);
const tn = await fetchTennisHistory(histCache);
log(`tenis: ${tn.matches.length} meczów (pobrano ${tn.fetched}/${tn.tasks}, błędy ${tn.failed})`);
writeJson('history.json', { ...fb.cache, ...tn.cache });

// 2. Elo
const elo = computeFootballElo(fb.matches);
log(`Elo piłka: ${Object.keys(elo.teams).length} drużyn`);
const tennisElo = computeTennisElo(tn.matches);
log(`Elo tenis: ${Object.keys(tennisElo.players).length} zawodników`);

// 3. statystyki strzałów -> xG
let statsCache = readJson('stats-cache.json', {});
let xgFit = { coef: { sot: 0.3, other: 0.04, corners: 0.01 }, n: 0, fitted: false };
let xgNow = {};
if (!SKIP_STATS) {
  const st = await fetchMatchStats(fb.matches, statsCache, { maxNew: MAX_STATS });
  statsCache = { stats: st.stats };
  writeJson('stats-cache.json', statsCache);
  log(`statystyki: pobrano ${st.fetched} (ze statystykami ${st.withStats}), w cache ${Object.keys(st.stats).length}`);
}
const stats = statsCache.stats || {};
xgFit = fitXgModel(fb.matches, stats);
xgNow = currentXgStrengths(fb.matches, stats, xgFit.coef);
log(`xG: współczynniki ${JSON.stringify(xgFit.coef)} (n=${xgFit.n}, korelacja ${xgFit.corr ?? '-'}), drużyn z xG: ${Object.keys(xgNow).length}`);

// 4. backtest
const bt = runBacktest(fb.matches, elo, stats, xgFit.coef, leagueNames, log);
log(`backtest: test ${bt.test.n} meczów – model ${(bt.test.model.accuracy * 100).toFixed(1)}% / logloss ${bt.test.model.logloss}, kursy ${(bt.test.summary.market.accuracy * 100).toFixed(1)}% / ${bt.test.summary.market.logloss}`);
log(`wagi: ${JSON.stringify(bt.params)}`);

// tenis: skuteczność Elo vs ranking nie jest tu liczona (brak rankingów historycznych); zapisujemy trafność faworyta Elo w ostatnich 90 dniach
const cutoff = new Date(Date.now() - 90 * 86400_000).toISOString();
let tnN = 0, tnHit = 0, tnHitSurf = 0;
for (const m of tn.matches) {
  if (m.date < cutoff) continue;
  const pre = tennisElo.byMatch[m.id];
  if (!pre) continue;
  if (pre.p1.all === pre.p2.all) continue;
  tnN++;
  if ((pre.p1.all > pre.p2.all) === (m.winner === 'p1')) tnHit++;
  if ((pre.p1.surf > pre.p2.surf) === (m.winner === 'p1')) tnHitSurf++;
}
const tennisEval = { n: tnN, accuracyAll: tnN ? Math.round((tnHit / tnN) * 1000) / 1000 : 0, accuracySurface: tnN ? Math.round((tnHitSurf / tnN) * 1000) / 1000 : 0, days: 90 };
log(`tenis Elo (90 dni): ${tnN} meczów, faworyt Elo ${(tennisEval.accuracyAll * 100).toFixed(1)}%, per nawierzchnia ${(tennisEval.accuracySurface * 100).toFixed(1)}%`);

// ratings.json – to pobiera aplikacja
const ratings = {
  generatedAt: new Date().toISOString(),
  params: bt.params,
  elo: elo.teams,
  eloLeagueMean: elo.leagueMean,
  xg: xgNow,
  xgCoef: xgFit.coef,
  tennisElo: tennisElo.players,
  seasons: { football: fb.matches.length, tennis: tn.matches.length },
};
writeJson('ratings.json', ratings);
log(`ratings.json: ${(fs.statSync(path.join(OUT, 'ratings.json')).size / 1024).toFixed(0)} KB`);

// 5. tracker skuteczności
const prevTrack = readJson('predictions.json', { predictions: [] });
const backtestPublic = {
  fittedAt: ratings.generatedAt,
  test: { n: bt.test.n, model: bt.test.model, defaultParams: bt.test.defaultParams, withoutElo: bt.test.withoutElo, withoutXg: bt.test.withoutXg, market: bt.test.summary.market, modelWithMarket: bt.test.summary.modelWithMarket, disagree: bt.test.summary.disagree, agree: bt.test.summary.agree, calibration: bt.test.summary.calibration, byOutcome: bt.test.summary.byOutcome, perLeague: bt.test.summary.perLeague },
  all: { n: bt.all.n, model: bt.all.model, market: bt.all.summary.market, modelWithMarket: bt.all.summary.modelWithMarket, calibration: bt.all.summary.calibration, perLeague: bt.all.summary.perLeague },
  train: bt.train,
  params: bt.params,
  xg: { coef: xgFit.coef, n: xgFit.n, corr: xgFit.corr ?? null, teams: Object.keys(xgNow).length },
  tennis: tennisEval,
  history: { footballMatches: fb.matches.length, tennisMatches: tn.matches.length, leagues: FOOTBALL_LEAGUES.length, seasons: fb.seasons, splitDate: bt.splitDate },
};
let trackResult = { predictions: prevTrack.predictions || [], accuracy: { generatedAt: ratings.generatedAt, tracked: null, upcoming: [], backtest: backtestPublic } };
if (!SKIP_TRACK) {
  trackResult = await updateTracker(prevTrack, fb.matches, ratings, backtestPublic, log);
} else {
  trackResult.accuracy = { ...trackResult.accuracy, ...(await updateTracker(prevTrack, fb.matches, ratings, backtestPublic, log, { settleOnly: true })).accuracy };
}
writeJson('predictions.json', { predictions: trackResult.predictions });
writeJson('accuracy.json', trackResult.accuracy);
log(`accuracy.json: ${(fs.statSync(path.join(OUT, 'accuracy.json')).size / 1024).toFixed(0)} KB, prognoz w trackerze: ${trackResult.predictions.length}`);
writeJson('summary.txt', null); fs.writeFileSync(path.join(OUT, 'summary.txt'), [
  `generated: ${ratings.generatedAt}`,
  `football matches: ${fb.matches.length}, tennis: ${tn.matches.length}`,
  `backtest test: n=${bt.test.n} model acc=${bt.test.model.accuracy} ll=${bt.test.model.logloss} | market acc=${bt.test.summary.market.accuracy} ll=${bt.test.summary.market.logloss}`,
  `params: ${JSON.stringify(bt.params)}`,
].join('\n'));
log('gotowe');
