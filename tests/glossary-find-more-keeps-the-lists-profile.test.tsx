// @vitest-environment jsdom
/**
 * **The glossary's Find more asks nothing about the profile.**
 *
 * From 2026-09-13 until plan 261001m the foot handed `more` the list's own
 * `profiled`, because `existingFor` refused to append across a profile
 * difference and an always-profiled Find more would have *rewritten* a plain
 * list under a button that says "more" (GPT Sol's review of
 * docs/plans/260913a-drop-the-use-your-profile-checkbox.md, F2).
 *
 * Since 261001m the glossary is a shared step: the server never hands it a
 * profile, and an unprofiled run appends to a legacy profiled list under that
 * list's own stamp (src/glossary.ts § existingFor, tests/glossary.test.ts). So
 * the flag is dead, and the name of this file now means only that: the list
 * keeps its stamp, and the press carries no setting.
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
    cancel: noop,
    look: async () => {},
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
  it("tops a list up, plain or profiled, without a profile setting", async () => {
    for (const hash of [null, "the-profile"]) {
      const more = vi.fn(async () => {});
      await mount(owner(glossary(hash), { more }));
      await pressFindMore();
      expect(more.mock.calls).toEqual([[]]);
    }
  });

  it("offers no profile control of any kind beside it", async () => {
    await mount(owner(glossary(null), {}));
    const foot = host.querySelector(".gloss-foot");
    expect(foot?.querySelector('input[type="checkbox"]')).toBeNull();
    expect(host.querySelector(".prof-row")).toBeNull();
    expect(foot?.textContent).not.toContain("Your profile");
  });
});
