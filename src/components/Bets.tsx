import React, { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { usePolling, apiJSON, pct, fmtDate, fmtTime, plural } from '../api';
import type { BetsState, Coupon, BetSettings } from '../types';
import { Tile } from './charts';

const zl = (x: number) => `${x.toFixed(2).replace('.', ',')} zł`;
const TYPE_LABEL: Record<Coupon['type'], string> = { solo: 'Solo', ako2: 'AKO 2', ako3: 'AKO 3' };
const STATUS_LABEL: Record<Coupon['status'], string> = { open: 'Otwarty', won: 'Wygrany', lost: 'Przegrany', void: 'Zwrot' };

export default function Bets({ onOpenMatch }: { onOpenMatch: (leagueId: string, id: string) => void }) {
  const st = usePolling<BetsState>('/api/bets', 60_000);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  const act = async (label: string, fn: () => Promise<any>) => {
    setBusy(label); setMsg(null);
    try { const r = await fn(); if (r?.reason && !r?.created?.length) setMsg(r.reason); else if (r?.created) setMsg(`Utworzono ${plural(r.created.length, ['kupon', 'kupony', 'kuponów'])} (sprawdzono ${r.scanned} meczów, ${r.candidates} spełnia kryteria).`); st.refresh(); }
    catch (e: any) { setMsg(e?.message || 'Błąd'); }
    finally { setBusy(null); }
  };
  const post = (url: string, body?: any) => apiJSON<any>(url, { method: 'POST', body: body || {} });

  if (!st.data) return <div className="content-inner">{st.error ? <div className="errbox">{st.error}</div> : <div className="loading"><div className="spinner" /> Ładuję kupony…</div>}</div>;
  const d = st.data;
  const open = d.coupons.filter((c) => c.status === 'open');
  const done = d.coupons.filter((c) => c.status !== 'open');
  const profitColor = d.stats.profit > 0 ? 'var(--good)' : d.stats.profit < 0 ? 'var(--critical)' : undefined;
  const analysisMode = d.settings.mode !== 'value';

  return (
    <div className="content-inner stack">
      <div className="card" style={{ borderColor: 'rgba(250,178,25,0.35)', background: 'rgba(250,178,25,0.06)' }}>
        <b>Symulacja, nie prawdziwe zakłady.</b> <span className="text-2">Bankroll jest wirtualny. {analysisMode
          ? <>Typ to <b>zwycięzca wg analizy</b> (forma, tabela, dom/wyjazd, świeżość, stawka, H2H, sygnały z sieci) – kurs bukmachera nie ma wpływu na wybór, służy tylko do policzenia kuponu. Typ trafia na kupon, gdy analiza daje mu ≥ {pct(d.settings.minProb)} szans i pewność ≥ {pct(d.settings.minConfidence)}.</>
          : <>Tryb „value”: typ trafia na kupon tylko wtedy, gdy analiza (waga {pct(d.settings.modelWeight)}) daje wyraźnie większe szanse niż kurs (EV ≥ {pct(d.settings.minEdge)}).</>} Kupony rozliczają się same po meczach. Kursy pochodzą z ESPN (DraftKings), u polskich bukmacherów mogą się nieco różnić. Kupon kopiujesz przyciskiem i stawiasz ręcznie.</span>
      </div>

      <div className="tiles">
        <Tile label="Bankroll" value={zl(d.bankroll)} sub={`start ${zl(d.startBankroll)}${d.stats.openStake ? ` · w grze ${zl(d.stats.openStake)}` : ''}`} color="var(--accent)" />
        <Tile label="Zysk / strata" value={`${d.stats.profit > 0 ? '+' : ''}${zl(d.stats.profit)}`} sub={`${d.stats.profit >= 0 ? '+' : ''}${pct(d.stats.profit / d.startBankroll)} kapitału`} color={profitColor} />
        <Tile label="ROI" value={`${d.stats.roi >= 0 ? '+' : ''}${pct(d.stats.roi, 1)}`} sub={`obrót ${zl(d.stats.staked)}`} color={d.stats.roi > 0 ? 'var(--good)' : d.stats.roi < 0 ? 'var(--critical)' : undefined} />
        <Tile label="Kupony" value={`${d.stats.won} / ${d.stats.lost}`} sub={`wygrane / przegrane · ${d.stats.open} otwartych`} />
        <Tile label="Skuteczność" value={pct(d.stats.hitRate)} sub={d.stats.streak ? `seria: ${d.stats.streak > 0 ? `${d.stats.streak} wygranych` : `${-d.stats.streak} przegranych`}` : 'brak rozliczonych'} />
        <Tile label="Najlepsza wygrana" value={`+${zl(d.stats.bestWin)}`} sub="netto na kuponie" />
      </div>

      <div className="grid c21">
        <div className="card">
          <h3>Bankroll w czasie <span className="hint">{d.history.length} zapisów</span></h3>
          <BankrollChart history={d.history} start={d.startBankroll} />
        </div>
        <div className="card">
          <h3>Sterowanie</h3>
          <div className="stack" style={{ gap: 8 }}>
            <button className="chip active" disabled={!!busy} onClick={() => act('gen', () => post('/api/bets/generate', { force: true }))} style={{ justifyContent: 'center', padding: '10px 14px' }}>{busy === 'gen' ? 'Analizuję mecze… (do 2 min)' : 'Generuj kupony teraz'}</button>
            <button className="chip" disabled={!!busy} onClick={() => act('auto', () => post('/api/bets/settings', { auto: !d.settings.auto }))} style={{ justifyContent: 'center', padding: '10px 14px' }}>
              Auto-kupony: <b style={{ color: d.settings.auto ? 'var(--good)' : 'var(--critical)' }}>{d.settings.auto ? 'włączone' : 'wyłączone'}</b>
            </button>
            <button className="chip" onClick={() => setShowSettings((s) => !s)} style={{ justifyContent: 'center', padding: '10px 14px' }}>Ustawienia strategii</button>
            <div className="note">
              Tryb: <b>{analysisMode ? 'analiza (kto wygra wg modelu)' : 'value (przewaga nad kursem)'}</b>. Auto: codziennie od {d.settings.autoHour}:00 do {d.settings.maxCouponsPerDay} kuponów z meczów w ciągu {d.settings.horizonHours} h. Stawka ≤ {pct(d.settings.stakePct)} bankrollu (¼ Kelly). Ligi poziomu ≤ {d.settings.maxTier}.
              {d.lastGeneratedDate && <> Ostatnie generowanie: {d.lastGeneratedDate}.</>}
              {d.lastSettledAt && <> Rozliczenie: {new Date(d.lastSettledAt).toLocaleTimeString('pl-PL')}.</>}
            </div>
            {msg && <div className="note" style={{ color: 'var(--text)' }}>{msg}</div>}
          </div>
          {showSettings && <SettingsForm settings={d.settings} startBankroll={d.startBankroll} onSaved={() => { st.refresh(); }} post={post} />}
        </div>
      </div>

      <section>
        <h3 style={{ fontSize: 13, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-2)', marginBottom: 10 }}>Otwarte kupony <span className="muted">({open.length})</span></h3>
        {open.length === 0 ? <div className="card note">Brak otwartych kuponów. Kliknij „Generuj kupony teraz” albo poczekaj na automat ({d.settings.autoHour}:00).</div> : (
          <div className="grid c2">{open.map((c) => <CouponCard key={c.id} c={c} onOpenMatch={onOpenMatch} onDelete={() => act('del', () => apiJSON(`/api/bets/coupon/${c.id}`, { method: 'DELETE' }))} />)}</div>
        )}
      </section>

      <section>
        <h3 style={{ fontSize: 13, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-2)', marginBottom: 10 }}>Rozliczone <span className="muted">({done.length})</span></h3>
        {done.length === 0 ? <div className="card note">Jeszcze nic nie rozliczono – kupony rozliczają się automatycznie po zakończeniu meczów.</div> : (
          <div className="grid c2">{done.map((c) => <CouponCard key={c.id} c={c} onOpenMatch={onOpenMatch} />)}</div>
        )}
      </section>
    </div>
  );
}

function couponText(c: Coupon) {
  const lines = c.picks.map((p) => `${fmtDate(p.kickoff)} ${fmtTime(p.kickoff)} · ${p.leagueName} · ${p.home} – ${p.away}: ${p.selLabel} @ ${p.odds.toFixed(2)}`);
  return `MatchIQ kupon ${TYPE_LABEL[c.type]}\n${lines.join('\n')}\nStawka ${zl(c.stake)} · kurs łączny ${c.totalOdds.toFixed(2)} · możliwa wygrana ${zl(c.potentialWin)}`;
}

function CouponCard({ c, onOpenMatch, onDelete }: { c: Coupon; onOpenMatch: (l: string, id: string) => void; onDelete?: () => void }) {
  const [copied, setCopied] = useState(false);
  const canDelete = onDelete && c.status === 'open' && c.picks.every((p) => new Date(p.kickoff).getTime() > Date.now());
  const copy = async () => { try { await navigator.clipboard.writeText(couponText(c)); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* ignore */ } };
  return (
    <motion.div className={`coupon ${c.status}`} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
      <div className="chead">
        <span className="badge type">{TYPE_LABEL[c.type]}</span>
        <span className={`badge st ${c.status}`}>{STATUS_LABEL[c.status]}</span>
        <span className="muted">{fmtDate(c.createdAt)} {fmtTime(c.createdAt)}</span>
        <span style={{ marginLeft: 'auto' }} className="mono">szansa {pct(c.pEst)}</span>
      </div>
      <div className="picks">
        {c.picks.map((p, i) => (
          <div className={`pick ${p.status}`} key={i} onClick={() => onOpenMatch(p.leagueId, p.matchId)} title="Otwórz analizę meczu">
            <div className="when">{fmtTime(p.kickoff)}<small>{fmtDate(p.kickoff).slice(0, 5)}</small></div>
            <div className="match">
              <div className="teams">{p.homeLogo && <img src={p.homeLogo} alt="" />}{p.home} – {p.away}{p.awayLogo && <img src={p.awayLogo} alt="" />}{p.result && <span className="mono res">{p.result}</span>}</div>
              <div className="meta">{p.leagueName} · typ <b>{p.selLabel}</b> · analiza <b>{pct(p.pModel)}</b>{p.pMarket ? <> · kurs sugeruje {pct(p.pMarket)}</> : null} · pewność {pct(p.confidence)}{p.mode === 'value' && <> · przewaga {p.ev >= 0 ? '+' : ''}{pct(p.ev)}</>}</div>
              {p.why && <div className="meta why">Dlaczego: {p.why}</div>}
              {p.news && (p.news.home.top.length > 0 || p.news.away.top.length > 0) && (
                <div className="meta news">
                  {p.news.home.top.map((h, k) => <span key={`h${k}`} className={h.tone}>{h.tone === 'neg' ? '⚠' : '↑'} {p.home}: {h.title}</span>)}
                  {p.news.away.top.map((h, k) => <span key={`a${k}`} className={h.tone}>{h.tone === 'neg' ? '⚠' : '↑'} {p.away}: {h.title}</span>)}
                </div>
              )}
            </div>
            <div className="odds mono">{p.odds.toFixed(2)}</div>
            <div className={`pst ${p.status}`}>{p.status === 'won' ? '✓' : p.status === 'lost' ? '✗' : p.status === 'void' ? '↺' : '…'}</div>
          </div>
        ))}
      </div>
      <div className="cfoot">
        <span>Stawka <b>{zl(c.stake)}</b></span>
        <span>Kurs <b className="mono">{c.totalOdds.toFixed(2)}</b></span>
        <span>{c.status === 'won' ? <>Wypłata <b style={{ color: 'var(--good)' }}>{zl(c.payout)}</b></> : c.status === 'lost' ? <>Strata <b style={{ color: 'var(--critical)' }}>−{zl(c.stake)}</b></> : c.status === 'void' ? <>Zwrot <b>{zl(c.payout)}</b></> : <>Możliwa wygrana <b>{zl(c.potentialWin)}</b></>}</span>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          <button className="chip" onClick={copy}>{copied ? 'Skopiowano' : 'Kopiuj kupon'}</button>
          {canDelete && <button className="chip" onClick={onDelete} title="Anuluj kupon i zwróć stawkę">Anuluj</button>}
        </span>
      </div>
    </motion.div>
  );
}

function BankrollChart({ history, start }: { history: BetsState['history']; start: number }) {
  const pts = useMemo(() => history.map((h) => ({ t: new Date(h.t).getTime(), v: h.bankroll, note: h.note })), [history]);
  const [hover, setHover] = useState<number | null>(null);
  if (pts.length < 2) return <div className="note">Wykres pojawi się po pierwszych rozliczonych kuponach.</div>;
  const W = 600, H = 180, px = 36, py = 14;
  const t0 = pts[0].t, t1 = pts[pts.length - 1].t || t0 + 1;
  const vmin = Math.min(start, ...pts.map((p) => p.v)) * 0.9, vmax = Math.max(start, ...pts.map((p) => p.v)) * 1.1 || 1;
  const X = (t: number) => px + ((t - t0) / Math.max(1, t1 - t0)) * (W - 2 * px);
  const Y = (v: number) => py + (1 - (v - vmin) / Math.max(0.01, vmax - vmin)) * (H - 2 * py);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'} ${X(p.t)} ${Y(p.v)}`).join(' ');
  const h = hover != null ? pts[hover] : null;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ maxHeight: 220 }} onMouseLeave={() => setHover(null)}>
      {[0.25, 0.5, 0.75].map((f) => <line key={f} x1={px} x2={W - px} y1={py + f * (H - 2 * py)} y2={py + f * (H - 2 * py)} stroke="var(--grid)" />)}
      <line x1={px} x2={W - px} y1={Y(start)} y2={Y(start)} stroke="var(--muted)" strokeDasharray="4 4" />
      <text x={W - px + 4} y={Y(start) + 4} fontSize={10} fill="var(--muted)">start</text>
      <motion.path d={d} fill="none" stroke="var(--accent)" strokeWidth={2} initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.8 }} />
      {pts.map((p, i) => <circle key={i} cx={X(p.t)} cy={Y(p.v)} r={hover === i ? 5 : 3} fill="var(--accent)" stroke="var(--surface)" strokeWidth={2} onMouseEnter={() => setHover(i)} style={{ cursor: 'pointer' }} />)}
      <text x={px - 4} y={Y(vmax / 1.1) + 4} fontSize={10} fill="var(--muted)" textAnchor="end">{(vmax / 1.1).toFixed(0)}</text>
      <text x={px - 4} y={Y(vmin / 0.9) + 4} fontSize={10} fill="var(--muted)" textAnchor="end">{(vmin / 0.9).toFixed(0)}</text>
      {h && (
        <g>
          <rect x={Math.min(X(h.t) + 8, W - 190)} y={8} width={182} height={34} rx={6} fill="var(--bg)" stroke="var(--border-strong)" />
          <text x={Math.min(X(h.t) + 14, W - 184)} y={22} fontSize={11} fill="var(--text)">{zl(h.v)} · {new Date(h.t).toLocaleDateString('pl-PL')} {new Date(h.t).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })}</text>
          <text x={Math.min(X(h.t) + 14, W - 184)} y={36} fontSize={10} fill="var(--text-2)">{h.note || ''}</text>
        </g>
      )}
    </svg>
  );
}

