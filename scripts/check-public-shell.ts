/**
 * Does a deployed `/read/:slug` actually behave the way
 * docs/plans/260828ao-public-read-only-stage2-input-sol.md says it must?
 *
 *     npx tsx scripts/check-public-shell.ts --self-test
 *     npx tsx scripts/check-public-shell.ts \
 *       --public-slug some-public-article \
 *       --private-slug some-private-article \
 *       [--private-title "The private article's exact title"] \
 *       [--host https://www.spideryarn.com]
 *
 * This is the "checks without a deployment... the minimal deployed checks"
 * list from § 7 of that plan, turned into curl requests you can run after
 * shipping the feature. It knows nothing about the feature's source — it only
 * ever talks to a running deployment over HTTP, the same way an unfurler or a
 * crawler would. Modelled on scripts/deploy.ts's `verify*` functions: same
 * `--host` flag, same one-request-at-a-time style, same "list every problem,
 * don't just say something is wrong" reporting.
 *
 * ## What this cannot check
 *
 * Nothing here opens a browser. A curl 200 with the right `<title>` proves the
 * HTML the server sent was correct; it says nothing about whether the script
 * tag it points at actually boots React. This project has already shipped a
 * deployment where curl was happy and the site was a blank page for an
 * afternoon (docs/project/browser-testing.md) — that class of bug needs an
 * actual browser and is checked separately, by hand or in a browser subagent,
 * never by this script. Nor does this script check anything about the private
 * article beyond what it can see from the outside with no credentials: it
 * cannot fetch the private article's real title to compare against, so the
 * leak check for it only runs when you pass `--private-title` yourself.
 *
 * ## Arguments
 *
 *  --host <url>            default https://www.spideryarn.com
 *  --public-slug <slug>    a real, public, readable article
 *  --private-slug <slug>   a real article that is private (or otherwise
 *                          unreadable) to an anonymous visitor
 *  --private-title <text>  the private article's exact title, if you want the
 *                          direct leak check run (see above) — optional, and
 *                          not asked for in the spec this script was written
 *                          against; everything else works without it
 *  --self-test             run the pure parsing/judging functions against
 *                          inlined fixtures, print PASS/FAIL for each, make no
 *                          network requests, and exit. Everything above is
 *                          ignored.
 *
 * Any check that needs a slug you did not supply is printed as SKIP, with the
 * reason, and never counted as a pass. Exit code is non-zero only if a check
 * that actually ran failed.
 */

import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { sameCommit } from "./build-stamp.js";
import { headText } from "../src/html.js";
/* The card's clamp, from the composer that applies it, rather than a `120`
   written out here — a checker that carries its own copy of the number it is
   checking cannot notice the number changing. */
import { CARD_TITLE } from "../src/public/page-head.js";
import { documentTitle } from "../src/title-text.js";

/* ------------------------------------------------------------------ */
/* Facts about the feature, fixed rather than guessed                  */
/* ------------------------------------------------------------------ */

/**
 * `og:url` is always this origin, never built from whatever `--host` this
 * script was pointed at — the design is explicit that the function must never
 * construct it from `Host` or a forwarded header, so a preview deployment's
 * own hostname must never appear there either. Checking it against anything
 * other than production would validate the wrong property.
 */
const PRODUCTION_ORIGIN = "https://www.spideryarn.com";

/** index.html:17. The unmodified shell's `<title>` — checked, not assumed. */
const DEFAULT_TITLE = "Spideryarn";

/* ------------------------------------------------------------------ */
/* Saying things — deliberately close to scripts/deploy.ts's look      */
/* ------------------------------------------------------------------ */

const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const DIM = "\x1b[2m";
const OFF = "\x1b[0m";

/** A CLI, so `console.log`, deliberately. docs/project/logging.md. */
const say = (s = "") => console.log(s);
const step = (s: string) => say(`\n${DIM}──${OFF} ${s}`);

type Verdict = "PASS" | "FAIL" | "SKIP";

const tally: Record<Verdict, number> = { PASS: 0, FAIL: 0, SKIP: 0 };

function printVerdict(v: Verdict, name: string): void {
  const tag = v === "PASS" ? `${GREEN}PASS${OFF}` : v === "FAIL" ? `${RED}FAIL${OFF}` : `${YELLOW}SKIP${OFF}`;
  say(`  ${tag}  ${name}`);
}

/** One check: PASS if `problems` is empty, otherwise FAIL with every problem printed. */
function report(name: string, problems: string[], info?: string): boolean {
  const verdict: Verdict = problems.length === 0 ? "PASS" : "FAIL";
  tally[verdict]++;
  printVerdict(verdict, name);
  for (const p of problems) say(`         ${p}`);
  if (info) say(`         ${DIM}${info}${OFF}`);
  return verdict === "PASS";
}

function skip(name: string, reason: string): void {
  tally.SKIP++;
  printVerdict("SKIP", name);
  say(`         ${reason}`);
}

/* ------------------------------------------------------------------ */
/* Pure parsing — every one of these is exercised by --self-test       */
/* ------------------------------------------------------------------ */

export interface HeaderLine {
  name: string;
  value: string;
}

export interface ParsedHead {
  /** e.g. 200. `null` when the dump has no recognisable status line at all. */
  status: number | null;
  statusLine: string;
  /**
   * Every header line in the final response block, verbatim, in the order
   * curl wrote them — **including exact duplicates**. Collapsing these into
   * "one value per name" is the specific thing the design warns against: a
   * doubled `x-robots-tag` is exactly what checks 6 and 7 exist to catch, and
   * a `Headers` object (or any map keyed by name) throws that evidence away
   * before you ever see it.
   */
  lines: HeaderLine[];
}

/**
 * Parse a curl `-D` dump. curl can write more than one status-line block to
 * that file — a `100 Continue` preamble, or (harmlessly, since nothing here
 * follows redirects) a redirect notice — so this takes the **last** block,
 * which is always the one that actually answered the request.
 */
export function parseHeaderDump(dump: string): ParsedHead {
  const blocks = dump
    .split(/\r?\n\r?\n/)
    .map((b) => b.trim())
    .filter((b) => b.length > 0);
  const last = blocks[blocks.length - 1] ?? "";
  const rawLines = last.split(/\r?\n/);
  const statusLine = rawLines[0] ?? "";
  const m = /^HTTP\/\d(?:\.\d)?\s+(\d{3})/.exec(statusLine);
  const status = m?.[1] ? Number(m[1]) : null;

  const lines: HeaderLine[] = [];
  for (const line of rawLines.slice(1)) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    lines.push({ name: line.slice(0, idx).trim(), value: line.slice(idx + 1).trim() });
  }
  return { status, statusLine, lines };
}

/** Every value sent under `name` (case-insensitive), in order, undeduplicated. */
export function headerValues(head: ParsedHead, name: string): string[] {
  const lower = name.toLowerCase();
  return head.lines.filter((l) => l.name.toLowerCase() === lower).map((l) => l.value);
}

export function headerCount(head: ParsedHead, name: string): number {
  return headerValues(head, name).length;
}

/**
 * The text of a `<title>` element, or `null` if there is no such element at
 * all. That is a different answer from an *empty* title (`<title></title>`
 * would return `""`), on purpose: the default shell has a real, non-empty
 * title, so `""` is itself a failure worth reporting distinctly from "found
 * nothing to read".
 */
export function extractTitle(html: string): string | null {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return m ? (m[1] ?? "").trim() : null;
}

/**
 * The `content` of the first `<meta>` tag whose `name=` or `property=`
 * equals `key` exactly — or `null` if there is no such tag. Attribute order
 * inside the tag is not assumed, since `content="…" property="og:title"` is
 * just as legal HTML as the other way round.
 */
export function metaContent(html: string, key: string): string | null {
  const tagRe = /<meta\b[^>]*>/gi;
  let tm: RegExpExecArray | null = tagRe.exec(html);
  while (tm) {
    const tag = tm[0];
    const keyMatch = /(?:name|property)\s*=\s*["']([^"']*)["']/i.exec(tag);
    if (keyMatch?.[1] === key) {
      const contentMatch = /content\s*=\s*["']([^"']*)["']/i.exec(tag);
      return contentMatch ? (contentMatch[1] ?? null) : null;
    }
    tm = tagRe.exec(html);
  }
  return null;
}

