// @vitest-environment jsdom
/**
 * **The ring, the paragraph bars and the rail's ticks are all the band that is
 * open — and the phrase marks are that band plus the quotes, which are on the
 * page whatever mode it is. Through a whole reading session.**
 *
 * **The second clause arrived on 2026-09-08** and the file's name is one clause
 * behind it, deliberately: renaming it would cost every link into it for a
 * distinction `agree()` below states in full. Greg asked for the quotes to be
 * marked *"even if we're not in quotes mode"* (SPIDERYARN-READING2-2P), so
 * exactly one of the four projections stopped belonging to the open band. See
 * `agree` for which, and `proseFound` in src/web/reader/passages.ts for why the
 * other three must not follow it.
 *
 * This is the test a pure `selectPassages` unit test and a miniature-`Reader`
 * band harness both miss, and GPT Sol's F1 on the plan is the whole reason it
 * exists:
 *
 * > `<TimelineBand onFound={setIdeaFound} …/>` compiles, passes the band-level
 * > cleanup test, passes the selection test — and marks nothing in the real
 * > reader.
 *
 * Both of those tests are honest about their own subject and neither can see
 * *which setter a band was handed*, because neither mounts the composition that
 * hands it over. So this one mounts the whole app at a real article's address,
 * signed in as its owner, and drives the sequence the review's acceptance
 * criterion names:
 *
 * **Ideas → Timeline → Search with pending work → Criteria ↔ Claims → Plain →
 * Back**, and then, under an article change, **A → B → A over Ideas and
 * Timeline only**.
 *
 * That third arm is deliberately the short one, and saying so is GPT Sol's F3
 * on this file — an earlier draft of this header called it "the same again",
 * which it is not. What it is for is that a slot carries nothing across an
 * article boundary, and two producers with distinguishable marks answer that;
 * driving the whole sequence three times over would roughly double the file's
 * runtime to re-prove wiring the first two arms already hold. The cost of the
 * choice is real and belongs here rather than in a footnote: **an
 * article-scoped wiring mistake in Search, Criteria or Claims specifically
 * would not be caught by this variant.**
 *
 * ## How a wrong wiring is made visible
 *
 * Every producer marks **its own paragraph and only its own**. Ideas quotes the
 * second paragraph, Timeline the third, Search's literal matcher the fourth,
 * Criteria the fifth and Claims the sixth — so "which blocks are marked" is a
 * sentence naming the band, and a band whose marks went into another band's
 * slot produces an empty prose rather than a subtly wrong one. The mutation
 * that proves it is exactly Sol's: give `TimelineBand` Ideas' setter, and the
 * Timeline arm fails with *Timeline's own paragraph is marked*.
 *
 * ## Three projections, asserted together at every commit
 *
 * They are three memos over one array (`Reader` § `passages`), and the bug this
 * stage removed was two *expressions* disagreeing, so reading only one of them
 * would be reading the half that happened to be right:
 *
 *  - the **phrase marks** — `mark.hit` inside `tr[data-block]`, put there by
 *    annotate.ts, which is what the reader actually sees on the words;
 *  - the **ring** — `mark.hit[data-hit-open]`, drawn from `openKey` alone, so a
 *    ring in the wrong place is a key that came from a different slot than the
 *    marks did;
 *  - the **paragraph bar** — `td.text.has-hit`, from `blockStrength`, plus the
 *    rail's own `.spine-match` ticks from `blockMatches`, which is the same fact
 *    again for the spine.
 *
 * ## What it does not prove
 *
 * That the nine non-producers read their own answer rather than Search's slot
 * cannot be *seen* from here, and after stage 4a there is nothing to see: the
 * unmount clear is a layout cleanup, so Search's marks are gone before the paint
 * either way, and `act` flushes the commit and its cleanups together in any
 * case. What 4b changed is that the nine no longer depend on that clear, and the
 * assertion for it is
 * tests/every-mode-says-which-passages-it-marks.test.ts, which requires the
 * empty constant by identity rather than Search's emptied slot. What *is*
 * proved here is the settled truth at every step, which is the half no unit test
 * can reach.
 *
 * Harness lifted from tests/a-broken-mode-leaves-the-article-readable.test.tsx —
 * the mocks, the fake server, `settle`, `open` and `press` — which lifted it in
 * turn from tests/public-network-trace.test.tsx.
 *
 * docs/plans/260906c-separate-article-access-reader-composition-and-mode-controllers.md
 * § Stage 4b; docs/plans/260905e-main-app-architecture-review.md § A3.
 */
