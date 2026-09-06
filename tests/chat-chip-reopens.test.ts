/**
 * **Which conversation the gutter's chat chip opens.**
 *
 * `threadFor` is the query behind `App.chatAboutBlock`, and it is the real
 * function rather than a copy of its rules — the sibling file
 * `tests/help-sends-once.test.tsx` says at length why an inlined reimplementation
 * of a query is a test that goes on passing while the app does something else.
 *
 * The consequence — a click on the chip putting the stored transcript on screen
 * rather than an empty composer — is asserted against the real `App` in
 * `tests/public-network-trace.test.tsx` § *opens the conversation the chat chip
 * is counting*. This file is the ordering, which no click-level test can
 * enumerate cheaply.
 *
 * docs/plans/260905c-gutter-comment-chip-explanation-metadata-and-prompt.md § stage 1.
 */
import { describe, expect, it } from "vitest";

import type { ChatAnchor, ThreadKind, ThreadSummary } from "../src/types.js";
import { threadFor } from "../src/web/useChatAnchors.js";

const BLOCK = "spya-k3m9qt";
const OTHER = "spya-zzzzzz";

function summary(
  id: string,
  updatedAt: string,
  anchor: ChatAnchor | undefined,
  kind: ThreadKind = "chat",
): ThreadSummary {
  return {
    id,
    title: id,
    createdAt: updatedAt,
    updatedAt,
    kind,
    turns: 1,
    ...(anchor ? { anchor } : {}),
  };
}

/** A conversation about the paragraph itself — what the chip's count is for. */
const whole = (id: string, updatedAt: string, blockId = BLOCK, kind: ThreadKind = "chat") =>
  summary(id, updatedAt, { blockId }, kind);

/** A conversation about words the reader picked out inside that paragraph. */
const selection = (id: string, updatedAt: string, blockId = BLOCK) =>
  summary(id, updatedAt, { blockId, quote: "a phrase", start: 3 });

describe("the conversation the chat chip opens", () => {
  it("finds nothing on a paragraph nobody has talked about", () => {
    expect(threadFor([], BLOCK)).toBeUndefined();
    /* And a conversation on a *different* paragraph is not a match either —
       the count beside this block would not include it, so opening it would be
       the chip showing something it never claimed. */
    expect(threadFor([whole("spya-else11", "2026-09-05T09:00:00.000Z", OTHER)], BLOCK))
      .toBeUndefined();
  });

  it("opens the newest whole-block conversation", () => {
    const found = threadFor(
      [
        whole("spya-old111", "2026-09-04T10:00:00.000Z"),
        whole("spya-new222", "2026-09-05T09:00:00.000Z"),
        whole("spya-mid333", "2026-09-04T18:00:00.000Z"),
      ],
      BLOCK,
    );
    expect(found?.id).toBe("spya-new222");
  });

  it("prefers the paragraph's own conversation to a newer selection", () => {
    /* **The one rule that is not "newest wins."** The reader pressed a control
       beside a paragraph, so a three-word highlight from a minute ago must not
       displace the conversation about the paragraph. GPT Sol's finding 4,
       against Fable's flat ordering. */
    const found = threadFor(
      [
        whole("spya-old111", "2026-09-04T10:00:00.000Z"),
        selection("spya-sel222", "2026-09-05T09:00:00.000Z"),
      ],
      BLOCK,
    );
    expect(found?.id).toBe("spya-old111");
  });

  it("falls back to the newest selection when the paragraph has no conversation", () => {
    /* Where this parts company with the "?" (`helpThreadFor`), which admits
       whole-block anchors only. The chip is free and its count already includes
       every anchored conversation on the block, so showing one of the things it
       is counting is the truthful thing for it to do. */
    const found = threadFor(
      [
        selection("spya-sel111", "2026-09-04T10:00:00.000Z"),
        selection("spya-sel222", "2026-09-05T09:00:00.000Z"),
      ],
      BLOCK,
    );
    expect(found?.id).toBe("spya-sel222");
  });

  it("ignores a conversation that is not a chat", () => {
    /* A Remember thread anchored to this block would open chat's UI over a
       Remember conversation — the same failure `App`'s overlay gates against.
       Filtered **positively** on `kind === "chat"`, so a fourth kind arriving
       tomorrow is excluded by default rather than by somebody remembering. */
    const remember = whole("spya-rem111", "2026-09-05T09:00:00.000Z", BLOCK, "remember");
    expect(threadFor([remember], BLOCK)).toBeUndefined();
    /* And it does not merely lose to a chat — it is not a candidate at all,
       which a fixture with a chat beside it could not tell apart. */
    const found = threadFor(
      [remember, whole("spya-cha111", "2026-09-04T10:00:00.000Z")],
      BLOCK,
    );
    expect(found?.id).toBe("spya-cha111");
  });

  it("ignores a conversation with no anchor at all", () => {
    // Started from the Chat band, about the whole article. It is on nobody's
    // paragraph, and the chip beside this one does not count it.
    expect(threadFor([summary("spya-free11", "2026-09-05T09:00:00.000Z", undefined)], BLOCK))
      .toBeUndefined();
  });
});
