/**
 * **The declared bypass** — the one way a call is allowed to skip both gateways
 * and still appear in `npm run cost`.
 *
 * What is worth testing here is not that a happy call produces a row. It is the
 * four ways this could quietly under-report, each of which was a real design
 * choice argued out with GPT Sol on 2026-08-28:
 *
 * 1. a call that **throws** must still leave a row, or a run of failures reads
 *    as a run of free calls;
 * 2. a call that reports **no usage** must be `cost_source: "none"`, never `0` —
 *    an unknown price and a free call are different facts;
 * 3. **retries** must not hide behind one row, because a bare Anthropic client
 *    makes up to three billable attempts by default;
 * 4. a `fetch` **outside** a declaration must not run at all.
 *
 * See docs/plans/ai-spend-outside-the-gateway.md.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { type AiCallRow, collectSpend } from "../src/ai-spend.js";
import {
  declaredFetch,
  withDeclaredExternalCall,
} from "../evals/declared-spend.js";
import { DECLARATIONS, declarationFor } from "../src/spend-declarations.js";

/* A real declared id, so the test cannot drift from the register. */
const METERED = DECLARATIONS.find((d) => d.metered)?.id ?? "";
const UNMETERED = DECLARATIONS.find((d) => !d.metered)?.id ?? "";

/** Sonnet 5's usage, in the shape the Anthropic SDK hands back. */
const USAGE = { input_tokens: 1_000, output_tokens: 100 };

async function rowsFrom(fn: () => Promise<unknown>): Promise<AiCallRow[]> {
  const rows: AiCallRow[] = [];
  await collectSpend(fn, {
    attribution: { scopeKind: "eval", ownerId: "00000000-0000-4000-8000-00000000d001" },
    sink: async (row) => {
      rows.push(row);
    },
  }).catch(() => undefined);
  return rows;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the register", () => {
  it("refuses an id nobody declared", () => {
    expect(() => declarationFor("no-such-bypass")).toThrow(/not a declared bypass/);
  });

  it("refuses an id that is declared but not yet metered", () => {
    /* The whole point of the `metered: false` rows is that they are named and
       *not* wired. Letting one through this wrapper would mean the report
       listing it as uncounted while it was quietly writing rows. */
    expect(() => declarationFor(UNMETERED)).toThrow(/not metered/);
  });
});

