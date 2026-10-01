// Spike, 2026-10-01: title/authors/abstract/DOI from pages 1-2 of each eval PDF with pdf.js and no model.
// Run from the repo root: node evals/pdf/minimal-metadata/no-model-spike.mjs. docs/plans/261001m-bulk-import-of-many-papers-a-stepping-stone.md.
import fs from "node:fs";
const R = process.cwd() + "/";
const pdfjs = await import(R + "node_modules/pdfjs-dist/legacy/build/pdf.mjs");
const exp = JSON.parse(fs.readFileSync(R + "evals/pdf/titles/expected.json", "utf8")).fixtures;
const files = [];
for (const f of exp) files.push({ name: f.slug, path: R + `evals/pdf/titles/${f.slug}/source.pdf`, title: f.title, byline: f.byline });
for (const n of ["easy", "harder", "much-harder"]) files.push({ name: n, path: R + `evals/pdf/${n}/source.pdf` });
files.push({ name: "entropy-p8", path: R + "tests/fixtures/pdf-vector-figure/entropy-24-00930-p8.pdf" });
const norm = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const trunc = (s, n = 60) => (s == null ? "-" : s.length > n ? s.slice(0, n) + "…" : s);

async function lines(doc, p) {
  const page = await doc.getPage(p);
  const tc = await page.getTextContent();
  const items = tc.items
    .filter((i) => i.str !== undefined && i.str.trim())
    .map((i) => ({ s: i.str, x: i.transform[4], y: i.transform[5], h: Math.abs(i.transform[3]) || i.height }));
  const ls = [];
  for (const it of items) {
    const l = ls.find((l) => Math.abs(l.y - it.y) < 2);
    if (l) l.items.push(it);
    else ls.push({ y: it.y, items: [it] });
  }
  ls.sort((a, b) => b.y - a.y);
  return ls
    .map((l) => {
      l.items.sort((a, b) => a.x - b.x);
      const text = l.items.map((i) => i.s).join(" ").replace(/\s+/g, " ").trim();
      return { y: l.y, text, h: Math.max(...l.items.map((i) => i.h)), n: text.length };
    })
    .filter((l) => l.text);
}
function heur(L) {
  const top = L.slice(0, 40).filter((l) => l.n > 3);
  if (!top.length) return { title: "", authors: "" };
  const maxH = Math.max(...top.map((l) => l.h));
  const i = top.findIndex((l) => l.h >= maxH - 0.6);
  const t = [top[i]];
  let j = i + 1;
  while (j < top.length && Math.abs(top[j].h - top[i].h) < 0.6 && top[j - 1].y - top[j].y < top[i].h * 2.2) { t.push(top[j]); j++; }
  const au = [];
  for (; j < top.length && au.length < 3; j++) {
    if (/^(abstract|summary|keywords?)\b/i.test(top[j].text)) break;
    au.push(top[j].text);
  }
  return { title: t.map((l) => l.text).join(" "), authors: au.join(" | ") };
}
function abstract(texts) {
  const full = texts.join("\n");
  const m = full.match(/(^|\n)\s*(abstract|summary)\b[\s.:—-]*\n?/i);
  if (!m) return { abs: null, fb: full.replace(/\s+/g, " ").slice(0, 1200) };
  let rest = full.slice(m.index + m[0].length);
  const e = rest.search(/\n\s*(\d\.?\s*|I\.\s*)?(introduction|keywords?|index terms|key words)\b/i);
  if (e > 0) rest = rest.slice(0, e);
  return { abs: rest.replace(/\s+/g, " ").trim().slice(0, 2500) };
}
const out = [];
let sumT = 0;
for (const f of files) {
  const t0 = performance.now();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(f.path)), verbosity: 0 }).promise;
  let meta = {};
  try {
    const m = await doc.getMetadata();
    meta = { t: m.info?.Title, a: m.info?.Author, xt: m.metadata?.get?.("dc:title"), xa: m.metadata?.get?.("dc:creator") };
  } catch (e) {}
  const pages = [], texts = [];
  for (let p = 1; p <= Math.min(2, doc.numPages); p++) {
    const L = await lines(doc, p);
    pages.push(L);
    texts.push(L.map((l) => l.text).join("\n"));
  }
  const h = heur(pages[0]);
  const ab = abstract(texts);
  const all = texts.join("\n") + " " + JSON.stringify(meta);
  const doi = all.match(/\b10\.\d{4,9}\/[^\s"|,;]+/)?.[0];
  const ax = all.match(/arXiv:\s?\d{4}\.\d{4,5}(v\d+)?/i)?.[0];
  const ms = performance.now() - t0;
  sumT += ms;
  const mt = meta.t || meta.xt || "";
  out.push({
    name: f.name.slice(0, 22), pg: doc.numPages, ms: Math.round(ms),
    metaT: trunc(mt, 40), metaTok: f.title ? norm(mt) === norm(f.title) : null, metaA: trunc(meta.a || meta.xa, 30),
    hT: trunc(h.title, 60), hTok: f.title ? norm(h.title) === norm(f.title) : null,
    hA: trunc(h.authors, 60),
    hAok: f.byline ? norm(h.authors).includes(norm(f.byline.split(/,\s*/)[0].split(" ").pop())) : null,
    abs: ab.abs ? trunc(ab.abs, 60) : "FB:" + trunc(ab.fb, 40), doi: doi || null, arxiv: ax || null,
  });
}
for (const r of out) console.log(JSON.stringify(r));
console.log("avg ms", Math.round(sumT / files.length));
