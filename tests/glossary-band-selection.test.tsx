// @vitest-environment jsdom
/**
 * **That a term the threshold hides stops being the open one, in the same frame
 * the row leaves.**
 *
 * `tests/glossary-band-wiring.test.ts` asserts this by reading source text, and
 * says so honestly. What a grep cannot see is *when*: the band nulls `selected`
 * during render, but the prose draws its emphasis from `Reader`'s own state,
 * which the band reaches through a callback. Put that callback in a passive
 * effect and the panel commits without the row while the article still
 * emphasises the term — one paintable frame in which the page says two
 * different things about what is open. GPT Sol's second finding on the built
 * code, 2026-09-03.
 *
 * So this file mounts the real band through the real `NuqsAdapter`, drags the
 * real slider, and asserts *when* the callback arrives rather than whether it
 * does. A `Probe` sits beside the band and subscribes to the same `?gate=`, so
 * one drag re-renders both in one commit, and its two effects bracket the
 * band's:
 *
 *   layout phase   the band's effects, then `probe:layout`
 *   ---- the browser may paint here ----
 *   passive phase  the band's effects, then `probe:passive`
 *
 * A `useLayoutEffect` in the band therefore lands *before* `probe:layout`; a
 * `useEffect` lands after it. That single assertion is the regression, and it
 * was watched fail against `useEffect` before the fix went in.
 *
 * A sibling that subscribes rather than a wrapper: a wrapper never re-renders
 * when the band's own hooks change, so its effects never fire and it measures
 * nothing. Reading the same parameter is what puts the two in one commit.
 *
 * `VisitorGlossaryBand` and not `GlossaryBand`, because the visitor's band is
 * the same hook (`useGlossaryMode`) with no fetch attached — the owner's band
 * would drag in `useGlossary` and the job list for nothing this file is about.
 *
 * docs/plans/260903c-threshold-sliders-hide-below-threshold-items.md § Stage 2.
 */
import { act, createElement, useEffect, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { enableHistorySync, NuqsAdapter } from "nuqs/adapters/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PublicGlossary, PublicGlossaryEntry } from "../src/public-types.js";
import type { BlockId } from "../src/types.js";
import { gateParam } from "../src/web/params.js";

const { useQueryState } = await import("nuqs");

const { VisitorGlossaryBand } = await import("../src/web/App.js");

function entry(name: string, difficulty: number, centrality: number): PublicGlossaryEntry {
  return {
    id: `spya-${name.padEnd(6, "x")}`,
    name,
    kind: "concept",
    aliases: [],
    senseHere: `What ${name} means here.`,
    difficulty,
    centrality,
    blocks: ["spya-aaaaaa" as BlockId],
  };
}

/* Two terms an order apart, so the list can be prioritised at all and the
   slider has somewhere to travel — `canPrioritise` in GlossaryPanel.tsx.

   The names are also the ids, and `?term=` is validated against `ID_PATTERN`
   (src/ids.ts), whose alphabet has no `i`, `l` or `o` in it — a term called
   "low" would be silently unselectable here and the test would look like a
   failure of the thing it is about. */
const HARD = entry("hard", 0.8, 0.8); // 0.64
const RARE = entry("rare", 0.2, 0.2); // 0.04
const GLOSSARY: PublicGlossary = { entries: [HARD, RARE] };

/** Each phase of the commit and each thing the band said, in order. */
let marks: string[] = [];

/** What the band last said was open, as an id or `null`. */
let selection: string | null = null;

/**
 * A sibling that re-renders whenever the band does, and marks each phase.
 *
 * No dependency array on either effect: this is about the commit, not about a
 * value. `useQueryState` on the same parameter the slider writes is what makes
 * the commit shared — see the note at the top of this file.
 */
function Probe() {
  useQueryState("gate", gateParam);
  useLayoutEffect(() => {
    marks.push("probe:layout");
  });
  useEffect(() => {
    marks.push("probe:passive");
  });
  return null;
}

let host: HTMLDivElement;
let root: Root;

enableHistorySync();

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  marks = [];
  selection = null;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

async function settle(turns = 4): Promise<void> {
  for (let i = 0; i < turns; i++) {
    await act(async () => {
      await new Promise((go) => setTimeout(go, 0));
    });
  }
}

/** What the query string says now. */
function param(key: string): string | null {
  return new URLSearchParams(location.search).get(key);
}

async function mount(search: string): Promise<void> {
  history.replaceState(null, "", `/a-piece${search}`);
  await act(async () => {
    root.render(
      createElement(
        NuqsAdapter,
        null,
        createElement(
          "div",
          null,
          createElement(VisitorGlossaryBand, {
            key: "band",
            glossary: GLOSSARY,
            onJump: () => {},
            onSelected: (sel: { id: string } | null) => {
              marks.push(`band:${sel ? sel.id : "null"}`);
              selection = sel ? sel.id : null;
            },
          }),
          createElement(Probe, { key: "probe" }),
        ),
      ),
    );
  });
  await settle();
}

/**
 * Drag the threshold, through the control the reader actually uses, and hand
 * back control **once the address reflects the drag** — not the instant the
 * event does, which is what this said until 2026-09-06 and is the whole of the
 * bug below.
 *
 * The native value setter, then an `input` event: React tracks the DOM node's
 * last value and would swallow a plain assignment as "nothing changed". This is
 * what `fireEvent.change` does, written out because this repo has no
 * testing-library.
 */
async function dragGateTo(value: number): Promise<void> {
  const slider = document.getElementById("gloss-gate") as HTMLInputElement | null;
  expect(slider, "the threshold slider must be on screen to be dragged").not.toBeNull();
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => {
    setter.call(slider, String(value));
    slider!.dispatchEvent(new Event("input", { bubbles: true }));
  });

  /* **Wait for the address, or leave a timer behind.** `gateParam` is
     `debounce(200)` (src/web/params.ts), so the write waits in a per-key
     debounce queue and only then joins nuqs's shared throttle queue — two
     stages, and both of them live on `globalThis`, which is why no unmount
     cancels either. A case that returns before the write lands leaves a timer
     that fires after vitest has torn this file's jsdom down, and takes the
     whole run down with an unhandled `ReferenceError: location is not defined`
     while every test still reports green. Found by measuring what was still
     queued when this file ended, not by reading it:
     docs/postmortems/260906c-a-url-write-outlived-the-page-that-asked-for-it.md.

     Polled rather than slept through, so nothing here depends on the debounce
     staying at 200ms. */
  await vi.waitFor(() => {
    expect(param("gate")).toBe(value.toFixed(2));
  });
}