describe("withDeclaredExternalCall", () => {
  it("prices an Anthropic call from the table, and says the figure is ours", async () => {
    const rows = await rowsFrom(() =>
      withDeclaredExternalCall(METERED, { model: "claude-sonnet-5" }, async ({ observe }) => {
        observe.anthropic({ usage: USAGE, model: "claude-sonnet-5" });
        return "done";
      }),
    );

    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.costSource).toBe("computed");
    /* Not in `credits_used_nanos`, which means one specific thing — what
       OpenRouter deducted — and this call never went near OpenRouter. */
    expect(row.creditsUsedNanos).toBeNull();
    expect(row.computedCostNanos).toBeGreaterThan(0);
    expect(row.priceVersion).toMatch(/claude-sonnet-5@\d{4}-\d{2}-\d{2}/);
    expect(row.providerAccount).toBe("anthropic");
    expect(row.scopeKind).toBe("eval");
    /* The declaration id travels on the row, so a surprising number leads back
       to the reason the call was allowed to skip the gateway. */
    expect(row.stepName).toBe(METERED);
    expect(row.outcome).toBe("ok");
    expect(row.reportedInputTokens).toBe(1_000);
  });

  it("writes a row when the call throws, and does not call it free", async () => {
    const rows = await rowsFrom(() =>
      withDeclaredExternalCall(METERED, { model: "claude-sonnet-5" }, async () => {
        throw new Error("upstream said no");
      }),
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]?.outcome).toBe("error");
    /* **`none`, not a zero.** The money may well have been spent — an aborted
       or refused call is still billed for what it produced — and the report
       says the total is short by an unknown amount rather than adding nothing. */
    expect(rows[0]?.costSource).toBe("none");
    expect(rows[0]?.computedCostNanos).toBeNull();
    expect(rows[0]?.creditsUsedNanos).toBeNull();
  });

  it("lets the caller's error through rather than replacing it", async () => {
    /* The retry check used to live in the `finally`, where a `throw` silently
       replaced whatever the body threw — so a genuine provider failure came
       back as a lecture about retries and the row was never written at all. */
    await expect(
      collectSpend(
        () =>
          withDeclaredExternalCall(METERED, { model: "claude-sonnet-5" }, async () => {
            throw new Error("upstream said no");
          }),
        {
          attribution: { scopeKind: "eval", ownerId: "00000000-0000-4000-8000-00000000d001" },
          sink: async () => undefined,
        },
      ),
    ).rejects.toThrow("upstream said no");
  });

  it("takes OpenRouter's own figure when there is one, and never both", async () => {
    const or = DECLARATIONS.find((d) => d.metered && d.account === "openrouter");
    expect(or, "there should be at least one metered OpenRouter bypass").toBeDefined();
    const rows = await rowsFrom(() =>
      withDeclaredExternalCall(or!.id, { model: "google/gemini-3.7-flash" }, async ({ observe }) => {
        observe.openRouter({
          usage: { prompt_tokens: 900, completion_tokens: 12, cost: 0.000_18 },
          model: "google/gemini-3.7-flash",
          provider: "Google",
        });
      }),
    );

    expect(rows[0]?.costSource).toBe("provider");
    expect(rows[0]?.creditsUsedNanos).toBe(180_000);
    expect(rows[0]?.computedCostNanos).toBeNull();
    expect(rows[0]?.providerAccount).toBe("openrouter");
    expect(rows[0]?.upstream).toBe("Google");
  });

  it("refuses to report one row for two HTTP attempts", async () => {
    /* The bug this exists for: a default Anthropic client retries twice, so one
       `messages.create` can be three billable requests and one row. */
    vi.stubGlobal("fetch", async () => new Response("{}", { status: 200 }));
    await expect(
      collectSpend(
        () =>
          withDeclaredExternalCall(METERED, { model: "claude-sonnet-5" }, async () => {
            await declaredFetch("https://example.test/one");
            await declaredFetch("https://example.test/two");
          }),
        {
          attribution: { scopeKind: "eval", ownerId: "00000000-0000-4000-8000-00000000d001" },
          sink: async () => undefined,
        },
      ),
    ).rejects.toThrow(/2 HTTP attempts/);
  });

  it("still writes the row before complaining about the attempts", async () => {
    vi.stubGlobal("fetch", async () => new Response("{}", { status: 200 }));
    const rows = await rowsFrom(() =>
      withDeclaredExternalCall(METERED, { model: "claude-sonnet-5" }, async ({ observe }) => {
        await declaredFetch("https://example.test/one");
        await declaredFetch("https://example.test/two");
        observe.anthropic({ usage: USAGE, model: "claude-sonnet-5" });
      }),
    );
    /* The money was spent twice over. Refusing to record it as well would be
       the worst of both. */
    expect(rows).toHaveLength(1);
  });
});

describe("a retried call", () => {
  it("records no amount at all, rather than one attempt's", async () => {
    /* Row-versus-no-row was a false choice, which is GPT Sol's phrase and it is
       right: the money was spent about N times over, so the honest row says the
       call happened and that we cannot say what it cost. The report then counts
       it under "short by an unknown amount". */
    vi.stubGlobal("fetch", async () => new Response("{}", { status: 200 }));
    const rows = await rowsFrom(() =>
      withDeclaredExternalCall(METERED, { model: "claude-sonnet-5" }, async ({ observe }) => {
        await declaredFetch("https://example.test/one");
        await declaredFetch("https://example.test/two");
        observe.anthropic({ usage: USAGE, model: "claude-sonnet-5" });
      }),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.outcome).toBe("error");
    expect(rows[0]?.costSource).toBe("none");
    expect(rows[0]?.computedCostNanos).toBeNull();
  });

  it("keeps the body's own error rather than replacing it with the retry one", async () => {
    /* The flag that decides this was never assigned for a while — the edit that
       added it had an anchor that had already moved, and a `replace` matching
       nothing says nothing. GPT Sol read the file and found it. */
    vi.stubGlobal("fetch", async () => new Response("{}", { status: 200 }));
    await expect(
      collectSpend(
        () =>
          withDeclaredExternalCall(METERED, { model: "claude-sonnet-5" }, async () => {
            await declaredFetch("https://example.test/one");
            await declaredFetch("https://example.test/two");
            throw new Error("upstream said no");
          }),
        {
          attribution: { scopeKind: "eval", ownerId: "00000000-0000-4000-8000-00000000d001" },
          sink: async () => undefined,
        },
      ),
    ).rejects.toThrow("upstream said no");
  });
});

