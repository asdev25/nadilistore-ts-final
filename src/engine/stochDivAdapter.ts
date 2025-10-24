import type { OHLCV } from "../types.js";
import { computeStochDivPro, type Options, type DivergenceEvent } from "./stochDivPro.js";

export type StochDivOutput = {
  stochK: number | undefined;
  stochD: number | undefined;
  signal: "Bullish" | "Bearish" | "None";
  annotations: DivergenceEvent[];
};

export function runOnSeries(series: OHLCV[], opts: Options): StochDivOutput {
  if (series.length < 50) {
    return { stochK: undefined, stochD: undefined, signal: "None", annotations: [] };
  }
  const open  = series.map(r => r.o);
  const high  = series.map(r => r.h);
  const low   = series.map(r => r.l);
  const close = series.map(r => r.c);
  const volume= series.map(r => r.v);
  const time  = series.map(r => r.t);

  const { stochKSeries, stochDSeries, events } =
    computeStochDivPro(open, high, low, close, volume, time, opts);

  const lastEvent = events.at(-1);
  let signal: "Bullish" | "Bearish" | "None" = "None";
  if (lastEvent?.kind === "bullish") signal = "Bullish";
  else if (lastEvent?.kind === "bearish") signal = "Bearish";

  return {
    stochK: stochKSeries.at(-1),
    stochD: stochDSeries.at(-1),
    signal,
    annotations: events
  };
}
