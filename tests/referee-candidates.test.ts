/**
 * **The four hard rules Candidates is under, as code rather than as prompt.**
 *
 * Referee mode's fourth sub-mode asks a model to name real people, which is the
 * one output nothing in the article can check: a plausible name beside a
 * real-looking URL is exactly what a model produces well. So the plan gave it
 * four rules (docs/plans/260831an-referee-mode-for-peer-reviewers.md § 4), and
 * the only ones worth having are the ones a test can break. This file is that
 * test.
 *
 * Each rule below was watched fail before it was watched pass — by mutating
 * src/referee-candidates.ts forwards to remove the check, running, and editing
 * it back. A check nobody has seen fail is not evidence
 * (docs/reusable/silent-success.md).
 *
 * The fifth section is about the thing that makes the other four safe to
 * enforce: a dropped row is **counted**, so a panel can tell *the model named
 * nobody* from *the model named eleven people and none of them survived*. That
 * distinction went missing in Criteria and needed a second cross-family review
 * to catch.
 */
import { describe, expect, it } from "vitest";
import type { Citation } from "../src/types.js";
import {
  ALL_DROPPED,
  COI_NOT_CHECKED,
  MAX_CANDIDATES,
  NO_BYLINE_TO_EXCLUDE,
  SHORTLIST_FENCE,
  anyDropped,
  authorKeys,
  citedUrls,
  excludedByByline,
  nameKey,
  readShortlist,
  withoutShortlist,
} from "../src/referee-candidates.js";

const FOUND = "https://example.org/lab/kessler";
const ALSO_FOUND = "https://example.com/papers/hierarchical";

/** What the web search came back with, as `collectCitations` would have kept it. */
const allowed = (): Map<string, Citation> =>
  new Map([
    [FOUND, { url: FOUND, title: "Kessler Lab — people" }],
    [ALSO_FOUND, { url: ALSO_FOUND, title: "Hierarchical models in practice" }],
  ]);

const blockIds = new Set(["spya-k3m9qt", "spya-p7w2dn"]);

/** One row, with everything right, that individual tests then spoil. */
function row(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: "Ada Kessler",
    affiliation: "University of Nowhere",
    requirement: "Someone who can judge a hierarchical Bayesian fit",
    blockId: "spya-k3m9qt",
    why: "Has published the method on comparable data",
    sources: [FOUND],
    ...over,
  };
}

/** An answer with prose and a fenced shortlist, the way the model is asked to write one. */
function answer(rows: unknown[], prose = "Here are some people worth asking.\n\n"): string {
  return `${prose}\`\`\`${SHORTLIST_FENCE}\n${JSON.stringify(rows, null, 2)}\n\`\`\``;
}

function read(text: string, authors: Set<string> = new Set()) {
  return readShortlist(text, { allowed: allowed(), blockIds, authors });
}

describe("rule 1 — no name without a source link the web search returned", () => {
  it("keeps a candidate whose source came back from the search", () => {
    const list = read(answer([row()]));
    expect(list?.candidates).toHaveLength(1);
    expect(list?.candidates[0]?.sources).toEqual([
      { url: FOUND, title: "Kessler Lab — people" },
    ]);
  });

  it("drops a candidate whose URL parses but was never returned", () => {
    /* The failure mode this rule is for. `https://mit.edu/~kessler` is a
       perfectly good address, it is not in `allowed`, and nothing else in the
       system could tell that the model made it up. */
    const list = read(answer([row({ sources: ["https://mit.edu/~kessler"] })]));
    expect(list?.candidates).toEqual([]);
    expect(list?.dropped.uncited).toBe(1);
  });

  it("drops a candidate with no sources at all", () => {
    const list = read(answer([row({ sources: [] })]));
    expect(list?.candidates).toEqual([]);
    expect(list?.dropped.uncited).toBe(1);
  });

  it("takes the title from the search result, never from the model", () => {
    /* The label a reader clicks says what the search found there, not what the
       model would like them to think is there. */
    const list = read(
      answer([row({ sources: [{ url: FOUND, title: "Definitive proof of expertise" }] })]),
    );
    /* An object where a string was asked for is not a source at all — but the
       point stands either way, so the string form is checked for the title. */
    expect(list?.candidates).toEqual([]);
    const good = read(answer([row()]));
    expect(good?.candidates[0]?.sources[0]?.title).toBe("Kessler Lab — people");
  });

  it("refuses a non-http scheme even if something put one in the allowed map", () => {
    const withJs = new Map(allowed());
    withJs.set("javascript:alert(1)", { url: "javascript:alert(1)" });
    const list = readShortlist(answer([row({ sources: ["javascript:alert(1)"] })]), {
      allowed: withJs,
      blockIds,
      authors: new Set(),
    });
    expect(list?.candidates).toEqual([]);
    expect(list?.dropped.uncited).toBe(1);
  });

  it("gathers the allowed URLs from every answer in the conversation, not just the last", () => {
    /* The model is asked to re-emit the whole shortlist each turn, so a person
       found in turn two is still in turn five's fence long after turn five's own
       searches have moved on. Scoping this to one answer would delete the older
       half of every long list and call it uncited. */
    const urls = citedUrls([
      { role: "user" },
      { role: "assistant", citations: [{ url: FOUND, title: "one" }] },
      { role: "user" },
      { role: "assistant", citations: [{ url: ALSO_FOUND }] },
    ]);
    expect([...urls.keys()]).toEqual([FOUND, ALSO_FOUND]);
  });

  it("ignores citations on a user turn", () => {
    expect(citedUrls([{ role: "user", citations: [{ url: FOUND }] }]).size).toBe(0);
  });
});

