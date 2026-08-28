/**
 * **The embeddings client, and what it refuses to believe.**
 *
 * Every check under test here guards a failure that produces a real number.
 * That is the whole reason they exist rather than a comment saying the provider
 * is well-behaved: a duplicated `index`, an out-of-range one, a short vector or
 * a `null` that JSON coerced to zero all leave you with cosines that compute,
 * sort and draw. Nothing throws, nothing looks wrong, and the picture is
 * confidently about the wrong passages — docs/reusable/silent-success.md.
 *
 * The transport is faked. What is being tested is our reading of a response,
 * not OpenRouter.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { canRetry, placingFailed } from "../src/messages.js";
import {
  BATCH,
  cosine,
  dot,
  embedAll,
  embedBatch,
  EmbeddingFailure,
  normalise,
} from "../src/embeddings.js";

type Datum = { index: number; embedding: number[] };

/** Stand in for `fetch` with one canned 200. */
function answers(data: Datum[]): void {
  vi.stubGlobal("fetch", async () =>
    new Response(JSON.stringify({ data, usage: { prompt_tokens: 3 } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );
}

const call = (n: number) => embedBatch("m", Array.from({ length: n }, (_, i) => `t${i}`), "k", null);

afterEach(() => vi.unstubAllGlobals());

describe("embedBatch", () => {
  it("puts the vectors back in the order asked for, not the order sent", () => {
    /* **OpenRouter does not promise the order of `data[]`.** If it ever comes
       back permuted and we trust the array, every vector is still a real
       vector, every cosine is still a real number, and every passage is matched
       against the wrong neighbour. Inherited from the eval this was lifted
       from, and kept for the same reason. */
    answers([
      { index: 1, embedding: [0, 1] },
      { index: 0, embedding: [1, 0] },
    ]);
    return expect(call(2)).resolves.toMatchObject({ vectors: [[1, 0], [0, 1]] });
  });

  it("refuses a response that names one index twice", async () => {
    // Two answers for slot 0 and none for slot 1: without this check the second
    // overwrites the first, slot 1 stays empty, and the "no vector at index"
    // guard fires with a confusing message about the wrong thing.
    answers([
      { index: 0, embedding: [1, 0] },
      { index: 0, embedding: [0, 1] },
    ]);
    await expect(call(2)).rejects.toThrow(/came back twice/);
  });

  it("refuses an index outside the range asked for", async () => {
    answers([
      { index: 0, embedding: [1, 0] },
      { index: 7, embedding: [0, 1] },
    ]);
    await expect(call(2)).rejects.toThrow(/outside 0\.\.1/);
  });

  it("refuses a response whose vectors are not all the same length", async () => {
    /* A short vector is the quietest failure of the lot: `cosine` compares it
       against the first N components of its partner, which is a real number
       between −1 and 1 and is not a similarity. */
    answers([
      { index: 0, embedding: [1, 0, 0] },
      { index: 1, embedding: [0, 1] },
    ]);
    await expect(call(2)).rejects.toThrow(/dimensions/);
  });

  it("refuses a vector with a non-finite value in it", async () => {
    answers([
      { index: 0, embedding: [1, 0] },
      { index: 1, embedding: [0, Number.NaN] },
    ]);
    await expect(call(2)).rejects.toThrow(/non-finite/);
  });

  it("refuses an empty vector", async () => {
    answers([
      { index: 0, embedding: [1, 0] },
      { index: 1, embedding: [] },
    ]);
    await expect(call(2)).rejects.toThrow(/no vector/);
  });

  it("fails fast on the 404 that is an account setting, without retrying", async () => {
    /* "No endpoints available matching your guardrail restrictions" is a 404
       and reads exactly like a mistyped model id. It is the account's privacy
       settings refusing every upstream, so retrying cannot help — and five
       backoffs before the real message is a minute of waiting for a sentence
       that was available immediately. */
    let calls = 0;
    vi.stubGlobal("fetch", async () => {
      calls++;
      return new Response("No endpoints available matching your guardrail restrictions", {
        status: 404,
      });
    });
    await expect(call(1)).rejects.toThrow(/account setting/);
    expect(calls).toBe(1);
  });

  it("refuses a 200 that carries no vectors, in words rather than a TypeError", async () => {
    /* `openRouterJson` hands back `unknown`, deliberately. Without a check the
       cast reaches `body.data.length` and throws a raw `TypeError` naming a
       property — a pipeline failure that says nothing about what happened.
       Raised by a GPT Sol review. */
    vi.stubGlobal(
      "fetch",
      async () => new Response(JSON.stringify({ error: { message: "nope" } }), { status: 200 }),
    );
    await expect(call(1)).rejects.toThrow(/carried no vectors/);
  });

  it("does not treat an ordinary 404 as that", async () => {
    vi.stubGlobal(
      "fetch",
      async () => new Response("model not found", { status: 404 }),
    );
    /* **The status, without the provider's words.** This used to assert
       `/404 model not found/` — the status *and* the body — and the body half is
       deliberately gone: an embeddings request carries the article's own
       paragraphs, so an upstream that echoes the request back would put article
       prose into an error thrown from a pipeline stage, which
       docs/project/logging.md forbids from reaching a log. Raised by a GPT Sol
       review of src/ai-call.ts.

       What the test still has to prove is the distinction that matters: this
       404 is not the "no endpoints available" one, so it must not carry that
       message or its instructions. Asserting the absence is the half that would
       otherwise be lost with the body. */
    await expect(call(1)).rejects.toThrow(/embeddings m: 404/);
    await expect(call(1)).rejects.not.toThrow(/account setting/);
  });
});

/**
 * **Whose fault it was, as a value the route can branch on.**
 *
 * These are the assertions that were missing while Drift, Trail and Force were
 * dead in production for a fortnight. The classification existed — it was a
 * *prefix on a message*, `startsWith("embeddings ")`, which is only ever as good
 * as the wording and was not good enough. Nothing tested it, because a test for
 * "does this string begin with this string" reads like a test of nothing.
 *
 * docs/plans/embedding-endpoints-refused.md.
 */
describe("what an embedding failure says about itself", () => {
  const failureOf = async (n = 1): Promise<EmbeddingFailure> => {
    try {
      await call(n);
    } catch (err) {
      expect(err, "not a typed embedding failure").toBeInstanceOf(EmbeddingFailure);
      return err as EmbeddingFailure;
    }
    throw new Error("it did not fail at all, so there is no failure to read");
  };
  const reasonOf = async (n = 1): Promise<string> => (await failureOf(n)).reason;

  it("calls the guardrail 404 a configuration problem, not the provider being down", async () => {
    /* **The one that shipped.** Production's OpenRouter account was not allowed
       to use the embedding model, and every reader was told the model "could
       not be reached" — a sentence about a network, under which the only sane
       thing to do is try again, which could never have worked. `config` is what
       makes the route say "somebody has to fix this here" instead. */
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response("No endpoints available matching your guardrail restrictions", { status: 404 }),
    );
    await expect(reasonOf()).resolves.toBe("config");
  });

  it("calls a refused status the provider's fault", async () => {
    vi.stubGlobal("fetch", async () => new Response("model not found", { status: 404 }));
    await expect(reasonOf()).resolves.toBe("provider");
  });

  it("calls a connection that never opened the provider's fault too", async () => {
    /* **The gap the prefix match left, and the ordinary failure.** `fetch`
       rejects with a bare `TypeError` when DNS fails or the socket drops — no
       status, no body, and a message that begins with nothing in particular. It
       matched no prefix, so it escaped every embedding-aware branch and reached
       the route's catch-all as an unexplained 500: the provider being
       *unreachable* was the one provider failure that did not read as one.
       ⟨Sol⟩ */
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("fetch failed");
    });
    await expect(reasonOf()).resolves.toBe("provider");
  });

  it("does not answer a permanent refusal with 'try again'", async () => {
    /* **The mistake this whole change exists to stop, made one layer up.** The
       first version of the typed reasons called every refusal except the
       guardrail 404 `provider`, and the route reported `provider` as a
       transient blip — so an invalid key, exhausted credit, a 403 and a payload
       too big were all answered with "waiting a few seconds and trying again
       usually works". Found by ⟨Sol⟩ running the statuses rather than reading
       the claim, which is why the statuses are run here.

       The reason stays `provider` — the provider is who refused — and the
       *status* is what carries the difference, so `placingFailed` can hand it to
       `providerHttpFailure` and get the sentence that status has always had. */
    for (const status of [400, 401, 402, 403, 413]) {
      vi.stubGlobal("fetch", async () => new Response("no", { status }));
      const failure = await failureOf();
      expect(failure.reason, `status ${status}`).toBe("provider");
      expect(failure.status, `status ${status}`).toBe(status);
      const shown = placingFailed(failure.reason, failure.status);
      expect(canRetry(shown.kind), `${status}: ${shown.message}`).toBe(false);
    }
  });

  it("still says 'try again' for the statuses where another go can work", async () => {
    /* The other half, and the half that makes the test above mean something: a
       check that called everything permanent would pass the first assertion and
       be just as wrong. 429 and 503 are the provider being busy. */
    for (const status of [429, 503]) {
      vi.stubGlobal("fetch", async () => new Response("no", { status, headers: { "retry-after": "1" } }));
      const failure = await failureOf();
      expect(failure.status, `status ${status}`).toBe(status);
      expect(canRetry(placingFailed(failure.reason, failure.status).kind), `${status}`).toBe(true);
    }
  }, 20_000);

  it("carries no status when nothing answered, so it is not mistaken for a refusal", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("fetch failed");
    });
    await expect(failureOf().then((f) => f.status)).resolves.toBeNull();
  });

  it("refuses an entry of the response that is not an object at all", async () => {
    /* `{"data":[null]}` is a real thing a 200 can carry, and it used to reach
       `d.index` and throw `Cannot read properties of null` — an untyped
       `TypeError` escaping the boundary this file had just claimed was wholly
       typed. ⟨Sol⟩ found it by testing the claim. */
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ data: [null] }), { status: 200 }));
    const failure = await failureOf();
    expect(failure.reason).toBe("provider");
    expect(failure.message).toMatch(/entry 0 of the response is not an object/);
  });

  it("does not repeat what the provider said, whatever the reason", async () => {
    /* An embeddings request carries the article's own paragraphs, so an upstream
       that echoes the request back would put article prose into a thrown error —
       and this error now reaches a log with its `reason` attached, which is
       exactly the place docs/project/logging.md forbids prose from reaching. */
    vi.stubGlobal(
      "fetch",
      async () => new Response("the article said: a horse walked into a bar", { status: 400 }),
    );
    await expect(call(1)).rejects.not.toThrow(/horse/);
  });
});

