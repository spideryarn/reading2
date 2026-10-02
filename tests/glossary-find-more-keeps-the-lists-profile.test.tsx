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
import type { BlockId, Glossary } from "../src/types.js";

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

async function pressFindMore(): Promise<void> {
  const button = [...host.querySelectorAll<HTMLButtonElement>(".gloss-foot button")].find((b) =>
    /find more/i.test(b.textContent ?? ""),
  );
  if (!button) throw new Error("no Find more in the foot");
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

describe("Find more in the glossary's foot", () => {
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
    const foot = host.querySelector(".gloss-foot");
    expect(foot?.querySelector('input[type="checkbox"]')).toBeNull();
    expect(host.querySelector(".prof-row")).toBeNull();
    expect(foot?.textContent).not.toContain("Your profile");
  });
});
