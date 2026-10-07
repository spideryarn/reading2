// What src/reader-comments.ts changes, page by page: stage 2's whole result from two checkouts of
// src/extract.ts, side by side. Plan 261007k.
//
// Usage: npx tsx evals/extraction/comments-arms.mts <base-extract.ts> [--pages=<urls.tsv>] [file.html ...]
//   <base-extract.ts>  extract.ts of a tree without the pass, e.g.
//                      mkdir -p /tmp/base && git archive <commit> src package.json tsconfig.json | tar -x -C /tmp/base
//                      && ln -s "$PWD/node_modules" /tmp/base/node_modules   →   /tmp/base/src/extract.ts
//   --pages            a TSV of `<file>\t<url>` (evals/extraction/comments/pages.tsv), resolved
//                      against the TSV's own directory; fetch them with comments/fetch.sh
//   file.html ...      corpus fixtures; their URL comes from corpus.mts, as the page was fetched
//
// Compared: everything readArticle returns except this pass's one new `removed` key — the article's
// content, title, byline, excerpt, site name, date, language and direction, the authors, the page's
// own ids, the old removal keys, the note, callout and protect audits, and the refusal. The new
// count is printed. FULL=1 prints the whole text of a page that differs. Any difference exits 1.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { JSDOM, VirtualConsole } from "jsdom";
import { readArticle } from "../../src/extract.js";
import { READER_COMMENTS_KEY } from "../../src/reader-comments.js";
import { ALL_FIXTURES } from "./corpus.mjs";

const args = process.argv.slice(2);
const basePath = args.shift();
if (!basePath) throw new Error("usage: comments-arms.mts <base-extract.ts> [--pages=<tsv>] [file.html ...]");
const base = (await import(basePath)) as { readArticle: typeof readArticle };

const inputs: { file: string; url: string }[] = [];
for (const a of args) {
  if (a.startsWith("--pages=")) {
    const tsv = a.slice("--pages=".length);
    for (const line of (await readFile(tsv, "utf8")).split("\n")) {
      const [file, url] = line.split("\t");
      if (file && url && !file.startsWith("#")) inputs.push({ file: path.resolve(path.dirname(tsv), file), url });
    }
  } else {
    const fx = ALL_FIXTURES.find((f) => f.file === path.basename(a));
    if (!fx) throw new Error(`${a} is not a corpus fixture; pass it in a --pages TSV with its URL`);
    inputs.push({ file: a, url: fx.url });
  }
}
if (inputs.length === 0) throw new Error("no pages to compare; pass a --pages TSV and/or corpus fixtures");

const text = (html: string) =>
  (new JSDOM(`<body>${html}</body>`, { virtualConsole: new VirtualConsole() }).window.document.body.textContent ?? "")
    .replace(/\s+/g, " ")
    .trim();

/** Everything but this pass's one new audit count, as one comparable string. */
function contract(r: ReturnType<typeof readArticle>): string {
  const { refusal, removed, ...rest } = r;
  const comparableRemoved = { ...removed };
  delete comparableRemoved[READER_COMMENTS_KEY];
  return JSON.stringify({
    ...rest,
    removed: comparableRemoved,
    refusal: refusal ? `${refusal.constructor.name}: ${refusal.message}` : null,
  });
}

let same = 0;
let acted = 0;
let different = 0;
for (const { file, url } of inputs) {
  const html = await readFile(file, "utf8");
  const a = base.readArticle(html, url);
  const b = readArticle(html, url);
  const name = path.basename(file);
  const n = b.removed[READER_COMMENTS_KEY] ?? 0;
  if (n > 0) acted++;
  if (contract(a) === contract(b)) {
    same++;
    console.log(`same\t${name}\tcontainers=${n}`);
    continue;
  }
  different++;
  const ta = text(a.article?.content ?? "");
  const tb = text(b.article?.content ?? "");
  console.log(`DIFF\t${name}\tcontainers=${n}\tbefore=${ta.length} after=${tb.length}`);
  for (const k of ["title", "byline", "excerpt", "siteName", "publishedTime", "lang", "dir"] as const)
    if (a.article?.[k] !== b.article?.[k]) console.log(`   ${k}: ${JSON.stringify(a.article?.[k])} -> ${JSON.stringify(b.article?.[k])}`);
  if (a.refusal?.constructor.name !== b.refusal?.constructor.name)
    console.log(`   refusal: ${a.refusal?.constructor.name ?? "-"} -> ${b.refusal?.constructor.name ?? "-"}`);
  console.log(`   before: ${JSON.stringify(process.env.FULL ? ta : ta.slice(0, 140))}`);
  console.log(`   after:  ${JSON.stringify(process.env.FULL ? tb : tb.slice(0, 140))}`);
}
console.log(`${same}/${inputs.length} identical; the pass removed a container on ${acted}`);
if (different > 0) process.exitCode = 1;
