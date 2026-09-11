import React, { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { pct } from '../api';
import type { Factor, Insight, StatRow } from '../types';

/* ---------- pasek prawdopodobieństw (2 lub 3 wyniki) ---------- */
export function ProbBar({ home, draw, away, homeName, awayName, big }: { home: number; draw?: number; away: number; homeName: string; awayName: string; big?: boolean }) {
  const segs = [
    { k: 'home', v: home, label: homeName },
    ...(draw != null ? [{ k: 'draw', v: draw, label: 'Remis' }] : []),
    { k: 'away', v: away, label: awayName },
  ];
  return (
    <div>
      <div className="probbar" style={big ? { height: 44 } : undefined} role="img" aria-label={segs.map((s) => `${s.label} ${pct(s.v)}`).join(', ')}>
        {segs.map((s) => (
          <motion.div key={s.k} className={`seg ${s.k}`} initial={{ flex: 1 }} animate={{ flex: Math.max(s.v, 0.02) }} transition={{ duration: 0.7, ease: [0.2, 0.8, 0.2, 1] }} title={`${s.label}: ${pct(s.v, 1)}`}>
            {s.v >= 0.08 && <span>{pct(s.v)}</span>}
          </motion.div>
        ))}
      </div>
      <div className="problabels">
        <span><b className="home-c">{homeName}</b> {pct(home, 1)}</span>
        {draw != null && <span>Remis {pct(draw, 1)}</span>}
        <span>{pct(away, 1)} <b className="away-c">{awayName}</b></span>
      </div>
    </div>
  );
}

/* ---------- wskaźnik pewności (łuk) ---------- */
export function Gauge({ value, label = 'Pewność' }: { value: number; label?: string }) {
  const r = 50, cx = 60, cy = 60;
  const arc = (t: number) => {
    const a = Math.PI * (1 - t);
    return { x: cx + r * Math.cos(a), y: cy - r * Math.sin(a) };
  };
  const end = arc(value);
  const large = value > 0.5 ? 1 : 0;
  const color = value >= 0.7 ? 'var(--good)' : value >= 0.45 ? 'var(--warning)' : 'var(--serious)';
  return (
    <div className="gauge" title={`${label}: ${pct(value)}`}>
      <svg width="120" height="70" viewBox="0 0 120 70">
        <path d={`M ${arc(0).x} ${arc(0).y} A ${r} ${r} 0 1 1 ${arc(1).x} ${arc(1).y}`} fill="none" stroke="var(--grid)" strokeWidth="8" strokeLinecap="round" />
        <motion.path d={`M ${arc(0).x} ${arc(0).y} A ${r} ${r} 0 ${large} 1 ${end.x} ${end.y}`} fill="none" stroke={color} strokeWidth="8" strokeLinecap="round" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.8 }} />
      </svg>
      <div className="lab">{pct(value)}</div>
      <div className="sub">{label}</div>
    </div>
  );
}