describe("rule 2 — the paper's own authors are excluded", () => {
  it("drops an author written exactly as the byline has them", () => {
    const list = read(answer([row({ name: "Ada Kessler" })]), authorKeys("Ada Kessler"));
    expect(list?.candidates).toEqual([]);
    expect(list?.dropped.authors).toBe(1);
  });

  it("drops an author written with a middle initial, or with only an initial", () => {
    const authors = authorKeys("Ada Kessler and Bo Nakamura");
    expect(read(answer([row({ name: "Ada Q. Kessler" })]), authors)?.dropped.authors).toBe(1);
    expect(read(answer([row({ name: "A. Kessler" })]), authors)?.dropped.authors).toBe(1);
    expect(read(answer([row({ name: "Bo Nakamura" })]), authors)?.dropped.authors).toBe(1);
  });

  it("reads a surname-first byline", () => {
    expect(authorKeys("Kessler, Ada")).toEqual(new Set(["kessler|a"]));
  });

  it("reads a comma-separated list of full names as several people", () => {
    expect(authorKeys("Ada Kessler, Bo Nakamura, Chi Oyelaran")).toEqual(
      new Set(["kessler|a", "nakamura|b", "oyelaran|c"]),
    );
  });

  it("folds diacritics, so Müller and Muller are one person", () => {
    expect(nameKey("Eva Müller")).toBe(nameKey("Eva Muller"));
  });

  it("does not drop an unrelated namesake", () => {
    /* Surname-only matching would exclude every Kessler in the field, and the
       editor would never learn it had happened. That is a worse failure than the
       one it prevents. */
    const list = read(answer([row({ name: "Zoë Kessler" })]), authorKeys("Ada Kessler"));
    expect(list?.candidates).toHaveLength(1);
    expect(list?.dropped.authors).toBe(0);
  });

  it("declines to build a key from a one-word byline", () => {
    /* "Anonymous", "The Editors", a mangled byline. A rule that cannot be sure
       declines to exclude: showing an extra name costs a glance, withholding the
       right person costs the reviewer. */
    expect(nameKey("Anonymous")).toBeNull();
    expect(authorKeys("Anonymous").size).toBe(0);
    expect(authorKeys(undefined).size).toBe(0);
  });
});

describe("rule 3 — every candidate answers a fit-requirement, anchored in the paper", () => {
  it("drops a candidate with no requirement", () => {
    const list = read(answer([row({ requirement: "  " })]));
    expect(list?.candidates).toEqual([]);
    expect(list?.dropped.unanchored).toBe(1);
  });

  it("drops a candidate whose block id this paper does not have", () => {
    const list = read(answer([row({ blockId: "spya-zzzzzz" })]));
    expect(list?.candidates).toEqual([]);
    expect(list?.dropped.unanchored).toBe(1);
  });

  it("drops a candidate with no block id at all", () => {
    const list = read(answer([row({ blockId: undefined })]));
    expect(list?.candidates).toEqual([]);
    expect(list?.dropped.unanchored).toBe(1);
  });
});

