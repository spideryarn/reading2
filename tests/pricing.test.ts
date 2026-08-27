/**
 * `src/pricing.ts` — the arithmetic that turns token counts into money.
 *
 * **The fixtures in here are measured, not invented.** The two OpenRouter cases
 * are real responses from two identical ~18k-token calls to
 * `anthropic/claude-sonnet-5` on 2026-08-27, together with the `cost`
 * OpenRouter itself returned for each. That is what makes this file worth
 * having: the assertion is not "our function agrees with our function", it is
 * "our function agrees with a bill".
 *
 * The trap those two cases exist to hold shut is in
 * docs/plans/ai-cost-tracking.md § 2 — Anthropic and OpenRouter disagree about
 * whether "input tokens" includes the cached ones. A single shared cost helper
 * is correct for exactly one of them, and wrong for the other by roughly the
 * size of the cache, which on these calls is 95% of the prompt. If someone
 * later folds `priceAnthropicCall` and `crossCheckOpenRouter` into one
 * function, `the additive reading is wrong for OpenRouter` goes red.
 */
import { describe, expect, it } from "vitest";

import {
  ANTHROPIC_PRICES,
  costDrift,
  crossCheckOpenRouter,
  effectiveFrom,
  priceAnthropicCall,
  priceAt,
  providerCostToNanos,
} from "../src/pricing.js";

/** Measured 2026-08-27. Cold call — a cache write, no read. */
const OR_COLD = {
  prompt_tokens: 18224,
  completion_tokens: 4,
  prompt_tokens_details: { cached_tokens: 0, cache_write_tokens: 18212 },
};
const OR_COLD_REPORTED_USD = 0.045594;

/** The same call three seconds later. Cache read, no write. */
const OR_WARM = {
  prompt_tokens: 18224,
  completion_tokens: 4,
  prompt_tokens_details: { cached_tokens: 18212, cache_write_tokens: 0 },
};
const OR_WARM_REPORTED_USD = 0.0037064;

/** When the probes were run. Every priced call here is stamped with it. */
const AT = new Date("2026-08-27T12:00:00Z");
const SONNET = priceAt("claude-sonnet-5", AT)!;

describe("crossCheckOpenRouter — against what OpenRouter actually charged", () => {
  it("matches the reported cost on a cold (cache-writing) call", () => {
    const priced = crossCheckOpenRouter(SONNET, OR_COLD);
    expect(priced?.totalNanos).toBe(providerCostToNanos(OR_COLD_REPORTED_USD));
  });

  it("matches the reported cost on a warm (cache-reading) call", () => {
    const priced = crossCheckOpenRouter(SONNET, OR_WARM);
    expect(priced?.totalNanos).toBe(providerCostToNanos(OR_WARM_REPORTED_USD));
  });

  /**
   * The negative case, which is the one that actually protects anything. If
   * OpenRouter's `prompt_tokens` were disjoint from the cache fields — the
   * Anthropic-shaped reading — the warm call would price at about $0.040
   * instead of $0.0037. Asserting the *size* of the error rather than merely
   * that it differs, so that a future refactor cannot make this pass by
   * accident.
   */
  it("the additive reading is wrong for OpenRouter, by an order of magnitude", () => {
    const d = OR_WARM.prompt_tokens_details;
    const additiveUsd =
      (OR_WARM.prompt_tokens / 1e6) * SONNET.input +
      (d.cached_tokens / 1e6) * SONNET.cacheRead +
      (d.cache_write_tokens / 1e6) * SONNET.cacheWrite5m +
      (OR_WARM.completion_tokens / 1e6) * SONNET.output;
    expect(additiveUsd / OR_WARM_REPORTED_USD).toBeGreaterThan(10);
  });

  it("refuses rather than clamping when the subtraction goes negative", () => {
    /* A response whose cache figures exceed its prompt count means the
       inclusive reading has stopped describing reality. Zero would be a
       plausible-looking under-price; null is the honest answer. */
    expect(
      crossCheckOpenRouter(SONNET, {
        prompt_tokens: 100,
        completion_tokens: 1,
        prompt_tokens_details: { cached_tokens: 900, cache_write_tokens: 0 },
      }),
    ).toBeNull();
  });

  it("has nothing to say about an empty usage object", () => {
    expect(crossCheckOpenRouter(SONNET, {})).toBeNull();
  });
});

