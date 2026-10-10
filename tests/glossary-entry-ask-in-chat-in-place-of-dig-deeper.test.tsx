// @vitest-environment jsdom
/**
 * **An open Glossary entry has *Ask in chat* where *Dig deeper* was, and a
 * kept lookup answer is still drawn** — `Looked` in src/web/GlossaryPanel.tsx,
 * plan docs/plans/261009k-ask-in-chat-replaces-dig-deeper-and-a-chat-goes-back-to-its-item.md
 * § Stage 1.
 *
 * Greg, 2026-10-09 (spya-tv6wn5): *"we don't need the dig deeper button"*.
 * Until then `Looked` returned early when it had no dig to offer, before it
 * drew *Ask in chat*, so the chat button hung off the dig's prop. These pin
 * the other way round: the chat button is drawn from `chats` alone, a kept
 * answer is drawn from the entry alone, and no surface offers Dig deeper.
 *
 * It replaced tests/glossary-dig-deeper-button.test.tsx, which pinned the
 * button and its *Dig deeper again* (plan 261001p, Sol F10).
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GlossaryEntry, GlossaryLookup, ThreadSummary } from "../src/types.js";

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
const { ASK_ENTRY_IN_CHAT, OPEN_ENTRY_CHAT } = await import("../src/web/OriginChat.js");

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

const STARTED: ThreadSummary = {
  id: "spya-thrd01",
  title: "About predictive processing",
  createdAt: "2026-10-09T00:00:00.000Z",
  updatedAt: "2026-10-09T00:00:00.000Z",
  kind: "chat",
  turns: 2,
  lastLine: "It is a theory of perception.",
  origin: { mode: "glossary", itemId: ENTRY.id, quote: ENTRY.name },
};

function draw(opts: {
  entry?: GlossaryEntry;
  owner?: boolean;
  summaries?: ThreadSummary[];
}): { asked: Pick<GlossaryEntry, "id" | "name">[]; opened: string[] } {
  const asked: Pick<GlossaryEntry, "id" | "name">[] = [];
  const opened: string[] = [];
  act(() =>
    root.render(
      createElement(Looked, {
        entry: opts.entry ?? ENTRY,
        chats:
          opts.owner === false
            ? null
            : {
                summaries: opts.summaries ?? [],
                onAsk: (entry) => void asked.push(entry),
                onOpen: (id) => void opened.push(id),
              },
      }),
    ),
  );
  return { asked, opened };
}

const askButton = () => host.querySelector<HTMLButtonElement>("button.gloss-ask-chat");
const anyDigDeeper = () =>
  [...host.querySelectorAll("button")].filter((b) => /Dig deeper|Digging deeper/.test(b.textContent ?? ""));

describe("an open Glossary entry, for its owner", () => {
  it("has Ask in chat and no Dig deeper, and the press asks about that entry", () => {
    const { asked } = draw({});
    expect(anyDigDeeper(), "Dig deeper is gone (plan 261009k)").toEqual([]);
    expect(host.querySelector(".gloss-dig")).toBeNull();
    const button = askButton();
    expect(button?.textContent?.trim(), "icon only (plan 261010g)").toBe("");
    expect(button?.getAttribute("aria-label")).toBe(ASK_ENTRY_IN_CHAT);
    act(() => button?.click());
    expect(asked).toEqual([ENTRY]);
  });

  it("still draws a kept lookup answer, with Ask in chat under it and no Dig deeper again", () => {
    draw({ entry: { ...ENTRY, lookup: LOOKUP } });
    expect(host.textContent).toContain("The old answer.");
    expect(askButton()).not.toBeNull();
    expect(anyDigDeeper()).toEqual([]);
  });

  it("offers Ask in chat on a term the article never quotes", () => {
    draw({ entry: { ...ENTRY, blocks: [] } });
    expect(askButton()?.disabled).toBe(false);
  });

  it("shows the way back to a chat already started from it", () => {
    const { opened } = draw({ summaries: [STARTED] });
    const mark = host.querySelector<HTMLButtonElement>("button.origin-chat");
    expect(mark?.getAttribute("aria-label")).toBe(OPEN_ENTRY_CHAT);
    act(() => mark?.click());
    expect(opened).toEqual([STARTED.id]);
  });
});

describe("an open Glossary entry, for a visitor", () => {
  it("draws a kept answer and no buttons at all", () => {
    draw({ entry: { ...ENTRY, lookup: LOOKUP }, owner: false });
    expect(host.textContent).toContain("The old answer.");
    expect(host.querySelectorAll("button")).toHaveLength(0);
  });

  it("draws nothing for an entry with no answer", () => {
    draw({ owner: false });
    expect(host.innerHTML).toBe("");
  });
});