describe("the guard against spending into nothing", () => {
  it("refuses to make the call when no ledger is open at all", async () => {
    await expect(
      withDeclaredExternalCall(METERED, { model: "claude-sonnet-5" }, async () => "never"),
    ).rejects.toThrow(/no ledger open/);
  });

  it("refuses a collector that reports but never writes", async () => {
    /* **The failure GPT Sol drove**, and the reason `collectingSpend()` is not
       the right question: a collector with no sink hands its calls to whoever
       opened it and writes nothing durable. A bypass is only permitted at all
       because it still writes a row, so running inside one of those is the one
       thing it must not quietly do. */
    let ran = false;
    await expect(
      collectSpend(
        () =>
          withDeclaredExternalCall(METERED, { model: "claude-sonnet-5" }, async () => {
            ran = true;
            return "x";
          }),
        { attribution: { scopeKind: "eval", ownerId: "00000000-0000-4000-8000-00000000d001" } },
      ),
    ).rejects.toThrow(/no ledger open/);
    expect(ran, "the body must not have run — the money is not spent").toBe(false);
  });
});

describe("the observer", () => {
  it("refuses the wrong provider's observer for the declaration", async () => {
    /* One accepted row saying `provider_account=anthropic, cost_source=provider`
       — a settled OpenRouter figure attributed to a bill that never saw it.
       GPT Sol produced exactly that against the first version. */
    const anth = DECLARATIONS.find((d) => d.metered && d.account === "anthropic")!;
    await expect(
      collectSpend(
        () =>
          withDeclaredExternalCall(anth.id, { model: "claude-sonnet-5" }, async ({ observe }) => {
            observe.openRouter({ usage: { cost: 0.5 } });
          }),
        {
          attribution: { scopeKind: "eval", ownerId: "00000000-0000-4000-8000-00000000d001" },
          sink: async () => undefined,
        },
      ),
    ).rejects.toThrow(/not the observer for it/);
  });

  it("refuses a second observation rather than keeping the last one", async () => {
    await expect(
      collectSpend(
        () =>
          withDeclaredExternalCall(METERED, { model: "claude-sonnet-5" }, async ({ observe }) => {
            observe.anthropic({ usage: USAGE, model: "claude-sonnet-5" });
            observe.anthropic({ usage: USAGE, model: "claude-sonnet-5" });
          }),
        {
          attribution: { scopeKind: "eval", ownerId: "00000000-0000-4000-8000-00000000d001" },
          sink: async () => undefined,
        },
      ),
    ).rejects.toThrow(/observed its usage twice/);
  });

  it("keeps the cache split and the service tier, which pricing does not read", async () => {
    const rows = await rowsFrom(() =>
      withDeclaredExternalCall(METERED, { model: "claude-sonnet-5" }, async ({ observe }) => {
        observe.anthropic({
          model: "claude-sonnet-5",
          usage: {
            input_tokens: 10,
            output_tokens: 2,
            cache_creation_input_tokens: 90,
            cache_creation: { ephemeral_5m_input_tokens: 60, ephemeral_1h_input_tokens: 30 },
            service_tier: "standard",
            server_tool_use: { web_search_requests: 2 },
            inference_geo: "us",
            output_tokens_details: { thinking_tokens: 40 },
          },
        });
      }),
    );
    /* A 1-hour write costs 1.6x a 5-minute one, so one total will not do. */
    expect(rows[0]?.cacheWrite5mTokens).toBe(60);
    expect(rows[0]?.cacheWrite1hTokens).toBe(30);
    expect(rows[0]?.serviceTier).toBe("standard");
    expect(rows[0]?.webSearches).toBe(2);
    /* **`inference_geo` matters to the money**: US inference is priced above the
       standard rate, so on a US call the computed figure is a floor. The
       multiplier is not applied; this column is what makes those calls findable.
       Both this and the thinking tokens were written as `null` for a while by an
       edit that silently matched nothing — hence the assertions. */
    expect(rows[0]?.inferenceGeo).toBe("us");
    expect(rows[0]?.reasoningTokens).toBe(40);
  });
});

/**
 * **The Messages shape, billed by OpenRouter — which is two facts, not one.**
 *
 * `account` says who billed us and picks the authoritative cost figure; `wire`
 * says what shape the usage arrived in. Collapsing them is what the observer pair
 * did until 2026-08-31: a bypass speaking Anthropic's Messages shape *to
 * OpenRouter* had only `observe.openRouter` available, whose body type has
 * nowhere to put a cache split, a thinking count, a service tier or an inference
 * geography — so the row carried the right money and had quietly stopped saying
 * anything else. GPT Sol found it in review of the judge migration; both
 * Messages-wire bypasses (`evals/embedding-retrieval.ts`,
 * `evals/toc-structure/model-arms.ts`) were doing it.
 */
