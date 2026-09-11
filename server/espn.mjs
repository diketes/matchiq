// Warstwa dostępu do publicznych endpointów ESPN + cache w pamięci.
// Wszystkie funkcje zwracają już znormalizowane, lekkie obiekty dla frontu.

export const SITE = 'https://site.api.espn.com/apis/site/v2/sports';
export const SITE_V2 = 'https://site.api.espn.com/apis/v2/sports';
export const CORE = 'https://sports.core.api.espn.com/v2/sports';

// ---------- cache ----------
const cache = new Map();

export async function getJSON(url, ttlMs = 30_000) {
  const now = Date.now();
  const hit = cache.get(url);
  if (hit) {
    if (hit.promise) return hit.promise;
    if (now - hit.t < hit.ttl) return hit.data;
  }
  const promise = (async () => {
    const res = await fetch(url.replace('http://', 'https://'), {
      headers: { 'user-agent': 'MatchIQ/1.0 (+local analytics app)' },
    });
    if (!res.ok) {
      const err = new Error(`ESPN ${res.status} for ${url}`);
      err.status = res.status;
      throw err;
    }
    return res.json();
  })();
  cache.set(url, { promise, t: now, ttl: ttlMs });
  try {
    const data = await promise;
    cache.set(url, { data, t: Date.now(), ttl: ttlMs });
    return data;
  } catch (e) {
    cache.delete(url);
    throw e;
  }
}

// prosty limiter równoległości
export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      try { out[idx] = await fn(items[idx], idx); } catch (e) { out[idx] = { __error: e.message }; }
    }
  });
  await Promise.all(workers);
  return out;
}

// ---------- ligi piłkarskie ----------
export const FOOTBALL_LEAGUES = [
  { slug: 'uefa.champions', name: 'Liga Mistrzów UEFA', region: 'Europa', tier: 1 },
  { slug: 'uefa.europa', name: 'Liga Europy UEFA', region: 'Europa', tier: 1 },
  { slug: 'uefa.europa.conf', name: 'Liga Konferencji UEFA', region: 'Europa', tier: 2 },
  { slug: 'eng.1', name: 'Premier League', region: 'Anglia', tier: 1 },
  { slug: 'esp.1', name: 'LaLiga', region: 'Hiszpania', tier: 1 },
  { slug: 'ger.1', name: 'Bundesliga', region: 'Niemcy', tier: 1 },
  { slug: 'ita.1', name: 'Serie A', region: 'Włochy', tier: 1 },
  { slug: 'fra.1', name: 'Ligue 1', region: 'Francja', tier: 1 },
  { slug: 'ned.1', name: 'Eredivisie', region: 'Holandia', tier: 1 },
  { slug: 'por.1', name: 'Primeira Liga', region: 'Portugalia', tier: 1 },
  { slug: 'tur.1', name: 'Süper Lig', region: 'Turcja', tier: 2 },
  { slug: 'bel.1', name: 'Pro League', region: 'Belgia', tier: 2 },
  { slug: 'sco.1', name: 'Scottish Premiership', region: 'Szkocja', tier: 2 },
  { slug: 'eng.2', name: 'Championship', region: 'Anglia', tier: 2 },
  { slug: 'esp.2', name: 'LaLiga 2', region: 'Hiszpania', tier: 3 },
  { slug: 'ger.2', name: '2. Bundesliga', region: 'Niemcy', tier: 3 },
  { slug: 'ita.2', name: 'Serie B', region: 'Włochy', tier: 3 },
  { slug: 'fra.2', name: 'Ligue 2', region: 'Francja', tier: 3 },
  { slug: 'aut.1', name: 'Bundesliga (Austria)', region: 'Austria', tier: 3 },
  { slug: 'sui.1', name: 'Super League (Szwajcaria)', region: 'Szwajcaria', tier: 3 },
  { slug: 'den.1', name: 'Superliga (Dania)', region: 'Dania', tier: 3 },
  { slug: 'gre.1', name: 'Super League (Grecja)', region: 'Grecja', tier: 3 },
  { slug: 'rus.1', name: 'Premier Liga (Rosja)', region: 'Rosja', tier: 3 },
  { slug: 'nor.1', name: 'Eliteserien', region: 'Norwegia', tier: 3 },
  { slug: 'swe.1', name: 'Allsvenskan', region: 'Szwecja', tier: 3 },
  { slug: 'usa.1', name: 'MLS', region: 'USA', tier: 2 },
  { slug: 'mex.1', name: 'Liga MX', region: 'Meksyk', tier: 2 },
  { slug: 'bra.1', name: 'Brasileirão', region: 'Brazylia', tier: 2 },
  { slug: 'arg.1', name: 'Liga Profesional', region: 'Argentyna', tier: 2 },
  { slug: 'jpn.1', name: 'J1 League', region: 'Japonia', tier: 3 },
  { slug: 'ksa.1', name: 'Saudi Pro League', region: 'Arabia Saudyjska', tier: 3 },
  { slug: 'conmebol.libertadores', name: 'Copa Libertadores', region: 'Ameryka Płd.', tier: 2 },
  { slug: 'uefa.nations', name: 'Liga Narodów UEFA', region: 'Reprezentacje', tier: 1 },
  { slug: 'fifa.worldq.uefa', name: 'El. MŚ – Europa', region: 'Reprezentacje', tier: 1 },
  { slug: 'fifa.world', name: 'Mistrzostwa Świata', region: 'Reprezentacje', tier: 1 },
  { slug: 'fifa.friendly', name: 'Mecze towarzyskie reprezentacji', region: 'Reprezentacje', tier: 3 },
  { slug: 'eng.fa', name: 'FA Cup', region: 'Anglia', tier: 3 },
  { slug: 'eng.league_cup', name: 'Carabao Cup', region: 'Anglia', tier: 3 },
  { slug: 'esp.copa_del_rey', name: 'Copa del Rey', region: 'Hiszpania', tier: 3 },
  { slug: 'ger.dfb_pokal', name: 'DFB-Pokal', region: 'Niemcy', tier: 3 },
  { slug: 'ita.coppa_italia', name: 'Coppa Italia', region: 'Włochy', tier: 3 },
  { slug: 'club.friendly', name: 'Mecze towarzyskie klubów', region: 'Świat', tier: 4 },
];

