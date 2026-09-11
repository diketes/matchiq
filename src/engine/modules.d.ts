// Moduły silnika (server/*.mjs) są zwykłym JS – deklaracja typów dla TypeScriptu.
declare module '*.mjs' {
  export const handleApi: (method: string, pathname: string, query?: Record<string, string>, body?: any) => Promise<any>;
  export const configureBetsStorage: (adapter: { read?: () => string | object | null; write?: (json: string) => void }) => void;
  export const startScheduler: () => void;
}