/**
 * Undo `escapeHtml`, and only `escapeHtml`.
 *
 * **The bug this exists for was live for about ten minutes and would have
 * failed a correct server.** `extractTitle` and `metaContent` hand back the raw
 * bytes between the tags, which the server has escaped; the expectation is
 * built from `headText` over a title that arrived as JSON, which is not
 * escaped. So an article whose title contains `&` or an apostrophe — Dickens,
 * a band name, half the headlines on the web — would have been reported as a
 * head that names the wrong article.
 *
 * Comparing decoded rather than escaping the expectation is deliberate: it does
 * not depend on *where* the server escapes relative to appending
 * ` · Spideryarn`, so a correct implementation that composes in either order
 * still passes, and only a genuinely different title fails.
 *
 * `&amp;` last. Doing it first turns `&amp;lt;` — the correct escaping of the
 * literal text `&lt;` — into `&lt;` and then into `<`, which is the classic
 * double-decode and would let a real difference through unnoticed.
 */
export function unescapeHead(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

/* ------------------------------------------------------------------ */
/* Judging — also pure, also self-tested                               */
/* ------------------------------------------------------------------ */

/** Common to every `/read/:slug` response, enhanced or not. */
export function judgeCommonHeaders(head: ParsedHead): string[] {
  const problems: string[] = [];

  const ct = headerValues(head, "content-type");
  if (ct.length !== 1) problems.push(`content-type: expected exactly one header, saw ${ct.length}`);
  else if (ct[0]?.toLowerCase() !== "text/html; charset=utf-8")
    problems.push(`content-type: expected 'text/html; charset=utf-8', got '${ct[0]}'`);

  const cc = headerValues(head, "cache-control");
  if (cc.length !== 1) problems.push(`cache-control: expected exactly one header, saw ${cc.length}`);
  else if (cc[0]?.toLowerCase() !== "no-store") problems.push(`cache-control: expected 'no-store', got '${cc[0]}'`);

  const sha = headerValues(head, "x-spideryarn-shell-sha256");
  if (sha.length !== 1)
    problems.push(`x-spideryarn-shell-sha256: expected exactly one header, saw ${sha.length}`);
  else if (!/^[0-9a-f]{64}$/i.test(sha[0] ?? "")) problems.push(`x-spideryarn-shell-sha256: '${sha[0]}' is not a 64-hex-char sha256`);

  return problems;
}

/**
 * Everything about the public head **except both titles**, which
 * {@link judgeTitleAgainstArticle} owns outright — `<title>` and `og:title`,
 * each compared exactly against the article's own.
 *
 * This docblock used to say it checked `og:title` was present. It never did:
 * the loop below has three keys and that is not one of them. Harmless while the
 * title judge downgraded on a blank title — except that it was the *reason* the
 * downgrade looked survivable, since a missing `og:title` seemed to be somebody
 * else's problem. It was nobody's. GPT Sol, reviewing Cluster B.
 */
export function judgePublicHead(head: ParsedHead, body: string, opts: { slug: string }): string[] {
  const problems = judgeCommonHeaders(head);
  if (head.status !== 200) problems.push(`status: expected 200, got ${head.status ?? "(no status line)"}`);

  for (const key of ["og:description", "og:url", "twitter:card"]) {
    const v = metaContent(body, key);
    if (v === null || v === "") problems.push(`meta ${key}: missing`);
  }

  const ogUrl = metaContent(body, "og:url");
  const expectedOgUrl = `${PRODUCTION_ORIGIN}/read/${encodeURIComponent(opts.slug)}`;
  if (ogUrl !== null && ogUrl !== expectedOgUrl) problems.push(`meta og:url: expected '${expectedOgUrl}', got '${ogUrl}'`);

  return problems;
}

export interface TitleVerdict {
  problems: string[];
  /**
   * **Information, not an excuse**, and it was the second of those until
   * 2026-09-02.
   *
   * There used to be a `downgraded` flag beside this, set when the article's
   * own title was blank, and it meant *this run checked less*. It is gone with
   * the branch that set it: blank is deterministic on both sides now, so every
   * title is compared exactly and there is nothing left to be lenient about.
   * What survives is this line of prose, set only for the blank case, so that a
   * person reading the output knows the `Untitled` it compared came from the
   * composers rather than from the article.
   */
  note?: string;
}

/**
 * Is the title *the right article's*, not just *some* enhancement?
 *
 * `GET /api/public/article/:slug` is an independent, already-public source of
 * truth for the article's title — assembled by the same server, but not by the
 * same code path that composes the head, so agreement between them means
 * something. Checking only "not the bare default" (the old, weaker version of
 * this check) would pass a head built from the wrong article, or a stale
 * cache: any non-default string satisfies it. Comparing against the article's
 * own `meta.title`, run through the same `headText()` clamp the head-builder
 * itself uses, catches that.
 *
 * ## Why the article route, when this used to ask `/api/public/metadata/:slug`
 *
 * That route was deleted on 2026-09-02 —
 * docs/plans/260902j-public-read-only-access-audit-and-improvements.md
 * § Cluster B — and the article route is the *more* independent of the two, not
 * a fallback. All three public reads share `publicCurrentRevisionQuery`, so
 * none of them could ever catch a bug in that; past it, metadata and head
 * evaluated the **same `PUBLIC_HEADING_TITLE` SQL expression**, while the
 * article read derives its heading title from the sanitised blocks
 * (`headingTitleOf`, src/store/public-reader.ts). Two chains that agree by
 * arriving separately is what this comparison was always after.
 *
 * It also buys a check nobody had: the head *advertises* an article, and
 * fetching the article proves the thing it advertises can actually be
 * delivered.
 *
 * **A blank article title is not a reason to check less, and it used to be.**
 * `??` preserves `""` through both fallback chains, so `meta.title` can come
 * back empty — and while this check asked the *metadata* route that was
 * genuinely unresolvable, because the head fell back to the article's first
 * `<h1>` and metadata carried no such fallback, so the two could differ
 * legitimately and by an amount nothing here could predict. It downgraded to
 * "not the bare default" for that case.
 *
 * **The article route took that uncertainty away and the downgrade outlived
 * it.** Blank is deterministic on both sides: `documentTitle("")` is
 * `Untitled · Spideryarn` (src/title-text.ts § articleTitle, `|| "Untitled"`)
 * and the card is `Untitled` (src/public/page-head.ts, the same `||`). So the
 * expected values are known exactly, and every title is now compared exactly.
 *
 * GPT Sol found what the surviving downgrade admitted, reviewing this stage:
 * for a blank-titled article, a head reading `<title>Some Other Article ·
 * Spideryarn</title>` **with no `og:title` at all** passed — present, and not
 * the bare default. A head composed from the wrong article, waved through by
 * the branch that existed to be lenient about a difference that no longer
 * exists. `note` survives as information rather than as an excuse: it says the
 * article has no stored title, so the reader of the output knows which side the
 * `Untitled` came from.
 */
export function judgeTitleAgainstArticle(body: string, articleTitle: string): TitleVerdict {
  const title = extractTitle(body);
  const blank = articleTitle.trim() === "";

  const problems: string[] = [];
  /* `|| "Untitled"` on both, matching the two composers exactly — a title of
     `"   "` normalises to `""`, which is as titleless as one that was never
     set, and both sides say `Untitled` for it. */
  const expectedOgTitle = headText(articleTitle, CARD_TITLE) || "Untitled";
  const expectedTitle = documentTitle(articleTitle);

  const decodedTitle = title === null ? null : unescapeHead(title);
  if (decodedTitle === null) problems.push("title: no <title> tag found");
  else if (decodedTitle !== expectedTitle)
    problems.push(`title: expected '${expectedTitle}' (from /api/public/article's meta.title, through documentTitle()), got '${decodedTitle}'`);

  const rawOgTitle = metaContent(body, "og:title");
  const ogTitle = rawOgTitle === null ? null : unescapeHead(rawOgTitle);
  if (ogTitle === null) problems.push("meta og:title: missing");
  else if (ogTitle !== expectedOgTitle)
    problems.push(`meta og:title: expected '${expectedOgTitle}' (from /api/public/article's meta.title, clamped to 120), got '${ogTitle}'`);

  return blank
    ? {
        problems,
        note:
          "this article has no stored title, so both expectations above are the composers' own " +
          "'Untitled' rather than anything the article said — checked exactly, not waived",
      }
    : { problems };
}

/**
 * The article's own title, out of a `GET /api/public/article/:slug` body.
 *
 * **Pure, and separate from the request, so `--self-test` can reach it.** The
 * field moved when this check was repointed: the deleted metadata payload had
 * `title` at the top level, and the article payload has it at `meta.title`
 * (src/public/dto.ts § publicMeta). A version that kept reading the top-level
 * key would find `undefined` on every real response and report *no string
 * title*, which looks like a broken deployment rather than a broken checker —
 * so the shape is pinned by a self-test case rather than by whatever
 * production happens to return. docs/reusable/silent-success.md.
 *
 * Anything short of a string is a `problems` entry, never a quiet `null`: this
 * is a public route that is supposed to work.
 */
export function articleTitleFrom(bodyText: string, path: string): { title: string | null; problems: string[] } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    return { title: null, problems: [`GET ${path}: response was not JSON`] };
  }
  const meta = (parsed as { meta?: unknown }).meta;
  if (typeof meta !== "object" || meta === null) return { title: null, problems: [`GET ${path}: response has no 'meta' object`] };
  const title = (meta as { title?: unknown }).title;
  if (typeof title !== "string") return { title: null, problems: [`GET ${path}: response has no string 'meta.title' field`] };
  return { title, problems: [] };
}

