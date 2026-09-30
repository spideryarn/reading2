// @vitest-environment jsdom
/**
 * **Simple — Summary's plain-words sub-mode**, on the client
 * (docs/plans/260930i-simple-summaries-eli15-sub-mode.md stage 2).
 *
 * Two halves:
 *
 *  1. **The view.** Each paragraph is plain text followed by a `BlockRef` door
 *     per id; the foot says what it is; *stale* draws the notice and *outdated*
 *     draws nothing; a visitor gets the stored paragraphs and no verb, or a
 *     line saying none has been made.
 *  2. **The press.** The real `SummarySubModeToggle` over the real `useSimple`,
 *     under `<StrictMode>`, counting job requests the way
 *     tests/modes-that-start-themselves.test.tsx does: pressing Simple with
 *     nothing stored buys exactly one run; arriving on `?summary=simple` (a
 *     pasted link, a Back step, a restore — all the same setter) buys nothing;
 *     and a second press recovers from a failed read.
 */
import { act, createElement, type ReactElement, StrictMode, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BlockId, Job, SimpleSummary } from "../src/types.js";
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

function artefact(): SimpleSummary {
  return {
    version: "simple/1",
    generator: "test",
    slug: "a-piece",
    sourceHash: "hash",
    generatedAt: "2026-09-30T09:00:00.000Z",
    elapsedMs: 1,
    paragraphs: [
      { text: WHAT, ids: [EARLY, MIDDLE] },
      { text: WHY, ids: [LATER] },
    ],
  };
}

vi.mock("../src/web/lib/api.js", () => ({
  apiFetch: async (url: string) => {
    gets.push(url);
    if (artefactFails) throw new Error("network");
    return artefactStatus === 404
      ? new Response(null, { status: 404 })
      : new Response(JSON.stringify({ simpleSummary: artefact(), stale: false, outdated: false }), {
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

const { SIMPLE_FOOT, SIMPLE_NONE_OWNER, SIMPLE_NONE_VISITOR, SimplePanel } = await import(
  "../src/web/SimplePanel.js"
);
const { BlockLinkProvider } = await import("../src/web/BlockLinkCard.js");
const { SummaryPanel } = await import("../src/web/SummaryPanel.js");
const { SummarySubModeToggle } = await import("../src/web/modes/summary/SummaryMode.js");
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

async function draw(access: Parameters<typeof SimplePanel>[0]["access"]): Promise<void> {
  jumps.length = 0;
  await act(async () =>
    root.render(createElement(SimplePanel, { access, onJump: (id: BlockId) => void jumps.push(id) })),
  );
}

const text = (): string => host.textContent ?? "";

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
    expect(text()).toContain(SIMPLE_FOOT);
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
    simple.paragraphs[0] = { text: "<b>bold</b> **stars**", ids: [EARLY] };
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
    await draw({ kind: "visitor", simple: { paragraphs: artefact().paragraphs } });
    expect(host.querySelectorAll(".simple-para")).toHaveLength(2);
    expect(host.querySelectorAll("a.block-ref")).toHaveLength(3);
    expect(text()).toContain(SIMPLE_FOOT);
    expect(host.querySelectorAll("button")).toHaveLength(0);
  });

  it("tells a visitor none has been made yet", async () => {
    await draw({ kind: "visitor", simple: null });
    expect(text()).toContain(SIMPLE_NONE_VISITOR);
    expect(host.querySelectorAll("button")).toHaveLength(0);
  });
});

/* --------------------------------------------------------------- the press -- */

/** The owner's band, reduced: the real switch and, under Simple, the real hook. */
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
    createElement(SummarySubModeToggle, { slug, value: view, onChange: setView }),
    view === "simple" ? createElement(SimpleProbe, { slug }) : null,
  );
}

async function open(start: SummaryView): Promise<void> {
  await act(async () => {
    root.render(createElement(StrictMode, null, createElement(Band, { slug: "a-piece", start })));
  });
  await settle();
}

async function pressSimple(): Promise<void> {
  const chip = [...host.querySelectorAll<HTMLButtonElement>(".summ-views .summ-pill")].find(
    (b) => b.textContent?.trim() === "Simple",
  );
  if (!chip) throw new Error("no Simple chip");
  await act(async () => chip.click());
  await settle();
}

const simpleGets = (): string[] => gets.filter((u) => u.startsWith("/api/simple/"));

describe("pressing Simple", () => {
  it("writes it when nothing is stored, once", async () => {
    await open("gists");
    expect(simpleGets(), "Gists reads nothing").toEqual([]);
    await pressSimple();
    expect(simpleGets().length).toBeGreaterThan(0);
    expect(posts).toEqual([{ slug: "a-piece", steps: ["simple"] }]);
  });

  it("does not write it a second time when pressed again", async () => {
    await open("gists");
    await pressSimple();
    await pressSimple();
    expect(posts).toEqual([{ slug: "a-piece", steps: ["simple"] }]);
  });

  it("writes nothing when one is already stored", async () => {
    artefactStatus = 200;
    await open("gists");
    await pressSimple();
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

describe("arriving at Simple without pressing it", () => {
  it("spends nothing on a pasted link or a restore", async () => {
    await open("simple");
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

describe("Simple and the Gists depth", () => {
  it("hides Depth under Simple and restores the chosen depth on returning to Gists", async () => {
    const onDeep = vi.fn();
    await act(async () => {
      root.render(
        createElement(SummaryPanel, {
          root: null,
          deep: 2,
          onDeep,
          atRow: null,
          onJump: () => {},
          simple: createElement("div", { "data-simple": "" }, "Simple body"),
        }),
      );
    });
    expect([...host.querySelectorAll("legend")].some((legend) => legend.textContent === "Depth")).toBe(false);

    await act(async () => {
      root.render(
        createElement(SummaryPanel, {
          root: null,
          deep: 2,
          onDeep,
          atRow: null,
          onJump: () => {},
          simple: null,
        }),
      );
    });
    const sections = [...host.querySelectorAll<HTMLButtonElement>(".summ-pill")].find(
      (button) => button.textContent === "sections",
    );
    expect(sections?.getAttribute("aria-pressed")).toBe("true");
    expect(onDeep).not.toHaveBeenCalled();
  });
});
