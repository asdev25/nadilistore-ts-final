import { readFileSync } from "node:fs";

export function symbolsFromFile(path: string): string[] {
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .map(s => s.trim().toUpperCase())
    .filter(Boolean);
}
