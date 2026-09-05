// @vitest-environment jsdom
/**
 * **One press of "?" buys exactly one answer.**
 *
 * The button in the gutter spends a model call with no composer and no
 * confirmation — Greg's explicit call, 2026-09-04: *"Accept it — one click is
 * the point."* That decision is what makes this file necessary rather than
 * fussy. Every other paid control in the app has a step between the press and
 * the money; this one does not, so "exactly once" is the only thing standing
 * between a double-tap and a double charge, and **a duplicate is invisible**:
 * two conversations about the same paragraph look, from the reading view, like
 * one conversation and one stray mark.
 *
 * ## There are two of "once" and they are different bugs
 *
 * 1. **One press, rendered twice.** React StrictMode mounts every component,
 *    tears it down and mounts it again — so an un-latched `useEffect` that
 *    sends spends twice on every press for anyone running the dev server, and
 *    once in production, which is the worst possible way round because nobody
 *    developing it would ever see the bill. `ChatDialog` holds the latch.
 * 2. **Two presses, rendered once.** A double-tap on an iPad fires the handler
 *    twice, and the fear was that both would read the same `chats` array,
 *    conclude there is no conversation yet, and both mint one. App carried a
 *    ref against it until 2026-09-05, when the App-level test in
 *    `tests/public-network-trace.test.tsx` showed the count stays at one with
 *    that ref deleted — because `helpAboutBlock` only sets a draft and the send
 *    is an effect in a component that mounts once. The guard came out; the
 *    behaviour is asserted where the requests are counted.
 *
 * So this file holds the first, through the real `ChatDialog`, plus the two
 * states either side of a conversation existing — a first answer being walked
 * away from, and an id that names nothing.
 *
 * docs/plans/260904b-gutter-help-button-and-detached-streaming-chat.md § stage 3.
 */
import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ChatAnchor, ChatThread, ThreadSummary } from "../src/types.js";

/* The dialog's other hooks reach for things jsdom has not got, and none of them
   is what is under test. */
vi.mock("../src/web/useProfile.js", () => ({ useHasProfile: () => false }));
vi.mock("../src/web/Tooltip.js", () => ({
  Tooltip: ({ children }: { children: unknown }) => children,
  TooltipGroup: ({ children }: { children: unknown }) => children,
}));

/** Every `send` the dialog made, in order, with the text it sent. */
let sends: { text: string; anchor: ChatAnchor | undefined }[] = [];
/** Every other operation it invoked, in order, by name. */
let calls: string[] = [];
/** What `useChat` reports as stored. Set per test; empty for a fresh draft. */
let threads: ChatThread[] = [];
/** Did the first GET fail? `loaded` is true either way — that is the point. */
let loadFailed = false;

/* **One mock, driven by the two mutable cells above, rather than a
   `vi.resetModules()` per case.** Re-importing the component under a fresh
   module registry gives it a *second copy of React*, which loses
   `IS_REACT_ACT_ENVIRONMENT` and turns every `act()` into a warning and every
   assertion into a failure that has nothing to do with the code. */
vi.mock("../src/web/useChat.js", () => ({
  useChat: () => ({
    get threads() {
      return threads;
    },
    loaded: true,
    get loadFailed() {
      return loadFailed;
    },
    /* A Set of message ids, not a boolean — `Conversation` calls `.has` on it. */
    recovering: new Set<string>(),
    send: (
      _threadId: string | null,
      text: string,
      _at: string | null,
      _first: boolean,
      _onReal: (id: string) => void,
      anchor?: ChatAnchor,
    ) => {
      sends.push({ text, anchor });
      return "spya-newthr";
    },
    speak: () => "",
    cancelAndDiscard: () => calls.push("cancelAndDiscard"),
    retry: () => {},
    edit: () => {},
    stop: () => calls.push("stop"),
    begin: () => {},
    discard: () => {},
    rename: () => {},
    remove: () => calls.push("remove"),
    error: null,
  }),
}));

