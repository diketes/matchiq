// Tenis: szczegóły meczu + analiza (ranking, forma, nawierzchnia, H2H, model Markowa live)
import { CORE, getJSON, fetchTennisTour, guessSurface, tournamentCategory, ROUND_PL, mapLimit } from './espn.mjs';
import { matchWin, solveServeEdge } from './markov.mjs';
import { plural, pct, f1, clamp, round3, lata, MECZE, SETY, TYTULY, WYGRANE } from './text.mjs';
import { playerElo, ensureRatings } from './ratings.mjs';

const SURFACE_PL = { hard: 'twarda', clay: 'mączka (ceglana)', grass: 'trawa', carpet: 'dywan' };
const SURFACE_LOC = { hard: 'na twardej nawierzchni', clay: 'na mączce', grass: 'na trawie', carpet: 'na dywanie' };

export async function getTennisMatch(tour, compId) {
  await ensureRatings().catch(() => null);
  const { matches, raw, rankMap } = await fetchTennisTour(tour);
  const item = matches.find((m) => m.id === String(compId));
  if (!item) { const e = new Error('Nie znaleziono meczu'); e.status = 404; throw e; }
  const eventId = item.league.eventId;

  // mecze obu graczy w bieżącym turnieju (ze scoreboardu – bez dodatkowych zapytań)
  const runOf = (pid) => matches
    .filter((m) => m.league.eventId === eventId && m.state === 'post' && (m.home.id === pid || m.away.id === pid) && !m.doubles)
    .map((m) => toResult(m, pid, item.league.name))
    .sort((a, b) => new Date(b.date) - new Date(a.date));

  const [hp, ap] = await Promise.all([
    playerProfile(tour, item.home, rankMap, matches, eventId),
    playerProfile(tour, item.away, rankMap, matches, eventId),
  ]);
  hp.tournamentRun = runOf(item.home.id);
  ap.tournamentRun = runOf(item.away.id);

  const tournament = {
    name: item.league.name,
    surface: item.surface,
    surfacePl: SURFACE_PL[item.surface] || item.surface,
    category: tournamentCategory(item.league.name),
    round: item.round,
    court: item.venue,
    bestOf: item.bestOf,
    group: item.group,
  };

  const analysis = analyzeTennis({ item, home: hp, away: ap, tournament, tour });
  return { summary: item, players: { home: hp, away: ap }, tournament, analysis, fetchedAt: new Date().toISOString() };
}

function toResult(m, pid, tournamentName) {
  const me = m.home.id === pid ? m.home : m.away;
  const opp = m.home.id === pid ? m.away : m.home;
  const score = m.home.sets.map((s, i) => {
    const a = m.home.id === pid ? m.home.sets[i] : m.away.sets[i];
    const b = m.home.id === pid ? m.away.sets[i] : m.home.sets[i];
    return `${a?.games ?? 0}-${b?.games ?? 0}`;
  }).join(' ');
  return { id: m.id, date: m.date, tournament: tournamentName, round: m.round, opponent: { id: opp.id, name: opp.name, rank: opp.rank, seed: opp.seed }, won: me.winner, score, setsWon: me.score, setsLost: opp.score, surface: m.surface };
}

const eventNameCache = new Map();
async function eventName(tour, eventId) {
  if (eventNameCache.has(eventId)) return eventNameCache.get(eventId);
  const p = getJSON(`${CORE}/tennis/leagues/${tour}/events/${eventId}?lang=en&region=us`, 24 * 60 * 60_000)
    .then((e) => ({ name: e.name || e.shortName || '', date: e.date }))
    .catch(() => ({ name: '', date: null }));
  eventNameCache.set(eventId, p);
  return p;
}

