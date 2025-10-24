// Pure TypeScript implementation of Stoch Div Pro
export type DivergenceEvent = {
  kind: "bullish" | "bearish";
  isEarly: boolean;
  p1Bar: number; p1Price: number; p1Stoch: number;
  p2Bar: number; p2Price: number; p2Stoch: number;
  barsApart: number;
  priceDiffPct: number;
  stochDiff: number;
  note?: string;
};

export type Options = {
  stochLength: number;
  smoothK: number;
  smoothD: number;
  oversold: number;
  overbought: number;
  pivotLeft: number;
  pivotRight: number;
  priceTolerance: number;
  minBarsBetweenPivots: number;
  enableEarly: boolean;
};

function sma(arr: number[], len: number): number[] {
  const out = new Array(arr.length).fill(NaN);
  if (len <= 1) return arr.slice();
  let sum = 0;
  for (let i = 0; i < arr.length; i++) {
    sum += arr[i];
    if (i >= len) sum -= arr[i - len];
    if (i >= len - 1) out[i] = sum / len;
  }
  return out;
}

function rollingMin(arr: number[], len: number): number[] {
  const out = new Array(arr.length).fill(NaN);
  const dq: number[] = [];
  for (let i = 0; i < arr.length; i++) {
    while (dq.length && dq[0] <= i - len) dq.shift();
    while (dq.length && arr[dq[dq.length - 1]] >= arr[i]) dq.pop();
    dq.push(i);
    if (i >= len - 1) out[i] = arr[dq[0]];
  }
  return out;
}

function rollingMax(arr: number[], len: number): number[] {
  const out = new Array(arr.length).fill(NaN);
  const dq: number[] = [];
  for (let i = 0; i < arr.length; i++) {
    while (dq.length && dq[0] <= i - len) dq.shift();
    while (dq.length && arr[dq[dq.length - 1]] <= arr[i]) dq.pop();
    dq.push(i);
    if (i >= len - 1) out[i] = arr[dq[0]];
  }
  return out;
}

function stoch(high: number[], low: number[], close: number[], kLen: number, smoothK: number, smoothD: number) {
  const ll = rollingMin(low, kLen);
  const hh = rollingMax(high, kLen);
  const rawK = close.map((c, i) => {
    const denom = (hh[i] - ll[i]);
    if (!isFinite(denom) || denom === 0) return NaN;
    return ((c - ll[i]) / denom) * 100;
  });
  const k = sma(rawK, smoothK);
  const d = sma(k, smoothD);
  return { k, d };
}

function pivothigh(src: number[], left: number, right: number): (number | null)[] {
  const n = src.length;
  const out = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    const L = i - left;
    const R = i + right;
    if (L < 0 || R >= n) continue;
    let ok = true;
    for (let j = L; j <= R; j++) {
      if (src[i] < src[j] && j !== i) { ok = false; break; }
    }
    if (ok) out[i] = i;
  }
  return out;
}

function pivotlow(src: number[], left: number, right: number): (number | null)[] {
  const n = src.length;
  const out = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    const L = i - left;
    const R = i + right;
    if (L < 0 || R >= n) continue;
    let ok = true;
    for (let j = L; j <= R; j++) {
      if (src[i] > src[j] && j !== i) { ok = false; break; }
    }
    if (ok) out[i] = i;
  }
  return out;
}

export function computeStochDivPro(
  open: number[], high: number[], low: number[], close: number[], volume: number[], time: number[],
  opt: Options
): { stochKSeries: number[]; stochDSeries: number[]; events: DivergenceEvent[] } {
  const n = close.length;
  if ([open, high, low, close, volume, time].some(arr => arr.length !== n)) {
    throw new Error("Input arrays must have equal length");
  }
  if (n === 0) return { stochKSeries: [], stochDSeries: [], events: [] };

  const { stochLength, smoothK, smoothD, pivotLeft, pivotRight, priceTolerance, minBarsBetweenPivots } = opt;
  const { k: kSeries, d: dSeries } = stoch(high, low, close, stochLength, smoothK, smoothD);

  const ph = pivothigh(high, pivotLeft, pivotRight);
  const pl = pivotlow(low, pivotLeft, pivotRight);

  const events: DivergenceEvent[] = [];

  const highs: { bar: number, price: number, stoch: number }[] = [];
  const lows:  { bar: number, price: number, stoch: number }[] = [];
  for (let i = 0; i < n; i++) {
    if (ph[i] != null) highs.push({ bar: i, price: high[i], stoch: kSeries[i] });
    if (pl[i] != null) lows.push({  bar: i, price: low[i],  stoch: kSeries[i] });
  }

  const findPairs = (arr: {bar:number, price:number, stoch:number}[], bear: boolean) => {
    for (let j = 1; j < arr.length; j++) {
      const p2 = arr[j];
      for (let i = j - 1; i >= 0; i--) {
        const p1 = arr[i];
        const barsApart = p2.bar - p1.bar;
        if (barsApart < minBarsBetweenPivots) continue;
        if (barsApart > 60) break;

        const priceDiffPct = Math.abs(p2.price - p1.price) / p1.price;
        if (priceDiffPct > priceTolerance) continue;

        const stochDiff = p2.stoch - p1.stoch;
        if (bear) {
          if (!(stochDiff <= -10)) continue;
        } else {
          if (!(stochDiff >= 10)) continue;
        }

        events.push({
          kind: bear ? "bearish" : "bullish",
          isEarly: false,
          p1Bar: p1.bar, p1Price: p1.price, p1Stoch: p1.stoch,
          p2Bar: p2.bar, p2Price: p2.price, p2Stoch: p2.stoch,
          barsApart, priceDiffPct, stochDiff
        });
        break;
      }
    }
  };

  findPairs(highs, true);
  findPairs(lows, false);

  return { stochKSeries: kSeries, stochDSeries: dSeries, events };
}