export const leagueBySlug = new Map(FOOTBALL_LEAGUES.map((l) => [l.slug, l]));

// ---------- daty ----------
export const TZ = 'Europe/Warsaw';

export function localDateKey(iso, tz = TZ) {
  // YYYY-MM-DD w strefie Europe/Warsaw
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d);
  const get = (t) => parts.find((p) => p.type === t)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function shiftDateKey(key, days) {
  const [y, m, d] = key.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

export function todayKey() {
  return localDateKey(new Date().toISOString());
}

const compact = (k) => k.replaceAll('-', '');

// ---------- piłka nożna: lista meczów ----------
export function normalizeFootballEvent(ev, league) {
  const comp = ev.competitions?.[0] || {};
  const comps = comp.competitors || [];
  const home = comps.find((c) => c.homeAway === 'home') || comps[0] || {};
  const away = comps.find((c) => c.homeAway === 'away') || comps[1] || {};
  const st = ev.status || comp.status || {};
  const state = st.type?.state || 'pre';

  const side = (c) => ({
    id: c.team?.id || c.id,
    name: (c.team?.displayName || c.team?.name || '?').trim(),
    short: (c.team?.shortDisplayName || c.team?.abbreviation || '?').trim(),
    abbr: c.team?.abbreviation || '',
    logo: c.team?.logo || c.team?.logos?.[0]?.href,
    color: c.team?.color ? `#${c.team.color}` : undefined,
    altColor: c.team?.alternateColor ? `#${c.team.alternateColor}` : undefined,
    score: c.score != null ? Number(c.score) : null,
    form: c.form || undefined,
    record: c.records?.[0]?.summary,
    winner: !!c.winner,
  });

  const odds = comp.odds?.[0];
  let market;
  if (odds) {
    const ml = {
      home: odds.homeTeamOdds?.moneyLine,
      away: odds.awayTeamOdds?.moneyLine,
      draw: odds.drawOdds?.moneyLine,
    };
    market = moneylineToProbs(ml);
    if (market) market.overUnder = odds.overUnder;
  }

  return {
    id: ev.id,
    sport: 'football',
    league: { id: league.slug, name: league.name, region: league.region, tier: league.tier },
    date: ev.date,
    dateKey: localDateKey(ev.date),
    state,
    statusText: footballStatusText(st, ev.date),
    clock: st.displayClock,
    period: st.period,
    statusDetail: st.type?.description,
    home: side(home),
    away: side(away),
    venue: comp.venue?.fullName,
    market,
    name: ev.name,
    shortName: ev.shortName,
  };
}

export function footballStatusText(st, dateIso) {
  const state = st.type?.state;
  if (state === 'in') {
    const name = st.type?.name || '';
    if (name.includes('HALFTIME')) return 'Przerwa';
    if (name.includes('EXTRA')) return `Dogr. ${st.displayClock || ''}`.trim();
    if (name.includes('SHOOTOUT')) return 'Karne';
    return st.displayClock || 'Na żywo';
  }
  if (state === 'post') {
    const name = st.type?.name || '';
    if (name.includes('POSTPONED')) return 'Przełożony';
    if (name.includes('CANCELED')) return 'Odwołany';
    if (name.includes('ABANDONED')) return 'Przerwany';
    if (name.includes('SHOOTOUT') || name.includes('PEN')) return 'Po karnych';
    if (name.includes('EXTRA') || name.includes('AET')) return 'Po dogr.';
    return 'Koniec';
  }
  const name = st.type?.name || '';
  if (name.includes('POSTPONED')) return 'Przełożony';
  return new Intl.DateTimeFormat('pl-PL', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }).format(new Date(dateIso));
}

