// PineTS conversion of "Stoch Div Pro Advanced Strength + Nison Patterns"
// Author: converted for WHAT KIND OF AI (GOLFR)
// Notes:
// - Faithfully ports the stochastic divergence detection, Nison candlestick pattern checks,
//   strength heuristics, optional repainting early signal, and rich tooltips.
// - PineTS cannot draw TradingView labels/lines directly; instead we return structured
//   objects in `annotations` that your UI (e.g., Lightweight Charts) can render.
// - "Early" signals may repaint (exactly like the Pine original when enabled).
// - All texts are in English.

import { PineTS, Providers } from "pinets";

// --- Helper types for returned annotations ---
export type DivergenceEvent = {
  kind: "bullish" | "bearish";
  isEarly: boolean;
  p1Bar: number; // bar_index of divergence start on the stochastic pane
  p2Bar: number; // bar_index of divergence end on the stochastic pane
  p1Stoch: number; // stochastic value at p1
  p2Stoch: number; // stochastic value at p2
  p1Price: number; // price at p1 (low for bull, high for bear)
  p2Price: number; // price at p2 (low for bull, high for bear)
  tooltips: {
    start: string; // tooltip for start label
    end?: string; // tooltip for end label when confirmed
    early?: string; // tooltip shown on early mark
  };
  meta: {
    strengthText: string;
    strengthEmoji: string;
    strengthScore0to9: number;
    nison?: { pattern: string; direction: string; score: number };
    pressureShort?: string; // like "⬆︎xx% / ⬇︎yy%"
    doublePattern?: "Double Top" | "Double Bottom";
  };
  guides: {
    showVLines: boolean;
    v1Bar?: number;
    v2Bar?: number;
  };
};

export type StrengthLabel = {
  bar: number;
  y: number; // plotted on stoch scale
  text: string; // emoji + line
  score: number; // 0..9
};

export type PressureLabel = {
  bar: number;
  y: number; // plotted on stoch scale
  text: string; // short pressure string
  up: number;
  down: number;
};

// === Create a PineTS instance (you can change provider/symbol/tf elsewhere) ===
export const pineTS = new PineTS(Providers.Binance, "BTCUSDT", "60", 1500);

