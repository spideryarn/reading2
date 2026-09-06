/**
 * The two routes behind Referee's Claims — `/api/referee/claims/…` in
 * src/routes.ts.
 *
 * No server and no network: `handleApi` is a plain function over a request and a
 * response, the same harness tests/referee-criteria-routes.test.ts uses.
 * **Nothing here reaches a model**, and that is load-bearing rather than lucky:
 * the POST under test is refused before a single response header is written, so
 * a test that stopped failing would fail *loudly* — the fake response below has
 * no `writeHead` that survives being used for real work — rather than quietly
 * start spending money.
 *
 * What this file is actually for is the sentence *the routes are wired to the
 * store and the guard runs before the stream opens*. `claimsProblem` and
 * `validateClaims` are tested as functions elsewhere; a guard nobody calls
 * passes its own tests perfectly.
 *
 * ## It ran on the filesystem store until 2026-09-04, and this is the file the
 * postmortem was about
 *
 * Claims shipped filesystem-only on 2026-08-31 and answered 501 in production
 * for four hours, having passed this suite — because `SPIDERYARN_STORE` unset
 * means `files` and every fixture here was a `data/<slug>/` directory read back
 * through `loadClaimsRun`, which is the **filesystem** function and never
 * consults `src/store/`
 * (docs/postmortems/260901e-claims-shipped-filesystem-only-and-returned-501-in-production.md).
 * Converting it is that postmortem's own remedy
 * (docs/plans/260903f-delete-the-spideryarn-store-flag-and-the-filesystem-store.md
 * § B). It now seeds through `scratchArticleInPg`, and reads back through
 * `refereeClaimsStore`.
 *
 * tests/referee-routes-postgres.test.ts was written *because* this file could
 * not say anything about Postgres. Its header's argument for existing
 * separately — that pinning the flag here would cost this file its no-model
 * guarantee — is now moot, and it is the file to fold this one into when
 * somebody has a reason to.
 *
 * ### One case was dropped rather than translated, and the reason is a finding
 *
 * *"refuses a paper with no text, before a header is written"* — the 400 out of
 * `claimsProblem` — **cannot be reached under Postgres**, because
 * `reasonsNotToPublish` (src/store/pg-revisions.ts) refuses to publish a
 * revision with no blocks: *"it has no blocks"*. So there is no way for
 * `loadArticle` to hand the route an article whose `blocks` are empty, and the
 * seeder cannot make one. The two cases that needed such a fixture — that one
 * and *"writes nothing when it refuses"* — are gone rather than propped up with
 * a manufactured row, which would be a green test proving nothing.
 *
 * What is lost is narrower than it looks: the *ordering* claim those cases
 * carried — nothing is written and no header goes out before the request is
 * refused — is still asserted by the 404 case below, which is the other refusal
 * above `sse(res)`. What is genuinely uncovered is `claimsProblem` itself, and
 * it is uncovered because under the store that deploys it is unreachable.
 */

import type { IncomingMessage, ServerResponse } from "node:http";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { closeDb } from "../src/db/client.js";
import { loadEnvLocal } from "../src/env.js";
import { CLAIMS_ORPHAN_GRACE_MS } from "../src/store/pg-referee-claims.js";
import { acceptAny, asTestOwner, AUTHED_HEADERS, TEST_OWNER } from "./helpers/authed.js";
import { pgReady } from "./helpers/pg-ready.js";
import { scratchArticleInPg, type ScratchArticle } from "./helpers/scratch-article.js";

loadEnvLocal();

/** The paper every case below asks about. */
const SLUG = "test-referee-claims-routes";
/**
 * A second paper, seeded and never asked.
 *
 * The filesystem version got *"a paper nobody has asked"* for free by writing a
 * fresh directory before every case. There is no `remove` on
 * `RefereeClaimsStore` — one run per article, and deleting it is not an
 * operation the app has — so the un-asked state is a second article rather than
 * a reset, and it cannot be spoiled by the order the cases run in.
 */
const FRESH = "test-referee-claims-routes-fresh";
/** A slug that is not an article at all. */
const ABSENT = "test-referee-claims-routes-no-such-article";

await pgReady({
  suite: "tests/referee-claims-routes.test.ts",
  tables: ["spideryarn.referee_claims", "spideryarn.revision_blocks"],
  max: 2,
});

const { handleApi } = await import("../src/routes.js");
const { refereeClaimsStore } = await import("../src/store/index.js");


interface Reply {
  status: number;
  body: Record<string, unknown>;
  /** True if anything wrote a response header — i.e. a stream was opened. */
  streamed: boolean;
}

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

const URL = `/api/referee/claims/${SLUG}`;

/**
 * A run begun long enough ago that the sweep considers it abandoned.
 *
 * **The store's own clock parameter, not an `UPDATE` after the fact.**
 * `RefereeClaimsStore.begin` takes `now` precisely so a caller can say when a
 * run started, and `referee_claims.created_at` is what the Postgres sweep
 * measures against `CLAIMS_ORPHAN_GRACE_MS`. Doctoring the column afterwards
 * would be the same fixture with SQL in it, and
 * tests/store-parity-referee.test.ts § `staleStart` records what that cost when
 * it was tried: `created_at` **is** the wire form's `createdAt`, so the doctored
 * run differed from an honest one in the one field the doctoring touched.
 *
 * The filesystem store needed none of this — it sweeps whatever it is shown the
 * instant anybody looks, because two servers sharing one `data/` directory is a
 * thing nobody does. The grace window is the deployed store's, and this is
 * where this file starts covering it.
 */
