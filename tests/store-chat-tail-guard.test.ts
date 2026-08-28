/**
 * `expectedTailId` has to be checked with the edit, not before it.
 *
 * The guard exists because a stale tab's edit silently deletes every turn added
 * since it last looked: `withEdit` checks only that its target is still a
 * question, then discards everything after it. Tab A appends Q2/A2, stale tab B
 * edits Q1, both vanish, and A's reader saw a perfectly successful answer.
 *
 * **Putting the check one layer too high puts the bug back.** Load the threads,
 * check the tail, then call the store's `edit` — which enters the mutex and
 * re-reads — and there are two reads with a gap between them. A `begin` can land, or
 * already be queued, in that gap: the check passes against Q1/A1, `begin`
 * writes Q2/A2, and the edit runs behind it and deletes both. GPT Sol found
 * that in the filesystem adapter on 2026-08-26, after the Postgres one had the
 * check in the right place.
 *
 * This file is the filesystem side. The Postgres side is in
 * tests/store-chat-pg.test.ts, where the check runs inside the article-locked
 * transaction.
 *
 * No database needed.
 */

import { rm } from "node:fs/promises";
import path from "node:path";

import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { ChatConflict } from "../src/chat.js";
import { fsChatStore } from "../src/store/fs.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const SLUG = "test-chat-tail-guard";

async function clear(): Promise<void> {
  await rm(path.join(ROOT, "data", SLUG), { recursive: true, force: true });
}

describe("the filesystem chat store's stale-edit guard", () => {
  beforeEach(clear);
  afterAll(clear);

  it("refuses an edit whose view of the end of the thread is out of date", async () => {
    const one = await fsChatStore.begin(SLUG, { threadId: "spya-thread", question: "First?" });
    await fsChatStore.finish(SLUG, "spya-thread", one.reply.id, { status: "done", text: "A1" });
    const staleTail = one.reply.id;

    const two = await fsChatStore.begin(SLUG, { threadId: "spya-thread", question: "Second?" });
    await fsChatStore.finish(SLUG, "spya-thread", two.reply.id, { status: "done", text: "A2" });

    await expect(
      fsChatStore.edit(SLUG, "spya-thread", one.user.id, "rewritten", {
        expectedTailId: staleTail,
      }),
    ).rejects.toBeInstanceOf(ChatConflict);
    expect((await fsChatStore.load(SLUG))[0]?.messages).toHaveLength(4);
  });

  it("checks against the thread as it is when the edit runs, not when it was asked for", async () => {
    /* **The race, made deterministic by the mutex itself.**

       `begin` and `edit` are both fired without awaiting the first. The mutex
       is a promise chain, so `begin` is enqueued first and therefore runs
       first — that part is not a race. What *was* a race is where the tail gets
       read: inside the callback it sees the state `begin` just wrote and
       conflicts, which is right; outside it, the read can happen before
       `begin`'s write and the edit sails through and deletes the new turn.

       So the assertion is the guarantee rather than the timing: an edit naming
       a tail that is no longer the tail by the time it runs must not proceed. */
    const one = await fsChatStore.begin(SLUG, { threadId: "spya-thread", question: "First?" });
    await fsChatStore.finish(SLUG, "spya-thread", one.reply.id, { status: "done", text: "A1" });

    const [began, edited] = await Promise.allSettled([
      fsChatStore.begin(SLUG, { threadId: "spya-thread", question: "Second?" }),
      fsChatStore.edit(SLUG, "spya-thread", one.user.id, "rewritten", {
        expectedTailId: one.reply.id,
      }),
    ]);

    expect(began.status).toBe("fulfilled");
    expect(edited.status, "a stale edit ran behind a turn it never saw").toBe("rejected");
    if (edited.status === "rejected") {
      expect(edited.reason).toBeInstanceOf(ChatConflict);
    }
    // Q1, A1, Q2, A2 — nothing discarded.
    expect((await fsChatStore.load(SLUG))[0]?.messages).toHaveLength(4);
  });

  it("lets an up-to-date edit through", async () => {
    const one = await fsChatStore.begin(SLUG, { threadId: "spya-thread", question: "First?" });
    await fsChatStore.finish(SLUG, "spya-thread", one.reply.id, { status: "done", text: "A1" });
    const edited = await fsChatStore.edit(SLUG, "spya-thread", one.user.id, "rewritten", {
      expectedTailId: one.reply.id,
    });
    expect(edited.discarded).toBe(1);
    expect((await fsChatStore.load(SLUG))[0]?.messages[0]?.text).toBe("rewritten");
  });
});
