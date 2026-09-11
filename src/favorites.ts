import { useCallback, useEffect, useState } from 'react';

// Ulubione drużyny / zawodnicy – lokalnie na urządzeniu.
export interface Favorite { id: string; name: string; sport: 'football' | 'tennis'; logo?: string }

const KEY = 'matchiq.favorites.v1';
const listeners = new Set<() => void>();

function read(): Favorite[] {
  try { const raw = localStorage.getItem(KEY); const arr = raw ? JSON.parse(raw) : []; return Array.isArray(arr) ? arr : []; } catch { return []; }
}
function write(list: Favorite[]) {
  try { localStorage.setItem(KEY, JSON.stringify(list.slice(0, 60))); } catch { /* ignore */ }
  listeners.forEach((l) => l());
}

export function useFavorites() {
  const [list, setList] = useState<Favorite[]>(read);
  useEffect(() => { const l = () => setList(read()); listeners.add(l); return () => { listeners.delete(l); }; }, []);
  const isFav = useCallback((id: string) => list.some((f) => f.id === id), [list]);
  const toggle = useCallback((f: Favorite) => {
    const cur = read();
    write(cur.some((x) => x.id === f.id) ? cur.filter((x) => x.id !== f.id) : [...cur, f]);
  }, []);
  return { favorites: list, isFav, toggle };
}

// Udostępnianie: systemowe okno (telefon) albo schowek.
export async function shareText(title: string, text: string): Promise<'shared' | 'copied' | 'failed'> {
  const nav: any = navigator;
  try {
    if (nav.share) { await nav.share({ title, text }); return 'shared'; }
  } catch (e: any) { if (e?.name === 'AbortError') return 'failed'; }
  try { await navigator.clipboard.writeText(text); return 'copied'; } catch { return 'failed'; }
}
