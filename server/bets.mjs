// Wirtualny bankroll i kupony: typy z analizy (kto wygra wg modelu, niezależnie od kursu),
// automatyczne rozliczanie po meczach, historia i statystyki. Symulacja – nic nie jest stawiane u bukmachera.
// Moduł nie zależy od Node (fs) – zapis przez wstrzykiwany adapter (plik na serwerze, localStorage w aplikacji mobilnej).
import { fetchFootballWindow, todayKey, shiftDateKey, mapLimit, TZ } from './espn.mjs';
import { getFootballMatch } from './football.mjs';

const DEFAULT_SETTINGS = {
  auto: true,               // generuj kupony automatycznie raz dziennie
  autoHour: 9,              // od której godziny (Europe/Warsaw)
  maxCouponsPerDay: 3,
  stakePct: 0.08,           // maks. udział bankrollu na kupon
  mode: 'analysis',         // 'analysis' = typ to zwycięzca wg analizy (kurs nieistotny); 'value' = tylko typy z przewagą nad kursem
  minProb: 0.45,            // tryb analysis: minimalne prawdopodobieństwo typu wg modelu
  minEdge: 0.04,            // tryb value: minimalna przewaga (EV) typu
  modelWeight: 1,           // tryb value: ile liczy się analiza vs kurs bukmachera (1 = tylko analiza)
  minOdds: 1.35,            // tryb value: zakres kursów
  maxOdds: 4.5,
  minConfidence: 0.4,
  maxTier: 2,               // tylko ligi 1–2 poziomu (jakość danych)
  horizonHours: 30,         // mecze w ciągu najbliższych X godzin
};

// ---------- zapis (adapter) ----------
let persist = {
  read: () => null,          // -> string | object | null
  write: (_json) => {},      // <- string (JSON)
};
let state = null;

/** Podłącz sposób zapisu stanu kuponów (serwer: plik; aplikacja: localStorage). */
export function configureBetsStorage(adapter) {
  persist = { ...persist, ...adapter };
  state = null;
}

function load() {
  if (state) return state;
  try {
    const raw = persist.read();
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.coupons)) throw new Error('empty');
    state = parsed;
    state.settings = { ...DEFAULT_SETTINGS, ...(state.settings || {}) };
  } catch {
    state = fresh(30);
    save();
  }
  return state;
}

function fresh(start) {
  return {
    version: 2,
    startBankroll: start,
    bankroll: start,
    settings: { ...DEFAULT_SETTINGS },
    coupons: [],
    history: [{ t: new Date().toISOString(), bankroll: start, note: 'start' }],
    lastGeneratedDate: null,
    lastSettledAt: null,
  };
}

function save() {
  try { persist.write(JSON.stringify(state, null, 2)); } catch (e) { console.error('[kupony] zapis nieudany:', e.message); }
}

const dec = (ml) => (ml == null || Number.isNaN(Number(ml)) ? null : Number(ml) > 0 ? 1 + Number(ml) / 100 : 1 + 100 / -Number(ml));
const r2 = (x) => Math.round(x * 100) / 100;
const round05 = (x) => Math.round(x * 2) / 2;
const SEL_LABEL = { home: '1', draw: 'X', away: '2' };

function localHour() {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', hour12: false }).format(new Date()));
}