async function playerProfile(tour, side, rankMap, matches, currentEventId) {
  const id = String(side.id);
  const rk = rankMap.get(id);
  const [core, recent] = await Promise.all([
    getJSON(`${CORE}/tennis/leagues/${tour}/athletes/${id}?lang=en&region=us`, 6 * 60 * 60_000).catch(() => null),
    recentResults(tour, id, currentEventId).catch(() => []),
  ]);
  const stats = core?.statistics?.splits?.categories?.[0]?.stats || [];
  const sv = (n) => Number((stats.find((s) => s.name === n) || {}).value ?? 0);
  // jeśli statystyki są w $ref – spróbuj dociągnąć
  let career = { won: sv('singlesWon'), lost: sv('singlesLost'), titles: sv('singlesTitles'), prize: sv('prize') };
  if (!stats.length && core?.statistics?.$ref) {
    try {
      const st = await getJSON(core.statistics.$ref, 6 * 60 * 60_000);
      const s2 = st?.splits?.categories?.[0]?.stats || [];
      const v2 = (n) => Number((s2.find((s) => s.name === n) || {}).value ?? 0);
      career = { won: v2('singlesWon'), lost: v2('singlesLost'), titles: v2('singlesTitles'), prize: v2('prize') };
    } catch { /* ignore */ }
  }
  const hand = core?.hand?.type || core?.hand?.displayValue || null;
  return {
    ...side,
    rank: rk?.rank ?? side.rank ?? null,
    rankPrev: rk?.prev ?? null,
    rankPoints: rk?.points ?? null,
    rankTrend: rk?.trend ?? null,
    age: core?.age ?? null,
    height: core?.displayHeight ?? null,
    heightCm: core?.height ? Math.round(core.height * 2.54) : null,
    weightKg: core?.weight ? Math.round(core.weight * 0.4536) : null,
    hand: hand ? (/left/i.test(hand) ? 'Leworęczny' : 'Praworęczny') : null,
    birthPlace: [core?.birthPlace?.city, core?.birthPlace?.country].filter(Boolean).join(', ') || null,
    debutYear: core?.debutYear ?? null,
    career,
    recent,
  };
}

async function recentResults(tour, id, currentEventId) {
  const log = await getJSON(`${CORE}/tennis/leagues/${tour}/athletes/${id}/eventlog?limit=100&lang=en&region=us`, 30 * 60_000);
  const items = (log?.events?.items || []).filter((it) => it.played !== false);
  // dziennik jest grupowany turniejami (najnowsze pierwsze), w turnieju rosnąco rundami
  const pick = items.slice(0, 14).filter((it) => !String(it.competition?.$ref || '').includes(`/events/${currentEventId}/`));
  const comps = await mapLimit(pick, 6, (it) => getJSON(it.competition.$ref, 24 * 60 * 60_000));
  const results = [];
  const evIds = new Set();
  for (const c of comps) {
    if (!c || c.__error) continue;
    const m = String(c.$ref || '').match(/events\/([^/]+)\/competitions/);
    const evId = m?.[1];
    if (evId) evIds.add(evId);
    const me = (c.competitors || []).find((x) => String(x.id) === id);
    const opp = (c.competitors || []).find((x) => String(x.id) !== id);
    if (!me || !opp) continue;
    const note = c.notes?.[0]?.text || '';
    const scoreMatch = note.match(/\)\s*([\d\-\s\(\)]+)$/) || note.match(/bt .*?\)\s*(.*)$/);
    let score = scoreMatch ? scoreMatch[1].trim() : '';
    // konwersja wyniku na perspektywę gracza – note ma perspektywę zwycięzcy
    if (!me.winner && score) {
      score = score.split(/\s+(?![\d\-]+\))/).map((s) => {
        const mm = s.match(/^(\d+)-(\d+)(?:\s*\((\d+)-(\d+)\))?(.*)$/);
        if (!mm) return s;
        const tb = mm[3] != null ? ` (${mm[4]}-${mm[3]})` : '';
        return `${mm[2]}-${mm[1]}${tb}${mm[5] || ''}`;
      }).join(' ');
    }
    results.push({ id: c.id, date: c.date, eventId: evId, round: ROUND_PL(c.round?.displayName || ''), opponent: { id: opp.id, name: opp.name }, won: !!me.winner, score, retired: /ret\.|retired|w\/o|walkover/i.test(note) });
  }
  const names = new Map();
  await Promise.all([...evIds].map(async (e) => names.set(e, await eventName(tour, e))));
  for (const r of results) {
    const ev = names.get(r.eventId);
    r.tournament = ev?.name || '';
    r.surface = guessSurface(r.tournament, r.date);
  }
  results.sort((a, b) => new Date(b.date) - new Date(a.date));
  return results.slice(0, 12);
}

