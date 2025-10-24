import { Command } from "commander";
import pLimit from "p-limit";
import { DEFAULTS } from "./config.js";
import { symbolsFromFile } from "./io/symbolsFromFile.js";
import { downloadYahoo } from "./io/downloadYahoo.js";
import { writeCsv } from "./io/writeCsv.js";
import { runOnSeries } from "./engine/stochDivAdapter.js";
import type { ResultRow } from "./types.js";

const program = new Command();

program
  .name("nadilistore-ts")
  .description("Stoch Div Pro scanner (TypeScript)")
  .option("--mode <pure|pine>", "engine mode", "pure")
  .option("--file <path>", "path to stocks.txt", "stocks.txt")
  .option("--period <range>", "data range", DEFAULTS.period)
  .option("--interval <tf>", "interval 1d|1h|15m", DEFAULTS.interval)
  .option("--out <csv>", "export CSV path", "")
  .parse(process.argv);

const opt = program.opts();

async function runPine() {
  console.log("Running PineTS demo mode...");
  try {
    const mod = await import("./engine/pine_port/stoch_div_pro_nison.js");
    if (typeof (mod as any).runStochDivPro !== "function") {
      console.error("runStochDivPro not found. Ensure your file exports it.");
      process.exit(1);
    }
    await (mod as any).runStochDivPro();
    console.log("PineTS demo finished.");
  } catch (e) {
    console.error("PineTS mode error:", (e as Error).message);
    console.error("Tip: npm i pinets  (and ensure your file compiles in ESM).");
    process.exit(1);
  }
}

async function runPure() {
  const symbols = symbolsFromFile(String(opt.file));
  if (symbols.length === 0) {
    console.error("No symbols found.");
    process.exit(1);
  }

  const limit = pLimit(DEFAULTS.concurrency);
  const tasks = symbols.map(sym => limit(async () => {
    try {
      const series = await downloadYahoo(sym, String(opt.period), String(opt.interval));
      if (series.length === 0) throw new Error("No data");
      const out = runOnSeries(series, {
        stochLength: DEFAULTS.stochLength,
        smoothK: DEFAULTS.smoothK,
        smoothD: DEFAULTS.smoothD,
        oversold: DEFAULTS.oversold,
        overbought: DEFAULTS.overbought,
        pivotLeft: DEFAULTS.pivotLeft,
        pivotRight: DEFAULTS.pivotRight,
        priceTolerance: DEFAULTS.priceTolerance,
        minBarsBetweenPivots: DEFAULTS.minBarsBetweenPivots,
        enableEarly: DEFAULTS.enableEarly
      });
      const last = series.at(-1)!;
      const row: ResultRow = {
        symbol: sym,
        date: new Date(last.t).toISOString().slice(0, 10),
        open: last.o, high: last.h, low: last.l, close: last.c, volume: last.v,
        stochK: out.stochK, stochD: out.stochD,
        signal: out.signal,
        details: out.annotations.at(-1) ? JSON.stringify(out.annotations.at(-1)) : undefined
      };
      return row;
    } catch (e) {
      return {
        symbol: sym, date: "", open: NaN, high: NaN, low: NaN, close: NaN, volume: NaN,
        signal: "None" as const, details: (e as Error).message
      };
    }
  }));

  const results = (await Promise.all(tasks)).filter(Boolean) as ResultRow[];
  console.table(results.slice(0, 10));

  if (opt.out) {
    await writeCsv(results, String(opt.out));
    console.log(`Saved CSV → ${opt.out}`);
  }
}

(async () => {
  if (String(opt.mode) === "pine") await runPine();
  else await runPure();
})();
