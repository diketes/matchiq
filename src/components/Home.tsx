import React, { Suspense, useMemo } from 'react';
import type { AccuracyResponse, MatchItem, Sport, TrackedPrediction } from '../types';
import { fmtDayLabel, plural, pct, usePolling, fmtTime } from '../api';
import { useFavorites } from '../favorites';

const HeroScene = React.lazy(() => import('./three/HeroScene'));

interface Props {
  sport: Sport; matches: MatchItem[]; loading: boolean; onPick: (m: MatchItem) => void; today?: string; date: string;
  onShowList?: () => void; onOpenMatch: (leagueId: string, id: string) => void; onModel: () => void;
}

const SectionTitle = ({ children }: { children: React.ReactNode }) => <h3 className="sect">{children}</h3>;

export default function Home({ sport, matches, loading, onPick, today, date, onShowList, onOpenMatch, onModel }: Props) {
  const live = useMemo(() => matches.filter((m) => m.state === 'in').slice(0, 12), [matches]);
  const upcoming = useMemo(() => matches.filter((m) => m.state === 'pre' && m.dateKey === date).sort((a, b) => a.league.tier - b.league.tier || new Date(a.date).getTime() - new Date(b.date).getTime()).slice(0, 12), [matches, date]);
  const finished = useMemo(() => matches.filter((m) => m.state === 'post' && m.dateKey === date).sort((a, b) => a.league.tier - b.league.tier).slice(0, 8), [matches, date]);
  const t = today || date;
  const acc = usePolling<AccuracyResponse>(sport === 'football' ? '/api/accuracy' : null, 10 * 60_000);
  const picksOfDay = useMemo(() => {
    const now = Date.now();
    return (acc.data?.remote?.upcoming || []).filter((p) => new Date(p.date).getTime() > now - 2 * 3600_000 && new Date(p.date).getTime() < now + 40 * 3600_000).slice(0, 8);
  }, [acc.data]);
  const { favorites } = useFavorites();
  const favMatches = useMemo(() => matches.filter((m) => favorites.some((f) => f.id === m.home.id || f.id === m.away.id)).slice(0, 8), [matches, favorites]);
  const bt = acc.data?.remote?.backtest;
  const tr = acc.data?.remote?.tracked;

  return (
    <div className="content-inner stack">
      <div className="hero">
        <div className="canvas3d">
          <Suspense fallback={null}><HeroScene sport={sport} /></Suspense>
        </div>
        <div className="copy">
          <h1>{sport === 'football' ? <>Analiza meczów <span>piłkarskich</span> na żywo</> : <>Analiza meczów <span>tenisowych</span> na żywo</>}</h1>
          <p>{sport === 'football'
            ? 'Kto wygra według analizy: Elo z dwóch sezonów, xG ze strzałów, forma, tabela, bilans u siebie i na wyjeździe, świeżość, absencje w składzie, bezpośrednie mecze i sygnały z sieci. Wagi dopasowane na tysiącach meczów, skuteczność sprawdzana codziennie. Kursy tylko do porównania.'
            : 'Model Markowa (punkt → gem → set → mecz) z Elo per nawierzchnia, rankingu, formy i bieżącego wyniku. Do tego profile graczy, forma i bezpośrednie mecze.'}</p>
          <div className="pills">
            <span>{plural(matches.length, ['mecz', 'mecze', 'meczów'])} w oknie wczoraj–jutro</span>
            <span style={{ color: live.length ? '#ff8497' : undefined }}>{live.length} na żywo</span>
            <span>{sport === 'football' ? '40+ lig i pucharów' : 'ATP + WTA'}</span>
            <span>typ z analizy, nie z kursu</span>
          </div>
          {onShowList && <button className="chip active" style={{ marginTop: 14, pointerEvents: 'auto', padding: '9px 16px', fontSize: 13 }} onClick={onShowList}>Pokaż wszystkie mecze ({matches.length}) →</button>}
        </div>
      </div>

      {loading && matches.length === 0 && <div className="loading"><div className="spinner" /> Pobieram mecze…</div>}

      {sport === 'football' && picksOfDay.length > 0 && (
        <section>
          <SectionTitle>Typy dnia wg analizy <span className="muted">· najpewniejsze prognozy z codziennego trackera</span></SectionTitle>
          <div className="typy">{picksOfDay.map((p) => <PickOfDay key={p.matchId} p={p} onOpen={onOpenMatch} />)}</div>
        </section>
      )}

      {favorites.length > 0 && (
        <section>
          <SectionTitle>★ Twoje drużyny i zawodnicy <span className="muted">· {favorites.map((f) => f.name).slice(0, 4).join(', ')}{favorites.length > 4 ? '…' : ''}</span></SectionTitle>
          {favMatches.length ? <div className="picks">{favMatches.map((m) => <Pick key={m.id} m={m} onPick={onPick} sport={sport} />)}</div> : <div className="card note">Brak meczów ulubionych w oknie wczoraj–jutro. Gwiazdkę dodajesz na stronie meczu.</div>}
        </section>
      )}

      {live.length > 0 && (
        <section>
          <SectionTitle><span style={{ color: 'var(--live)' }}>●</span> Na żywo teraz</SectionTitle>
          <div className="picks">{live.map((m) => <Pick key={m.id} m={m} onPick={onPick} sport={sport} />)}</div>
        </section>
      )}
      {upcoming.length > 0 && (
        <section>
          <SectionTitle>Nadchodzące · {fmtDayLabel(date, t)}</SectionTitle>
          <div className="picks">{upcoming.map((m) => <Pick key={m.id} m={m} onPick={onPick} sport={sport} />)}</div>
        </section>
      )}
      {finished.length > 0 && (
        <section>
          <SectionTitle>Zakończone · {fmtDayLabel(date, t)}</SectionTitle>
          <div className="picks">{finished.map((m) => <Pick key={m.id} m={m} onPick={onPick} sport={sport} />)}</div>
        </section>
      )}

      <section className="grid c3">
        <div className="card modelcard" onClick={onModel} style={{ cursor: 'pointer' }}>
          <h3>Skuteczność modelu <span className="hint">zobacz →</span></h3>
          {bt ? (
            <div className="tiles" style={{ gridTemplateColumns: '1fr 1fr' }}>
              <div className="tile"><div className="lbl">Backtest</div><div className="val" style={{ color: 'var(--accent)' }}>{pct(bt.test.model.accuracy, 1)}</div><div className="sub">{bt.test.n.toLocaleString('pl-PL')} meczów poza treningiem</div></div>
              <div className="tile"><div className="lbl">Na żywo</div><div className="val">{tr && tr.settled ? pct(tr.all.model.accuracy, 1) : '—'}</div><div className="sub">{tr && tr.settled ? `${tr.settled} rozliczonych${tr.all.market.n ? ` · kursy ${pct(tr.all.market.accuracy, 1)}` : ''}` : 'zbieram prognozy'}</div></div>
            </div>
          ) : <p className="text-2" style={{ margin: 0, fontSize: 13 }}>Backtest na tysiącach meczów, kalibracja, porównanie z kursami, rankingi Elo i Twoje własne prognozy.</p>}
        </div>
        <div className="card">
          <h3>Jak liczymy szanse</h3>
          <p className="text-2" style={{ margin: 0, fontSize: 13 }}>
            {sport === 'football'
              ? 'Siła ataku i obrony (sezon + ostatnie mecze), Elo z 2 sezonów, xG ze strzałów, bilans u siebie / na wyjeździe, forma, świeżość, stawka meczu, absencje w podstawowym składzie, H2H i sygnały z sieci dają oczekiwane gole. Rozkład Poissona z korektą Dixona-Colesa zamienia je na szanse 1/X/2, a wagi są dopasowane automatycznie na historii wyników.'
              : 'Ranking i punkty rankingowe oraz Elo z ostatniego roku (osobno na twardej, mączce i trawie) dają bazowe szanse; forma, nawierzchnia i H2H je korygują. Model Markowa liczy z tego szanse także w trakcie meczu.'}
          </p>
        </div>
        <div className="card">
          <h3>Na żywo</h3>
          <p className="text-2" style={{ margin: 0, fontSize: 13 }}>
            {sport === 'football'
              ? 'W trakcie meczu model bierze pod uwagę aktualny wynik, minutę, strzały celne, posiadanie i czerwone kartki. Szanse zmieniają się z każdym golem – zobaczysz też najbardziej prawdopodobny wynik końcowy.'
              : 'W trakcie meczu model liczy szanse z aktualnego stanu setów i gemów (w tym tie-breaki). Prowadzenie 1:0 w setach przy równych siłach to ok. 75% szans, przełamanie w secie – ok. 90% na tego seta.'}
          </p>
        </div>
      </section>
    </div>
  );
}

