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
 * ## It ran on the filesystem store until 2026-09-04, and that is the point
 *
 * The fixture was a hand-written `data/<slug>/blocks.json` and the read-back
 * went through `loadClaimsRun` (src/referee-claims-store.ts), which reads the
 * data root and never consults `src/store/` — so the number this file is about
 * was being carried through the store that is **not deployed**
 * (docs/plans/260903f-delete-the-spideryarn-store-flag-and-the-filesystem-store.md
 * § B). That matters more here than in most of the twenty-six: `claimsOmitted`
 * is a *column* in Postgres and a key in a JSON object on files, so the
 * filesystem round trip carries any field anybody adds, for free and for ever,
 * while the Postgres one drops the field it was not told about and reports
 * success — which is what `finish` in src/store/pg-referee-claims.ts warns
 * about at length. This file was checking the store that cannot have the bug.
 *
 * It now pins `postgres` before any import, seeds through `scratchArticleInPg`,
 * and reads back through `refereeClaimsStore.load`.
 *
 * **Mutation.** The `claimsOmitted` spread deleted from `finish` in
 * src/store/pg-referee-claims.ts — the single line that names the column, which
 * is the bug this file is about, put back where the deployed store can have it.
 * Re-run on 2026-09-04: *1 failed | 1 passed (2)*, `expected undefined to be
 * 3`. The surviving pass is the store control, which is the point of having it.
 *
 * **Blind to.** Everything either side of that one column. `runClaimsStream` is
 * mocked here and hands `truncated: 3` straight over, so nothing below can tell
 * a `validateClaims` that miscounts from one that counts correctly, and no
 * assertion here follows the number as far as the panel that prints it. The
 * other fields `finish` writes — `status`, `claims`, `model`, `error` — could
 * each drop the same way and leave this file green; `EVERY_RUN_FIELD` in
 * tests/store-pg-referee-claims.test.ts is what covers those.
 */
import type { IncomingMessage, ServerResponse } from "node:http";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb } from "../src/db/client.js";
import { loadEnvLocal } from "../src/env.js";
import type { Claim } from "../src/referee-claims.js";
import { acceptAny, asTestOwner, AUTHED_HEADERS, TEST_OWNER } from "./helpers/authed.js";
import { pgReady } from "./helpers/pg-ready.js";
import { scratchArticleInPg, type ScratchArticle } from "./helpers/scratch-article.js";

loadEnvLocal();

/** How many claims the validator threw away past its cap, for this run. */
const TRUNCATED = 3;

/**
 * The one claim the mocked run answers with, anchored in `beforeAll`.
 *
 * A literal `spya-clm001` would have done on files, where nothing checks a
 * block id against anything. It is written from the seeded article instead
 * because a fixture id that names no block of the article under test is the
 * kind of thing that goes on passing while meaning nothing —
 * `ScratchArticle.blocks`.
 */
let CLAIM: Claim;

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
        claims: [CLAIM],
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

const SLUG = "test-referee-claims-omitted";

await pgReady({
  suite: "tests/referee-claims-omitted.test.ts",
  tables: ["spideryarn.referee_claims", "spideryarn.revision_blocks"],
});

const { handleApi } = await import("../src/routes.js");
const { refereeClaimsStore } = await import("../src/store/index.js");


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

describe("what the route stores about its own cap", { timeout: 60_000 }, () => {
  let article: ScratchArticle;

  beforeAll(async () => {
    /* `ownerId: TEST_OWNER` and not the default: a request authenticated by
       ./helpers/authed.ts runs as `TEST_SUB`, and the Postgres reader filters
       every article by owner, so an article seeded as anybody else is a 404
       that reads exactly like a broken route —
       ./helpers/scratch-article.ts § `ScratchOptions.ownerId`. */
    article = await scratchArticleInPg(SLUG, { ownerId: TEST_OWNER });
    const block = article.blocks.find((b) => b.text.trim().length > 30);
    if (!block) throw new Error("the fixture article has no block long enough to quote");
    const quote = block.text.trim().slice(0, 24);
    CLAIM = {
      id: `${block.id}:0`,
      blockId: block.id,
      start: block.text.indexOf(quote),
      claim: "The method cuts annotation error.",
      quote,
      passages: [],
      discarded: 0,
    };
  });

  afterAll(async () => {
    await article?.remove();
    await closeDb();
  });

  it("carries the count of claims it cut, so the panel can say how many", async () => {
    const reply = await post(`/api/referee/claims/${SLUG}`);

    const run = await asTestOwner(() => refereeClaimsStore.load(SLUG));
    expect(
      run,
      `the run was not stored at all — the route answered ${reply.status}: ${reply.text.slice(0, 300)}`,
    ).not.toBeNull();
    expect(
      run?.claimsOmitted,
      `validateClaims counted ${TRUNCATED} claims past the cap and the route dropped ` +
        `the number on the floor, so the panel can only say that some were cut. ` +
        `src/routes.ts § runRefereeClaims, and \`finish\` in ` +
        `src/store/pg-referee-claims.ts, which is where a column can go missing.`,
    ).toBe(TRUNCATED);
  });
});
