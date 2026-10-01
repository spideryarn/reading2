// @vitest-environment jsdom
/**
 * **The glossary's *Dig deeper* button, with and without an answer already
 * there** — `Looked` in src/web/GlossaryPanel.tsx, plan 261001p stage 1.
 *
 * Sol F10: the button used to be drawn only while an entry had no answer, so
 * an entry checked before Dig deeper existed — perhaps one that says *no web
 * search* — could never be dug into. Now it is drawn under the answer as
 * *Dig deeper again*, and the old answer stays on screen while a new one
 * arrives and when one fails.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GlossaryEntry, GlossaryLookup } from "../src/types.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/* src/web/lib/api.ts reaches supabase at module scope — the same stub
   tests/glossary-lookup-label.test.tsx installs. */
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

const { Looked } = await import("../src/web/GlossaryPanel.js");

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const LOOKUP: GlossaryLookup = {
  answer: "The old answer.",
  citations: [],
  searches: 0,
  model: "a-model",
  at: "2026-09-10T00:00:00.000Z",
};
const ENTRY = {
  id: "spya-pppppp",
  name: "predictive processing",
  kind: "term",
  aliases: [],
  background: "",
  blocks: ["spya-aaaaaa"],
} as unknown as GlossaryEntry;

function draw(opts: {
  lookup?: GlossaryLookup;
  owner?: boolean;
  looking?: boolean;
  draft?: string | null;
  failed?: string | null;
}): { pressed: string[] } {
  const pressed: string[] = [];
  act(() =>
    root.render(
      createElement(Looked, {
        entry: opts.lookup ? { ...ENTRY, lookup: opts.lookup } : ENTRY,
        look:
          opts.owner === false
            ? null
            : async (id: string) => {
                pressed.push(id);
              },
        looking: opts.looking ?? false,
        busy: opts.looking ?? false,
        unquoted: false,
        draft: opts.draft ?? null,
        failed: opts.failed ?? null,
      }),
    ),
  );
  return { pressed };
}

const button = () => host.querySelector<HTMLButtonElement>("button.gloss-btn");

describe("the Dig deeper button", () => {
  it("is Dig deeper on an entry with no answer, with the tooltip that says what it does", () => {
    draw({});
    expect(button()?.textContent).toBe("Dig deeper");
    expect(button()?.title).toBe(
      "Searches the web and asks a stronger model about this one thing. It takes longer than the first answer.",
    );
  });

  it("is Dig deeper again under an answer already there, and presses for that entry", () => {
    const { pressed } = draw({ lookup: LOOKUP });
    expect(host.textContent).toContain("The old answer.");
    expect(button()?.textContent).toBe("Dig deeper again");
    act(() => button()?.click());
    expect(pressed).toEqual([ENTRY.id]);
  });

  it("keeps the old answer on screen while the new one arrives, and when it fails", () => {
    draw({ lookup: LOOKUP, looking: true, draft: "A new answ" });
    expect(host.textContent).toContain("The old answer.");
    expect(host.textContent).toContain("A new answ");
    expect(button()?.textContent).toBe("Digging deeper…");

    draw({ lookup: LOOKUP, failed: "It did not work. [dig-no-search]" });
    expect(host.textContent).toContain("The old answer.");
    expect(host.textContent).toContain("[dig-no-search]");
    expect(button()?.textContent).toBe("Dig deeper again");
  });

  it("is not drawn for a visitor, who still sees an answer", () => {
    draw({ lookup: LOOKUP, owner: false });
    expect(host.textContent).toContain("The old answer.");
    expect(button()).toBeNull();
  });
});
