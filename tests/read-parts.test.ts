/**
 * **`readParts` — stage 2 for an article that arrived as several pages.**
 *
 * docs/plans/261024p-a-multi-page-article-imports-from-its-first-page.md §
 * *Stage 2: extracting each part*. One test per behaviour the plan names, and
 * the ones that matter downstream are run through stage 3's real splitter
 * (`splitIntoBlocks`) and the supplement split (`splitBlocks`), not only
 * through the markers stage 2 writes — GPT Sol's F4 was that the markers can be
 * right while Structure strands the notes.
 *
 * Fixtures in tests/fixtures/read-parts/ are small hand-written pages in the
 * shapes the plan measured: a landing page under the floor, two chapters whose
 * `<h1>`s Readability treats differently, pandoc footnotes on both with a
 * colliding "Ibid.", colliding author ids, a dead in-page link whose target
 * exists only on page 1, and a bot check.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";

import { readArticle, TooLittleTextToRead } from "../src/extract.js";
import { splitIntoBlocks } from "../src/blocks.js";
import { NOTE_ID_PATTERN } from "../src/notes.js";
import { CONTEXT_ID_PATTERN } from "../src/reserved.js";
import { namespaceAnchors, readParts, type PageSource } from "../src/read-parts.js";
import { splitBlocks } from "../src/supplement.js";
import type { Log } from "../src/log.js";

const FIXTURES = path.join(import.meta.dirname, "fixtures", "read-parts");
const page = (file: string, address: string): PageSource => ({
  html: readFileSync(path.join(FIXTURES, file), "utf8"),
  url: `https://lantern.example/${address}`,
});
const landing = page("landing.html", "");
const one = page("chapter-one.html", "chapter-one");
const two = page("chapter-two.html", "chapter-two");
const botCheck = page("bot-check.html", "chapter-three");
const declined: PageSource = { html: "<!doctype html><html><body></body></html>", url: "https://lantern.example/empty" };

/** A logger that records what it was asked to write. */
function recordingLog(): Log & { lines: { level: string; obj: unknown; msg?: string | undefined }[] } {
  const lines: { level: string; obj: unknown; msg?: string | undefined }[] = [];
  const at = (level: string) => (obj: unknown, msg?: string) => void lines.push({ level, obj, msg });
  const self = { lines, debug: at("debug"), info: at("info"), warn: at("warn"), error: at("error"), child: () => self };
  return self as unknown as Log & { lines: typeof lines };
}
const quiet = () => ({ log: recordingLog() });

function body(html: string): HTMLElement {
  return new JSDOM(`<!doctype html><html><body>${html}</body></html>`).window.document.body;
}
const squash = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

function joined(parts: PageSource[] = [one, two]) {
  const result = readParts(landing, parts, quiet());
  const content = result.article?.content ?? "";
  return { result, content, doc: body(content) };
}

function blocksOf(content: string) {
  return splitIntoBlocks(`<!doctype html><html><body>${content}</body></html>`).blocks;
}

describe("readParts with no parts", () => {
  it("is readArticle, exactly", () => {
    for (const p of [landing, one, two, botCheck, declined]) {
      expect(readParts(p, [], quiet())).toEqual(readArticle(p.html, p.url));
    }
  });
});

describe("page 1 refuses as it always has", () => {
  it("a bot check on page 1 is still a bot check, whatever follows", () => {
    const r = readParts(botCheck, [one, two], quiet());
    expect(r.refusal?.name).toBe("ChallengePage");
    expect(r).toEqual(readArticle(botCheck.html, botCheck.url));
  });

  it("no article on page 1 is still no article", () => {
    const r = readParts(declined, [one], quiet());
    expect(r.article).toBeNull();
  });

  it("the metadata is page 1's", () => {
    const { result } = joined();
    const alone = readArticle(landing.html, landing.url);
    expect(result.article?.title).toBe(alone.article?.title);
    expect(result.article?.byline).toBe(alone.article?.byline);
    expect(result.opening).toEqual(alone.opening);
    expect(result.ownIds).toEqual(alone.ownIds);
  });
});

