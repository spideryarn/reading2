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
  currentSpend,
  emptySpend,
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
    job: "hierarchy",
    answeredBy: "anthropic/claude-sonnet-5",
    upstreamCostNanos: 21_523_500,
    model: "anthropic/claude-sonnet-5",
    costNanos: 21_523_500,
    generationId: "gen-1787844432-JKwGQebcNXfkCfTX5mUq",
    upstream: "Anthropic",
    isByok: false,
    providerAccount: "openrouter",
    computedCostNanos: null,
    priceVersion: null,
    credentialFingerprint: "abcdef012345",
    wire: "messages",
    inputTokens: 13,
    outputTokens: 4,
    cacheReadTokens: 0,
    cacheWriteTokens: 8583,
    cacheWrite5mTokens: 8583,
    cacheWrite1hTokens: 0,
    reasoningTokens: 0,
    webSearches: null,
    serviceTier: "standard",
    inferenceGeo: null,
    ms: 1200,
    outcome: "ok",
    ...over,
  };
}

beforeEach(() => resetUnscopedCalls());

describe("collectSpend", () => {
  it("collects calls made anywhere inside it, including after an await", async () => {
    const { result, report } = await collectSpend(async () => {
      recordSpend(call({ job: "hierarchy" }));
      await Promise.resolve();
      recordSpend(call({ job: "labels" }));
      return "the answer";
    });
    expect(result).toBe("the answer");
    expect(report.calls.map((c) => c.job)).toEqual(["hierarchy", "labels"]);
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
        {
          onDone: (r) => {
            seen.push(r);
          },
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
      {
        onDone: (r) => {
          seen.push(r);
        },
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
      const id = beginSpend("hierarchy", "m");
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
    expect(spendFields(emptySpend())).toEqual({});
  });

  it("still writes a line when a call went missing and none completed", () => {
    /* **The check that used to suppress its own bug report.** The early return
       was `calls.length === 0`, which is the exact state a run that lost a
       request ends in — so the one symptom was hidden by the guard written for
       the ordinary case. Raised by a GPT Sol review. */
    const fields = spendFields({
      ...emptySpend(),
      pending: [{ job: "chat", model: "m", startedAt: 0, rowId: "r1" }],
    });
    expect(fields.aiPending).toBe(1);
    expect(fields.aiPendingJobs).toBe("chat");
  });

  it("names the two problems separately, because they are two problems", () => {
    const fields = spendFields({
      ...emptySpend(),
      calls: [call({ costNanos: 100 }), call({ costNanos: null })],
      pending: [{ job: "search", model: "m", startedAt: 0, rowId: "r1" }],
    });
    expect(fields.aiCalls).toBe(2);
    expect(fields.aiUnpriced).toBe(1);
    expect(fields.aiPending).toBe(1);
    expect(fields.aiPendingJobs).toBe("search");
  });

  it("leaves the two out when there is nothing to say", () => {
    const fields = spendFields({ ...emptySpend(), calls: [call()] });
    expect(fields).not.toHaveProperty("aiUnpriced");
    expect(fields).not.toHaveProperty("aiPending");
  });
});

describe("formatNanos", () => {
  it("reads as money", () => {
    expect(formatNanos(21_523_500)).toBe("$0.0215");
    expect(formatNanos(0)).toBe("$0.0000");
  });

  it("does not round a real cost down to nothing", () => {
    /* One query embedding is about $0.00000018 — which is the reason the column
       counts in nano-dollars, and which four decimals would print as `$0.0000`.
       Putting the lie back at the last step is worse than never having avoided
       it, because by then there is a correct number in the database to disagree
       with. Caught on a live probe. */
    expect(formatNanos(180)).toBe("$0.00000018");
    expect(formatNanos(180)).not.toBe("$0.0000");
    /* And a real zero stays short: a free call and a very cheap one are
       different things, and only one of them wants eight decimals. */
    expect(formatNanos(0)).toBe("$0.0000");
  });
});

/* ==================================================== the write to the ledger ==
   Everything above tests what the collector *reports*. These test what it
   *keeps*, which is a different question and the one a bill is made of. */

import { environmentOwnerId, runAsOwner, runInRequest, setRequestOwner } from "../src/owner.js";
import { type AiCallRow, withSpendAttribution } from "../src/ai-spend.js";

/** Swapped in by the draining test; the ordinary sinks are inline. */
let sinkGate: (row: AiCallRow) => Promise<void> = async () => undefined;

/** Record one call inside a collector with a capturing sink, and hand back the rows. */
async function rowsFrom(
  options: Parameters<typeof collectSpend>[1] = {},
  body: () => void = () => {
    const id = beginSpend("hierarchy", "anthropic/claude-sonnet-5");
    recordSpend(call(), id);
  },
): Promise<AiCallRow[]> {
  const rows: AiCallRow[] = [];
  await collectSpend(
    async () => {
      body();
    },
    {
      ...options,
      sink: async (row) => {
        rows.push(row);
      },
    },
  );
  return rows;
}

describe("the sink", () => {
  it("calls a BYOK zero a reported cost, because a zero is an answer", async () => {
    /* **The mutation that found this:** `costSourceOf` asking `if (costNanos)`
       instead of `if (costNanos !== null)` passed every test in the suite. It
       would have put `cost_source: "computed"` on a BYOK call whose credits are
       legitimately `0`, and migration 0023's CHECK then *rejects the insert* —
       so the loudest symptom of a one-character slip would be a row that never
       arrives, on exactly the traffic a per-user spend limit is made of. */
    const rows = await rowsFrom({}, () => {
      recordSpend(call({ costNanos: 0, upstreamCostNanos: 4_000, isByok: true }));
    });
    expect(rows[0]?.costSource).toBe("provider");
    expect(rows[0]?.creditsUsedNanos).toBe(0);
    expect(rows[0]?.computedCostNanos).toBeNull();
  });

  it("says a call nobody could price is `none`, not `computed`", async () => {
    const rows = await rowsFrom({}, () => {
      recordSpend(call({ costNanos: null, upstreamCostNanos: null, isByok: null }));
    });
    expect(rows[0]?.costSource).toBe("none");
  });

  it("gets one row per recorded call, with the collector's attribution on it", async () => {
    const rows = await rowsFrom({
      attribution: {
        scopeKind: "job_step",
        ownerId: "00000000-0000-4000-8000-00000000ac02",
        articleSlug: "some-article",
        jobId: "job-7",
        stepName: "hierarchy",
      },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.scopeKind).toBe("job_step");
    expect(rows[0]?.articleSlug).toBe("some-article");
    expect(rows[0]?.jobId).toBe("job-7");
    expect(rows[0]?.stepName).toBe("hierarchy");
    expect(rows[0]?.job).toBe("hierarchy");
    expect(rows[0]?.creditsUsedNanos).toBe(21_523_500);
    /* Named `credits`, not `cost`. The rename is the decision — see
       docs/plans/260827q-ai-cost-tracking.md Q5 — and a test that only checked the
       number would let it drift back to a name that promises cash. */
    expect("creditsUsedNanos" in (rows[0] ?? {})).toBe(true);
  });

  it("uses the id minted before the call, not one invented at the end", async () => {
    /* The point of minting early is that a call which never returns still has a
       name. Nothing asserts that directly — there is no row for it — so what is
       checked is that the id on the row is the one `beginSpend` reserved. */
    const rows: AiCallRow[] = [];
    let pendingId: string | undefined;
    await collectSpend(
      async () => {
        const id = beginSpend("hierarchy", "anthropic/claude-sonnet-5");
        pendingId = currentSpend()?.pending[0]?.rowId;
        recordSpend(call(), id);
      },
      {
        attribution: { scopeKind: "cli", ownerId: environmentOwnerId() },
        sink: async (row) => {
          rows.push(row);
        },
      },
    );
    expect(pendingId).toBeTruthy();
    expect(rows[0]?.id).toBe(pendingId);
  });

  it("is awaited before collectSpend returns, because Vercel freezes the process", async () => {
    /* **The failure this prevents is invisible on a laptop.** An un-awaited
       insert finishes fine here and never runs on a serverless function, whose
       instance can be frozen the moment the response goes out — so the rows
       that go missing are exactly the request-path ones. */
    let settled = false;
    await collectSpend(
      async () => {
        const id = beginSpend("hierarchy", "m");
        recordSpend(call(), id);
      },
      {
        attribution: { scopeKind: "request", ownerId: environmentOwnerId() },
        sink: async () => {
          await new Promise((r) => setTimeout(r, 20));
          settled = true;
        },
      },
    );
    expect(settled).toBe(true);
  });

  it("does not let a failing sink fail the work — a metrics write is not the feature", async () => {
    const { result } = await collectSpend(
      async () => {
        const id = beginSpend("hierarchy", "m");
        recordSpend(call(), id);
        return "the answer";
      },
      {
        attribution: { scopeKind: "cli", ownerId: environmentOwnerId() },
        sink: async () => {
          throw new Error("the database is on fire");
        },
      },
    );
    expect(result).toBe("the answer");
  });

  it("writes nothing for a call that finished after its collector reported", async () => {
    /* A late call is already counted and logged. Writing it would be worse than
       dropping it: the row would land under a run that had already reported a
       total without it, so two records of the same work would disagree. */
    const rows: AiCallRow[] = [];
    let release: (() => void) | undefined;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    /* **A continuation started inside the scope, not a callback invoked from
       outside it.** That distinction is the test: a function called after
       `collectSpend` returns runs with no scope at all and is counted as
       *unscoped*, which is a different bug. `gate.then` captures the context, so
       what arrives here is genuinely a call that finished late. */
    let finishing: Promise<void> | undefined;
    await collectSpend(
      async () => {
        const id = beginSpend("hierarchy", "m");
        finishing = gate.then(() => {
          recordSpend(call(), id);
        });
      },
      {
        attribution: { scopeKind: "cli", ownerId: environmentOwnerId() },
        sink: async (row) => {
          rows.push(row);
        },
      },
    );
    release?.();
    await finishing;
    expect(rows).toEqual([]);
    expect(lateCalls()).toBe(1);
  });

  it("writes no row when there is no owner to bill", async () => {
    /* `owner_id` is `not null` and `on delete restrict`, so there is no honest
       row for a call whose owner cannot be named. A request that reached a model
       before it was authenticated is the shape that gets here. */
    const rows: AiCallRow[] = [];
    await runInRequest(() =>
      collectSpend(
        async () => {
          const id = beginSpend("chat", "m");
          recordSpend(call({ job: "chat" }), id);
        },
        {
          attribution: { scopeKind: "request" },
          sink: async (row) => {
            rows.push(row);
          },
        },
      ),
    );
    expect(rows).toEqual([]);
  });

  it("takes the owner from the request when the collector opened before the gate ran", async () => {
    /* `handleApi` opens the collector outside the gate, deliberately — so at
       that instant nobody knows who is asking, and the owner has to be resolved
       when the call is recorded rather than when the box was opened. */
    const rows: AiCallRow[] = [];
    const alice = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    await runInRequest(() =>
      collectSpend(
        async () => {
          setRequestOwner(alice as ReturnType<typeof environmentOwnerId>);
          const id = beginSpend("chat", "m");
          recordSpend(call({ job: "chat" }), id);
        },
        {
          attribution: { scopeKind: "request" },
          sink: async (row) => {
            rows.push(row);
          },
        },
      ),
    );
    expect(rows[0]?.ownerId).toBe(alice);
  });
});

describe("closing the box", () => {
  it("does not accept a call that finishes while an earlier sink is still draining", async () => {
    /* **The race a GPT Sol review drove directly.** The first version awaited
       the writes and *then* set `closed`, which looks like the careful order and
       is not: a call finishing during that wait was still accepted, appended a
       new promise, and `Promise.allSettled` had already captured its iterable —
       so `collectSpend` returned with that write unsettled, and on Vercel the
       row disappears.

       Closed first, the second call is a *late* one: no row, a warn line, and
       `lateCalls()`. Which is the honest answer, because the report has already
       been taken and a row written now would belong to a total published without
       it. */
    const rows: AiCallRow[] = [];
    let releaseFirstSink: (() => void) | undefined;
    let sinkAStarted: (() => void) | undefined;
    const firstSinkStarted = new Promise<void>((r) => {
      sinkAStarted = r;
    });
    let n = 0;
    sinkGate = async (row) => {
      n += 1;
      if (n === 1) {
        sinkAStarted?.();
        await new Promise<void>((r) => {
          releaseFirstSink = r;
        });
      }
      rows.push(row);
    };

    /* The second call's finish is a *continuation started inside the scope*, so
       it keeps the async context — a callback invoked from out here would have
       no scope at all and be counted as unscoped, which is a different bug. */
    let fireSecond: (() => void) | undefined;
    const gate = new Promise<void>((r) => {
      fireSecond = r;
    });

    const collecting = collectSpend(
      async () => {
        const idB = beginSpend("arc", "m");
        void gate.then(() => {
          recordSpend(call({ job: "arc" }), idB);
        });
        /* This one's sink blocks, so `collectSpend` is inside its drain when the
           second call finishes. `fn` itself returns straight away. */
        recordSpend(call(), beginSpend("hierarchy", "m"));
      },
      {
        attribution: { scopeKind: "cli", ownerId: environmentOwnerId() },
        sink: (row) => sinkGate(row),
      },
    );

    await firstSinkStarted;
    fireSecond?.();
    await new Promise((r) => setTimeout(r, 0));
    releaseFirstSink?.();
    await collecting;

    /* One row, and the second call accounted for rather than lost. */
    expect(rows).toHaveLength(1);
    expect(rows[0]?.job).toBe("hierarchy");
    expect(lateCalls()).toBeGreaterThanOrEqual(1);
  });
});

describe("withSpendAttribution", () => {
  it("adds the article without starting a second collector", async () => {
    /* A nested `collectSpend` would hide these calls from the outer one, and the
       request's own log line would then report a cost of zero for a request that
       spent money. Same box, different view of it. */
    const rows: AiCallRow[] = [];
    const { report } = await collectSpend(
      async () => {
        await withSpendAttribution({ articleSlug: "on-writing" }, async () => {
          const id = beginSpend("chat", "m");
          recordSpend(call({ job: "chat" }), id);
        });
      },
      {
        attribution: { scopeKind: "request", ownerId: environmentOwnerId() },
        sink: async (row) => {
          rows.push(row);
        },
      },
    );
    expect(rows[0]?.articleSlug).toBe("on-writing");
    expect(rows[0]?.scopeKind).toBe("request");
    /* The outer report sees it too — which is the half a nested collector loses. */
    expect(report.calls).toHaveLength(1);
  });

  it("does not leak the article to a sibling branch", async () => {
    const rows: AiCallRow[] = [];
    await collectSpend(
      async () => {
        await withSpendAttribution({ articleSlug: "one" }, async () => {
          recordSpend(call({ job: "chat" }), beginSpend("chat", "m"));
        });
        recordSpend(call({ job: "dictation" }), beginSpend("dictation", "m"));
      },
      {
        attribution: { scopeKind: "request", ownerId: environmentOwnerId() },
        sink: async (row) => {
          rows.push(row);
        },
      },
    );
    expect(rows.map((r) => r.articleSlug)).toEqual(["one", null]);
  });

  it("is a no-op outside a collector, like everything else here", async () => {
    let ran = false;
    withSpendAttribution({ articleSlug: "x" }, () => {
      ran = true;
    });
    expect(ran).toBe(true);
  });
});

describe("a run id", () => {
  it("is on the report and on every row it produced, so the two can be joined", async () => {
    const rows: AiCallRow[] = [];
    const { report } = await collectSpend(
      async () => {
        recordSpend(call(), beginSpend("hierarchy", "m"));
        recordSpend(call({ job: "arc" }), beginSpend("arc", "m"));
      },
      {
        attribution: { scopeKind: "cli", ownerId: environmentOwnerId() },
        sink: async (row) => {
          rows.push(row);
        },
      },
    );
    expect(report.runId).toBeTruthy();
    expect(rows.map((r) => r.runId)).toEqual([report.runId, report.runId]);
    expect(spendFields(report).aiRunId).toBe(report.runId);
  });

  it("is different for two pieces of work, so their rows do not merge", async () => {
    const one = await rowsFrom({ attribution: { scopeKind: "cli", ownerId: environmentOwnerId() } });
    const two = await rowsFrom({ attribution: { scopeKind: "cli", ownerId: environmentOwnerId() } });
    expect(one[0]?.runId).not.toBe(two[0]?.runId);
  });
});

describe("keyFingerprint", () => {
  it("names a key without carrying it", async () => {
    const { keyFingerprint } = await import("../src/ai-spend.js");
    const fp = keyFingerprint("sk-or-v1-something-secret");
    expect(fp).toHaveLength(12);
    expect(fp).toMatch(/^[0-9a-f]{12}$/);
    expect("sk-or-v1-something-secret").not.toContain(fp);
    /* Two keys, two names — otherwise the per-key reconciliation is meaningless. */
    expect(keyFingerprint("sk-or-v1-another")).not.toBe(fp);
  });
});

/* `runAsOwner` is imported so a reader can see the pipeline's case is covered
   by `attribution.ownerId` rather than by ambient state. */
void runAsOwner;
