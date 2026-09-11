// Piłka nożna: pobranie szczegółów meczu + silnik analizy (Poisson, forma, tabela, H2H, kursy, live)
import { SITE, SITE_V2, getJSON, leagueBySlug, fetchFootballLeague, normalizeFootballEvent, moneylineToProbs, localDateKey, shiftDateKey } from './espn.mjs';
import { plural, pct, f1, f2, clamp, round3, wMeczach, gen, MECZE, GOLE, ZWYC, PORAZKI } from './text.mjs';
import { matchNews } from './news.mjs';
import { DEFAULT_PARAMS, teamStrength, expectedGoals, predict, argmax, eloWinProb } from '../pipeline/model.mjs';
import { ensureRatings, teamElo, teamXg, modelParams } from './ratings.mjs';

const STAT_LABELS = {
  possessionPct: 'Posiadanie piłki (%)',
  totalShots: 'Strzały',
  shotsOnTarget: 'Strzały celne',
  blockedShots: 'Strzały zablokowane',
  wonCorners: 'Rzuty rożne',
  offsides: 'Spalone',
  foulsCommitted: 'Faule',
  yellowCards: 'Żółte kartki',
  redCards: 'Czerwone kartki',
  saves: 'Obrony bramkarza',
  totalPasses: 'Podania',
  accuratePasses: 'Celne podania',
  passPct: 'Celność podań (%)',
  totalCrosses: 'Dośrodkowania',
  accurateCrosses: 'Celne dośrodkowania',
  totalLongBalls: 'Długie podania',
  accurateLongBalls: 'Celne długie podania',
  totalTackles: 'Odbiory',
  effectiveTackles: 'Skuteczne odbiory',
  interceptions: 'Przechwyty',
  totalClearance: 'Wybicia',
};
const STAT_ORDER = Object.keys(STAT_LABELS);

const POS_PL = {
  G: 'BR', GK: 'BR', D: 'OB', CD: 'ŚO', 'CD-L': 'ŚO', 'CD-R': 'ŚO', LB: 'LO', RB: 'PO', LWB: 'LWO', RWB: 'PWO', SW: 'LIB',
  M: 'POM', CM: 'ŚP', 'CM-L': 'ŚP', 'CM-R': 'ŚP', DM: 'DP', 'DM-L': 'DP', 'DM-R': 'DP', AM: 'OP', 'AM-L': 'LP', 'AM-R': 'PP', LM: 'LP', RM: 'PP', LW: 'LS', RW: 'PS',
  F: 'NAP', CF: 'NAP', 'CF-L': 'NAP', 'CF-R': 'NAP', ST: 'NAP', SUB: 'REZ',
};

// ---------- pobieranie ----------
export async function getFootballMatch(slug, id) {
  const league = leagueBySlug.get(slug) || { slug, name: slug, region: '', tier: 4 };
  const [summary] = await Promise.all([getJSON(`${SITE}/soccer/${slug}/summary?event=${id}`, 20_000), ensureRatings().catch(() => null)]);
  const header = summary.header || {};
  const comp = header.competitions?.[0] || {};
  const state = comp.status?.type?.state || 'pre';
  const dateKey = localDateKey(comp.date || new Date().toISOString());

  // element listy (ze scoreboardu – ma kursy, formę, statystyki live)
  let item = null;
  try {
    const list = await fetchFootballLeague(slug, shiftDateKey(dateKey, -1), shiftDateKey(dateKey, 1));
    item = list.find((m) => m.id === String(id)) || null;
  } catch { /* fallback niżej */ }
  if (!item) {
    item = normalizeFootballEvent({ id: header.id, date: comp.date, name: '', shortName: '', status: comp.status, competitions: [{ competitors: comp.competitors, status: comp.status, venue: summary.gameInfo?.venue, odds: summary.odds }] }, league);
  }
  if (!item.market && summary.odds?.[0]) {
    const o = summary.odds[0];
    item.market = moneylineToProbs({ home: o.homeTeamOdds?.moneyLine, away: o.awayTeamOdds?.moneyLine, draw: o.drawOdds?.moneyLine });
    if (item.market) item.market.overUnder = o.overUnder;
  }

  const homeId = item.home.id, awayId = item.away.id;
  const [standingsRaw, homeInfo, awayInfo, homeSquad, awaySquad, news] = await Promise.all([
    getJSON(`${SITE_V2}/soccer/${slug}/standings`, 10 * 60_000).catch(() => null),
    getJSON(`${SITE}/soccer/${slug}/teams/${homeId}`, 30 * 60_000).catch(() => null),
    getJSON(`${SITE}/soccer/${slug}/teams/${awayId}`, 30 * 60_000).catch(() => null),
    getJSON(`${SITE}/soccer/${slug}/teams/${homeId}/roster`, 6 * 60 * 60_000).catch(() => null),
    getJSON(`${SITE}/soccer/${slug}/teams/${awayId}/roster`, 6 * 60 * 60_000).catch(() => null),
    state === 'post' ? Promise.resolve(null) : matchNews(item.home.name, item.away.name).catch(() => null),
  ]);

  const standings = normalizeStandings(standingsRaw, homeId, awayId) || normalizeSummaryStandings(summary.standings, homeId, awayId);
  const stats = normalizeStats(summary.boxscore);
  const lineups = normalizeLineups(summary.rosters, homeId, awayId, { [homeId]: squadPositions(homeSquad), [awayId]: squadPositions(awaySquad) }, id);
  const events = normalizeEvents(comp.details || summary.keyEvents, homeId, awayId);
  const lastFive = normalizeLastFive(summary.lastFiveGames, homeId, awayId);
  const h2h = normalizeH2H(summary.seasonseries, homeId, awayId);
  const records = { home: normalizeRecord(homeInfo), away: normalizeRecord(awayInfo) };
  const squads = { home: normalizeSquad(homeSquad), away: normalizeSquad(awaySquad) };

  const teams = {
    home: { ...item.home, lastFive: lastFive.home, record: records.home, table: standings?.byTeam?.[homeId] || null, squad: squads.home, formation: lineups.home?.formation },
    away: { ...item.away, lastFive: lastFive.away, record: records.away, table: standings?.byTeam?.[awayId] || null, squad: squads.away, formation: lineups.away?.formation },
  };

  // absencje: kto z podstawowego składu (ostatnie 5 meczów) nie wyszedł dziś w jedenastce
  const absences = state === 'post' ? null : await detectAbsences(slug, teams, lineups).catch(() => null);

  const analysis = analyzeFootball({ item, teams, stats, events, lineups, standings, h2h, state, news, absences });

  return {
    summary: item,
    teams,
    stats,
    events,
    lineups,
    absences,
    news: news ? { home: news.home.headlines, away: news.away.headlines, signal: { home: { neg: news.home.neg, pos: news.home.pos }, away: { neg: news.away.neg, pos: news.away.pos } } } : null,
    standings: standings?.rows || [],
    standingsNote: standings?.groupName,
    h2h,
    venue: summary.gameInfo?.venue?.fullName || item.venue,
    city: summary.gameInfo?.venue?.address?.city,
    referee: summary.gameInfo?.officials?.find((o) => /referee/i.test(o.position?.name || ''))?.displayName,
    attendance: comp.attendance || summary.gameInfo?.attendance,
    analysis,
    fetchedAt: new Date().toISOString(),
  };
}

// ---------- absencje (podstawowy skład z ostatnich meczów vs dzisiejsza jedenastka) ----------
async function regularsFor(team, slug) {
  const games = (team.lastFive || []).slice(0, 5);
  if (games.length < 3) return null;
  const sums = await Promise.all(games.map((g) => getJSON(`${SITE}/soccer/${slug}/summary?event=${g.id}`, 12 * 60 * 60_000).catch(() => null)));
  const counts = new Map();
  let n = 0;
  for (const s of sums) {
    const r = (s?.rosters || []).find((x) => String(x.team?.id) === String(team.id));
    if (!r) continue;
    const starters = (r.roster || []).filter((p) => p.starter);
    if (starters.length < 7) continue;
    n++;
    for (const p of starters) {
      const aid = p.athlete?.id;
      if (!aid) continue;
      const c = counts.get(aid) || { id: aid, name: p.athlete?.displayName || p.athlete?.shortName || '?', starts: 0, pos: POS_PL[p.position?.abbreviation] || p.position?.abbreviation || '' };
      c.starts++;
      counts.set(aid, c);
    }
  }
  if (n < 3) return null;
  return { n, regulars: [...counts.values()].filter((c) => c.starts >= Math.ceil(n * 0.6)) };
}