describe("the Messages wire through OpenRouter", () => {
  const messagesViaOr = DECLARATIONS.find(
    (d) => d.metered && d.account === "openrouter" && d.wire === "messages",
  );
  const chatViaOr = DECLARATIONS.find(
    (d) => d.metered && d.account === "openrouter" && d.wire === "chat",
  );

  it("has a metered declaration of each wire to test against", () => {
    /* Not decoration: these are found from the register rather than named, so a
       `?.` below would otherwise skip the whole block in silence the day the
       register changes shape. */
    expect(messagesViaOr).toBeDefined();
    expect(chatViaOr).toBeDefined();
  });

  it("keeps OpenRouter's settled cost AND the Anthropic-shaped token detail", async () => {
    const rows = await rowsFrom(() =>
      withDeclaredExternalCall(
        messagesViaOr!.id,
        { model: "anthropic/claude-sonnet-5" },
        async ({ observe }) => {
          observe.messagesViaOpenRouter(
            {
              model: "anthropic/claude-sonnet-5",
              usage: {
                input_tokens: 40,
                output_tokens: 600,
                cache_read_input_tokens: 13_863,
                cache_creation_input_tokens: 90,
                cache_creation: { ephemeral_5m_input_tokens: 60, ephemeral_1h_input_tokens: 30 },
                service_tier: "standard",
                inference_geo: "us",
                output_tokens_details: { thinking_tokens: 128 },
              },
            },
            { costUsd: 0.002_838_6, upstream: "Anthropic" },
          );
        },
      ),
    );

    /* The money is OpenRouter's own, so nothing of ours may sit beside it. */
    expect(rows[0]?.costSource).toBe("provider");
    expect(rows[0]?.creditsUsedNanos).toBe(2_838_600);
    expect(rows[0]?.computedCostNanos).toBeNull();
    expect(rows[0]?.priceVersion).toBeNull();
    expect(rows[0]?.providerAccount).toBe("openrouter");
    expect(rows[0]?.upstream).toBe("Anthropic");

    /* And the half that went missing. Every one of these is a column
       `observe.openRouter` cannot fill, which is why the method exists. */
    /* **`reportedInputTokens`, not `inputTokens`** — the row names it that
       because the two wires disagree about what an input token is, which is the
       same disagreement this observer exists for (src/ai-spend.ts). */
    expect(rows[0]?.reportedInputTokens).toBe(40);
    expect(rows[0]?.outputTokens).toBe(600);
    expect(rows[0]?.cacheReadTokens).toBe(13_863);
    expect(rows[0]?.cacheWrite5mTokens).toBe(60);
    expect(rows[0]?.cacheWrite1hTokens).toBe(30);
    expect(rows[0]?.reasoningTokens).toBe(128);
    expect(rows[0]?.serviceTier).toBe("standard");
    expect(rows[0]?.inferenceGeo).toBe("us");
  });

  it("says it does not know, rather than borrowing our price table, when no cost arrives", async () => {
    /* The Skin puts `cost` in the raw `message_delta`, and the SDK's stream
       accumulator drops it — so a caller reading the merged message gets
       `undefined` for ever. The row must then be short by an *unknown* amount:
       `computed`, under OpenRouter's account, would put our arithmetic where
       `--reconcile` compares against their running total. */
    const rows = await rowsFrom(() =>
      withDeclaredExternalCall(
        messagesViaOr!.id,
        { model: "anthropic/claude-sonnet-5" },
        async ({ observe }) => {
          observe.messagesViaOpenRouter(
            { model: "anthropic/claude-sonnet-5", usage: { input_tokens: 40, output_tokens: 600 } },
            { costUsd: null },
          );
        },
      ),
    );

    expect(rows[0]?.costSource).toBe("none");
    expect(rows[0]?.creditsUsedNanos).toBeNull();
    expect(rows[0]?.computedCostNanos).toBeNull();
    /* The tokens still arrived, so the row is not empty — it is honest. */
    expect(rows[0]?.reportedInputTokens).toBe(40);
  });

  it("refuses the chat wire's observer for a Messages-wire declaration", async () => {
    /* **This is the guard, and it is the whole finding.** `observe.openRouter`
       accepted a Messages-wire call happily; the loss was invisible because the
       cost was right. Now the wrong shape cannot be handed over at all. */
    await expect(
      collectSpend(
        () =>
          withDeclaredExternalCall(
            messagesViaOr!.id,
            { model: "anthropic/claude-sonnet-5" },
            async ({ observe }) => {
              observe.openRouter({
                usage: { prompt_tokens: 40, completion_tokens: 600, cost: 0.002 },
              });
            },
          ),
        {
          attribution: { scopeKind: "eval", ownerId: "00000000-0000-4000-8000-00000000d001" },
          sink: async () => undefined,
        },
      ),
    ).rejects.toThrow(/not the observer for it/);
  });

  it("refuses the Messages observer for a chat-wire declaration", async () => {
    /* The other direction, because the two wires disagree about what an input
       token is — the Messages shape reports cache reads outside `input_tokens`,
       the chat shape inside — so a chat body read as Anthropic-shaped would
       double-count them. */
    await expect(
      collectSpend(
        () =>
          withDeclaredExternalCall(
            chatViaOr!.id,
            { model: "google/gemini-3.7-flash" },
            async ({ observe }) => {
              observe.messagesViaOpenRouter(
                { usage: { input_tokens: 1, output_tokens: 1 } },
                { costUsd: 0.001 },
              );
            },
          ),
        {
          attribution: { scopeKind: "eval", ownerId: "00000000-0000-4000-8000-00000000d001" },
          sink: async () => undefined,
        },
      ),
    ).rejects.toThrow(/not the observer for it/);
  });
});

