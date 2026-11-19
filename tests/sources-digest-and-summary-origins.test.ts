/**
 * **The sources digest and a Summary level as chat origins** — plan
 * docs/plans/261030b-sources-digest-a-prose-digest-of-what-it-cites-and-who-cites-it.md
 * § The ask box, Stage 3.
 *
 * Each is an id-shaped origin (`GlossaryOrigin`'s rules) whose id carries the
 * artefact's `generatedAt`, so a digest or a summary written again gets new
 * chats. The ids the senders mint are what the route's patterns admit, and
 * the database's CHECKs hold the same patterns
 * (tests/chat-origin-route.test.ts § the CHECKs). The shape's round trip
 * through the columns, the route and the transaction are in the suites
 * docs/project/chat-from-a-mode.md § Adding it to another mode names; this file
 * holds the ids, the paragraph numbering, the title and the list's words.
 */
import { describe, expect, it } from "vitest";

import { titleFromOrigin } from "../src/chat-title.js";
import { originColumns, originFromColumns } from "../src/thread-origin.js";
import {
  SOURCES_DIGEST_ITEM_ID,
  SOURCES_DIGEST_SECTIONS,
  SUMMARY_ITEM_ID,
  type SourcesDigestOrigin,
  type SourcesDigestParagraph,
  type SourcesDigestSections,
  sameOrigin,
  sourcesDigestItemId,
  sourcesDigestParagraphNumber,
  sourcesDigestParagraphOf,
  summaryItemId,
  summaryLevelOf,
  type SummaryOrigin,
  type ThreadOrigin,
} from "../src/types.js";
import { sourcesDigestOrigin, summaryOrigin } from "../src/web/chat-handoff.js";
import { originBack, threadSource } from "../src/web/thread-source.js";

const AT = "2026-10-30T21:56:39.123Z";

describe("a digest's item id", () => {
  it("is `sd-` and the digest's time, and `-p` and a number for one paragraph", () => {
    expect(sourcesDigestItemId(AT)).toBe("sd-20261030215639123");
    expect(sourcesDigestItemId(AT, 3)).toBe("sd-20261030215639123-p3");
    expect(sourcesDigestItemId("2026-10-30T21:56:39Z")).toMatch(SOURCES_DIGEST_ITEM_ID);
    expect(sourcesDigestItemId(AT)).toMatch(SOURCES_DIGEST_ITEM_ID);
    expect(sourcesDigestItemId(AT, 1)).toMatch(SOURCES_DIGEST_ITEM_ID);
    expect(sourcesDigestItemId(AT, 999)).toMatch(SOURCES_DIGEST_ITEM_ID);
  });

  it("admits nothing looser", () => {
    for (const bad of [
      "sd-2026",
      "sd-202610302156391234",
      "sd-20261030215639123-p0",
      "sd-20261030215639123-p01",
      "sd-20261030215639123-p1000",
      "sd-20261030215639123-p",
      " sd-20261030215639123",
      "so-20261030215639123",
      "spya-k3m9qt",
      "ss-brief-20261030215639123",
    ]) {
      expect(bad, bad).not.toMatch(SOURCES_DIGEST_ITEM_ID);
    }
  });

  it("says which paragraph it names, or none for the whole digest", () => {
    expect(sourcesDigestParagraphOf(sourcesDigestItemId(AT, 7))).toBe(7);
    expect(sourcesDigestParagraphOf(sourcesDigestItemId(AT))).toBeNull();
    expect(sourcesDigestParagraphOf("si-0123456789ab")).toBeNull();
  });
});

describe("a digest paragraph's number", () => {
  const p = (text: string): SourcesDigestParagraph => ({ text, sentences: [], ids: [], more: "", sources: [], leadIds: [] });
  const sections: SourcesDigestSections = {
    cites: [p("a"), p("b")],
    citedBy: [p("c")],
    missed: [],
    check: [p("d"), p("e")],
  };

  it("counts from 1 across the sections, in the order the panel draws them", () => {
    expect([...SOURCES_DIGEST_SECTIONS]).toEqual(["cites", "citedBy", "missed", "check"]);
    expect(sourcesDigestParagraphNumber(sections, "cites", 0)).toBe(1);
    expect(sourcesDigestParagraphNumber(sections, "cites", 1)).toBe(2);
    expect(sourcesDigestParagraphNumber(sections, "citedBy", 0)).toBe(3);
    /* An empty section takes no numbers. */
    expect(sourcesDigestParagraphNumber(sections, "check", 0)).toBe(4);
    expect(sourcesDigestParagraphNumber(sections, "check", 1)).toBe(5);
  });

  it("is a different number for every paragraph of a digest", () => {
    const all = SOURCES_DIGEST_SECTIONS.flatMap((key) =>
      sections[key].map((_, i) => sourcesDigestParagraphNumber(sections, key, i)),
    );
    expect(all).toEqual([1, 2, 3, 4, 5]);
  });
});