export function moneylineToProbs(ml) {
  const imp = (v) => {
    if (v == null || Number.isNaN(Number(v))) return null;
    const n = Number(v);
    return n < 0 ? -n / (-n + 100) : 100 / (n + 100);
  };
  const h = imp(ml.home), a = imp(ml.away), d = imp(ml.draw);
  if (h == null || a == null) return null;
  const parts = d == null ? { home: h, away: a } : { home: h, draw: d, away: a };
  const sum = Object.values(parts).reduce((s, v) => s + v, 0);
  const out = {};
  for (const k of Object.keys(parts)) out[k] = parts[k] / sum;
  out.raw = ml;
  return out;
}

export async function fetchFootballLeague(slug, fromKey, toKey) {
  const url = `${SITE}/soccer/${slug}/scoreboard?dates=${compact(fromKey)}-${compact(toKey)}&limit=200`;
  const data = await getJSON(url, 30_000);
  const league = leagueBySlug.get(slug) || { slug, name: data.leagues?.[0]?.name || slug, region: '', tier: 4 };
  return (data.events || []).map((ev) => normalizeFootballEvent(ev, league));
}

export async function fetchFootballWindow(centerKey) {
  const from = shiftDateKey(centerKey, -1);
  const to = shiftDateKey(centerKey, 1);
  const results = await mapLimit(FOOTBALL_LEAGUES, 8, (l) => fetchFootballLeague(l.slug, from, to));
  const events = [];
  const errors = [];
  results.forEach((r, i) => {
    if (Array.isArray(r)) events.push(...r);
    else if (r?.__error) errors.push({ league: FOOTBALL_LEAGUES[i].slug, error: r.__error });
  });
  return { events, errors };
}

// ---------- tenis: lista meczów ----------
export const TENNIS_TOURS = [
  { slug: 'atp', name: 'ATP' },
  { slug: 'wta', name: 'WTA' },
];

