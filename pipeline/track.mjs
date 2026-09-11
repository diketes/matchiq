// Tracker skuteczności: codziennie zapisuje prognozy pełnego modelu (tego samego co w aplikacji) dla meczów
// w najbliższych 48 h, a potem rozlicza je wynikami. Daje realną, bieżącą trafność modelu vs kursy.
import { fetchFootballWindow, todayKey, shiftDateKey, mapLimit, FOOTBALL_LEAGUES } from '../server/espn.mjs';
import { getFootballMatch } from '../server/football.mjs';
import { configureRatings } from '../server/ratings.mjs';
import { summarize } from './backtest.mjs';

const r3 = (x) => Math.round(x * 1000) / 1000;
const argmax = (o) => Object.keys(o).reduce((b, k) => (o[k] > o[b] ? k : b), Object.keys(o)[0]);
const leagueNames = Object.fromEntries(FOOTBALL_LEAGUES.map((l) => [l.slug, l.name]));

export async function updateTracker(prev, historyMatches, ratings, backtestPublic, log = () => {}, { settleOnly = false } = {}) {
  const preds = (prev.predictions || []).map((p) => ({ ...p }));
  const byId = new Map(historyMatches.map((m) => [m.id, m]));
  const now = Date.now();

  // rozliczenie
  let settled = 0;
  for (const p of preds) {
    if (p.result || p.void) continue;
    const m = byId.get(p.matchId);
    if (m) {
      p.result = m.hs > m.as ? 'home' : m.hs < m.as ? 'away' : 'draw';
      p.score = `${m.hs}:${m.as}`;
      p.hit = p.fav === p.result;
      settled++;
    } else if (now - new Date(p.date).getTime() > 6 * 86400_000) {
      p.void = true;
    }
  }

  // nowe prognozy
  let added = 0;
  if (!settleOnly) {
    configureRatings({ preset: ratings });
    const today = todayKey();
    const seen = new Set(preds.map((p) => p.matchId));
    const events = [];
    for (const day of [today, shiftDateKey(today, 2)]) {
      try { const { events: ev } = await fetchFootballWindow(day); events.push(...ev); } catch (e) { log('lista meczów:', e.message); }
    }
    const uniq = new Map();
    for (const e of events) if (!uniq.has(e.id)) uniq.set(e.id, e);
    const upcoming = [...uniq.values()].filter((e) => {
      const t = new Date(e.date).getTime();
      return e.state === 'pre' && e.league.tier <= 3 && t > now + 20 * 60_000 && t < now + 48 * 3600_000 && !seen.has(e.id);
    }).sort((a, b) => a.league.tier - b.league.tier || new Date(a.date) - new Date(b.date)).slice(0, 220);
    log(`tracker: ${upcoming.length} nowych meczów do prognozy`);
    const details = await mapLimit(upcoming, 4, (e) => getFootballMatch(e.league.id, e.id));
    upcoming.forEach((e, i) => {
      const d = details[i];
      if (!d || d.__error || !d.analysis?.model) return;
      const a = d.analysis;
      const probs = a.model;
      preds.push({
        matchId: e.id, leagueId: e.league.id, leagueName: e.league.name, date: e.date,
        home: e.home.short, away: e.away.short, homeName: e.home.name, awayName: e.away.name, homeLogo: e.home.logo, awayLogo: e.away.logo,
        probs: { home: r3(probs.home), draw: r3(probs.draw), away: r3(probs.away) },
        fav: argmax(probs), confidence: a.confidence,
        market: a.market ? { home: r3(a.market.home), draw: r3(a.market.draw), away: r3(a.market.away) } : null,
        why: a.verdict?.why || '', xg: a.xg, predictedAt: new Date().toISOString(),
      });
      added++;
    });
  }

  // przytnij do 150 dni
  const keepFrom = new Date(now - 150 * 86400_000).toISOString();
  const kept = preds.filter((p) => p.date >= keepFrom);

  // statystyki
  const done = kept.filter((p) => p.result && !p.void);
  const forSummary = done.map((p) => ({ league: p.leagueId, probs: p.probs, result: p.result, market: p.market, date: p.date }));
  const summaryAll = summarize(forSummary, leagueNames);
  const last30 = forSummary.filter((p) => now - new Date(p.date).getTime() <= 30 * 86400_000);
  const summary30 = summarize(last30, leagueNames);
  // seria dzienna (do wykresu)
  const daily = {};
  for (const p of done) {
    const k = p.date.slice(0, 10);
    const d = daily[k] || (daily[k] = { date: k, n: 0, hit: 0, marketHit: 0, withMarket: 0 });
    d.n++; if (p.hit) d.hit++;
    if (p.market) { d.withMarket++; if (argmax(p.market) === p.result) d.marketHit++; }
  }
  const upcomingList = kept.filter((p) => !p.result && !p.void && new Date(p.date).getTime() > now - 2 * 3600_000)
    .map((p) => ({ matchId: p.matchId, leagueId: p.leagueId, leagueName: p.leagueName, date: p.date, home: p.home, away: p.away, homeLogo: p.homeLogo, awayLogo: p.awayLogo, probs: p.probs, fav: p.fav, confidence: p.confidence, market: p.market, why: p.why }))
    .sort((a, b) => b.probs[b.fav] * b.confidence - a.probs[a.fav] * a.confidence)
    .slice(0, 60);
  const recent = done.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 80).map((p) => ({ matchId: p.matchId, leagueId: p.leagueId, leagueName: p.leagueName, date: p.date, home: p.home, away: p.away, homeLogo: p.homeLogo, awayLogo: p.awayLogo, probs: p.probs, fav: p.fav, result: p.result, score: p.score, hit: p.hit, market: p.market }));

  log(`tracker: rozliczono ${settled}, dodano ${added}, łącznie ${kept.length} (rozliczonych ${done.length})`);
  return {
    predictions: kept,
    accuracy: {
      generatedAt: new Date().toISOString(),
      tracked: { all: summaryAll, last30: summary30, pending: kept.filter((p) => !p.result && !p.void).length, settled: done.length, daily: Object.values(daily).sort((a, b) => a.date.localeCompare(b.date)).slice(-60) },
      upcoming: upcomingList,
      recent,
      backtest: backtestPublic,
    },
  };
}
