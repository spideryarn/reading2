// @vitest-environment jsdom
/**
 * **An automatic run took the profile decision, so the panel states it rather
 * than offering a tick it has disabled.**
 *
 * Greg's call, 2026-08-31, when the auto-run was designed:
 *
 * > Today's empty states let the reader untick *use my profile* before pressing
 * > the paid button. An automatic run has nobody to ask, so it takes the
 * > default — profile on — and the panel then states it in words. **Not a
 * > disabled tickbox**, which reads as a choice the reader missed rather than a
 * > decision already taken.
 *
 * The distinction is invisible to a request trace and to a screenshot taken
 * without knowing what to look at, which is why it is pinned here: a disabled
 * checkbox and a sentence occupy the same slot and read as the same greyed-out
 * thing at a glance. What separates them is whether the input element exists,
 * and that is what these assert.
 *
 * The other half — that a **manual** press still gets the real control — is the
 * control for it. Without that, deleting the checkbox entirely would be green.
 *
 * docs/plans/260902e-a-per-article-job-queue-that-appends-and-modes-that-start-themselves.md § 2d.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { IdeasPanel } from "../src/web/IdeasPanel.js";
import type { UseIdeas } from "../src/web/useIdeas.js";
import type { Job } from "../src/types.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** A job on the record, so the panel is drawing a run rather than a button. */
const RUNNING = {
  id: "job-1",
  slug: "constitution",
  status: "running",
  steps: [{ name: "ideas", status: "running" }],
  createdAt: 1,
  updatedAt: 1,
} as unknown as Job;

function owner(over: Partial<UseIdeas> = {}): UseIdeas {
  return {
    status: "none",
    ideas: null,
    stale: false,
    outdated: false,
    profiled: false,
    profileChanged: false,
    hasProfile: true,
    slug: "constitution",
    error: null,
    job: null,
    failed: null,
    stalled: false,
    starting: false,
    automatic: false,
    ensure: async () => {},
    regenerate: async () => {},
    cancel: () => {},
    ...over,
  };
}

let host: HTMLDivElement;
let root: Root;

function draw(view: UseIdeas): void {
  act(() => {
    root.render(
      createElement(IdeasPanel, {
        access: { kind: "owner", owner: view, ideas: null },
        ideaId: null,
        onIdea: () => {},
        found: [],
        openKey: null,
        onOpenKey: () => {},
        onJump: () => {},
      }),
    );
  });
}

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("the empty state, while a run this reader did not start is under way", () => {
  it("says which profile it is using, and offers no tick", () => {
    draw(owner({ automatic: true, job: RUNNING }));

    expect(host.textContent).toContain("Using your profile");
    expect(host.querySelector('input[type="checkbox"]'), "no tick to miss").toBeNull();
  });

  it("still offers the tick when the reader is the one pressing", () => {
    /* The control. Without it, a panel that had lost the checkbox altogether
       would satisfy the test above. */
    draw(owner());

    const tick = host.querySelector<HTMLInputElement>('input[type="checkbox"]');
    expect(tick, "the reader chooses, when there is a reader to ask").not.toBeNull();
    expect(host.textContent).toContain("Use your profile");
    expect(host.textContent).not.toContain("Using your profile");
  });
});
