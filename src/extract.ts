/**
 * Stage 2 — Readability over a page somebody else fetched.
 *
 * Writes the standalone debug page (`output/<slug>.html`, which stage 3 reads)
 * and `data/<slug>/meta.json`, which is what everything downstream knows the
 * article *by* — its title, who wrote it, where it came from and when. See
 * docs/project/content-extraction.md and docs/project/library.md.
 *
 * Stage 1 is src/fetch.ts and is somebody else's problem, deliberately: getting
 * bytes off the open web safely is a subject of its own (docs/project/fetching.md).
 * The CLI below calls it; the queue calls it as a separate step and keeps what
 * it got, so a bad extraction can be retried without asking the publisher again.
 *
 * **Two callers, one code path.** `npm run extract -- <url>` runs `main()`
 * below; the ingest queue (src/pipeline.ts) calls `runExtract` directly, in the
 * server process. They must not drift, so the CLI is a thin
 * argv wrapper around the same two functions and nothing else.
 *
 * Nothing here is top-level `await`, deliberately — for the reason spelled out
 * at `main()` in src/blocks.ts. With one, this module becomes an async module,
 * and importing it would also *run* it.
 */
import { JSDOM, VirtualConsole } from "jsdom";
import { Readability } from "@mozilla/readability";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fetchHtml } from "./fetch.js";
import { escapeHtml } from "./html.js";
import { slugFromUrl } from "./ingest.js";
import { isMain } from "./is-main.js";
import { canonicaliseNotes, type NoteStats } from "./notes.js";
import { sanitizeHtml } from "./sanitize.js";
import type { Meta } from "./types.js";

/**
 * Text going into markup, made text again.
 *
 * Readability hands back `title`, `byline`, `siteName` and `lang` as strings it
 * took the *textContent* of, and that reads as safe. It is not: textContent
 * decodes entities, so a page whose `<title>` says
 * `Real&lt;/title&gt;&lt;img src=x onerror=…&gt;` gives us back a string with a
 * real `</title>` and a real `<img>` in it, and writing that into a template
 * puts them back in the document. Verified against real Readability output in
 * tests/extract-sanitize.test.ts, which is also where the byline — interpolated
 * straight into a `<div>` — was confirmed to be a working `<img onerror>`.
 *
 * All five characters, not the three that "look like markup". `"` is what holds
 * `lang` inside its attribute, and the source page's `lang` is the only one of
 * these that lands in an attribute rather than in text.
 *
 * **The function itself moved to [`src/html.ts`](html.ts)** on 2026-08-29,
 * unchanged, when stage 2 of the public-link work needed a third caller: a
 * serverless function composing a `<head>` before the bundle loads. This copy
 * and the one still in `pdf-read.ts` had already drifted apart by one character
 * class, which is the argument for a shared module rather than a fourth copy.
 */

/**
 * The standalone, styled debug page. Not what the reading view renders — and
 * that is exactly why it was the last unsanitised thing in the pipeline.
 *
 * Stage 3 sanitises before it mints ids, and it rewrites this same file, so for
 * a while the argument was that the window is only between the two commands.
 * The window is where the file is *for*: `npm run extract -- <url>` prints the
 * path and the next thing anybody does is open it. Readability is not a
 * sanitiser and says so; `<img onerror>` and `<span onmouseover>` come through
 * it intact, and an `onerror` on a bogus src fires on load with no click.
 *
 * Sanitising the **content string** rather than the assembled document, for two
 * reasons. It is the canonical DOMPurify call and the one that gets the
 * scrutiny (src/sanitize.ts says why the string path won here). And the
 * template's own `<style>` is in the `<head>`, which the policy forbids in
 * source markup — running the whole page through would leave a debug page that
 * still opens and has lost its looks, which is how that mistake would survive.
 *
 * The result is concatenated into `<body>`, an ordinary element context. Never
 * move it inside `<xmp>`, `<noscript>` or any other raw-text element: re-parsing
 * sanitised output in one of those is CVE-2026-65914's shape, and
 * docs/project/security.md has the rule.
 *
 * Stage 3 is unaffected. It sanitises whatever it is handed, so a body that
 * arrives clean is a no-op for it and blocks.json comes out identical — pinned
 * in tests/extract-sanitize.test.ts rather than assumed, because the two stages
 * share this file and stage 3 writes block ids back into it.
 */
