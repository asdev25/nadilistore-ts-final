import yahooFinance from "yahoo-finance2";
import type { OHLCV } from "../types.js";

export async function downloadYahoo(
  symbol: string,
  period = "6mo",
  interval: "1d" as "1d" | "1h" | "15m"
): Promise<OHLCV[]> {
  const res = await yahooFinance.chart(symbol, { range: period, interval });
  const candles = res?.quotes ?? [];
  return candles.map(c => ({
    t: new Date(c.date!).getTime(),
    o: Number(c.open!), h: Number(c.high!), l: Number(c.low!), c: Number(c.close!), v: Number(c.volume ?? 0)
  }));
}
