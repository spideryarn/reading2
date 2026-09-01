// @vitest-environment jsdom
/**
 * **A Sketch that is being redrawn, with the old one still on screen.**
 *
 * Greg, 2026-08-30:
 *
 * > Make sure the diagrams in Diagram mode show loading spinners if they're
 * > generating. And/or a button to trigger generation if needed.
 *
 * The empty state already had both — the sentence about the price, the button,
 * and `JobProgress`'s spinner once it is pressed. The state that had neither
 * was the one where a picture already exists and a `sketch` job is running
 * anyway: from the CLI, from another tab, or from the shelf. `useStepJob` reads
 * the queue rather than remembering the click precisely so that those show up,
 * and this panel was the one surface that then did nothing with the answer —
 * so the picture silently changed under the reader two minutes later with
 * nothing having said it was going to.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Block, BlockId, Job } from "../src/types.js";
import { SketchView } from "../src/web/SketchView.js";
import { jobEngine } from "../src/web/jobEngine.js";

const BLOCKS: Block[] = [
  { id: "spya-b0" as BlockId, tag: "p", kind: "text", text: "one two three", words: 3, html: "<p>one two three</p>", gistable: true },
];

/** The smallest scene `readSketch` will accept and `paintScene` will draw. */
const SKETCH = {
  version: 1,
  title: "The shape of it",
  caption: "What the argument does",
  scenes: [
    {
      id: "overview",
      title: "The shape of it",
      height: 600,
      items: [
        { kind: "node", id: "claim", shape: "box", x: 200, y: 100, w: 200, h: 60, text: "a claim", size: "sm", block: "spya-b0" },
      ],
    },
    /* A second scene, so the scene row exists at all — with one scene the bar
       shows a plain title instead. Four of the six real drawings have scenes no
       node opens, which is why the row is the way in rather than a breadcrumb. */
    {
      id: "detail",
      title: "The first support",
      height: 600,
      items: [
        { kind: "node", id: "support", shape: "box", x: 200, y: 100, w: 200, h: 60, text: "a support", size: "sm", block: "spya-b0" },
      ],
    },
  ],
};

/** A `sketch` job the queue says is running for this article. */
const RUNNING: Job = {
  id: "j1",
  slug: "s",
  status: "running",
  steps: [{ name: "sketch", status: "running", label: "Drawing the argument" }],
} as unknown as Job;

/** A job this panel started itself — the one that used to pin `startedId`. */
const MINE_RUNNING: Job = {
  id: "j0",
  slug: "s",
  status: "running",
  steps: [{ name: "sketch", status: "running", label: "Drawing the argument" }],
} as unknown as Job;

/** The same job, come back failed — what a two-minute redraw looks like when it loses. */
const FAILED: Job = {
  id: "j1",
  slug: "s",
  status: "error",
  error: "The model refused this one [E_MODEL_FORBIDDEN]",
  steps: [{ name: "sketch", status: "error", label: "Drawing the argument" }],
} as unknown as Job;

let host: HTMLDivElement;
let root: Root;

/** Mutable, so a test can change what the next poll sees. */
let queue: Job[] = [];

function serving(jobs: Job[]) {
  queue = jobs;
  vi.stubGlobal("fetch", async (url: RequestInfo | URL) => {
    const u = String(url);
    if (u.includes("/api/sketch/")) {
      return new Response(
        JSON.stringify({ sketch: SKETCH, stale: false, outdated: false, profileChanged: false }),
        { status: 200 },
      );
    }
    /* **`done`, or this never returns.** `useJobs` drives a running job by
       POSTing `advance` in a loop that only `done` ends, and a stub answering
       neither `done` nor `busy` spins without ever awaiting a timer — which
       takes the worker out of memory rather than failing an assertion. The
       polled list below still says `running`, which is what this test is
       about. */
    if (u.includes("/advance")) {
      return new Response(JSON.stringify({ job: queue[0] ?? null, ran: null, busy: false, done: true }), { status: 200 });
    }
    if (u.includes("/api/jobs")) return new Response(JSON.stringify({ jobs: queue }), { status: 200 });
    return new Response(JSON.stringify({}), { status: 200 });
  });
}

