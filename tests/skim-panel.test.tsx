// @vitest-environment jsdom
/**
 * **Skim mode, drawn and walked** — src/web/SkimPanel.tsx and
 * src/web/modes/skim/SkimMode.tsx.
 *
 * Two halves. The panel, from a posed hook and view: the pinned head, the depth
 * control that offers only the depths that add stops, the role line on the
 * current row only, each pass's stops, the pips that say which passes a stop
 * is in (plan 261003l), and the foot's promise. Then the
 * band, for real, over a stubbed network inside a
 * `NuqsAdapter`: what a step and a depth change write to the address and to the
 * history stack, that a stale `?stop=` falls back to the first stop, and that
 * the passage it publishes is the quote's own mark.
 *
 * docs/plans/260928a-trajectory-mode-skim-a-paper-at-increasing-depth.md.
 */
import { act, createElement, StrictMode, useCallback, useEffect, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NuqsAdapter } from "nuqs/adapters/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  Block,
  BlockId,
  Job,
  NodeId,
  Quote,
  Quotes,
  Skim,
  SkimStop,
  Tree,
  TreeNode,
} from "../src/types.js";
import type { GlossaryEntry } from "../src/types.js";
import type { GlossaryRead } from "../src/web/useGlossary.js";
import type { CardTarget, StopCard } from "../src/web/stop-card.js";
import type { TermActions } from "../src/web/ProseHoverCard.js";
import type { Found } from "../src/web/search-hits.js";
import type { UseSkim } from "../src/web/useSkim.js";
import type { QuotesRead } from "../src/web/useQuotes.js";
import type {
  SkimArrival,
  SkimControl,
  SkimView,
} from "../src/web/modes/skim/SkimMode.js";
import { DELAY } from "../src/web/Tooltip.js";
import temml from "temml";
import { temmlRenderer } from "../src/maths-tex.js";
import { renderArticleMaths } from "../src/web/maths.js";
import { BlockLinkProvider, buildBlockLinkIndex } from "../src/web/BlockLinkCard.js";
import type { Article } from "../src/types.js";

/* jsdom has no `CSS.escape`, which `useFollow` uses to find the current row;
   the ids here need no escaping. scroll-glide.test.ts does the same. */
globalThis.CSS ??= { escape: (s: string) => s } as unknown as typeof globalThis.CSS;

/* ------------------------------------------------------------ the network -- */

let skimBody: unknown = null;
/** The Ideas the stop card may show, or `null` for none (404). */
let ideasBody: unknown = null;
/** The FAQ a stop card must not show (SPIDERYARN-READING2-8Z), or `null` for none (404). */
let faqBody: unknown = null;
/** A held Ideas read, for the prerequisite-loading race. */
let ideasReply: Promise<Response> | null = null;
/** The Ideas read fails: the server answers a 500 in its own sentence. */
let ideasFails = false;
/** Every request, so a test can say the card started no job. */
const requested: { url: string; method: string }[] = [];
/** The body of every POST, parsed — what a press asked the queue for. */
const posted: unknown[] = [];
vi.mock("../src/web/lib/api.js", async () => {
  const real = await vi.importActual<typeof import("../src/web/lib/api.js")>(
    "../src/web/lib/api.js",
  );
  const apiFetch = async (url: string, init?: RequestInit) => {
    requested.push({ url, method: init?.method ?? "GET" });
    if (init?.method === "POST" && typeof init.body === "string") posted.push(JSON.parse(init.body));
    if (url.startsWith("/api/skim/"))
      return skimBody === null
        ? new Response(null, { status: 404 })
        : new Response(JSON.stringify(skimBody), { status: 200 });
    if (url.startsWith("/api/ideas/") && ideasFails)
      return new Response(JSON.stringify({ error: "The Ideas could not be read." }), { status: 500 });
    if (url.startsWith("/api/ideas/"))
      return ideasReply ?? (ideasBody === null
        ? new Response(null, { status: 404 })
        : new Response(JSON.stringify(ideasBody), { status: 200 }));
    if (url.startsWith("/api/faq/"))
      return faqBody === null ? new Response(null, { status: 404 }) : new Response(JSON.stringify(faqBody), { status: 200 });
    if (url.startsWith("/api/jobs")) return new Response(JSON.stringify({ jobs: [] }), { status: 200 });
    /* The stale notice's × (plan 261010a): nothing dismissed yet, and a dismissal lands. */
    if (url.startsWith("/api/stale-notices/"))
      return init?.method === "POST"
        ? new Response(null, { status: 204 })
        : new Response(JSON.stringify({ dismissed: {} }), { status: 200 });
    return new Response(null, { status: 404 });
  };
  return {
    ...real,
    apiFetch,
    fetchOk: async (url: string, init?: RequestInit) => apiFetch(url, init),
  };
});

/* The queue is the real one; only its completion callbacks are kept, so a test
   can say "the route's job finished" without a poll (Sol F61). */
const { finishers } = vi.hoisted(() => ({ finishers: [] as ((job: unknown) => void)[] }));
vi.mock("../src/web/useJobs.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/web/useJobs.js")>();
  return {
    ...real,
    useJobs: (cadence: Parameters<typeof real.useJobs>[0], cb?: Parameters<typeof real.useJobs>[1]) => {
      if (cb) finishers.push(cb as (job: unknown) => void);
      return real.useJobs(cadence, cb);
    },
  };
});

/* Scrolls are recorded — jsdom has no layout, and the claim is that a step
   scrolls rather than pushes. comment-jump.test.ts does the same. */
const { scrolled, flashed, passages, jumpPassages, movement, aligns, flashOrder } = vi.hoisted(() => ({
  scrolled: [] as string[],
  flashed: [] as string[],
  /* The passage each flash was narrowed to (plan 260928a § 7b), or null. */
  passages: [] as (string | null)[],
  /* The passage a history-pushing row jump asks `beginJump` to flash. */
  jumpPassages: [] as (string | null)[],
  /* How each Skim movement asked to land — plan 260929a § 3. */
  aligns: [] as string[],
  movement: { outcome: "settled" as "settled" | "cancelled" | "missing", dropped: 0 },
  flashOrder: [] as string[],
}));
vi.mock("../src/web/scroll.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/web/scroll.js")>();
  /* The scroll settles at once, so a caller that flashes on "settled" does. */
  return {
    ...actual,
    scrollToBlock: (
      id: string,
      _behavior?: ScrollBehavior,
      done?: (o: "settled" | "cancelled" | "missing") => void,
      how?: { align?: string },
    ) => {
      scrolled.push(id);
      aligns.push(how?.align ?? "top");
      done?.(movement.outcome);
    },
  };
});
/* The flash on arrival (stage 5a), recorded: jsdom has no prose to wash. */
vi.mock("../src/web/flash.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/web/flash.js")>();
  return {
    ...actual,
    flashBlock: (id: string, target?: { passage?: string | null }) => {
      flashed.push(id);
      passages.push(target?.passage ?? null);
    },
    dropPendingFlash: () => {
      movement.dropped += 1;
      flashOrder.push("old flash dropped");
    },
    resetFlash: () => {
      flashed.length = 0;
    },
  };
});

const { SkimPanel, SkimDoor, SKIM_CUE_EXPLAINED, coverageNote, skimPromise } = await import(
  "../src/web/SkimPanel.js"
);
const { armSkimOpening, firstSkimArrival, SkimBand } = await import(
  "../src/web/modes/skim/SkimMode.js"
);
const { resetFlash } = await import("../src/web/flash.js");
const { useModeFlashOwnership } = await import("../src/web/reader/mode-flash.js");
const { resolveQuotes } = await import("../src/web/search-hits.js");
const { quoteStroke } = await import("../src/web/QuotesPanel.js");

describe("the reading view's Skim arrival mailbox", () => {
  it("arms from the press itself even while location still has the old mode", () => {
    history.replaceState(null, "", "/read/a-route?mode=plain");
    const arrival = firstSkimArrival("plain");
    armSkimOpening(arrival, "plain", "skim");
    expect(location.search, "nuqs has not written the new mode yet").toBe("?mode=plain");
    expect(arrival).toEqual({ stop: null, open: true });
  });

  it("does not re-arm a press on the already-open mode", () => {
    const arrival: SkimArrival = { stop: null, open: false };
    armSkimOpening(arrival, "skim", "skim");
    expect(arrival.open).toBe(false);
  });

  it("arms neither a stop arrival nor an opening when Back remounts the Reader", () => {
    history.replaceState(null, "", "/read/a-route?mode=skim&stop=q-popped");
    window.dispatchEvent(new PopStateEvent("popstate"));
    expect(firstSkimArrival("skim")).toEqual({ stop: null, open: false });
  });
});

describe("a held flash across a mode change", () => {
  function IncomingBand({ mode }: { mode: "plain" | "skim" }) {
    useEffect(() => {
      if (mode === "skim") flashOrder.push("incoming landing");
    }, [mode]);
    return null;
  }

  function FlashOwner({ mode }: { mode: "plain" | "skim" }) {
    useModeFlashOwnership(mode, mode === "skim");
    return createElement(IncomingBand, { key: mode, mode });
  }

  it("drops the departing mode's flash before the incoming band claims its landing", async () => {
    await act(async () => root.render(createElement(FlashOwner, { mode: "plain" })));
    flashOrder.length = 0;
    await act(async () => root.render(createElement(FlashOwner, { mode: "skim" })));
    expect(flashOrder).toEqual(["old flash dropped", "incoming landing"]);
  });
});

/* ------------------------------------------------------------ the article -- */

/* Real ids: the alphabet has no `1`, `i`, `l` or `o`. docs/project/block-ids.md. */
const B = ["spya-tr2abc", "spya-tr3def", "spya-tr4ghj", "spya-tr5kmn"] as BlockId[];
const Q = ["spya-tq2abc", "spya-tq3def", "spya-tq4ghj", "spya-tq5kmn"];
const WORDS = [
  "The effect held in all four cohorts.",
  "We measured it with a calibrated rig.",
  "Earlier work never left the laboratory.",
  "The limits are the sample and the season.",
];

const BLOCKS: Block[] = B.map((id, i) => ({
  id,
  tag: "p",
  kind: "text",
  text: WORDS[i]!,
  words: 7,
  html: `<p>${WORDS[i]}</p>`,
  gistable: true,
}));

function node(
  id: string,
  depth: number,
  parent: string | null,
  children: string[],
  range: [number, number],
  title: string,
): TreeNode {
  return {
    id: id as NodeId,
    depth,
    parent: parent as NodeId | null,
    children: children as NodeId[],
    range: [B[range[0]]!, B[range[1]]!],
    title,
  };
}
const TREE: Tree = {
  version: "t",
  generator: "t",
  slug: "a-route",
  rootId: "root" as NodeId,
  nodes: {
    root: node("root", 0, null, ["res", "met"], [0, 3], "Whole"),
    res: node("res", 1, "root", ["l0", "l1"], [0, 1], "Results"),
    l0: node("l0", 2, "res", [], [0, 0], "l0"),
    l1: node("l1", 2, "res", [], [1, 1], "l1"),
    met: node("met", 1, "root", ["l2", "l3"], [2, 3], "Methods"),
    l2: node("l2", 2, "met", [], [2, 2], "l2"),
    l3: node("l3", 2, "met", [], [3, 3], "l3"),
  } as Record<NodeId, TreeNode>,
};

const QUOTE_LIST: Quote[] = B.map((blockId, i) => ({
  id: Q[i]!,
  blockId,
  text: WORDS[i]!,
  start: 0,
  importance: 80,
  striking: 60,
}));

const QUOTES: Quotes = {
  version: "test",
  generator: "test",
  slug: "a-route",
  sourceHash: "hash",
  quotes: QUOTE_LIST,
  discarded: { unfound: 0, otherVoice: 0, wrongLength: 0, overlapping: 0, overCap: 0, malformed: 0 },
  generatedAt: "2026-09-28T09:00:00.000Z",
  elapsedMs: 1,
};

/**
 * Route order q2 q0 q3 q1; Gist is q2 and q0, More adds q3, Most adds q1 —
 * and since plan 260929e each pass walks only what it adds: Gist q2 q0, More
 * q3, Most q1.
 */
const STOPS: SkimStop[] = [
  { quoteId: Q[2]!, depth: 1, role: null, cue: "What does earlier work miss, by their account?" },
  { quoteId: Q[0]!, depth: 1, role: null, cue: "Look for the headline comparison." },
  { quoteId: Q[3]!, depth: 2, role: null, cue: "Where does it stop holding?" },
  /* A stop from a route written before cues: the band falls back to its role. */
  { quoteId: Q[1]!, depth: 3, role: "How they measured it" },
];

const ROUTE: Skim = {
  version: "test",
  generator: "test",
  slug: "a-route",
  sourceHash: "hash",
  profileHash: null,
  stops: STOPS,
  visible: [2, 3, 4],
  offered: 4,
  dropped: { unknownQuote: 0, duplicate: 0, sameBlock: 0, malformed: 0, badRole: 0, overCap: 0, collapsed: 0 },
  generatedAt: "2026-09-28T09:00:00.000Z",
  elapsedMs: 1,
};

const SKIM_BODY = {
  skim: ROUTE,
  stale: false,
  outdated: false,
  profileChanged: false,
  notOnRoute: 0,
};

/**
 * **The same route with two stops carried into a deeper pass** (plan 261003l,
 * spya-ms9d69): Gist q2 q0, More q2 q3, Most q3 q1. Stop 1 of More is stop 1
 * of Gist, so a depth change from the top of Gist stays where it is.
 */
const SHARED_STOPS: SkimStop[] = STOPS.map((s) =>
  s.quoteId === Q[2] ? { ...s, again: [2] } : s.quoteId === Q[3] ? { ...s, again: [3] } : s,
);
const SHARED_BODY = { ...SKIM_BODY, skim: { ...ROUTE, stops: SHARED_STOPS } };

/* ------------------------------------------------------------- the harness -- */

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  scrolled.length = 0;
  flashed.length = 0;
  passages.length = 0;
  jumpPassages.length = 0;
  movement.outcome = "settled";
  movement.dropped = 0;
  requested.length = 0;
  posted.length = 0;
  quotesRead = QUOTES_READ;
  ideasBody = null;
  faqBody = null;
  ideasReply = null;
  ideasFails = false;
  finishers.length = 0;
  skimBody = SKIM_BODY;
  history.replaceState(null, "", "/read/a-route?mode=skim");
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
});

/* =============================================================== the panel == */

