/**
 * **What a reader's request cost** — the collector `handleApi` opens, and the
 * line it ends up on.
 *
 * Until 2026-08-27 the pipeline's unit of accounting was a step
 * ([`src/jobs.ts`](../src/jobs.ts)) and a reader's request had no unit at all.
 * The reader-facing model calls recorded into no collector, `unscopedCalls()`
 * counted them, and nothing added them up — which is the wrong ones to be
 * missing, because a chat turn or a dictation spends money on somebody's
 * *question*, and that is what Greg's *"spend limit per user"* is about.
 *
 * This drives `handleApi` for real: the request, the route, `src/ai-call.ts`,
 * and the line `logRequest` writes. Only `fetch` is replaced. The property being
 * checked is that the scope survives the whole request — which is what an
 * `AsyncLocalStorage` gives and a returned value does not.
 *
 * ## Why a child process
 *
 * [`src/log.ts`](../src/log.ts) builds its logger at import time and is `silent`
 * under `NODE_ENV=test`, so an in-process assertion would be satisfied by a
 * logger that emits nothing at all — the vacuous green this repo keeps a
 * document about (docs/reusable/silent-success.md). The child runs with
 * `NODE_ENV=development` and its stdout *is* the evidence. Same harness as
 * tests/chat-empty-answer-log.test.ts and tests/stop-details.test.ts.
 *
 * The first version of this file did not use a child, spied on
 * `process.stdout.write`, and captured nothing at all — pino's synchronous
 * destination writes to the file descriptor and never touches that method, so
 * every assertion read `undefined`. It failed loudly, which is the only reason
 * it is worth writing down.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

const TSX = fileURLToPath(new URL("../node_modules/.bin/tsx", import.meta.url));
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const src = (file: string) => JSON.stringify(path.join(ROOT, "src", file));
const helper = JSON.stringify(path.join(ROOT, "tests", "helpers", "authed.ts"));

/** Base64 long enough to clear `MIN_AUDIO_BASE64`, and canonically padded. */
const AUDIO = `${"A".repeat(3000)}AA==`;

/** The cost the fake provider reports, in dollars. Nano-dollars ×1e9 below. */
const COST = 0.000123;

let stdout = "";
let stderr = "";

