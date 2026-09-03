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

// infra/hetzner/README.md is named explicitly rather than picked up by a glob,
// because it is the only markdown outside docs/ that is a runbook someone
// follows literally — and it was outside this gate until 2026-08-31, which is
// exactly how it came to carry a link to a `#mcp-servers` heading that did not
// exist. A dead anchor there costs more than one in docs/: it is read while
// building a machine, by someone who cannot yet ask the repo anything.
const DOC_FILES = ["AGENTS.md", "infra/hetzner/README.md", ...globSync("docs/**/*.md")];

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

/**
 * The gitignored roots that pipeline runs write into: `/data/` and `/output/`
 * in `.gitignore`, both anchored with a leading slash, so this is the whole of
 * them and only the top level counts.
 *
 * Written out rather than parsed out of `.gitignore` at runtime. A parser would
 * have to implement enough of gitignore's syntax — anchoring, negation, `**`,
 * directory-only patterns — to be right about anything else in that file, and a
 * parser that got it subtly wrong would silently stop banning things, which is
 * the failure mode this whole test exists to close. Two names and a pointer are
 * more honest. If a third runtime root ever appears in `.gitignore`, add it.
 */
const IGNORED_DATA_ROOTS = new Set(["data", "output"]);

/**
 * Why a resolved link target cannot be relied on to mean the same thing on two
 * machines — or `null` if it can.
 *
 * Takes the **resolved** repo-relative path rather than the link text, and both
 * halves of that matter. Reading the text cannot tell a top-level runtime root
 * apart from a nested tracked one: `tests/fixtures/data-root/data/…` is the
 * committed corpus and a perfectly good link target, while `../../data/…` from
 * a doc is not, and the two are indistinguishable as strings. Resolving first
 * settles it, because `.gitignore` anchors both roots with a leading slash, so
 * only the top level counts.
 *
 * Exported as a function, and exercised by a table of its own below, because
 * the assertion that uses it is a list that should be empty. Emptying
 * `IGNORED_DATA_ROOTS`, or pointing the filter at the wrong field, would leave
 * that assertion green and silent — which is the exact reporting failure the
 * rule exists to close.
 */