describe("priceAnthropicCall — additive, because input_tokens excludes the cache", () => {
  it("adds the three input figures rather than subtracting them", () => {
    /* Anthropic's own docs: input_tokens counts only what follows the last
       cache breakpoint. So a call reporting 50 fresh + 18212 read is an 18262
       token prompt, and pricing 50 of it would be a 99.7% discount nobody gave
       us. */
    const priced = priceAnthropicCall(
      "claude-sonnet-5",
      {
        input_tokens: 50,
        output_tokens: 4,
        cache_read_input_tokens: 18212,
        cache_creation_input_tokens: 0,
      },
      AT,
    );
    const expected =
      (50 / 1e6) * SONNET.input + (18212 / 1e6) * SONNET.cacheRead + (4 / 1e6) * SONNET.output;
    expect(priced?.totalNanos).toBe(Math.round(expected * 1e9));
  });

  it("prices a 1-hour cache write higher than a 5-minute one", () => {
    const base = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0 };
    const m5 = priceAnthropicCall(
      "claude-sonnet-5",
      {
        ...base,
        cache_creation_input_tokens: 1000,
        cache_creation: { ephemeral_5m_input_tokens: 1000, ephemeral_1h_input_tokens: 0 },
      },
      AT,
    );
    const h1 = priceAnthropicCall(
      "claude-sonnet-5",
      {
        ...base,
        cache_creation_input_tokens: 1000,
        cache_creation: { ephemeral_1h_input_tokens: 1000, ephemeral_5m_input_tokens: 0 },
      },
      AT,
    );
    /* 2.0x versus 1.25x of the input rate — a 1.6x difference. A flat total
       priced as 5-minute would under-charge this by 37.5%. */
    expect(h1!.totalNanos / m5!.totalNanos).toBeCloseTo(1.6, 5);
  });

  it("falls back to pricing a flat cache_creation total as 5-minute", () => {
    const priced = priceAnthropicCall(
      "claude-sonnet-5",
      { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 1000 },
      AT,
    );
    expect(priced?.cacheWriteNanos).toBe(Math.round((1000 / 1e6) * SONNET.cacheWrite5m * 1e9));
  });

  it("the parts sum to the total", () => {
    const p = priceAnthropicCall(
      "claude-sonnet-5",
      {
        input_tokens: 1234,
        output_tokens: 567,
        cache_read_input_tokens: 8910,
        cache_creation_input_tokens: 1112,
      },
      AT,
    )!;
    /* Each part is rounded independently, so allow a nano or two of slack
       rather than pretending rounding does not happen. */
    const summed = p.inputNanos + p.outputNanos + p.cacheWriteNanos + p.cacheReadNanos;
    expect(Math.abs(summed - p.totalNanos)).toBeLessThanOrEqual(4);
  });

  /**
   * The rule from the plan, and the reason it is a rule: `voyageai/voyage-4` is
   * absent from OpenRouter's own model listing, so a price table built by
   * scraping it would have reported every embedding call as free. An unknown
   * model has to be distinguishable from a cheap one.
   */
  it("returns null for a model it does not know, never zero", () => {
    expect(
      priceAnthropicCall("claude-sonnet-9", { input_tokens: 1e6, output_tokens: 1e6 }, AT),
    ).toBeNull();
  });

  it("stamps the row with the price that applied, not the day the table was read", () => {
    const p = priceAnthropicCall("claude-sonnet-5", { input_tokens: 1, output_tokens: 1 }, AT);
    expect(p?.priceVersion).toBe("claude-sonnet-5@1970-01-01");
  });
});

/**
 * Effective-dated prices. There is only one row per model today, so these
 * assert the *mechanism* against a synthetic table rather than against a real
 * price change — the point being that when a real one lands, committing it
 * ahead of its date is all that is needed.
 *
 * The near-miss that motivated this: Sonnet 5 was scheduled to go from $2/$10
 * to $3/$15 on 2026-09-01, and Anthropic cancelled it. See src/pricing.ts.
 */