/* ---------- radar (dwie serie) ---------- */
export function Radar({ axes, home, away, homeName, awayName, size = 300 }: { axes: { key: string; label: string }[]; home: Record<string, number>; away: Record<string, number>; homeName: string; awayName: string; size?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const cx = size / 2, cy = size / 2, R = size / 2 - 46;
  const n = axes.length;
  const pt = (i: number, v: number) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    return { x: cx + Math.cos(a) * R * v, y: cy + Math.sin(a) * R * v };
  };
  const poly = (vals: Record<string, number>) => axes.map((ax, i) => { const p = pt(i, Math.max(0.03, (vals[ax.key] ?? 0) / 100)); return `${p.x},${p.y}`; }).join(' ');
  const rings = [0.25, 0.5, 0.75, 1];
  return (
    <div>
      <svg width="100%" viewBox={`0 0 ${size} ${size}`} style={{ maxHeight: size }} role="img" aria-label={`Radar: ${homeName} vs ${awayName}`}>
        {rings.map((r) => (
          <polygon key={r} points={axes.map((_, i) => { const p = pt(i, r); return `${p.x},${p.y}`; }).join(' ')} fill="none" stroke="var(--grid)" strokeWidth={1} />
        ))}
        {axes.map((_, i) => { const p = pt(i, 1); return <line key={i} x1={cx} y1={cy} x2={p.x} y2={p.y} stroke="var(--grid)" strokeWidth={1} />; })}
        <motion.polygon points={poly(home)} fill="var(--home)" fillOpacity={0.22} stroke="var(--home)" strokeWidth={2} initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }} style={{ transformOrigin: `${cx}px ${cy}px` }} transition={{ duration: 0.6 }} />
        <motion.polygon points={poly(away)} fill="var(--away)" fillOpacity={0.22} stroke="var(--away)" strokeWidth={2} initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }} style={{ transformOrigin: `${cx}px ${cy}px` }} transition={{ duration: 0.6, delay: 0.1 }} />
        {axes.map((ax, i) => {
          const ph = pt(i, Math.max(0.03, (home[ax.key] ?? 0) / 100));
          const pa = pt(i, Math.max(0.03, (away[ax.key] ?? 0) / 100));
          const lp = pt(i, 1.22);
          const anchor = Math.abs(lp.x - cx) < 10 ? 'middle' : lp.x > cx ? 'start' : 'end';
          return (
            <g key={ax.key} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <circle cx={ph.x} cy={ph.y} r={hover === i ? 6 : 4} fill="var(--home)" stroke="var(--surface)" strokeWidth={2} />
              <circle cx={pa.x} cy={pa.y} r={hover === i ? 6 : 4} fill="var(--away)" stroke="var(--surface)" strokeWidth={2} />
              <text x={lp.x} y={lp.y} textAnchor={anchor} dominantBaseline="middle" fontSize={11} fill={hover === i ? 'var(--text)' : 'var(--muted)'} fontWeight={600}>{ax.label}</text>
              {hover === i && (
                <text x={lp.x} y={lp.y + 14} textAnchor={anchor} fontSize={11} fill="var(--text-2)" fontFamily="var(--font-mono)">{Math.round(home[ax.key] ?? 0)} · {Math.round(away[ax.key] ?? 0)}</text>
              )}
              <circle cx={pt(i, 1).x} cy={pt(i, 1).y} r={16} fill="transparent" />
            </g>
          );
        })}
      </svg>
      <div className="legend" style={{ justifyContent: 'center' }}>
        <span><i className="sw" style={{ background: 'var(--home)' }} />{homeName}</span>
        <span><i className="sw" style={{ background: 'var(--away)' }} />{awayName}</span>
      </div>
    </div>
  );
}

/* ---------- czynniki (rozbieżny pasek) ---------- */
export function Factors({ factors }: { factors: Factor[] }) {
  return (
    <div className="factors">
      {factors.map((f) => {
        const net = Math.max(-1, Math.min(1, (f.home - f.away) / 2));
        return (
          <div className="factor" key={f.key} title={f.note}>
            <div className="lbl">{f.label}{f.note && <small>{f.note}</small>}</div>
            <div className="bar">
              {net > 0.01 && <i className="h" style={{ width: `${net * 50}%` }} />}
              {net < -0.01 && <i className="a" style={{ width: `${-net * 50}%` }} />}
              {Math.abs(net) <= 0.01 && <i className="h" style={{ width: '1%', background: 'var(--muted)' }} />}
            </div>
            <div className="w">waga {Math.round(f.weight * 100)}%</div>
          </div>
        );
      })}
      <div className="note">Słupek w lewo od środka = przewaga gospodarza / gracza 1, w prawo = gościa / gracza 2. Długość = jak mocno czynnik przechyla szalę.</div>
    </div>
  );
}

/* ---------- lista wniosków ---------- */
const ICON: Record<Insight['kind'], string> = { strength: '+', weakness: '−', warning: '!', info: 'i' };
export function Insights({ items, empty = 'Brak wniosków' }: { items: Insight[]; empty?: string }) {
  if (!items?.length) return <div className="note">{empty}</div>;
  return (
    <ul className="insights">
      {items.map((it, i) => (
        <motion.li key={i} className={it.kind} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.04 }}>
          <span className="ic">{ICON[it.kind]}</span>
          <span>{it.text}</span>
          {it.tag && <span className="tag">{it.tag}</span>}
        </motion.li>
      ))}
    </ul>
  );
}

