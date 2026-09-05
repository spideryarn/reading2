// @vitest-environment jsdom
/**
 * **The instrument has to be provably off, provably on, and provably in the
 * middle state.**
 *
 * src/web/annotation-cost.ts exists to answer one question — how much of a
 * gesture in the reading view the annotation pipeline is responsible for
 * (docs/plans/260905i-measure-annotation-computation-before-optimising-it.md).
 * Its failure modes are all silent, and they are mirror images:
 *
 * - a probe that never switched on reports zeroes, and zeroes read as "this is
 *   cheap, defer" — which is the answer this job would most like to hear and
 *   the one it must not be handed by accident;
 * - a probe that cannot be switched off is permanent instrumentation in code
 *   that runs thousands of times per render, and is then part of what it is
 *   measuring (perf.ts makes the same argument for the globals it patches);
 * - and `"counts"` mode — the one the decision is actually made in — is
 *   *defined* by four zeroed leaf timers, which is indistinguishable from a
 *   broken probe unless the leaf **counts** are checked at the same time.
 *
 * So every assertion here is paired. A zero is only believed next to a nonzero
 * control taken from the *same* calls. One-sided, either counter — always zero,
 * or always counting — passes half of this file and fails the other.
 * docs/reusable/silent-success.md.
 *
 * jsdom because `host()` in annotate.ts builds a real `<div>`, and because the
 * memo test below mounts the real `TableView`.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

/* The other probe, mocked rather than started — starting it patches timers,
   rAF and fetch globally. Copied from tests/prose-not-rebuilt.test.tsx. */
vi.mock("../src/web/perf.js", () => ({
  useRenderCount: () => {},
  mark: (_l: string, fn: () => unknown) => fn(),
}));

/* Floating UI does real geometry and is not what is under test. */
vi.mock("../src/web/Tooltip.js", () => ({
  Tooltip: ({ children }: { children: unknown }) => children,
  TooltipGroup: ({ children }: { children: unknown }) => children,
}));

import { annotateHtml, renderedText, resolveMark, type Mark } from "../src/web/annotate.js";
import {
  annotationCost,
  type AnnotationCost,
  type CostSite,
  resetAnnotationCost,
  startAnnotationCost,
  stopAnnotationCost,
} from "../src/web/annotation-cost.js";
import { addZoomHandles } from "../src/web/zoomable.js";
import { TableView } from "../src/web/TableView.js";
import { buildGeometry } from "../src/web/tree.js";
import { fitView } from "../src/web/layout.js";
import { readArticleFromDir } from "./helpers/article-from-dir.js";
import type { Article, Comment } from "../src/types.js";

/** Every site the snapshot carries, so a new one cannot be left unasserted. */
const SITES: CostSite[] = [
  "renderedText",
  "resolveMark",
  "annotateHtml",
  "addZoomHandles",
  "marksByBlock",
  "proseHtml",
];

/** The four whose timers are switched off in `"counts"` mode. */
const LEAVES = ["renderedText", "resolveMark", "annotateHtml", "addZoomHandles"] as const;

/** How many times `callTheLeaves` reaches each leaf. */
const ROUNDS = 5;

/** The four leaf sites, exercised in exactly the same way in every mode. */
function callTheLeaves(): void {
  const html =
    "<p>Tea and toast, and a <em>figure</em> below.</p><figure><img width='400'></figure>";
  for (let i = 0; i < ROUNDS; i++) {
    const text = renderedText(html);
    const found = resolveMark(text, { quote: "toast", start: 8 });
    expect(found, "the fixture quote must resolve, or this exercises nothing").not.toBeNull();
    const marks: Mark[] = [{ id: `c${i}`, start: found?.start ?? 0, end: found?.end ?? 0 }];
    const marked = annotateHtml(html, marks);
    expect(marked, "annotateHtml must actually have done work").toContain("<mark");
    const withHandles = addZoomHandles(marked);
    expect(withHandles, "addZoomHandles must actually have done work").toContain("zoom-btn");
  }
}

/** Every site's numbers, flattened for a whole-snapshot assertion. */
function totals(cost: AnnotationCost): { calls: number; ms: number } {
  /* Summed only to say "nothing at all moved" / "something moved". The header
     of annotation-cost.ts is emphatic that these six overlap and that a sum is
     not a duration — it is not used as one anywhere here. */
  let calls = 0;
  let ms = 0;
  for (const site of SITES) {
    calls += cost[site].n;
    ms += cost[site].ms;
  }
  return { calls, ms };
}