function PickOfDay({ p, onOpen }: { p: TrackedPrediction; onOpen: (leagueId: string, id: string) => void }) {
  const favName = p.fav === 'home' ? p.home : p.fav === 'away' ? p.away : 'Remis';
  const marketFav = p.market ? (Object.keys(p.market) as ('home' | 'draw' | 'away')[]).reduce((b, k) => (p.market![k] > p.market![b] ? k : b), 'home' as 'home' | 'draw' | 'away') : null;
  const agrees = marketFav ? marketFav === p.fav : null;
  return (
    <div className="typ" onClick={() => onOpen(p.leagueId, p.matchId)}>
      <div className="lg"><span>{p.leagueName}</span><span>{new Date(p.date).toLocaleDateString('pl-PL', { day: 'numeric', month: 'short' })} {fmtTime(p.date)}</span></div>
      <div className="vs">
        <div className="t">{p.homeLogo && <img src={p.homeLogo} alt="" />}<span>{p.home}</span></div>
        <div className="sc">vs</div>
        <div className="t" style={{ flexDirection: 'row-reverse' }}>{p.awayLogo && <img src={p.awayLogo} alt="" />}<span>{p.away}</span></div>
      </div>
      <div className="probbar" style={{ height: 8 }}>
        <div className="seg home" style={{ flex: p.probs.home }} />
        <div className="seg draw" style={{ flex: p.probs.draw }} />
        <div className="seg away" style={{ flex: p.probs.away }} />
      </div>
      <div className="typline">
        <b className={p.fav === 'home' ? 'home-c' : p.fav === 'away' ? 'away-c' : ''}>{favName}</b> <span className="mono">{pct(p.probs[p.fav])}</span>
        {agrees != null && <span className={`mkt-pill${agrees ? '' : ' differs'}`} style={{ marginLeft: 'auto', padding: '2px 8px', fontSize: 11 }}>{agrees ? 'kursy ✓' : 'kursy ≠'}</span>}
      </div>
      {p.why && <div className="note">Za: {p.why}</div>}
    </div>
  );
}

