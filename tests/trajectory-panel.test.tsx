// @vitest-environment jsdom
/**
 * **Trajectory mode, drawn and walked** — src/web/TrajectoryPanel.tsx and
 * src/web/modes/trajectory/TrajectoryMode.tsx.
 *
 * Two halves. The panel, from a posed hook and view: the pinned head, the depth
 * control that offers only the depths that add stops, the role line on the
 * current row only, the dimmed stops of a shallower pass, and the foot's
 * promise. Then the band, for real, over a stubbed network inside a
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
  NodeId,
  Quote,
  Quotes,
  Trajectory,
  TrajectoryStop,
  Tree,
  TreeNode,
} from "../src/types.js";
import type { GlossaryEntry } from "../src/types.js";
import type { GlossaryRead } from "../src/web/useGlossary.js";
import type { StopCard } from "../src/web/stop-card.js";
import type { Found } from "../src/web/search-hits.js";
import type { UseTrajectory } from "../src/web/useTrajectory.js";
import type { QuotesRead } from "../src/web/useQuotes.js";
import type {
  TrajectoryArrival,
  TrajectoryControl,
  TrajectoryView,
} from "../src/web/modes/trajectory/TrajectoryMode.js";

/* jsdom has no `CSS.escape`, which `useFollow` uses to find the current row;
   the ids here need no escaping. scroll-glide.test.ts does the same. */
globalThis.CSS ??= { escape: (s: string) => s } as unknown as typeof globalThis.CSS;

/* ------------------------------------------------------------ the network -- */

let trajectoryBody: unknown = null;
/** The Ideas the stop card may show, or `null` for none (404). */
let ideasBody: unknown = null;
/** A held Ideas read, for the prerequisite-loading race. */
let ideasReply: Promise<Response> | null = null;
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
    if (url.startsWith("/api/trajectory/"))
      return trajectoryBody === null
        ? new Response(null, { status: 404 })
        : new Response(JSON.stringify(trajectoryBody), { status: 200 });
    if (url.startsWith("/api/ideas/"))
      return ideasReply ?? (ideasBody === null
        ? new Response(null, { status: 404 })
        : new Response(JSON.stringify(ideasBody), { status: 200 }));
    if (url.startsWith("/api/jobs")) return new Response(JSON.stringify({ jobs: [] }), { status: 200 });
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
const { scrolled, flashed, passages, jumpPassages, movement, aligns } = vi.hoisted(() => ({
  scrolled: [] as string[],
  flashed: [] as string[],
  /* The passage each flash was narrowed to (plan 260928a § 7b), or null. */
  passages: [] as (string | null)[],
  /* The passage a history-pushing row jump asks `beginJump` to flash. */
  jumpPassages: [] as (string | null)[],
  /* How each Trajectory movement asked to land — plan 260929a § 3. */
  aligns: [] as string[],
  movement: { outcome: "settled" as "settled" | "cancelled" | "missing", dropped: 0 },
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
    },
    resetFlash: () => {
      flashed.length = 0;
    },
  };
});

const { TrajectoryPanel, TrajectoryDoor, coverageNote, trajectoryPromise } = await import(
  "../src/web/TrajectoryPanel.js"
);
const { armTrajectoryOpening, firstTrajectoryArrival, TrajectoryBand } = await import(
  "../src/web/modes/trajectory/TrajectoryMode.js"
);
const { resetFlash } = await import("../src/web/flash.js");
const { resolveQuotes } = await import("../src/web/search-hits.js");
const { quoteStroke } = await import("../src/web/QuotesPanel.js");

