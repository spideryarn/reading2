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
import type { Citation, InvestigatedPaper } from "../src/types.js";
import {
  INVESTIGATION_LABEL,
  INVESTIGATION_LABEL_WITH_PAPER,
  investigationLabel,
  investigationParts,
  investigationProvenance,
  noPassagesSentence,
  paperReadSentence,
  passageCaption,
} from "../src/web/CitationInvestigation.js";

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
        "One result (arxiv.org) is the page an earlier quick check matched to the work.",
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
        "One result (doi.org) is the page an earlier quick check matched to the work.",
    );
  });

  /* Plan 260930d P-4: the row's lookup matched a page, but this search did
     not return a usable extract from it. `matchedHost` is null both when the
     page is absent and when its result has an empty extract, so the copy must
     not claim which happened. */
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
    "a %s lookup whose page this search did not yield as an extract: says only what the evidence proves",
    (state) => {
      expect(investigationProvenance(UNMATCHED, { state, host: "arxiv.org" })).toBe(
        `${STEM}An earlier quick check matched a page on arxiv.org; this search did not return an extract from it.`,
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
    ).toBe(`${STEM}One result (doi.org) is the page an earlier quick check matched to the work.`);
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

/* ------------------------------------- plan 261001a stage 3: the paper itself -- */

describe("what was read of the paper itself, in words (plan 261001a stage 3)", () => {
  /* Midday UTC, so the day is the same in every time zone a test runs in. */
  const AT = "2026-10-01T12:00:00.000Z";
  const READ: InvestigatedPaper = {
    state: "read",
    requestedUrl: "https://arxiv.org/pdf/2001.08361",
    finalUrl: "https://arxiv.org/pdf/2001.08361",
    host: "arxiv.org",
    words: 11200,
    sentWords: 4900,
    chunks: ["c1", "c2"],
    matchedBy: "arxiv",
    evidenceSha: "a".repeat(64),
    selectionVersion: "paper-selection/1",
    readAt: AT,
    passages: [],
  };

  it.each([
    [
      READ,
      "We read the paper itself: a PDF from arxiv.org, 11,200 words. The AI was shown 4,900 of them — the opening and the passages closest to what the article cites it for. Matched by its title and arXiv id. Read on 1 October 2026.",
    ],
    [
      { ...READ, matchedBy: "doi" },
      "We read the paper itself: a PDF from arxiv.org, 11,200 words. The AI was shown 4,900 of them — the opening and the passages closest to what the article cites it for. Matched by its title and DOI. Read on 1 October 2026.",
    ],
    [
      { state: "unreadable", requestedUrl: "https://doi.org/10.1/x", host: "nature.com", unreadableWhy: "refused", readAt: AT },
      "We could not get the paper because the site would not let us read it — publishers often turn away automated readers. We tried nature.com on 1 October 2026.",
    ],
    [
      { state: "not-the-full-text", requestedUrl: "https://doi.org/10.1/x", finalUrl: "https://pub.example/x", host: "pub.example", readAt: AT },
      "We reached a page for this work on pub.example, but not its full text, so the AI was not shown it. Tried on 1 October 2026.",
    ],
    [
      { state: "not-confirmed", requestedUrl: "https://arxiv.org/pdf/1", finalUrl: "https://arxiv.org/pdf/1", host: "arxiv.org", readAt: AT },
      "We found a document on arxiv.org but could not confirm it is this work, so the AI was not shown it. Tried on 1 October 2026.",
    ],
    [
      { state: "identity-conflict", requestedUrl: "https://doi.org/10.1/z", host: "doi.org", readAt: AT },
      "The identifier the article gives points to a different title, so we did not use it. Tried on 1 October 2026.",
    ],
    [{ state: "no-address", readAt: AT }, "We had no address for the paper itself, so the AI was not shown it. Tried on 1 October 2026."],
  ] as [InvestigatedPaper, string][])("says case %#", (paper, sentence) => {
    expect(paperReadSentence(paper)).toBe(sentence);
  });

  it("names the paper in the label only when the AI was shown it", () => {
    expect(investigationLabel({ paper: READ })).toBe(INVESTIGATION_LABEL_WITH_PAPER);
    expect(investigationLabel({ paper: { state: "no-address", readAt: AT } })).toBe(INVESTIGATION_LABEL);
    expect(investigationLabel({})).toBe(INVESTIGATION_LABEL);
  });

  it("an answer from before the paper was read is said exactly as before; with a paper, never 'we did not fetch any page'", () => {
    const base = {
      sources: [src("https://example.org/a")],
      extractsRead: 1,
      longestExtractWords: 9,
      matchedHost: null,
    };
    expect(investigationProvenance(base)).toContain(MIDDLE);
    const withRead = investigationProvenance({ ...base, paper: READ });
    expect(withRead).not.toContain("We did not fetch any page");
    expect(withRead).toContain("the parts of the paper it was shown");
    expect(withRead).toContain("not to quote it or the paper");
    const without = investigationProvenance({ ...base, paper: { state: "no-address", readAt: AT } });
    expect(without).not.toContain("We did not fetch any page");
    expect(without).not.toContain("the paper it was shown");
  });

  it("captions a passage with its page and the AI's reading, and never calls none found a failure or the reverse", () => {
    expect(passageCaption({ page: 3, bears: "partly" })).toBe("page 3 · the AI's reading: partly supports it");
    expect(noPassagesSentence([])).toBe("The AI found no passage it could point to in what it was shown.");
    expect(noPassagesSentence(null)).toMatch(/failed/);
    expect(noPassagesSentence(null)).not.toMatch(/does not support/);
  });
});