async function detectAbsences(slug, teams, lineups) {
  const out = { home: null, away: null };
  await Promise.all(['home', 'away'].map(async (side) => {
    const lu = lineups[side];
    if (!lu || lu.starters.length < 11) return;
    const reg = await regularsFor(teams[side], slug);
    if (!reg) return;
    const starters = new Set(lu.starters.map((p) => String(p.id)));
    const bench = new Set(lu.subs.map((p) => String(p.id)));
    const missing = reg.regulars.filter((r) => !starters.has(String(r.id))).map((r) => ({ name: r.name, pos: r.pos, starts: r.starts, of: reg.n, onBench: bench.has(String(r.id)) }));
    const missingCount = missing.reduce((s, m) => s + (m.onBench ? 0.5 : 1), 0);
    out[side] = { matches: reg.n, regulars: reg.regulars.length, missing, missingCount };
  }));
  return out.home || out.away ? out : null;
}

// ---------- normalizacja ----------
const statVal = (arr, name) => {
  const s = (arr || []).find((x) => x.name === name);
  if (!s) return null;
  const v = Number(String(s.displayValue ?? s.value).replace(',', '.'));
  return Number.isFinite(v) ? v : null;
};

function normalizeStandings(raw, homeId, awayId) {
  if (!raw?.children?.length) return null;
  let group = raw.children.find((c) => c.standings?.entries?.some((e) => e.team?.id === homeId || e.team?.id === awayId)) || raw.children[0];
  const entries = group.standings?.entries || [];
  if (!entries.length) return null;
  const rows = entries.map((e) => {
    const st = e.stats || [];
    const row = {
      id: e.team?.id,
      name: e.team?.displayName || e.team?.name,
      short: e.team?.shortDisplayName || e.team?.abbreviation,
      logo: e.team?.logos?.[0]?.href,
      gp: statVal(st, 'gamesPlayed') ?? 0,
      w: statVal(st, 'wins') ?? 0,
      d: statVal(st, 'ties') ?? 0,
      l: statVal(st, 'losses') ?? 0,
      gf: statVal(st, 'pointsFor') ?? 0,
      ga: statVal(st, 'pointsAgainst') ?? 0,
      gd: statVal(st, 'pointDifferential') ?? 0,
      pts: statVal(st, 'points') ?? 0,
      rank: statVal(st, 'rank') ?? 0,
      note: e.note?.description,
      noteColor: e.note?.color,
    };
    return row;
  });
  rows.sort((a, b) => (a.rank || 99) - (b.rank || 99) || b.pts - a.pts);
  rows.forEach((r, i) => { if (!r.rank) r.rank = i + 1; });
  const byTeam = Object.fromEntries(rows.map((r) => [r.id, { ...r, teams: rows.length }]));
  return { rows, byTeam, groupName: group.name };
}

function normalizeSummaryStandings(st, homeId, awayId) {
  const groups = st?.groups || [];
  const group = groups.find((g) => g.standings?.entries?.some((e) => e.id === homeId || e.id === awayId)) || groups.find((g) => g.standings?.entries?.length);
  const entries = group?.standings?.entries || [];
  if (!entries.length) return null;
  const rows = entries.map((e) => ({
    id: e.id, name: e.team, short: e.team, logo: e.logo?.[0]?.href,
    gp: statVal(e.stats, 'gamesPlayed') ?? 0, w: statVal(e.stats, 'wins') ?? 0, d: statVal(e.stats, 'ties') ?? 0, l: statVal(e.stats, 'losses') ?? 0,
    gf: 0, ga: 0, gd: statVal(e.stats, 'pointDifferential') ?? 0, pts: statVal(e.stats, 'points') ?? 0, rank: statVal(e.stats, 'rank') ?? 0,
  }));
  rows.sort((a, b) => (a.rank || 99) - (b.rank || 99));
  return { rows, byTeam: Object.fromEntries(rows.map((r) => [r.id, { ...r, teams: rows.length, noGoals: true }])), groupName: group?.header };
}

function normalizeStats(boxscore) {
  const teams = boxscore?.teams || [];
  if (teams.length < 2) return [];
  const home = teams.find((t) => t.homeAway === 'home') || teams[0];
  const away = teams.find((t) => t.homeAway === 'away') || teams[1];
  const rows = [];
  for (const key of STAT_ORDER) {
    let h = statVal(home.statistics, key), a = statVal(away.statistics, key);
    if (h == null && a == null) continue;
    const pctType = key === 'possessionPct' || key.endsWith('Pct');
    // ESPN podaje passPct/crossPct itd. jako ułamek 0–1 (posiadanie już w %)
    if (pctType && key !== 'possessionPct') {
      if (h != null && h <= 1) h = h * 100;
      if (a != null && a <= 1) a = a * 100;
    }
    rows.push({ key, label: STAT_LABELS[key], home: h ?? 0, away: a ?? 0, pctType });
  }
  return rows;
}

// pozycje zawodników z kadry drużyny (fallback, gdy ESPN w trakcie meczu zwraca "SUB" dla wszystkich)
function squadPositions(roster) {
  const map = {};
  for (const a of roster?.athletes || []) {
    if (a.id && a.position?.abbreviation) map[a.id] = { abbreviation: a.position.abbreviation, name: a.position.name };
  }
  return map;
}

// pamięć pozycji z przedmeczowego składu (ESPN potrafi je zgubić w trakcie meczu)
const lineupMemory = new Map();

function normalizeLineups(rosters, homeId, awayId, squadPos = {}, eventId = '') {
  const out = { home: null, away: null };
  const memKey = `${eventId}`;
  const remembered = lineupMemory.get(memKey) || {};
  const learned = {};
  for (const r of rosters || []) {
    const side = r.team?.id === homeId || r.homeAway === 'home' ? 'home' : 'away';
    const teamId = r.team?.id || (side === 'home' ? homeId : awayId);
    const fromSquad = squadPos[teamId] || {};
    const players = (r.roster || []).map((p) => {
      const st = p.stats || [];
      const aid = p.athlete?.id;
      let abbr = p.position?.abbreviation || '';
      let posName = p.position?.name;
      let fp = Number(p.formationPlace) || 0;
      const isStarter = !!p.starter;
      const degraded = !abbr || abbr === 'SUB';
      if (!degraded && isStarter && aid) learned[aid] = { abbreviation: abbr, name: posName, formationPlace: fp };
      if (degraded && aid) {
        const mem = remembered[aid];
        if (mem) { abbr = mem.abbreviation; posName = mem.name; fp = fp || mem.formationPlace; }
        else if (fromSquad[aid] && isStarter) { abbr = fromSquad[aid].abbreviation; posName = fromSquad[aid].name; }
        else if (isStarter) { abbr = ''; posName = undefined; }
      }
      return {
        id: aid,
        name: p.athlete?.displayName || p.athlete?.fullName,
        short: p.athlete?.shortName || p.athlete?.displayName,
        jersey: p.jersey,
        position: abbr,
        positionPl: isStarter && abbr === 'SUB' ? '' : (POS_PL[abbr] || abbr || ''),
        positionName: posName,
        starter: isStarter,
        formationPlace: fp,
        subbedIn: !!p.subbedIn,
        subbedOut: !!p.subbedOut,
        stats: {
          goals: statVal(st, 'totalGoals') ?? 0,
          assists: statVal(st, 'goalAssists') ?? 0,
          shots: statVal(st, 'totalShots') ?? 0,
          shotsOnTarget: statVal(st, 'shotsOnTarget') ?? 0,
          saves: statVal(st, 'saves') ?? 0,
          yellow: statVal(st, 'yellowCards') ?? 0,
          red: statVal(st, 'redCards') ?? 0,
          fouls: statVal(st, 'foulsCommitted') ?? 0,
          foulsSuffered: statVal(st, 'foulsSuffered') ?? 0,
          passes: statVal(st, 'totalPasses') ?? 0,
          accuratePasses: statVal(st, 'accuratePasses') ?? 0,
          tackles: statVal(st, 'totalTackles') ?? 0,
          goalsConceded: statVal(st, 'goalsConceded') ?? 0,
          ownGoals: statVal(st, 'ownGoals') ?? 0,
          offsides: statVal(st, 'offsides') ?? 0,
        },
      };
    });
    out[side] = {
      formation: r.formation || null,
      starters: players.filter((p) => p.starter).sort((a, b) => a.formationPlace - b.formationPlace),
      subs: players.filter((p) => !p.starter),
    };
  }
  if (Object.keys(learned).length) {
    lineupMemory.set(memKey, { ...remembered, ...learned });
    if (lineupMemory.size > 500) lineupMemory.delete(lineupMemory.keys().next().value);
  }
  return out;
}

