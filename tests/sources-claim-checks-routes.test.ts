/**
 * **The two routes behind Debate's reader claim checks** —
 * `GET`/`POST /api/sources-claims/:slug/checks`, `runSourcesClaimCheck` in
 * src/routes.ts — and the store under them, against real Postgres. Plan
 * docs/plans/261008i-debate-claims-picked-by-the-reader.md § 3, stage 3.
 *
 * What is at stake is **the order of the refusals**: every free one
 * (ownership, input, a stale list, a check already out) before the shared
 * allowance, and the allowance before the model. So the allowance is a stub
 * that counts what it was asked and answers what each case says, and the
 * search is a stub that counts its calls — nothing here reaches a model.
 *
 * And **the reservation is the insert**: the partial unique index
 * `debate_claim_checks_one_pending` is what makes two presses at once one
 * search and one 409, so that is asked of two real connections, not of a
 * read-then-write in code.
 */
import type { IncomingMessage, ServerResponse } from "node:http";

import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { closeDb, getDb } from "../src/db/client.js";
import { articleRevisions, articles, sourcesClaimChecks } from "../src/db/schema.js";
import { inputFingerprint as listFingerprint } from "../src/sources-claims.js";
import { loadEnvLocal } from "../src/env.js";
import {
  SOURCES_CLAIM_CHECK_IN_FLIGHT,
  SOURCES_CLAIM_CHECK_LIMITED,
  SOURCES_CLAIM_CHECK_LIST_STALE,
  SOURCES_CLAIM_CHECK_SWEPT,
  SOURCES_CLAIM_CHECK_DIG_FURTHER_FIRST,
} from "../src/messages.js";
import type { SourcesClaimCheckTarget, SourcesClaimCheck, SourcesClaimList, ListedClaim } from "../src/types.js";
import { acceptAny, asTestOwner, AUTHED_HEADERS, TEST_OWNER } from "./helpers/authed.js";
import { pgReady } from "./helpers/pg-ready.js";
import { scratchArticleInPg, type ScratchArticle } from "./helpers/scratch-article.js";
import { seedAuthUser } from "./helpers/seed-auth-user.js";
import type { OwnerId } from "../src/owner.js";

loadEnvLocal();

const SLUG = "test-debate-claim-checks";
/** Somebody else's article: seeded under an owner of its own, never the test reader. */
const THEIRS = "test-debate-claim-checks-theirs";
const OUTSIDER = "7c0de5a1-0000-4000-8000-00000000d1c5" as OwnerId;
const TYPED = "a claim the reader typed, never to be echoed";

const seen = vi.hoisted(() => ({
  taken: [] as string[],
  finished: [] as string[],
  answer: "allowed" as "allowed" | "rate" | "concurrency" | "global",
  searches: [] as { targets: readonly SourcesClaimCheckTarget[]; alreadyFound: readonly string[] }[],
  /** Set to hold the search open until a case lets it go. */
  gate: null as Promise<void> | null,
  /** Resolved when the stub search starts, so a case can act while it is out. */
  started: null as (() => void) | null,
  /** How many of the next `finish` writes throw, as a dropped connection would. */
  finishThrows: 0,
  finishCalls: 0,
  /** Run just before the reservation insert: a peer acting in that gap. */
  beforeBegin: null as (() => Promise<void>) | null,
  /** Make the first list after the next successful reservation lose its connection. */
  failListAfterNextBegin: false,
  failNextList: false,
}));

vi.mock("../src/store/index.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/store/index.js")>();
  const checks = real.sourcesClaimChecksStore;
  return {
  ...real,
  sourcesClaimChecksStore: {
    async list(...a: Parameters<typeof checks.list>) {
      if (seen.failNextList) {
        seen.failNextList = false;
        throw new Error("connection reset during final list");
      }
      return checks.list(...a);
    },
    abandon: (...a: Parameters<typeof checks.abandon>) => checks.abandon(...a),
    sweep: (...a: Parameters<typeof checks.sweep>) => checks.sweep(...a),
    async begin(...a: Parameters<typeof checks.begin>) {
      const hook = seen.beforeBegin;
      seen.beforeBegin = null;
      if (hook) await hook();
      const begun = await checks.begin(...a);
      if (seen.failListAfterNextBegin) {
        seen.failListAfterNextBegin = false;
        seen.failNextList = true;
      }
      return begun;
    },
    async finish(...a: Parameters<typeof checks.finish>) {
      seen.finishCalls++;
      if (seen.finishThrows > 0) {
        seen.finishThrows--;
        throw new Error("connection reset");
      }
      return checks.finish(...a);
    },
  },
  fetchAllowanceStore: {
    async take(bucket: string) {
      seen.taken.push(bucket);
      return seen.answer === "allowed" ? { kind: "allowed", id: "lease" } : { kind: seen.answer };
    },
    async finish(id: string) {
      seen.finished.push(id);
    },
  },
  };
});