/** The unmodified default shell: private, absent, unreadable, or malformed. */
export function judgeDefaultShell(head: ParsedHead, body: string, expectedStatus: number): string[] {
  const problems = judgeCommonHeaders(head);
  if (head.status !== expectedStatus) problems.push(`status: expected ${expectedStatus}, got ${head.status ?? "(no status line)"}`);

  const title = extractTitle(body);
  if (title !== DEFAULT_TITLE)
    problems.push(`title: expected exactly '${DEFAULT_TITLE}', got ${title === null ? "no <title> tag" : `'${title}'`}`);

  if (metaContent(body, "og:title") !== null) problems.push("meta og:title: present on what should be the unmodified default shell");

  return problems;
}

/** Only run when the caller actually supplied the text to look for. */
export function judgeNoLeak(headDump: string, body: string, needle: string): string[] {
  const problems: string[] = [];
  if (headDump.includes(needle)) problems.push("the private title appears in the response headers");
  if (body.includes(needle)) problems.push("the private title appears in the response body");
  return problems;
}

/**
 * The private response and the nonexistent-slug response should be
 * byte-identical where it matters. Full-body equality (not just status) is
 * the actual leak test: the default shell carries nothing slug-specific, so
 * any difference between "private" and "does not exist" is something that
 * leaked.
 *
 * Headers are checked selectively rather than in full — `date`, `x-vercel-id`
 * and similar legitimately differ request to request; comparing those would
 * make this check permanently red for a reason that has nothing to do with
 * the feature.
 */
export function judgeByteIdentical(
  a: { head: ParsedHead; bodyBuffer: Buffer },
  b: { head: ParsedHead; bodyBuffer: Buffer },
): string[] {
  const problems: string[] = [];
  if (a.head.status !== b.head.status) problems.push(`status differs: ${a.head.status} vs ${b.head.status}`);
  if (!a.bodyBuffer.equals(b.bodyBuffer)) problems.push(`body differs (${a.bodyBuffer.length} vs ${b.bodyBuffer.length} bytes)`);
  for (const name of ["content-type", "cache-control", "x-spideryarn-shell-sha256"]) {
    const av = headerValues(a.head, name).join(",");
    const bv = headerValues(b.head, name).join(",");
    if (av !== bv) problems.push(`header ${name} differs: '${av}' vs '${bv}'`);
  }
  return problems;
}

/** Never enhanced, never a 5xx — the acceptance bar the spec sets for a malformed path. */
export function judgeMalformedPath(head: ParsedHead, body: string): string[] {
  const problems: string[] = [];
  if (head.status !== null && head.status >= 500) problems.push(`status: ${head.status} is a 5xx`);
  const title = extractTitle(body);
  if (title !== null && title !== DEFAULT_TITLE) problems.push(`title: got an enhanced-looking title '${title}' for a malformed path`);
  if (metaContent(body, "og:title") !== null) problems.push("meta og:title: present for a malformed path");
  return problems;
}

export function judgeHeadMatchesGet(
  getR: { head: ParsedHead; bodyBuffer: Buffer },
  headR: { head: ParsedHead; bodyBuffer: Buffer },
): string[] {
  const problems: string[] = [];
  if (getR.head.status !== headR.head.status) problems.push(`status differs: GET ${getR.head.status}, HEAD ${headR.head.status}`);

  const getSha = headerValues(getR.head, "x-spideryarn-shell-sha256")[0];
  const headSha = headerValues(headR.head, "x-spideryarn-shell-sha256")[0];
  if (getSha !== headSha) problems.push(`x-spideryarn-shell-sha256 differs: GET '${getSha}', HEAD '${headSha}'`);

  const cl = headerValues(headR.head, "content-length")[0];
  if (cl === undefined) problems.push("content-length: missing on the HEAD response");
  else if (Number(cl) !== getR.bodyBuffer.length)
    problems.push(`content-length: HEAD said ${cl}, GET's body is actually ${getR.bodyBuffer.length} bytes`);

  if (headR.bodyBuffer.length !== 0) problems.push(`HEAD returned a body of ${headR.bodyBuffer.length} bytes, expected none`);

  return problems;
}

/** The base shell compiled into the function must be the exact bytes it serves at `/index.html`. */
export function judgeShellHashMatches(readHead: ParsedHead, indexBodyBuffer: Buffer): string[] {
  const claimed = headerValues(readHead, "x-spideryarn-shell-sha256")[0];
  if (!claimed) return ["x-spideryarn-shell-sha256: missing on the /read/ response"];
  const actual = createHash("sha256").update(indexBodyBuffer).digest("hex");
  if (claimed.toLowerCase() !== actual) return [`header says ${claimed}, but sha256 of the served /index.html is ${actual}`];
  return [];
}

/**
 * This slice deliberately does not change crawler exposure — see the plan's
 * § 3, and the design note this script was written against. So the one
 * acceptable value on a public `/read/` response is still the site-wide
 * default, and anything else (including the correct-sounding `index, follow`
 * arriving early) is exactly the accidental flip this check exists to catch.
 */
export function judgeRobotsHeaderOnRead(head: ParsedHead): string[] {
  const values = headerValues(head, "x-robots-tag");
  if (values.length !== 1) return [`expected exactly one x-robots-tag header, saw ${values.length}${values.length ? ` (${values.join(" | ")})` : ""}`];
  if (values[0]?.toLowerCase() !== "noindex, nofollow")
    return [`expected 'noindex, nofollow', got '${values[0]}' — crawler exposure is not supposed to change in this slice`];
  return [];
}

/**
 * The two crawlers `public/robots.txt` deliberately lets at `/read/`, so that a
 * pasted shared link draws a card instead of a bare URL. Neither puts a page in
 * a search result, and the `X-Robots-Tag` header and the `<meta name="robots">`
 * are what actually keep the site out of search — that pair is untouched. The
 * file itself carries the whole argument; this is the list, lower-cased because
 * a robots.txt user-agent match is case-insensitive.
 */
const PREVIEW_BOTS = ["facebookexternalhit", "twitterbot"];