describe("the reading view's Trajectory arrival mailbox", () => {
  it("arms from the press itself even while location still has the old mode", () => {
    history.replaceState(null, "", "/read/a-route?mode=plain");
    const arrival = firstTrajectoryArrival("plain");
    armTrajectoryOpening(arrival, "plain", "trajectory");
    expect(location.search, "nuqs has not written the new mode yet").toBe("?mode=plain");
    expect(arrival).toEqual({ stop: null, open: true });
  });

  it("does not re-arm a press on the already-open mode", () => {
    const arrival: TrajectoryArrival = { stop: null, open: false };
    armTrajectoryOpening(arrival, "trajectory", "trajectory");
    expect(arrival.open).toBe(false);
  });

  it("arms neither a stop arrival nor an opening when Back remounts the Reader", () => {
    history.replaceState(null, "", "/read/a-route?mode=trajectory&stop=q-popped");
    window.dispatchEvent(new PopStateEvent("popstate"));
    expect(firstTrajectoryArrival("trajectory")).toEqual({ stop: null, open: false });
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
 * Route order q2 q0 q3 q1; Gist is q2 and q0, More adds q3, Most adds q1.
 */
const STOPS: TrajectoryStop[] = [
  { quoteId: Q[2]!, depth: 1, role: null, cue: "What does earlier work miss, by their account?" },
  { quoteId: Q[0]!, depth: 1, role: null, cue: "Look for the headline comparison." },
  { quoteId: Q[3]!, depth: 2, role: null, cue: "Where does it stop holding?" },
  /* A stop from a route written before cues: the band falls back to its role. */
  { quoteId: Q[1]!, depth: 3, role: "How they measured it" },
];

const ROUTE: Trajectory = {
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
  ideasReply = null;
  finishers.length = 0;
  trajectoryBody = { trajectory: ROUTE, stale: false, outdated: false, profileChanged: false, notOnRoute: 0 };
  history.replaceState(null, "", "/read/a-route?mode=trajectory");
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

/* =============================================================== the panel == */

function owner(over: Partial<UseTrajectory> = {}): UseTrajectory {
  return {
    status: "ready",
    trajectory: ROUTE,
    stale: false,
    outdated: false,
    profileChanged: false,
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
    cancel: () => {},
    ...over,
  };
}

const calls: string[] = [];
function view(over: Partial<TrajectoryView> = {}): TrajectoryView {
  return {
    depth: 2,
    depths: [
      { depth: 1, label: "Gist", count: 2 },
      { depth: 2, label: "More", count: 3 },
      { depth: 3, label: "Most", count: 4 },
    ],
    rows: [
      { quoteId: Q[2]!, n: 1, place: "Methods", cue: "What earlier work missed", seen: true, current: false, missing: false, position: null, words: null },
      { quoteId: Q[0]!, n: 2, place: "Results", cue: "The headline result", seen: true, current: true, missing: false, position: null, words: null },
      { quoteId: Q[3]!, n: 3, place: "Methods", cue: "Where it stops holding", seen: false, current: false, missing: false, position: null, words: null },
    ],
    position: 2,
    card: null,
    onDepth: (d) => void calls.push(`depth ${d}`),
    onRow: (id) => void calls.push(`row ${id}`),
    onStep: (dir) => void calls.push(`step ${dir}`),
    onOpen: (target) => void calls.push(`open ${target.kind} ${target.id}`),
    canOpen: () => true,
    ...over,
  };
}

const TERM: GlossaryEntry = {
  id: "spya-te2abc",
  name: "transfer entropy",
  kind: "concept",
  aliases: [],
  senseHere: "How much a source's past says about a target's future.",
  blocks: [],
};
const CARD: StopCard = {
  terms: [
    { entry: TERM, alsoAt: 1 },
    { entry: { ...TERM, id: "spya-te3def", name: "synergy", senseHere: "Information only the pair carries." }, alsoAt: null },
  ],
  ideas: [{ id: "spya-id2abc", name: "Synergy is not redundancy" }],
  questions: [{ id: "q1", question: "How was synergy measured?" }],
  events: [{ id: "spya-ev2abc", label: "Recordings made" }],
};

async function draw(o: UseTrajectory, v: TrajectoryView) {
  calls.length = 0;
  await act(async () => root.render(createElement(TrajectoryPanel, { owner: o, view: v, away: false })));
}

const text = (sel: string) => host.querySelector(sel)?.textContent ?? null;

describe("the panel", () => {
  it("pins the stepper and the depth control in the head, with counts", async () => {
    await draw(owner(), view());
    const head = host.querySelector(".band-head");
    expect(head?.textContent).toContain("Stop 2 of 3");
    const depths = [...host.querySelectorAll<HTMLButtonElement>(".band-head .traj-depth")];
    expect(depths.map((b) => b.textContent)).toEqual(["Gist2", "More3", "Most4"]);
    expect(depths.map((b) => b.getAttribute("aria-pressed"))).toEqual(["false", "true", "false"]);
    /* The list is not in the head — the head is what stays put. */
    expect(head?.querySelector(".traj-list")).toBeNull();
  });

  it("draws only the depths that add stops, and no control when there is one", async () => {
    await draw(owner(), view({ depths: [{ depth: 1, label: "Gist", count: 2 }] }));
    expect(host.querySelector(".traj-depths")).toBeNull();
    expect(text(".band-head")).toContain("Stop 2 of 3");
  });

  it("shows the cue on the current row only, and the place on every row", async () => {
    await draw(owner(), view());
    const rows = [...host.querySelectorAll<HTMLElement>(".traj-row")];
    expect(rows.map((r) => r.querySelector(".traj-place")?.textContent)).toEqual([
      "Methods",
      "Results",
      "Methods",
    ]);
    expect(rows.map((r) => r.querySelector(".traj-cue")?.textContent ?? null)).toEqual([
      null,
      "The headline result",
      null,
    ]);
    expect(host.textContent).not.toContain("What earlier work missed");
  });

  it("draws a repeated section path for a screen reader only — no ditto mark beside a quote (260928e)", async () => {
    const repeated = view({
      rows: [
        { quoteId: Q[2]!, n: 1, place: "Methods", cue: null, seen: false, current: false, missing: false, position: null, words: "First." },
        { quoteId: Q[3]!, n: 2, place: "Methods", cue: null, seen: false, current: false, missing: false, position: null, words: "Second." },
      ],
      position: 1,
    });
    await draw(owner(), repeated);

    const rows = [...host.querySelectorAll<HTMLElement>(".traj-row")];
    expect(rows[0]?.querySelector(".traj-place")?.textContent).toBe("Methods");
    expect(rows[1]?.querySelector(".traj-place")).toBeNull();
    expect(rows[1]?.querySelector(".sr-only")?.textContent).toBe("Methods");
    /* The report: a column of `〃` read as a column of quotation marks. */
    expect(host.textContent).not.toContain("〃");
  });

  describe("the quote's words on each row (260928e)", () => {
    const LONG =
      "Across all five datasets the effect held within two per cent, even after the rich-club nodes were removed and the comparison was repeated from scratch.";
    const words = (r: Element | undefined) => r?.querySelector(".traj-words")?.textContent ?? null;
    const rowsOf = () => [...host.querySelectorAll<HTMLElement>(".traj-row")];
    const tips = () => document.querySelectorAll('[role="tooltip"]');
    async function hover(el: Element) {
      el.dispatchEvent(new MouseEvent("mouseenter"));
      await act(async () => {
        await new Promise((r) => setTimeout(r, 400));
      });
    }
    async function unhover(el: Element) {
      el.dispatchEvent(new MouseEvent("mouseleave"));
      el.dispatchEvent(new MouseEvent("mouseout", { bubbles: true, relatedTarget: document.body }));
      for (const _ of [0, 1]) {
        await act(async () => {
          await new Promise((r) => setTimeout(r, 300));
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

      const go = rowsOf()[0]!.querySelector(".traj-go")!;
      await hover(go);
      expect(tips()).toHaveLength(1);
      expect(tips()[0]?.textContent).toContain(LONG);
      await unhover(go);
      expect(tips()).toHaveLength(0);
    });

    it("shows a quote that fits whole, with no tooltip to repeat it", async () => {
      await draw(owner(), withWords([LONG, null, "Short and whole."]));
      expect(words(rowsOf()[2])).toBe("“Short and whole.”");
      await hover(rowsOf()[2]!.querySelector(".traj-go")!);
      expect(tips()).toHaveLength(0);
    });

    it("handles the 100-character boundary, whitespace, and an unbroken cut", async () => {
      const exact = "x".repeat(100);
      const over = "x".repeat(101);
      await draw(owner(), withWords([exact, " \n\t ", over]));

      expect(words(rowsOf()[0])).toBe(`“${exact}”`);
      expect(words(rowsOf()[1])).toBeNull();
      expect(words(rowsOf()[2])).toBe(`“${exact}…”`);
      await hover(rowsOf()[0]!.querySelector(".traj-go")!);
      expect(tips()).toHaveLength(0);
      await hover(rowsOf()[2]!.querySelector(".traj-go")!);
      expect(tips()[0]?.textContent).toContain(over);
    });

    it("shows the current stop's quote whole, with no tooltip — which is also what a tap reaches", async () => {
      await draw(owner(), withWords([null, LONG, null]));
      expect(words(rowsOf()[1])).toBe(`“${LONG}”`);
      await hover(rowsOf()[1]!.querySelector(".traj-go")!);
      expect(tips()).toHaveLength(0);
    });

    it("keeps the same button, and its focus, when a cut row becomes current", async () => {
      await draw(owner(), withWords([LONG, null, null]));
      const before = rowsOf()[0]!.querySelector<HTMLButtonElement>(".traj-go")!;
      before.focus();
      const moved = withWords([LONG, null, null]);
      await draw(owner(), { ...moved, rows: moved.rows.map((r, i) => ({ ...r, current: i === 0 })) });
      const after = rowsOf()[0]!.querySelector<HTMLButtonElement>(".traj-go")!;
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
      await hover(rowsOf()[0]!.querySelector(".traj-go")!);
      expect(tips()).toHaveLength(1);
      /* → onto it: current, whole, no card. Then → off it, pointer long gone. */
      await draw(owner(), at(0));
      await act(async () => {
        await new Promise((r) => setTimeout(r, 200));
      });
      expect(tips()).toHaveLength(0);
      await draw(owner(), at(2));
      await act(async () => {
        await new Promise((r) => setTimeout(r, 200));
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
      await hover(rowsOf()[0]!.querySelector(".traj-go")!);
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
  });

  it("dims the stops of a shallower pass", async () => {
    await draw(owner(), view());
    const rows = [...host.querySelectorAll<HTMLElement>(".traj-row")];
    expect(rows.map((r) => r.classList.contains("seen"))).toEqual([true, true, false]);
  });

  it("hands a row, the arrows and a depth to the view", async () => {
    await draw(owner(), view());
    await act(async () => host.querySelectorAll<HTMLButtonElement>(".traj-go")[2]!.click());
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Next stop"]')!.click());
    await act(async () => host.querySelectorAll<HTMLButtonElement>(".traj-depth")[2]!.click());
    /* The depth already drawn is not a change. */
    await act(async () => host.querySelectorAll<HTMLButtonElement>(".traj-depth")[1]!.click());
    expect(calls).toEqual([`row ${Q[3]}`, "step 1", "depth 3"]);
  });

  it("turns ‹ into Back to stop 1 on stop 1, and disables › at the end, because the route does not wrap", async () => {
    await draw(owner(), view({ position: 1 }));
    expect(host.querySelector('[aria-label="Previous stop"]')).toBeNull();
    expect(host.querySelector<HTMLButtonElement>('[aria-label="Back to stop 1"]')!.disabled).toBe(false);
    await draw(owner(), view({ position: 3 }));
    expect(host.querySelector<HTMLButtonElement>('[aria-label="Next stop"]')!.disabled).toBe(true);
  });

  it("keeps the promise in the head's info tooltip, not the foot, and says how much of the Quotes Most walks (52)", async () => {
    const tip = () => document.querySelector('[role="tooltip"]')?.textContent ?? null;
    const info = () => host.querySelector<HTMLButtonElement>('.band-head [aria-label="About this route"]')!;
    await draw(owner(), view());
    expect(host.querySelector(".traj-foot")?.textContent ?? "").not.toContain("Quotes");
    expect(info().hasAttribute("title"), "a tooltip, not a title").toBe(false);
    expect(info(), "last in the head, after the depth control").toBe(host.querySelector(".traj-head")!.lastElementChild);
    expect(tip()).toBeNull();
    /* A tap — a click, with no hover first — opens it: touch has no hover. */
    await act(async () => info().click());
    expect(tip()).toBe(trajectoryPromise(false));
    expect(info().getAttribute("aria-expanded")).toBe("true");
    await act(async () => info().click());
    expect(info().getAttribute("aria-expanded"), "a second tap closes it").toBe("false");
    /* The keyboard reaches it too: focus opens it. */
    await act(async () => info().focus());
    expect(info().getAttribute("aria-expanded"), "focus opens it").toBe("true");
    await act(async () => info().blur());

    const most = view({
      depth: 3,
      rows: [...view().rows, { quoteId: Q[1]!, n: 4, place: "Results", cue: null, seen: false, current: false, missing: false, position: null, words: null }],
    });
    /* The live Quotes list may include two abstract quotes; the route records
       the four it was actually offered, which is the honest denominator. */
    await draw(owner(), most);
    await act(async () => info().click());
    expect(tip()).toContain("every one of the 4 quotes offered to this route");
    await act(async () => info().click());
    await draw(owner({ trajectory: { ...ROUTE, offered: 6 } }), most);
    await act(async () => info().click());
    expect(tip()).toContain("4 of the 6 quotes offered to this route");
    await act(async () => info().click());
    expect(coverageNote(4, 0)).toBeNull();
  });

  it("does not blame the Quotes when the Ideas or outline may have made the route stale", async () => {
    await draw(owner({ stale: true, notOnRoute: 3 }), view());
    expect(text(".gloss-stale")).toContain("Quotes, Ideas, or outline");
    expect(text(".gloss-stale")).not.toContain("Quotes have changed");
  });

  it("draws the stop card under the current row only, and no card when there is nothing", async () => {
    await draw(owner(), view());
    expect(host.querySelector(".traj-card")).toBeNull();
    expect(host.textContent).not.toMatch(/glossary|generate/i);

    await draw(owner(), view({ card: CARD }));
    const cards = [...host.querySelectorAll(".traj-card")];
    expect(cards).toHaveLength(1);
    expect(cards[0]!.closest(".traj-row")?.classList.contains("current")).toBe(true);
    /* Outside the row's button: a button cannot hold other controls. */
    expect(cards[0]!.closest("button")).toBeNull();
    const chips = [...host.querySelectorAll<HTMLButtonElement>(".traj-chip")];
    expect(chips.map((c) => c.textContent)).toEqual(["transfer entropyalso at stop 1", "synergy"]);
    expect(text(".traj-card")).toContain("Synergy is not redundancy");
    expect(text(".traj-card")).toContain("How was synergy measured?");
    expect(text(".traj-card")).toContain("Recordings made");
    expect(text(".traj-card")).not.toContain(TERM.senseHere!);
  });

  it("opens a term chip to its one-line sense and a link into Glossary", async () => {
    await draw(owner(), view({ card: CARD }));
    const chip = host.querySelector<HTMLButtonElement>(".traj-chip")!;
    expect(chip.getAttribute("aria-expanded")).toBe("false");
    await act(async () => chip.click());
    expect(chip.getAttribute("aria-expanded")).toBe("true");
    expect(text(".traj-sense")).toContain(TERM.senseHere!);
    await act(async () => host.querySelector<HTMLButtonElement>(".traj-sense .traj-link")!.click());
    expect(calls).toEqual([`open term ${TERM.id}`]);
  });

  it("links an idea and an event into their modes, and leaves the FAQ question as text", async () => {
    await draw(owner(), view({ card: CARD }));
    const buttons = [...host.querySelectorAll<HTMLButtonElement>(".traj-card .traj-link")];
    const byText = (t: string) => buttons.find((b) => b.textContent?.includes(t))!;
    await act(async () => byText("Synergy is not redundancy").click());
    await act(async () => byText("Recordings made").click());
    expect(byText("the passage")).toBeUndefined();
    expect(calls).toEqual(["open idea spya-id2abc", "open event spya-ev2abc"]);
  });

  it("keeps an experimental event as scrapbook text when its mode control is hidden", async () => {
    await draw(
      owner(),
      view({
        card: CARD,
        canOpen: (target) => target.kind !== "event",
      }),
    );
    expect(text(".traj-card")).toContain("Recordings made");
    const links = [...host.querySelectorAll<HTMLButtonElement>(".traj-card .traj-link")];
    expect(links.some((button) => button.textContent?.includes("Recordings made"))).toBe(false);
  });

  it("offers to plan it again under a ready route, rebuilding the route only (5e)", async () => {
    let regenerated = 0;
    let ensured = 0;
    const o = owner({
      regenerate: async () => void regenerated++,
      ensure: async () => void ensured++,
    });
    await draw(o, view());
    const again = [...host.querySelectorAll<HTMLButtonElement>(".traj-again button")];
    expect(again.map((b) => b.textContent)).toEqual(["Plan it again"]);
    await act(async () => again[0]!.click());
    expect([regenerated, ensured]).toEqual([1, 0]);
  });

  it("does not offer it twice when the outdated banner already does", async () => {
    await draw(owner({ outdated: true }), view());
    const buttons = [...host.querySelectorAll<HTMLButtonElement>("button")].filter(
      (b) => b.textContent === "Plan it again",
    );
    expect(buttons).toHaveLength(1);
    expect(host.querySelector(".traj-again")).toBeNull();
  });

  it("marks where each stop sits in the article, the current one in the accent (5b)", async () => {
    const v = view();
    const positions = [0.8, 0.1, 0.55];
    await draw(owner(), view({ rows: v.rows.map((r, i) => ({ ...r, position: positions[i]! })) }));
    const rows = [...host.querySelectorAll<HTMLElement>(".traj-row")];
    const dots = rows.map((r) => r.querySelector<HTMLElement>(".traj-pos-dot"));
    expect(dots.map((d) => d?.style.top)).toEqual(["80%", "10%", "55%"]);
    /* Inside the number's column, so it takes no width of its own (plan 260929a § 4). */
    expect(rows[0]!.querySelector(".traj-n .traj-pos")).not.toBeNull();
    expect(dots.map((d) => d?.classList.contains("on"))).toEqual([false, true, false]);
    /* Drawn for the eye; said in words for a screen reader. */
    expect(rows[0]!.querySelector(".traj-pos")?.getAttribute("aria-hidden")).toBe("true");
    expect(rows[0]!.querySelector(".traj-pos-said")?.textContent).toBe("about 80% of the way through");
    expect(rows[1]!.querySelector(".traj-pos-said")?.classList.contains("sr-only")).toBe(true);
  });

  it("draws no track for a stop it cannot place", async () => {
    await draw(owner(), view());
    expect(host.querySelector(".traj-pos")).toBeNull();
    expect(host.querySelector(".traj-pos-said")).toBeNull();
  });

  it("says when the Quotes will be chosen first", async () => {
    const empty = view({ rows: [], position: 0, depth: null });
    await draw(owner({ status: "none", trajectory: null, quotesFirst: true }), empty);
    expect(text(".gloss-hint")).toContain("Quotes are chosen first");
    await draw(owner({ status: "none", trajectory: null }), empty);
    expect(text(".gloss-hint")).not.toContain("chosen first");
  });

  it("says before the press that the Ideas are found first, and that they are the long part (Sol F64)", async () => {
    const empty = view({ rows: [], position: 0, depth: null });
    await draw(owner({ status: "none", trajectory: null, quotesFirst: true, ideasFirst: true }), empty);
    expect(text(".gloss-hint")).toContain("Quotes are chosen and its key Ideas found");
    expect(text(".gloss-hint")).toContain("finding the Ideas is the long part");
    await draw(owner({ status: "none", trajectory: null, ideasFirst: true }), empty);
    expect(text(".gloss-hint")).toContain("key Ideas are found — the long part");
    expect(text(".gloss-hint")).not.toContain("Quotes are chosen");
    await draw(owner({ status: "none", trajectory: null }), empty);
    expect(text(".gloss-hint")).not.toContain("Ideas");
    expect(text(".gloss-hint")).toContain("a few seconds");
  });

  it("offers to plan a route when there is none", async () => {
    await draw(owner({ status: "none", trajectory: null }), view({ rows: [], position: 0, depth: null }));
    expect(host.querySelector(".band-head")).toBeNull();
    expect(text(".gloss-empty")).toContain("Nobody has planned a route");
  });
});

describe("the door in the prose", () => {
  const door = (props: Partial<Parameters<typeof TrajectoryDoor>[0]>) =>
    createElement(TrajectoryDoor, {
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
    expect(text(".traj-door-cue")).toBe("End of Gist — 5 stops.");
    await act(async () => buttons[0]!.click());
    expect(deeper).toBe(1);
  });

  it("offers no button at the end of the deepest pass, only the line saying which pass ended (51)", async () => {
    await act(async () => root.render(door({ door: { kind: "end", pass: "Most", count: 1, deeper: null } })));
    expect(host.querySelectorAll("button")).toHaveLength(0);
    expect(text(".traj-door-cue")).toBe("End of Most — 1 stop.");
  });

  it("says under the next-stop door where it leads — the next stop's cue, small and muted", async () => {
    await act(async () => root.render(door({ door: { kind: "next", cue: "Look for the headline comparison." } })));
    expect(text(".traj-door-cue")).toBe("Look for the headline comparison.");
    await act(async () => root.render(door({ door: { kind: "next", cue: null } })));
    expect(host.querySelector(".traj-door-cue")).toBeNull();
  });

  it("draws nothing with no door and no band to bring back", async () => {
    await act(async () => root.render(door({})));
    expect(host.innerHTML).toBe("");
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
  error: null,
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
let control: TrajectoryControl | null = null;
let away = 0;

function Harness({ covers = false, stepped = false, arrival }: { covers?: boolean; stepped?: boolean; arrival?: TrajectoryArrival }) {
  const ownArrival = useRef<TrajectoryArrival>({
    stop: new URLSearchParams(location.search).get("stop"),
    open: false,
  });
  const [found, setFound] = useState<Found[]>([]);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const onFound = useCallback((f: Found[]) => {
    published = f;
    setFound(f);
  }, []);
  const onControl = useCallback((c: TrajectoryControl | null) => {
    control = c;
  }, []);
  return createElement(
    NuqsAdapter,
    null,
    createElement("div", { id: "state", "data-found": String(found.length), "data-open": openKey ?? "" }),
    createElement(TrajectoryBand, {
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
      onOpen: (target: { kind: string; id: string }) => void opened.push(`${target.kind} ${target.id}`),
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
  error: null,
  reload: async () => {},
  refresh: async () => {},
  patchEntry: () => {},
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
const current = () => host.querySelector(".traj-row.current")?.getAttribute("data-stop") ?? null;

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
    expect([param("depth"), param("stop")]).toEqual(["2", Q[2]]);
    expect(scrolled).toEqual([B[2]]);
    expect(text(".band-head")).toContain("Stop 1 of 3");
  });

  it("offers nothing past the end of the deepest pass", async () => {
    history.replaceState(null, "", `/read/a-route?mode=trajectory&depth=3&stop=${Q[1]}`);
    await mount();
    expect(control?.door).toEqual({ kind: "end", pass: "Most", count: 4, deeper: null });
    await act(async () => control!.deeper());
    await settled();
    expect(param("stop"), "no deeper pass: nothing moves").toBe(Q[1]);
  });

  it("does not go round on a depth button pressed at the end of a pass — it keeps your place", async () => {
    history.replaceState(null, "", `/read/a-route?mode=trajectory&depth=1&stop=${Q[0]}`);
    await mount();
    scrolled.length = 0;
    await act(async () => host.querySelectorAll<HTMLButtonElement>(".traj-depth")[1]!.click());
    await settled();
    expect([param("depth"), param("stop")]).toEqual(["2", Q[0]]);
    expect(scrolled).toEqual([]);
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
      if (this.classList.contains("traj-row") && this.classList.contains("current")) return rect(rowAt.top, rowAt.bottom);
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
      if (this.classList.contains("traj-row") && this.classList.contains("current")) return rect(500, 540);
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

  it("keeps the reader's place on a depth change that is not the end of a pass", async () => {
    await mount();
    scrolled.length = 0;
    await act(async () => host.querySelectorAll<HTMLButtonElement>(".traj-depth")[2]!.click());
    await settled();
    expect([param("depth"), param("stop")]).toEqual(["3", Q[2]]);
    expect(scrolled, "staying put is not a scroll").toEqual([]);
  });

  it("falls back to the first stop when ?stop= names nothing on the pass", async () => {
    history.replaceState(null, "", `/read/a-route?mode=trajectory&depth=1&stop=${Q[1]}`);
    await mount();
    expect(current()).toBe(Q[2]);
  });

  it("dims the stops of a shallower pass once the depth goes up", async () => {
    history.replaceState(null, "", "/read/a-route?mode=trajectory&depth=3");
    await mount();
    const rows = [...host.querySelectorAll<HTMLElement>(".traj-row")];
    expect(rows.map((r) => r.classList.contains("seen"))).toEqual([true, true, true, false]);
    expect(rows.map((r) => r.querySelector(".traj-place")?.textContent)).toEqual([
      "Methods",
      "Results",
      "Methods",
      "Results",
    ]);
  });

  it("steps aside on a narrow window when a stop is chosen from the band", async () => {
    await mount(true);
    await act(async () => host.querySelectorAll<HTMLButtonElement>(".traj-go")[1]!.click());
    await settled();
    expect(away).toBe(1);
    expect(scrolled).toContain(`jump ${B[0]}`);
    expect(param("stop")).toBe(Q[0]);
  });

  it("places each row's stop in the article by its words (5b)", async () => {
    history.replaceState(null, "", "/read/a-route?mode=trajectory&depth=3");
    await mount();
    /* Four blocks of seven words each; route order is blocks 2, 0, 3, 1. */
    const left = [...host.querySelectorAll<HTMLElement>(".traj-pos-dot")].map((d) => d.style.top);
    expect(left).toEqual(["63%", "13%", "88%", "38%"]);
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

  it("flashes on ‹ › in the band too, and steps aside after on a narrow window (5a)", async () => {
    await mount(true);
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Next stop"]')!.click());
    await settled();
    expect(flashed).toEqual([B[0]]);
    expect(away).toBe(1);
  });

  it("steps aside on ← → and on a depth change that moves, as on ‹ › (Sol F29)", async () => {
    await mount(true);
    /* A depth change that keeps the stop moves nobody, so the band stays. */
    await act(async () => host.querySelectorAll<HTMLButtonElement>(".traj-depth")[2]!.click());
    await settled();
    expect([param("stop"), flashed, away]).toEqual([Q[2], [], 0]);
    /* The keys reach the band through the published control, not the panel. */
    await act(async () => void control!.step(1));
    await settled();
    expect([flashed, away]).toEqual([[B[0]], 1]);
    /* The door, to the next stop on Most. */
    await act(async () => control!.advance());
    await settled();
    expect([flashed, away]).toEqual([[B[0], B[3]], 2]);
    /* Back to Gist, which does not have that stop: the reader is moved. */
    await act(async () => host.querySelectorAll<HTMLButtonElement>(".traj-depth")[0]!.click());
    await settled();
    expect(param("depth")).toBe("1");
    expect(flashed).toHaveLength(3);
    expect(away).toBe(3);
  });

  it("flashes when going round again moves the reader, and not when a depth change keeps the stop (5a)", async () => {
    await mount();
    await act(async () => host.querySelectorAll<HTMLButtonElement>(".traj-depth")[2]!.click());
    await settled();
    expect(flashed, "the same stop: nothing was jumped to").toEqual([]);

    history.replaceState(null, "", `/read/a-route?mode=trajectory&depth=1&stop=${Q[0]}`);
    await mount();
    flashed.length = 0;
    await act(async () => control!.deeper());
    await settled();
    expect(param("stop")).toBe(Q[2]);
    expect(flashed).toEqual([B[2]]);
  });

  it("leaves a row press's quote flash to the jump it makes, so it flashes once (5a, 7b)", async () => {
    await mount();
    await act(async () => host.querySelectorAll<HTMLButtonElement>(".traj-go")[1]!.click());
    await settled();
    /* `onJump` → `beginJump` flashes in the real reader; the band adds none. */
    expect(scrolled).toEqual([`jump ${B[0]}`]);
    expect(jumpPassages).toEqual([`${Q[0]}:${B[0]}:0`]);
    expect(flashed).toEqual([]);
  });

  it("brings a deep link's stop into view and flashes it, once (5a, Sol F28)", async () => {
    history.replaceState(null, "", `/read/a-route?mode=trajectory&depth=2&stop=${Q[3]}`);
    await mount();
    expect(scrolled).toEqual([B[3]]);
    expect(flashed).toEqual([B[3]]);
    /* Once: a re-render, or the data settling, does not do it again. */
    await settled();
    expect([scrolled, flashed]).toEqual([[B[3]], [B[3]]]);
    /* And a step after it is its own arrival, not a second deep link. */
    await act(async () => void control!.step(-1));
    await settled();
    expect(flashed).toEqual([B[3], B[0]]);
  });

  it("does not re-arm the deep-link arrival when the Trajectory band remounts", async () => {
    history.replaceState(null, "", `/read/a-route?mode=trajectory&depth=2&stop=${Q[3]}`);

    function Mode({ trajectory }: { trajectory: boolean }) {
      const arrival = useRef<TrajectoryArrival>({
        stop: new URLSearchParams(location.search).get("stop"),
        open: false,
      });
      return trajectory
        ? createElement(Harness, { arrival: arrival.current })
        : createElement("div", { "data-mode": "plain" });
    }

    await act(async () => root.render(createElement(Mode, { trajectory: true })));
    await settled();
    expect([scrolled, flashed]).toEqual([[B[3]], [B[3]]]);

    await act(async () => root.render(createElement(Mode, { trajectory: false })));
    await act(async () => root.render(createElement(Mode, { trajectory: true })));
    await settled();

    expect([scrolled, flashed], "the initial (slug, stop) arrival is one-shot").toEqual([
      [B[3]],
      [B[3]],
    ]);
  });

  it("keeps one deep-link flash through StrictMode's synthetic cleanup", async () => {
    history.replaceState(null, "", `/read/a-route?mode=trajectory&depth=2&stop=${Q[3]}`);

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

  it("leaves the band open over a deep link on a narrow window", async () => {
    /* A shared link opens the band (Reader.tsx § bandAway); the flash is held
       behind it and fires when the band steps aside (flash.ts). */
    history.replaceState(null, "", `/read/a-route?mode=trajectory&depth=2&stop=${Q[3]}`);
    await mount(true);
    expect([scrolled, away]).toEqual([[B[3]], 0]);
  });

  it("lands a deep link whose stop is not on the pass on the first stop, without a push (Sol F4)", async () => {
    history.replaceState(null, "", `/read/a-route?mode=trajectory&depth=1&stop=${Q[1]}`);
    const before = history.length;
    await mount();
    expect([scrolled, flashed]).toEqual([[B[2]], [B[2]]]);
    expect(history.length).toBe(before);
  });

  it("jumps to the current stop when the mode is opened, once, as a jump the chip can undo (4K)", async () => {
    history.replaceState(null, "", "/read/a-route?mode=trajectory");
    const arrival: TrajectoryArrival = { stop: null, open: true };
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
    history.replaceState(null, "", `/read/a-route?mode=trajectory&depth=2&stop=${Q[3]}`);
    const arrival: TrajectoryArrival = { stop: Q[3]!, open: true };
    await act(async () => root.render(createElement(Harness, { arrival })));
    await settled();
    expect(scrolled).toEqual([B[3]]);
    expect(arrival).toEqual({ stop: null, open: false });
  });

  it("waits for the route before the opening jump, and does not jump on a remount it was not armed for", async () => {
    history.replaceState(null, "", "/read/a-route?mode=trajectory");
    const arrival: TrajectoryArrival = { stop: null, open: true };
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
    history.replaceState(null, "", "/read/a-route?mode=trajectory");
    const arrival: TrajectoryArrival = { stop: null, open: true };
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
    /* Not `["quotes", "trajectory"]`: the server re-runs Quotes whose prompt
       version is merely outdated, so naming them on every press re-bought and
       replaced a reader's Quotes on a route rebuild (browser check, 2026-09-28;
       the plan's F38). The Ideas are there too — outdated, which is not a
       reason to name them either. */
    ideasBody = IDEAS_BODY;
    await mount();
    await act(async () => host.querySelector<HTMLButtonElement>(".traj-again button")!.click());
    await settled();
    expect(posted).toEqual([{ slug: "a-route", steps: ["trajectory"], force: ["trajectory"] }]);
  });

  it("plans it again with the Ideas found first, unforced, when there are none (stage 6)", async () => {
    await mount();
    await act(async () => host.querySelector<HTMLButtonElement>(".traj-again button")!.click());
    await settled();
    expect(posted).toEqual([{ slug: "a-route", steps: ["ideas", "trajectory"], force: ["trajectory"] }]);
  });

  it("plans it again with stale Quotes chosen first, unforced (5e, Sol F30)", async () => {
    quotesRead = { ...QUOTES_READ, stale: true };
    ideasBody = IDEAS_BODY;
    await mount();
    await act(async () => host.querySelector<HTMLButtonElement>(".traj-again button")!.click());
    await settled();
    /* Only the route is forced; `stepIsDone` decides about the Quotes. */
    expect(posted).toEqual([{ slug: "a-route", steps: ["quotes", "trajectory"], force: ["trajectory"] }]);
  });

  it("keeps a route press pending until the Ideas read says whether it is stale", async () => {
    let answerIdeas!: (response: Response) => void;
    ideasReply = new Promise<Response>((resolve) => {
      answerIdeas = resolve;
    });
    await mount();

    await act(async () => host.querySelector<HTMLButtonElement>(".traj-again button")!.click());
    await settled();
    expect(posted, "must not plan against Ideas whose freshness is still unknown").toEqual([]);

    answerIdeas(
      new Response(JSON.stringify({ ...IDEAS_BODY, stale: true, outdated: false }), { status: 200 }),
    );
    await settled();
    expect(posted).toEqual([
      { slug: "a-route", steps: ["ideas", "trajectory"], force: ["trajectory"] },
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
    const card = host.querySelector(".traj-row.current .traj-card");
    expect([...(card?.querySelectorAll(".traj-chip") ?? [])].map((c) => c.textContent)).toEqual(["laboratory"]);
    /* Outdated, not stale, so it is shown (F19). */
    expect(card?.textContent).toContain("Fieldwork is the test");
    expect(requested.some((r) => r.url.startsWith("/api/ideas/"))).toBe(true);
    expect(requested.filter((r) => r.method !== "GET")).toEqual([]);

    await act(async () => {
      [...host.querySelectorAll<HTMLButtonElement>(".traj-card .traj-link")]
        .find((b) => b.textContent?.includes("Fieldwork"))!
        .click();
    });
    expect(opened).toEqual(["idea spya-id4ghj"]);
  });

  it("shows the Ideas the route's own job found, without a reload (Sol F61)", async () => {
    /* A fresh article: no Ideas when the band mounts. */
    await mount();
    const ideaReads = () => requested.filter((r) => r.url.startsWith("/api/ideas/")).length;
    const before = ideaReads();
    expect(before).toBeGreaterThan(0);
    expect(host.querySelector(".traj-row.current .traj-card")?.textContent ?? "").not.toContain(
      "Fieldwork is the test",
    );

    /* The route's job finishes, having found the Ideas on its way. */
    ideasBody = IDEAS_BODY;
    expect(finishers.length).toBeGreaterThan(0);
    await act(async () => {
      finishers.at(-1)!({ id: "job-t", slug: "a-route", status: "done", steps: [{ name: "ideas" }, { name: "trajectory" }] });
    });
    await settled();
    expect(ideaReads()).toBeGreaterThan(before);
    expect(host.querySelector(".traj-row.current .traj-card")?.textContent).toContain("Fieldwork is the test");
  });

  it("finds a plural the stored list never named, and draws no card from a stale glossary", async () => {
    history.replaceState(null, "", `/read/a-route?mode=trajectory&depth=1&stop=${Q[0]}`);
    await mount();
    expect([...host.querySelectorAll(".traj-row.current .traj-chip")].map((c) => c.textContent)).toEqual([
      "cohort",
    ]);
    glossaryRead = { ...GLOSSARY_READ, stale: true };
    await mount();
    expect(host.querySelector(".traj-card")).toBeNull();
  });

  it("shows the cue on the current row, and an old route's role where there is no cue", async () => {
    await mount();
    expect(text(".traj-row.current .traj-cue")).toBe("What does earlier work miss, by their account?");
    history.replaceState(null, "", `/read/a-route?mode=trajectory&depth=3&stop=${Q[1]}`);
    await mount();
    expect(text(".traj-row.current .traj-cue")).toBe("How they measured it");
  });

  it("hands the door the next stop's cue mid-pass, and the pass that ended at its end", async () => {
    await mount();
    expect(control?.door).toEqual({ kind: "next", cue: "Look for the headline comparison." });
    await act(async () => void control!.step(1));
    await settled();
    expect(control?.door).toEqual({ kind: "end", pass: "Gist", count: 2, deeper: "More" });
  });
});