vi.mock("../src/reception.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/reception.js")>();
  return {
    ...real,
    async generateClaimCheck(opts: { targets: readonly SourcesClaimCheckTarget[]; alreadyFound?: readonly string[] }) {
      seen.searches.push({ targets: opts.targets, alreadyFound: opts.alreadyFound ?? [] });
      seen.started?.();
      if (seen.gate) await seen.gate;
      return {
        results: opts.targets.map((t, i) => ({
          claimId: t.claimId,
          outcome: "answered",
          rows: [
            {
              id: `spya-rw${"abcdefgh"[i] ?? "z"}a2m`,
              url: `https://found.example/${seen.searches.length}/${i}`,
              sourceQuote: "words copied from the page",
              relation: "qualifies",
              lean: "neither",
              applies: "How it bears.",
              ...(t.kind === "listed" ? { claimQuote: t.quote, blockId: t.blockId } : {}),
            },
          ],
        })),
        counts: {
          returnedSources: 1,
          reportedRows: opts.targets.length,
          keptRows: opts.targets.length,
          omittedOverCap: 0,
          lost: {
            uncited: 0,
            selfSource: 0,
            unverifiedSource: 0,
            directnessUnverified: 0,
            sourceIsCopy: 0,
            claimNotInBlock: 0,
            unknownBlockId: 0,
            malformed: 0,
          },
          webSearches: 2,
          groups: { missing: 0, duplicate: 0, unknown: 0, malformed: 0, rowsSetAside: 0 },
        },
        model: "stub-model",
        webSearches: 2,
        elapsedMs: 1,
      };
    },
  };
});

await pgReady({
  suite: "tests/sources-claim-checks-routes.test.ts",
  tables: ["spideryarn.debate_claim_checks", "spideryarn.revision_blocks"],
  max: 3,
});

const { handleApi } = await import("../src/routes.js");
const { sourcesClaimChecksStore, loadArticle, loadSourcesClaims } = await import("../src/store/index.js");
const { CHECK_ORPHAN_GRACE_MS, CheckInFlight } = await import("../src/store/pg-sources-claim-checks.js");
const { SOURCES_CLAIM_CHECK_TIMEOUT_MS } = await import("../src/reception.js");

interface Reply {
  status: number;
  /** Everything written: a JSON body, or the SSE frames. */
  written: string;
  /** A response header was written: the stream opened. */
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
  let written = "";
  let streamed = false;
  const res = {
    statusCode: 0,
    writableEnded: false,
    destroyed: false,
    setHeader() {},
    flushHeaders() {},
    writeHead(status: number) {
      streamed = true;
      (this as { statusCode: number }).statusCode = status;
    },
    on() {},
    write(chunk: string) {
      written += chunk;
      return true;
    },
    end(chunk?: string) {
      if (chunk) written += chunk;
      (this as { writableEnded: boolean }).writableEnded = true;
    },
  } as unknown as ServerResponse;
  await handleApi(req, res, acceptAny);
  return { status: res.statusCode, written, streamed };
}

const URL = `/api/sources-claims/${SLUG}/checks`;

/** The `done` frame's check, out of an SSE body. */
function doneFrame(written: string): SourcesClaimCheck {
  const frame = written.split("\n\n").find((f) => f.includes("event: done"));
  const data = frame?.split("\n").find((l) => l.startsWith("data: "));
  if (!data) throw new Error(`no done frame in ${written.slice(0, 200)}`);
  return JSON.parse(data.slice("data: ".length)) as SourcesClaimCheck;
}

