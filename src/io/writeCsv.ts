import { writeToPath } from "fast-csv";
import type { ResultRow } from "../types.js";

export async function writeCsv(rows: ResultRow[], outPath: string) {
  await new Promise<void>((resolve, reject) => {
    const stream = writeToPath(outPath, rows, { headers: true });
    stream.on("error", reject);
    stream.on("finish", resolve);
  });
}
