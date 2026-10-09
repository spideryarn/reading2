// @vitest-environment jsdom
/**
 * **What Chat's panel draws for the guide** — plan
 * docs/plans/261007j-the-guide-a-conversation-about-how-to-read-this.md,
 * stage 2:
 *
 * - **the pinned row**, above the list and outside its source filter, there
 *   under every `?chatfrom=` and with no conversation at all, and a press on
 *   it opens the guide (GPT Sol's F2);
 * - **the greeting**, ours and free, asking in the conversation since plan
 *   261009i (no box): why you are reading when no reason is stored, About you
 *   quoted back when it is there, three ways in while it is empty (plan
 *   261009u), nothing asked when the reason could not be read;
 * - **the guide's offer to save** (plan 261009q), a card under its answer
 *   that writes only on a press, never over words changed since the guide
 *   offered it, once per double press, with an Undo that puts back only over
 *   its own write. It replaced *Keep this as why you're reading*, whose
 *   invariants moved here.
 *
 * The real `ChatPanel`, handed props directly, as
 * tests/chat-list-sources.test.tsx does. What the band hands it is
 * tests/guide-in-chat-band.test.tsx.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatThread, SaveOffer, ThreadKind } from "../src/types.js";
import { forgetChatDrafts } from "../src/web/chat-draft.js";
import type { LiveApi } from "../src/web/live/useLiveConversation.js";
import type { ChatFrom } from "../src/web/params.js";

/** What `GET /api/reader?slug=` answers. */
let reader: { profile: string | null; purpose: string | null; purposeFailed: boolean } = {
  profile: null,
  purpose: null,
  purposeFailed: false,
};
const patches: unknown[] = [];
/** When set, the next PATCH writes and then answers 500, as a reply lost after the write. */
let patchLosesReply = false;
/** Something to run before the reader read answers: another tab saving. */
let beforeRead: (() => void) | null = null;
/** A deliberately slow opening read, for the race between the greeting and a first send. */
let delayedRead: Promise<Response> | null = null;

vi.mock("../src/web/lib/api.js", async () => {
  const real = await vi.importActual<typeof import("../src/web/lib/api.js")>("../src/web/lib/api.js");
  const json = (body: unknown) =>
    new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  return {
    ...real,
    apiFetch: (url: string, init?: RequestInit) => {
      if ((init?.method ?? "GET") === "PATCH") {
        const body = JSON.parse(String(init?.body ?? "{}")) as { purpose?: string | null; profile?: string | null };
        patches.push(body);
        if ("profile" in body) reader = { ...reader, profile: body.profile ?? null };
        else reader = { ...reader, purpose: body.purpose ?? null };
        if (patchLosesReply) return Promise.resolve(new Response("{}", { status: 500 }));
        return Promise.resolve(json("profile" in body ? { profile: body.profile ?? null } : { purpose: body.purpose }));
      }
      if (String(url).startsWith("/api/reader")) {
        beforeRead?.();
        if (delayedRead !== null) return delayedRead;
        return Promise.resolve(json(reader));
      }
      return Promise.resolve(json({}));
    },
  };
});

const { ChatPanel } = await import("../src/web/ChatPanel.js");
const { GUIDE_STARTS } = await import("../src/web/GuideGreeting.js");
const { OFFER_WORDS, UNDO_LABEL } = await import("../src/web/GuideSaveOffer.js");

const AT = "2026-10-07T09:00:00.000Z";

function thread(id: string, kind: ThreadKind, over: Partial<ChatThread> = {}): ChatThread {
  return {
    id,
    kind,
    title: `A question in ${id}`,
    createdAt: AT,
    updatedAt: AT,
    messages: [
      { id: `${id.slice(0, 9)}q`, role: "user", text: "said", createdAt: AT, status: "done" },
      { id: `${id.slice(0, 9)}a`, role: "assistant", text: "answered", createdAt: AT, status: "done" },
    ],
    ...over,
  };
}

