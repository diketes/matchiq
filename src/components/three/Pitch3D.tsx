import React, { useMemo, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Html } from '@react-three/drei';
import * as THREE from 'three';
import type { Lineup, LineupPlayer } from '../../types';

const W = 6.8, L = 10.5; // proporcje boiska 68 x 105 m

/* ---------- tekstura boiska ---------- */
function usePitchTexture() {
  return useMemo(() => {
    const c = document.createElement('canvas');
    c.width = 680; c.height = 1050;
    const g = c.getContext('2d')!;
    // pasy trawy
    for (let i = 0; i < 12; i++) {
      g.fillStyle = i % 2 ? '#1f7a3e' : '#237f43';
      g.fillRect(0, (i * c.height) / 12, c.width, c.height / 12 + 1);
    }
    g.strokeStyle = 'rgba(255,255,255,0.9)';
    g.lineWidth = 4;
    const m = 30; // margines
    g.strokeRect(m, m, c.width - 2 * m, c.height - 2 * m);
    g.beginPath(); g.moveTo(m, c.height / 2); g.lineTo(c.width - m, c.height / 2); g.stroke();
    g.beginPath(); g.arc(c.width / 2, c.height / 2, 91.5, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.arc(c.width / 2, c.height / 2, 5, 0, Math.PI * 2); g.fillStyle = '#fff'; g.fill();
    const box = (top: boolean) => {
      const y0 = top ? m : c.height - m;
      const dir = top ? 1 : -1;
      // pole karne 40.3 x 16.5 m
      g.strokeRect(c.width / 2 - 201.5, top ? y0 : y0 - 165, 403, 165);
      // pole bramkowe 18.3 x 5.5
      g.strokeRect(c.width / 2 - 91.5, top ? y0 : y0 - 55, 183, 55);
      // punkt karny
      g.beginPath(); g.arc(c.width / 2, y0 + dir * 110, 4, 0, Math.PI * 2); g.fill();
      // łuk pola karnego
      g.beginPath();
      g.arc(c.width / 2, y0 + dir * 110, 91.5, top ? 0.65 : Math.PI + 0.65, top ? Math.PI - 0.65 : 2 * Math.PI - 0.65);
      g.stroke();
      // bramka
      g.fillStyle = 'rgba(255,255,255,0.25)';
      g.fillRect(c.width / 2 - 36.6, top ? y0 - 18 : y0, 73.2, 18);
      g.fillStyle = '#fff';
    };
    box(true); box(false);
    const tex = new THREE.CanvasTexture(c);
    tex.anisotropy = 8;
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }, []);
}

/* ---------- układ zawodników ---------- */
const DEPTH: Record<string, number> = { G: 0, GK: 0, SW: 1, CD: 1, 'CD-L': 1, 'CD-R': 1, D: 1, LB: 1, RB: 1, LWB: 1.5, RWB: 1.5, DM: 2, 'DM-L': 2, 'DM-R': 2, CM: 3, 'CM-L': 3, 'CM-R': 3, M: 3, LM: 3, RM: 3, AM: 4, 'AM-L': 4, 'AM-R': 4, LW: 4.5, RW: 4.5, F: 5, CF: 5, 'CF-L': 5, 'CF-R': 5, ST: 5 };
const lateral = (pos: string) => (/(^L|-L$|^LW|^LB|^LM)/.test(pos) ? -1 : /(^R|-R$|^RW|^RB|^RM)/.test(pos) ? 1 : 0);

export interface Placed { p: LineupPlayer; px: number; py: number }

export function layoutTeam(lineup: Lineup | null): Placed[] {
  if (!lineup) return [];
  const onPitch = [...lineup.starters.filter((p) => !p.subbedOut), ...lineup.subs.filter((p) => p.subbedIn && !p.subbedOut)];
  const gk = onPitch.find((p) => (DEPTH[p.position] ?? 3) === 0) || onPitch[0];
  const field = onPitch.filter((p) => p !== gk).sort((a, b) => (DEPTH[a.position] ?? 3) - (DEPTH[b.position] ?? 3) || a.formationPlace - b.formationPlace);
  let lines = (lineup.formation || '').split('-').map(Number).filter((n) => n > 0);
  if (!lines.length || lines.reduce((s, n) => s + n, 0) !== field.length) {
    const d = field.filter((p) => (DEPTH[p.position] ?? 3) <= 1.5).length;
    const f = field.filter((p) => (DEPTH[p.position] ?? 3) >= 4.5).length;
    const m = field.length - d - f;
    lines = [d, m, f].filter((n) => n > 0);
    if (!lines.length) lines = [field.length];
  }
  const out: Placed[] = [];
  if (gk) out.push({ p: gk, px: 0.5, py: 0.06 });
  let idx = 0;
  lines.forEach((count, k) => {
    const members = field.slice(idx, idx + count).sort((a, b) => lateral(a.position) - lateral(b.position) || a.formationPlace - b.formationPlace);
    idx += count;
    const py = 0.24 + (lines.length > 1 ? k * (0.68 / (lines.length - 1)) : 0.34);
    members.forEach((p, i) => out.push({ p, px: count === 1 ? 0.5 : 0.12 + (i / (count - 1)) * 0.76, py }));
  });
  return out;
}

/* ---------- tekstura numeru ---------- */
const numCache = new Map<string, THREE.CanvasTexture>();
function numberTexture(num: string, color: string, text: string) {
  const key = `${num}|${color}|${text}`;
  if (numCache.has(key)) return numCache.get(key)!;
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  const g = c.getContext('2d')!;
  g.beginPath(); g.arc(64, 64, 58, 0, Math.PI * 2); g.fillStyle = color; g.fill();
  g.lineWidth = 6; g.strokeStyle = 'rgba(255,255,255,0.85)'; g.stroke();
  g.fillStyle = text; g.font = 'bold 60px Inter, Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(num || '', 64, 68);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  numCache.set(key, t);
  return t;
}

function luminance(hex: string) {
  const h = hex.replace('#', '');
  if (h.length < 6) return 0.5;
  const r = parseInt(h.slice(0, 2), 16) / 255, g = parseInt(h.slice(2, 4), 16) / 255, b = parseInt(h.slice(4, 6), 16) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function Player({ placed, side, color, offset, highlight }: { placed: Placed; side: 'home' | 'away'; color: string; offset: number; highlight: boolean }) {
  const ref = useRef<THREE.Group>(null!);
  const [hover, setHover] = useState(false);
  const x = (placed.px - 0.5) * (W * 0.9) * (side === 'home' ? 1 : -1);
  const z = side === 'home' ? L / 2 - 0.5 - placed.py * (L / 2 - 0.9) : -(L / 2 - 0.5) + placed.py * (L / 2 - 0.9);
  const textColor = luminance(color) > 0.55 ? '#111' : '#fff';
  const tex = numberTexture(placed.p.jersey, color, textColor);
  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    ref.current.position.y = 0.02 + Math.sin(t * 2 + offset) * 0.03;
    const s = hover || highlight ? 1.25 : 1;
    ref.current.scale.x += (s - ref.current.scale.x) * 0.15;
    ref.current.scale.y = ref.current.scale.z = ref.current.scale.x;
  });
  const st = placed.p.stats;
  const badges = [st.goals ? `⚽ ${st.goals}` : '', st.assists ? `A ${st.assists}` : '', st.yellow ? '🟨' : '', st.red ? '🟥' : '', st.saves ? `🧤 ${st.saves}` : ''].filter(Boolean).join(' ');
  return (
    <group position={[x, 0, z]}>
      <group ref={ref} onPointerOver={(e) => { e.stopPropagation(); setHover(true); document.body.style.cursor = 'pointer'; }} onPointerOut={() => { setHover(false); document.body.style.cursor = 'auto'; }}>
        <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.22, 0.3, 32]} />
          <meshBasicMaterial color={color} transparent opacity={0.55} />
        </mesh>
        <mesh position={[0, 0.42, 0]} castShadow>
          <capsuleGeometry args={[0.15, 0.32, 4, 14]} />
          <meshStandardMaterial color={color} roughness={0.6} />
        </mesh>
        <mesh position={[0, 0.82, 0]} castShadow>
          <sphereGeometry args={[0.12, 20, 20]} />
          <meshStandardMaterial color="#e8c9a8" roughness={0.7} />
        </mesh>
        <sprite position={[0, 1.2, 0]} scale={[0.42, 0.42, 1]}>
          <spriteMaterial map={tex} transparent depthWrite={false} />
        </sprite>
        {(hover || highlight) && (
          <Html position={[0, 1.55, 0]} center zIndexRange={[10, 0]}>
            <div className="tip">
              <b>{placed.p.jersey}. {placed.p.name}</b>
              <span className="muted">{placed.p.positionName || placed.p.positionPl}{placed.p.subbedIn ? ' · wszedł z ławki' : ''}</span>
              {badges && <div>{badges}</div>}
            </div>
          </Html>
        )}
      </group>
    </group>
  );
}

