// @vitest-environment jsdom
/**
 * **Simple — Summary's plain-words levels**, on the client
 * (docs/plans/260930i-simple-summaries-eli15-sub-mode.md stage 2, and the
 * slider and levels of
 * docs/plans/261001b-summary-controls-in-one-row-and-two-plain-words-levels-shaped-by-profile-and-goal.md).
 *
 * Three parts:
 *
 *  1. **The view.** The chosen level's paragraphs, each plain text followed by
 *     a `BlockRef` door per id; no description line (7B); *stale* draws the
 *     notice and *outdated* draws nothing; a changed profile offers a rewrite;
 *     a visitor gets the stored paragraphs and no verb, or a line saying none
 *     has been made.
 *  2. **The press.** The real `SummaryControls` slider over the real
 *     `useSimple`, under `<StrictMode>`, counting job requests the way
 *     tests/modes-that-start-themselves.test.tsx does: choosing a level with
 *     nothing stored buys exactly one run; arriving on a level (a pasted link,
 *     a Back step, a restore — all the same setter) buys nothing; and a second
 *     press recovers from a failed read.
 *  3. **The band**: the real `SummaryBand` and `VisitorSummaryBand` on an old
 *     outline link, which must land on the default level with no Parts |
 *     Sections anywhere (plan 261001p).
 */
import { act, createElement, type ReactElement, StrictMode, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BlockId, Job, SimpleLevel, SimpleSummary } from "../src/types.js";
import type { UseSimple } from "../src/web/useSimple.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/* ------------------------------------------------------------ the network -- */

const gets: string[] = [];
const posts: { slug: string; steps: string[]; force?: string[] }[] = [];
/** What `GET /api/simple/:slug` answers: 404 is "nobody has asked for one yet". */
let artefactStatus = 404;
/** Whether the GET rejects outright — a dead network, not a 404. */
let artefactFails = false;

/* Real ids: `ID_PATTERN` rejects `1`, `i`, `l` and `o`. docs/project/block-ids.md. */
const EARLY = "spya-f4q7tw" as BlockId;
const MIDDLE = "spya-k3m9qt" as BlockId;
const LATER = "spya-r8z3nh" as BlockId;

const WHAT = "This essay asks whether a machine could ever be conscious, and says probably not.";
const WHY = "It matters because people are starting to treat chatbots as if they had feelings.";

const BRIEF_TEXT = "A short one: could a machine feel? Probably not.";
const FULLER_TEXT = "The fuller one keeps the essay's own term, the hard problem, and says what it means.";

function artefact(): SimpleSummary {
  return {
    version: "simple/2",
    generator: "test",
    slug: "a-piece",
    sourceHash: "hash",
    generatedAt: "2026-09-30T09:00:00.000Z",
    elapsedMs: 1,
    profileHash: null,
    levels: {
      brief: [
        { text: BRIEF_TEXT, ids: [EARLY] },
        { text: "It matters for chatbots.", ids: [LATER] },
      ],
      simple: [
        { text: WHAT, ids: [EARLY, MIDDLE] },
        { text: WHY, ids: [LATER] },
      ],
      fuller: [
        { text: FULLER_TEXT, ids: [EARLY] },
        { text: WHY, ids: [LATER] },
        { text: "And it says where the argument stops.", ids: [MIDDLE] },
      ],
    },
  };
}

vi.mock("../src/web/lib/api.js", () => ({
  apiFetch: async (url: string) => {
    gets.push(url);
    if (artefactFails) throw new Error("network");
    return artefactStatus === 404
      ? new Response(null, { status: 404 })
      : new Response(JSON.stringify({ simpleSummary: artefact(), stale: false, outdated: false, profileChanged: false }), {
          status: 200,
        });
  },
  readJson: async (res: Response) => res.json(),
  fetchOk: async () => new Response(null, { status: 204 }),
  failure: async (res: Response) => new Error(String(res.status)),
}));

let nextJobId = 0;
const jobs: Job[] = [];
vi.mock("../src/web/useJobs.js", async () => {
  const actual = await vi.importActual<typeof import("../src/web/useJobs.js")>("../src/web/useJobs.js");
  return {
    ...actual,
    useJobs: () => ({
      jobs,
      loaded: true,
      error: null,
      driverFailures: {},
      lastFailure: () => "The queue said no.",
      run: async (request: { slug: string; steps: string[]; force?: string[] }) => {
        posts.push(request);
        nextJobId += 1;
        return { id: `job${nextJobId}` };
      },
      cancel: async () => {},
      add: async () => null,
      addUpload: async () => null,
      retry: async () => {},
      forget: async () => {},
    }),
  };
});

