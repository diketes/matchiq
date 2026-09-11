import React, { Suspense, useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { usePolling, pct, f1, f2, fmtDate, fmtTime, plural } from '../../api';
import type { FootballDetail, FormGame, LineupPlayer, MatchEvent, NewsHeadline, TableRow, TeamDetail } from '../../types';
import { ProbBar, Gauge, Radar, Factors, Insights, StatCompare, ScoreHeat, Tile } from '../charts';

const Pitch3D = React.lazy(() => import('../three/Pitch3D'));
const ParticlesFX = React.lazy(() => import('../three/HeroScene').then((m) => ({ default: m.ParticlesFX })));

type Tab = 'analiza' | 'statystyki' | 'sklady' | 'forma' | 'tabela' | 'przebieg';
const RADAR_AXES = [
  { key: 'atak', label: 'Atak' }, { key: 'obrona', label: 'Obrona' }, { key: 'forma', label: 'Forma' },
  { key: 'boisko', label: 'Dom / wyjazd' }, { key: 'bilans', label: 'Bilans' }, { key: 'stabilnosc', label: 'Stabilność' },
];

const TABS: Tab[] = ['analiza', 'statystyki', 'sklady', 'forma', 'tabela', 'przebieg'];

export default function FootballMatch({ leagueId, id, onBack, initialTab }: { leagueId: string; id: string; onBack: () => void; initialTab?: string }) {
  const [intervalMs, setIntervalMs] = useState(30_000);
  const d = usePolling<FootballDetail>(`/api/football/match/${encodeURIComponent(leagueId)}/${id}`, intervalMs);
  const state = d.data?.summary.state;
  useEffect(() => { if (state) setIntervalMs(state === 'in' ? 20_000 : 180_000); }, [state]);
  const [tab, setTab] = useState<Tab>(TABS.includes(initialTab as Tab) ? (initialTab as Tab) : 'analiza');
  const [highlight, setHighlight] = useState<string | null>(null);

  if (!d.data) {
    return (
      <div className="content-inner">
        {d.error ? <div className="errbox">Nie udało się pobrać meczu: {d.error} <button className="refresh" onClick={d.refresh} style={{ marginLeft: 10, textDecoration: 'underline' }}>spróbuj ponownie</button></div> : <div className="loading"><div className="spinner" /> Analizuję mecz… (forma, tabela, składy, H2H)</div>}
      </div>
    );
  }

  const data = d.data;
  const { summary: m, teams, analysis: a } = data;
  const live = m.state === 'in';
  const hc = teams.home.color || '#3987e5';
  const ac = teams.away.color || '#d95926';
  const tabs: { k: Tab; label: string; n?: number }[] = [
    { k: 'analiza', label: 'Analiza' },
    { k: 'statystyki', label: 'Statystyki', n: data.stats.length || undefined },
    { k: 'sklady', label: 'Składy 3D', n: (data.lineups.home?.starters.length || 0) + (data.lineups.away?.starters.length || 0) || undefined },
    { k: 'forma', label: 'Forma i H2H' },
    { k: 'tabela', label: 'Tabela', n: data.standings.length || undefined },
    { k: 'przebieg', label: 'Przebieg', n: data.events.length || undefined },
  ];

  return (
    <div className="content-inner">
      <div className="mhead">
        <div className="bg" />
        <div className="canvas3d"><Suspense fallback={null}><ParticlesFX colorA={hc} colorB={ac} /></Suspense></div>
        <div className="inner">
          <div className="meta">
            <button className="tag" onClick={onBack}>← Lista</button>
            <span className="tag">{m.league.name}</span>
            <span className="muted">{m.league.region}</span>
            {live && <span className="tag live">● {m.statusText}{m.period ? ` · ${m.period === 1 ? '1. połowa' : m.period === 2 ? '2. połowa' : 'dogrywka'}` : ''}</span>}
            <span>{fmtDate(m.date)} {fmtTime(m.date)}</span>
            {data.venue && <span className="muted">· {data.venue}{data.city ? `, ${data.city}` : ''}</span>}
            {data.referee && <span className="muted">· sędzia: {data.referee}</span>}
          </div>
          <div className="row">
            <TeamSide t={teams.home} side="home" />
            <div className="center">
              <div className={`score${m.state === 'pre' ? ' pre' : ''}`}>{m.state === 'pre' ? fmtTime(m.date) : `${m.home.score ?? 0} : ${m.away.score ?? 0}`}</div>
              <div className={`status${live ? ' live' : ''}`}>{m.state === 'pre' ? 'Przed meczem' : live ? `${m.statusText}` : m.statusText}</div>
            </div>
            <TeamSide t={teams.away} side="away" />
          </div>
          <div className="verdict">
            <div className="verdict-pill">
              <span className="sw" style={{ background: a.verdict.winner === 'home' ? 'var(--home)' : a.verdict.winner === 'away' ? 'var(--away)' : 'var(--draw)' }} />
              {a.verdict.text}
              {a.verdict.sub && <small>· {a.verdict.sub}</small>}
            </div>
            {a.verdict.why && m.state !== 'post' && <span className="note">Za: {a.verdict.why}</span>}
            <span className="note">Pewność analizy {pct(a.confidence)}</span>
            {a.verdict.market && m.state === 'pre' && (
              <span className={`mkt-pill${a.verdict.market.agrees ? '' : ' differs'}`} title="Kursy nie wpływają na prognozę – tylko porównanie">
                Kursy: {a.verdict.market.winner === 'home' ? teams.home.short : a.verdict.market.winner === 'away' ? teams.away.short : 'remis'} {pct(a.verdict.market.p)} {a.verdict.market.agrees ? '✓ zgodnie' : '≠ analiza'}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="tabs">
        {tabs.map((t) => <button key={t.k} className={tab === t.k ? 'active' : ''} onClick={() => setTab(t.k)}>{t.label}{t.n ? <span className="n">{t.n}</span> : null}</button>)}
        <span style={{ marginLeft: 'auto' }} className="updated">{live ? 'live · odświeżanie co 20 s' : 'odświeżanie co 3 min'} · {d.updatedAt ? new Date(d.updatedAt).toLocaleTimeString('pl-PL') : ''} <button className="refresh" onClick={d.refresh}>odśwież</button></span>
      </div>

      {tab === 'analiza' && <AnalysisTab data={data} />}
      {tab === 'statystyki' && <StatsTab data={data} />}
      {tab === 'sklady' && (
        <div className="stack">
          <Suspense fallback={<div className="pitchwrap loading"><div className="spinner" /> Ładuję boisko 3D…</div>}>
            <Pitch3D home={data.lineups.home} away={data.lineups.away} homeColor={hc} awayColor={ac} homeName={teams.home.name} awayName={teams.away.name} highlightId={highlight} />
          </Suspense>
          {!data.lineups.home && !data.lineups.away && <div className="card note">Składy pojawią się zwykle ok. godziny przed meczem.</div>}
          <div className="grid c2">
            <LineupCard t={teams.home} lineup={data.lineups.home} color={hc} onHover={setHighlight} state={m.state} />
            <LineupCard t={teams.away} lineup={data.lineups.away} color={ac} onHover={setHighlight} state={m.state} />
          </div>
          {(a.keyPlayers.home.length > 0 || a.keyPlayers.away.length > 0) && m.state !== 'pre' && (
            <div className="grid c2">
              <KeyPlayers t={teams.home} players={a.keyPlayers.home} color={hc} />
              <KeyPlayers t={teams.away} players={a.keyPlayers.away} color={ac} />
            </div>
          )}
        </div>
      )}
      {tab === 'forma' && <FormTab data={data} />}
      {tab === 'tabela' && <TableTab rows={data.standings} homeId={teams.home.id} awayId={teams.away.id} note={data.standingsNote} />}
      {tab === 'przebieg' && <TimelineTab events={data.events} home={teams.home} away={teams.away} />}
    </div>
  );
}

function TeamSide({ t, side }: { t: TeamDetail; side: 'home' | 'away' }) {
  const form = (t.lastFive || []).slice(0, 5).map((g) => g.result);
  return (
    <div className={`side ${side}`}>
      {t.logo ? <img src={t.logo} alt="" /> : <div style={{ width: 64, height: 64, borderRadius: 16, background: t.color || 'var(--surface-3)' }} />}
      <div>
        <div className="name" style={{ color: side === 'home' ? 'var(--home)' : 'var(--away)' }}>{t.name}</div>
        <div className="sub">
          {t.table && <span><b>{t.table.rank}.</b> w tabeli · {t.table.pts} pkt</span>}
          {t.record?.overall && t.record.overall.gp > 0 && <span>bilans <b>{t.record.overall.w}-{t.record.overall.d}-{t.record.overall.l}</b></span>}
          {form.length > 0 && <span style={{ display: 'inline-flex', gap: 3 }}>{form.map((r, i) => <i key={i} style={{ width: 14, height: 14, borderRadius: 4, display: 'inline-grid', placeItems: 'center', fontSize: 9, fontWeight: 800, fontStyle: 'normal', color: '#fff', background: r === 'W' ? 'var(--good)' : r === 'D' ? '#6b7280' : 'var(--critical)' }}>{r === 'W' ? 'Z' : r === 'D' ? 'R' : 'P'}</i>)}</span>}
          {t.formation && <span>ustawienie <b>{t.formation}</b></span>}
        </div>
      </div>
    </div>
  );
}

function AnalysisTab({ data }: { data: FootballDetail }) {
  const { summary: m, teams, analysis: a } = data;
  const live = m.state === 'in';
  const top = a.topScores[0];
  return (
    <div className="stack">
      <div className="grid c21">
        <div className="card">
          <h3>Kto wygra? <span className="hint">{live ? 'szanse na wynik końcowy przy obecnym stanie' : m.state === 'post' ? 'wynik końcowy' : 'wyłącznie z analizy – bez kursów'}</span></h3>
          <ProbBar big home={a.probs.home} draw={a.probs.draw} away={a.probs.away} homeName={teams.home.short} awayName={teams.away.short} />
          <div className="tiles" style={{ marginTop: 16 }}>
            <Tile label="xG modelu" value={<span><span className="home-c">{f2(a.xg.home)}</span> – <span className="away-c">{f2(a.xg.away)}</span></span>} sub={live && a.live ? `do końca: ${f2(a.live.xgRemaining.home)} – ${f2(a.live.xgRemaining.away)}` : `średnia ligi ${f2(a.leagueAvgGoals)} / drużynę`} />
            <Tile label="Powyżej 2,5 gola" value={pct(a.over25)} sub={a.over25 >= 0.5 ? 'mecz na gole' : 'raczej mało goli'} color={a.over25 >= 0.55 ? 'var(--good)' : undefined} />
            <Tile label="Obie strzelą" value={pct(a.btts)} sub="BTTS" />
            {top && <Tile label="Typowany wynik" value={top.score} sub={`${pct(top.p)} szans`} />}
            {live && a.live && <Tile label="Do końca" value={`~${a.live.remainingMinutes}'`} sub={`minuta ${a.live.minute}`} color="var(--live)" />}
          </div>
          <div style={{ marginTop: 16 }} className="stack">
            <MiniProb label="Analiza przedmeczowa (forma, tabela, dom/wyjazd, H2H, świeżość, stawka, sieć)" p={a.model} h={teams.home.short} aw={teams.away.short} />
            {a.market && <MiniProb label="Kursy bukmacherskie – tylko porównanie, nie wchodzą do prognozy" p={a.market} h={teams.home.short} aw={teams.away.short} />}
            {a.live && <MiniProb label="Analiza live (obecny stan)" p={a.live} h={teams.home.short} aw={teams.away.short} />}
          </div>
        </div>
        <div className="card">
          <h3>Pewność i momentum</h3>
          <Gauge value={a.confidence} />
          <div className="note" style={{ textAlign: 'center', marginTop: 22 }}>
            {a.confidence >= 0.7 ? 'Wyraźny faworyt i pełne dane – prognoza stabilna.' : a.confidence >= 0.45 ? 'Umiarkowana pewność – mecz może pójść w kilka stron.' : 'Niska pewność – wyrównany mecz lub brakuje danych.'}
          </div>
          {a.momentum && (
            <div style={{ marginTop: 18 }}>
              <div className="note" style={{ marginBottom: 6 }}>Momentum live (strzały celne, strzały, posiadanie)</div>
              <div className="momentum">
                <div className="bar"><i style={{ width: `${a.momentum.home * 100}%`, background: 'var(--home)' }} /><i style={{ width: `${a.momentum.away * 100}%`, background: 'var(--away)' }} /></div>
                <div className="problabels"><b className="home-c">{pct(a.momentum.home)}</b><b className="away-c">{pct(a.momentum.away)}</b></div>
              </div>
            </div>
          )}
          <div style={{ marginTop: 18 }} className="tiles">
            <Tile label="Siła ataku" value={<span><span className="home-c">{f2(a.strengths.home.attack)}</span> · <span className="away-c">{f2(a.strengths.away.attack)}</span></span>} sub="1,00 = średnia ligi" />
            <Tile label="Szczelność obrony" value={<span><span className="home-c">{f2(2 - a.strengths.home.defense)}</span> · <span className="away-c">{f2(2 - a.strengths.away.defense)}</span></span>} sub="wyżej = lepiej" />
            {a.context && (a.context.home.restDays != null || a.context.away.restDays != null) && (
              <Tile label="Dni przerwy" value={<span><span className="home-c">{a.context.home.restDays ?? '–'}</span> · <span className="away-c">{a.context.away.restDays ?? '–'}</span></span>} sub={`${a.context.home.matches14} · ${a.context.away.matches14} meczów w 14 dni`} />
            )}
          </div>
        </div>
      </div>

      <div className="grid c2">
        <div className="card">
          <h3>Kluczowe czynniki <span className="hint">co przechyla szalę</span></h3>
          <Factors factors={a.factors} />
        </div>
        <div className="card">
          <h3>Profil drużyn <span className="hint">0–100, im dalej od środka tym lepiej</span></h3>
          <Radar axes={RADAR_AXES} home={a.ratings.home as any} away={a.ratings.away as any} homeName={teams.home.short} awayName={teams.away.short} />
        </div>
      </div>

      <div className="grid c2">
        <div className="card">
          <h3><span className="sw" style={{ width: 10, height: 10, borderRadius: 3, background: 'var(--home)', display: 'inline-block' }} /> {teams.home.name}: mocne i słabe strony</h3>
          <Insights items={a.insights.home} />
        </div>
        <div className="card">
          <h3><span className="sw" style={{ width: 10, height: 10, borderRadius: 3, background: 'var(--away)', display: 'inline-block' }} /> {teams.away.name}: mocne i słabe strony</h3>
          <Insights items={a.insights.away} />
        </div>
      </div>

      {data.news && (data.news.home.length > 0 || data.news.away.length > 0) && (
        <div className="grid c2">
          <NewsCard name={teams.home.name} items={data.news.home} signal={data.news.signal.home} color="var(--home)" />
          <NewsCard name={teams.away.name} items={data.news.away} signal={data.news.signal.away} color="var(--away)" />
        </div>
      )}

      <div className="grid c21">
        <div className="card">
          <h3>Wnioski meczowe</h3>
          <Insights items={a.insights.match} />
        </div>
        <div className="card">
          <h3>Najbardziej prawdopodobne wyniki</h3>
          {a.scoreMatrix ? <ScoreHeat matrix={a.scoreMatrix} homeName={teams.home.short} awayName={teams.away.short} /> : (
            <div className="paths">
              {a.topScores.map((s) => (
                <div className="path" key={s.score}>
                  <div className="lbl">{s.score}</div>
                  <div className="bar"><motion.i initial={{ width: 0 }} animate={{ width: `${s.p * 100}%` }} style={{ background: 'var(--third)' }} /></div>
                  <div className="v">{pct(s.p)}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function NewsCard({ name, items, signal, color }: { name: string; items: NewsHeadline[]; signal: { neg: number; pos: number }; color: string }) {
  return (
    <div className="card">
      <h3><span style={{ width: 10, height: 10, borderRadius: 3, background: color, display: 'inline-block' }} /> Z sieci: {name} <span className="hint">{signal.neg ? `${signal.neg} negat.` : ''}{signal.neg && signal.pos ? ' · ' : ''}{signal.pos ? `${signal.pos} pozyt.` : ''}{!signal.neg && !signal.pos ? 'bez alarmów' : ''}</span></h3>
      {!items.length ? <div className="note">Brak świeżych nagłówków.</div> : (
        <ul className="insights">
          {items.slice(0, 6).map((h, i) => (
            <li key={i} className={h.tone === 'neg' ? 'warning' : h.tone === 'pos' ? 'strength' : 'info'}>
              <span className="ic">{h.tone === 'neg' ? '!' : h.tone === 'pos' ? '+' : '·'}</span>
              <span><a href={h.link} target="_blank" rel="noreferrer" style={{ color: 'inherit', textDecoration: 'none' }}>{h.title}</a><br /><small className="muted">{h.source}{h.date ? ` · ${new Date(h.date).toLocaleDateString('pl-PL')}` : ''}</small></span>
            </li>
          ))}
        </ul>
      )}
      <div className="note" style={{ marginTop: 8 }}>Nagłówki z ostatnich 4 dni (Google News). Kontuzje, zawieszenia i kryzysy obniżają prognozę drużyny o kilka procent, powroty lekko ją podnoszą.</div>
    </div>
  );
}

function MiniProb({ label, p, h, aw }: { label: string; p: { home: number; draw: number; away: number }; h: string; aw: string }) {
  return (
    <div>
      <div className="note" style={{ marginBottom: 4, display: 'flex', justifyContent: 'space-between' }}><span>{label}</span><span className="mono">{pct(p.home)} / {pct(p.draw)} / {pct(p.away)}</span></div>
      <div className="probbar" style={{ height: 10 }} title={`${h} ${pct(p.home)} · remis ${pct(p.draw)} · ${aw} ${pct(p.away)}`}>
        <div className="seg home" style={{ flex: p.home }} />
        <div className="seg draw" style={{ flex: p.draw }} />
        <div className="seg away" style={{ flex: p.away }} />
      </div>
    </div>
  );
}

function StatsTab({ data }: { data: FootballDetail }) {
  const { teams, stats, summary: m } = data;
  const meaningful = stats.filter((r) => r.home + r.away > 0);
  const onlyCards = meaningful.length > 0 && meaningful.every((r) => r.key === 'yellowCards' || r.key === 'redCards');
  return (
    <div className="grid c21">
      <div className="card">
        <h3>Statystyki meczu <span className="hint">{m.state === 'pre' ? 'przed meczem' : m.statusText}</span></h3>
        <div className="legend" style={{ marginBottom: 12 }}><span><i className="sw" style={{ background: 'var(--home)' }} />{teams.home.name}</span><span><i className="sw" style={{ background: 'var(--away)' }} />{teams.away.name}</span></div>
        {m.state !== 'pre' && (meaningful.length === 0 || onlyCards) && (
          <div className="note" style={{ marginBottom: 12 }}>Źródło nie podaje (jeszcze) szczegółowych statystyk dla tego meczu – dla mniejszych lig pojawiają się z opóźnieniem lub wcale. Analiza opiera się wtedy na wyniku, formie i tabeli.</div>
        )}
        <StatCompare rows={m.state === 'pre' ? [] : meaningful.length ? stats : []} />
      </div>
      <div className="stack">
        <div className="card">
          <h3>Bilans sezonu</h3>
          <RecordTiles t={teams.home} side="home" />
          <div style={{ height: 10 }} />
          <RecordTiles t={teams.away} side="away" />
        </div>
        {(teams.home.squad || teams.away.squad) && (
          <div className="card">
            <h3>Kadra</h3>
            <div className="tiles">
              {teams.home.squad && <Tile label={teams.home.short} value={teams.home.squad.size} sub={teams.home.squad.avgAge ? `śr. wiek ${f1(teams.home.squad.avgAge)} lat` : ''} color="var(--home)" />}
              {teams.away.squad && <Tile label={teams.away.short} value={teams.away.squad.size} sub={teams.away.squad.avgAge ? `śr. wiek ${f1(teams.away.squad.avgAge)} lat` : ''} color="var(--away)" />}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function RecordTiles({ t, side }: { t: TeamDetail; side: 'home' | 'away' }) {
  const r = t.record;
  if (!r) return <div className="note">{t.name}: brak bilansu sezonu.</div>;
  const f = (s: { w: number; d: number; l: number; gf: number; ga: number }) => `${s.w}-${s.d}-${s.l} (${s.gf}:${s.ga})`;
  return (
    <div>
      <div className="note" style={{ marginBottom: 6, color: side === 'home' ? 'var(--home)' : 'var(--away)', fontWeight: 700 }}>{t.name}</div>
      <div className="tiles">
        <Tile small label="Ogółem" value={f(r.overall)} sub={plural(r.overall.gp, ['mecz', 'mecze', 'meczów'])} />
        <Tile small label="U siebie" value={f(r.home)} sub={plural(r.home.gp, ['mecz', 'mecze', 'meczów'])} />
        <Tile small label="Na wyjeździe" value={f(r.away)} sub={plural(r.away.gp, ['mecz', 'mecze', 'meczów'])} />
      </div>
    </div>
  );
}

function LineupCard({ t, lineup, color, onHover, state }: { t: TeamDetail; lineup: FootballDetail['lineups']['home']; color: string; onHover: (id: string | null) => void; state: string }) {
  if (!lineup) return <div className="card"><h3>{t.name}</h3><div className="note">Brak składu.</div></div>;
  const Row = ({ p }: { p: LineupPlayer }) => (
    <div className={`p${p.subbedOut ? ' out' : ''}${p.subbedIn ? ' in' : ''}`} onMouseEnter={() => onHover(p.id)} onMouseLeave={() => onHover(null)}>
      <span className="no">{p.jersey}</span>
      <span>{p.name}<span className="pos">{p.positionPl}</span>{p.subbedOut && <span className="pos">↓ zszedł</span>}{p.subbedIn && <span className="pos">↑ wszedł</span>}</span>
      <span className="st">
        {p.stats.goals > 0 && <span className="g">⚽ {p.stats.goals}</span>}
        {p.stats.assists > 0 && <span>A {p.stats.assists}</span>}
        {p.stats.shotsOnTarget > 0 && <span>{p.stats.shotsOnTarget} cel.</span>}
        {p.stats.saves > 0 && <span>{p.stats.saves} obr.</span>}
        {p.stats.yellow > 0 && <span className="y">■</span>}
        {p.stats.red > 0 && <span className="r">■</span>}
      </span>
    </div>
  );
  return (
    <div className="card">
      <h3><span style={{ width: 10, height: 10, borderRadius: 3, background: color, display: 'inline-block' }} /> {t.name} <span className="hint">{lineup.formation ? `ustawienie ${lineup.formation}` : ''}</span></h3>
      <div className="plist">{lineup.starters.map((p) => <Row key={p.id} p={p} />)}</div>
      {lineup.subs.length > 0 && (
        <>
          <div className="note" style={{ margin: '12px 0 6px', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700 }}>Ławka rezerwowych</div>
          <div className="plist">{lineup.subs.map((p) => <Row key={p.id} p={p} />)}</div>
        </>
      )}
      {state === 'pre' && <div className="note" style={{ marginTop: 8 }}>Statystyki zawodników pojawią się w trakcie meczu.</div>}
    </div>
  );
}

function KeyPlayers({ t, players, color }: { t: TeamDetail; players: LineupPlayer[]; color: string }) {
  return (
    <div className="card">
      <h3>Kluczowi zawodnicy · {t.short} <span className="hint">wpływ na mecz wg statystyk</span></h3>
      <div className="stack" style={{ gap: 6 }}>
        {players.map((p) => (
          <div className="kp" key={p.id}>
            <div className="no" style={{ background: color, color: '#fff' }}>{p.jersey}</div>
            <div>
              <div className="nm">{p.name} <span className="imp">{p.positionPl} · wpływ {p.impact}</span></div>
              <div className="why">{p.why || 'bez wydarzeń'}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function FormTab({ data }: { data: FootballDetail }) {
  const { teams, h2h } = data;
  const Strip = ({ t }: { t: TeamDetail }) => (
    <div className="card">
      <h3>{t.name} · ostatnie mecze</h3>
      {t.lastFive.length === 0 ? <div className="note">Brak danych.</div> : (
        <div className="stack" style={{ gap: 6 }}>
          {t.lastFive.map((g: FormGame) => (
            <div className="result" key={g.id}>
              <div className={`res ${g.result}`} style={g.result === 'D' ? { background: '#6b7280' } : undefined}>{g.result === 'W' ? 'Z' : g.result === 'D' ? 'R' : 'P'}</div>
              <div className="who" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {g.opponent.logo && <img src={g.opponent.logo} alt="" style={{ width: 20, height: 20, objectFit: 'contain' }} />}
                <div>
                  <div className="opp">{g.homeAway === 'H' ? 'vs' : '@'} {g.opponent.name}</div>
                  <div className="meta">{fmtDate(g.date)} · {g.competition || ''}{g.round ? ` · ${g.round}` : ''}</div>
                </div>
              </div>
              <div className="sc" style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>{g.gf}:{g.ga}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
  return (
    <div className="stack">
      <div className="grid c2"><Strip t={teams.home} /><Strip t={teams.away} /></div>
      <div className="card">
        <h3>Bezpośrednie mecze {h2h.summary && <span className="hint">{teams.home.short} {h2h.summary.homeWins} · remisy {h2h.summary.draws} · {teams.away.short} {h2h.summary.awayWins}</span>}</h3>
        {h2h.games.length === 0 ? <div className="note">Brak danych o bezpośrednich meczach.</div> : (
          <div className="stack" style={{ gap: 6 }}>
            {h2h.games.map((g) => {
              const hw = g.home.score > g.away.score, aw = g.away.score > g.home.score;
              return (
                <div className="bigmatch" key={g.id} style={{ padding: '8px 12px', borderRadius: 10, background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-end', fontWeight: hw ? 700 : 500 }}>{g.home.name}{g.home.logo && <img src={g.home.logo} alt="" style={{ width: 20, height: 20 }} />}</div>
                  <div className="mono" style={{ fontWeight: 700, fontSize: 16, minWidth: 60, textAlign: 'center' }}>{g.home.score} : {g.away.score}<div className="note" style={{ fontWeight: 400 }}>{fmtDate(g.date)}</div></div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: aw ? 700 : 500 }}>{g.away.logo && <img src={g.away.logo} alt="" style={{ width: 20, height: 20 }} />}{g.away.name}</div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function TableTab({ rows, homeId, awayId, note }: { rows: TableRow[]; homeId: string; awayId: string; note?: string }) {
  if (!rows.length) return <div className="card note">Brak tabeli dla tych rozgrywek (puchar, mecz towarzyski lub faza pucharowa).</div>;
  const hasGoals = rows.some((r) => r.gf || r.ga);
  return (
    <div className="card">
      <h3>Tabela {note && <span className="hint">{note}</span>}</h3>
      <div style={{ overflowX: 'auto' }}>
        <table className="tbl">
          <thead><tr><th>#</th><th>Drużyna</th><th className="num">M</th><th className="num">Z</th><th className="num">R</th><th className="num">P</th>{hasGoals && <th className="num">Bramki</th>}<th className="num">+/−</th><th className="num">Pkt</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={r.id === homeId ? 'hl-home' : r.id === awayId ? 'hl-away' : ''}>
                <td className="num">{r.rank}</td>
                <td><div className="tm">{r.noteColor && <span className="zone" style={{ background: r.noteColor }} title={r.note} />}{r.logo && <img src={r.logo} alt="" />}{r.name}</div></td>
                <td className="num">{r.gp}</td><td className="num">{r.w}</td><td className="num">{r.d}</td><td className="num">{r.l}</td>
                {hasGoals && <td className="num">{r.gf}:{r.ga}</td>}
                <td className="num">{r.gd > 0 ? `+${r.gd}` : r.gd}</td>
                <td className="num" style={{ fontWeight: 700 }}>{r.pts}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="legend" style={{ marginTop: 10 }}>
        {[...new Map(rows.filter((r) => r.note).map((r) => [r.note, r.noteColor])).entries()].map(([n, c]) => <span key={n}><i className="sw" style={{ background: c || 'var(--muted)' }} />{n}</span>)}
      </div>
    </div>
  );
}

const EV_ICON: Record<string, { cls: string; txt: string; label: string }> = {
  goal: { cls: 'goal', txt: '⚽', label: 'Gol' },
  pengoal: { cls: 'goal', txt: '⚽', label: 'Gol z karnego' },
  owngoal: { cls: 'goal', txt: '⚽', label: 'Gol samobójczy' },
  penmiss: { cls: 'other', txt: '✗', label: 'Niewykorzystany karny' },
  yellow: { cls: 'yellow', txt: '', label: 'Żółta kartka' },
  red: { cls: 'red', txt: '', label: 'Czerwona kartka' },
  sub: { cls: 'sub', txt: '⇄', label: 'Zmiana' },
  var: { cls: 'other', txt: 'VAR', label: 'VAR' },
  'shootout-goal': { cls: 'goal', txt: '⚽', label: 'Karny (seria) – gol' },
  'shootout-miss': { cls: 'other', txt: '✗', label: 'Karny (seria) – pudło' },
  other: { cls: 'other', txt: '•', label: 'Wydarzenie' },
};

function TimelineTab({ events, home, away }: { events: MatchEvent[]; home: TeamDetail; away: TeamDetail }) {
  if (!events.length) return <div className="card note">Brak wydarzeń – mecz jeszcze się nie rozpoczął lub źródło nie podaje przebiegu.</div>;
  return (
    <div className="card">
      <h3>Przebieg meczu <span className="hint">{home.short} po lewej · {away.short} po prawej</span></h3>
      <div className="timeline">
        {events.map((e, i) => {
          const ic = EV_ICON[e.kind] || EV_ICON.other;
          const body = (
            <>
              <span className={`ic ${ic.cls}`}>{ic.txt}</span>
              <span>{e.players.length ? e.players.join(' → ') : ic.label}<br /><small>{ic.label}{e.kind === 'sub' ? ' (wchodzi → schodzi)' : ''}</small></span>
            </>
          );
          return (
            <div className="tl" key={i}>
              <div className={`ev home`}>{e.team === 'home' && body}</div>
              <div className="min">{e.minute}</div>
              <div className={`ev away`}>{e.team === 'away' && body}{e.team === 'none' && <span className="muted">{e.text}</span>}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