// ---------- analiza ----------
export function analyzeTennis({ item, home, away, tournament, tour }) {
  const state = item.state;
  const bestOf = tournament.bestOf || 3;
  const doubles = item.doubles;

  const rankOf = (p) => p.rank || 300;
  const a = 0.6, b = 0.45;
  const rA = rankOf(home), rB = rankOf(away);
  let pRank = rB ** a / (rA ** a + rB ** a);
  if (home.rankPoints && away.rankPoints) {
    const pPts = home.rankPoints ** b / (home.rankPoints ** b + away.rankPoints ** b);
    pRank = 0.5 * pRank + 0.5 * pPts;
  }
  const noRank = !home.rank && !away.rank;
  if (noRank) pRank = 0.5;

  // Elo z historii wyników (ostatnie ~13 miesięcy), osobno per nawierzchnia
  const eH = playerElo(home.id), eA = playerElo(away.id);
  const surfKey = ['hard', 'clay', 'grass'].includes(tournament.surface) ? tournament.surface : 'hard';
  const nKey = 'n' + surfKey.charAt(0).toUpperCase() + surfKey.slice(1);
  let pElo = null, eloUsed = null;
  if (eH && eA && eH.n >= 5 && eA.n >= 5 && !doubles) {
    const useSurf = (eH[nKey] || 0) >= 6 && (eA[nKey] || 0) >= 6;
    const rh = useSurf ? eH[surfKey] : eH.all, ra = useSurf ? eA[surfKey] : eA.all;
    pElo = 1 / (1 + 10 ** ((ra - rh) / 400));
    eloUsed = { home: rh, away: ra, surface: useSurf, homeAll: eH.all, awayAll: eA.all, homeSurf: eH[surfKey], awaySurf: eA[surfKey], homeN: eH.n, awayN: eA.n };
  }
  const pBase = pElo != null ? (noRank ? pElo : 0.5 * pRank + 0.5 * pElo) : pRank;

  // forma: ostatnie mecze + przebieg turnieju
  const formOf = (p) => {
    const all = [...(p.tournamentRun || []), ...(p.recent || [])].slice(0, 10);
    if (!all.length) return { score: 0.5, n: 0, wins: 0, setsLostPerMatch: null };
    let num = 0, den = 0;
    all.forEach((r, i) => { const w = 1 - i * 0.06; num += w * (r.won ? 1 : 0); den += w; });
    const wins = all.filter((r) => r.won).length;
    const run = p.tournamentRun || [];
    const setsLost = run.length ? run.reduce((s, r) => s + (r.setsLost || 0), 0) / run.length : null;
    return { score: num / den, n: all.length, wins, setsLostPerMatch: setsLost };
  };
  const fH = formOf(home), fA = formOf(away);
  const formAdj = (fH.n && fA.n) ? 0.12 * (fH.score - fA.score) : 0;

  // nawierzchnia (bilans w ostatnich meczach na tej nawierzchni)
  const surfRec = (p) => {
    const all = [...(p.tournamentRun || []), ...(p.recent || [])].filter((r) => r.surface === tournament.surface);
    return { won: all.filter((r) => r.won).length, lost: all.filter((r) => !r.won).length, n: all.length };
  };
  const sH = surfRec(home), sA = surfRec(away);
  let surfAdj = 0;
  if (sH.n >= 4 && sA.n >= 4) surfAdj = 0.06 * (sH.won / sH.n - sA.won / sA.n);

  // H2H z pobranych wyników
  const h2hGames = [];
  for (const r of [...(home.recent || []), ...(home.tournamentRun || [])]) if (String(r.opponent?.id) === String(away.id)) h2hGames.push({ ...r, winner: r.won ? 'home' : 'away' });
  for (const r of [...(away.recent || []), ...(away.tournamentRun || [])]) if (String(r.opponent?.id) === String(home.id) && !h2hGames.find((g) => g.id === r.id)) h2hGames.push({ ...r, winner: r.won ? 'away' : 'home' });
  h2hGames.sort((x, y) => new Date(y.date) - new Date(x.date));
  const h2h = { homeWins: h2hGames.filter((g) => g.winner === 'home').length, awayWins: h2hGames.filter((g) => g.winner === 'away').length, games: h2hGames };
  let h2hAdj = 0;
  if (h2hGames.length >= 2) h2hAdj = 0.05 * ((h2h.homeWins - h2h.awayWins) / h2hGames.length);

  const pPre = clamp(pBase + formAdj + surfAdj + h2hAdj, 0.04, 0.96);

  // model Markowa
  const base = tour === 'wta' ? 0.58 : 0.63;
  const edge = solveServeEdge(pPre, base, bestOf);
  const pre = matchWin({ bestOf, pA: edge.pA, pB: edge.pB });

  // stan live
  const setsH = home.score || 0, setsA = away.score || 0;
  const hSets = home.sets || [], aSets = away.sets || [];
  let gH = 0, gA = 0, inTiebreak = false, tbH = 0, tbA = 0;
  const lastIdx = Math.max(hSets.length, aSets.length) - 1;
  if (lastIdx >= 0 && hSets[lastIdx]?.won == null && aSets[lastIdx]?.won == null) {
    gH = hSets[lastIdx]?.games ?? 0; gA = aSets[lastIdx]?.games ?? 0;
    if (gH === 6 && gA === 6) { inTiebreak = true; tbH = hSets[lastIdx]?.tiebreak ?? 0; tbA = aSets[lastIdx]?.tiebreak ?? 0; }
  }
  let live = null;
  if (state === 'in') {
    const r = matchWin({ bestOf, setsA: setsH, setsB: setsA, gA: gH, gB: gA, pA: edge.pA, pB: edge.pB, inTiebreak, tbA: tbH, tbB: tbA });
    live = { home: r.p, away: 1 - r.p, dist: r.dist, setWinNow: r.setWinNow };
  }

  let probs;
  if (state === 'post') probs = { home: home.winner ? 1 : 0, away: away.winner ? 1 : 0 };
  else if (state === 'in' && live) probs = { home: live.home, away: live.away };
  else probs = { home: pre.p, away: 1 - pre.p };

  const spread = Math.abs(probs.home - probs.away);
  let confidence = 0.3 + 0.45 * spread + (home.rank && away.rank ? 0.1 : 0) + (fH.n >= 5 && fA.n >= 5 ? 0.1 : 0);
  if (doubles) confidence -= 0.15;
  if (state === 'post') confidence = 1;
  confidence = clamp(confidence, 0.2, 0.97);

  const ratings = { home: playerRatings(home, fH, sH, live, 'home', setsH, setsA, gH, gA), away: playerRatings(away, fA, sA, live, 'away', setsA, setsH, gA, gH) };
  const factors = buildFactors({ home, away, fH, fA, sH, sA, h2h, tournament, live, setsH, setsA, gH, gA, pRank, pElo, eloUsed });
  const insights = {
    home: playerInsights(home, fH, sH, h2h, 'home', tournament, state, setsH, setsA, gH, gA),
    away: playerInsights(away, fA, sA, h2h, 'away', tournament, state, setsA, setsH, gA, gH),
    match: matchInsights({ item, home, away, pre, live, probs, state, tournament, edge, h2h, setsH, setsA, gH, gA, inTiebreak }),
  };
  if (eloUsed) {
    const loc = eloUsed.surface ? (SURFACE_LOC[tournament.surface] || 'na tej nawierzchni') : 'z ostatnich 12 miesięcy';
    insights.match.splice(1, 0, { kind: 'info', text: `Elo ${loc}: ${home.short} ${eloUsed.home} vs ${away.short} ${eloUsed.away} → ${pct(pElo)} szans dla ${home.short} (${eloUsed.homeN} i ${eloUsed.awayN} meczów w bazie)` });
    const diff = eloUsed.home - eloUsed.away;
    if (Math.abs(diff) >= 80) {
      const strong = diff > 0 ? 'home' : 'away';
      const weak = diff > 0 ? 'away' : 'home';
      insights[strong].unshift({ kind: 'strength', text: `Wyraźnie wyższe Elo ${eloUsed.surface ? loc : ''} (${diff > 0 ? eloUsed.home : eloUsed.away} vs ${diff > 0 ? eloUsed.away : eloUsed.home}) – wyniki z ostatniego roku za tym graczem`, tag: 'elo' });
      insights[weak].push({ kind: 'weakness', text: `Niższe Elo ${eloUsed.surface ? loc : ''} o ${Math.abs(Math.round(diff))} pkt`, tag: 'elo' });
    }
  }
  const dist = (state === 'in' && live ? live.dist : pre.dist);
  const paths = Object.entries(dist).map(([k, p]) => { const [x, y] = k.split('-').map(Number); return { label: `${x}:${y}`, winner: x > y ? 'home' : 'away', p: round3(p) }; }).sort((x, y) => y.p - x.p);

  const verdict = buildVerdict({ home, away, probs, state, setsH, setsA, live });

  return {
    probs: { home: round3(probs.home), away: round3(probs.away) },
    pre: { home: round3(pre.p), away: round3(1 - pre.p) },
    live: live ? { home: round3(live.home), away: round3(live.away), setWinNow: live.setWinNow != null ? round3(live.setWinNow) : null } : null,
    pointWin: { home: round3(edge.pA), away: round3(edge.pB) },
    state: { setsHome: setsH, setsAway: setsA, gamesHome: gH, gamesAway: gA, bestOf, setsToWin: Math.ceil(bestOf / 2), inTiebreak, tbHome: tbH, tbAway: tbA },
    paths,
    confidence: round3(confidence),
    verdict,
    factors,
    insights,
    ratings,
    h2h,
    form: { home: fH, away: fA },
    surface: { home: sH, away: sA },
    components: { rank: round3(pRank), elo: pElo != null ? round3(pElo) : null, base: round3(pBase), form: round3(formAdj), surface: round3(surfAdj), h2h: round3(h2hAdj) },
    elo: eloUsed,
  };
}

