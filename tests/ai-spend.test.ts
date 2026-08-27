/**
 * The ambient spend collector — [`src/ai-spend.ts`](../src/ai-spend.ts).
 *
 * Two things are worth pinning here and the rest is bookkeeping.
 *
 * **A call made with no collector open must not fail, and must not vanish
 * without trace.** Both halves matter: failing would break every CLI run and
 * every test that reaches a model, and vanishing silently is how a cost table
 * ends up plausible and short. `unscopedCalls()` is the compromise, and it is
 * only worth anything if something counts it.
 *
 * **A total must carry its own caveat.** `totalSpend` returns `unpriced`
 * alongside `nanos` so a report cannot present "$0.30" when three of the nine
 * calls in it reported nothing at all.
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  collectSpend,
  collectingSpend,
  formatNanos,
  recordSpend,
  resetUnscopedCalls,
  type SpendRecord,
  totalSpend,
  unscopedCalls,
} from "../src/ai-spend.js";

/** A plausible finished call. Override whatever the test is about. */
function call(over: Partial<SpendRecord> = {}): SpendRecord {
  return {
    task: "toc",
    model: "anthropic/claude-sonnet-5",
    costNanos: 21_523_500,
    generationId: "gen-1787844432-JKwGQebcNXfkCfTX5mUq",
    upstream: "Anthropic",
    isByok: false,
    inputTokens: 13,
    outputTokens: 4,
    cacheReadTokens: 0,
    cacheWriteTokens: 8583,
    ms: 1200,
    outcome: "ok",
    ...over,
  };
}

beforeEach(() => resetUnscopedCalls());

describe("collectSpend", () => {
  it("collects calls made anywhere inside it, including after an await", async () => {
    const { result, calls } = await collectSpend(async () => {
      recordSpend(call({ task: "toc" }));
      await Promise.resolve();
      recordSpend(call({ task: "labels" }));
      return "the answer";
    });
    expect(result).toBe("the answer");
    expect(calls.map((c) => c.task)).toEqual(["toc", "labels"]);
  });

  it("gives each piece of work its own box, so two runs cannot bill each other", async () => {
    const [a, b] = await Promise.all([
      collectSpend(async () => {
        recordSpend(call({ task: "arc" }));
        await new Promise((r) => setTimeout(r, 5));
        recordSpend(call({ task: "arc" }));
        return null;
      }),
      collectSpend(async () => {
        recordSpend(call({ task: "ideas" }));
        return null;
      }),
    ]);
    /* Overlapping in time and interleaved across an await. If the store used
       `enterWith` rather than `run`, these two would share an array. */
    expect(a.calls.map((c) => c.task)).toEqual(["arc", "arc"]);
    expect(b.calls.map((c) => c.task)).toEqual(["ideas"]);
  });

  it("knows whether anybody is keeping accounts", async () => {
    expect(collectingSpend()).toBe(false);
    await collectSpend(async () => {
      expect(collectingSpend()).toBe(true);
    });
    expect(collectingSpend()).toBe(false);
  });

  it("hands back what a failed run spent, which the resolved value never can", async () => {
    /* The case `onDone` exists for. A stage that throws has usually already
       paid for the call that threw, and a retry pays again — so losing the
       record here understates the bill exactly when it matters most. */
    /* An array pushed into rather than a `let` assigned in the callback:
       TypeScript's control-flow analysis does not follow an assignment made
       inside a callback, so a `let seen = null` reads as `never` afterwards and
       the file fails `npm run typecheck` while vitest — which transpiles
       without typechecking — stays green. Found by a GPT Sol review. */
    const seen: (readonly SpendRecord[])[] = [];
    await expect(
      collectSpend(
        async () => {
          recordSpend(call({ outcome: "error", costNanos: 4_200_000 }));
          throw new Error("stage blew up");
        },
        (calls) => {
          seen.push(calls);
        },
      ),
    ).rejects.toThrow("stage blew up");

    expect(seen).toHaveLength(1);
    expect(seen[0]).toHaveLength(1);
    expect(seen[0]?.[0]?.costNanos).toBe(4_200_000);
    expect(seen[0]?.[0]?.outcome).toBe("error");
    /* And the box is shut again, so the next piece of work starts clean. */
    expect(collectingSpend()).toBe(false);
  });

  it("fires onDone on the happy path too, with the same records", async () => {
    const seen: (readonly SpendRecord[])[] = [];
    const { calls } = await collectSpend(
      async () => {
        recordSpend(call({ task: "arc" }));
      },
      (c) => {
        seen.push(c);
      },
    );
    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual(calls);
  });
});

describe("recording with nobody listening", () => {
  it("does not throw — a CLI run is an ordinary thing", () => {
    expect(() => recordSpend(call())).not.toThrow();
  });

  it("counts what it dropped, so a report can admit the total is short", () => {
    recordSpend(call());
    recordSpend(call());
    expect(unscopedCalls()).toBe(2);
  });

  it("does not count calls that were collected", async () => {
    await collectSpend(async () => {
      recordSpend(call());
      recordSpend(call());
    });
    expect(unscopedCalls()).toBe(0);
  });
});

describe("totalSpend", () => {
  it("adds up what it can", () => {
    const { nanos, unpriced } = totalSpend([call({ costNanos: 100 }), call({ costNanos: 250 })]);
    expect(nanos).toBe(350);
    expect(unpriced).toBe(0);
  });

  it("counts the calls it could not price rather than treating them as free", () => {
    /* The distinction the whole return shape exists for: this is $0.0000001
       across three calls, one of which reported nothing — not across three
       calls that agreed. */
    const { nanos, unpriced } = totalSpend([
      call({ costNanos: 100 }),
      call({ costNanos: null }),
      call({ costNanos: null }),
    ]);
    expect(nanos).toBe(100);
    expect(unpriced).toBe(2);
  });

  it("is zero and honest about it for an empty run", () => {
    expect(totalSpend([])).toEqual({ nanos: 0, unpriced: 0 });
  });

  it("sums in integers, so a long run does not drift", () => {
    /* Nano-dollars in a plain number rather than dollars in a float: 10,000
       calls at $0.0000001 each is exactly $0.001, not 0.0009999999999. */
    const many = Array.from({ length: 10_000 }, () => call({ costNanos: 100 }));
    expect(totalSpend(many).nanos).toBe(1_000_000);
  });
});

describe("formatNanos", () => {
  it("reads as money", () => {
    expect(formatNanos(21_523_500)).toBe("$0.0215");
    expect(formatNanos(0)).toBe("$0.0000");
  });
});