describe("work that outlives the call", () => {
  /* **`AsyncLocalStorage` follows into anything created inside its callback**,
     so "a store exists" is not "the call is still running". GPT Sol drove both
     of these: a fetch scheduled inside `fn` and awaited after it returned went
     out against a row that was already written and closed; and a wrapper started
     from a callback retained past `collectSpend` ran its body and then had the
     row discarded as *late*. */
  it("refuses a fetch scheduled inside the call but run after it", async () => {
    vi.stubGlobal("fetch", async () => new Response("{}", { status: 200 }));
    let detached: Promise<unknown> | null = null;
    await rowsFrom(() =>
      withDeclaredExternalCall(METERED, { model: "claude-sonnet-5" }, async ({ observe }) => {
        /* Started, deliberately not awaited — the shape of a fire-and-forget
           log call, or a `Promise.all` somebody forgot to await. */
        detached = new Promise((r) => setTimeout(r, 0)).then(() =>
          declaredFetch("https://example.test/late"),
        );
        observe.anthropic({ usage: USAGE, model: "claude-sonnet-5" });
      }),
    );
    await expect(detached).rejects.toThrow(/already been recorded/);
  });

  it("refuses to start a declared call once the collector has closed", async () => {
    /* **Scheduled inside the collector, run after it.** Handing a closure out
       and calling it later does not restore the context — the first version of
       this test did that and passed for the wrong reason, because there was no
       store at all by then. `AsyncLocalStorage` propagates into async resources
       *created inside* the callback, so a timer started in `fn` still sees the
       box after `collectSpend` has returned and shut it. */
    let detached: Promise<unknown> | null = null;
    await collectSpend(
      async () => {
        detached = new Promise((r) => setTimeout(r, 0)).then(() =>
          withDeclaredExternalCall(METERED, { model: "claude-sonnet-5" }, async () => "x"),
        );
      },
      {
        attribution: { scopeKind: "eval", ownerId: "00000000-0000-4000-8000-00000000d001" },
        sink: async () => undefined,
      },
    );
    await expect(detached).rejects.toThrow(/no ledger open/);
  });
});

describe("declaredFetch", () => {
  it("refuses to run outside a declaration", async () => {
    vi.stubGlobal("fetch", async () => new Response("{}", { status: 200 }));
    await expect(declaredFetch("https://example.test/")).rejects.toThrow(
      /outside withDeclaredExternalCall/,
    );
  });

  it("runs inside one", async () => {
    const seen: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      seen.push(String(url));
      return new Response("{}", { status: 200 });
    });
    await rowsFrom(() =>
      withDeclaredExternalCall(METERED, { model: "claude-sonnet-5" }, async () => {
        await declaredFetch("https://example.test/inside");
      }),
    );
    expect(seen).toEqual(["https://example.test/inside"]);
  });
});
