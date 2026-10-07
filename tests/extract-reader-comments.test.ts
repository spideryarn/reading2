/**
 * A blog's comment thread stays out of the article — src/reader-comments.ts,
 * plan 261007k, report spya-eqjfgv.
 *
 * Two real WordPress pages from the corpus. Greg's xenaproject post is the
 * ordinary case, which Readability always got right and must go on getting
 * right. Lemire's is the case that was wrong: cut to a short post, Readability's
 * retry returned "5 thoughts on …" and the thoughts, as the article.
 *
 * Every case asserts what must be there as well as what must not — an empty
 * article contains no comments either (GPT Sol, plan review). And the negatives
 * are the page shapes a broader rule deleted: a `div.commentary` article that
 * only the retry rescues, RFC 9110's authored `#comments`, an unmarked post
 * sharing that wrapper with a thread, authored `#respond`, and class names that
 * merely contain the word.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM, VirtualConsole } from "jsdom";
import { describe, expect, it } from "vitest";
import { readArticle, TooLittleTextToRead } from "../src/extract.js";
import { READER_COMMENTS_KEY, removeReaderComments } from "../src/reader-comments.js";

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "../evals/extraction/fixtures");
const XENA_URL = "https://xenaproject.wordpress.com/2026/10/01/to-grieve-or-not-to-grieve/";
const LEMIRE_URL = "https://lemire.me/blog/2026/10/06/linking-node-js-with-mold/";

const fixture = (file: string) => readFile(path.join(FIXTURES, file), "utf8");
const parse = (html: string): Document => new JSDOM(html, { virtualConsole: new VirtualConsole() }).window.document;
const textOf = (html: string | null | undefined): string =>
  (parse(`<body>${html ?? ""}</body>`).body.textContent ?? "").replace(/\s+/g, " ");

/** The page with its post body's text cut to `n` characters, set as text so nothing is reparsed. */
function withPostCutTo(html: string, n: number): { html: string; post: string } {
  const d = parse(html);
  const body = d.querySelector(".entry-content");
  if (!body) throw new Error("no .entry-content");
  const post = (body.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, n);
  const p = d.createElement("p");
  p.textContent = post;
  body.replaceChildren(p);
  return { html: `<!doctype html>${d.documentElement.outerHTML}`, post };
}

/* A run from one reader's comment on each page, absent from the post itself. */
const XENA_COMMENT = "OpenAI and Anthropic have been gatekeeping mathematics since the very beginning";
const LEMIRE_COMMENT = "Clearly, these link times are without LTO";

describe("a blog's comment thread", () => {
  it("stays out of Greg's xenaproject post, and the post arrives whole", async () => {
    const { article, refusal, removed } = readArticle(await fixture("xena_wordpress_comments.html"), XENA_URL);
    const text = textOf(article?.content);
    expect(refusal).toBeNull();
    expect(text).toContain("Recent events in the field of AI for mathematics have shown us");
    expect(text).toContain("Wir müssen wissen — wir werden wissen!");
    expect(text).not.toContain(XENA_COMMENT);
    expect(removed[READER_COMMENTS_KEY]).toBeGreaterThan(0);
  });

  it("is not handed back as the article when the post is short: the page is refused as too short instead", async () => {
    const { html } = withPostCutTo(await fixture("lemire_wordpress_comments.html"), 150);
    const { article, refusal } = readArticle(html, LEMIRE_URL);
    expect(textOf(article?.content)).not.toContain(LEMIRE_COMMENT);
    expect(textOf(article?.content)).not.toContain("thoughts on");
    expect(refusal).toBeInstanceOf(TooLittleTextToRead);
  });

  it("stays out of a post just long enough to read, and the post is there", async () => {
    const { html, post } = withPostCutTo(await fixture("lemire_wordpress_comments.html"), 700);
    const { article, refusal } = readArticle(html, LEMIRE_URL);
    const text = textOf(article?.content);
    expect(refusal).toBeNull();
    expect(text).toContain(post.slice(0, 200));
    expect(text).not.toContain(LEMIRE_COMMENT);
  });
});

