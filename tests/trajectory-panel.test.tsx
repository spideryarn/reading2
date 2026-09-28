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
import type { GlossaryEntry } from "../src/types.js";
import type { GlossaryRead } from "../src/web/useGlossary.js";
import type { StopCard } from "../src/web/stop-card.js";
import type { Found } from "../src/web/search-hits.js";
import type { UseTrajectory } from "../src/web/useTrajectory.js";
import type { QuotesRead } from "../src/web/useQuotes.js";
import type { TrajectoryControl, TrajectoryView } from "../src/web/modes/trajectory/TrajectoryMode.js";

/* ------------------------------------------------------------ the network -- */

let trajectoryBody: unknown = null;
/** The Ideas the stop card may show, or `null` for none (404). */
let ideasBody: unknown = null;
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
      return ideasBody === null
        ? new Response(null, { status: 404 })
        : new Response(JSON.stringify(ideasBody), { status: 200 });
    if (url.startsWith("/api/jobs")) return new Response(JSON.stringify({ jobs: [] }), { status: 200 });
    return new Response(null, { status: 404 });
  };
  return {
    ...real,
    apiFetch,
    fetchOk: async (url: string, init?: RequestInit) => apiFetch(url, init),
  };
});

/* Scrolls are recorded — jsdom has no layout, and the claim is that a step
   scrolls rather than pushes. comment-jump.test.ts does the same. */