/**
 * **`Allow:` is not the same thing as indexing, and this check used to say it
 * was.**
 *
 * It rejected any `Allow:` line at all — *"that would mean indexing is already
 * enabled"* — which was true of the file it was written against and false of
 * the file that shipped. `public/robots.txt` grew two `Allow: /read/` lines on
 * purpose, one for each preview bot, and from that day this check failed
 * against a correct deployment. Found 2026-09-02, by running the script.
 *
 * A check that fails on the truth is worse than no check: the first thing
 * anybody does with a red they believe is spurious is stop reading the output.
 * So the rule is now the one the file actually keeps — **the anonymous group is
 * still `Disallow: /`, and every `Allow:` belongs to a group naming only the
 * preview bots** — and a third bot, or an `Allow:` in the `*` group, still
 * fails.
 */
export function judgeRobotsTxt(contentType: string, body: string): string[] {
  const problems: string[] = [];
  if (!contentType.toLowerCase().includes("text/plain")) problems.push(`served as '${contentType}', not text/plain`);

  /* Grouped the way a crawler reads it: a run of `User-agent:` lines opens a
     group, and the rules under it belong to all of them until the next run. */
  const groups: { agents: string[]; rules: string[] }[] = [];
  let opening = false;
  for (const raw of body.split("\n")) {
    const line = raw.replace(/#.*$/, "").trim();
    if (line === "") continue;
    const ua = /^User-agent:\s*(.+)$/i.exec(line);
    if (ua) {
      if (!opening) groups.push({ agents: [], rules: [] });
      groups[groups.length - 1]?.agents.push((ua[1] ?? "").trim().toLowerCase());
      opening = true;
      continue;
    }
    opening = false;
    groups[groups.length - 1]?.rules.push(line);
  }

  const anonymous = groups.find((g) => g.agents.includes("*"));
  if (!anonymous) problems.push("no 'User-agent: *' group found");
  else if (!anonymous.rules.some((r) => /^Disallow:\s*\/$/i.test(r)))
    problems.push("the 'User-agent: *' group does not say 'Disallow: /'");

  for (const group of groups) {
    const allows = group.rules.filter((r) => /^Allow:/i.test(r));
    if (allows.length === 0) continue;
    const unexpected = group.agents.filter((a) => !PREVIEW_BOTS.includes(a));
    if (unexpected.length > 0)
      problems.push(
        `an 'Allow:' line under '${unexpected.join(", ")}' — only ${PREVIEW_BOTS.join(" and ")} are meant to have one`,
      );
    for (const allow of allows)
      if (!/^Allow:\s*\/read\/$/i.test(allow))
        problems.push(`unexpected rule '${allow}' — the only hole is 'Allow: /read/'`);
  }

  return problems;
}

export function judgeMethodNotAllowed(head: ParsedHead): string[] {
  const problems: string[] = [];
  if (head.status !== 405) problems.push(`status: expected 405, got ${head.status ?? "(no status line)"}`);
  const allow = headerValues(head, "allow");
  if (allow.length !== 1) problems.push(`allow: expected exactly one header, saw ${allow.length}`);
  else {
    const members = new Set(
      (allow[0] ?? "")
        .split(",")
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean),
    );
    if (members.size !== 2 || !members.has("GET") || !members.has("HEAD"))
      problems.push(`allow: expected 'GET, HEAD', got '${allow[0]}'`);
  }
  return problems;
}

export function judgeCommitsMatch(healthCommit: string | null, buildJsonCommit: string | null): string[] {
  const problems: string[] = [];
  if (!healthCommit) problems.push("/api/health named no commit");
  if (!buildJsonCommit) problems.push("/build.json named no commit");
  if (healthCommit && buildJsonCommit && !sameCommit(healthCommit, buildJsonCommit))
    problems.push(`/api/health says ${healthCommit}, /build.json says ${buildJsonCommit}`);
  return problems;
}

/** `/read/:slug/metadata` must fall through to the plain, static SPA shell — never our function. */
export function judgeSpaFallback(head: ParsedHead, body: string): string[] {
  const problems: string[] = [];
  if (head.status !== 200) problems.push(`status: expected 200 (falling through to the ordinary SPA shell), got ${head.status ?? "(no status line)"}`);
  const title = extractTitle(body);
  if (title !== DEFAULT_TITLE)
    problems.push(`title: expected the default shell's '${DEFAULT_TITLE}', got ${title === null ? "no <title> tag" : `'${title}'`}`);
  return problems;
}

/* ------------------------------------------------------------------ */
/* Talking to a real deployment                                        */
/* ------------------------------------------------------------------ */

interface RawResponse {
  head: ParsedHead;
  headDump: string;
  bodyBuffer: Buffer;
  bodyText: string;
  curlError: string | null;
}

/**
 * `curl`, not `fetch` — deliberately. `fetch`'s `Headers` collapses repeated
 * header names into one comma-joined value (or silently keeps only one,
 * depending on the name), which is precisely the evidence checks 6 and 7 need
 * to see intact: a duplicated `x-robots-tag` has to look duplicated. Flags
 * match docs/plans/260828ao-public-read-only-stage2-input-sol.md § 3 exactly:
 * `--http1.1 --path-as-is -H 'Accept-Encoding: identity'`, and never
 * `--compressed` — check 6 hashes exact bytes.
 */
