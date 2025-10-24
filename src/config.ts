export const DEFAULTS = {
  // Indicator
  stochLength: 12,
  smoothK: 3,
  smoothD: 3,
  oversold: 20,
  overbought: 80,

  // Pivots / divergence
  pivotLeft: 5,
  pivotRight: 1,
  priceTolerance: 0.012, // 1.2%
  minBarsBetweenPivots: 7,
  enableEarly: true,

  // Data
  period: "6mo",
  interval: "1d",

  // Rate limiting
  sleepMs: 500,
  concurrency: 5
};