beforeAll(() => {
  const body = `void (async () => {
    const AUDIO = ${JSON.stringify(AUDIO)};

    /* Three requests through one server, each with a different provider
       answer, so the three cases below are one child rather than three. */
    const replies = [
      /* 1. an ordinary success, with a cost on it */
      () => ({
        ok: true,
        status: 200,
        headers: new Headers({ "x-generation-id": "gen-dictation-1" }),
        text: async () => JSON.stringify({
          model: "google/gemini-3.1-flash-lite",
          choices: [{ message: { content: JSON.stringify({ transcript: "hello there" }) }, finish_reason: "stop" }],
          usage: { prompt_tokens: 900, completion_tokens: 4, cost: ${COST}, is_byok: false },
        }),
      }),
      /* 2. a success carrying no usage block at all — the failure that
            \`usage: { include: true }\` exists to prevent, seen from the
            reporting end. Zero dollars, and a field saying the zero is not a
            measurement. */
      () => ({
        ok: true,
        status: 200,
        headers: new Headers(),
        text: async () => JSON.stringify({
          model: "google/gemini-3.1-flash-lite",
          choices: [{ message: { content: JSON.stringify({ transcript: "hello there" }) }, finish_reason: "stop" }],
        }),
      }),
      /* 3. a refusal. The call happened; the money left before the failure did. */
      () => ({ ok: false, status: 429, headers: new Headers(), text: async () => "busy" }),
    ];
    let call = 0;
    globalThis.fetch = async () => replies[call++]();

    const { handleApi } = await import(${src("routes.ts")});
    const { acceptAny, AUTHED_HEADERS } = await import(${helper});

    const request = (payload) => {
      const req = Object.assign(
        (async function* () { yield Buffer.from(JSON.stringify(payload)); })(),
        { method: "POST", url: "/api/transcribe", headers: AUTHED_HEADERS },
      );
      let status = 0;
      const res = {
        set statusCode(v) { status = v; },
        get statusCode() { return status; },
        setHeader() {},
        end() {},
        write() { return true; },
        /* The dictation route listens for the reader hanging up. A fake
           response without these is a 500 that looks exactly like the failure
           under test. */
        on() {},
        off() {},
      };
      /* The same verifier every other handleApi suite uses. Not a permissive
         default in src/auth.ts — a seam the test hands in; see
         tests/helpers/authed.ts on why that distinction is load-bearing. */
      return handleApi(req, res, acceptAny);
    };

    /* \`context: { kind: "profile" }\` rather than an article, so nothing has to
       exist on disk — the vocabulary lookup for an article would go to the
       store, and this test is about the collector, not the shelf. */
    const dictation = { audio: AUDIO, format: "webm", context: { kind: "profile" } };
    await request(dictation);
    await request(dictation);
    await request(dictation);
    /* A fourth that never reaches a model: rejected at the route. */
    await request({ audio: "not base64!" });
  })();`;

  const env: NodeJS.ProcessEnv = { ...process.env };
  /* Neither the suite's LOG_LEVEL nor NODE_ENV=test may decide what this
     measures: "test" makes the logger silent, and every assertion below would
     then be satisfied by a child that printed nothing. */
  delete env.LOG_LEVEL;
  env.NODE_ENV = "development";
  /* The gateway refuses without a key, and that refusal would look exactly like
     the failure under test. Nothing is sent anywhere — `fetch` is replaced. */
  env.OPENROUTER_API_KEY = "test-key-not-a-real-one";

  const child = spawnSync(TSX, ["-e", body], {
    env,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  stdout = child.stdout ?? "";
  stderr = child.stderr ?? "";
}, 120_000);

/** The child's `http` lines, in the order they were written. */
function httpLines(): Record<string, unknown>[] {
  const found = stdout
    .split("\n")
    .filter((l) => l.trim().startsWith("{"))
    .map((l) => JSON.parse(l) as Record<string, unknown>)
    .filter((l) => l.component === "http");
  /* **Loud rather than empty.** If the child dies on an import, every
     assertion below reads `undefined` and the suite says four confusing things
     instead of one true one. */
  if (found.length !== 4) {
    throw new Error(
      `expected four http lines from the child, got ${found.length}\n` +
        `--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}`,
    );
  }
  return found;
}

describe("a request that reaches a model", () => {
  it("puts what it spent on the line it already writes", () => {
    const line = httpLines()[0];
    expect(line?.path).toBe("/api/transcribe");
    expect(line?.aiCalls).toBe(1);
    /* Nano-dollars, integers, so a long run does not drift — src/pricing.ts. */
    expect(line?.aiCostNanos).toBe(Math.round(COST * 1e9));
    expect(line?.aiCost).toBe("$0.0001");
    /* Absent, because neither went wrong. An ordinary line stays short and an
       unusual one says why.

       **`aiLateFinishes` used to be asserted here and is gone**, because no
       production code can emit that field — a vacuous assertion is not a weaker
       test, it is a line that will go on passing whatever happens. A late finish
       is counted process-wide by `lateCalls()`; see the comment there for why it
       cannot be a field on a line that has already been written. Raised by a GPT
       Sol review. */
    expect(line?.aiUnpriced).toBeUndefined();
    expect(line?.aiPending).toBeUndefined();
  });

  it("says so when a call reported no cost, rather than calling it free", () => {
    const line = httpLines()[1];
    expect(line?.aiCalls).toBe(1);
    expect(line?.aiCostNanos).toBe(0);
    expect(line?.aiUnpriced).toBe(1);
  });

  it("records a refused call too — the money left before the failure did", () => {
    const line = httpLines()[2];
    expect(line?.status).toBe(429);
    expect(line?.aiCalls).toBe(1);
    expect(line?.aiUnpriced).toBe(1);
  });

  it("gives each request its own box, so one reader's turn is not on another's line", () => {
    /* Three requests, one process, one call each. If the collector were a
       module-level array — or opened with `enterWith` rather than `run` — the
       second line would carry two calls and the third three. */
    for (const line of httpLines().slice(0, 3)) expect(line.aiCalls).toBe(1);
  });
});

describe("a request that reaches no model", () => {
  it("gets no cost fields at all", () => {
    /* Rejected at the route, before anything is sent. `aiCalls: 0` on every
       request would be noise; the fields appear when there is something to
       say. */
    const line = httpLines()[3];
    expect(line?.status).toBe(400);
    expect(line).not.toHaveProperty("aiCalls");
    expect(line).not.toHaveProperty("aiCost");
  });
});