function normalizeEvents(details, homeId, awayId) {
  const out = [];
  for (const d of details || []) {
    const text = d.type?.text || d.type?.type || '';
    let kind = 'other';
    if (d.redCard || /red card/i.test(text)) kind = 'red';
    else if (d.yellowCard || /yellow card/i.test(text)) kind = 'yellow';
    else if (/substitution/i.test(text)) kind = 'sub';
    else if (d.ownGoal || /own goal/i.test(text)) kind = 'owngoal';
    else if (/penalty.*missed|missed penalty|saved/i.test(text)) kind = 'penmiss';
    else if (d.shootout) kind = d.scoringPlay ? 'shootout-goal' : 'shootout-miss';
    else if (d.penaltyKick && d.scoringPlay) kind = 'pengoal';
    else if (d.scoringPlay || /goal/i.test(text)) kind = 'goal';
    else if (/var/i.test(text)) kind = 'var';
    const clockVal = d.clock?.value ?? 0;
    out.push({
      kind,
      minute: d.clock?.displayValue || `${Math.round(clockVal / 60)}'`,
      minuteNum: clockVal / 60,
      team: d.team?.id === homeId ? 'home' : d.team?.id === awayId ? 'away' : 'none',
      players: (d.athletesInvolved || []).map((a) => a.shortName || a.displayName),
      text: d.text || text,
      typeText: text,
    });
  }
  out.sort((a, b) => a.minuteNum - b.minuteNum);
  return out;
}

function normalizeLastFive(lastFive, homeId, awayId) {
  const out = { home: [], away: [] };
  for (const block of lastFive || []) {
    const tid = block.team?.id;
    const side = tid === homeId ? 'home' : tid === awayId ? 'away' : null;
    if (!side) continue;
    out[side] = (block.events || []).map((e) => {
      const isHome = e.homeTeamId === tid;
      const gf = Number(isHome ? e.homeTeamScore : e.awayTeamScore);
      const ga = Number(isHome ? e.awayTeamScore : e.homeTeamScore);
      return {
        id: e.id,
        date: e.gameDate,
        opponent: { id: e.opponent?.id, name: e.opponent?.displayName, short: e.opponent?.abbreviation, logo: e.opponent?.logos?.[0]?.href || (e.opponent?.id ? `https://a.espncdn.com/i/teamlogos/soccer/500/${e.opponent.id}.png` : undefined) },
        homeAway: isHome ? 'H' : 'A',
        gf: Number.isFinite(gf) ? gf : 0,
        ga: Number.isFinite(ga) ? ga : 0,
        result: e.gameResult || (gf > ga ? 'W' : gf < ga ? 'L' : 'D'),
        competition: e.leagueName || e.competitionName,
        round: e.roundName,
      };
    }).sort((a, b) => new Date(b.date) - new Date(a.date));
  }
  return out;
}

function normalizeH2H(series, homeId, awayId) {
  const s = (series || []).find((x) => x.type === 'head-to-head') || series?.[0];
  if (!s) return { games: [], summary: null };
  const games = (s.events || []).map((e) => {
    const h = (e.competitors || []).find((c) => c.homeAway === 'home') || e.competitors?.[0];
    const a = (e.competitors || []).find((c) => c.homeAway === 'away') || e.competitors?.[1];
    return {
      id: e.id,
      date: e.date,
      home: { id: h?.team?.id, name: h?.team?.displayName, short: h?.team?.abbreviation, logo: h?.team?.logo, score: Number(h?.score ?? 0) },
      away: { id: a?.team?.id, name: a?.team?.displayName, short: a?.team?.abbreviation, logo: a?.team?.logo, score: Number(a?.score ?? 0) },
      completed: e.statusType?.completed !== false,
    };
  }).filter((g) => g.completed).sort((a, b) => new Date(b.date) - new Date(a.date));
  let homeWins = 0, awayWins = 0, draws = 0, homeGoals = 0, awayGoals = 0;
  for (const g of games) {
    const hs = g.home.id === homeId ? g.home.score : g.away.score;
    const as = g.home.id === homeId ? g.away.score : g.home.score;
    homeGoals += hs; awayGoals += as;
    if (hs > as) homeWins++; else if (hs < as) awayWins++; else draws++;
  }
  return { games, summary: games.length ? { homeWins, awayWins, draws, homeGoals, awayGoals, total: games.length } : null };
}

function normalizeRecord(info) {
  const stats = info?.team?.record?.items?.[0]?.stats;
  if (!stats) return null;
  const v = (n) => Number((stats.find((s) => s.name === n) || {}).value ?? 0);
  return {
    overall: { gp: v('gamesPlayed'), w: v('wins'), d: v('ties'), l: v('losses'), gf: v('pointsFor'), ga: v('pointsAgainst'), pts: v('points') },
    home: { gp: v('homeGamesPlayed'), w: v('homeWins'), d: v('homeTies'), l: v('homeLosses'), gf: v('homePointsFor'), ga: v('homePointsAgainst') },
    away: { gp: v('awayGamesPlayed'), w: v('awayWins'), d: v('awayTies'), l: v('awayLosses'), gf: v('awayPointsFor'), ga: v('awayPointsAgainst') },
    rank: v('rank') || null,
    streak: v('streak'),
  };
}

function normalizeSquad(roster) {
  const ath = roster?.athletes;
  if (!ath?.length) return null;
  const ages = ath.map((a) => a.age).filter((x) => Number.isFinite(x));
  const byPos = {};
  for (const a of ath) {
    const p = a.position?.abbreviation || '?';
    byPos[p] = (byPos[p] || 0) + 1;
  }
  return { size: ath.length, avgAge: ages.length ? ages.reduce((s, x) => s + x, 0) / ages.length : null, byPos };
}

// ---------- model (rdzeń w pipeline/model.mjs – te same wagi co w backteście) ----------
/** Stan drużyny z danych ESPN -> format modelu */
function stateOf(team, side) {
  const t = team.table;
  const r = team.record?.overall;
  let gp = 0, gf = 0, ga = 0, pts = 0, noGoals = false;
  if (t && t.gp > 0 && !t.noGoals) { gp = t.gp; gf = t.gf; ga = t.ga; pts = t.pts; }
  else if (r && r.gp > 0) { gp = r.gp; gf = r.gf; ga = r.ga; pts = r.pts; }
  else if (t && t.gp > 0) { gp = t.gp; pts = t.pts; noGoals = true; }
  return {
    gp, gf, ga, pts, noGoals,
    last5: (team.lastFive || []).slice(0, 5).map((g) => ({ gf: g.gf, ga: g.ga, result: g.result, date: g.date })),
    split: team.record?.[side] || null,
    overall: r || null,
    table: t ? { rank: t.rank, teams: t.teams, gp: t.gp } : null,
  };
}

function liveMinute(item) {
  const st = item.statusDetail || '';
  const clock = item.clock || '';
  const m = clock.match(/(\d+)'(?:\+(\d+)')?/);
  let minute = m ? Number(m[1]) + (m[2] ? Number(m[2]) : 0) : 0;
  if (/halftime|przerwa/i.test(st) || /HALFTIME/i.test(st)) minute = 45;
  return minute;
}

