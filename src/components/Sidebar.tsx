import React, { useMemo, useState } from 'react';
import type { MatchItem, MatchListResponse, Sport } from '../types';
import type { PollState } from '../api';
import type { Selection } from '../App';
import { fmtDayLabel } from '../api';

export type Filter = 'all' | 'live' | 'today' | 'yesterday' | 'tomorrow' | 'upcoming' | 'finished';

interface Props {
  sport: Sport; list: PollState<MatchListResponse>; filter: Filter; onFilter: (f: Filter) => void;
  query: string; onQuery?: (q: string) => void; selected: Selection | null; onPick: (m: MatchItem) => void; date: string;
  mobile?: boolean;
}

export default function Sidebar({ sport, list, filter, onFilter, query, onQuery, selected, onPick, date, mobile }: Props) {
  const data = list.data;
  const matches = data?.matches ?? [];
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const counts = useMemo(() => ({
    live: matches.filter((m) => m.state === 'in').length,
    today: matches.filter((m) => m.dateKey === date).length,
    yesterday: matches.filter((m) => data && m.dateKey === data.yesterday).length,
    tomorrow: matches.filter((m) => data && m.dateKey === data.tomorrow).length,
    upcoming: matches.filter((m) => m.state === 'pre').length,
    finished: matches.filter((m) => m.state === 'post').length,
  }), [matches, data, date]);

  const q = query.trim().toLowerCase();
  const filtered = useMemo(() => matches.filter((m) => {
    if (filter === 'live' && m.state !== 'in') return false;
    if (filter === 'today' && m.dateKey !== date) return false;
    if (filter === 'yesterday' && m.dateKey !== data?.yesterday) return false;
    if (filter === 'tomorrow' && m.dateKey !== data?.tomorrow) return false;
    if (filter === 'upcoming' && m.state !== 'pre') return false;
    if (filter === 'finished' && m.state !== 'post') return false;
    if (filter === 'all' && m.state !== 'in' && m.dateKey !== date) return false;
    if (q) {
      const hay = `${m.home.name} ${m.away.name} ${m.home.short} ${m.away.short} ${m.league.name} ${m.league.region} ${m.group || ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  }), [matches, filter, q, date, data]);

  // grupowanie po lidze / turnieju
  const groups = useMemo(() => {
    const map = new Map<string, { key: string; name: string; region: string; tier: number; items: MatchItem[]; live: number }>();
    for (const m of filtered) {
      const key = sport === 'tennis' ? `${m.league.id}|${m.group || ''}` : m.league.id;
      const name = sport === 'tennis' ? `${m.league.name}` : m.league.name;
      const region = sport === 'tennis' ? `${m.league.region} · ${m.group || ''}` : m.league.region;
      if (!map.has(key)) map.set(key, { key, name, region, tier: m.league.tier, items: [], live: 0 });
      const g = map.get(key)!;
      g.items.push(m);
      if (m.state === 'in') g.live++;
    }
    const arr = [...map.values()];
    arr.sort((a, b) => (b.live > 0 ? 1 : 0) - (a.live > 0 ? 1 : 0) || a.tier - b.tier || a.name.localeCompare(b.name, 'pl'));
    for (const g of arr) g.items.sort((a, b) => (a.state === 'in' ? -1 : 0) - (b.state === 'in' ? -1 : 0) || new Date(a.date).getTime() - new Date(b.date).getTime());
    return arr;
  }, [filtered, sport]);

  const t = data?.today || date;
  const chips: { k: Filter; label: string; n: number; live?: boolean }[] = [
    { k: 'live', label: 'Na żywo', n: counts.live, live: true },
    { k: 'all', label: `${fmtDayLabel(date, t)} + live`, n: counts.today },
    { k: 'upcoming', label: 'Nadchodzące', n: counts.upcoming },
    { k: 'finished', label: 'Zakończone', n: counts.finished },
    { k: 'yesterday', label: data ? fmtDayLabel(data.yesterday, t) : 'Wczoraj', n: counts.yesterday },
    { k: 'tomorrow', label: data ? fmtDayLabel(data.tomorrow, t) : 'Jutro', n: counts.tomorrow },
  ];

  return (
    <aside className={`sidebar${mobile ? ' mobile' : ''}`}>
      {mobile && onQuery && (
        <div className="msearch">
          <label className="search">
            <span>⌕</span>
            <input placeholder={sport === 'football' ? 'Szukaj drużyny lub ligi…' : 'Szukaj zawodnika lub turnieju…'} value={query} onChange={(e) => onQuery(e.target.value)} />
            {query && <button onClick={() => onQuery('')} title="Wyczyść">✕</button>}
          </label>
        </div>
      )}
      <div className="filters">
        {chips.map((c) => (
          <button key={c.k} className={`chip${filter === c.k ? ' active' : ''}${c.live ? ' live' : ''}`} onClick={() => onFilter(c.k)}>
            {c.live && <span className="pulse" style={{ width: 7, height: 7, borderRadius: 4, background: 'var(--live)', display: 'inline-block' }} />}
            {c.label} <span className="n">{c.n}</span>
          </button>
        ))}
      </div>
      <div className="list">
        {list.loading && !data && <div className="loading"><div className="spinner" /> Pobieram mecze…</div>}
        {list.error && <div className="errbox" style={{ margin: 10 }}>Nie udało się pobrać listy: {list.error}</div>}
        {data && groups.length === 0 && (
          <div className="empty"><h3>Brak meczów</h3>Zmień filtr, datę lub wyszukiwanie.</div>
        )}
        {groups.map((g) => {
          const isCollapsed = !!collapsed[g.key];
          return (
            <div className="league-group" key={g.key}>
              <div className={`league-head${isCollapsed ? ' collapsed' : ''}`} onClick={() => setCollapsed((c) => ({ ...c, [g.key]: !c[g.key] }))}>
                <span>{g.name}</span>
                <span className="region">{g.region}</span>
                {g.live > 0 && <span style={{ color: 'var(--live)' }}>● {g.live}</span>}
                <span className="caret">▾</span>
              </div>
              {!isCollapsed && g.items.map((m) => (
                <MatchCard key={m.id} m={m} active={selected?.id === m.id} onClick={() => onPick(m)} sport={sport} />
              ))}
            </div>
          );
        })}
        {data && (
          <div className="updated" style={{ padding: '14px 8px' }}>
            Odświeżanie automatyczne · {list.updatedAt ? new Date(list.updatedAt).toLocaleTimeString('pl-PL') : ''}
            <button className="refresh" onClick={list.refresh}>odśwież</button>
          </div>
        )}
      </div>
    </aside>
  );
}

function MatchCard({ m, active, onClick, sport }: { m: MatchItem; active: boolean; onClick: () => void; sport: Sport }) {
  const live = m.state === 'in';
  const dayHint = m.dateKey !== new Date().toLocaleDateString('en-CA') ? new Date(m.date).toLocaleDateString('pl-PL', { day: 'numeric', month: 'short' }) : null;
  return (
    <div className={`mcard${active ? ' active' : ''}${live ? ' live' : ''}`} onClick={onClick}>
      <div className="status">
        {m.statusText}
        {dayHint && m.state === 'pre' && <small>{dayHint}</small>}
        {live && m.period != null && sport === 'football' && <small>{m.period === 1 ? '1. poł.' : m.period === 2 ? '2. poł.' : 'dogr.'}</small>}
        {sport === 'tennis' && m.round && <small>{m.round}</small>}
      </div>
      <div className="teams">
        <TeamLine side={m.home} winner={m.state === 'post' && m.home.winner} sport={sport} />
        <TeamLine side={m.away} winner={m.state === 'post' && m.away.winner} sport={sport} />
      </div>
      {sport === 'football' ? (
        <div className="score">
          <span className={`s${m.state === 'pre' ? ' dim' : ''}`}>{m.state === 'pre' ? '–' : m.home.score ?? '–'}</span>
          <span className={`s${m.state === 'pre' ? ' dim' : ''}`}>{m.state === 'pre' ? '–' : m.away.score ?? '–'}</span>
        </div>
      ) : (
        <div className="score">
          <div className="sets">
            {(m.home.sets || []).map((s, i) => <span key={i} className={s.won ? 'w' : ''}>{s.games}</span>)}
            <span className="w" style={{ marginLeft: 4 }}>{m.state === 'pre' ? '' : m.home.score}</span>
          </div>
          <div className="sets">
            {(m.away.sets || []).map((s, i) => <span key={i} className={s.won ? 'w' : ''}>{s.games}</span>)}
            <span className="w" style={{ marginLeft: 4 }}>{m.state === 'pre' ? '' : m.away.score}</span>
          </div>
        </div>
      )}
      {m.market && m.state !== 'post' && (
        <div className="prob" title={`Kursy (tylko podgląd): ${Math.round(m.market.home * 100)}% / ${m.market.draw != null ? Math.round(m.market.draw * 100) + '% / ' : ''}${Math.round(m.market.away * 100)}%`}>
          <i style={{ width: `${m.market.home * 100}%`, background: 'var(--home)' }} />
          {m.market.draw != null && <i style={{ width: `${m.market.draw * 100}%`, background: 'var(--draw)' }} />}
          <i style={{ width: `${m.market.away * 100}%`, background: 'var(--away)' }} />
        </div>
      )}
    </div>
  );
}

function TeamLine({ side, winner, sport }: { side: MatchItem['home']; winner?: boolean; sport: Sport }) {
  const img = sport === 'football' ? side.logo : side.flag;
  return (
    <div className={`team${winner ? ' win' : ''}`}>
      {img ? <img src={img} alt="" loading="lazy" /> : <span style={{ width: 18, height: 18, borderRadius: 4, background: 'var(--surface-3)', display: 'inline-block' }} />}
      <span className="nm">{side.name}</span>
      {sport === 'tennis' && (side.seed || side.rank) && <span className="rk">{side.seed ? `[${side.seed}]` : ''}{side.rank ? ` #${side.rank}` : ''}</span>}
    </div>
  );
}