type Maybe = string | null | undefined;
function debugPage(article: {
  title: Maybe;
  byline: Maybe;
  siteName: Maybe;
  lang: Maybe;
  length: number | null | undefined;
  content: Maybe;
}): string {
  const text = (s: Maybe) => escapeHtml(s ?? "");
  return `<!doctype html>
<html lang="${text(article.lang) || "en"}">
<head>
<meta charset="utf-8">
<title>${text(article.title) || "Untitled"}</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  body {
    max-width: 700px;
    margin: 3rem auto;
    padding: 0 1.5rem;
    font-family: Georgia, "Times New Roman", serif;
    line-height: 1.6;
    color: #222;
    background: #fdfdfb;
  }
  h1 { font-size: 2rem; line-height: 1.2; margin-bottom: 0.25rem; }
  .meta { color: #777; font-family: -apple-system, sans-serif; font-size: 0.9rem; margin-bottom: 2rem; }
  img { max-width: 100%; height: auto; }
  figure { margin: 1.5rem 0; }
  figcaption { font-size: 0.85rem; color: #777; font-family: -apple-system, sans-serif; }
  a { color: #0645ad; }
  pre { overflow-x: auto; background: #f4f4f4; padding: 1rem; }
  blockquote { border-left: 3px solid #ccc; margin-left: 0; padding-left: 1rem; color: #555; }
</style>
</head>
<body>
<h1>${text(article.title)}</h1>
<div class="meta">
  ${article.byline ? `${text(article.byline)} &middot; ` : ""}${text(article.siteName)}
  ${article.length ? `&middot; ~${Math.round(article.length / 5 / 200)} min read` : ""}
</div>
${sanitizeHtml(article.content ?? "")}
</body>
</html>`;
}

/** Where `npm run extract -- <url>` puts its HTML when you don't say. */
export function defaultOutFile(url: string): string {
  return `output/${slugFromUrl(url) || "article"}.html`;
}

/**
 * The slug an output filename implies.
 *
 * Taken from the OUTPUT FILE rather than from the URL, which looks like the
 * long way round given `defaultOutFile` just derived the filename from the URL
 * — but it is the only spelling that cannot drift. Stage 3 names its blocks
 * file after the HTML file, and stage 4 names the data directory after *that*
 * (src/toc.ts). So the basename here is what the rest of the pipeline will call
 * this article, whether it was chosen by us or passed in on the command line.
 * Deriving it from the URL a second time would put meta.json in the
 * right-looking directory for `npm run extract <url>` and in the wrong one the
 * moment anybody passed an explicit filename — and the only symptom would be an
 * article with no byline.
 */
export function slugForOutFile(outFile: string): string {
  return path.basename(outFile).replace(/\.[^.]+$/, "");
}

export interface ExtractResult {
  slug: string;
  outFile: string;
  meta: Meta;
  /** Readability's own character count, for the log line. */
  length: number | null;
  excerpt: string | null;
  /** What the footnote canonicalisation did — see src/notes.ts. */
  notes: NoteStats;
}

