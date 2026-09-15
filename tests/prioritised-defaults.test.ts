/**
 * **Where each prioritised bar rests when nobody has touched it, and what
 * search opens on.**
 *
 * Greg, 2026-09-12, two reports on one subject: *"Make prioritized the default
 * submode for search"* and *"set the threshold lower, i.e. more permissive, so
 * that for all of these different modes, most of the entries are coming in by
 * default."* The numbers were measured on the local corpus —
 * docs/plans/260915d-prioritised-by-default-in-search-and-lower-default-thresholds-everywhere.md
 * § The measurement — so what is pinned here is the boundary each one draws,
 * through each panel's own composite, rather than a share of some fixture list:
 * a share would be a fact about the fixture.
 *
 * The four callers of `applyThreshold` that have a prioritised order. Debate's
 * categorical bar is the fifth caller and is deliberately not here — see the
 * plan's § Which modes these are.
 */
import { describe, expect, it } from "vitest";
import type { CitedWork, GlossaryEntry, Quote } from "../src/types.js";
import {
  CITATION_BAR_DEFAULT,
  priorityOf as citationPriority,
} from "../src/web/CitationsPanel.js";
import { PRIORITY_GATE, priorityOf as termPriority } from "../src/web/GlossaryPanel.js";
import { orderParam } from "../src/web/params.js";
import {
  QUOTE_BAR_DEFAULT,
  QUOTE_HEAVY_AT,
  priorityOf as quotePriority,
  quoteTier,
} from "../src/web/QuotesPanel.js";
import { PRIORITY_CONF } from "../src/web/search-hits.js";
import { survivesThreshold } from "../src/web/threshold.js";

const term = (difficulty: number, centrality: number) =>
  ({ difficulty, centrality }) as GlossaryEntry;
const quote = (importance: number, striking?: number): Quote => ({
  id: "q",
  blockId: "spya-aaaaaa",
  text: "t",
  importance,
  ...(striking === undefined ? {} : { striking }),
});
const work = (relevance: number, influence: number) => ({ relevance, influence }) as CitedWork;

describe("search opens on the prioritised order", () => {
  it("defaults ?order= to prioritised", () => {
    expect(orderParam.defaultValue).toBe("prioritised");
  });
});

describe("each measured bar rests at its new boundary", () => {
  it("glossary: 0.10 on difficulty × centrality", () => {
    expect(PRIORITY_GATE).toBe(0.1);
    // 0.4 × 0.3 = 0.12 — a term the old 0.30 hid, and the new one keeps.
    expect(survivesThreshold(termPriority(term(0.4, 0.3)), PRIORITY_GATE)).toBe(true);
    // 0.3 × 0.3 = 0.09 — still under the bar: it is a bar, not a formality.
    expect(survivesThreshold(termPriority(term(0.3, 0.3)), PRIORITY_GATE)).toBe(false);
  });

  it("quotes: 0.60 on max(importance, striking)", () => {
    expect(QUOTE_BAR_DEFAULT).toBe(0.6);
    expect(survivesThreshold(quotePriority(quote(0.4, 0.65)), QUOTE_BAR_DEFAULT)).toBe(true);
    expect(survivesThreshold(quotePriority(quote(0.55, 0.5)), QUOTE_BAR_DEFAULT)).toBe(false);
  });

  it("citations: 0.25 on (2 × relevance + influence) / 3", () => {
    expect(CITATION_BAR_DEFAULT).toBe(0.25);
    // (2 × 0.3 + 0.2) / 3 ≈ 0.27 — kept.
    expect(survivesThreshold(citationPriority(work(0.3, 0.2)), CITATION_BAR_DEFAULT)).toBe(true);
    // (2 × 0.2 + 0.2) / 3 = 0.20 — not.
    expect(survivesThreshold(citationPriority(work(0.2, 0.2)), CITATION_BAR_DEFAULT)).toBe(false);
  });

  it("search: 30 on the 0–100 confidence the rows print", () => {
    expect(PRIORITY_CONF).toBe(30);
    expect(survivesThreshold(30, PRIORITY_CONF)).toBe(true);
    expect(survivesThreshold(29, PRIORITY_CONF)).toBe(false);
  });
});

describe("the quote stroke keeps its own number", () => {
  it("stays heavy from 0.80, above where the bar now rests", () => {
    /* Tied to the bar, every quote on screen by default would be heavy and the
       two-tier stroke would say nothing on first open. Decoupled, a quote the
       default bar keeps can still be drawn light. */
    expect(QUOTE_HEAVY_AT).toBe(0.8);
    const kept = quote(0.7);
    expect(survivesThreshold(quotePriority(kept), QUOTE_BAR_DEFAULT)).toBe(true);
    expect(quoteTier(kept)).toBe(1);
    expect(quoteTier(quote(0.8))).toBe(2);
  });
});
