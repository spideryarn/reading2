/**
 * **What a model call cost**, and the one place in this app that knows a price.
 *
 * Until 2026-08-27 there was no such place, deliberately —
 * docs/project/logging.md said *"We log token counts, which are facts, and
 * leave cost to whoever is doing the arithmetic"*, and evals/prompt-caching.ts
 * carried its own three-line price table with a comment saying *"there is
 * nowhere in the app that knows prices — the app does not bill anyone"*. Both
 * were right about an app with one user. Greg, 2026-08-27:
 *
 * > For my tracking, so I can estimate costs and set pricing. Also so we can
 * > define a spend limit per user.
 *
 * docs/plans/ai-cost-tracking.md is the whole argument. This file is the
 * arithmetic half of it, and it is deliberately pure: no IO, no database, no
 * clock. Everything here can be checked against a number somebody measured.
 *
 * ## The one thing to understand before editing this file
 *
 * **The two providers do not mean the same thing by "input tokens", and a
 * single shared cost function is therefore a bug rather than a convenience.**
 *
 * | | what the field counts | what you do with the cache figures |
 * |---|---|---|
 * | Anthropic SDK (`input_tokens`) | tokens *after the last cache breakpoint only* | **add** them |
 * | OpenRouter (`prompt_tokens`) | the whole prompt, cached or not | **subtract** them |
 *
 * Anthropic states its rule outright:
 *
 * > The `input_tokens` field represents only the tokens that come after the
 * > last cache breakpoint in your request — not all the input tokens you sent.
 *
 * OpenRouter states its rule nowhere, so it was measured instead — two
 * identical ~18k-token calls, checked against the cost OpenRouter itself
 * returned. The subtractive reading matched to eight decimal places on both;
 * the additive reading was out by 1.8x and 10.8x. The numbers are in
 * `tests/pricing.test.ts`, kept as fixtures precisely so that this cannot be
 * "simplified" into one function later without a test going red.
 *
 * Seven of this app's twelve paid call sites are on the SDK and five are on
 * OpenRouter, so getting it wrong is not a rounding error: on a cached call the
 * cache is ~95% of the prompt. Hence two named functions and no generic one.
 *
 * ## Which calls actually need this
 *
 * Fewer than you would think. **OpenRouter reports what it charged**
 * (`usage.cost`), so for those five the honest record is the provider's own
 * number and this file is only the cross-check on it — see `PRICE_CHECKED` and
 * docs/plans/ai-cost-tracking.md § The reconciliation. Anthropic never returns
 * a cost figure at all, so the seven pipeline stages are priced here or not at
 * all.
 *
 * ## A model with no price is an error, not a zero
 *
 * `priceAnthropicCall` returns `null` for a model it does not know, and callers
 * must record that as `unpriced` rather than as `0`. This is not theoretical:
 * `voyageai/voyage-4`, this app's embedding model, is not in OpenRouter's
 * `/api/v1/models` listing at all, so a price table built by scraping that
 * endpoint would have reported every embedding call as free. A missing price
 * must never be able to look like a cheap call.
 * docs/reusable/silent-success.md.
 */

/**
 * USD per **million** tokens — the unit prices are quoted in, so that the table
 * below can be read against a pricing page without arithmetic.
 *
 * Nano-dollars are the storage unit and they are converted at the end. Two
 * different units in one file is a real risk, so the rule is: every number in
 * this file is per-million USD until `toNanos` is called, and `toNanos` is
 * called exactly once per function.
 */
export interface ModelPrice {
  input: number;
  output: number;
  /** 5-minute ephemeral cache write: 1.25x input. */
  cacheWrite5m: number;
  /** 1-hour ephemeral cache write: 2x input. This app does not use it yet. */
  cacheWrite1h: number;
  /** Cache read: 0.1x input. */
  cacheRead: number;
}

/**
 * When these were last checked, and against what.
 *
 * Kept next to the numbers rather than in a commit message, because the
 * question a reader has when they find a surprising cost is "how old is this
 * table", and a commit message does not answer it without archaeology.
 *
 * The Sonnet 5 row is not merely *read* from a pricing page — it was confirmed
 * against real billing on the date below, by comparing computed cost against
 * the charge OpenRouter reported for the same call. See tests/pricing.test.ts.
 */
export const PRICE_CHECKED = "2026-08-27";