// ---------- kandydaci ----------
export async function findValuePicks(settings = load().settings) {
  const now = Date.now();
  const today = todayKey();
  const { events } = await fetchFootballWindow(today);
  const extra = await fetchFootballWindow(shiftDateKey(today, 2)).catch(() => ({ events: [] }));
  const seen = new Set();
  const pre = [];
  for (const e of [...events, ...extra.events]) {
    if (seen.has(e.id)) continue;
    seen.add(e.id);
    const t = new Date(e.date).getTime();
    if (e.state !== 'pre' || e.league.tier > settings.maxTier) continue;
    if (t < now + 30 * 60_000 || t > now + settings.horizonHours * 3600_000) continue;
    pre.push(e);
  }
  pre.sort((a, b) => a.league.tier - b.league.tier || new Date(a.date) - new Date(b.date));
  const chosen = pre.slice(0, 28);
  // kursy przedmeczowe są w szczegółach meczu (summary), nie zawsze na liście
  const details = await mapLimit(chosen, 4, (m) => getFootballMatch(m.league.id, m.id));
  const picks = [];
  const mode = settings.mode === 'value' ? 'value' : 'analysis';
  chosen.forEach((m0, i) => {
    const d = details[i];
    if (!d || d.__error) return;
    const m = d.summary;
    if (!m.market?.raw) return; // bez kursu nie da się policzyć kuponu
    const a = d.analysis;
    const raw = m.market.raw;
    const odds = { home: dec(raw.home), draw: dec(raw.draw), away: dec(raw.away) };
    const gpOf = (t) => Math.max(t.table?.gp ?? 0, t.record?.overall?.gp ?? 0, (t.lastFive?.length ?? 0) > 0 ? 3 : 0);
    const games = Math.min(gpOf(d.teams.home), gpOf(d.teams.away));
    const base = (sel, pModel, pEst, o) => ({
      matchId: m.id, leagueId: m.league.id, leagueName: m.league.name, kickoff: m.date,
      home: m.home.short, away: m.away.short, homeLogo: m.home.logo, awayLogo: m.away.logo,
      sel, selLabel: sel === 'draw' ? 'X (remis)' : `${SEL_LABEL[sel]} (${sel === 'home' ? m.home.short : m.away.short})`,
      odds: r2(o), pModel: r2(pModel), pMarket: r2(m.market[sel] ?? 0), pEst: r2(pEst), ev: r2(pEst * o - 1), confidence: a.confidence,
      modelWeight: 1, games, mode,
      why: explainPick(sel, d), news: newsSummary(d, sel), status: 'open',
    });

    if (mode === 'analysis') {
      // typ = najbardziej prawdopodobny wynik wg analizy; kurs służy tylko do policzenia kuponu
      const model = a.model;
      const sel = ['home', 'draw', 'away'].sort((x, y) => model[y] - model[x])[0];
      const pModel = model[sel];
      const o = odds[sel];
      if (!o || pModel == null) return;
      if (pModel < (settings.minProb ?? 0.45) || a.confidence < settings.minConfidence) return;
      picks.push(base(sel, pModel, pModel, o));
      return;
    }

    // tryb value: im mniej meczów w sezonie, tym mniej ufamy analizie względem kursu
    const dataFactor = Math.max(0.35, Math.min(1, (games + 2) / 10));
    const w = (settings.modelWeight ?? 1) * dataFactor;
    let best = null;
    for (const sel of ['home', 'draw', 'away']) {
      const o = odds[sel];
      if (!o || o < settings.minOdds || o > settings.maxOdds) continue;
      const pModel = a.model[sel];
      const pMarket = m.market[sel];
      if (pModel == null || pMarket == null) continue;
      const pEst = w * pModel + (1 - w) * pMarket;
      const ev = pEst * o - 1;
      if (ev < settings.minEdge || a.confidence < settings.minConfidence) continue;
      const pick = { ...base(sel, pModel, pEst, o), modelWeight: r2(w) };
      if (!best || pick.ev > best.ev) best = pick;
    }
    if (best) picks.push(best);
  });
  if (mode === 'analysis') picks.sort((a, b) => b.pModel * b.confidence - a.pModel * a.confidence);
  else picks.sort((a, b) => b.ev - a.ev);
  return { picks, scanned: chosen.length, mode };
}

