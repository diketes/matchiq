import React, { useEffect, useState } from 'react';
import type { Sport } from '../types';
import { fmtDayLabel } from '../api';

interface Props {
  sport: Sport; onSport: (s: Sport) => void;
  date: string; onDate: (d: string) => void; today?: string;
  query: string; onQuery: (q: string) => void;
  liveCount: number; onHome: () => void;
  bets: boolean; onBets: () => void;
  mobile?: boolean;
}

const shift = (key: string, days: number) => {
  const d = new Date(key + 'T12:00:00');
  d.setDate(d.getDate() + days);
  return d.toLocaleDateString('en-CA');
};

export default function TopBar({ sport, onSport, date, onDate, today, query, onQuery, liveCount, onHome, bets, onBets, mobile }: Props) {
  const [now, setNow] = useState(new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);
  const t = today || new Date().toLocaleDateString('en-CA');
  return (
    <header className={`topbar${mobile ? ' compact' : ''}`}>
      <div className="brand" onClick={onHome} title="Strona główna">
        <div className="logo">M</div>
        Match<span className="iq">IQ</span>
      </div>
      <div className="seg" role="tablist" aria-label="Dyscyplina">
        <button className={sport === 'football' ? 'active' : ''} onClick={() => onSport('football')}>
          <span className="dot" style={{ background: '#35d07f' }} /> {mobile ? 'Piłka' : 'Piłka nożna'}
        </button>
        <button className={sport === 'tennis' ? 'active' : ''} onClick={() => onSport('tennis')}>
          <span className="dot" style={{ background: '#d4e94a' }} /> Tenis
        </button>
      </div>
      <div className="datenav" aria-label="Wybór dnia">
        <button onClick={() => onDate(shift(date, -1))} title="Poprzedni dzień">‹</button>
        <button className="label" onClick={() => onDate(t)} title="Wróć do dziś">{fmtDayLabel(date, t)}</button>
        <button onClick={() => onDate(shift(date, 1))} title="Następny dzień">›</button>
        <span className="cal" title="Wybierz datę">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="5" width="18" height="16" rx="3" /><path d="M3 10h18M8 3v4M16 3v4" /></svg>
          <input type="date" value={date} onChange={(e) => e.target.value && onDate(e.target.value)} />
        </span>
      </div>
      {!mobile && (
        <>
          <label className="search">
            <span>⌕</span>
            <input placeholder={sport === 'football' ? 'Szukaj drużyny lub ligi…' : 'Szukaj zawodnika lub turnieju…'} value={query} onChange={(e) => onQuery(e.target.value)} />
            {query && <button onClick={() => onQuery('')} title="Wyczyść">✕</button>}
          </label>
          <button className={`bets-btn${bets ? ' active' : ''}`} onClick={onBets} title="Wirtualne kupony i bankroll">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 8a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4z" /><path d="M13 6v12" strokeDasharray="2 3" /></svg>
            Kupony
          </button>
        </>
      )}
      <div className="spacer" />
      {liveCount > 0 && <div className="livebadge"><span className="pulse" /> {liveCount}{mobile ? '' : ' na żywo'}</div>}
      {!mobile && <div className="clock">{now.toLocaleTimeString('pl-PL')}</div>}
    </header>
  );
}
