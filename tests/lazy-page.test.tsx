// @vitest-environment jsdom
/**
 * **What the reader sees when a route's code does not arrive.**
 *
 * `/admin` and `/design` are fetched on demand
 * (docs/plans/260905i-lazy-load-admin-and-design-routes.md), so there is now a
 * failure this app could not have before: the page's JavaScript is asked for
 * and does not come. In production that is nearly always a deploy replacing the
 * hashed assets under a tab that was already open.
 *
 * The one assertion here that is worth more than the rest is **Try again calls
 * the loader a second time**. React stores a rejection on the lazy component's
 * payload and re-throws that same result forever, so a retry that merely
 * remounts the same lazy type is a button that does nothing — and it looks
 * exactly like a working one from the outside. GPT Sol's F2 on the plan;
 * `LazyPage.tsx`'s header has the argument.
 *
 * A **stubbed loader**, not a real chunk: the subject is what the boundary does
 * with a rejected promise, and a real dynamic import in vitest resolves from
 * disk and cannot be made to fail on demand.
 */
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const captureClientFailure = vi.fn();
const recordLog = vi.fn();

vi.mock("../src/web/monitoring.js", () => ({
  captureClientFailure,
  initClientMonitoring: () => {},
}));
/* Only the door is stubbed. `nameOfThrown` is the real one, because it is what
   decides the `name` the assertions below read — a stub of it would be a second
   implementation of the thing under test. src/web/log-buffer.ts § nameOfThrown. */
vi.mock("../src/web/log-buffer.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/web/log-buffer.js")>()),
  recordLog,
}));

import type { PageLoader } from "../src/web/LazyPage.js";

/* Imported after the mocks are declared, so that the module under test picks
   up the stubbed `monitoring` and `log-buffer` rather than the real ones. */
const { LazyPage } = await import("../src/web/LazyPage.js");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * Every request the whole test makes. Nothing should reach `/api/` — a page
 * that failed to load cannot have asked the server for anything, and a spinner
 * that quietly kicked off generation work would be a real bug wearing a
 * loading state.
 */
const requested: string[] = [];
globalThis.fetch = (async (input: RequestInfo | URL) => {
  requested.push(String(typeof input === "string" ? input : input instanceof URL ? input : input.url));
  return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
}) as typeof fetch;

let host: HTMLDivElement;
let root: Root;

/* React prints a caught boundary error to the console. That is correct
   behaviour and it is not what is under test, so it is silenced rather than
   read. */
let quietConsole: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  captureClientFailure.mockClear();
  recordLog.mockClear();
  quietConsole = vi.spyOn(console, "error").mockImplementation(() => {});
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  quietConsole.mockRestore();
});

/** A page the loader can hand back, distinguishable from the escape. */
const RealPage = () => <h1>The real page</h1>;

/** Render, then let the loader's promise settle and React re-render on it. */
async function show(node: ReactNode) {
  await act(async () => {
    root.render(node);
  });
  await act(async () => {});
}

const text = () => host.textContent ?? "";
const tryAgain = () =>
  [...host.querySelectorAll("button")].find((b) => b.textContent?.includes("Try again"));

/**
 * The message an unloadable chunk must never carry into the page or into a
 * report. A real one is a bundler's or a browser's sentence about a URL, and
 * this app's rule is that no error's own text reaches a reader or the wire.
 */
const SECRET = "Failed to fetch dynamically imported module: /assets/AdminPage-secret.js";