export function analyzeFootball({ item, teams, stats, events, lineups, standings, h2h, state, news = null, absences = null }) {
  const rows = standings?.rows || [];
  const totGP = rows.reduce((s, r) => s + r.gp, 0);
  const totGF = rows.reduce((s, r) => s + r.gf, 0);
  const leagueAvg = totGP > 0 && totGF > 0 ? clamp(totGF / totGP, 1.0, 1.9) : 1.35;
  const params = modelParams(DEFAULT_PARAMS);

  const H = teamStrength(stateOf(teams.home, 'home'), leagueAvg, 'home', params, item.date);
  const A = teamStrength(stateOf(teams.away, 'away'), leagueAvg, 'away', params, item.date);

  // Elo z historii wyników (pipeline) – wymaga min. 5 meczów w bazie u obu drużyn
  const eloH = teamElo(teams.home.id), eloA = teamElo(teams.away.id);
  const elo = eloH && eloA && eloH.n >= 5 && eloA.n >= 5 ? { home: eloH.elo, away: eloA.elo, diff: eloH.elo - eloA.elo, p: round3(eloWinProb(eloH.elo + 60 - eloA.elo)), n: { home: eloH.n, away: eloA.n } } : null;
  // xG ze strzałów (bieżący sezon) – gdy obie drużyny mają dane
  const xgH = teamXg(teams.home.id), xgA = teamXg(teams.away.id);
  const xg = xgH && xgA ? { home: xgH, away: xgA } : null;

  // H2H: -1..1 (mecze u gospodarza liczą się mocniej)
  const hs = h2h?.summary;
  let h2hScore = 0;
  if (hs && hs.total >= 3) {
    const homeId = teams.home.id;
    let w = 0, score = 0;
    for (const g of h2h.games || []) {
      const homeIsHost = g.home.id === homeId;
      const hsc = homeIsHost ? g.home.score : g.away.score, asc = homeIsHost ? g.away.score : g.home.score;
      const weight = homeIsHost ? 1.5 : 1;
      score += weight * (hsc > asc ? 1 : hsc < asc ? -1 : 0);
      w += weight;
    }
    h2hScore = w ? score / w : 0;
  }
  const h2hAdj = h2hScore * params.h2hWeight;
  // sygnały z sieci: kontuzje / zawieszenia / kryzys obniżają siłę, powroty lekko podnoszą
  const newsAdj = { home: 0, away: 0 };
  if (news) {
    newsAdj.home = -0.04 * Math.min(news.home.neg, 3) + 0.015 * Math.min(news.home.pos, 2);
    newsAdj.away = -0.04 * Math.min(news.away.neg, 3) + 0.015 * Math.min(news.away.pos, 2);
  }
  const absCount = absences ? { home: absences.home?.missingCount || 0, away: absences.away?.missingCount || 0 } : null;

  const { lh, la } = expectedGoals({
    H, A, leagueAvg, params,
    eloDiff: elo ? elo.diff : null,
    h2h: h2hScore,
    xg: xg ? { home: { att: xg.home.att, def: xg.home.def }, away: { att: xg.away.att, def: xg.away.def } } : null,
    absences: absCount,
    news: newsAdj,
    neutral: !!item.neutral,
  });

  // model przedmeczowy (Poisson + korekta Dixona-Colesa na remisy)
  const pre = predict(lh, la, params);
  const preM = pre.matrix;

  // live / post
  const curH = Number(item.home.score ?? 0), curA = Number(item.away.score ?? 0);
  let live = null;
  let momentum = null;
  let minute = 0;
  let cards = { home: { yellow: 0, red: 0 }, away: { yellow: 0, red: 0 } };
  for (const e of events) {
    if (e.team === 'none') continue;
    if (e.kind === 'red') cards[e.team].red++;
    if (e.kind === 'yellow') cards[e.team].yellow++;
  }
  const sv = (k) => { const r = stats.find((s) => s.key === k); return r ? { h: r.home, a: r.away } : null; };

  if (state === 'in') {
    minute = liveMinute(item);
    const total = item.period >= 3 ? 120 : 90;
    const remaining = clamp((total + 4 - minute) / 90, 0.02, 1.4);
    const sot = sv('shotsOnTarget'), sh = sv('totalShots'), possRaw = sv('possessionPct');
    const poss = possRaw && possRaw.h > 0 && possRaw.h < 100 ? possRaw : null;
    let momH = 0.5;
    const share = (x) => (x && x.h + x.a > 0 ? x.h / (x.h + x.a) : 0.5);
    if (statsMeaningful(stats)) momH = 0.5 * share(sot) + 0.3 * share(sh) + 0.2 * (poss ? poss.h / 100 : 0.5);
    const weight = clamp(minute / 45, 0, 1);
    const mFactorH = clamp(1 + (momH - 0.5) * 1.2 * weight, 0.6, 1.4);
    const mFactorA = clamp(1 + (0.5 - momH) * 1.2 * weight, 0.6, 1.4);
    let lhr = lh * remaining * mFactorH;
    let lar = la * remaining * mFactorA;
    if (cards.home.red) { lhr *= 0.75 ** cards.home.red; lar *= 1.15; }
    if (cards.away.red) { lar *= 0.75 ** cards.away.red; lhr *= 1.15; }
    const lv = predict(lhr, lar, params, curH, curA);
    live = { home: lv.home, draw: lv.draw, away: lv.away, over25: lv.over25, btts: lv.btts, topScores: lv.topScores, xgRemaining: { home: lhr, away: lar }, minute, remainingMinutes: Math.max(0, Math.round(total - minute)) };
    momentum = { home: momH, away: 1 - momH, weight };
  }

  // kursy bukmacherskie – tylko do porównania, NIE wchodzą do prognozy
  const market = item.market && item.market.draw != null ? { home: item.market.home, draw: item.market.draw, away: item.market.away } : null;

  let probs;
  if (state === 'post') {
    probs = { home: curH > curA ? 1 : 0, draw: curH === curA ? 1 : 0, away: curA > curH ? 1 : 0 };
  } else if (state === 'in') {
    probs = { home: live.home, draw: live.draw, away: live.away };
  } else {
    probs = { home: pre.home, draw: pre.draw, away: pre.away };
  }

  // pewność: przewaga faworyta + kompletność danych
  const sorted = Object.values(probs).sort((a, b) => b - a);
  const spread = sorted[0] - (sorted[1] ?? 0);
  let confidence = 0.28 + 0.5 * spread
    + (rows.length ? 0.06 : 0)
    + ((teams.home.lastFive?.length ?? 0) >= 5 ? 0.05 : 0) + ((teams.away.lastFive?.length ?? 0) >= 5 ? 0.05 : 0)
    + ((teams.home.record?.overall?.gp ?? 0) >= 5 && (teams.away.record?.overall?.gp ?? 0) >= 5 ? 0.04 : 0)
    + ((h2h?.summary?.total ?? 0) >= 3 ? 0.02 : 0)
    + (news ? 0.02 : 0);
  if (state === 'post') confidence = 1;
  confidence = clamp(confidence, 0.2, 0.97);

  // ratingi (radar)
  const ratings = {
    home: teamRatings(teams.home, H, 'home', cards.home, stats, 'h'),
    away: teamRatings(teams.away, A, 'away', cards.away, stats, 'a'),
  };

  // czynniki
  const factors = buildFactors({ H, A, teams, h2h, market, pre, momentum, cards, state, elo, xg, absences });
  if (news && (news.home.neg || news.away.neg || news.home.pos || news.away.pos)) {
    factors.push({ key: 'siec', label: 'Sygnały z sieci', home: clamp(news.home.score / 3, -1, 1), away: clamp(news.away.score / 3, -1, 1), weight: 0.1, note: `kontuzje/zawieszenia: ${news.home.neg} vs ${news.away.neg} nagłówków` });
  }

  // wnioski
  const insights = {
    home: teamInsights(teams.home, H, 'home', h2h, stats, cards.home, momentum, lineups.home, events, state),
    away: teamInsights(teams.away, A, 'away', h2h, stats, cards.away, momentum, lineups.away, events, state),
    match: matchInsights({ item, teams, pre, live, market, probs, state, lh, la, minute, curH, curA, cards, h2h }),
  };
  if (news) {
    const addNews = (side) => {
      const n = news[side];
      const list = insights[side];
      for (const h of n.headlines.filter((x) => x.tone === 'neg').slice(0, 2)) list.unshift({ kind: 'warning', text: `Z sieci: „${h.title}”${h.source ? ` (${h.source})` : ''}`, tag: 'sieć' });
      for (const h of n.headlines.filter((x) => x.tone === 'pos').slice(0, 1)) list.push({ kind: 'info', text: `Z sieci: „${h.title}”${h.source ? ` (${h.source})` : ''}`, tag: 'sieć' });
      if (list.length > 12) list.length = 12;
    };
    addNews('home'); addNews('away');
  }
  for (const side of ['home', 'away']) {
    const ab = absences?.[side];
    if (!ab) continue;
    const absent = ab.missing.filter((m) => !m.onBench), bench = ab.missing.filter((m) => m.onBench);
    if (absent.length) insights[side].unshift({ kind: 'warning', text: `Brak w kadrze meczowej: ${absent.map((m) => `${m.name}${m.pos ? ` (${m.pos})` : ''}`).join(', ')} – grali w ${absent[0].starts} z ${ab.matches} ostatnich meczów`, tag: 'skład' });
    if (bench.length) insights[side].unshift({ kind: 'info', text: `Na ławce zamiast w podstawie: ${bench.map((m) => m.name).join(', ')} (rotacja)`, tag: 'skład' });
    if (!ab.missing.length) insights[side].push({ kind: 'strength', text: `Pełna podstawowa jedenastka z ostatnich ${ab.matches} meczów`, tag: 'skład' });
  }
  if (elo) {
    const strong = elo.diff >= 0 ? 'home' : 'away';
    const weak = strong === 'home' ? 'away' : 'home';
    const d = Math.abs(elo.diff);
    if (d >= 80) {
      insights[strong].unshift({ kind: 'strength', text: `Wyższe Elo (${strong === 'home' ? elo.home : elo.away} vs ${strong === 'home' ? elo.away : elo.home}) – wyniki z 2 sezonów, także w pucharach, za tą drużyną`, tag: 'elo' });
      insights[weak].push({ kind: 'weakness', text: `Niższe Elo o ${Math.round(d)} pkt`, tag: 'elo' });
    }
  }
  if (xg) {
    for (const side of ['home', 'away']) {
      const x = xg[side];
      const other = teams[side].table;
      if (x.att >= 1.15) insights[side].push({ kind: 'strength', text: `Tworzą dużo sytuacji: xG ${f2(x.xgFor)} na mecz (ze strzałów, ${x.gp} meczów)`, tag: 'xg' });
      if (x.def >= 1.15) insights[side].push({ kind: 'weakness', text: `Dopuszczają rywali do wielu sytuacji: xGA ${f2(x.xgAgainst)} na mecz`, tag: 'xg' });
      if (other && other.gp >= 5 && !other.noGoals) {
        const goalsPer = other.gf / other.gp;
        if (goalsPer - x.xgFor >= 0.45) insights[side].push({ kind: 'warning', text: `Strzelają więcej, niż wynika z sytuacji (${f2(goalsPer)} goli vs xG ${f2(x.xgFor)}) – możliwy spadek skuteczności`, tag: 'xg' });
        if (x.xgFor - goalsPer >= 0.45) insights[side].push({ kind: 'info', text: `Marnują sytuacje (xG ${f2(x.xgFor)} vs ${f2(goalsPer)} goli) – forma strzelecka powinna się poprawić`, tag: 'xg' });
      }
      if (insights[side].length > 12) insights[side].length = 12;
    }
  }

  const keyPlayers = { home: keyPlayersFor(lineups.home, state), away: keyPlayersFor(lineups.away, state) };

  const verdict = buildVerdict({ item, probs, state, curH, curA, live, pre, factors, market });

  return {
    basis: 'analysis', // prognoza wynika wyłącznie z analizy (forma, tabela, dom/wyjazd, H2H, świeżość, stawka, Elo, xG, absencje, sygnały z sieci) – nie z kursów
    params: { source: params === DEFAULT_PARAMS ? 'default' : 'fitted', elo: params.eloWeight, xg: params.xgWeight, form: params.formWeight, homeAtt: params.homeAtt },
    elo,
    xgData: xg ? { home: { xgFor: xg.home.xgFor, xgAgainst: xg.home.xgAgainst, gp: xg.home.gp }, away: { xgFor: xg.away.xgFor, xgAgainst: xg.away.xgAgainst, gp: xg.away.gp } } : null,
    h2hScore: round3(h2hScore),
    context: {
      home: { restDays: H.restDays, matches14: H.matches14, stakes: H.stakes, venueAttack: round3(H.venueAttack), venueDefense: round3(H.venueDefense), attackRecent: round3(H.attackRecent), defenseRecent: round3(H.defenseRecent) },
      away: { restDays: A.restDays, matches14: A.matches14, stakes: A.stakes, venueAttack: round3(A.venueAttack), venueDefense: round3(A.venueDefense), attackRecent: round3(A.attackRecent), defenseRecent: round3(A.defenseRecent) },
    },
    probs: mapRound(probs),
    model: mapRound({ home: pre.home, draw: pre.draw, away: pre.away }),
    live: live ? { ...mapRound({ home: live.home, draw: live.draw, away: live.away }), over25: round3(live.over25), btts: round3(live.btts), topScores: live.topScores.map((s) => ({ ...s, p: round3(s.p) })), xgRemaining: { home: round3(live.xgRemaining.home), away: round3(live.xgRemaining.away) }, minute: live.minute, remainingMinutes: live.remainingMinutes } : null,
    market: market ? mapRound(market) : null,
    xg: { home: round3(lh), away: round3(la) },
    leagueAvgGoals: round3(leagueAvg),
    over25: round3(state === 'in' && live ? live.over25 : pre.over25),
    btts: round3(state === 'in' && live ? live.btts : pre.btts),
    topScores: (state === 'in' && live ? live.topScores : pre.topScores).map((s) => ({ ...s, p: round3(s.p) })),
    scoreMatrix: (state === 'in' && live ? null : preM.slice(0, 6).map((r) => r.slice(0, 6).map(round3))),
    confidence: round3(confidence),
    verdict,
    factors,
    insights,
    ratings,
    keyPlayers,
    momentum: momentum ? { home: round3(momentum.home), away: round3(momentum.away) } : null,
    newsAdj: { home: round3(newsAdj.home), away: round3(newsAdj.away) },
    strengths: { home: { attack: round3(H.attack), defense: round3(A.defense), ppg: round3(H.ppg), form: round3(H.formScore) }, away: { attack: round3(A.attack), defense: round3(A.defense), ppg: round3(A.ppg), form: round3(A.formScore) } },
  };
}

