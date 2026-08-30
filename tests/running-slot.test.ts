/**
 * The wait that stops a contended job insert being reported as a broken test.
 *
 * These cases drive `insertWhenSlotFree` with a fake insert rather than a
 * database, because what is being tested is the *decision* — retry, rethrow, or
 * give up with something a person can act on — and a real second claimant would
 * make that decision hard to arrange and slow to observe.
 *
 * The fake error is shaped like the real one on purpose: SQLSTATE `23505` and a
 * `constraint` name, wrapped in an outer error the way Drizzle wraps pg's. A
 * flat fake would pass against a `violatesConstraint` that only read the top
 * level, which is the bug its own comment warns about.
 *
 * **Two constraint names go in, and only one still comes out of a database.**
 * `jobs_only_one_running` was dropped on 2026-08-30, when global concurrency 1
 * became a counted cap that `claim` reports as `busy` rather than raising. No
 * live insert can produce that name now. The helper still lists it and these
 * cases still drive it, which is what keeps the retry loop exercised — but the
 * name that fires in earnest is `jobs_active_slug`: this article already has a
 * job queued or running.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { insertWhenSlotFree } from "./helpers/running-slot.js";

/**
 * pg's error, under Drizzle's wrapper — two levels, like the real thing.
 *
 * Every duplicate-key case here is built by this one function, so the
 * **constraint name is the only difference** between one that should be waited
 * out and one that should be rethrown. An earlier version built the rethrown
 * case flat, by hand: a regression to "retry every 23505" read the flat error
 * as not-contention and the test passed against the bug it was written for.
 */
function duplicateKey(constraint: string): Error {
  const fromPg = Object.assign(new Error("duplicate key value violates unique constraint"), {
    code: "23505",
    constraint,
  });
  return Object.assign(new Error("Failed query: insert into \"spideryarn\".\"jobs\""), {
    cause: fromPg,
  });
}

const FAST = { attempts: 3, gapMs: 1 };

afterEach(() => {
  vi.useRealTimers();
});

describe("waiting out a contended job insert", () => {
  it("tries again when the insert is refused, and returns what the insert returned", async () => {
    const insert = vi
      .fn()
      .mockRejectedValueOnce(duplicateKey("jobs_only_one_running"))
      .mockRejectedValueOnce(duplicateKey("jobs_only_one_running"))
      .mockResolvedValue({ id: "spya-ok" });

    expect(await insertWhenSlotFree("writes", insert, FAST)).toEqual({ id: "spya-ok" });
    expect(insert).toHaveBeenCalledTimes(3);
  });

  it("waits for the per-article refusal, the one still raised in earnest", async () => {
    const insert = vi
      .fn()
      .mockRejectedValueOnce(duplicateKey("jobs_active_slug"))
      .mockResolvedValue({ id: "spya-ok" });

    await expect(insertWhenSlotFree("writes", insert, FAST)).resolves.toEqual({ id: "spya-ok" });
    expect(insert).toHaveBeenCalledTimes(2);
  });

  it("calls the insert afresh each time rather than retrying one value", async () => {
    /* A job wants a new id per attempt. If this ever retried a promise instead
       of the function, every attempt would carry the first attempt's id. */
    const ids: string[] = [];
    let n = 0;
    const insert = async () => {
      const id = `spya-${++n}`;
      ids.push(id);
      if (n < 3) throw duplicateKey("jobs_only_one_running");
      return id;
    };

    expect(await insertWhenSlotFree("writes", insert, FAST)).toBe("spya-3");
    expect(ids).toEqual(["spya-1", "spya-2", "spya-3"]);
  });

  it("rethrows at once when the failure is not contention", async () => {
    /* The dangerous direction: a real bug swallowed into a 20-second wait and
       then reported as a wedged row. */
    const notContention = Object.assign(new Error("null value in column violates not-null"), {
      code: "23502",
      constraint: "jobs_slug_not_null",
    });
    const insert = vi.fn().mockRejectedValue(notContention);

    await expect(insertWhenSlotFree("writes", insert, FAST)).rejects.toThrow("not-null");
    expect(insert).toHaveBeenCalledTimes(1);
  });

  it("does not retry a different unique violation that happens to be 23505", async () => {
    /* GPT Sol, 2026-08-28: the previous version of this file only ever offered
       a non-23505 code here, so a regression to "retry every duplicate key,
       whatever it is" would have stayed green. The constraint name is the whole
       decision, and this is the case that says so. */
    const other = duplicateKey("jobs_draft_revision_unique");
    const insert = vi.fn().mockRejectedValue(other);

    // `toBe`, not `toThrow`: it must come back untouched, not merely look similar.
    await expect(insertWhenSlotFree("writes", insert, FAST)).rejects.toBe(other);
    expect(insert).toHaveBeenCalledTimes(1);
  });

  it("parks on a timer between attempts rather than spinning", async () => {
    /* Without this, deleting the `setTimeout` leaves a tight retry loop that
       hammers the database and every case above still passes. */
    vi.useFakeTimers();
    const insert = vi.fn().mockRejectedValue(duplicateKey("jobs_only_one_running"));
    const settled = vi.fn();
    void insertWhenSlotFree("writes", insert, { attempts: 3, gapMs: 500 }).catch(settled);

    await vi.advanceTimersByTimeAsync(0);
    expect(insert).toHaveBeenCalledTimes(1);
    expect(settled).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(499);
    expect(insert).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(insert).toHaveBeenCalledTimes(2);
  });

  it("uses 40 attempts 500ms apart when nobody passes the seam", async () => {
    /* Every other case here passes `FAST`, so the numbers a real caller gets
       were untested: `ATTEMPTS = 1` would have left the file green. */
    vi.useFakeTimers();
    const insert = vi.fn().mockRejectedValue(duplicateKey("jobs_only_one_running"));
    const caught = vi.fn();
    void insertWhenSlotFree("writes", insert).catch(caught);

    await vi.advanceTimersByTimeAsync(39 * 500 - 1);
    expect(insert).toHaveBeenCalledTimes(39);
    expect(caught).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(insert).toHaveBeenCalledTimes(40);
    expect(caught).toHaveBeenCalledOnce();
    expect(caught.mock.calls[0]?.[0]).toMatchObject({ message: expect.stringContaining("in 20s") });
  });

  it("gives up saying a row may be wedged, because waiting cannot clear that", async () => {
    const insert = vi.fn().mockRejectedValue(duplicateKey("jobs_only_one_running"));

    await expect(insertWhenSlotFree("writes", insert, FAST)).rejects.toThrow(
      /could not start a job for "writes".*wedged/s,
    );
    expect(insert).toHaveBeenCalledTimes(3);
  });
});