const { SIMPLE_NONE_OWNER, SIMPLE_NONE_VISITOR, SimplePanel } = await import(
  "../src/web/SimplePanel.js"
);
const { BlockLinkProvider } = await import("../src/web/BlockLinkCard.js");
const { SummaryBand, SummaryControls, VisitorSummaryBand } = await import(
  "../src/web/modes/summary/SummaryMode.js"
);
const { useSimple } = await import("../src/web/useSimple.js");
const { resetActivations } = await import("../src/web/activation.js");
const { jobEngine } = await import("../src/web/jobEngine.js");

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  gets.length = 0;
  posts.length = 0;
  jobs.length = 0;
  nextJobId = 0;
  artefactStatus = 404;
  artefactFails = false;
  resetActivations();
  jobEngine.reset();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

async function settle(): Promise<void> {
  for (let i = 0; i < 6; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

/* ---------------------------------------------------------------- the view -- */

function owner(over: Partial<UseSimple> = {}): UseSimple {
  return {
    status: "ready",
    simple: artefact(),
    stale: false,
    outdated: false,
    profiled: false,
    profileChanged: false,
    slug: "a-piece",
    error: null,
    job: null,
    failed: null,
    stalled: false,
    starting: false,
    retryRead: async () => {},
    ensure: async () => {},
    regenerate: async () => {},
    cancel: () => {},
    ...over,
  };
}

const jumps: BlockId[] = [];

async function draw(
  access: Parameters<typeof SimplePanel>[0]["access"],
  level: SimpleLevel = "simple",
): Promise<void> {
  jumps.length = 0;
  await act(async () =>
    root.render(createElement(SimplePanel, { access, level, onJump: (id: BlockId) => void jumps.push(id) })),
  );
}

const text = (): string => host.textContent ?? "";

/** The foot Greg asked to go (SPIDERYARN-READING2-7B). */
const NO_FOOT = "Written by AI";

describe("the Simple view", () => {
  it("draws each paragraph as text, followed by a door for each of its passages", async () => {
    await draw({ kind: "owner", owner: owner() });
    const paras = [...host.querySelectorAll(".simple-para")];
    expect(paras).toHaveLength(2);
    expect(paras[0]?.querySelector(".simple-text")?.textContent).toBe(WHAT);
    expect(
      [...(paras[0]?.querySelectorAll("a.block-ref") ?? [])].map((a) => a.getAttribute("data-block-link")),
    ).toEqual([EARLY, MIDDLE]);
    expect(
      [...(paras[1]?.querySelectorAll("a.block-ref") ?? [])].map((a) => a.getAttribute("data-block-link")),
    ).toEqual([LATER]);
    expect(text()).not.toContain(NO_FOOT);
  });

  it("jumps to the passage when a door is clicked", async () => {
    await draw({ kind: "owner", owner: owner() });
    const door = host.querySelector<HTMLAnchorElement>(`a.block-ref[data-block-link="${LATER}"]`);
    expect(door).not.toBeNull();
    await act(async () => {
      door?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
    });
    expect(jumps).toEqual([LATER]);
  });

  it("opens the cited passage's card from a paragraph door", async () => {
    class FakeResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    const index = new Map([
      [EARLY, { text: "The opening evidence for the first paragraph.", section: "The question" }],
      [MIDDLE, { text: "The second piece of evidence.", section: "The question" }],
      [LATER, { text: "The passage explaining why it matters.", section: "Why it matters" }],
    ]);
    await act(async () => {
      root.render(
        <BlockLinkProvider index={index}>
          <SimplePanel
            access={{ kind: "owner", owner: owner() }}
            level="simple"
            onJump={(id: BlockId) => void jumps.push(id)}
          />
        </BlockLinkProvider>,
      );
    });
    const door = host.querySelector<HTMLAnchorElement>(`a.block-ref[data-block-link="${LATER}"]`);
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
      door?.focus();
      await Promise.resolve();
    });
    const card = document.querySelector<HTMLElement>(".tooltip-anchor");
    expect(card?.textContent).toContain("Why it matters");
    expect(card?.textContent).toContain("The passage explaining why it matters.");
  });

  it("renders a paragraph's markup as the characters, never as HTML", async () => {
    const simple = artefact();
    simple.levels.simple[0] = { text: "<b>bold</b> **stars**", ids: [EARLY] };
    await draw({ kind: "owner", owner: owner({ simple }) });
    expect(host.querySelector(".simple-text b")).toBeNull();
    expect(host.querySelector(".simple-text")?.textContent).toBe("<b>bold</b> **stars**");
  });

  it("says so when the article has moved, and offers to write it again", async () => {
    await draw({ kind: "owner", owner: owner({ stale: true }) });
    expect(host.querySelector(".gloss-stale")).not.toBeNull();
    expect(text()).toContain("older version of the article");
    expect(text()).toContain("Write it again");
    /* The paragraphs are still there under the notice. */
    expect(text()).toContain(WHAT);
  });

  it("draws the level the slider has chosen, and only that one", async () => {
    await draw({ kind: "owner", owner: owner() }, "brief");
    expect(text()).toContain(BRIEF_TEXT);
    expect(text()).not.toContain(WHAT);
    await draw({ kind: "owner", owner: owner() }, "fuller");
    expect(text()).toContain(FULLER_TEXT);
    expect(host.querySelectorAll(".simple-para")).toHaveLength(3);
    await draw({ kind: "visitor", simple: { levels: artefact().levels } }, "brief");
    expect(text()).toContain(BRIEF_TEXT);
  });

  it("offers to write it again once the reader has changed their profile, without a notice line", async () => {
    await draw({ kind: "owner", owner: owner({ profiled: true, profileChanged: true }) });
    expect(text()).toContain("Write it again");
    expect(host.querySelector(".gloss-stale")).toBeNull();
    expect(text()).toContain(WHAT);
    /* And not while the profile is the one they were written for. */
    await draw({ kind: "owner", owner: owner({ profiled: true, profileChanged: false }) });
    expect(text()).not.toContain("Write it again");
  });

  it("says nothing when only the prompt is older", async () => {
    await draw({ kind: "owner", owner: owner({ outdated: true }) });
    expect(host.querySelector(".gloss-stale")).toBeNull();
    expect(text()).not.toContain("older version");
    expect(text()).not.toContain("Write it again");
    expect(text()).toContain(WHAT);
  });

  it("does not say nobody has asked while the press's own run is starting", async () => {
    /* Since 2026-10-02 opening Summary starts the run (plan 261002a), so the
       empty state is drawn with a job under way; "Nobody has asked" beside
       "Writing it in plain words" read as a contradiction in the browser check. */
    await draw({ kind: "owner", owner: owner({ status: "none", simple: null, starting: true }) });
    expect(text()).not.toContain(SIMPLE_NONE_OWNER);
    expect(text()).toContain("All three levels are written together");
  });

  it("offers to write it when there is none, and shows why a run failed", async () => {
    await draw({ kind: "owner", owner: owner({ status: "none", simple: null }) });
    expect(text()).toContain(SIMPLE_NONE_OWNER);
    expect(text()).toContain("Write it");

    await draw({
      kind: "owner",
      owner: owner({
        status: "none",
        simple: null,
        failed: { message: "The AI service is busy right now.", retryable: true, retry: null },
      }),
    });
    expect(text()).toContain("The AI service is busy right now.");
    /* A way to try again: the run button is still drawn for a retryable failure. */
    expect([...host.querySelectorAll("button")].some((b) => b.textContent?.includes("Write it"))).toBe(
      true,
    );
  });

  it("offers to read again after a failed read, without offering a run", async () => {
    await draw({ kind: "owner", owner: owner({ status: "error", simple: null, error: "Could not reach the server." }) });
    expect(text()).toContain("Could not reach the server.");
    expect(text()).toContain("Try again");
    expect(text()).not.toContain("Write it");
  });

  it("gives a visitor the stored paragraphs and their doors, and nothing to press", async () => {
    await draw({ kind: "visitor", simple: { levels: artefact().levels } });
    expect(host.querySelectorAll(".simple-para")).toHaveLength(2);
    expect(host.querySelectorAll("a.block-ref")).toHaveLength(3);
    expect(text()).not.toContain(NO_FOOT);
    expect(host.querySelectorAll("button")).toHaveLength(0);
  });

  it("tells a visitor none has been made yet", async () => {
    await draw({ kind: "visitor", simple: null });
    expect(text()).toContain(SIMPLE_NONE_VISITOR);
    expect(host.querySelectorAll("button")).toHaveLength(0);
  });
});