const CHAT = thread("spya-chtaab", "chat");
const CLAIM = thread("spya-clmaab", "chat", {
  origin: { mode: "debate", blockId: "spya-bbbbbb", quote: "RNA can transfer a memory" },
});
const LEARN = thread("spya-remaab", "learn");
const EMPTY_GUIDE = thread("spya-gdeaab", "guide", { messages: [] });

let host: HTMLDivElement;
let root: Root;
const sent: string[] = [];
let guideOpened = 0;

function paint(
  listed: ChatThread[],
  over: { from?: ChatFrom | null; threadId?: string | null; guide?: ChatThread | null; live?: LiveApi } = {},
) {
  const guide = over.guide ?? null;
  act(() => {
    root.render(
      createElement(ChatPanel, {
        slug: "a-piece",
        articleTitle: "Attention Is All You Need",
        kind: "chat" as const,
        loaded: true,
        loadFailed: false,
        listed,
        threads: [...listed.filter((t) => t.kind === "chat"), ...(guide ? [guide] : [])],
        guide: {
          thread: guide,
          onOpen: () => {
            guideOpened += 1;
          },
        },
        threadId: over.threadId ?? null,
        from: over.from ?? null,
        onFrom: () => {},
        onOpenLearn: () => {},
        onThread: () => {},
        onSend: (q: string) => {
          sent.push(q);
        },
        onNew: () => {},
        onSendNew: () => {},
        onDiscard: () => {},
        onRename: () => {},
        onDelete: () => {},
        canStartOver: false,
        onRetry: () => {},
        onEdit: () => {},
        onDeleteFrom: undefined,
        onStop: () => {},
        onJump: () => {},
        recovering: new Set<string>(),
        blocks: new Map<string, string>(),
        live: over.live,
        focusNonce: 0,
        error: null,
      }),
    );
  });
}

async function settle(): Promise<void> {
  for (let i = 0; i < 4; i++) {
    await act(async () => {
      await new Promise((go) => setTimeout(go, 0));
    });
  }
}

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  reader = { profile: null, purpose: null, purposeFailed: false };
  patches.length = 0;
  patchLosesReply = false;
  beforeRead = null;
  delayedRead = null;
  sent.length = 0;
  guideOpened = 0;
  forgetChatDrafts();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const guideRow = (): HTMLElement | null => host.querySelector<HTMLElement>(".chat-guide");

