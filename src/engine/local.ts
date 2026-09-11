// Lokalny silnik analizy dla aplikacji mobilnej / PWA.
// Te same moduły co na serwerze (server/*.mjs) – ESPN pobierane bezpośrednio z aplikacji, kupony i prognozy w localStorage,
// ratingi (Elo, xG, wagi) z gałęzi `data` repozytorium z paczką zapasową wbudowaną w aplikację.
import { handleApi } from '../../server/api.mjs';
import { configureBetsStorage, startScheduler } from '../../server/bets.mjs';
import { configureTrackerStorage } from '../../server/tracker.mjs';
import { configureRatings, ensureRatings } from '../../server/ratings.mjs';

const storage = (key: string) => ({
  read: () => {
    try { return localStorage.getItem(key); } catch { return null; }
  },
  write: (json: string) => {
    try { localStorage.setItem(key, json); } catch { /* brak miejsca / tryb prywatny */ }
  },
});

configureBetsStorage(storage('matchiq.bets.v2'));
configureTrackerStorage(storage('matchiq.tracker.v1'));
configureRatings({
  fallback: async () => {
    const r = await fetch('./data/ratings.json');
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  },
});
ensureRatings().catch(() => null);
startScheduler();

export async function localApi(method: string, url: string, body?: any): Promise<any> {
  const u = new URL(url, 'http://local');
  const query: Record<string, string> = {};
  u.searchParams.forEach((v, k) => { query[k] = v; });
  return handleApi(method, u.pathname, query, body);
}
