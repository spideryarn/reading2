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
import { act, createElement, useCallback, useState } from "react";
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
import type { Found } from "../src/web/search-hits.js";
import type { UseTrajectory } from "../src/web/useTrajectory.js";
import type { QuotesRead } from "../src/web/useQuotes.js";
import type { TrajectoryControl, TrajectoryView } from "../src/web/modes/trajectory/TrajectoryMode.js";

/* ------------------------------------------------------------ the network -- */

let trajectoryBody: unknown = null;
vi.mock("../src/web/lib/api.js", async () => {
  const real = await vi.importActual<typeof import("../src/web/lib/api.js")>(
    "../src/web/lib/api.js",
  );
  const apiFetch = async (url: string) => {
    if (url.startsWith("/api/trajectory/"))
      return trajectoryBody === null
        ? new Response(null, { status: 404 })
        : new Response(JSON.stringify(trajectoryBody), { status: 200 });
    if (url.startsWith("/api/jobs")) return new Response(JSON.stringify({ jobs: [] }), { status: 200 });
    return new Response(null, { status: 404 });
  };
  return {
    ...real,
    apiFetch,
    fetchOk: async (url: string) => apiFetch(url),
  };
});

/* Scrolls are recorded — jsdom has no layout, and the claim is that a step
   scrolls rather than pushes. comment-jump.test.ts does the same. */
const { scrolled } = vi.hoisted(() => ({ scrolled: [] as string[] }));
vi.mock("../src/web/scroll.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/web/scroll.js")>();
  return { ...actual, scrollToBlock: (id: string) => void scrolled.push(id) };
});

const { TrajectoryPanel, TrajectoryDoor, coverageNote, trajectoryPromise } = await import(
  "../src/web/TrajectoryPanel.js"
);
const { TrajectoryBand } = await import("../src/web/modes/trajectory/TrajectoryMode.js");
const { resolveQuotes } = await import("../src/web/search-hits.js");
const { quoteStroke } = await import("../src/web/QuotesPanel.js");

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
  { quoteId: Q[2]!, depth: 1, role: "What earlier work missed" },
  { quoteId: Q[0]!, depth: 1, role: "The headline result" },
  { quoteId: Q[3]!, depth: 2, role: "Where it stops holding" },
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
      { quoteId: Q[2]!, n: 1, place: "Methods", role: "What earlier work missed", seen: true, current: false, missing: false },
      { quoteId: Q[0]!, n: 2, place: "Results", role: "The headline result", seen: true, current: true, missing: false },
      { quoteId: Q[3]!, n: 3, place: "Methods", role: "Where it stops holding", seen: false, current: false, missing: false },
    ],
    position: 2,
    onDepth: (d) => void calls.push(`depth ${d}`),
    onRow: (id) => void calls.push(`row ${id}`),
    onStep: (dir) => void calls.push(`step ${dir}`),
    ...over,
  };
}