/* --------------------------------------------------------------- the press -- */

/** The owner's band, reduced: the real slider and, under a level, the real hook. */
function SimpleProbe({ slug }: { slug: string }): ReactElement {
  const view = useSimple(slug);
  return createElement("div", { "data-band": "simple" }, view.starting ? "starting" : view.status);
}

/** The address-bar setter, which is what a pasted link, Back and a restore all reach. */
let arrive: (next: SimpleLevel) => void = () => {};

function Band({ slug, start }: { slug: string; start: SimpleLevel }): ReactElement {
  const [view, setView] = useState<SimpleLevel>(start);
  arrive = setView;
  return createElement(
    "div",
    null,
    createElement(SummaryControls, { slug, value: view, onChange: setView }),
    /* One element for every level, so moving between levels keeps the hook
       mounted — as `OwnerSimple` does in the real band. */
    createElement(SimpleProbe, { slug }),
  );
}

async function open(start: SimpleLevel): Promise<void> {
  await act(async () => {
    root.render(createElement(StrictMode, null, createElement(Band, { slug: "a-piece", start })));
  });
  await settle();
}

function slider(): HTMLInputElement {
  const found = host.querySelector<HTMLInputElement>(".summ-slider input[type=range]");
  if (!found) throw new Error("no plain-words slider");
  return found;
}