const { ChatDialog } = await import("../src/web/ChatDialog.js");
const { HELP_QUESTION } = await import("../src/web/chat-handoff.js");
const { helpThreadFor } = await import("../src/web/useChatAnchors.js");

const BLOCK = "spya-k3m9qt";
const OPENING = "Hierarchical Bayesian models of cognition are often introduced as if";

let host: HTMLDivElement;
let root: Root;

const dialog = (props: Record<string, unknown>) =>
  createElement(ChatDialog, {
    slug: "an-article",
    at: null,
    blocks: new Map([[BLOCK, OPENING]]),
    onJump: () => {},
    onClose: () => {},
    onThread: () => {},
    onOpenFull: () => {},
    onCreated: () => {},
    onDropped: () => {},
    ...props,
    // biome-ignore lint/suspicious/noExplicitAny: the props are built per case
  } as any);

beforeEach(() => {
  sends = [];
  calls = [];
  threads = [];
  loadFailed = false;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("the '?' sends once, and says what the reader was looking at", () => {
  it("sends nothing at all for an ordinary draft", () => {
    /* The control case, and the one that would catch an auto-send wired to the
       wrong field: the chat button opens this same dialog with the same anchor
       and the same opening words. The *only* difference is `help`, and if that
       stopped being the trigger, every press of the chat button would start
       spending silently. */
    act(() => {
      root.render(dialog({ target: { kind: "draft", anchor: { blockId: BLOCK }, opening: OPENING } }));
    });
    expect(sends).toEqual([]);
  });

  it("sends once for a help press", () => {
    act(() => {
      root.render(
        dialog({ target: { kind: "draft", anchor: { blockId: BLOCK }, opening: OPENING, help: true } }),
      );
    });
    expect(sends).toHaveLength(1);
  });

  it("still sends once under StrictMode, which mounts everything twice", () => {
    /* **The bug this catches costs real money and only in production.**
       StrictMode's double mount is development-only, so an implementation that
       sends on mount with no latch spends twice here and once for a reader —
       meaning the developer sees the duplicate and the reader does not, or the
       reverse if the latch is wrong in the other direction. Either way the
       cheap check is to mount it the way React will. */
    act(() => {
      root.render(
        createElement(
          StrictMode,
          null,
          dialog({ target: { kind: "draft", anchor: { blockId: BLOCK }, opening: OPENING, help: true } }),
        ),
      );
    });
    expect(sends).toHaveLength(1);
  });

  it("does not send again when the target is re-created with the same block", () => {
    /* `target` is an object literal built in App's render, so it is a new
       identity on every unrelated state change — a scroll position, a mode, a
       finished job. An effect keyed on it alone fires every time. */
    const target = () => ({ kind: "draft", anchor: { blockId: BLOCK }, opening: OPENING, help: true });
    act(() => root.render(dialog({ target: target() })));
    act(() => root.render(dialog({ target: target() })));
    act(() => root.render(dialog({ target: target() })));
    expect(sends).toHaveLength(1);
  });

  it("sends again for a different paragraph, because that is a different question", () => {
    /* The latch holds the block it sent for rather than a boolean. A boolean
       would make the second paragraph's press silently do nothing, which is the
       failure that looks exactly like a button that is not wired up. */
    act(() => root.render(dialog({ target: { kind: "draft", anchor: { blockId: BLOCK }, opening: OPENING, help: true } })));
    act(() =>
      root.render(
        dialog({ target: { kind: "draft", anchor: { blockId: "spya-other1" }, opening: "Another one", help: true } }),
      ),
    );
    expect(sends).toHaveLength(2);
  });

  it("puts the paragraph's opening words in the message, not a bare id", () => {
    /* **Trap 2 of the plan.** `askAboutBlock` quotes only what it is handed,
       and a `{ blockId }` anchor hands it nothing — so the obvious wiring sends
       `About block k3m9qt:` and the reader's own transcript says nothing about
       which paragraph they pressed. Greg ruled that out when this message was
       designed: *"a six-character code in a text box is not something you can
       check you clicked correctly"* (chat-handoff.ts). */
    act(() =>
      root.render(dialog({ target: { kind: "draft", anchor: { blockId: BLOCK }, opening: OPENING, help: true } })),
    );
    const sent = sends[0]?.text ?? "";
    expect(sent).toContain("k3m9qt");
    expect(sent).not.toContain("spya-");
    expect(sent).toContain("Hierarchical Bayesian models");
    expect(sent).toContain(HELP_QUESTION);
  });

  it("asks for the gap rather than for a radius", () => {
    /* The sentence is the reader's own words in their transcript, and its whole
       job is to *not* name a window — Greg, 2026-09-04: "often the confusion is
       wider in scope than just that block, so the LLM is going to have to use
       its judgment on that." An earlier draft said "explain this and
       surrounding blocks", which is exactly the instruction we know is usually
       wrong. */
    expect(HELP_QUESTION).toContain("somewhere earlier");
    expect(HELP_QUESTION.toLowerCase()).not.toContain("surrounding");
    /* First person, because it is attributed to the reader in the transcript. */
    expect(HELP_QUESTION).toMatch(/^I /);
  });

  it("keeps the anchor structural, so the prose draws no phantom mark", () => {
    /* A `{ blockId }` anchor and nothing else. Adding `quote`/`start` to make
       the opening words travel would have been the shorter fix and would draw a
       highlight over the first 60 characters of the paragraph — a mark the
       reader never made, on words they did not choose. The words go in the
       message; the anchor stays whole-block. */
    act(() =>
      root.render(dialog({ target: { kind: "draft", anchor: { blockId: BLOCK }, opening: OPENING, help: true } })),
    );
    expect(sends[0]?.anchor).toEqual({ blockId: BLOCK });
  });
});

/**
 * **Walking away must not destroy the answer you just bought.**
 *
 * The "?" exists so a reader can ask and keep scrolling. The gesture for going
 * back to reading is the ✕ in the corner — and on an iPad, which is the device
 * Greg was holding when he asked for this, there is no Esc to do it safely
 * instead. Until 2026-09-05 that ✕ meant `cancelAndDiscard` while a first
 * answer was arriving: it aborted the answer on the server and deleted the
 * thread. The control worked perfectly and did the opposite of the feature,
 * which is what docs/reusable/silent-success.md is about.
 *
 * Nothing here can see whether the answer keeps arriving — that is the server's
 * (`tests/chat-unmounted-turn.test.ts` pins it). What it can see is that the
 * corner button no longer calls the destructive path, and that the destructive
 * path is still *reachable*, because GPT Sol's condition was that two controls
 * change rather than one: an ✕ that merely closed would have left a first
 * answer with no way to stop at all.
 */
describe("the way out of a first answer", () => {
  const streamingThread = {
    kind: "chat",
    id: "spya-newthr",
    title: "About block k3m9qt",
    createdAt: "2026-09-05T00:00:00.000Z",
    updatedAt: "2026-09-05T00:00:00.000Z",
    anchor: { blockId: BLOCK },
    messages: [
      { id: "spya-msgu01", role: "user", text: "…", createdAt: "2026-09-05T00:00:00.000Z", status: "done" },
      { id: "spya-msga01", role: "assistant", text: "half an ans", createdAt: "2026-09-05T00:00:00.000Z", status: "pending" },
    ],
  };

  /** Mount the dialog on that thread, mid-first-answer. */
  const openOnFirstAnswer = () => {
    // biome-ignore lint/suspicious/noExplicitAny: a thread shaped for this test
    threads = [streamingThread as any];
    act(() => {
      root.render(
        dialog({
          target: { kind: "thread", threadId: "spya-newthr" },
          onClose: () => calls.push("close"),
          onDropped: () => calls.push("dropped"),
        }),
      );
    });
  };

  it("the corner ✕ closes and destroys nothing", () => {
    openOnFirstAnswer();
    const x = host.querySelector("header button") as HTMLButtonElement;
    expect(x, "the header must have a button").toBeTruthy();
    expect(x.getAttribute("aria-label")).toBe("Close");
    act(() => x.click());
    expect(calls).toEqual(["close"]);
    /* Named, because this is the assertion the whole describe exists for. */
    expect(calls).not.toContain("cancelAndDiscard");
    expect(calls).not.toContain("dropped");
  });

  it("but throwing it away is still one press, in the footer", () => {
    /* Sol's condition. An ✕ that merely closed, with nothing else changed,
       would leave a first answer with no way to stop — the footer's Stop is
       deliberately hidden in this state, because an answer that has barely
       started is not one you want half of. */
    openOnFirstAnswer();
    const cancel = [...host.querySelectorAll("footer button")].find((b) => b.textContent?.trim() === "Cancel");
    expect(cancel, "a first answer must still be discardable").toBeTruthy();
    act(() => (cancel as HTMLButtonElement).click());
    expect(calls).toEqual(["cancelAndDiscard", "dropped", "close"]);
  });
});

/**
 * **A conversation that is not there must say so, and stop being consulted.**
 *
 * `starting` used to be `loaded && !thread` — which reads as "we have the list
 * and this is not in it", a description of a *missing* thread rather than a new
 * one. So it swallowed its own opposite: the "That conversation no longer
 * exists" branch was unreachable, and any `?thread=` naming something gone
 * showed a spinner saying *Starting…* for ever, with no Stop, no Delete and no
 * retry under it.
 *
 * Nobody met it while every conversation began with the reader typing one,
 * because then the id had just been minted by this very panel. **The "?" broke
 * that**: it reopens from a *summary*, and a summary can be stale — deleted in
 * another tab, or optimistic and its POST never landed. Worse, the stale summary
 * kept routing that paragraph's next press back to the same missing id, so the
 * button was permanently dead on it. GPT Sol's stage 3 review, finding 2.
 */
describe("a thread that is not there", () => {
  const openOn = (threadId: string) =>
    act(() => {
      root.render(
        dialog({
          target: { kind: "thread", threadId },
          onClose: () => calls.push("close"),
          onDropped: (id: string) => calls.push(`dropped:${id}`),
        }),
      );
    });

  it("destroys nothing on sight, however the id got here", () => {
    /* **The correction that shaped the rule above.** The first fix said "we did
       not mint it, so it must be gone" and dropped immediately — and a panel is
       not the operation's lifetime. Press "?", close before the `begin` frame,
       reopen from the optimistic summary, and the new panel's ref is empty
       while the original POST is still in the air, because the send
       deliberately outlives the unmount. Live conversations declared dead and
       their shortcuts thrown away, for ordinary and comment-started chats as
       well as the "?". GPT Sol, second pass.

       So the panel waits first, always, whoever minted the id — the elapsed
       time is the evidence, not the provenance. */
    openOn("spya-ghost1");
    expect(calls).not.toContain("dropped:spya-ghost1");
    expect(host.textContent).toContain("Starting…");
  });

  it("says the load failed, rather than that the conversation is gone", () => {
    /* `loaded` means the request finished, not that it worked. Conflating the
       two is how an outage gets reported to the reader as a deletion — and, in
       the first version of this fix, how it would have *performed* one. */
    loadFailed = true;
    openOn("spya-ghost1");
    expect(host.textContent).toContain("Could not load");
    expect(host.textContent).not.toContain("no longer exists");
    expect(calls).not.toContain("dropped:spya-ghost1");
  });

  it("waits out the creation window, then offers a way forward", () => {
    /* **The route stage 3 created, end to end.** Press "?", close before the
       `begin` frame, have the POST fail, press again: the optimistic summary
       outlives the panel while the new panel's `useChat` — a fresh controller,
       one per mount — finds no server thread. Without this the reader lands on
       an endless "Starting…", and because `helpThreadFor` keeps returning that
       summary, **every later press lands there too**: the "?" is dead on that
       paragraph for the life of the article. The old chat button never had this
       route, because it always opens a fresh draft.

       **And what it says at the end is weaker than "this is gone", on purpose.**
       Three things stop this panel being entitled to that: `useChat` makes one
       GET and never refreshes, so the snapshot is old however long we wait; a
       failed request can come back as a cached synthetic 200; and the client's
       timeout does not bound the server, which persists the thread before it
       installs the listener that would notice the browser leaving. A write that
       timed out has an ambiguous outcome. So the reader is told what we know and
       given a button — and pressing it is *their* decision to abandon the id,
       which is the only authority available. Two earlier drafts dropped the
       summary automatically; both were inferring a deletion from evidence that
       cannot support one. GPT Sol, fifth pass. */
    vi.useFakeTimers();
    try {
      openOn("spya-ghost1");
      expect(host.textContent).toContain("Starting…");
      act(() => {
        vi.advanceTimersByTime(181_000);
      });
      expect(host.textContent).toContain("didn't see this conversation start");
      /* Still nothing destroyed until a person asks. */
      expect(calls).not.toContain("dropped:spya-ghost1");

      const forget = [...host.querySelectorAll("button")].find(
        (b) => b.textContent?.trim() === "Forget this attempt",
      );
      expect(forget, "the reader needs a way out").toBeTruthy();
      act(() => (forget as HTMLButtonElement).click());
      /* Dropping the stale summary is what makes the next "?" on that paragraph
         mint a real conversation instead of landing back here. */
      expect(calls).toEqual(["dropped:spya-ghost1", "close"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not carry one conversation's verdict onto the next", () => {
    /* **The bug the previous version of this test missed by swapping too
       early.** The verdict used to be a boolean, so after A timed out, a swap to
       a missing B rendered once with it still true — and B was condemned on a
       clock started for A. Storing *which id* was waited out makes the
       comparison true only of the thing it was measured for. GPT Sol, fifth
       pass; the earlier test swapped before A expired and so never saw it. */
    vi.useFakeTimers();
    try {
      openOn("spya-ghost1");
      act(() => {
        vi.advanceTimersByTime(181_000);
      });
      expect(host.textContent).toContain("didn't see this conversation start");

      openOn("spya-ghost2");
      /* Not one tick has passed for B. */
      expect(host.textContent).toContain("Starting…");
      expect(host.textContent).not.toContain("didn't see this conversation start");

      act(() => {
        vi.advanceTimersByTime(181_000);
      });
      expect(host.textContent).toContain("didn't see this conversation start");
    } finally {
      vi.useRealTimers();
    }
  });

  it("never drops a summary while the answer could still be coming", () => {
    /* **The other side of the rule above, and the one that stops it becoming
       the bug it replaced.** Two earlier fixes destroyed too eagerly: one
       dropped anything this panel had not minted, which would have deleted live
       conversations mid-creation; the other dropped only what it *had* minted,
       which never ran at all because `send` inserts the thread optimistically
       before the request leaves — it passed only because this file's mock omits
       that insert, as clean an example as the repo has of a check agreeing with
       the code because it shares its assumption
       (docs/reusable/silent-success.md).

       So: nothing is dropped while the conversation is on screen and the answer
       could still arrive, however long the reader leaves the panel open. */
    vi.useFakeTimers();
    try {
      threads = [
        {
          kind: "chat",
          id: "spya-alive1",
          title: "A conversation that exists",
          createdAt: "2026-09-05T00:00:00.000Z",
          updatedAt: "2026-09-05T00:00:00.000Z",
          messages: [],
          // biome-ignore lint/suspicious/noExplicitAny: a thread shaped for this test
        } as any,
      ];
      openOn("spya-alive1");
      act(() => {
        vi.advanceTimersByTime(400_000);
      });
      expect(calls.filter((c) => c.startsWith("dropped:"))).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("still shows 'Starting…' for an id this panel just minted", () => {
    /* The state the old condition existed for, and it has to survive: between
       the POST and the `begin` frame there is a guessed id and no stored
       conversation, and the panel must look like a conversation in that window
       or the feel of the thing is gone. Here the panel mints it by sending a
       help draft, then is re-targeted at the id it returned. */
    act(() => {
      root.render(
        dialog({ target: { kind: "draft", anchor: { blockId: BLOCK }, opening: OPENING, help: true } }),
      );
    });
    expect(sends).toHaveLength(1);
    openOn("spya-newthr");
    expect(host.querySelector(".chat-dialog-loading")).not.toBeNull();
    expect(host.textContent).toContain("Starting…");
    expect(calls).not.toContain("dropped:spya-newthr");
  });
});

/**
 * **Which conversation a press reopens rather than buying.**
 *
 * `helpThreadFor` is the real function `App.helpAboutBlock` calls, not a copy —
 * an earlier draft of this file reimplemented the query inline and would have
 * gone on passing while App did something else entirely, which is the species
 * of test the repo's own instructions call out.
 *
 * **There is no latch to stand in for any more.** This block used to wrap the
 * query in a hand-written ref and a fake `commit()`, mirroring a `helpArming`
 * guard in App — and that guard was deleted on 2026-09-05 when the App-level
 * test in `tests/public-network-trace.test.tsx` showed its absence could not be
 * observed. A stand-in for code that no longer exists is worse than no test:
 * it is a description of the past that reads like a check on the present. GPT
 * Sol, second pass on stage 3.
 */
describe("the conversation a second press reopens", () => {
  /** App's shape around the real query, minus the guard that came out. */
  function launcher(summaries: ThreadSummary[]) {
    const minted: string[] = [];
    const opened: string[] = [];
    const press = (blockId: string) => {
      const existing = helpThreadFor(summaries, blockId);
      if (existing) {
        opened.push(existing.id);
        return;
      }
      minted.push(blockId);
    };
    return { press, minted, opened };
  }

  const summary = (id: string, blockId: string, updatedAt: string, anchor?: ChatAnchor): ThreadSummary =>
    ({
      id,
      title: id,
      createdAt: updatedAt,
      updatedAt,
      kind: "chat",
      turns: 1,
      anchor: anchor ?? { blockId },
      // biome-ignore lint/suspicious/noExplicitAny: a summary shaped for this test
    }) as any;

  it("mints one when there is nothing to reopen", () => {
    const l = launcher([]);
    l.press(BLOCK);
    expect(l.minted).toEqual([BLOCK]);
    expect(l.opened).toEqual([]);
  });

  it("stays willing after a press that produced nothing", () => {
    /* **The failure a latch here would have introduced**, and the reason the
       one that was here had to clear itself: a guard that outlives the tick
       makes the button permanently inert on that paragraph, so a reader whose
       first attempt was cancelled or failed presses "?" and nothing whatever
       happens, for the rest of the session, with no message. With the guard
       gone the property is free, and it is asserted anyway because it is the
       property that mattered. */
    const l = launcher([]);
    l.press(BLOCK);
    l.press(BLOCK);
    expect(l.minted).toEqual([BLOCK, BLOCK]);
  });

  it("opens the conversation that already exists instead of buying another", () => {
    const l = launcher([summary("spya-old111", BLOCK, "2026-09-04T10:00:00.000Z")]);
    l.press(BLOCK);
    expect(l.minted).toEqual([]);
    expect(l.opened).toEqual(["spya-old111"]);
  });

  it("opens the newest of them", () => {
    const l = launcher([
      summary("spya-old111", BLOCK, "2026-09-04T10:00:00.000Z"),
      summary("spya-new222", BLOCK, "2026-09-05T09:00:00.000Z"),
    ]);
    l.press(BLOCK);
    expect(l.opened).toEqual(["spya-new222"]);
  });

  it("ignores a conversation about a phrase somebody selected", () => {
    /* A chat anchored to a *quote* is about those words. Reopening it for a
       reader who pressed "?" on the paragraph would answer a question they did
       not ask, and — worse — would make the "?" silently do nothing new on a
       paragraph they have highlighted once. Only whole-block anchors count. */
    const l = launcher([
      summary("spya-sel333", BLOCK, "2026-09-05T09:00:00.000Z", {
        blockId: BLOCK,
        quote: "a phrase",
        start: 3,
      }),
    ]);
    l.press(BLOCK);
    expect(l.opened).toEqual([]);
    expect(l.minted).toEqual([BLOCK]);
  });
});