export const runStochDivPro = async () => {
  const { result } = await pineTS.run((ctx) => {
    const { ta, input, data } = ctx;
    const { open, high, low, close, volume, time } = data;

    // ================= Inputs =================
    const grpStoch = "Stochastic & Levels Settings";
    const stochLength = input.number({ title: "Stochastic %K Length", defval: 12, group: grpStoch, min: 1, step: 1 });
    const smoothK = input.number({ title: "Stochastic %K Smoothing", defval: 3, group: grpStoch, min: 1, step: 1 });
    const smoothD = input.number({ title: "Stochastic %D Smoothing", defval: 3, group: grpStoch, min: 1, step: 1 });
    const stoch_overSold_level = input.number({ title: "Oversold Level", defval: 20, group: grpStoch });
    const stoch_overBought_level = input.number({ title: "Overbought Level", defval: 80, group: grpStoch });

    const grpPivot = "Pivot & Divergence Settings";
    const pivotLeft = input.number({ title: "Pivot Lookback Left", defval: 5, group: grpPivot, min: 1, step: 1 });
    const pivotRight = input.number({ title: "Pivot Lookback Right", defval: 1, group: grpPivot, min: 1, step: 1 });
    const priceTolerance = input.number({ title: "Price Tolerance for Tops/Bottoms (e.g., 0.012 = 1.2%)", defval: 0.012, group: grpPivot, step: 0.001 });
    const minBarsBetweenPivots = input.number({ title: "Min Bars Between Pivots (Default 7, Recommended 7-10)", defval: 7, group: grpPivot, min: 1, step: 1 });
    const enableFullEarlySignal = input.bool({ title: "⭐ Enable Full Early Signal (Repainting)", defval: true, group: grpPivot });

    const grpDouble = "Double Top/Bottom Label Settings";
    const showDoublePatternLabels = input.bool({ title: "Show Double Top/Bottom Labels", defval: true, group: grpDouble });
    const doubleTopLabelText = input.text({ title: "Double Top Label Text", defval: "Double Top", group: grpDouble });
    const doubleBottomLabelText = input.text({ title: "Double Bottom Label Text", defval: "Double Bottom", group: grpDouble });

    const grpSigStart = "Signal Label Settings (Start)";
    const waitForCrossover = input.bool({ title: "Wait for Crossover Confirmation?", defval: true, group: grpSigStart });
    const signalLabelYOffset = input.number({ title: "Signal Label Y Offset (Stochastic values)", defval: 0, group: grpSigStart });
    const signalLabelXOffset = input.number({ title: "Signal Label X Offset (Bars)", defval: 0, group: grpSigStart });
    const signalLabelText = input.text({ title: "Signal Label Text", defval: "⭐", group: grpSigStart });

    const grpEnd = "Signal Label Settings (Detailed End)";
    const endLabelYOffset = input.number({ title: "Detailed End Label Y Offset (Stochastic values)", defval: 5, group: grpEnd });
    const endLabelXOffset = input.number({ title: "Detailed End Label X Offset (Bars)", defval: 0, group: grpEnd });
    const endLabelText = input.text({ title: "Detailed End Label Text", defval: "🏁", group: grpEnd });

    const grpPress = "Buyer/Seller Pressure Label Settings";
    const showPressureLabel = input.bool({ title: "Show Pressure Label on Chart", defval: true, group: grpPress });
    const pressureLabelYOffset = input.number({ title: "Pressure Label Y Offset", defval: -15, group: grpPress });

    const grpStrength = "Divergence Strength Assessment Settings";
    const showStrengthInTooltip = input.bool({ title: "Show Strength Assessment in Tooltip", defval: true, group: grpStrength });
    const showStrengthLabel = input.bool({ title: "Show Separate Strength Label", defval: true, group: grpStrength });

    const grpNison = "Candle Patterns Settings (STEVE NISON)";
    const showCandlePatterns = input.bool({ title: "Show Candle Pattern Detection in Tooltip", defval: true, group: grpNison });
    const volumeLookback = input.number({ title: "Volume Moving Average Lookback for", defval: 20, group: grpNison });
    const trendLookback = input.number({ title: "Prior Trend Lookback for", defval: 10, group: grpNison });
    const showVolumeComparison = input.bool({ title: "Show Volume Comparison Between Pivots", defval: true, group: grpNison });

    // ================= Calculations =================
    const stochRaw = ta.stoch(close, high, low, stochLength);
    const k = ta.sma(stochRaw, smoothK);
    const d = ta.sma(k, smoothD);

    // --- pivot helpers (approximate ta.pivothigh/low behavior) ---
    const pivHighPrice = pivothigh(high, pivotLeft, pivotRight);
    const pivLowPrice = pivotlow(low, pivotLeft, pivotRight);

    // --- state to track last/prev pivots (bullish & bearish) ---
    let lastPhPrice: number | undefined, lastPhBar: number | undefined, lastPhStoch: number | undefined;
    let prevPhPrice: number | undefined, prevPhBar: number | undefined, prevPhStoch: number | undefined;
    let lastPlPrice: number | undefined, lastPlBar: number | undefined, lastPlStoch: number | undefined;
    let prevPlPrice: number | undefined, prevPlBar: number | undefined, prevPlStoch: number | undefined;

    // divergence pending flags
    let activeBullishDivergencePending = false;
    let activeBearishDivergencePending = false;

    // pending buffers
    let bull_div_p1_bar = NaN, bull_div_p1_stoch_val = NaN, bull_div_p2_bar = NaN, bull_div_p2_stoch_val = NaN;
    let bear_div_p1_bar = NaN, bear_div_p1_stoch_val = NaN, bear_div_p2_bar = NaN, bear_div_p2_stoch_val = NaN;

    // outputs to collect
    const annotations: DivergenceEvent[] = [];
    const strengthLabels: StrengthLabel[] = [];
    const pressureLabels: PressureLabel[] = [];

    // iterate all bars forward (PineTS provides vectors; we loop to emulate bar-by-bar logic)
    const n = close.length;

    // util lambdas translated from Pine functions
    const isBullish = (i: number) => close[i] > open[i];
    const isBearish = (i: number) => close[i] < open[i];
    const bodySize = (i: number) => Math.abs(close[i] - open[i]);
    const upperShadow = (i: number) => high[i] - Math.max(open[i], close[i]);
    const lowerShadow = (i: number) => Math.min(open[i], close[i]) - low[i];
    const candleRange = (i: number) => high[i] - low[i];
    const isDojiBody = (i: number) => candleRange(i) > 0 && bodySize(i) <= candleRange(i) * 0.1;

    const checkPriorTrend = (i: number, lookback: number, direction: "up" | "down") => {
      const start = Math.max(0, i - lookback);
      const isTrend = direction === "up" ? close[i - 1] > close[start] : close[i - 1] < close[start];
      return isTrend;
    };

    // --- Nison detections (at current bar i) ---
    const nison = (i: number) => {
      const up = (lb: number) => checkPriorTrend(i, lb, "up");
      const down = (lb: number) => checkPriorTrend(i, lb, "down");

      const cond = {
        hammer: down(trendLookback) && lowerShadow(i) >= 2 * bodySize(i) && upperShadow(i) < bodySize(i) && bodySize(i) > 0,
        invertedHammer: down(trendLookback) && upperShadow(i) >= 2 * bodySize(i) && lowerShadow(i) < bodySize(i) && bodySize(i) > 0,
        bullEngulf: down(trendLookback) && isBearish(i - 1) && isBullish(i) && close[i] > open[i - 1] && open[i] < close[i - 1],
        piercing: down(trendLookback) && isBearish(i - 1) && isBullish(i) && open[i] < close[i - 1] && close[i] > (open[i - 1] + close[i - 1]) / 2 && close[i] < open[i - 1],
        morningStar: down(trendLookback) && isBearish(i - 2) && bodySize(i - 2) > bodySize(i - 1) && Math.min(open[i - 1], close[i - 1]) < close[i - 2] && isBullish(i) && close[i] > (open[i - 2] + close[i - 2]) / 2,
        threeWhite: down(trendLookback) && isBullish(i - 2) && isBullish(i - 1) && isBullish(i) && close[i - 1] > close[i - 2] && close[i] > close[i - 1] && open[i - 1] > open[i - 2] && open[i - 1] < close[i - 2] && open[i] > open[i - 1] && open[i] < close[i - 1],
        bullHarami: down(trendLookback) && isBearish(i - 1) && isBullish(i) && open[i] > close[i - 1] && close[i] < open[i - 1],
        hangingMan: up(trendLookback) && lowerShadow(i) >= 2 * bodySize(i) && upperShadow(i) < bodySize(i) && bodySize(i) > 0,
        shootingStar: up(trendLookback) && upperShadow(i) >= 2 * bodySize(i) && lowerShadow(i) < bodySize(i) && bodySize(i) > 0,
        bearEngulf: up(trendLookback) && isBullish(i - 1) && isBearish(i) && close[i] < open[i - 1] && open[i] > close[i - 1],
        darkCloud: up(trendLookback) && isBullish(i - 1) && isBearish(i) && open[i] > close[i - 1] && close[i] < (open[i - 1] + close[i - 1]) / 2 && close[i] > open[i - 1],
        eveningStar: up(trendLookback) && isBullish(i - 2) && bodySize(i - 2) > bodySize(i - 1) && Math.max(open[i - 1], close[i - 1]) > close[i - 2] && isBearish(i) && close[i] < (open[i - 2] + close[i - 2]) / 2,
        threeBlack: up(trendLookback) && isBearish(i - 2) && isBearish(i - 1) && isBearish(i) && close[i - 1] < close[i - 2] && close[i] < close[i - 1] && open[i - 1] < open[i - 2] && open[i - 1] > close[i - 2] && open[i] < open[i - 1] && open[i] > close[i - 1],
        bearHarami: up(trendLookback) && isBullish(i - 1) && isBearish(i) && open[i] < close[i - 1] && close[i] > open[i - 1],
        doji: isDojiBody(i),
        haramiCross: (up(trendLookback) || down(trendLookback)) && bodySize(i - 1) > bodySize(i) * 3 && isDojiBody(i) && high[i] < high[i - 1] && low[i] > low[i - 1],
      };

      let pattern = "";
      let dir = "";
      let base = 0;
      if (cond.threeWhite) { pattern = "Three White Soldiers"; dir = "Long"; base = 90; }
      else if (cond.threeBlack) { pattern = "Three Black Crows"; dir = "Short"; base = 90; }
      else if (cond.morningStar) { pattern = "Morning Star"; dir = "Long"; base = 85; }
      else if (cond.eveningStar) { pattern = "Evening Star"; dir = "Short"; base = 85; }
      else if (cond.bullEngulf) { pattern = "Bullish Engulfing"; dir = "Long"; base = 75; }
      else if (cond.bearEngulf) { pattern = "Bearish Engulfing"; dir = "Short"; base = 75; }
      else if (cond.piercing) { pattern = "Piercing Pattern"; dir = "Long"; base = 70; }
      else if (cond.darkCloud) { pattern = "Dark Cloud Cover"; dir = "Short"; base = 70; }
      else if (cond.haramiCross) { pattern = "Harami Cross"; dir = isBearish(i - 1) ? "Long (Potential)" : "Short (Potential)"; base = 65; }
      else if (cond.bullHarami) { pattern = "Bullish Harami"; dir = "Long (Requires Confirmation)"; base = 60; }
      else if (cond.bearHarami) { pattern = "Bearish Harami"; dir = "Short (Requires Confirmation)"; base = 60; }
      else if (cond.hammer) { pattern = "Hammer"; dir = "Long"; base = 50; }
      else if (cond.hangingMan) { pattern = "Hanging Man"; dir = "Short"; base = 50; }
      else if (cond.invertedHammer) { pattern = "Inverted Hammer"; dir = "Long (Requires Confirmation)"; base = 45; }
      else if (cond.shootingStar) { pattern = "Shooting Star"; dir = "Short"; base = 45; }
      else if (cond.doji) { pattern = "Doji"; dir = "Neutral - Potential Reversal"; base = 30; }

      let finalScore = base;
      if (base > 0) {
        const kVal = k[i];
        if ((dir.startsWith("Long") && kVal < stoch_overSold_level) || (dir.startsWith("Short") && kVal > stoch_overBought_level))
          finalScore += 15;
        const avgVol = ta.sma(volume, volumeLookback)[i];
        if (volume[i] > avgVol * 1.5) finalScore += 15; else if (volume[i] > avgVol) finalScore += 5;
        finalScore = Math.min(100, finalScore);
      }
      return { pattern, dir, finalScore };
    };

    const getCandleDescription = (i: number) => {
      const b = bodySize(i);
      const r = candleRange(i);
      const u = upperShadow(i);
      const l = lowerShadow(i);
      const green = close[i] > open[i];
      const red = close[i] < open[i];
      const isDoji = r > 0 ? b <= r * 0.1 : false;
      let desc = "";
      if (isDoji) {
        desc = "Doji";
        if (u > b * 2 && l > b * 2) desc += " (Long-Legged)";
        else if (u > b * 3 && l < b * 0.5) desc += " (Gravestone)";
        else if (l > b * 3 && u < b * 0.5) desc += " (Dragonfly)";
      } else if (green) {
        desc = "Green Candle";
        if (r > 0 && b > r * 0.7 && l < b * 0.2 && u < b * 0.2) desc += " (Full/Marubozu)";
      } else if (red) {
        desc = "Red Candle";
        if (r > 0 && b > r * 0.7 && l < b * 0.2 && u < b * 0.2) desc += " (Full/Marubozu)";
      } else {
        desc = "Unchanged Candle (Open=Close)";
      }
      let pressureDesc = "";
      let pressureShort = "";
      if (r > 0) {
        const buying = ((close[i] - low[i]) / r) * 100;
        const selling = ((high[i] - close[i]) / r) * 100;
        pressureDesc = `Buyers: ~${buying.toFixed(0)}%, Sellers: ~${selling.toFixed(0)}%`;
        pressureShort = `⬆️${buying.toFixed(0)}% / ⬇️${selling.toFixed(0)}%`;
        if (close[i] === high[i] && close[i] !== low[i]) pressureDesc = "Strong Buying Pressure (Close at High)";
        else if (close[i] === low[i] && close[i] !== high[i]) pressureDesc = "Strong Selling Pressure (Close at Low)";
      }
      return { desc, pressureDesc, pressureShort };
    };

    const getStrengthAssessment = (score: number) => {
      let text = ""; let emoji = "";
      if (score >= 8) { text = "Very Strong Divergence"; emoji = "🔥"; }
      else if (score >= 6) { text = "Strong Divergence"; emoji = "💪"; }
      else if (score >= 4) { text = "Medium-High Divergence"; emoji = "⚡"; }
      else if (score >= 2) { text = "Medium Divergence"; emoji = "📊"; }
      else { text = "Weak Divergence"; emoji = "⚠️"; }
      return { text, emoji };
    };

    const calculateStrength = (i: number, isBear: boolean, p1_stoch: number, p2_stoch: number, kVal: number) => {
      let s = 0;
      if (isBear) {
        if (p1_stoch > (stoch_overBought_level + 5)) s += 3; else if (p1_stoch > stoch_overBought_level) s += 2; else if (p1_stoch > (stoch_overBought_level - 10)) s += 1;
        const fall = p1_stoch - p2_stoch; if (fall > 25) s += 3; else if (fall > 15) s += 2; else if (fall > 5) s += 1;
        const kSlope = kVal - k[i - 1]; if (kSlope < -7) s += 3; else if (kSlope < -3) s += 2; else if (kSlope < -1) s += 1;
      } else {
        if (p1_stoch < (stoch_overSold_level - 5)) s += 3; else if (p1_stoch < stoch_overSold_level) s += 2; else if (p1_stoch < (stoch_overSold_level + 10)) s += 1;
        const rise = p2_stoch - p1_stoch; if (rise > 25) s += 3; else if (rise > 15) s += 2; else if (rise > 5) s += 1;
        const kSlope = kVal - k[i - 1]; if (kSlope > 7) s += 3; else if (kSlope > 3) s += 2; else if (kSlope > 1) s += 1;
      }
      const { text, emoji } = getStrengthAssessment(s);
      return { text, emoji, score: s };
    };

    // === Main bar loop ===
    for (let i = 0; i < n; i++) {
      // update confirmed pivots when they become known
      if (!isNaN(pivHighPrice[i])) {
        prevPhPrice = lastPhPrice; prevPhBar = lastPhBar; prevPhStoch = lastPhStoch;
        lastPhPrice = high[i - pivotRight]; lastPhBar = (i - pivotRight); lastPhStoch = k[i - pivotRight];
      }
      if (!isNaN(pivLowPrice[i])) {
        prevPlPrice = lastPlPrice; prevPlBar = lastPlBar; prevPlStoch = lastPlStoch;
        lastPlPrice = low[i - pivotRight]; lastPlBar = (i - pivotRight); lastPlStoch = k[i - pivotRight];
      }

      // Historical divergence checks (bearish at highs)
      if (lastPhBar !== undefined && prevPhBar !== undefined && (lastPhBar - prevPhBar) >= minBarsBetweenPivots) {
        const priceCondTop = Math.abs((lastPhPrice! - prevPhPrice!) / (prevPhPrice!)) <= priceTolerance;
        const stochCondTop = (lastPhStoch! < prevPhStoch!);
        if (priceCondTop && stochCondTop) {
          activeBearishDivergencePending = true;
          bear_div_p1_bar = prevPhBar!; bear_div_p1_stoch_val = prevPhStoch!;
          bear_div_p2_bar = lastPhBar!; bear_div_p2_stoch_val = lastPhStoch!;
        }
      }

      // Historical divergence checks (bullish at lows)
      if (lastPlBar !== undefined && prevPlBar !== undefined && (lastPlBar - prevPlBar) >= minBarsBetweenPivots) {
        const priceCondBottom = Math.abs((lastPlPrice! - prevPlPrice!) / (prevPlPrice!)) <= priceTolerance;
        const stochCondBottom = (lastPlStoch! > prevPlStoch!);
        if (priceCondBottom && stochCondBottom) {
          activeBullishDivergencePending = true;
          bull_div_p1_bar = prevPlBar!; bull_div_p1_stoch_val = prevPlStoch!;
          bull_div_p2_bar = lastPlBar!; bull_div_p2_stoch_val = lastPlStoch!;
        }
      }

      // "Early" detection on the last bar only (to mimic barstate.islast)
      const isLast = (i === n - 1);
      if (isLast && enableFullEarlySignal) {
        // Potential high now?
        const isPotentialHigh = high[i] === highest(high, pivotLeft + 1, i);
        if (isPotentialHigh && lastPhBar !== undefined && (i - lastPhBar) >= minBarsBetweenPivots) {
          const priceCondEarlyTop = Math.abs((high[i] - lastPhPrice!) / lastPhPrice!) <= priceTolerance;
          const stochCondEarlyTop = k[i] < (lastPhStoch!);
          if (priceCondEarlyTop && stochCondEarlyTop) {
            const kSlopeNow = i > 0 ? (k[i] - k[i - 1]) : 0;
            const virtualAngleDeg = Math.atan(kSlopeNow) * 180 / Math.PI;
            const { text: sText, emoji: sEmoji, score: sScore } = calculateStrength(i, true, lastPhStoch!, k[i], k[i]);
            const signalStrength = Math.min(10, Math.max(1, Math.round((sScore / 9) * 9) + 1));
            // consecutive bars over OB from lastPhBar backwards
            let daysInOB = 0; for (let b = lastPhBar; b >= Math.max(0, lastPhBar - 100); b--) { if (k[b] > stoch_overBought_level) daysInOB++; else break; }
            // nison + pressure
            const ni = nison(i);
            const { pressureShort } = getCandleDescription(i);
            const startStr = `Stochastic at Divergence Start: ${lastPhStoch!.toFixed(2)}\n` +
              `Current K Slope: ${kSlopeNow.toFixed(2)} (Angle: ${virtualAngleDeg.toFixed(2)}°)\n` +
              `Potential Strength (1-10): ${signalStrength}\n` +
              (showStrengthInTooltip ? `Strength Assessment: ${sEmoji} ${sText}\nRaw Score: ${sScore.toFixed(1)}/9\n` : "") +
              `Consecutive Days Above ${stoch_overBought_level.toFixed(0)}: ${daysInOB}\n` +
              `Divergence Start Date: ${new Date(time[lastPhBar]).toISOString()}\n` +
              `Potential Divergence (Repaints)`;

            const earlyTip = (() => {
              // Compute a pseudo "required stoch raw" for cross; Pine version derives from moving-average math
              const targetD = d[i];
              const requiredRaw = requiredRawForCross(targetD, smoothK, stochRaw, i);
              let convergence = "N/A"; let requiredStr = "N/A";
              if (!Number.isNaN(requiredRaw) && !Number.isNaN(stochRaw[i])) {
                if (true) { // bearish branch
                  const conv = requiredRaw <= 0 ? 100 : Math.max(0, 100 * (1 - stochRaw[i] / requiredRaw));
                  convergence = `${conv.toFixed(2)}%`;
                  requiredStr = `< ${requiredRaw.toFixed(2)}`;
                }
              }
              return (
                `Potential ${"Bearish"} Divergence:\n\n` +
                `Potential Strength: ${sEmoji} ${sText}\n` +
                (ni.pattern ? `\n--- STEVE NISON PATTERN ---\nPattern Name: ${ni.pattern}\nConfidence Score: ${ni.finalScore.toFixed(0)}/100\nSignal: ${ni.dir}\n----------------------------\n` : "") +
                (pressureShort ? `\nBuying/Selling Pressure: ${pressureShort}\n` : "") +
                `---------------------------------------\n` +
                `Crossover Convergence: ${convergence}\n` +
                `Stoch Target for Cross: ${requiredStr}\n\n` +
                `Warning: This signal may disappear if the price sets a new high/low.`
              );
            })();

            annotations.push({
              kind: "bearish", isEarly: true,
              p1Bar: lastPhBar!, p2Bar: i,
              p1Stoch: lastPhStoch!, p2Stoch: k[i],
              p1Price: lastPhPrice!, p2Price: high[i],
              tooltips: { start: startStr, early: earlyTip },
              meta: {
                strengthText: sText, strengthEmoji: sEmoji, strengthScore0to9: sScore,
                nison: ni.pattern ? { pattern: ni.pattern, direction: ni.dir, score: ni.finalScore } : undefined,
                pressureShort,
                doublePattern: showDoublePatternLabels ? "Double Top" : undefined,
              },
              guides: { showVLines: true, v1Bar: lastPhBar!, v2Bar: i },
            });

            if (showPressureLabel && pressureShort) {
              pressureLabels.push({ bar: i, y: k[i] + pressureLabelYOffset, text: pressureShort, up: 0, down: 0 });
            }
          }
        }

        // Potential low now?
        const isPotentialLow = low[i] === lowest(low, pivotLeft + 1, i);
        if (isPotentialLow && lastPlBar !== undefined && (i - lastPlBar) >= minBarsBetweenPivots) {
          const priceCondEarlyBot = Math.abs((low[i] - lastPlPrice!) / lastPlPrice!) <= priceTolerance;
          const stochCondEarlyBot = k[i] > (lastPlStoch!);
          if (priceCondEarlyBot && stochCondEarlyBot) {
            const kSlopeNow = i > 0 ? (k[i] - k[i - 1]) : 0;
            const virtualAngleDeg = Math.atan(kSlopeNow) * 180 / Math.PI;
            const { text: sText, emoji: sEmoji, score: sScore } = calculateStrength(i, false, lastPlStoch!, k[i], k[i]);
            const signalStrength = Math.min(10, Math.max(1, Math.round((sScore / 9) * 9) + 1));
            let daysInOS = 0; for (let b = lastPlBar; b >= Math.max(0, lastPlBar - 100); b--) { if (k[b] < stoch_overSold_level) daysInOS++; else break; }
            const ni = nison(i);
            const { pressureShort } = getCandleDescription(i);
            const startStr = `Stochastic at Divergence Start: ${lastPlStoch!.toFixed(2)}\n` +
              `Current K Slope: ${kSlopeNow.toFixed(2)} (Angle: ${virtualAngleDeg.toFixed(2)}°)\n` +
              `Potential Strength (1-10): ${signalStrength}\n` +
              (showStrengthInTooltip ? `Strength Assessment: ${sEmoji} ${sText}\nRaw Score: ${sScore.toFixed(1)}/9\n` : "") +
              `Consecutive Days Below ${stoch_overSold_level.toFixed(0)}: ${daysInOS}\n` +
              `Divergence Start Date: ${new Date(time[lastPlBar]).toISOString()}\n` +
              `Potential Divergence (Repaints)`;

            const earlyTip = (() => {
              const targetD = d[i];
              const requiredRaw = requiredRawForCross(targetD, smoothK, stochRaw, i);
              let convergence = "N/A"; let requiredStr = "N/A";
              if (!Number.isNaN(requiredRaw) && !Number.isNaN(stochRaw[i])) {
                // bullish branch
                const conv = (requiredRaw >= 100 || requiredRaw <= 0) ? 100 : Math.max(0, 100 * (stochRaw[i] / requiredRaw));
                convergence = `${conv.toFixed(2)}%`;
                requiredStr = `> ${requiredRaw.toFixed(2)}`;
              }
              return (
                `Potential ${"Bullish"} Divergence:\n\n` +
                `Potential Strength: ${sEmoji} ${sText}\n` +
                (ni.pattern ? `\n--- STEVE NISON PATTERN ---\nPattern Name: ${ni.pattern}\nConfidence Score: ${ni.finalScore.toFixed(0)}/100\nSignal: ${ni.dir}\n----------------------------\n` : "") +
                (pressureShort ? `\nBuying/Selling Pressure: ${pressureShort}\n` : "") +
                `---------------------------------------\n` +
                `Crossover Convergence: ${convergence}\n` +
                `Stoch Target for Cross: ${requiredStr}\n\n` +
                `Warning: This signal may disappear if the price sets a new high/low.`
              );
            })();

            annotations.push({
              kind: "bullish", isEarly: true,
              p1Bar: lastPlBar!, p2Bar: i,
              p1Stoch: lastPlStoch!, p2Stoch: k[i],
              p1Price: lastPlPrice!, p2Price: low[i],
              tooltips: { start: startStr, early: earlyTip },
              meta: {
                strengthText: sText, strengthEmoji: sEmoji, strengthScore0to9: sScore,
                nison: ni.pattern ? { pattern: ni.pattern, direction: ni.dir, score: ni.finalScore } : undefined,
                pressureShort,
                doublePattern: showDoublePatternLabels ? "Double Bottom" : undefined,
              },
              guides: { showVLines: true, v1Bar: lastPlBar!, v2Bar: i },
            });

            if (showPressureLabel && pressureShort) {
              pressureLabels.push({ bar: i, y: k[i] + pressureLabelYOffset, text: pressureShort, up: 0, down: 0 });
            }
          }
        }
      }

      // crossover checks for confirming pending divergences
      const bullCross = i > 0 && crossOver(k[i - 1], k[i], d[i - 1], d[i]);
      const bearCross = i > 0 && crossUnder(k[i - 1], k[i], d[i - 1], d[i]);

      // Confirm Bullish
      if (activeBullishDivergencePending && (!waitForCrossover || bullCross) && i >= bull_div_p2_bar) {
        const kSlope = i > 0 ? k[i] - k[i - 1] : 0; const angle = Math.atan(kSlope) * 180 / Math.PI;
        // compute strength using p1 and stoch at p2 bar index
        const stochAtDivEnd = k[i - (i - bull_div_p2_bar)];
        const { text: sText, emoji: sEmoji, score: sScore } = calculateStrength(i, false, bull_div_p1_stoch_val, stochAtDivEnd, k[i]);
        const signalStrength = Math.min(10, Math.max(1, Math.round((sScore / 9) * 9) + 1));
        // days below OS from p1 backward
        let daysInOS = 0; for (let b = bull_div_p1_bar; b >= Math.max(0, bull_div_p1_bar - 100); b--) { if (k[b] < stoch_overSold_level) daysInOS++; else break; }
        // Candle at end
        const eBar = bull_div_p2_bar; const ni = nison(eBar);
        const { desc, pressureDesc, pressureShort } = getCandleDescription(eBar);
        const startTip = `Stochastic at Divergence Start: ${bull_div_p1_stoch_val.toFixed(2)}\n` +
          `K Slope at Crossover: ${kSlope.toFixed(2)} (Angle: ${angle.toFixed(2)}°)\n` +
          `Signal Strength (1-10): ${signalStrength}\n` +
          (showStrengthInTooltip ? `Strength Assessment: ${sEmoji} ${sText}\nRaw Score: ${sScore.toFixed(1)}/9\n` : "") +
          `Consecutive Days Below ${stoch_overSold_level.toFixed(0)}: ${daysInOS}\n` +
          `Divergence Start Date: ${new Date(time[bull_div_p1_bar]).toISOString()}\n` +
          `Signal Date (Crossover): ${new Date(time[i]).toISOString()}`;

        let endTip = `Divergence End (Signal Candle):\nCandle Description: ${desc}\n`;
        if (showCandlePatterns && ni.pattern) {
          endTip += `\n--- STEVE NISON PATTERN ---\nPattern Name: ${ni.pattern}\nConfidence Score: ${ni.finalScore.toFixed(0)}/100\nSignal: ${ni.dir}\n----------------------------\n\n`;
        }
        endTip += `Volume: ${volume[eBar].toFixed(0)}\n`;
        if (showVolumeComparison) {
          const v1 = volume[bull_div_p1_bar]; const v2 = volume[bull_div_p2_bar];
          const chg = v1 > 0 ? ((v2 - v1) / v1) * 100 : 0; const s = (chg >= 0 ? "+" : "") + chg.toFixed(2) + "%";
          endTip += `Volume Change Between Pivots: ${s}\n`;
        }
        endTip += `Buying/Selling Pressure: ${pressureDesc}\n` +
          `Divergence End Date: ${new Date(time[eBar]).toISOString()}`;

        annotations.push({
          kind: "bullish", isEarly: false,
          p1Bar: bull_div_p1_bar, p2Bar: bull_div_p2_bar,
          p1Stoch: bull_div_p1_stoch_val, p2Stoch: bull_div_p2_stoch_val,
          p1Price: low[bull_div_p1_bar], p2Price: low[bull_div_p2_bar],
          tooltips: { start: startTip, end: endTip },
          meta: {
            strengthText: sText, strengthEmoji: sEmoji, strengthScore0to9: sScore,
            nison: ni.pattern ? { pattern: ni.pattern, direction: ni.dir, score: ni.finalScore } : undefined,
            pressureShort,
            doublePattern: showDoublePatternLabels ? "Double Bottom" : undefined,
          },
          guides: { showVLines: true, v1Bar: bull_div_p1_bar, v2Bar: bull_div_p2_bar },
        });

        if (showStrengthLabel) {
          strengthLabels.push({ bar: bull_div_p1_bar - 2, y: bull_div_p1_stoch_val - 8, text: `${sEmoji}\n${sText}` , score: sScore });
        }
        if (showPressureLabel && pressureShort) {
          pressureLabels.push({ bar: bull_div_p2_bar, y: bull_div_p2_stoch_val + pressureLabelYOffset, text: pressureShort, up: 0, down: 0 });
        }
        activeBullishDivergencePending = false;
      }

      // Confirm Bearish
      if (activeBearishDivergencePending && (!waitForCrossover || bearCross) && i >= bear_div_p2_bar) {
        const kSlope = i > 0 ? k[i] - k[i - 1] : 0; const angle = Math.atan(kSlope) * 180 / Math.PI;
        const stochAtDivEnd = k[i - (i - bear_div_p2_bar)];
        const { text: sText, emoji: sEmoji, score: sScore } = calculateStrength(i, true, bear_div_p1_stoch_val, stochAtDivEnd, k[i]);
        const signalStrength = Math.min(10, Math.max(1, Math.round((sScore / 9) * 9) + 1));
        let daysInOB = 0; for (let b = bear_div_p1_bar; b >= Math.max(0, bear_div_p1_bar - 100); b--) { if (k[b] > stoch_overBought_level) daysInOB++; else break; }
        const eBar = bear_div_p2_bar; const ni = nison(eBar);
        const { desc, pressureDesc, pressureShort } = getCandleDescription(eBar);
        const startTip = `Stochastic at Divergence Start: ${bear_div_p1_stoch_val.toFixed(2)}\n` +
          `K Slope at Crossover: ${kSlope.toFixed(2)} (Angle: ${angle.toFixed(2)}°)\n` +
          `Signal Strength (1-10): ${signalStrength}\n` +
          (showStrengthInTooltip ? `Strength Assessment: ${sEmoji} ${sText}\nRaw Score: ${sScore.toFixed(1)}/9\n` : "") +
          `Consecutive Days Above ${stoch_overBought_level.toFixed(0)}: ${daysInOB}\n` +
          `Divergence Start Date: ${new Date(time[bear_div_p1_bar]).toISOString()}\n` +
          `Signal Date (Crossover): ${new Date(time[i]).toISOString()}`;

        let endTip = `Divergence End (Signal Candle):\nCandle Description: ${desc}\n`;
        if (showCandlePatterns && ni.pattern) {
          endTip += `\n--- STEVE NISON PATTERN ---\nPattern Name: ${ni.pattern}\nConfidence Score: ${ni.finalScore.toFixed(0)}/100\nSignal: ${ni.dir}\n----------------------------\n\n`;
        }
        endTip += `Volume: ${volume[eBar].toFixed(0)}\n`;
        if (showVolumeComparison) {
          const v1 = volume[bear_div_p1_bar]; const v2 = volume[bear_div_p2_bar];
          const chg = v1 > 0 ? ((v2 - v1) / v1) * 100 : 0; const s = (chg >= 0 ? "+" : "") + chg.toFixed(2) + "%";
          endTip += `Volume Change Between Pivots: ${s}\n`;
        }
        endTip += `Buying/Selling Pressure: ${pressureDesc}\n` +
          `Divergence End Date: ${new Date(time[eBar]).toISOString()}`;

        annotations.push({
          kind: "bearish", isEarly: false,
          p1Bar: bear_div_p1_bar, p2Bar: bear_div_p2_bar,
          p1Stoch: bear_div_p1_stoch_val, p2Stoch: bear_div_p2_stoch_val,
          p1Price: high[bear_div_p1_bar], p2Price: high[bear_div_p2_bar],
          tooltips: { start: startTip, end: endTip },
          meta: {
            strengthText: sText, strengthEmoji: sEmoji, strengthScore0to9: sScore,
            nison: ni.pattern ? { pattern: ni.pattern, direction: ni.dir, score: ni.finalScore } : undefined,
            pressureShort,
            doublePattern: showDoublePatternLabels ? "Double Top" : undefined,
          },
          guides: { showVLines: true, v1Bar: bear_div_p1_bar, v2Bar: bear_div_p2_bar },
        });

        if (showStrengthLabel) {
          strengthLabels.push({ bar: bear_div_p1_bar - 2, y: bear_div_p1_stoch_val + 8, text: `${sEmoji}\n${sText}` , score: sScore });
        }
        if (showPressureLabel && pressureShort) {
          pressureLabels.push({ bar: bear_div_p2_bar, y: bear_div_p2_stoch_val + pressureLabelYOffset, text: pressureShort, up: 0, down: 0 });
        }
        activeBearishDivergencePending = false;
      }
    }

    // === Return PineTS result ===
    return {
      plots: {
        k, d,
        overbought: Array(n).fill(stoch_overBought_level),
        oversold: Array(n).fill(stoch_overSold_level),
        mid: Array(n).fill(50),
      },
      annotations,
      strengthLabels,
      pressureLabels,
      meta: {
        signalLabel: { text: signalLabelText, xOffset: signalLabelXOffset, yOffset: signalLabelYOffset },
        endLabel: { text: endLabelText, xOffset: endLabelXOffset, yOffset: endLabelYOffset },
      },
    };
  });

  return result;
};

