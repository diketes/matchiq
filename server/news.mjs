// Sygnały z internetu: nagłówki z Google News (ostatnie dni) o drużynie – kontuzje, zawieszenia,
// zwolnienia trenerów, powroty. Bez klucza API. Wynik: lista nagłówków + prosty wskaźnik ton (neg/pos).
import { getJSON } from './espn.mjs';

const NEG = [
  /\binjur/i, /\bruled out\b/i, /\bsidelined\b/i, /\bout for\b/i, /\bwill miss\b/i, /\bmisses?\b.*\b(match|game|clash)\b/i, /\bsuspend/i, /\bbanned?\b/i, /\bsacked\b/i, /\bfired\b/i,
  /\bcrisis\b/i, /\bsetback\b/i, /\bblow\b/i, /\bdoubt(ful)?\b/i, /\bwithout\b/i, /\bfitness (concern|worry)/i, /\bhospital/i, /\bsurgery\b/i, /\b(on strike|strike action|players'? strike|go on strike)\b/i, /\bunrest\b/i, /\bresign/i,
  /kontuzj/i, /\bwypad/i, /zawieszon/i, /zwolnion/i, /\bkryzys/i, /\bnie zagra/i, /\bpauz/i, /\boperacj/i,
];
const POS = [
  /\breturns?\b/i, /\bback in training\b/i, /\bback from injury\b/i, /\bcleared\b/i, /\bboost\b/i, /\bfit (again|to play)\b/i, /\bavailable again\b/i, /\bwins? (award|player of)/i, /\bunbeaten\b/i,
  /\bpowr[oó]t/i, /\bwraca\b/i, /\bgotowy do gry\b/i,
];
const NOISE = [/live ?stream/i, /how to watch/i, /where to watch/i, /live score/i, /live ticker/i, /tv channel/i, /prediction/i, /preview/i, /betting/i, /odds/i, /ｓｔｒｅａｍ/i, /free match/i, /highlights/i, /lineups?/i, /line-ups?/i, /vs\.?\s/i, /\bv\b/i,
  // inne sekcje klubu: kobiety, młodzież, legendy, e-sport
  /\b(frauen|women|women's|ladies|u-?1[5-9]|u-?2[0-3]|youth|academy|campus|legends?|esports?|basketball|handball|volleyball|hockey)\b/i];

const unescape = (s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/<!\[CDATA\[|\]\]>/g, '');

const cache = new Map();

export async function teamNews(name, { days = 4, limit = 10 } = {}) {
  if (!name) return empty();
  const key = `${name}|${days}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < 30 * 60_000) return hit.data;
  const q = encodeURIComponent(`"${name}" football when:${days}d`);
  const url = `https://news.google.com/rss/search?q=${q}&hl=en-US&gl=US&ceid=US:en`;
  let xml = '';
  try {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 7000);
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'user-agent': 'Mozilla/5.0 MatchIQ/1.0' } });
    clearTimeout(to);
    if (res.ok) xml = await res.text();
  } catch { /* brak sieci / timeout */ }
  const items = [];
  const re = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = re.exec(xml)) && items.length < 40) {
    const block = m[1];
    const title = unescape((block.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '').trim();
    const link = unescape((block.match(/<link>([\s\S]*?)<\/link>/) || [])[1] || '').trim();
    const pub = (block.match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [])[1] || '';
    const source = unescape((block.match(/<source[^>]*>([\s\S]*?)<\/source>/) || [])[1] || '').trim();
    if (!title) continue;
    const clean = title.replace(/\s-\s[^-]+$/, ''); // usuń " - Źródło" z końca
    const noisy = NOISE.some((r) => r.test(clean));
    const neg = NEG.some((r) => r.test(clean));
    const pos = POS.some((r) => r.test(clean));
    items.push({ title: clean, link, date: pub ? new Date(pub).toISOString() : null, source, tone: neg && !pos ? 'neg' : pos && !neg ? 'pos' : 'neutral', noisy });
  }
  // sygnały najpierw, potem reszta; bez śmieci typu "how to watch"
  const signals = items.filter((i) => !i.noisy && i.tone !== 'neutral');
  const rest = items.filter((i) => !i.noisy && i.tone === 'neutral');
  const headlines = [...signals, ...rest].slice(0, limit);
  const negCount = Math.min(signals.filter((i) => i.tone === 'neg').length, 4);
  const posCount = Math.min(signals.filter((i) => i.tone === 'pos').length, 3);
  const data = { name, headlines, neg: negCount, pos: posCount, score: posCount * 0.5 - negCount, total: items.length };
  cache.set(key, { t: Date.now(), data });
  if (cache.size > 400) cache.delete(cache.keys().next().value);
  return data;
}

function empty() { return { name: '', headlines: [], neg: 0, pos: 0, score: 0, total: 0 }; }

export async function matchNews(homeName, awayName) {
  const [home, away] = await Promise.all([teamNews(homeName).catch(empty), teamNews(awayName).catch(empty)]);
  return { home, away };
}
