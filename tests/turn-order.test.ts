/**
 * `inTurnOrder` — one turn at a time per conversation.
 *
 * A lock is the sort of thing that looks obviously right and is obviously right
 * until three requests arrive at once. This file is the contract, on its own,
 * with no HTTP and no store: **exclusion**, **order**, and what happens when one
 * of the things holding it throws.
 *
 * It does not check that the routes use it. That is read rather than tested, and
 * the reason is in the note above `inTurnOrder` in src/routes.ts — the window
 * the lock closes is a wait inside `settleThread`, and nothing outside the
 * process can hold that wait open on purpose. A test that tried passed with the
 * lock removed, which is worse than no test at all.
 */
import { describe, expect, it } from "vitest";
import { inTurnOrder } from "../src/routes.js";

/** A promise somebody else resolves. */
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("inTurnOrder", () => {
  it("will not let a second turn start before the first has finished", async () => {
    const log: string[] = [];
    const first = deferred();

    const a = inTurnOrder("t", async () => {
      log.push("a in");
      await first.promise;
      log.push("a out");
    });
    const b = inTurnOrder("t", async () => {
      log.push("b in");
    });

    await tick();
    // This is the whole point. `b` was dispatched while `a` was in the middle,
    // and it has not run a line.
    expect(log).toEqual(["a in"]);

    first.resolve();
    await Promise.all([a, b]);
    expect(log).toEqual(["a in", "a out", "b in"]);
  });

  it("keeps three turns in the order they arrived", async () => {
    const log: string[] = [];
    const gate = deferred();
    const turn = (name: string) =>
      inTurnOrder("t", async () => {
        await gate.promise;
        log.push(name);
      });
    const all = [turn("one"), turn("two"), turn("three")];
    gate.resolve();
    await Promise.all(all);
    expect(log).toEqual(["one", "two", "three"]);
  });

  it("does not make two conversations wait for each other", async () => {
    const held = deferred();
    const log: string[] = [];
    const slow = inTurnOrder("a", async () => {
      await held.promise;
      log.push("a");
    });
    await inTurnOrder("b", async () => {
      log.push("b");
    });
    // `b` finished while `a` was still held.
    expect(log).toEqual(["b"]);
    held.resolve();
    await slow;
    expect(log).toEqual(["b", "a"]);
  });

  it("lets a turn queued behind a failing one through, and tells only the caller", async () => {
    /* The two have to be queued **together**, before the first settles, or this
       proves nothing: a turn dispatched after the failure finds the key already
       cleaned up and starts a fresh chain, which works whatever the chain does
       with rejections. Queued behind it, it waits on the failing turn's tail —
       and if that tail passed the rejection on, one refused request would reject
       every later turn in this conversation with a stranger's error for the life
       of the process. */
    const gate = deferred();
    const failed = inTurnOrder("t", async () => {
      await gate.promise;
      throw new Error("no");
    });
    const behind = inTurnOrder("t", async () => "fine");
    gate.resolve();

    await expect(failed).rejects.toThrow("no");
    await expect(behind).resolves.toBe("fine");
  });

  it("does not accumulate a key per conversation", async () => {
    /* The map is module state, so a key left behind is a leak for the life of
       the process — one per conversation anybody ever chatted in. Checked from
       the outside: after everything settles, a turn on the same key must start
       immediately rather than queue behind a tail that is still hanging around.
       If the entry were never cleared, the chain would still resolve, so this
       is a weak check — but a leak that changed behaviour would show here. */
    await inTurnOrder("t", async () => {});
    let started = false;
    const p = inTurnOrder("t", async () => {
      started = true;
    });
    await tick();
    expect(started).toBe(true);
    await p;
  });
});