async function draw(o: UseTrajectory, v: TrajectoryView, quoteCount = 4) {
  calls.length = 0;
  await act(async () => root.render(createElement(TrajectoryPanel, { owner: o, view: v, quoteCount })));
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

  it("shows the role on the current row only, and the place on every row", async () => {
    await draw(owner(), view());
    const rows = [...host.querySelectorAll<HTMLElement>(".traj-row")];
    expect(rows.map((r) => r.querySelector(".traj-place")?.textContent)).toEqual([
      "Methods",
      "Results",
      "Methods",
    ]);
    expect(rows.map((r) => r.querySelector(".traj-role")?.textContent ?? null)).toEqual([
      null,
      "The headline result",
      null,
    ]);
    expect(host.textContent).not.toContain("What earlier work missed");
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

  it("disables the arrow at each end, because the route does not wrap", async () => {
    await draw(owner(), view({ position: 1 }));
    expect(host.querySelector<HTMLButtonElement>('[aria-label="Previous stop"]')!.disabled).toBe(true);
    await draw(owner(), view({ position: 3 }));
    expect(host.querySelector<HTMLButtonElement>('[aria-label="Next stop"]')!.disabled).toBe(true);
  });

  it("keeps the promise in the foot, and says how much of the Quotes Most walks", async () => {
    await draw(owner(), view());
    expect(text(".traj-foot")).toBe(trajectoryPromise(false));
    const most = view({
      depth: 3,
      rows: [...view().rows, { quoteId: Q[1]!, n: 4, place: "Results", role: null, seen: false, current: false, missing: false }],
    });
    await draw(owner(), most, 4);
    expect(text(".traj-foot")).toContain("every one of the article's 4 quotes");
    await draw(owner(), most, 6);
    expect(text(".traj-foot")).toContain("4 of the article's 6 quotes");
    expect(coverageNote(4, 0)).toBeNull();
  });

  it("says how many quotes are not on a stale route, and offers to plan it again", async () => {
    await draw(owner({ stale: true, notOnRoute: 3 }), view());
    expect(text(".gloss-stale")).toContain("3 are not on it");
  });

  it("offers to plan a route when there is none", async () => {
    await draw(owner({ status: "none", trajectory: null }), view({ rows: [], position: 0, depth: null }));
    expect(host.querySelector(".band-head")).toBeNull();
    expect(text(".gloss-empty")).toContain("Nobody has planned a route");
  });
});

describe("the door in the prose", () => {
  it("offers the next stop, and the band back only when asked to", async () => {
    let pressed = 0;
    let back = 0;
    await act(async () =>
      root.render(createElement(TrajectoryDoor, { label: "Next stop ›", onPress: () => void pressed++, onRoute: null })),
    );
    expect([...host.querySelectorAll("button")].map((b) => b.textContent)).toEqual(["Next stop ›"]);
    await act(async () =>
      root.render(
        createElement(TrajectoryDoor, {
          label: "Go round again — More ›",
          onPress: () => void pressed++,
          onRoute: () => void back++,
        }),
      ),
    );
    const buttons = [...host.querySelectorAll<HTMLButtonElement>("button")];
    expect(buttons.map((b) => b.textContent)).toEqual(["All stops", "Go round again — More ›"]);
    await act(async () => buttons[1]!.click());
    await act(async () => buttons[0]!.click());
    expect([pressed, back]).toEqual([1, 1]);
  });

  it("draws nothing at the end of the deepest pass", async () => {
    await act(async () =>
      root.render(createElement(TrajectoryDoor, { label: null, onPress: () => {}, onRoute: null })),
    );
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

/** The prose's quote marks, as `useQuoteMarks` would have built them. */
const MARKS: Found[] = resolveQuotes(
  BLOCKS,
  QUOTE_LIST.map((q) => ({ ...q, stroke: quoteStroke(q) })),
);

let published: Found[] = [];
let control: TrajectoryControl | null = null;
let away = 0;

function Harness({ covers = false }: { covers?: boolean }) {
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
      quotes: QUOTES_READ,
      quoteMarks: MARKS,
      covers,
      onAway: () => void away++,
      onJump: (id: BlockId) => void scrolled.push(`jump ${id}`),
      onFound,
      openKey,
      onOpenKey: setOpenKey,
      onControl,
    }),
  );
}

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
    expect(control?.door).toBe("Next stop ›");
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
    expect(control?.door).toBe("Go round again — More ›");
  });

  it("goes round again from the end of a pass: one pushed entry, depth and stop together", async () => {
    await mount();
    await act(async () => void control!.step(1));
    await settled();
    const before = history.length;
    scrolled.length = 0;
    await act(async () => control!.advance());
    await settled();
    expect(history.length, "one entry for the depth and the stop").toBe(before + 1);
    expect([param("depth"), param("stop")]).toEqual(["2", Q[3]]);
    expect(scrolled).toEqual([B[3]]);
    expect(text(".band-head")).toContain("Stop 3 of 3");
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

  it("takes its passage and its handle with it when it goes", async () => {
    await mount();
    expect(control).not.toBeNull();
    await act(async () => root.render(createElement(NuqsAdapter, null, createElement("div"))));
    expect(control).toBeNull();
    expect(published).toEqual([]);
  });
});