export const SURFACES = [
  { re: /roland garros|french open|monte[- ]carlo|madrid|rome|italian open|barcelona|hamburg|kitzb|gstaad|umag|bastad|båstad|estoril|munich|geneva|lyon|marrakech|houston|bucharest|rio|buenos aires|santiago|cordoba|charleston|stuttgart|strasbourg|rabat|palermo|budapest|warsaw|prague|lausanne|iasi|cluj|bogota|santa cruz|mallorca open|athens|belgrade|banja luka|zagreb|bologna|florence|turin|cagliari|parma|seville|marbella|kitzbuhel/i, surface: 'clay' },
  { re: /wimbledon|halle|queen|london|eastbourne|'s-hertogenbosch|rosmalen|libema|newport|berlin|bad homburg|nottingham|birmingham|ilkley|surbiton|mallorca championships|stuttgart open/i, surface: 'grass' },
];

export function guessSurface(name = '', date) {
  for (const s of SURFACES) if (s.re.test(name)) {
    // Stuttgart WTA (kwiecień) = mączka, Stuttgart ATP (czerwiec) = trawa
    if (/stuttgart/i.test(name) && date) {
      const m = new Date(date).getUTCMonth();
      return m >= 5 ? 'grass' : 'clay';
    }
    return s.surface;
  }
  return 'hard';
}

export function tournamentCategory(name = '') {
  if (/australian open|roland garros|french open|wimbledon|us open/i.test(name)) return 'Wielki Szlem';
  if (/finals|masters/i.test(name)) return 'Masters / Finals';
  if (/indian wells|miami|monte[- ]carlo|madrid|rome|italian open|canadian|montreal|toronto|cincinnati|shanghai|paris masters|rolex paris|dubai|doha|qatar|wuhan|beijing|china open/i.test(name)) return 'Masters 1000';
  return 'Turniej ATP/WTA';
}

export function tennisStatusText(st, dateIso) {
  const state = st.type?.state;
  if (state === 'in') {
    const detail = st.type?.detail || '';
    const m = detail.match(/(\d)(st|nd|rd|th) Set/i);
    if (m) return `${m[1]}. set`;
    if (/suspended|delay/i.test(detail)) return 'Przerwa';
    return 'Na żywo';
  }
  if (state === 'post') {
    const name = st.type?.name || '';
    if (/RET|WALKOVER|W\/O/i.test(st.type?.detail || '') || /RETIRED|WALKOVER/i.test(name)) return 'Krecz/W.O.';
    if (/POSTPONED/.test(name)) return 'Przełożony';
    return 'Koniec';
  }
  return new Intl.DateTimeFormat('pl-PL', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }).format(new Date(dateIso));
}

export const ROUND_PL = (r = '') => {
  const m = r.match(/Qualifying (\d)/i);
  if (m) return `Kwalifikacje – ${m[1]}. runda`;
  if (/Qualifying/i.test(r)) return 'Kwalifikacje';
  if (/Round of 128/i.test(r)) return '1. runda';
  if (/Round of 64/i.test(r)) return '2. runda';
  if (/Round of 32/i.test(r)) return '3. runda';
  if (/Round of 16/i.test(r)) return '1/8 finału';
  if (/Quarterfinal/i.test(r)) return 'Ćwierćfinał';
  if (/Semifinal/i.test(r)) return 'Półfinał';
  if (/^Final$/i.test(r)) return 'Finał';
  const n = r.match(/Round (\d)/i);
  if (n) return `${n[1]}. runda`;
  return r;
};

