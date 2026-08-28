/**
 * **What the two pictures that read passages for meaning answer with when they
 * cannot** — the seam between `EmbeddingFailure` and the reader.
 *
 * `tests/embeddings.test.ts` pins the classification and `tests/messages.test.ts`
 * pins the sentences. Neither covers the join, and the join is where this
 * feature's whole production life went wrong: the classification was right, the
 * sentence was right, and the route in between said "could not be reached" to a
 * reader whose only useful move was to tell somebody. ⟨Sol⟩ asked for these.
 *
 * The value under test is the one that crosses the seam — an `EmbeddingFailure`
 * in, an HTTP status and a reader's sentence out.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { EmbeddingFailure } from "../src/embeddings.js";
import { kindOfMessage, worthRetrying } from "../src/messages.js";
import { embeddingHttpError } from "../src/routes.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** The status and sentence a failure turns into, as the route would send them. */
function answerTo(failure: EmbeddingFailure): { status: number; message: string } {
  const err = embeddingHttpError(failure, "some-slug") as Error & { status?: number };
  return { status: err.status ?? 0, message: err.message };
}

describe("what a failed picture answers with", () => {
  it("blames this server, not the gateway, when this app is not set up", () => {
    /* **500 rather than 502**, which is not pedantry: 502 claims to be a healthy
       gateway whose upstream let it down, and the upstream did nothing wrong
       here — it declined an account that may not use the model. ⟨Sol⟩ */
    const { status, message } = answerTo(new EmbeddingFailure("config", "no endpoints"));
    expect(status).toBe(500);
    expect(kindOfMessage(message)).toBe("ours");
    expect(worthRetrying(message), message).toBe(false);
  });

  it("says 503 for its own back pressure, and offers another go", () => {
    // Ours, not the provider's — nothing upstream has been asked anything.
    const { status, message } = answerTo(new EmbeddingFailure("busy", "busy: 4 already"));
    expect(status).toBe(503);
    expect(worthRetrying(message), message).toBe(true);
  });

  it("says 502 and offers another go when nothing answered", () => {
    const { status, message } = answerTo(new EmbeddingFailure("provider", "socket died"));
    expect(status).toBe(502);
    expect(worthRetrying(message), message).toBe(true);
  });

  it("never invites another go past a refusal that will be refused again", () => {
    /* The regression test for the second version of this bug. Each of these is a
       `provider` failure — the provider is who refused — and each is permanent,
       so the *status* has to reach the reader's sentence. Before this, all five
       came out as "waiting a few seconds and trying again usually works". */
    for (const status of [400, 401, 402, 403, 413]) {
      const { message } = answerTo(new EmbeddingFailure("provider", `embeddings m: ${status}`, { status }));
      expect(worthRetrying(message), `${status}: ${message}`).toBe(false);
    }
  });

  it("still offers another go when the provider was merely busy", () => {
    // Without this the test above is satisfied by refusing every retry.
    for (const status of [429, 500, 502, 503, 504]) {
      const { message } = answerTo(new EmbeddingFailure("provider", `embeddings m: ${status}`, { status }));
      expect(worthRetrying(message), `${status}: ${message}`).toBe(true);
    }
  });

  it("hands a failure that is not about embedding straight back", () => {
    /* **The guard that keeps a bug of ours looking like a bug of ours.**
       Everything after the model call is our own arithmetic — principal
       components, k-means, the ranking — and reporting a defect there as an
       upstream outage sends whoever is debugging to a status page. Returned
       unchanged, so the route's catch-all reports a 500 with a stack. */
    const bug = new TypeError("cannot read properties of undefined");
    expect(embeddingHttpError(bug, "some-slug")).toBe(bug);
  });

  it("never shows the reader what the failure actually said", () => {
    /* The thrown message names the key in use and an account setting, and the
       one an embeddings call could carry is worse: the request is the article's
       own paragraphs. None of it reaches the browser. */
    const secret = "key in use: sk-or-v1-abc… and a horse walked into a bar";
    const { message } = answerTo(new EmbeddingFailure("config", secret));
    expect(message).not.toMatch(/sk-or-v1|horse/);
  });
});

describe("both pictures fail the same way", () => {
  it("routes Force and Drift through the one mapping", () => {
    /* A tripwire, not a proof. The two routes disagreed for a fortnight —
       `projection` let a bug of ours fall through and `similar` reported it as
       an outage — because each made these decisions for itself, and the fix that
       was written for one was not written for the other twenty lines above. The
       cheapest guard against that recurring is that neither route builds its own
       answer. */
    const routes = readFileSync(path.join(ROOT, "src", "routes.ts"), "utf8");
    const uses = routes.match(/throw embeddingHttpError\(/g) ?? [];
    expect(uses.length, "both the similar and projection routes must use it").toBe(2);
    /* And the sentences must not have come back inline. `[emb1]` and `[emb2]`
       were hand-rolled here and in no table, which is how they ended up
       unregistered — see src/messages.ts § placing passages. */
    expect(routes).not.toMatch(/\[emb\d\]/);
  });
});