// uzasadnienie typu z analizy: mocna strona typowanej strony + słabość rywala + kontekst dom/wyjazd
function explainPick(sel, d) {
  const a = d.analysis;
  const parts = [];
  if (sel === 'draw') {
    parts.push('Model widzi wyrównany mecz');
    const w1 = a.insights.home.find((i) => i.kind === 'weakness'); const w2 = a.insights.away.find((i) => i.kind === 'weakness');
    if (w1) parts.push(`${d.teams.home.short}: ${lower(w1.text)}`);
    if (w2) parts.push(`${d.teams.away.short}: ${lower(w2.text)}`);
  } else {
    const me = sel, opp = sel === 'home' ? 'away' : 'home';
    const s = a.insights[me].find((i) => i.kind === 'strength');
    const w = a.insights[opp].find((i) => i.kind === 'weakness');
    const split = d.teams[me].record?.[me];
    parts.push(me === 'home' ? `${d.teams.home.short} u siebie` : `${d.teams.away.short} na wyjeździe`);
    if (split && split.gp >= 2) parts[0] += ` (${split.w}-${split.d}-${split.l} w tym sezonie)`;
    if (s) parts.push(lower(s.text));
    if (w) parts.push(`rywal: ${lower(w.text)}`);
    const hs = d.h2h?.summary;
    if (hs && hs.total >= 2) parts.push(`H2H ${me === 'home' ? hs.homeWins : hs.awayWins}-${hs.draws}-${me === 'home' ? hs.awayWins : hs.homeWins}`);
  }
  if (a.verdict?.why) parts.push(`za: ${a.verdict.why}`);
  return parts.join(' · ');
}
const lower = (s) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);

function newsSummary(d, sel) {
  const n = d.news;
  if (!n) return null;
  const pickSide = (side) => ({ neg: n.signal[side].neg, pos: n.signal[side].pos, top: n[side].filter((h) => h.tone !== 'neutral').slice(0, 2).map((h) => ({ title: h.title, tone: h.tone, source: h.source, link: h.link })) });
  return { home: pickSide('home'), away: pickSide('away') };
}

// ---------- budowa kuponów ----------
function kellyStake(bankroll, p, odds, settings) {
  const f = (p * odds - 1) / (odds - 1);
  const frac = Math.min(settings.stakePct, Math.max(0.02, f / 4));
  const stake = round05(bankroll * frac);
  return Math.max(1, Math.min(stake, round05(bankroll * 0.15)));
}

function makeCoupon(picks, type, bankroll, settings) {
  const totalOdds = picks.reduce((s, p) => s * p.odds, 1);
  const pAll = picks.reduce((s, p) => s * p.pEst, 1);
  const stake = kellyStake(bankroll, pAll, totalOdds, settings);
  return {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    createdAt: new Date().toISOString(),
    date: todayKey(),
    type,
    picks: picks.map((p) => ({ ...p })),
    stake,
    totalOdds: r2(totalOdds),
    potentialWin: r2(stake * totalOdds),
    pEst: r2(pAll),
    ev: r2(pAll * totalOdds - 1),
    status: 'open',
    payout: 0,
  };
}

export async function generateCoupons({ force = false } = {}) {
  const st = load();
  const s = st.settings;
  const today = todayKey();
  const todayCount = st.coupons.filter((c) => c.date === today).length;
  const room = s.maxCouponsPerDay - todayCount;
  if (room <= 0 && !force) return { created: [], reason: 'Limit kuponów na dziś wyczerpany' };
  if (st.bankroll < 1) return { created: [], reason: 'Bankroll poniżej 1 zł – zresetuj lub czekaj na rozliczenie' };

  const { picks: all, scanned } = await findValuePicks(s);
  const usedMatches = new Set(st.coupons.filter((c) => c.status === 'open').flatMap((c) => c.picks.map((p) => p.matchId)));
  const picks = all.filter((p) => !usedMatches.has(p.matchId));
  if (!picks.length) return { created: [], reason: `Brak typów (${scanned} meczów sprawdzonych, ${all.length} spełnia kryteria, wszystkie już na kuponach)` };

  const created = [];
  let bankroll = st.bankroll;
  const take = (n, from) => from.splice(0, n);
  const pool = [...picks];
  const slots = force ? Math.max(room, 1) : room;

  // 1) solo – najpewniejszy typ
  if (created.length < slots && pool.length >= 1) created.push(makeCoupon(take(1, pool), 'solo', bankroll, s));
  // 2) AKO 2 – kolejne dwa typy
  if (created.length < slots && pool.length >= 2) created.push(makeCoupon(take(2, pool), 'ako2', bankroll, s));
  // 3) "bezpieczny" AKO – faworyci o wysokim prawdopodobieństwie
  if (created.length < slots) {
    const safe = pool.filter((p) => p.pEst >= 0.55).slice(0, 3);
    if (safe.length >= 2) {
      for (const p of safe) pool.splice(pool.indexOf(p), 1);
      created.push(makeCoupon(safe, safe.length === 3 ? 'ako3' : 'ako2', bankroll, s));
    } else if (pool.length >= 1) created.push(makeCoupon(take(1, pool), 'solo', bankroll, s));
  }
  // dodatkowe sola, jeśli limit dnia jest większy
  while (created.length < slots && pool.length >= 1) created.push(makeCoupon(take(1, pool), 'solo', bankroll, s));

  for (const c of created) {
    if (c.stake > bankroll) { c.stake = round05(bankroll); c.potentialWin = r2(c.stake * c.totalOdds); }
    if (c.stake < 0.5) continue;
    bankroll = r2(bankroll - c.stake);
    st.coupons.push(c);
  }
  st.bankroll = bankroll;
  st.lastGeneratedDate = today;
  st.history.push({ t: new Date().toISOString(), bankroll, note: `kupony: ${created.length}` });
  save();
  return { created, scanned, candidates: all.length };
}