const mapRound = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, round3(v)]));

function teamRatings(team, S, side, cards, stats, key) {
  const lf = team.lastFive || [];
  const nonLoss = lf.length ? lf.filter((g) => g.result !== 'L').length / lf.length : 0.5;
  const gdPer = S.gp ? (S.gf - S.ga) / S.gp : 0;
  const split = team.record?.[side];
  // atut boiska z regularyzacją (małe próbki ciągną do średniej ligowej ~1,35 pkt/mecz)
  const venue = split && split.gp ? ((split.w * 3 + split.d + 1.35 * 3) / (split.gp + 3)) / 3 : S.ppg / 3;
  return {
    atak: Math.round(clamp(S.attack * 50, 5, 100)),
    obrona: Math.round(clamp((2 - S.defense) * 50, 5, 100)),
    forma: Math.round(clamp(S.formScore * 100, 5, 100)),
    boisko: Math.round(clamp(venue * 100, 5, 100)),
    bilans: Math.round(clamp((gdPer + 2) / 4 * 100, 5, 100)),
    stabilnosc: Math.round(clamp(nonLoss * 100, 5, 100)),
  };
}

function buildFactors({ H, A, teams, h2h, market, pre, momentum, cards, state, elo = null, xg = null, absences = null }) {
  const f = [];
  const sgn = (x) => clamp(x, -1, 1);
  if (elo) f.push({ key: 'elo', label: 'Elo (wyniki z 2 sezonów)', home: sgn((elo.p - 0.5) * 2.5), away: sgn((0.5 - elo.p) * 2.5), weight: 0.22, note: `${elo.home} vs ${elo.away} → ${pct(elo.p)} dla gospodarza` });
  if (xg) f.push({ key: 'xg', label: 'xG ze strzałów (sezon)', home: sgn((xg.home.att - xg.away.def) * 1.2 + (xg.away.def - 1) * 0.5), away: sgn((xg.away.att - xg.home.def) * 1.2 + (xg.home.def - 1) * 0.5), weight: 0.15, note: `xG ${f2(xg.home.xgFor)}–${f2(xg.home.xgAgainst)} vs ${f2(xg.away.xgFor)}–${f2(xg.away.xgAgainst)} na mecz` });
  if (absences && (absences.home?.missing?.length || absences.away?.missing?.length)) {
    const cnt = (s) => absences[s]?.missingCount || 0;
    f.push({ key: 'absencje', label: 'Absencje w podstawowym składzie', home: sgn(-0.3 * cnt('home')), away: sgn(-0.3 * cnt('away')), weight: 0.14, note: `${absences.home?.missing?.length ?? 0} vs ${absences.away?.missing?.length ?? 0} brakujących z regularnej jedenastki` });
  }
  f.push({ key: 'forma', label: 'Forma (ostatnie 5)', home: sgn((H.formScore - 0.5) * 2), away: sgn((A.formScore - 0.5) * 2), weight: 0.2, note: `${fmtForm(teams.home.lastFive)} vs ${fmtForm(teams.away.lastFive)}` });
  f.push({ key: 'tabela', label: 'Punkty na mecz (sezon)', home: sgn((H.ppg - 1.35) / 1.2), away: sgn((A.ppg - 1.35) / 1.2), weight: 0.2, note: `${f2(H.ppg)} vs ${f2(A.ppg)} pkt/mecz` });
  f.push({ key: 'atak', label: 'Siła ataku', home: sgn(H.attack - 1), away: sgn(A.attack - 1), weight: 0.15, note: `${f2(H.gp ? H.gf / H.gp : 0)} vs ${f2(A.gp ? A.gf / A.gp : 0)} goli/mecz` });
  f.push({ key: 'obrona', label: 'Szczelność obrony', home: sgn(1 - H.defense), away: sgn(1 - A.defense), weight: 0.15, note: `${f2(H.gp ? H.ga / H.gp : 0)} vs ${f2(A.gp ? A.ga / A.gp : 0)} straconych/mecz` });
  const splitH = teams.home.record?.home, splitA = teams.away.record?.away;
  const splitTxt = (s) => (s && s.gp >= 2 ? `${s.w}-${s.d}-${s.l}` : '—');
  f.push({ key: 'boisko', label: 'Atut własnego boiska', home: sgn(0.35 + (H.venueAttack - 1) * 2 + (H.venueFactor - 1) * 4), away: sgn(-0.35 + (A.venueAttack - 1) * 2 + (A.venueFactor - 1) * 4), weight: 0.1, note: `${splitTxt(splitH)} u siebie vs ${splitTxt(splitA)} na wyjazdach` });
  const trendH = (H.attackRecent - H.attackSeason) - (H.defenseRecent - H.defenseSeason);
  const trendA = (A.attackRecent - A.attackSeason) - (A.defenseRecent - A.defenseSeason);
  if (Math.abs(trendH) > 0.03 || Math.abs(trendA) > 0.03) f.push({ key: 'trend', label: 'Trend (ostatnie 5 vs sezon)', home: sgn(trendH * 2), away: sgn(trendA * 2), weight: 0.1, note: 'gole strzelane/tracone ostatnio względem całego sezonu' });
  const hs = h2h?.summary;
  if (hs && hs.total >= 2) f.push({ key: 'h2h', label: 'Bezpośrednie mecze', home: sgn((hs.homeWins - hs.awayWins) / hs.total), away: sgn((hs.awayWins - hs.homeWins) / hs.total), weight: 0.08, note: `${hs.homeWins}-${hs.draws}-${hs.awayWins} w ${plural(hs.total, MECZE)}` });
  if (H.restDays != null || A.restDays != null) {
    const fat = (S) => (S.restDays == null ? 0 : S.restDays <= 2 ? -0.6 : S.restDays === 3 ? -0.25 : S.restDays >= 6 ? 0.2 : 0) - (S.matches14 >= 5 ? 0.3 : 0);
    const fh = fat(H), fa = fat(A);
    if (fh || fa) f.push({ key: 'swiezosc', label: 'Świeżość (przerwa od meczu)', home: sgn(fh), away: sgn(fa), weight: 0.08, note: `${H.restDays ?? '?'} vs ${A.restDays ?? '?'} dni przerwy · ${H.matches14} vs ${A.matches14} meczów w 14 dni` });
  }
  if (H.stakes || A.stakes) f.push({ key: 'stawka', label: 'Stawka meczu (tabela)', home: sgn(H.stakes), away: sgn(A.stakes), weight: 0.06, note: 'walka o tytuł / puchary / utrzymanie vs środek tabeli' });
  if (momentum && momentum.weight > 0) f.push({ key: 'momentum', label: 'Przebieg meczu (live)', home: sgn((momentum.home - 0.5) * 2.5), away: sgn((momentum.away - 0.5) * 2.5), weight: 0.25, note: 'strzały celne, strzały, posiadanie' });
  if (cards.home.red || cards.away.red) f.push({ key: 'kartki', label: 'Osłabienia (czerwone kartki)', home: cards.home.red ? -0.8 : cards.away.red ? 0.5 : 0, away: cards.away.red ? -0.8 : cards.home.red ? 0.5 : 0, weight: 0.15, note: `${cards.home.red} vs ${cards.away.red}` });
  return f;
}