let article: ScratchArticle;
let theirs: ScratchArticle;
let claims: ListedClaim[];
let hash: string;

/** Write a list onto the article's current revision — the stage-2 artefact, as the step stores it. */
async function storeList(sourceHash: string, listed: ListedClaim[] = claims): Promise<void> {
  const list: SourcesClaimList = {
    version: "debate-claims/1",
    generator: "test",
    slug: SLUG,
    sourceHash,
    claims: listed,
    dropped: { unknownIds: 0, unquoted: 0, tooLong: 0, duplicate: 0, overCap: 0, malformed: 0 },
    generatedAt: new Date().toISOString(),
    elapsedMs: 1,
  };
  const db = getDb();
  const [row] = await db
    .select({ revision: articles.currentRevisionId })
    .from(articles)
    .where(eq(articles.id, article.articleId));
  await db.update(articleRevisions).set({ sourcesClaims: list }).where(eq(articleRevisions.id, row!.revision!));
}

async function rows() {
  return getDb().select().from(sourcesClaimChecks).where(eq(sourcesClaimChecks.articleId, article.articleId));
}

beforeAll(async () => {
  article = await scratchArticleInPg(SLUG, { ownerId: TEST_OWNER });
  await seedAuthUser(getDb(), {
    id: OUTSIDER,
    email: "outsider-debate-claim-checks@example.invalid",
    onConflictDoNothing: true,
  });
  theirs = await scratchArticleInPg(THEIRS, { ownerId: OUTSIDER });
  const body = article.blocks.filter((b) => b.kind === "text" && b.text.split(" ").length > 8);
  claims = body.slice(0, 5).map((b, i) => ({
    id: `spya-c${"abcde"[i]}k2mb`,
    blockId: b.id,
    quote: b.text.split(" ").slice(0, 6).join(" "),
    statement: `Claim ${i}.`,
  }));
  expect(claims).toHaveLength(5);
  const loaded = await asTestOwner(() => loadArticle(SLUG));
  hash = listFingerprint(loaded.blocks, loaded.tree, loaded.meta);
});

beforeEach(async () => {
  seen.taken.length = 0;
  seen.finished.length = 0;
  seen.searches.length = 0;
  seen.answer = "allowed";
  seen.gate = null;
  seen.started = null;
  seen.finishThrows = 0;
  seen.finishCalls = 0;
  seen.beforeBegin = null;
  seen.failListAfterNextBegin = false;
  seen.failNextList = false;
  await getDb().delete(sourcesClaimChecks).where(eq(sourcesClaimChecks.articleId, article.articleId));
  await storeList(hash);
});

afterAll(async () => {
  await article?.remove();
  await theirs?.remove();
  await closeDb();
});

describe("the list it checks against", () => {
  it("is judged fresh by the route exactly when the list's own reader says it is", async () => {
    /* Two deciders of one question — the route's, against the article it
       loads, and `loadSourcesClaims`' stale flag. They must agree, or a fresh
       list is refused, or a stale one spends. */
    const found = await asTestOwner(() => loadSourcesClaims(SLUG));
    expect(found.stale).toBe(false);
    await storeList("an-older-article");
    expect((await asTestOwner(() => loadSourcesClaims(SLUG))).stale).toBe(true);
  });
});

