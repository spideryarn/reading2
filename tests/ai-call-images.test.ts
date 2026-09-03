/**
 * **The images half of the gateway** — `openRouterImage` in
 * [`src/ai-call.ts`](../src/ai-call.ts).
 *
 * Its own file rather than more of [`ai-call.test.ts`](ai-call.test.ts),
 * because the question is a different one. That file is about the *lifecycle*
 * of a chat call and proves it by breaking the seam a dozen ways; the lifecycle
 * here is the same `Meter` in the same `finally` and does not want re-proving.
 * What wants proving is three things that are new:
 *
 * 1. **A response with `data[]` and no `choices` anywhere in it**, decoded and
 *    checked before the bytes reach anything that would try to draw them.
 * 2. **A bill that is zero on purpose.** `openai/gpt-image-2` is served on
 *    somebody else's key, so OpenRouter answers `is_byok: true` and
 *    `usage.cost: 0` with the real figure in
 *    `usage.cost_details.upstream_inference_cost`. A ledger that took the zero
 *    at face value would under-report every plate this app ever draws and look
 *    entirely healthy doing it.
 * 3. **`wire: "images"` on the row.** Derived from the path by the binary test
 *    this seam used until 2026-09-03, it would have said `"chat"`.
 *
 * The money assertions are on the **`AiCallRow` that reaches the sink**, not on
 * the `SpendRecord` the collector reports, because `byok_upstream_nanos` is
 * written at that projection and nowhere else (`normaliseByokUpstream`,
 * src/ai-spend.ts) — and it is the projection, not the record, that a total is
 * made of.
 *
 * Every payload here is the one the spike of 2026-09-03 actually got back, cost
 * and all — docs/plans/260903c-illustrated-diagram-sub-mode.md § The wire.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProviderRefused, openRouterImage } from "../src/ai-call.js";
import { type AiCallRow, collectSpend } from "../src/ai-spend.js";
import { environmentOwnerId } from "../src/owner.js";

/* Stubbed explicitly rather than relied on: vite.config.ts's `loadEnvLocal()`
   leaks `.env.local` into vitest, so a test that "passes" because the real key
   is present passes only on this laptop. */
beforeEach(() => vi.stubEnv("OPENROUTER_API_KEY", "sk-test-key"));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

/**
 * A real 2×3 PNG — signature, IHDR, IDAT, IEND — built once and kept as bytes.
 *
 * **It has to be a real one.** The seam sniffs the signature and reads the
 * IHDR, so a fixture of `Buffer.from("hello")` would prove the happy path by
 * skipping the validation the happy path goes through.
 */
const PLATE = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAIAAAA2iEnWAAAAC0lEQVR4nGNgwAIAABUAAapll8QAAAAASUVORK5CYII=",
  "base64",
);

/** The same PNG with its IHDR rewritten to claim a raster nothing can allocate. */
function bombB64(width: number, height: number): string {
  const bytes = Buffer.from(PLATE);
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes.toString("base64");
}

/**
 * The usage block from the spike, verbatim.
 *
 * **`cost: 0` beside `upstream_inference_cost: 0.013237` is the whole point of
 * this file.** Change either number and the assertions below should stop
 * agreeing about which one the ledger kept.
 */
const BYOK_USAGE = {
  prompt_tokens: 1085,
  completion_tokens: 158,
  total_tokens: 1243,
  cost: 0,
  is_byok: true,
  prompt_tokens_details: { cached_tokens: 0 },
  cost_details: {
    upstream_inference_cost: 0.013237,
    upstream_inference_prompt_cost: 0.008497,
    upstream_inference_completions_cost: 0.00474,
  },
  completion_tokens_details: { reasoning_tokens: 0, image_tokens: 158 },
};

/** The whole 200, as the endpoint writes it: `data[]`, and no `choices` at all. */
function drawn(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    created: 1_788_406_283,
    data: [{ b64_json: PLATE.toString("base64"), media_type: "image/png" }],
    usage: BYOK_USAGE,
    ...overrides,
  });
}

interface Sent {
  url: string;
  body: Record<string, unknown>;
  headers: Record<string, string>;
}

