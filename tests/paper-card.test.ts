/**
 * **What the paper card says, as data** — PaperCard.tsx § paperCardFacts,
 * plan 261002f. The hover itself is tests/shelf-topics-detail.test.tsx § the
 * paper card on an article link; this pins the sentences that would otherwise
 * be false for an unusual entry.
 */
import { describe, expect, it } from "vitest";
import { SHARING_MARK_ON_ARCHIVED } from "../src/messages.js";
import type { LibraryEntry } from "../src/types.js";
import { ABSTRACT_PREVIEW, CARD_TOPICS, paperCardFacts } from "../src/web/PaperCard.js";
import { exactly } from "../src/web/relative-time.js";
import { NOT_PROCESSED_MARK } from "../src/web/ShelfEntry.js";

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

/** ENTRY without some of its optional fields — `exactOptionalPropertyTypes` refuses `undefined`. */
function without(...keys: (keyof LibraryEntry)[]): LibraryEntry {
  const e: Record<string, unknown> = { ...ENTRY };
  for (const k of keys) delete e[k];
  return e as unknown as LibraryEntry;
}

/** A paper with only its title, authors and abstract read: no gist, every count 0. */
const MINIMAL: LibraryEntry = {
  ...without("gist", "lastOpenedAt"),
  processing: "minimal",
  words: 0,
  minutes: 0,
  blocks: 0,
  parts: 0,
  sections: 0,
};

const value = (facts: ReturnType<typeof paperCardFacts>, label: string) =>
  facts.facts.find((f) => f.label === label)?.value;

describe("paperCardFacts", () => {
  it("says title, byline and site, gist, both dates exactly, and the length", () => {
    const card = paperCardFacts(ENTRY, []);
    expect(card.title).toBe("On reading slowly");
    expect(card.byline).toBe("Ada Quillfeather · The Longform Review");
    expect(card.preview).toBe("Slow reading compounds.");
    expect(value(card, "Added")).toBe(exactly(ENTRY.addedAt));
    expect(value(card, "Last opened")).toBe(exactly(ENTRY.lastOpenedAt));
    expect(value(card, "Length")).toBe("16 min · 3,456 words");
    expect(value(card, "Status")).toBeUndefined();
    expect(value(card, "Archived")).toBeUndefined();
    expect(value(card, "Shared")).toBeUndefined();
  });

  it("gives a minimal paper no length, the shelf's marker, and its abstract cut short as the preview", () => {
    const abstract = `${"We measure reading. ".repeat(30)}The end.`;
    const card = paperCardFacts({ ...MINIMAL, abstract }, []);
    expect(value(card, "Length")).toBeUndefined();
    expect(value(card, "Status")).toBe(NOT_PROCESSED_MARK);
    expect(card.facts.map((f) => f.value).join(" ")).not.toMatch(/\b0 (min|words)\b/);
    expect(card.preview?.endsWith("…")).toBe(true);
    expect(card.preview?.length ?? 0).toBeLessThanOrEqual(ABSTRACT_PREVIEW + 1);
    expect(abstract.startsWith((card.preview ?? "").slice(0, -1))).toBe(true);
  });

  it("gives a minimal paper with no abstract no preview, and a short abstract whole", () => {
    expect(paperCardFacts(MINIMAL, []).preview).toBeUndefined();
    expect(paperCardFacts({ ...MINIMAL, abstract: "  Short.  " }, []).preview).toBe("Short.");
  });

  it("says never for an article never opened, and names the archive and sharing", () => {
    const card = paperCardFacts(
      { ...without("lastOpenedAt"), archivedAt: "2026-09-25T10:00:00.000Z", visibility: "public" },
      [],
    );
    expect(value(card, "Last opened")).toBe("never");
    expect(value(card, "Archived")).toBe(exactly("2026-09-25T10:00:00.000Z"));
    expect(value(card, "Shared")).toBe(SHARING_MARK_ON_ARCHIVED);
  });

  it("cuts an abstract at an available word boundary even when the next token is very long", () => {
    const opening = "A bounded preview";
    const abstract = `${opening} ${"x".repeat(ABSTRACT_PREVIEW * 2)}`;
    expect(paperCardFacts({ ...MINIMAL, abstract }, []).preview).toBe(`${opening}…`);
  });

  it("drops an empty byline, and keeps either half alone", () => {
    expect(paperCardFacts(without("byline", "siteName"), []).byline).toBeUndefined();
    expect(paperCardFacts({ ...ENTRY, byline: "  ", siteName: "Site" }, []).byline).toBe("Site");
  });

  it(`names the first ${CARD_TOPICS} topics in the order given and counts the rest`, () => {
    const topics = Array.from({ length: CARD_TOPICS + 3 }, (_, i) => ({ label: `t${i}`, slot: i }));
    const card = paperCardFacts(ENTRY, topics);
    expect(card.topics.map((t) => t.label)).toEqual(topics.slice(0, CARD_TOPICS).map((t) => t.label));
    expect(card.moreTopics).toBe(3);
    expect(paperCardFacts(ENTRY, topics.slice(0, CARD_TOPICS)).moreTopics).toBe(0);
  });
});