function playerRatings(p, form, surf, live, side, mySets, oppSets, myGames, oppGames) {
  const rank = p.rank ? clamp(100 - 12 * Math.log2(p.rank), 5, 100) : 10;
  const forma = clamp(form.n ? form.score * 100 : 50, 5, 100);
  const career = p.career || {};
  const total = (career.won || 0) + (career.lost || 0);
  const skut = total >= 20 ? clamp((career.won / total) * 100, 5, 100) : 50;
  const dosw = clamp(total / 6, 5, 100);
  const tytuly = clamp((career.titles || 0) * 6, 5, 100);
  let turniej = 50;
  if (form.setsLostPerMatch != null) turniej = clamp(100 - form.setsLostPerMatch * 40, 5, 100);
  const naw = surf.n >= 3 ? clamp((surf.won / surf.n) * 100, 5, 100) : 50;
  return {
    ranking: Math.round(rank),
    forma: Math.round(forma),
    skutecznosc: Math.round(skut),
    doswiadczenie: Math.round(dosw),
    turniej: Math.round(turniej),
    nawierzchnia: Math.round(naw),
    tytuly: Math.round(tytuly),
  };
}

function buildFactors({ home, away, fH, fA, sH, sA, h2h, tournament, live, setsH, setsA, gH, gA, pRank, pElo = null, eloUsed = null }) {
  const f = [];
  const sgn = (x) => clamp(x, -1, 1);
  f.push({ key: 'ranking', label: 'Ranking', home: sgn((pRank - 0.5) * 2.2), away: sgn((0.5 - pRank) * 2.2), weight: pElo != null ? 0.22 : 0.35, note: `#${home.rank ?? '—'} vs #${away.rank ?? '—'}` });
  if (pElo != null && eloUsed) f.push({ key: 'elo', label: eloUsed.surface ? `Elo ${SURFACE_LOC[tournament.surface] || 'na nawierzchni'}` : 'Elo (wyniki z 12 mies.)', home: sgn((pElo - 0.5) * 2.2), away: sgn((0.5 - pElo) * 2.2), weight: 0.22, note: `${eloUsed.home} vs ${eloUsed.away} (${eloUsed.homeN} / ${eloUsed.awayN} meczów)` });
  f.push({ key: 'forma', label: 'Forma (ostatnie 10)', home: sgn((fH.score - 0.5) * 2), away: sgn((fA.score - 0.5) * 2), weight: 0.2, note: `${fH.wins}/${fH.n} vs ${fA.wins}/${fA.n} wygranych` });
  if (sH.n >= 3 || sA.n >= 3) f.push({ key: 'nawierzchnia', label: `Bilans ${SURFACE_LOC[tournament.surface] || 'na nawierzchni'}`, home: sH.n ? sgn((sH.won / sH.n - 0.5) * 2) : 0, away: sA.n ? sgn((sA.won / sA.n - 0.5) * 2) : 0, weight: 0.12, note: `${sH.won}-${sH.lost} vs ${sA.won}-${sA.lost}` });
  if (h2h.games.length) f.push({ key: 'h2h', label: 'Bezpośrednie mecze', home: sgn((h2h.homeWins - h2h.awayWins) / h2h.games.length), away: sgn((h2h.awayWins - h2h.homeWins) / h2h.games.length), weight: 0.1, note: `${h2h.homeWins}-${h2h.awayWins}` });
  const cH = home.career || {}, cA = away.career || {};
  const wrH = (cH.won + cH.lost) >= 20 ? cH.won / (cH.won + cH.lost) : null;
  const wrA = (cA.won + cA.lost) >= 20 ? cA.won / (cA.won + cA.lost) : null;
  if (wrH != null && wrA != null) f.push({ key: 'kariera', label: 'Skuteczność w karierze', home: sgn((wrH - wrA) * 4), away: sgn((wrA - wrH) * 4), weight: 0.08, note: `${pct(wrH)} vs ${pct(wrA)}` });
  if (live) {
    const lead = (setsH - setsA) * 0.6 + (gH - gA) * 0.12;
    f.push({ key: 'przebieg', label: 'Stan meczu (live)', home: sgn(lead), away: sgn(-lead), weight: 0.4, note: `sety ${setsH}:${setsA}, gemy ${gH}:${gA}` });
  }
  return f;
}

