// @vitest-environment jsdom
/**
 * **The glossary's Find more continues the list in the setting it was written
 * with — not in whatever the current profile is.**
 *
 * Until 2026-09-13 the foot carried a *Use your profile* checkbox seeded from
 * the list on screen, so a plain list was topped up plainly unless the reader
 * ticked it. When the checkbox went (Greg, 2026-09-12: *"Just always have it
 * as on"*) the obvious simplification — always send the profile — would have
 * broken this: `existingFor` refuses to append across a profile difference
 * (src/glossary.ts), so Find more on a plain list would **rewrite** it,
 * dropping every term the model did not happen to return again, under a
 * button that says "more". GPT Sol's review of
 * docs/plans/260913a-drop-the-use-your-profile-checkbox.md, F2.
 *
 * So the foot hands `more` the list's own `profiled`, and this pins both
 * directions. The first was watched fail against the always-profile version.
 * The stage's half — that `more(false)` reaches the request as
 * `useProfile: false` — is tests/step-job-force.test.tsx.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GlossaryOwner } from "../src/web/GlossaryPanel.js";
import type { BlockId, Glossary, Job } from "../src/types.js";
import { DRIVER_STALLED } from "../src/job-state.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/* src/web/lib/api.ts reaches supabase at module scope — the same stub
   tests/quotes-find-more-panel.test.tsx installs. */
vi.mock("../src/web/lib/supabase.js", () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: { access_token: "t" } } }),
      refreshSession: async () => ({ data: { session: { access_token: "t" } } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signOut: async () => ({ error: null }),
    },
  },
  googleSignInAvailable: false,
}));

const { GlossaryPanel } = await import("../src/web/GlossaryPanel.js");

const noop = () => {};

function glossary(profileHash: string | null): Glossary {
  return {
    version: "test",
    generator: "test",
    slug: "constitution",
    sourceHash: "hash",
    profileHash,
    entries: [
      {
        id: "spya-term23",
        name: "Kolmogorov depth",
        kind: "concept",
        aliases: [],
        senseHere: "How much work it took to build the thing.",
        blocks: ["spya-bbbbbb" as BlockId],
      },
    ],
    passes: 1,
    generatedAt: "2026-09-01T09:00:00.000Z",
    elapsedMs: 1,
  };
}

function owner(list: Glossary, over: Partial<GlossaryOwner>): GlossaryOwner {
  return {
    status: "ready",
    glossary: list,
    stale: false,
    outdated: false,
    profiled: list.profileHash != null,
    profileChanged: false,
    slug: "constitution",
    error: null,
    job: null,
    failed: null,
    stalled: false,
    starting: false,
    find: async () => {},
    more: async () => {},
    refresh: async () => {},
    cancel: noop,
    look: async () => false,
    setHidden: async () => {},
    hiding: new Set<string>(),
    looking: null,
    lookFailed: null,
    lookDraft: null,
    lookKept: null,
    ask: async () => {},
    asking: false,
    askDraft: null,
    asked: null,
    askFailed: null,
    askTerm: null,
    clearAsked: noop,
    ...over,
  };
}

let host: HTMLDivElement;
let root: Root;

async function mount(view: GlossaryOwner): Promise<void> {
  await act(async () => {
    root.render(
      createElement(GlossaryPanel, {
        access: { kind: "owner", owner: view, glossary: view.glossary },
        termId: null,
        onTerm: noop,
        sort: "prioritised",
        onSort: noop,
        gate: null,
        onGate: noop,
        onJump: noop,
        onAskChat: noop,
      }),
    );
  });
}

/** The run row at the top of the column — the foot until 2026-10-03 (plan 261003c). */
function moreButton(): HTMLButtonElement | undefined {
  return [...host.querySelectorAll<HTMLButtonElement>(".gloss-more button")].find((b) =>
    /find more|find terms again/i.test(b.textContent ?? ""),
  );
}