describe("normalise and dot", () => {
  it("agree with cosine, which is the point of having both", () => {
    const a = [3, 4, 0];
    const b = [0, 4, 3];
    const [ua, ub] = [normalise(a), normalise(b)];
    expect(ua && ub && dot(ua, ub)).toBeCloseTo(cosine(a, b));
  });

  it("gives back null for a vector with no direction, rather than NaN", () => {
    /* A zero vector divided by its zero norm is a vector of NaN, and NaN
       compares false against everything — so such a passage would not error,
       it would sort wherever the sort happened to leave it. */
    expect(normalise([0, 0, 0])).toBeNull();
    expect(cosine([0, 0], [1, 1])).toBe(0);
  });

  it("is length one, so a dot product really is a cosine", () => {
    const u = normalise([5, 12]);
    let sum = 0;
    for (const x of u ?? []) sum += x * x;
    expect(sum).toBeCloseTo(1);
  });
});

describe("embedAll, across more than one batch", () => {
  /* ⟨Sol⟩ Every test above sends one batch, so the checks that only exist
     *between* batches had nothing exercising them. An article of 97 passages is
     two requests, and that is where a provider can change its mind. */

  it("refuses a second batch that comes back a different width", async () => {
    /* **Undetectable downstream.** `dot` used to walk the shorter vector, so
       every comparison between a 1024-dimensional batch and a 1536-dimensional
       one was a real number computed over the first 1024 components of
       something that means something else. No error, no warning, wrong
       picture. */
    let call = 0;
    vi.stubGlobal("fetch", async (_u: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { input: string[] };
      const width = call++ === 0 ? 2 : 3;
      const data = body.input.map((_t, i) => ({
        index: i,
        embedding: Array.from({ length: width }, () => 0.5),
      }));
      return new Response(JSON.stringify({ data, usage: {} }), { status: 200 });
    });
    const texts = Array.from({ length: BATCH + 1 }, (_, i) => `t${i}`);
    await expect(embedAll(texts, { inputType: null, apiKey: "k" })).rejects.toThrow(
      /3-dimensional, not 2/,
    );
  });

  it("keeps every batch's vectors, in order", async () => {
    vi.stubGlobal("fetch", async (_u: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { input: string[] };
      const data = body.input.map((t, i) => ({ index: i, embedding: [Number(t.slice(1)), 0] }));
      return new Response(JSON.stringify({ data, usage: {} }), { status: 200 });
    });
    const texts = Array.from({ length: BATCH + 5 }, (_, i) => `t${i}`);
    const { vectors } = await embedAll(texts, { inputType: null, apiKey: "k" });
    expect(vectors).toHaveLength(BATCH + 5);
    // The seam between the two batches is where an off-by-one would show.
    expect(vectors[BATCH - 1]?.[0]).toBe(BATCH - 1);
    expect(vectors[BATCH]?.[0]).toBe(BATCH);
  });

  it("refuses to compare vectors of different lengths at all", () => {
    // The last line of defence, below every check above.
    expect(() => cosine([1, 2], [1, 2, 3])).toThrow(/dimensional/);
    const a = normalise([1, 0]);
    const b = normalise([1, 0, 0]);
    expect(() => (a && b ? dot(a, b) : 0)).toThrow(/dimensional/);
  });
});