import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { enableHistorySync, NuqsAdapter } from "nuqs/adapters/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Article, Block, BlockId, Ideas, Timeline } from "../src/types.js";
import type { Claim, ClaimsRun } from "../src/referee-claims.js";
import type { SavedCriterion } from "../src/saved-criteria.js";
import { MODE_LABEL } from "../src/title-text.js";

/** Who `useSession` says is here — a store, so the page can be signed in. */
const who = vi.hoisted(() => {
  let user: { id: string; email: string } | null = null;
  const listeners = new Set<() => void>();
  return {
    get: () => user,
    set(next: { id: string; email: string } | null) {
      user = next;
      for (const fn of [...listeners]) fn();
    },
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
});

vi.mock("../src/web/useSession.js", async () => {
  const { useSyncExternalStore } = await import("react");
  return {
    useSession: () => ({
      session: null,
      user: useSyncExternalStore(who.subscribe, who.get, who.get),
      loading: false,
    }),
  };
});

const authListeners: ((event: string, session: unknown) => void)[] = [];

vi.mock("../src/web/lib/supabase.js", () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: { access_token: "t" } } }),
      refreshSession: async () => ({ data: { session: { access_token: "t" } } }),
      onAuthStateChange: (fn: (event: string, session: unknown) => void) => {
        authListeners.push(fn);
        return { data: { subscription: { unsubscribe() {} } } };
      },
      signOut: async () => ({ error: null }),
    },
  },
  googleSignInAvailable: false,
}));

/* The browser APIs the reading view uses that jsdom does not have. */
class NoResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
Object.assign(globalThis, { ResizeObserver: NoResizeObserver });
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    onchange: null,
    dispatchEvent: () => false,
  }),
});
Object.defineProperty(window, "scrollTo", { writable: true, value: () => {} });
if (!(globalThis as { CSS?: unknown }).CSS) {
  (globalThis as { CSS?: unknown }).CSS = { escape: (s: string) => s };
}

/* ------------------------------------------------------------ the article --

   Six blocks, five of which belong to exactly one producer. The phrases are
   distinct strings so that a mark landing in the wrong paragraph is a failure
   naming the paragraph rather than a count that is merely different. */

const A = "a-piece";
const B = "another-piece";

const HEAD = "spya-aaaaaa" as BlockId;
const P_IDEA = "spya-bbbbbb" as BlockId;
const P_TIME = "spya-cccccc" as BlockId;
const P_FIND = "spya-dddddd" as BlockId;
const P_CRIT = "spya-eeeeee" as BlockId;
const P_CLAIM = "spya-ffffff" as BlockId;
/**
 * **The paragraph the quotes mode marked, which since 2026-09-08 is marked in
 * every mode.**
 *
 * A seventh paragraph of its own rather than a quote laid over one of the six,
 * and that is what makes the arms below readable: "which blocks are marked"
 * stays a sentence naming the band, with one constant added to it everywhere.
 * A quote sharing `P_IDEA` would make the ideas arm pass whether or not the
 * quotes were drawn at all.
 */
const P_QUOTE = "spya-iiiiii" as BlockId;

const IDEA_QUOTE = "Thirty-one participants in each arm";
const TIME_QUOTE = "The trial ran through the spring";
/** Only in `P_FIND`, so the literal matcher marks one paragraph and no other. */
const FIND = "posthoc";
const CRIT_QUOTE = "no unexposed comparison group";
const CLAIM_QUOTE = "the effect held in eleven";
/** The line the quotes step chose. Verbatim from `P_QUOTE`, as the artefact's are. */
const KEPT_QUOTE = "Writing is thinking";

