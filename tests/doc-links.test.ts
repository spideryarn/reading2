/**
 * Every relative link in the docs resolves — file *and* anchor.
 *
 * This exists because doc rot bit three times in one session, and because of
 * how it bites: **a stale anchor resolves silently to the top of the page.** It
 * never looks broken. You click it, you land somewhere plausible, and you never
 * learn it stopped taking you where it said. Nothing else in the repo can catch
 * that, and one grep can.
 *
 * It is checked against the working tree rather than against committed state,
 * which is the deliberate choice here. Several agents edit this repo at once, so
 * one of them renaming a heading can turn another's link red mid-flight — and
 * the tempting fix is to check `git show HEAD:…` instead so in-flight edits are
 * invisible. That gets it backwards. AGENTS.md says run `npm test` before you
 * commit, so checking the working tree is what stops a broken link *landing*;
 * checking committed state would only tell you it already had. A red result
 * here is always a one-line fix, and always a real one.
 *
 * Not a style checker. It asserts only that a link goes where it claims.
 */
import { readFileSync } from "node:fs";
import { existsSync } from "node:fs";
import path from "node:path";
import { globSync } from "node:fs";
import { describe, expect, it } from "vitest";

const FILES = ["AGENTS.md", ...globSync("docs/**/*.md")];

/** Fenced code blocks hold `#` lines that are comments, not headings. */
const stripFences = (md: string) => md.replace(/^```[\s\S]*?^```/gm, "");

/**
 * GitHub's heading → anchor rule: lower-case, drop everything that isn't a
 * letter, number, space, hyphen or underscore (so backticks, colons, commas and
 * apostrophes all vanish), then spaces to hyphens.
 */
function slug(heading: string): string {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s+/g, "-");
}

/** Every anchor a reader could land on in this file. */
function anchorsIn(file: string): Set<string> {
  const md = readFileSync(file, "utf8");
  const found = new Set<string>();
  const seen = new Map<string, number>();

  for (const m of stripFences(md).matchAll(/^#{1,6}\s+(.+?)\s*$/gm)) {
    const base = slug(m[1]!);
    if (!base) continue;
    // Repeated headings get -1, -2, … in the order they appear.
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    found.add(n === 0 ? base : `${base}-${n}`);
  }
  // Explicit tags win where a heading would give a useless slug — architecture.md
  // and open-questions.md both use these, and they are NOT stale despite bearing
  // no relation to the heading above them.
  for (const m of md.matchAll(/<a\s+(?:id|name)="([^"]+)"/g)) found.add(m[1]!);

  return found;
}

const anchorCache = new Map<string, Set<string>>();
const anchorsFor = (file: string) => {
  if (!anchorCache.has(file)) anchorCache.set(file, anchorsIn(file));
  return anchorCache.get(file)!;
};

interface Link {
  from: string;
  target: string;
  file: string;
  anchor: string;
}

function linksIn(file: string): Link[] {
  const md = stripFences(readFileSync(file, "utf8"));
  const out: Link[] = [];
  for (const m of md.matchAll(/\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    const target = m[1]!;
    if (/^(https?:|mailto:|data:)/.test(target)) continue;
    const [rel, anchor = ""] = target.split("#");
    // `#foo` alone points within the same document.
    const resolved = rel ? path.normalize(path.join(path.dirname(file), rel)) : file;
    out.push({ from: file, target, file: resolved, anchor });
  }
  return out;
}

const allLinks = FILES.flatMap(linksIn);

describe("documentation links", () => {
  it("finds links to check at all", () => {
    // Guards the regex itself: a parser that silently matched nothing would
    // make every assertion below pass forever.
    expect(FILES.length).toBeGreaterThan(10);
    expect(allLinks.length).toBeGreaterThan(100);
  });

  it("point at files that exist", () => {
    const broken = allLinks
      .filter((l) => !existsSync(l.file))
      // rename-or-move.md illustrates the syntax with a made-up path.
      .filter((l) => !l.from.endsWith("rename-or-move.md"))
      .map((l) => `${l.from} → ${l.target}`);
    expect(broken).toEqual([]);
  });

  it("point at anchors that exist", () => {
    const broken = allLinks
      .filter((l) => l.anchor && existsSync(l.file) && l.file.endsWith(".md"))
      .filter((l) => !anchorsFor(l.file).has(l.anchor))
      .map((l) => `${l.from} → ${l.target}`);
    expect(broken).toEqual([]);
  });
});
