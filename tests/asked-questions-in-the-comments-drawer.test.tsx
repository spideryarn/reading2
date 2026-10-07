// @vitest-environment jsdom
/**
 * **A question asked from the gutter is in the Comments drawer.**
 *
 * Greg, SPIDERYARN-READING2-6W, 2026-09-30: he pressed the "?" beside a
 * paragraph, read the answer, closed it — and then could not find it again,
 * because the drawer listed comments only and a whole-block chat draws no mark
 * in the prose. *"I expect that to show up in the comments so that I can find
 * it again or find the answer again. Perhaps somehow flagged as a question
 * rather than a comment, but still there."*
 *
 * docs/plans/260930f-gutter-questions-listed-in-the-comments-drawer.md.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Comment, ThreadSummary } from "../src/types.js";
import { type AskedQuestion, orderDrawer } from "../src/web/comment-nav.js";
import { Dock, fitSignature } from "../src/web/Dock.js";
import { askedBesideCard, askedQuestions } from "../src/web/useChatAnchors.js";
import { SLOW_AFTER_MS } from "../src/web/useSlow.js";
import { EXPERIMENTAL_OFF } from "./helpers/experimental-fixtures.js";

const FIRST = "spya-aaaaa1";
const SECOND = "spya-bbbbb2";
/* In document order the *second* id sorts first as a string — so a sort on the
   id string would come out backwards, and the ordering tests below would see it
   (block-ids.md § why random). */
const BLOCKS = [{ id: SECOND }, { id: FIRST }];

const COMMENT: Comment = {
  id: "cmt-1",
  blockId: FIRST,
  quote: "a phrase he marked",
  start: 10,
  createdAt: "2026-09-30T09:00:00.000Z",
  body: "this is the bit I doubt",
  status: "none",
};

/** The gutter's "?": a chat anchored to the whole block. */
const HELP: AskedQuestion = {
  id: "thr-help",
  blockId: FIRST,
  createdAt: "2026-09-30T10:00:00.000Z",
  lastLine: "The key idea is that the earlier result was a special case.",
};

/** *Chat about this* on a selection, in the paragraph before. */
const SELECTED: AskedQuestion = {
  id: "thr-sel",
  blockId: SECOND,
  quote: "an earlier sentence",
  start: 4,
  createdAt: "2026-09-30T11:00:00.000Z",
};

describe("orderDrawer", () => {
  it("puts comments and questions in one reading order, by block index", () => {
    const rows = orderDrawer([COMMENT], [HELP, SELECTED], BLOCKS);
    expect(rows.map((r) => r.item.id)).toEqual(["thr-sel", "thr-help", "cmt-1"]);
  });

  it("puts a whole-block question before a comment on part of its paragraph", () => {
    // HELP was asked an hour after COMMENT, and still comes first: it is about
    // the paragraph, so it precedes anything inside it.
    const rows = orderDrawer([COMMENT], [HELP], BLOCKS);
    expect(rows.map((r) => r.kind)).toEqual(["asked", "comment"]);
  });

  it("sorts a question whose paragraph is gone to the end, not out of the list", () => {
    const orphan: AskedQuestion = { ...HELP, id: "thr-orphan", blockId: "spya-gone00" };
    const rows = orderDrawer([COMMENT], [orphan, SELECTED], BLOCKS);
    expect(rows.map((r) => r.item.id)).toEqual(["thr-sel", "cmt-1", "thr-orphan"]);
  });
});