/** Replace `fetch`, capture what went out, replay what comes back. */
function stubTransport(
  status: number,
  body: string,
  headers: Record<string, string> = {},
): Sent[] {
  const sent: Sent[] = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    sent.push({
      url,
      body: JSON.parse(String(init.body)) as Record<string, unknown>,
      headers: init.headers as Record<string, string>,
    });
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: new Headers(headers),
      text: async () => body,
    } as unknown as Response;
  });
  return sent;
}

const ASK = {
  model: "openai/gpt-image-2",
  prompt: "an antique map of the argument",
  aspectRatio: "2:3",
  quality: "low",
} as const;

/**
 * Draw one plate inside a collector that keeps its rows, and hand back
 * everything: what went out, what came back, what the collector reported, and
 * what the ledger was actually asked to write.
 *
 * The result is caught rather than awaited into a throw, so a failing call and
 * a succeeding one are read the same way and the rows are always inspected.
 */
async function draw(
  request: Parameters<typeof openRouterImage>[1] = ASK,
  reply: { status?: number; body?: string; headers?: Record<string, string> } = {},
) {
  const sent = stubTransport(
    reply.status ?? 200,
    reply.body ?? drawn(),
    reply.headers ?? { "x-generation-id": "gen-plate-1" },
  );
  const rows: AiCallRow[] = [];
  const { result, report } = await collectSpend(
    async () => openRouterImage("illustrate", request).catch((e: unknown) => e),
    {
      attribution: { scopeKind: "cli", ownerId: environmentOwnerId() },
      sink: async (row) => {
        rows.push(row);
      },
    },
  );
  return { sent, result, report, rows };
}

describe("the picture that comes back", () => {
  it("decodes the bytes and names them from their signature", async () => {
    const { result } = await draw();
    const call = result as Awaited<ReturnType<typeof openRouterImage>>;
    expect(Buffer.from(call.image).equals(PLATE)).toBe(true);
    expect(call.mediaType).toBe("image/png");
    /* The endpoint's answer carries no `model`, so this is honestly null rather
       than a copy of what we asked for. */
    expect(call.answeredBy).toBeNull();
    expect(call.generationId).toBe("gen-plate-1");
  });

  it("throws a sentence of ours, not the provider's, when there is no picture in the answer", async () => {
    /* A 200 with an empty `data` is a real shape — a refusal the model dressed
       up as a success — and the caller has to be told. What it must not be told
       is what the body said: the prompt is quoted from the reader's article,
       and a refusing upstream is exactly where that comes back. */
    const { result, rows } = await draw(ASK, {
      body: JSON.stringify({
        created: 1,
        data: [],
        usage: BYOK_USAGE,
        error: "refused: SECRET article prose",
      }),
    });
    expect((result as Error).message).toMatch(/no picture/);
    expect((result as Error).message).not.toContain("SECRET article prose");
    /* And the plate was generated before it was withheld, so it is still a row
       — with the money on it, and an `error`. */
    expect(rows).toHaveLength(1);
    expect(rows[0]?.outcome).toBe("error");
    expect(rows[0]?.byokUpstreamNanos).toBe(13_237_000);
  });

  it("refuses bytes that are not a picture at all", async () => {
    /* `Buffer.from(x, "base64")` never throws — it decodes what it can and
       hands back the rest — so "it parsed" is not evidence of anything. Without
       the signature check, an HTML error page base64'd into `b64_json` would be
       written to the blob store under a `.png` name and served to a reader.
       src/assets.ts § `sniffImage` is the shared statement of what a picture is. */
    const { result } = await draw(ASK, {
      body: JSON.stringify({
        data: [{ b64_json: Buffer.from("<html>nope</html>").toString("base64") }],
      }),
    });
    expect((result as Error).message).toMatch(/not a picture/);
  });

  it("refuses a picture whose bytes contradict the type the provider claimed", async () => {
    /* The name is a promise: Stage 3 stores these under `sha256/<hash>.jpeg`
       and serves them with a `Content-Type`. Taking the provider's word for it
       would make that promise one nobody checked. */
    const { result } = await draw(ASK, {
      body: JSON.stringify({
        data: [{ b64_json: PLATE.toString("base64"), media_type: "image/jpeg" }],
      }),
    });
    expect((result as Error).message).toMatch(/called its picture image\/jpeg/);
  });

  it("refuses a decompression bomb before anything tries to draw it", async () => {
    /* 20000×20000 is about a megabyte of PNG and 1.6 GB of raster. The next
       thing to touch these bytes is `@napi-rs/canvas`, which allocates
       width × height × 4 without asking. */
    const { result } = await draw(ASK, {
      body: JSON.stringify({
        data: [{ b64_json: bombB64(20_000, 20_000), media_type: "image/png" }],
      }),
    });
    expect((result as Error).message).toMatch(/implausible dimensions/);
  });

  it("refuses a picture with no pixels in it", async () => {
    const { result } = await draw(ASK, {
      body: JSON.stringify({
        data: [{ b64_json: bombB64(0, 0), media_type: "image/png" }],
      }),
    });
    expect((result as Error).message).toMatch(/implausible dimensions/);
  });
});