function Pick({ m, onPick, sport }: { m: MatchItem; onPick: (m: MatchItem) => void; sport: Sport }) {
  const live = m.state === 'in';
  const score = sport === 'football'
    ? (m.state === 'pre' ? m.statusText : `${m.home.score ?? 0} : ${m.away.score ?? 0}`)
    : (m.state === 'pre' ? m.statusText : `${m.home.score} : ${m.away.score}`);
  return (
    <div className="pick" onClick={() => onPick(m)}>
      <div className="lg"><span>{m.league.name}{m.round ? ` · ${m.round}` : ''}</span><span style={live ? { color: 'var(--live)' } : undefined}>{live ? `● ${m.statusText}` : m.state === 'post' ? 'Koniec' : new Date(m.date).toLocaleDateString('pl-PL', { day: 'numeric', month: 'short' })}</span></div>
      <div className="vs">
        <div className="t">{(sport === 'football' ? m.home.logo : m.home.flag) && <img src={sport === 'football' ? m.home.logo : m.home.flag} alt="" />}<span>{m.home.short}</span></div>
        <div className="sc">{score}</div>
        <div className="t" style={{ flexDirection: 'row-reverse' }}>{(sport === 'football' ? m.away.logo : m.away.flag) && <img src={sport === 'football' ? m.away.logo : m.away.flag} alt="" />}<span>{m.away.short}</span></div>
      </div>
      {m.market && m.state !== 'post' && (
        <div className="probbar" style={{ height: 8 }} title="Kursy (tylko podgląd)">
          <div className="seg home" style={{ flex: m.market.home }} />
          {m.market.draw != null && <div className="seg draw" style={{ flex: m.market.draw }} />}
          <div className="seg away" style={{ flex: m.market.away }} />
        </div>
      )}
      {sport === 'tennis' && (m.home.rank || m.away.rank) && <div className="note">Ranking: #{m.home.rank ?? '—'} vs #{m.away.rank ?? '—'} · {m.surface === 'clay' ? 'mączka' : m.surface === 'grass' ? 'trawa' : 'twarda'}</div>}
    </div>
  );
}