describe("askedQuestions", () => {
  const base = { title: "Help me understand.", createdAt: "t", updatedAt: "t", turns: 1 };
  it("keeps anchored chats, whole-block and quoted, and nothing else", () => {
    const summaries: ThreadSummary[] = [
      { ...base, id: "a", kind: "chat", anchor: { blockId: FIRST } },
      { ...base, id: "b", kind: "chat", anchor: { blockId: SECOND, quote: "q", start: 2 } },
      { ...base, id: "c", kind: "chat" },
      { ...base, id: "d", kind: "learn", anchor: { blockId: FIRST } },
    ];
    const got = askedQuestions(summaries, []);
    expect(got.map((q) => q.id)).toEqual(["a", "b"]);
    expect(got[1]).toMatchObject({ blockId: SECOND, quote: "q", start: 2 });
    expect(got[0]?.quote).toBeUndefined();
  });

  it("leaves out a chat a comment already points at, so it is not listed twice", () => {
    // *Also ask the AI* on a comment: an anchored chat, recorded as the
    // comment's `threadId`. The comment's own row is where that question lives.
    const summaries: ThreadSummary[] = [
      { ...base, id: "from-comment", kind: "chat", anchor: { blockId: FIRST, quote: "q", start: 0 } },
      { ...base, id: "from-gutter", kind: "chat", anchor: { blockId: FIRST } },
    ];
    const got = askedQuestions(summaries, [{ ...COMMENT, threadId: "from-comment" }]);
    expect(got.map((q) => q.id)).toEqual(["from-gutter"]);
  });
});

/* Plan 261004k § 6: while a conversation is drawn as a card in the Marginalia
   column, the margin's own *Question* line for it is dropped — the block would
   say it directly above the card that is that question. The margin's list
   only; the drawer keeps listing it. */
describe("askedBesideCard", () => {
  const list: AskedQuestion[] = [HELP, SELECTED];
  it("drops the conversation the card is showing, and nothing else", () => {
    expect(askedBesideCard(list, HELP.id).map((q) => q.id)).toEqual([SELECTED.id]);
    expect(askedBesideCard(list, "thr-not-in-the-list").map((q) => q.id)).toEqual([HELP.id, SELECTED.id]);
  });

  it("is the same list, by identity, when there is no card: the margin's memo must hold", () => {
    expect(askedBesideCard(list, null)).toBe(list);
    expect(askedBesideCard(list, "thr-not-in-the-list")).toBe(list);
  });
});

let host: HTMLDivElement;
let root: Root;

