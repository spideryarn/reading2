// Probe: does stage 2's readArticle keep readers' comments?
// Usage: npx tsx evals/extraction/comments-probe.mts <file.html>...
// For each page: how many comment bodies the source has (by common engine markup), and how many
// of them reach the extracted article, matched on a 60-character run of their own text.
import { readFile } from "node:fs/promises";
import { JSDOM, VirtualConsole } from "jsdom";
import { readArticle } from "../../src/extract.js";

const BODY_SEL = [
  ".comment-content", // WordPress (core themes, wp.com)
  ".comment-body", // WordPress (older), Blogger
  ".comment-text",
  ".comment_text",
  ".comment .content", // Drupal
  ".CommentBody", // LWN
  ".comment-block", // Blogger
  "li.comment > div",
  "div.comment",
].join(", ");

const squash = (s: string) => s.replace(/\s+/g, " ").trim();

const files = process.argv.slice(2);
if (files.length === 0) throw new Error("no pages to probe; pass one or more HTML files");

let checkedBodies = 0;
for (const file of files) {
  const html = await readFile(file, "utf8");
  const src = new JSDOM(html, { virtualConsole: new VirtualConsole() }).window.document;
  /* The innermost match only, so WordPress's `.comment-body > .comment-content` counts once. */
  const bodies = [...src.querySelectorAll(BODY_SEL)]
    .filter((el) => el.querySelector(BODY_SEL) === null)
    .map((el) => squash(el.textContent ?? ""))
    .filter((t) => t.length >= 80)
    .map((t) => t.slice(10, 70));
  checkedBodies += bodies.length;
  const { article, refusal } = readArticle(html, "https://example.com/post");
  const out = squash(new JSDOM(`<body>${article?.content ?? ""}</body>`, { virtualConsole: new VirtualConsole() }).window.document.body.textContent ?? "");
  // A comment that quotes the post is not a leak: its run is also in the page with every comment
  // body taken out.
  const bare = src.cloneNode(true) as Document;
  for (const el of bare.querySelectorAll(BODY_SEL)) el.remove();
  const bareText = squash(bare.body?.textContent ?? "");
  const leaked = bodies.filter((b) => out.includes(b) && !bareText.includes(b));
  console.log(
    `${file.split("/").pop()}\trefusal=${refusal?.constructor.name ?? "-"}\tchars=${out.length}\tcommentBodies=${bodies.length}\tleaked=${leaked.length}`,
  );
  console.log("   head:", JSON.stringify(out.slice(0, 120)));
  console.log("   tail:", JSON.stringify(out.slice(-160)));
  for (const l of leaked.slice(0, 3)) console.log("   LEAK:", JSON.stringify(l));
}
if (checkedBodies === 0) throw new Error("the supplied pages contained no 80-character comment body this probe recognises");