// ---------- rozliczanie ----------
export async function settleCoupons() {
  const st = load();
  const open = st.coupons.filter((c) => c.status === 'open');
  if (!open.length) { st.lastSettledAt = new Date().toISOString(); save(); return { settled: 0 }; }
  const days = new Set();
  for (const c of open) for (const p of c.picks) {
    const k = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(p.kickoff));
    days.add(k);
  }
  const byId = new Map();
  for (const day of days) {
    try {
      const { events } = await fetchFootballWindow(day);
      for (const e of events) byId.set(e.id, e);
    } catch { /* spróbujemy następnym razem */ }
  }
  let settled = 0;
  const now = Date.now();
  for (const c of open) {
    let changed = false;
    for (const p of c.picks) {
      if (p.status !== 'open') continue;
      const e = byId.get(p.matchId);
      if (e && e.state === 'post') {
        if (/Przełożony|Odwołany|Przerwany/.test(e.statusText)) { p.status = 'void'; p.result = null; }
        else {
          const h = Number(e.home.score ?? 0), a = Number(e.away.score ?? 0);
          const res = h > a ? 'home' : h < a ? 'away' : 'draw';
          p.result = `${h}:${a}`;
          p.status = res === p.sel ? 'won' : 'lost';
        }
        changed = true;
      } else if (!e && new Date(p.kickoff).getTime() < now - 3 * 86400_000) {
        p.status = 'void'; changed = true;
      } else if (e && /Przełożony|Odwołany/.test(e.statusText)) {
        p.status = 'void'; changed = true;
      }
    }
    if (!changed) continue;
    if (c.picks.some((p) => p.status === 'lost')) {
      c.status = 'lost'; c.payout = 0; c.settledAt = new Date().toISOString(); settled++;
      st.history.push({ t: c.settledAt, bankroll: st.bankroll, note: `przegrany ${c.type} (−${c.stake} zł)` });
    } else if (c.picks.every((p) => p.status !== 'open')) {
      const wonLegs = c.picks.filter((p) => p.status === 'won');
      if (!wonLegs.length) { c.status = 'void'; c.payout = c.stake; }
      else { c.status = 'won'; c.payout = r2(c.stake * wonLegs.reduce((s, p) => s * p.odds, 1)); }
      st.bankroll = r2(st.bankroll + c.payout);
      c.settledAt = new Date().toISOString(); settled++;
      st.history.push({ t: c.settledAt, bankroll: st.bankroll, note: c.status === 'won' ? `wygrany ${c.type} (+${c.payout} zł)` : 'zwrot' });
    }
  }
  st.lastSettledAt = new Date().toISOString();
  save();
  return { settled };
}