const fmtForm = (lf) => (lf || []).slice(0, 5).map((g) => g.result).join('') || '—';

/** czy statystyki live są już realne (ESPN zwraca zera / 100% posiadania zanim spłyną dane) */
function statsMeaningful(stats) {
  if (!stats?.length) return false;
  const sum = (k) => { const r = stats.find((s) => s.key === k); return r ? r.home + r.away : 0; };
  return sum('totalShots') + sum('foulsCommitted') + sum('totalPasses') > 0;
}

function streaks(lf) {
  let unbeaten = 0, wins = 0, losses = 0, winless = 0;
  for (const g of lf) { if (g.result !== 'L') unbeaten++; else break; }
  for (const g of lf) { if (g.result === 'W') wins++; else break; }
  for (const g of lf) { if (g.result === 'L') losses++; else break; }
  for (const g of lf) { if (g.result !== 'W') winless++; else break; }
  return { unbeaten, wins, losses, winless };
}

function teamInsights(team, S, side, h2h, stats, cards, momentum, lineup, events, state) {
  const out = [];
  const lf = team.lastFive || [];
  const n = lf.length;
  const push = (kind, text, tag) => out.push({ kind, text, tag });

  if (n) {
    const w = lf.filter((g) => g.result === 'W').length;
    const l = lf.filter((g) => g.result === 'L').length;
    const d = n - w - l;
    const gf = lf.reduce((s, g) => s + g.gf, 0), ga = lf.reduce((s, g) => s + g.ga, 0);
    const cs = lf.filter((g) => g.ga === 0).length;
    const fts = lf.filter((g) => g.gf === 0).length;
    const st = streaks(lf);
    if (st.wins >= 3) push('strength', `Seria ${gen(st.wins, 'zwycięstw')} z rzędu – drużyna na fali`, 'forma');
    else if (w >= 4) push('strength', `Świetna forma: ${plural(w, ZWYC)} w ostatnich ${wMeczach(n)}`, 'forma');
    else if (st.unbeaten >= 4) push('strength', `Seria ${gen(st.unbeaten, 'meczów')} bez porażki`, 'forma');
    if (st.losses >= 2) push('weakness', `${plural(st.losses, PORAZKI)} z rzędu – kryzys wyników`, 'forma');
    else if (w === 0 && n >= 3) push('weakness', `Bez zwycięstwa w ostatnich ${wMeczach(n)} (${d} rem., ${l} por.)`, 'forma');
    else if (st.winless >= 3) push('weakness', `Seria ${gen(st.winless, 'meczów')} bez wygranej`, 'forma');
    if (gf / n >= 2) push('strength', `Skuteczny atak: średnio ${f1(gf / n)} gola na mecz w ostatnich ${wMeczach(n)}`, 'atak');
    else if (gf / n < 0.8) push('weakness', `Problemy ze strzelaniem: tylko ${plural(gf, GOLE)} w ${wMeczach(n)}`, 'atak');
    if (fts >= 2) push('weakness', `Bez gola w ${fts} z ${n} ostatnich meczów`, 'atak');
    if (cs >= 3) push('strength', `Czyste konto w ${cs} z ${n} ostatnich meczów`, 'obrona');
    if (n >= 4 && lf.every((g) => g.ga > 0)) push('weakness', `Tracą gola w każdym z ostatnich ${gen(n, 'meczów')} – dziura w defensywie`, 'obrona');
    else if (ga / n >= 1.8) push('weakness', `Słaba obrona: ${plural(ga, GOLE)} stracone w ${wMeczach(n)}`, 'obrona');
    const big = lf.find((g) => g.ga - g.gf >= 3);
    if (big) push('warning', `Wysoka porażka ${big.gf}:${big.ga} z ${big.opponent.name} (${big.homeAway === 'H' ? 'u siebie' : 'na wyjeździe'})`, 'forma');
    const bigWin = lf.find((g) => g.gf - g.ga >= 3);
    if (bigWin) push('strength', `Pewne zwycięstwo ${bigWin.gf}:${bigWin.ga} z ${bigWin.opponent.name} w ostatnich meczach`, 'forma');
    const comps = new Set(lf.map((g) => g.competition).filter(Boolean));
    if (comps.size >= 2) push('info', `Gra na kilku frontach: ${[...comps].slice(0, 3).join(', ')}`, 'info');
  } else {
    push('info', 'Brak danych o ostatnich meczach tej drużyny', 'info');
  }

  const t = team.table;
  if (t && t.gp > 0) {
    if (t.rank <= 3) push('strength', `${t.rank}. miejsce w tabeli (${t.pts} pkt, bilans ${t.w}-${t.d}-${t.l})`, 'tabela');
    else if (t.teams && t.rank >= t.teams - 2) push('weakness', `Strefa spadkowa: ${t.rank}. miejsce na ${t.teams} (${t.pts} pkt)`, 'tabela');
    else push('info', `${t.rank}. miejsce w tabeli, ${t.pts} pkt po ${wMeczach(t.gp)}`, 'tabela');
    if (!t.noGoals && t.gp >= 3) {
      if (t.gf / t.gp >= 2.2) push('strength', `Najgroźniejszy atak ligi? ${f1(t.gf / t.gp)} gola/mecz w sezonie`, 'atak');
      if (t.ga / t.gp <= 0.7) push('strength', `Szczelna defensywa: tylko ${f1(t.ga / t.gp)} straconego gola/mecz`, 'obrona');
      if (t.ga / t.gp >= 1.9) push('weakness', `Traci ${f1(t.ga / t.gp)} gola/mecz w sezonie`, 'obrona');
    }
    if (t.note) push('info', `Strefa: ${t.note}`, 'tabela');
  }

  const split = team.record?.[side];
  if (split && split.gp >= 2) {
    const label = side === 'home' ? 'u siebie' : 'na wyjazdach';
    const wr = split.w / split.gp;
    if (wr >= 0.6) push('strength', `Mocni ${label}: ${split.w}-${split.d}-${split.l} (gole ${split.gf}:${split.ga})`, 'boisko');
    else if (wr <= 0.2 && split.l >= split.w) push('weakness', `Słabi ${label}: ${split.w}-${split.d}-${split.l} (gole ${split.gf}:${split.ga})`, 'boisko');
    else push('info', `Bilans ${label}: ${split.w}-${split.d}-${split.l}`, 'boisko');
  }

  const hs = h2h?.summary;
  if (hs && hs.total >= 2) {
    const wins = side === 'home' ? hs.homeWins : hs.awayWins;
    const losses = side === 'home' ? hs.awayWins : hs.homeWins;
    if (wins / hs.total >= 0.6) push('strength', `Wygrali ${wins} z ${plural(hs.total, MECZE)} bezpośrednich`, 'h2h');
    else if (losses / hs.total >= 0.6) push('weakness', `Przegrali ${losses} z ${plural(hs.total, MECZE)} bezpośrednich`, 'h2h');
  }

  if (team.squad?.avgAge) {
    if (team.squad.avgAge <= 24.5) push('info', `Młoda kadra: średnia wieku ${f1(team.squad.avgAge)} lat (${team.squad.size} zawodników)`, 'sklad');
    else if (team.squad.avgAge >= 28.5) push('info', `Doświadczona kadra: średnia wieku ${f1(team.squad.avgAge)} lat`, 'sklad');
  }

  if (lineup?.formation) {
    const f = lineup.formation;
    const parts = f.split('-').map(Number);
    const attackers = parts[parts.length - 1] || 0;
    const defenders = parts[0] || 0;
    let desc = '';
    if (defenders >= 5) desc = ' – nastawienie defensywne';
    else if (attackers >= 3 || parts.slice(1).reduce((s, x) => s + x, 0) - defenders >= 4) desc = ' – ofensywne ustawienie';
    push('info', `Ustawienie ${f}${desc}`, 'sklad');
  }

  // live
  if (state !== 'pre' && statsMeaningful(stats)) {
    const g = (k) => { const r = stats.find((s) => s.key === k); return r ? (side === 'home' ? [r.home, r.away] : [r.away, r.home]) : null; };
    const possRaw = g('possessionPct');
    const poss = possRaw && possRaw[0] > 0 && possRaw[0] < 100 ? possRaw : null;
    const sot = g('shotsOnTarget'), sh = g('totalShots'), fouls = g('foulsCommitted'), off = g('offsides'), pass = g('passPct'), saves = g('saves'), corners = g('wonCorners');
    if (poss && poss[0] >= 60) push('strength', `Kontrolują grę: ${Math.round(poss[0])}% posiadania piłki`, 'live');
    if (poss && poss[0] <= 38 && sh && sh[0] >= sh[1] && sh[0] >= 3) push('strength', `Skuteczna gra z kontry: mniej piłki (${Math.round(poss[0])}%), ale ${sh[0]} strzałów`, 'live');
    if (sot && sot[0] >= 3 && sot[0] >= sot[1] * 2) push('strength', `Wyraźnie groźniejsi: ${sot[0]} celnych strzałów vs ${sot[1]}`, 'live');
    if (sh && sh[0] >= 8 && sot && sot[0] <= 1) push('weakness', `Nieskuteczni: ${sh[0]} strzałów, tylko ${sot[0]} celnych`, 'live');
    if (fouls && fouls[0] >= 12) push('warning', `Dużo fauli (${fouls[0]}) – ryzyko kolejnych kartek`, 'live');
    if (off && off[0] >= 4) push('weakness', `Często na spalonym (${off[0]}) – problem z wyczuciem czasu`, 'live');
    if (pass && pass[0] > 0 && pass[0] < 72) push('weakness', `Niedokładne podania: celność ${Math.round(pass[0])}%`, 'live');
    if (pass && pass[0] >= 88) push('strength', `Bardzo dokładne rozegranie: ${Math.round(pass[0])}% celnych podań`, 'live');
    if (saves && saves[0] >= 4) push('info', `Bramkarz ratuje drużynę: ${saves[0]} obron`, 'live');
    if (corners && corners[0] >= 7) push('info', `Presja ze stałych fragmentów: ${corners[0]} rzutów rożnych`, 'live');
  }
  if (cards.red) push('warning', `Czerwona kartka – grają w osłabieniu (${11 - cards.red} zawodników)`, 'live');
  else if (cards.yellow >= 3) push('warning', `${cards.yellow} żółte kartki – zawodnicy muszą uważać`, 'live');

  // sort: strengths, weaknesses, warnings, info
  const order = { strength: 0, weakness: 1, warning: 2, info: 3 };
  out.sort((a, b) => order[a.kind] - order[b.kind]);
  return out.slice(0, 10);
}