function playerInsights(p, form, surf, h2h, side, tournament, state, mySets, oppSets, myGames, oppGames) {
  const out = [];
  const push = (kind, text, tag) => out.push({ kind, text, tag });
  if (p.rank) {
    if (p.rank <= 5) push('strength', `Ścisła czołówka rankingu: nr ${p.rank} (${p.rankPoints ? p.rankPoints.toLocaleString('pl-PL') + ' pkt' : ''})`, 'ranking');
    else if (p.rank <= 20) push('strength', `Top 20 rankingu: nr ${p.rank}`, 'ranking');
    else if (p.rank > 100) push('weakness', `Poza setką rankingu (nr ${p.rank})`, 'ranking');
    else push('info', `Nr ${p.rank} w rankingu`, 'ranking');
    if (p.rankPrev && p.rankPrev - p.rank >= 5) push('strength', `Awans w rankingu: z ${p.rankPrev}. na ${p.rank}. miejsce`, 'ranking');
    if (p.rankPrev && p.rank - p.rankPrev >= 5) push('weakness', `Spadek w rankingu: z ${p.rankPrev}. na ${p.rank}. miejsce`, 'ranking');
  } else push('info', 'Brak pozycji w rankingu (kwalifikant / dzika karta / debel)', 'ranking');
  if (p.seed) push('info', `Rozstawienie w turnieju: nr ${p.seed}`, 'ranking');

  if (form.n) {
    const all = [...(p.tournamentRun || []), ...(p.recent || [])].slice(0, 10);
    let streak = 0; for (const r of all) { if (r.won) streak++; else break; }
    let lstreak = 0; for (const r of all) { if (!r.won) lstreak++; else break; }
    if (streak >= 4) push('strength', `Seria ${streak} wygranych meczów z rzędu`, 'forma');
    else if (form.wins / form.n >= 0.7) push('strength', `Dobra forma: ${plural(form.wins, WYGRANE)} z ostatnich ${plural(form.n, MECZE)}`, 'forma');
    if (lstreak >= 2) push('weakness', `${plural(lstreak, ['porażka', 'porażki', 'porażek'])} z rzędu`, 'forma');
    else if (form.wins / form.n <= 0.4) push('weakness', `Słaba forma: tylko ${plural(form.wins, WYGRANE)} z ostatnich ${plural(form.n, MECZE)}`, 'forma');
    const run = p.tournamentRun || [];
    if (run.length >= 2) {
      const setsLost = run.reduce((s, r) => s + (r.setsLost || 0), 0);
      if (setsLost === 0) push('strength', `W tym turnieju nie stracił(a) jeszcze seta (${plural(run.length, MECZE)})`, 'turniej');
      else if (setsLost / run.length >= 1) push('warning', `Wymagająca droga w turnieju: ${plural(setsLost, SETY)} stracone w ${plural(run.length, MECZE)} – możliwe zmęczenie`, 'turniej');
      else push('info', `W turnieju: ${run.length} wygranych, ${plural(setsLost, SETY)} stracone`, 'turniej');
      const upset = run.find((r) => r.opponent?.rank && p.rank && r.opponent.rank < p.rank);
      if (upset) push('strength', `Pokonał(a) wyżej notowanego rywala: ${upset.opponent.name} (nr ${upset.opponent.rank})`, 'turniej');
      const tough = run.filter((r) => r.retired).length;
      if (tough) push('info', 'Jeden z meczów zakończył się kreczem rywala', 'turniej');
    }
    const ret = all.find((r) => !r.won && r.retired);
    if (ret) push('warning', 'Niedawny krecz – możliwe problemy zdrowotne', 'forma');
  } else push('info', 'Brak danych o ostatnich meczach', 'forma');

  if (surf.n >= 4) {
    const wr = surf.won / surf.n;
    const loc = SURFACE_LOC[tournament.surface] || 'na tej nawierzchni';
    if (wr >= 0.7) push('strength', `Świetnie ${loc}: ${surf.won}-${surf.lost} w ostatnich meczach`, 'nawierzchnia');
    else if (wr <= 0.4) push('weakness', `Słabiej ${loc}: ${surf.won}-${surf.lost} w ostatnich meczach`, 'nawierzchnia');
    else push('info', `Bilans ${loc}: ${surf.won}-${surf.lost}`, 'nawierzchnia');
  }

  const c = p.career || {};
  const tot = (c.won || 0) + (c.lost || 0);
  if (tot >= 20) {
    const wr = c.won / tot;
    if (wr >= 0.72) push('strength', `Bilans kariery ${c.won}-${c.lost} (${pct(wr)}) – zawodnik z najwyższej półki`, 'kariera');
    else if (wr < 0.5) push('weakness', `Ujemny bilans kariery: ${c.won}-${c.lost}`, 'kariera');
    else push('info', `Bilans kariery ${c.won}-${c.lost} (${pct(wr)})`, 'kariera');
    if (c.titles >= 10) push('strength', `${plural(c.titles, TYTULY)} singlowe w karierze`, 'kariera');
    else if (c.titles >= 1) push('info', `${plural(c.titles, TYTULY)} singlowe`, 'kariera');
  } else if (tot > 0) push('info', `Niewielkie doświadczenie: ${tot} meczów w tourze`, 'kariera');

  if (p.hand === 'Leworęczny') push('info', 'Leworęczny – nietypowa rotacja, trudny serwis na przewagi', 'profil');
  if (p.age && p.age <= 21) push('info', `Młody wiek: ${lata(p.age)} – duży potencjał, mniej rutyny`, 'profil');
  if (p.age && p.age >= 33) push('warning', `Wiek: ${lata(p.age)} – w długich meczach może brakować świeżości`, 'profil');
  if (p.heightCm && p.heightCm >= 196) push('strength', `Bardzo wysoki (${p.heightCm} cm) – potężny serwis`, 'profil');

  if (h2h.games.length) {
    const w = side === 'home' ? h2h.homeWins : h2h.awayWins;
    const l = side === 'home' ? h2h.awayWins : h2h.homeWins;
    push(w > l ? 'strength' : w < l ? 'weakness' : 'info', `Bezpośrednie mecze: ${w}-${l}`, 'h2h');
  }

  if (state === 'in') {
    if (mySets > oppSets) push('strength', `Prowadzi ${mySets}:${oppSets} w setach`, 'live');
    else if (mySets < oppSets) push('warning', `Przegrywa ${mySets}:${oppSets} w setach – musi odrabiać`, 'live');
    if (myGames - oppGames >= 2) push('strength', `Ma przełamanie w bieżącym secie (${myGames}:${oppGames})`, 'live');
    if (oppGames - myGames >= 2) push('weakness', `Stracił(a) serwis w bieżącym secie (${myGames}:${oppGames})`, 'live');
  }
  const order = { strength: 0, weakness: 1, warning: 2, info: 3 };
  out.sort((x, y) => order[x.kind] - order[y.kind]);
  return out.slice(0, 10);
}

