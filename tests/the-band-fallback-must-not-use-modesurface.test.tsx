// @vitest-environment jsdom
/**
 * **The one duplicated `<aside className="mode-band">` in production, and the
 * test that stops somebody tidying it away.**
 *
 * `FeatureBoundary`'s fallback hand-writes its own band shell. Every other band
 * in the reader now goes through `src/web/ModeSurface.tsx` — twelve of them, as
 * of stage 2 of
 * docs/plans/260906f-the-active-mode-gets-one-surface-and-one-way-to-fit-the-screen.md
 * — so that one leftover copy looks exactly like an oversight, and the obvious
 * next commit migrates it for symmetry. That commit would be a P1.
 *
 * ## Why the copy has to stay
 *
 * A React error boundary catches a throw from its *children*, and then renders
 * its fallback **in its own place in the tree**. So if the throw came from
 * `ModeSurface` itself, a fallback that also rendered `ModeSurface` would invoke
 * the component that had just thrown, throw a second time, and — because a
 * boundary cannot catch its own render — send that second throw up to
 * `AppBoundary`, which replaces the entire reader with a page-level apology.
 *
 * That is precisely the failure
 * docs/plans/260905h-a-mode-failure-should-leave-the-article-readable.md exists
 * to prevent: a broken mode must leave the article readable. The duplication is
 * a **circuit breaker**, not an oversight, and this file is the thing that says
 * so out loud. GPT Sol found it while reviewing the plan (F4, 2026-09-06) and
 * built a React 19 harness to confirm the second throw reaches the root; the
 * plan's acceptance for stage 2 was then rewritten to require that migrating the
 * fallback makes a test fail. This is that test.
 *
 * ## How it forces the question
 *
 * `ModeSurface` is mocked to throw. That is not a contrived failure — it stands
 * for any bug in the one component every band now depends on, which is exactly
 * the class of fault that got riskier the moment twelve panels started sharing
 * it. With the mock in place:
 *
 * - a panel rendering `ModeSurface` throws;
 * - `FeatureBoundary` catches it and renders its **raw** fallback, which does
 *   not touch `ModeSurface` and therefore renders;
 * - the prose and the dock beside it are untouched, and `AppBoundary` never
 *   fires.
 *
 * Change that fallback to use `ModeSurface` and the second throw escapes: the
 * feature fallback disappears, the prose and dock go with it, and the assertions
 * below fail one after another. **Watched, 2026-09-07** — the fallback was
 * temporarily rewritten to render `ModeSurface` and this file went red on
 * exactly those assertions before being restored.
 */
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The shared surface, replaced by a component that always throws.
 *
 * Mocked at the module the panels import, so anything reaching for it in this
 * file gets the throwing version — including, if somebody migrates it, the
 * fallback.
 */
vi.mock("../src/web/ModeSurface.js", () => ({
  ModeSurface: () => {
    throw new Error("ModeSurface itself is broken");
  },
}));

const { FeatureBoundary } = await import("../src/web/FeatureBoundary.js");
const { AppBoundary } = await import("../src/web/AppBoundary.js");
const { ModeSurface } = await import("../src/web/ModeSurface.js");

let host: HTMLDivElement;
let root: Root;
/** React logs a caught error; the boundary is the point, so the noise is not. */
let errors: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  errors = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  errors.mockRestore();
});

/**
 * A mode panel, exactly as all twelve are now written: its band is the surface.
 *
 * `children` goes in the props object rather than as `createElement`'s variadic
 * third argument, because `ModeSurface` declares `children` as required and
 * TypeScript does not fold the variadic form back into the props type — the call
 * is correct at runtime either way and only one of the two type-checks.
 */
function BandedPanel(): ReactNode {
  return createElement(ModeSurface, {
    label: "Ideas",
    feature: "gloss ideas",
    children: "the ideas",
  });
}

/**
 * The reader in miniature: prose, the failing band inside its boundary, the dock
 * — all inside `AppBoundary`, which is what a second throw would reach.
 *
 * The prose and the dock are here as **witnesses**, not decoration. "The article
 * is still readable" is the actual requirement, and a test that only checked for
 * the fallback's sentence would pass over a page that had lost everything else.
 */
async function mountReader(): Promise<void> {
  await act(async () => {
    root.render(
      createElement(
        AppBoundary,
        null,
        createElement("div", { className: "prose", key: "p" }, "The article's own words."),
        createElement(FeatureBoundary, {
          key: "b",
          name: "Ideas",
          slug: "a-piece",
          target: null,
          resetKey: "ideas",
          onPlain: () => {},
          children: createElement(BandedPanel),
        }),
        createElement("div", { className: "dock", key: "d" }, "Dock"),
      ),
    );
  });
}

describe("when ModeSurface itself throws, the feature fallback still stands", () => {
  it("draws the feature's own fallback rather than the page-level one", async () => {
    await mountReader();

    /* The fallback names the mode and labels itself as a band that is not
       working — `FeatureBoundary.tsx`. Its presence is the whole claim: it was
       rendered *after* `ModeSurface` threw, by a fallback that does not use
       `ModeSurface`. */
    const fallback = host.querySelector('aside[aria-label="Ideas is not working"]');
    expect(fallback, "the feature fallback's band").not.toBeNull();
    expect(fallback?.textContent).toContain("Ideas stopped working");

    /* And the page-level apology is absent. This is the assertion that fails
       first if the fallback is ever migrated: the second throw escapes, and
       `AppBoundary` replaces everything below it. */
    expect(host.textContent, "the page-level fallback").not.toContain(
      "Something in Spideryarn broke",
    );
  });

  it("leaves the article and the dock exactly where they were", async () => {
    await mountReader();

    /* The requirement in one line: a broken mode leaves the article readable.
       If the throw reached `AppBoundary` these would both be gone, because that
       boundary replaces its whole subtree rather than a part of it. */
    expect(host.querySelector(".prose")?.textContent).toBe("The article's own words.");
    expect(host.querySelector(".dock")?.textContent).toBe("Dock");
  });

  it("keeps the fallback's band raw — it must not be the shared surface", async () => {
    await mountReader();

    /* The structural half of the same claim, and the reason it is asserted
       rather than left to the two above: those two would also pass if somebody
       migrated the fallback *and* `ModeSurface` happened not to throw that day.
       Here the surface is broken by construction, so a fallback that rendered a
       band at all is a fallback that did not go through it. */
    const fallback = host.querySelector('aside[aria-label="Ideas is not working"]');
    expect(fallback?.getAttribute("class"), "the fallback's own bare band").toBe("mode-band");
  });
});