describe("a summary level's item id", () => {
  it("is `ss-`, the level and the summary's time", () => {
    expect(summaryItemId("brief", AT)).toBe("ss-brief-20261030215639123");
    expect(summaryItemId("fuller", AT)).toBe("ss-fuller-20261030215639123");
    expect(summaryItemId("fuller", AT)).toMatch(SUMMARY_ITEM_ID);
    expect(summaryLevelOf(summaryItemId("fuller", AT))).toBe("fuller");
    expect(summaryLevelOf(summaryItemId("brief", AT))).toBe("brief");
  });

  it("admits nothing looser", () => {
    for (const bad of ["ss-thread-20261030215639123", "ss-brief-2026", "ss-Brief-20261030215639123", "ss-20261030215639123", "sd-20261030215639123"]) {
      expect(bad, bad).not.toMatch(SUMMARY_ITEM_ID);
      expect(summaryLevelOf(bad), bad).toBeNull();
    }
  });
});

describe("the origins the senders build", () => {
  it("cut the snapshot to the origin's cap, and are nothing for blank words", () => {
    expect(sourcesDigestOrigin(AT, undefined, "  The piece builds on two lines of work. ")).toEqual({
      mode: "sources-digest",
      itemId: "sd-20261030215639123",
      quote: "The piece builds on two lines of work.",
    });
    expect(sourcesDigestOrigin(AT, 2, "x".repeat(400))?.quote).toHaveLength(300);
    expect(sourcesDigestOrigin(AT, 2, "  ")).toBeUndefined();
    expect(summaryOrigin("fuller", AT, "In plain words")).toEqual({
      mode: "summary",
      itemId: "ss-fuller-20261030215639123",
      quote: "In plain words",
    });
    expect(summaryOrigin("brief", AT, "")).toBeUndefined();
  });
});

describe.each([
  {
    mode: "sources-digest",
    item: sourcesDigestItemId(AT),
    other: sourcesDigestItemId(AT, 1),
    rewritten: sourcesDigestItemId("2026-10-31T09:00:00.000Z"),
  },
  {
    mode: "summary",
    item: summaryItemId("brief", AT),
    other: summaryItemId("fuller", AT),
    rewritten: summaryItemId("brief", "2026-10-31T09:00:00.000Z"),
  },
] as const)("a $mode origin", ({ mode, item, other, rewritten }) => {
  const ORIGIN: SourcesDigestOrigin | SummaryOrigin = { mode, itemId: item, quote: "The piece builds on two lines of work" };

  it("is found by its id, not its words; another paragraph or level, or a rewrite, is another chat", () => {
    expect(sameOrigin(ORIGIN, { ...ORIGIN, quote: "reworded" })).toBe(true);
    expect(sameOrigin(ORIGIN, { ...ORIGIN, itemId: other })).toBe(false);
    expect(sameOrigin(ORIGIN, { ...ORIGIN, itemId: rewritten })).toBe(false);
    expect(sameOrigin(ORIGIN, { mode: "situate", itemId: item, quote: ORIGIN.quote })).toBe(false);
  });

  it("goes to its own columns and back", () => {
    expect(originColumns(ORIGIN)).toMatchObject({ originMode: mode, originItemId: item, originQuote: ORIGIN.quote });
    expect(originFromColumns(originColumns(ORIGIN))).toEqual({ origin: ORIGIN });
  });
});

describe("the list's words and the way back", () => {
  const DIGEST: ThreadOrigin = { mode: "sources-digest", itemId: sourcesDigestItemId(AT), quote: "It builds on two lines" };
  const PARAGRAPH: ThreadOrigin = { ...DIGEST, itemId: sourcesDigestItemId(AT, 4), quote: "Nobody has tested it" };
  const FULLER: ThreadOrigin = { mode: "summary", itemId: summaryItemId("fuller", AT), quote: "In plain words" };
  const BRIEF: ThreadOrigin = { ...FULLER, itemId: summaryItemId("brief", AT) };

  it("names a digest chat after the digest, and a summary chat after its level", () => {
    expect(titleFromOrigin(DIGEST)).toBe("Digest: It builds on two lines");
    expect(titleFromOrigin(PARAGRAPH)).toBe("Digest: Nobody has tested it");
    expect(titleFromOrigin(FULLER)).toBe("Fuller summary: In plain words");
    expect(titleFromOrigin(BRIEF)).toBe("Brief summary: In plain words");
  });

  it("lists a digest chat under Sources, placed in Digest, in the model's voice", () => {
    for (const origin of [DIGEST, PARAGRAPH]) {
      expect(threadSource({ kind: "chat", origin })).toEqual({
        from: "sources",
        mode: "sources",
        place: "Digest",
        label: "Started from the digest in Sources › Digest",
        quote: origin.quote,
        voice: "ai",
      });
    }
  });

  it("lists a summary chat under Summary, placed on its level, in the model's voice", () => {
    expect(threadSource({ kind: "chat", origin: FULLER })).toEqual({
      from: "summary",
      mode: "summary",
      place: "Fuller",
      label: "Started from Summary › Fuller",
      quote: "In plain words",
      voice: "ai",
    });
    expect(threadSource({ kind: "chat", origin: BRIEF })?.label).toBe("Started from Summary › Brief");
  });

  it("goes back to the digest, and to the summary's level", () => {
    expect(originBack(PARAGRAPH)).toEqual({
      mode: "sources",
      view: "digest",
      modeLabel: "Digest",
      quote: "Nobody has tested it",
      text: "Back to “Nobody has tested it” in Digest",
    });
    expect(originBack(FULLER)).toEqual({
      mode: "summary",
      view: "fuller",
      modeLabel: "Fuller",
      quote: "In plain words",
      text: "Back to “In plain words” in Fuller",
    });
    expect(originBack(BRIEF).view).toBe("brief");
  });
});
