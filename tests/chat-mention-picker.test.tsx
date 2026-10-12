// @vitest-environment jsdom
/**
 * **The `@` list in Chat's box** — plan
 * docs/plans/261012d-chat-at-mention-your-own-articles.md § 1, the composer
 * half (src/web/MentionPicker.tsx, `Composer` in src/web/ChatPanel.tsx).
 *
 * - While the list is open, Enter picks rather than sends.
 * - Escape closes the list and leaves the draft alone — its first rung — and
 *   not while an input method is composing.
 * - The list leaves out the open article and an unread (minimal) paper.
 * - The "Bringing in" row, not the text, decides what is sent.
 * - Only typed Chat's box has the list at all.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LibraryEntry } from "../src/types.js";
import type { SendHow } from "../src/web/ChatPanel.js";

function entry(slug: string, title: string, extra: Partial<LibraryEntry> = {}): LibraryEntry {
  return {
    slug,
    title,
    addedAt: "2026-10-01T10:00:00.000Z",
    words: 100,
    minutes: 1,
    blocks: 3,
    parts: 1,
    sections: 1,
    comments: 0,
    sourceReusable: true,
    opens: 1,
    has: { arc: false, tweets: false, glossary: false },
    ...extra,
  } as LibraryEntry;
}

const SHELF = [
  entry("open-one", "The open article", { lastOpenedAt: "2026-10-12T10:00:00.000Z" }),
  entry("smith-2024", "Smith 2024, Replication", {
    url: "https://www.nature.com/articles/x",
    lastOpenedAt: "2026-10-11T10:00:00.000Z",
  }),
  entry("a-paper", "Replication abstract only", { processing: "minimal", lastOpenedAt: "2026-10-12T09:00:00.000Z" }),
];
const ARCHIVE = [entry("reply-to-jones", "Reply to Jones", { lastOpenedAt: "2026-10-10T10:00:00.000Z", archivedAt: "2026-10-10T11:00:00.000Z" })];

vi.mock("../src/web/lib/api.js", async () => {
  const real = await vi.importActual<typeof import("../src/web/lib/api.js")>("../src/web/lib/api.js");
  return {
    ...real,
    apiFetch: async (url: string) =>
      new Response(JSON.stringify({ articles: String(url).includes("archived=1") ? ARCHIVE : SHELF }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  };
});

const { Composer } = await import("../src/web/ChatPanel.js");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
let sent: { question: string; how: SendHow | undefined }[];

function paint(kind: "chat" | "guide" = "chat"): void {
  act(() => {
    root.render(
      createElement(Composer, {
        slug: "open-one",
        keepAs: "chat:open-one:t",
        onSend: (question: string, how?: SendHow) => {
          sent.push({ question, how });
        },
        busy: false,
        focusNonce: 0,
        focused: { current: 0 },
        draft: "",
        onDraft: () => {},
        kind,
      }),
    );
  });
}

const box = () => host.querySelector<HTMLTextAreaElement>("textarea.chat-input") as HTMLTextAreaElement;
const options = () => [...document.querySelectorAll<HTMLElement>('[role="option"]')];
const listbox = () => document.querySelector('[role="listbox"]');

async function type(text: string): Promise<void> {
  const el = box();
  await act(async () => {
    el.focus();
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(el, text);
    el.setSelectionRange(text.length, text.length);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  /* The list's one fetch. */
  await act(async () => {
    for (let i = 0; i < 6; i += 1) await Promise.resolve();
    await new Promise((go) => setTimeout(go, 0));
  });
}

function press(key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const e = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  act(() => {
    box().dispatchEvent(e);
  });
  return e;
}