/**
 * **Un-hide `aria-hidden="true"` before Readability looks at the page.**
 *
 * Readability's visibility check (`Readability.js:2701`) skips any node marked
 * `aria-hidden="true"`, along with `[hidden]` and inline `display: none`. That
 * is right for an off-screen menu and wrong for a **collapsed section of the
 * article**: an accordion is closed, not absent, and a reader would see the text
 * by clicking on it. Readability cannot click.
 *
 * Measured over the fifteen pages in evals/extraction/fixtures/ (run
 * `npx tsx evals/extraction/corpus.mts`), removing the attribute does exactly
 * two things and is byte-for-byte inert on the other thirteen:
 *
 * 1. **anthropic.com/constitution: 39,355 characters come back** — a quarter of
 *    the article. Three `ExpandableSection` divs holding *Claude's three types
 *    of principals*, the verification passage and the hard constraints. Real
 *    body text, collapsed by default, invisible to every stage after this one.
 * 2. **Wikipedia: non-empty accessible names come back on 188 formula images.**
 *    Wikipedia writes each formula twice — MathML inside `style="display: none"`
 *    for assistive tech, and a fallback `<img aria-hidden="true">` for eyes.
 *    Readability drops the MathML (inline `display: none`, which this does NOT
 *    touch) and keeps the image, so the attribute ends up pointing at an
 *    accessible twin that no longer exists, leaving all 188 with no accessible
 *    name. Checked through the real sanitiser, not inferred: 208 images
 *    reach the reading view, 188 of them carrying `alt` text, and `aria-hidden`
 *    goes 188 → 0. **Stated no further than that**, at GPT Sol's insistence: not
 *    "audible", not "an accessibility win". The `alt` is raw TeX
 *    (`{\displaystyle {\text{Loss}}=-\sum …`), and no browser accessibility
 *    inspection and no screen reader were run.
 *
 * **`[hidden]` is deliberately not touched**, though the first version of this
 * removed it too. Across the same fifteen pages it changed exactly one, arxiv.org
 * abs, and what it added was 95 characters of *furniture*: "View a PDF of the
 * paper titled …", a screen-reader label for a link. That is the whole measured
 * effect, and it is a regression — caught only because the arm was compared
 * document-against-document rather than by counting recovered characters, which
 * scored it as a gain. The distinction that matters: `hidden` is the HTML spec's
 * own "not currently relevant" and authors mean it, whereas `aria-hidden` is an
 * accessibility annotation, and the visual/assistive split is exactly where
 * readable text gets marked invisible to a parser.
 *
 * Inline `display: none` is left alone for the same reason — it is a stronger
 * claim, and stripping it on Wikipedia would restore 188 MathML formulas *beside*
 * the 188 images that already render them.
 *
 * **What this is known to let in, and the corpus cannot see.** A navigation
 * drawer hidden by external CSS only — `aria-hidden="true"` on the container, no
 * `[hidden]`, no inline `display: none` — is admitted when it sits *inside* the
 * article container; outside it, link density sinks it either way. GPT Sol's
 * counter-example, reproduced, and at thirty items it is 1,370 characters. None
 * of the fifteen fixtures contains the pattern, so "byte-identical on thirteen"
 * says nothing about how often it happens. Pinned as behaviour rather than as a
 * safety claim in tests/extract-unhide.test.ts, so changing the rule changes an
 * expectation instead of changing nothing. Backing this out is deleting one call.
 *
 * The design not taken, and the one to revisit if that pattern turns up: strip
 * the attribute, parse, then **restore it** on surviving nodes — Sol's argument,
 * that extraction and accessibility are separate decisions and this conflates
 * them. Blanket restore is also wrong (it would re-hide the 39,355 recovered
 * characters from the accessibility tree), so the real design is a three-way
 * rule: keep the removal on recovered content regions, restore on decorative or
 * duplicate leaves, special-case a fallback image whose accessible twin did not
 * survive. That is more than this change is worth today.
 *
 * Exported because evals/extraction/inventory.mts scores this arm and must score
 * the code that ships, not a second copy of it.
 */
export function unhideCollapsedSections(doc: Document): void {
  for (const el of Array.from(doc.querySelectorAll('[aria-hidden="true"]'))) {
    el.removeAttribute("aria-hidden");
  }
}

/**
 * Stage 2 — Readability over already-fetched HTML, and the artefacts that fall
 * out of it.
 *
 * `html` is passed in rather than fetched here so that this stage is a pure
 * function of bytes we already hold: re-running it costs nothing and asks
 * nobody's server for anything. The queue relies on that.
 */
/**
 * **Everything stage 2 does to a page before anything is written down** — the
 * DOM prep and the Readability call, with no filesystem, no metadata and no
 * side effect.
 *
 * Split out of `runExtract` on 2026-08-31 because two eval instruments were
 * re-deriving it and got it wrong. `evals/extraction/probe.mts` and
 * `tidy.mts` each did `unhide → Readability → split`, missing
 * `canonicaliseNotes` — and the cost of that omission was not theoretical:
 * `acx_footnotes.html` reports **18 stranded footnote-marker blocks** through
 * the instruments' version and **zero** through this one, because
 * canonicalisation is precisely what turns those markers into notes. An
 * instrument measuring a pipeline that does not exist reported a failure the
 * real pipeline had already fixed, and nothing could have caught it except
 * running the two side by side. Found by GPT Sol's review.
 *
 * So the order below is the contract, not an implementation detail, and it has
 * exactly one home.
 *
 * `article` is `null` when Readability declines the page — the caller decides
 * whether that is an error (`runExtract`: yes) or a row in a table (an eval:
 * no). It is deliberately not thrown from here.
 */
