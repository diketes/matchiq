// Model Markowa dla tenisa: prawdopodobieństwo wygrania punktu na serwisie
// -> gem -> set (z tie-breakiem) -> mecz. Pozwala liczyć szanse z dowolnego stanu meczu.

/** P(serwujący wygra gema) przy p = P(wygrania punktu na własnym serwisie) */
export function gameWin(p) {
  const q = 1 - p;
  const deuce = (p * p) / (1 - 2 * p * q);
  return p ** 4 * (1 + 4 * q + 10 * q * q) + 20 * p ** 3 * q ** 3 * deuce;
}

/**
 * P(A wygra tie-break) – A serwuje pierwszy punkt.
 * a = P(A wygra punkt na swoim serwisie), b = P(A wygra punkt na serwisie B)
 */
export function tiebreakWin(a, b, target = 7) {
  const memo = new Map();
  const serverIsA = (n) => Math.floor((n + 1) / 2) % 2 === 0; // A: 0, 3,4, 7,8, ...
  const rec = (x, y) => {
    if (x >= target && x - y >= 2) return 1;
    if (y >= target && y - x >= 2) return 0;
    if (x >= target - 1 && y >= target - 1 && x === y) {
      // deuce w tie-breaku: para punktów (jeden serwis A, jeden B)
      const win = a * b, lose = (1 - a) * (1 - b);
      return win / (win + lose);
    }
    const key = x * 100 + y;
    if (memo.has(key)) return memo.get(key);
    const pA = serverIsA(x + y) ? a : b;
    const v = pA * rec(x + 1, y) + (1 - pA) * rec(x, y + 1);
    memo.set(key, v);
    return v;
  };
  return rec(0, 0);
}

/**
 * P(A wygra seta) ze stanu gemów (gA, gB), serverA = czy A serwuje w bieżącym gemie.
 * pA, pB – prawdopodobieństwa wygrania punktu na własnym serwisie.
 */
export function setWin(gA, gB, serverA, pA, pB, finalSetLong = false) {
  const gWinA = gameWin(pA);          // A wygrywa swój gem
  const gWinB = gameWin(pB);          // B wygrywa swój gem
  const memo = new Map();
  const rec = (x, y, sA) => {
    if (x >= 6 && x - y >= 2) return 1;
    if (y >= 6 && y - x >= 2) return 0;
    if (x === 6 && y === 6) {
      // tie-break: serwuje ten, kto ma serwować kolejny gem
      const a = pA, b = 1 - pB;
      const t = finalSetLong ? 10 : 7;
      return sA ? tiebreakWin(a, b, t) : 1 - tiebreakWin(1 - b, 1 - a, t);
    }
    const key = `${x},${y},${sA ? 1 : 0}`;
    if (memo.has(key)) return memo.get(key);
    const pWin = sA ? gWinA : 1 - gWinB;
    const v = pWin * rec(x + 1, y, !sA) + (1 - pWin) * rec(x, y + 1, !sA);
    memo.set(key, v);
    return v;
  };
  return rec(gA, gB, serverA);
}

/** P(A wygra seta) bez wiedzy kto serwuje (średnia) */
export function setWinAvg(gA, gB, pA, pB, finalSetLong = false) {
  return 0.5 * (setWin(gA, gB, true, pA, pB, finalSetLong) + setWin(gA, gB, false, pA, pB, finalSetLong));
}

/**
 * P(A wygra mecz) ze stanu: setsA, setsB (wygrane sety), bieżący set (gA, gB),
 * bestOf (3 lub 5). Zwraca też rozkład końcowych wyników w setach.
 */
export function matchWin({ setsA = 0, setsB = 0, gA = 0, gB = 0, bestOf = 3, pA, pB, inTiebreak = false, tbA = 0, tbB = 0 }) {
  const need = Math.ceil(bestOf / 2);
  const freshSet = setWinAvg(0, 0, pA, pB);
  const memo = new Map();
  // rozkład: klucz "a-b" -> prob
  const dist = {};
  const rec = (sa, sb, prob, pathFirst) => {
    if (sa === need) { dist[`${sa}-${sb}`] = (dist[`${sa}-${sb}`] || 0) + prob; return prob; }
    if (sb === need) { dist[`${sa}-${sb}`] = (dist[`${sa}-${sb}`] || 0) + prob; return 0; }
    let pSet;
    if (pathFirst) {
      const finalLong = bestOf === 5 && sa === need - 1 && sb === need - 1;
      if (inTiebreak) {
        // tie-break w toku: wynik punktowy nieznany dokładnie – stan przybliżony
        const a = pA, b = 1 - pB;
        const t = finalLong ? 10 : 7;
        pSet = tiebreakFrom(tbA, tbB, a, b, t);
      } else {
        pSet = setWinAvg(gA, gB, pA, pB, finalLong);
      }
    } else {
      pSet = freshSet;
    }
    const w = rec(sa + 1, sb, prob * pSet, false);
    rec(sa, sb + 1, prob * (1 - pSet), false);
    return w + 0; // suma zwracana niżej
  };
  rec(setsA, setsB, 1, true);
  let pWin = 0;
  for (const [k, v] of Object.entries(dist)) {
    const [a] = k.split('-').map(Number);
    if (a === need) pWin += v;
  }
  return { p: pWin, dist, setWinNow: inTiebreak ? null : setWinAvg(gA, gB, pA, pB) };
}

function tiebreakFrom(x, y, a, b, target) {
  // uśrednienie po tym, kto serwuje przy danym stanie
  const serverIsA = (n) => Math.floor((n + 1) / 2) % 2 === 0;
  const memo = new Map();
  const rec = (i, j) => {
    if (i >= target && i - j >= 2) return 1;
    if (j >= target && j - i >= 2) return 0;
    if (i >= target - 1 && j >= target - 1 && i === j) {
      const win = a * b, lose = (1 - a) * (1 - b);
      return win / (win + lose);
    }
    const key = i * 100 + j;
    if (memo.has(key)) return memo.get(key);
    const p = serverIsA(i + j) ? a : b;
    const v = p * rec(i + 1, j) + (1 - p) * rec(i, j + 1);
    memo.set(key, v);
    return v;
  };
  return rec(x, y);
}

/**
 * Dobiera przewagę punktową delta tak, aby P(A wygra mecz od 0:0) = target.
 * Zwraca { pA, pB } (prawdopodobieństwa wygrania punktu na własnym serwisie).
 */
export function solveServeEdge(target, base = 0.62, bestOf = 3) {
  let lo = -0.25, hi = 0.25;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    const p = matchWin({ bestOf, pA: base + mid, pB: base - mid }).p;
    if (p < target) lo = mid; else hi = mid;
  }
  const d = (lo + hi) / 2;
  return { pA: base + d, pB: base - d, delta: d };
}
