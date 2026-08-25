/**
 * `.env.local` → `process.env`.
 *
 * Twelve lines rather than a dependency, because this project has exactly one
 * secret (`OPENROUTER_API_KEY`) and both things that need it — the Vite dev
 * middleware and any `tsx src/…` script — run in a plain Node process.
 *
 * **A variable already in the environment wins.** `.env.local` is the
 * convenience, not the authority, so `OPENROUTER_API_KEY=… npm run dev` does
 * what it looks like it does.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
let done = false;

export function loadEnvLocal(): void {
  if (done) return;
  done = true;
  let text: string;
  try {
    text = readFileSync(path.join(ROOT, ".env.local"), "utf8");
  } catch {
    return; // no file is fine — the variable may be set some other way
  }
  for (const line of text.split("\n")) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match || line.trimStart().startsWith("#")) continue;
    // Neither group is optional in the pattern, so the defaults never fire —
    // they are here because a regex match types every group as possibly absent.
    const [, name = "", raw = ""] = match;
    const value = raw.trim().replace(/^(['"])(.*)\1$/, "$2");
    if (process.env[name] === undefined) process.env[name] = value;
  }
}
