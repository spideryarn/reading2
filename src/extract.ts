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
import { fileURLToPath } from "node:url";
import { fetchHtml } from "./fetch.js";
import { slugFromUrl } from "./ingest.js";
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
 */
const escapeHtml = (s: string): string =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );

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
}

/**
 * Stage 2 — Readability over already-fetched HTML, and the artefacts that fall
 * out of it.
 *
 * `html` is passed in rather than fetched here so that this stage is a pure
 * function of bytes we already hold: re-running it costs nothing and asks
 * nobody's server for anything. The queue relies on that.
 */
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
  const dom = new JSDOM(opts.html, {
    url: opts.url,
    virtualConsole: new VirtualConsole(),
  });
  const article = new Readability(dom.window.document).parse();
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
  const meta: Meta = {
    slug,
    title: article.title ?? slug,
    ...(article.byline ? { byline: article.byline } : {}),
    ...(article.siteName ? { siteName: article.siteName } : {}),
    ...(article.lang ? { lang: article.lang } : {}),
    url: opts.url,
    fetchedAt: new Date().toISOString(),
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
  console.log(`Excerpt: ${result.excerpt}`);
  console.log(`\nWritten to: ${path.resolve(result.outFile)}`);
  console.log(`            ${path.resolve("data", result.slug, "meta.json")}`);
}

/* Compared as resolved paths, not by suffix. `import.meta.url.endsWith(basename)`
   also matches when a *different* entry file with the same basename imports this
   module — `scripts/arc.ts` importing `src/arc.ts` would run the CLI as a side
   effect of the import, which is the one thing this guard exists to prevent. */
const isMain =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) void main();
