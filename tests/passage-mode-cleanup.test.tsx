// @vitest-environment jsdom
/**
 * **Leaving a passage mode takes both halves of its state with it.**
 *
 * Four bands push a `Found[]` up to `Reader` and hold an `openKey` there beside
 * it: Ideas, Timeline, Referee and Quotes. The two are one piece of state in two
 * fields — `found` is which passages are marked in the prose, `openKey` is which
 * of those marks is *rung*. `TableView` draws the ring from the key alone. So a
 * key that outlives the marks names a passage that is no longer on the page.
 *
 * `useIdeasMode` and `TimelineBand` (src/web/App.tsx) each clear both on
 * unmount, in an effect with no data dependencies so that it runs on the way out
 * and not on every keystroke. The comment above `TimelineBand`'s five effects
 * says why they are the same five and what follows from that:
 *
 * > **a fix to one of these belongs in both**, which is written here rather than
 * > left to be discovered.
 *
 * `CriteriaBand` (src/web/CriteriaPanel.tsx) is the third copy and it clears
 * only `onFound([])`. That is
 * docs/plans/260902o-adding-a-mode-the-recurring-edits-and-how-to-make-them-one.md § T0.2,
 * and this file is the executable form of that sentence: **the same assertion,
 * over three bands**, with Ideas and Timeline as the controls that pass.
 *
 * ## Why it is asserted on the parent's state and not on the callback
 *
 * `expect(onOpenKey).toHaveBeenCalledWith(null)` would go green for a band that
 * cleared the key and then set it again, and for one that cleared it on some
 * earlier render for an unrelated reason. What the reader has is the value
 * `Reader` is holding *after* the band has gone, so the harness below is a
 * miniature `Reader` — it owns `found` and `openKey`, hands the band stable
 * setters, and prints both into the DOM. Unmounting the band is how a mode is
 * left, and the assertion reads the printed value afterwards.
 *
 * The setters are `useCallback([])` on purpose: the cleanup effects list them as
 * dependencies, so an identity that changed per render would make them run on
 * every render instead of on the way out, and the test would pass for a reason
 * that has nothing to do with unmounting.
 *
 * ## How each band comes to have a passage open
 *
 * Ideas and Timeline open the first resolved passage themselves as soon as
 * `?idea=` / `?event=` names one — the "standing on the first passage is the
 * state a selected idea is *in*" effect. Referee has no such effect on purpose
 * (several criteria can be on at once, so "the first" would be arbitrary), so
 * here the referee **presses a result row**, which is the real gesture and the
 * one `CriterionResult`'s `onOpen` exists for. Each test asserts the key is set
 * before it asserts anything about clearing it: a precondition that quietly
 * failed to arrive would make the clearing assertion vacuous.
 *
 * Harness: tests/referee-gap.test.tsx's — the real bands over a stubbed
 * `apiFetch` inside a `NuqsAdapter`, because a component handed its props by
 * hand cannot see the wiring that should have supplied them.
 */
import { act, createElement, useCallback, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NuqsAdapter } from "nuqs/adapters/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SavedCriterion } from "../src/saved-criteria.js";
import type { Block, BlockId, Ideas, Timeline } from "../src/types.js";
import type { Found } from "../src/web/search-hits.js";

/** One reply, decided by the URL. */
let answer: (url: string, init: RequestInit) => Promise<Response>;

/**
 * `apiFetch` and `fetchOk` both — `fetchOk` calls `apiFetch` through the
 * module's own binding, so replacing only the export leaves every write reaching
 * for a real Supabase session. tests/referee-gap.test.tsx § the same mock.
 */
vi.mock("../src/web/lib/api.js", async () => {
  const real = await vi.importActual<typeof import("../src/web/lib/api.js")>(
    "../src/web/lib/api.js",
  );
  const apiFetch = (url: string, init: RequestInit = {}) => answer(url, init);
  return {
    ...real,
    apiFetch,
    fetchOk: async (url: string, init: RequestInit = {}) => {
      const r = await apiFetch(url, init);
      if (!r.ok) throw await real.failure(r);
      return r;
    },
  };
});

const { IdeasBand, TimelineBand } = await import("../src/web/App.js");
const { CriteriaBand } = await import("../src/web/CriteriaPanel.js");

/* Real ids: `ID_PATTERN` rejects `1`, `i`, `l` and `o`, and `?idea=`, `?event=`
   and `?crits=` all validate through it — a made-up id would simply not parse,
   and the band would sit there with nothing selected. */
