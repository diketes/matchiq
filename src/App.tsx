import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { usePolling, LOCAL_ENGINE } from './api';
import type { MatchItem, MatchListResponse, Sport } from './types';
import TopBar from './components/TopBar';
import Sidebar, { type Filter } from './components/Sidebar';
import Home from './components/Home';
import Bets from './components/Bets';
import Model from './components/Model';
import FootballMatch from './components/football/FootballMatch';
import TennisMatch from './components/tennis/TennisMatch';

export interface Selection { sport: Sport; leagueId: string; id: string; tab?: string }
export type View = 'home' | 'list' | 'bets' | 'model';

function parseHash(): { sport: Sport; sel: Selection | null; view: View } {
  const h = window.location.hash.replace(/^#\/?/, '');
  const [sport, leagueId, id, tab] = h.split('/');
  if (sport === 'kupony') return { sport: 'football', sel: null, view: 'bets' };
  if (sport === 'model') return { sport: 'football', sel: null, view: 'model' };
  if (sport === 'mecze') return { sport: leagueId === 'tennis' ? 'tennis' : 'football', sel: null, view: 'list' };
  const s: Sport = sport === 'tennis' ? 'tennis' : 'football';
  if (leagueId && id) return { sport: s, sel: { sport: s, leagueId: decodeURIComponent(leagueId), id, tab }, view: 'home' };
  return { sport: s, sel: null, view: 'home' };
}

/** Telefon / wąskie okno: lista meczów jako osobny widok, dolna nawigacja. */
function useIsMobile() {
  const query = '(max-width: 800px)';
  const [mobile, setMobile] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setMobile(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return mobile;
}

const NavIcon = ({ kind }: { kind: 'home' | 'list' | 'bets' | 'model' }) => {
  const common = { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  if (kind === 'home') return <svg {...common}><path d="M3 11l9-8 9 8v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z" /></svg>;
  if (kind === 'list') return <svg {...common}><path d="M4 6h16M4 12h16M4 18h16" /></svg>;
  if (kind === 'bets') return <svg {...common}><path d="M3 8a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4z" /><path d="M13 6v12" strokeDasharray="2 3" /></svg>;
  return <svg {...common}><path d="M3 20h18M5 17V9M10 17V4M15 17v-7M20 17v-4" /></svg>;
};

export default function App() {
  const init = useMemo(parseHash, []);
  const isMobile = useIsMobile();
  const [sport, setSport] = useState<Sport>(init.sport);
  const [date, setDate] = useState<string>(() => new Date().toLocaleDateString('en-CA'));
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [sel, setSel] = useState<Selection | null>(init.sel);
  const [view, setView] = useState<View>(init.view);
  const selRef = useRef(sel);
  const viewRef = useRef(view);
  selRef.current = sel;
  viewRef.current = view;

  useEffect(() => { document.documentElement.dataset.sport = sport; }, [sport]);
  useEffect(() => {
    const h = sel ? `#/${sel.sport}/${encodeURIComponent(sel.leagueId)}/${sel.id}` : view === 'bets' ? '#/kupony' : view === 'model' ? '#/model' : view === 'list' ? `#/mecze/${sport}` : `#/${sport}`;
    if (window.location.hash !== h) window.history.replaceState(null, '', h);
  }, [sel, sport, view]);
  useEffect(() => {
    const onHash = () => { const p = parseHash(); setSport(p.sport); setSel(p.sel); setView(p.view); };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  // Android: przycisk „wstecz” cofa do listy zamiast zamykać aplikację
  useEffect(() => {
    const cap = (window as any).Capacitor;
    if (!cap?.isNativePlatform?.()) return;
    let remove: (() => void) | undefined;
    import('@capacitor/app').then(({ App: CapApp }) => {
      CapApp.addListener('backButton', () => {
        if (selRef.current) setSel(null);
        else if (viewRef.current !== 'home') setView('home');
        else CapApp.exitApp();
      }).then((h) => { remove = () => h.remove(); });
    }).catch(() => { /* brak pluginu w przeglądarce */ });
    return () => remove?.();
  }, []);

  const listUrl = `/api/${sport}/matches?date=${date}`;
  const list = usePolling<MatchListResponse>(listUrl, LOCAL_ENGINE ? 45_000 : 30_000);
  const matches = list.data?.matches ?? [];
  const liveCount = matches.filter((m) => m.state === 'in').length;

  const pick = (m: MatchItem) => { setSel({ sport: m.sport, leagueId: m.league.id, id: m.id }); };
  const changeSport = (s: Sport) => { setSport(s); setSel(null); if (view === 'bets' || view === 'model') setView('home'); setFilter('all'); setQuery(''); };
  const openMatch = (leagueId: string, id: string) => { setSport('football'); setSel({ sport: 'football', leagueId, id }); };
  const goHome = () => { setSel(null); setView('home'); };
  const goView = (v: View) => { setSel(null); setView(v); };

  const sidebar = (mobile: boolean) => (
    <Sidebar sport={sport} list={list} filter={filter} onFilter={setFilter} query={query} onQuery={setQuery} selected={sel} onPick={pick} date={date} mobile={mobile} />
  );

  const fade = { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0 }, transition: { duration: 0.25 } };

  return (
    <div className={`app${isMobile ? ' mobile' : ''}`}>
      <TopBar sport={sport} onSport={changeSport} date={date} onDate={setDate} today={list.data?.today} query={query} onQuery={setQuery} liveCount={liveCount} onHome={goHome} bets={view === 'bets' && !sel} onBets={() => goView('bets')} model={view === 'model' && !sel} onModel={() => goView('model')} mobile={isMobile} />
      <div className="body">
        {!isMobile && sidebar(false)}
        <main className="content">
          <AnimatePresence mode="wait">
            {sel ? (
              sel.sport === 'football' ? (
                <motion.div key={`f-${sel.id}`} {...fade}>
                  <FootballMatch leagueId={sel.leagueId} id={sel.id} onBack={() => setSel(null)} initialTab={sel.tab} />
                </motion.div>
              ) : (
                <motion.div key={`t-${sel.id}`} {...fade}>
                  <TennisMatch tour={sel.leagueId.split(':')[0]} id={sel.id} onBack={() => setSel(null)} initialTab={sel.tab} />
                </motion.div>
              )
            ) : view === 'bets' ? (
              <motion.div key="bets" {...fade}>
                <Bets onOpenMatch={openMatch} />
              </motion.div>
            ) : view === 'model' ? (
              <motion.div key="model" {...fade}>
                <Model onOpenMatch={openMatch} />
              </motion.div>
            ) : isMobile && view === 'list' ? (
              <motion.div key="list" {...fade} style={{ height: '100%' }}>
                {sidebar(true)}
              </motion.div>
            ) : (
              <motion.div key="home" {...fade}>
                <Home sport={sport} matches={matches} loading={list.loading} onPick={pick} today={list.data?.today} date={date} onShowList={isMobile ? () => goView('list') : undefined} onOpenMatch={openMatch} onModel={() => goView('model')} />
              </motion.div>
            )}
          </AnimatePresence>
        </main>
      </div>
      {isMobile && (
        <nav className="bottomnav" aria-label="Nawigacja">
          <button className={!sel && view === 'home' ? 'active' : ''} onClick={goHome}><NavIcon kind="home" />Start</button>
          <button className={!sel && view === 'list' ? 'active' : ''} onClick={() => goView('list')}><NavIcon kind="list" />Mecze{liveCount > 0 && <b className="ln">{liveCount}</b>}</button>
          <button className={!sel && view === 'bets' ? 'active' : ''} onClick={() => goView('bets')}><NavIcon kind="bets" />Kupony</button>
          <button className={!sel && view === 'model' ? 'active' : ''} onClick={() => goView('model')}><NavIcon kind="model" />Model</button>
        </nav>
      )}
    </div>
  );
}
