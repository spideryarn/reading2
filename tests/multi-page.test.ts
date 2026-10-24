/**
 * **The multi-page judge sees only the page's own same-site links, and its
 * answer is held to them** (src/multi-page.ts, plan 261024p, report spya-qkyukr).
 */
import { describe, expect, it } from "vitest";

import { CHAT_REASONING } from "../src/ai-call.js";
import {
  MAX_CONTINUATION_PAGES,
  judgeMultiPage,
  multiPageRequest,
  pageKey,
  pageLinks,
  parseMultiPageAnswer,
  sameSite,
  type MultiPageGateway,
} from "../src/multi-page.js";

const PAGE = "https://essay.example/";
const HTML = `<!doctype html><html><head><title>An essay</title>
<link rel="next" href="/chapter-1"><link rel="stylesheet" href="/s.css"></head><body>
<nav class="chapters"><a href="/chapter-1">Chapter I</a><a href="/chapter-2">Chapter II</a>
<a href="https://www.essay.example/chapter-3#top">Chapter III</a></nav>
<main><p>The abstract. <a href="#notes">notes</a> <a href="/">home</a> <a href="https://elsewhere.example/x">a source</a>
<a href="/chapter-1">read chapter one</a> <a href="/figure.png">figure</a> <a href="mailto:a@b.c">mail</a>
<a href="https://user:pw@essay.example/secret">x</a></p></main></body></html>`;

describe("pageLinks", () => {
  const links = pageLinks(HTML, PAGE, `<p><a href="https://essay.example/chapter-2">kept</a></p>`);

  it("keeps the site's other pages, once each, in document order, with ids", () => {
    expect(links.map((l) => [l.id, new URL(l.url).pathname])).toEqual([
      ["L1", "/chapter-1"],
      ["L2", "/chapter-2"],
      ["L3", "/chapter-3"],
    ]);
  });

  it("drops the page itself, other sites, assets, credentials and non-web schemes", () => {
    const urls = links.map((l) => l.url).join(" ");
    expect(urls).not.toMatch(/elsewhere|figure\.png|mailto|user:pw|#/);
  });

  it("merges every wording and rel of one target, and says where it was and whether the article kept it", () => {
    const one = links[0]!;
    expect(one.rel).toBe("next");
    expect(one.text).toBe("<link rel=next> | Chapter I | read chapter one");
    expect(links[1]!.inArticle).toBe(true);
    expect(links[0]!.inArticle).toBe(false);
    expect(links[1]!.where).toBe("nav.chapters");
  });

  it("treats www. as the same site, and http going up to https", () => {
    expect(sameSite(new URL("https://www.a.example/x"), new URL("https://a.example/y"))).toBe(true);
    expect(sameSite(new URL("http://a.example/x"), new URL("https://www.a.example/y"))).toBe(true);
    expect(sameSite(new URL("https://a.example/"), new URL("https://b.a.example/"))).toBe(false);
  });

  it("never follows a page's link down to http, or to another port of its host", () => {
    expect(sameSite(new URL("https://a.example/x"), new URL("http://a.example/y"))).toBe(false);
    expect(sameSite(new URL("https://a.example/x"), new URL("https://a.example:8443/y"))).toBe(false);
    expect(sameSite(new URL("http://a.example:8080/x"), new URL("http://a.example:8080/y"))).toBe(true);
    expect(sameSite(new URL("http://a.example:8080/x"), new URL("https://a.example/y"))).toBe(false);
  });

  it("treats a fragment or a trailing slash as the same page", () => {
    expect(pageKey(new URL("https://a.example/p/#x"))).toBe(pageKey(new URL("https://www.a.example/p")));
  });
});

const answer = (content: string, finish = "stop") => ({ choices: [{ finish_reason: finish, message: { content } }] });
const links = pageLinks(HTML, PAGE, null);

describe("parseMultiPageAnswer", () => {
  it("maps ids back to the page's links, in the order given, each once", () => {
    const v = parseMultiPageAnswer(answer(JSON.stringify({ continues: true, pages: ["L2", "L1", "L2"], reason: "chapters" })), links);
    expect(v.continues && v.pages.map((p) => p.id)).toEqual(["L2", "L1"]);
  });

  it("refuses the whole answer when it names a link that is not on the page", () => {
    expect(() =>
      parseMultiPageAnswer(answer(JSON.stringify({ continues: true, pages: ["L1", "https://evil.example/"], reason: "" })), links),
    ).toThrow(/not on the page/);
  });

  it("reads continues-with-no-pages as does-not-continue, and refuses an unfinished or malformed answer", () => {
    expect(parseMultiPageAnswer(answer(JSON.stringify({ continues: true, pages: [], reason: "x" })), links).continues).toBe(false);
    expect(() => parseMultiPageAnswer(answer("{}", "length"), links)).toThrow(/did not finish/);
    expect(() => parseMultiPageAnswer(answer("not json"), links)).toThrow(/not JSON/);
    expect(() => parseMultiPageAnswer(answer(JSON.stringify({ continues: "yes", pages: [], reason: "" })), links)).toThrow(/shape/);
  });

  it(`stops at ${MAX_CONTINUATION_PAGES} further pages`, () => {
    const many = Array.from({ length: 40 }, (_, i) => `<a href="/p/${i + 2}">${i + 2}</a>`).join("");
    const lots = pageLinks(`<body>${many}</body>`, PAGE, null);
    const v = parseMultiPageAnswer(answer(JSON.stringify({ continues: true, pages: lots.map((l) => l.id), reason: "" })), lots);
    expect(v.continues && v.pages.length).toBe(MAX_CONTINUATION_PAGES);
  });
});

describe("judgeMultiPage and its request", () => {
  it("makes no call for a page with no links to its own site", async () => {
    let called = false;
    const gateway: MultiPageGateway = async () => {
      called = true;
      throw new Error("unreachable");
    };
    const v = await judgeMultiPage({ url: PAGE, title: null, text: "x" }, [], { gateway });
    expect(v.continues).toBe(false);
    expect(called).toBe(false);
  });

  it("sends the page as one JSON object, under its own job, at a named effort", async () => {
    let seen: { job: string; content: string } | null = null;
    const gateway: MultiPageGateway = async (job, body) => {
      seen = { job, content: String((body.messages as { content: string }[])[1]!.content) };
      return { json: answer(JSON.stringify({ continues: false, pages: [], reason: "one page" })) } as unknown as Awaited<ReturnType<MultiPageGateway>>;
    };
    await judgeMultiPage({ url: PAGE, title: "An essay", text: "The abstract." }, links, { gateway });
    expect(seen!.job).toBe("multi-page");
    const payload = JSON.parse(seen!.content);
    expect(payload.links[0]).toMatchObject({ id: "L1", href: "/chapter-1", rel: "next" });
    expect(CHAT_REASONING["multi-page"]).toEqual({ effort: "low" });
  });

  it("puts the end of a long text beside its start", () => {
    const body = multiPageRequest({ url: PAGE, title: null, text: `${"a ".repeat(2000)}THE END` }, links);
    const payload = JSON.parse(String((body.messages as { content: string }[])[1]!.content));
    expect(payload.text_end).toMatch(/THE END$/);
  });
});
