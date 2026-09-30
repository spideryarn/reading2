/**
 * **How much a passage bears on its row's target — `bears`** (`debate/3`;
 * docs/plans/260929h-debate-mode-clearer-sources-and-orders.md, stage 2; the
 * review's F3 and F5).
 *
 * The one field stage 2 kept. It was asked beside the work's title, authors and
 * year, which were dropped after measurement (the plan's § The measurement, as
 * it runs); the file keeps its name so its history stays in one place.
 *
 * Positive and rejection controls, because a check never seen to refuse
 * anything is not evidence (docs/reusable/silent-success.md) — and the case
 * that matters most: **out of vocabulary is absent, never a default stop**, so
 * a row is never filed in a relevance band the model did not choose.
 */
import { describe, expect, it } from "vitest";
import {
  blockTextById,
  CLAIMS_SYSTEM,
  DIRECT_SYSTEM,
  readBearsField,
  readClaimGroup,
  readDirectGroup,
} from "../src/debate.js";
import { isDebateBears, readStoredBears } from "../src/types.js";
import type { Block, SearchEvidence } from "../src/types.js";
import { bearsLines, bearsProblems, bearsReport, completeBearsReport } from "../evals/debate/bears.js";

describe("the live reader", () => {
  it("keeps each of the three stops", () => {
    expect(readBearsField({ bears: "directly" })).toEqual({ bears: "directly" });
    expect(readBearsField({ bears: "partly" })).toEqual({ bears: "partly" });
    expect(readBearsField({ bears: " loosely " })).toEqual({ bears: "loosely" });
  });

  it("leaves it absent, not defaulted, for anything else — absent means unjudged", () => {
    for (const bears of ["very", "DIRECTLY", "relevant", 0.73, null, "", undefined]) {
      expect(readBearsField({ bears })).toEqual({});
    }
    expect(readBearsField({})).toEqual({});
  });
});

describe("the stored reader agrees with the live one", () => {
  it("reads a stop, and null for anything else", () => {
    expect(readStoredBears({ bears: "directly" })).toBe("directly");
    expect(readStoredBears({})).toBeNull();
    expect(readStoredBears({ bears: "DIRECTLY" })).toBeNull();
    expect(isDebateBears("loosely")).toBe(true);
    expect(isDebateBears("relevant")).toBe(false);
  });
});

/* ----------------------------------------------- wired through readShared (F3) -- */

describe("both group readers carry it, and never lose a row over it", () => {
  const block = (id: string, text: string): Block => ({
    id,
    tag: "p",
    kind: "text",
    text,
    words: text.split(/\s+/).length,
    html: `<p>${text}</p>`,
    gistable: true,
  });
  const EXCERPT =
    "Hippocampo-cortical coupling mediates memory consolidation during sleep. Reinforcing the " +
    "endogenous coordination between hippocampal sharp wave-ripples and cortical delta waves boosted consolidation.";
  const evidence: SearchEvidence = { url: "https://www.nature.com/articles/nn.4304", excerpt: EXCERPT };
  const input = {
    admissible: new Map([[evidence.url, evidence]]),
    article: {
      url: "https://example.invalid/this-article",
      title: "Hippocampo-cortical coupling mediates memory consolidation during sleep",
      byline: null,
    },
    blockText: blockTextById([
      block("spya-aaaaaa", "Sleep consolidates memory by coordinating ripples with cortical delta waves."),
    ]),
  };
  const claimRow = {
    url: evidence.url,
    blockId: "spya-aaaaaa",
    claimQuote: "coordinating ripples with cortical delta waves",
    sourceQuote: "Reinforcing the endogenous coordination between hippocampal sharp wave-ripples",
    relation: "corroborates",
    lean: "leans-for",
    applies: "It is the experiment behind the claim.",
  };

  it("a claim row keeps a stop", () => {
    const group = readClaimGroup([{ ...claimRow, bears: "partly" }], input, 1);
    expect(group.rows[0]?.bears).toBe("partly");
  });

  it("a claim row with an unknown answer is kept, unjudged", () => {
    const group = readClaimGroup([{ ...claimRow, bears: "somewhat" }], input, 1);
    expect(group.counts.keptRows).toBe(1);
    const kept = group.rows[0];
    expect(kept && "bears" in kept).toBe(false);
  });

  it("a direct row carries it too, and nothing about the work", () => {
    const group = readDirectGroup(
      [
        {
          url: evidence.url,
          sourceQuote: claimRow.sourceQuote,
          articleReferenceQuote: "Hippocampo-cortical coupling mediates memory consolidation during sleep",
          relation: "corroborates",
          lean: "leans-for",
          applies: "It is this piece.",
          bears: "directly",
          /* Offered anyway: nothing on the live path reads these any more. */
          title: "Hippocampo-cortical coupling mediates memory consolidation during sleep",
          year: 2016,
        },
      ],
      input,
      1,
    );
    expect(group.counts.keptRows).toBe(1);
    const kept = group.rows[0];
    expect(kept?.bears).toBe("directly");
    expect(kept && ("workTitle" in kept || "publishedYear" in kept || "authors" in kept)).toBe(false);
  });
});

