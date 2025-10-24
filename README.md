# NadiliStore TS Scanner

A TypeScript scanner that downloads OHLCV data, computes TradingView-style **Stochastic %K/%D**, finds **pivot highs/lows**, and detects **double-top / double-bottom divergences** with tolerance and min-bar rules. Ships with a **pure TS engine** and an optional **PineTS demo** (your original conversion).

## Features
- Provider-agnostic pure engine: `computeStochDivPro(...)` (no Pine runtime required)
- CLI for bulk scanning and CSV export
- Optional PineTS runtime demo (Binance/BTCUSDT) to mirror your original script
- Easy configuration for stoch/pivot/tolerance rules

## Requirements
- Node.js 18+
- npm (or pnpm/yarn)

## Install
```bash
npm install
```

## Quick Start (Pure Engine)
```bash
# Edit stocks.txt to your tickers
npm run dev -- --file stocks.txt --period 6mo --interval 1d --out output.csv
```

**Outputs**: prints first rows to console, writes `output.csv` if specified.

## CLI Options
```
--file <path>       Path to tickers file (default: stocks.txt)
--period <range>    Yahoo range (e.g., 3mo, 6mo, 1y) (default: 6mo)
--interval <tf>     1d | 1h | 15m (default: 1d)
--out <csv>         If set, write results to CSV
--mode <pure|pine>  Choose engine: pure (default) or pine (demo)
```

## PineTS Mode (Optional)
Your original PineTS conversion is included at `src/engine/pine_port/stoch_div_pro_nison.ts`.
To run it (demo style) choose `--mode pine` and install `pinets`:

```bash
npm i pinets
npm run dev -- --mode pine
```

> Pine mode is a self-contained demo (uses `Providers.Binance, "BTCUSDT", "60", 1500"`). The CLI ignores tickers/CSV flags in pine mode.

## Configuration
Edit `src/config.ts`:
- `stochLength`, `smoothK`, `smoothD`, `oversold`, `overbought`
- `pivotLeft`, `pivotRight`, `priceTolerance`, `minBarsBetweenPivots`, `enableEarly`
- `period`, `interval`
- `sleepMs`, `concurrency`

## Project Structure
```
nadilistore-ts/
├── README.md
├── package.json
├── tsconfig.json
├── stocks.txt
└── src/
    ├── index.ts
    ├── config.ts
    ├── types.ts
    ├── io/
    │   ├── downloadYahoo.ts
    │   ├── symbolsFromFile.ts
    │   └── writeCsv.ts
    └── engine/
        ├── stochDivPro.ts
        ├── stochDivAdapter.ts
        ├── pineWrapper.ts
        └── pine_port/
            └── stoch_div_pro_nison.ts
```

## Notes
- The pure engine returns an `annotations` array of divergence events; the CLI stores the latest event JSON in the `details` field of the CSV for quick inspection.
- You can extend the engine to output Nison/strength/pressure labels; just add fields to `DivergenceEvent` and return them in `computeStochDivPro(...)`.

MIT © WHAT KIND OF AI