const abandoned = () => () =>
  new Date(Date.now() - CLAIMS_ORPHAN_GRACE_MS - 60_000).toISOString();

describe("Referee's claims routes", { timeout: 60_000 }, () => {
  let article: ScratchArticle;
  let fresh: ScratchArticle;

  beforeAll(async () => {
    /* `ownerId: TEST_OWNER` and not the default: a request authenticated by
       ./helpers/authed.ts runs as `TEST_SUB`, and the Postgres reader filters
       every article by owner, so an article seeded as anybody else answers 404
       to everything — which looks exactly like a broken route.
       ./helpers/scratch-article.ts § `ScratchOptions.ownerId`. */
    article = await scratchArticleInPg(SLUG, { ownerId: TEST_OWNER });
    fresh = await scratchArticleInPg(FRESH, { ownerId: TEST_OWNER });
  });

  afterAll(async () => {
    await article?.remove();
    await fresh?.remove();
    await closeDb();
  });

  describe("GET — reading the run back", () => {
    it("answers null for a paper nobody has asked, rather than 404", async () => {
      /* A paper with no claims run is the ordinary state, not a missing
         resource. The panel has a sentence for it and needs the 200 to render
         it. Under Postgres this is a `referee_claims` table with no row for
         this article, where on files it was a directory with no JSON file. */
      const reply = await call("GET", `/api/referee/claims/${FRESH}`);
      expect(reply.status).toBe(200);
      expect(reply.body.run).toBeNull();
    });

    it("returns the stored run and the paper's fingerprint together", async () => {
      /* Both halves in one response and read close together, for the reason
         `readSearches` gives: the paper can be re-extracted between two reads,
         and a run read before a hash read would be compared against an article
         it was never answered about.

         The fingerprint is a **string** here, where the criteria suite's GET
         gets nothing at all: `sourceHashFor` answers `undefined` only for a
         revision with no blocks, and this article has nineteen. */
      await asTestOwner(() => refereeClaimsStore.begin(SLUG));
      const reply = await call("GET", URL);
      expect(reply.status).toBe(200);
      expect(typeof reply.body.sourceHash).toBe("string");
      /* **And the young run is still pending**, which is the other half of the
         sweep and was not asserted anywhere until 2026-09-04.

         **Mutation.** Deleting `lt(created_at, cutoff)` from `sweep` — the
         guard that is the entire difference between the two stores here. It
         **stayed green** the first time, because nothing in the file began a
         run and then asked whether a GET had left it alone; the line below was
         written because of that, and re-run against it on 2026-09-04 the same
         deletion gives *1 failed | 6 passed (7)*, this case, `expected 'error'
         to be 'pending'`. On Vercel the GET arrives on a different process from
         the one streaming the answer, so without that guard every poll errors a
         run that is still arriving. `CLAIMS_ORPHAN_GRACE_MS`.

         **Blind to.** Where the boundary actually falls. This line and the case
         below stand either side of one threshold and neither moves a clock, so
         a `cutoff` built from the wrong constant, or compared against the wrong
         column, keeps both green. The `status = 'pending'` half of the same
         `where` — what stops a GET re-erroring a run that already finished — is
         reached by nothing here. */
      expect((reply.body.run as { status: string }).status).toBe("pending");
    });

    it("sweeps an abandoned pending run into an error a referee can retry", async () => {
      /* Written before the model is called, precisely so a crash leaves
         evidence — and evidence nothing ever clears is a spinner for ever. This
         process is not running it and it is older than the grace window, so the
         GET repairs it.

         **Mutation.** `sweep` in src/store/pg-referee-claims.ts writing
         `status: "pending"` where it writes `status: "error"`, so an abandoned
         run is found, stamped with `CLAIMS_SWEPT` and left exactly as
         spinning as it was. Re-run 2026-09-04: *1 failed | 6 passed (7)*, this
         case, `expected 'pending' to be 'error'`.

         **Blind to.** What the referee is then shown. It pins the status the
         column ends up holding, in the response and in a second `load`, and
         nothing here reads `error` back — a sweep that wrote the status without
         the sentence, or with the wrong one, passes both assertions. `begin`
         and `finish`, which is where a real run's status comes from, are not
         reached by it either. */
      await asTestOwner(() => refereeClaimsStore.begin(SLUG, abandoned()));
      const reply = await call("GET", URL);
      expect((reply.body.run as { status: string }).status).toBe("error");
      expect((await asTestOwner(() => refereeClaimsStore.load(SLUG)))?.status).toBe("error");
    });
  });

  describe("POST — what has to be true before a model is called", () => {
    it("refuses a slug that is not an article at all", async () => {
      /* Under Postgres this 404 comes out of `ownedSlug` rather than out of a
         missing directory — a different code path answering the same way. And
         `streamed` is the half that matters: `loadArticle` throws above
         `sse(res)`, so there is still somewhere to put a 404. It is the only
         refusal this route has left that a published article can reach; see
         the header on the one that went with the filesystem store. */
      const reply = await call("POST", `/api/referee/claims/${ABSENT}`);
      expect(reply.status).toBe(404);
      expect(reply.streamed).toBe(false);
    });
  });

  describe("the methods it does not have", () => {
    /* One run per article, so there is no row to name, nothing to recolour and
       nothing to delete one of. A second POST replaces the first, which is what
       POST already means. */
    it("has no DELETE", async () => {
      expect((await call("DELETE", URL)).status).toBe(404);
    });

    it("has no PATCH", async () => {
      expect((await call("PATCH", URL, { colour: 1 })).status).toBe(404);
    });
  });
});