/** Where the numbers came from, for whoever re-checks them. */
export const PRICE_SOURCE = "https://platform.claude.com/docs/en/about-claude/pricing";

/**
 * The multipliers Anthropic applies to the input price. Written as constants
 * rather than baked into the table so that the table's rows cannot disagree
 * with each other about what a cache read costs — which is the mistake that
 * would be invisible, since every row would still look plausible.
 */
const CACHE_WRITE_5M = 1.25;
const CACHE_WRITE_1H = 2.0;
const CACHE_READ = 0.1;

/** Build a full price row from the two numbers a pricing page actually quotes. */
function anthropicPrice(input: number, output: number): ModelPrice {
  return {
    input,
    output,
    cacheWrite5m: input * CACHE_WRITE_5M,
    cacheWrite1h: input * CACHE_WRITE_1H,
    cacheRead: input * CACHE_READ,
  };
}

/**
 * **Every model this app can reach through the Anthropic SDK.**
 *
 * Three rows, because src/models.ts is a closed list: `CAPABLE_MODEL` is the
 * only one any stage names, and the other two are here because
 * `SPIDERYARN_*_MODEL` can point a stage at them for a one-off comparison and a
 * run whose cost silently reads zero would be a poor way to find that out.
 *
 * **Deliberately not a package.** docs/research/ai-cost-tracking-options.md
 * recommends `@pydantic/genai-prices`, and for an app that reached a hundred
 * models it would be right. Here the whole table is nine numbers, and a
 * dependency that refetches prices from GitHub every hour is the wrong shape
 * for a figure somebody bills against: a price that can change without anyone
 * reviewing it is the problem, not the solution. See
 * docs/plans/ai-cost-tracking.md § A table in git, not a package.
 *
 * The OpenRouter spellings are absent on purpose. Those calls carry their own
 * cost and must never be priced from here as if they were the same call —
 * except by `crossCheckOpenRouter`, which says in its name that it is doing so.
 */
export const ANTHROPIC_PRICES: Readonly<Record<string, readonly PriceRow[]>> = {
  "claude-sonnet-5": [{ from: "1970-01-01", price: anthropicPrice(2.0, 10.0) }],
  "claude-opus-5": [{ from: "1970-01-01", price: anthropicPrice(5.0, 25.0) }],
  "claude-haiku-4-5": [{ from: "1970-01-01", price: anthropicPrice(1.0, 5.0) }],
};

/**
 * A price, and the instant it started applying. **Dates are UTC**, and the row
 * applies from that instant until the next row's.
 *
 * ## Why this is a list rather than one row per model
 *
 * Because a price change was scheduled, dated, and cancelled *during the week
 * this file was written*, which is a better argument than any I would have
 * constructed. Sonnet 5's $2/$10 was introductory pricing through 2026-08-31,
 * with an increase to $3/$15 scheduled for 2026-09-01; Anthropic then made the
 * introductory price standard and cancelled the increase. GPT Sol's review
 * flagged the increase as a blocker; checking it against the pricing page is
 * what turned a wrong finding into this design.
 *
 * Snapshotting cost at call time already handles a price change for calls made
 * *after* somebody edits a table. What it cannot handle is the gap between the
 * change and the edit — a rate that changes at midnight UTC and a deploy at
 * nine in the morning is nine hours of calls priced wrong, permanently, because
 * the snapshot is the thing that gets billed from. An effective date lets the
 * new row be committed *before* the boundary, so the switch happens on time
 * whether or not anybody is awake.
 *
 * The single `1970-01-01` row on each model is not a placeholder for missing
 * information — it says "this price has always applied as far as this app is
 * concerned", which is true: nothing was recorded before today.
 */
export interface PriceRow {
  /** `YYYY-MM-DD`, UTC. The row applies from 00:00:00Z on this date. */
  from: string;
  price: ModelPrice;
}

/**
 * The price for a model **at the moment the call started**, which is not
 * necessarily now. `null` for a model with no table, or for an instant before
 * any row applies.
 *
 * Takes the call's start time rather than reading a clock, because a row
 * written from a queue can be recorded minutes after the call it describes, and
 * on the wrong side of a boundary. The price is a property of the call.
 */
export function priceAt(model: string, startedAt: Date): ModelPrice | null {
  return rowAt(model, startedAt)?.price ?? null;
}