const SLUG = "a-piece";
const ONE = "spya-k3m9qt" as BlockId;
const TWO = "spya-m4p7rs" as BlockId;
const IDEA = "spya-dea2aa";
const EVENT = "spya-evt2aa";
const CRIT = "spya-crt2aa";

const QUOTE_ONE = "Thirty-one participants in each arm";
const QUOTE_TWO = "The effect held in a post-hoc subgroup";

const BLOCKS: Block[] = [
  {
    id: ONE,
    tag: "p",
    kind: "text",
    text: "Thirty-one participants in each arm, with no unexposed comparison group.",
    words: 11,
    html: "<p>Thirty-one participants in each arm, with no unexposed comparison group.</p>",
    gistable: true,
  },
  {
    id: TWO,
    tag: "p",
    kind: "text",
    text: "The effect held in a post-hoc subgroup of eleven.",
    words: 9,
    html: "<p>The effect held in a post-hoc subgroup of eleven.</p>",
    gistable: true,
  },
];

const IDEAS: Ideas = {
  version: "ideas/1",
  generator: "test",
  slug: SLUG,
  sourceHash: "h",
  generatedAt: "2026-09-02T10:00:00.000Z",
  elapsedMs: 1,
  ideas: [
    {
      id: IDEA,
      name: "Small arms carry little",
      provenance: "assumed",
      statement: "A trial this size cannot separate the effect from noise.",
      /* Two occurrences, not one, so "the first" is a choice rather than the
         only option — the same reason the panel's stepper exists. */
      occurrences: [
        { blockId: ONE, quote: QUOTE_ONE, reasoning: "the size is the claim" },
        { blockId: TWO, quote: QUOTE_TWO, reasoning: "and again, post hoc" },
      ],
    },
  ],
};

const TIMELINE: Timeline = {
  version: "timeline/1",
  generator: "test",
  slug: SLUG,
  sourceHash: "h",
  orderConflicts: 0,
  generatedAt: "2026-09-02T10:00:00.000Z",
  elapsedMs: 1,
  events: [
    {
      id: EVENT,
      label: "The trial ran",
      dating: { kind: "untimed" },
      order: 1,
      modality: "happened",
      occurrences: [
        { blockId: ONE, quote: QUOTE_ONE, start: 0 },
        { blockId: TWO, quote: QUOTE_TWO, start: 0 },
      ],
    },
  ],
};