/* ------------------------------------------------ the eval's measurement (F4) -- */

describe("the eval's bears report", () => {
  it("counts omitted, offered by stop, and refused, and the stored rows by stop", () => {
    const reported = [{ bears: "directly" }, { bears: "hugely" }, {}, { bears: "partly" }, "not a row"];
    const report = bearsReport(reported, [{ bears: "directly" }, {}]);
    expect(report).toEqual({
      rows: 5,
      omitted: 2,
      offered: { directly: 1, partly: 1, loosely: 0 },
      refused: 1,
      keptRows: 2,
      onKeptRows: { directly: 1, partly: 0, loosely: 0 },
      unjudgedKept: 1,
    });
    expect(bearsProblems(report)).toEqual([]);
  });

  it("says a pre-debate/3 answer offered nothing, rather than printing zeros", () => {
    expect(bearsLines(bearsReport([{ applies: "x" }], [])).join("\n")).toContain("none offered");
  });

  it("names broken arithmetic rather than printing it", () => {
    const report = bearsReport([{}], []);
    report.omitted += 1;
    expect(bearsProblems(report)).not.toEqual([]);
    expect(bearsLines(report).join("\n")).toContain("! omitted + offered + refused does not add up");
  });

  it("makes no run-level claim from a partial replay", () => {
    const direct = bearsReport([{ bears: "directly" }], [{ bears: "directly" }]);
    const claims = bearsReport([{ bears: "partly" }], [{ bears: "partly" }]);
    expect(completeBearsReport([{ ok: true, pass: "direct", bears: direct }])).toBeNull();
    expect(
      completeBearsReport([
        { ok: true, pass: "direct", bears: direct },
        { ok: false, pass: "claims" },
      ]),
    ).toBeNull();
    expect(
      completeBearsReport([
        { ok: true, pass: "direct", bears: direct },
        { ok: true, pass: "claims", bears: claims },
      ]),
    ).toMatchObject({ rows: 2, keptRows: 2 });
  });
});

/* -------------------------------------------------------------- the prompts -- */

describe("both prompts ask for bears, and no longer for the work", () => {
  const flat = (p: string) => p.replace(/\s+/g, " ");
  it.each([
    ["direct", flat(DIRECT_SYSTEM)],
    ["claims", flat(CLAIMS_SYSTEM)],
  ])("%s", (_name, prompt) => {
    expect(prompt).toContain('"bears"');
    for (const stop of ["directly", "partly", "loosely"]) expect(prompt).toContain(stop);
    /* Dropped after measurement: the extract is a mid-page passage. */
    expect(prompt).not.toContain('"authors"');
    expect(prompt).not.toContain('"year"');
    expect(prompt).not.toContain("WHAT THE PAGE SAYS THE WORK IS");
    /* True of the search still; the reader's orders are the reader's (F16). */
    expect(prompt).toContain("No ranking by prominence is applied to what you return");
  });
});