/** A click on the slider where it rests, on Simple — a press on the level showing. */
async function pressSimple(): Promise<void> {
  const input = slider();
  await act(async () => input.click());
  await settle();
}

/** A drag or an arrow key to a stop. */
async function slideTo(stop: number): Promise<void> {
  const input = slider();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, String(stop));
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await settle();
}

const simpleGets = (): string[] => gets.filter((u) => u.startsWith("/api/simple/"));

describe("choosing a plain-words level", () => {
  it("writes them when nothing is stored, once", async () => {
    await open("simple");
    expect(posts, "arriving buys nothing").toEqual([]);
    await pressSimple();
    expect(simpleGets().length).toBeGreaterThan(0);
    expect(posts).toEqual([{ slug: "a-piece", steps: ["simple"] }]);
  });

  it("writes them once when the reader goes straight to Fuller", async () => {
    await open("simple");
    await slideTo(2);
    expect(posts).toEqual([{ slug: "a-piece", steps: ["simple"] }]);
  });

  it("goes to an end, and arms, from the icon at that end", async () => {
    await open("simple");
    const ends = [...host.querySelectorAll<HTMLButtonElement>(".summ-slider .summ-slider-end")];
    expect(ends, "an icon at each end").toHaveLength(2);
    /* They are real shortcuts, not decoration: a keyboard and a screen reader
       get the same Brief/Fuller jumps as a pointer. */
    expect(ends.map((end) => end.getAttribute("aria-label"))).toEqual([
      "Show Brief summary",
      "Show Fuller summary",
    ]);
    expect(ends.map((end) => end.tabIndex)).toEqual([0, 0]);
    expect(ends.some((end) => end.hasAttribute("aria-hidden"))).toBe(false);
    await act(async () => ends[1]?.click());
    await settle();
    expect(slider().getAttribute("aria-valuetext")).toBe("Fuller");
    expect(posts).toEqual([{ slug: "a-piece", steps: ["simple"] }]);
    await act(async () => ends[0]?.click());
    await settle();
    expect(slider().getAttribute("aria-valuetext")).toBe("Brief");
    expect(posts, "one run writes every level").toEqual([{ slug: "a-piece", steps: ["simple"] }]);
  });

  it("does not write them a second time when pressed again, or moved to another level", async () => {
    await open("simple");
    await pressSimple();
    await pressSimple();
    await slideTo(0);
    expect(posts).toEqual([{ slug: "a-piece", steps: ["simple"] }]);
  });

  it("writes nothing when they are already stored", async () => {
    artefactStatus = 200;
    await open("simple");
    await pressSimple();
    await slideTo(2);
    expect(simpleGets().length).toBeGreaterThan(0);
    expect(posts).toEqual([]);
  });

  it("recovers from a failed read on a second press", async () => {
    artefactFails = true;
    await open("simple");
    await pressSimple();
    expect(posts, "a failed read is not an answer").toEqual([]);

    artefactFails = false;
    await pressSimple();
    expect(posts).toEqual([{ slug: "a-piece", steps: ["simple"] }]);
  });
});

describe("arriving at a level without choosing it", () => {
  it("spends nothing on a pasted link or a restore", async () => {
    await open("fuller");
    /* The read settled — so "no POST" is about a panel that knows it is empty. */
    expect(simpleGets().length).toBeGreaterThan(0);
    expect(host.querySelector('[data-band="simple"]')?.textContent).toBe("none");
    expect(posts).toEqual([]);
  });

  it("spends nothing on a Back step into it", async () => {
    await open("brief");
    await act(async () => arrive("simple"));
    await settle();
    expect(simpleGets().length).toBeGreaterThan(0);
    expect(posts).toEqual([]);
  });
});

/* ------------------------------------------------------------ the band -- */