describe("a term the threshold hides stops being the open one", () => {
  it("drops the selection in the layout phase, before the browser can paint", async () => {
    await mount(`?mode=glossary&sort=prioritised&gate=0.01&term=${RARE.id}`);
    /* Precondition: at 0.01 the low-scoring term is on screen and open. */
    expect(selection).toBe(RARE.id);
    expect(document.body.textContent).toContain("What rare means here.");

    marks = [];
    await dragGateTo(0.5);

    /* The row has gone, and so has the emphasis the article draws from it. */
    expect(document.body.textContent).not.toContain("What rare means here.");
    expect(selection).toBeNull();

    /* The finding itself: the clearing arrives in the layout phase of the
       commit that took the row away, not in the passive phase after it. With a
       passive effect the row is gone and the term is still emphasised in the
       prose — one frame in which the page says two different things about what
       is open. */
    const where = JSON.stringify(marks);
    const cleared = marks.indexOf("band:null");
    const painted = marks.indexOf("probe:layout");
    expect(cleared, `expected a cleared selection in ${where}`).toBeGreaterThan(-1);
    expect(painted, `expected a probed commit in ${where}`).toBeGreaterThan(-1);
    expect(cleared, `cleared too late in ${where}`).toBeLessThan(painted);

    /* And the URL follows, a tick later. That clearing may stay passive: it is
       a parameter rather than a thing on screen. */
    await settle();
    expect(param("term")).toBeNull();
  });

  it("does not clear a selection the threshold is not hiding", async () => {
    /* The other half: the guard is about hidden terms, not about the slider
       moving. Dragging up to a gate the open term still clears leaves it open,
       so a reader adjusting the bar does not lose their place. */
    await mount(`?mode=glossary&sort=prioritised&gate=0.01&term=${HARD.id}`);
    expect(selection).toBe(HARD.id);
    await dragGateTo(0.5);
    await settle();
    expect(selection).toBe(HARD.id);
    expect(param("term")).toBe(HARD.id);
  });
});
