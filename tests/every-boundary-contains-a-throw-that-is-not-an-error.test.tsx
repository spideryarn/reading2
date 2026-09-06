// @vitest-environment jsdom
/**
 * **Every boundary must survive being handed something that is not an Error.**
 *
 * React passes `componentDidCatch` the thrown value unchanged, so a component
 * that does `throw null` — a real thing components do — gives the handler
 * something with no `.name`. `AppBoundary` used to read `error.name` there, and
 * that read threw a second time *out of the handler itself*. There is nothing
 * above the root boundary to catch that, so the reader got an empty `#root`:
 * the failure mode the boundary exists to prevent, arriving through the
 * boundary. Sol, 2026-09-06, F15.
 *
 * All three boundaries had the same defect, and all three now hand the caught
 * value to `nameOfThrown` (src/web/log-buffer.ts) rather than reading it. This
 * file is the behavioural half — each boundary mounted on its own, given a
 * `throw null`, and asked for its own fallback. The structural half, which is
 * what stops a *fourth* boundary repeating it, is
 * tests/no-boundary-reads-the-caught-value.test.ts.
 *
 * `FeatureBoundary`'s ordinary containment is covered at length by
 * tests/a-broken-mode-leaves-the-article-readable.test.tsx, through the whole
 * app; here it is mounted bare, so that the assertion is about the handler and
 * not about the page around it.
 *
 * docs/plans/260905h-a-mode-failure-should-leave-the-article-readable.md.
 */
import { act, StrictMode, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AppBoundary } from "../src/web/AppBoundary.js";
import { FeatureBoundary } from "../src/web/FeatureBoundary.js";
import { LazyPage } from "../src/web/LazyPage.js";
import { clearLogBuffer, readLogBuffer } from "../src/web/log-buffer.js";

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  clearLogBuffer();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

const text = (): string => host.textContent ?? "";

/**
 * How many times the probe actually threw.
 *
 * The positive control every case here needs: a child that quietly stopped
 * throwing would make "the app survived" pass over a page that never failed.
 * docs/reusable/silent-success.md.
 */
let threw = 0;

beforeEach(() => {
  threw = 0;
});

function ThrowsNull(): never {
  threw += 1;
  throw null;
}

/** The `client-error` entries the boundary's handler managed to write. */
const clientErrors = () => readLogBuffer().filter((entry) => entry.kind === "client-error");

const mount = async (tree: ReactNode): Promise<void> => {
  await act(async () => {
    root.render(<StrictMode>{tree}</StrictMode>);
  });
};

describe("the root boundary contains a throw that is not an Error", () => {
  it("still draws its apology, and still records the failure", async () => {
    await mount(
      <AppBoundary>
        <ThrowsNull />
      </AppBoundary>,
    );

    expect(threw, "the probe never threw, so nothing was contained").toBeGreaterThan(0);
    /* Matched on the bracketed code rather than the sentence, so the words stay
       rewritable — docs/project/copy.md. */
    expect(text(), "the root fallback did not draw").toContain("[render]");
    /* And the handler ran to its end rather than throwing out of the middle of
       itself: the name it could not read fell back to the constant. */
    expect(clientErrors()).toContainEqual(
      expect.objectContaining({ source: "boundary", name: "Error" }),
    );
  });
});

describe("the lazy-route boundary contains a throw that is not an Error", () => {
  it("draws [chunk] rather than letting the throw reach the root", async () => {
    /* Module-scope by the rule in src/web/LazyPage.tsx: `load` is a `useMemo`
       dependency. The chunk arrives fine and then throws while being drawn,
       which is the case that reaches `componentDidCatch` — a rejected import
       would be caught by the same boundary but never hands it a `null`. */
    const load = async () => ({ default: ThrowsNull as unknown as () => ReactNode });

    await mount(
      <AppBoundary>
        <LazyPage load={load} routeKey="admin" />
      </AppBoundary>,
    );
    /* The `Suspense` resolves a microtask after the render, so the throw
       happens on a second pass. */
    await act(async () => {});

    expect(threw, "the lazy page never threw, so nothing was contained").toBeGreaterThan(0);
    expect(text(), "the chunk fallback did not draw").toContain("[chunk]");
    expect(text(), "the throw escaped to the root boundary").not.toContain("[render]");
    expect(clientErrors()).toContainEqual(
      expect.objectContaining({ source: "boundary", name: "Error" }),
    );
  });
});

describe("the feature boundary contains a throw that is not an Error", () => {
  it("draws [mode-render] rather than letting the throw reach the root", async () => {
    await mount(
      <AppBoundary>
        <FeatureBoundary
          name="Ideas"
          slug="a-slug"
          /* No activation token in play: this case is about the handler's
             *diagnostic* half. The retirement half, and a press to retire, are
             tests/a-broken-mode-leaves-the-article-readable.test.tsx's. */
          target={null}
          resetKey="a-slug|owner"
          onPlain={() => {}}
        >
          <ThrowsNull />
        </FeatureBoundary>
      </AppBoundary>,
    );

    expect(threw, "the feature never threw, so nothing was contained").toBeGreaterThan(0);
    expect(text(), "the band-shaped fallback did not draw").toContain("[mode-render]");
    expect(text(), "the throw escaped to the root boundary").not.toContain("[render]");
    expect(clientErrors()).toContainEqual(
      expect.objectContaining({ source: "boundary", name: "Error" }),
    );
  });
});
