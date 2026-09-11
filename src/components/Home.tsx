import React, { Suspense, useMemo } from 'react';
import type { MatchItem, Sport } from '../types';
import { fmtDayLabel, plural } from '../api';

const HeroScene = React.lazy(() => import('./three/HeroScene'));

interface Props { sport: Sport; matches: MatchItem[]; loading: boolean; onPick: (m: MatchItem) => void; today?: string; date: string; onShowList?: () => void }

export default function Home({ sport, matches, loading, onPick, today, date, onShowList }: Props) {
  const live = useMemo(() => matches.filter((m) => m.state === 'in').slice(0, 12), [matches]);
  const upcoming = useMemo(() => matches.filter((m) => m.state === 'pre' && m.dateKey === date).sort((a, b) => a.league.tier - b.league.tier || new Date(a.date).getTime() - new Date(b.date).getTime()).slice(0, 12), [matches, date]);
  const finished = useMemo(() => matches.filter((m) => m.state === 'post' && m.dateKey === date).sort((a, b) => a.league.tier - b.league.tier).slice(0, 8), [matches, date]);
  const t = today || date;

  return (
    <div className="content-inner stack">
      <div className="hero">
        <div className="canvas3d">
          <Suspense fallback={null}><HeroScene sport={sport} /></Suspense>
        </div>
        <div className="copy">
          <h1>{sport === 'football' ? <>Analiza meczów <span>piłkarskich</span> na żywo</> : <>Analiza meczów <span>tenisowych</span> na żywo</>}</h1>
          <p>{sport === 'football'
            ? 'Wybierz mecz z listy: analiza liczy szanse na wygraną, remis i porażkę z formy, tabeli, bilansu u siebie/na wyjeździe, świeżości, stawki meczu, bezpośrednich meczów, sygnałów z sieci i przebiegu gry. Kursy bukmacherskie służą tylko do porównania.'
            : 'Wybierz mecz z listy: model Markowa (punkt → gem → set → mecz) liczy szanse z rankingu, formy, nawierzchni i bieżącego wyniku. Do tego profile graczy, forma i bezpośrednie mecze.'}</p>
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

      {live.length > 0 && (
        <section>
          <h3 style={{ fontSize: 13, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-2)', marginBottom: 10 }}><span style={{ color: 'var(--live)' }}>●</span> Na żywo teraz</h3>
          <div className="picks">{live.map((m) => <Pick key={m.id} m={m} onPick={onPick} sport={sport} />)}</div>
        </section>
      )}
      {upcoming.length > 0 && (
        <section>
          <h3 style={{ fontSize: 13, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-2)', marginBottom: 10 }}>Nadchodzące · {fmtDayLabel(date, t)}</h3>
          <div className="picks">{upcoming.map((m) => <Pick key={m.id} m={m} onPick={onPick} sport={sport} />)}</div>
        </section>
      )}
      {finished.length > 0 && (
        <section>
          <h3 style={{ fontSize: 13, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-2)', marginBottom: 10 }}>Zakończone · {fmtDayLabel(date, t)}</h3>
          <div className="picks">{finished.map((m) => <Pick key={m.id} m={m} onPick={onPick} sport={sport} />)}</div>
        </section>
      )}

      <section className="grid c3">
        <div className="card">
          <h3>Jak liczymy szanse</h3>
          <p className="text-2" style={{ margin: 0, fontSize: 13 }}>
            {sport === 'football'
              ? 'Każda drużyna dostaje siłę ataku i obrony (gole strzelone/stracone względem średniej ligi, sezon + ostatnie 5 meczów), korektę za formę, bilans u siebie / na wyjeździe, świeżość (dni od ostatniego meczu), stawkę meczu i bezpośrednie mecze. Z tego wychodzą oczekiwane gole (xG), a rozkład Poissona z korektą Dixona-Colesa zamienia je na prawdopodobieństwa wyników.'
              : 'Ranking i punkty rankingowe dają bazowe szanse, forma z 10 ostatnich meczów, bilans na danej nawierzchni i H2H je korygują. Następnie dobieramy skuteczność serwisu obu graczy tak, aby model Markowa (punkt → gem → set → mecz) dawał te szanse – i liczymy z niego dalej, także w trakcie meczu.'}
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
        <div className="card">
          <h3>Analiza, nie kursy</h3>
          <p className="text-2" style={{ margin: 0, fontSize: 13 }}>
            {sport === 'football'
              ? 'Typ „kto wygra” wynika wyłącznie z analizy – kursy bukmacherskie nie wchodzą do prognozy. Pokazujemy je obok tylko dla porównania i wyraźnie zaznaczamy, gdy analiza wskazuje inny wynik niż rynek.'
              : 'Dla tenisa pokazujemy składowe: ile szans wynika z rankingu, ile z formy, nawierzchni i bezpośrednich meczów. Pewność modelu spada w deblu i gdy brakuje danych o graczach spoza rankingu.'}
          </p>
        </div>
      </section>
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
        <div className="probbar" style={{ height: 8 }}>
          <div className="seg home" style={{ flex: m.market.home }} />
          {m.market.draw != null && <div className="seg draw" style={{ flex: m.market.draw }} />}
          <div className="seg away" style={{ flex: m.market.away }} />
        </div>
      )}
      {sport === 'tennis' && (m.home.rank || m.away.rank) && <div className="note">Ranking: #{m.home.rank ?? '—'} vs #{m.away.rank ?? '—'} · {m.surface === 'clay' ? 'mączka' : m.surface === 'grass' ? 'trawa' : 'twarda'}</div>}
    </div>
  );
}