function para(id: BlockId, text: string): Block {
  return {
    id,
    tag: "p",
    kind: "text",
    text,
    words: text.split(" ").length,
    html: `<p>${text}</p>`,
    gistable: true,
  };
}

const BLOCKS: Block[] = [
  {
    id: HEAD,
    tag: "h1",
    kind: "heading",
    level: 1,
    text: "A piece",
    words: 2,
    html: "<h1>A piece</h1>",
    gistable: false,
  },
  para(P_IDEA, `${IDEA_QUOTE}, and that is the whole of the evidence.`),
  para(P_TIME, `${TIME_QUOTE} and finished before the summer.`),
  para(P_FIND, `A ${FIND} subgroup was named after the fact.`),
  para(P_CRIT, `There was ${CRIT_QUOTE} at any point.`),
  para(P_CLAIM, `Even so, ${CLAIM_QUOTE} of the participants.`),
  para(P_QUOTE, `${KEPT_QUOTE}; there is no other kind.`),
];

/** The second article's blocks — different ids, so leakage is visible. */
const B_HEAD = "spya-gggggg" as BlockId;
const B_IDEA = "spya-hhhhhh" as BlockId;
const B_TIME = "spya-jjjjjj" as BlockId;
const B_IDEA_QUOTE = "A second piece about something else";
const B_TIME_QUOTE = "It was written a year later";

const B_BLOCKS: Block[] = [
  {
    id: B_HEAD,
    tag: "h1",
    kind: "heading",
    level: 1,
    text: "Another piece",
    words: 2,
    html: "<h1>Another piece</h1>",
    gistable: false,
  },
  para(B_IDEA, `${B_IDEA_QUOTE}, entirely.`),
  para(B_TIME, `${B_TIME_QUOTE} by the same author.`),
];

function tree(slug: string, blocks: Block[]): Article["tree"] {
  const first = blocks[0]!.id;
  const last = blocks[blocks.length - 1]!.id;
  return {
    version: "test",
    generator: "test",
    slug,
    rootId: "n0",
    nodes: {
      n0: {
        id: "n0",
        depth: 0,
        parent: null,
        children: ["n1"],
        range: [first, last],
        title: "The piece",
        gist: "What the piece says.",
      },
      n1: {
        id: "n1",
        depth: 1,
        parent: "n0",
        children: [],
        range: [blocks[1]!.id, last],
        title: "The argument it makes",
        gist: "Where the piece gets to.",
      },
    },
  };
}

const ARTICLES: Record<string, Article> = {
  [A]: {
    meta: { slug: A, title: "A piece", url: "https://example.com/a", byline: "Somebody" },
    blocks: BLOCKS,
    tree: tree(A, BLOCKS),
    assets: undefined,
    /* Required on `Article` since dev made the nav-label ladder explicit;
       "ready" is what every writer produces today (src/types.ts). Nothing
       in this test reads it — it draws marks, not rung 5. */
    navLabelStatus: "ready",
  },
  [B]: {
    meta: { slug: B, title: "Another piece", url: "https://example.com/b", byline: "Somebody" },
    blocks: B_BLOCKS,
    tree: tree(B, B_BLOCKS),
    assets: undefined,
    /* Required on `Article` since dev made the nav-label ladder explicit;
       "ready" is what every writer produces today (src/types.ts). Nothing
       in this test reads it — it draws marks, not rung 5. */
    navLabelStatus: "ready",
  },
};

/* --------------------------------------------------------- the five slots -- */

/* **Real ids.** `ID_PATTERN` excludes `i`, `l`, `o` and `1`, and `?idea=`,
   `?event=` and `?crits=` all validate through it — so a plausible-looking
   `spya-krit34` parses to nothing, the criterion is never switched on, and the
   arm below would assert about a band showing its rows and marking nothing.
   src/ids.ts. */