// ===== Utility functions =====

// Simple pivot detection: returns array with confirmed pivot price at the bar where it becomes confirmed, else NaN.
function pivothigh(series: number[], left: number, right: number) {
  const out = new Array(series.length).fill(NaN);
  for (let i = left + right; i < series.length; i++) {
    const p = i - right; // pivot candidate index
    let isPivot = true;
    for (let j = 1; j <= left; j++) if (series[p] <= series[p - j]) { isPivot = false; break; }
    for (let j = 1; j <= right; j++) if (series[p] < series[p + j]) { isPivot = false; break; }
    if (isPivot) out[i] = series[p]; // known only when right bars have passed
  }
  return out;
}

function pivotlow(series: number[], left: number, right: number) {
  const out = new Array(series.length).fill(NaN);
  for (let i = left + right; i < series.length; i++) {
    const p = i - right;
    let isPivot = true;
    for (let j = 1; j <= left; j++) if (series[p] >= series[p - j]) { isPivot = false; break; }
    for (let j = 1; j <= right; j++) if (series[p] > series[p + j]) { isPivot = false; break; }
    if (isPivot) out[i] = series[p];
  }
  return out;
}

// Highest/lowest over last (len) bars that end at index i
function highest(series: number[], len: number, i: number) {
  const start = Math.max(0, i - len + 1);
  let h = -Infinity;
  for (let k = start; k <= i; k++) h = Math.max(h, series[k]);
  return h;
}
function lowest(series: number[], len: number, i: number) {
  const start = Math.max(0, i - len + 1);
  let l = +Infinity;
  for (let k = start; k <= i; k++) l = Math.min(l, series[k]);
  return l;
}

// Crossing helpers
function crossOver(prevA: number, currA: number, prevB: number, currB: number) {
  return prevA <= prevB && currA > currB;
}
function crossUnder(prevA: number, currA: number, prevB: number, currB: number) {
  return prevA >= prevB && currA < currB;
}

// Derived from Pine logic: compute required %K raw value that would yield current D after smoothing
// Here we approximate: D = SMA(K, smoothD) and K = SMA(raw, smoothK). We invert the last step only to
// obtain the single-step raw needed to force K to a target (d). This matches the Pine tooltip math intent.
function requiredRawForCross(targetD: number, smoothK: number, stochRaw: number[], i: number) {
  // approximate K target = targetD; K = SMA(raw, smoothK)
  if (smoothK <= 0) return NaN;
  let sumPrev = 0;
  for (let j = 1; j <= smoothK - 1; j++) {
    const idx = i - j; if (idx < 0) return NaN; sumPrev += stochRaw[idx];
  }
  const required = (targetD * smoothK) - sumPrev; // required new raw to achieve K == targetD
  return required;
}