function Ball() {
  const ref = useRef<THREE.Mesh>(null!);
  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    ref.current.position.set(Math.sin(t * 0.7) * 0.6, 0.15 + Math.abs(Math.sin(t * 2.2)) * 0.25, Math.cos(t * 0.5) * 0.8);
    ref.current.rotation.x = t * 2; ref.current.rotation.z = t * 1.3;
  });
  return (
    <mesh ref={ref} castShadow>
      <icosahedronGeometry args={[0.13, 1]} />
      <meshStandardMaterial color="#fff" flatShading />
    </mesh>
  );
}

function PitchMesh() {
  const tex = usePitchTexture();
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[W + 1.2, L + 1.2]} />
        <meshStandardMaterial map={tex} roughness={0.95} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]}>
        <planeGeometry args={[W + 2.2, L + 2.2]} />
        <meshStandardMaterial color="#0d2417" roughness={1} />
      </mesh>
      {/* bramki */}
      {[1, -1].map((s) => (
        <group key={s} position={[0, 0, (s * (L + 1.2)) / 2 - s * 0.6]}>
          <mesh position={[0, 0.5, s * 0.02]}>
            <boxGeometry args={[0.74, 0.03, 0.03]} />
            <meshStandardMaterial color="#fff" />
          </mesh>
          <mesh position={[-0.37, 0.25, 0]}><boxGeometry args={[0.03, 0.5, 0.03]} /><meshStandardMaterial color="#fff" /></mesh>
          <mesh position={[0.37, 0.25, 0]}><boxGeometry args={[0.03, 0.5, 0.03]} /><meshStandardMaterial color="#fff" /></mesh>
          <mesh position={[0, 0.25, s * 0.18]}>
            <boxGeometry args={[0.74, 0.5, 0.36]} />
            <meshBasicMaterial color="#fff" transparent opacity={0.08} wireframe />
          </mesh>
        </group>
      ))}
    </group>
  );
}