function matchInsights({ item, teams, pre, live, market, probs, state, lh, la, minute, curH, curA, cards, h2h }) {
  const out = [];
  const push = (kind, text) => out.push({ kind, text });
  const hn = teams.home.short, an = teams.away.short;
  const fav = probs.home >= probs.away && probs.home >= probs.draw ? 'home' : probs.away >= probs.draw ? 'away' : 'draw';

  const label = (k) => (k === 'home' ? hn : k === 'away' ? an : 'remis');
  if (state === 'pre') {
    if (fav === 'draw') push('info', `Bardzo wyrównany mecz – wg analizy remis jest najbardziej prawdopodobny (${pct(probs.draw)})`);
    else push('info', `Faworyt wg analizy: ${label(fav)} – ${pct(probs[fav])} szans (forma, tabela, dom/wyjazd, H2H, świeżość, stawka, sygnały z sieci)`);
    push('info', `Spodziewane gole (xG modelu): ${f2(lh)} – ${f2(la)}, łącznie ${f2(lh + la)}`);
    push(pre.over25 >= 0.55 ? 'strength' : pre.over25 <= 0.42 ? 'weakness' : 'info', `Powyżej 2,5 gola: ${pct(pre.over25)} · Obie drużyny strzelą: ${pct(pre.btts)}`);
    if (market) {
      const mf = argmax(market);
      if (mf !== fav) push('warning', `Kursy bukmacherskie wskazują ${label(mf)} (${pct(market[mf])}), a analiza – ${label(fav)} (${pct(probs[fav])}). Typ wynika z analizy, nie z kursu.`);
      else if (Math.abs(pre[fav] - market[fav]) >= 0.1) push('info', `Kursy też wskazują ${label(fav)}, ale dają mu ${pct(market[fav])} – analiza jest ${pre[fav] > market[fav] ? 'bardziej' : 'mniej'} przekonana (${pct(pre[fav])})`);
      else push('info', `Kursy bukmacherskie zgadzają się z analizą (${pct(market.home)} / ${pct(market.draw)} / ${pct(market.away)})`);
    }
    const top = pre.topScores[0];
    if (top) push('info', `Najbardziej prawdopodobny wynik: ${top.score} (${pct(top.p)})`);
  } else if (state === 'in' && live) {
    push('info', `${minute}' – wynik ${curH}:${curA}. Szanse teraz: ${hn} ${pct(live.home)} · remis ${pct(live.draw)} · ${an} ${pct(live.away)}`);
    push('info', `Przed meczem model dawał: ${pct(pre.home)} / ${pct(pre.draw)} / ${pct(pre.away)}`);
    const swing = live.home - pre.home;
    if (Math.abs(swing) >= 0.2) push('warning', `Duża zmiana względem prognozy: ${swing > 0 ? hn : an} zyskał ${pct(Math.abs(swing))} szans`);
    push('info', `Spodziewane gole do końca: ${f2(live.xgRemaining.home)} – ${f2(live.xgRemaining.away)} (ok. ${live.remainingMinutes} min gry)`);
    if (live.topScores[0]) push('info', `Najbardziej prawdopodobny wynik końcowy: ${live.topScores[0].score} (${pct(live.topScores[0].p)})`);
    if (curH === curA && minute >= 75) push('warning', 'Końcówka przy remisie – każdy gol rozstrzyga mecz');
    if (Math.abs(curH - curA) === 1 && minute >= 80) push('warning', `${curH > curA ? an : hn} potrzebuje gola – spodziewaj się otwartej gry i kontr`);
  } else if (state === 'post') {
    const res = curH > curA ? `${hn} wygrał ${curH}:${curA}` : curA > curH ? `${an} wygrał ${curA}:${curH}` : `Remis ${curH}:${curA}`;
    const modelFav = pre.home >= pre.away && pre.home >= pre.draw ? 'home' : pre.away >= pre.draw ? 'away' : 'draw';
    const actual = curH > curA ? 'home' : curA > curH ? 'away' : 'draw';
    push('info', `${res}. Model przed meczem: ${pct(pre.home)} / ${pct(pre.draw)} / ${pct(pre.away)}`);
    push(modelFav === actual ? 'strength' : 'weakness', modelFav === actual ? 'Model trafnie wskazał wynik' : `Niespodzianka – model wskazywał ${modelFav === 'home' ? hn : modelFav === 'away' ? an : 'remis'}`);
    if (curH + curA >= 3) push('info', `Mecz z ${plural(curH + curA, GOLE)} – powyżej 2,5 (model dawał ${pct(pre.over25)})`);
  }
  const hs = h2h?.summary;
  if (hs && hs.total >= 2) push('info', `Bezpośrednie mecze: ${hs.homeWins} wygranych ${hn}, ${hs.draws} remisów, ${hs.awayWins} wygranych ${an} (gole ${hs.homeGoals}:${hs.awayGoals})`);
  if (cards.home.red || cards.away.red) push('warning', `Czerwone kartki: ${hn} ${cards.home.red}, ${an} ${cards.away.red} – gra w osłabieniu zmienia obraz meczu`);
  return out;
}