describe("priceAt — the price is a property of when the call happened", () => {
  it("picks the row in force at the call's start time, not now", () => {
    const before = new Date("2026-08-31T23:59:59Z");
    const after = new Date("2026-09-01T00:00:01Z");
    /* Both resolve to the same row today. What matters is that they resolve
       from the argument at all — a clock read inside the function would make
       these two indistinguishable for ever. */
    expect(priceAt("claude-sonnet-5", before)).toEqual(priceAt("claude-sonnet-5", after));
    expect(effectiveFrom("claude-sonnet-5", before)).toBe("1970-01-01");
  });

  it("says so rather than guessing when no row applies yet", () => {
    expect(priceAt("claude-sonnet-5", new Date("1969-01-01T00:00:00Z"))).toBeNull();
    expect(effectiveFrom("claude-sonnet-5", new Date("1969-01-01T00:00:00Z"))).toBe("unpriced");
  });

  it("knows nothing about a model that is not in the table", () => {
    expect(priceAt("gpt-5.6-luna", AT)).toBeNull();
    expect(effectiveFrom("gpt-5.6-luna", AT)).toBe("unpriced");
  });

  it("treats the boundary as UTC midnight, not local midnight", () => {
    /* 00:30 BST on 1 September is 23:30 UTC on 31 August — the case that makes
       a naive Date comparison put a call on the wrong side of a price change. */
    const bstJustAfterLocalMidnight = new Date("2026-09-01T00:30:00+01:00");
    expect(bstJustAfterLocalMidnight.toISOString()).toBe("2026-08-31T23:30:00.000Z");
  });
});

describe("the price table itself", () => {
  const rows = Object.entries(ANTHROPIC_PRICES).flatMap(([model, list]) =>
    list.map((r) => [`${model}@${r.from}`, r.price] as const),
  );

  it("keeps Anthropic's published cache multipliers on every row", () => {
    for (const [label, p] of rows) {
      expect(p.cacheWrite5m / p.input, `${label} 5m write`).toBeCloseTo(1.25, 10);
      expect(p.cacheWrite1h / p.input, `${label} 1h write`).toBeCloseTo(2.0, 10);
      expect(p.cacheRead / p.input, `${label} cache read`).toBeCloseTo(0.1, 10);
    }
  });

  it("prices output above input on every row", () => {
    /* Not a law of nature, but true of every model this app can reach, and an
       inverted row is the shape a copy-paste error takes. */
    for (const [label, p] of rows) expect(p.output, label).toBeGreaterThan(p.input);
  });

  it("keeps each model's rows in ascending date order", () => {
    /* `priceAt` walks the list and keeps the last match, so an out-of-order
       list silently returns the wrong price. Cheap to assert, invisible
       otherwise. */
    for (const [model, list] of Object.entries(ANTHROPIC_PRICES)) {
      const dates = list.map((r) => r.from);
      expect(dates, model).toEqual([...dates].sort());
    }
  });

  it("covers every model src/models.ts can send to the Anthropic SDK", async () => {
    const { CAPABLE_MODEL } = await import("../src/models.js");
    expect(priceAt(CAPABLE_MODEL, AT)).not.toBeNull();
  });
});

describe("providerCostToNanos", () => {
  it("keeps a sub-micro-dollar embedding call from rounding to nothing", () => {
    /* The measured cost of one real 7-token voyage-4 call. In micro-dollars
       this is 0.00042 and rounds to zero — which is why the storage unit is
       nano-dollars. */
    expect(providerCostToNanos(4.2e-7)).toBe(420);
  });

  it("refuses a missing or nonsensical figure rather than calling it free", () => {
    expect(providerCostToNanos(undefined)).toBeNull();
    expect(providerCostToNanos(null)).toBeNull();
    expect(providerCostToNanos(Number.NaN)).toBeNull();
    expect(providerCostToNanos(-1)).toBeNull();
  });

  it("keeps zero, which is a real answer for a BYOK call", () => {
    expect(providerCostToNanos(0)).toBe(0);
  });
});

describe("costDrift", () => {
  it("is zero when the two agree, on the measured cold call", () => {
    const ours = crossCheckOpenRouter(SONNET, OR_COLD)!.totalNanos;
    expect(costDrift(providerCostToNanos(OR_COLD_REPORTED_USD), ours)).toBe(0);
  });

  it("reports the size of a stale price table", () => {
    expect(costDrift(100_000, 125_000)).toBeCloseTo(0.25, 10);
  });

  it("says nothing rather than dividing by zero on a BYOK call", () => {
    expect(costDrift(0, 500)).toBeNull();
    expect(costDrift(null, 500)).toBeNull();
    expect(costDrift(500, null)).toBeNull();
  });
});
