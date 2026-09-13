// @vitest-environment jsdom
/**
 * **Nothing about the profile sits beside a paid button any more — no
 * checkbox, no sentence, no button — and the badge still says what the text
 * was written for.**
 *
 * Greg, 2026-09-12:
 *
 * > All the places where it has a little checkbox saying "use your profile",
 * > and remove that from the UI. Just always have it as on. So just assume that
 * > we're always going to use the profile, and we don't need to include it in
 * > the UI to ask them. So the UI is a bit tidier and more compact.
 *
 * Until 2026-09-13 a reader with a profile saw a row reading *☑ Use your
 * profile* and a button into the profile panel; a reader without one saw the
 * button labelled *Your profile*; and a run that had started itself said
 * *Using your profile* instead of the checkbox. The whole row went (GPT Sol's
 * review of docs/plans/260913a-drop-the-use-your-profile-checkbox.md, F3). What
 * is left is the *written for you* badge, which opens the panel.
 *
 * Drawn through the real `IdeasPanel`, so what is asserted is what a reader of
 * a panel meets. The checkbox, sentence and `ensure(true)` assertions were
 * watched fail against the checkbox version before it was removed.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
    slug: "constitution",
    error: null,
    job: null,
    failed: null,
    stalled: false,
    starting: false,
    ensure: async () => {},
    regenerate: async () => {},
    cancel: () => {},
    ...over,
  };
}

let host: HTMLDivElement;
let root: Root;

function draw(view: UseIdeas, ideas: { ideas: [] } | null = null): void {
  act(() => {
    root.render(
      createElement(IdeasPanel, {
        access: { kind: "owner", owner: view, ideas },
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

/** Everything the old row could have put on screen, in any of its states. */
function expectNoProfileRow(): void {
  expect(host.querySelector('input[type="checkbox"]'), "no tick to set").toBeNull();
  expect(host.querySelector(".prof-row"), "no row at all").toBeNull();
  expect(host.textContent).not.toContain("Use your profile");
  expect(host.textContent).not.toContain("Using your profile");
  expect(host.textContent).not.toContain("Your profile");
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

describe("beside the button that spends", () => {
  it("there is nothing about the profile, in the empty state", () => {
    draw(owner());
    expectNoProfileRow();
  });

  it("nor while a run is going", () => {
    draw(owner({ job: RUNNING }));
    expectNoProfileRow();
  });

  it("nor beside Find them again, on a list written for the profile", () => {
    draw(owner({ status: "ready", profiled: true }), { ideas: [] });
    expectNoProfileRow();
  });

  it("and the press sends no profile choice", async () => {
    /* `ensure` is the only thing the panel hands the press to, so what it is
       called with is what reaches the request. With the checkbox it was
       `ensure(true)` or `ensure(false)`; now nothing, and the server reads an
       absent `useProfile` as yes. */
    const ensure = vi.fn(async () => {});
    draw(owner({ ensure }));

    const press = [...host.querySelectorAll<HTMLButtonElement>("button")].find((b) =>
      b.textContent?.includes("Find the ideas"),
    );
    if (!press) throw new Error("no run button in the empty state");
    await act(async () => press.click());

    expect(ensure.mock.calls).toEqual([[]]);
  });
});

describe("the badge", () => {
  it("still says a list was written for the reader, and is the way into the panel", () => {
    draw(owner({ status: "ready", profiled: true }), { ideas: [] });
    const badge = host.querySelector<HTMLButtonElement>("button.prof-badge");
    expect(badge?.textContent).toContain("written for you");
  });
});
