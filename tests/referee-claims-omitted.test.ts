/**
 * **The cap the route forgot to pass on.**
 *
 * `validateClaims` keeps twenty claims and counts what it cut, because a list
 * that silently truncates makes position into a ranking — in the one sub-mode
 * built to have none. `ClaimsPanel` prints the count. But `runRefereeClaims`
 * stored `{status, claims, model}` and nothing else, so `claimsOmitted` was
 * always absent, and every run took the fallback sentence that can only say
 * *some were cut* rather than how many.
 *
 * GPT Sol's finding 5, 2026-09-01. Its shape is the one this feature keeps
 * producing: a number computed correctly, rendered correctly, and never carried
 * between the two.
 *
 * **Why this is its own file.** tests/referee-claims-routes.test.ts says in its
 * own header that nothing in it reaches a model, and that this is load-bearing
 * rather than lucky — its fake response would fail loudly rather than quietly
 * start spending. Mocking the run there would take that sentence away from it.
 * So the mock lives here, where the header says what it is.
 *
 * Writes under `data/<throwaway slug>/`, which is gitignored, and removes it.
 */
import { mkdir, rm, writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { Claim } from "../src/referee-claims.js";
import { acceptAny, asTestOwner, AUTHED_HEADERS } from "./helpers/authed.js";

/** How many claims the validator threw away past its cap, for this run. */
const TRUNCATED = 3;

const CLAIMS: Claim[] = [
  {
    id: "spya-clm001:0",
    blockId: "spya-clm001",
    start: 0,
    claim: "The method cuts annotation error.",
    quote: "The method cuts annotation error.",
    passages: [],
    discarded: 0,
  },
];

/* `importActual` and spread, not a bare object: src/store/pg-referee-claims.ts
   imports `CLAIMS_TIMEOUT_MS` from this module, so replacing the whole of it
   leaves that store with an undefined constant and the import graph falls over
   before a single test runs. Mock the one function; keep the rest real. */
vi.mock("../src/referee-claims-run.js", async () => ({
  ...(await vi.importActual<typeof import("../src/referee-claims-run.js")>(
    "../src/referee-claims-run.js",
  )),
  runClaimsStream: async function* () {
    yield {
      type: "done" as const,
      outcome: {
        claims: CLAIMS,
        model: "a-test-model",
        dropped: {
          malformed: 0,
          unknownIds: 0,
          unquoted: 0,
          truncated: TRUNCATED,
        },
        withheld: [],
      },
    };
  },
}));

const { handleApi } = await import("../src/routes.js");
const { loadClaimsRun } = await import("../src/referee-claims-store.js");

const SLUG = "test-referee-claims-omitted";
const DIR = path.resolve(import.meta.dirname, "..", "data", SLUG);
afterEach(() => rm(DIR, { recursive: true, force: true }));

async function seedArticle(): Promise<void> {
  await mkdir(DIR, { recursive: true });
  /* `loadArticle` reads blocks.json **and** tree.json and skips the directory
     unless both are there, so a fixture with only the first is a 404 that looks
     exactly like the route refusing — the trap tests/referee-claims-routes.test.ts
     already fell into once and wrote down. */
  await writeFile(path.join(DIR, "tree.json"), JSON.stringify({ nodes: [] }), "utf8");
  await writeFile(
    path.join(DIR, "meta.json"),
    JSON.stringify({ slug: SLUG, title: "A paper with too many claims", url: "https://x.test/p" }),
    "utf8",
  );
  await writeFile(
    path.join(DIR, "blocks.json"),
    JSON.stringify({
      blocks: [
        {
          id: "spya-clm001",
          tag: "p",
          kind: "prose",
          level: 0,
          text: "The method cuts annotation error.",
          words: 5,
          html: "<p>The method cuts annotation error.</p>",
          gistable: true,
        },
      ],
    }),
    "utf8",
  );
}

async function post(url: string): Promise<{ status: number; text: string }> {
  const req = Object.assign(
    (async function* () {
      /* no body: the route takes none */
    })(),
    { method: "POST", url, headers: AUTHED_HEADERS },
  ) as unknown as IncomingMessage;

  let status = 0;
  let text = "";
  const res = {
    set statusCode(v: number) {
      status = v;
    },
    get statusCode() {
      return status;
    },
    setHeader: () => {},
    writeHead: (code: number) => {
      status = code;
      return res;
    },
    write: (chunk: unknown) => {
      text += String(chunk);
      return true;
    },
    end: (chunk?: unknown) => {
      if (chunk !== undefined) text += String(chunk);
    },
    on: () => res,
    once: () => res,
    removeListener: () => res,
    emit: () => false,
    flushHeaders: () => {},
  } as unknown as ServerResponse;

  await handleApi(req, res, acceptAny);
  return { status, text };
}

describe("what the route stores about its own cap", () => {
  it("carries the count of claims it cut, so the panel can say how many", async () => {
    await seedArticle();
    const reply = await post(`/api/referee/claims/${SLUG}`);

    const run = await asTestOwner(() => loadClaimsRun(SLUG));
    expect(
      run,
      `the run was not stored at all — the route answered ${reply.status}: ${reply.text.slice(0, 300)}`,
    ).not.toBeNull();
    expect(
      run?.claimsOmitted,
      `validateClaims counted ${TRUNCATED} claims past the cap and the route dropped ` +
        `the number on the floor, so the panel can only say that some were cut. ` +
        `src/routes.ts § runRefereeClaims.`,
    ).toBe(TRUNCATED);
  });
});
