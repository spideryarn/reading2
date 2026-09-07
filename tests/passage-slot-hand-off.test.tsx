// @vitest-environment jsdom
/**
 * **Two producers, one publication slot: the incoming one's marks must survive.**
 *
 * `Reader` keeps five `Found[]` slots, one per producer, precisely so that a
 * mode on its way out cannot erase the marks of the mode arriving. Referee's two
 * sub-modes are the one place that guarantee does not reach: `CriteriaBand` and
 * `ClaimsBand` are siblings inside `RefereeSubMode` and both write the *same*
 * slot, so changing `?referee=` hands one slot from one producer to another
 * inside a single commit.
 *
 * Before 2026-09-06 both of them published in a `useLayoutEffect` and cleared in
 * a passive `useEffect`. React destroys a deleted subtree's **passive** effects
 * in the passive phase of the commit that deleted it — *after* the layout phase
 * in which the incoming sibling published. So the order was:
 *
 * > incoming layout publish → outgoing passive clear → settled slot empty
 *
 * and whatever the incoming producer had to say was overwritten by the outgoing
 * one's goodbye. The fix is that the clear is a **layout** cleanup, which React
 * runs in the mutation phase, before the incoming sibling's layout effect —
 * src/web/passage-lifecycle.ts.
 *
 * ## Why this file uses two stand-in producers rather than the real bands
 *
 * Because the real bands cannot show it, and that was **measured, not assumed**.
 * `CriteriaBand`'s marks come from `useCriteria`'s fetch and `ClaimsBand`'s from
 * a tick the referee has not made yet, so both publish an *empty* list in their
 * first layout effect. The outgoing clear then overwrites empty with empty and
 * the settled state is right by luck. The hazard is therefore latent in the
 * shipped bands rather than live: it becomes a lost-marks bug the moment any
 * producer sharing a slot has something to say on its first commit — a cached
 * artefact, a default-on selection, marks derived from the URL, all of which
 * exist elsewhere in this app (`SearchBand` publishes `findLiteral` marks
 * synchronously from `?find=`).
 *
 * So the two components below are not a paraphrase of the bands: they are the
 * *lifecycle* the bands are built on, driven by props so that a producer has
 * something to publish at mount. `tests/passage-mode-cleanup.test.tsx` covers
 * the real bands; this file covers the ordering rule they share.
 *
 * ## Not under StrictMode, and that is the point
 *
 * StrictMode **masks** this. Its simulated remount republishes the incoming
 * producer *after* the outgoing clear, so the settled DOM comes out right and
 * the test goes green against the broken code — measured by GPT Sol in a React
 * 19.2.8 probe, docs/plans/260906c-plan-review-sol-2.md § F9. The red proof is
 * therefore non-StrictMode. The StrictMode case at the bottom is a *regression*
 * variant that only ever runs against the fixed code; do not "improve" this file
 * by wrapping the rest of it in `<StrictMode>`.
 */
import {
  act,
  createElement,
  StrictMode,
  useCallback,
  useLayoutEffect,
  useState,
} from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { BlockId } from "../src/types.js";
import type { Found } from "../src/web/search-hits.js";
import { usePassageLifecycle } from "../src/web/passage-lifecycle.js";

const ONE = "spya-k3m9qt" as BlockId;
const TWO = "spya-m4p7rs" as BlockId;

/** A resolved passage, in the shape `search-hits.ts` mints them. */
function passage(key: string, blockId: BlockId): Found {
  return {
    key,
    blockId,
    runId: "r",
    slot: 0,
    index: 0,
    start: 0,
    end: 4,
    confidence: null,
    valence: null,
    reasoning: null,
    short: "some",
    long: "some words",
    at: 0,
    whole: false,
  };
}

/* Two sets, so "whose marks are on the page" is a question with an answer. */
const KEYED_MARKS = [passage("keyed:1", ONE), passage("keyed:2", TWO)];
const UNKEYED_MARKS = [passage("unkeyed:1", ONE)];

/**
 * **`CriteriaBand`'s lifecycle**, with the fetch taken out: a `keyed` producer
 * that publishes marks it was handed and holds its open key in the parent.
 */
function KeyedProducer({
  found,
  openKey,
  onFound,
  onOpenKey,
}: {
  found: Found[];
  openKey: string | null;
  onFound(next: Found[]): void;
  onOpenKey(key: string | null): void;
}) {
  usePassageLifecycle({ kind: "keyed", found, openKey, onFound, onOpenKey });
  /* The referee's press, which is the only thing that opens a criteria passage —
     `CriterionResult`'s `onOpen`, and the reason `.crit-jump` is a button. */
  return createElement(
    "button",
    { type: "button", className: "keyed-open", onClick: () => onOpenKey(found[0]?.key ?? null) },
    "open the first",
  );
}

/**
 * **`ClaimsBand`'s lifecycle**: an `unkeyed` producer, which publishes marks and
 * owns no key at all, so its unmount clears `found` and nothing else.
 */
function UnkeyedProducer({ found, onFound }: { found: Found[]; onFound(next: Found[]): void }) {
  usePassageLifecycle({ kind: "unkeyed", found, onFound });
  return createElement("div", { className: "unkeyed" });
}

type Sub = "keyed" | "unkeyed" | null;

