/**
 * **What an *Investigate* row says it read, composed by code** — plan 260930a
 * § What was read and § Which result is the work, and the answer split into
 * its parts for the collapsed view. src/web/CitationInvestigation.tsx.
 *
 * The provenance sentence is the one place a reader learns how much of the
 * work was actually in front of the AI, so every branch is pinned whole: the
 * count (one result or many), the hosts (distinct, only real web addresses),
 * and the identity line (matched by the first check and read here, matched but not returned here, or not confirmed — plan 260930d P-4). There is
 * no profile branch: the stored record does not say whether a profile was
 * sent, so the sentence does not claim either way.
 */
import { describe, expect, it } from "vitest";
import type { Citation } from "../src/types.js";
import { investigationParts, investigationProvenance } from "../src/web/CitationInvestigation.js";

const src = (url: string, title?: string): Citation => (title ? { url, title } : { url });

const MIDDLE =
  "We did not fetch any page ourselves; an extract may be an abstract or part of a paper's text.";

describe("investigationProvenance", () => {
  it("many results, one matched by the first check: distinct hosts, the longest extract, the match", () => {
    expect(
      investigationProvenance({
        sources: [
          src("https://arxiv.org/abs/1", "A"),
          src("https://www.nature.com/articles/2", "B"),
          src("https://arxiv.org/pdf/1", "A again"),
        ],
        extractsRead: 3,
        longestExtractWords: 412,
        matchedHost: "arxiv.org",
      }),
    ).toBe(
      "Web search returned extracts for 3 results (arxiv.org, nature.com), the longest about 412 words. " +
        `${MIDDLE} ` +
        "The AI was asked to base what it says about the work on those extracts, and used this article to relate them. " +
        "It was instructed not to quote them. " +
        "One result (arxiv.org) was matched to the work by the first check.",
    );
  });

  it("many results, none matched: says it could not confirm any is the work", () => {
    expect(
      investigationProvenance({
        sources: [src("https://example.org/a"), src("https://example.com/b")],
        extractsRead: 2,
        longestExtractWords: 90,
        matchedHost: null,
      }),
    ).toBe(
      "Web search returned extracts for 2 results (example.org, example.com), the longest about 90 words. " +
        `${MIDDLE} ` +
        "The AI was asked to base what it says about the work on those extracts, and used this article to relate them. " +
        "It was instructed not to quote them. " +
        "We could not confirm that any result is this work itself.",
    );
  });

  it("one result, unmatched: singular throughout, and no 'longest'", () => {
    expect(
      investigationProvenance({
        sources: [src("https://www.semanticscholar.org/paper/x")],
        extractsRead: 1,
        longestExtractWords: 250,
        matchedHost: null,
      }),
    ).toBe(
      "Web search returned an extract for one result (semanticscholar.org), about 250 words. " +
        `${MIDDLE} ` +
        "The AI was asked to base what it says about the work on that extract, and used this article to relate it. " +
        "It was instructed not to quote it. " +
        "We could not confirm that any result is this work itself.",
    );
  });

  it("one result, matched, of one word", () => {
    expect(
      investigationProvenance({
        sources: [src("https://doi.org/10.1/x")],
        extractsRead: 1,
        longestExtractWords: 1,
        matchedHost: "doi.org",
      }),
    ).toBe(
      "Web search returned an extract for one result (doi.org), about 1 word. " +
        `${MIDDLE} ` +
        "The AI was asked to base what it says about the work on that extract, and used this article to relate it. " +
        "It was instructed not to quote it. " +
        "One result (doi.org) was matched to the work by the first check.",
    );
  });

  /* Plan 260930d P-4: the row's lookup matched a page, and this search did
     not return it. `matchedHost` is null, so without the lookup the line would
     say "could not confirm" right under a row showing a code-matched page. */
  const UNMATCHED = {
    sources: [src("https://example.org/a"), src("https://example.com/b")],
    extractsRead: 2,
    longestExtractWords: 90,
    matchedHost: null,
  };
  const STEM =
    "Web search returned extracts for 2 results (example.org, example.com), the longest about 90 words. " +
    `${MIDDLE} ` +
    "The AI was asked to base what it says about the work on those extracts, and used this article to relate them. " +
    "It was instructed not to quote them. ";

  it.each(["assessed", "unreadable"] as const)(
    "a %s lookup whose page this search did not return: says the first check matched it, and this search did not",
    (state) => {
      expect(investigationProvenance(UNMATCHED, { state, host: "arxiv.org" })).toBe(
        `${STEM}The first check matched a page on arxiv.org; this search's own results did not include it.`,
      );
    },
  );

  it.each(["no-extract", "not-identified"] as const)(
    "a %s lookup identified no page, so it is still 'could not confirm'",
    (state) => {
      expect(investigationProvenance(UNMATCHED, { state, host: "arxiv.org" })).toBe(
        `${STEM}We could not confirm that any result is this work itself.`,
      );
    },
  );

  it("no lookup, or a null one: 'could not confirm'", () => {
    for (const lookup of [undefined, null]) {
      expect(investigationProvenance(UNMATCHED, lookup)).toBe(
        `${STEM}We could not confirm that any result is this work itself.`,
      );
    }
  });

  it("a page read here wins over the lookup's own host", () => {
    expect(
      investigationProvenance({ ...UNMATCHED, matchedHost: "doi.org" }, { state: "assessed", host: "arxiv.org" }),
    ).toBe(`${STEM}One result (doi.org) was matched to the work by the first check.`);
  });

  it("names no host that is not a web address, and drops the brackets when none is left", () => {
    const said = investigationProvenance({
      sources: [src("javascript:alert(1)"), src("not a url")],
      extractsRead: 2,
      longestExtractWords: 30,
      matchedHost: null,
    });
    expect(said.startsWith("Web search returned extracts for 2 results, the longest about 30 words. ")).toBe(true);
    expect(said).not.toMatch(/javascript|not a url|\(\)/);
  });

  it("never claims the paper was read, verified or confirmed as the work", () => {
    for (const matchedHost of ["arxiv.org", null]) {
      const said = investigationProvenance({
        sources: [src("https://arxiv.org/abs/1")],
        extractsRead: 1,
        longestExtractWords: 10,
        matchedHost,
      });
      expect(said).not.toMatch(/full (text|paper)|verified|we read the/i);
    }
  });
});