const { scrolled, flashed } = vi.hoisted(() => ({ scrolled: [] as string[], flashed: [] as string[] }));
vi.mock("../src/web/scroll.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/web/scroll.js")>();
  /* The scroll settles at once, so a caller that flashes on "settled" does. */
  return {
    ...actual,
    scrollToBlock: (id: string, _behavior?: ScrollBehavior, done?: (o: "settled") => void) => {
      scrolled.push(id);
      done?.("settled");
    },
  };
});
/* The flash on arrival (stage 5a), recorded: jsdom has no prose to wash. */
vi.mock("../src/web/flash.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/web/flash.js")>();
  return {
    ...actual,
    flashBlock: (id: string) => void flashed.push(id),
    dropPendingFlash: () => {},
  };
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
  requested.length = 0;
  posted.length = 0;
  quotesRead = QUOTES_READ;
  ideasBody = null;
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
      { quoteId: Q[2]!, n: 1, place: "Methods", cue: "What earlier work missed", seen: true, current: false, missing: false, position: null },
      { quoteId: Q[0]!, n: 2, place: "Results", cue: "The headline result", seen: true, current: true, missing: false, position: null },
      { quoteId: Q[3]!, n: 3, place: "Methods", cue: "Where it stops holding", seen: false, current: false, missing: false, position: null },
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

  it("elides a repeated section path visually but keeps its words for a screen reader", async () => {
    const repeated = view({
      rows: [
        { quoteId: Q[2]!, n: 1, place: "Methods", cue: null, seen: false, current: false, missing: false, position: null },
        { quoteId: Q[3]!, n: 2, place: "Methods", cue: null, seen: false, current: false, missing: false, position: null },
      ],
      position: 1,
    });
    await draw(owner(), repeated);

    const places = [...host.querySelectorAll<HTMLElement>(".traj-place")];
    expect(places[0]?.textContent).toBe("Methods");
    expect(places[1]?.querySelector('[aria-hidden="true"]')?.textContent).toBe("〃");
    expect(places[1]?.querySelector(".sr-only")?.textContent).toBe("Methods");
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
    expect(text(".traj-foot .traj-note")).toBe(trajectoryPromise(false));
    const most = view({
      depth: 3,
      rows: [...view().rows, { quoteId: Q[1]!, n: 4, place: "Results", cue: null, seen: false, current: false, missing: false, position: null }],
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
    expect(dots.map((d) => d?.style.left)).toEqual(["80%", "10%", "55%"]);
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
      root.render(createElement(TrajectoryDoor, { label: "Next stop ›", cue: null, onPress: () => void pressed++, onRoute: null })),
    );
    expect([...host.querySelectorAll("button")].map((b) => b.textContent)).toEqual(["Next stop ›"]);
    await act(async () =>
      root.render(
        createElement(TrajectoryDoor, {
          label: "Go round again — More ›",
          cue: null,
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

  it("says under the door where it leads — the next stop's cue, small and muted", async () => {
    await act(async () =>
      root.render(
        createElement(TrajectoryDoor, {
          label: "Next stop ›",
          cue: "Look for the headline comparison.",
          onPress: () => {},
          onRoute: null,
        }),
      ),
    );
    expect(text(".traj-door-cue")).toBe("Look for the headline comparison.");
    await act(async () =>
      root.render(createElement(TrajectoryDoor, { label: "Next stop ›", cue: null, onPress: () => {}, onRoute: null })),
    );
    expect(host.querySelector(".traj-door-cue")).toBeNull();
  });

  it("draws nothing at the end of the deepest pass", async () => {
    await act(async () =>
      root.render(createElement(TrajectoryDoor, { label: null, cue: null, onPress: () => {}, onRoute: null })),
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
      quotes: quotesRead,
      quoteMarks: MARKS,
      covers,
      onAway: () => void away++,
      onJump: (id: BlockId) => void scrolled.push(`jump ${id}`),
      onFound,
      openKey,
      onOpenKey: setOpenKey,
      onControl,
      glossary: glossaryRead,
      onOpen: (target: { kind: string; id: string }) => void opened.push(`${target.kind} ${target.id}`),
      canOpen: () => true,
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

  it("places each row's stop in the article by its words (5b)", async () => {
    history.replaceState(null, "", "/read/a-route?mode=trajectory&depth=3");
    await mount();
    /* Four blocks of seven words each; route order is blocks 2, 0, 3, 1. */
    const left = [...host.querySelectorAll<HTMLElement>(".traj-pos-dot")].map((d) => d.style.left);
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
    await act(async () => control!.advance());
    await settled();
    expect(param("stop")).toBe(Q[3]);
    expect(flashed).toEqual([B[3]]);
  });

  it("leaves a row press's flash to the jump it makes, so it flashes once (5a)", async () => {
    await mount();
    await act(async () => host.querySelectorAll<HTMLButtonElement>(".traj-go")[1]!.click());
    await settled();
    /* `onJump` → `beginJump` flashes in the real reader; the band adds none. */
    expect(scrolled).toEqual([`jump ${B[0]}`]);
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

  it("leaves the band open over a deep link on a narrow window", async () => {
    /* A shared link opens the band (Reader.tsx § bandAway); the flash is held
       behind it and fires when the band steps aside (flash.ts). */
    history.replaceState(null, "", `/read/a-route?mode=trajectory&depth=2&stop=${Q[3]}`);
    await mount(true);
    expect([scrolled, away]).toEqual([[B[3]], 0]);
  });

  it("does nothing for a deep link whose stop is not on the pass", async () => {
    history.replaceState(null, "", `/read/a-route?mode=trajectory&depth=1&stop=${Q[1]}`);
    await mount();
    expect([scrolled, flashed]).toEqual([[], []]);
  });

  it("plans it again with the route forced, and nothing else when the Quotes are current (5e)", async () => {
    await mount();
    await act(async () => host.querySelector<HTMLButtonElement>(".traj-again button")!.click());
    await settled();
    expect(posted).toEqual([{ slug: "a-route", steps: ["trajectory"], force: ["trajectory"] }]);
  });

  it("plans it again with stale Quotes chosen first, unforced (5e, Sol F30)", async () => {
    quotesRead = { ...QUOTES_READ, stale: true };
    await mount();
    await act(async () => host.querySelector<HTMLButtonElement>(".traj-again button")!.click());
    await settled();
    /* Only the route is forced; `stepIsDone` decides about the Quotes. */
    expect(posted).toEqual([{ slug: "a-route", steps: ["quotes", "trajectory"], force: ["trajectory"] }]);
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

  it("hands the door the cue of the stop it leads to — the next one, or the first new one round again", async () => {
    await mount();
    expect(control?.doorCue).toBe("Look for the headline comparison.");
    await act(async () => void control!.step(1));
    await settled();
    expect(control?.door).toBe("Go round again — More ›");
    expect(control?.doorCue).toBe("Where does it stop holding?");
  });
});