function SettingsForm({ settings, startBankroll, onSaved, post }: { settings: BetSettings; startBankroll: number; onSaved: () => void; post: (u: string, b?: any) => Promise<any> }) {
  const [s, setS] = useState<BetSettings>(settings);
  const [start, setStart] = useState(String(startBankroll));
  const [saving, setSaving] = useState(false);
  const num = (k: keyof BetSettings) => ({ value: String((s as any)[k]), onChange: (e: React.ChangeEvent<HTMLInputElement>) => setS({ ...s, [k]: Number(e.target.value) }) });
  const save = async () => { setSaving(true); try { await post('/api/bets/settings', s); onSaved(); } finally { setSaving(false); } };
  const reset = async () => { if (!window.confirm(`Zresetować bankroll do ${start} zł i usunąć wszystkie kupony?`)) return; setSaving(true); try { await post('/api/bets/reset', { start: Number(start) }); onSaved(); } finally { setSaving(false); } };
  const value = s.mode === 'value';
  return (
    <div className="settings">
      <label style={{ gridColumn: '1 / -1' }}>Tryb typowania
        <select value={s.mode || 'analysis'} onChange={(e) => setS({ ...s, mode: e.target.value as BetSettings['mode'] })}>
          <option value="analysis">Analiza – typuj zwycięzcę wg modelu (kurs bez znaczenia)</option>
          <option value="value">Value – tylko typy z przewagą nad kursem</option>
        </select>
      </label>
      {!value && <label>Min. szansa typu wg analizy (0,34–0,9)<input type="number" step={0.01} min={0.34} max={0.9} {...num('minProb')} /></label>}
      <label>Min. pewność analizy<input type="number" step={0.05} min={0.2} max={0.95} {...num('minConfidence')} /></label>
      <label>Maks. kuponów dziennie<input type="number" min={1} max={10} {...num('maxCouponsPerDay')} /></label>
      <label>Godzina auto-generowania<input type="number" min={0} max={23} {...num('autoHour')} /></label>
      <label>Maks. stawka (% bankrollu)<input type="number" step={0.01} min={0.01} max={0.25} {...num('stakePct')} /></label>
      {value && <label>Min. przewaga EV (np. 0,04)<input type="number" step={0.01} min={0} max={0.3} {...num('minEdge')} /></label>}
      {value && <label>Waga analizy vs kurs (0,3–1)<input type="number" step={0.05} min={0.3} max={1} {...num('modelWeight')} /></label>}
      {value && <label>Kurs min.<input type="number" step={0.05} min={1.05} max={3} {...num('minOdds')} /></label>}
      {value && <label>Kurs maks.<input type="number" step={0.1} min={1.5} max={20} {...num('maxOdds')} /></label>}
      <label>Ligi do poziomu (1–4)<input type="number" min={1} max={4} {...num('maxTier')} /></label>
      <label>Horyzont (godzin)<input type="number" min={6} max={72} {...num('horizonHours')} /></label>
      <label>Bankroll startowy (reset)<input type="number" step={1} min={1} value={start} onChange={(e) => setStart(e.target.value)} /></label>
      <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button className="chip active" disabled={saving} onClick={save}>Zapisz ustawienia</button>
        <button className="chip" disabled={saving} onClick={reset} style={{ color: '#ffb3b3' }}>Resetuj bankroll i historię</button>
      </div>
    </div>
  );
}
