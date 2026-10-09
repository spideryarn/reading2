// @vitest-environment jsdom
/**
 * **A comment's footer offers no *Dig deeper*; its *Ask in chat* box is the
 * way to go further** (plan 261009k, D2: Greg, 2026-10-09, *"we don't need the
 * dig deeper button"*).
 *
 * The button was *Search the web*, then *Dig deeper* (plan 261001p). Its
 * history here: it was once offered on a **free** comment (`status: "none"`),
 * which `beginAnswer` in src/comments.ts refuses with a 409 — report 1X,
 * 2026-09-05. The button is gone on every status now, and the follow-up box
 * is drawn on every status but `pending`.
 *
 * Four statuses rather than one, so that a Dig deeper coming back on any one
 * of them goes red.
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

/** Render one comment as its owner. */
async function drawOwned(status: ClientComment["status"]): Promise<void> {
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
          onDiscuss: () => {},
          onEdit: () => {},
          onPlace: () => {},
          onRecolour: () => {},
          error: null,
        },
      }),
    );
  });
}

const digDeeper = () =>
  [...container.querySelectorAll("button")].filter((b) => /Dig deeper|Search the web/.test(b.textContent ?? ""));

describe("no Dig deeper on a comment (261009k)", () => {
  it.each(["none", "pending", "done", "error"] as const)("is not offered on a %s comment", async (status) => {
    await drawOwned(status);
    expect(container.querySelector(".cmt-deepen")).toBeNull();
    expect(digDeeper()).toEqual([]);
  });

  it.each(["none", "done", "error"] as const)("leaves Ask in chat as the way further on a %s comment", async (status) => {
    await drawOwned(status);
    const ask = container.querySelector<HTMLInputElement | HTMLTextAreaElement>(
      '[aria-label="Ask a follow-up question about this passage"]',
    );
    expect(ask).not.toBeNull();
    expect([...container.querySelectorAll("button[type=submit]")].map((b) => b.textContent)).toContain("Ask in chat");
  });
});

describe("the search badge", () => {
  it("says the sources were found, not cited", async () => {
    /* Plan 261001p § What the sources list means: a dug answer's list is
       everything its search returned, and a plain-text answer cannot say which
       of them it leaned on. */
    await act(async () => {
      root.render(
        createElement(CommentDialog, {
          comment: {
            ...comment("done"),
            searches: 2,
            citations: [
              { url: "https://example.org/a" },
              { url: "https://example.org/b" },
              { url: "https://example.org/c" },
            ],
          },
          position: 1,
          total: 1,
          hasPrev: false,
          hasNext: false,
          onPrev: () => {},
          onNext: () => {},
          onClose: () => {},
          access: { kind: "visitor" as const },
        }),
      );
    });
    const badge = container.querySelector<HTMLElement>(".cmt-search");
    await act(async () => badge?.focus());
    const card = document.querySelector<HTMLElement>('[role="tooltip"]');
    expect(card?.textContent).toContain("found 3 sources");
    expect(card?.textContent).not.toContain("cited");
  });

  it("does not claim an empty sources list is shown above", async () => {
    await act(async () => {
      root.render(
        createElement(CommentDialog, {
          comment: { ...comment("done"), searches: 1, citations: [] },
          position: 1,
          total: 1,
          hasPrev: false,
          hasNext: false,
          onPrev: () => {},
          onNext: () => {},
          onClose: () => {},
          access: { kind: "visitor" as const },
        }),
      );
    });
    const badge = container.querySelector<HTMLElement>(".cmt-search");
    await act(async () => badge?.focus());
    const card = document.querySelector<HTMLElement>('[role="tooltip"]');
    expect(card?.textContent).toContain("The model ran one search.");
    expect(card?.textContent).not.toContain("listed above");
  });
});

describe("a whole-paragraph bookmark", () => {
  it("names the whole paragraph and quotes its opening rather than rendering a blank", async () => {
    const whole: ClientComment = {
      id: "spya-p7w2dn",
      blockId: BLOCK,
      createdAt: "2026-09-12T10:00:00.000Z",
      status: "none",
    };
    await act(async () => {
      root.render(
        createElement(CommentDialog, {
          comment: whole,
          paragraph: "The opening words that distinguish this paragraph from another.",
          position: 1,
          total: 1,
          hasPrev: false,
          hasNext: false,
          onPrev: () => {},
          onNext: () => {},
          onClose: () => {},
          access: { kind: "visitor" as const },
        }),
      );
    });
    expect(container.querySelector(".cmt-quote")?.textContent).toBe(
      "Whole paragraph — The opening words that distinguish this paragraph from another.",
    );
  });
});
