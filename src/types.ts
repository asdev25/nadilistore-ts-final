export type OHLCV = {
  t: number; // ms epoch
  o: number; h: number; l: number; c: number; v: number;
};

export type SignalType = "Bullish" | "Bearish" | "None";

export type ResultRow = {
  symbol: string;
  date: string;
  open: number; high: number; low: number; close: number; volume: number;
  stochK?: number; stochD?: number;
  signal: SignalType;
  details?: string;
};
