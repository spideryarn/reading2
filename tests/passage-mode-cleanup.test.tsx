// @vitest-environment jsdom
/**
 * **Leaving a passage mode takes both halves of its state with it.**
 *
 * Six components resolve passages and push a `Found[]` up to `Reader`, and four
 * of them hold an `openKey` there beside it: Ideas, Timeline, Search, Quotes,
 * Criteria and Claims. The two fields are one piece of state — `found` is which
 * passages are marked in the prose, `openKey` is which of those marks is *rung*.
 * `TableView` draws the ring from the key alone. So a key that outlives the
 * marks names a passage that is no longer on the page.
 *
 * **Since 2026-09-06 all six share one hook**, `usePassageLifecycle`
 * (src/web/passage-lifecycle.ts), which holds the three rules they had six
 * copies of: publish before paint, drop an open key the list no longer has, and
 * clear on the way out in a cleanup that depends on nothing but the parent's
 * setters. The sentence this file was written to make executable —
 * *"a fix to one of these belongs in all three"*, which said *"in both"* until
 * Referee became the third and was six by the end — is now a sentence about one
 * function, and this file is what stops that function being wrong for one of its
 * three shapes. Every copy of every rule had been got wrong once:
 * `CriteriaBand` cleared `onFound([])` and left the key set until 2026-09-02
 * (docs/plans/260902o-adding-a-mode-the-recurring-edits-and-how-to-make-them-one.md
 * § T0.2), and `useIdeasMode` had no drop-an-invalid-key rule at all until
 * 2026-08-27.
 *
 * So the arms below are one per **shape** as well as one per band: `keyed`
 * (Ideas, Timeline, Search, Criteria), `derived` (Quotes) and `unkeyed`
 * (Claims). Ideas and Timeline are the controls that always passed.
 *
 * **Quotes only became a band with a key on 2026-09-05.** Before that it marked
 * the selected quote and nothing else, so it had no key to lose. It is also the
 * one band here whose marks are *not* a function of the selection, so its test
 * asserts the opposite precondition: two passages marked with nothing selected
 * at all.
 * docs/plans/260905g-mark-every-visible-quote-and-make-the-quiz-start-easier.md.
 *
 * **Claims is the one band with no key at all**, which is why it is the `unkeyed`
 * shape: nothing rings a claim's passage, so leaving the sub-mode has to take
 * `found` and must not touch a key it does not own. Its marks are default-off,
 * so the arm ticks a claim first.
 *
 * **Search is here for its prop names as much as its cleanup.** It calls the
 * same hook through `openHit`/`onOpenHit` rather than `openKey`/`onOpenKey`, and
 * those names are what six other test files mount its band by, so an arm that
 * used the other names would prove nothing about the band `Reader` renders.
 *
 * **The hand-off between Criteria and Claims is not here**, because they are the
 * only two producers that share one slot and what that needs asserting about is
 * an ordering rather than a value left behind:
 * tests/passage-slot-hand-off.test.tsx.
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

import type { Claim, ClaimsRun } from "../src/referee-claims.js";
import type { SavedCriterion } from "../src/saved-criteria.js";
import type { Block, BlockId, Ideas, Quotes, Timeline } from "../src/types.js";
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

const { TimelineBand } = await import("../src/web/modes/timeline/TimelineMode.js");
const { IdeasBand } = await import("../src/web/modes/ideas/IdeasMode.js");
const { CriteriaBand } = await import("../src/web/CriteriaPanel.js");
const { ClaimsBand } = await import("../src/web/ClaimsPanel.js");
const { SearchBand } = await import("../src/web/modes/search/SearchMode.js");

/* Real ids: `ID_PATTERN` rejects `1`, `i`, `l` and `o`, and `?idea=`, `?event=`
   and `?crits=` all validate through it — a made-up id would simply not parse,
   and the band would sit there with nothing selected. */
const SLUG = "a-piece";
const ONE = "spya-k3m9qt" as BlockId;
const TWO = "spya-m4p7rs" as BlockId;
const IDEA = "spya-dea2aa";
const EVENT = "spya-evt2aa";
const CRIT = "spya-crt2aa";
const QUOTE_A = "spya-qte2aa";
const QUOTE_B = "spya-qte2bb";

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

/**
 * Two quotes, one per block, and **neither of them selected** — which is the
 * whole point of this fixture. Until 2026-09-05 quotes mode marked only the
 * selected quote, so a band with nothing selected drew nothing at all; the
 * precondition below is that `found` is 2 before anybody has pressed a row.
 *
 * Both scored the same, so `canPrioritise` is false and the rank falls back to
 * document order however the URL arrives. The bar has its own tests in
 * tests/quotes-panel.test.ts; this file is about the two halves of the state.
 */
const QUOTES: Quotes = {
  version: "quotes/3",
  generator: "test",
  slug: SLUG,
  sourceHash: "h",
  generatedAt: "2026-09-05T10:00:00.000Z",
  elapsedMs: 1,
  quotes: [
    { id: QUOTE_A, blockId: ONE, text: QUOTE_ONE, importance: 0.9 },
    { id: QUOTE_B, blockId: TWO, text: QUOTE_TWO, importance: 0.9 },
  ],
  discarded: {
    unfound: 0,
    otherVoice: 0,
    wrongLength: 0,
    overlapping: 0,
    overCap: 0,
    malformed: 0,
  },
};