function matchInsights({ item, home, away, pre, live, probs, state, tournament, edge, h2h, setsH, setsA, gH, gA, inTiebreak }) {
  const out = [];
  const push = (kind, text) => out.push({ kind, text });
  const hn = home.short, an = away.short;
  const fav = probs.home >= probs.away ? 'home' : 'away';
  push('info', `${tournament.category} · ${tournament.name} · ${tournament.round || ''} · nawierzchnia ${tournament.surfacePl} · do ${Math.ceil(tournament.bestOf / 2)} wygranych setów`);
  if (state === 'pre') {
    push('info', `Faworyt: ${fav === 'home' ? hn : an} – ${pct(probs[fav])} szans na zwycięstwo`);
    push('info', `Model: szansa wygrania punktu na własnym serwisie ${pct(edge.pA)} (${hn}) vs ${pct(edge.pB)} (${an})`);
    if (Math.abs(probs.home - probs.away) < 0.12) push('warning', 'Bardzo wyrównane zestawienie – decydować mogą detale (serwis, tie-breaki)');
  } else if (state === 'in' && live) {
    push('info', `Stan: sety ${setsH}:${setsA}, gemy ${gH}:${gA}${inTiebreak ? ' (tie-break)' : ''}. Szanse teraz: ${hn} ${pct(live.home)} · ${an} ${pct(live.away)}`);
    push('info', `Przed meczem model dawał ${pct(pre.p)} dla ${hn}`);
    if (live.setWinNow != null) push('info', `Bieżący set: ${hn} ${pct(live.setWinNow)} · ${an} ${pct(1 - live.setWinNow)}`);
    const swing = live.home - pre.p;
    if (Math.abs(swing) >= 0.25) push('warning', `Duży zwrot: ${swing > 0 ? hn : an} zyskał(a) ${pct(Math.abs(swing))} względem prognozy`);
    if (inTiebreak) push('warning', 'Tie-break w toku – loteria, każdy punkt waży bardzo dużo');
  } else if (state === 'post') {
    const w = home.winner ? home : away;
    push('info', `${w.short} wygrywa mecz${item.note ? `: ${item.note.replace(/^.*?\)\s*/, '')}` : ''}`);
    const modelFav = pre.p >= 0.5 ? 'home' : 'away';
    const actual = home.winner ? 'home' : 'away';
    push(modelFav === actual ? 'strength' : 'weakness', modelFav === actual ? `Model trafnie wskazał zwycięzcę (${pct(modelFav === 'home' ? pre.p : 1 - pre.p)})` : `Niespodzianka – model dawał ${pct(actual === 'home' ? pre.p : 1 - pre.p)} zwycięzcy`);
  }
  if (h2h.games.length) push('info', `Bezpośrednie mecze: ${h2h.homeWins}-${h2h.awayWins} (${plural(h2h.games.length, MECZE)} w bazie)`);
  if (item.doubles) push('warning', 'Debel – model traktuje parę jak jednego gracza (mniejsza pewność)');
  return out;
}