function unportableTarget(resolved: string): string | null {
  const segments = resolved.split(path.sep);
  const root = segments[0] ?? "";
  if (IGNORED_DATA_ROOTS.has(root)) {
    return `${root}/ is gitignored runtime output — whether this resolves depends on what the reader has run`;
  }
  // `../../../x` normalises to `../x`, which is outside the repository
  // altogether. No doc does this today; it is banned anyway because it fails in
  // exactly the same way — green on the laptop that happens to have the file,
  // red in a clean checkout — and the root check above cannot see it, since the
  // first segment is `..` rather than a name.
  if (root === "..") {
    return "resolves outside the repository, so only a machine with that file could follow it";
  }
  return null;
}

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
      // The same citation, written relative: `vite.config.ts:55`. A trailing
      // `:<line>` is what makes it a citation rather than a link — no repo path
      // ends in one — so this exempts the citation without exempting the file.
      // Narrow on purpose: `foo.md#anchor` and plain `foo.ts` are still checked.
      .filter((l) => !/:\d+$/.test(l.target))
      .map((l) => `${l.from} → ${l.target}`);
    expect(broken).toEqual([]);
  });

  /**
   * **A link into `/data/` is wrong even on the machine where it resolves.**
   *
   * That directory is gitignored pipeline output, so whether a link into it
   * works depends on which articles the reader happens to have run — and in a
   * worktree, on which fixtures `worktree:setup` copied. Both states existed at
   * once on 2026-09-02: `data/reader.json` was red in every worktree and green
   * in the primary, while `data/noema-mythology-of-conscious-ai` was green in
   * both and one corpus change away from red.
   *
   * The check above cannot tell those apart, because "the file is there"
   * is true for the wrong reason. So this asks the question that has one
   * answer everywhere: name a runtime path in prose, never as a link.
   *
   * The rule the first version of this check used matched `data/` in the link
   * *text*, and it was wrong in both directions: it never mentioned `output`,
   * so `open-questions.md`'s link into it survived and went on resolving by
   * luck until 2026-09-02; and it would have banned a link to the tracked
   * corpus under `tests/fixtures/data-root/data/`. `unportableTarget` judges
   * the resolved path instead, which is what tells those two apart.
   */
  it("never link into gitignored runtime output", () => {
    const unportable = allLinks
      .filter((l) => !/^<?\//.test(l.target))
      // `l.file` is the link's own repo-relative path, so
      // `docs/project/../../output/x` has already become `output/x`.
      .map((l) => ({ l, why: unportableTarget(l.file) }))
      .filter(({ why }) => why !== null)
      .map(({ l, why }) => `${l.from} → ${l.target} (${why})`);
    expect(unportable).toEqual([]);
  });

  /**
   * The positive control for the rule above, which is a list that should be
   * empty and so proves nothing about the classifier that fills it.
   *
   * Each case is a link exactly as it would be written in a doc under
   * `docs/project/`, resolved the way `linksIn` resolves one, so the
   * normalisation is under test too rather than assumed.
   */
  it("classifies each shape of link target", () => {
    const asWrittenIn = (rel: string) => unportableTarget(path.normalize(path.join("docs/project", rel)));

    // Gitignored runtime output, both roots, with and without a file part.
    expect(asWrittenIn("../../output/noema.html")).toContain("gitignored");
    expect(asWrittenIn("../../data/reader.json")).toContain("gitignored");
    expect(asWrittenIn("../../data")).toContain("gitignored");
    // Outside the repository altogether.
    expect(asWrittenIn("../../../elsewhere.md")).toContain("outside the repository");
    // The tracked corpus, which contains the literal segment `data/` and is a
    // legitimate target. This is the case a text-matching rule got wrong.
    expect(asWrittenIn("../../tests/fixtures/data-root/data/constitution")).toBeNull();
    // And an ordinary link, so "rejects everything" would not pass either.
    expect(asWrittenIn("architecture.md")).toBeNull();
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

/**
 * The third thing this file checks: that an evergreen doc never cites a line
 * number, and that a `file § symbol` citation names something the file holds.
 *
 * A line number is a fact about one commit. On 2026-09-03 every one of the six
 * `path:NNN` citations under docs/project/ and infra/ that was checked pointed
 * at a line that no longer held what the sentence said — `src/glossary.ts:1060`
 * was inside a prompt string, `src/jobs.ts:443` was a comment about `force` —
 * and the link check above was green on all of them, because it looks for the
 * file, and the file is nearly always there. A citation that cannot go red is
 * the subject of docs/research/260903b-facts-that-were-wrong.md.
 *
 * So evergreen docs cite the symbol — `src/models.ts` § `STAGE_EFFORT` — and
 * this checks the file still contains it, which a rename does break. Plans,
 * postmortems and research notes are dated records of a moment and may keep
 * their line numbers; GPT Sol's reviews cite that way and are left alone.
 *
 * Third-party and made-up paths are ignored (`Readability.js:2701`,
 * `src/x.ts:148`): the rule is "no line number *into this repo*", and a path
 * that resolves to nothing here has nothing to rot against.
 */
const EVERGREEN = [
  "AGENTS.md",
  "infra/hetzner/README.md",
  ...globSync("docs/project/**/*.md"),
  ...globSync("docs/reusable/*.md"),
];

const CODE_EXT = "(?:ts|tsx|css|js|mjs|cjs|json|sql|sh)";

/**
 * The directories a citation into this repo starts with. A path under one of
 * these that does not exist is a *stale* citation — the file was renamed or
 * deleted — and must be reported, not skipped. The first version of this guard
 * dropped every unresolved path as "external", so deleting a cited file made
 * the test greener; GPT Sol's review demonstrated that on 2026-09-03.
 */
const REPO_ROOTS = ["src", "tests", "scripts", "styles", "infra", "evals", "docs", "supabase", "drizzle"];

/**
 * A citation pasted from a review or a terminal is often absolute —
 * `/home/greg/code/spideryarn2/.claude/worktrees/x/src/foo.ts` — and means
 * this repo's file however many worktrees deep it was. Cut it back to the repo
 * root; a path with no repo root in it is somebody else's machine.
 */
function repoRelative(p: string): string {
  const m = p.match(new RegExp(`(?:^|/)((?:${REPO_ROOTS.join("|")})/.*)$`));
  return m ? m[1]! : p;
}

/** Where the citation points — or `null` when it is not into this repo at all. */
type Target = { file: string } | { missing: string };

/**
 * Docs write `lib/api.ts` for `src/web/lib/api.ts` and `styles.css` for
 * `src/web/styles.css`, so the prefixes are tried too. Over-resolving is the
 * safe direction: a false positive is a line in a failing test that someone
 * reads; a false negative is silence.
 */
function resolveCodePath(from: string, written: string): Target | null {
  const rel = path.isAbsolute(written) ? repoRelative(written) : written;
  if (path.isAbsolute(rel)) return null;
  const candidates = [rel, path.join(path.dirname(from), rel), path.join("src", rel), path.join("src/web", rel)];
  const file = candidates.map((p) => path.normalize(p)).find(existsSync);
  if (file) return { file };
  const root = path.normalize(rel).split(path.sep)[0] ?? "";
  return REPO_ROOTS.includes(root) ? { missing: rel } : null;
}

interface CodeCitation {
  from: string;
  text: string;
  target: Target;
  /** Only for the `§` form. */
  symbol?: string;
}

/**
 * `src/foo.ts:123`, `src/foo.ts#L123`, `src/foo.ts:94-105`, and the spoken
 * forms `foo.ts line 12` and `foo.ts L12` — anything that pins a line.
 */
function lineCitationsIn(from: string, text: string): CodeCitation[] {
  const out: CodeCitation[] = [];
  // The optional backtick is for the spoken forms, where the path is usually
  // in code and the line number is not: `` `src/blocks.ts` line 12 ``.
  const re = new RegExp(`([\\w./-]+\\.${CODE_EXT})\`?((?::|#L|\\s+L|\\s+lines?\\s+)\\d+)`, "g");
  for (const m of stripFences(text).matchAll(re)) {
    const target = resolveCodePath(from, m[1]!);
    if (target) out.push({ from, text: `${m[1]}${m[2]}`, target });
  }
  return out;
}

/**
 * `` `src/foo.ts` § `symbol` ``, bare `src/foo.ts § `symbol``, and the linked
 * form `` [`src/foo.ts`](../../src/foo.ts) § `symbol` `` — for that one the
 * link's target is what is resolved, not its label, since the label is
 * whatever the author felt like writing.
 */
function symbolCitationsIn(from: string, text: string): CodeCitation[] {
  const out: CodeCitation[] = [];
  const md = stripFences(text);
  const plain = new RegExp(`\`?([\\w./-]+\\.${CODE_EXT})\`?\\s*§\\s*\`([^\`]+)\``, "g");
  const linked = new RegExp(`\\[[^\\]]*\\]\\(([^)\\s]+\\.${CODE_EXT})\\)\\s*§\\s*\`([^\`]+)\``, "g");
  for (const m of [...md.matchAll(plain), ...md.matchAll(linked)]) {
    const target = resolveCodePath(from, m[1]!);
    if (target) out.push({ from, text: m[0], target, symbol: m[2]! });
  }
  return out;
}

/**
 * Whether the file still holds the cited symbol. An identifier is matched on
 * its own boundaries, so `` § `save` `` does not survive on `saved`; anything
 * else — a CSS selector, a phrase from a comment — is matched as written.
 * This proves the anchor is still there, not that the sentence around the
 * citation is still true; that is as far as a test can go.
 */
function holds(file: string, symbol: string): boolean {
  const src = readFileSync(file, "utf8");
  if (/^[A-Za-z_$][\w$]*$/.test(symbol)) {
    return new RegExp(`(?<![\\w$])${symbol}(?![\\w$])`).test(src);
  }
  return src.includes(symbol);
}

const describeTarget = (t: Target) => ("file" in t ? t.file : `${t.missing} — no such file`);

describe("evergreen docs cite code by symbol, not by line", () => {
  /**
   * The positive controls. The two assertions after them are lists that should
   * be empty, and an empty list says nothing about the pattern that fills it —
   * so every shape the pattern must catch, and every shape it must leave
   * alone, is tried here first.
   */
  it("recognises each shape of line citation", () => {
    const doc = "docs/project/architecture.md";
    const lines = (s: string) => lineCitationsIn(doc, s).map((c) => `${c.text} → ${describeTarget(c.target)}`);
    expect(lines("see `src/blocks.ts:12`")).toEqual(["src/blocks.ts:12 → src/blocks.ts"]);
    expect(lines("[src/blocks.ts#L12](../../src/blocks.ts)")).toEqual(["src/blocks.ts#L12 → src/blocks.ts"]);
    expect(lines("`src/source-hash.ts:94-105`")).toEqual(["src/source-hash.ts:94 → src/source-hash.ts"]);
    // A link whose label is not the path: the target still carries the line.
    expect(lines("[the check](../../src/blocks.ts#L12)")).toEqual(["../../src/blocks.ts#L12 → src/blocks.ts"]);
    // Spoken, which is how a line number gets past a regex that only knows `:`.
    expect(lines("`src/blocks.ts` line 12")).toEqual(["src/blocks.ts line 12 → src/blocks.ts"]);
    expect(lines("`src/blocks.ts` L12")).toEqual(["src/blocks.ts L12 → src/blocks.ts"]);
    // The prefixes docs leave off.
    expect(lines("`lib/api.ts:159`")).toEqual(["lib/api.ts:159 → src/web/lib/api.ts"]);
    // Pasted from a review: absolute, and from some worktree. Still this repo.
    expect(lines("`/home/greg/code/spideryarn2/.claude/worktrees/x/src/blocks.ts:12`")).toEqual([
      "/home/greg/code/spideryarn2/.claude/worktrees/x/src/blocks.ts:12 → src/blocks.ts",
    ]);
    // A file this repo no longer has is the stalest citation of all, and the
    // first version of this guard skipped it.
    expect(lines("`src/x.ts:148`")).toEqual(["src/x.ts:148 → src/x.ts — no such file"]);
    // Not this repo: nothing to rot against.
    expect(lines("`Readability.js:2701`")).toEqual([]);
    expect(lines("`/Users/greg/elsewhere/file.ts:148`")).toEqual([]);
    // A fence is quoted output, not a citation.
    expect(lines("```\nsrc/routes.ts:93\n```")).toEqual([]);
  });

  it("recognises each shape of symbol citation, and whether it still holds", () => {
    const doc = "docs/project/architecture.md";
    const symbols = (s: string) =>
      symbolCitationsIn(doc, s).map((c) => [describeTarget(c.target), c.symbol]);
    expect(symbols("(`src/blocks.ts` § `nonsuch`, and styles.css § `.tooltip-anchor`)")).toEqual([
      ["src/blocks.ts", "nonsuch"],
      // `styles.css` is how summaries.md writes it; the prefix is filled in.
      ["src/web/styles.css", ".tooltip-anchor"],
    ]);
    // The linked form, which is how most of the corpus writes it. The target
    // is what counts, whatever the label says.
    expect(symbols("[`src/blocks.ts`](../../src/blocks.ts) § `nonsuch`")).toEqual([["src/blocks.ts", "nonsuch"]]);
    expect(symbols("[the parser](../../src/blocks.ts) § `nonsuch`")).toEqual([["src/blocks.ts", "nonsuch"]]);
    expect(symbols("`src/x.ts` § `gone`")).toEqual([["src/x.ts — no such file", "gone"]]);
    expect(symbols("database.md § heading")).toEqual([]);

    // `holds` is the filter behind the assertion below; a filter that let
    // everything through would leave that list empty too. Not tried against
    // this file: every string written here is, by that fact, in this file.
    expect(holds("src/source-hash.ts", "hashBlocks")).toBe(true);
    expect(holds("src/source-hash.ts", "hashBlock")).toBe(false); // a prefix is not the symbol
    expect(holds("src/blocks.ts", "Bloc")).toBe(false); // nor is it inside a longer one
    expect(holds("src/web/styles.css", ".tooltip-anchor")).toBe(true); // selectors match as written
  });

  it("never cite a line number", () => {
    const cited = EVERGREEN.flatMap((f) => lineCitationsIn(f, readFileSync(f, "utf8")))
      // codex-cli-as-subagent.md explains the citation form with a made-up path.
      .filter((c) => !c.from.endsWith("codex-cli-as-subagent.md"))
      .map((c) => `${c.from} → ${c.text}`);
    expect(cited).toEqual([]);
  });

  it("cite symbols the file still holds", () => {
    const all = EVERGREEN.flatMap((f) => symbolCitationsIn(f, readFileSync(f, "utf8")));
    // The guard: the docs do cite this way, so finding few means the pattern broke.
    expect(all.length).toBeGreaterThan(30);
    const stale = all
      .filter((c) => "missing" in c.target || !holds(c.target.file, c.symbol!))
      .map((c) => `${c.from} → ${c.text} (${describeTarget(c.target)})`);
    expect(stale).toEqual([]);
  });
});
