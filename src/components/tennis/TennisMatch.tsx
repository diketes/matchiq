import React, { Suspense, useEffect, useState } from 'react';
import { usePolling, pct, fmtDate, fmtTime } from '../../api';
import type { TennisDetail, TennisPlayer, TennisResult } from '../../types';
import { ProbBar, Gauge, Radar, Factors, Insights, Tile, PathBars } from '../charts';

const Court3D = React.lazy(() => import('../three/Court3D'));

type Tab = 'analiza' | 'gracze' | 'forma' | 'turniej';
const RADAR_AXES = [
  { key: 'ranking', label: 'Ranking' }, { key: 'forma', label: 'Forma' }, { key: 'skutecznosc', label: 'Skuteczność' },
  { key: 'doswiadczenie', label: 'Doświadczenie' }, { key: 'turniej', label: 'Ten turniej' }, { key: 'nawierzchnia', label: 'Nawierzchnia' },
];

const TABS: Tab[] = ['analiza', 'gracze', 'forma', 'turniej'];

export default function TennisMatch({ tour, id, onBack, initialTab }: { tour: string; id: string; onBack: () => void; initialTab?: string }) {
  const [intervalMs, setIntervalMs] = useState(30_000);
  const d = usePolling<TennisDetail>(`/api/tennis/match/${tour}/${id}`, intervalMs);
  const state = d.data?.summary.state;
  useEffect(() => { if (state) setIntervalMs(state === 'in' ? 20_000 : 180_000); }, [state]);
  const [tab, setTab] = useState<Tab>(TABS.includes(initialTab as Tab) ? (initialTab as Tab) : 'analiza');

  if (!d.data) {
    return (
      <div className="content-inner">
        {d.error ? <div className="errbox">Nie udało się pobrać meczu: {d.error} <button className="refresh" onClick={d.refresh} style={{ marginLeft: 10, textDecoration: 'underline' }}>spróbuj ponownie</button></div> : <div className="loading"><div className="spinner" /> Analizuję mecz… (ranking, forma, ostatnie wyniki obu graczy)</div>}
      </div>
    );
  }
  const data = d.data;
  const { summary: m, players, tournament: t, analysis: a } = data;
  const live = m.state === 'in';
  const H = players.home, A = players.away;

  return (
    <div className="content-inner">
      <div className="mhead">
        <div className="bg" />
        <div className="inner">
          <div className="meta">
            <button className="tag" onClick={onBack}>← Lista</button>
            <span className="tag">{m.league.region}</span>
            <span className="tag">{t.name}</span>
            <span className={`surface-chip ${t.surface}`}>{t.surfacePl}</span>
            {t.round && <span>{t.round}</span>}
            {t.group && <span className="muted">· {t.group}</span>}
            {live && <span className="tag live">● {m.statusText}</span>}
            <span>{fmtDate(m.date)} {fmtTime(m.date)}</span>
            {t.court && <span className="muted">· {t.court}</span>}
            <span className="muted">· do {a.state.setsToWin} wygranych setów</span>
          </div>
          <div className="row">
            <PlayerSide p={H} side="home" />
            <div className="center">
              {m.state === 'pre' ? <div className="score pre">{fmtTime(m.date)}</div> : (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 18 }}>
                  <div className="score" style={{ fontSize: 40 }}><span className="home-c">{H.score}</span> : <span className="away-c">{A.score}</span></div>
                  <SetsTable h={H} a={A} />
                </div>
              )}
              <div className={`status${live ? ' live' : ''}`}>{m.state === 'pre' ? 'Przed meczem' : live ? `${m.statusText}${a.state.inTiebreak ? ' · tie-break' : ''}` : m.statusText}</div>
            </div>
            <PlayerSide p={A} side="away" />
          </div>
          <div className="verdict">
            <div className="verdict-pill">
              <span className="sw" style={{ background: a.verdict.winner === 'home' ? 'var(--home)' : 'var(--away)' }} />
              {a.verdict.text}
              {a.verdict.sub && <small>· {a.verdict.sub}</small>}
            </div>
            <span className="note">Pewność modelu {pct(a.confidence)}</span>
          </div>
        </div>
      </div>

      <div className="tabs">
        {([['analiza', 'Analiza'], ['gracze', 'Gracze'], ['forma', 'Forma i H2H'], ['turniej', 'Droga w turnieju']] as [Tab, string][]).map(([k, label]) => <button key={k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>{label}</button>)}
        <span style={{ marginLeft: 'auto' }} className="updated">{live ? 'live · odświeżanie co 20 s' : 'odświeżanie co 3 min'} · {d.updatedAt ? new Date(d.updatedAt).toLocaleTimeString('pl-PL') : ''} <button className="refresh" onClick={d.refresh}>odśwież</button></span>
      </div>

      {tab === 'analiza' && (
        <div className="stack">
          <div className="grid c21">
            <div className="card">
              <h3>Kto wygra? <span className="hint">{live ? 'szanse przy obecnym stanie setów i gemów' : m.state === 'post' ? 'wynik końcowy' : 'model przedmeczowy'}</span></h3>
              <ProbBar big home={a.probs.home} away={a.probs.away} homeName={H.short} awayName={A.short} />
              <div className="tiles" style={{ marginTop: 16 }}>
                <Tile label="Przed meczem" value={<span><span className="home-c">{pct(a.pre.home)}</span> · <span className="away-c">{pct(a.pre.away)}</span></span>} sub="ranking + forma + nawierzchnia + H2H" />
                {a.live && a.live.setWinNow != null && <Tile label="Bieżący set" value={<span><span className="home-c">{pct(a.live.setWinNow)}</span> · <span className="away-c">{pct(1 - a.live.setWinNow)}</span></span>} sub={`gemy ${a.state.gamesHome}:${a.state.gamesAway}`} />}
                <Tile label="Punkt na serwisie" value={<span><span className="home-c">{pct(a.pointWin.home)}</span> · <span className="away-c">{pct(a.pointWin.away)}</span></span>} sub="parametr modelu Markowa" />
                <Tile label="Format" value={`BO${a.state.bestOf}`} sub={`do ${a.state.setsToWin} setów`} />
              </div>
              <div style={{ marginTop: 16 }}>
                <h3>Składowe prognozy przedmeczowej</h3>
                <div className="tiles">
                  <Tile label="Ranking" value={pct(a.components.rank)} sub={`#${H.rank ?? '—'} vs #${A.rank ?? '—'}`} />
                  <Tile label="Forma" value={`${a.components.form >= 0 ? '+' : ''}${(a.components.form * 100).toFixed(1)} pp`} sub={`${a.form.home.wins}/${a.form.home.n} vs ${a.form.away.wins}/${a.form.away.n}`} color={a.components.form > 0.02 ? 'var(--home)' : a.components.form < -0.02 ? 'var(--away)' : undefined} />
                  <Tile label="Nawierzchnia" value={`${a.components.surface >= 0 ? '+' : ''}${(a.components.surface * 100).toFixed(1)} pp`} sub={`${a.surface.home.won}-${a.surface.home.lost} vs ${a.surface.away.won}-${a.surface.away.lost}`} />
                  <Tile label="H2H" value={`${a.components.h2h >= 0 ? '+' : ''}${(a.components.h2h * 100).toFixed(1)} pp`} sub={`${a.h2h.homeWins}-${a.h2h.awayWins}`} />
                </div>
                <div className="note" style={{ marginTop: 6 }}>pp = punkty procentowe korekty dla {H.short} względem szans z rankingu.</div>
              </div>
            </div>
            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
              <Suspense fallback={<div className="loading"><div className="spinner" /> Ładuję kort 3D…</div>}>
                <Court3D surface={t.surface} live={live} />
              </Suspense>
              <div style={{ padding: '12px 16px' }}>
                <Gauge value={a.confidence} />
                <div className="note" style={{ textAlign: 'center', marginTop: 22 }}>{a.confidence >= 0.7 ? 'Wyraźny faworyt i pełne dane.' : a.confidence >= 0.45 ? 'Umiarkowana pewność.' : 'Wyrównany mecz lub brak danych.'}</div>
              </div>
            </div>
          </div>

          <div className="grid c2">
            <div className="card">
              <h3>Ścieżki do zwycięstwa <span className="hint">rozkład wyniku w setach</span></h3>
              <PathBars paths={a.paths} homeName={H.short} awayName={A.short} />
            </div>
            <div className="card">
              <h3>Kluczowe czynniki</h3>
              <Factors factors={a.factors} />
            </div>
          </div>

          <div className="grid c2">
            <div className="card">
              <h3>Profil graczy <span className="hint">0–100</span></h3>
              <Radar axes={RADAR_AXES} home={a.ratings.home as any} away={a.ratings.away as any} homeName={H.short} awayName={A.short} />
            </div>
            <div className="card">
              <h3>Wnioski meczowe</h3>
              <Insights items={a.insights.match} />
            </div>
          </div>

          <div className="grid c2">
            <div className="card"><h3><span style={{ width: 10, height: 10, borderRadius: 3, background: 'var(--home)', display: 'inline-block' }} /> {H.name}: mocne i słabe strony</h3><Insights items={a.insights.home} /></div>
            <div className="card"><h3><span style={{ width: 10, height: 10, borderRadius: 3, background: 'var(--away)', display: 'inline-block' }} /> {A.name}: mocne i słabe strony</h3><Insights items={a.insights.away} /></div>
          </div>
        </div>
      )}

      {tab === 'gracze' && (
        <div className="grid c2">
          <PlayerCard p={H} side="home" />
          <PlayerCard p={A} side="away" />
        </div>
      )}

      {tab === 'forma' && (
        <div className="stack">
          <div className="grid c2">
            <ResultsCard title={`${H.name} · ostatnie mecze`} results={H.recent} surface={t.surface} />
            <ResultsCard title={`${A.name} · ostatnie mecze`} results={A.recent} surface={t.surface} />
          </div>
          <div className="card">
            <h3>Bezpośrednie mecze <span className="hint">{a.h2h.homeWins}-{a.h2h.awayWins} (w pobranych wynikach)</span></h3>
            {a.h2h.games.length === 0 ? <div className="note">Brak bezpośrednich meczów w ostatnich wynikach obu graczy.</div> : (
              <div className="results">{a.h2h.games.map((g) => (
                <div className="result" key={g.id}>
                  <div className={`res ${g.winner === 'home' ? 'W' : 'L'}`} style={{ background: g.winner === 'home' ? 'var(--home)' : 'var(--away)' }}>{g.winner === 'home' ? '1' : '2'}</div>
                  <div className="who"><div className="opp">Wygrywa {g.winner === 'home' ? H.short : A.short}</div><div className="meta">{fmtDate(g.date)} · {g.tournament}{g.round ? ` · ${g.round}` : ''}</div></div>
                  <div className="sc">{g.score}</div>
                </div>
              ))}</div>
            )}
          </div>
        </div>
      )}

      {tab === 'turniej' && (
        <div className="grid c2">
          <ResultsCard title={`${H.name} · ${t.name}`} results={H.tournamentRun} surface={t.surface} emptyText="Pierwszy mecz w tym turnieju." />
          <ResultsCard title={`${A.name} · ${t.name}`} results={A.tournamentRun} surface={t.surface} emptyText="Pierwszy mecz w tym turnieju." />
        </div>
      )}
    </div>
  );
}