describe("what is not a comment thread", () => {
  it("leaves an article whose only text is in div.commentary, which Readability's retry reads", () => {
    const sentence = "The commentary itself is the article here, and it has to reach the reader intact. ";
    const html = `<!doctype html><html><head><title>Commentary</title></head><body>
      <div class="commentary"><p>${sentence.repeat(14)}</p></div></body></html>`;
    const { article } = readArticle(html, "https://example.com/commentary");
    expect(textOf(article?.content)).toContain(sentence.trim());
  });

  it("leaves a container that holds the post, whatever it is called", () => {
    const d = parse(`<body><div id="comments"><h1>Title</h1><div class="entry-content"><p>The post.</p></div></div></body>`);
    expect(removeReaderComments(d)).toBe(0);
    expect(d.body.textContent).toContain("The post.");
  });

  it("leaves authored prose in #comments when a theme gives the post none of the usual markers", () => {
    const d = parse(`<body><div id="comments">
      <section><p>The post is plain prose under the wrapper, with no h1 or conventional post-body class.</p></section>
      <ol class="comment-list"><li class="comment">A reader's reply.</li></ol>
    </div></body>`);
    expect(removeReaderComments(d)).toBe(1);
    expect(d.body.textContent).toContain("The post is plain prose under the wrapper");
    expect(d.body.textContent).not.toContain("A reader's reply");
  });

  it("does not mistake RFC 9110's authored Comments section for a reader thread", async () => {
    const d = parse(await fixture("rfc9110.html"));
    const section = d.querySelector("#comments");
    expect(section?.textContent).toContain("Comments can be included in some HTTP fields");
    removeReaderComments(d);
    expect(section?.isConnected).toBe(true);
    expect(section?.textContent).toContain("Comments can be included in some HTTP fields");
  });

  it("leaves unrelated authored content called #respond", () => {
    const d = parse(`<body><section id="respond"><p>The author responds to the objection in this section.</p></section></body>`);
    expect(removeReaderComments(d)).toBe(0);
    expect(d.body.textContent).toContain("The author responds to the objection");
  });

  it("removes an old WordPress comment list identified by id", () => {
    const d = parse(`<body><ol id="commentlist"><li id="comment-1">A reader's reply.</li></ol></body>`);
    expect(removeReaderComments(d)).toBe(1);
    expect(d.body.textContent).not.toContain("A reader's reply");
  });

  it("removes Blogger's measured two-token thread root", () => {
    const d = parse(`<body><div class="comment-thread toplevel-thread"><ol><li>A reader's reply.</li></ol></div></body>`);
    expect(removeReaderComments(d)).toBe(1);
    expect(d.body.textContent).not.toContain("A reader's reply");
  });

  it("matches whole names only, never a class that merely contains the word", () => {
    const d = parse(`<body>
      <span class="comments-link">3 comments</span>
      <div class="comment-author">A reader</div>
      <div class="react-comments-container">GitHub's issue body</div>
      <div class="commentary">Commentary</div>
      <div class="comments-area" id="x"><ol class="comment-list"><li>gone</li></ol></div></body>`);
    expect(removeReaderComments(d)).toBe(1);
    expect(d.body.textContent).not.toContain("gone");
    for (const kept of ["3 comments", "A reader", "GitHub's issue body", "Commentary"]) expect(d.body.textContent).toContain(kept);
  });

  it("leaves a Hacker News thread, where the thread is the page", async () => {
    expect(removeReaderComments(parse(await fixture("hn_dropbox.html")))).toBe(0);
  });

  it("leaves a generic comment-thread when the discussion itself is the page", () => {
    const d = parse(`<body><div class="comment-thread"><h2>Design discussion</h2><p>The first proposal and its reasoning.</p></div></body>`);
    expect(removeReaderComments(d)).toBe(0);
    expect(d.body.textContent).toContain("The first proposal and its reasoning");
  });
});
