/**
 * The two places outside data reaches a link card — src/web/link-facts.ts.
 *
 * The hook itself is not tested, and **the reason is not the one I first gave**.
 * I wrote that it would be a test of a mock; a GPT Sol review pointed out that
 * `useLinkFacts` is driven entirely by a prop and two deferred promises, which
 * is about as testable as a hook gets. The real reason is that this repo has no
 * React test harness at all — no `@testing-library/react`, nothing that renders
 * a component — and adding one is a dependency decision bigger than this
 * feature, taken deliberately rather than smuggled in behind it. The three
 * tests worth writing the day it exists are named at the foot of this file.
 *
 * What *is* tested is the pair of pure functions either side of the wire,
 * because those are where somebody else's bytes turn into something a React
 * render trusts:
 *
 *  - `shelfIndex` — our own shelf, keyed the way an href will be looked up. One
 *    bad line here gives a card that never matches anything, which looks
 *    exactly like a card that had nothing to match.
 *  - `readSummary` — Wikipedia's JSON, which is the only third-party response
 *    that reaches this view at all.
 *
 * See docs/project/links.md.
 */
import { describe, expect, it } from "vitest";
import { urlKey } from "../src/ingest.js";
import { readSummary, shelfIndex } from "../src/web/link-facts.js";
import type { LibraryEntry } from "../src/types.js";

/** Enough of a shelf entry to be indexed. The rest is what the card renders. */
function entry(slug: string, url?: string): LibraryEntry {
  return {
    slug,
    title: slug,
    ...(url ? { url } : {}),
    addedAt: "2026-08-27T00:00:00.000Z",
    words: 100,
    minutes: 1,
    blocks: 3,
    parts: 1,
    sections: 1,
    comments: 0,
    opens: 0,
    has: { arc: false, tweets: false, glossary: false, summary: false },
  };
}

describe("shelfIndex", () => {
  it("finds the article behind a spelling of its address the author chose", () => {
    /* The whole point of keying by `urlKey` rather than by the URL. An author
       writes `http://`, or drops the `www.`, or adds a campaign parameter,
       and none of those is a different article — and every one of them would
       miss a plain string comparison. */
    const index = shelfIndex([entry("noema", "https://www.noemamag.com/the-mythology-of-conscious-ai/")]);
    const spellings = [
      "https://www.noemamag.com/the-mythology-of-conscious-ai/",
      "http://www.noemamag.com/the-mythology-of-conscious-ai/",
      "https://noemamag.com/the-mythology-of-conscious-ai",
      "https://www.noemamag.com/the-mythology-of-conscious-ai/?utm_source=twitter",
    ];
    for (const spelling of spellings) {
      expect(index.get(urlKey(spelling))?.slug, spelling).toBe("noema");
    }
  });

  it("does not confuse two articles on one host", () => {
    const index = shelfIndex([
      entry("a", "https://www.noemamag.com/the-mythology-of-conscious-ai/"),
      entry("b", "https://www.noemamag.com/the-danger-of-superhuman-ai/"),
    ]);
    expect(index.size).toBe(2);
    expect(index.get(urlKey("https://noemamag.com/the-danger-of-superhuman-ai"))?.slug).toBe("b");
  });

  it("skips an article that has no address, because no href can point at one", () => {
    /* An uploaded PDF came from nowhere on the web. Indexing it under `""`
       would make every unparseable href match the same random article, which
       is the failure that would look most like a working feature. */
    const index = shelfIndex([entry("uploaded"), entry("noema", "https://noemamag.com/x")]);
    expect(index.size).toBe(1);
    expect(index.has("")).toBe(false);
  });

  it("skips an article read off this laptop's disk", () => {
    /* Older PDF articles on disk carry the `file:///…` they were read from.
       `urlKey` would key one under a path on somebody's machine — harmless
       until the day something normalises an href into the same shape. An entry
       nothing can ever match is an entry that can only be matched by accident. */
    const index = shelfIndex([entry("pdf", "file:///Users/greg/evals/pdf/easy/source.pdf")]);
    expect(index.size).toBe(0);
  });

  it("keeps the first of two entries that key the same, rather than throwing", () => {
    // A duplicate on the shelf. `urlKey` exists to make it rare; when it
    // happens the card names one of them, because nothing here could pick well.
    const index = shelfIndex([entry("first", "https://x.test/a"), entry("second", "http://x.test/a/")]);
    expect(index.size).toBe(1);
    expect(index.get(urlKey("https://x.test/a"))?.slug).toBe("first");
  });
});

