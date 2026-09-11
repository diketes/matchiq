import React, { useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Sparkles } from '@react-three/drei';
import * as THREE from 'three';

const CW = 3.2, CL = 8.4; // proporcje kortu 10.97 x 23.77 (z korytarzami deblowymi)

const SURF: Record<string, { court: string; out: string; line: string }> = {
  hard: { court: '#2f6fb5', out: '#2b8a5c', line: '#ffffff' },
  clay: { court: '#c2562b', out: '#9c4222', line: '#f7f1e6' },
  grass: { court: '#3f9a4a', out: '#2f7a3a', line: '#ffffff' },
  carpet: { court: '#3b4f8f', out: '#2b3766', line: '#ffffff' },
};

function useCourtTexture(surface: string) {
  return useMemo(() => {
    const s = SURF[surface] || SURF.hard;
    const c = document.createElement('canvas');
    c.width = 640; c.height = 1680;
    const g = c.getContext('2d')!;
    g.fillStyle = s.out; g.fillRect(0, 0, c.width, c.height);
    const mx = 100, my = 140; // margines
    const w = c.width - 2 * mx, h = c.height - 2 * my;
    g.fillStyle = s.court; g.fillRect(mx, my, w, h);
    g.strokeStyle = s.line; g.lineWidth = 5;
    g.strokeRect(mx, my, w, h);
    const single = w * (8.23 / 10.97);
    const sx = mx + (w - single) / 2;
    g.beginPath(); g.moveTo(sx, my); g.lineTo(sx, my + h); g.moveTo(sx + single, my); g.lineTo(sx + single, my + h); g.stroke();
    const serviceY = h * (6.4 / 23.77);
    g.beginPath();
    g.moveTo(sx, my + h / 2 - serviceY); g.lineTo(sx + single, my + h / 2 - serviceY);
    g.moveTo(sx, my + h / 2 + serviceY); g.lineTo(sx + single, my + h / 2 + serviceY);
    g.moveTo(c.width / 2, my + h / 2 - serviceY); g.lineTo(c.width / 2, my + h / 2 + serviceY);
    g.stroke();
    // siatka (linia)
    g.strokeStyle = 'rgba(255,255,255,0.35)'; g.beginPath(); g.moveTo(mx - 40, my + h / 2); g.lineTo(mx + w + 40, my + h / 2); g.stroke();
    // znaczniki środka linii końcowej
    g.strokeStyle = s.line; g.beginPath(); g.moveTo(c.width / 2, my); g.lineTo(c.width / 2, my + 18); g.moveTo(c.width / 2, my + h); g.lineTo(c.width / 2, my + h - 18); g.stroke();
    const tex = new THREE.CanvasTexture(c);
    tex.anisotropy = 8; tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }, [surface]);
}

function Rally({ homeColor, awayColor, speed }: { homeColor: string; awayColor: string; speed: number }) {
  const ball = useRef<THREE.Mesh>(null!);
  const p1 = useRef<THREE.Group>(null!);
  const p2 = useRef<THREE.Group>(null!);
  const trail = useRef<THREE.Mesh[]>([]);
  const hist = useRef<THREE.Vector3[]>([]);
  const state = useRef({ t: 0, dir: 1, fromX: 0, toX: 0.6 });

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05);
    const s = state.current;
    s.t += dt * speed;
    if (s.t >= 1) { s.t = 0; s.dir *= -1; s.fromX = s.toX; s.toX = (Math.random() - 0.5) * 2.2; }
    const u = s.t;
    const z0 = -CL / 2 + 0.3, z1 = CL / 2 - 0.3;
    const zStart = s.dir === 1 ? z0 : z1, zEnd = s.dir === 1 ? z1 : z0;
    const z = zStart + (zEnd - zStart) * u;
    const x = s.fromX + (s.toX - s.fromX) * u;
    let y: number;
    if (u < 0.72) y = 0.12 + 1.35 * Math.sin((Math.PI * u) / 0.72);
    else y = 0.12 + 0.45 * Math.sin((Math.PI * (u - 0.72)) / 0.28);
    ball.current.position.set(x, y, z);
    ball.current.rotation.x += dt * 12;
    // ślad
    hist.current.unshift(new THREE.Vector3(x, y, z));
    if (hist.current.length > 10) hist.current.pop();
    trail.current.forEach((m, i) => { const h = hist.current[i * 1 + 1]; if (m && h) { m.position.copy(h); m.visible = true; } else if (m) m.visible = false; });
    // gracze biegną do piłki
    const t = performance.now() / 1000;
    p1.current.position.x += ((s.dir === 1 ? s.fromX : s.toX) - p1.current.position.x) * 0.06;
    p2.current.position.x += ((s.dir === 1 ? s.toX : s.fromX) - p2.current.position.x) * 0.06;
    p1.current.position.y = Math.abs(Math.sin(t * 6)) * 0.04;
    p2.current.position.y = Math.abs(Math.sin(t * 6 + 1)) * 0.04;
  });

  const Player = ({ color, z, refObj }: { color: string; z: number; refObj: React.MutableRefObject<THREE.Group> }) => (
    <group ref={refObj} position={[0, 0, z]}>
      <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}><ringGeometry args={[0.2, 0.28, 32]} /><meshBasicMaterial color={color} transparent opacity={0.6} /></mesh>
      <mesh position={[0, 0.45, 0]} castShadow><capsuleGeometry args={[0.15, 0.36, 4, 14]} /><meshStandardMaterial color={color} roughness={0.6} /></mesh>
      <mesh position={[0, 0.88, 0]} castShadow><sphereGeometry args={[0.12, 20, 20]} /><meshStandardMaterial color="#e8c9a8" /></mesh>
      <mesh position={[0.24, 0.55, 0.1]} rotation={[0.3, 0, -0.5]}><torusGeometry args={[0.11, 0.02, 8, 24]} /><meshStandardMaterial color="#222" /></mesh>
    </group>
  );

  return (
    <>
      <mesh ref={ball} castShadow>
        <sphereGeometry args={[0.07, 16, 16]} />
        <meshStandardMaterial color="#d4e94a" emissive="#9fb800" emissiveIntensity={0.35} />
      </mesh>
      {Array.from({ length: 9 }).map((_, i) => (
        <mesh key={i} ref={(el) => { if (el) trail.current[i] = el; }}>
          <sphereGeometry args={[0.05 - i * 0.004, 8, 8]} />
          <meshBasicMaterial color="#d4e94a" transparent opacity={0.45 - i * 0.045} />
        </mesh>
      ))}
      <Player color={homeColor} z={-CL / 2 + 0.25} refObj={p1} />
      <Player color={awayColor} z={CL / 2 - 0.25} refObj={p2} />
    </>
  );
}