function owner(over: Partial<UseSkim> = {}): UseSkim {
  return {
    status: "ready",
    skim: ROUTE,
    stale: false,
    outdated: false,
    profileChanged: false,
    profileNoticeDismissed: false,
    dismissFailed: null,
    dismissProfileNotice: async () => {},
    notOnRoute: 0,
    slug: "a-route",
    error: null,
    job: null,
    failed: null,
    stalled: false,
    starting: false,
    automatic: false,
    quotesFirst: false,
    ideasFirst: false,
    retryRead: async () => {},
    ensure: async () => {},
    regenerate: async () => {},
    rewriting: false,
    refresh: async () => {},
    cancel: () => {},
    ...over,
  };
}

const RUNNING_SKIM_JOB: Job = {
  id: "job-skim",
  ownerId: "owner" as Job["ownerId"],
  slug: "a-route",
  status: "running",
  createdAt: "2026-09-29T00:00:00.000Z",
  startedAt: "2026-09-29T00:00:01.000Z",
  steps: [
    {
      name: "skim",
      label: "Planning the route",
      status: "running",
      startedAt: "2026-09-29T00:00:01.000Z",
    },
  ],
};

const calls: string[] = [];
function view(over: Partial<SkimView> = {}): SkimView {
  return {
    depth: 2,
    depths: [
      { depth: 1, label: "Gist", count: 2 },
      { depth: 2, label: "More", count: 3 },
      { depth: 3, label: "Most", count: 4 },
    ],
    rows: [
      { quoteId: Q[2]!, n: 1, place: [{ title: "Methods", voice: "ai" }], cue: "What earlier work missed", current: false, missing: false, position: null, words: null, where: [], passes: null, blockId: null },
      { quoteId: Q[0]!, n: 2, place: [{ title: "Results", voice: "ai" }], cue: "The headline result", current: true, missing: false, position: null, words: null, where: [], passes: null, blockId: null },
      { quoteId: Q[3]!, n: 3, place: [{ title: "Methods", voice: "ai" }], cue: "Where it stops holding", current: false, missing: false, position: null, words: null, where: [], passes: null, blockId: null },
    ],
    position: 2,
    card: null,
    onDepth: (d) => void calls.push(`depth ${d}`),
    onRow: (id) => void calls.push(`row ${id}`),
    onStep: (dir) => void calls.push(`step ${dir}`),
    onOpen: (target) => void calls.push(`open ${target.kind}${"id" in target ? ` ${target.id}` : ""}`),
    canOpen: () => true,
    termActions: null,
    onAskTerm: null,
    ...over,
  };
}

/** The owner's *Ask in chat* on a term, as the Skim band hands it to the card (plan 261009k). */
const ask = (entry: { id: string }) => void calls.push(`ask ${entry.id}`);

/** The owner's *Hide* on a term, as the Skim band hands it to the card. */
function termActions(over: Partial<TermActions> = {}): TermActions {
  return {
    setHidden: async (id) => void calls.push(`hide ${id}`),
    hiding: new Set<string>(),
    ...over,
  };
}

const TERM: GlossaryEntry = {
  id: "spya-te2abc",
  name: "transfer entropy",
  kind: "concept",
  aliases: [],
  senseHere: "How much a source's past says about a target's future.",
  blocks: [B[0]!],
};
const CARD: StopCard = {
  terms: [
    { entry: TERM },
    { entry: { ...TERM, id: "spya-te3def", name: "synergy", senseHere: "Information only the pair carries." } },
  ],
  ideas: [{ id: "spya-id2abc", name: "Synergy is not redundancy", statement: "The pair carries information neither does alone." }],
  events: [{ id: "spya-ev2abc", label: "Recordings made" }],
};

async function draw(o: UseSkim, v: SkimView) {
  calls.length = 0;
  await act(async () => root.render(createElement(SkimPanel, { access: { kind: "owner", owner: o }, view: v, away: false })));
}

async function drawVisitor(v: SkimView) {
  calls.length = 0;
  await act(async () => root.render(createElement(SkimPanel, { access: { kind: "visitor", route: ROUTE }, view: v, away: false })));
}

const text = (sel: string) => host.querySelector(sel)?.textContent ?? null;