function PlayerSide({ p, side }: { p: TennisPlayer; side: 'home' | 'away' }) {
  return (
    <div className={`side ${side}`}>
      {p.flag ? <img className="flag" src={p.flag} alt={p.country || ''} /> : <div className="flag" style={{ background: 'var(--surface-3)' }} />}
      <div>
        <div className="name" style={{ color: side === 'home' ? 'var(--home)' : 'var(--away)' }}>{p.name}</div>
        <div className="sub">
          {p.rank && <span>ranking <b>#{p.rank}</b>{p.rankPrev && p.rankPrev !== p.rank ? <span className="muted"> ({p.rankPrev > p.rank ? '↑' : '↓'} z {p.rankPrev})</span> : null}</span>}
          {p.seed && <span>rozst. <b>{p.seed}</b></span>}
          {p.country && <span>{p.country}</span>}
          {p.hand && <span>{p.hand.toLowerCase()}</span>}
          {p.age && <span>{p.age} l.</span>}
        </div>
      </div>
    </div>
  );
}

function SetsTable({ h, a }: { h: TennisPlayer; a: TennisPlayer }) {
  const n = Math.max(h.sets?.length || 0, a.sets?.length || 0);
  if (!n) return null;
  return (
    <div className="sets-table">
      {Array.from({ length: n }).map((_, i) => {
        const hs = h.sets?.[i], as = a.sets?.[i];
        const cur = hs?.won == null && as?.won == null;
        return (
          <div className={`set${cur ? ' cur' : ''}`} key={i}>
            <span className={hs?.won ? 'w' : hs?.won === false ? 'l' : ''}>{hs?.games ?? ''}{hs?.tiebreak != null && <sup>{hs.tiebreak}</sup>}</span>
            <span className={as?.won ? 'w' : as?.won === false ? 'l' : ''}>{as?.games ?? ''}{as?.tiebreak != null && <sup>{as.tiebreak}</sup>}</span>
          </div>
        );
      })}
    </div>
  );
}

function PlayerCard({ p, side }: { p: TennisPlayer; side: 'home' | 'away' }) {
  const tot = p.career.won + p.career.lost;
  return (
    <div className="card pcard">
      <div className="hdr">
        {p.flag && <img src={p.flag} alt="" />}
        <div><div className="nm" style={{ color: side === 'home' ? 'var(--home)' : 'var(--away)' }}>{p.name}</div><div className="sub">{p.country}{p.birthPlace ? ` · ${p.birthPlace}` : ''}</div></div>
      </div>
      <div className="tiles">
        <Tile label="Ranking" value={p.rank ? `#${p.rank}` : '—'} sub={p.rankPoints ? `${p.rankPoints.toLocaleString('pl-PL')} pkt` : 'brak w rankingu'} />
        <Tile label="Bilans kariery" value={tot ? `${p.career.won}-${p.career.lost}` : '—'} sub={tot ? `${pct(p.career.won / tot)} wygranych` : ''} />
        <Tile label="Tytuły" value={p.career.titles} sub="singiel" />
      </div>
      <div className="kv">
        <div><span>Poprzedni ranking</span><span>{p.rankPrev ? `#${p.rankPrev}` : '—'}</span></div>
        <div><span>Rozstawienie</span><span>{p.seed ?? '—'}</span></div>
        <div><span>Wiek</span><span>{p.age ?? '—'}</span></div>
        <div><span>Ręka</span><span>{p.hand ?? '—'}</span></div>
        <div><span>Wzrost</span><span>{p.heightCm ? `${p.heightCm} cm` : '—'}</span></div>
        <div><span>Waga</span><span>{p.weightKg ? `${p.weightKg} kg` : '—'}</span></div>
        <div><span>Debiut</span><span>{p.debutYear ?? '—'}</span></div>
        <div><span>Nagrody</span><span>{p.career.prize ? `$${Math.round(p.career.prize / 1000).toLocaleString('pl-PL')} tys.` : '—'}</span></div>
      </div>
    </div>
  );
}

function ResultsCard({ title, results, surface, emptyText = 'Brak wyników.' }: { title: string; results: TennisResult[]; surface: string; emptyText?: string }) {
  return (
    <div className="card">
      <h3>{title}</h3>
      {!results?.length ? <div className="note">{emptyText}</div> : (
        <div className="results">
          {results.map((r) => (
            <div className="result" key={r.id}>
              <div className={`res ${r.won ? 'W' : 'L'}`}>{r.won ? 'W' : 'P'}</div>
              <div className="who">
                <div className="opp">vs {r.opponent.name}{r.opponent.rank ? <span className="muted"> #{r.opponent.rank}</span> : null}</div>
                <div className="meta">{fmtDate(r.date)} · {r.tournament || ''}{r.round ? ` · ${r.round}` : ''}{r.surface && r.surface === surface ? ' · ta nawierzchnia' : ''}{r.retired ? ' · krecz' : ''}</div>
              </div>
              <div className="sc">{r.score}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
