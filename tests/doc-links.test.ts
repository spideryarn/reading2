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
 * (docs/project/original-version/overview.md). Listed explicitly rather than inferred:
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
      // GPT Sol's review files cite evidence as `</abs/path/file.md:161>`. That
      // is a citation, not a link — an absolute path is never a repo link, so
      // there is nothing here for this test to be right about.
      .filter((l) => !/^<?\//.test(l.target))
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

/**
 * The second thing this file checks: that the docs tree has no orphans.
 *
 * `AGENTS.md` lists seven entry-point docs, and under each one ("↳ …") the docs
 * it owns. That list is the index, so it is also the thing that rots — a new doc
 * gets written, nothing points at it, and it is invisible to every agent that
 * arrives afterwards. Reading it from the working tree rather than from
 * `git ls-files` means an untracked new doc fails immediately, which is the
 * moment it is cheapest to fix.
 *
 * Cross-links are fine and expected; a doc may be linked from anywhere. What
 * this pins is that exactly one entry point *claims* it.
 */

const ENTRY_POINTS = [
  "vision.md",
  "architecture.md",
  "reading-view-overview.md",
  "design-css-overview.md",
  "security-map.md",
  "code-quality-overview.md",
  "dev-and-deployment-overview.md",
];

/** owner filename → the docs its "↳" lines claim */
function ownershipFromAgentsMd(): Map<string, string[]> {
  const lines = readFileSync("AGENTS.md", "utf8").split("\n");
  const owned = new Map<string, string[]>();
  /* The list being filled in, held directly rather than by its key: the key
     would have to be looked up again on every line, and `Map.get` answers
     `string[] | undefined` however sure we are that we just put it there. */
  let current: string[] | null = null;
  for (const line of lines) {
    const owner = line.match(/^- \*\*\[([a-z0-9-]+\.md)\]/)?.[1];
    if (owner) {
      current = [];
      owned.set(owner, current);
      continue;
    }
    if (current === null) continue;
    // A "↳" block runs until the next bullet or a blank line, and its
    // continuation lines start with prose as often as with a backtick.
    const inBlock = line.includes("↳") || /^\s+\S/.test(line);
    if (!inBlock) {
      current = null;
      continue;
    }
    for (const match of line.matchAll(/`([a-z0-9-]+\.md)`/g)) {
      /* A successful match always has group 1 — the group is the whole point
         of the pattern — but skipping rather than asserting means a pattern
         edited into having no group drops every claim instead of throwing,
         and the "parses the ownership list at all" guard below is what turns
         that into a failure. */
      const name = match[1];
      if (name) current.push(name);
    }
  }
  return owned;
}

describe("docs have exactly one owner", () => {
  const owned = ownershipFromAgentsMd();
  const claims = [...owned.values()].flat();
  const onDisk = globSync("docs/project/*.md").map((f) => path.basename(f));

  it("parses the ownership list at all", () => {
    // Same guard as above: a regex that matched nothing would make every
    // assertion below pass forever, and pass loudest when the file was empty.
    expect(owned.size).toBe(ENTRY_POINTS.length);
    expect([...owned.keys()].sort()).toEqual([...ENTRY_POINTS].sort());
    expect(claims.length).toBeGreaterThan(30);
  });

  it("claims every doc that exists", () => {
    const orphans = onDisk
      .filter((f) => !ENTRY_POINTS.includes(f))
      .filter((f) => !claims.includes(f));
    expect(orphans).toEqual([]);
  });

  it("claims no doc twice", () => {
    const twice = claims.filter((f, i) => claims.indexOf(f) !== i);
    expect([...new Set(twice)]).toEqual([]);
  });

  it("claims nothing that does not exist", () => {
    expect(claims.filter((f) => !onDisk.includes(f))).toEqual([]);
  });

  it("links from the owner to each doc it claims", () => {
    const unlinked: string[] = [];
    for (const [owner, children] of owned) {
      const body = readFileSync(path.join("docs/project", owner), "utf8");
      for (const child of children) {
        // A deep link counts: `(other.md#section)` is still a link to it.
        const linked = new RegExp(`\\(${child.replace(".", "\\.")}[)#]`).test(body);
        if (!linked) unlinked.push(`${owner} → ${child}`);
      }
    }
    expect(unlinked).toEqual([]);
  });
});