describe("the pages are joined in order", () => {
  it("every page's prose, in reading order, with nothing deduplicated", () => {
    const { result } = joined();
    const text = squash(result.article?.textContent);
    const at = [
      "An essay in two chapters about lanterns",
      "Before the lanterns there was the coast itself",
      "Once the lanterns were lit the coast road changed",
      "By the fifth winter the lanterns were taken for granted",
    ].map((s) => text.indexOf(s));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    /* "Ibid." is on both pages, and both stay. */
    expect(text.match(/Ibid\./g)).toHaveLength(2);
  });

  it("textContent and length describe the joined content", () => {
    const { result, doc } = joined();
    expect(result.article?.textContent).toBe(doc.textContent);
    expect(result.article?.length).toBe(result.article?.textContent?.length);
  });

  it("stats are summed over the pages that were read", () => {
    const { result } = joined();
    const each = [landing, one, two].map((p) => readArticle(p.html, p.url));
    expect(result.notes.notes).toBe(each.reduce((n, r) => n + r.notes.notes, 0));
    expect(result.notes.notes).toBe(3);
    expect(result.notes.shapes.gwern).toBe(3);
    expect(result.notes.markers).toBe(3);
  });
});

describe("no heading of ours, but the page's own h1 put back", () => {
  it("restores a chapter's h1 Readability dropped, as an h2, at the top of its part", () => {
    const { doc } = joined();
    const h2s = Array.from(doc.querySelectorAll("h2"), (h) => squash(h.textContent));
    expect(h2s.filter((t) => t === "Chapter One. Darkness")).toHaveLength(1);
    /* At the top of chapter one: straight before its first heading, after all of page 1. */
    const text = squash(doc.textContent);
    const heading = text.indexOf("Chapter One. Darkness Introduction to the dark coast");
    expect(heading).toBeGreaterThan(text.indexOf("Chapter One. Darkness Chapter Two. Light")); // page 1's contents list
    expect(heading).toBeLessThan(text.indexOf("Before the lanterns there was the coast itself"));
  });

  it("does not add it again when the content already opens with it", () => {
    /* Chapter two's title differs from its h1, so Readability kept the h1. */
    const alone = readArticle(two.html, two.url);
    expect(squash(body(alone.article?.content ?? "").textContent).startsWith("Chapter Two. Light")).toBe(true);
    const { doc } = joined();
    const h2s = Array.from(doc.querySelectorAll("h2"), (h) => squash(h.textContent));
    expect(h2s.filter((t) => t === "Chapter Two. Light")).toHaveLength(1);
  });

  it("writes no heading for page 1, and none of its own words", () => {
    const { doc } = joined();
    const headings = Array.from(doc.querySelectorAll("h1, h2, h3, h4, h5, h6"), (h) => squash(h.textContent));
    expect(headings).toEqual([
      "Method",
      "Chapter One. Darkness",
      "Introduction to the dark coast",
      "Chapter Two. Light",
      "Introduction to the lit coast",
      "Notes",
    ]);
  });
});

describe("later pages' anchors are namespaced", () => {
  it("no id is defined twice, and each page's in-page link lands on its own page", () => {
    const { doc } = joined();
    const ids = Array.from(doc.querySelectorAll("[id]"), (el) => el.id);
    expect(new Set(ids).size).toBe(ids.length);
    const intro = (words: string) =>
      Array.from(doc.querySelectorAll("a[href]")).find((a) => a.textContent === words)?.getAttribute("href");
    expect(intro("the introduction")).toBe("#p2-intro");
    expect(doc.querySelector('[id="p2-intro"]')?.textContent).toBe("Introduction to the dark coast");
    expect(intro("the start of this chapter")).toBe("#p3-intro");
    expect(doc.querySelector('[id="p3-intro"]')?.textContent).toBe("Introduction to the lit coast");
  });

  it("a dead link stays dead rather than landing on page 1's anchor of the same name", () => {
    const { doc, content } = joined();
    const link = Array.from(doc.querySelectorAll("a")).find((a) => a.textContent === "the method section")!;
    expect(link.getAttribute("href")).toBe("#p2-method");
    expect(doc.querySelector('[id="method"]')).not.toBeNull(); // page 1's, untouched
    expect(doc.querySelector('[id="p2-method"]')).toBeNull();
    /* And stage 3 agrees: page 1's Method heading gets a block id, the dead
       link is not pointed at it. */
    const blocks = blocksOf(content);
    const method = blocks.find((b) => b.text === "Method")!;
    const citing = blocks.find((b) => b.text.includes("the method section"))!;
    expect(citing.html).not.toContain(`#${method.id}`);
    expect(citing.html).toContain('href="#p2-method"');
  });

  it("stage 3 retargets the namespaced links to the right blocks", () => {
    const { content } = joined();
    const blocks = blocksOf(content);
    const darkIntro = blocks.find((b) => b.text === "Introduction to the dark coast")!;
    const litIntro = blocks.find((b) => b.text === "Introduction to the lit coast")!;
    expect(blocks.find((b) => b.text.includes("the introduction,"))!.html).toContain(`href="#${darkIntro.id}"`);
    expect(blocks.find((b) => b.text.includes("the start of this chapter"))!.html).toContain(`href="#${litIntro.id}"`);
  });

  it("stage 3 cannot be steered to a page-1 decoy using the predictable prefix", () => {
    const decoy = { ...landing, html: landing.html.replace('<h2 id="method">', '<p id="p2-intro">PAGE ONE DECOY</p><h2 id="method">') };
    const result = readParts(decoy, [one], quiet());
    const blocks = blocksOf(result.article?.content ?? "");
    const real = blocks.find((b) => b.text === "Introduction to the dark coast")!;
    const citing = blocks.find((b) => b.text.includes("the introduction,"))!;
    const decoyBlock = blocks.find((b) => b.text === "PAGE ONE DECOY")!;
    expect(citing.html).toContain(`href="#${real.id}"`);
    expect(citing.html).not.toContain(`href="#${decoyBlock.id}"`);
  });

  it("names, ARIA id-lists and url(#…) follow the same map", () => {
    const { doc } = joined();
    expect(doc.querySelector('a[name="p2-old-anchor"]')).not.toBeNull();
    const svg = doc.querySelector("svg")!;
    expect(svg.getAttribute("aria-labelledby")).toBe("p2-fig-title");
    const rect = svg.querySelector("rect")!;
    expect(rect.getAttribute("fill")).toBe("url(#p2-grad)");
    expect(rect.getAttribute("style")).toBe("fill: url('#p2-grad')");
    expect(svg.querySelector("linearGradient")?.id).toBe("p2-grad");
  });
});

