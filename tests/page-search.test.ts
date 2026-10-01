/**
 * **The Metadata page's search box** — src/web/page-search.ts.
 *
 * Greg, SPIDERYARN-READING2-83, 2026-10-01:
 *
 * > make sure it does a good job of finding things, including synonyms
 *
 * No model call: a synonym table, light stemming, prefix match as you type, and
 * a ranking where a section's own name beats the words inside it. Each rule
 * here is one a reader would notice only as "search is bad", never as an error.
 * docs/plans/261001s-metadata-contents-opens-and-flashes-its-section-and-a-search-box-above-it.md.
 */
import { describe, expect, it } from "vitest";
import { searchSections, type SearchableSection } from "../src/web/page-search.js";

function section(
  label: string,
  { keywords = "", aside = "" }: Partial<SearchableSection> = {},
): SearchableSection {
  return { id: label, label, keywords, aside };
}

const PAGE: SearchableSection[] = [
  section("Authors", { keywords: "names writers byline who wrote it affiliations", aside: "2" }),
  section("At a glance"),
  section("Your reading"),
  section("Access & sharing"),
  section("AI processing", { keywords: "rerun summaries glossary steps", aside: "9 of 9 stages" }),
  section("What it cost", { keywords: "calls models tokens breakdown", aside: "$0.0123 · 12 calls" }),
  section("Export"),
  section("Technical details", { keywords: "slug files storage fingerprint" }),
  section("Archive this article"),
  section("Delete this article"),
];

const find = (q: string) => searchSections(q, PAGE);

describe("searchSections", () => {
  it("an empty or blank query matches nothing — the list shows itself whole", () => {
    expect(find("")).toEqual([]);
    expect(find("   ")).toEqual([]);
  });

  it("finds a section by its name, ignoring case", () => {
    expect(find("export")[0]).toBe("Export");
    expect(find("EXPORT")[0]).toBe("Export");
  });

  it("matches a prefix, so the list narrows while you type", () => {
    expect(find("expo")[0]).toBe("Export");
    expect(find("techn")[0]).toBe("Technical details");
  });

  it("finds a section by a synonym of its name", () => {
    expect(find("price")[0]).toBe("What it cost");
    expect(find("spend")[0]).toBe("What it cost");
    expect(find("money")[0]).toBe("What it cost");
    expect(find("remove")[0]).toBe("Delete this article");
    expect(find("download")[0]).toBe("Export");
    expect(find("public")[0]).toBe("Access & sharing");
    expect(find("regenerate")[0]).toBe("AI processing");
  });

  it("strips a plural or -ing so a word finds its stem", () => {
    expect(find("costs")[0]).toBe("What it cost");
    expect(find("sharing")).toContain("Access & sharing");
    expect(find("authored")[0]).toBe("Authors");
  });

  it("finds words the page wrote as a section's keywords, and its heading's aside", () => {
    expect(find("slug")[0]).toBe("Technical details");
    expect(find("fingerprint")[0]).toBe("Technical details");
    expect(find("calls")[0]).toBe("What it cost");
  });

  it("does not search a section's body — there is no body in the index", () => {
    /* The interface has no field for it; this pins that the label of one
       section is not found through another's words. */
    expect(find("leeds")).toEqual([]);
  });

  it("ranks by where the word was found before how", () => {
    /* A synonym in the name beats a whole word in the keywords. */
    const hits = searchSections("remove", [
      section("Archive this article", { keywords: "remove" }),
      section("Delete this article"),
    ]);
    expect(hits).toEqual(["Delete this article", "Archive this article"]);
    /* A whole word in the keywords beats a whole word in the aside. */
    expect(
      searchSections("calls", [
        section("Alpha", { aside: "12 calls" }),
        section("Beta", { keywords: "calls" }),
      ]),
    ).toEqual(["Beta", "Alpha"]);
  });

  it("within one place, a whole word beats a prefix beats a synonym", () => {
    expect(
      searchSections("cost", [
        section("Price"),
        section("Costly"),
        section("Cost"),
      ]),
    ).toEqual(["Cost", "Costly", "Price"]);
  });

  it("scores a word once, by its best evidence — repeating it does not climb", () => {
    expect(
      searchSections("glossary", [
        section("Glossary"),
        section("Other", { keywords: "glossary glossary glossary glossary glossary", aside: "glossary" }),
      ])[0],
    ).toBe("Glossary");
  });

  it("keeps page order for a tie", () => {
    expect(
      searchSections("note", [section("Note one"), section("Note two")]),
    ).toEqual(["Note one", "Note two"]);
  });

  it("needs every word to hit somewhere — two words narrow rather than widen", () => {
    expect(find("delete cost")).toEqual([]);
    expect(find("technical slug")).toEqual(["Technical details"]);
  });

  it("drops the words a question is made of, so a question finds its answer", () => {
    expect(find("how much did this cost")[0]).toBe("What it cost");
    expect(find("where can I download it")[0]).toBe("Export");
    expect(find("who wrote this")[0]).toBe("Authors");
  });

  it("keeps those words when they are all there is", () => {
    expect(find("what it")[0]).toBe("What it cost");
  });

  it("matches nothing for a word nothing on the page has", () => {
    expect(find("zebra")).toEqual([]);
  });

  it("ignores accents and punctuation", () => {
    expect(find("café")).toEqual(searchSections("cafe", PAGE));
    expect(find("what-it-cost")[0]).toBe("What it cost");
  });
});
