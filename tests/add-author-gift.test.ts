/**
 * The add page's *For the author…* controller — src/web/add-author-gift.ts,
 * plan docs/plans/261009u-author-gift-draft-voucher-from-the-add-page.md § D9
 * and § Revision 3, R2-F8. Every answer `POST /api/admin/author-gifts` can
 * give, driven through an injected request, without React. What only the page
 * can get wrong (the two exits, the recheck after the await) is
 * tests/add-page-author-gift.test.tsx.
 */
import { describe, expect, it } from "vitest";

import { PAGE_FAULT } from "../src/messages.js";
import { AuthorGiftAtAddController, type PostAuthorGift } from "../src/web/add-author-gift.js";
import { ReaderFacingError } from "../src/web/lib/reader-facing.js";

function refusal(status: number, message = "no"): Error {
  return Object.assign(new ReaderFacingError(message), { status });
}

/** A `post` that waits for the test to answer, recording every call. */
function held() {
  const calls: string[] = [];
  let answer: ((body: { created: boolean }) => void) | null = null;
  let fail: ((e: unknown) => void) | null = null;
  const post: PostAuthorGift = (slug) => {
    calls.push(slug);
    return new Promise((resolve, reject) => {
      answer = resolve;
      fail = reject;
    });
  };
  return {
    post,
    calls,
    answer: (created: boolean) => answer?.({ created }),
    fail: (e: unknown) => fail?.(e),
  };
}

function armed(post: PostAuthorGift): AuthorGiftAtAddController {
  const gift = new AuthorGiftAtAddController(post);
  gift.open();
  gift.tick(true);
  expect(gift.confirm()).toBe(true);
  return gift;
}

describe("AuthorGiftAtAddController", () => {
  it("is not armed without the rights tick, and Cancel leaves nothing behind", () => {
    const gift = new AuthorGiftAtAddController(held().post);
    expect(gift.get()).toEqual({ kind: "off" });
    gift.open();
    expect(gift.get()).toEqual({ kind: "confirming", rights: false });
    expect(gift.unsettled()).toBe(true);
    expect(gift.confirm()).toBe(false);
    expect(gift.engaged()).toBe(false);
    gift.cancel();
    expect(gift.get()).toEqual({ kind: "off" });
    expect(gift.unsettled()).toBe(false);
  });

  it("arms on confirm, and Undo disarms it before the exit", async () => {
    const h = held();
    const gift = armed(h.post);
    expect(gift.get()).toEqual({ kind: "armed" });
    expect(gift.engaged()).toBe(true);
    gift.undo();
    expect(gift.get()).toEqual({ kind: "off" });
    expect(gift.engaged()).toBe(false);
    /* Not armed: the exit goes, and nothing is sent. */
    await expect(gift.send("a-paper")).resolves.toBe("go");
    expect(h.calls).toEqual([]);
  });

  it("armed + 202: one request, then go", async () => {
    const h = held();
    const gift = armed(h.post);
    const exit = gift.send("a-paper");
    expect(gift.get()).toEqual({ kind: "sending", slug: "a-paper" });
    /* Undo is over once the exit has started. */
    gift.undo();
    expect(gift.get()).toEqual({ kind: "sending", slug: "a-paper" });
    h.answer(true);
    await expect(exit).resolves.toBe("go");
    expect(h.calls).toEqual(["a-paper"]);
    expect(gift.get()).toEqual({ kind: "made", slug: "a-paper", created: true });
  });

  it("armed + 200 (a gift already there) is a success too", async () => {
    const h = held();
    const gift = armed(h.post);
    const exit = gift.send("a-paper");
    h.answer(false);
    await expect(exit).resolves.toBe("go");
    expect(gift.get()).toEqual({ kind: "made", slug: "a-paper", created: false });
  });

  it("is single-flight: a second exit while the first waits shares its request, and one after it sends nothing", async () => {
    const h = held();
    const gift = armed(h.post);
    const first = gift.send("a-paper");
    const second = gift.send("a-paper");
    h.answer(true);
    await expect(first).resolves.toBe("go");
    await expect(second).resolves.toBe("go");
    await expect(gift.send("a-paper")).resolves.toBe("go");
    expect(h.calls).toEqual(["a-paper"]);
  });

  it("armed + 409: stays, says why, and does not send again", async () => {
    const h = held();
    const gift = armed(h.post);
    const exit = gift.send("a-paper");
    h.fail(refusal(409, "That article has nothing to read yet."));
    await expect(exit).resolves.toBe("stay");
    expect(gift.get()).toEqual({
      kind: "refused",
      slug: "a-paper",
      message: "That article has nothing to read yet.",
    });
    await expect(gift.send("a-paper")).resolves.toBe("stay");
    expect(h.calls).toEqual(["a-paper"]);
  });

  it("a lost answer (no status) stays as *lost*, never as made", async () => {
    const h = held();
    const gift = armed(h.post);
    const exit = gift.send("a-paper");
    h.fail(new TypeError("Failed to fetch"));
    await expect(exit).resolves.toBe("stay");
    expect(gift.get()).toMatchObject({ kind: "lost", slug: "a-paper" });
  });

  it("a request that throws before it is sent (the token lookup) is caught", async () => {
    const gift = armed(() => {
      throw new Error("no token");
    });
    await expect(gift.send("a-paper")).resolves.toBe("stay");
    expect(gift.get()).toMatchObject({ kind: "lost" });
  });

  it("does not put an unauthored exception's words on the page", async () => {
    const h = held();
    const gift = armed(h.post);
    const exit = gift.send("a-paper");
    h.fail(new Error("SENTINEL internal exception"));
    await expect(exit).resolves.toBe("stay");
    expect(gift.get()).toEqual({ kind: "lost", slug: "a-paper", message: PAGE_FAULT.message });
  });

  it("retired mid-await: the answer is drawn nowhere and the exit is stale", async () => {
    const h = held();
    const gift = armed(h.post);
    const exit = gift.send("a-paper");
    let told = 0;
    gift.subscribe(() => {
      told += 1;
    });
    gift.retire();
    expect(told).toBe(1);
    expect(gift.get()).toEqual({ kind: "off" });
    h.answer(true);
    await expect(exit).resolves.toBe("stale");
    expect(gift.get()).toEqual({ kind: "off" });
    expect(told).toBe(1);
  });

  it("retired before the exit: no request at all", async () => {
    const h = held();
    const gift = armed(h.post);
    gift.retire();
    await expect(gift.send("a-paper")).resolves.toBe("stale");
    expect(h.calls).toEqual([]);
    /* And nothing it is asked afterwards changes it. */
    gift.open();
    expect(gift.get()).toEqual({ kind: "off" });
  });
});
