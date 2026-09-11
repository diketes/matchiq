// Ratingi z pipeline'u danych (Elo piłka/tenis, xG ze strzałów, dopasowane wagi modelu) oraz statystyki skuteczności.
// Źródło: gałąź `data` repozytorium (aktualizowana codziennie przez GitHub Actions). Bez Node – działa też w aplikacji.
const RAW = 'https://raw.githubusercontent.com/diketes/matchiq/data';

const source = {
  ratingsUrl: `${RAW}/ratings.json`,
  accuracyUrl: `${RAW}/accuracy.json`,
  fallback: null,      // async () => ratings (np. paczka wbudowana w aplikację)
  ttlMs: 6 * 3600_000,
};

let ratings = null, ratingsAt = 0, ratingsLoading = null;
let accuracy = null, accuracyAt = 0, accuracyLoading = null;

export function configureRatings({ ratingsUrl, accuracyUrl, fallback, preset, ttlMs } = {}) {
  if (ratingsUrl) source.ratingsUrl = ratingsUrl;
  if (accuracyUrl) source.accuracyUrl = accuracyUrl;
  if (fallback) source.fallback = fallback;
  if (ttlMs) source.ttlMs = ttlMs;
  if (preset) { ratings = preset; ratingsAt = Date.now(); }
}

async function fetchJson(url, timeoutMs = 15000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally { clearTimeout(t); }
}

/** Ładuje ratingi (raz na kilka godzin). Nigdy nie rzuca – gdy brak sieci, zwraca to, co jest (albo null). */
export async function ensureRatings() {
  if (ratings && Date.now() - ratingsAt < source.ttlMs) return ratings;
  if (ratingsLoading) return ratingsLoading;
  ratingsLoading = (async () => {
    try {
      const r = await fetchJson(source.ratingsUrl);
      if (r && r.elo && r.params) { ratings = r; ratingsAt = Date.now(); return ratings; }
    } catch { /* fallback */ }
    if (!ratings && source.fallback) {
      try {
        const r = await source.fallback();
        if (r && r.elo && r.params) { ratings = r; ratingsAt = Date.now() - source.ttlMs + 10 * 60_000; }
      } catch { /* brak paczki */ }
    }
    if (ratings) ratingsAt = Math.max(ratingsAt, Date.now() - source.ttlMs + 10 * 60_000);
    return ratings;
  })().finally(() => { ratingsLoading = null; });
  return ratingsLoading;
}

export function getRatings() { return ratings; }

export function ratingsInfo() {
  if (!ratings) return null;
  return {
    generatedAt: ratings.generatedAt,
    teams: Object.keys(ratings.elo || {}).length,
    xgTeams: Object.keys(ratings.xg || {}).length,
    tennisPlayers: Object.keys(ratings.tennisElo || {}).length,
    params: ratings.params,
  };
}

/** Skuteczność (tracker + backtest). Cache 20 min. */
export async function getAccuracy() {
  if (accuracy && Date.now() - accuracyAt < 20 * 60_000) return accuracy;
  if (accuracyLoading) return accuracyLoading;
  accuracyLoading = (async () => {
    try {
      const a = await fetchJson(source.accuracyUrl);
      if (a && a.generatedAt) { accuracy = a; accuracyAt = Date.now(); }
    } catch { /* zostaw stare */ }
    if (accuracy) accuracyAt = Math.max(accuracyAt, Date.now() - 20 * 60_000 + 3 * 60_000);
    return accuracy;
  })().finally(() => { accuracyLoading = null; });
  return accuracyLoading;
}

/** Elo drużyny (piłka) */
export function teamElo(teamId) {
  const e = ratings?.elo?.[String(teamId)];
  return e ? { elo: e.elo, n: e.n, league: e.league, last: e.last } : null;
}

/** Siły xG drużyny (bieżący sezon) */
export function teamXg(teamId) {
  return ratings?.xg?.[String(teamId)] || null;
}

/** Elo tenisisty (ogólne + per nawierzchnia) */
export function playerElo(playerId) {
  return ratings?.tennisElo?.[String(playerId)] || null;
}

export function modelParams(defaults) {
  return ratings?.params ? { ...defaults, ...ratings.params } : defaults;
}
