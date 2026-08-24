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
 * It covers **source comments as well as markdown**, and that is not an extra —
 * it is the case the test was written for. All three stale anchors that prompted
 * it were in comments (`Spine.tsx`, `tree.ts`, `styles.css`), not one in a
 * markdown file, and a markdown-only checker went green on every one of them.
 * Found by spideryarn2-ed mutation-testing this file rather than trusting it.
 *
 * Comments don't use markdown link syntax, so they need their own rule: a bare
 * `granularity-zoom.md#the-tree` in prose, resolved against the docs directories
 * rather than against the source file's own — `granularity-zoom.md` written in
 * `src/web/tree.ts` means `docs/project/granularity-zoom.md`, not
 * `src/web/granularity-zoom.md`.
 *
 * Not a style checker. It asserts only that a link goes where it claims.
 */
import { readFileSync } from "node:fs";
import { existsSync } from "node:fs";
import path from "node:path";
import { globSync } from "node:fs";
import { describe, expect, it } from "vitest";

const DOC_FILES = ["AGENTS.md", ...globSync("docs/**/*.md")];

/** Everything that carries prose about the docs in a comment. */
const SOURCE_FILES = [
  ...globSync("src/**/*.{ts,tsx,css}"),
  ...globSync("styles/*.css"),
  ...globSync("*.config.ts"),
];

/**
 * Where a bare reference is resolved, in order. A comment says
 * `granularity-zoom.md#the-tree` and means the doc, wherever it lives — the
 * path is relative to the docs, not to the file doing the referring.
 */
const SEARCH_ROOTS = [".", "docs/project", "docs/reusable"];

/**
 * Citations of a *different* repository, which are correctly dangling here.
 * `styles/tokens.css` credits the original app's own docs under a `Source:`
 * line naming its absolute path; those files were deliberately not carried over
 * (docs/project/original-version.md). Listed explicitly rather than inferred:
 * "the directory doesn't exist so it must be external" would also swallow a
 * genuine typo in a directory name, which is exactly a break worth catching.
 */
const EXTERNAL = new Set([
  "docs/reference/DESIGN_COLORS_FONTS.md",
  "docs/reference/RESEARCH_ON_OPTIMAL_TEXT_FORMATTING.md",
]);

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

/**
 * Bare `foo.md#anchor` references in source comments.
 *
 * Deliberately not applied to markdown, where the convention is a real link and
 * `linksIn` already covers it.
 */
function bareRefsIn(file: string): Link[] {
  const src = readFileSync(file, "utf8");
  const out: Link[] = [];
  // The anchor class excludes `.`, so a reference ending a sentence —
  // "…granularity-zoom.md#node-shape." — doesn't drag the full stop in.
  for (const m of src.matchAll(/[\w./-]*\.md(?:#([\w-]+))?/g)) {
    const target = m[0];
    const rel = target.split("#")[0]!;
    if (EXTERNAL.has(rel)) continue;
    const resolved =
      SEARCH_ROOTS.map((r) => path.normalize(path.join(r, rel))).find(existsSync) ??
      path.normalize(path.join(path.dirname(file), rel));
    out.push({ from: file, target, file: resolved, anchor: m[1] ?? "" });
  }
  return out;
}

const allLinks = [
  ...DOC_FILES.flatMap(linksIn),
  ...SOURCE_FILES.flatMap(bareRefsIn),
];

describe("documentation links", () => {
  it("finds links to check at all", () => {
    // Guards the regex itself: a parser that silently matched nothing would
    // make every assertion below pass forever.
    expect(DOC_FILES.length).toBeGreaterThan(10);
    expect(SOURCE_FILES.length).toBeGreaterThan(10);
    expect(allLinks.length).toBeGreaterThan(100);
    // The bare-reference path has its own guard: it is the half that was
    // missing, so "it found nothing" must not read as "nothing is wrong".
    expect(SOURCE_FILES.flatMap(bareRefsIn).length).toBeGreaterThan(15);
    expect(
      SOURCE_FILES.flatMap(bareRefsIn).filter((l) => l.anchor).length,
    ).toBeGreaterThan(5);
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