describe("namespaceAnchors on its own", () => {
  const fresh = () => ({ notes: new Set<string>(), contexts: new Set<string>(), anchors: new Set<string>() });

  it("rewrites every same-document reference, defined on the page or not", () => {
    const root = body(
      `<p id="a">x</p><a href="#a">1</a><a href="#gone">2</a><a href="#caf%C3%A9">3</a><p id="café">y</p>` +
        `<label for="a">l</label><table><tr><td headers="a gone">t</td></tr></table><div aria-describedby=" a  gone ">d</div>` +
        `<img usemap="#m"><map name="m"></map><svg><use xlink:href="#a"/><use href="#a"/></svg>` +
        `<a href="https://elsewhere.example/#a">out</a><a href="#">top</a>`,
    );
    namespaceAnchors(root, "p2-", fresh());
    const hrefs = Array.from(root.querySelectorAll("a"), (a) => a.getAttribute("href"));
    /* An encoded fragment naming a defined id is matched decoded, as stage 3 does. */
    expect(hrefs).toEqual(["#p2-a", "#p2-gone", "#p2-café", "https://elsewhere.example/#a", "#"]);
    expect(root.querySelector("p")?.id).toBe("p2-a");
    expect(root.querySelector("label")?.getAttribute("for")).toBe("p2-a");
    expect(root.querySelector("[headers]")?.getAttribute("headers")).toBe("p2-a p2-gone");
    expect(root.querySelector("[aria-describedby]")?.getAttribute("aria-describedby")).toBe("p2-a p2-gone");
    expect(root.querySelector("img")?.getAttribute("usemap")).toBe("#p2-m");
    expect(root.querySelector("map")?.getAttribute("name")).toBe("p2-m");
    const uses = Array.from(root.querySelectorAll("use"));
    expect(uses[0]?.getAttribute("xlink:href")).toBe("#p2-a");
    expect(uses[1]?.getAttribute("href")).toBe("#p2-a");
    expect(root.querySelectorAll("p")[1]!.id).toBe("p2-café");
  });

  it("an author id shaped like a note id is an ordinary anchor and is prefixed", () => {
    const root = body(`<p id="spya-note-0123456789">x</p><a href="#spya-note-0123456789">x</a>`);
    namespaceAnchors(root, "p2-", fresh());
    expect(root.querySelector("p")?.id).toBe("p2-spya-note-0123456789");
    expect(root.querySelector("a")?.getAttribute("href")).toBe("#p2-spya-note-0123456789");
  });

  it("cannot reuse an ordinary anchor that an earlier page preclaimed", () => {
    const root = body(`<p id="target">real target</p><a href="#target">go</a><a href="#gone">dead</a>`);
    const taken = { ...fresh(), anchors: new Set(["p2-target", "p2-gone"]) };
    namespaceAnchors(root, "p2-", taken);
    expect(root.querySelector("p")?.id).toBe("p2-target-2");
    expect(root.querySelector('a[href*="target"]')?.getAttribute("href")).toBe("#p2-target-2");
    expect(root.querySelector('a[href*="gone"]')?.getAttribute("href")).toBe("#p2-gone-2");
  });

  it("cannot reuse an ordinary earlier-page anchor for a stamped note", () => {
    const root = body(
      `<a id="spya-note-ref-0123456789" data-spya-note-ref="spya-note-0123456789" href="#spya-note-0123456789">1</a>` +
        `<li id="spya-note-0123456789" data-spya-note="spya-note-0123456789">note</li>`,
    );
    const taken = { ...fresh(), anchors: new Set(["spya-note-0123456789"]) };
    namespaceAnchors(root, "p2-", taken);
    const note = root.querySelector("li")!;
    expect(note.id).toBe("spya-note-0123456789-2");
    expect(note.getAttribute("data-spya-note")).toBe(note.id);
    expect(root.querySelector("a")?.getAttribute("href")).toBe(`#${note.id}`);
  });

  it("suffixes a colliding callout context id, and leaves a fresh one alone", () => {
    const taken = { notes: new Set<string>(), contexts: new Set(["c-0123456789"]), anchors: new Set<string>() };
    const root = body(
      `<div data-spya-callout="c-0123456789"><p data-spya-callout="c-0123456789">a</p></div>` +
        `<div data-spya-callout="c-abcdef0123"><p data-spya-callout="c-abcdef0123">b</p></div>`,
    );
    namespaceAnchors(root, "p2-", taken);
    const values = Array.from(root.querySelectorAll("[data-spya-callout]"), (el) => el.getAttribute("data-spya-callout"));
    expect(values).toEqual(["c-0123456789-2", "c-0123456789-2", "c-abcdef0123", "c-abcdef0123"]);
    for (const v of values) expect(v).toMatch(CONTEXT_ID_PATTERN);
    expect([...taken.contexts].sort()).toEqual(["c-0123456789", "c-0123456789-2", "c-abcdef0123"]);
  });
});

