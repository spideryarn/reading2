/**
 * **Every way a fetch by address can fail has its own sentence on the job card,
 * and Retry only where another go can come out differently.**
 *
 * Until 2026-10-04 only `too-large` had one (tests/one-size-limit.test.ts). The
 * rest took the generic sentence for the step, which is `retry`, so a 404 was
 * offered a button that asked the same address and got the same answer.
 * docs/plans/261004l-four-small-queued-fixes-fetch-failure-sentences-composer-focus-stale-remember-param-marginalia-head-at-the-top.md § A.
 *
 * Four claims, each seen red before the code changed:
 *
 *  1. Through the pipeline's own fetch step, a 404 and a 413 are `blocked` with
 *     a `[fetch-…]` code and no Retry; a partial body stays `retry`.
 *  2. `http-error` is two answers, decided by the status it kept.
 *  3. Every `FetchFailureCode` has a sentence whose bracketed code reads back as
 *     the kind it was declared with.
 *  4. Neither the reader's sentence nor the diagnostic carries the address, the
 *     host, the fetcher's own message or the cause's.
 *
 * Assertions match on the code and the kind, never on the prose
 * (docs/project/copy.md § The bracketed code).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { FetchFailure, type FetchFailureCode, type FetchOptions } from "../src/fetch.js";
import { declaredFailure, failureKindOf, readerFailureOf } from "../src/job-failure.js";
import { codeOfMessage, fetchFailed, kindOfMessage, worthRetrying, type FailureKind } from "../src/messages.js";
import { STEPS } from "../src/pipeline.js";
import { nullCheckpointStore } from "../src/store/checkpoints.js";
import { memoryArtefacts } from "./helpers/memory-artefacts.js";

/**
 * The same seam tests/one-size-limit.test.ts uses, for the same reason: the
 * step passes `fetchDocument` no network of its own, so the real function is
 * reached through a mock that only adds the injected one.
 */
const network: { seams: FetchOptions | null } = { seams: null };

vi.mock("../src/fetch.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/fetch.js")>();
  return {
    ...real,
    fetchDocument: async (url: string, options: FetchOptions = {}) =>
      real.fetchDocument(url, { ...options, ...(network.seams ?? {}) }),
  };
});

afterEach(() => {
  network.seams = null;
});

/** Unlikely to appear in any sentence by accident, and all four are different. */
const SENTINEL_HOST = "sentinel-reading-history.example";
const SENTINEL_PATH = "sentinel-private-path";
const SENTINEL_MESSAGE = "SENTINEL_FETCHER_MESSAGE";
const SENTINEL_CAUSE = "SENTINEL_CAUSE_MESSAGE";
const SENTINELS = [SENTINEL_HOST, SENTINEL_PATH, SENTINEL_MESSAGE, SENTINEL_CAUSE, "secret=token"];

const ADDRESS = `https://${SENTINEL_HOST}/${SENTINEL_PATH}?secret=token`;

const ctx = () => ({
  slug: "test-fetch-failure-sentences",
  url: ADDRESS,
  report: () => {},
  preview: () => {},
  signal: new AbortController().signal,
  cacheArticle: false,
  power: "standard" as const,
});

/** One response from the injected network, and no socket. */
function answering(respond: () => Response | Promise<Response>): FetchOptions {
  return {
    attempts: 1,
    sleep: async () => {},
    resolve: async () => ["93.184.216.34"],
    fetchImpl: async () => respond(),
  };
}

/** What the fetch step threw, having failed. */
async function stepFailure(seams: FetchOptions): Promise<Error> {
  network.seams = seams;
  const thrown = await STEPS.fetch
    .run(ctx(), memoryArtefacts(), nullCheckpointStore())
    .then(() => null)
    .catch((err: unknown) => err);
  expect(thrown, "the fetch step succeeded").toBeInstanceOf(Error);
  return thrown as Error;
}

/** Everything about a thrown error that the log or Sentry could be handed. */
function everythingOn(err: Error): string {
  const cause = (err as { cause?: unknown }).cause;
  return [
    err.message,
    String(err),
    JSON.stringify(err, Object.getOwnPropertyNames(err).filter((key) => key !== "stack")),
    cause === undefined ? "" : String(cause),
    readerFailureOf(err, STEPS.fetch.label).message,
  ].join("\n");
}

