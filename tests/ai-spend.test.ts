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
  type SpendReport,
  beginSpend,
  collectSpend,
  collectingSpend,
  formatNanos,
  recordSpend,
  lateCalls,
  resetUnscopedCalls,
  spendFields,
  type SpendRecord,
  totalSpend,
  unscopedCalls,
} from "../src/ai-spend.js";

/** A plausible finished call. Override whatever the test is about. */
function call(over: Partial<SpendRecord> = {}): SpendRecord {
  return {
    job: "toc",
    answeredBy: "anthropic/claude-sonnet-5",
    upstreamCostNanos: 21_523_500,
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
    const { result, report } = await collectSpend(async () => {
      recordSpend(call({ job: "toc" }));
      await Promise.resolve();
      recordSpend(call({ job: "labels" }));
      return "the answer";
    });
    expect(result).toBe("the answer");
    expect(report.calls.map((c) => c.job)).toEqual(["toc", "labels"]);
  });

  it("gives each piece of work its own box, so two runs cannot bill each other", async () => {
    const [a, b] = await Promise.all([
      collectSpend(async () => {
        recordSpend(call({ job: "arc" }));
        await new Promise((r) => setTimeout(r, 5));
        recordSpend(call({ job: "arc" }));
        return null;
      }),
      collectSpend(async () => {
        recordSpend(call({ job: "ideas" }));
        return null;
      }),
    ]);
    /* Overlapping in time and interleaved across an await. If the store used
       `enterWith` rather than `run`, these two would share an array. */
    expect(a.report.calls.map((c) => c.job)).toEqual(["arc", "arc"]);
    expect(b.report.calls.map((c) => c.job)).toEqual(["ideas"]);
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
    const seen: SpendReport[] = [];
    await expect(
      collectSpend(
        async () => {
          recordSpend(call({ outcome: "error", costNanos: 4_200_000 }));
          throw new Error("stage blew up");
        },
        (r) => {
          seen.push(r);
        },
      ),
    ).rejects.toThrow("stage blew up");

    expect(seen).toHaveLength(1);
    expect(seen[0]?.calls).toHaveLength(1);
    expect(seen[0]?.calls[0]?.costNanos).toBe(4_200_000);
    expect(seen[0]?.calls[0]?.outcome).toBe("error");
    /* And the box is shut again, so the next piece of work starts clean. */
    expect(collectingSpend()).toBe(false);
  });

  it("fires onDone on the happy path too, with the same records", async () => {
    const seen: SpendReport[] = [];
    const { report } = await collectSpend(
      async () => {
        recordSpend(call({ job: "arc" }));
      },
      (r) => {
        seen.push(r);
      },
    );
    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual(report);
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

describe("a call that was started and never recorded", () => {
  it("is reported as pending, with the job that lost it", async () => {
    /* The failure this whole design can still have, and the reason `beginSpend`
       is called before a byte goes over the wire rather than after the answer
       comes back. A caller that starts a request and drops it produces a
       working feature and a short bill; this is the only trace of that. */
    const { report } = await collectSpend(async () => {
      beginSpend("chat", "anthropic/claude-sonnet-5");
      recordSpend(call({ job: "explain" }), beginSpend("explain", "m"));
    });
    expect(report.calls.map((c) => c.job)).toEqual(["explain"]);
    expect(report.pending.map((p) => p.job)).toEqual(["chat"]);
  });

  it("is not counted as pending once it has been recorded", async () => {
    const { report } = await collectSpend(async () => {
      const id = beginSpend("toc", "m");
      recordSpend(call(), id);
    });
    expect(report.pending).toEqual([]);
  });

  it("counts a finish that arrives after its collector has reported", async () => {
    /* A record whose cost is real and is in no total anywhere. It happens when a
       piece of work reports and then something it launched finishes afterwards —
       a streamed route returning before its generator is drained, say.

       **It cannot be on the report**, which is the whole reason `lateCalls()` is
       process-wide: by definition this arrives after the report was taken. The
       first draft put a `late` field on `SpendReport` and then discovered there
       was no moment at which it could be anything but zero — a counter nobody
       could read, which is the failure this module is otherwise built against.

       The `.then` is what makes the context right. An arrow function called from
       a later scope runs in *that* scope; a continuation chained inside this one
       carries this one's context with it, closed or not. */
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let dangling: Promise<void> | null = null;
    const { report } = await collectSpend(async () => {
      const id = beginSpend("chat", "m");
      dangling = gate.then(() => recordSpend(call({ job: "chat" }), id));
    });
    /* Reported while still in flight — which is the pending case, correctly. */
    expect(report.pending.map((p) => p.job)).toEqual(["chat"]);
    expect(lateCalls()).toBe(0);

    release();
    await dangling;
    expect(lateCalls()).toBe(1);
    /* And it did not fall on the floor instead, which is a different fault with
       a different counter. */
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

  it("does not treat a BYOK zero as free money", async () => {
    /* **The bug this whole pair of fields exists to prevent, and which the
       first version of `totalSpend` had anyway.** Under BYOK `usage.cost` is
       legitimately `0` — OpenRouter charged nothing, the upstream billed
       somebody else's key — so summing `costNanos` alone gives `$0.0000` with
       `unpriced: 0`, a total that looks measured and correct while missing real
       money. `isByok` was recorded to tell that zero from a free call, and then
       nothing read it. Found by a GPT Sol review of the code, after an earlier
       review had asked for the field. */
    const { nanos, unpriced } = totalSpend([
      call({ costNanos: 0, upstreamCostNanos: 4_000, isByok: true }),
      call({ costNanos: 100, upstreamCostNanos: 100, isByok: false }),
    ]);
    expect(nanos).toBe(4_100);
    expect(unpriced).toBe(0);
  });

  it("counts a BYOK call with no upstream figure as unpriced, not as free", () => {
    /* The same understatement one level down: falling back to `costNanos` — a
       legitimate `0` under BYOK — would report *zero* where the honest answer is
       *unknown*. */
    const { nanos, unpriced } = totalSpend([
      call({ costNanos: 0, upstreamCostNanos: null, isByok: true }),
    ]);
    expect(nanos).toBe(0);
    expect(unpriced).toBe(1);
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

describe("spendFields", () => {
  it("says nothing at all about a piece of work that called no model", () => {
    expect(spendFields({ calls: [], pending: [] })).toEqual({});
  });

  it("still writes a line when a call went missing and none completed", () => {
    /* **The check that used to suppress its own bug report.** The early return
       was `calls.length === 0`, which is the exact state a run that lost a
       request ends in — so the one symptom was hidden by the guard written for
       the ordinary case. Raised by a GPT Sol review. */
    const fields = spendFields({
      calls: [],
      pending: [{ job: "chat", model: "m", startedAt: 0 }],
    });
    expect(fields.aiPending).toBe(1);
    expect(fields.aiPendingJobs).toBe("chat");
  });

  it("names the two problems separately, because they are two problems", () => {
    const fields = spendFields({
      calls: [call({ costNanos: 100 }), call({ costNanos: null })],
      pending: [{ job: "search", model: "m", startedAt: 0 }],
    });
    expect(fields.aiCalls).toBe(2);
    expect(fields.aiUnpriced).toBe(1);
    expect(fields.aiPending).toBe(1);
    expect(fields.aiPendingJobs).toBe("search");
  });

  it("leaves the two out when there is nothing to say", () => {
    const fields = spendFields({ calls: [call()], pending: [] });
    expect(fields).not.toHaveProperty("aiUnpriced");
    expect(fields).not.toHaveProperty("aiPending");
  });
});

describe("formatNanos", () => {
  it("reads as money", () => {
    expect(formatNanos(21_523_500)).toBe("$0.0215");
    expect(formatNanos(0)).toBe("$0.0000");
  });
});
