import React, { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { usePolling, apiJSON, pct, fmtDate, fmtTime } from '../api';
import type { AccuracyResponse, EloResponse, MatchItem } from '../types';
import { Tile } from './charts';

const r1 = (x: number) => `${(x * 100).toFixed(1)}%`;

export default function Model({ onOpenMatch, onPick }: { onOpenMatch: (leagueId: string, id: string) => void; onPick?: (m: MatchItem) => void }) {
  const acc = usePolling<AccuracyResponse>('/api/accuracy', 10 * 60_000);
  const elo = usePolling<EloResponse>('/api/elo', 30 * 60_000);
  const [league, setLeague] = useState<string | null>(null);
  const [tour, setTour] = useState<'atp' | 'wta'>('atp');
  const [busy, setBusy] = useState(false);

  if (!acc.data) return <div className="content-inner">{acc.error ? <div className="errbox">{acc.error}</div> : <div className="loading"><div className="spinner" /> Ładuję skuteczność modelu…</div>}</div>;
  const d = acc.data;
  const remote = d.remote;
  const bt = remote?.backtest;
  const tr = remote?.tracked;
  const mine = d.mine;
  const test = bt?.test;
  const leagues = elo.data?.leagues || [];
  const activeLeague = leagues.find((l) => l.slug === league) || leagues[0];

  const clearMine = async () => {
    if (!window.confirm('Usunąć historię „Moich prognoz”?')) return;
    setBusy(true);
    try { await apiJSON('/api/track', { method: 'DELETE' }); acc.refresh(); } finally { setBusy(false); }
  };

  return (
    <div className="content-inner stack">
      <div className="card modelhead">
        <div>
          <h2 style={{ fontSize: 22, marginBottom: 6 }}>Skuteczność modelu</h2>
          <p className="text-2" style={{ margin: 0, fontSize: 13, maxWidth: 760 }}>
            Wszystko poniżej liczy się automatycznie: backtest na {bt?.history?.footballMatches?.toLocaleString('pl-PL') || '—'} meczach z {bt?.history?.leagues || 42} lig (wagi dopasowane tylko na danych sprzed {bt?.history?.splitDate ? fmtDate(bt.history.splitDate) : 'daty podziału'}, sprawdzone na późniejszych), codzienny tracker prognoz porównywany z kursami oraz Twoje własne prognozy.
            100% trafności nie istnieje – bukmacherzy trafiają zwycięzcę meczu piłkarskiego w ok. 53–56% przypadków. Celem jest bicie kursów o kilka punktów procentowych i dobra kalibracja.
          </p>
        </div>
        <div className="note" style={{ textAlign: 'right' }}>
          {remote?.generatedAt ? <>dane z {fmtDate(remote.generatedAt)} {fmtTime(remote.generatedAt)}</> : 'dane z pipeline’u jeszcze niedostępne'}
          {d.ratings && <><br />Elo: {d.ratings.teams} drużyn · xG: {d.ratings.xgTeams} drużyn · tenis: {d.ratings.tennisPlayers} graczy</>}
        </div>
      </div>

      {test && (
        <section>
          <h3 className="sect">Backtest – mecze, których model nie widział podczas dopasowania <span className="muted">({test.n.toLocaleString('pl-PL')} meczów od {bt?.history?.splitDate ? fmtDate(bt.history.splitDate) : '—'})</span></h3>
          <div className="tiles">
            <Tile label="Trafność (zwycięzca)" value={r1(test.model.accuracy)} sub={`domyślne wagi: ${r1(test.defaultParams.accuracy)}`} color="var(--accent)" />
            <Tile label="Log-loss" value={test.model.logloss.toFixed(3)} sub={`niżej = lepiej · domyślne ${test.defaultParams.logloss.toFixed(3)}`} />
            <Tile label="Brier" value={test.model.brier.toFixed(3)} sub="0 = idealnie, 0,667 = losowo" />
            <Tile label="Bez Elo" value={r1(test.withoutElo.accuracy)} sub={`log-loss ${test.withoutElo.logloss.toFixed(3)}`} />
            <Tile label="Bez xG" value={r1(test.withoutXg.accuracy)} sub={`log-loss ${test.withoutXg.logloss.toFixed(3)}`} />
            {bt?.tennis && <Tile label="Tenis: faworyt Elo" value={r1(bt.tennis.accuracySurface)} sub={`${bt.tennis.n} meczów z ${bt.tennis.days} dni · ogólne ${r1(bt.tennis.accuracyAll)}`} />}
          </div>
          <div className="grid c2" style={{ marginTop: 14 }}>
            <div className="card">
              <h3>Kalibracja <span className="hint">czy „60%” znaczy 60%</span></h3>
              <Calibration rows={test.calibration} />
              <div className="note" style={{ marginTop: 8 }}>Słupek = jak często faworyt faktycznie wygrał w danym przedziale przewidywanej szansy. Linia = ideał.</div>
            </div>
            <div className="card">
              <h3>Co model typuje i jak trafia <span className="hint">wg wyniku</span></h3>
              <table className="tbl">
                <thead><tr><th>Wynik</th><th className="num">Zdarzył się</th><th className="num">Typowany</th><th className="num">Trafiony</th><th className="num">Precyzja</th></tr></thead>
                <tbody>
                  {(['home', 'draw', 'away'] as const).map((k) => { const o = test.byOutcome[k]; return (
                    <tr key={k}><td>{k === 'home' ? 'Gospodarz' : k === 'draw' ? 'Remis' : 'Gość'}</td><td className="num">{o.n}</td><td className="num">{o.predicted}</td><td className="num">{o.hit}</td><td className="num" style={{ fontWeight: 700 }}>{pct(o.precision)}</td></tr>
                  ); })}
                </tbody>
              </table>
              <div className="note" style={{ marginTop: 8 }}>Remisy są najtrudniejsze do przewidzenia – model typuje je rzadko, dlatego liczba typów remisu jest mała.</div>
            </div>
          </div>
          <div className="card" style={{ marginTop: 14 }}>
            <h3>Trafność w ligach <span className="hint">mecze testowe</span></h3>
            <div style={{ overflowX: 'auto' }}>
              <table className="tbl">
                <thead><tr><th>Liga</th><th className="num">Mecze</th><th className="num">Trafność</th><th className="num">Log-loss</th></tr></thead>
                <tbody>
                  {test.perLeague.filter((l) => l.model.n >= 20).slice(0, 30).map((l) => (
                    <tr key={l.league}><td>{l.name}</td><td className="num">{l.model.n}</td><td className="num" style={{ fontWeight: 700, color: l.model.accuracy >= 0.5 ? 'var(--good)' : undefined }}>{r1(l.model.accuracy)}</td><td className="num">{l.model.logloss.toFixed(3)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}

      <section>
        <h3 className="sect">Tracker na żywo – prognozy zapisane przed meczem, rozliczone po nim</h3>
        {tr && tr.settled > 0 ? (
          <>
            <div className="tiles">
              <Tile label="Rozliczone prognozy" value={tr.settled} sub={`${tr.pending} czeka na wynik`} />
              <Tile label="Trafność modelu" value={r1(tr.all.model.accuracy)} sub={tr.all.market.n ? `kursy: ${r1(tr.all.market.accuracy)} (${tr.all.market.n} meczów)` : 'brak kursów do porównania'} color={tr.all.market.n && tr.all.model.accuracy >= tr.all.market.accuracy ? 'var(--good)' : undefined} />
              <Tile label="Log-loss model / kursy" value={`${tr.all.modelWithMarket.n ? tr.all.modelWithMarket.logloss.toFixed(3) : tr.all.model.logloss.toFixed(3)} / ${tr.all.market.n ? tr.all.market.logloss.toFixed(3) : '—'}`} sub="niżej = lepiej" />
              <Tile label="Gdy model ≠ kursy" value={tr.all.disagree.n ? `${r1(tr.all.disagree.modelAccuracy)} vs ${r1(tr.all.disagree.marketAccuracy)}` : '—'} sub={`${tr.all.disagree.n} meczów · model vs kursy`} color={tr.all.disagree.n >= 20 && tr.all.disagree.modelAccuracy > tr.all.disagree.marketAccuracy ? 'var(--good)' : undefined} />
              <Tile label="Ostatnie 30 dni" value={tr.last30.model.n ? r1(tr.last30.model.accuracy) : '—'} sub={`${tr.last30.model.n} meczów`} />
            </div>
            {tr.daily.length > 1 && (
              <div className="card" style={{ marginTop: 14 }}>
                <h3>Trafność dzień po dniu <span className="hint">model vs kursy</span></h3>
                <DailyChart rows={tr.daily} />
              </div>
            )}
          </>
        ) : (
          <div className="card note">Tracker zbiera prognozy od pierwszego uruchomienia pipeline’u. Pierwsze rozliczone mecze pojawią się po 1–2 dniach.</div>
        )}
        {remote?.recent && remote.recent.length > 0 && (
          <div className="card" style={{ marginTop: 14 }}>
            <h3>Ostatnio rozliczone <span className="hint">{remote.recent.length}</span></h3>
            <div className="results">
              {remote.recent.slice(0, 25).map((p) => (
                <div className="result" key={p.matchId} onClick={() => onOpenMatch(p.leagueId, p.matchId)} style={{ cursor: 'pointer' }}>
                  <div className={`res ${p.hit ? 'W' : 'L'}`}>{p.hit ? '✓' : '✗'}</div>
                  <div className="who"><div className="opp">{p.home} – {p.away} <span className="mono">{p.score}</span></div><div className="meta">{fmtDate(p.date)} · {p.leagueName} · typ {p.fav === 'home' ? p.home : p.fav === 'away' ? p.away : 'remis'} ({pct(p.probs[p.fav])}){p.market ? ` · kursy ${pct(Math.max(p.market.home, p.market.draw, p.market.away))}` : ''}</div></div>
                  <div className="sc">{pct(p.probs.home)} / {pct(p.probs.draw)} / {pct(p.probs.away)}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      <section>
        <h3 className="sect">Moje prognozy <span className="muted">– mecze, których analizę otworzyłeś przed meczem</span></h3>
        <div className="tiles">
          <Tile label="Rozliczone" value={mine.n} sub={`${mine.pending} w toku`} />
          <Tile label="Trafność" value={mine.n ? r1(mine.accuracy) : '—'} sub={mine.marketN ? `kursy: ${r1(mine.marketAccuracy)}` : 'otwieraj analizy przed meczem'} color={mine.n >= 10 && mine.accuracy >= 0.5 ? 'var(--good)' : undefined} />
          <Tile label="Brier" value={mine.n ? mine.brier.toFixed(3) : '—'} sub="niżej = lepiej" />
          <Tile label="Gdy model ≠ kursy" value={mine.disagree.n ? `${r1(mine.disagree.modelAccuracy)} vs ${r1(mine.disagree.marketAccuracy)}` : '—'} sub={`${mine.disagree.n} meczów`} />
        </div>
        {mine.items.length > 0 && (
          <div className="card" style={{ marginTop: 14 }}>
            <h3>Historia <span className="hint">{mine.items.length}</span> <button className="chip" style={{ marginLeft: 'auto' }} disabled={busy} onClick={clearMine}>wyczyść</button></h3>
            <div className="results">
              {mine.items.slice(0, 40).map((p) => (
                <div className="result" key={p.matchId} onClick={() => onOpenMatch(p.leagueId, p.matchId)} style={{ cursor: 'pointer' }}>
                  <div className={`res ${p.result ? (p.hit ? 'W' : 'L') : ''}`} style={!p.result ? { background: 'var(--surface-3)', color: 'var(--muted)' } : undefined}>{p.result ? (p.hit ? '✓' : '✗') : '…'}</div>
                  <div className="who"><div className="opp">{p.home} – {p.away} {p.score && <span className="mono">{p.score}</span>}</div><div className="meta">{fmtDate(p.date)} {fmtTime(p.date)} · {p.leagueName} · typ {p.fav === 'home' ? p.home : p.fav === 'away' ? p.away : 'remis'} ({pct(p.probs[p.fav])})</div></div>
                  <div className="sc">{p.why ? p.why.slice(0, 40) : ''}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {leagues.length > 0 && (
        <section>
          <h3 className="sect">Ranking Elo <span className="muted">– siła drużyn z 2 sezonów wyników, także w pucharach</span></h3>
          <div className="filters" style={{ padding: '0 0 10px', borderBottom: 0 }}>
            {leagues.slice(0, 24).map((l) => <button key={l.slug} className={`chip${activeLeague?.slug === l.slug ? ' active' : ''}`} onClick={() => setLeague(l.slug)}>{l.name}</button>)}
          </div>
          {activeLeague && (
            <div className="card">
              <h3>{activeLeague.name} <span className="hint">średnia ligi {activeLeague.mean ?? '—'} · {activeLeague.teams.length} drużyn</span></h3>
              <div style={{ overflowX: 'auto' }}>
                <table className="tbl">
                  <thead><tr><th>#</th><th>Drużyna</th><th className="num">Elo</th><th className="num">Mecze</th><th className="num">xG / mecz</th><th className="num">xGA / mecz</th></tr></thead>
                  <tbody>
                    {activeLeague.teams.map((t, i) => (
                      <tr key={t.id}><td className="num">{i + 1}</td><td>{t.name}</td><td className="num" style={{ fontWeight: 700 }}>{t.elo}</td><td className="num">{t.n}</td><td className="num">{t.xg ? t.xg.xgFor.toFixed(2) : '—'}</td><td className="num">{t.xg ? t.xg.xgAgainst.toFixed(2) : '—'}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {elo.data?.tennis && (
            <div className="card" style={{ marginTop: 14 }}>
              <h3>Elo tenis <span className="hint">ostatnie 13 miesięcy</span>
                <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                  <button className={`chip${tour === 'atp' ? ' active' : ''}`} onClick={() => setTour('atp')}>ATP</button>
                  <button className={`chip${tour === 'wta' ? ' active' : ''}`} onClick={() => setTour('wta')}>WTA</button>
                </span>
              </h3>
              <div style={{ overflowX: 'auto' }}>
                <table className="tbl">
                  <thead><tr><th>#</th><th>Zawodnik</th><th className="num">Elo</th><th className="num">Twarda</th><th className="num">Mączka</th><th className="num">Trawa</th><th className="num">Mecze</th></tr></thead>
                  <tbody>
                    {elo.data.tennis[tour].map((p, i) => (
                      <tr key={p.id}><td className="num">{i + 1}</td><td>{p.name}</td><td className="num" style={{ fontWeight: 700 }}>{p.all}</td><td className="num">{p.nHard >= 5 ? p.hard : '—'}</td><td className="num">{p.nClay >= 5 ? p.clay : '—'}</td><td className="num">{p.nGrass >= 5 ? p.grass : '—'}</td><td className="num">{p.n}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>
      )}

      {bt && (
        <section>
          <h3 className="sect">Jak to działa</h3>
          <div className="grid c3">
            <div className="card"><h3>Wagi dopasowane automatycznie</h3><div className="kv" style={{ gridTemplateColumns: '1fr' }}>
              {Object.entries(bt.params).map(([k, v]) => <div key={k}><span>{PARAM_LABEL[k] || k}</span><span className="mono">{typeof v === 'number' ? v.toFixed(2) : String(v)}</span></div>)}
            </div></div>
            <div className="card"><h3>xG ze strzałów</h3><p className="text-2" style={{ margin: 0, fontSize: 13 }}>Własny wskaźnik xG dopasowany na {bt.xg.n.toLocaleString('pl-PL')} zapisach: gol ≈ {bt.xg.coef.sot.toFixed(2)}·celne + {bt.xg.coef.other.toFixed(3)}·niecelne{bt.xg.coef.corners ? ` ${bt.xg.coef.corners >= 0 ? '+' : '−'} ${Math.abs(bt.xg.coef.corners).toFixed(3)}·rożne` : ''}. Korelacja z golami: {bt.xg.corr ?? '—'}. Dostępne dla {bt.xg.teams} drużyn w bieżącym sezonie.</p></div>
            <div className="card"><h3>Dane</h3><p className="text-2" style={{ margin: 0, fontSize: 13 }}>{bt.history.footballMatches.toLocaleString('pl-PL')} meczów piłkarskich (sezony {Object.keys(bt.history.seasons || {}).join(', ')}), {bt.history.tennisMatches.toLocaleString('pl-PL')} meczów tenisowych. Aktualizacja codziennie ok. 7:30 przez GitHub Actions – aplikacja pobiera nowe ratingi sama.</p></div>
          </div>
        </section>
      )}
    </div>
  );
}

const PARAM_LABEL: Record<string, string> = {
  homeAtt: 'Atut gospodarza (gole ×)', awayAtt: 'Gość (gole ×)', formWeight: 'Forma (5 meczów)', recencyWeight: 'Udział ostatnich meczów', shrinkK: 'Regularyzacja', rho: 'Dixon-Coles (remisy)',
  eloWeight: 'Elo', venueWeight: 'Bilans u siebie / wyjazd', restWeight: 'Świeżość', h2hWeight: 'Bezpośrednie mecze', xgWeight: 'xG', stakesWeight: 'Stawka meczu', absenceWeight: 'Absencje', newsWeight: 'Sygnały z sieci',
};

function Calibration({ rows }: { rows: { range: string; n: number; predicted: number; actual: number }[] }) {
  if (!rows.length) return <div className="note">Brak danych.</div>;
  const W = 520, H = 200, px = 40, py = 16;
  const bw = (W - 2 * px) / rows.length;
  const Y = (v: number) => py + (1 - v) * (H - 2 * py);
  return (
    <svg viewBox={`0 0 ${W} ${H + 24}`} width="100%" style={{ maxHeight: 260 }}>
      {[0.25, 0.5, 0.75, 1].map((v) => <g key={v}><line x1={px} x2={W - px} y1={Y(v)} y2={Y(v)} stroke="var(--grid)" /><text x={px - 6} y={Y(v) + 4} fontSize={10} fill="var(--muted)" textAnchor="end">{Math.round(v * 100)}%</text></g>)}
      {rows.map((r, i) => (
        <g key={r.range}>
          <motion.rect x={px + i * bw + 6} width={bw - 12} y={Y(r.actual)} height={Y(0) - Y(r.actual)} rx={4} fill="var(--home)" initial={{ opacity: 0 }} animate={{ opacity: 0.85 }} />
          <circle cx={px + i * bw + bw / 2} cy={Y(r.predicted)} r={4} fill="var(--third)" stroke="var(--bg)" strokeWidth={2} />
          <text x={px + i * bw + bw / 2} y={H + 8} fontSize={10} fill="var(--text-2)" textAnchor="middle">{r.range}</text>
          <text x={px + i * bw + bw / 2} y={H + 20} fontSize={9} fill="var(--muted)" textAnchor="middle">n={r.n}</text>
        </g>
      ))}
      <path d={rows.map((r, i) => `${i ? 'L' : 'M'} ${px + i * bw + bw / 2} ${Y(r.predicted)}`).join(' ')} fill="none" stroke="var(--third)" strokeWidth={2} strokeDasharray="4 3" />
    </svg>
  );
}

function DailyChart({ rows }: { rows: { date: string; n: number; hit: number; marketHit: number; withMarket: number }[] }) {
  const pts = useMemo(() => rows.slice(-40), [rows]);
  const W = 600, H = 170, px = 36, py = 14;
  const bw = (W - 2 * px) / Math.max(1, pts.length);
  const Y = (v: number) => py + (1 - v) * (H - 2 * py);
  return (
    <svg viewBox={`0 0 ${W} ${H + 20}`} width="100%" style={{ maxHeight: 230 }}>
      {[0.25, 0.5, 0.75, 1].map((v) => <g key={v}><line x1={px} x2={W - px} y1={Y(v)} y2={Y(v)} stroke="var(--grid)" /><text x={px - 6} y={Y(v) + 4} fontSize={10} fill="var(--muted)" textAnchor="end">{Math.round(v * 100)}%</text></g>)}
      {pts.map((r, i) => {
        const acc = r.n ? r.hit / r.n : 0;
        const macc = r.withMarket ? r.marketHit / r.withMarket : null;
        return (
          <g key={r.date}>
            <rect x={px + i * bw + 2} width={Math.max(2, bw - 4)} y={Y(acc)} height={Y(0) - Y(acc)} rx={3} fill="var(--home)" opacity={0.85}><title>{r.date}: {r.hit}/{r.n} trafionych</title></rect>
            {macc != null && <line x1={px + i * bw + 2} x2={px + i * bw + bw - 2} y1={Y(macc)} y2={Y(macc)} stroke="var(--away)" strokeWidth={2} />}
            {(i % Math.ceil(pts.length / 8) === 0) && <text x={px + i * bw + bw / 2} y={H + 12} fontSize={9} fill="var(--muted)" textAnchor="middle">{r.date.slice(5)}</text>}
          </g>
        );
      })}
      <text x={W - px} y={12} fontSize={10} fill="var(--text-2)" textAnchor="end">▬ model · <tspan fill="var(--away)">▬</tspan> kursy</text>
    </svg>
  );
}