describe("the money, which is zero and is not free", () => {
  it("puts the upstream figure on the ledger row, not the zero it was billed", async () => {
    /* **The failure this test exists for is silent and total.** `usage.cost` is
       `0` on every BYOK call, so a meter that read only that would write a row
       per plate, each claiming the plate was free, and every other check would
       stay green: the row count is right, the tokens are right, the outcome is
       right. Only the total is wrong, and only by all of it.
       docs/project/ai-gateway.md is the document this is the test for. */
    const { rows, report } = await draw();
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row?.job).toBe("illustrate");
    /* **Not `"chat"`.** Derived from the path, it would have been. */
    expect(row?.wire).toBe("images");
    expect(row?.requestedModel).toBe("openai/gpt-image-2");
    expect(row?.isByok).toBe(true);
    expect(row?.outcome).toBe("ok");
    /* A zero that is an *answer*: OpenRouter settled the call at nothing because
       somebody else's key was charged. `cost_source: "provider"` is one of the
       three conditions `ai_calls_byok_upstream_only` checks before it will
       accept the column below at all. */
    expect(row?.costSource).toBe("provider");
    expect(row?.creditsUsedNanos).toBe(0);
    /* $0.013237, in nano-dollars — what the spike was actually charged. */
    expect(row?.byokUpstreamNanos).toBe(13_237_000);
    expect(row?.computedCostNanos).toBeNull();
    expect(row?.reportedInputTokens).toBe(1085);
    expect(row?.outputTokens).toBe(158);
    /* One record, and none left open. */
    expect(report.calls).toHaveLength(1);
    expect(report.pending).toHaveLength(0);
  });

  it("drops the upstream figure when the response does not say the call was BYOK — a finding, not a blessing", async () => {
    /* **This pins what happens today; it does not endorse it.**
     *
     * `normaliseByokUpstream` (src/ai-spend.ts) writes `byok_upstream_nanos`
     * only when `is_byok === true`, because that is one of the three conditions
     * in `ai_calls_byok_upstream_only` and a row that fails the CHECK is
     * *rejected* — a call that lands in no ledger at all. It is deliberately
     * `=== true`, since "we were not told" is not "no".
     *
     * The consequence, for a `cost: 0` with a real upstream figure and no
     * `is_byok`: the upstream number is dropped, `credits_used_nanos` is `0`,
     * `cost_source` is `provider`, and the row therefore claims the picture was
     * **free** — with a straight face and a passing CHECK. On the chat wire this
     * combination has never been observed (OpenRouter reports
     * `upstream_inference_cost` equal to `cost` on an ordinary call, measured
     * 2026-08-27), which is why the rule is safe there; on this wire it has
     * never been looked for.
     *
     * The right fix is *not* to loosen the condition — that puts the
     * double-count back and breaks the CHECK. It is to make the discrepancy
     * visible: warn at the projection when a non-zero upstream figure is being
     * dropped from a row whose credits are zero.
     *
     * **Done, 2026-09-03** — `warnIfPaidLooksFree` in src/ai-spend.ts, and the
     * test below watches it fire. The row's shape is unchanged, which is why
     * this characterisation still stands: the ledger still records the call as
     * free, and now says so out loud instead of only here. */
    const { rows } = await draw(ASK, {
      body: drawn({
        usage: { ...BYOK_USAGE, is_byok: false },
      }),
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.creditsUsedNanos).toBe(0);
    expect(rows[0]?.costSource).toBe("provider");
    expect(rows[0]?.byokUpstreamNanos).toBeNull();
    /* The provider *did* tell us; it is the projection that decides not to keep
       it. The evidence is still on the record the collector reports, which is
       what makes the recommended warning possible at all. */
    expect(rows[0]?.isByok).toBe(false);
  });

  /**
   * **The case the test above claims to be and is not.** It supplies
   * `is_byok: false`, which is the provider answering; this is the provider
   * saying nothing at all, which is the hole `warnIfPaidLooksFree` was written
   * for — `isByok` is `boolean | null` and the narrowing is deliberately
   * `=== true`, so *not told* falls in with *no* and the upstream figure is
   * dropped either way. GPT Sol spotted that the characterisation was of a
   * different case, 2026-09-03.
   */
  it("drops the upstream figure when the response never mentions is_byok at all", async () => {
    const { is_byok: _omitted, ...silent } = BYOK_USAGE;
    const { rows } = await draw(ASK, { body: drawn({ usage: silent }) });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.isByok).toBeNull();
    expect(rows[0]?.creditsUsedNanos).toBe(0);
    expect(rows[0]?.costSource).toBe("provider");
    expect(rows[0]?.byokUpstreamNanos).toBeNull();
  });

  it("says out loud that it is recording a paid plate as a free one", async () => {
    /* The other half of the case above, and the reason it is a separate `it`:
       the row's shape is what the ledger *keeps*, and this is what a person
       gets told. A warning nobody has watched fire is not a warning — it is a
       line of code that looks like one (docs/reusable/silent-success.md), and
       this exact narrowing is where a real bill would go missing. */
    const warn = vi.fn();
    vi.spyOn(await import("../src/log.js"), "log").mockReturnValue({
      warn,
      info: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    } as unknown as ReturnType<typeof import("../src/log.js").log>);

    await draw(ASK, { body: drawn({ usage: { ...BYOK_USAGE, is_byok: false } }) });

    expect(warn).toHaveBeenCalledTimes(1);
    const [fields, message] = warn.mock.calls[0] as [Record<string, unknown>, string];
    expect(message).toMatch(/recorded as free and is not/);
    /* The number a person needs in order to go and look, and nothing that
       could carry a prompt or a line of the article — src/log-redaction.ts. */
    expect(fields.upstreamCostNanos).toBe(13_237_000);
    expect(fields.wire).toBe("images");
    expect(Object.keys(fields).sort()).toEqual(["isByok", "job", "upstreamCostNanos", "wire"]);
  });

  it("stays quiet on an ordinary BYOK plate, where the zero is the whole design", async () => {
    /* The guard against the noisy version of the fix: a warning that fires on
       every plate this app draws is a warning that gets filtered out, and then
       the real one goes with it. `is_byok: true` is the normal case here. */
    const warn = vi.fn();
    vi.spyOn(await import("../src/log.js"), "log").mockReturnValue({
      warn,
      info: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    } as unknown as ReturnType<typeof import("../src/log.js").log>);

    await draw(ASK, { body: drawn({ usage: BYOK_USAGE }) });

    expect(warn).not.toHaveBeenCalled();
  });

  it("records exactly one row, with an error on it, when the provider refuses", async () => {
    const { result, rows, report } = await draw(ASK, {
      status: 429,
      body: "you are sending us a reader's whole article back",
      headers: { "retry-after": "7", "x-generation-id": "gen-refused" },
    });
    expect(result).toBeInstanceOf(ProviderRefused);
    const refused = result as ProviderRefused;
    expect(refused.status).toBe(429);
    expect(refused.retryAfterMs).toBe(7000);
    expect(refused.message).not.toContain("reader's whole article");
    expect(JSON.stringify(refused)).not.toContain("reader's whole article");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.outcome).toBe("error");
    expect(rows[0]?.wire).toBe("images");
    /* No usage arrived, so there is no figure — `none`, never a zero, which is
       what a genuinely free call would look like. */
    expect(rows[0]?.costSource).toBe("none");
    expect(rows[0]?.creditsUsedNanos).toBeNull();
    expect(rows[0]?.byokUpstreamNanos).toBeNull();
    /* The only handle left on a call that produced no usage object at all. */
    expect(rows[0]?.generationId).toBe("gen-refused");
    expect(report.pending).toHaveLength(0);
  });

  /**
   * **A refusal that told us what it cost, and the ledger keeping it.**
   *
   * `openRouterImage` used to throw on the status *before* parsing the body, so
   * a `429` carrying a real `usage` block recorded an unpriced error row for a
   * plate the provider had already charged for. Nothing about a non-2xx makes
   * its `usage` less true — GPT Sol, 2026-09-03. The row is still an `error`,
   * because that is what the call was.
   */
  it("keeps the money off a refusal whose body carried usage", async () => {
    const { result, rows } = await draw(ASK, {
      status: 429,
      body: JSON.stringify({
        error: { message: "rate limited, and here is the plate we already drew" },
        usage: BYOK_USAGE,
      }),
      headers: { "x-generation-id": "gen-priced-refusal" },
    });
    expect(result).toBeInstanceOf(ProviderRefused);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.outcome).toBe("error");
    expect(rows[0]?.costSource).toBe("provider");
    expect(rows[0]?.creditsUsedNanos).toBe(0);
    expect(rows[0]?.byokUpstreamNanos).toBe(13_237_000);
    expect(rows[0]?.reportedInputTokens).toBe(1085);
    /* And still not a word of the body in what the caller is told. */
    expect((result as Error).message).not.toContain("plate we already drew");
  });

  it("records one error row for a 200 whose body is not JSON at all", async () => {
    /* A gateway that answers `200` with an HTML error page. The parse failure
       is swallowed — V8 puts a prefix of the input into the `SyntaxError`, and
       the input wraps a prompt quoted from the article — so what the caller
       gets is `readPlate`'s own sentence. */
    const { result, rows } = await draw(ASK, { body: "<html>upstream is having a moment</html>" });
    expect((result as Error).message).toMatch(/no picture/);
    expect((result as Error).message).not.toContain("upstream is having a moment");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.outcome).toBe("error");
    expect(rows[0]?.costSource).toBe("none");
  });

  it("records the call when the body itself fails to arrive", async () => {
    /* `response.text()` rejecting is a connection that died mid-body: the
       request was made and may have been billed, so it is a row. */
    vi.stubGlobal("fetch", async () => ({
      ok: true,
      status: 200,
      headers: new Headers(),
      text: async () => {
        throw new TypeError("terminated");
      },
    }));
    const { report } = await collectSpend(
      async () => openRouterImage("illustrate", ASK).catch((e: unknown) => e),
      { attribution: { scopeKind: "cli", ownerId: environmentOwnerId() } },
    );
    expect(report.calls).toHaveLength(1);
    expect(report.calls[0]?.outcome).toBe("error");
    expect(report.pending).toHaveLength(0);
  });

  /**
   * **A signal that was already aborted, characterised rather than blessed.**
   *
   * `fetch` rejects immediately, so no request is made — and yet a row is
   * written, because the meter is constructed before the call. That is the
   * opposite of the "no attempt, no record" rule the missing-key case below
   * enforces, and it is left as it is for now: the row says `aborted` and costs
   * nothing, and `generateIllustrated` no longer hands this seam an
   * already-aborted signal (src/illustrated.ts § `drawPlates`). If a phantom
   * row ever matters, the fix is one `if` before `new Meter`.
   */
  it("writes an aborted row for a call that never left the process", async () => {
    const controller = new AbortController();
    controller.abort();
    /* `fetch`'s own behaviour, spelled out: an already-aborted signal rejects
       before a byte goes out. The seam does not check the signal itself, so
       this is the only thing standing between an aborted run and a real
       request — worth pinning, because a stub that ignored the signal answered
       `200` and the row said `ok`. */
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      if (init.signal?.aborted) {
        const err = new Error("This operation was aborted");
        err.name = "AbortError";
        throw err;
      }
      return { ok: true, status: 200, headers: new Headers(), text: async () => drawn() } as unknown as Response;
    });
    const { report } = await collectSpend(
      async () =>
        openRouterImage("illustrate", ASK, { signal: controller.signal }).catch(
          (e: unknown) => e,
        ),
      { attribution: { scopeKind: "cli", ownerId: environmentOwnerId() } },
    );
    expect(report.calls).toHaveLength(1);
    expect(report.calls[0]?.outcome).toBe("aborted");
  });

  it("records the call even when the request never connected", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("fetch failed");
    });
    const { report } = await collectSpend(
      async () => openRouterImage("illustrate", ASK).catch((e: unknown) => e),
      { attribution: { scopeKind: "cli", ownerId: environmentOwnerId() } },
    );
    expect(report.calls).toHaveLength(1);
    expect(report.calls[0]?.outcome).toBe("error");
    expect(report.pending).toHaveLength(0);
  });

  it("writes no row at all when there was never a request to make", async () => {
    /* The inverse of *one record, one network attempt*: no attempt, no record.
       A missing key fails before the meter is constructed — see `prepare` in
       src/ai-call.ts, which learned this from a spend row for a call that never
       left the process. */
    vi.stubEnv("OPENROUTER_API_KEY", "");
    const sent = stubTransport(200, drawn());
    const { result, report } = await collectSpend(
      async () => openRouterImage("illustrate", ASK).catch((e: unknown) => e),
      { attribution: { scopeKind: "cli", ownerId: environmentOwnerId() } },
    );
    expect((result as Error).message).toMatch(/ai-not-set-up/);
    expect(sent).toHaveLength(0);
    expect(report.calls).toHaveLength(0);
    expect(report.pending).toHaveLength(0);
  });
});

