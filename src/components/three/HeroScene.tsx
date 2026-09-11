import React, { useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Sparkles, Float } from '@react-three/drei';
import * as THREE from 'three';
import type { Sport } from '../../types';

/** Piłka z prostą fizyką: grawitacja, odbicie z tłumieniem, ściśnięcie przy uderzeniu */
function BouncingBall({ sport }: { sport: Sport }) {
  const group = useRef<THREE.Group>(null!);
  const phys = useRef({ y: 2.2, vy: 0, squash: 1, spin: 0 });

  const seam = useMemo(() => {
    // szew piłki tenisowej (krzywa parametryczna)
    const pts: THREE.Vector3[] = [];
    const a = 0.62, b = 0.2;
    for (let i = 0; i <= 200; i++) {
      const t = (i / 200) * Math.PI * 2;
      pts.push(new THREE.Vector3(a * Math.cos(t) + b * Math.cos(3 * t), a * Math.sin(t) - b * Math.sin(3 * t), 0.72 * Math.sin(2 * t)).normalize().multiplyScalar(0.705));
    }
    return new THREE.CatmullRomCurve3(pts, true);
  }, []);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05);
    const p = phys.current;
    p.vy -= 9.81 * dt;
    p.y += p.vy * dt;
    if (p.y <= 0) {
      p.y = 0;
      p.vy = -p.vy * 0.78;
      if (Math.abs(p.vy) < 1.2) p.vy = 5.2; // "kopnięcie" – piłka nigdy nie zasypia
      p.squash = 0.7;
      p.spin = 1;
    }
    p.squash += (1 - p.squash) * Math.min(1, dt * 12);
    p.spin += (0 - p.spin) * Math.min(1, dt * 3);
    const g = group.current;
    g.position.y = p.y + 0.7;
    const sx = 1 / Math.sqrt(p.squash);
    g.scale.set(sx, p.squash, sx);
    g.rotation.y += dt * (0.6 + p.spin * 2.5);
    g.rotation.x += dt * 0.35;
  });

  return (
    <group ref={group} position={[0.6, 0.7, 0]}>
      {sport === 'football' ? (
        <>
          <mesh castShadow>
            <icosahedronGeometry args={[0.7, 1]} />
            <meshStandardMaterial color="#f4f6fa" flatShading roughness={0.35} metalness={0.05} />
          </mesh>
          <mesh>
            <icosahedronGeometry args={[0.705, 1]} />
            <meshBasicMaterial color="#0b0f16" wireframe />
          </mesh>
        </>
      ) : (
        <>
          <mesh castShadow>
            <sphereGeometry args={[0.7, 48, 48]} />
            <meshStandardMaterial color="#d4e94a" roughness={0.9} metalness={0} />
          </mesh>
          <mesh>
            <tubeGeometry args={[seam, 220, 0.022, 8, true]} />
            <meshStandardMaterial color="#f7fbe0" roughness={0.8} />
          </mesh>
        </>
      )}
    </group>
  );
}

function Ring({ radius, speed, color, tilt }: { radius: number; speed: number; color: string; tilt: number }) {
  const ref = useRef<THREE.Mesh>(null!);
  useFrame((_, dt) => { ref.current.rotation.z += dt * speed; });
  return (
    <mesh ref={ref} rotation={[tilt, 0.3, 0]} position={[0.6, 1.4, 0]}>
      <torusGeometry args={[radius, 0.012, 8, 120]} />
      <meshBasicMaterial color={color} transparent opacity={0.55} />
    </mesh>
  );
}

function CameraRig() {
  const { camera } = useThree();
  useEffect(() => { camera.lookAt(0.6, 1.0, 0); }, [camera]);
  return null;
}

function Scene({ sport }: { sport: Sport }) {
  const accent = sport === 'football' ? '#35d07f' : '#d4e94a';
  return (
    <>
      <CameraRig />
      <color attach="background" args={['#0a0e16']} />
      <fog attach="fog" args={['#0a0e16', 8, 18]} />
      <ambientLight intensity={0.9} />
      <hemisphereLight args={['#ffffff', '#0a0e16', 0.6]} />
      <spotLight position={[4, 7, 4]} angle={0.55} penumbra={0.8} intensity={120} color="#ffffff" castShadow shadow-mapSize={[1024, 1024]} />
      <pointLight position={[-4, 3, -2]} intensity={30} color={accent} />
      <pointLight position={[3, 2, -4]} intensity={22} color="#3987e5" />
      <BouncingBall sport={sport} />
      <Ring radius={1.5} speed={0.35} color={accent} tilt={1.2} />
      <Ring radius={2.0} speed={-0.22} color="#3987e5" tilt={1.5} />
      <Float speed={1.4} rotationIntensity={0.6} floatIntensity={0.8}>
        <mesh position={[2.9, 1.9, -1.5]}>
          <octahedronGeometry args={[0.22, 0]} />
          <meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={0.5} />
        </mesh>
      </Float>
      <Float speed={1.1} rotationIntensity={0.8} floatIntensity={0.6}>
        <mesh position={[-3.1, 2.4, -1.2]}>
          <tetrahedronGeometry args={[0.2, 0]} />
          <meshStandardMaterial color="#3987e5" emissive="#3987e5" emissiveIntensity={0.5} />
        </mesh>
      </Float>
      <Sparkles count={140} scale={[12, 5, 8]} position={[0, 2, -1]} size={2.2} speed={0.35} color="#cfe6ff" opacity={0.7} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <planeGeometry args={[30, 30]} />
        <meshStandardMaterial color="#0d1424" roughness={0.35} metalness={0.6} />
      </mesh>
      <gridHelper args={[30, 30, '#1c2a44', '#131c30']} position={[0, 0.005, 0]} />
    </>
  );
}

export default function HeroScene({ sport }: { sport: Sport }) {
  return (
    <Canvas dpr={[1, 1.5]} shadows camera={{ position: [0.6, 2.4, 6.5], fov: 36 }} gl={{ antialias: true }}>
      <Scene sport={sport} />
    </Canvas>
  );
}

/** Lekka scena cząsteczek do tła nagłówka meczu */
export function ParticlesFX({ colorA, colorB }: { colorA: string; colorB: string }) {
  return (
    <Canvas dpr={[1, 1.25]} camera={{ position: [0, 0, 6], fov: 45 }} gl={{ antialias: false, alpha: true }} style={{ background: 'transparent' }}>
      <Sparkles count={70} scale={[14, 4, 4]} position={[-4, 0, 0]} size={3} speed={0.25} color={colorA} opacity={0.6} />
      <Sparkles count={70} scale={[14, 4, 4]} position={[4, 0, 0]} size={3} speed={0.25} color={colorB} opacity={0.6} />
    </Canvas>
  );
}