describe("investigationParts", () => {
  it("splits on blank lines and takes each part's lead off its first line", () => {
    expect(
      investigationParts(
        "Does it back the claim?\nThe abstract on arxiv.org says so.\n\nHow else it bears on this article\nIt extends the model.\n\nFor you\nWorth a look.",
      ),
    ).toEqual([
      { lead: "Does it back the claim?", text: "The abstract on arxiv.org says so." },
      { lead: "How else it bears on this article", text: "It extends the model." },
      { lead: "For you", text: "Worth a look." },
    ]);
  });

  it("joins a lead standing alone to the paragraph after it", () => {
    expect(investigationParts("Does it back the claim?\n\nThe abstract says so.\n\n\nFor you\n\nYes.")).toEqual([
      { lead: "Does it back the claim?", text: "The abstract says so." },
      { lead: "For you", text: "Yes." },
    ]);
  });

  it("recognises a lead dressed in markdown or a colon, and drops the dressing", () => {
    expect(investigationParts("**How else it bears on this article:**\nIt disagrees.\r\n\r\n## for you\nMaybe.")).toEqual([
      { lead: "How else it bears on this article", text: "It disagrees." },
      { lead: "for you", text: "Maybe." },
    ]);
  });

  it("keeps a paragraph with no lead as it is, and a lead's paragraph line breaks", () => {
    expect(investigationParts("  Plain first.  \n\nDoes it back the claim?\nOne line.\nAnother.")).toEqual([
      { lead: null, text: "Plain first." },
      { lead: "Does it back the claim?", text: "One line.\nAnother." },
    ]);
  });

  it("an empty answer has no parts", () => {
    expect(investigationParts("")).toEqual([]);
    expect(investigationParts(" \n\n ")).toEqual([]);
  });
});
