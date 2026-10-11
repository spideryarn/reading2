// @vitest-environment jsdom
/**
 * **A comment that started a chat shows that chat's gist under its link**
 * (plan 261011c). Greg, 2026-10-10 (spya-rbp55k): *"if I click Ask in Chat and
 * get a nice response, that that should auto-generate a short summary that
 * shows up in the citation entry, and that that should be true for anywhere
 * where we offer Ask in Chat."* A comment's *Ask in chat* box is one of those
 * places; the gist is the one line a small model already writes after each
 * answer (src/chat-gist.ts), the same line an item's chat mark shows.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { CommentDialog } from "../src/web/CommentDialog.js";
import type { ClientComment } from "../src/web/useComments.js";

const COMMENT: ClientComment = {
  id: "spya-p7w2dn",
  blockId: "spya-k3m9qt",
  quote: "a science of bumps",
  start: 0,
  createdAt: "2026-09-05T10:00:00.000Z",
  body: "what is the evidence for this?",
  status: "none",
  threadId: "spya-t4r5e6",
};

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

async function draw(own: { onOpenThread?: () => void; threadGist?: string }): Promise<void> {
  await act(async () => {
    root.render(
      createElement(CommentDialog, {
        comment: COMMENT,
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
          onDiscuss: () => {},
          onEdit: () => {},
          onPlace: () => {},
          onRecolour: () => {},
          error: null,
          ...own,
        },
      }),
    );
  });
}

const GIST = "Phrenology's evidence was anecdotal, and the replications failed.";

describe("the chat a comment started (261011c)", () => {
  it("shows the chat's gist under the link to it, in the model's face", async () => {
    await draw({ onOpenThread: () => {}, threadGist: GIST });
    const link = container.querySelector(".cmt-open-thread");
    const gist = container.querySelector(".cmt-thread-gist");
    expect(link).not.toBeNull();
    expect(gist?.textContent).toBe(GIST);
    expect(gist?.classList.contains("voice-ai")).toBe(true);
    expect(link?.nextElementSibling).toBe(gist);
  });

  it("shows only the link until a gist has been written", async () => {
    await draw({ onOpenThread: () => {} });
    expect(container.querySelector(".cmt-open-thread")).not.toBeNull();
    expect(container.querySelector(".cmt-thread-gist")).toBeNull();
  });

  it("shows no gist when the chat is not there to open", async () => {
    await draw({ threadGist: GIST });
    expect(container.querySelector(".cmt-thread-gist")).toBeNull();
  });
});