/**
 * `Reader`'s referee slot, in miniature, mounted the way `RefereeSubMode` mounts
 * its two bands: **one position**, a different component type in it, so changing
 * the sub-mode is one commit that deletes one producer and mounts the other.
 *
 * The setters are `useCallback([])`-stable, for the reason
 * tests/passage-mode-cleanup.test.tsx gives at length: the unmount cleanup lists
 * them as its dependencies, so an identity that changed per render would turn a
 * cleanup that runs on the way out into one that runs on every render, and this
 * file would pass for a reason that has nothing to do with the hand-off.
 */
/**
 * **Every committed value of the slot, in order, as the page would have drawn
 * it.** A layout effect, so what it records is what a paint of that commit would
 * have shown; the assertion that reads it is about the commits *between* the two
 * producers, which a settled-state assertion cannot see.
 */
const commits: string[] = [];

function Recorder({ found }: { found: string }) {
  useLayoutEffect(() => {
    commits.push(found);
  }, [found]);
  return null;
}

function Slot({ sub }: { sub: Sub }) {
  const [found, setFound] = useState<Found[]>([]);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const onFound = useCallback((next: Found[]) => setFound(next), []);
  const onOpenKey = useCallback((key: string | null) => setOpenKey(key), []);

  return createElement(
    "div",
    null,
    createElement("div", {
      key: "state",
      id: "state",
      "data-found": found.map((f) => f.key).join(",") || "none",
      "data-open": openKey ?? "none",
    }),
    createElement(Recorder, {
      key: "recorder",
      found: found.map((f) => f.key).join(",") || "none",
    }),
    sub === "keyed"
      ? createElement(KeyedProducer, {
          key: "sub",
          found: KEYED_MARKS,
          openKey,
          onFound,
          onOpenKey,
        })
      : sub === "unkeyed"
        ? createElement(UnkeyedProducer, { key: "sub", found: UNKEYED_MARKS, onFound })
        : null,
  );
}

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  commits.length = 0;
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

/** What the slot is holding right now — the parent's state, not a callback. */
function state(): { found: string; openKey: string } {
  const el = host.querySelector("#state");
  return {
    found: el?.getAttribute("data-found") ?? "missing",
    openKey: el?.getAttribute("data-open") ?? "missing",
  };
}

describe("handing one publication slot from one producer to the other", () => {
  function show(sub: Sub, strict = false): void {
    const tree = createElement(Slot, { sub });
    act(() => root.render(strict ? createElement(StrictMode, null, tree) : tree));
  }

  it("keeps the incoming marks when a keyed producer replaces an unkeyed one", () => {
    show("unkeyed");
    expect(state().found, "the outgoing producer must have marked something to lose").toBe(
      "unkeyed:1",
    );

    show("keyed");

    /* The **settled** commit, not merely the first: the outgoing clear lands in
       the passive phase, so a test that looked only at the layout phase would
       pass against the broken code. */
    expect(state().found, "the incoming producer's marks were erased by the outgoing clear").toBe(
      "keyed:1,keyed:2",
    );
  });

  it("keeps the incoming marks when an unkeyed producer replaces a keyed one", () => {
    show("keyed");
    expect(state().found).toBe("keyed:1,keyed:2");

    show("unkeyed");

    expect(state().found, "the incoming producer's marks were erased by the outgoing clear").toBe(
      "unkeyed:1",
    );
  });

  it("takes the outgoing producer's key with it, and only its own", () => {
    show("keyed");
    /* A keyed producer's key is the parent's, and nothing opens it by itself —
       Criteria refuses to open the first passage on purpose — so the press is
       what sets it, and the hand-off is what has to take it away. */
    expect(state().found).toBe("keyed:1,keyed:2");
    act(() => host.querySelector<HTMLButtonElement>(".keyed-open")!.click());
    expect(state().openKey, "the press must open a passage for the hand-off to clear").toBe(
      "keyed:1",
    );

    show("unkeyed");
    expect(state().openKey, "an unkeyed producer holds no key, so none may survive").toBe("none");
  });

  it("never draws an empty slot in between the two producers", () => {
    /* **The commit before the outgoing cleanup**, which is where the defect
       lived and which a settled-state assertion cannot reach. With a passive
       clear the slot went `keyed` → `unkeyed` → *empty*: the incoming producer
       published in the layout phase and the outgoing one wiped it in the passive
       phase of the same commit. With a layout cleanup the outgoing clear happens
       in the mutation phase, so the slot's committed values step straight from
       one producer's marks to the other's and the prose never blinks. */
    show("keyed");
    commits.length = 0;
    show("unkeyed");

    expect(commits, "the hand-off must commit at least the incoming marks").not.toHaveLength(0);
    expect(
      commits,
      `the slot was emptied after the incoming producer published: ${commits.join(" → ")}`,
    ).not.toContain("none");
    expect(commits.at(-1)).toBe("unkeyed:1");
  });

  it("clears the slot on the way out of the mode entirely", () => {
    show("keyed");
    expect(state().found).toBe("keyed:1,keyed:2");
    show(null);
    expect(state()).toEqual({ found: "none", openKey: "none" });
  });

  /**
   * **A regression variant, and never the red proof** — see the header. Under
   * StrictMode React simulates a remount, which republishes the incoming
   * producer after the outgoing clear and hides the very defect this file
   * exists for. It is here to show the fix survives the double-invoke, not to
   * demonstrate the bug.
   */
  it("survives StrictMode's simulated remount as well", () => {
    show("unkeyed", true);
    expect(state().found).toBe("unkeyed:1");
    show("keyed", true);
    expect(state().found).toBe("keyed:1,keyed:2");
    show("unkeyed", true);
    expect(state().found).toBe("unkeyed:1");
  });
});
