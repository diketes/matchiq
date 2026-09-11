import { useEffect, useRef, useState, useCallback } from 'react';

/** Aplikacja mobilna / PWA: cały silnik analizy działa lokalnie (bez serwera). Desktop: zapytania do Express. */
export const LOCAL_ENGINE: boolean =
  import.meta.env.VITE_ENGINE === 'local' || (typeof window !== 'undefined' && !!(window as any).Capacitor?.isNativePlatform?.());

type LocalHandler = (method: string, url: string, body?: any) => Promise<any>;
let localHandler: LocalHandler | null = null;
async function getLocal(): Promise<LocalHandler> {
  if (!localHandler) {
    const mod = await import('./engine/local');
    localHandler = mod.localApi;
  }
  return localHandler;
}

export interface ApiInit { method?: string; body?: any; signal?: AbortSignal }

/** Jedno wejście do API: lokalny silnik albo HTTP. Zwraca JSON, rzuca Error z komunikatem. */
export async function apiJSON<T>(url: string, init?: ApiInit): Promise<T> {
  const method = init?.method || 'GET';
  if (LOCAL_ENGINE) {
    const handler = await getLocal();
    try {
      return (await handler(method, url, init?.body)) as T;
    } catch (e: any) {
      throw new Error(e?.message || 'Błąd analizy');
    }
  }
  const res = await fetch(url, {
    method,
    signal: init?.signal,
    headers: init?.body != null ? { 'content-type': 'application/json' } : undefined,
    body: init?.body != null ? JSON.stringify(init.body) : undefined,
  });
  if (!res.ok) {
    let msg = `Błąd ${res.status}`;
    try { const j = await res.json(); if (j?.error) msg = j.error; } catch { /* ignore */ }
    throw new Error(msg);
  }
  return res.json();
}

export function fetchJSON<T>(url: string, signal?: AbortSignal): Promise<T> {
  return apiJSON<T>(url, { signal });
}

export interface PollState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  updatedAt: number | null;
  refresh: () => void;
}

/** Pobiera JSON i odświeża co `intervalMs` (0 = bez odświeżania). */
export function usePolling<T>(url: string | null, intervalMs: number): PollState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(!!url);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [tick, setTick] = useState(0);
  const urlRef = useRef(url);

  useEffect(() => {
    urlRef.current = url;
    if (!url) { setData(null); setLoading(false); return; }
    const ctrl = new AbortController();
    let timer: number | undefined;
    let cancelled = false;
    setLoading(true);
    setError(null);

    const run = async () => {
      try {
        const d = await fetchJSON<T>(url, ctrl.signal);
        if (cancelled) return;
        setData(d);
        setError(null);
        setUpdatedAt(Date.now());
      } catch (e: any) {
        if (cancelled || e?.name === 'AbortError') return;
        setError(e?.message || 'Błąd połączenia');
      } finally {
        if (!cancelled) setLoading(false);
      }
      if (!cancelled && intervalMs > 0) timer = window.setTimeout(run, intervalMs);
    };
    run();
    return () => { cancelled = true; ctrl.abort(); if (timer) window.clearTimeout(timer); };
  }, [url, intervalMs, tick]);

  const refresh = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, loading, updatedAt, refresh };
}

export const fmtTime = (iso: string) => new Intl.DateTimeFormat('pl-PL', { hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
export const fmtDate = (iso: string) => new Intl.DateTimeFormat('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(iso));
export const fmtDateShort = (iso: string) => new Intl.DateTimeFormat('pl-PL', { day: 'numeric', month: 'short' }).format(new Date(iso));
export const fmtDayLabel = (key: string, today: string) => {
  if (key === today) return 'Dziś';
  const d = new Date(key + 'T12:00:00');
  const t = new Date(today + 'T12:00:00');
  const diff = Math.round((d.getTime() - t.getTime()) / 86400000);
  if (diff === 1) return 'Jutro';
  if (diff === -1) return 'Wczoraj';
  return new Intl.DateTimeFormat('pl-PL', { weekday: 'short', day: 'numeric', month: 'short' }).format(d);
};
export const pct = (x: number, digits = 0) => `${(x * 100).toFixed(digits)}%`;
export function plural(n: number, forms: [string, string, string]) {
  const abs = Math.abs(n);
  if (abs === 1) return `${n} ${forms[0]}`;
  const last = abs % 10, tens = abs % 100;
  if (last >= 2 && last <= 4 && !(tens >= 12 && tens <= 14)) return `${n} ${forms[1]}`;
  return `${n} ${forms[2]}`;
}
export const f1 = (x: number) => x.toFixed(1).replace('.', ',');
export const f2 = (x: number) => x.toFixed(2).replace('.', ',');
