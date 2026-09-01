/**
 * The four routes behind Referee's Criteria — `/api/referee/criteria/…` in
 * src/routes.ts.
 *
 * No server and no network: `handleApi` is a plain function over a request and
 * a response, which is the same harness tests/routes.test.ts uses. **Nothing
 * here reaches a model**, and that is load-bearing rather than lucky: every
 * request under test is refused by validation, and validation happens before a
 * single response header is written. A POST that got past it would open a
 * stream and try to call OpenRouter, so a test that stopped failing would fail
 * loudly rather than quietly start spending money.
 *
 * What this file is actually for is the sentence *the validators are wired to
 * the routes*. `criterionProblem` and the kind and scale guards are all tested
 * as functions elsewhere (tests/referee-criteria.test.ts); a validator nobody
 * calls passes its own tests perfectly.
 *
 * Writes under `data/<throwaway slug>/`, which is gitignored, and removes it.
 */

import { rm } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { handleApi } from "../src/routes.js";
import { beginCriterion, loadCriteria } from "../src/referee-criteria-store.js";
import { acceptAny, AUTHED_HEADERS } from "./helpers/authed.js";

const SLUG = "test-referee-criteria-routes";
const DIR = path.resolve(import.meta.dirname, "..", "data", SLUG);
afterEach(() => rm(DIR, { recursive: true, force: true }));

interface Reply {
  status: number;
  body: { error?: string; criteria?: { id: string; colour?: number }[]; [k: string]: unknown };
  /** True if anything wrote a response header — i.e. a stream was opened. */
  streamed: boolean;
}

/**
 * Drive `handleApi` with a fake request/response pair.
 *
 * The response deliberately has **no** `writeHead`, `write` or `on`, exactly as
 * tests/routes.test.ts's `call` does: a request that got as far as opening a
 * stream would throw here rather than pass, which is what makes "validation
 * happens before a header" a property this file can actually check.
 */
async function call(method: string, url: string, body?: unknown): Promise<Reply> {
  const payload = body === undefined ? [] : [Buffer.from(JSON.stringify(body))];
  const req = Object.assign(
    (async function* () {
      yield* payload;
    })(),
    { method, url, headers: AUTHED_HEADERS },
  ) as unknown as IncomingMessage;

  let status = 0;
  let text = "";
  let streamed = false;
  const res = {
    set statusCode(v: number) {
      status = v;
    },
    get statusCode() {
      return status;
    },
    setHeader() {},
    writeHead() {
      streamed = true;
    },
    end(chunk: string) {
      text = chunk;
    },
  } as unknown as ServerResponse;

  await handleApi(req, res, acceptAny);
  return { status, body: text ? JSON.parse(text) : {}, streamed };
}

const POST = `/api/referee/criteria/${SLUG}`;

describe("POST — what a criterion has to be before a model is called", () => {
  it("refuses a body that is not an object at all", async () => {
    // `readBody` will happily return a bare JSON `null`; destructuring one is a
    // `TypeError` the generic handler turns into a 500, which is the one thing
    // validation must never do.
    const reply = await call("POST", POST, null);
    expect(reply.status).toBe(400);
    expect(reply.streamed).toBe(false);
  });

  it("refuses an empty criterion", async () => {
    const reply = await call("POST", POST, { criterion: "   ", kind: "single" });
    expect(reply.status).toBe(400);
    expect(reply.body.error).toMatch(/criterion/);
  });

  it("refuses a criterion long enough to push the paper out of the context window", async () => {
    const reply = await call("POST", POST, { criterion: "x".repeat(501), kind: "single" });
    expect(reply.status).toBe(400);
    expect(reply.body.error).toMatch(/500 characters/);
  });

  it("refuses a kind that is not one of the three", async () => {
    const reply = await call("POST", POST, { criterion: "Controls?", kind: "verdict" });
    expect(reply.status).toBe(400);
    expect(reply.body.error).toMatch(/single, diverging or literature/);
  });

  it("refuses a missing kind rather than guessing one", async () => {
    const reply = await call("POST", POST, { criterion: "Controls?" });
    expect(reply.status).toBe(400);
  });

  /* The rule the database also holds (`referee_criteria_diverging_shape`): a
     two-ended criterion with one pole has a signed number pointing at nothing,
     and the panel could not print the direction in words — which
     docs/project/colour-scales.md requires. */
  it("refuses a diverging criterion with no poles", async () => {
    const reply = await call("POST", POST, { criterion: "Controls?", kind: "diverging" });
    expect(reply.status).toBe(400);
    expect(reply.body.error).toMatch(/poles/);
  });

  it("refuses a diverging criterion with one pole", async () => {
    const reply = await call("POST", POST, {
      criterion: "Controls?",
      kind: "diverging",
      poles: { against: "missing" },
    });
    expect(reply.status).toBe(400);
  });

  it("refuses a diverging criterion whose poles are blank, saying which half", async () => {
    const reply = await call("POST", POST, {
      criterion: "Controls?",
      kind: "diverging",
      poles: { against: "  ", favour: "  " },
    });
    expect(reply.status).toBe(400);
    // `criterionProblem`'s own sentence, so the reason travels from the module
    // that owns the rule rather than being reworded at the route.
    expect(reply.body.error).toMatch(/a word for each end/);
  });

  it("refuses a scale that names no ramp we have", async () => {
    const reply = await call("POST", POST, {
      criterion: "Controls?",
      kind: "diverging",
      poles: { against: "missing", favour: "settled" },
      scale: "rainbow",
    });
    expect(reply.status).toBe(400);
    expect(reply.body.error).toMatch(/rg or br/);
  });

  it("writes nothing at all when a request is refused", async () => {
    await call("POST", POST, { criterion: "Controls?", kind: "diverging" });
    // Not "an empty list" — the file must not exist, because a refused request
    // that leaves state behind is the shape docs/reusable/silent-success.md is
    // about, one level down.
    expect(await loadCriteria(SLUG)).toEqual([]);
  });
});