describe("the job card under a fetch that failed", () => {
  it("is not offered Retry under a page that is not there", async () => {
    const thrown = await stepFailure(answering(() => new Response("gone", { status: 404 })));
    /* Declared, not fallen back to: the generic sentence is also a
       `ReaderFacingFailure`, so asking only `readerFailureOf` would pass on it. */
    const failure = declaredFailure(thrown);
    expect(failure, "the fetch step declared no sentence for a 404").not.toBeNull();
    expect(failure?.kind).toBe("blocked");
    expect(codeOfMessage(failure?.message ?? "")).toMatch(/^fetch-/);
    expect(failureKindOf(thrown)).toBe("blocked");
    expect(worthRetrying(readerFailureOf(thrown, STEPS.fetch.label).message)).toBe(false);
  });

  it("is not offered Retry under a refusal the site will repeat (a 413)", async () => {
    const thrown = await stepFailure(answering(() => new Response("no", { status: 413 })));
    const failure = declaredFailure(thrown);
    expect(failure, "the fetch step declared no sentence for a 413").not.toBeNull();
    expect(failure?.kind).toBe("blocked");
    expect(codeOfMessage(failure?.message ?? "")).toMatch(/^fetch-/);
    expect(worthRetrying(failure?.message ?? "")).toBe(false);
  });

  it("is still offered Retry under a body that arrived in part", async () => {
    const thrown = await stepFailure(
      answering(() => new Response("<p>half", { status: 206, headers: { "content-type": "text/html" } })),
    );
    const failure = declaredFailure(thrown);
    expect(failure, "the fetch step declared no sentence for a partial body").not.toBeNull();
    expect(failure?.kind).toBe("retry");
    expect(codeOfMessage(failure?.message ?? "")).toMatch(/^fetch-/);
    expect(worthRetrying(failure?.message ?? "")).toBe(true);
  });

  it("gives the two refusals different codes from each other and from the partial body", async () => {
    const codes = [];
    for (const status of [404, 413, 206]) {
      const thrown = await stepFailure(
        answering(() => new Response("x", { status, headers: { "content-type": "text/html" } })),
      );
      codes.push(codeOfMessage(readerFailureOf(thrown, STEPS.fetch.label).message));
    }
    expect(new Set(codes).size).toBe(3);
  });
});

describe("an unclassified status is two answers, not one", () => {
  const blocked = [400, 405, 406, 409, 413, 418, 451, 499];
  const retry = [null, 206, 304, 408, 425, 599];

  for (const status of blocked) {
    it(`${status}: the site will say the same again`, () => {
      expect(fetchFailed("http-error", status).kind).toBe("blocked");
    });
  }
  for (const status of retry) {
    it(`${String(status)}: a later go can come out differently`, () => {
      expect(fetchFailed("http-error", status).kind).toBe("retry");
    });
  }

  it("has one code for each answer", () => {
    const codes = new Set([...blocked, ...retry].map((status) => codeOfMessage(fetchFailed("http-error", status).message)));
    expect(codes.size).toBe(2);
  });
});

/**
 * **Every code, by name.** A `Record` over the union, so an eighteenth code is
 * a red `npm run typecheck` here as well as in src/messages.ts, and the kind
 * beside each is the decision the plan's table records.
 */
const EXPECTED: Record<FetchFailureCode, FailureKind> = {
  "invalid-url": "blocked",
  "unsupported-scheme": "blocked",
  "blocked-address": "blocked",
  dns: "retry",
  connection: "retry",
  certificate: "blocked",
  timeout: "retry",
  "too-many-redirects": "blocked",
  unauthorized: "blocked",
  forbidden: "blocked",
  "not-found": "blocked",
  "rate-limited": "retry",
  "server-error": "retry",
  /* With no status. The other answer is the describe block above. */
  "http-error": "retry",
  "too-large": "blocked",
  "unsupported-type": "blocked",
  empty: "retry",
};

const CODES = Object.keys(EXPECTED) as FetchFailureCode[];

describe("every fetch failure code has a sentence of its own", () => {
  for (const code of CODES) {
    it(`${code} is ${EXPECTED[code]}, and its bracketed code says so too`, () => {
      const failure = fetchFailed(code, null);
      expect(failure.kind).toBe(EXPECTED[code]);
      expect(codeOfMessage(failure.message), failure.message).toMatch(/^fetch-/);
      expect(kindOfMessage(failure.message)).toBe(failure.kind);
      expect(worthRetrying(failure.message)).toBe(failure.kind === "retry");
    });
  }

  it("shares no code between two of them", () => {
    const codes = CODES.map((code) => codeOfMessage(fetchFailed(code, null).message));
    expect(new Set(codes).size).toBe(CODES.length);
  });
});

describe("neither sentence carries the address", () => {
  for (const code of CODES) {
    for (const status of code === "http-error" ? [null, 413] : [null]) {
      it(`${code}${status === null ? "" : ` (${status})`}: not on the card, not in the diagnostic`, async () => {
        const thrown = await stepFailure({
          attempts: 1,
          sleep: async () => {},
          resolve: async () => ["93.184.216.34"],
          fetchImpl: async () => {
            throw new FetchFailure(code, ADDRESS, `${SENTINEL_MESSAGE} at ${ADDRESS}`, {
              status,
              cause: new Error(`${SENTINEL_CAUSE} for ${SENTINEL_HOST}`),
            });
          },
        });
        expect(declaredFailure(thrown), `no sentence declared for ${code}`).not.toBeNull();
        const all = everythingOn(thrown);
        for (const sentinel of SENTINELS) expect(all).not.toContain(sentinel);
        /* The diagnostic is not empty for it: it names the code, and the
           status where there was one, which is all a log reader needs.
           `too-large` keeps the wording it had first, which names the limit
           (tests/one-size-limit.test.ts pins it). */
        if (code !== "too-large") expect(thrown.message).toContain(code);
        if (status !== null) expect(thrown.message).toContain(String(status));
        expect(codeOfMessage(thrown.message)).toMatch(/^fetch-/);
      });
    }
  }

  it("does not carry a status that is not a whole number", async () => {
    const thrown = await stepFailure({
      attempts: 1,
      sleep: async () => {},
      resolve: async () => ["93.184.216.34"],
      fetchImpl: async () => {
        throw new FetchFailure("http-error", ADDRESS, "x", { status: SENTINEL_MESSAGE as unknown as number });
      },
    });
    expect(everythingOn(thrown)).not.toContain(SENTINEL_MESSAGE);
  });
});
