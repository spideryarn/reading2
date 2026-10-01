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
 *     nothing stored buys exactly one run; arriving on `?summary=simple` (a
 *     pasted link, a Back step, a restore — all the same setter) buys nothing;
 *     and a second press recovers from a failed read.
 *  3. **The outline's ladder** beside it: Parts | Sections.
 */
import { act, createElement, type ReactElement, StrictMode, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BlockId, Job, SimpleLevel, SimpleSummary } from "../src/types.js";
import type { UseSimple } from "../src/web/useSimple.js";
import type { SummaryView } from "../src/web/params.js";

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
const { SummaryPanel } = await import("../src/web/SummaryPanel.js");
const { SummaryControls } = await import("../src/web/modes/summary/SummaryMode.js");
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
let arrive: (next: SummaryView) => void = () => {};

function Band({ slug, start }: { slug: string; start: SummaryView }): ReactElement {
  const [view, setView] = useState<SummaryView>(start);
  arrive = setView;
  return createElement(
    "div",
    null,
    createElement(SummaryControls, { slug, value: view, onChange: setView }),
    /* One element for every level, so moving between levels keeps the hook
       mounted — as `OwnerSimple` does in the real band. */
    view !== "gists" ? createElement(SimpleProbe, { slug }) : null,
  );
}

async function open(start: SummaryView): Promise<void> {
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

/** A click on the slider where it rests — how the idle slider opens Simple. */
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
    await open("gists");
    expect(simpleGets(), "the outline reads nothing").toEqual([]);
    await pressSimple();
    expect(simpleGets().length).toBeGreaterThan(0);
    expect(posts).toEqual([{ slug: "a-piece", steps: ["simple"] }]);
  });

  it("writes them once when the reader goes straight to Fuller", async () => {
    await open("gists");
    await slideTo(2);
    expect(posts).toEqual([{ slug: "a-piece", steps: ["simple"] }]);
  });

  it("does not write them a second time when pressed again, or moved to another level", async () => {
    await open("gists");
    await pressSimple();
    await pressSimple();
    await slideTo(0);
    expect(posts).toEqual([{ slug: "a-piece", steps: ["simple"] }]);
  });

  it("writes nothing when they are already stored", async () => {
    artefactStatus = 200;
    await open("gists");
    await pressSimple();
    await slideTo(2);
    expect(simpleGets().length).toBeGreaterThan(0);
    expect(posts).toEqual([]);
  });

  it("recovers from a failed read on a second press", async () => {
    artefactFails = true;
    await open("gists");
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
    await open("gists");
    await act(async () => arrive("simple"));
    await settle();
    expect(simpleGets().length).toBeGreaterThan(0);
    expect(posts).toEqual([]);
  });
});

/* ------------------------------------------------------ the outline ladder -- */

describe("Parts | Sections beside the slider", () => {
  async function panel(deep: number, plain: boolean, onDeep: (d: number) => void): Promise<void> {
    await act(async () => {
      root.render(
        createElement(SummaryPanel, {
          root: null,
          deep,
          onDeep,
          atRow: null,
          onJump: () => {},
          simple: plain ? createElement("div", { "data-simple": "" }, "Simple body") : null,
        }),
      );
    });
  }
  const pill = (label: string): HTMLButtonElement => {
    const found = [...host.querySelectorAll<HTMLButtonElement>(".summ-pill")].find((b) => b.textContent === label);
    if (!found) throw new Error(`no ${label} pill`);
    return found;
  };

  it("has no Article pill and no visible labels — one row, two named groups", async () => {
    await panel(1, false, () => {});
    expect([...host.querySelectorAll(".summ-pill")].map((b) => b.textContent)).toEqual(["Parts", "Sections"]);
    expect([...host.querySelectorAll("legend")].map((l) => [l.textContent, l.className])).toEqual([
      ["Outline", "sr-only"],
    ]);
    expect(host.querySelectorAll(".summ-controls")).toHaveLength(1);
  });

  it("lights Parts as included under Sections, with aria-pressed on the chosen depth only", async () => {
    await panel(2, false, () => {});
    expect(pill("Sections").getAttribute("aria-pressed")).toBe("true");
    expect(pill("Sections").classList.contains("on")).toBe(true);
    expect(pill("Parts").getAttribute("aria-pressed")).toBe("false");
    expect(pill("Parts").classList.contains("included")).toBe(true);
    await panel(1, false, () => {});
    expect(pill("Parts").getAttribute("aria-pressed")).toBe("true");
    expect(pill("Sections").classList.contains("included")).toBe(false);
  });

  it("steps Sections back to Parts when pressed while chosen", async () => {
    const onDeep = vi.fn();
    await panel(2, false, onDeep);
    await act(async () => pill("Sections").click());
    expect(onDeep).toHaveBeenLastCalledWith(1);
    await act(async () => pill("Parts").click());
    expect(onDeep).toHaveBeenLastCalledWith(1);
  });

  it("draws the pair unlit under a plain-words level, and a press asks for that depth", async () => {
    const onDeep = vi.fn();
    await panel(2, true, onDeep);
    expect(host.querySelector("[data-simple]")).not.toBeNull();
    expect(pill("Sections").getAttribute("aria-pressed")).toBe("false");
    expect(pill("Parts").classList.contains("included")).toBe(false);
    expect(onDeep).not.toHaveBeenCalled();
    /* Not "step back": under a level, Sections is not chosen, so it asks for 2. */
    await act(async () => pill("Sections").click());
    expect(onDeep).toHaveBeenLastCalledWith(2);
  });
});