async function pressFindMore(): Promise<void> {
  const button = moreButton();
  if (!button) throw new Error("no Find more at the top of the column");
  await act(async () => button.click());
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

describe("Find more at the top of the glossary", () => {
  it("tops a plain list up plainly", async () => {
    const more = vi.fn(async () => {});
    await mount(owner(glossary(null), { more }));
    await pressFindMore();
    expect(more.mock.calls).toEqual([[false]]);
  });

  it("tops a list written for the profile up for the profile", async () => {
    const more = vi.fn(async () => {});
    await mount(owner(glossary("the-profile"), { more }));
    await pressFindMore();
    expect(more.mock.calls).toEqual([[true]]);
  });

  /* **Regenerate in the profile panel is the forced run, and that is why it
     rewrites** (plan 261002b). The glossary has no "replace" verb: `more` is
     the forced run, and it appends only when the list's profile hash matches
     the reader's (src/glossary.ts § existingFor). The panel offers Regenerate
     only when the server says it does *not* match, so this forced run is a
     rewrite. `find` would be the wrong call — unforced, it can skip — and a
     panel that wired it would start a job that changed nothing. */
  it("Regenerate in the badge's panel asks for the forced run, for the profile", async () => {
    const more = vi.fn(async () => {});
    const find = vi.fn(async () => {});
    await mount(owner(glossary("an-old-profile"), { more, find, profileChanged: true }));
    const badge = host.querySelector<HTMLButtonElement>("button.prof-badge");
    if (!badge) throw new Error("no badge on a list written for a profile");
    await act(async () => badge.click());
    const regenerate = [...document.querySelectorAll<HTMLButtonElement>(".prof-panel button")].find((b) =>
      /regenerate/i.test(b.textContent ?? ""),
    );
    if (!regenerate) throw new Error("no Regenerate in the panel for a changed profile");
    await act(async () => regenerate.click());
    expect(more.mock.calls).toEqual([[true]]);
    expect(find).not.toHaveBeenCalled();
  });

  it("offers no profile control of any kind beside it", async () => {
    await mount(owner(glossary(null), {}));
    const row = host.querySelector(".gloss-more");
    expect(row?.querySelector('input[type="checkbox"]')).toBeNull();
    expect(host.querySelector(".prof-row")).toBeNull();
    expect(row?.textContent).not.toContain("Your profile");
  });
});

/* **At the top of the column, on every owner's list, outdated ones included**
   — Greg, 2026-10-02, spya-s660yh: *"There used to be a Find More button in
   Glossary mode. Add it back, at the top of the column"*. It was in the foot,
   and hidden on a list from an older prompt (plan 260929c), which is most
   lists; Greg's own was `glossary/4`. On such a list the forced run rewrites
   (`existingFor` refuses to append across prompt versions), so the button says
   so rather than "more". docs/plans/261003c-glossary-find-more-at-the-top-and-metadata-press-closes.md § 1. */
describe("where the run row is, and what it says", () => {
  it("is above Look up a term, and the foot holds no button", async () => {
    await mount(owner(glossary(null), {}));
    const row = host.querySelector(".gloss-more");
    const ask = host.querySelector(".gloss-ask");
    expect(row, "no run row").not.toBeNull();
    expect(ask, "no Look up a term").not.toBeNull();
    if (row && ask) {
      expect(row.compareDocumentPosition(ask) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    expect(host.querySelector(".gloss-foot")).toBeNull();
    expect(moreButton()?.textContent).toMatch(/find more/i);
  });

  it("on an outdated list, offers Find terms again, and it sends the same forced run", async () => {
    const more = vi.fn(async () => {});
    await mount(owner(glossary(null), { more, outdated: true }));
    const button = moreButton();
    expect(button?.textContent).toMatch(/find terms again/i);
    expect(button?.textContent).not.toMatch(/find more/i);
    await pressFindMore();
    expect(more.mock.calls).toEqual([[false]]);
  });

  /* The server's verdict wins over the panel's two facts: it also sees a
     changed or cleared profile, which `outdated` and `stale` do not
     (`panelRunKind`, GPT Sol's plan review P1). */
  it("says Find terms again when the server says the press rewrites, on a current list", async () => {
    await mount(owner(glossary("a-profile"), { panelRun: "rewrite" }));
    expect(moreButton()?.textContent).toMatch(/find terms again/i);
  });

  it("says Find more when the server says the press appends", async () => {
    await mount(owner(glossary(null), { panelRun: "append" }));
    expect(moreButton()?.textContent).toMatch(/find more/i);
  });

  it("on a stale list, the banner says so and the one run button is the top row's", async () => {
    await mount(owner(glossary(null), { stale: true }));
    expect(host.querySelector(".gloss-stale")).not.toBeNull();
    expect(host.querySelector(".gloss-stale button")).toBeNull();
    expect(moreButton()?.textContent).toMatch(/find terms again/i);
  });

  it("while a run is going, shows its progress in the same place", async () => {
    await mount(owner(glossary(null), { starting: true }));
    expect(host.querySelector(".gloss-more")?.textContent).toMatch(/starting/i);
  });

  /* Moving the stale banner's progress into the run row must carry its
     transport warning and Retry too — a healthy poll is not proof the tab
     can advance the job. Code review of 261003c. */
  it.each([false, true])("keeps the stalled-job warning in the one run row (stale: %s)", async (stale) => {
    const job: Job = {
      id: "job-glossary",
      ownerId: "owner" as Job["ownerId"],
      slug: "constitution",
      status: "running",
      createdAt: new Date().toISOString(),
      startedAt: new Date().toISOString(),
      steps: [{ name: "glossary", label: "Finding the terms", status: "running" }],
    };
    await mount(owner(glossary(null), { stale, job, stalled: true }));
    expect(host.querySelector(".gloss-more")?.textContent).toContain(DRIVER_STALLED);
    expect(host.textContent?.split(DRIVER_STALLED)).toHaveLength(2);
    await mount(owner(glossary(null), { stale, job, stalled: false }));
    expect(host.textContent).not.toContain(DRIVER_STALLED);
    expect(host.querySelector(".gloss-more")?.textContent).toContain("Stop");
  });

  it("retries a failed stale-list job rather than sending a fresh run", async () => {
    const retry = vi.fn(async () => {});
    const more = vi.fn(async () => {});
    await mount(owner(glossary(null), {
      stale: true,
      more,
      failed: { message: "The connection failed.", retryable: true, retry },
    }));
    const button = [...host.querySelectorAll<HTMLButtonElement>(".gloss-more button")]
      .find((b) => b.textContent?.includes("Retry"));
    expect(button, "no Retry for the failed job").toBeDefined();
    await act(async () => button?.click());
    expect(retry).toHaveBeenCalledOnce();
    expect(more).not.toHaveBeenCalled();
  });

  it("offers no paid run under a stale-list failure another go cannot fix", async () => {
    await mount(owner(glossary(null), {
      stale: true,
      failed: { message: "The article is too long.", retryable: false, retry: null },
    }));
    expect(host.querySelector(".gloss-more")?.textContent).toContain("The article is too long.");
    expect(host.querySelector(".gloss-more button")).toBeNull();
  });

  it("keeps the run button for an owner's zero-entry list", async () => {
    await mount(owner({ ...glossary(null), entries: [] }, {}));
    expect(moreButton()?.textContent).toMatch(/find more/i);
  });
});