beforeEach(() => {
  sent = [];
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("the @ list", () => {
  it("lists the reader's articles, newest opened first, without the open one or an unread paper", async () => {
    paint();
    await type("compare with @");
    expect(box().getAttribute("role")).toBe("combobox");
    expect(box().getAttribute("aria-expanded")).toBe("true");
    expect(listbox()?.getAttribute("aria-label")).toBe("Your articles");
    expect(box().getAttribute("aria-controls")).toBe(listbox()?.id);
    expect(box().getAttribute("aria-activedescendant")).toBe(options()[0]?.id);
    const titles = options().map((o) => o.textContent);
    expect(titles).toEqual(["Smith 2024, Replicationnature.com", "Reply to Jonesarchived"]);
  });

  it("narrows by title", async () => {
    paint();
    await type("compare with @jon");
    expect(options().map((o) => o.querySelector(".mention-picker-title")?.textContent)).toEqual(["Reply to Jones"]);
  });

  it("picks on Enter rather than sending, and puts the article in the row", async () => {
    paint();
    await type("compare with @rep");
    const e = press("Enter");
    expect(e.defaultPrevented).toBe(true);
    expect(sent).toEqual([]);
    expect(box().value).toBe("compare with @Smith 2024, Replication ");
    expect(host.querySelector(".mention-chips")?.textContent).toContain("Smith 2024, Replication");
    expect(listbox()).toBeNull();
  });

  it("picks a row on Tab, but leaves Tab alone when there is no row", async () => {
    paint();
    await type("compare with @jon");
    const picked = press("Tab");
    expect(picked.defaultPrevented).toBe(true);
    expect(box().value).toBe("compare with @Reply to Jones ");

    await type("compare");
    await type("compare with @nobody");
    const empty = press("Tab");
    expect(empty.defaultPrevented).toBe(false);
    expect(sent).toEqual([]);
  });

  it("closes a no-match query on Enter, but sends it once a space makes it prose", async () => {
    paint();
    await type("compare with @nobody");
    const closed = press("Enter");
    expect(closed.defaultPrevented).toBe(true);
    expect(sent).toEqual([]);
    expect(listbox()).toBeNull();

    await type("compare with @nobody please");
    expect(listbox()).toBeNull();
    press("Enter");
    expect(sent.map((s) => s.question)).toEqual(["compare with @nobody please"]);
  });

  it("picks on pointerdown before a touch can blur the box", async () => {
    paint();
    await type("compare with @jon");
    const row = options()[0] as HTMLElement;
    const down = new MouseEvent("pointerdown", { bubbles: true, cancelable: true });
    act(() => {
      row.dispatchEvent(down);
      box().blur();
    });
    expect(down.defaultPrevented).toBe(true);
    expect(box().value).toBe("compare with @Reply to Jones ");
    expect(host.querySelector(".mention-chips")?.textContent).toContain("Reply to Jones");
  });

  it("closes on Escape and keeps the draft — and a second Escape is the ladder's old first rung", async () => {
    paint();
    await type("compare with @");
    press("Escape");
    expect(listbox()).toBeNull();
    expect(box().value).toBe("compare with @");
    press("Escape");
    expect(box().value).toBe("");
  });

  it("stays open on an Escape an input method is using", async () => {
    paint();
    await type("compare with @");
    press("Escape", { isComposing: true });
    expect(listbox()).not.toBeNull();
    expect(box().value).toBe("compare with @");
  });

  it("sends what the row holds, not what the text says", async () => {
    paint();
    await type("compare with @jon");
    press("Enter");
    /* The reader rewrites the words, @Title and all: the article still goes. */
    await type("compare the two");
    press("Enter");
    expect(sent).toHaveLength(1);
    expect(sent[0]?.how?.mentions?.slugs).toEqual(["reply-to-jones"]);
  });

  it("sends nothing for an @Title whose chip was taken out", async () => {
    paint();
    await type("compare with @jon");
    press("Enter");
    const remove = host.querySelector<HTMLButtonElement>(".mention-chip-x");
    act(() => remove?.click());
    /* Nothing matches a search with a space in it, so the list lets it go. */
    await type("compare with @Reply to Jones please");
    expect(listbox()).toBeNull();
    press("Enter");
    expect(sent).toHaveLength(1);
    expect(sent[0]?.how?.mentions).toBeUndefined();
  });

  it("keeps the row until the server accepts the question", async () => {
    paint();
    await type("compare with @jon");
    press("Enter");
    await type("compare");
    press("Enter");
    expect(host.querySelector(".mention-chips")).not.toBeNull();
    act(() => sent[0]?.how?.mentions?.onAccepted());
    expect(host.querySelector(".mention-chips")).toBeNull();
  });

  it("restores the submitted words and keeps the row when the server refuses before begin", async () => {
    paint();
    await type("compare with @jon");
    press("Enter");
    await type("compare the two");
    press("Enter");
    expect(box().value).toBe("");
    act(() => sent[0]?.how?.mentions?.onRefused?.());
    expect(box().value).toBe("compare the two");
    expect(host.querySelector(".mention-chips")?.textContent).toContain("Reply to Jones");
  });

  it("is not there in a box that is not typed Chat's", async () => {
    paint("guide");
    await type("hello @");
    expect(box().getAttribute("role")).toBeNull();
    expect(listbox()).toBeNull();
    press("Enter");
    expect(sent).toHaveLength(1);
    expect(sent[0]?.how?.mentions).toBeUndefined();
  });
});