describe("the panel", () => {
  it("reveals an unchanged chosen depth when a refreshed route first offers the depth bar", async () => {
    const box = (left: number, width: number) =>
      ({ left, right: left + width, width, top: 0, bottom: 36, height: 36, x: left, y: 0 }) as DOMRect;
    const fieldsetRect = HTMLFieldSetElement.prototype.getBoundingClientRect;
    const buttonRect = HTMLButtonElement.prototype.getBoundingClientRect;
    HTMLFieldSetElement.prototype.getBoundingClientRect = () => box(0, 150);
    HTMLButtonElement.prototype.getBoundingClientRect = function () {
      if (!this.classList.contains("skim-depth")) return buttonRect.call(this);
      const parent = this.parentElement!;
      return box([...parent.children].indexOf(this) * 100 - parent.scrollLeft, 80);
    };
    try {
      await draw(owner(), view({ depth: 3, depths: [{ depth: 3, label: "Most", count: 4 }] }));
      expect(host.querySelector(".skim-depths")).toBeNull();
      await draw(owner(), view({ depth: 3 }));
      const group = host.querySelector<HTMLElement>(".skim-depths");
      expect(group).not.toBeNull();
      expect(group?.querySelector('[aria-pressed="true"]')?.textContent).toContain("Most");
      expect(group?.scrollLeft, "the unchanged chosen depth must be revealed when its bar arrives").toBe(130);
    } finally {
      HTMLFieldSetElement.prototype.getBoundingClientRect = fieldsetRect;
      HTMLButtonElement.prototype.getBoundingClientRect = buttonRect;
    }
  });

  it("pins the stepper and the depth control in the head, with counts", async () => {
    await draw(owner(), view());
    const head = host.querySelector(".band-head");
    expect(head?.textContent).toContain("Stop 2 of 3");
    expect(head?.querySelector(".skim-spark")?.getAttribute("aria-label")).toBe(
      "Stop 2 of 3 · position unavailable",
    );
    const depths = [...host.querySelectorAll<HTMLButtonElement>(".band-head .skim-depth")];
    expect(depths.map((b) => b.textContent)).toEqual(["Gist2", "More3", "Most4"]);
    expect(depths.map((b) => b.getAttribute("aria-pressed"))).toEqual(["false", "true", "false"]);
    /* The list is not in the head — the head is what stays put. */
    expect(head?.querySelector(".skim-list")).toBeNull();
  });

  it("draws only the depths that add stops, and no control when there is one", async () => {
    await draw(owner(), view({ depths: [{ depth: 1, label: "Gist", count: 2 }] }));
    expect(host.querySelector(".skim-depths")).toBeNull();
    expect(text(".band-head")).toContain("Stop 2 of 3");
  });

  it("shows the cue on the current row only, and the place on every row", async () => {
    await draw(owner(), view());
    const rows = [...host.querySelectorAll<HTMLElement>(".skim-row")];
    expect(rows.map((r) => r.querySelector(".skim-place")?.textContent)).toEqual([
      "Methods",
      "Results",
      "Methods",
    ]);
    expect(rows.map((r) => r.querySelector(".skim-cue")?.textContent ?? null)).toEqual([
      null,
      "The headline result",
      null,
    ]);
    expect(host.textContent).not.toContain("What earlier work missed");
  });

  it("puts the cue above the quote on the current row (Greg, SPIDERYARN-READING2-8J)", async () => {
    await draw(
      owner(),
      view({
        rows: [
          { quoteId: Q[0]!, n: 1, place: [{ title: "Results", voice: "ai" }], cue: "What does it do?", current: true, missing: false, position: null, words: "The passage.", where: [], passes: null, blockId: null },
        ],
      }),
    );
    const what = host.querySelector(".skim-row.current .skim-what");
    const order = [...(what?.children ?? [])]
      .map((el) => el.className)
      .filter((c) => c === "skim-place" || c === "skim-cue" || c === "skim-words");
    expect(order).toEqual(["skim-place", "skim-cue", "skim-words"]);
  });

  it("explains the current cue on its mouse card without nesting another control in the row button", async () => {
    const posed = view();
    await draw(owner(), {
      ...posed,
      rows: posed.rows.map((row) => row.current ? { ...row, words: "The current quote is already shown whole." } : row),
    });
    const cue = host.querySelector<HTMLElement>(".skim-row.current .skim-cue")!;
    expect(cue.closest("button")?.classList.contains("skim-go")).toBe(true);
    expect(cue.matches("button, [role='button'], [tabindex='0']")).toBe(false);

    vi.useFakeTimers();
    cue.dispatchEvent(new MouseEvent("mouseenter"));
    await act(async () => {
      vi.advanceTimersByTime(DELAY.open);
    });
    const card = document.querySelector<HTMLElement>('[role="tooltip"]');
    expect(document.querySelectorAll('[role="tooltip"]')).toHaveLength(1);
    expect(card?.textContent).toContain(SKIM_CUE_EXPLAINED);
    expect(cue.getAttribute("aria-describedby")).toBe(card?.id);
  });

  it("draws a repeated section path for a screen reader only — no ditto mark beside a quote (260928e)", async () => {
    const repeated = view({
      rows: [
        { quoteId: Q[2]!, n: 1, place: [{ title: "Methods", voice: "ai" }], cue: null, current: false, missing: false, position: null, words: "First.", where: [], passes: null, blockId: null },
        { quoteId: Q[3]!, n: 2, place: [{ title: "Methods", voice: "ai" }], cue: null, current: false, missing: false, position: null, words: "Second.", where: [], passes: null, blockId: null },
      ],
      position: 1,
    });
    await draw(owner(), repeated);

    const rows = [...host.querySelectorAll<HTMLElement>(".skim-row")];
    expect(rows[0]?.querySelector(".skim-place")?.textContent).toBe("Methods");
    expect(rows[1]?.querySelector(".skim-place")).toBeNull();
    expect(rows[1]?.querySelector(".sr-only")?.textContent).toBe("Methods");
    /* The report: a column of `〃` read as a column of quotation marks. */
    expect(host.textContent).not.toContain("〃");
  });

  it("draws each title on the path in its own voice, and the › between them in ours (fonts.md)", async () => {
    const mixed = view({
      rows: [
        {
          quoteId: Q[2]!,
          n: 1,
          place: [
            { title: "Results", voice: "author" },
            { title: "Why it holds", voice: "ai" },
          ],
          cue: null,
          current: false,
          missing: false,
          position: null,
          words: "First.",
          where: [],
          passes: null,
          blockId: null,
        },
        // The same text in other voices is still the same place: said, not drawn.
        { quoteId: Q[3]!, n: 2, place: [{ title: "Results", voice: "ai" }, { title: "Why it holds", voice: "ai" }], cue: null, current: false, missing: false, position: null, words: "Second.", where: [], passes: null, blockId: null },
      ],
      position: 1,
    });
    await draw(owner(), mixed);

    const rows = [...host.querySelectorAll<HTMLElement>(".skim-row")];
    const place = rows[0]?.querySelector(".skim-place");
    expect(place?.textContent).toBe("Results › Why it holds");
    expect([...(place?.children ?? [])].map((c) => [c.textContent, c.className])).toEqual([
      ["Results", "voice-author"],
      ["Why it holds", "voice-ai"],
    ]);
    expect(rows[1]?.querySelector(".sr-only")?.textContent).toBe("Results › Why it holds");
  });

  describe("the quote's words on each row (260928e)", () => {
    const LONG =
      "Across all five datasets the effect held within two per cent, even after the rich-club nodes were removed and the comparison was repeated from scratch.";
    const words = (r: Element | undefined) => r?.querySelector(".skim-words")?.textContent ?? null;
    const rowsOf = () => [...host.querySelectorAll<HTMLElement>(".skim-row")];
    const tips = () => document.querySelectorAll('[role="tooltip"], [role="dialog"]');
    /* A faked clock from the first hover to the end of the case (2026-10-04:
       these slept for real). Every later wait in such a case is an advance. */
    async function hover(el: Element) {
      vi.useFakeTimers();
      el.dispatchEvent(new MouseEvent("mouseenter"));
      await act(async () => {
        vi.advanceTimersByTime(DELAY.open);
      });
    }
    async function unhover(el: Element) {
      el.dispatchEvent(new MouseEvent("mouseleave"));
      el.dispatchEvent(new MouseEvent("mouseout", { bubbles: true, relatedTarget: document.body }));
      for (const _ of [0, 1]) {
        await act(async () => {
          vi.advanceTimersByTime(300);
        });
      }
    }
    const withWords = (w: [string | null, string | null, string | null]) =>
      view({ rows: view().rows.map((r, i) => ({ ...r, words: w[i]! })) });

    it("cuts a long quote short, in quotation marks, and shows the whole of it on hover", async () => {
      await draw(owner(), withWords([LONG, null, "Short and whole."]));
      const first = words(rowsOf()[0]);
      expect(first?.startsWith("“")).toBe(true);
      expect(first?.endsWith("…”")).toBe(true);
      expect(first!.length).toBeLessThan(LONG.length);
      expect(LONG.startsWith(first!.slice(1, -2))).toBe(true);

      const go = rowsOf()[0]!.querySelector(".skim-go")!;
      await hover(go);
      expect(tips()).toHaveLength(1);
      expect(tips()[0]?.textContent).toContain(LONG);
      await unhover(go);
      expect(tips()).toHaveLength(0);
    });

    it("shows a quote that fits whole, with no tooltip to repeat it", async () => {
      await draw(owner(), withWords([LONG, null, "Short and whole."]));
      expect(words(rowsOf()[2])).toBe("“Short and whole.”");
      await hover(rowsOf()[2]!.querySelector(".skim-go")!);
      expect(tips()).toHaveLength(0);
    });

    it("handles the 100-character boundary, whitespace, and an unbroken cut", async () => {
      const exact = "x".repeat(100);
      const over = "x".repeat(101);
      await draw(owner(), withWords([exact, " \n\t ", over]));

      expect(words(rowsOf()[0])).toBe(`“${exact}”`);
      expect(words(rowsOf()[1])).toBeNull();
      expect(words(rowsOf()[2])).toBe(`“${exact}…”`);
      await hover(rowsOf()[0]!.querySelector(".skim-go")!);
      expect(tips()).toHaveLength(0);
      await hover(rowsOf()[2]!.querySelector(".skim-go")!);
      expect(tips()[0]?.textContent).toContain(over);
    });

    it("shows the current stop's quote whole, with no tooltip — which is also what a tap reaches", async () => {
      await draw(owner(), withWords([null, LONG, null]));
      expect(words(rowsOf()[1])).toBe(`“${LONG}”`);
      await hover(rowsOf()[1]!.querySelector(".skim-go")!);
      expect(tips()).toHaveLength(0);
    });

    it("keeps the same button, and its focus, when a cut row becomes current", async () => {
      await draw(owner(), withWords([LONG, null, null]));
      const before = rowsOf()[0]!.querySelector<HTMLButtonElement>(".skim-go")!;
      before.focus();
      const moved = withWords([LONG, null, null]);
      await draw(owner(), { ...moved, rows: moved.rows.map((r, i) => ({ ...r, current: i === 0 })) });
      const after = rowsOf()[0]!.querySelector<HTMLButtonElement>(".skim-go")!;
      expect(after).toBe(before);
      expect(document.activeElement).toBe(after);
      expect(words(rowsOf()[0])).toBe(`“${LONG}”`);
      expect(tips()).toHaveLength(0);
    });

    it("does not pop a card back up when a row it was open on stops being current", async () => {
      const at = (i: number) => {
        const v = withWords([LONG, null, null]);
        return { ...v, rows: v.rows.map((r, j) => ({ ...r, current: j === i })) };
      };
      await draw(owner(), at(1));
      await hover(rowsOf()[0]!.querySelector(".skim-go")!);
      expect(tips()).toHaveLength(1);
      /* → onto it: current, whole, no card. Then → off it, pointer long gone. */
      await draw(owner(), at(0));
      await act(async () => {
        vi.advanceTimersByTime(200);
      });
      expect(tips()).toHaveLength(0);
      await draw(owner(), at(2));
      await act(async () => {
        vi.advanceTimersByTime(200);
      });
      expect(tips()).toHaveLength(0);
    });

    it("forgets an open card when its row leaves the route", async () => {
      const at = (i: number) => {
        const v = withWords([LONG, null, null]);
        return { ...v, rows: v.rows.map((r, j) => ({ ...r, current: j === i })) };
      };
      const full = at(1);
      await draw(owner(), full);
      await hover(rowsOf()[0]!.querySelector(".skim-go")!);
      expect(tips()).toHaveLength(1);

      /* A shallower pass can remove the row altogether, so its Tooltip cannot
         report that it closed. Restoring the deeper pass must not reuse that
         stale open state. */
      await draw(owner(), { ...full, rows: full.rows.slice(1) });
      expect(tips()).toHaveLength(0);
      await draw(owner(), full);
      expect(tips()).toHaveLength(0);
    });

    it("draws no words for a row whose quote has gone", async () => {
      await draw(owner(), withWords([null, null, null]));
      expect(rowsOf().map(words)).toEqual([null, null, null]);
    });

    /* spya-pqae7m (Greg, 2026-10-09): a quote from Attention Is All You Need
       showed its formula as raw TeX on the row. A quote is `block.text`, which
       holds the TeX source; the row draws the block's own markup instead, with
       the maths the prose drew (src/web/excerpt-html.ts, plan 261009k). */
    it("draws a quote's maths as maths and keeps its italics, as the prose does (spya-pqae7m)", async () => {
      const html =
        '<p data-spya-id="spya-tr2abc">We scale the dot products by \\(\\frac{1}{\\sqrt{d_k}}\\), as <em>Vaswani et al.</em> do.</p>';
      const source = { id: B[0]!, tag: "p", kind: "paragraph", text: "", words: 0, html, gistable: true } as unknown as Block;
      const prose = (
        await renderArticleMaths({ slug: "attention", title: "Attention", blocks: [source] } as unknown as Article, {
          load: async () => temmlRenderer(temml),
        })
      ).blocks;
      const quote = "We scale the dot products by \\(\\frac{1}{\\sqrt{d_k}}\\), as Vaswani et al. do.";
      const v = view({
        rows: view().rows.map((r, i) => ({ ...r, words: i === 1 ? quote : null, blockId: i === 1 ? B[0]! : null })),
      });
      calls.length = 0;
      await act(async () =>
        root.render(
          createElement(BlockLinkProvider, {
            index: buildBlockLinkIndex(prose, []),
            children: createElement(SkimPanel, { access: { kind: "owner", owner: owner() }, view: v, away: false }),
          }),
        ),
      );
      const shown = rowsOf()[1]!.querySelector(".skim-words")!;
      expect(shown.querySelector("math")).not.toBeNull();
      expect(shown.textContent).not.toContain("\\(");
      expect(shown.textContent).not.toContain("frac");
      expect(shown.querySelector("em")?.textContent).toBe("Vaswani et al.");
      expect(shown.querySelector("[data-spya-id], [id]")).toBeNull();
    });
  });

  it("dims no row: every row is a stop of this pass (260929e)", async () => {
    await draw(owner(), view());
    const rows = [...host.querySelectorAll<HTMLElement>(".skim-row")];
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.classList.contains("seen"))).toEqual([false, false, false]);
  });

  it("hands a row, the arrows and a depth to the view", async () => {
    await draw(owner(), view());
    await act(async () => host.querySelectorAll<HTMLButtonElement>(".skim-go")[2]!.click());
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Next stop"]')!.click());
    await act(async () => host.querySelectorAll<HTMLButtonElement>(".skim-depth")[2]!.click());
    /* The depth already drawn is not a change. */
    await act(async () => host.querySelectorAll<HTMLButtonElement>(".skim-depth")[1]!.click());
    expect(calls).toEqual([`row ${Q[3]}`, "step 1", "depth 3"]);
  });

  it("turns ‹ into Back to stop 1 on stop 1, and disables › at the end, because the route does not wrap", async () => {
    await draw(owner(), view({ position: 1 }));
    expect(host.querySelector('[aria-label="Previous stop"]')).toBeNull();
    expect(host.querySelector<HTMLButtonElement>('[aria-label="Back to stop 1"]')!.disabled).toBe(false);
    await draw(owner(), view({ position: 3 }));
    expect(host.querySelector<HTMLButtonElement>('[aria-label="Next stop"]')!.disabled).toBe(true);
  });

  /* The (i) is the band's, in its corner, since 2026-10-01 (spya-ucu35y, plan
     261001m); it was the head's own before that. */
  it("keeps the promise in the band's info tooltip, not the foot, and says how much of the Quotes Most walks (52)", async () => {
    const tip = () => document.querySelector('[role="tooltip"], [role="dialog"]')?.textContent ?? null;
    const info = () => host.querySelector<HTMLButtonElement>(".mode-band > .band-about")!;
    await draw(owner(), view());
    expect(host.querySelector(".skim-foot")?.textContent ?? "").not.toContain("Quotes");
    expect(info().hasAttribute("title"), "a tooltip, not a title").toBe(false);
    expect(tip()).toBeNull();
    /* A tap — a click, with no hover first — opens it: touch has no hover. */
    await act(async () => info().click());
    expect(tip()).toContain(skimPromise(false));
    expect(tip()).toContain(SKIM_CUE_EXPLAINED);
    expect(info().getAttribute("aria-expanded")).toBe("true");
    await act(async () => info().click());
    expect(info().getAttribute("aria-expanded"), "a second tap closes it").toBe("false");
    /* The keyboard reaches it too: focus opens it. */
    await act(async () => info().focus());
    expect(info().getAttribute("aria-expanded"), "focus opens it").toBe("true");
    await act(async () =>
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
    );
    expect(info().getAttribute("aria-expanded"), "Escape closes it").toBe("false");
    await act(async () => info().click());
    await act(async () => document.body.dispatchEvent(new Event("pointerdown", { bubbles: true })));
    expect(info().getAttribute("aria-expanded"), "a press elsewhere closes it").toBe("false");
    await act(async () => info().blur());

    const most = view({
      depth: 3,
      /* Most walks only its own stop (260929e), so the count must come from the
         whole route, not from the rows drawn. */
      rows: [{ quoteId: Q[1]!, n: 1, place: [{ title: "Results", voice: "ai" }], cue: null, current: true, missing: false, position: null, words: null, where: [], passes: null, blockId: null }],
    });
    /* The live Quotes list may include two abstract quotes; the route records
       the four it was actually offered, which is the honest denominator. */
    await draw(owner(), most);
    await act(async () => info().click());
    expect(tip()).toContain("Gist, More and Most together stop at every one of the 4 quotes offered to this route");
    await act(async () => info().click());
    await draw(owner({ skim: { ...ROUTE, offered: 6 } }), most);
    await act(async () => info().click());
    expect(tip()).toContain("4 of the 6 quotes offered to this route");
    await act(async () => info().click());
    expect(coverageNote(4, 0)).toBeNull();
  });

  it("puts the cue explanation in the visitor's band info card too", async () => {
    await drawVisitor(view());
    const info = host.querySelector<HTMLButtonElement>(".mode-band > .band-about")!;
    await act(async () => info.click());
    expect(document.querySelector('[role="tooltip"], [role="dialog"]')?.textContent).toContain(
      SKIM_CUE_EXPLAINED,
    );
  });

  it("does not blame the Quotes when the Ideas or outline may have made the route stale", async () => {
    await draw(owner({ stale: true, notOnRoute: 3 }), view());
    expect(text(".gloss-stale")).toContain("Quotes, Ideas, or outline");
    expect(text(".gloss-stale")).not.toContain("Quotes have changed");
  });

  it("draws the stop card under the current row only, and no card when there is nothing", async () => {
    await draw(owner(), view());
    expect(host.querySelector(".skim-card")).toBeNull();
    expect(host.textContent).not.toMatch(/glossary|generate/i);

    await draw(owner(), view({ card: CARD }));
    const cards = [...host.querySelectorAll(".skim-card")];
    expect(cards).toHaveLength(1);
    expect(cards[0]!.closest(".skim-row")?.classList.contains("current")).toBe(true);
    /* Outside the row's button: a button cannot hold other controls. */
    expect(cards[0]!.closest("button")).toBeNull();
    const chips = [...host.querySelectorAll<HTMLButtonElement>(".skim-chip")];
    expect(chips.map((c) => c.textContent)).toEqual([
      /* The name alone: no word about other stops since 2026-10-06 (Greg, spya-se0e4v). */
      "transfer entropy",
      "synergy",
      "Synergy is not redundancy",
    ]);
    expect(text(".skim-card")).toContain("Recordings made");
    expect(text(".skim-card")).not.toContain(TERM.senseHere!);
  });

  /* **A term chip opens the glossary's own card** — plan 261006e, Greg
     (spya-se0e4v): "they should provide/reuse the usual 'go to glossary' etc
     in rich tooltips". The card is portalled, so it is found on `document`. */
  const termCard = () => document.querySelector<HTMLElement>('[role="dialog"]');
  /* An icon-only button (plan 261010g) is named by its aria-label. */
  const buttonName = (b: HTMLButtonElement) => b.textContent?.trim() || b.getAttribute("aria-label");
  const cardButtons = () => [...(termCard()?.querySelectorAll("button") ?? [])].map(buttonName);
  const cardButton = (label: string) =>
    [...termCard()!.querySelectorAll<HTMLButtonElement>("button")].find((b) => buttonName(b) === label)!;
  const termChip = () => host.querySelector<HTMLButtonElement>(".skim-chip")!;

  it("opens a term chip to the glossary's own card on focus, with the owner's three actions (261006e)", async () => {
    await draw(owner(), view({ card: CARD, termActions: termActions(), onAskTerm: ask }));
    expect(termCard()).toBeNull();
    expect(termChip().getAttribute("aria-expanded")).toBe("false");
    await act(async () => termChip().focus());
    expect(termChip().getAttribute("aria-expanded")).toBe("true");
    expect(termCard()?.textContent).toContain(TERM.senseHere!);
    expect(cardButtons()).toEqual(["Ask about this term in chat", "Hide", "Open in Glossary"]);
    /* The sense is in the card and nowhere in the band: one surface, not two. */
    expect(host.querySelector(".skim-sense")).toBeNull();
    expect(host.querySelector('[aria-label="Open in Glossary"]')).toBeNull();
    await act(async () => cardButton("Open in Glossary").click());
    expect(calls).toEqual([`open term ${TERM.id}`]);
    expect(termChip().getAttribute("aria-expanded"), "leaving for Glossary closes it").toBe("false");
  });

  it("asks in chat from the card, with the Glossary band's sender, and closes the card (261009k)", async () => {
    await draw(owner(), view({ card: CARD, termActions: termActions(), onAskTerm: ask }));
    await act(async () => termChip().focus());
    expect(cardButtons(), "Dig deeper is gone").not.toContain("Dig deeper");
    await act(async () => cardButton("Ask about this term in chat").click());
    expect(calls).toEqual([`ask ${TERM.id}`]);
    expect(termChip().getAttribute("aria-expanded")).toBe("false");
  });

  it("opens a term's card on a tap and keeps it until a tap elsewhere", async () => {
    await draw(owner(), view({ card: CARD, termActions: termActions(), onAskTerm: ask }));
    /* The click-only activation also works without a preceding focus. The
       pointerdown/focus/click ordering is exercised separately below. */
    await act(async () => termChip().click());
    expect(termChip().getAttribute("aria-expanded")).toBe("true");
    expect(cardButtons()).toContain("Open in Glossary");
    await act(async () => termChip().click());
    expect(termChip().getAttribute("aria-expanded"), "a second tap closes it").toBe("false");
    await act(async () => termChip().click());
    await act(async () => document.body.dispatchEvent(new Event("pointerdown", { bubbles: true })));
    expect(termChip().getAttribute("aria-expanded"), "a press elsewhere closes it").toBe("false");
  });

  it("gives a visitor's card Open in Glossary and neither of the owner's verbs", async () => {
    calls.length = 0;
    await act(async () =>
      root.render(
        createElement(SkimPanel, {
          access: { kind: "visitor", route: ROUTE },
          view: view({ card: CARD, termActions: null }),
          away: false,
        }),
      ),
    );
    await act(async () => termChip().focus());
    expect(termCard()?.textContent).toContain(TERM.senseHere!);
    expect(cardButtons()).toEqual(["Open in Glossary"]);
  });

  it("does not pull focus back from another term when a slow Hide completes", async () => {
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => { finish = resolve; });
    function Hiding() {
      const [card, setCard] = useState(CARD);
      return createElement(SkimPanel, {
        access: { kind: "owner", owner: owner() },
        view: view({ card, termActions: termActions({ setHidden: async () => {
          await pending;
          setCard({ ...CARD, terms: CARD.terms.slice(1) });
        } }) }),
        away: false,
      });
    }
    await act(async () => root.render(createElement(Hiding)));
    await act(async () => termChip().focus());
    await act(async () => cardButton("Hide").focus());
    await act(async () => cardButton("Hide").click());
    const next = host.querySelectorAll<HTMLButtonElement>(".skim-chip")[1]!;
    await act(async () => next.focus());
    expect(document.activeElement).toBe(next);
    await act(async () => finish());
    expect(document.activeElement, "the reader already moved on").toBe(next);
    expect(next.getAttribute("aria-expanded")).toBe("true");
  });

  it.each(["touch", "pen"])("pins a %s tap even when focus opens the card before click, and a second tap closes it", async (pointerType) => {
    await draw(owner(), view({ card: CARD }));
    const touchDown = () => {
      const event = new Event("pointerdown", { bubbles: true });
      Object.defineProperty(event, "pointerType", { value: pointerType });
      termChip().dispatchEvent(event);
    };
    await act(async () => touchDown());
    await act(async () => termChip().focus());
    await act(async () => termChip().click());
    expect(termChip().getAttribute("aria-expanded")).toBe("true");
    await act(async () => touchDown());
    await act(async () => termChip().click());
    expect(termChip().getAttribute("aria-expanded"), "focus must not hold a dismissed tap open").toBe("false");
  });

  it("preserves unrelated keyboard focus when Hide is pressed from a hovered card", async () => {
    vi.useFakeTimers();
    await draw(owner(), view({ card: CARD, termActions: termActions(), onAskTerm: ask }));
    const input = document.createElement("input");
    host.append(input);
    await act(async () => input.focus());
    await act(async () => {
      termChip().dispatchEvent(new MouseEvent("mouseenter"));
      vi.advanceTimersByTime(500);
    });
    expect(cardButtons()).toContain("Hide");
    /* A mouse click need not change focus (e.g. Safari). */
    await act(async () => cardButton("Hide").click());
    expect(document.activeElement).toBe(input);
  });

  it("tabs into a term card, closes it with Escape, and reopens it with keyboard activation", async () => {
    vi.useFakeTimers();
    const settle = async () => {
      for (const _ of [0, 1, 2]) await act(async () => { vi.advanceTimersByTime(500); });
    };
    await draw(owner(), view({ card: CARD, termActions: termActions(), onAskTerm: ask }));
    await act(async () => termChip().focus());
    await settle();
    /* jsdom does not implement Tab's default action; use the same portal
       focus guard a browser's Tab reaches (tooltip-interactive.test.tsx). */
    const guard = host.querySelector<HTMLElement>('.skim-chip ~ [data-type="outside"]')!;
    expect(guard.getAttribute("data-type")).toBe("outside");
    await act(async () => guard.focus());
    await settle();
    expect(document.activeElement).toBe(cardButton("Ask about this term in chat"));
    const escape = () => act(async () => document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    /* One press, one surface: the Ask button's own tooltip goes first. */
    await escape();
    await settle();
    expect(termCard(), "the first Escape closes only the Ask tooltip").not.toBeNull();
    await escape();
    await settle();
    expect(termCard()).toBeNull();
    expect(document.activeElement).toBe(termChip());
    await act(async () => {
      termChip().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      termChip().click();
    });
    await settle();
    expect(termChip().getAttribute("aria-expanded")).toBe("true");
    expect(cardButtons()).toContain("Open in Glossary");
  });

  it("draws a card with no Open in Glossary when Glossary cannot be opened, and keeps Ask in chat and Hide", async () => {
    const closed = (target: CardTarget) => target.kind !== "term";
    await draw(owner(), view({ card: CARD, canOpen: closed, termActions: termActions(), onAskTerm: ask }));
    await act(async () => termChip().focus());
    expect(termCard()?.textContent).toContain(TERM.senseHere!);
    /* Dig deeper landed in Glossary, so it went with the way there, until
       2026-10-09. Ask in chat goes to Chat, and Hide stays put (plan 261009k). */
    expect(cardButtons()).toEqual(["Ask about this term in chat", "Hide"]);
  });

  it("keeps Hide and Ask in chat independent: either can be drawn without the other (261009k, Sol F1)", async () => {
    await draw(owner(), view({ card: CARD, termActions: termActions(), onAskTerm: null }));
    await act(async () => termChip().focus());
    expect(cardButtons()).toEqual(["Hide", "Open in Glossary"]);
    await act(async () => termChip().blur());
    await draw(owner(), view({ card: CARD, termActions: null, onAskTerm: ask }));
    await act(async () => termChip().focus());
    expect(cardButtons()).toEqual(["Ask about this term in chat", "Open in Glossary"]);
  });

  it("draws a visitor's card with no button at all when Glossary cannot be opened", async () => {
    await act(async () =>
      root.render(
        createElement(SkimPanel, {
          access: { kind: "visitor", route: ROUTE },
          view: view({ card: CARD, canOpen: (target) => target.kind !== "term", termActions: null }),
          away: false,
        }),
      ),
    );
    await act(async () => termChip().focus());
    expect(termCard()?.textContent).toContain(TERM.senseHere!);
    expect(cardButtons()).toEqual([]);
  });

  it("moves focus to the stop's row when Hide removes the last term (Sol, plan review F4)", async () => {
    const only: StopCard = { ...CARD, terms: [{ entry: TERM }] };
    function Hiding() {
      const [card, setCard] = useState(only);
      const actions = termActions({
        /* As `useGlossary` § `setHidden`: the list is re-read before it resolves. */
        setHidden: async () => {
          await act(async () => setCard({ ...only, terms: [] }));
        },
      });
      return createElement(SkimPanel, {
        access: { kind: "owner", owner: owner() },
        view: view({ card, termActions: actions }),
        away: false,
      });
    }
    await act(async () => root.render(createElement(Hiding)));
    await act(async () => termChip().focus());
    await act(async () => cardButton("Hide").click());
    expect(host.querySelectorAll(".skim-cluster[aria-label='Terms it uses'] .skim-chip")).toHaveLength(0);
    const row = host.querySelector<HTMLButtonElement>(".skim-row.current .skim-go")!;
    expect(document.activeElement, "not left on <body>").toBe(row);
  });

  it("opens an idea in place to its statement, one snippet at a time (59)", async () => {
    await draw(owner(), view({ card: CARD }));
    const chips = () => [...host.querySelectorAll<HTMLButtonElement>(".skim-chip")];
    await act(async () => chips()[0]!.click());
    expect(chips().map((c) => c.getAttribute("aria-expanded"))).toEqual(["true", "false", "false"]);
    await act(async () => chips()[2]!.click());
    /* The idea's opening closed the term's. */
    expect(chips().map((c) => c.getAttribute("aria-expanded"))).toEqual(["false", "false", "true"]);
    expect(text(".skim-card .skim-sense")).toContain("The pair carries information neither does alone.");
    /* Pressed again, it closes. */
    await act(async () => chips()[2]!.click());
    expect(chips().map((c) => c.getAttribute("aria-expanded"))).toEqual(["false", "false", "false"]);
    await act(async () => chips()[2]!.click());
    await act(async () => host.querySelector<HTMLButtonElement>('.skim-card [aria-label="Open in Ideas"]')!.click());
    const events = [...host.querySelectorAll<HTMLButtonElement>(".skim-card .skim-link")];
    await act(async () => events.find((b) => b.textContent?.includes("Recordings made"))!.click());
    expect(calls).toEqual(["open idea spya-id2abc", "open event spya-ev2abc"]);
  });

  it("closes an open snippet when stepping away, so stepping back does not resurrect it", async () => {
    const at = (i: number) => {
      const v = view({ card: CARD, position: i + 1 });
      return { ...v, rows: v.rows.map((row, j) => ({ ...row, current: i === j })) };
    };
    await draw(owner(), at(1));
    const chip = () => host.querySelector<HTMLButtonElement>(".skim-chip")!;
    await act(async () => chip().click());
    expect(chip().getAttribute("aria-expanded")).toBe("true");
    await draw(owner(), at(0));
    await draw(owner(), at(1));
    expect(chip().getAttribute("aria-expanded")).toBe("false");
  });

  it("gives each row's position mark a where-am-I card, as its own button beside the row (5C)", async () => {
    const where = [
      { kind: "node" as const, key: "a", title: "Methods", voice: "ai" as const, depth: 0, onPath: false, here: false },
      { kind: "node" as const, key: "b", title: "Results", voice: "ai" as const, depth: 0, onPath: true, here: true },
    ];
    const v = view();
    await draw(owner(), { ...v, rows: v.rows.map((r) => ({ ...r, position: 0.5, where })) });
    const marks = [...host.querySelectorAll<HTMLButtonElement>(".skim-where")];
    expect(marks).toHaveLength(3);
    expect(marks[0]!.closest(".skim-go")).toBeNull();
    expect(marks[0]!.getAttribute("aria-label")).toBe("Where stop 1 is in the article");
    await act(async () => marks[0]!.click());
    expect(calls, "the mark must not press the row").toEqual([]);
    const card = document.querySelector(".where-card");
    expect(card?.textContent).toBe("MethodsResults");
    expect(card?.querySelector(".where-node.here")?.textContent).toBe("Results");
    expect(card?.querySelector("[aria-current]"), "the card marks what it is about, not the reader (261003d F4)").toBeNull();
    const titles = [...(card?.querySelectorAll<HTMLElement>(".where-node") ?? [])];
    expect(
      titles.map((row) => [...row.classList].filter((name) => name.startsWith("voice-"))),
      "the title's face reached the app's ▸ marker",
    ).toEqual([[], []]);
    expect(
      titles.map((row) => [...(row.querySelector<HTMLElement>(".where-title")?.classList ?? [])].filter((name) => name.startsWith("voice-")).join()),
    ).toEqual(["voice-ai", "voice-ai"]);
  });

  it("forgets an open where-card when its row leaves the pass", async () => {
    const where = [{ kind: "node" as const, key: "a", title: "Methods", voice: "ai" as const, depth: 0, onPath: true, here: true }];
    const v = view();
    const full = { ...v, rows: v.rows.map((row) => ({ ...row, position: 0.5, where })) };
    await draw(owner(), full);
    await act(async () => host.querySelector<HTMLButtonElement>(".skim-where")!.click());
    expect(document.querySelector(".where-card")).not.toBeNull();
    await draw(owner(), { ...full, rows: full.rows.slice(1) });
    await draw(owner(), full);
    expect(host.querySelector<HTMLButtonElement>(".skim-where")!.getAttribute("aria-expanded")).toBe("false");
    expect(document.querySelector(".where-card")).toBeNull();
  });

  it("keeps an experimental event as scrapbook text when its mode control is hidden", async () => {
    await draw(
      owner(),
      view({
        card: CARD,
        canOpen: (target) => target.kind !== "event",
      }),
    );
    expect(text(".skim-card")).toContain("Recordings made");
    const links = [...host.querySelectorAll<HTMLButtonElement>(".skim-card .skim-link")];
    expect(links.some((button) => button.textContent?.includes("Recordings made"))).toBe(false);
  });

  /* Greg, 2026-09-29 (SPIDERYARN-READING2-53): *"In Trajectory mode, remove
     the "Plan it again" button. The user can do that from Metadata if they
     really want."* The out-of-date banner keeps its own — plan 260929b. */
  it("offers no standing Plan it again under a current route", async () => {
    await draw(owner(), view());
    const buttons = [...host.querySelectorAll<HTMLButtonElement>("button")].filter(
      (b) => b.textContent === "Plan it again",
    );
    expect(buttons).toEqual([]);
    expect(host.querySelector(".skim-again")).toBeNull();
  });

  it("keeps a current route's running job visible without restoring the standing button", async () => {
    /* An empty published route has no ordinary footer notes, so this also pins
       the status independently of the route having stops. */
    await draw(owner({ job: RUNNING_SKIM_JOB }), view({ rows: [], depth: null }));
    const footer = host.querySelector<HTMLElement>(".skim-again");
    expect(footer, "the running job disappeared with the standing redo button").toBeTruthy();
    expect(footer?.textContent).toContain("Stop");
    expect(footer?.textContent).not.toContain("Plan it again");
  });

  /* An older prompt is not announced — Greg, 2026-09-29
     (SPIDERYARN-READING2-55): *"perhaps even don't bother showing it."* Only
     the stale and profile-changed banners are left, and a job on an outdated
     route shows in the foot. plan 260929c. */
  it("says nothing about an outdated route, but still about a stale or re-profiled one", async () => {
    await draw(owner({ outdated: true }), view());
    expect(host.querySelector(".gloss-stale")).toBeNull();
    expect(host.textContent).not.toContain("older version of the prompt");
    await draw(owner({ outdated: true, profileChanged: true }), view());
    expect(text(".gloss-stale")).toContain("before your profile said what it says now");
    /* Beside the ×, plan 261009i. */
    expect(
      [...host.querySelectorAll(".gloss-stale button:not(.notice-close)")].map((b) => b.textContent),
    ).toEqual(["Plan it again"]);
  });

  /* Greg, 2026-10-09 (spya-ud2w92): the profile notice can be sent away;
     plan 261009i. */
  describe("the profile notice's ×", () => {
    it("is on the profile notice, and pressing it asks the owner to dismiss", async () => {
      let dismissed = 0;
      await draw(owner({ profileChanged: true, dismissProfileNotice: async () => void dismissed++ }), view());
      const close = host.querySelector<HTMLButtonElement>(".gloss-stale .notice-close");
      expect(close, "no × on the profile notice").toBeTruthy();
      expect(close?.getAttribute("aria-label")).toContain("Dismiss");
      await act(async () => close?.click());
      expect(dismissed).toBe(1);
    });

    it("hides the banner once dismissed, and a job then shows in the foot", async () => {
      await draw(owner({ profileChanged: true, profileNoticeDismissed: true }), view());
      expect(host.querySelector(".gloss-stale")).toBeNull();
      await draw(owner({ profileChanged: true, profileNoticeDismissed: true, job: RUNNING_SKIM_JOB }), view());
      expect(host.querySelector(".skim-again")?.textContent, "a job after a dismissal shows nowhere").toContain("Stop");
    });

    /* Plan 261010a: the stale banner has an × of its own now, which is the
       stale notice's, stored against the route's clock — not this one. */
    it("does not hide the stale banner, whose × is its own", async () => {
      const { forgetStaleNotices } = await import("../src/web/useStaleNotices.js");
      forgetStaleNotices();
      let dismissed = 0;
      await draw(
        owner({
          stale: true,
          profileChanged: true,
          profileNoticeDismissed: true,
          dismissProfileNotice: async () => void dismissed++,
        }),
        view(),
      );
      expect(text(".gloss-stale")).toContain("have changed since this route was planned");
      expect(host.querySelector('[data-stale-notice="skim"] .notice-close')).toBeTruthy();
      await act(async () => host.querySelector<HTMLButtonElement>(".gloss-stale .notice-close")?.click());
      expect(dismissed, "the stale × dismissed the profile notice").toBe(0);
      expect(host.querySelector(".gloss-stale"), "the stale banner stayed").toBeNull();
      forgetStaleNotices();
    });

    it("shows the profile notice once the stale one is dismissed, if it is not dismissed too", async () => {
      const { forgetStaleNotices } = await import("../src/web/useStaleNotices.js");
      forgetStaleNotices();
      await draw(owner({ stale: true, profileChanged: true }), view());
      expect(text(".gloss-stale")).toContain("have changed since this route was planned");
      await act(async () => host.querySelector<HTMLButtonElement>(".gloss-stale .notice-close")?.click());
      expect(text(".gloss-stale")).toContain("before your profile said what it says now");
      forgetStaleNotices();
    });

    it("says why when a dismissal did not stick", async () => {
      await draw(owner({ profileChanged: true, dismissFailed: "The server could not be reached." }), view());
      expect(text(".notice-failed")).toContain("The server could not be reached.");
    });

    /* Plan 261010a, GPT Sol's finding 3: a stale route's banner can be sent
       away, so a stop whose quote has gone says so itself, in its words and
       in its accessible name. */
    it("says on a stop whose quote has gone that it is no longer in the Quotes", async () => {
      const v = view();
      await draw(owner(), view({ rows: v.rows.map((r, i) => (i === 0 ? { ...r, missing: true } : r)) }));
      const go = host.querySelector<HTMLButtonElement>(".skim-row .skim-go");
      expect(go?.disabled).toBe(true);
      expect(go?.textContent).toContain("This quote is no longer in the Quotes");
      const others = [...host.querySelectorAll<HTMLElement>(".skim-row .skim-go")].slice(1);
      for (const b of others) expect(b.textContent).not.toContain("no longer in the Quotes");
    });
  });

  it("shows a running job in the foot on an outdated route", async () => {
    await draw(owner({ outdated: true, job: RUNNING_SKIM_JOB }), view());
    const footer = host.querySelector<HTMLElement>(".skim-again");
    expect(footer, "a run on an outdated route shows nowhere").toBeTruthy();
    expect(footer?.textContent).toContain("Stop");
  });

  it("offers it once, in the stale banner, rebuilding the route only (5e)", async () => {
    let regenerated = 0;
    let ensured = 0;
    const o = owner({
      stale: true,
      regenerate: async () => void regenerated++,
      ensure: async () => void ensured++,
    });
    await draw(o, view());
    const again = [...host.querySelectorAll<HTMLButtonElement>(".gloss-stale button:not(.notice-close)")];
    expect(again.map((b) => b.textContent)).toEqual(["Plan it again"]);
    await act(async () => again[0]!.click());
    expect([regenerated, ensured]).toEqual([1, 0]);
  });

  it("marks where each stop sits in the article, the current one in the accent (5b)", async () => {
    const v = view();
    const positions = [0.8, 0.1, 0.55];
    await draw(owner(), view({ rows: v.rows.map((r, i) => ({ ...r, position: positions[i]! })) }));
    const rows = [...host.querySelectorAll<HTMLElement>(".skim-row")];
    const dots = rows.map((r) => r.querySelector<HTMLElement>(".skim-pos-dot"));
    expect(dots.map((d) => d?.style.top)).toEqual(["80%", "10%", "55%"]);
    /* Inside the number's column, so it takes no width of its own (plan 260929a § 4). */
    expect(rows[0]!.querySelector(".skim-n .skim-pos")).not.toBeNull();
    expect(dots.map((d) => d?.classList.contains("on"))).toEqual([false, true, false]);
    /* Drawn for the eye; said in words for a screen reader. */
    expect(rows[0]!.querySelector(".skim-pos")?.getAttribute("aria-hidden")).toBe("true");
    expect(rows[0]!.querySelector(".skim-pos-said")?.textContent).toBe("about 80% of the way through");
    expect(rows[1]!.querySelector(".skim-pos-said")?.classList.contains("sr-only")).toBe(true);
  });

  it("draws no track for a stop it cannot place", async () => {
    await draw(owner(), view());
    expect(host.querySelector(".skim-pos")).toBeNull();
    expect(host.querySelector(".skim-pos-said")).toBeNull();
  });

  describe("the pips: which passes a stop is in (261003l, spya-ms9d69)", () => {
    const pass = (on: boolean[]) =>
      (["Gist", "More", "Most"] as const).map((label, i) => ({ depth: (i + 1) as 1 | 2 | 3, label, on: on[i]! }));
    /* Drawn at More (`view()`'s depth 2): a Gist stop carried in, More's own,
       and a More stop carried on into Most. */
    const piped = () => {
      const v = view();
      const on = [[true, true, false], [false, true, false], [false, true, true]];
      return view({ rows: v.rows.map((r, i) => ({ ...r, position: 0.5, passes: pass(on[i]!) })) });
    };
    const tip = () => document.querySelector('[role="tooltip"], [role="dialog"]')?.textContent ?? null;
    const info = () => host.querySelector<HTMLButtonElement>(".mode-band > .band-about")!;

    it("draws one pip per offered depth on every row, filled for the passes the stop is walked in", async () => {
      await draw(owner(), piped());
      const rows = [...host.querySelectorAll<HTMLElement>(".skim-row")];
      const pips = rows.map((r) => [...r.querySelectorAll(".skim-pip")].map((p) => p.classList.contains("on")));
      expect(pips).toEqual([[true, true, false], [false, true, false], [false, true, true]]);
      /* Inside the row's own button, in the number's column, above the position line. */
      const run = rows[0]!.querySelector(".skim-go .skim-n .skim-pips")!;
      expect(run.getAttribute("aria-hidden")).toBe("true");
      expect(run.textContent, "no printed label").toBe("");
      expect(run.compareDocumentPosition(rows[0]!.querySelector(".skim-pos")!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      /* Not a control: nothing to focus, nothing that could press or collide. */
      expect(host.querySelector(".skim-pips button, .skim-pips [tabindex], .skim-pips [role]")).toBeNull();
      expect(rows.map((r) => r.querySelector(".skim-line")!.classList.contains("piped"))).toEqual([true, true, true]);
    });

    it("says the other passes in the row's name, for a stop in more than one, and prints nothing", async () => {
      await draw(owner(), piped());
      const said = [...host.querySelectorAll<HTMLElement>(".skim-row")].map(
        (r) => r.querySelector(".skim-go .skim-pips-said")?.textContent ?? null,
      );
      expect(said).toEqual(["Also in Gist", null, "Also in Most"]);
      expect(host.querySelector(".skim-pips-said")!.classList.contains("sr-only")).toBe(true);
      const v = piped();
      await draw(owner(), { ...v, depth: 1, rows: [{ ...v.rows[0]!, passes: pass([true, true, true]) }] });
      expect(host.querySelector(".skim-pips-said")?.textContent).toBe("Also in More and Most");
    });

    it("draws none on a route that carries no stop — every old route", async () => {
      await draw(owner(), view());
      expect(host.querySelector(".skim-pips")).toBeNull();
      expect(host.querySelector(".skim-pips-said")).toBeNull();
      expect(host.querySelector(".skim-line.piped")).toBeNull();
    });

    it("explains them in the band's (i) only when they are drawn", async () => {
      await draw(owner(), piped());
      await act(async () => info().click());
      expect(tip()).toContain("The dots under a stop's number show which passes it is in — Gist, More, Most.");
      expect(tip()).toContain("more than one filled");
      await act(async () => info().click());
      await draw(owner(), view());
      await act(async () => info().click());
      expect(tip()).toContain(skimPromise(false));
      expect(tip()).not.toContain("The dots");
      await act(async () => info().click());
    });
  });

  it("says when the Quotes will be chosen first", async () => {
    const empty = view({ rows: [], position: 0, depth: null });
    await draw(owner({ status: "none", skim: null, quotesFirst: true }), empty);
    expect(text(".gloss-hint")).toContain("Quotes are chosen first");
    await draw(owner({ status: "none", skim: null }), empty);
    expect(text(".gloss-hint")).not.toContain("chosen first");
  });

  it("says before the press that the Ideas are found first, and that they are the long part (Sol F64)", async () => {
    const empty = view({ rows: [], position: 0, depth: null });
    await draw(owner({ status: "none", skim: null, quotesFirst: true, ideasFirst: true }), empty);
    expect(text(".gloss-hint")).toContain("Quotes are chosen and its key Ideas found");
    expect(text(".gloss-hint")).toContain("finding the Ideas is the long part");
    await draw(owner({ status: "none", skim: null, ideasFirst: true }), empty);
    expect(text(".gloss-hint")).toContain("key Ideas are found — the long part");
    expect(text(".gloss-hint")).not.toContain("Quotes are chosen");
    await draw(owner({ status: "none", skim: null }), empty);
    expect(text(".gloss-hint")).not.toContain("Ideas");
    expect(text(".gloss-hint")).toContain("a few seconds");
  });

  it("offers to plan a route when there is none", async () => {
    await draw(owner({ status: "none", skim: null }), view({ rows: [], position: 0, depth: null }));
    expect(host.querySelector(".band-head")).toBeNull();
    expect(text(".gloss-empty")).toContain("Nobody has planned a route through this one yet.");
  });
});

describe("the door in the prose", () => {
  const door = (props: Partial<Parameters<typeof SkimDoor>[0]>) =>
    createElement(SkimDoor, {
      door: null,
      onNext: () => {},
      onDeeper: () => {},
      onRoute: null,
      ...props,
    });

  it("offers the next stop mid-pass, and the band back only when asked to", async () => {
    let next = 0;
    let back = 0;
    await act(async () => root.render(door({ door: { kind: "next", cue: null }, onNext: () => void next++ })));
    expect([...host.querySelectorAll("button")].map((b) => b.textContent)).toEqual(["Next stop ›"]);
    await act(async () =>
      root.render(door({ door: { kind: "next", cue: null }, onNext: () => void next++, onRoute: () => void back++ })),
    );
    const buttons = [...host.querySelectorAll<HTMLButtonElement>("button")];
    expect(buttons.map((b) => b.textContent)).toEqual(["All stops", "Next stop ›"]);
    await act(async () => buttons[1]!.click());
    await act(async () => buttons[0]!.click());
    expect([next, back]).toEqual([1, 1]);
  });

  it("offers one door at the end of a pass: more detail, and no going round again (51)", async () => {
    let deeper = 0;
    await act(async () =>
      root.render(
        door({
          door: { kind: "end", pass: "Gist", count: 5, deeper: "More" },
          onDeeper: () => void deeper++,
        }),
      ),
    );
    const buttons = [...host.querySelectorAll<HTMLButtonElement>("button")];
    expect(buttons.map((b) => b.textContent)).toEqual(["More detail ›"]);
    expect(text(".skim-door-cue")).toBe("End of Gist — 5 stops.");
    await act(async () => buttons[0]!.click());
    expect(deeper).toBe(1);
  });

  it("offers no button at the end of the deepest pass, only the line saying which pass ended (51)", async () => {
    await act(async () => root.render(door({ door: { kind: "end", pass: "Most", count: 1, deeper: null } })));
    expect(host.querySelectorAll("button")).toHaveLength(0);
    expect(text(".skim-door-cue")).toBe("End of Most — 1 stop.");
  });

  it("says under the next-stop door where it leads — the next stop's cue, small and muted", async () => {
    await act(async () => root.render(door({ door: { kind: "next", cue: "Look for the headline comparison." } })));
    expect(text(".skim-door-cue")).toBe("Look for the headline comparison.");
    await act(async () => root.render(door({ door: { kind: "next", cue: null } })));
    expect(host.querySelector(".skim-door-cue")).toBeNull();
  });

  it("draws nothing with no door and no band to bring back", async () => {
    await act(async () => root.render(door({})));
    expect(host.innerHTML).toBe("");
  });
});

/* **A shortcut is named on its control's card** — Greg, 2026-09-30
   (SPIDERYARN-READING2-74): *"Add tooltips for the previous and next buttons in
   the trajectory mode … especially showing the keyboard shortcuts."* The rule is
   docs/project/tooltips.md § A shortcut is named on its card. */
describe("the step controls name their keys", () => {
  const tip = () => document.querySelector('[role="tooltip"], [role="dialog"]')?.textContent ?? null;
  async function hover(el: Element) {
    vi.useFakeTimers();
    el.dispatchEvent(new MouseEvent("mouseenter"));
    await act(async () => {
      vi.advanceTimersByTime(DELAY.open);
    });
  }

  it.each([
    [2, "Previous stop", "←", "Back one stop along the route."],
    [1, "Back to stop 1", "←", "Back to the first stop."],
    [2, "Next stop", "→", "On to the next stop along the route."],
  ])("on stop %i, %s's card names %s, and it has no title", async (position, label, key, truth) => {
    await draw(owner(), view({ position }));
    const button = host.querySelector<HTMLButtonElement>(`.skim-head [aria-label="${label}"]`)!;
    expect(button.hasAttribute("title"), "a card, not a title").toBe(false);
    await hover(button);
    expect(document.querySelectorAll('[role="tooltip"], [role="dialog"]'), "one card, not a stale one beside it").toHaveLength(1);
    expect(tip()).toContain(label);
    expect(tip()).toContain(`While reading, press ${key}`);
    expect(tip()).toContain(truth);
  });

  it("opens on keyboard focus too, and follows ‹'s label from stop 2 to stop 1", async () => {
    vi.useFakeTimers();
    await draw(owner(), view({ position: 2 }));
    const back = () => host.querySelector<HTMLButtonElement>(".skim-head .skim-arrow")!;
    await act(async () => back().focus());
    await act(async () => {
      vi.advanceTimersByTime(DELAY.open);
    });
    expect(tip()).toContain("Previous stop");
    await draw(owner(), view({ position: 1 }));
    expect(document.activeElement, "the step kept focus on ‹").toBe(back());
    expect(document.querySelectorAll('[role="tooltip"], [role="dialog"]')).toHaveLength(1);
    expect(tip()).toContain("Back to stop 1");
    expect(tip()).not.toContain("Previous stop");
  });

  it("closes Next's card when stepping makes the button disabled", async () => {
    vi.useFakeTimers();
    await draw(owner(), view({ position: 2 }));
    const next = () => host.querySelector<HTMLButtonElement>('.skim-head [aria-label="Next stop"]')!;
    await act(async () => next().focus());
    await act(async () => {
      vi.advanceTimersByTime(DELAY.open);
    });
    expect(tip()).toContain("Next stop");

    await draw(owner(), view({ position: 3 }));
    expect(next().disabled).toBe(true);
    await act(async () => {
      vi.advanceTimersByTime(100);
    });
    expect(document.querySelectorAll('[role="tooltip"], [role="dialog"]')).toHaveLength(0);
  });

  it("the door's Next stop names → too", async () => {
    await act(async () =>
      root.render(createElement(SkimDoor, { door: { kind: "next", cue: null }, onNext: () => {}, onDeeper: () => {}, onRoute: null })),
    );
    await hover(host.querySelector("button")!);
    expect(tip()).toContain("While reading, press →");
    expect(tip()).toContain("On to the next stop along the route.");
  });

  /* 73 kept the head's own (i) in one group with the depth buttons. Since
     2026-10-01 the (i) is the band's, so the head has none, and the depths
     are the group's only content. */
  it("leaves the head without an info button of its own", async () => {
    await draw(owner(), view());
    expect(host.querySelector(".skim-head .band-about, .skim-head [aria-label=\"About this route\"]")).toBeNull();
    expect(host.querySelector(".skim-depths")!.parentElement!.classList.contains("skim-head-end")).toBe(true);
  });
});

/* ================================================================ the band == */

const QUOTES_READ: QuotesRead = {
  status: "ready",
  quotes: QUOTES,
  stale: false,
  outdated: false,
  profiled: false,
  profileChanged: false,
  fresh: { begin: () => 0, landed: () => {}, begun: () => 0, latest: null },
  error: null,
  retryRead: async () => {},
  reload: async () => {},
  refresh: async () => {},
};
/** The Quotes read the band is handed; a test may pose it stale. */
let quotesRead: QuotesRead = QUOTES_READ;

/** The prose's quote marks, as `useQuoteMarks` would have built them. */
const MARKS: Found[] = resolveQuotes(
  BLOCKS,
  QUOTE_LIST.map((q) => ({ ...q, stroke: quoteStroke(q) })),
);

let published: Found[] = [];
let control: SkimControl | null = null;
let away = 0;

function Harness({ covers = false, stepped = false, arrival }: { covers?: boolean; stepped?: boolean; arrival?: SkimArrival }) {
  const ownArrival = useRef<SkimArrival>({
    stop: new URLSearchParams(location.search).get("stop"),
    open: false,
  });
  const [found, setFound] = useState<Found[]>([]);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const onFound = useCallback((f: Found[]) => {
    published = f;
    setFound(f);
  }, []);
  const onControl = useCallback((c: SkimControl | null) => {
    control = c;
  }, []);
  return createElement(
    NuqsAdapter,
    null,
    createElement("div", { id: "state", "data-found": String(found.length), "data-open": openKey ?? "" }),
    createElement(SkimBand, {
      slug: "a-route",
      blocks: BLOCKS,
      tree: TREE,
      quotes: quotesRead,
      quoteMarks: MARKS,
      covers,
      away: stepped,
      onAway: () => void away++,
      onJump: (id: BlockId, passage?: string) => {
        scrolled.push(`jump ${id}`);
        jumpPassages.push(passage ?? null);
      },
      onFound,
      openKey,
      onOpenKey: setOpenKey,
      onControl,
      glossary: glossaryRead,
      onAskTerm: () => {},
      onOpen: (target: CardTarget) => void opened.push(`${target.kind}${"id" in target ? ` ${target.id}` : ""}`),
      canOpen: () => true,
      arrival: arrival ?? ownArrival.current,
    }),
  );
}

/**
 * The glossary as `Reader` holds it — `useGlossaryRead`, posed. "cohort" is in
 * block 0 only as its plural; "laboratory" is in block 2. Neither entry lists a
 * block: the card scans the prose, not the stored lists (F23).
 */
const GLOSSARY_READ: GlossaryRead = {
  status: "ready",
  glossary: {
    version: "g",
    generator: "g",
    slug: "a-route",
    sourceHash: "h",
    entries: [
      { id: "spya-gc2abc", name: "cohort", kind: "concept", aliases: [], blocks: [], senseHere: "A group followed over time." },
      { id: "spya-gc3def", name: "laboratory", kind: "concept", aliases: ["lab"], blocks: [] },
    ],
  } as unknown as GlossaryRead["glossary"],
  stale: false,
  outdated: false,
  profiled: false,
  profileChanged: false,
  fresh: { begin: () => 0, landed: () => {}, begun: () => 0, latest: null },
  error: null,
  retryRead: async () => {},
  reload: async () => {},
  refresh: async () => {},
  patchEntry: () => {},
  look: async () => false,
  looking: null,
  lookFailed: null,
  lookDraft: null,
  lookKept: null,
  setHidden: async () => {},
  hiding: new Set<string>(),
};
let glossaryRead: GlossaryRead = GLOSSARY_READ;
const opened: string[] = [];

const IDEAS_BODY = {
  ideas: {
    version: "ideas/t",
    generator: "t",
    slug: "a-route",
    sourceHash: "h",
    profileHash: null,
    ideas: [
      {
        id: "spya-id4ghj",
        name: "Fieldwork is the test",
        provenance: "assumed",
        statement: "S.",
        occurrences: [{ blockId: B[2]!, quote: "never left the laboratory", reasoning: "r" }],
      },
    ],
    generatedAt: "",
    elapsedMs: 0,
  },
  stale: false,
  outdated: true,
  profileChanged: false,
};

async function settled(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 120));
  });
}