describe("the request that actually goes out", () => {
  it("posts to the images endpoint and sends none of the chat wire's furniture", async () => {
    const { sent } = await draw();
    /* The literal, not the constant it was built from: a test that asserts a
       value against its own source asserts nothing. */
    expect(sent[0]?.url).toBe("https://openrouter.ai/api/v1/images");
    expect(sent[0]?.headers.Authorization).toBe("Bearer sk-test-key");
    expect(sent[0]?.headers["X-Title"]).toBe("Spideryarn");
    /* **None of these three, and each absence is a measurement rather than an
       oversight.** `provider` is `AI_JOB_ROUTE`'s chat-wire routing policy and
       has never been tried against this endpoint; `usage: {include: true}` is
       unnecessary, because the spike got a full `usage` block back without
       asking; and there is no streaming here at all. `env-proposal` in
       src/ai-call.ts is this repo's write-up of what one unverified field in a
       body costs — a 404 with no endpoints left, which the feature reported as
       "the model could not be reached". */
    expect(sent[0]?.body.provider).toBeUndefined();
    expect(sent[0]?.body.usage).toBeUndefined();
    expect(sent[0]?.body.stream).toBeUndefined();
    expect(sent[0]?.body).toMatchObject({
      model: "openai/gpt-image-2",
      prompt: "an antique map of the argument",
      n: 1,
      aspect_ratio: "2:3",
      quality: "low",
    });
  });

  it("carries reference images in the shape the endpoint takes", async () => {
    const { sent } = await draw({
      ...ASK,
      inputReferences: [
        { dataUrl: "data:image/png;base64,AAAA" },
        { dataUrl: "data:image/jpeg;base64,BBBB" },
      ],
    });
    /* The style-continuity trick the spike found: the overview plate goes back
       in as a reference so the zoom plates come out in the same illustrator's
       hand. Getting this shape wrong is not an error — the endpoint would draw
       without the reference, and the only symptom would be plates that look
       like different books. */
    expect(sent[0]?.body.input_references).toEqual([
      { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } },
      { type: "image_url", image_url: { url: "data:image/jpeg;base64,BBBB" } },
    ]);
  });

  it("omits input_references entirely when there are none, rather than sending an empty list", async () => {
    /* `input_references` is documented as 0-16, and an empty array is a value
       inside that range that nothing has been measured against. Omission is
       what the spike sent when it sent none, so omission is what we send. */
    const none = await draw(ASK);
    expect(none.sent[0]?.body).not.toHaveProperty("input_references");
    const empty = await draw({ ...ASK, inputReferences: [] });
    expect(empty.sent[0]?.body).not.toHaveProperty("input_references");
  });

  it("leaves out the optional fields the caller did not ask for", async () => {
    const { sent } = await draw({ model: "openai/gpt-image-2", prompt: "a plate" });
    expect(sent[0]?.body).not.toHaveProperty("aspect_ratio");
    expect(sent[0]?.body).not.toHaveProperty("quality");
    expect(sent[0]?.body.n).toBe(1);
  });
});
