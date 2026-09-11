// Lokalny silnik analizy dla aplikacji mobilnej / PWA.
// Te same moduły co na serwerze (server/*.mjs) – ESPN pobierane bezpośrednio z aplikacji, kupony w localStorage.
import { handleApi } from '../../server/api.mjs';
import { configureBetsStorage, startScheduler } from '../../server/bets.mjs';

const KEY = 'matchiq.bets.v2';

configureBetsStorage({
  read: () => {
    try { return localStorage.getItem(KEY); } catch { return null; }
  },
  write: (json: string) => {
    try { localStorage.setItem(KEY, json); } catch { /* brak miejsca / tryb prywatny */ }
  },
});
startScheduler();

export async function localApi(method: string, url: string, body?: any): Promise<any> {
  const u = new URL(url, 'http://local');
  const query: Record<string, string> = {};
  u.searchParams.forEach((v, k) => { query[k] = v; });
  return handleApi(method, u.pathname, query, body);
}
