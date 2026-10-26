/**
 * **A finding's chat origin and the id the step mints are one shape** — plan
 * docs/plans/261025h-sources-becomes-three-chips-a-cost-ladder-and-experiments.md,
 * decision 9; queue item qi-mmtsxdhg.
 *
 * For a finding, the route requires `SITUATE_FINDING_ID`; the overview is the
 * one other admitted shape, `SITUATE_OVERVIEW_ID` (src/routes.ts §
 * `parseSituateOrigin`). Finding ids are minted by src/situate.ts §
 * `findingId`. If the step ever mints another finding shape, every finding's
 * *Ask in chat* would get a 400, and this is the test that says so first.
 */
import { describe, expect, it } from "vitest";

import { titleFromOrigin } from "../src/chat-title.js";
import { findingId } from "../src/situate.js";
import {
  SITUATE_FINDING_ID,
  SITUATE_FINDING_KINDS,
  SITUATE_OVERVIEW_ID,
  sameOrigin,
  situateOverviewId,
  type ThreadOrigin,
} from "../src/types.js";
import { threadSource } from "../src/web/thread-source.js";

describe("a finding's id", () => {
  it("is what the origin's pattern admits, for every kind", () => {
    for (const kind of SITUATE_FINDING_KINDS) {
      const id = findingId(kind, "spya-k3m9qt", "https://example.org/a-paper");
      expect(id, kind).toMatch(SITUATE_FINDING_ID);
    }
  });

  it("is not a block-shaped id, and the pattern admits nothing looser", () => {
    expect("spya-k3m9qt").not.toMatch(SITUATE_FINDING_ID);
    expect("si-0123456789AB").not.toMatch(SITUATE_FINDING_ID);
    expect("si-0123456789abc").not.toMatch(SITUATE_FINDING_ID);
    expect(" si-0123456789ab").not.toMatch(SITUATE_FINDING_ID);
  });
});

describe("a finding's origin", () => {
  const FINDING: ThreadOrigin = { mode: "situate", itemId: "si-0123456789ab", quote: "Ignition is a step-function" };

  it("is found by its id, not its words, so a reworded search keeps the chat (qi-mmtsxdhg)", () => {
    expect(sameOrigin(FINDING, { ...FINDING, quote: "reworded" })).toBe(true);
    expect(sameOrigin(FINDING, { ...FINDING, itemId: "si-ba9876543210" })).toBe(false);
    /* The lens a finding's chat stored before plan 261025h is another origin. */
    expect(sameOrigin(FINDING, { mode: "reception", lens: "Ignition is a step-function" })).toBe(false);
  });

  it("names its chat after the passage", () => {
    expect(titleFromOrigin(FINDING)).toBe("Finding: Ignition is a step-function");
  });
});

/* The overview's chat (plan 261026g § Stage 2): a `situate` origin whose
   item is the dossier's overview, a second shape the route takes. */
describe("an overview's origin", () => {
  const OVERVIEW: ThreadOrigin = {
    mode: "situate",
    itemId: situateOverviewId("2026-10-25T12:22:30.533Z"),
    quote: "The report was followed by a peer-reviewed update",
  };

  it("is minted from the dossier's time, in its own shape, never a finding's", () => {
    expect(situateOverviewId("2026-10-25T12:22:30.533Z")).toBe("so-20261025122230533");
    expect(situateOverviewId("2026-10-25T12:22:30Z")).toMatch(SITUATE_OVERVIEW_ID);
    expect(situateOverviewId("2026-10-25T12:22:30.533Z")).not.toMatch(SITUATE_FINDING_ID);
    expect("so-2026").not.toMatch(SITUATE_OVERVIEW_ID);
    expect("so-20261025122230533x").not.toMatch(SITUATE_OVERVIEW_ID);
  });

  it("is another search's overview's chat only when the time matches", () => {
    expect(sameOrigin(OVERVIEW, { ...OVERVIEW, quote: "reworded" })).toBe(true);
    expect(sameOrigin(OVERVIEW, { ...OVERVIEW, itemId: situateOverviewId("2026-10-26T09:00:00.000Z") })).toBe(false);
  });

  it("names its chat after Where it sits, not a finding", () => {
    expect(titleFromOrigin(OVERVIEW)).toMatch(/^Where it sits: The report was followed/);
  });

  it("labels the chat list as the overview in Where it sits, in the model's voice", () => {
    expect(threadSource({ kind: "chat", origin: OVERVIEW })).toEqual({
      from: "sources",
      mode: "sources",
      place: "Where it sits",
      label: "Started from the overview in Sources › Where it sits",
      quote: OVERVIEW.quote,
      voice: "ai",
    });
  });
});