/** The two invariants every tally must satisfy in every mode. */
function tallyIsSane(cost: AnnotationCost, site: CostSite): void {
  const tally = cost[site];
  expect(Number.isFinite(tally.ms), `${site} accumulated a non-finite ms`).toBe(true);
  expect(tally.ms, `${site} accumulated negative time`).toBeGreaterThanOrEqual(0);
  expect(Number.isFinite(tally.maxMs), `${site} has a non-finite maxMs`).toBe(true);
  expect(tally.maxMs, `${site} has a negative maxMs`).toBeGreaterThanOrEqual(0);
  /* The worst single sample is one of the samples that make up the total, so it
     can never exceed it — and with any call at all it must be at least the
     average. Both directions, because a `maxMs` stuck at zero and a `maxMs`
     that is really a running total both pass one of them. */
  expect(tally.maxMs, `${site}: maxMs exceeds the accumulated ms`).toBeLessThanOrEqual(tally.ms);
  if (tally.ms > 0) {
    expect(tally.maxMs, `${site}: maxMs is below the mean, so it is not a maximum`)
      .toBeGreaterThanOrEqual(tally.ms / tally.n);
  }
}

beforeEach(() => {
  stopAnnotationCost();
  resetAnnotationCost();
});

afterEach(() => {
  stopAnnotationCost();
  resetAnnotationCost();
});

it("records nothing at all while it is off", () => {
  callTheLeaves();
  const off = annotationCost();
  expect(off.mode, "the probe must start off — a reader pays for it otherwise").toBe("off");
  for (const site of SITES) {
    expect(off[site], `${site} must be untouched while the probe is off`).toEqual({
      n: 0,
      ms: 0,
      maxMs: 0,
    });
  }

  /* The control that makes those zeroes mean something. Identical calls, probe
     on: if these were also zero the block above would have proved nothing. */
  startAnnotationCost("full");
  callTheLeaves();
  const on = annotationCost();
  for (const site of LEAVES) {
    expect(on[site].n, `${site} was never counted — the probe is wired up wrong`).toBe(ROUNDS);
    tallyIsSane(on, site);
  }
});

it("counts the leaves without timing them in the mode the decision is made in", () => {
  startAnnotationCost();
  expect(annotationCost().mode, "startAnnotationCost() must default to the decision mode").toBe(
    "counts",
  );
  callTheLeaves();
  const counted = annotationCost();

  /* The point of the mode: `proseHtml` calls `addZoomHandles` once per block,
     so leaf timing would put a thousand clock reads inside the interval it is
     supposed to explain. */
  for (const site of LEAVES) {
    expect(counted[site].n, `${site} lost its count in "counts" mode`).toBe(ROUNDS);
    expect(counted[site].ms, `${site} read the clock in "counts" mode`).toBe(0);
    expect(counted[site].maxMs, `${site} read the clock in "counts" mode`).toBe(0);
  }

  /* And the control for *that* zero, which is otherwise the exact shape of a
     probe that cannot time anything at all: the same four leaves, same calls,
     diagnostic mode, and now they must move. */
  resetAnnotationCost();
  startAnnotationCost("full");
  callTheLeaves();
  const full = annotationCost();
  expect(full.mode).toBe("full");
  for (const site of LEAVES) {
    expect(full[site].n, `${site} lost its count in "full" mode`).toBe(ROUNDS);
    tallyIsSane(full, site);
  }
  /* At least one leaf must have registered measurable time, or "the timers are
     on" is an unverified claim. `annotateHtml` over five marked blocks is the
     most expensive of the four and the safest to insist on. */
  const timed = LEAVES.some((site) => full[site].ms > 0);
  expect(timed, 'no leaf accumulated any time in "full" mode — the timers never ran').toBe(true);
});

it("stops recording again, and reset returns it to zero", () => {
  startAnnotationCost("full");
  callTheLeaves();
  expect(
    totals(annotationCost()).calls,
    "nothing was counted, so nothing is being tested",
  ).toBeGreaterThan(0);

  resetAnnotationCost();
  const cleared = annotationCost();
  expect(totals(cleared)).toEqual({ calls: 0, ms: 0 });
  for (const site of SITES) expect(cleared[site].maxMs, `${site} kept its maxMs`).toBe(0);
  expect(cleared.mode, "reset must not switch the probe off — that is stop's job").toBe("full");

  stopAnnotationCost();
  callTheLeaves();
  const after = annotationCost();
  expect(after.mode).toBe("off");
  expect(totals(after), "calls after stop were still counted").toEqual({ calls: 0, ms: 0 });
});

/* ------------------------------------------------------------ the memos --
   The two numbers the plan's decision rule is actually applied to. They live
   in TableView.tsx rather than in annotate.ts, so nothing above would notice
   if their `noteCost` were dropped in a merge. */