const IDEA_ID = "spya-kdea34";
const EVENT_ID = "spya-kevt34";
const CRIT_ID = "spya-krtx34";

function ideasFor(slug: string, blockId: BlockId, quote: string): Ideas {
  return {
    version: "ideas/1",
    generator: "test",
    slug,
    sourceHash: "h",
    generatedAt: "2026-09-01T09:00:00.000Z",
    elapsedMs: 1,
    ideas: [
      {
        id: IDEA_ID,
        name: "Small arms carry little",
        provenance: "assumed",
        statement: "A trial this size cannot separate the effect from noise.",
        occurrences: [{ blockId, quote, reasoning: "the size is the claim" }],
      },
    ],
  };
}

function timelineFor(slug: string, blockId: BlockId, quote: string): Timeline {
  return {
    version: "timeline/1",
    generator: "test",
    slug,
    sourceHash: "h",
    orderConflicts: 0,
    generatedAt: "2026-09-01T09:00:00.000Z",
    elapsedMs: 1,
    events: [
      {
        id: EVENT_ID,
        label: "The trial ran",
        dating: { kind: "untimed" },
        order: 1,
        modality: "happened",
        occurrences: [{ blockId, quote, start: 0 }],
      },
    ],
  };
}

const CRITERION: SavedCriterion = {
  id: CRIT_ID,
  criterion: "Is the study adequately powered for the comparisons it draws?",
  config: {
    kind: "diverging",
    poles: { against: "underpowered", favour: "well powered" },
    scale: "rg",
  },
  createdAt: "2026-09-01T09:00:00.000Z",
  status: "done",
  results: [
    {
      kind: "diverging",
      blockId: P_CRIT,
      quote: CRIT_QUOTE,
      confidence: 80,
      reasoning: "nothing to compare it with",
      valence: -64,
    },
  ],
};

const CLAIM: Claim = {
  id: `${P_CRIT}:0`,
  blockId: P_CRIT,
  quote: CRIT_QUOTE,
  start: 0,
  claim: "The trial was too small to separate the effect from noise",
  passages: [
    { blockId: P_CLAIM, quote: CLAIM_QUOTE, start: 6, reasoning: "and again, post hoc" },
  ],
  discarded: 0,
};

const CLAIMS_RUN: ClaimsRun = {
  status: "done",
  createdAt: "2026-09-01T09:00:00.000Z",
  claims: [CLAIM],
  sourceHash: "h",
};

/* ------------------------------------------------------------ the network -- */

const trace: { url: string; method: string }[] = [];

/**
 * Search's saved-run list, **held** — which is what "with pending work" means
 * in the sequence this file drives. `SearchBand` fetches it on mount, and while
 * it is outstanding the band's literal matcher has already published its marks
 * out of the blocks. So the arm asserts the page is right *during* a request
 * rather than only after one, and the release afterwards asserts a reply that
 * lands in another mode cannot put marks back.
 */
/**
 * **Whether the held request was ever actually made, and whether it is still
 * held** — three booleans rather than one nullable function, because the
 * function alone could not tell the two failures apart.
 *
 * It was `let releaseSearch: (() => void) | null`, armed with a `() => {}` that
 * the handler replaced only if `/api/search/` really arrived. GPT Sol's stage 4b
 * review (P2) pointed out what that cannot see: the marks in this arm come from
 * `findLiteral` and do not depend on the reply at all, so if the GET stopped
 * being made — or started resolving at once — every visible assertion would
 * still have the same answer and the release at the end would call the dummy.
 * "Search **with pending work**" would have quietly become "Search". So the
 * pending-ness is asserted directly: made, still unsettled, and settled only
 * when this test says so.
 */
