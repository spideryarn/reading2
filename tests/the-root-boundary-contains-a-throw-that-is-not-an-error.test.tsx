// @vitest-environment jsdom
/**
 * **The last boundary must survive being handed something that is not an Error.**
 *
 * React passes `componentDidCatch` the thrown value unchanged, so a component
 * that does `throw null` — a real thing components do — gives the handler
 * something with no `.name`. `AppBoundary` used to read `error.name` there, and
 * that read threw a second time *out of the handler itself*. There is nothing
 * above the root boundary to catch that, so the reader got an empty `#root`:
 * the failure mode the boundary exists to prevent, arriving through the
 * boundary. Sol, 2026-09-06, F15.
 *
 * The same defect was fixed in `src/web/FeatureBoundary.tsx` and is covered by
 * tests/a-broken-mode-leaves-the-article-readable.test.tsx § contains a throw of
 * something that is not an Error at all. That case cannot cover this one: the
 * feature boundary contains the throw, so the `null` never reaches
 * `AppBoundary`, and reverting `AppBoundary.tsx` alone left all seventeen of
 * those tests green. Hence this file, which mounts the root boundary on its own.
 *
 * docs/plans/260905h-a-mode-failure-should-leave-the-article-readable.md.
 */
import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AppBoundary } from "../src/web/AppBoundary.js";
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

describe("the root boundary contains a throw that is not an Error", () => {
  it("still draws its apology, and still records the failure", async () => {
    let threw = 0;
    function ThrowsNull(): never {
      threw += 1;
      throw null;
    }

    await act(async () => {
      root.render(
        <StrictMode>
          <AppBoundary>
            <ThrowsNull />
          </AppBoundary>
        </StrictMode>,
      );
    });

    /* The positive control: a child that quietly stopped throwing would make
       everything below pass over a page that never failed.
       docs/reusable/silent-success.md. */
    expect(threw, "the probe never threw, so nothing was contained").toBeGreaterThan(0);
    /* Matched on the bracketed code rather than the sentence, so the words stay
       rewritable — docs/project/copy.md. */
    expect(text(), "the root fallback did not draw").toContain("[render]");
    /* And the handler ran to its end rather than throwing out of the middle of
       itself: the name it could not read fell back to the constant. */
    expect(readLogBuffer().filter((entry) => entry.kind === "client-error")).toContainEqual(
      expect.objectContaining({ source: "boundary", name: "Error" }),
    );
  });
});