const CRITERION: SavedCriterion = {
  id: CRIT,
  criterion: "Is the study adequately powered for the comparisons it draws?",
  config: { kind: "diverging", poles: { against: "underpowered", favour: "well powered" }, scale: "rg" },
  createdAt: "2026-09-01T09:00:00.000Z",
  status: "done",
  results: [
    {
      kind: "diverging",
      blockId: ONE,
      quote: QUOTE_ONE,
      confidence: 80,
      reasoning: "thirty-one per arm",
      valence: -64,
    },
    {
      kind: "diverging",
      blockId: TWO,
      quote: QUOTE_TWO,
      confidence: 70,
      reasoning: "a subgroup of eleven",
      valence: -40,
    },
  ],
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/**
 * Every read the three bands make, answered from the fixtures above.
 *
 * The `404` fall-through is not a catch-all shrug: it is what the server really
 * answers for an artefact nobody has asked for, and every one of these hooks has
 * a branch for it. A URL that arrives here unexpected therefore produces the
 * band's empty state rather than an exception, which the preconditions below
 * would then catch by name.
 */
const serve = (url: string): Promise<Response> => {
  const path = url.split("?")[0] ?? url;
  if (path === `/api/ideas/${SLUG}`) {
    return Promise.resolve(json({ ideas: IDEAS, stale: false, outdated: false, profileChanged: false }));
  }
  if (path === `/api/timeline/${SLUG}`) {
    return Promise.resolve(json({ timeline: TIMELINE, stale: false, outdated: false }));
  }
  if (path === `/api/referee/criteria/${SLUG}`) {
    return Promise.resolve(json({ criteria: [CRITERION], sourceHash: "h" }));
  }
  return Promise.resolve(json({ error: "not found" }, 404));
};

/* ------------------------------------------------------------ the harness -- */

type BandName = "ideas" | "timeline" | "referee";

/**
 * `Reader`, in miniature: it owns `found` and `openKey`, and the band is
 * mounted under it exactly as `Reader` mounts it. Passing `band: null` is how
 * this file spells *the reader left the mode* — that is what changing `?mode=`
 * does to the band, and the unmount cleanup is the only thing that runs.
 */
function Harness({ band }: { band: BandName | null }) {
  const [found, setFound] = useState<Found[]>([]);
  const [openKey, setOpenKey] = useState<string | null>(null);
  /* Stable, and the stability is load-bearing — see this file's header. */
  const onFound = useCallback((next: Found[]) => setFound(next), []);
  const onOpenKey = useCallback((key: string | null) => setOpenKey(key), []);

  const shared = {
    blocks: BLOCKS,
    onJump: () => {},
    onFound,
    openKey,
    onOpenKey,
  };

  return createElement(
    NuqsAdapter,
    null,
    createElement("div", {
      key: "state",
      id: "state",
      /* Printed rather than returned, so the assertion reads what the prose
         would have been drawn from. `none` because an attribute cannot be
         null, and it is not a value any key can take. */
      "data-open": openKey ?? "none",
      "data-found": String(found.length),
    }),
    band === "ideas" ? createElement(IdeasBand, { key: "b", slug: SLUG, ...shared }) : null,
    band === "timeline" ? createElement(TimelineBand, { key: "b", slug: SLUG, ...shared }) : null,
    band === "referee"
      ? createElement(CriteriaBand, { key: "b", slug: SLUG, comments: [], ...shared })
      : null,
  );
}

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  /* Without this React warns on every `act` and the real warnings are buried.
     tests/referee-gap.test.tsx carries the same line. */
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  answer = (url) => serve(url);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

/** tests/referee-gap.test.tsx § `flush` — the hooks add microtask hops. */
async function flush(times = 6): Promise<void> {
  for (let i = 0; i < times; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

function show(band: BandName | null): void {
  act(() => root.render(createElement(Harness, { band })));
}

/** What `Reader` is holding right now. */
function state(): { openKey: string; found: number } {
  const el = host.querySelector("#state");
  return {
    openKey: el?.getAttribute("data-open") ?? "missing",
    found: Number(el?.getAttribute("data-found") ?? "-1"),
  };
}

/* --------------------------------------------------------------- the tests -- */

describe("leaving a passage mode clears the open key as well as the marks", () => {
  it("Ideas — the band the rule was written for", async () => {
    history.replaceState(null, "", `/read/${SLUG}?mode=ideas&idea=${IDEA}`);
    show("ideas");
    await flush();

    /* The precondition, asserted rather than assumed: two passages marked and
       the first of them rung. Without this the clearing assertion below would
       pass over an empty band. */
    expect(state().found).toBe(2);
    expect(state().openKey).toBe(`${IDEA}:${ONE}:0`);

    show(null);
    await flush();

    expect(state().found).toBe(0);
    expect(state().openKey).toBe("none");
  });

  it("Timeline — the second copy of the same five effects", async () => {
    history.replaceState(null, "", `/read/${SLUG}?mode=timeline&event=${EVENT}`);
    show("timeline");
    await flush();

    expect(state().found).toBe(2);
    expect(state().openKey).toBe(`${EVENT}:${ONE}:0`);

    show(null);
    await flush();

    expect(state().found).toBe(0);
    expect(state().openKey).toBe("none");
  });

  it("Referee — the third copy, which clears only half", async () => {
    /* Marks are default-off in Referee (`critsParam`), so the criterion has to
       be switched on for anything to be resolved at all. */
    history.replaceState(null, "", `/read/${SLUG}?mode=referee&crits=${CRIT}`);
    show("referee");
    await flush();

    expect(state().found).toBe(2);
    /* Referee opens nothing by itself, on purpose — several criteria can be on
       at once. The referee presses a result row, which is the gesture
       `CriterionResult`'s `onOpen` exists for. */
    expect(state().openKey).toBe("none");
    const rows = [...host.querySelectorAll<HTMLButtonElement>(".crit-jump")];
    expect(rows, "two criterion result rows to press").toHaveLength(2);
    act(() => rows[0]!.click());
    await flush();
    expect(state().openKey).toBe(`${CRIT}:${ONE}:0`);

    /* **A second press moves the ring and does not lose it**, which is what
       stops the assertion below being satisfied by a band that clears the key
       on every change instead of on the way out. Folding the unmount cleanup
       into the effect that pushes `found` up is the tempting wrong fix — it
       would go green on the unmount assertion and flicker every mark on the
       page, which is the trap `GlossaryBand` documents and both bands above
       cite. This press is the check that it did not happen. */
    act(() => rows[1]!.click());
    await flush();
    expect(state().openKey).toBe(`${CRIT}:${TWO}:1`);

    show(null);
    await flush();

    expect(state().found).toBe(0);
    /* The half that is missing: `CriteriaBand`'s unmount effect clears
       `onFound` and leaves the key, so the prose keeps a ring around a passage
       that is no longer marked, and the next mode inherits it. */
    expect(state().openKey).toBe("none");
  });
});