/**
 * **One claim, taken up one paragraph later.** Claims marks the *passages* a
 * claim is supported by, not the sentence that makes it, so the mark lands on
 * `TWO` and the claim is anchored in `ONE`.
 *
 * Marks are off until the referee asks for them — `showing` is local state that
 * starts empty — so the arm below ticks the box before it has anything to lose.
 */
const CLAIM: Claim = {
  id: `${ONE}:0`,
  blockId: ONE,
  quote: "Thirty-one participants",
  start: 0,
  claim: "The trial was too small to separate the effect from noise",
  passages: [
    { blockId: TWO, quote: "post-hoc subgroup", start: 22, reasoning: "and again, post hoc" },
  ],
  discarded: 0,
};

const CLAIMS_RUN: ClaimsRun = {
  status: "done",
  createdAt: "2026-09-01T09:00:00.000Z",
  claims: [CLAIM],
  sourceHash: "h",
};

/**
 * **What the literal matcher finds**, which is the one set of marks in this file
 * that needs no artefact at all: `?match=words&find=` is resolved out of the
 * blocks on every keystroke, so Search publishes passages on its first commit.
 */
const FIND = "post-hoc";

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
  if (path === `/api/quotes/${SLUG}`) {
    return Promise.resolve(
      json({ quotes: QUOTES, stale: false, outdated: false, profileChanged: false }),
    );
  }
  if (path === `/api/referee/criteria/${SLUG}`) {
    return Promise.resolve(json({ criteria: [CRITERION], sourceHash: "h" }));
  }
  if (path === `/api/referee/claims/${SLUG}`) {
    return Promise.resolve(json({ run: CLAIMS_RUN, sourceHash: "h" }));
  }
  /* Search's saved runs, and an empty list is the honest answer here: this arm
     is about the literal matcher, which needs no saved search and no model. */
  if (path === `/api/search/${SLUG}`) {
    return Promise.resolve(json({ searches: [], sourceHash: "h" }));
  }
  return Promise.resolve(json({ error: "not found" }, 404));
};

/* ------------------------------------------------------------ the harness -- */