describe("the guide's pinned row", () => {
  it.each([null, "chats", "sources", "learn"] as const)("is above the list whatever the filter says (%s)", (from) => {
    paint([CHAT, CLAIM, LEARN], { from });
    const row = guideRow();
    expect(row).not.toBeNull();
    expect(row?.textContent).toContain("Guide");
    /* First in the list, ahead of the filter and every row. */
    const list = host.querySelector(".chat-threads");
    expect(row && list && row.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("is there with no conversation at all, and before the guide exists", () => {
    paint([]);
    expect(guideRow()?.textContent).toContain("How to read this piece");
  });

  it("does not say nothing was asked when the guide holds a conversation (browser pass)", () => {
    paint([], { guide: thread("spya-gdeabb", "guide") });
    expect(host.textContent).not.toContain("Nothing asked yet.");
    act(() => root.render(createElement("div")));
    paint([]);
    expect(host.textContent).toContain("Nothing asked yet.");
  });

  it("opens the guide when pressed", () => {
    paint([CHAT]);
    act(() => guideRow()?.querySelector<HTMLButtonElement>("button")?.click());
    expect(guideOpened).toBe(1);
  });
});

describe("the guide's greeting", () => {
  const greeting = async () => {
    paint([CHAT], { guide: EMPTY_GUIDE, threadId: EMPTY_GUIDE.id });
    await settle();
  };
  const button = (label: string) =>
    [...host.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === label);
  const startButton = () => button(GUIDE_STARTS[0]);
  const startLabels = () => GUIDE_STARTS.filter((label) => button(label) !== undefined);
  /* What the greeting no longer draws under the first answer (plan 261009q). */
  const keepButton = () => button("Keep this as why you're reading");
  /** The reader answers: the same mount, now with their first message in it. */
  const answer = async (text: string) => {
    const said = thread(EMPTY_GUIDE.id, "guide", {
      messages: [{ id: "spya-gdeq01", role: "user", text, createdAt: AT, status: "done" }],
    });
    paint([CHAT], { guide: said, threadId: said.id });
    await settle();
  };

  it("welcomes them to the piece by name, asks why, and draws no box; the panel is headed Guide", async () => {
    await greeting();
    expect(host.textContent).toContain("Hi, I'm your guide to Attention Is All You Need.");
    expect(host.textContent).toContain("Why are you reading it?");
    expect(host.querySelector("textarea#guide-purpose")).toBeNull();
    /* The three ways in, whatever is stored (plan 261009u). */
    expect(startLabels()).toEqual([...GUIDE_STARTS]);
    expect(host.querySelector("h2")?.textContent).toBe("Guide");
  });

  it("quotes About you back and asks if it is still right, when there is one", async () => {
    reader = { ...reader, profile: "A cognitive neuroscientist   who studies memory" };
    await greeting();
    expect(host.textContent).toContain("In About you, you wrote “A cognitive neuroscientist who studies memory”. Is that still right?");
    expect(host.textContent).toContain("why are you reading this one?");
  });

  it("offers the three starts, and asks nothing, when a reason is stored; a press sends its words", async () => {
    reader = { ...reader, purpose: "I review for a journal" };
    await greeting();
    expect(host.textContent).toContain("You said you're reading it because “I review for a journal”.");
    expect(host.textContent).not.toContain("Why are you reading it?");
    const start = startButton();
    expect(start).toBeDefined();
    act(() => start?.click());
    expect(sent).toEqual([GUIDE_STARTS[0]]);
  });

  it("points at the profile only when a reason is stored and About you is empty", async () => {
    reader = { ...reader, purpose: "For a journal club" };
    await greeting();
    expect(host.querySelector('a[href="/profile"]')).not.toBeNull();
    act(() => root.unmount());
    root = createRoot(host);
    reader = { ...reader, profile: "A historian of science" };
    await greeting();
    expect(host.querySelector('a[href="/profile"]')).toBeNull();
  });

  it("asks nothing and offers nothing when the reason could not be read", async () => {
    reader = { ...reader, purposeFailed: true };
    await greeting();
    expect(host.textContent).not.toContain("Why are you reading");
    await answer("For my journal club");
    expect(keepButton()).toBeUndefined();
  });

  it("stays above the reader's answer, saves nothing, and offers no keep button under it", async () => {
    await greeting();
    await answer("For my journal club\r\n next week  ");
    expect(host.textContent).toContain("Why are you reading it?");
    expect(keepButton()).toBeUndefined();
    /* The starts go with the first message; the greeting stays. */
    expect(startLabels()).toEqual([]);
    expect(patches).toEqual([]);
  });

  it("does not turn a message sent before the purpose read into an answer to a greeting shown later", async () => {
    let answerRead: ((response: Response) => void) | undefined;
    delayedRead = new Promise<Response>((resolve) => {
      answerRead = resolve;
    });
    paint([CHAT], { guide: EMPTY_GUIDE, threadId: EMPTY_GUIDE.id });
    await answer("Where should I start?");
    expect(host.textContent).not.toContain("Why are you reading it?");

    delayedRead = null;
    await act(async () =>
      answerRead?.(
        new Response(JSON.stringify(reader), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    await settle();
    expect(host.textContent).not.toContain("Why are you reading it?");
    expect(keepButton()).toBeUndefined();
  });

  it("does not put a late greeting above the first spoken words", async () => {
    let answerRead: ((response: Response) => void) | undefined;
    delayedRead = new Promise<Response>((resolve) => {
      answerRead = resolve;
    });
    const live = {
      lines: [
        {
          id: "spoken-1",
          role: "reader",
          text: "Where should I start?",
          done: false,
          exchange: "spoken-1",
          session: 0,
          order: 0,
        },
      ],
    } as unknown as LiveApi;
    paint([CHAT], { guide: EMPTY_GUIDE, threadId: EMPTY_GUIDE.id, live });
    await settle();

    delayedRead = null;
    await act(async () =>
      answerRead?.(
        new Response(JSON.stringify(reader), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    await settle();
    expect(host.textContent).not.toContain("Why are you reading it?");
  });

  it("draws no greeting and no keep button on a guide that already had turns", async () => {
    paint([CHAT], { guide: thread("spya-gdeacc", "guide"), threadId: "spya-gdeacc" });
    await settle();
    expect(host.textContent).not.toContain("I'm your guide");
    expect(keepButton()).toBeUndefined();
  });
});

describe("the guide's offer to save", () => {
  type Offer = { field: "purpose" | "profile"; text: string; basis?: string | null };
  /** A guide whose one answer ran `offer_to_save` once per offer given. */
  const guideWith = (offers: Offer[], over: { status?: "done" | "pending"; name?: string } = {}) =>
    thread("spya-gdeoff", "guide", {
      messages: [
        { id: "spya-gdeq02", role: "user", text: "For my journal club. I'm a historian.", createdAt: AT, status: "done" },
        {
          id: "spya-gdea02",
          role: "assistant",
          text: "Start with the abstract.",
          createdAt: AT,
          status: over.status ?? "done",
          tools: offers.map((offer) => ({
            name: over.name ?? "offer_to_save",
            label: "offered to save why you're reading",
            status: "done" as const,
            /* Some cases below deliberately forge an invalid stored shape;
               this is the JSON boundary the component is meant to reject. */
            offer: offer as SaveOffer,
          })),
        },
      ],
    });
  const draw = async (guide: ChatThread) => {
    paint([CHAT], { guide, threadId: guide.id });
    await settle();
  };
  const button = (label: string) =>
    [...host.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === label);
  const press = async (label: string) => {
    await act(async () => button(label)?.click());
    await settle();
  };
  const SAVE = OFFER_WORDS.purpose.save;
  const REASON: Offer = { field: "purpose", text: "For my journal club.", basis: null };

  it("shows the words under the answer and saves nothing until the press", async () => {
    await draw(guideWith([REASON]));
    expect(host.querySelector(".guide-offer-text")?.textContent).toBe("For my journal club.");
    expect(host.querySelector(".guide-offer-text")?.classList.contains("voice-ai")).toBe(true);
    expect(patches).toEqual([]);
    await press(SAVE);
    expect(patches).toEqual([{ purpose: "For my journal club." }]);
    expect(host.textContent).toContain(OFFER_WORDS.purpose.saved);
    expect(sent, "saving sends nothing to the guide").toEqual([]);
  });

  it("Undo puts back what the press replaced, and only over its own write", async () => {
    reader = { ...reader, purpose: "Older reason" };
    await draw(guideWith([{ ...REASON, basis: "Older reason" }]));
    await press(SAVE);
    expect(reader.purpose).toBe("For my journal club.");
    await press(UNDO_LABEL);
    expect(patches.at(-1)).toEqual({ purpose: "Older reason" });
    expect(host.textContent).toContain("Undone");

    /* Saved again, then changed elsewhere: Undo leaves the newer words. */
    await press(SAVE);
    reader = { ...reader, purpose: "Written on Metadata since" };
    const before = patches.length;
    await press(UNDO_LABEL);
    expect(patches).toHaveLength(before);
    expect(host.textContent).toContain("It has changed since");
  });

  it("does not save over words that changed since the guide offered it", async () => {
    reader = { ...reader, purpose: "Saved from a later offer" };
    await draw(guideWith([REASON]));
    await press(SAVE);
    expect(patches).toEqual([]);
    expect(host.textContent).toContain("It has changed since I offered this");
  });

  it("writes nothing when what is saved now cannot be read", async () => {
    reader = { ...reader, purposeFailed: true };
    await draw(guideWith([REASON]));
    await press(SAVE);
    expect(patches).toEqual([]);
    expect(host.textContent).toContain("Couldn't check what is saved now");
  });

  it("says it is already saved rather than writing it again", async () => {
    reader = { ...reader, purpose: "For my journal club." };
    await draw(guideWith([REASON]));
    await press(SAVE);
    expect(patches).toEqual([]);
    expect(host.textContent).toContain("Already saved");
  });

  it("writes once for a double press", async () => {
    await draw(guideWith([REASON]));
    await act(async () => {
      button(SAVE)?.click();
      button(SAVE)?.click();
    });
    await settle();
    expect(patches).toHaveLength(1);
  });

  it("calls a save whose reply was lost saved, when the server has it", async () => {
    await draw(guideWith([REASON]));
    patchLosesReply = true;
    await press(SAVE);
    expect(patches).toHaveLength(1);
    expect(host.textContent).toContain(OFFER_WORDS.purpose.saved);
  });

  it("saves About you through the reader route, and an unreadable shelf does not hide it", async () => {
    reader = { ...reader, profile: "A historian", purposeFailed: true };
    await draw(guideWith([{ field: "profile", text: "A historian of science.", basis: "A historian" }]));
    expect(host.textContent).toContain("Saving this replaces what About you says now.");
    await press(OFFER_WORDS.profile.save);
    expect(patches).toEqual([{ profile: "A historian of science." }]);
    await press(UNDO_LABEL);
    expect(patches.at(-1)).toEqual({ profile: "A historian" });
  });

  it("draws one card per field, the last offer's", async () => {
    await draw(guideWith([REASON, { ...REASON, text: "For journal club next week." }]));
    expect([...host.querySelectorAll(".guide-offer-text")].map((p) => p.textContent)).toEqual([
      "For journal club next week.",
    ]);
  });

  it.each([
    ["an answer still arriving", guideWith([REASON], { status: "pending" })],
    ["a run of another tool", guideWith([REASON], { name: "article_glossary" })],
    ["an offer with no safe basis", guideWith([{ field: "purpose", text: "x" }])],
    ["words over the cap", guideWith([{ field: "purpose", text: "x".repeat(601) }])],
    ["an unknown field", guideWith([{ field: "password" as "purpose", text: "x" }])],
  ])("draws no card for %s", async (_what, guide) => {
    await draw(guide);
    expect(host.querySelector(".guide-offer")).toBeNull();
  });

  it("draws no card in a chat, whatever its runs say", async () => {
    const chat = { ...guideWith([REASON]), id: "spya-chtoff", kind: "chat" as const };
    paint([chat], { threadId: chat.id });
    await settle();
    expect(host.querySelector(".guide-offer")).toBeNull();
  });
});

/* Plan 261009u: the guide's next steps, as ChatPanel places them. What each
   kind does is tests/guide-next-steps-row.test.tsx. */
describe("the guide's next steps in the panel", () => {
  const steps = (words: string) => [
    { name: "offer_next_steps", label: "offered next steps", status: "done" as const, steps: [{ kind: "ask" as const, words }] },
  ];
  const twoAnswers = (last: "done" | "pending") =>
    thread("spya-gdenxt", "guide", {
      messages: [
        { id: "spya-gdeq11", role: "user", text: "For my journal club.", createdAt: AT, status: "done" },
        { id: "spya-gdea11", role: "assistant", text: "Start with the abstract.", createdAt: AT, status: "done", tools: steps("Older step") },
        { id: "spya-gdeq12", role: "user", text: "And then?", createdAt: AT, status: "done" },
        { id: "spya-gdea12", role: "assistant", text: "Then the method.", createdAt: AT, status: last, tools: last === "done" ? steps("Newer step") : [] },
      ],
    });
  const labels = () => [...host.querySelectorAll('[aria-label="Next steps"] button')].map((b) => b.textContent);

  it("draws the latest answer's steps only, with no tool line for them, and a press sends the words", async () => {
    paint([CHAT], { guide: twoAnswers("done"), threadId: "spya-gdenxt" });
    await settle();
    expect(labels()).toEqual(["Newer step"]);
    expect(host.textContent).not.toContain("offered next steps");
    act(() => host.querySelector<HTMLButtonElement>('[aria-label="Next steps"] button')?.click());
    expect(sent).toEqual(["Newer step"]);
  });

  it("draws no steps while an answer is arriving, not even the last one's", async () => {
    paint([CHAT], { guide: twoAnswers("pending"), threadId: "spya-gdenxt" });
    await settle();
    expect(labels()).toEqual([]);
  });
});