export function readArticle(
  html: string,
  url: string,
): { article: ReturnType<Readability["parse"]>; notes: NoteStats } {
  /* **A `VirtualConsole` with nothing attached to it**, and this is not tidiness.
     JSDOM's default forwards its own errors straight to `console`, and one of
     them quotes the page: a malformed `@import` produces `Could not parse CSS
     @import URL "<whatever the page said>" relative to base URL "<the full
     source URL, query string included>"`. That is fetched-page-controlled text
     and a possibly private URL on the server's stderr, going round Pino,
     `errorFields` and redaction alike — none of which can reach a string
     somebody else's library printed.

     Ordinary CSS parse failures print a fixed sentence and are harmless; it is
     the `@import` branch that carries the page's own words. Dropping the lot is
     right anyway: we are here for the article text, and JSDOM's opinion of a
     stylesheet is not something anybody running this needs.

     Found by a GPT Sol review that reproduced it, 2026-08-26 — the fourth round
     of the same class, and the first one where the leak was a dependency's
     rather than ours. See docs/project/logging.md. */
  const dom = new JSDOM(html, { url, virtualConsole: new VirtualConsole() });
  unhideCollapsedSections(dom.window.document);
  /* Before Readability, and it has to be: Readability's `keepClasses: false`
     takes the identifying classes off, and the sanitiser downstream of it
     deletes the `<label>`/`<input>` that Tufte's sidenotes are made of. By stage
     3 there is nothing left to recognise a note by. See src/notes.ts. */
  const notes = canonicaliseNotes(dom.window.document);
  return { article: new Readability(dom.window.document).parse(), notes };
}

/**
 * An ISO-8601 date, optionally with a time, optionally with a zone.
 *
 * Deliberately narrow. Readability's `publishedTime` comes off
 * `<meta property="article:published_time">` or JSON-LD `datePublished`, both of
 * which are ISO by convention — but it is whatever the page said, and a page can
 * say `"Last updated Tuesday"`.
 */
const ISO_DATE =
  /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)(Z|[+-]\d{2}:?\d{2})?)?$/;

/**
 * Readability's `publishedTime`, kept if it is a date and dropped if it is prose.
 *
 * **Kept in the publisher's own zone rather than converted to UTC**, which is
 * the one decision in this function. `new Date(s).toISOString()` looks like the
 * obvious normalisation and it moves the calendar day: a piece published at 8pm
 * on 31 December in New York becomes 1 January, and the calendar day is exactly
 * what this field is for — Timeline reads the year off the front of it to date
 * every "on July 7" the article never gives a year for
 * (docs/plans/timeline-mode.md § The reference frame). A day that shifts by
 * zone is a year that shifts at the boundary. The only normalising done here is
 * of spelling, never of instant: a space separator becomes `T`, and `+0000`
 * becomes `+00:00`.
 *
 * **An unrecognised string is dropped, not guessed at.** `Date.parse` will
 * happily take `"July 7, 2026"` and interpret it in the *server's* local zone,
 * so a date we cannot read as ISO is worse than no date: the no-frame path is
 * already the common one and is honest, where a silently wrong frame would
 * misdate every year-less event in the piece and look like a fact.
 *
 * Whatever comes back is the publisher's claim, not a verified one.
 */
export function publicationDate(raw: Maybe): string | undefined {
  const m = ISO_DATE.exec((raw ?? "").trim());
  if (!m) return undefined;
  const [, day, time, zone] = m;
  /* A well-formed shape is not a real date — `2026-02-31` matches the pattern.
     Round-tripping the day through Date is the cheap check, and it is done on
     the day alone (which parses as UTC, per the ECMAScript date-only rule) so
     that no zone arithmetic can move it. */
  const parsed = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || !parsed.toISOString().startsWith(`${day}T`)) {
    return undefined;
  }
  if (!time) return day;
  /* `+0000` and `+00:00` are the same offset in two of ISO 8601's spellings,
     and two spellings of one fact is a fingerprint that changes when nothing
     did. The extended form is what everything else here writes. */
  const offset =
    zone && zone !== "Z" && !zone.includes(":")
      ? `${zone.slice(0, 3)}:${zone.slice(3)}`
      : zone;
  return `${day}T${time}${offset ?? ""}`;
}