function curlRequest(url: string, method: "GET" | "HEAD" | "POST" = "GET"): RawResponse {
  const dir = mkdtempSync(path.join(tmpdir(), "spideryarn-check-public-shell-"));
  const headersFile = path.join(dir, "headers");
  const bodyFile = path.join(dir, "body");
  try {
    const args = [
      "--http1.1",
      "--path-as-is",
      "-H",
      "Accept-Encoding: identity",
      "-sS",
      "--max-time",
      "30",
      "-D",
      headersFile,
      "-o",
      bodyFile,
      "--request",
      method,
      url,
    ];
    const r = spawnSync("curl", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    const curlError = r.status === 0 ? null : `curl exited ${r.status}: ${(r.stderr || r.stdout || "").trim()}`;
    const headDump = existsSync(headersFile) ? readFileSync(headersFile, "utf8") : "";
    const bodyBuffer = existsSync(bodyFile) ? readFileSync(bodyFile) : Buffer.alloc(0);
    return { head: parseHeaderDump(headDump), headDump, bodyBuffer, bodyText: bodyBuffer.toString("utf8"), curlError };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const randomHex = (bytes: number) => randomBytes(bytes).toString("hex");

/* ------------------------------------------------------------------ */
/* --self-test — proves the parser and the judges can actually fail    */
/* ------------------------------------------------------------------ */

/** Build a raw `-D`-style dump the way curl would write one. */
function dump(statusLine: string, headers: Record<string, string | string[]>): string {
  const lines = [statusLine];
  for (const [name, value] of Object.entries(headers)) {
    for (const v of Array.isArray(value) ? value : [value]) lines.push(`${name}: ${v}`);
  }
  return `${lines.join("\r\n")}\r\n\r\n`;
}

function runSelfTest(): void {
  step("--self-test — pure functions against inlined fixtures, no network");
  let failed = 0;
  const check = (name: string, condition: boolean, actual?: unknown) => {
    if (condition) {
      tally.PASS++;
      printVerdict("PASS", name);
    } else {
      tally.FAIL++;
      failed++;
      printVerdict("FAIL", name);
      if (actual !== undefined) say(`         got: ${JSON.stringify(actual)}`);
    }
  };

  /* ---- parseHeaderDump / headerValues: does duplication survive parsing? ---- */
  const dupDump = dump("HTTP/1.1 200 OK", { "x-robots-tag": ["noindex, nofollow", "index, follow"] });
  const dupHead = parseHeaderDump(dupDump);
  check("parseHeaderDump keeps duplicate headers as two lines, not one", headerCount(dupHead, "x-robots-tag") === 2, headerCount(dupHead, "x-robots-tag"));
  check("headerValues is case-insensitive on the name", headerValues(dupHead, "X-ROBOTS-TAG").length === 2);

  /* curl sometimes writes a 100-continue block before the real one; only the last counts. */
  const twoBlockDump = `HTTP/1.1 100 Continue\r\n\r\n${dump("HTTP/1.1 200 OK", { "content-type": "text/html" })}`;
  check("parseHeaderDump takes the final block, not a 100-continue preamble", parseHeaderDump(twoBlockDump).status === 200);

  /* ---- extractTitle: absent vs empty are different answers ---- */
  check("extractTitle: absent tag is null", extractTitle("<html><body>no head here</body></html>") === null);
  check("extractTitle: empty tag is '', not null", extractTitle("<title></title>") === "");
  check("extractTitle: reads ordinary content", extractTitle("<title>Hello · Spideryarn</title>") === "Hello · Spideryarn");

  /* ---- metaContent: attribute order, absence ---- */
  check(
    "metaContent finds content before the name/property attribute",
    metaContent('<meta content="a description" property="og:description">', "og:description") === "a description",
  );
  check("metaContent: null when no matching tag exists", metaContent("<meta charset='utf-8'>", "og:title") === null);

  /* ---- Fixture 1: a good public response — every relevant judge should pass ---- */
  const goodBody =
    '<html><head><title>My Great Article · Spideryarn</title>' +
    '<meta property="og:type" content="article">' +
    '<meta property="og:title" content="My Great Article">' +
    '<meta property="og:description" content="A description of the article.">' +
    '<meta property="og:url" content="https://www.spideryarn.com/read/my-great-article">' +
    '<meta name="twitter:card" content="summary">' +
    "</head><body>…</body></html>";
  const goodShaHeaders = createHash("sha256").update("the base shell bytes").digest("hex");
  const goodHead = parseHeaderDump(
    dump("HTTP/1.1 200 OK", {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-spideryarn-shell-sha256": goodShaHeaders,
      "x-robots-tag": "noindex, nofollow",
    }),
  );
  check("judgePublicHead: the good fixture passes clean", judgePublicHead(goodHead, goodBody, { slug: "my-great-article" }).length === 0, judgePublicHead(goodHead, goodBody, { slug: "my-great-article" }));
  check("judgeRobotsHeaderOnRead: the good fixture passes clean", judgeRobotsHeaderOnRead(goodHead).length === 0);

  /* ---- Fixture 2: a duplicated x-robots-tag ---- */
  const dupRobotsHead = parseHeaderDump(
    dump("HTTP/1.1 200 OK", {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-spideryarn-shell-sha256": goodShaHeaders,
      "x-robots-tag": ["noindex, nofollow", "index, follow"],
    }),
  );
  const dupRobotsProblems = judgeRobotsHeaderOnRead(dupRobotsHead);
  check("judgeRobotsHeaderOnRead: catches a doubled x-robots-tag", dupRobotsProblems.length > 0, dupRobotsProblems);

  /* ---- Fixture 3: the enhanced head missing (200, but never enhanced) ---- */
  const unenhancedBody = `<html><head><title>${DEFAULT_TITLE}</title></head><body>…</body></html>`;
  const unenhancedHead = parseHeaderDump(
    dump("HTTP/1.1 200 OK", {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-spideryarn-shell-sha256": goodShaHeaders,
    }),
  );
  /* `judgePublicHead` must fail on this page too, by a different route — it has
     no og:description, og:url or twitter:card at all. Two judges, two reasons,
     and neither is allowed to be the only thing standing between us and a
     preview that was never composed. */
  const unenhancedPublicProblems = judgePublicHead(unenhancedHead, unenhancedBody, { slug: "my-great-article" });
  check(
    "judgePublicHead: catches a 200 that was never enhanced",
    unenhancedPublicProblems.length > 0,
    unenhancedPublicProblems,
  );
  const missingEnhancementVerdict = judgeTitleAgainstArticle(unenhancedBody, "My Great Article");
  check(
    "judgeTitleAgainstArticle: catches a 200 that was never enhanced",
    /* Both halves, named specifically. "the array is non-empty" would pass on
       any single complaint, including one about the wrong thing entirely. */
    missingEnhancementVerdict.problems.some((p) => p.startsWith("title:")) &&
      missingEnhancementVerdict.problems.some((p) => p.startsWith("meta og:title:")),
    missingEnhancementVerdict,
  );

  /* ---- judgeTitleAgainstArticle: the actual point of this strengthening ---- */
  check(
    "judgeTitleAgainstArticle: the good fixture's title matches its own article payload",
    judgeTitleAgainstArticle(goodBody, "My Great Article").problems.length === 0,
    judgeTitleAgainstArticle(goodBody, "My Great Article"),
  );
  /* This is the case the old "just not the bare default" check could not see:
     a fully-enhanced, well-formed head — for the WRONG article. */
  const wrongArticleVerdict = judgeTitleAgainstArticle(goodBody, "A Totally Different Article");
  check(
    "judgeTitleAgainstArticle: catches a well-formed head enhanced from the wrong article",
    wrongArticleVerdict.problems.some((p) => p.includes("title:")) && wrongArticleVerdict.problems.some((p) => p.includes("og:title")),
    wrongArticleVerdict,
  );
  check(
    "judgeTitleAgainstArticle: clamps the article title the same way the server does (documentTitle / 120)",
    judgeTitleAgainstArticle(
      /* Spelled out, not built from `documentTitle`/`headText` — the judge
         calls those, so a body composed with them would agree with any
         behaviour they had, which is a positive case that cannot fail. 200 A's
         with no space to cut at: 64 then an ellipsis for the tab, a hard 120
         for the card. */
      `<title>${"A".repeat(64)}… · Spideryarn</title><meta property="og:title" content="${"A".repeat(120)}">`,
      "A".repeat(200),
    ).problems.length === 0,
  );
  /* **The case that was broken until it was written.** A correct server escapes
     the title on the way into the document; the expectation is built from a
     title that arrived as JSON and is not escaped. Comparing the two raw was a
     check that would have failed a correct server on any article whose title
     contains an ampersand or an apostrophe. */
  const punctuated = "Marks & Spencer's \"Big\" <Sale>";
  const escapedHeadBody =
    `<title>Marks &amp; Spencer&#39;s &quot;Big&quot; &lt;Sale&gt; · Spideryarn</title>` +
    `<meta property="og:title" content="Marks &amp; Spencer&#39;s &quot;Big&quot; &lt;Sale&gt;">`;
  const punctuatedVerdict = judgeTitleAgainstArticle(escapedHeadBody, punctuated);
  check(
    "judgeTitleAgainstArticle: a correctly escaped title matches its unescaped article title",
    punctuatedVerdict.problems.length === 0,
    punctuatedVerdict,
  );
  /* And the control on that control: decoding must not make everything match. */
  const stillWrongVerdict = judgeTitleAgainstArticle(escapedHeadBody, "Marks & Spencer's Small Sale");
  check(
    "judgeTitleAgainstArticle: decoding does not make a genuinely different title match",
    stillWrongVerdict.problems.length > 0,
    stillWrongVerdict,
  );
  check(
    "unescapeHead does not double-decode: &amp;lt; is the text '&lt;', not '<'",
    unescapeHead("&amp;lt;") === "&lt;",
    unescapeHead("&amp;lt;"),
  );

  /* ---- a blank article title: still checked exactly, never waived ----
     `meta.title` comes back empty (`??` preserves `""`) and *both* composers
     answer `Untitled` for it, so the expectations are known and the old
     downgrade to "not the bare default" is gone. Whitespace as well as empty,
     because a title of `"   "` is as titleless as one of `""` and both
     composers treat it that way.

     The three cases below are the mutation GPT Sol found alive in the
     downgraded version, split into its parts: it passed a head built from the
     **wrong article** with **no og:title at all**, because "present and not the
     bare default" is satisfied by almost anything. */
  const blankBody = `<title>Untitled · Spideryarn</title><meta property="og:title" content="Untitled">`;
  const blankTitleVerdict = judgeTitleAgainstArticle(blankBody, "   ");
  check(
    "judgeTitleAgainstArticle: a blank article title passes on the composers' own Untitled, and says so",
    blankTitleVerdict.problems.length === 0 && !!blankTitleVerdict.note,
    blankTitleVerdict,
  );
  const blankWrongTitleVerdict = judgeTitleAgainstArticle(
    `<title>Some Other Article · Spideryarn</title><meta property="og:title" content="Some Other Article">`,
    "",
  );
  check(
    "judgeTitleAgainstArticle: a blank article title still catches a head built from another article",
    blankWrongTitleVerdict.problems.some((p) => p.startsWith("title:")) &&
      blankWrongTitleVerdict.problems.some((p) => p.startsWith("meta og:title:")),
    blankWrongTitleVerdict,
  );
  const blankNoOgVerdict = judgeTitleAgainstArticle("<title>Untitled · Spideryarn</title>", "");
  check(
    "judgeTitleAgainstArticle: a blank article title still catches a missing og:title",
    blankNoOgVerdict.problems.length === 1 && blankNoOgVerdict.problems[0] === "meta og:title: missing",
    blankNoOgVerdict,
  );
  const blankButUnenhancedVerdict = judgeTitleAgainstArticle(unenhancedBody, "");
  check(
    "judgeTitleAgainstArticle: a blank article title still catches a genuinely unenhanced page",
    blankButUnenhancedVerdict.problems.length > 0,
    blankButUnenhancedVerdict,
  );

  /* ---- articleTitleFrom: the field this check moved to, pinned by shape ---- */
  /* **The mutation that would otherwise be invisible.** The deleted metadata
     payload carried `title` at the top level; the article payload carries it at
     `meta.title`. A repointed checker that kept reading the top-level key would
     report "no string title" against every healthy deployment — a checker
     failure wearing a deployment failure's clothes. Both shapes are fed in, and
     the wrong one has to be rejected. */
  const articleBody = JSON.stringify({ meta: { slug: "my-great-article", title: "My Great Article" }, blocks: [] });
  const fromArticle = articleTitleFrom(articleBody, "/api/public/article/x");
  check(
    "articleTitleFrom: reads meta.title out of an article payload",
    fromArticle.title === "My Great Article" && fromArticle.problems.length === 0,
    fromArticle,
  );
  const fromFlat = articleTitleFrom(JSON.stringify({ title: "My Great Article" }), "/api/public/article/x");
  check(
    "articleTitleFrom: refuses a top-level title — the deleted metadata shape is not this one",
    fromFlat.title === null && fromFlat.problems.length > 0,
    fromFlat,
  );
  /* A blank title is a *value*, not a failure: it is the downgrade path's input,
     and turning it into a problem here would make that path unreachable. */
  const fromBlank = articleTitleFrom(JSON.stringify({ meta: { title: "" } }), "/api/public/article/x");
  check(
    "articleTitleFrom: an empty meta.title is a title, not a problem",
    fromBlank.title === "" && fromBlank.problems.length === 0,
    fromBlank,
  );
  const fromHtml = articleTitleFrom("<html>not json at all</html>", "/api/public/article/x");
  check(
    "articleTitleFrom: a non-JSON body is a problem, never a silent null",
    fromHtml.title === null && fromHtml.problems.length > 0,
    fromHtml,
  );

  /* ---- Fixture 4: the private article's title leaking into the body ---- */
  const leakedTitle = "A Secret Diary Entry";
  const leakingBody = `<html><head><title>${DEFAULT_TITLE}</title></head><body><!-- ${leakedTitle} --></body></html>`;
  const leakProblems = judgeNoLeak("", leakingBody, leakedTitle);
  check("judgeNoLeak: catches the private title inside the body", leakProblems.length > 0, leakProblems);
  const noLeakProblems = judgeNoLeak("", `<html><head><title>${DEFAULT_TITLE}</title></head><body>…</body></html>`, leakedTitle);
  check("judgeNoLeak: passes clean when the title truly is absent", noLeakProblems.length === 0);

  /* ---- judgeDefaultShell: 404 default vs a leaking one ---- */
  const clean404Head = parseHeaderDump(
    dump("HTTP/1.1 404 Not Found", {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-spideryarn-shell-sha256": goodShaHeaders,
    }),
  );
  check("judgeDefaultShell: a clean 404 default shell passes", judgeDefaultShell(clean404Head, `<html><head><title>${DEFAULT_TITLE}</title></head></html>`, 404).length === 0);
  check(
    "judgeDefaultShell: catches an og:title that should not be there",
    judgeDefaultShell(clean404Head, `<html><head><title>${DEFAULT_TITLE}</title><meta property="og:title" content="leak"></head></html>`, 404).length > 0,
  );

  /* ---- judgeByteIdentical ---- */
  const bodyA = Buffer.from("same bytes");
  const bodyB = Buffer.from("different bytes");
  check("judgeByteIdentical: identical responses pass", judgeByteIdentical({ head: clean404Head, bodyBuffer: bodyA }, { head: clean404Head, bodyBuffer: bodyA }).length === 0);
  const identicalProblems = judgeByteIdentical({ head: clean404Head, bodyBuffer: bodyA }, { head: clean404Head, bodyBuffer: bodyB });
  check("judgeByteIdentical: catches a body that differs", identicalProblems.length > 0, identicalProblems);

  /* ---- judgeMalformedPath ---- */
  check("judgeMalformedPath: a 400 default shell passes", judgeMalformedPath(parseHeaderDump(dump("HTTP/1.1 400 Bad Request", {})), `<title>${DEFAULT_TITLE}</title>`).length === 0);
  check("judgeMalformedPath: a 500 fails", judgeMalformedPath(parseHeaderDump(dump("HTTP/1.1 500 Internal Server Error", {})), `<title>${DEFAULT_TITLE}</title>`).length > 0);
  check(
    "judgeMalformedPath: an enhanced title on a malformed path fails",
    judgeMalformedPath(parseHeaderDump(dump("HTTP/1.1 400 Bad Request", {})), "<title>Somehow Enhanced · Spideryarn</title>").length > 0,
  );

  /* ---- judgeHeadMatchesGet ---- */
  const getOk = { head: goodHead, bodyBuffer: Buffer.from(goodBody) };
  const headOk = {
    head: parseHeaderDump(dump("HTTP/1.1 200 OK", { "x-spideryarn-shell-sha256": goodShaHeaders, "content-length": String(Buffer.byteLength(goodBody)) })),
    bodyBuffer: Buffer.alloc(0),
  };
  check("judgeHeadMatchesGet: a correct HEAD passes", judgeHeadMatchesGet(getOk, headOk).length === 0);
  const headWrongLength = {
    head: parseHeaderDump(dump("HTTP/1.1 200 OK", { "x-spideryarn-shell-sha256": goodShaHeaders, "content-length": "1" })),
    bodyBuffer: Buffer.alloc(0),
  };
  const wrongLengthProblems = judgeHeadMatchesGet(getOk, headWrongLength);
  check("judgeHeadMatchesGet: catches a wrong content-length", wrongLengthProblems.length > 0, wrongLengthProblems);
  const headWithBody = { head: headOk.head, bodyBuffer: Buffer.from("oops") };
  check("judgeHeadMatchesGet: catches HEAD returning a body", judgeHeadMatchesGet(getOk, headWithBody).length > 0);

  /* ---- judgeShellHashMatches ---- */
  const indexBytes = Buffer.from("<html>the real shell</html>");
  const trueHash = createHash("sha256").update(indexBytes).digest("hex");
  const trueHashHead = parseHeaderDump(dump("HTTP/1.1 200 OK", { "x-spideryarn-shell-sha256": trueHash }));
  check("judgeShellHashMatches: a matching hash passes", judgeShellHashMatches(trueHashHead, indexBytes).length === 0);
  const wrongHashHead = parseHeaderDump(dump("HTTP/1.1 200 OK", { "x-spideryarn-shell-sha256": "0".repeat(64) }));
  check("judgeShellHashMatches: catches a byte added after the digest was taken", judgeShellHashMatches(wrongHashHead, indexBytes).length > 0);

  /* ---- judgeRobotsTxt ----
     **The shipped file is the first fixture, and it was not before.** This
     check rejected every `Allow:` line, `public/robots.txt` deliberately has
     two, and so it failed against a correct deployment from the day the preview
     hole shipped — found by running the script, 2026-09-02. Written out here
     rather than read from disk, because this script talks only to a deployment
     (see its header) and a fixture read from the repo would agree with whatever
     the repo said. */
  const shippedRobots =
    "User-agent: *\nDisallow: /\n\n" +
    "User-agent: facebookexternalhit\nAllow: /read/\nDisallow: /\n\n" +
    "User-agent: Twitterbot\nAllow: /read/\nDisallow: /\n";
  check(
    "judgeRobotsTxt: the shipped file — Disallow-all plus the two preview holes — passes",
    judgeRobotsTxt("text/plain; charset=utf-8", shippedRobots).length === 0,
    judgeRobotsTxt("text/plain; charset=utf-8", shippedRobots),
  );
  check(
    "judgeRobotsTxt: the older Disallow-all-and-nothing-else file still passes",
    judgeRobotsTxt("text/plain; charset=utf-8", "User-agent: *\nDisallow: /\n").length === 0,
  );
  check("judgeRobotsTxt: catches being served as text/html (the SPA ate it)", judgeRobotsTxt("text/html", "User-agent: *\nDisallow: /\n").length > 0);
  check(
    "judgeRobotsTxt: catches an Allow in the anonymous group, which is the real flip",
    judgeRobotsTxt("text/plain", "User-agent: *\nAllow: /read/\nDisallow: /\n").length > 0,
  );
  check(
    "judgeRobotsTxt: catches a third bot being let in beside the two",
    judgeRobotsTxt("text/plain", `${shippedRobots}\nUser-agent: Googlebot\nAllow: /read/\nDisallow: /\n`).length > 0,
  );
  check(
    "judgeRobotsTxt: catches the hole being widened past /read/",
    judgeRobotsTxt("text/plain", "User-agent: *\nDisallow: /\n\nUser-agent: Twitterbot\nAllow: /\nDisallow: /\n").length > 0,
  );
  check(
    "judgeRobotsTxt: catches the site-wide Disallow being dropped",
    judgeRobotsTxt("text/plain", "User-agent: *\nDisallow: /profile\n").length > 0,
  );
  check("judgeRobotsTxt: catches losing the anonymous group altogether", judgeRobotsTxt("text/plain", "User-agent: Twitterbot\nDisallow: /\n").length > 0);

  /* ---- judgeMethodNotAllowed ---- */
  check("judgeMethodNotAllowed: a correct 405 passes", judgeMethodNotAllowed(parseHeaderDump(dump("HTTP/1.1 405 Method Not Allowed", { allow: "GET, HEAD" }))).length === 0);
  check("judgeMethodNotAllowed: catches a missing Allow header", judgeMethodNotAllowed(parseHeaderDump(dump("HTTP/1.1 405 Method Not Allowed", {}))).length > 0);
  check("judgeMethodNotAllowed: catches the wrong status", judgeMethodNotAllowed(parseHeaderDump(dump("HTTP/1.1 200 OK", { allow: "GET, HEAD" }))).length > 0);

  /* ---- judgeCommitsMatch ---- */
  check("judgeCommitsMatch: matching commits pass", judgeCommitsMatch("a".repeat(40), "a".repeat(40)).length === 0);
  check("judgeCommitsMatch: catches a mismatch", judgeCommitsMatch("a".repeat(40), "b".repeat(40)).length > 0);
  check("judgeCommitsMatch: catches a missing commit", judgeCommitsMatch(null, "a".repeat(40)).length > 0);

  /* ---- judgeSpaFallback ---- */
  check("judgeSpaFallback: 200 + default title passes", judgeSpaFallback(parseHeaderDump(dump("HTTP/1.1 200 OK", {})), `<title>${DEFAULT_TITLE}</title>`).length === 0);
  check("judgeSpaFallback: catches a 404 (the rewrite swallowed the nested route)", judgeSpaFallback(parseHeaderDump(dump("HTTP/1.1 404 Not Found", {})), `<title>${DEFAULT_TITLE}</title>`).length > 0);

  say();
  say(`${failed === 0 ? GREEN : RED}${tally.PASS} passed, ${tally.FAIL} failed${OFF} out of ${tally.PASS + tally.FAIL} self-test cases.`);
  process.exit(failed === 0 ? 0 : 1);
}

/* ------------------------------------------------------------------ */
/* Arguments                                                            */
/* ------------------------------------------------------------------ */

const argv = process.argv.slice(2);
const has = (f: string) => argv.includes(f);
const flagValue = (f: string): string | undefined => {
  const inline = argv.find((a) => a.startsWith(`${f}=`));
  if (inline) return inline.slice(f.length + 1);
  const i = argv.indexOf(f);
  return i >= 0 ? argv[i + 1] : undefined;
};

/* ------------------------------------------------------------------ */
/* Live checks against a deployment                                    */
/* ------------------------------------------------------------------ */

/** Fold a request's own transport failure and a judge's problems into one list. */
function problemsOf(rs: readonly RawResponse[], judge: () => string[]): string[] {
  const errors = rs.map((r) => r.curlError).filter((e): e is string => !!e);
  return errors.length > 0 ? errors : judge();
}

/**
 * `GET /api/public/article/:slug`'s `meta.title` — the independent source of
 * truth {@link judgeTitleAgainstArticle} checks the head against. This is a
 * public route that is supposed to work, so anything short of a clean 200 with
 * a string title is reported as a problem, never silently treated as "no title
 * to compare against".
 *
 * The transport half only; the parsing is {@link articleTitleFrom}, which
 * `--self-test` covers.
 */
function fetchArticleTitle(host: string, slug: string): { title: string | null; problems: string[] } {
  const articleR = curlRequest(`${host}/api/public/article/${encodeURIComponent(slug)}`);
  const path = `/api/public/article/${slug}`;
  if (articleR.curlError) return { title: null, problems: [`GET ${path}: ${articleR.curlError}`] };
  if (articleR.head.status !== 200) return { title: null, problems: [`GET ${path} answered ${articleR.head.status ?? "(no status)"}, not 200`] };
  return articleTitleFrom(articleR.bodyText, path);
}

/** 1. Public slug — enhanced head, with its title checked against /api/public/article's. */
function checkPublicHead(host: string, publicSlug: string | undefined): void {
  if (!publicSlug) {
    skip("public slug — enhanced head", "no --public-slug given");
    return;
  }
  const r = curlRequest(`${host}/read/${encodeURIComponent(publicSlug)}`);
  const { title: articleTitle, problems: articleProblems } = fetchArticleTitle(host, publicSlug);

  let note: string | undefined;
  const problems = [
    ...articleProblems,
    ...problemsOf([r], () => {
      const headProblems = judgePublicHead(r.head, r.bodyText, { slug: publicSlug });
      if (articleTitle === null) return headProblems;
      const titleVerdict = judgeTitleAgainstArticle(r.bodyText, articleTitle);
      note = titleVerdict.note;
      return [...headProblems, ...titleVerdict.problems];
    }),
  ];
  report("public slug — enhanced head", problems, note);
}

/** 2. Known private slug — default shell, and (only with --private-title) no title leak. */
function checkPrivateSlug(host: string, privateSlug: string | undefined, privateTitle: string | undefined): RawResponse | null {
  if (!privateSlug) {
    skip("known private slug — default shell", "no --private-slug given");
    skip("known private slug — title does not leak", "no --private-slug given");
    return null;
  }
  const r = curlRequest(`${host}/read/${encodeURIComponent(privateSlug)}`);
  report("known private slug — default shell", problemsOf([r], () => judgeDefaultShell(r.head, r.bodyText, 404)));

  if (!privateTitle) {
    skip(
      "known private slug — title does not leak",
      "no --private-title given — this script has no way to know the private title without you supplying it",
    );
  } else {
    report("known private slug — title does not leak", problemsOf([r], () => judgeNoLeak(r.headDump, r.bodyText, privateTitle)));
  }
  return r;
}

/** 3. A random valid-looking slug that does not exist — same as private, byte-identical. */
function checkRandomNonexistent(host: string, privateSlug: string | undefined, privateResponse: RawResponse | null): void {
  if (!privateSlug) {
    skip("random nonexistent slug — matches the private response", "no --private-slug given to compare against");
    return;
  }
  const randomSlug = `deploy-check-nonexistent-${randomHex(6)}`;
  const r = curlRequest(`${host}/read/${randomSlug}`);
  report(
    "random nonexistent slug — matches the private response",
    problemsOf([r], () => {
      const problems = judgeDefaultShell(r.head, r.bodyText, 404);
      if (privateResponse && !privateResponse.curlError) {
        problems.push(...judgeByteIdentical({ head: r.head, bodyBuffer: r.bodyBuffer }, { head: privateResponse.head, bodyBuffer: privateResponse.bodyBuffer }));
      }
      return problems;
    }),
  );
}

/** 4. Malformed paths, with --path-as-is: upper-case, literal %2F, double-encoded %252F. */
function checkMalformedPaths(host: string): void {
  const malformedBase = "deploy-check-malformed-slug";
  const variants = [
    ["UPPER-CASE slug", malformedBase.toUpperCase()],
    ["literal %2F", `${malformedBase}%2Fmore`],
    ["double-encoded %252F", `${malformedBase}%252Fmore`],
  ] as const;
  for (const [label, segment] of variants) {
    const r = curlRequest(`${host}/read/${segment}`);
    report(`malformed path — ${label}`, problemsOf([r], () => judgeMalformedPath(r.head, r.bodyText)), `status: ${r.head.status ?? "(none)"}`);
  }
}

/** 5. HEAD matches GET, for the public slug. */
function checkHeadMatchesGet(host: string, publicSlug: string | undefined): void {
  if (!publicSlug) {
    skip("HEAD matches GET", "no --public-slug given");
    return;
  }
  const url = `${host}/read/${encodeURIComponent(publicSlug)}`;
  const getR = curlRequest(url, "GET");
  const headR = curlRequest(url, "HEAD");
  report("HEAD matches GET", problemsOf([getR, headR], () => judgeHeadMatchesGet(getR, headR)));
}

/** 6. Embedded shell equals served shell. */
function checkShellHash(host: string, publicSlug: string | undefined): void {
  if (!publicSlug) {
    skip("embedded shell hash matches the served shell", "no --public-slug given (needs a /read/ response to read the header from)");
    return;
  }
  const readR = curlRequest(`${host}/read/${encodeURIComponent(publicSlug)}`);
  const indexR = curlRequest(`${host}/index.html`);
  report("embedded shell hash matches the served shell", problemsOf([readR, indexR], () => judgeShellHashMatches(readR.head, indexR.bodyBuffer)));
}

/** 7a. Robots, unchanged, on the public /read/ response. 7b. robots.txt itself, no slug needed. */
function checkRobots(host: string, publicSlug: string | undefined): void {
  if (!publicSlug) {
    skip("x-robots-tag on the public /read/ response", "no --public-slug given");
  } else {
    const r = curlRequest(`${host}/read/${encodeURIComponent(publicSlug)}`);
    report("x-robots-tag on the public /read/ response", problemsOf([r], () => judgeRobotsHeaderOnRead(r.head)));
  }

  const r = curlRequest(`${host}/robots.txt`);
  const contentType = headerValues(r.head, "content-type")[0] ?? "";
  report("/robots.txt is unchanged (text/plain, Disallow: /)", problemsOf([r], () => judgeRobotsTxt(contentType, r.bodyText)));
}

/** A `{commit}` or `{build: {commit}}` shape — accepted either way, matching scripts/deploy-checks.ts's HealthBody. */
function commitFrom(json: string): string | null {
  try {
    const parsed = JSON.parse(json) as { commit?: string | null; build?: { commit?: string | null } };
    return parsed.commit ?? parsed.build?.commit ?? null;
  } catch {
    return null;
  }
}

/** 8. /build.json and /api/health name the same commit. */
function checkCommitsMatch(host: string): void {
  const health = curlRequest(`${host}/api/health`);
  const build = curlRequest(`${host}/build.json`);
  const healthCommit = health.curlError ? null : commitFrom(health.bodyText);
  const buildCommit = build.curlError ? null : commitFrom(build.bodyText);
  report(
    "/build.json and /api/health name the same commit",
    problemsOf([health, build], () => judgeCommitsMatch(healthCommit, buildCommit)),
    `health=${healthCommit ?? "?"} build.json=${buildCommit ?? "?"}`,
  );
}

/** 9. /read/:slug/metadata falls through to the SPA, not to our function. */
function checkMetadataFallback(host: string, anySlug: string): void {
  const r = curlRequest(`${host}/read/${encodeURIComponent(anySlug)}/metadata`);
  report("/read/:slug/metadata falls through to the SPA", problemsOf([r], () => judgeSpaFallback(r.head, r.bodyText)));
}

/**
 * 10. A method other than GET/HEAD is refused with 405. From the Case table in
 * the spec this script was written against, though it is not one of the nine
 * numbered checks in "The checks" section — included anyway because the case
 * table is explicit about it and a missing 405/Allow guard is cheap to catch
 * here.
 */
function checkMethodNotAllowed(host: string, anySlug: string): void {
  const r = curlRequest(`${host}/read/${encodeURIComponent(anySlug)}`, "POST");
  report("POST /read/:slug is refused with 405", problemsOf([r], () => judgeMethodNotAllowed(r.head)));
}

async function main(): Promise<void> {
  if (has("--self-test")) {
    runSelfTest();
    return;
  }

  const host = (flagValue("--host") ?? "https://www.spideryarn.com").replace(/\/+$/, "");
  const publicSlug = flagValue("--public-slug");
  const privateSlug = flagValue("--private-slug");
  const privateTitle = flagValue("--private-title");
  const anySlug = publicSlug ?? privateSlug ?? "deploy-check-fallback-slug";

  step(`Checking ${host}`);

  checkPublicHead(host, publicSlug);
  const privateResponse = checkPrivateSlug(host, privateSlug, privateTitle);
  checkRandomNonexistent(host, privateSlug, privateResponse);
  checkMalformedPaths(host);
  checkHeadMatchesGet(host, publicSlug);
  checkShellHash(host, publicSlug);
  checkRobots(host, publicSlug);
  checkCommitsMatch(host);
  checkMetadataFallback(host, anySlug);
  checkMethodNotAllowed(host, anySlug);

  say();
  const summaryColour = tally.FAIL > 0 ? RED : tally.SKIP > 0 ? YELLOW : GREEN;
  say(`${summaryColour}${tally.PASS} passed, ${tally.FAIL} failed, ${tally.SKIP} skipped${OFF}`);
  if (tally.SKIP > 0) say(`${YELLOW}${tally.SKIP} check(s) skipped — supply the missing --public-slug/--private-slug/--private-title to run them.${OFF}`);

  process.exit(tally.FAIL > 0 ? 1 : 0);
}

/**
 * **Only when this file is what was run**, and it was unconditional until
 * 2026-09-02.
 *
 * Every function above is exported so it can be exercised in isolation, and the
 * `--self-test` mode exists precisely so somebody can. But a bare `main()` at
 * module scope means *importing* one of those exports runs the whole suite —
 * against `https://www.spideryarn.com`, because that is the default host. That
 * happened while reviewing this file: a one-line import to try a single judge
 * issued a dozen requests to production, including the POST that the 405 check
 * is. Nothing was written and nothing could have been; it was still not what
 * anybody asked for.
 *
 * `process.argv[1]` rather than a bundler's `import.meta.main`, which `tsx`
 * does not define.
 */
const RUN_DIRECTLY =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);

if (RUN_DIRECTLY) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