describe("note ids that collide are suffixed, not prefixed", () => {
  it("keeps NOTE_ID_PATTERN, and the id, the stamps and every link agree", () => {
    const { doc } = joined();
    const notes = Array.from(doc.querySelectorAll("li[data-spya-note]"));
    expect(notes).toHaveLength(3);
    const ids = notes.map((n) => n.id);
    expect(new Set(ids).size).toBe(3);
    for (const n of notes) {
      expect(n.id).toMatch(NOTE_ID_PATTERN);
      expect(n.getAttribute("data-spya-note")).toBe(n.id);
    }
    const [firstIbid, , secondIbid] = notes;
    expect(secondIbid!.id).toBe(`${firstIbid!.id}-2`);

    for (const note of notes) {
      /* Every marker citing it points at it, by href and by stamp… */
      const markers = Array.from(doc.querySelectorAll(`a[data-spya-note-ref="${note.id}"]`));
      expect(markers).toHaveLength(1);
      expect(markers[0]!.getAttribute("href")).toBe(`#${note.id}`);
      /* …and its back-link is its own, and goes back to that marker. */
      const back = note.querySelector("a[data-spya-note-back]")!;
      expect(back.getAttribute("data-spya-note-back")).toBe(note.id);
      expect(back.getAttribute("href")).toBe(`#${markers[0]!.id}`);
    }
    /* Chapter two's marker is chapter two's, not chapter one's. */
    const ch2Marker = doc.querySelector(`a[data-spya-note-ref="${secondIbid!.id}"]`)!;
    expect(ch2Marker.id).toBe("p3-fnref1");
    expect(ch2Marker.closest("p")?.textContent).toContain("about the carters");
  });

  it("stage 3 carries each note's id onto its block", () => {
    const { content, doc } = joined();
    const blocks = blocksOf(content);
    const noteIds = blocks.filter((b) => b.role === "footnote").map((b) => b.noteId);
    expect(noteIds).toHaveLength(3);
    expect(noteIds).toEqual(Array.from(doc.querySelectorAll("li[data-spya-note]"), (n) => n.id));
  });
});