/**
 * **Summary is the slider and the paragraphs, and nothing else** — Greg,
 * 2026-10-01 (spya-b3ggv4): *"let's just get rid of parts and sections"*.
 * docs/plans/261001p-summary-loses-parts-and-sections-a-touch-wider.md.
 *
 * The real bands, under the real address bar, on the address an old link
 * carries: `?summary=gists&deep=2` was the outline at Sections. It must land
 * on the default plain-words level, with no Parts | Sections pair and no
 * outline anywhere in the band, for the owner and for a visitor.
 */
describe("Summary's band, arriving on an old outline link", () => {
  const OLD_LINK = "/read/a-piece?mode=summary&summary=gists&deep=2";

  async function band(which: "owner" | "visitor"): Promise<void> {
    history.replaceState(null, "", OLD_LINK);
    const { NuqsAdapter } = await import("nuqs/adapters/react");
    const inner =
      which === "owner"
        ? createElement(SummaryBand, { slug: "a-piece", onJump: () => {} })
        : createElement(VisitorSummaryBand, { simple: { levels: artefact().levels }, onJump: () => {} });
    await act(async () => {
      root.render(createElement(NuqsAdapter, null, inner));
    });
    await settle();
  }

  function noOutline(): void {
    const labels = [...host.querySelectorAll("button, legend")].map((el) => el.textContent?.trim());
    expect(labels, "no Parts | Sections pair").not.toContain("Parts");
    expect(labels).not.toContain("Sections");
    expect(labels, "no outline group").not.toContain("Outline");
    expect(host.querySelector(".summ-pill"), "no pills").toBeNull();
    expect(host.querySelector(".summ-list"), "no gist outline").toBeNull();
    expect(host.querySelectorAll(".mode-band.summ"), "one Summary band").toHaveLength(1);
    expect(host.querySelectorAll(".summ-controls"), "one row of controls").toHaveLength(1);
  }

  it("draws the owner the default plain-words level, not the outline", async () => {
    await band("owner");
    noOutline();
    /* Brief, the default since 8N (plan 261002c). */
    expect(slider().getAttribute("aria-valuetext")).toBe("Brief");
    /* The plain-words body, at its empty state — the GET answered 404. */
    expect(text()).toContain(SIMPLE_NONE_OWNER);
    expect(posts, "arriving on a link spends nothing").toEqual([]);
  });

  it("draws a visitor the stored paragraphs at the default level", async () => {
    await band("visitor");
    noOutline();
    expect(slider().getAttribute("aria-valuetext")).toBe("Brief");
    expect(text()).toContain(BRIEF_TEXT);
    expect(text()).not.toContain(WHAT);
    expect(gets, "a visitor's band reads nothing").toEqual([]);
  });

  /* Greg, 2026-10-01 (8N, spya-zw479b): "In summary mode, default to the
     brief summary when it opens for the first time." No `?summary=` selects
     that default; explicit Simple and Fuller are remembered in the address. */
  it("opens on Brief when the address names no level, and Simple only when it says so", async () => {
    const { NuqsAdapter } = await import("nuqs/adapters/react");
    const inner = createElement(VisitorSummaryBand, { simple: { levels: artefact().levels }, onJump: () => {} });
    history.replaceState(null, "", "/read/a-piece?mode=summary");
    await act(async () => {
      root.render(createElement(NuqsAdapter, null, inner));
    });
    await settle();
    expect(slider().getAttribute("aria-valuetext")).toBe("Brief");
    expect(text()).toContain(BRIEF_TEXT);
    await act(async () => {
      root.unmount();
    });
    root = createRoot(host);
    history.replaceState(null, "", "/read/a-piece?mode=summary&summary=simple");
    await act(async () => {
      root.render(createElement(NuqsAdapter, null, inner));
    });
    await settle();
    expect(slider().getAttribute("aria-valuetext")).toBe("Simple");
    expect(text()).toContain(WHAT);
    /* Back to Brief, the default: nuqs drops it from the address (plan, Sol P2). */
    const briefEnd = host.querySelector<HTMLButtonElement>('button[aria-label="Show Brief summary"]');
    await act(async () => {
      briefEnd?.click();
    });
    await settle();
    expect(slider().getAttribute("aria-valuetext")).toBe("Brief");
    expect(new URLSearchParams(location.search).has("summary")).toBe(false);
  });

  it("says the slider's three levels without a visible level name beside it", async () => {
    await band("owner");
    expect(host.querySelector(".summ-slider-name")).toBeNull();
    expect(host.querySelector(".summ-controls")?.textContent ?? "").not.toMatch(/Brief|Simple|Fuller/);
  });
});