type BandName = "ideas" | "timeline" | "referee" | "claims" | "search";

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
    /* **No `openKey` and no `onOpenKey`**, which is this band's shape rather
       than an omission: nothing rings a claim's passage, so leaving the sub-mode
       has to take `found` and must not touch a key it does not own. */
    band === "claims"
      ? createElement(ClaimsBand, {
          key: "b",
          slug: SLUG,
          blocks: BLOCKS,
          onJump: () => {},
          onFound,
        })
      : null,
    /* **`openHit` and `onOpenHit`, not `openKey` and `onOpenKey`.** Search's
       band-level names are older than the other five and six test files mount it
       by them, so they are deliberately not unified — mounting it by the other
       names here would prove nothing about the band `Reader` renders. */
    band === "search"
      ? createElement(SearchBand, {
          key: "b",
          slug: SLUG,
          blocks: BLOCKS,
          onJump: () => {},
          onFound,
          openHit: openKey,
          onOpenHit: onOpenKey,
        })
      : null,
    /* **Quotes is not here, and its absence is the subject of a comment rather
       than an oversight.** It was the fifth band until 2026-09-08, when the
       marks stopped being published by the band at all: `Reader` computes them
       from state it already holds, because they are now drawn in every mode
       (reader/useQuoteMarks.ts). A band that pushes nothing has no publication
       to protect and no cleanup to get wrong. What replaced its arm here is the
       *opposite* assertion, one file over — that the marks **survive** leaving
       the mode — in tests/the-marks-in-the-prose-belong-to-the-mode-showing.test.tsx. */
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

  it("Timeline — the same three rules, from the same hook", async () => {
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

  it("Referee — an open key whose mark has gone cannot stay open", async () => {
    /* **The second of the three rules, and the one the arms above do not
       reach**: they all take the key away by unmounting the band, which is a
       different rule with a different mechanism. This one happens with the band
       still on screen — the referee unticks the criterion they were standing in,
       so the marks go and the key would otherwise survive, leaving a ring round
       a passage nothing marks and a stepper reading "– / 2".

       `useIdeasMode` had no such rule at all until 2026-08-27 and
       `CriteriaBand`'s was written on the same argument, so a helper that lost
       it would be repeating a bug this repo has already had. Keyed on *absence
       from `found`*, which is why the assertion below unticks rather than
       pressing the other row: an ordinary change of selection must leave the key
       alone, and the second `.crit-jump` press in the arm above is the guard for
       that half. */
    history.replaceState(null, "", `/read/${SLUG}?mode=referee&crits=${CRIT}`);
    show("referee");
    await flush();

    expect(state().found).toBe(2);
    const rows = [...host.querySelectorAll<HTMLButtonElement>(".crit-jump")];
    act(() => rows[0]!.click());
    await flush();
    expect(state().openKey).toBe(`${CRIT}:${ONE}:0`);

    const tick = host.querySelector<HTMLInputElement>(".crit-tick input");
    expect(tick, "the criterion's tick, which is what takes the marks away").not.toBeNull();
    act(() => tick!.click());
    await flush();

    expect(state().found, "unticking takes the marks out of the prose").toBe(0);
    expect(state().openKey, "and the ring cannot outlive the mark it was round").toBe("none");
  });

  it("Claims — the unkeyed shape, which owns no key to lose", async () => {
    /* **The one band with no `openKey` at all.** Nothing rings a claim's
       passage, so the whole of leaving is `onFound([])` — and the assertion that
       matters as much is the one about the key it does not own: a producer that
       cleared a key belonging to nobody would look exactly like this one until
       the sub-mode it shares a slot with had a key open. */
    history.replaceState(null, "", `/read/${SLUG}?mode=referee&referee=claims`);
    show("claims");
    await flush();

    /* Marks are off until the referee asks for them, so the precondition here is
       a tick rather than a URL — `showing` is local state and starts empty. */
    expect(state().found, "nothing is marked until the referee ticks a claim").toBe(0);
    const ticks = [...host.querySelectorAll<HTMLInputElement>(".clm-tick input")];
    expect(ticks, "one claim to tick").toHaveLength(1);
    act(() => ticks[0]!.click());
    await flush();
    expect(state().found, "the claim's passage is marked").toBe(1);

    show(null);
    await flush();

    expect(state().found).toBe(0);
    expect(state().openKey).toBe("none");
  });

  it("Search — the same rules under the older prop names", async () => {
    /* **`openHit`/`onOpenHit`, deliberately not renamed**, and this arm exists
       partly to hold that: six other test files mount `SearchBand` by those
       names, so the helper takes them through rather than making the band change
       its interface to use it.

       The literal matcher, because it needs no saved search and no model: it is
       resolved out of the blocks on every keystroke, which also makes Search the
       one producer here that publishes passages on its **first** commit. */
    history.replaceState(null, "", `/read/${SLUG}?mode=search&match=words&find=${FIND}`);
    show("search");
    await flush();

    expect(state().found, "the literal matcher found the phrase").toBe(1);
    expect(state().openKey).toBe("none");

    /* Search opens nothing by itself either; the reader presses a row. */
    const rows = [...host.querySelectorAll<HTMLButtonElement>(".srch-hit-btn")];
    expect(rows, "one result row to press").toHaveLength(1);
    act(() => rows[0]!.click());
    await flush();
    expect(state().openKey, "pressing a row rings its mark").not.toBe("none");

    show(null);
    await flush();

    expect(state().found).toBe(0);
    expect(state().openKey).toBe("none");
  });

  it("Referee's two sub-modes hand one slot over, in both directions", async () => {
    /* **The one place in the app where two producers share a slot.**
       `CriteriaBand` and `ClaimsBand` are siblings inside `RefereeSubMode`
       writing `Reader`'s single `refereeFound`, so changing `?referee=` is one
       commit that deletes one producer and mounts the other.

       What this arm asserts is the settled answer: after the swap the slot holds
       the **incoming** producer's marks and nothing of the outgoing one's. It
       passes against the pre-fix code too, and that is worth writing down rather
       than leaving to be rediscovered — both of these bands publish an *empty*
       list on their first commit (Criteria's marks come from a fetch, Claims'
       from a tick nobody has made), so the outgoing passive clear used to
       overwrite empty with empty and the settled state came out right by luck.
       The ordering that stops it being luck is proved in
       tests/passage-slot-hand-off.test.tsx, where the producers have something
       to say at mount. */
    history.replaceState(null, "", `/read/${SLUG}?mode=referee&referee=criteria&crits=${CRIT}`);
    show("referee");
    await flush();
    expect(state().found, "criteria marked its two passages").toBe(2);
    const rows = [...host.querySelectorAll<HTMLButtonElement>(".crit-jump")];
    act(() => rows[0]!.click());
    await flush();
    expect(state().openKey).toBe(`${CRIT}:${ONE}:0`);

    /* criteria → claims. The key goes with the producer that owned it: Claims
       has none, so a key surviving here would ring a passage nobody marks. */
    show("claims");
    await flush();
    expect(state().openKey, "criteria's ring must not outlive criteria").toBe("none");
    expect(state().found, "and neither may its marks").toBe(0);

    const ticks = [...host.querySelectorAll<HTMLInputElement>(".clm-tick input")];
    act(() => ticks[0]!.click());
    await flush();
    expect(state().found, "claims now owns the slot").toBe(1);

    /* claims → criteria, the other direction, which the first fix for this
       proposed to leave alone on the grounds that Claims was the exceptional
       shape. It is not: the rule is about the phase of the clear, not about
       which producer is keyed. */
    show("referee");
    await flush();
    expect(state().found, "criteria owns the slot again, with its own marks").toBe(2);
  });

});