describe("a route whose code does not arrive", () => {
  it("shows the escape, with the code a reader can quote", async () => {
    const load = vi.fn(async () => {
      throw new Error(SECRET);
    });
    await show(<LazyPage load={load as unknown as PageLoader} routeKey="admin:home" />);

    /* The code, not the prose — docs/project/copy.md § The bracketed code. */
    expect(text()).toContain("[chunk]");
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
    /* And it says the thing that is actually true and actually helps. */
    expect(text().toLowerCase()).toContain("reloading");
    expect(text()).not.toContain(SECRET);
  });

  it("reports it once, without the error's message", async () => {
    const load = vi.fn(async () => {
      throw new Error(SECRET);
    });
    await show(<LazyPage load={load as unknown as PageLoader} routeKey="admin:home" />);

    expect(captureClientFailure).toHaveBeenCalledTimes(1);
    const [err, context] = captureClientFailure.mock.calls[0] as [Error, Record<string, string>];
    expect(context).toEqual({ boundary: "lazy-route" });
    /* The `Error` itself is handed to `captureClientFailure`, which is where
       `monitoring-scrub.ts` decides what leaves the machine. What must not
       happen is this file adding the message to anything of its own — the
       context above, and the ring-buffer entry below. */
    expect(err.message).toBe(SECRET);
    expect(JSON.stringify(context)).not.toContain(SECRET);

    expect(recordLog).toHaveBeenCalledTimes(1);
    const [entry] = recordLog.mock.calls[0] as [Record<string, unknown>];
    expect(entry).toEqual({ kind: "client-error", source: "boundary", name: "Error" });
    expect(JSON.stringify(entry)).not.toContain(SECRET);
  });

  it("asks the loader again when the reader presses Try again", async () => {
    /* Reject once, resolve the second time. This is the assertion that would
       have caught Sol's F2: with a retry that only remounts the same lazy
       type, `load` is called once and the escape never goes away. */
    const load = vi.fn(async () => {
      if (load.mock.calls.length === 1) throw new Error(SECRET);
      return { default: RealPage };
    });
    await show(<LazyPage load={load as unknown as PageLoader} routeKey="admin:home" />);
    expect(load).toHaveBeenCalledTimes(1);
    expect(text()).toContain("[chunk]");

    const button = tryAgain();
    expect(button).toBeDefined();
    await act(async () => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await act(async () => {});

    expect(load).toHaveBeenCalledTimes(2);
    expect(text()).toContain("The real page");
    expect(text()).not.toContain("[chunk]");
    /* One failure, one report — the successful retry adds nothing. */
    expect(captureClientFailure).toHaveBeenCalledTimes(1);
  });

  it("does not carry one route's failure onto the next", async () => {
    /* Without the route key the boundary sits at the same position in the tree
       for both branches, so React reuses the instance and `/design`'s broken
       state — and possibly its component — would still be there at `/admin`. */
    const failing = vi.fn(async () => {
      throw new Error(SECRET);
    });
    await show(<LazyPage load={failing as unknown as PageLoader} routeKey="design" />);
    expect(text()).toContain("[chunk]");

    const working = vi.fn(async () => ({ default: RealPage }));
    await show(<LazyPage load={working as unknown as PageLoader} routeKey="admin:home" />);
    expect(text()).toContain("The real page");
    expect(text()).not.toContain("[chunk]");
  });

  it("clears a failure on a route change even when the loader is the same", async () => {
    /* The case above passes a *different* loader on the second render, which is
       what App.tsx does today — so it would also pass with `routeKey` missing
       from the memo's dependencies, because a new `load` identity rebuilds the
       lazy type on its own. Nothing in this component's signature promises the
       loaders differ, and with one shared loader the boundary remounts while
       React's cached rejection does not: `[chunk]` forever, and the loader
       never called a second time. GPT Sol's F9, code review 2026-09-05, which
       it established with a harness rather than by reading. */
    let fail = true;
    const shared = vi.fn(async () => {
      if (fail) throw new Error(SECRET);
      return { default: RealPage };
    });

    await show(<LazyPage load={shared as unknown as PageLoader} routeKey="design" />);
    expect(text()).toContain("[chunk]");
    expect(shared).toHaveBeenCalledTimes(1);

    fail = false;
    await show(<LazyPage load={shared as unknown as PageLoader} routeKey="admin:home" />);
    expect(shared, "the route change must ask the same loader again").toHaveBeenCalledTimes(2);
    expect(text()).toContain("The real page");
    expect(text()).not.toContain("[chunk]");
  });

  it("shows the quiet loading surface while it waits", async () => {
    let settle: (m: { default: typeof RealPage }) => void = () => {};
    const load = vi.fn(
      () =>
        new Promise<{ default: typeof RealPage }>((resolve) => {
          settle = resolve;
        }),
    );
    await act(async () => {
      root.render(<LazyPage load={load as unknown as PageLoader} routeKey="design" />);
    });

    const waiting = host.querySelector('[role="status"]');
    expect(waiting, "the Suspense fallback should be on screen").not.toBeNull();
    expect(text()).not.toContain("[chunk]");

    await act(async () => {
      settle({ default: RealPage });
    });
    await act(async () => {});
    expect(text()).toContain("The real page");
    expect(host.querySelector('[role="status"]')).toBeNull();
  });

  it("issues no request at any point", () => {
    /* Across every case above: a page that never loaded cannot have asked the
       server for anything, and a loading state that quietly started generation
       work would be the expensive version of this bug. */
    expect(requested.filter((u) => u.includes("/api/"))).toEqual([]);
  });
});