beforeEach(() => {
  /* React only recognises `act` when this is set, and without it the async
     setStates from the job poller land outside one — which prints a warning and
     leaves assertions racing the update they are about. */
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  /* The job list is polled on a timer, so a test that wants to see the next
     poll has to move the clock rather than wait eight real seconds. */
  vi.useFakeTimers({ shouldAdvanceTime: true });
  /* The poller is a tab-level singleton (src/web/jobEngine.ts) and survives an
     unmount on purpose, so each case starts it over rather than inheriting the
     previous one's list and its drive loop. */
  jobEngine.reset();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/* Two flushes: `apiFetch` asks for a token before it sends, so the sketch and
   the job list land on different microtasks. Asserting after one sees a panel
   that has only half arrived — which is also what a genuinely broken fetch
   looks like. */
async function mount() {
  await act(async () => {
    root.render(<SketchView slug="s" blocks={BLOCKS} atRow={0} onJump={() => {}} />);
    await new Promise((r) => setTimeout(r, 0));
  });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

describe("a picture on screen while another is being drawn", () => {
  it("draws the picture at all, before anything else is asserted", async () => {
    serving([]);
    await mount();
    expect(host.querySelector("svg.sk-svg"), "no picture, so nothing below means anything").not.toBeNull();
    expect(host.querySelector(".cmt-spinner"), "spinning with no job running").toBeNull();
  });

  it("says a redraw is under way, and spins while it is", async () => {
    serving([RUNNING]);
    await mount();
    expect(host.querySelector("svg.sk-svg"), "the picture went away while it was redrawn").not.toBeNull();
    const busy = host.querySelector(".sk-busy");
    expect(busy, "a two-minute job is running and the panel says nothing").not.toBeNull();
    expect(busy?.querySelector(".cmt-spinner"), "no spinner").not.toBeNull();
    /* The step's own label, off the server, so the words here are the words the
       shelf shows for the same run. */
    expect(busy?.textContent).toContain("Drawing the argument");
  });

  /**
   * **The spinner going away is not the same as the work having succeeded.**
   *
   * `useStepJob` only lists queued and running jobs, and its `failed` used to
   * follow only a job *this hook started* — which a ready Sketch cannot do,
   * because the Draw button lives in the empty state. So a redraw begun from
   * the CLI or another tab that came back failed took the busy line away, left
   * the old picture standing, and said nothing: two minutes and $0.20 reading
   * as a completed redraw that changed nothing. ⟨Sol⟩, 2026-08-30.
   */
  it("says so when a redraw somebody else started comes back failed", async () => {
    serving([RUNNING]);
    await mount();
    expect(host.querySelector(".sk-busy"), "it never looked busy, so this proves nothing").not.toBeNull();

    /* The job leaves the running set and reappears as an error. The poll is on
       an 8s timer, so the clock has to move for the panel to see it. */
    queue = [FAILED];
    await act(async () => { await vi.advanceTimersByTimeAsync(9000); });

    expect(host.querySelector(".sk-busy"), "still claiming to be working").toBeNull();
    const gone = host.querySelector(".sk-failed");
    expect(gone, "the redraw failed and the panel said nothing at all").not.toBeNull();
    expect(gone?.textContent, "the server's own reason was thrown away").toContain("E_MODEL_FORBIDDEN");
    expect(host.querySelector("svg.sk-svg"), "the old picture should stand").not.toBeNull();
  });

  /**
   * **Every scene reachable by Tab, and the arrows left to the article.**
   *
   * This assertion has now been made in both directions, and the reversal is
   * the point of the docstring.
   *
   * ⟨Sol⟩, 2026-08-30, found that the scene row had the *right half* of the
   * radiogroup pattern and not the left: a roving `tabIndex` — only the
   * selected scene at 0, the rest at -1 — and no arrow handler at all. So a
   * keyboard reader could reach the scene they were already on and none of the
   * others, and it read as deliberate precisely because the roving tabstop was
   * there. The fix was to add the arrows, and this test held them.
   *
   * **On 2026-08-31 the arrows went instead**, across all five switchers in the
   * app. Sol's finding was right and is still honoured — the row is fully
   * reachable by keyboard — but the remedy is the other one: drop the roving
   * tabstop rather than complete the pattern around it. The reason is local and
   * Sol could not have weighed it, because it is about the *page* rather than
   * the control: ↑ / ↓ step the article and ← / → choose the granularity
   * stride (docs/project/keyboard.md), and every one of these handlers called
   * `stopPropagation` to take those keys whenever one held focus. Greg met that
   * as a bug and asked for the behaviour removed.
   *
   * So the two halves swap: what was `tabIndex={-1}` plus arrows is now
   * `tabIndex={0}` plus none. `src/web/Dock.tsx` § the mode switch has the full
   * reasoning and what the extra tab stops cost; the app-wide sweep that stops
   * the roving pattern coming back is
   * tests/arrows-belong-to-the-article.test.tsx.
   */
  it("gives every scene its own tab stop, and leaves the arrows alone", async () => {
    serving([]);
    await mount();
    const scenes = [...host.querySelectorAll<HTMLElement>(".sk-scene")];
    expect(scenes.length, "the scene row is not drawn").toBe(2);
    expect(scenes[0]?.getAttribute("aria-checked"), "the overview should be selected").toBe("true");
    /* The half of Sol's finding that stands: the reader can get to the scene
       they are NOT on. It used to be -1 here, reachable only by arrow. */
    for (const scene of scenes) {
      expect(scene.tabIndex, "a scene is off the tab order with no arrows to reach it").toBe(0);
    }

    await act(async () => {
      scenes[0]?.focus();
      scenes[0]?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
      await new Promise((r) => setTimeout(r, 0));
    });

    const after = [...host.querySelectorAll<HTMLElement>(".sk-scene")];
    expect(
      after[0]?.getAttribute("aria-checked"),
      "an arrow press still moves the scene row — the arrows belong to the article",
    ).toBe("true");
    expect(after[1]?.getAttribute("aria-checked")).toBe("false");
  });

  /**
   * **And the press reaches the window**, which is the half a deletion could
   * quietly get wrong: a handler that stopped *selecting* while still calling
   * `stopPropagation` would leave the arrows dead in the scene row rather than
   * handing them back, and nothing above would notice.
   */
  it("lets an arrow press through to the window", async () => {
    serving([]);
    await mount();
    const scene = host.querySelector<HTMLElement>(".sk-scene");
    expect(scene).not.toBeNull();

    let reached = false;
    const spy = () => {
      reached = true;
    };
    window.addEventListener("keydown", spy);
    await act(async () => {
      scene?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
      await new Promise((r) => setTimeout(r, 0));
    });
    window.removeEventListener("keydown", spy);
    expect(reached, "the scene row swallowed the key").toBe(true);
  });

  /**
   * **The one this panel watches is the latest one, not the first one.**
   *
   * `stopped` read `startedId ?? seenId`, so the moment a mount had started a
   * job of its own it stopped looking at anything else — for good. Two ways
   * that goes wrong, and this drives the second because it is the one that
   * *invents* news rather than losing it: a run of ours fails, a later run from
   * somewhere else succeeds, and the old failure comes back out from behind the
   * spinner as though it had just happened. ⟨Sol⟩, 2026-08-30, reviewing the
   * fix to its own earlier finding — which is the argument for a second round.
   */
  it("forgets an old failure once a newer run has succeeded", async () => {
    /* A job this panel *started*, which is what put `startedId` in the way. The
       only surface that can is the empty state's Draw button, so the fixture
       begins there: no picture, one press, and the job comes back failed. */
    serving([]);
    vi.stubGlobal("fetch", async (url: RequestInfo | URL, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("/api/sketch/")) {
        return drawn
          ? new Response(JSON.stringify({ sketch: SKETCH, stale: false, outdated: false, profileChanged: false }), { status: 200 })
          : new Response("{}", { status: 404 });
      }
      if (u.includes("/advance")) return new Response(JSON.stringify({ job: queue[0] ?? null, ran: null, busy: false, done: true }), { status: 200 });
      if (u.includes("/api/jobs") && init?.method === "POST") {
        queue = [MINE_RUNNING];
        return new Response(JSON.stringify(MINE_RUNNING), { status: 200 });
      }
      if (u.includes("/api/jobs")) return new Response(JSON.stringify({ jobs: queue }), { status: 200 });
      return new Response(JSON.stringify({}), { status: 200 });
    });
    let drawn = false;

    await mount();
    const draw = [...host.querySelectorAll("button")].find((b) => b.textContent?.includes("Draw"));
    expect(draw, "the empty state has no Draw button").toBeTruthy();
    await act(async () => {
      draw?.click();
      await new Promise((r) => setTimeout(r, 0));
    });

    /* Ours fails. **And stays in the list**, which is the half a first version
       of this test got wrong and which is what makes the bug reachable at all:
       `/api/jobs` returns finished jobs too, so a failed run is still there to
       be found by id long after it stopped. Dropping it from the fixture made
       the failure disappear for the wrong reason and the test pass on the bug. */
    const MINE_FAILED = { ...MINE_RUNNING, status: "error", error: "mine broke [E_MINE]" } as unknown as Job;
    queue = [MINE_FAILED];
    await act(async () => { await vi.advanceTimersByTimeAsync(9000); });
    expect(host.textContent, "our own failure was not reported").toContain("E_MINE");

    // Somebody else redraws it, and this time it works.
    drawn = true;
    queue = [MINE_FAILED, RUNNING];
    await act(async () => { await vi.advanceTimersByTimeAsync(9000); });
    /* A spinner, not `.sk-busy` specifically: our own run failed rather than
       finishing, so nothing reloaded the artefact and the panel is still in its
       empty state, where `JobProgress` is what shows the run. Which branch
       reports it is not what this test is about. */
    expect(host.querySelector(".cmt-spinner"), "the newer run is not showing as busy").not.toBeNull();

    queue = [MINE_FAILED, { ...RUNNING, status: "done" } as unknown as Job];
    await act(async () => { await vi.advanceTimersByTimeAsync(9000); });
    expect(host.querySelector(".cmt-spinner"), "still claiming to be working").toBeNull();
    expect(
      host.textContent,
      "an old failure came back out from behind the spinner, about a run that has since succeeded",
    ).not.toContain("E_MINE");
  });
});
