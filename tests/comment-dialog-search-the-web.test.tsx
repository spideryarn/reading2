// @vitest-environment jsdom
/**
 * **"Search the web" is offered on comments the server refuses to answer.**
 *
 * `CommentDialog`'s footer renders `cmt-deepen` whenever `own && comment.status
 * !== "pending"`. That reads as *"not busy"*, and it is not: `status: "none"` is
 * every **free** comment — a bookmark, or a note the reader wrote without
 * ticking "Also ask the AI" — and it passes the test. So a reader who writes
 * *"what is the evidence for this?"* as a plain comment is shown a button
 * labelled **Search the web**, presses it, and is told by `beginAnswer` in
 * src/comments.ts that their comment
 *
 * > was never a question, so there is nothing to answer
 *
 * — a 409, `NotAnExplanation(id, "free")`. The refusal is right; the button is
 * the bug. Found while diagnosing report 1X (a comment asking for evidence did
 * not search the web); not what bit Greg that morning, but the same reader
 * pressing the same expectation against a different wall.
 *
 * Three statuses rather than one, because a one-case test here would pin the
 * fix and not the rule: `none` must not offer it, and `done` and `error` must
 * go on offering it. Narrowing the condition too far is the obvious way to
 * "fix" this and would take the reader's only way to ask again with them.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { CommentDialog } from "../src/web/CommentDialog.js";
import type { ClientComment } from "../src/web/useComments.js";

const BLOCK = "spya-k3m9qt";

const comment = (status: ClientComment["status"]): ClientComment => ({
  id: "spya-p7w2dn",
  blockId: BLOCK,
  quote: "a science of bumps",
  start: 0,
  createdAt: "2026-09-05T10:00:00.000Z",
  body: "what is the evidence for this?",
  status,
  ...(status === "done" ? { answer: "Because of X." } : {}),
  ...(status === "error" ? { error: "The AI service was unreachable." } : {}),
});

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

/** Render one comment as its owner, and say whether the button is drawn. */
async function deepenOffered(status: ClientComment["status"]): Promise<boolean> {
  await act(async () => {
    root.render(
      createElement(CommentDialog, {
        comment: comment(status),
        position: 1,
        total: 1,
        hasPrev: false,
        hasNext: false,
        onPrev: () => {},
        onNext: () => {},
        onClose: () => {},
        access: {
          kind: "owner" as const,
          placing: false,
          pending: 0,
          onDelete: () => {},
          onRetry: () => {},
          onDeepen: () => {},
          onDiscuss: () => {},
          onEdit: () => {},
          onPlace: () => {},
          error: null,
        },
      }),
    );
  });
  return container.querySelector(".cmt-deepen") !== null;
}

describe("the Search the web button", () => {
  it("is NOT offered on a free comment, which the server refuses with a 409", async () => {
    expect(
      await deepenOffered("none"),
      'A free comment (status "none") was never a question. Pressing this gets ' +
        "`NotAnExplanation(id, \"free\")` — src/comments.ts § beginAnswer.",
    ).toBe(false);
  });

  it("is still offered on an answered comment, which is what it is for", async () => {
    expect(await deepenOffered("done")).toBe(true);
  });

  it("is still offered on one whose answer failed", async () => {
    expect(await deepenOffered("error")).toBe(true);
  });

  it("is still hidden while an answer is arriving", async () => {
    /* Two overlapping re-asks race to write the same row — the reason the
       original condition existed at all. */
    expect(await deepenOffered("pending")).toBe(false);
  });
});
