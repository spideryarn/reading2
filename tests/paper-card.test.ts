/**
 * **What the paper card says, as data** — PaperCard.tsx § paperCardFacts,
 * plan 261002f. The hover itself is tests/shelf-topics-detail.test.tsx § the
 * paper card on an article link; this pins the sentences that would otherwise
 * be false for an unusual entry.
 */
import { describe, expect, it } from "vitest";
import type { LibraryEntry } from "../src/types.js";
import { CARD_TOPICS, paperCardFacts } from "../src/web/PaperCard.js";
import { exactly } from "../src/web/relative-time.js";

const ENTRY: LibraryEntry = {
  slug: "paper-card-piece",
  title: "On reading slowly",
  byline: "Ada Quillfeather",
  siteName: "The Longform Review",
  addedAt: "2026-08-12T09:15:00.000Z",
  lastOpenedAt: "2026-09-20T16:05:00.000Z",
  words: 3456,
  minutes: 16,
  blocks: 97,
  parts: 4,
  sections: 11,
  comments: 0,
  opens: 3,
  sourceReusable: true,
  gist: "Slow reading compounds.",
  has: { arc: false, tweets: false, glossary: false },
};

const value = (facts: ReturnType<typeof paperCardFacts>, label: string) =>
  facts.facts.find((f) => f.label === label)?.value;

describe("paperCardFacts", () => {
  it("says title, byline and site, gist, both dates exactly, and the length", () => {
    const card = paperCardFacts(ENTRY, []);
    expect(card.title).toBe("On reading slowly");
    expect(card.byline).toBe("Ada Quillfeather · The Longform Review");
    expect(card.gist).toBe("Slow reading compounds.");
    expect(value(card, "Added")).toBe(exactly(ENTRY.addedAt));
    expect(value(card, "Last opened")).toBe(exactly(ENTRY.lastOpenedAt));
    expect(value(card, "Length")).toBe("16 min · 3,456 words");
    expect(value(card, "Archived")).toBeUndefined();
    expect(value(card, "Shared")).toBeUndefined();
  });

  it("does not claim a length for a paper with only its title and abstract read", () => {
    const card = paperCardFacts({ ...ENTRY, processing: "minimal", words: 0, minutes: 0 }, []);
    expect(value(card, "Length")).toBe("not read yet — title and abstract only");
  });

  it("says never for an article never opened, and names the archive and sharing", () => {
    const card = paperCardFacts(
      { ...ENTRY, lastOpenedAt: undefined, archivedAt: "2026-09-25T10:00:00.000Z", visibility: "public" },
      [],
    );
    expect(value(card, "Last opened")).toBe("never");
    expect(value(card, "Archived")).toBe(exactly("2026-09-25T10:00:00.000Z"));
    expect(value(card, "Shared")).toBeTruthy();
  });

  it("drops an empty byline, and keeps either half alone", () => {
    expect(paperCardFacts({ ...ENTRY, byline: undefined, siteName: undefined }, []).byline).toBeUndefined();
    expect(paperCardFacts({ ...ENTRY, byline: "  ", siteName: "Site" }, []).byline).toBe("Site");
  });

  it(`names the first ${CARD_TOPICS} topics and counts the rest`, () => {
    const topics = Array.from({ length: CARD_TOPICS + 3 }, (_, i) => ({ label: `t${i}`, slot: i }));
    const card = paperCardFacts(ENTRY, topics);
    expect(card.topics.map((t) => t.label)).toEqual(topics.slice(0, CARD_TOPICS).map((t) => t.label));
    expect(card.moreTopics).toBe(3);
  });
});