describe("refusals, in order, before anything is spent", () => {
  it("refuses somebody else's article as not found, and spends nothing", async () => {
    const get = await call("GET", `/api/sources-claims/${THEIRS}/checks`);
    expect(get.status).toBe(404);
    const post = await call("POST", `/api/sources-claims/${THEIRS}/checks`, { own: TYPED });
    expect(post.status).toBe(404);
    expect(post.streamed).toBe(false);
    expect(seen.taken).toEqual([]);
    expect(seen.searches).toEqual([]);
  });

  it("refuses a typed claim over 600 characters, and never echoes it", async () => {
    const long = `${TYPED} ${"x".repeat(600)}`;
    const r = await call("POST", URL, { own: long });
    expect(r.status).toBe(413);
    expect(r.written).not.toContain(TYPED);
    expect(seen.taken).toEqual([]);
    /* The positive control: 600 exactly is a claim. */
    const ok = await call("POST", URL, { own: "y".repeat(600) });
    expect(ok.status).toBe(200);
  });

  it("refuses more than four claims, none, and an empty typed one", async () => {
    const five = await call("POST", URL, { claimIds: claims.slice(0, 4).map((c) => c.id), own: TYPED });
    expect(five.status).toBe(400);
    expect((await call("POST", URL, {})).status).toBe(400);
    expect((await call("POST", URL, { own: "   " })).status).toBe(400);
    expect(seen.taken).toEqual([]);
    expect(await rows()).toEqual([]);
  });

  it("refuses an id that is not in the current list", async () => {
    const r = await call("POST", URL, { claimIds: ["spya-nosuc2"] });
    expect(r.status).toBe(409);
    expect(seen.taken).toEqual([]);
    expect(await rows()).toEqual([]);
  });

  it("refuses a stale list with a 409 before the allowance", async () => {
    await storeList("an-older-article");
    const r = await call("POST", URL, { claimIds: [claims[0]!.id] });
    expect(r.status).toBe(409);
    expect(r.written).toContain(SOURCES_CLAIM_CHECK_LIST_STALE);
    expect(seen.taken).toEqual([]);
    expect(seen.searches).toEqual([]);
  });

  it("starts no search when the allowance refuses, and takes the reservation back", async () => {
    seen.answer = "rate";
    const r = await call("POST", URL, { claimIds: [claims[0]!.id] });
    expect(r.status).toBe(429);
    expect(r.written).toContain(SOURCES_CLAIM_CHECK_LIMITED);
    expect(seen.taken).toEqual(["sources-claim-check"]);
    expect(seen.searches).toEqual([]);
    /* No pending row left to hold the article's one check. */
    expect(await rows()).toEqual([]);
  });

  it("refuses Dig further on a claim no finished check has looked at", async () => {
    const r = await call("POST", URL, { digFurther: claims[0]!.id });
    expect(r.status).toBe(409);
    expect(r.written).toContain(SOURCES_CLAIM_CHECK_DIG_FURTHER_FIRST);
    expect(seen.taken).toEqual([]);
  });
});

describe("a check", () => {
  it("searches the ticked claims and the typed one, anchored from the list, and stores the answer", async () => {
    const r = await call("POST", URL, { claimIds: [claims[1]!.id], own: `  ${TYPED}  `, blockId: "ignored" });
    expect(r.status).toBe(200);
    expect(r.streamed).toBe(true);
    expect(seen.searches).toHaveLength(1);
    const [listed, own] = seen.searches[0]!.targets;
    expect(listed).toEqual({
      kind: "listed",
      claimId: claims[1]!.id,
      blockId: claims[1]!.blockId,
      quote: claims[1]!.quote,
      statement: claims[1]!.statement,
    });
    expect(own).toMatchObject({ kind: "own", text: TYPED });
    const done = doneFrame(r.written);
    expect(done.status).toBe("done");
    expect(done.results.map((x) => x.outcome)).toEqual(["answered", "answered"]);
    expect(done.listSourceHash).toBe(hash);
    expect(done.finishedAt).toBeTruthy();
    /* The allowance: taken once, given back once. */
    expect(seen.taken).toEqual(["sources-claim-check"]);
    expect(seen.finished).toEqual(["lease"]);
    /* And the GET finds the same row a reload would. */
    const listed2 = JSON.parse((await call("GET", URL)).written) as { checks: SourcesClaimCheck[] };
    expect(listed2.checks.map((c) => c.id)).toEqual([done.id]);
  });

  it("makes two presses at once one search and one 409", async () => {
    let release!: () => void;
    seen.gate = new Promise<void>((resolve) => (release = resolve));
    const started = new Promise<void>((resolve) => (seen.started = resolve));
    const first = call("POST", URL, { claimIds: [claims[0]!.id] });
    await started;
    const second = await call("POST", URL, { claimIds: [claims[1]!.id] });
    expect(second.status).toBe(409);
    expect(second.written).toContain(SOURCES_CLAIM_CHECK_IN_FLIGHT);
    /* Refused by the index, before the allowance. */
    expect(seen.taken).toEqual(["sources-claim-check"]);
    release();
    expect((await first).status).toBe(200);
    expect(seen.searches).toHaveLength(1);
  });

  it("digs further on one claim, told the addresses it already has", async () => {
    const r1 = await call("POST", URL, { claimIds: [claims[0]!.id, claims[1]!.id] });
    const first = doneFrame(r1.written);
    const found = first.results.flatMap((x) =>
      x.claimId === claims[0]!.id && x.outcome === "answered" ? x.rows.map((row) => row.url) : [],
    );
    const r2 = await call("POST", URL, { digFurther: claims[0]!.id });
    expect(r2.status).toBe(200);
    expect(seen.searches[1]?.targets.map((t) => t.claimId)).toEqual([claims[0]!.id]);
    expect(seen.searches[1]?.alreadyFound).toEqual(found);
    expect(doneFrame(r2.written).digFurther).toBe(true);
  });

  it("digs further on a typed claim by its id, with its words from the stored check", async () => {
    const r1 = await call("POST", URL, { own: TYPED });
    const ownId = doneFrame(r1.written).targets[0]!.claimId;
    const r2 = await call("POST", URL, { digFurther: ownId });
    expect(r2.status).toBe(200);
    expect(seen.searches[1]?.targets).toEqual([{ kind: "own", claimId: ownId, text: TYPED }]);
  });
});