function Net() {
  return (
    <group>
      <mesh position={[0, 0.46, 0]}><boxGeometry args={[CW + 0.6, 0.04, 0.02]} /><meshStandardMaterial color="#fff" /></mesh>
      <mesh position={[0, 0.23, 0]}>
        <planeGeometry args={[CW + 0.6, 0.46]} />
        <meshStandardMaterial color="#cfd8e3" transparent opacity={0.35} side={THREE.DoubleSide} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[(s * (CW + 0.6)) / 2, 0.25, 0]}><cylinderGeometry args={[0.03, 0.03, 0.5, 8]} /><meshStandardMaterial color="#222" /></mesh>
      ))}
      <mesh position={[0, 0.25, 0]}><cylinderGeometry args={[0.015, 0.015, 0.5, 8]} /><meshStandardMaterial color="#fff" /></mesh>
    </group>
  );
}

export default function Court3D({ surface, homeColor = '#3987e5', awayColor = '#d95926', live }: { surface: string; homeColor?: string; awayColor?: string; live?: boolean }) {
  const tex = useCourtTexture(surface);
  const s = SURF[surface] || SURF.hard;
  return (
    <div className="pitchwrap" style={{ height: 320 }}>
      <Canvas dpr={[1, 1.5]} shadows camera={{ position: [0, 5.2, 8.5], fov: 40 }} gl={{ antialias: true }}>
        <color attach="background" args={['#0a0e16']} />
        <fog attach="fog" args={['#0a0e16', 12, 26]} />
        <ambientLight intensity={0.6} />
        <directionalLight position={[5, 10, 4]} intensity={2.4} castShadow shadow-mapSize={[1024, 1024]} />
        <pointLight position={[-5, 4, -5]} intensity={20} color="#d4e94a" />
        <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <planeGeometry args={[CW + 1.4, CL + 1.4]} />
          <meshStandardMaterial map={tex} roughness={0.95} />
        </mesh>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]}>
          <planeGeometry args={[CW + 4, CL + 4]} />
          <meshStandardMaterial color={s.out} roughness={1} />
        </mesh>
        <Net />
        <Rally homeColor={homeColor} awayColor={awayColor} speed={live ? 0.55 : 0.4} />
        <Sparkles count={40} scale={[8, 3, 10]} position={[0, 1.5, 0]} size={1.6} speed={0.2} color="#ffffff" opacity={0.35} />
        <OrbitControls enablePan={false} minDistance={5} maxDistance={16} minPolarAngle={0.3} maxPolarAngle={1.3} autoRotate autoRotateSpeed={0.35} />
      </Canvas>
      <div className="hint">Nawierzchnia: {surface === 'clay' ? 'mączka' : surface === 'grass' ? 'trawa' : 'twarda'} · przeciągnij, aby obrócić</div>
    </div>
  );
}