/* ---------- porównanie statystyk ---------- */
export function StatCompare({ rows }: { rows: StatRow[] }) {
  if (!rows.length) return <div className="note">Statystyki pojawią się po rozpoczęciu meczu.</div>;
  return (
    <div className="statrows">
      {rows.map((r) => {
        const max = r.pctType ? 100 : Math.max(r.home, r.away, 1);
        const fmt = (v: number) => (r.pctType ? `${Math.round(v)}%` : `${v}`);
        return (
          <div className="statrow" key={r.key}>
            <div className="v" style={{ color: r.home > r.away ? 'var(--text)' : 'var(--text-2)' }}>{fmt(r.home)}</div>
            <div className="mid">
              <div className="lbl">{r.label}</div>
              <div className="bars">
                <div className="l"><i style={{ width: `${(r.home / max) * 100}%` }} /></div>
                <div className="r"><i style={{ width: `${(r.away / max) * 100}%` }} /></div>
              </div>
            </div>
            <div className="v r" style={{ color: r.away > r.home ? 'var(--text)' : 'var(--text-2)' }}>{fmt(r.away)}</div>
          </div>
        );
      })}
    </div>
  );
}

/* ---------- mapa wyników (Poisson) ---------- */
export function ScoreHeat({ matrix, homeName, awayName }: { matrix: number[][]; homeName: string; awayName: string }) {
  const max = useMemo(() => Math.max(...matrix.flat()), [matrix]);
  let best = { i: 0, j: 0, v: 0 };
  matrix.forEach((row, i) => row.forEach((v, j) => { if (v > best.v) best = { i, j, v }; }));
  const color = (v: number) => {
    const t = Math.pow(v / max, 0.6);
    return `rgba(57,135,229,${0.06 + 0.84 * t})`;
  };
  return (
    <div>
      <div className="note" style={{ marginBottom: 6 }}>Wiersze: gole {homeName} · Kolumny: gole {awayName}. Im ciemniej, tym bardziej prawdopodobny wynik.</div>
      <div className="heat">
        <div className="hd" />
        {matrix[0].map((_, j) => <div className="hd" key={j}>{j}</div>)}
        {matrix.map((row, i) => (
          <React.Fragment key={i}>
            <div className="hd">{i}</div>
            {row.map((v, j) => (
              <div className={`c${i === best.i && j === best.j ? ' best' : ''}`} key={j} style={{ background: color(v) }} title={`${i}:${j} – ${pct(v, 1)}`}>{v >= 0.03 ? Math.round(v * 100) : ''}</div>
            ))}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

/* ---------- kafelek statystyki ---------- */
export function Tile({ label, value, sub, color, small }: { label: string; value: React.ReactNode; sub?: React.ReactNode; color?: string; small?: boolean }) {
  return (
    <div className="tile">
      <div className="lbl">{label}</div>
      <div className="val" style={{ ...(color ? { color } : {}), ...(small ? { fontSize: 16 } : {}) }}>{value}</div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  );
}

/* ---------- ścieżki do zwycięstwa (rozkład wyników w setach) ---------- */
export function PathBars({ paths, homeName, awayName }: { paths: { label: string; winner: 'home' | 'away'; p: number }[]; homeName: string; awayName: string }) {
  return (
    <div className="paths">
      {paths.map((p) => (
        <div className="path" key={p.label} title={`${p.winner === 'home' ? homeName : awayName} wygrywa ${p.label} – ${pct(p.p, 1)}`}>
          <div className="lbl" style={{ color: p.winner === 'home' ? 'var(--home)' : 'var(--away)' }}>{p.label}</div>
          <div className="bar"><motion.i initial={{ width: 0 }} animate={{ width: `${p.p * 100}%` }} transition={{ duration: 0.6 }} style={{ background: p.winner === 'home' ? 'var(--home)' : 'var(--away)' }} /></div>
          <div className="v">{pct(p.p)}</div>
        </div>
      ))}
      <div className="legend"><span><i className="sw" style={{ background: 'var(--home)' }} />{homeName}</span><span><i className="sw" style={{ background: 'var(--away)' }} />{awayName}</span></div>
    </div>
  );
}
