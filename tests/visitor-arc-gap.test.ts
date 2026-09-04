/**
 * **A visitor gets no arc on an article whose owner has not opened it, and that
 * is a decision rather than a bug.**
 *
 * Until 2026-08-29 every ingest wrote an arc before the article could be opened,
 * so `arc.json` was effectively always there. Two changes that day ended that:
 * `arc` came out of `DEFAULT_INGEST_STEPS`, and the arc gained a `sourceHash`
 * that no artefact already on disk carries — so on the day it shipped, the whole
 * existing library was in this state too, not just newly-added articles.
 *
 * Nothing asks for one on a visitor's behalf, and nothing can: writing an arc is
 * a job, starting a job is a POST, and the acceptance test for public reading is
 * that a signed-out browser issues **no POST whatever**. `useArc` is therefore
 * mounted in `OwnedReader`, below the capability seam.
 *
 * **This file exists because the failure is invisible.** `buildArcColumn`
 * returns `null` without an arc and `TableView` falls back to the root gist, so
 * the page looks complete. Nobody would report it. Greg was offered a second,
 * non-blocking arc job after ingest — which would have closed the hole for
 * visitors and for the back catalogue — and chose the smaller change, having
 * been shown that deferring the arc saves about 4% of ingest wall time
 * (`hierarchy` 228s, `arc` 10s, measured). GPT Sol's condition for that option was
 * that the regression be accepted *and tested*, which is what this is.
 *
 * If a later change gives visitors an arc, these tests should fail and be
 * deleted deliberately. That is the point of them.
 *
 * docs/plans/260829f-defer-arc-and-rename-hierarchy.md § 2.2.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEFAULT_INGEST_STEPS, FORCE_ONLY_WHEN_NAMED, STEP_ORDER } from "../src/pipeline.js";
import { buildArc, partsOf } from "../src/arc.js";
import { buildArcColumn } from "../src/web/tree.js";
import { buildGeometry } from "../src/web/tree.js";
import { visitorGap } from "../src/web/visitor.js";
import type { PublicArtefacts } from "../src/public-types.js";

const NOTHING_BUILT: PublicArtefacts = {
  arc: false,
  tweets: false,
  glossary: false,
  ideas: false,
  quotes: false,
  timeline: false,
  sketch: false,
};

describe("adding an article no longer writes an arc", () => {
  it("leaves arc out of the default steps, so the article opens a model call sooner", () => {
    expect(DEFAULT_INGEST_STEPS).not.toContain("arc");
    // And the steps that make it *readable* are all still there — this is a
    // latency change, not a change to what an article is.
    expect(DEFAULT_INGEST_STEPS).toContain("hierarchy");
    expect(DEFAULT_INGEST_STEPS).toContain("blocks");
  });

  it("keeps arc runnable on request", () => {
    // Out of the defaults is not out of the pipeline: `{ steps: ["arc"] }` is
    // what `useArc` posts.
    expect(STEP_ORDER).toContain("arc");
  });

  it("takes arc out of the force-cascade, now that it can judge its own freshness", () => {
    /* The two halves must move together. Out of the defaults and *in* the
       cascade would mean a forced earlier step silently rewriting an arc whose
       inputs had not moved; in the defaults and out of the cascade would mean a
       re-ingest leaving a stale one. src/pipeline.ts § FORCE_ONLY_WHEN_NAMED. */
    expect(FORCE_ONLY_WHEN_NAMED.has("arc")).toBe(true);
  });
});

describe("what a visitor gets, and does not", () => {
  it("still opens the hierarchy for free, with no arc built", () => {
    // The tree, the zoom and the spine come from the payload the visitor already
    // holds. Losing the arc must not cost them the mode itself.
    expect(visitorGap("hierarchy", NOTHING_BUILT)).toBeNull();
  });

  it("draws no arc column rather than a partial one", () => {
    /* Against the real fixture, with a control — an empty geometry returns
       `null` whatever the arc is, so asserting on one would have proved nothing
       about the arc at all. The control is the half that makes this evidence:
       the same geometry with a real arc must NOT be null. */
    const blocks = JSON.parse(readFileSync("example/blocks.json", "utf8")).blocks;
    const tree = JSON.parse(readFileSync("example/tree.json", "utf8"));
    const geometry = buildGeometry(tree, blocks);

    const parts = partsOf(tree);
    const real = buildArc(parts.map((_, i) => `Sentence ${i + 1}.`), tree, "example", "hash");
    expect(buildArcColumn(geometry, real)).not.toBeNull();

    // The visitor's case on an article with no arc.json.
    expect(buildArcColumn(geometry, undefined)).toBeNull();
  });

  it("ACCEPTED REGRESSION: nothing in the visitor path can cause an arc to be written", () => {
    /* The assertion that matters, expressed as the thing a reviewer should
       check: `useArc` — the only caller that posts an arc job — must be imported
       by the owner-only component and by nothing on the visitor path. Asserted
       against the source rather than by rendering, because the failure mode is a
       hook moving up one component, which no render of the visitor page would
       reveal unless it happened to assert on POSTs. */
    const app = readFileSync("src/web/App.tsx", "utf-8");
    const ownedAt = app.indexOf("function OwnedReader(");
    const visitorAt = app.indexOf("function VisitorArticle(");
    /* Both must exist and be in this order, or the slices below would silently
       become the wrong text and the test would pass while checking nothing —
       exactly the way a source-scanning assertion goes quiet. */
    expect(ownedAt).toBeGreaterThan(-1);
    expect(visitorAt).toBeGreaterThan(ownedAt);

    const ownedBody = app.slice(ownedAt, visitorAt);
    const visitorArticle = app.slice(visitorAt);

    expect(ownedBody).toContain("useArc(");
    // The visitor component, and everything after it, must never call it.
    expect(visitorArticle).not.toContain("useArc(");
  });
});