describe("PATCH — the colour and nothing else", () => {
  it("refuses a colour neither store would write", async () => {
    const begun = await beginCriterion(SLUG, "Controls?", { kind: "single" });
    const reply = await call("PATCH", `${POST}/${begun.id}`, { colour: 1.5 });
    expect(reply.status).toBe(400);
    expect(reply.body.error).toMatch(/small whole number/);
  });

  it("takes slot 0, which every `if (!colour)` in this app would have refused", async () => {
    const begun = await beginCriterion(SLUG, "Controls?", { kind: "single" });
    const reply = await call("PATCH", `${POST}/${begun.id}`, { colour: 0 });
    expect(reply.status).toBe(200);
    expect((await loadCriteria(SLUG))[0]?.colour).toBe(0);
  });

  it("takes null, which is how the referee asks for automatic", async () => {
    const begun = await beginCriterion(SLUG, "Controls?", { kind: "single" });
    await call("PATCH", `${POST}/${begun.id}`, { colour: 3 });
    const reply = await call("PATCH", `${POST}/${begun.id}`, { colour: null });
    expect(reply.status).toBe(200);
    const back = (await loadCriteria(SLUG))[0];
    expect(back && "colour" in back).toBe(false);
  });

  /* **`{ colour }` and nothing else.** Changing the question is what POST does,
     because a changed question needs a fresh model call and this route makes
     none — a PATCH that quietly rewrote the criterion would leave results on
     screen that answer a question nobody asked. */
  it("ignores everything but the colour", async () => {
    const begun = await beginCriterion(SLUG, "Controls?", { kind: "single" });
    await call("PATCH", `${POST}/${begun.id}`, {
      colour: 2,
      criterion: "something else entirely",
      kind: "diverging",
    });
    const back = (await loadCriteria(SLUG))[0];
    expect(back?.criterion).toBe("Controls?");
    expect(back?.config).toEqual({ kind: "single" });
    expect(back?.colour).toBe(2);
  });

  it("refuses a bare JSON null body with a 400 rather than a 500", async () => {
    const begun = await beginCriterion(SLUG, "Controls?", { kind: "single" });
    const reply = await call("PATCH", `${POST}/${begun.id}`, null);
    expect(reply.status).toBe(400);
  });
});

describe("DELETE", () => {
  it("removes the criterion and answers with what is left", async () => {
    const a = await beginCriterion(SLUG, "Controls?", { kind: "single" });
    await beginCriterion(SLUG, "Prior work?", { kind: "single" });
    const reply = await call("DELETE", `${POST}/${a.id}`);
    expect(reply.status).toBe(200);
    expect(reply.body.criteria).toHaveLength(1);
    expect(reply.body.criteria?.[0]?.id).not.toBe(a.id);
  });
});

describe("GET", () => {
  it("lists the criteria and the fingerprint to judge them against", async () => {
    await beginCriterion(SLUG, "Controls?", { kind: "single" });
    const reply = await call("GET", POST);
    expect(reply.status).toBe(200);
    expect(reply.body.criteria).toHaveLength(1);
    /* **And the fingerprint is absent here, which is worth pinning rather than
       glossing.** This fixture has no `blocks.json`, so the store answers
       `undefined` — and `JSON.stringify` deletes an `undefined` value outright,
       so the key does not reach the wire at all. The client reads
       `"sourceHash" in body`, so it correctly concludes *we have not been told*
       and marks nothing stale, which is the same answer search's GET gives for
       the same article and the safe way round to be wrong (`isStale`, and
       useCriteria.ts § fingerprint). What must never happen is a *hash* here,
       which would date the criteria to an article nobody read. */
    expect("sourceHash" in reply.body).toBe(false);
  });

  it("sweeps a pending criterion no process is running, so it can be run again", async () => {
    const begun = await beginCriterion(SLUG, "Controls?", { kind: "single" });
    const reply = await call("GET", POST);
    const row = reply.body.criteria?.find((c) => c.id === begun.id) as
      | { status?: string }
      | undefined;
    expect(row?.status).toBe("error");
  });
});
