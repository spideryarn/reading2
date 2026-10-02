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
import { HELP_SYNONYMS } from "../src/web/help/help-content.js";
import {
  METADATA_SYNONYMS,
  searchSections,
  searchStem,
  type SearchableSection,
} from "../src/web/page-search.js";

function section(
  label: string,
  { keywords = "", aside = "" }: Partial<SearchableSection> = {},
): SearchableSection {
  return { id: label, label, keywords, aside };
}

const PAGE: SearchableSection[] = [
  section("In one sentence"),
  section("Authors", { keywords: "names writers byline who wrote it affiliations", aside: "2" }),
  section("At a glance", {
    keywords: "words read time reading duration long blocks parts sections levels length size count statistics",
  }),
  section("How well we read the PDF", { keywords: "transcription missed missing words pages" }),
  section("Access & sharing", {
    keywords: "anyone everybody readers signed in account permission public link privacy visible who can read",
  }),
  section("Your reading", {
    keywords: "purpose reason goal notes comments questions annotations highlights bookmarks progress left off",
  }),
  section("Technical details", {
    keywords: "address url source original stored storage location link fingerprint hash slug id revision",
  }),
  section("What it cost", {
    keywords: "ai calls models tokens breakdown",
    aside: "$0.0123 · 12 calls",
  }),
  section("Export", { keywords: "data files zip" }),
  section("AI processing", {
    keywords: "steps stages pipeline models summaries glossary structure hierarchy",
    aside: "9 of 9 stages",
  }),
  section("Archive this article", { keywords: "remove from shelf" }),
  section("Delete this article", { keywords: "permanent permanently forever" }),
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
    expect(find("source fingerprint")).toEqual(["Technical details"]);
  });

  it("drops the words a question is made of, so a question finds its answer", () => {
    expect(find("how much did this cost")[0]).toBe("What it cost");
    expect(find("where can I download it")[0]).toBe("Export");
    expect(find("who wrote this")[0]).toBe("Authors");
  });

  it("handles natural reader queries against the page's actual sections", () => {
    const cases: [string, string][] = [
      ["comments and notes", "Your reading"],
      ["where I left off", "Your reading"],
      ["reading progress", "Your reading"],
      ["remove from shelf", "Archive this article"],
      ["delete permanently", "Delete this article"],
      ["download my data", "Export"],
      ["where is the zip", "Export"],
      ["which processing stages were used", "AI processing"],
      ["how do I make this public", "Access & sharing"],
      ["who can read it", "Access & sharing"],
      ["storage location", "Technical details"],
      ["original link", "Technical details"],
      ["AI cost", "What it cost"],
      ["read time", "At a glance"],
      ["how long to read", "At a glance"],
      ["what's the cost", "What it cost"],
      ["I'd like to download my data", "Export"],
    ];
    for (const [query, expected] of cases) expect(find(query)[0], query).toBe(expected);
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

/* **A page's own synonym table** — the Help page passes one (plan 261002b,
   R1). The default must stay Metadata's, and a page's table must replace it
   rather than add to it, or Help's words would widen Metadata's matches. */
describe("searchSections with a synonym table of its own", () => {
  const SPINE = [section("Reading the spine", { keywords: "marks" })];
  const OWN = [["rail", "sidebar", "spine"]] as const;

  it("finds through the page's own groups", () => {
    expect(searchSections("sidebar", SPINE, OWN)).toEqual(["Reading the spine"]);
  });

  it("does not find through them by default", () => {
    expect(searchSections("sidebar", SPINE)).toEqual([]);
  });

  it("replaces the default table rather than adding to it", () => {
    // `price` → `cost` is Metadata's group; the custom table does not have it.
    expect(find("price")[0]).toBe("What it cost");
    expect(searchSections("price", PAGE, OWN)).toEqual([]);
  });
});

/* **Forgiving about a word nothing on the page has** — Greg, `spya-nkjpte`,
   2026-10-02 ("more flexible/forgiving"). After an AND miss, a query word that
   matches no section at all is set aside and AND is tried again; two words
   that each mean something still narrow, so *delete cost* finds nothing. The
   code review argued for strict AND; the trade is in page-search.ts §
   searchSections and plan 261002c. */
describe("searchSections sets aside a word that matches nothing anywhere", () => {
  it("finds the section the other words agree on", () => {
    expect(find("regenerate my glossary zebra")[0]).toBe("AI processing");
    expect(find("delete zebra")).toEqual(find("delete"));
  });

  it("still narrows when every word means something", () => {
    expect(find("delete cost")).toEqual([]);
  });

  it("still finds nothing when no word means anything", () => {
    expect(find("zebra giraffe")).toEqual([]);
  });
});

describe("searchSections's question furniture", () => {

  it("keeps `get` meaningful except in the phrase `get rid`", () => {
    expect(
      searchSections(
        "get it back",
        [
          section("Jumping around, and getting back"),
          section("How do I get it back?"),
        ],
        [],
      ),
    ).toEqual(["How do I get it back?", "Jumping around, and getting back"]);
    expect(find("get rid of it forever")[0]).toBe("Delete this article");
  });
});

/* `groupsOf` keeps the last group a stem appears in, silently — so a word in
   two groups loses its first meaning with no error. Checked on stems, since two
   spellings can stem to one word. GPT Sol, plan review of 261002c, P2. */
describe("each synonym table puts a word in one group only", () => {
  for (const [name, table] of [
    ["Metadata", METADATA_SYNONYMS],
    ["Help", HELP_SYNONYMS],
  ] as const) {
    it(name, () => {
      const seen = new Map<string, number>();
      table.forEach((group, i) => {
        for (const word of group) {
          const stem = searchStem(word);
          expect(seen.get(stem) ?? i, `"${word}" is in groups ${seen.get(stem)} and ${i}`).toBe(i);
          seen.set(stem, i);
        }
      });
    });
  }
});