async function mount(covers = false) {
  published = [];
  control = null;
  away = 0;
  await act(async () => root.render(createElement(Harness, { covers })));
  await settled();
}

const param = (key: string) => new URLSearchParams(location.search).get(key);
const current = () => host.querySelector(".skim-row.current")?.getAttribute("data-stop") ?? null;

describe("the band, walked", () => {
  it("starts on the first stop of Gist, and publishes the quote's own mark, rung", async () => {
    await mount();
    expect(text(".band-head")).toContain("Stop 1 of 2");
    expect(current()).toBe(Q[2]);
    /* **The same object**, not a copy — which is what lets `proseFound` draw it
       once rather than twice (reader/passages.ts). */
    expect(published).toHaveLength(1);
    expect(published[0]).toBe(MARKS.find((m) => m.blockId === B[2]));
    expect(host.querySelector("#state")?.getAttribute("data-open")).toBe(published[0]!.key);
    expect(control?.blockId).toBe(B[2]);
    expect(control?.door).toEqual({ kind: "next", cue: "Look for the headline comparison." });
  });

  it("steps by replacing the entry, and scrolls the stop to the top", async () => {
    await mount();
    const before = history.length;
    await act(async () => {
      expect(control!.step(1)).toBe(true);
    });
    await settled();
    expect(param("stop")).toBe(Q[0]);
    expect(history.length, "a step must not push").toBe(before);
    expect(scrolled).toEqual([B[0]]);
    /* The end of Gist: no wrap, and the key goes back to the browser. */
    let took = true;
    await act(async () => {
      took = control!.step(1);
    });
    expect(took).toBe(false);
    expect(control?.door).toEqual({ kind: "end", pass: "Gist", count: 2, deeper: "More" });
  });

  it("More detail goes to stop 1 of the deeper pass: one pushed entry, depth and stop together (4N)", async () => {
    await mount();
    await act(async () => void control!.step(1));
    await settled();
    const before = history.length;
    scrolled.length = 0;
    await act(async () => control!.deeper());
    await settled();
    expect(history.length, "one entry for the depth and the stop").toBe(before + 1);
    /* More's own stop 1 — not Gist's first stop again (260929e, 4P). */
    expect([param("depth"), param("stop")]).toEqual(["2", Q[3]]);
    expect(scrolled).toEqual([B[3]]);
    expect(text(".band-head")).toContain("Stop 1 of 1");
  });

  it("offers nothing past the end of the deepest pass", async () => {
    history.replaceState(null, "", `/read/a-route?mode=skim&depth=3&stop=${Q[1]}`);
    await mount();
    expect(control?.door).toEqual({ kind: "end", pass: "Most", count: 1, deeper: null });
    await act(async () => control!.deeper());
    await settled();
    expect(param("stop"), "no deeper pass: nothing moves").toBe(Q[1]);
  });

  it("a depth button lands on stop 1 of the new pass, as the door does (260929e)", async () => {
    history.replaceState(null, "", `/read/a-route?mode=skim&depth=1&stop=${Q[0]}`);
    await mount();
    scrolled.length = 0;
    const before = history.length;
    await act(async () => host.querySelectorAll<HTMLButtonElement>(".skim-depth")[1]!.click());
    await settled();
    expect(history.length, "one entry for the depth and the stop").toBe(before + 1);
    expect([param("depth"), param("stop")]).toEqual(["2", Q[3]]);
    expect(scrolled).toEqual([B[3]]);
  });

  it("Back and Forward across a depth change restore one matching URL, pass and passage", async () => {
    await mount();
    await act(async () => void control!.step(1));
    await settled();
    await act(async () => host.querySelectorAll<HTMLButtonElement>(".skim-depth")[1]!.click());
    await settled();
    expect([param("depth"), param("stop"), current(), control?.blockId]).toEqual([
      "2",
      Q[3],
      Q[3],
      B[3],
    ]);

    const traverse = async (go: () => void) => {
      await act(async () => {
        const popped = new Promise<void>((resolve) =>
          window.addEventListener("popstate", () => resolve(), { once: true }),
        );
        go();
        await popped;
      });
      await settled();
    };

    await traverse(() => history.back());
    expect([param("depth"), param("stop"), current(), control?.blockId, published[0]?.blockId]).toEqual([
      null,
      Q[0],
      Q[0],
      B[0],
      B[0],
    ]);

    await traverse(() => history.forward());
    expect([param("depth"), param("stop"), current(), control?.blockId, published[0]?.blockId]).toEqual([
      "2",
      Q[3],
      Q[3],
      B[3],
      B[3],
    ]);
  });

  it("← on stop 1 goes to stop 1's passage again, and so does ‹ (4K)", async () => {
    await mount();
    scrolled.length = 0;
    let took = false;
    await act(async () => {
      took = control!.step(-1);
    });
    await settled();
    expect(took, "the key is taken, not handed back").toBe(true);
    expect(scrolled).toEqual([B[2]]);
    expect(flashed).toEqual([B[2]]);
    const back = host.querySelector<HTMLButtonElement>('[aria-label="Back to stop 1"]')!;
    expect(back.disabled).toBe(false);
    await act(async () => back.click());
    await settled();
    expect(scrolled).toEqual([B[2], B[2]]);
  });

  it("centres every movement along the route (4M)", async () => {
    await mount();
    aligns.length = 0;
    await act(async () => void control!.step(1));
    await settled();
    await act(async () => void control!.step(-1));
    await settled();
    expect(aligns).toEqual(["centre", "centre"]);
  });

  it("scrolls its own list, and only its list, to keep the current row in view (54)", async () => {
    /* jsdom has no layout, so the geometry is posed: the list's scroller is
       0–200px, and the current row is wherever `rowAt` says. Reduced motion,
       so the move is instant rather than a frame-by-frame slide. */
    let rowAt = { top: 10, bottom: 50 };
    const rect = (top: number, bottom: number) =>
      ({ top, bottom, left: 0, right: 300, width: 300, height: bottom - top, x: 0, y: top }) as DOMRect;
    const rects = vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
      if (this.classList.contains("tl-scroll")) return rect(0, 200);
      if (this.classList.contains("skim-row") && this.classList.contains("current")) return rect(rowAt.top, rowAt.bottom);
      return rect(0, 0);
    });
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("reduce") }) as MediaQueryList);
    const windowScroll = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    const hadIntoView = "scrollIntoView" in Element.prototype;
    if (!hadIntoView) Element.prototype.scrollIntoView = () => {};
    const intoView = vi.spyOn(Element.prototype, "scrollIntoView");
    try {
      await mount();
      const list = host.querySelector<HTMLElement>(".tl-scroll")!;
      expect(list.scrollTop, "stop 1 is in view: nothing moves").toBe(0);

      /* The next stop is below the list's visible box. */
      rowAt = { top: 500, bottom: 540 };
      await act(async () => void control!.step(1));
      await settled();
      const down = list.scrollTop;
      expect(down, "scrolled down towards the row").toBeGreaterThan(0);

      /* And back: the row now above the visible box. */
      rowAt = { top: -300, bottom: -260 };
      await act(async () => void control!.step(-1));
      await settled();
      expect(list.scrollTop, "scrolled up towards the row").toBeLessThan(down);

      expect(windowScroll, "never the page").not.toHaveBeenCalled();
      expect(intoView, "not scrollIntoView, which scrolls every ancestor").not.toHaveBeenCalled();
    } finally {
      rects.mockRestore();
      vi.unstubAllGlobals();
      windowScroll.mockRestore();
      intoView.mockRestore();
      if (!hadIntoView) delete (Element.prototype as Partial<Element>).scrollIntoView;
    }
  });

  it("measures the list again when a band that stepped aside comes back (54, Sol F1)", async () => {
    /* Stepped aside, the band is `display: none`: every rect is zero. */
    let hidden = true;
    const rect = (top: number, bottom: number) =>
      ({ top, bottom, left: 0, right: 300, width: 300, height: bottom - top, x: 0, y: top }) as DOMRect;
    const rects = vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
      if (hidden) return rect(0, 0);
      if (this.classList.contains("tl-scroll")) return rect(0, 200);
      if (this.classList.contains("skim-row") && this.classList.contains("current")) return rect(500, 540);
      return rect(0, 0);
    });
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("reduce") }) as MediaQueryList);
    try {
      published = [];
      control = null;
      await act(async () => root.render(createElement(Harness, { covers: true, stepped: true })));
      await settled();
      const list = host.querySelector<HTMLElement>(".tl-scroll")!;
      /* A step from the prose's door, while the band is away. */
      await act(async () => void control!.step(1));
      await settled();
      expect(list.scrollTop, "nothing to measure while hidden").toBe(0);
      /* *All stops*: the band comes back on the same stop. */
      hidden = false;
      await act(async () => root.render(createElement(Harness, { covers: true, stepped: false })));
      await settled();
      expect(list.scrollTop, "the current row is brought into view").toBeGreaterThan(0);
    } finally {
      rects.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it("a depth change down lands on stop 1 of the shallower pass too", async () => {
    history.replaceState(null, "", `/read/a-route?mode=skim&depth=2&stop=${Q[3]}`);
    await mount();
    scrolled.length = 0;
    await act(async () => host.querySelectorAll<HTMLButtonElement>(".skim-depth")[0]!.click());
    await settled();
    expect([param("depth"), param("stop")]).toEqual(["1", Q[2]]);
    expect(scrolled).toEqual([B[2]]);
  });

  it("draws a link's stop on its own pass when the link's depth disagrees (Sol F4)", async () => {
    /* A link from before 260929e: depth=1, but q1 is a Most stop. */
    history.replaceState(null, "", `/read/a-route?mode=skim&depth=1&stop=${Q[1]}`);
    await mount();
    expect(current()).toBe(Q[1]);
    expect(host.querySelector(".skim-depth.on")?.textContent).toContain("Most");
    expect(text(".band-head")).toContain("Stop 1 of 1");
  });

  it("canonicalises a conflicting link's depth on the next step, without pushing", async () => {
    history.replaceState(null, "", `/read/a-route?mode=skim&depth=1&stop=${Q[1]}`);
    const before = history.length;
    await mount();

    /* Most has one stop, so ← revisits stop 1 (4K). It still counts as the
       first traversal after the old link and must repair the stale depth. */
    await act(async () => {
      expect(control!.step(-1)).toBe(true);
    });
    await settled();

    expect([param("depth"), param("stop")]).toEqual(["3", Q[1]]);
    expect(history.length).toBe(before);
    expect([current(), control?.blockId, scrolled.at(-1)]).toEqual([Q[1], B[1], B[1]]);
  });

  it("falls back to the asked pass's first stop when ?stop= names no stop on the route", async () => {
    history.replaceState(null, "", "/read/a-route?mode=skim&depth=2&stop=spya-zz9zzz");
    await mount();
    expect(current()).toBe(Q[3]);
  });

  describe("a route that carries stops into deeper passes (261003l, spya-ms9d69)", () => {
    beforeEach(() => {
      skimBody = SHARED_BODY;
    });
    const pips = () =>
      [...host.querySelectorAll<HTMLElement>(".skim-row")].map((r) =>
        [...r.querySelectorAll(".skim-pip")].map((p) => (p.classList.contains("on") ? "●" : "○")).join(""),
      );

    it("walks a carried stop in both passes, and counts it in both", async () => {
      await mount();
      expect([...host.querySelectorAll(".skim-depth-n")].map((n) => n.textContent)).toEqual(["2", "2", "2"]);
      expect(pips()).toEqual(["●●○", "●○○"]);
      history.replaceState(null, "", "/read/a-route?mode=skim&depth=3");
      await mount();
      expect([...host.querySelectorAll<HTMLElement>(".skim-row")].map((r) => r.getAttribute("data-stop"))).toEqual([Q[3], Q[1]]);
      expect(pips()).toEqual(["○●●", "○○●"]);
      expect(host.querySelector(".skim-row .skim-pips-said")?.textContent).toBe("Also in More");
    });

    it("a depth change that stays on the same stop pushes one entry and does not scroll (Sol F5)", async () => {
      await mount();
      expect(current()).toBe(Q[2]);
      scrolled.length = 0;
      flashed.length = 0;
      const before = history.length;
      await act(async () => host.querySelectorAll<HTMLButtonElement>(".skim-depth")[1]!.click());
      await settled();
      expect(history.length, "one entry for the depth").toBe(before + 1);
      expect([param("depth"), param("stop"), current()]).toEqual(["2", Q[2], Q[2]]);
      expect(host.querySelector(".skim-depth.on")?.textContent).toContain("More");
      expect(text(".band-head")).toContain("Stop 1 of 2");
      expect(scrolled, "the reader is already there").toEqual([]);
      expect(flashed).toEqual([]);
      /* The door is More's now: on to More's own stop. */
      expect(control?.door).toEqual({ kind: "next", cue: "Where does it stop holding?" });

      /* Back undoes the depth change and nothing else. */
      await act(async () => {
        const popped = new Promise<void>((resolve) =>
          window.addEventListener("popstate", () => resolve(), { once: true }),
        );
        history.back();
        await popped;
      });
      await settled();
      expect([param("depth"), current()]).toEqual([null, Q[2]]);
      expect(host.querySelector(".skim-depth.on")?.textContent).toContain("Gist");
      expect(text(".band-head")).toContain("Stop 1 of 2");
    });

    it("draws a link's asked pass when its stop is walked there, else the stop's own", async () => {
      history.replaceState(null, "", `/read/a-route?mode=skim&depth=2&stop=${Q[2]}`);
      await mount();
      expect([current(), host.querySelector(".skim-depth.on")?.textContent?.slice(0, 4)]).toEqual([Q[2], "More"]);
      expect(text(".band-head")).toContain("Stop 1 of 2");
      /* A step from there keeps the pass it was drawn in. */
      await act(async () => void control!.step(1));
      await settled();
      expect([param("depth"), param("stop")]).toEqual(["2", Q[3]]);

      history.replaceState(null, "", `/read/a-route?mode=skim&depth=3&stop=${Q[2]}`);
      await mount();
      expect([current(), host.querySelector(".skim-depth.on")?.textContent?.slice(0, 4)]).toEqual([Q[2], "Gist"]);
      history.replaceState(null, "", `/read/a-route?mode=skim&stop=${Q[3]}`);
      await mount();
      expect([current(), host.querySelector(".skim-depth.on")?.textContent?.slice(0, 4)]).toEqual([Q[3], "More"]);
    });

    it("More detail at the end of Gist goes back to a carried stop 1 of More", async () => {
      await mount();
      await act(async () => void control!.step(1));
      await settled();
      scrolled.length = 0;
      await act(async () => control!.deeper());
      await settled();
      expect([param("depth"), param("stop")]).toEqual(["2", Q[2]]);
      expect(scrolled).toEqual([B[2]]);
    });
  });

  it("draws no pips on a route with no carried stop (261003l)", async () => {
    await mount();
    expect(host.querySelectorAll(".skim-row")).toHaveLength(2);
    expect(host.querySelector(".skim-pips")).toBeNull();
  });

  it("draws Most as only the stops Most adds, none dimmed (260929e)", async () => {
    history.replaceState(null, "", "/read/a-route?mode=skim&depth=3");
    await mount();
    const rows = [...host.querySelectorAll<HTMLElement>(".skim-row")];
    expect(rows.map((r) => r.classList.contains("seen"))).toEqual([false]);
    expect(rows.map((r) => r.querySelector(".skim-place")?.textContent)).toEqual(["Results"]);
    expect([...host.querySelectorAll(".skim-depth-n")].map((n) => n.textContent)).toEqual(["2", "1", "1"]);
  });

  it("steps aside on a narrow window when a stop is chosen from the band", async () => {
    await mount(true);
    await act(async () => host.querySelectorAll<HTMLButtonElement>(".skim-go")[1]!.click());
    await settled();
    expect(away).toBe(1);
    expect(scrolled).toContain(`jump ${B[0]}`);
    expect(param("stop")).toBe(Q[0]);
  });

  it("places each row's stop in the article by its words (5b)", async () => {
    await mount();
    /* Four blocks of seven words each; Gist walks blocks 2 then 0. */
    const left = [...host.querySelectorAll<HTMLElement>(".skim-pos-dot")].map((d) => d.style.top);
    expect(left).toEqual(["63%", "13%"]);
  });

  it("does not flash on an ordinary open, with no stop in the address (5a)", async () => {
    await mount();
    expect(flashed).toEqual([]);
  });

  it("flashes the stop's block on a step, and on the door's next stop (5a)", async () => {
    await mount();
    await act(async () => void control!.step(1));
    await settled();
    expect(flashed).toEqual([B[0]]);
    await act(async () => void control!.step(-1));
    await settled();
    expect(flashed).toEqual([B[0], B[2]]);
    await act(async () => control!.advance());
    await settled();
    expect(flashed).toEqual([B[0], B[2], B[0]]);
    /* 7b: each flash is narrowed to the stop's quote — the key annotate.ts
       writes into the quote's `mark.hit[data-hit]`. */
    expect(passages).toEqual([`${Q[0]}:${B[0]}:0`, `${Q[2]}:${B[2]}:0`, `${Q[0]}:${B[0]}:0`]);
  });

  it("drops a held flash when movement starts and flashes only after a settled scroll", async () => {
    await mount();
    movement.outcome = "cancelled";
    await act(async () => void control!.step(1));
    await settled();

    expect(scrolled).toEqual([B[0]]);
    expect(movement.dropped).toBe(1);
    expect(flashed).toEqual([]);
  });

  /* **A control in the head stays in Skim; a row goes to the article** — Greg's
     spya-kudr63, plan 261003l. Until then every step called `onAway` (Sol F29),
     so on a phone ‹ › showed one stop and then closed the band on the reader. */
  it("flashes on ‹ › in the band too, and stays up on a narrow window (5a, spya-kudr63)", async () => {
    await mount(true);
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Next stop"]')!.click());
    await settled();
    /* The prose still goes to the stop underneath, and the list follows. */
    expect([scrolled, flashed]).toEqual([[B[0]], [B[0]]]);
    expect([param("stop"), current()]).toEqual([Q[0], Q[0]]);
    expect(away).toBe(0);
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Previous stop"]')!.click());
    await settled();
    expect([current(), away]).toEqual([Q[2], 0]);
  });

  it("stays up on ← → and on a depth change, as on ‹ › (spya-kudr63; was Sol F29's step aside)", async () => {
    await mount(true);
    /* The keys reach the band through the published control, not the panel. */
    await act(async () => void control!.step(1));
    await settled();
    expect([flashed, away]).toEqual([[B[0]], 0]);
    /* The door, back to the next stop: ← then the door's Next stop. */
    await act(async () => void control!.step(-1));
    await settled();
    await act(async () => control!.advance());
    await settled();
    expect([flashed, away]).toEqual([[B[0], B[2], B[0]], 0]);
    /* A depth change always moves the reader now: Most's own stop 1. */
    await act(async () => host.querySelectorAll<HTMLButtonElement>(".skim-depth")[2]!.click());
    await settled();
    expect([param("depth"), param("stop")]).toEqual(["3", Q[1]]);
    expect([flashed.at(-1), away]).toEqual([B[1], 0]);
  });

  it("still steps aside for a row pressed after the head's controls were used (spya-kudr63)", async () => {
    await mount(true);
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Next stop"]')!.click());
    await settled();
    expect(away).toBe(0);
    /* The quote itself: a jump to the article, as before. */
    await act(async () => host.querySelector<HTMLButtonElement>(".skim-row.current .skim-go")!.click());
    await settled();
    expect(away).toBe(1);
    expect(scrolled.at(-1)).toBe(`jump ${B[0]}`);
    expect(jumpPassages.at(-1)).toBe(`${Q[0]}:${B[0]}:0`);
  });

  it("flashes when More detail or a depth button moves the reader (5a)", async () => {
    await mount();
    await act(async () => host.querySelectorAll<HTMLButtonElement>(".skim-depth")[2]!.click());
    await settled();
    expect(flashed).toEqual([B[1]]);

    history.replaceState(null, "", `/read/a-route?mode=skim&depth=1&stop=${Q[0]}`);
    await mount();
    flashed.length = 0;
    await act(async () => control!.deeper());
    await settled();
    expect(param("stop")).toBe(Q[3]);
    expect(flashed).toEqual([B[3]]);
  });

  it("leaves a row press's quote flash to the jump it makes, so it flashes once (5a, 7b)", async () => {
    await mount();
    await act(async () => host.querySelectorAll<HTMLButtonElement>(".skim-go")[1]!.click());
    await settled();
    /* `onJump` → `beginJump` flashes in the real reader; the band adds none. */
    expect(scrolled).toEqual([`jump ${B[0]}`]);
    expect(jumpPassages).toEqual([`${Q[0]}:${B[0]}:0`]);
    expect(flashed).toEqual([]);
  });

  it("brings a deep link's stop into view and flashes it, once (5a, Sol F28)", async () => {
    history.replaceState(null, "", `/read/a-route?mode=skim&depth=2&stop=${Q[3]}`);
    await mount();
    expect(scrolled).toEqual([B[3]]);
    expect(flashed).toEqual([B[3]]);
    /* Once: a re-render, or the data settling, does not do it again. */
    await settled();
    expect([scrolled, flashed]).toEqual([[B[3]], [B[3]]]);
    /* And a step after it is its own arrival, not a second deep link: ← on
       More's only stop goes to its passage again (4K). */
    await act(async () => void control!.step(-1));
    await settled();
    expect(flashed).toEqual([B[3], B[3]]);
  });

  it("does not re-arm the deep-link arrival when the Skim band remounts", async () => {
    history.replaceState(null, "", `/read/a-route?mode=skim&depth=2&stop=${Q[3]}`);

    function Mode({ skim }: { skim: boolean }) {
      const arrival = useRef<SkimArrival>({
        stop: new URLSearchParams(location.search).get("stop"),
        open: false,
      });
      return skim
        ? createElement(Harness, { arrival: arrival.current })
        : createElement("div", { "data-mode": "plain" });
    }

    await act(async () => root.render(createElement(Mode, { skim: true })));
    await settled();
    expect([scrolled, flashed]).toEqual([[B[3]], [B[3]]]);

    await act(async () => root.render(createElement(Mode, { skim: false })));
    await act(async () => root.render(createElement(Mode, { skim: true })));
    await settled();

    expect([scrolled, flashed], "the initial (slug, stop) arrival is one-shot").toEqual([
      [B[3]],
      [B[3]],
    ]);
  });

  it("keeps one deep-link flash through StrictMode's synthetic cleanup", async () => {
    history.replaceState(null, "", `/read/a-route?mode=skim&depth=2&stop=${Q[3]}`);

    function FlashOwner() {
      useEffect(() => resetFlash, []);
      return createElement(Harness);
    }

    await act(async () =>
      root.render(createElement(StrictMode, null, createElement(FlashOwner))),
    );
    await settled();

    expect([scrolled, flashed]).toEqual([[B[3]], [B[3]]]);
  });

  it("does not move the route when the destination quote has not loaded", async () => {
    quotesRead = { ...QUOTES_READ, quotes: null, status: "loading" };
    await mount();

    let took = true;
    await act(async () => {
      took = control!.step(1);
    });
    await settled();

    expect(took).toBe(false);
    expect(param("stop")).toBeNull();
    expect([scrolled, flashed]).toEqual([[], []]);
  });

  it("can leave a missing current stop for a valid new pass", async () => {
    const missing = "spya-tq6pqr";
    skimBody = {
      ...SKIM_BODY,
      stale: true,
      skim: {
        ...ROUTE,
        stops: [
          { quoteId: missing, depth: 1, role: null },
          { quoteId: Q[3]!, depth: 2, role: null },
        ],
        visible: [1, 2, 2],
      },
    };
    await mount();
    expect([current(), control?.blockId]).toEqual([missing, null]);

    await act(async () => host.querySelectorAll<HTMLButtonElement>(".skim-depth")[1]!.click());
    await settled();

    expect([param("depth"), param("stop")]).toEqual(["2", Q[3]]);
    expect([current(), control?.blockId, scrolled.at(-1)]).toEqual([Q[3], B[3], B[3]]);
  });

  it("refuses a depth change when the new pass's required stop 1 has no passage", async () => {
    const missing = "spya-tq6pqr";
    skimBody = {
      ...SKIM_BODY,
      stale: true,
      skim: {
        ...ROUTE,
        stops: [
          { quoteId: Q[2]!, depth: 1, role: null },
          { quoteId: missing, depth: 2, role: null },
          { quoteId: Q[3]!, depth: 2, role: null },
        ],
        visible: [1, 3, 3],
      },
    };
    await mount();
    scrolled.length = 0;

    await act(async () => host.querySelectorAll<HTMLButtonElement>(".skim-depth")[1]!.click());
    await settled();

    /* Updating only the band and URL would leave the prose at the old stop;
       skipping stop 1 would break the depth-change contract. Replanning the
       stale route is the available recovery, so the whole movement is refused. */
    expect([param("depth"), param("stop")]).toEqual([null, null]);
    expect([current(), control?.blockId, scrolled]).toEqual([Q[2], B[2], []]);
  });

  it("leaves the band open over a deep link on a narrow window", async () => {
    /* A shared link opens the band (Reader.tsx § bandAway); the flash is held
       behind it and fires when the band steps aside (flash.ts). */
    history.replaceState(null, "", `/read/a-route?mode=skim&depth=2&stop=${Q[3]}`);
    await mount(true);
    expect([scrolled, away]).toEqual([[B[3]], 0]);
  });

  it("lands a deep link whose stop is not on the route on the first stop, without a push (Sol F4)", async () => {
    history.replaceState(null, "", "/read/a-route?mode=skim&depth=1&stop=spya-zz9zzz");
    const before = history.length;
    await mount();
    expect([scrolled, flashed]).toEqual([[B[2]], [B[2]]]);
    expect(history.length).toBe(before);
  });

  it("jumps to the current stop when the mode is opened, once, as a jump the chip can undo (4K)", async () => {
    history.replaceState(null, "", "/read/a-route?mode=skim");
    const arrival: SkimArrival = { stop: null, open: true };
    await act(async () => root.render(createElement(StrictMode, null, createElement(Harness, { arrival }))));
    await settled();
    /* `onJump` is `jumpTo` → `beginJump` in the reader: the push, the stamp
       the "Back to …" chip is drawn from, the centring and the flash. */
    expect(scrolled).toEqual([`jump ${B[2]}`]);
    expect(jumpPassages).toEqual([`${Q[2]}:${B[2]}:0`]);
    expect(arrival.open, "consumed").toBe(false);
    /* A step afterwards is a step, not a second opening. */
    await act(async () => void control!.step(1));
    await settled();
    expect(scrolled).toEqual([`jump ${B[2]}`, B[0]]);
  });

  it("prefers a deep link to the opening jump when both are armed", async () => {
    history.replaceState(null, "", `/read/a-route?mode=skim&depth=2&stop=${Q[3]}`);
    const arrival: SkimArrival = { stop: Q[3]!, open: true };
    await act(async () => root.render(createElement(Harness, { arrival })));
    await settled();
    expect(scrolled).toEqual([B[3]]);
    expect(arrival).toEqual({ stop: null, open: false });
  });

  it("waits for the route before the opening jump, and does not jump on a remount it was not armed for", async () => {
    history.replaceState(null, "", "/read/a-route?mode=skim");
    const arrival: SkimArrival = { stop: null, open: true };
    await act(async () => root.render(createElement(Harness, { arrival })));
    await settled();
    expect(scrolled).toEqual([`jump ${B[2]}`]);
    /* Back into the mode (Reader does not re-arm on popstate): nothing moves. */
    await act(async () => root.render(createElement("div")));
    await act(async () => root.render(createElement(Harness, { arrival })));
    await settled();
    expect(scrolled).toEqual([`jump ${B[2]}`]);
  });

  it("retires an unresolved opening with the band that claimed it, so Back cannot spend the old press", async () => {
    history.replaceState(null, "", "/read/a-route?mode=skim");
    const arrival: SkimArrival = { stop: null, open: true };
    quotesRead = { ...QUOTES_READ, quotes: null, status: "loading" };
    await act(async () => root.render(createElement(Harness, { arrival })));
    await settled();
    expect(scrolled).toEqual([]);

    /* Leave before Quotes resolve, then return by history rather than by a new
       press. The first mount owned the press; this one must not inherit it. */
    await act(async () => root.render(createElement("div")));
    quotesRead = QUOTES_READ;
    await act(async () => root.render(createElement(Harness, { arrival })));
    await settled();
    expect(scrolled).toEqual([]);
  });

  it("plans it again with the route forced, and nothing else when the Quotes are current (5e)", async () => {
    /* Stale, so the banner — the one Plan it again left (plans 260929b, 260929c) — is drawn. */
    skimBody = { ...SKIM_BODY, stale: true };
    /* Not `["quotes", "skim"]`: the server re-runs Quotes whose prompt
       version is merely outdated, so naming them on every press re-bought and
       replaced a reader's Quotes on a route rebuild (browser check, 2026-09-28;
       the plan's F38). The Ideas are there too — outdated, which is not a
       reason to name them either. */
    ideasBody = IDEAS_BODY;
    await mount();
    await act(async () => host.querySelector<HTMLButtonElement>(".gloss-stale button:not(.notice-close)")!.click());
    await settled();
    expect(posted).toEqual([{ slug: "a-route", steps: ["skim"], force: ["skim"] }]);
  });

  it("plans it again with the Ideas found first, unforced, when there are none (stage 6)", async () => {
    /* Stale, so the banner — the one Plan it again left (plans 260929b, 260929c) — is drawn. */
    skimBody = { ...SKIM_BODY, stale: true };
    await mount();
    await act(async () => host.querySelector<HTMLButtonElement>(".gloss-stale button:not(.notice-close)")!.click());
    await settled();
    expect(posted).toEqual([{ slug: "a-route", steps: ["ideas", "skim"], force: ["skim"] }]);
  });

  it("plans it again with stale Quotes chosen first, unforced (5e, Sol F30)", async () => {
    /* Stale, so the banner — the one Plan it again left (plans 260929b, 260929c) — is drawn. */
    skimBody = { ...SKIM_BODY, stale: true };
    quotesRead = { ...QUOTES_READ, stale: true };
    ideasBody = IDEAS_BODY;
    await mount();
    await act(async () => host.querySelector<HTMLButtonElement>(".gloss-stale button:not(.notice-close)")!.click());
    await settled();
    /* Only the route is forced; `stepIsDone` decides about the Quotes. */
    expect(posted).toEqual([{ slug: "a-route", steps: ["quotes", "skim"], force: ["skim"] }]);
  });

  it("keeps a route press pending until the Ideas read says whether it is stale", async () => {
    /* Stale, so the banner — the one Plan it again left (plans 260929b, 260929c) — is drawn. */
    skimBody = { ...SKIM_BODY, stale: true };
    let answerIdeas!: (response: Response) => void;
    ideasReply = new Promise<Response>((resolve) => {
      answerIdeas = resolve;
    });
    await mount();

    await act(async () => host.querySelector<HTMLButtonElement>(".gloss-stale button:not(.notice-close)")!.click());
    await settled();
    expect(posted, "must not plan against Ideas whose freshness is still unknown").toEqual([]);

    answerIdeas(
      new Response(JSON.stringify({ ...IDEAS_BODY, stale: true, outdated: false }), { status: 200 }),
    );
    await settled();
    expect(posted).toEqual([
      { slug: "a-route", steps: ["ideas", "skim"], force: ["skim"] },
    ]);
  });

  it("takes its passage and its handle with it when it goes", async () => {
    await mount();
    expect(control).not.toBeNull();
    await act(async () => root.render(createElement(NuqsAdapter, null, createElement("div"))));
    expect(control).toBeNull();
    expect(published).toEqual([]);
  });
});