describe("a check, when something goes wrong around it", () => {
  it("retries a finish write that failed, so a paid answer is kept (GPT Sol's E7)", async () => {
    seen.finishThrows = 2;
    const r = await call("POST", URL, { claimIds: [claims[0]!.id] });
    expect(r.status).toBe(200);
    expect(seen.finishCalls).toBe(3);
    expect(doneFrame(r.written).status).toBe("done");
    const [row] = await rows();
    expect(row?.status).toBe("done");
    expect(row?.model).toBe("stub-model");
  }, 30_000);

  /* Real time: the waits are 1 s, 3 s and 10 s (`CHECK_FINISH_RETRY_MS`). */
  it("gives up after four tries, and the allowance is still given back", async () => {
    seen.finishThrows = 5;
    const r = await call("POST", URL, { claimIds: [claims[0]!.id] });
    expect(seen.finishCalls).toBe(4);
    expect(r.written).not.toContain("event: done");
    expect(seen.finished).toEqual(["lease"]);
    expect((await rows())[0]?.status).toBe("pending");
  }, 30_000);

  it("tells Dig further the addresses a check stored just before its reservation (GPT Sol's E8)", async () => {
    const r1 = await call("POST", URL, { claimIds: [claims[0]!.id] });
    expect(r1.status).toBe(200);
    /* A peer's check on the same claim, still out when this press is validated... */
    const peer = await asTestOwner(() =>
      sourcesClaimChecksStore.begin(SLUG, {
        listSourceHash: hash,
        targets: [
          {
            kind: "listed",
            claimId: claims[0]!.id,
            blockId: claims[0]!.blockId,
            quote: claims[0]!.quote,
            statement: claims[0]!.statement,
          },
        ],
        digFurther: true,
      }),
    );
    /* ...and finished in the gap before this press reserves. */
    seen.beforeBegin = async () => {
      const lost = {
        uncited: 0,
        selfSource: 0,
        unverifiedSource: 0,
        directnessUnverified: 0,
        sourceIsCopy: 0,
        claimNotInBlock: 0,
        unknownBlockId: 0,
        malformed: 0,
      };
      const finished = await asTestOwner(() =>
        sourcesClaimChecksStore.finish(
          SLUG,
          peer.check.id,
          {
            status: "done",
            results: [
              {
                claimId: claims[0]!.id,
                outcome: "answered",
                rows: [
                  {
                    id: "spya-rwlate",
                    url: "https://late.example/peer",
                    sourceQuote: "words copied from the page",
                    relation: "qualifies",
                    lean: "neither",
                    applies: "How it bears.",
                    claimQuote: claims[0]!.quote,
                    blockId: claims[0]!.blockId,
                  },
                ],
              },
            ],
            counts: {
              returnedSources: 1,
              reportedRows: 1,
              keptRows: 1,
              omittedOverCap: 0,
              lost,
              webSearches: 1,
              groups: { missing: 0, duplicate: 0, unknown: 0, malformed: 0, rowsSetAside: 0 },
            },
            webSearches: 1,
            model: "peer-model",
          } as Parameters<typeof sourcesClaimChecksStore.finish>[2],
          peer.attempt,
        ),
      );
      expect(finished?.status).toBe("done");
    };
    const r2 = await call("POST", URL, { digFurther: claims[0]!.id });
    expect(r2.status).toBe(200);
    expect(seen.searches[1]?.alreadyFound).toContain("https://late.example/peer");
    expect(seen.searches[1]?.alreadyFound).toContain("https://found.example/1/0");
  });

  it("spends no allowance when Dig further's post-reservation read fails", async () => {
    const first = await call("POST", URL, { claimIds: [claims[0]!.id] });
    expect(first.status).toBe(200);
    seen.taken.length = 0;
    seen.finished.length = 0;
    seen.failListAfterNextBegin = true;

    const failed = await call("POST", URL, { digFurther: claims[0]!.id });

    expect(failed.status).toBe(500);
    expect(seen.taken).toEqual([]);
    expect(seen.finished).toEqual([]);
    expect(seen.searches).toHaveLength(1);
    expect((await rows()).map((row) => row.status)).toEqual(["done"]);
  });

  it("digs further on a claim whose list was made again with new ids, from the stored check (E5)", async () => {
    const r1 = await call("POST", URL, { claimIds: [claims[2]!.id] });
    expect(r1.status).toBe(200);
    /* The same article, listed again: same hash, fresh random ids. */
    await storeList(
      hash,
      claims.map((c, i) => ({ ...c, id: `spya-n${"abcde"[i]}k2mb` })),
    );
    const r2 = await call("POST", URL, { digFurther: claims[2]!.id });
    expect(r2.status).toBe(200);
    expect(seen.searches[1]?.targets).toEqual([
      {
        kind: "listed",
        claimId: claims[2]!.id,
        blockId: claims[2]!.blockId,
        quote: claims[2]!.quote,
        statement: claims[2]!.statement,
      },
    ]);
    expect(seen.searches[1]?.alreadyFound).toEqual(["https://found.example/1/0"]);
  });
});