function paint(opts: {
  comments?: Comment[];
  questions?: AskedQuestion[];
  commentsLoaded?: boolean;
  askedLoaded?: boolean;
  askedError?: string | null;
  onOpenComment?: (id: string) => void;
  onOpenAsked?: (id: string) => void;
}): void {
  act(() => {
    root.render(
      createElement(Dock, {
        slug: "a-piece",
        view: "article" as const,
        experimental: EXPERIMENTAL_OFF,
        drawer: {
          comments: opts.comments ?? [],
          paragraphs: new Map([[FIRST, "In 1998 the lab found something odd about the result."]]),
          loaded: opts.commentsLoaded ?? true,
          loadError: null,
          error: null,
          panel: "questions" as const,
          onPanel: () => {},
          onOpenComment: opts.onOpenComment ?? (() => {}),
          asked: {
            questions: opts.questions ?? [],
            loaded: opts.askedLoaded ?? true,
            error: opts.askedError ?? null,
            blocks: BLOCKS,
            onOpen: opts.onOpenAsked ?? (() => {}),
          },
        },
      }),
    );
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

describe("the Comments drawer lists the questions the reader asked", () => {
  it("shows a '?' question, marked as one, with its paragraph", () => {
    paint({ questions: [HELP] });
    const row = host.querySelector(".dock-question.asked");
    expect(row).not.toBeNull();
    expect(row?.querySelector(".dock-question-kind")?.textContent).toBe("Question");
    expect(row?.textContent).toContain("Whole paragraph");
    expect(row?.textContent).toContain("In 1998 the lab");
  });

  /* SPIDERYARN-READING2-9H, plan 261002j: the comment rows say their kind too. */
  it("labels each comment row with its kind, beside the question rows' own", () => {
    paint({
      comments: [
        COMMENT,
        { ...COMMENT, id: "cmt-ai", threadId: "thr-x" },
        { id: "cmt-bare", blockId: FIRST, quote: "q", start: 0, createdAt: "t", status: "none" },
      ],
      questions: [HELP],
    });
    const kinds = [...host.querySelectorAll(".dock-question-kind")].map((k) => k.textContent);
    expect(kinds.sort()).toEqual(["Bookmark", "Comment", "Comment + AI", "Question"]);
  });

  /* No preview line: `lastLine` is not kept live, so a question minted in this
     visit would say "thinking…" under the answer the reader just read — the
     report's own sequence. GPT Sol's plan review, finding 2. */
  it("draws no answer preview, which would be stale for a question asked this visit", () => {
    paint({ questions: [HELP, SELECTED] });
    expect(host.querySelector(".dock-question.asked .dock-question-state")).toBeNull();
    expect(host.textContent).not.toContain("thinking…");
  });

  it("says the questions are still coming over the comments it already has", () => {
    paint({ comments: [COMMENT], askedLoaded: false });
    act(() => {
      vi.advanceTimersByTime(SLOW_AFTER_MS + 1);
    });
    expect(host.textContent).toContain("a phrase he marked");
    expect(host.querySelector(".cmt-spinner")).not.toBeNull();
  });

  it("says the comments are still coming over the questions it already has", () => {
    paint({ questions: [HELP], commentsLoaded: false });
    act(() => {
      vi.advanceTimersByTime(SLOW_AFTER_MS + 1);
    });
    expect(host.textContent).toContain("In 1998 the lab");
    expect(host.querySelector(".cmt-spinner")).not.toBeNull();
  });

  it("opens the conversation, not a comment, when the row is pressed", () => {
    const onOpenAsked = vi.fn();
    const onOpenComment = vi.fn();
    paint({ comments: [COMMENT], questions: [HELP], onOpenAsked, onOpenComment });
    act(() => (host.querySelector(".dock-question.asked") as HTMLButtonElement).click());
    expect(onOpenAsked).toHaveBeenCalledWith("thr-help");
    expect(onOpenComment).not.toHaveBeenCalled();
  });

  it("counts both on the Comments button, so the number matches the list", () => {
    paint({ comments: [COMMENT], questions: [HELP, SELECTED] });
    expect(host.querySelector(".dock-count")?.textContent).toBe("3");
  });

  it("changes the fit signature when a question takes the visible count from 9 to 10", () => {
    /* No modes drawn and none under More: this is about the chip. */
    const rest = [{ drawn: [], menu: [] }, undefined, undefined, undefined] as const;
    const nine = fitSignature(...rest, { comments: [], count: 9 }, null, false);
    const ten = fitSignature(...rest, { comments: [], count: 10 }, null, false);
    expect(nine).toContain("|9|");
    expect(ten).toContain("|10|");
    expect(ten).not.toBe(nine);
  });

  it("does not say 'Nothing marked yet' while the questions are still loading", () => {
    paint({ askedLoaded: false });
    act(() => {
      vi.advanceTimersByTime(SLOW_AFTER_MS + 1);
    });
    expect(host.textContent).not.toContain("Nothing marked yet");
  });

  it("says so when the questions failed to load, rather than that there are none", () => {
    paint({ askedError: "Couldn't reach the server. [net-down]" });
    expect(host.textContent).not.toContain("Nothing marked yet");
    expect(host.textContent).toContain("Couldn't load the questions you asked");
  });

  it("does not draw or open asked rows on the visitor arm, even if one is injected", () => {
    const onOpenAsked = vi.fn();
    act(() => {
      root.render(
        /* The assertion deliberately injects a field the visitor union forbids,
           so this cast is the test input rather than a shortcut around typing. */
        // biome-ignore lint/suspicious/noExplicitAny: hostile runtime prop for the ownership gate
        createElement(Dock as any, {
          slug: "a-piece",
          view: "article" as const,
          experimental: EXPERIMENTAL_OFF,
          drawer: {
            visitor: true as const,
            comments: [COMMENT],
            paragraphs: new Map([[FIRST, "In 1998 the lab found something odd."]]),
            panel: "questions" as const,
            onPanel: () => {},
            onOpenComment: () => {},
            /* Deliberately beyond the visitor union: the runtime gate must be
               ownership, not merely a well-behaved caller's empty list. */
            asked: {
              questions: [HELP],
              loaded: true,
              error: null,
              blocks: BLOCKS,
              onOpen: onOpenAsked,
            },
          },
        }),
      );
    });
    expect(host.querySelector(".dock-question.asked")).toBeNull();
    expect(host.textContent).not.toContain("Question");
    expect(onOpenAsked).not.toHaveBeenCalled();
  });
});