const DIR = "tests/fixtures/data-root/data/openai-huggingface";

class NoResize {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= NoResize as unknown as typeof ResizeObserver;

let mountPoint: HTMLDivElement;
let root: Root;

beforeEach(() => {
  mountPoint = document.createElement("div");
  document.body.appendChild(mountPoint);
  root = createRoot(mountPoint);
});

afterEach(() => {
  act(() => root.unmount());
  mountPoint.remove();
});

/** As tests/prose-not-rebuilt.test.tsx § `propsFor`. */
function propsFor(
  loaded: Awaited<ReturnType<typeof readArticleFromDir>>,
  over: Record<string, unknown> = {},
) {
  if (!loaded.meta) throw new Error(`${DIR} has no meta.json — the fixture is incomplete`);
  const article: Article = {
    meta: loaded.meta,
    blocks: loaded.blocks,
    tree: loaded.tree,
    assets: undefined,
  };
  const geometry = buildGeometry(article.tree, article.blocks);
  const gistDepths = geometry.columnDepths.filter((d) => d < geometry.leafDepth);
  const fit = fitView({
    windowWidth: 1400,
    gistDepths,
    leafDepth: geometry.leafDepth,
    showText: true,
    chosen: null,
  });
  return {
    article,
    geometry,
    columns: fit.columns,
    layout: fit,
    showText: true,
    comments: [],
    openComment: null,
    chats: [],
    chatCounts: new Map<string, number>(),
    openChat: null,
    sections: [],
    layoutKey: "test",
    ...over,
  };
}

it('charges the two memos in TableView, in "counts" mode and not when off', async () => {
  const loaded = await readArticleFromDir(DIR);
  const target = loaded.blocks.find((b) => b.gistable && renderedText(b.html).length > 60);
  if (!target) throw new Error("fixture has no ordinary prose block to mark");
  /* A real resolvable anchor, so `marksByBlock` does work rather than skipping
     the one comment it is handed. Taken from `renderedText`, never from
     `block.text` — the two are different strings, and annotate.ts's header is
     entirely about what happens when an offset crosses between them. */
  const text = renderedText(target.html);
  const comments: Comment[] = [
    {
      id: "cost-1",
      blockId: target.id,
      quote: text.slice(10, 25),
      start: 10,
      createdAt: new Date().toISOString(),
      /* A bookmark: the reader marked the words and asked nothing. Enough for
         `marksByBlock`, which reads only the anchor. */
      status: "none",
    },
  ];

  await act(async () => {
    root.render(createElement(TableView, propsFor(loaded, { comments }) as never));
  });
  const off = annotationCost();
  for (const site of ["marksByBlock", "proseHtml"] as const) {
    expect(off[site], `${site} counted while the probe was off`).toEqual({ n: 0, ms: 0, maxMs: 0 });
  }
  /* The guards that make those zeroes mean something: the component really did
     render prose, and the comment really did resolve, so "nothing was counted"
     is about the probe rather than about the mount. */
  expect(
    mountPoint.querySelectorAll(".prose").length,
    "no prose rendered — a zero count would be meaningless",
  ).toBe(loaded.blocks.length);
  expect(
    mountPoint.querySelector("mark.cmt"),
    "the fixture comment never resolved, so marksByBlock did no work",
  ).not.toBeNull();

  startAnnotationCost();
  /* A prop the memos depend on, so both re-run: a fresh `comments` array is
     exactly the streaming-delta shape the plan is about. */
  await act(async () => {
    root.render(createElement(TableView, propsFor(loaded, { comments: [...comments] }) as never));
  });
  const on = annotationCost();
  expect(
    on.marksByBlock.n,
    "marksByBlock is not charged — the memo lost its noteCost",
  ).toBeGreaterThan(0);
  expect(on.proseHtml.n, "proseHtml is not charged — the memo lost its noteCost").toBeGreaterThan(
    0,
  );
  for (const site of ["marksByBlock", "proseHtml"] as const) tallyIsSane(on, site);
  /* The outer timers run in "counts" mode — that is the whole point of the
     mode — while the leaves inside them are counted and not timed. */
  expect(on.addZoomHandles.ms, 'a leaf was timed in "counts" mode').toBe(0);
  /* The overlap the header warns about, asserted rather than merely described:
     `proseHtml` runs `addZoomHandles` on every block, so its call count is at
     least the article's length and its time is inside `proseHtml`'s. */
  expect(on.addZoomHandles.n).toBeGreaterThanOrEqual(loaded.blocks.length);
});