describe("Dig further across a list made again (E5)", () => {
  it("digs further on the new id of a claim checked under its old one, told the old check's addresses", async () => {
    const r1 = await call("POST", URL, { claimIds: [claims[3]!.id] });
    expect(r1.status).toBe(200);
    const renamed = claims.map((c, i) => ({ ...c, id: `spya-m${"abcde"[i]}k2mb` }));
    await storeList(hash, renamed);
    const r2 = await call("POST", URL, { digFurther: renamed[3]!.id });
    expect(r2.status).toBe(200);
    expect(seen.searches[1]?.targets.map((t) => t.claimId)).toEqual([renamed[3]!.id]);
    expect(seen.searches[1]?.alreadyFound).toEqual(["https://found.example/1/0"]);
  });

  it("still refuses an id no list and no check has ever named", async () => {
    const r = await call("POST", URL, { digFurther: "spya-nowhere" });
    expect(r.status).toBe(409);
    expect(seen.taken).toEqual([]);
  });
});

describe("the store", () => {
  const begin = () =>
    asTestOwner(() =>
      sourcesClaimChecksStore.begin(SLUG, { listSourceHash: hash, targets: [], digFurther: false }),
    );

  it("lets one of two simultaneous reservations through, on two connections", async () => {
    const settled = await Promise.allSettled([begin(), begin()]);
    const won = settled.filter((s) => s.status === "fulfilled");
    const lost = settled.filter((s): s is PromiseRejectedResult => s.status === "rejected");
    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(1);
    expect(lost[0]!.reason).toBeInstanceOf(CheckInFlight);
    expect((lost[0]!.reason as { status: number }).status).toBe(409);
  });

  it("will not let an older attempt finish over the check that replaced it", async () => {
    const { check, attempt } = await begin();
    /* The process running it died: the sweep ends it, and a new check begins. */
    await getDb()
      .update(sourcesClaimChecks)
      .set({ createdAt: new Date(Date.now() - CHECK_ORPHAN_GRACE_MS - 60_000) })
      .where(eq(sourcesClaimChecks.id, check.id));
    const swept = await asTestOwner(() => sourcesClaimChecksStore.sweep(SLUG, () => false));
    expect(swept.find((c) => c.id === check.id)).toMatchObject({ status: "error", error: SOURCES_CLAIM_CHECK_SWEPT });
    const newer = await begin();
    const late = await asTestOwner(() =>
      sourcesClaimChecksStore.finish(
        SLUG,
        check.id,
        { status: "done", results: [], counts: undefined as never, webSearches: 1, model: "late" },
        attempt,
      ),
    );
    expect(late).toBeNull();
    /* And it cannot finish the newer one either: wrong id, wrong attempt. */
    const wrong = await asTestOwner(() =>
      sourcesClaimChecksStore.finish(SLUG, newer.check.id, { status: "error", error: "late" }, attempt),
    );
    expect(wrong).toBeNull();
    const now = await rows();
    expect(now.find((r) => r.id === check.id)?.status).toBe("error");
    expect(now.find((r) => r.id === check.id)?.model).toBeNull();
    expect(now.find((r) => r.id === newer.check.id)?.finishedAt).toBeNull();
    expect(now.find((r) => r.id === newer.check.id)?.status).toBe("pending");
  });

  it("waits out the model's whole deadline and the admission before it, from the same constant (E6)", async () => {
    expect(CHECK_ORPHAN_GRACE_MS).toBeGreaterThanOrEqual(SOURCES_CLAIM_CHECK_TIMEOUT_MS + 120_000);
    /* Reserved, then nearly two minutes in admission and setup, then a model
       call that ran to its deadline: still not another process's to end. */
    const { check } = await begin();
    await getDb()
      .update(sourcesClaimChecks)
      .set({ createdAt: new Date(Date.now() - SOURCES_CLAIM_CHECK_TIMEOUT_MS - 110_000) })
      .where(eq(sourcesClaimChecks.id, check.id));
    const swept = await asTestOwner(() => sourcesClaimChecksStore.sweep(SLUG, () => false));
    expect(swept.find((c) => c.id === check.id)?.status).toBe("pending");
  });

  it("leaves a check this process is running, and a young one, to finish", async () => {
    const { check } = await begin();
    await getDb()
      .update(sourcesClaimChecks)
      .set({ createdAt: sql`now() - interval '1 hour'` })
      .where(eq(sourcesClaimChecks.id, check.id));
    const live = await asTestOwner(() => sourcesClaimChecksStore.sweep(SLUG, (id) => id === check.id));
    expect(live[0]?.status).toBe("pending");
    await getDb().update(sourcesClaimChecks).set({ createdAt: new Date() }).where(eq(sourcesClaimChecks.id, check.id));
    const young = await asTestOwner(() => sourcesClaimChecksStore.sweep(SLUG, () => false));
    expect(young[0]?.status).toBe("pending");
  });
});

describe("a visitor", () => {
  it("gets no checks in a shared article's payload", async () => {
    const r1 = await call("POST", URL, { own: TYPED });
    expect(r1.status).toBe(200);
    const shared = await call("PUT", `/api/article/${SLUG}/visibility`, { visibility: "public", rightsConfirmed: true });
    expect(shared.status).toBe(200);
    try {
      const req = Object.assign(
        (async function* () {})(),
        { method: "GET", url: `/api/public/article/${SLUG}`, headers: {} },
      ) as unknown as IncomingMessage;
      let text = "";
      let status = 0;
      const res = {
        set statusCode(v: number) {
          status = v;
        },
        get statusCode() {
          return status;
        },
        setHeader() {},
        end(chunk: string) {
          text = chunk ?? "";
        },
      } as unknown as ServerResponse;
      await handleApi(req, res, undefined);
      expect(status).toBe(200);
      /* The positive control: the list itself does cross. */
      expect(text).toContain(claims[0]!.statement);
      expect(text).not.toContain(TYPED);
      expect(text).not.toContain("found.example");
    } finally {
      await call("PUT", `/api/article/${SLUG}/visibility`, { visibility: "private" });
    }
  });
});