function keyPlayersFor(lineup, state) {
  if (!lineup) return [];
  const all = [...lineup.starters, ...lineup.subs];
  if (state === 'pre') {
    return lineup.starters.slice(0, 11).map((p) => ({ ...p, impact: 0, why: p.positionName || '' }));
  }
  const scored = all.map((p) => {
    const s = p.stats;
    const impact = s.goals * 5 + s.assists * 3 + s.shotsOnTarget * 1.2 + s.shots * 0.4 + s.saves * 1.5 + s.tackles * 0.4 + (s.accuratePasses || 0) * 0.02 - s.yellow * 1 - s.red * 4 - s.ownGoals * 4;
    const why = [];
    if (s.goals) why.push(plural(s.goals, GOLE));
    if (s.assists) why.push(`${s.assists} asyst`);
    if (s.shotsOnTarget) why.push(`${s.shotsOnTarget} celnych`);
    if (s.saves) why.push(`${s.saves} obron`);
    if (s.tackles >= 3) why.push(`${s.tackles} odbiorów`);
    if (s.yellow) why.push('żółta kartka');
    if (s.red) why.push('czerwona kartka');
    if (s.fouls >= 3) why.push(`${s.fouls} fauli`);
    return { ...p, impact: Math.round(impact * 10) / 10, why: why.join(', ') };
  });
  return scored.filter((p) => p.starter || p.subbedIn).sort((a, b) => b.impact - a.impact).slice(0, 6);
}

/** Najważniejsze czynniki przemawiające za typowanym wynikiem (do wyjaśnienia werdyktu) */
function whyFor(fav, factors) {
  if (!factors?.length) return '';
  if (fav === 'draw') return 'wyrównane siły obu drużyn';
  const scored = factors
    .map((f) => ({ f, s: (fav === 'home' ? f.home - f.away : f.away - f.home) * f.weight }))
    .filter((x) => x.s > 0.02)
    .sort((a, b) => b.s - a.s)
    .slice(0, 3);
  return scored.map((x) => x.f.label.toLowerCase().replace(/\s*\(.*?\)/g, '')).join(', ');
}

function buildVerdict({ item, probs, state, curH, curA, live, pre, factors, market }) {
  const hn = item.home.short, an = item.away.short;
  const fav = argmax(probs);
  const p = probs[fav];
  const why = state === 'post' ? '' : whyFor(fav, factors);
  const marketFav = market ? argmax(market) : null;
  const mkt = market ? { winner: marketFav, p: round3(market[marketFav]), agrees: marketFav === fav } : null;
  const name = (k) => (k === 'home' ? hn : k === 'away' ? an : 'remis');
  if (state === 'post') {
    const w = curH > curA ? 'home' : curA > curH ? 'away' : 'draw';
    return { winner: w, text: w === 'draw' ? `Remis ${curH}:${curA}` : `${name(w)} wygrywa ${Math.max(curH, curA)}:${Math.min(curH, curA)}`, sub: `Analiza przed meczem: ${pct(pre.home)} / ${pct(pre.draw)} / ${pct(pre.away)}`, why, market: mkt };
  }
  if (state === 'in') {
    if (fav === 'draw') return { winner: 'draw', text: `Remis najbardziej prawdopodobny (${pct(p)})`, sub: `${live.minute}' · ${curH}:${curA}`, why, market: mkt };
    return { winner: fav, text: p >= 0.8 ? `${name(fav)} kontroluje mecz (${pct(p)})` : `${name(fav)} bliżej wygranej (${pct(p)})`, sub: `${live.minute}' · ${curH}:${curA}`, why, market: mkt };
  }
  if (fav === 'draw' || p < 0.42) return { winner: fav, text: `Wyrównany mecz – lekka przewaga ${fav === 'draw' ? 'remisu' : name(fav)} (${pct(p)})`, sub: 'Niska pewność', why, market: mkt };
  if (p >= 0.65) return { winner: fav, text: `Zdecydowany faworyt wg analizy: ${name(fav)} (${pct(p)})`, sub: 'Wysoka pewność', why, market: mkt };
  return { winner: fav, text: `Faworyt wg analizy: ${name(fav)} (${pct(p)})`, sub: 'Umiarkowana pewność', why, market: mkt };
}