function rowAt(model: string, startedAt: Date): PriceRow | null {
  const rows = ANTHROPIC_PRICES[model];
  if (!rows) return null;
  let found: PriceRow | null = null;
  for (const row of rows) {
    if (Date.parse(`${row.from}T00:00:00Z`) <= startedAt.getTime()) found = row;
  }
  return found;
}

/**
 * Which price row applied, as its effective date — the stamp that goes on the
 * stored row.
 *
 * **`price_version` records which price was used, not when the table was last
 * looked at.** `PRICE_CHECKED` cannot do that job: it moves every time anybody
 * re-reads the pricing page, so two calls priced identically would carry
 * different stamps, and a call priced under an old row would carry the new
 * date. The effective date is a fact about the money.
 */
export function effectiveFrom(model: string, startedAt: Date): string {
  return rowAt(model, startedAt)?.from ?? "unpriced";
}

/**
 * **Nano-dollars**, which is how a cost is stored.
 *
 * Micro-dollars were the obvious choice and are very slightly too coarse: a
 * single query-embedding call runs about $0.0000006, which rounds to zero
 * micro-dollars and lands in the table as a free call. Nano-dollars put nine
 * digits after the point, which is more than any provider quotes, so rounding
 * can never be the reason a row reads zero.
 *
 * `number` rather than `bigint` at this boundary because a double holds
 * integers exactly up to 2^53, which is about $9,000,000 in nanos — and a
 * single call that cost nine million dollars has a bigger problem than
 * rounding. The database column is `bigint`.
 */
export type Nanos = number;

function toNanos(usd: number): Nanos {
  return Math.round(usd * 1e9);
}

/** Price `tokens` at a per-million rate, in dollars. */
function usd(tokens: number, perMillion: number): number {
  return (tokens / 1_000_000) * perMillion;
}

/**
 * What a priced call cost, split so that a surprising total can be read rather
 * than merely disbelieved. The parts sum to `totalNanos`.
 */
export interface PricedCall {
  totalNanos: Nanos;
  inputNanos: Nanos;
  outputNanos: Nanos;
  cacheWriteNanos: Nanos;
  cacheReadNanos: Nanos;
  /** Which row of `ANTHROPIC_PRICES` was used, and when it was last checked. */
  priceVersion: string;
}

/** The fields this file reads off an Anthropic `message.usage`. */
export interface AnthropicUsageLike {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  cache_creation?: {
    ephemeral_5m_input_tokens?: number | null;
    ephemeral_1h_input_tokens?: number | null;
  } | null;
}

/**
 * **Price a direct Anthropic SDK call.** Additive: `input_tokens` excludes the
 * cache figures, so nothing is subtracted from anything here.
 *
 * Returns `null` when the model is not in the table. Callers record that as
 * `unpriced`; see the file header for why it must not become `0`.
 *
 * The 5m/1h split is read from `cache_creation` when the provider sends it, and
 * falls back to the flat `cache_creation_input_tokens` **priced as 5-minute**,
 * which is what this app actually asks for. That fallback is a real assumption
 * rather than a safe default — a 1-hour write costs 1.6x what it is charged
 * here — so it is worth knowing that it only bites if somebody adds a 1-hour
 * breakpoint *and* the response stops carrying the breakdown.
 */
export function priceAnthropicCall(
  model: string,
  usage: AnthropicUsageLike,
  startedAt: Date,
): PricedCall | null {
  const price = priceAt(model, startedAt);
  if (!price) return null;

  const read = usage.cache_read_input_tokens ?? 0;
  const flatWrite = usage.cache_creation_input_tokens ?? 0;
  const write5m = usage.cache_creation?.ephemeral_5m_input_tokens ?? null;
  const write1h = usage.cache_creation?.ephemeral_1h_input_tokens ?? null;

  /* The breakdown is authoritative when it is present. When it is not, the flat
     total is all there is, and this app only ever writes 5-minute caches. */
  const split =
    write5m === null && write1h === null
      ? { m5: flatWrite, h1: 0 }
      : { m5: write5m ?? 0, h1: write1h ?? 0 };

  const inputUsd = usd(usage.input_tokens, price.input);
  const outputUsd = usd(usage.output_tokens, price.output);
  const writeUsd = usd(split.m5, price.cacheWrite5m) + usd(split.h1, price.cacheWrite1h);
  const readUsd = usd(read, price.cacheRead);

  return {
    totalNanos: toNanos(inputUsd + outputUsd + writeUsd + readUsd),
    inputNanos: toNanos(inputUsd),
    outputNanos: toNanos(outputUsd),
    cacheWriteNanos: toNanos(writeUsd),
    cacheReadNanos: toNanos(readUsd),
    priceVersion: `${model}@${effectiveFrom(model, startedAt)}`,
  };
}