export function normalizeTennisCompetition(c, ev, grouping, tour, rankMap) {
  const comps = c.competitors || [];
  const p1 = comps.find((x) => x.homeAway === 'home') || comps[0] || {};
  const p2 = comps.find((x) => x.homeAway === 'away') || comps[1] || {};
  const st = c.status || {};
  const state = st.type?.state || 'pre';

  const side = (p) => {
    const sets = (p.linescores || []).map((ls) => ({ games: ls.value ?? 0, tiebreak: ls.tiebreak, won: ls.winner }));
    const setsWon = sets.filter((s) => s.won === true).length;
    const rk = rankMap?.get(String(p.id));
    const pair = p.roster; // debel: para zawodników
    const firstOfPair = pair?.athletes?.[0];
    return {
      id: p.id,
      name: p.athlete?.displayName || p.athlete?.fullName || pair?.displayName || '?',
      short: p.athlete?.shortName || p.athlete?.displayName || pair?.shortDisplayName || pair?.displayName || '?',
      flag: p.athlete?.flag?.href || firstOfPair?.flag?.href,
      country: p.athlete?.flag?.alt || (pair?.athletes || []).map((a) => a.flag?.alt).filter(Boolean).join(' / ') || undefined,
      score: setsWon,
      sets,
      seed: p.curatedRank?.current,
      rank: rk?.rank,
      rankPoints: rk?.points,
      winner: !!p.winner,
    };
  };

  const groupName = grouping?.displayName || c.type?.text || '';
  const doubles = /doubles/i.test(groupName);
  const surface = guessSurface(ev.name, ev.date);
  // turniej może być w obu scoreboardach (ATP i WTA) – tour ustalamy po kategorii gry
  const realTour = /women/i.test(groupName) ? 'wta' : /men/i.test(groupName) ? 'atp' : tour;
  return {
    id: c.id,
    sport: 'tennis',
    league: { id: `${realTour}:${ev.id}`, name: ev.name, region: realTour.toUpperCase(), tier: tournamentCategory(ev.name) === 'Wielki Szlem' ? 1 : 2, tour: realTour, eventId: ev.id },
    group: grouping?.displayName?.replace("Men's Singles", 'Gra pojedyncza mężczyzn').replace("Women's Singles", 'Gra pojedyncza kobiet').replace("Men's Doubles", 'Debel mężczyzn').replace("Women's Doubles", 'Debel kobiet').replace('Mixed Doubles', 'Mikst'),
    doubles,
    round: ROUND_PL(c.round?.displayName),
    date: c.date,
    dateKey: localDateKey(c.date),
    state,
    statusText: tennisStatusText(st, c.date),
    statusDetail: st.type?.detail,
    home: side(p1),
    away: side(p2),
    venue: [ev.venue?.displayName || c.venue?.fullName, c.venue?.court].filter(Boolean).join(' · '),
    bestOf: c.format?.regulation?.periods || 3,
    surface,
    note: c.notes?.[0]?.text,
    name: `${p1.athlete?.shortName || '?'} – ${p2.athlete?.shortName || '?'}`,
  };
}

export async function fetchRankings(tour) {
  const data = await getJSON(`${SITE}/tennis/${tour}/rankings`, 60 * 60_000);
  const map = new Map();
  for (const r of data.rankings?.[0]?.ranks || []) {
    map.set(String(r.athlete?.id), { rank: r.current, prev: r.previous, points: r.points, trend: r.trend, name: r.athlete?.displayName });
  }
  return map;
}

export async function fetchTennisTour(tour) {
  const [data, rankMap] = await Promise.all([
    getJSON(`${SITE}/tennis/${tour}/scoreboard`, 30_000),
    fetchRankings(tour).catch(() => new Map()),
  ]);
  const out = [];
  for (const ev of data.events || []) {
    for (const g of ev.groupings || []) {
      for (const c of g.competitions || []) {
        out.push(normalizeTennisCompetition(c, ev, g.grouping, tour, rankMap));
      }
    }
  }
  return { matches: out, raw: data, rankMap };
}

export async function fetchTennisAll() {
  const results = await mapLimit(TENNIS_TOURS, 2, (t) => fetchTennisTour(t.slug));
  const seen = new Set();
  const matches = [];
  const errors = [];
  results.forEach((r, i) => {
    if (r?.matches) {
      for (const m of r.matches) {
        if (seen.has(m.id)) continue; // ten sam mecz w obu scoreboardach
        seen.add(m.id);
        matches.push(m);
      }
    } else if (r?.__error) errors.push({ tour: TENNIS_TOURS[i].slug, error: r.__error });
  });
  return { matches, errors };
}
