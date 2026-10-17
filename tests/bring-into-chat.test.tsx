// @vitest-environment jsdom
/**
 * ***Bring into this chat*** in the composer — plan
 * docs/plans/261017e-bring-a-web-page-into-chat.md § Stage 1.
 *
 * - An article handed to the box joins the "Bringing in" row, its
 *   `@Short title ` at the end of the words, once, and the row's cap holds.
 * - The question then carries it, as a pick from the `@` list would.
 * - An address in the draft gets a button; the guide's box does not.
 * - Pressing it for a page already on the shelf puts the chip in at once,
 *   with the shelf's title, and asks for the reader's own copy.
 */
import { act, createElement, createRef, type MutableRefObject } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SendHow } from "../src/web/ChatPanel.js";
import type { BringIn } from "../src/web/BringIntoChat.js";

const posted: unknown[] = [];
/* Each POST waits on this when set, so a test can act before it answers. */
let hold: Promise<void> | null = null;

vi.mock("../src/web/lib/api.js", async () => {
  const real = await vi.importActual<typeof import("../src/web/lib/api.js")>("../src/web/lib/api.js");
  return {
    ...real,
    apiFetch: async (url: string) =>
      new Response(
        JSON.stringify({
          articles: String(url).includes("archived=1")
            ? []
            : [
                {
                  slug: "smith-2024",
                  title: "Smith 2024, Replication",
                  addedAt: "2026-10-01T10:00:00.000Z",
                  url: "https://a.example/essay",
                },
              ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
  };
});

vi.mock("../src/web/useJobs.js", async () => {
  const real = await vi.importActual<typeof import("../src/web/useJobs.js")>("../src/web/useJobs.js");
  return {
    ...real,
    useJobs: () => ({
      jobs: [],
      add: async (url: string, options?: unknown) => {
        posted.push({ url, options });
        if (hold) await hold;
        return { article: "smith-2024", repeat: true };
      },
      lastFailure: () => null,
    }),
  };
});

const { Composer } = await import("../src/web/ChatPanel.js");
const { noteReader } = await import("../src/web/lib/reader-change.js");
const { withMentionAtEnd } = await import("../src/web/mentions.js");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
let sent: { question: string; how: SendHow | undefined }[];
let into: MutableRefObject<BringIn | null>;

function paint(kind: "chat" | "guide" = "chat", draft = ""): void {
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
        draft,
        onDraft: () => {},
        kind,
        bringInTo: into,
      }),
    );
  });
}

const box = () => host.querySelector<HTMLTextAreaElement>("textarea.chat-input") as HTMLTextAreaElement;
const chips = () => [...host.querySelectorAll(".mention-chip")].map((c) => c.textContent);

async function settle(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 8; i += 1) await Promise.resolve();
    await new Promise((go) => setTimeout(go, 0));
  });
}

function hand(slug: string, title: string): string | null {
  let out: string | null = null;
  act(() => {
    out = (into.current as BringIn)({ slug, title });
  });
  return out;
}

beforeEach(() => {
  sent = [];
  posted.length = 0;
  hold = null;
  into = createRef<BringIn | null>() as MutableRefObject<BringIn | null>;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("withMentionAtEnd", () => {
  it("puts the mention at the end, after one space", () => {
    expect(withMentionAtEnd("", "Smith")).toEqual({ value: "@Smith ", at: 0 });
    expect(withMentionAtEnd("compare", "Smith")).toEqual({ value: "compare @Smith ", at: 8 });
    expect(withMentionAtEnd("compare ", "Smith")).toEqual({ value: "compare @Smith ", at: 8 });
  });
});

describe("an article handed to the box", () => {
  it("joins the row once, with its @ text at the end, and goes with the question", () => {
    paint("chat", "compare with");
    expect(hand("smith-2024", "Smith 2024, Replication")).toBeNull();
    expect(box().value).toBe("compare with @Smith 2024, Replication ");
    expect(chips()).toEqual(["Smith 2024, Replication"]);

    expect(hand("smith-2024", "Smith 2024, Replication")).toBeNull();
    expect(box().value).toBe("compare with @Smith 2024, Replication ");
    expect(chips()).toHaveLength(1);

    act(() => {
      box().form?.requestSubmit();
    });
    expect(sent[0]?.how?.mentions?.slugs).toEqual(["smith-2024"]);
  });

  it("is refused past the most one question can bring in", () => {
    paint();
    for (const s of ["a", "b", "c"]) expect(hand(s, s.toUpperCase())).toBeNull();
    expect(hand("d", "D")).toMatch(/3 articles/);
    expect(chips()).toHaveLength(3);
  });

  it("holds the cap when two arrive before the box is drawn again", () => {
    paint();
    hand("a", "A");
    hand("b", "B");
    let last: (string | null)[] = [];
    act(() => {
      last = [(into.current as BringIn)({ slug: "c", title: "C" }), (into.current as BringIn)({ slug: "d", title: "D" })];
    });
    expect(last[0]).toBeNull();
    expect(last[1]).toMatch(/3 articles/);
    expect(chips()).toEqual(["A", "B", "C"]);
    expect(box().value).toBe("@A @B @C ");
  });

  it("takes its words out again with the chip's ×", () => {
    paint("chat", "compare with");
    hand("smith-2024", "Smith 2024, Replication");
    act(() => {
      host.querySelector<HTMLButtonElement>(".mention-chip-x")?.click();
    });
    expect(box().value).toBe("compare with ");
    expect(chips()).toEqual([]);
  });

  it("is not offered by the guide's box", () => {
    paint("guide");
    expect(into.current).toBeNull();
  });
});

describe("an address in the draft", () => {
  it("gets a button in Chat and none in the guide", () => {
    paint("chat", "what about https://a.example/essay");
    expect(host.querySelector(".bring-in-pasted")?.textContent).toContain("Bring a.example/essay into this chat");
    act(() => root.unmount());
    root = createRoot(host);
    paint("guide", "what about https://a.example/essay");
    expect(host.querySelector(".bring-in-pasted")).toBeNull();
  });

  it("brings a page already on the shelf in at once, by its shelf title, asking for the reader's own copy", async () => {
    paint("chat", "what about https://a.example/essay");
    act(() => {
      host.querySelector<HTMLButtonElement>(".bring-in-pasted .bring-in-button")?.click();
    });
    await settle();
    expect(posted).toEqual([{ url: "https://a.example/essay", options: { ownCopy: true } }]);
    expect(chips()).toEqual(["Smith 2024, Replication"]);
    expect(box().value).toBe("what about https://a.example/essay @Smith 2024, Replication ");
  });

  it("forgets an answer that arrives after the reader changed", async () => {
    noteReader("reader-a");
    let answer: () => void = () => {};
    hold = new Promise((go) => {
      answer = go;
    });
    paint("chat", "see https://b.example/other");
    act(() => {
      host.querySelector<HTMLButtonElement>(".bring-in-pasted .bring-in-button")?.click();
    });
    act(() => noteReader("reader-b"));
    answer();
    await settle();
    expect(chips()).toEqual([]);
    /* Drawn afresh, the button offers again rather than showing reader A's outcome. */
    act(() => root.unmount());
    root = createRoot(host);
    paint("chat", "see https://b.example/other");
    expect(host.querySelector(".bring-in-pasted .bring-in-button")).not.toBeNull();
  });
});