/** The fields this file reads off an OpenRouter `usage`. */
export interface OpenRouterUsageLike {
  prompt_tokens?: number | null;
  completion_tokens?: number | null;
  prompt_tokens_details?: {
    cached_tokens?: number | null;
    cache_write_tokens?: number | null;
  } | null;
}

/**
 * **Recompute what an OpenRouter call should have cost**, so that it can be
 * compared against the `usage.cost` OpenRouter reported.
 *
 * Named `crossCheck` rather than `price` because **nothing should bill from
 * this number.** OpenRouter's own figure is the invoice line; this one exists
 * to catch the day the two stop agreeing, which is the day `ANTHROPIC_PRICES`
 * has gone stale — and the seven Anthropic-SDK stages, which have no provider
 * figure to check against, are being priced wrong at that moment too, silently.
 * The five OpenRouter calls are the only continuous test the price table has.
 *
 * Subtractive, per the measurement in the file header. Takes the price row
 * directly, because the caller has to map OpenRouter's spelling
 * (`anthropic/claude-sonnet-5`) onto the SDK's (`claude-sonnet-5`) and
 * src/models.ts is emphatic that this must never be done by munging the string:
 * the previous model pair spelled it `claude-sonnet-4.5` against
 * `claude-sonnet-4-5`, and a derivation would have gone on disagreeing while
 * looking mended.
 *
 * Returns `null` when there is nothing to check — no usage, or a prompt count
 * smaller than the cache figures inside it, which would mean the subtraction
 * has stopped describing reality and a clamped-to-zero number would hide it.
 */
export function crossCheckOpenRouter(
  price: ModelPrice,
  usage: OpenRouterUsageLike,
): PricedCall | null {
  const prompt = usage.prompt_tokens ?? 0;
  const completion = usage.completion_tokens ?? 0;
  const read = usage.prompt_tokens_details?.cached_tokens ?? 0;
  const write = usage.prompt_tokens_details?.cache_write_tokens ?? 0;
  if (prompt === 0 && completion === 0) return null;

  const fresh = prompt - read - write;
  /* Negative means the inclusive reading is wrong for this response — a new
     provider shape, or a field that changed meaning. Refusing to answer is the
     point: a clamped zero would silently under-price and look fine. */
  if (fresh < 0) return null;

  const inputUsd = usd(fresh, price.input);
  const outputUsd = usd(completion, price.output);
  const writeUsd = usd(write, price.cacheWrite5m);
  const readUsd = usd(read, price.cacheRead);

  return {
    totalNanos: toNanos(inputUsd + outputUsd + writeUsd + readUsd),
    inputNanos: toNanos(inputUsd),
    outputNanos: toNanos(outputUsd),
    cacheWriteNanos: toNanos(writeUsd),
    cacheReadNanos: toNanos(readUsd),
    priceVersion: `openrouter-crosscheck@${PRICE_CHECKED}`,
  };
}

/** A dollar figure OpenRouter reported, as nano-dollars. */
export function providerCostToNanos(cost: number | null | undefined): Nanos | null {
  if (typeof cost !== "number" || !Number.isFinite(cost) || cost < 0) return null;
  return toNanos(cost);
}

/**
 * How far apart the provider's figure and ours are, as a fraction of the
 * provider's. `null` when either side is missing or the provider charged
 * nothing (a BYOK call, where zero is correct and a ratio is meaningless).
 *
 * A threshold is deliberately **not** set here. What counts as drift worth
 * shouting about is a reporting decision, and it belongs with the report — see
 * `npm run cost` — not buried in a pricing helper where nobody would find it.
 */
export function costDrift(providerNanos: Nanos | null, ourNanos: Nanos | null): number | null {
  if (providerNanos === null || ourNanos === null || providerNanos === 0) return null;
  return Math.abs(providerNanos - ourNanos) / providerNanos;
}
