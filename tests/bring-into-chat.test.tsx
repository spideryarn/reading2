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
import type { Job } from "../src/types.js";
import type { SendHow } from "../src/web/ChatPanel.js";
import type { BringIn } from "../src/web/BringIntoChat.js";

const posted: unknown[] = [];
/* Each POST waits on this when set, so a test can act before it answers. */
let hold: Promise<void> | null = null;
let showMentionCandidate = true;
let jobRows: Job[] = [];
let addAnswer: Job | { article: string; repeat: true } = { article: "smith-2024", repeat: true };

vi.mock("../src/web/lib/api.js", async () => {
  const real = await vi.importActual<typeof import("../src/web/lib/api.js")>("../src/web/lib/api.js");
  return {
    ...real,
    apiFetch: async (url: string) =>
      new Response(
        JSON.stringify({
          articles: String(url).includes("archived=1") || !showMentionCandidate
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
      jobs: jobRows,
      add: async (url: string, options?: unknown) => {
        posted.push({ url, options });
        if (hold) await hold;
        return addAnswer;
      },
      lastFailure: () => null,
    }),
  };
});

const { Composer, bringVia } = await import("../src/web/ChatPanel.js");
const { BringIntoChat } = await import("../src/web/BringIntoChat.js");
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
    out = (into.current as BringIn).add({ slug, title });
  });
  return out;
}

beforeEach(() => {
  sent = [];
  posted.length = 0;
  hold = null;
  showMentionCandidate = true;
  jobRows = [];
  addAnswer = { article: "smith-2024", repeat: true };
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
      last = [
        (into.current as BringIn).add({ slug: "c", title: "C" }),
        (into.current as BringIn).add({ slug: "d", title: "D" }),
      ];
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

  it("uses the row after a removal when another import lands in the same batch", () => {
    paint();
    for (const s of ["a", "b", "c"]) hand(s, s.toUpperCase());
    let refusal: string | null = "not called";
    act(() => {
      host.querySelector<HTMLButtonElement>(".mention-chip-x")?.click();
      refusal = (into.current as BringIn).add({ slug: "d", title: "D" });
    });
    expect(refusal).toBeNull();
    expect(chips()).toEqual(["B", "C", "D"]);
    expect(box().value).toBe("@B @C @D ");
  });

  it("is not offered by the guide's box", () => {
    paint("guide");
    expect(into.current).toBeNull();
  });

  it("retires the registered hand-over if a mounted box stops being Chat", () => {
    paint("chat");
    expect(into.current).not.toBeNull();
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

  it("does not start an import when the box already holds three articles", () => {
    paint("chat", "see https://full.example/page");
    for (const s of ["a", "b", "c"]) hand(s, s.toUpperCase());
    act(() => {
      host.querySelector<HTMLButtonElement>(".bring-in-pasted .bring-in-button")?.click();
    });
    expect(posted).toEqual([]);
    expect(host.querySelector(".bring-in-pasted")?.textContent).toMatch(/3 articles/);
  });

  it("posts once when two buttons for one address are pressed before either redraws", async () => {
    const brought: string[] = [];
    act(() => {
      root.render(
        createElement("div", null,
          createElement(BringIntoChat, {
            url: "https://c.example/same",
            openSlug: "open-one",
            bringIn: {
              add: ({ slug }) => {
                brought.push(slug);
                return null;
              },
              refusal: () => null,
            },
          }),
          createElement(BringIntoChat, {
            url: "https://C.example/same",
            openSlug: "open-one",
            bringIn: {
              add: ({ slug }) => {
                brought.push(slug);
                return null;
              },
              refusal: () => null,
            },
          }),
        ),
      );
    });
    const buttons = [...host.querySelectorAll<HTMLButtonElement>(".bring-in-button")];
    act(() => {
      buttons[0]?.click();
      buttons[1]?.click();
    });
    expect(posted).toEqual([{ url: "https://c.example/same", options: { ownCopy: true } }]);
    await settle();
    expect(brought).toEqual(["smith-2024", "smith-2024"]);
  });

  it("does not put an unread shelf article in the box", async () => {
    showMentionCandidate = false;
    paint("chat", "see https://d.example/abstract");
    act(() => {
      host.querySelector<HTMLButtonElement>(".bring-in-pasted .bring-in-button")?.click();
    });
    await settle();
    expect(chips()).toEqual([]);
    expect(host.querySelector(".bring-in-pasted")?.textContent).toMatch(/not ready/i);
  });

  it("keeps a completed import ready after its job leaves the engine snapshot", async () => {
    const queued = {
      id: "job-snapshot",
      ownerId: "owner" as Job["ownerId"],
      slug: "snapshot-page",
      url: "https://snapshot.example/page",
      steps: [],
      status: "queued",
      createdAt: "2026-10-17T10:00:00.000Z",
    } as Job;
    addAnswer = queued;
    const bringIn: BringIn = { add: () => null, refusal: () => null };
    const draw = () => {
      act(() => {
        root.render(createElement(BringIntoChat, {
          url: queued.url as string,
          openSlug: "open-one",
          bringIn,
        }));
      });
    };
    draw();
    act(() => host.querySelector<HTMLButtonElement>(".bring-in-button")?.click());
    await settle();
    jobRows = [{ ...queued, status: "done", title: "Snapshot page" }];
    draw();
    await settle();
    jobRows = [];
    draw();
    expect(host.querySelector(".bring-in-button")).not.toBeNull();
    expect(host.textContent).not.toContain("Adding it to your shelf");
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

describe("the hand-over from an answer's buttons to the box", () => {
  it("passes the box's yes through, and refuses only when there is no box", () => {
    const seam = { current: null } as MutableRefObject<BringIn | null>;
    const via = bringVia(seam);
    expect(via.refusal()).toMatch(/box/);
    expect(via.add({ slug: "s", title: "S" })).toMatch(/box/);
    seam.current = { add: () => null, refusal: () => null };
    expect(via.refusal()).toBeNull();
    expect(via.add({ slug: "s", title: "S" })).toBeNull();
    seam.current = { add: () => "full", refusal: () => "full" };
    expect(via.refusal()).toBe("full");
  });

  it("sends on the first Enter after an article is brought in", async () => {
    paint("chat", "compare with");
    await act(async () => {
      box().focus();
      box().setSelectionRange(box().value.length, box().value.length);
      box().dispatchEvent(new Event("select", { bubbles: true }));
    });
    hand("smith-2024", "Smith 2024, Replication");
    /* The reader comes back to the box after pressing, caret at the end, and
       presses Enter before the shelf list (asked for by an `@` the box sees)
       has arrived. */
    act(() => {
      box().blur();
      box().setSelectionRange(box().value.length, box().value.length);
      box().focus();
    });
    act(() => {
      box().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    });
    expect(sent.map((s) => s.question)).toEqual(["compare with @Smith 2024, Replication"]);
  });
});