function buildVerdict({ home, away, probs, state, setsH, setsA, live }) {
  const hn = home.short, an = away.short;
  const fav = probs.home >= probs.away ? 'home' : 'away';
  const p = probs[fav];
  if (state === 'post') return { winner: home.winner ? 'home' : 'away', text: `${home.winner ? hn : an} wygrywa ${home.winner ? `${setsH}:${setsA}` : `${setsA}:${setsH}`}`, sub: 'Mecz zakończony' };
  if (state === 'in') return { winner: fav, text: p >= 0.85 ? `${fav === 'home' ? hn : an} kontroluje mecz (${pct(p)})` : `${fav === 'home' ? hn : an} bliżej wygranej (${pct(p)})`, sub: `Sety ${setsH}:${setsA}` };
  if (p < 0.56) return { winner: fav, text: `Wyrównany mecz – lekka przewaga ${fav === 'home' ? hn : an} (${pct(p)})`, sub: 'Niska pewność' };
  if (p >= 0.75) return { winner: fav, text: `Zdecydowany faworyt: ${fav === 'home' ? hn : an} (${pct(p)})`, sub: 'Wysoka pewność' };
  return { winner: fav, text: `Faworyt: ${fav === 'home' ? hn : an} (${pct(p)})`, sub: 'Umiarkowana pewność' };
}
