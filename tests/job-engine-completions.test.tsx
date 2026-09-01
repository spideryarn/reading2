// @vitest-environment jsdom
/**
 * **Who gets told that a job finished, and exactly once.**
 *
 * The contract, in one sentence: *notify this subscriber once when a job
 * transitions to `done` after that subscriber began observing; never announce a
 * job that was already done when it arrived.*
 *
 * ## The bug this file exists to stop is one the refactor would have introduced
 *
 * `useJobs` used to keep a per-subscriber `Set` of ids it had announced, seeded
 * on the first poll *that hook itself* made. That was sound while the poll
 * belonged to the mount — the hook could not miss anything, because nothing
 * happened until it asked.
 *
 * It stops being sound the moment the engine polls on its own. A job can now
 * reach `done` **between a subscriber's render and its subscription effect**,
 * and a Set seeded in the effect would take that real completion as history and
 * baseline it away. The reader would be looking at a shelf that never gained
 * the article it just imported, and no request would have failed. GPT Sol found
 * this in the plan, before any of it was built.
 *
 * So completion is a **monotonic cursor, not a set**: the engine numbers
 * completion events, and each subscriber captures the number during its first
 * *render*. Everything past that number is news by definition, and the
 * render-to-effect window closes because the cursor was taken before it opened.
 *
 * ## Why `receive` and not a fake server
 *
 * The window under test is one synchronous commit. Nothing that goes through a
 * promise — a fetch, a timer, a microtask — can land inside it, so a test
 * driven by a fake `GET /api/jobs` cannot reach the case at all. `receive` is
 * the engine's own input, exposed for exactly this. The `Trigger` component
 * below finishes job B **during React's render pass**, after the subscriber has
 * rendered and before its effects run, which is the sequence itself.
 *
 * Nothing here talks to a server, which is also what makes it meaningful
 * locally: with no `VERCEL` set the real server advances jobs itself and the
 * browser's own progress is invisible.
 */
import { act, createElement, Fragment, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Job } from "../src/types.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * The job list never lands, so nothing but `receive` moves the engine.
 *
 * A held `GET` rather than an empty one: an answered poll would apply a list of
 * its own and the sequence below would be racing it. `/advance` answers `done`
 * so a driver started by `receive` ends instead of looping.
 */
vi.mock("../src/web/lib/api.js", async () => {
  const real = await vi.importActual<typeof import("../src/web/lib/api.js")>(
    "../src/web/lib/api.js",
  );
  return {
    ...real,
    apiFetch: (url: string) => {
      if (url.includes("/advance")) {
        return Promise.resolve(
          new Response(JSON.stringify({ job: null, ran: null, busy: false, done: true }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        );
      }
      return new Promise<Response>(() => {});
    },
  };
});

const { jobEngine } = await import("../src/web/jobEngine.js");
const { useJobs } = await import("../src/web/useJobs.js");

const job = (id: string, status: Job["status"]): Job =>
  ({ id, slug: id, status, steps: [] }) as unknown as Job;

const A_DONE = job("A", "done");
const B_RUNNING = job("B", "running");
const B_DONE = job("B", "done");
const C_RUNNING = job("C", "running");
const C_DONE = job("C", "done");

let heard1: string[] = [];
let heard2: string[] = [];
/** Fired once, during the render pass, by the component below. */
let duringRender: (() => void) | null = null;

function Probe({ heard }: { heard: string[] }): ReactElement | null {
  useJobs((finished) => heard.push(finished.id));
  return null;
}

/**
 * Finishes a job **while React is rendering**, after `Probe` above has rendered
 * and before any effect has run. That is the window, and there is no other way
 * to be inside it.
 */
function Trigger(): ReactElement | null {
  if (duringRender) {
    const fire = duringRender;
    duringRender = null;
    fire();
  }
  return null;
}

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  jobEngine.reset();
  heard1 = [];
  heard2 = [];
  duringRender = null;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  jobEngine.reset();
});

describe("telling a subscriber that a job finished", () => {
  it("announces only what finished after it started watching, and each thing once", async () => {
    /* 1. The engine's first list. A is already done — history — and B is
          running. The first list is a baseline, so nothing is announced from
          it to anybody, ever. */
    jobEngine.receive([A_DONE, B_RUNNING]);

    /* 2 and 3. Subscriber 1 renders and captures its cursor; B finishes inside
          the same render pass, before subscriber 1's effect has run. */
    duringRender = () => jobEngine.receive([A_DONE, B_DONE]);
    await act(async () => {
      root.render(
        createElement(Fragment, null, createElement(Probe, { heard: heard1 }), createElement(Trigger)),
      );
    });

    // 4. Subscriber 1 hears B exactly once, and never hears A.
    expect(heard1).toEqual(["B"]);

    // 5. Subscriber 2 mounts after B is done, and hears neither.
    await act(async () => {
      root.render(
        createElement(
          Fragment,
          null,
          createElement(Probe, { heard: heard1 }),
          createElement(Probe, { heard: heard2 }),
        ),
      );
    });
    expect(heard2).toEqual([]);
    expect(heard1).toEqual(["B"]);

    // 6. C runs and finishes. Both hear it, once each.
    await act(async () => {
      jobEngine.receive([A_DONE, B_DONE, C_RUNNING]);
    });
    await act(async () => {
      jobEngine.receive([A_DONE, B_DONE, C_DONE]);
    });
    expect(heard1).toEqual(["B", "C"]);
    expect(heard2).toEqual(["C"]);

    // 7. The same list again says nothing new to anybody.
    await act(async () => {
      jobEngine.receive([A_DONE, B_DONE, C_DONE]);
    });
    expect(heard1).toEqual(["B", "C"]);
    expect(heard2).toEqual(["C"]);
  });

  it("says nothing to a subscriber that mounts into a settled queue", async () => {
    /* The half that pays for the rest: opening the shelf must not fire
       `onFinished` once per job that ever succeeded, which is a refetch of the
       library per historical record. */
    jobEngine.receive([A_DONE, B_DONE, C_DONE]);
    await act(async () => {
      root.render(createElement(Probe, { heard: heard1 }));
    });
    expect(heard1).toEqual([]);
  });
});