describe("readSummary", () => {
  it("takes the three fields the card shows", () => {
    // The real answer for the one Wikipedia link in this corpus, trimmed.
    const out = readSummary({
      type: "standard",
      title: "Antikythera mechanism",
      description: "Ancient Greek analogue astronomical computer",
      extract: "The Antikythera mechanism is an ancient Greek hand-powered orrery.",
      thumbnail: { source: "https://upload.wikimedia.org/x.jpg" },
    });
    expect(out).toEqual({
      title: "Antikythera mechanism",
      description: "Ancient Greek analogue astronomical computer",
      extract: "The Antikythera mechanism is an ancient Greek hand-powered orrery.",
    });
  });

  it("leaves the description out rather than carrying an empty one", () => {
    /* `exactOptionalPropertyTypes` is on, so `description: undefined` is not
       the same as absent — and the card tests for the key. Plenty of real
       articles have no Wikidata one-liner. */
    const out = readSummary({ title: "Qualia", extract: "Qualia are individual instances." });
    expect(out).toEqual({ title: "Qualia", extract: "Qualia are individual instances." });
    expect(out && "description" in out).toBe(false);
  });

  it("drops a blank description rather than printing an empty line", () => {
    const out = readSummary({ title: "Qualia", extract: "Qualia are…", description: "   " });
    expect(out && "description" in out).toBe(false);
  });

  it("refuses a summary with a title and no lead paragraph", () => {
    /* The case worth having a rule about: a section headed "from wikipedia"
       with a name and no words under it reads as a lookup that broke, which is
       worse than no section at all. */
    expect(readSummary({ title: "Qualia", extract: "" })).toBe(null);
    expect(readSummary({ title: "Qualia" })).toBe(null);
  });

  it("refuses a lead paragraph with no title", () => {
    expect(readSummary({ extract: "Some words." })).toBe(null);
  });

  const RUBBISH: [string, unknown][] = [
    ["null", null],
    ["a string", "not json at all"],
    ["a number", 42],
    ["an array", []],
    ["an empty object", {}],
    // The one that matters: React throws on being handed an object to render,
    // and that would take the whole card down rather than one section.
    ["a title that is an object", { title: { en: "Qualia" }, extract: "Words." }],
    ["a title that is a number", { title: 7, extract: "Words." }],
    ["an extract that is an array", { title: "Qualia", extract: ["Words."] }],
  ];
  for (const [what, body] of RUBBISH) {
    it(`answers null for ${what}`, () => {
      expect(readSummary(body)).toBe(null);
    });
  }

  it("ignores a description of the wrong type instead of refusing the whole entry", () => {
    // The description is the least of the three, so a bad one costs its own
    // line rather than the section it sits in.
    const out = readSummary({ title: "Qualia", extract: "Words.", description: { en: "x" } });
    expect(out).toEqual({ title: "Qualia", extract: "Words." });
  });
});

/* --------------------------------------------------- what is not here --
   The three tests to write the day this repo can render a component, from a
   GPT Sol review of the hook (2026-08-27). Each names a real way it could
   break that nothing here would catch:

   1. **A → B while A is in flight.** Resolve A's Wikipedia fetch *after* the
      reader has moved to B, and assert B never shows A's summary. This is what
      deriving the answer during render rather than holding it in state is for,
      and there is currently nothing standing on that decision but the argument
      in the comment.
   2. **Two consumers, then unmount one.** Assert one `/api/library` request and
      one Wikipedia request between them, and that unmounting one does not stop
      the other being updated. That is the whole job of `shelfPending` and
      `wikiPending`.
   3. **A request that never settles.** Assert `loading` goes false at the
      deadline rather than leaving `looking it up…` under every external link in
      the article for the rest of the session. */
