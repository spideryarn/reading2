/**
 * **One reader of the registry keys, and one door to Semantic Scholar** —
 * plan 261018o stage 1, its code review's F1 and F2. A static sweep of the
 * code that can run (src/, evals/, scripts/), because the two leaks it found
 * were in an eval that no test drives: a phase that read `OPENALEX_API_KEY`
 * itself and put it in a URL as `api_key`, and Semantic Scholar requests that
 * bypassed the approval switch.
 *
 * - The key and approval names are read only by src/registry-keys.ts.
 * - `api_key` never appears as a query parameter.
 * - Semantic Scholar's API host is named only where the one door is
 *   (src/fetch.ts's host list, src/registry-keys.ts's key host) and where its
 *   one URL is built (src/citation-evidence.ts § `semanticScholarUrl`).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "..");
const SWEPT = ["src", "evals", "scripts"];

function files(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...files(full));
    else if (/\.(?:ts|tsx|mts|js|mjs)$/.test(name)) out.push(full);
  }
  return out;
}

const SOURCES = SWEPT.flatMap((d) => files(path.join(ROOT, d))).map((full) => ({
  file: path.relative(ROOT, full),
  text: readFileSync(full, "utf8"),
}));

function where(pattern: RegExp): string[] {
  return SOURCES.filter((s) => pattern.test(s.text)).map((s) => s.file).sort();
}

describe("the registry keys", () => {
  it("sweeps a real tree", () => {
    expect(SOURCES.length).toBeGreaterThan(500);
    expect(where(/semanticScholarAllowed/)).toContain("src/fetch.ts");
  });

  it("are read from the environment by src/registry-keys.ts alone", () => {
    expect(where(/process\.env(?:\.|\[["'])(?:OPENALEX_API_KEY|SEMANTIC_SCHOLAR_API_KEY|SEMANTIC_SCHOLAR_COMMERCIAL_USE)\b/)).toEqual([
      "src/registry-keys.ts",
    ]);
  });

  it("never travel as an api_key query parameter", () => {
    /* A literal `?api_key=`, or one set on URLSearchParams. (The redaction lists name the word as a key to scrub.) */
    expect(where(/[?&]api_key=|\.(?:set|append)\(\s*["']api_key["']/)).toEqual([]);
  });

  it("leave Semantic Scholar's API named only at its one door and its one URL", () => {
    expect(where(/api\.semanticscholar\.org/)).toEqual(["src/citation-evidence.ts", "src/fetch.ts", "src/registry-keys.ts"]);
  });
});