describe("the scrapbook, walked", () => {
  beforeEach(() => {
    glossaryRead = GLOSSARY_READ;
    opened.length = 0;
  });

  it("gathers the card from what already exists, and starts no job doing it", async () => {
    ideasBody = IDEAS_BODY;
    await mount();
    expect(current()).toBe(Q[2]);
    const card = host.querySelector(".skim-row.current .skim-card");
    /* The term, then the idea — both chips now (260929f). */
    const chips = () => [...host.querySelectorAll<HTMLButtonElement>(".skim-row.current .skim-card .skim-chip")];
    expect(chips().map((c) => c.textContent)).toEqual(["laboratory", "Fieldwork is the test"]);
    /* Outdated, not stale, so it is shown (F19). */
    expect(card?.textContent).toContain("Fieldwork is the test");
    expect(requested.some((r) => r.url.startsWith("/api/ideas/"))).toBe(true);
    expect(requested.filter((r) => r.method !== "GET")).toEqual([]);

    await act(async () => chips()[1]!.click());
    await act(async () => host.querySelector<HTMLButtonElement>('.skim-card [aria-label="Open in Ideas"]')!.click());
    expect(opened).toEqual(["idea spya-id4ghj"]);
  });

  it("shows no FAQ question on a stop, even when the FAQ pairs one with its paragraph (SPIDERYARN-READING2-8Z)", async () => {
    faqBody = {
      faq: {
        version: "faq/t",
        generator: "t",
        slug: "a-route",
        sourceHash: "h",
        questions: [
          {
            id: "spya-fq2abc",
            question: "Did they ever leave the laboratory?",
            passages: [{ blockId: B[2]!, quote: "never left the laboratory", start: 0 }],
          },
        ],
        dropped: {},
        generatedAt: "",
        elapsedMs: 0,
      },
      stale: false,
      outdated: false,
    };
    await mount();
    expect(current()).toBe(Q[2]);
    /* The stop card is there, so the gathering ran over this paragraph. */
    expect(host.querySelector(".skim-row.current .skim-card")).not.toBeNull();
    expect(host.textContent).not.toContain("Did they ever leave the laboratory?");
    /* Skim no longer reads the FAQ at all (Greg: "they don't add much"). */
    expect(requested.some((r) => r.url.startsWith("/api/faq/"))).toBe(false);
  });

  it("shows the Ideas the route's own job found, without a reload (Sol F61)", async () => {
    /* A fresh article: no Ideas when the band mounts. */
    await mount();
    const ideaReads = () => requested.filter((r) => r.url.startsWith("/api/ideas/")).length;
    const before = ideaReads();
    expect(before).toBeGreaterThan(0);
    expect(host.querySelector(".skim-row.current .skim-card")?.textContent ?? "").not.toContain(
      "Fieldwork is the test",
    );

    /* The route's job finishes, having found the Ideas on its way. */
    ideasBody = IDEAS_BODY;
    expect(finishers.length).toBeGreaterThan(0);
    await act(async () => {
      finishers.at(-1)!({ id: "job-t", slug: "a-route", status: "done", steps: [{ name: "ideas" }, { name: "skim" }] });
    });
    await settled();
    expect(ideaReads()).toBeGreaterThan(before);
    expect(host.querySelector(".skim-row.current .skim-card")?.textContent).toContain("Fieldwork is the test");
  });

  /* The stop card's Ideas across the read's states — the SkimMode half of
     tests/ideas-read-states.test.tsx, here because this file has the walk. */
  it("goes on showing a current list's ideas after a refresh of them fails", async () => {
    ideasBody = IDEAS_BODY;
    await mount();
    const card = () => host.querySelector(".skim-row.current .skim-card")?.textContent ?? "";
    expect(card()).toContain("Fieldwork is the test");

    ideasFails = true;
    const ideaReads = () => requested.filter((r) => r.url.startsWith("/api/ideas/")).length;
    const before = ideaReads();
    await act(async () => {
      finishers.at(-1)!({ id: "job-f", slug: "a-route", status: "done", steps: [{ name: "ideas" }, { name: "skim" }] });
    });
    await settled();
    expect(ideaReads(), "the failed refresh was asked").toBeGreaterThan(before);
    expect(card()).toContain("Fieldwork is the test");
  });

  it("shows no idea from a stale list, or from a read that failed", async () => {
    const card = () => host.querySelector(".skim-row.current .skim-card")?.textContent ?? "";
    ideasBody = { ...(IDEAS_BODY as object), stale: true };
    await mount();
    expect(current()).toBe(Q[2]);
    expect(card()).not.toContain("Fieldwork is the test");
    /* The control: the term on the same card is drawn, so the card ran. */
    expect(card()).toContain("laboratory");
  });

  it("shows no idea when the Ideas' opening read failed", async () => {
    ideasBody = IDEAS_BODY;
    ideasFails = true;
    await mount();
    expect(current()).toBe(Q[2]);
    const card = host.querySelector(".skim-row.current .skim-card")?.textContent ?? "";
    expect(card).not.toContain("Fieldwork is the test");
    expect(card).toContain("laboratory");
  });

  it("finds a plural the stored list never named, and draws no card from a stale glossary", async () => {
    history.replaceState(null, "", `/read/a-route?mode=skim&depth=1&stop=${Q[0]}`);
    await mount();
    expect([...host.querySelectorAll(".skim-row.current .skim-chip")].map((c) => c.textContent)).toEqual([
      "cohort",
    ]);
    glossaryRead = { ...GLOSSARY_READ, stale: true };
    await mount();
    expect(host.querySelector(".skim-card")).toBeNull();
  });

  it("shows the cue on the current row, and an old route's role where there is no cue", async () => {
    await mount();
    expect(text(".skim-row.current .skim-cue")).toBe("What does earlier work miss, by their account?");
    history.replaceState(null, "", `/read/a-route?mode=skim&depth=3&stop=${Q[1]}`);
    await mount();
    expect(text(".skim-row.current .skim-cue")).toBe("How they measured it");
  });

  it("hands the door the next stop's cue mid-pass, and the pass that ended at its end", async () => {
    await mount();
    expect(control?.door).toEqual({ kind: "next", cue: "Look for the headline comparison." });
    await act(async () => void control!.step(1));
    await settled();
    expect(control?.door).toEqual({ kind: "end", pass: "Gist", count: 2, deeper: "More" });
  });
});
