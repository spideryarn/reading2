import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const url = process.argv[2];
if (!url) {
  console.error("Usage: tsx src/extract.ts <url> [outFile]");
  process.exit(1);
}
const outFile = process.argv[3] ?? "output/article.html";

const res = await fetch(url, {
  headers: {
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  },
});
if (!res.ok) {
  throw new Error(`Fetch failed: ${res.status} ${res.statusText}`);
}
const html = await res.text();

const dom = new JSDOM(html, { url });
const reader = new Readability(dom.window.document);
const article = reader.parse();

if (!article) {
  throw new Error("Readability could not parse this page.");
}

const page = `<!doctype html>
<html lang="${article.lang ?? "en"}">
<head>
<meta charset="utf-8">
<title>${article.title ?? "Untitled"}</title>
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
<h1>${article.title ?? ""}</h1>
<div class="meta">
  ${article.byline ? `${article.byline} &middot; ` : ""}${article.siteName ?? ""}
  ${article.length ? `&middot; ~${Math.round(article.length / 5 / 200)} min read` : ""}
</div>
${article.content}
</body>
</html>`;

await mkdir(path.dirname(outFile), { recursive: true });
await writeFile(outFile, page, "utf-8");

console.log(`Title: ${article.title}`);
console.log(`Byline: ${article.byline}`);
console.log(`Site: ${article.siteName}`);
console.log(`Length (chars): ${article.length}`);
console.log(`Excerpt: ${article.excerpt}`);
console.log(`\nWritten to: ${path.resolve(outFile)}`);
