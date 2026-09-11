// Pomocnicze funkcje tekstowe (polska odmiana, formatowanie)

export function plural(n, forms) {
  // forms: ['mecz', 'mecze', 'meczów']
  const abs = Math.abs(n);
  if (abs === 1) return `${n} ${forms[0]}`;
  const last = abs % 10, tens = abs % 100;
  if (last >= 2 && last <= 4 && !(tens >= 12 && tens <= 14)) return `${n} ${forms[1]}`;
  return `${n} ${forms[2]}`;
}

export const pct = (x, digits = 0) => `${(x * 100).toFixed(digits)}%`;
export const f1 = (x) => (Math.round(x * 10) / 10).toFixed(1).replace('.', ',');
export const f2 = (x) => (Math.round(x * 100) / 100).toFixed(2).replace('.', ',');
export const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
export const round3 = (x) => Math.round(x * 1000) / 1000;

/** miejscownik: "w ostatnich 5 meczach" */
export const wMeczach = (n) => `${n} ${Math.abs(n) === 1 ? 'meczu' : 'meczach'}`;
/** dopełniacz po rzeczowniku ("seria 3 zwycięstw") */
export const gen = (n, form) => `${n} ${form}`;
export const lata = (n) => plural(n, ['rok', 'lata', 'lat']);

export const MECZE = ['mecz', 'mecze', 'meczów'];
export const WYGRANE = ['wygrana', 'wygrane', 'wygranych'];
export const GOLE = ['gol', 'gole', 'goli'];
export const ZWYC = ['zwycięstwo', 'zwycięstwa', 'zwycięstw'];
export const PORAZKI = ['porażka', 'porażki', 'porażek'];
export const REMISY = ['remis', 'remisy', 'remisów'];
export const SETY = ['set', 'sety', 'setów'];
export const PUNKTY = ['punkt', 'punkty', 'punktów'];
export const TYTULY = ['tytuł', 'tytuły', 'tytułów'];