describe("rule 4 — the panel says what it has not checked", () => {
  it("names both halves of conflict of interest, and claims neither", () => {
    /* Half of what publishers name is mechanically checkable and we check none
       of it; the other half is not automatable by anybody. The sentence has to
       carry both, because saying nothing reads as a filter that ran. */
    expect(COI_NOT_CHECKED).toMatch(/no conflict-of-interest check has run/i);
    expect(COI_NOT_CHECKED).toMatch(/co-authorship/i);
    expect(COI_NOT_CHECKED).toMatch(/advisor/i);
    expect(COI_NOT_CHECKED).not.toMatch(/\bno conflicts? (were )?found\b/i);
  });

  it("says which byline the author exclusion actually ran against", () => {
    expect(excludedByByline("Ada Kessler")).toContain("Ada Kessler");
    expect(NO_BYLINE_TO_EXCLUDE).toMatch(/no author exclusion could be run in code/i);
  });
});

describe("the fence", () => {
  it("returns null when the answer carries no shortlist", () => {
    /* Not an empty list. "The model has not named anybody" and "the model named
       people and none of them could be shown" are different sentences and the
       panel prints different ones. */
    expect(read("Here is the fit brief. [spya-k3m9qt]")).toBeNull();
  });

  it("takes the last complete block, so a model that corrects itself is read as corrected", () => {
    const text = `${answer([row({ name: "Ada Kessler" })])}\n\nOn reflection:\n\n${answer([
      row({ name: "Bo Nakamura" }),
    ], "")}`;
    expect(read(text)?.candidates.map((c) => c.name)).toEqual(["Bo Nakamura"]);
  });

  it("ignores a fence that has not closed yet", () => {
    /* What a streaming answer looks like for the second it takes the JSON to
       arrive. Parsing half a document throws; showing it would be showing an
       unvalidated claim about a named person. */
    const partial = `Names:\n\n\`\`\`${SHORTLIST_FENCE}\n[\n  {"name": "Ada Kess`;
    expect(read(partial)).toBeNull();
  });

  it("hides the block from the prose, closed or not", () => {
    expect(withoutShortlist(answer([row()]))).toBe("Here are some people worth asking.");
    const partial = `Names:\n\n\`\`\`${SHORTLIST_FENCE}\n[\n  {"name": "Ada Kess`;
    expect(withoutShortlist(partial)).toBe("Names:");
  });

  it("counts unreadable JSON as a malformed row rather than as no shortlist", () => {
    const broken = `Names:\n\n\`\`\`${SHORTLIST_FENCE}\n{ not json at all }\n\`\`\``;
    const list = read(broken);
    expect(list?.candidates).toEqual([]);
    expect(list?.dropped.malformed).toBe(1);
    expect(anyDropped(list?.dropped ?? { uncited: 0, authors: 0, unanchored: 0, malformed: 0, duplicate: 0 })).toBe(true);
  });

  it("caps the list", () => {
    /* Distinct **keys**, not just distinct strings: digits are not letters, so
       `Surname1` and `Surname2` reduce to one key and the first version of this
       test measured the deduplicator instead of the cap. It went red saying
       `expected 1 to be 40`, which is how that was noticed. */
    const letters = "abcdefghijklmnopqrstuvwxyz";
    const many = Array.from({ length: MAX_CANDIDATES + 5 }, (_, i) => {
      const a = letters[i % 26] ?? "a";
      const b = letters[Math.floor(i / 26) % 26] ?? "a";
      return row({ name: `Given${a}${b} Surname${a}${b}${a}` });
    });
    expect(read(answer(many))?.candidates.length).toBe(MAX_CANDIDATES);
  });

  it("drops the same person named twice", () => {
    const list = read(answer([row(), row({ affiliation: "Elsewhere" })]));
    expect(list?.candidates).toHaveLength(1);
    expect(list?.dropped.duplicate).toBe(1);
  });
});

describe("what was dropped is counted, not swallowed", () => {
  it("tells 'named nobody' apart from 'named people and showed none'", () => {
    const named = read("Just the brief for now. [spya-k3m9qt]");
    expect(named).toBeNull();

    const allBad = read(answer([row({ sources: ["https://elsewhere.test/x"] }), row({ blockId: "spya-zzzzzz" })]));
    expect(allBad?.candidates).toEqual([]);
    expect(anyDropped(allBad?.dropped ?? { uncited: 0, authors: 0, unanchored: 0, malformed: 0, duplicate: 0 })).toBe(true);
    expect(ALL_DROPPED).toMatch(/named people and none of them could be shown/i);
  });

  it("reports nothing dropped when nothing was", () => {
    const list = read(answer([row()]));
    expect(anyDropped(list?.dropped ?? { uncited: 1, authors: 0, unanchored: 0, malformed: 0, duplicate: 0 })).toBe(false);
  });
});