export async function runExtract(opts: {
  html: string;
  url: string;
  outFile?: string;
  /**
   * Where `meta.json` goes. Passed in rather than assumed, because `data/…`
   * relative to the process's cwd is only `<repo>/data/…` when you happen to
   * have started in the repo root — and the queue checks for the file at an
   * absolute path (src/pipeline.ts). A server started from anywhere else would
   * write the metadata somewhere the pipeline never looks, and the step would
   * still go green.
   */
  dataDir?: string;
}): Promise<ExtractResult> {
  const outFile = opts.outFile ?? defaultOutFile(opts.url);
  const slug = slugForOutFile(outFile);

  /* **A `VirtualConsole` with nothing attached to it**, and this is not tidiness.
     JSDOM's default forwards its own errors straight to `console`, and one of
     them quotes the page: a malformed `@import` produces `Could not parse CSS
     @import URL "<whatever the page said>" relative to base URL "<the full
     source URL, query string included>"`. That is fetched-page-controlled text
     and a possibly private URL on the server's stderr, going round Pino,
     `errorFields` and redaction alike — none of which can reach a string
     somebody else's library printed.

     Ordinary CSS parse failures print a fixed sentence and are harmless; it is
     the `@import` branch that carries the page's own words. Dropping the lot is
     right anyway: we are here for the article text, and JSDOM's opinion of a
     stylesheet is not something anybody running this needs.

     Found by a GPT Sol review that reproduced it, 2026-08-26 — the fourth round
     of the same class, and the first one where the leak was a dependency's
     rather than ours. See docs/project/logging.md. */
  const { article, notes } = readArticle(opts.html, opts.url);
  if (!article) {
    throw new Error("Readability could not parse this page.");
  }

  await mkdir(path.dirname(outFile), { recursive: true });
  await writeFile(outFile, debugPage(article), "utf-8");

  /* meta.json is the article's identity — the only place the source URL, the
     byline and the fetch date survive past this stage. Written straight into
     `data/<slug>/`, beside the artefacts the later stages put there, because it
     is where the server looks (src/api.ts) and because a piece of provenance
     left in `output/` would be scratch. Written on every run: re-extracting is
     how you refresh a page, and the fetch date should follow. */
  /* Readability has been handing `publishedTime` back all along and this stage
     dropped it on the floor. It is the reference frame for every year-less date
     in the piece — the field's note in src/types.ts says why it is not
     `fetchedAt`, and `publicationDate` above why it is not converted to UTC. */
  const publishedAt = publicationDate(article.publishedTime);
  const meta: Meta = {
    slug,
    title: article.title ?? slug,
    ...(article.byline ? { byline: article.byline } : {}),
    ...(article.siteName ? { siteName: article.siteName } : {}),
    ...(article.lang ? { lang: article.lang } : {}),
    url: opts.url,
    fetchedAt: new Date().toISOString(),
    ...(publishedAt ? { publishedAt } : {}),
    ...(article.excerpt ? { excerpt: article.excerpt } : {}),
  };
  const metaFile = path.join(opts.dataDir ?? path.join("data", slug), "meta.json");
  await mkdir(path.dirname(metaFile), { recursive: true });
  await writeFile(metaFile, `${JSON.stringify(meta, null, 2)}\n`, "utf-8");

  return {
    slug,
    outFile,
    meta,
    length: article.length ?? null,
    excerpt: article.excerpt ?? null,
    notes,
  };
}

async function main(): Promise<void> {
  const url = process.argv[2];
  if (!url) {
    console.error("Usage: tsx src/extract.ts <url> [outFile]");
    process.exit(1);
  }
  const outFile = process.argv[3] ?? defaultOutFile(url);

  const html = await fetchHtml(url);
  const result = await runExtract({ html, url, outFile });

  console.log(`Title: ${result.meta.title}`);
  console.log(`Byline: ${result.meta.byline}`);
  console.log(`Site: ${result.meta.siteName}`);
  console.log(`Length (chars): ${result.length}`);
  console.log(
    `Notes: ${result.notes.notes} (${result.notes.markers} markers, ` +
      `${JSON.stringify(result.notes.shapes)})`,
  );
  console.log(`Excerpt: ${result.excerpt}`);
  console.log(`\nWritten to: ${path.resolve(result.outFile)}`);
  console.log(`            ${path.resolve("data", result.slug, "meta.json")}`);
}

if (isMain(import.meta.url)) void main();