export default function Pitch3D({ home, away, homeColor, awayColor, homeName, awayName, highlightId }: { home: Lineup | null; away: Lineup | null; homeColor: string; awayColor: string; homeName: string; awayName: string; highlightId?: string | null }) {
  const hp = useMemo(() => layoutTeam(home), [home]);
  const ap = useMemo(() => layoutTeam(away), [away]);
  // upewnij się, że kolory się różnią
  let ac = awayColor;
  if (Math.abs(luminance(homeColor) - luminance(awayColor)) < 0.12) ac = luminance(homeColor) > 0.5 ? '#1f2937' : '#f3f4f6';
  return (
    <div className="pitchwrap">
      <Canvas dpr={[1, 1.5]} shadows camera={{ position: [0, 9.5, 9.5], fov: 42 }} gl={{ antialias: true }}>
        <color attach="background" args={['#08140d']} />
        <fog attach="fog" args={['#08140d', 14, 30]} />
        <ambientLight intensity={0.55} />
        <directionalLight position={[6, 12, 6]} intensity={2.2} castShadow shadow-mapSize={[2048, 2048]} shadow-camera-left={-8} shadow-camera-right={8} shadow-camera-top={8} shadow-camera-bottom={-8} />
        <pointLight position={[-6, 6, -4]} intensity={30} color="#9fd6ff" />
        <PitchMesh />
        <Ball />
        {hp.map((pl, i) => <Player key={`h${pl.p.id || i}`} placed={pl} side="home" color={homeColor} offset={i} highlight={highlightId === pl.p.id} />)}
        {ap.map((pl, i) => <Player key={`a${pl.p.id || i}`} placed={pl} side="away" color={ac} offset={i + 11} highlight={highlightId === pl.p.id} />)}
        <OrbitControls enablePan={false} minDistance={7} maxDistance={20} minPolarAngle={0.25} maxPolarAngle={1.35} target={[0, 0, 0]} />
      </Canvas>
      <div className="teamlabel top" style={{ borderLeft: `3px solid ${ac}` }}>{awayName}{away?.formation ? ` · ${away.formation}` : ''}</div>
      <div className="teamlabel bottom" style={{ borderLeft: `3px solid ${homeColor}` }}>{homeName}{home?.formation ? ` · ${home.formation}` : ''}</div>
      <div className="hint">Przeciągnij, aby obrócić · kółko myszy = zoom · najedź na zawodnika</div>
    </div>
  );
}