describe("one notes region at the end", () => {
  it("one container, last, under one heading, with every page's notes in reading order", () => {
    const { doc } = joined();
    expect(doc.querySelectorAll("section[data-spya-notes]")).toHaveLength(1);
    const container = doc.querySelector("section[data-spya-notes]")!;
    expect(doc.lastElementChild).toBe(container);
    expect(container.previousElementSibling?.tagName).toBe("H2");
    expect(container.previousElementSibling?.textContent).toBe("Notes");
    /* Chapter two's "References" heading went with its notes, and is not left mid-article. */
    expect(squash(doc.textContent)).not.toContain("References");
    const texts = Array.from(container.querySelectorAll("li[data-spya-note]"), (li) => squash(li.textContent));
    expect(texts).toEqual([
      "Ibid.↩︎",
      "Letter of the second winter, from the keeper at the northern village.↩︎",
      "Ibid.↩︎",
    ]);
  });

  it("splitBlocks takes the notes as one supplement group, none stranded, no orphan notes heading", () => {
    const { content } = joined();
    const blocks = blocksOf(content);
    const split = splitBlocks(blocks);
    expect(split.stranded).toBe(0);
    expect(split.groups).toHaveLength(1);
    expect(split.groups[0]!.blocks).toHaveLength(3);
    /* The body ends with the one notes heading, and no other heading says notes or references. */
    expect(split.body.at(-1)?.text).toBe("Notes");
    const noteHeadings = split.body.filter((b) => b.kind === "heading" && /^(notes|references)$/i.test(b.text));
    expect(noteHeadings).toHaveLength(1);
    /* Nothing empty was left behind where the notes were — no `<hr>` block. */
    expect(blocks.filter((b) => b.tag === "hr")).toHaveLength(0);
  });

  it("without the merge the same pages would strand notes (the check can fail)", () => {
    /* The counterfactual: the pages' contents simply concatenated. */
    const raw = [landing, one, two].map((p) => readArticle(p.html, p.url).article?.content ?? "").join("");
    const split = splitBlocks(blocksOf(raw));
    expect(split.stranded).toBeGreaterThan(0);
    expect(split.groups).toHaveLength(0);
  });
});

describe("a later page that cannot be read is dropped, not fatal", () => {
  it("a bot check in the middle is left out and logged as a count", () => {
    const logger = recordingLog();
    const r = readParts(landing, [one, botCheck, two], { log: logger });
    expect(r.refusal).toBeNull();
    const text = squash(r.article?.textContent);
    expect(text).not.toContain("BOT-CHECK-SENTINEL");
    expect(text).toContain("Once the lanterns were lit");
    /* Numbered by position, so the page after the dropped one is p4. */
    expect(body(r.article?.content ?? "").querySelector("#p4-intro")).not.toBeNull();
    expect(logger.lines).toHaveLength(1);
    expect(logger.lines[0]!.level).toBe("warn");
    expect(logger.lines[0]!.obj).toEqual({ pages: 4, read: 3, challenges: 1, declined: 0 });
    /* Counts only: no address, no prose. */
    expect(JSON.stringify(logger.lines)).not.toMatch(/lantern|bot!|SENTINEL/i);
  });

  it("a page Readability declines is left out too", () => {
    expect(readArticle(declined.html, declined.url).article).toBeNull();
    const logger = recordingLog();
    const r = readParts(landing, [declined, one], { log: logger });
    expect(r.refusal).toBeNull();
    expect(logger.lines[0]!.obj).toEqual({ pages: 3, read: 2, challenges: 0, declined: 1 });
  });

  it("logs nothing when every page was read", () => {
    const logger = recordingLog();
    readParts(landing, [one, two], { log: logger });
    expect(logger.lines).toHaveLength(0);
  });
});

describe("the floor is on the joined text", () => {
  it("a landing page under the floor is refused alone and accepted with its chapters", () => {
    const alone = readArticle(landing.html, landing.url);
    expect(alone.refusal).toBeInstanceOf(TooLittleTextToRead);
    expect(readParts(landing, [one], quiet()).refusal).toBeNull();
  });

  it("is still refused when every later page is dropped", () => {
    const r = readParts(landing, [botCheck, declined], quiet());
    expect(r.refusal).toBeInstanceOf(TooLittleTextToRead);
  });
});

describe("a page forging our attributes does not break the join", () => {
  it("its forged note and notes container are scrubbed, and stay body prose where they were", () => {
    const { doc, content, result } = joined();
    /* Only canonicaliseNotes' notes are notes. */
    expect(doc.querySelectorAll("[data-spya-note]")).toHaveLength(result.notes.notes);
    const container = doc.querySelector("section[data-spya-notes]")!;
    expect(container.textContent).not.toContain("dress itself");
    expect(container.textContent).not.toContain("claims to be our notes container");
    const text = squash(doc.textContent);
    expect(text.indexOf("dress itself")).toBeLessThan(text.indexOf("By the fifth winter"));
    const blocks = blocksOf(content);
    const forged = blocks.filter((b) => b.text.includes("dress itself") || b.text.includes("claims to be our notes"));
    expect(forged).toHaveLength(2);
    for (const b of forged) expect(b.role).toBeUndefined();
    expect(splitBlocks(blocks).stranded).toBe(0);
  });
});