const heldSearch = {
  /** Set before entering Search. False means answer the GET immediately. */
  wanted: false,
  /** True once the handler has been reached and the reply withheld. */
  made: false,
  /** True once the reply has actually been let go. */
  settled: false,
  release: null as (() => void) | null,
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function slugOf(url: string): string {
  const tail = url.split("?")[0]!.split("/").pop() ?? "";
  return tail;
}

function reply(url: string, method: string): Promise<Response> {
  const path = url.split("?")[0] ?? url;
  if (path.startsWith("/api/article/")) {
    const article = ARTICLES[slugOf(path)];
    return Promise.resolve(article ? json(article) : json({ error: "no" }, 404));
  }
  /* **Experimental features on**, because Timeline and Quotes are behind that
     switch and the bar does not draw a button for a mode it is hiding
     (Dock.tsx § the modes it draws at all). */
  if (path === "/api/reader") {
    return Promise.resolve(json({ experimentalSince: "2026-09-01T09:00:00.000Z" }));
  }
  if (method === "POST") return Promise.resolve(new Response(null, { status: 204 }));
  if (path.startsWith("/api/ideas/")) {
    const slug = slugOf(path);
    const ideas =
      slug === B ? ideasFor(B, B_IDEA, B_IDEA_QUOTE) : ideasFor(A, P_IDEA, IDEA_QUOTE);
    return Promise.resolve(json({ ideas, stale: false, outdated: false, profileChanged: false }));
  }
  if (path.startsWith("/api/timeline/")) {
    const slug = slugOf(path);
    const timeline =
      slug === B ? timelineFor(B, B_TIME, B_TIME_QUOTE) : timelineFor(A, P_TIME, TIME_QUOTE);
    return Promise.resolve(json({ timeline, stale: false, outdated: false }));
  }
  /* **The quotes, for article A only.** B has none, which is what lets the
     article-change arm below show that a slot carries nothing across a boundary
     — including this one, which is not a slot a band writes any more. */
  if (path.startsWith("/api/quotes/")) {
    if (slugOf(path) !== A) return Promise.resolve(new Response(null, { status: 404 }));
    return Promise.resolve(
      json({
        quotes: {
          slug: A,
          version: "quotes/3",
          generator: "test",
          sourceHash: "h",
          quotes: [{ id: "spya-qte001", blockId: P_QUOTE, text: KEPT_QUOTE, importance: 0.9 }],
        },
        stale: false,
        outdated: false,
        profileChanged: false,
      }),
    );
  }
  if (path.startsWith("/api/referee/criteria/")) {
    return Promise.resolve(json({ criteria: [CRITERION], sourceHash: "h" }));
  }
  if (path.startsWith("/api/referee/claims/")) {
    return Promise.resolve(json({ run: CLAIMS_RUN, sourceHash: "h" }));
  }
  if (path.startsWith("/api/search/")) {
    const answer = json({ searches: [], sourceHash: "h" });
    if (!heldSearch.wanted) return Promise.resolve(answer);
    heldSearch.made = true;
    return new Promise<Response>((go) => {
      heldSearch.release = () => {
        heldSearch.settled = true;
        go(answer);
      };
    });
  }
  if (path.startsWith("/api/comments/")) return Promise.resolve(json({ comments: [] }));
  if (path.startsWith("/api/chat/")) return Promise.resolve(json({ threads: [] }));
  if (path.startsWith("/api/glossary/")) {
    return Promise.resolve(json({ status: "none", glossary: null }));
  }
  if (path === "/api/jobs") return Promise.resolve(json({ jobs: [] }));
  return Promise.resolve(json({}));
}

const { App } = await import("../src/web/App.js");
const { resetForTests: resetExperimental } = await import("../src/web/experimental-store.js");
const activation = await import("../src/web/activation.js");

let host: HTMLDivElement;
let root: Root;

enableHistorySync();

const OWNER = { id: "owner-1", email: "a@example.com" };

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  trace.length = 0;
  heldSearch.wanted = false;
  heldSearch.made = false;
  heldSearch.settled = false;
  heldSearch.release = null;
  who.set(OWNER);
  activation.resetActivations();
  resetExperimental();
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    trace.push({ url, method });
    return reply(url, method);
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

async function settle(turns = 6): Promise<void> {
  for (let i = 0; i < turns; i++) {
    await act(async () => {
      await new Promise((go) => setTimeout(go, 0));
    });
  }
}

/**
 * The whole app at an article's address, with every producer's selection already
 * in the URL.
 *
 * `?idea=` and `?event=` are there from the start because Ideas and Timeline
 * open their first occurrence as soon as one is named — that is the state a
 * selected idea is *in*, whether the reader pressed a row or pasted a link — and
 * `?match=words&find=` is Search's literal matcher, which needs no artefact.
 * They persist across mode changes, so pressing a mode is the whole of what each
 * arm below has to do.
 */
async function open(slug: string, strict: boolean): Promise<void> {
  const search = `?mode=plain&idea=${IDEA_ID}&event=${EVENT_ID}&crits=${CRIT_ID}&match=words&find=${FIND}`;
  history.replaceState(null, "", `/read/${slug}${search}`);
  const tree = createElement(NuqsAdapter, null, createElement(App, null));
  await act(async () => {
    root.render(strict ? createElement(StrictMode, null, tree) : tree);
  });
  await act(async () => {
    for (const fn of [...authListeners]) fn("SIGNED_IN", { user: who.get() });
  });
  await settle();
}

const modeInUrl = (): string => new URLSearchParams(location.search).get("mode") ?? "plain";

/** `?mode=` is written behind nuqs' throttle, so a single read is a race. */
async function modeAfterPress(before: string): Promise<string> {
  for (let i = 0; i < 40 && modeInUrl() === before; i++) {
    await act(async () => {
      await new Promise((go) => setTimeout(go, 10));
    });
  }
  return modeInUrl();
}

function modeButton(label: string): HTMLButtonElement {
  const found = [...host.querySelectorAll<HTMLButtonElement>('.dock-modes [role="radio"]')].find(
    (b) => b.getAttribute("aria-label") === label,
  );
  expect(found, `the bar must draw ${label}`).toBeDefined();
  return found as HTMLButtonElement;
}

async function press(label: string): Promise<void> {
  const before = modeInUrl();
  const button = modeButton(label);
  await act(async () => button.click());
  await modeAfterPress(before);
  await settle();
}

/* ------------------------------------------------------- what is on screen -- */

/** Which paragraphs carry phrase marks, by block id, in document order. */
function marked(): string[] {
  return [...host.querySelectorAll<HTMLElement>("tr[data-block]")]
    .filter((row) => row.querySelector("mark.hit") !== null)
    .map((row) => row.getAttribute("data-block") ?? "?");
}

/** Which paragraphs carry the ring — `openKey`'s only visible consequence. */
function rung(): string[] {
  return [...host.querySelectorAll<HTMLElement>("tr[data-block]")]
    .filter((row) => row.querySelector("mark.hit[data-hit-open]") !== null)
    .map((row) => row.getAttribute("data-block") ?? "?");
}

/** Which paragraphs carry the bar down their left — `blockStrength`. */
function barred(): string[] {
  return [...host.querySelectorAll<HTMLElement>("tr[data-block]")]
    .filter((row) => row.querySelector("td.text.has-hit") !== null)
    .map((row) => row.getAttribute("data-block") ?? "?");
}

/** How many ticks the rail is drawing — `blockMatches`, the third projection. */
const railTicks = (): number => host.querySelectorAll(".spine-match").length;

/**
 * **The one assertion every arm makes**, so no arm can quietly assert less than
 * another.
 *
 * ## The contract changed on 2026-09-08, and this is where it is written down
 *
 * It used to be *the three projections name the same paragraphs*. Greg then
 * asked for the quotes to be marked *"even if we're not in quotes mode"*
 * (SPIDERYARN-READING2-2P), which makes that false for exactly one of the three:
 *
 * > the phrase marks are **the open mode's passages plus the quotes**; the
 * > paragraph bar, the spine rail and the ring are **the open mode's alone**.
 *
 * The split is not fastidiousness — a quote's `confidence` is `null`, which
 * `blockStrength` reads as certainty, so a quote allowed into the paragraph bar
 * would repaint a hedged search's bar at full; and every quote carries `slot: 0`,
 * which is the first saved search's colour. `proseFound` in
 * src/web/reader/passages.ts has the argument.
 *
 * **`quoted` is a parameter rather than a constant** so that one arm can say
 * *no* — the second article has no quotes, which is what shows that nothing
 * carries across an article boundary.
 */
function agree(where: string, blocks: BlockId[], ring: BlockId[], quoted = true): void {
  /* Document order, because `marked()` reads the rows down the page and
     `P_QUOTE` is the last paragraph. */
  const inProseNow = quoted ? [...blocks, P_QUOTE] : blocks;
  expect(marked(), `${where}: the phrase marks`).toEqual(inProseNow);
  expect(barred(), `${where}: the paragraph bars`).toEqual(blocks);
  expect(rung(), `${where}: the ring`).toEqual(ring);
  expect(railTicks(), `${where}: the rail's ticks`).toBe(blocks.length);
}

const onScreen = (phrase: string): boolean => (host.textContent ?? "").includes(phrase);

/* ------------------------------------------------------------- the session -- */

/**
 * The sequence, driven once per harness variant. `strict` is the second run
 * required by A3's acceptance: `main.tsx` mounts inside a `<StrictMode>`, so a
 * harness that left it off would be testing a page nobody visits — and the
 * simulated double-invocation is exactly what a publish/clear pair can be got
 * wrong by.
 */
async function readingSession(strict: boolean): Promise<void> {
  await open(A, strict);
  agree("plain, on arrival", [], []);

  /* ---- Ideas. Its occurrence is in P_IDEA and `?idea=` opens the first. */
  await press(MODE_LABEL.ideas);
  expect(onScreen("Small arms carry little"), "the Ideas panel never mounted").toBe(true);
  agree("ideas", [P_IDEA], [P_IDEA]);

  /* ---- Timeline. The arm Sol's mutation breaks: with Ideas' setter in
     `TimelineBand`, `timelineFound` stays empty and this is an empty page. */
  await press(MODE_LABEL.timeline);
  expect(onScreen("The trial ran"), "the Timeline panel never mounted").toBe(true);
  agree("timeline", [P_TIME], [P_TIME]);

  /* ---- Search, with its saved-run request still outstanding. */
  heldSearch.wanted = true;
  await press(MODE_LABEL.search);
  /* **That the request is pending is asserted, not assumed.** Everything below
     would read the same over a Search that never asked or was answered at once,
     because these marks come from the literal matcher — so the state this arm
     claims to be testing has to be checked directly. Sol, stage 4b, P2. */
  expect(heldSearch.made, "the saved-run GET was never made — nothing is pending").toBe(true);
  expect(heldSearch.settled, "the held reply landed before the reader had left Search").toBe(false);
  const rows = [...host.querySelectorAll<HTMLButtonElement>(".srch-hit-btn")];
  expect(rows, "the literal matcher found nothing to list").toHaveLength(1);
  agree("search, request pending", [P_FIND], []);
  /* Search opens nothing by itself; the reader presses a row. */
  await act(async () => rows[0]!.click());
  await settle();
  agree("search, a row pressed", [P_FIND], [P_FIND]);

  /* ---- Referee: Criteria, then Claims, then Criteria again. The one slot two
     producers share, and the hand-off has to be visible in the prose rather
     than only in the state. */
  await press(MODE_LABEL.referee);
  const jump = [...host.querySelectorAll<HTMLButtonElement>(".crit-jump")];
  expect(jump, "the criterion's result row").toHaveLength(1);
  agree("criteria", [P_CRIT], []);
  await act(async () => jump[0]!.click());
  await settle();
  agree("criteria, a row pressed", [P_CRIT], [P_CRIT]);

  await viewChip("Claims");
  /* Claims marks nothing until the referee ticks one — and Criteria's ring must
     not have survived the hand-off, because Claims owns no key to hold it. */
  agree("claims, before the tick", [], []);
  const ticks = [...host.querySelectorAll<HTMLInputElement>(".clm-tick input")];
  expect(ticks, "one claim to tick").toHaveLength(1);
  await act(async () => ticks[0]!.click());
  await settle();
  agree("claims, ticked", [P_CLAIM], []);

  await viewChip("Criteria");
  agree("criteria again", [P_CRIT], []);

  /* ---- Plain: a mode with no band and nothing to mark. */
  await press(MODE_LABEL.plain);
  expect(onScreen(CRIT_QUOTE), "the prose went with the band").toBe(true);
  agree("plain", [], []);

  /* ---- And Back, which is a mode change nobody pressed. `?mode=` is pushed
     history, so this returns to Referee with its own marks and no others. */
  await act(async () => history.back());
  await modeAfterPress("plain");
  await settle();
  expect(modeInUrl(), "Back did not return to Referee").toBe("referee");
  agree("back, in referee", [P_CRIT], []);

  /* The held reply lands in a mode that is not Search. Nothing may come back:
     the band is unmounted, and `selectPassages` would not read its slot anyway.
     Held all the way here, and let go by this line rather than by a timeout —
     both halves asserted, so "the reply arrived late" cannot become "the reply
     arrived on time and this line did nothing". */
  expect(heldSearch.settled, "the held reply settled on its own, somewhere above").toBe(false);
  heldSearch.release?.();
  await settle();
  expect(heldSearch.settled, "releasing the held reply did nothing").toBe(true);
  agree("after the held search reply landed", [P_CRIT], []);
}

/** Press one of Referee's sub-mode chips by its label. */
async function viewChip(label: string): Promise<void> {
  const chip = [...host.querySelectorAll<HTMLButtonElement>(".ref-view-btn")].find(
    (b) => (b.textContent ?? "").trim() === label,
  );
  expect(chip, `the ${label} chip`).toBeDefined();
  await act(async () => (chip as HTMLButtonElement).click());
  await settle();
}

describe("the marks in the prose belong to the mode showing, plus the quotes", () => {
  it("keeps every projection agreeing through a whole session", async () => {
    await readingSession(false);
  });

  it("does the same under StrictMode", async () => {
    await readingSession(true);
  });

  it("carries nothing across an article change, A → B → A", async () => {
    /* **Ideas and Timeline only, on purpose** — the header says why, and what
       this therefore does not cover. Sol, stage 4b, F3. */
    await open(A, false);
    await press(MODE_LABEL.ideas);
    agree("A, ideas", [P_IDEA], [P_IDEA]);
    await press(MODE_LABEL.timeline);
    agree("A, timeline", [P_TIME], [P_TIME]);

    /* B, reached the way a reader reaches it: a different address.

       **`quoted: false`, and it is the sharpest assertion in this arm.** B's
       `/api/quotes/` answers 404, so a mark on `P_QUOTE` here would be A's
       quote drawn on an article that does not contain it — which is what a
       marks layer that outlives the *article* rather than the *mode* would do,
       and the whole risk of having moved these out of the band's lifetime. */
    await go(B);
    expect(onScreen(B_IDEA_QUOTE), "the second article never loaded").toBe(true);
    await press(MODE_LABEL.ideas);
    agree("B, ideas", [B_IDEA], [B_IDEA], false);
    await press(MODE_LABEL.timeline);
    agree("B, timeline", [B_TIME], [B_TIME], false);

    /* And back to A, whose paragraphs are the only ones that may be marked. */
    await go(A);
    expect(onScreen(IDEA_QUOTE), "the first article never came back").toBe(true);
    await press(MODE_LABEL.ideas);
    agree("A again, ideas", [P_IDEA], [P_IDEA]);
  });
});

/** Go to another article's address — `popstate`, which is what Back sends. */
async function go(slug: string): Promise<void> {
  const search = `?mode=plain&idea=${IDEA_ID}&event=${EVENT_ID}&crits=${CRIT_ID}&match=words&find=${FIND}`;
  await act(async () => {
    history.pushState(null, "", `/read/${slug}${search}`);
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  await settle();
}
