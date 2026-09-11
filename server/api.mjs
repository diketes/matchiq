// Wspólny router API MatchIQ. Używany przez serwer Express (index.mjs) i przez aplikację mobilną / PWA,
// gdzie cały silnik analizy działa lokalnie w aplikacji (bez serwera).
import { fetchFootballWindow, fetchTennisAll, todayKey, shiftDateKey, FOOTBALL_LEAGUES } from './espn.mjs';
import { getFootballMatch } from './football.mjs';
import { getTennisMatch } from './tennis.mjs';
import { getState as betsState, generateCoupons, settleIfStale, updateSettings, resetBankroll, deleteCoupon, findValuePicks } from './bets.mjs';

const validDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '');

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

async function footballMatches(dateParam) {
  const date = validDate(dateParam) ? dateParam : todayKey();
  const { events, errors } = await fetchFootballWindow(date);
  const uniq = new Map();
  for (const e of events) if (!uniq.has(e.id)) uniq.set(e.id, e);
  const all = [...uniq.values()].sort((a, b) => new Date(a.date) - new Date(b.date));
  return { date, today: todayKey(), yesterday: shiftDateKey(date, -1), tomorrow: shiftDateKey(date, 1), matches: all, errors };
}

async function tennisMatches(dateParam) {
  const date = validDate(dateParam) ? dateParam : todayKey();
  const { matches, errors } = await fetchTennisAll();
  const from = shiftDateKey(date, -1), to = shiftDateKey(date, 1);
  const filtered = matches.filter((m) => m.state === 'in' || (m.dateKey >= from && m.dateKey <= to));
  filtered.sort((a, b) => new Date(a.date) - new Date(b.date));
  return { date, today: todayKey(), yesterday: from, tomorrow: to, matches: filtered, errors };
}

/**
 * Obsługa żądania API.
 * @param {string} method GET/POST/DELETE
 * @param {string} pathname np. /api/football/matches
 * @param {Record<string,string>} query parametry zapytania
 * @param {any} body treść (POST)
 */
export async function handleApi(method, pathname, query = {}, body = null) {
  const seg = pathname.split('/').filter(Boolean);
  if (seg[0] !== 'api') throw httpError(404, 'Nie ma takiego zasobu');
  const m = String(method || 'GET').toUpperCase();
  const [, a, b, c, d] = seg;
  const dec = (s) => { try { return decodeURIComponent(s); } catch { return s; } };

  if (m === 'GET' && a === 'health' && !b) return { ok: true, time: new Date().toISOString(), today: todayKey() };
  if (m === 'GET' && a === 'leagues' && !b) return FOOTBALL_LEAGUES;
  if (m === 'GET' && a === 'football' && b === 'matches') return footballMatches(query.date);
  if (m === 'GET' && a === 'football' && b === 'match' && c && d) return getFootballMatch(dec(c), dec(d));
  if (m === 'GET' && a === 'tennis' && b === 'matches') return tennisMatches(query.date);
  if (m === 'GET' && a === 'tennis' && b === 'match' && c && d) return getTennisMatch(dec(c), dec(d));

  if (a === 'bets') {
    if (m === 'GET' && !b) { await settleIfStale().catch(() => {}); return betsState(); }
    if (m === 'POST' && b === 'generate') { const r = await generateCoupons({ force: !!body?.force }); return { ...r, state: betsState() }; }
    if (m === 'GET' && b === 'picks') return findValuePicks();
    if (m === 'POST' && b === 'settings') return updateSettings(body || {});
    if (m === 'POST' && b === 'reset') return resetBankroll(body?.start);
    if (m === 'DELETE' && b === 'coupon' && c) return deleteCoupon(dec(c));
  }
  throw httpError(404, 'Nie ma takiego zasobu');
}
