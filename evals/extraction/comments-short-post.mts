// Probe: a short post above a long comment thread. Cuts each page's post body down to n characters
// and shows what stage 2 returns — the post, a refusal, or the thread. Plan 261007k.
// Usage: npx tsx evals/extraction/comments-short-post.mts [--base=<extract.ts>] [--n=150,400]
//          <file.html>::<post-body-selector> ...
//   --base runs another checkout's stage 2 instead (comments-arms.mts says how to get one).
import { readFile } from "node:fs/promises";
import path from "node:path";
import { JSDOM, VirtualConsole } from "jsdom";
import * as here from "../../src/extract.js";

let basePath: string | null = null;
let ns = [150, 400];
const pages: [string, string][] = [];
for (const a of process.argv.slice(2)) {
  if (a.startsWith("--base=")) basePath = a.slice("--base=".length);
  else if (a.startsWith("--n=")) ns = a.slice("--n=".length).split(",").map(Number);
  else {
    const [file, sel] = a.split("::");
    if (!file || !sel) throw new Error(`expected <file>::<selector>, got ${a}`);
    pages.push([file, sel]);
  }
}
if (pages.length === 0) throw new Error("no pages to probe; pass <file.html>::<post-body-selector>");
if (ns.length === 0 || ns.some((n) => !Number.isSafeInteger(n) || n <= 0)) {
  throw new Error("--n must be a comma-separated list of positive integers");
}
const { readArticle } = basePath ? ((await import(basePath)) as typeof here) : here;

for (const [file, sel] of pages) {
  const html = await readFile(file, "utf8");
  for (const n of ns) {
    const dom = new JSDOM(html, { virtualConsole: new VirtualConsole() });
    const body = dom.window.document.querySelector(sel);
    if (!body) throw new Error(`${file}: no ${sel}`);
    const wholePost = (body.textContent ?? "").replace(/\s+/g, " ").trim();
    if (wholePost.length < n) {
      throw new Error(`${file}: ${sel} has ${wholePost.length} characters, fewer than requested n=${n}`);
    }
    const text = wholePost.slice(0, n);
    const p = dom.window.document.createElement("p");
    p.textContent = text;
    body.replaceChildren(p);
    const { article, refusal } = readArticle(dom.serialize(), "https://example.com/post");
    const out = (new JSDOM(`<body>${article?.content ?? ""}</body>`, { virtualConsole: new VirtualConsole() }).window.document.body.textContent ?? "")
      .replace(/\s+/g, " ")
      .trim();
    console.log(`${path.basename(file)} n=${n}\trefusal=${refusal?.constructor.name ?? "-"}\tchars=${out.length}\tstartsWithPost=${out.startsWith(text.slice(0, 40))}`);
    console.log("   head:", JSON.stringify(out.slice(0, 160)));
  }
}
