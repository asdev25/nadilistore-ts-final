// Bridge helper for using original defaults
import { computeStochDivPro as pureCompute, type Options, type DivergenceEvent } from "./stochDivPro.js";
export type { DivergenceEvent } from "./stochDivPro.js";

export function computeWithOriginalDefaults(
  open: number[], high: number[], low: number[], close: number[], volume: number[], time: number[]
): { stochKSeries: number[]; stochDSeries: number[]; events: DivergenceEvent[] } {
  const opt: Options = {
    stochLength: 12,
    smoothK: 3,
    smoothD: 3,
    oversold: 20,
    overbought: 80,
    pivotLeft: 5,
    pivotRight: 1,
    priceTolerance: 0.012,
    minBarsBetweenPivots: 7,
    enableEarly: true
  };
  return pureCompute(open, high, low, close, volume, time, opt);
}