// ---------- API ----------
export function getState() {
  const st = load();
  const done = st.coupons.filter((c) => c.status !== 'open');
  const won = done.filter((c) => c.status === 'won');
  const lost = done.filter((c) => c.status === 'lost');
  const staked = done.reduce((s, c) => s + (c.status === 'void' ? 0 : c.stake), 0);
  const returned = won.reduce((s, c) => s + c.payout, 0);
  const openStake = st.coupons.filter((c) => c.status === 'open').reduce((s, c) => s + c.stake, 0);
  let streak = 0;
  for (const c of [...done].sort((a, b) => new Date(b.settledAt) - new Date(a.settledAt))) {
    if (c.status === 'void') continue;
    if (streak === 0) streak = c.status === 'won' ? 1 : -1;
    else if ((streak > 0 && c.status === 'won')) streak++;
    else if ((streak < 0 && c.status === 'lost')) streak--;
    else break;
  }
  return {
    bankroll: st.bankroll,
    startBankroll: st.startBankroll,
    settings: st.settings,
    stats: {
      profit: r2(st.bankroll + openStake - st.startBankroll),
      roi: staked > 0 ? r2((returned - staked) / staked) : 0,
      staked: r2(staked), returned: r2(returned), openStake: r2(openStake),
      won: won.length, lost: lost.length, void: done.length - won.length - lost.length, open: st.coupons.length - done.length,
      hitRate: won.length + lost.length ? r2(won.length / (won.length + lost.length)) : 0,
      streak,
      bestWin: won.reduce((m, c) => Math.max(m, c.payout - c.stake), 0),
    },
    coupons: [...st.coupons].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 200),
    history: st.history.slice(-300),
    lastGeneratedDate: st.lastGeneratedDate,
    lastSettledAt: st.lastSettledAt,
    today: todayKey(),
  };
}

export function updateSettings(patch) {
  const st = load();
  const num = (k, lo, hi) => { if (patch[k] != null && Number.isFinite(Number(patch[k]))) st.settings[k] = Math.max(lo, Math.min(hi, Number(patch[k]))); };
  if (patch.auto != null) st.settings.auto = !!patch.auto;
  if (patch.mode === 'analysis' || patch.mode === 'value') st.settings.mode = patch.mode;
  num('autoHour', 0, 23); num('maxCouponsPerDay', 1, 10); num('stakePct', 0.01, 0.25); num('minProb', 0.34, 0.9); num('minEdge', 0, 0.3); num('modelWeight', 0.3, 1);
  num('minOdds', 1.05, 3); num('maxOdds', 1.5, 20); num('minConfidence', 0.2, 0.95); num('maxTier', 1, 4); num('horizonHours', 6, 72);
  save();
  return st.settings;
}

export function resetBankroll(start) {
  const s = Number(start);
  const keep = load().settings;
  state = fresh(Number.isFinite(s) && s > 0 ? r2(s) : 30);
  state.settings = keep;
  save();
  return getState();
}

export function deleteCoupon(id) {
  const st = load();
  const c = st.coupons.find((x) => x.id === id);
  if (!c) { const e = new Error('Nie ma takiego kuponu'); e.status = 404; throw e; }
  if (c.status !== 'open') { const e = new Error('Kupon jest już rozliczony'); e.status = 400; throw e; }
  const started = c.picks.some((p) => new Date(p.kickoff).getTime() <= Date.now());
  if (started) { const e = new Error('Mecz z kuponu już się rozpoczął – nie można anulować'); e.status = 400; throw e; }
  st.coupons = st.coupons.filter((x) => x.id !== id);
  st.bankroll = r2(st.bankroll + c.stake);
  st.history.push({ t: new Date().toISOString(), bankroll: st.bankroll, note: 'anulowany kupon' });
  save();
  return getState();
}

// harmonogram: rozliczanie co 5 min, automatyczne kupony raz dziennie
let timer = null;
let lastSettleRun = 0;
export function startScheduler() {
  if (timer) return;
  const tick = async () => {
    try {
      const st = load();
      if (Date.now() - lastSettleRun > 4 * 60_000) { lastSettleRun = Date.now(); await settleCoupons(); }
      if (st.settings.auto && st.lastGeneratedDate !== todayKey() && localHour() >= st.settings.autoHour) {
        const r = await generateCoupons();
        console.log(`[kupony] auto: ${r.created.length} nowych (${r.reason || 'ok'})`);
        if (!r.created.length) { st.lastGeneratedDate = todayKey(); save(); }
      }
    } catch (e) { console.error('[kupony] scheduler:', e.message); }
  };
  timer = setInterval(tick, 5 * 60_000);
  setTimeout(tick, 15_000);
}

export async function settleIfStale() {
  if (Date.now() - lastSettleRun > 60_000) { lastSettleRun = Date.now(); await settleCoupons(); }
}
