/**
 * **`POST /api/referee/mirror/:slug` — the route that makes Mirror reachable.**
 *
 * Stage 5b of docs/plans/260831an-referee-mode-for-peer-reviewers.md. The
 * prompt, the call and the validator have been committed since `bd2f38e` and
 * nothing in the running app called them; this file is half of what says they
 * are wired up, and src/web/MirrorPanel.tsx's tests are the other half.
 *
 * No server and no network: `handleApi` is a plain function over a request and
 * a response, the same harness tests/routes.test.ts and
 * tests/referee-criteria-routes.test.ts use.
 *
 * ## Nothing here reaches a model, and that is a property rather than a hope
 *
 * Two of the four cases fail before a header is written — a bad method and a
 * slug with no article — so they cannot get near one. The other two **do** open
 * the stream and run `mirrorStream`, and they still cost nothing, because of
 * the guard that module puts above its own key check: *a referee with no
 * comment that has a body or a placement is an empty answer nobody pays for.*
 * That is the case this file is mostly about, since it is also the commonest
 * one a real referee will hit — and the one where "we did nothing" and "the
 * feature is broken" look identical from outside.
 *
 * **How that is checked, and why not the way this header used to say.** It used
 * to say the guard was free to delete because *"`OPENROUTER_API_KEY` is absent
 * under vitest, so the run throws `NOT_CONFIGURED`"*. That is not true on a
 * developer's machine: `mirrorStream` calls `loadEnvLocal()` immediately after
 * the guard, `.env.local` holds the real key, and `.env.local` beats the
 * environment by design (src/env.ts § *`.env.local` beats what the shell
 * inherited*). So the argument for "this test cannot spend money" rested on the
 * one thing that is false here, and deleting the guard would have bought a real
 * OpenRouter call out of a unit test.
 *
 * The placement case below therefore stubs global `fetch` — the repo's existing
 * move, from tests/explain.test.ts — with a spy that records and throws. That
 * makes "no model was asked" an assertion about something that happened rather
 * than about an error that did not, and it makes the spend impossible rather
 * than unlikely.
 *
 * ## It ran on the filesystem store until 2026-09-04
 *
 * The fixture was `cp(example/ → data/<slug>/)` and the comments went in
 * through `createComment` (src/comments.ts), which writes `comments.json` and
 * never consults `src/store/` — so the join this file exists to check, *the
 * referee's own placement reaches the minted remark with its sign and its
 * criterion*, was being made in the store that is not deployed
 * (docs/plans/260903f-delete-the-spideryarn-store-flag-and-the-filesystem-store.md
 * § B). It now pins `postgres` before any import, seeds through
 * `scratchArticleInPg`, and writes through `commentStore` — where `valence` is
 * a column with a CHECK on it and `criterion_id` is a foreign key onto the
 * criterion the placement names.
 *
 * **And the anchors are read off the article rather than written down.** The
 * three `spya-…` ids and their quotes were `example/`'s; the corpus article the
 * seeder clones is a different paper, so a literal here would name no block at
 * all — `ScratchArticle.blocks`, and the fixture check below is what says the
 * derived pair is real.
 */

import type { IncomingMessage, ServerResponse } from "node:http";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `SPIDERYARN_STORE=postgres`, before **any** import runs — `src/store/live.ts`
 * reads the flag once and imports are hoisted above every statement. Same
 * block, same reason, as tests/referee-routes-postgres.test.ts.
 */
const PREVIOUS_STORE_FLAG = vi.hoisted(() => {
  const previous = process.env.SPIDERYARN_STORE;
  process.env.SPIDERYARN_STORE = "postgres";
  return previous;
});

import { closeDb } from "../src/db/client.js";
import { loadEnvLocal } from "../src/env.js";
import type { MirrorInput, MirrorRemark } from "../src/referee-mirror-types.js";
import { acceptAny, asTestOwner, AUTHED_HEADERS, TEST_OWNER } from "./helpers/authed.js";
import { pgReady } from "./helpers/pg-ready.js";
import { scratchArticleInPg, type ScratchArticle } from "./helpers/scratch-article.js";

loadEnvLocal();

const SLUG = "test-referee-mirror-route";

const { reachable } = await pgReady({
  suite: "tests/referee-mirror-route.test.ts",
  tables: ["spideryarn.comments", "spideryarn.referee_criteria", "spideryarn.revision_blocks"],
});

const { handleApi } = await import("../src/routes.js");
/* The very objects the route reads its comments and criteria from, rather than
   the filesystem ones by name: if the two ever differed, a test that named the
   implementation would go on passing while the route read somewhere else. */
const { commentStore, refereeCriteriaStore, STORE } = await import("../src/store/index.js");

if (PREVIOUS_STORE_FLAG === undefined) delete process.env.SPIDERYARN_STORE;
else process.env.SPIDERYARN_STORE = PREVIOUS_STORE_FLAG;

const when = reachable ? describe : describe.skip;

describe("the store these tests are actually talking to", () => {
  /* The positive control: a flag that failed to take looks exactly like this
     file working, because the filesystem store round-trips a placement through
     JSON and could not lose a sign if it tried. */
  it("is the Postgres one", () => {
    expect(STORE).toBe("postgres");
  });
});

const URL_FOR = (slug: string) => `/api/referee/mirror/${slug}`;

/**
 * **Every URL anything in this file tried to fetch**, which is normally none.
 *
 * The alarm behind the header's claim, and it is file-wide rather than per-test
 * because the claim is file-wide. It records and then throws, so a run that
 * reaches the gateway fails loudly here instead of quietly buying a completion
 * with the key `loadEnvLocal()` is about to put into `process.env`.
 *
 * This was measured, not assumed. With the early return in `mirrorStream`
 * removed, the two "a referee with nothing written" cases below **passed** and
 * the file took ten seconds longer: they had each made a real OpenRouter call,
 * got an empty remark list back after validation, and asserted their way to
 * green over the top of it. `done` with no remarks is what a paid call and a
 * free one both produce, so nothing in those two tests could ever have told
 * them apart. Now the spy can.
 *
 * **It is installed per test rather than for the file**, and since the move to
 * Postgres that is load-bearing: `scratchArticleInPg` puts the raw document in
 * the Supabase bucket **over HTTP**, so a seed inside a stubbed `fetch` fails
 * with this stub's own message and reads as a route bug. The seed is in
 * `beforeAll`, above the stub.
 */
let fetches: string[] = [];

interface Reply {
  status: number;
  /** True once anything wrote a response header — i.e. a stream was opened. */
  streamed: boolean;
  /** Every frame, in order, as `sse` in src/routes.ts wrote it. */
  frames: { name: string; data: Record<string, unknown> }[];
  /** The JSON body, for the failures that never open a stream. */
  body: Record<string, unknown>;
}

/** Split the raw SSE text back into frames, ignoring `: ping` heartbeats. */
function parseFrames(text: string): { name: string; data: Record<string, unknown> }[] {
  const out: { name: string; data: Record<string, unknown> }[] = [];
  for (const chunk of text.split("\n\n")) {
    const name = /^event: (.+)$/m.exec(chunk)?.[1];
    const data = /^data: (.+)$/m.exec(chunk)?.[1];
    if (name && data) out.push({ name, data: JSON.parse(data) as Record<string, unknown> });
  }
  return out;
}

/**
 * Drive `handleApi` with a fake request/response pair that **can** be streamed
 * to — `tests/routes.test.ts`'s `callStreaming`, which is where every field
 * here is explained.
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
  let streamed = false;
  let text = "";
  const res = {
    set statusCode(v: number) {
      status = v;
    },
    get statusCode() {
      return status;
    },
    writableEnded: false,
    destroyed: false,
    setHeader() {},
    on() {},
    flushHeaders() {},
    writeHead(code: number) {
      streamed = true;
      status = code;
    },
    write(chunk: string) {
      text += chunk;
    },
    end(chunk?: string) {
      if (chunk) text += chunk;
    },
  } as unknown as ServerResponse;

  await handleApi(req, res, acceptAny);
  return {
    status,
    streamed,
    frames: streamed ? parseFrames(text) : [],
    body: streamed ? {} : (JSON.parse(text || "{}") as Record<string, unknown>),
  };
}

/** The one terminal frame a run is allowed to end with. */
function terminal(reply: Reply): { name: string; data: Record<string, unknown> } {
  const ends = reply.frames.filter((f) => f.name === "done" || f.name === "error");
  expect(
    ends.length,
    `exactly one terminal frame, got ${reply.frames.map((f) => f.name).join(", ") || "none"}`,
  ).toBe(1);
  return ends[0] as { name: string; data: Record<string, unknown> };
}

/** Where a mark goes: a real block of the seeded article, and real words in it. */
interface Anchor {
  blockId: string;
  quote: string;
  start: number;
}

when("Referee's mirror route", { timeout: 60_000 }, () => {
  let article: ScratchArticle;
  /** The two passages, read off the seeded article rather than written down. */
  let FIRST: Anchor;
  let SECOND: Anchor;

  beforeAll(async () => {
    /* `ownerId: TEST_OWNER` and not the default: a request authenticated by
       ./helpers/authed.ts runs as `TEST_SUB`, and the Postgres reader filters
       every article by owner — ./helpers/scratch-article.ts § `ScratchOptions.ownerId`. */
    article = await scratchArticleInPg(SLUG, { ownerId: TEST_OWNER });
    const long = article.blocks.filter((b) => b.text.trim().length > 40);
    const [a, b] = long;
    if (!a || !b) throw new Error("the fixture article has too few blocks to place two marks in");
    const anchor = (block: { id: string; text: string }, take: number): Anchor => {
      const quote = block.text.trim().slice(0, take);
      return { blockId: block.id, quote, start: block.text.indexOf(quote) };
    };
    /* Two different lengths, so the two marks cannot be told apart only by
       which block they are on. */
    FIRST = anchor(a, 18);
    SECOND = anchor(b, 24);
  });

  afterAll(async () => {
    await article?.remove();
    await closeDb();
  });

  /**
   * The marks, and nothing a previous case left.
   *
   * Where the filesystem version re-copied `example/` into `data/<slug>/` after
   * every case, which threw `comments.json` away with it. Deleting the rows and
   * keeping the article is the same reset — and the criteria go first only
   * because a comment's `criterion_id` is a foreign key onto them, so the
   * database would refuse the other order.
   */
  beforeEach(async () => {
    fetches = [];
    await asTestOwner(async () => {
      for (const c of await commentStore.load(SLUG)) await commentStore.remove(SLUG, c.id);
      for (const c of await refereeCriteriaStore.load(SLUG)) {
        await refereeCriteriaStore.remove(SLUG, c.id);
      }
    });
    vi.stubGlobal("fetch", (input: unknown) => {
      fetches.push(String(input));
      throw new Error("a model call was made");
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("what the route refuses before it writes a header", () => {
    it("is a 404 for a slug with no article, with nothing streamed", async () => {
      const reply = await call("POST", URL_FOR("test-referee-mirror-no-such-article"));
      expect(reply.streamed).toBe(false);
      expect(reply.status).toBe(404);
    });

    it("has no GET — reading is not what this route does", async () => {
      /* A run is a model call the referee asks for, so it is a POST and there is
         nothing to fetch. A GET must be an ordinary 404 rather than a stream. */
      const reply = await call("GET", URL_FOR(SLUG));
      expect(reply.streamed).toBe(false);
      expect(reply.status).toBe(404);
    });
  });

  describe("a referee with nothing written", () => {
    it("answers with an empty run rather than a failure, and pays nothing", async () => {
      const reply = await call("POST", URL_FOR(SLUG));
      expect(reply.streamed).toBe(true);

      const end = terminal(reply);
      /* **`done`, not `error`.** Nothing is wrong: there is nothing to mirror.
         This is the assertion that would go red if the early return in
         `mirrorStream` were removed, because the run would then reach the key
         check and throw. */
      expect(end.name).toBe("done");
      expect(end.data.remarks).toEqual([]);
      expect(end.data.coverage).toEqual({ asked: false, reason: "nothing-to-mirror" });
      /* And the half `done` cannot say on its own: a run that DID pay ends in a
         `done` carrying an empty list too. See `fetches`. */
      expect(fetches, "the run reached the model").toEqual([]);
    });

    it("counts the bookmarks it left behind rather than dropping them silently", async () => {
      /* A bookmark is a mark on a passage with nothing written under it. Mirror
         skips it — there is no claim of the referee's to remark on — and the
         count is what lets the panel say so instead of showing a blank. */
      await asTestOwner(() => commentStore.create(SLUG, FIRST));

      const reply = await call("POST", URL_FOR(SLUG));
      const end = terminal(reply);
      expect(end.name).toBe("done");
      const input = end.data.input as MirrorInput;
      expect(input.skippedBookmarks).toBe(1);
      expect(input.comments).toEqual([]);
      expect(end.data.remarks as MirrorRemark[]).toEqual([]);
      expect(fetches, "the run reached the model").toEqual([]);
    });
  });

  /**
   * **The placements half of Mirror, end to end.**
   *
   * `mintPlacements` has had unit tests since it was written, and the panel has
   * had tests over hand-built remarks, and nothing joined `commentStore.load` →
   * `mirrorStream` → the `done` frame. The branch that leaves unguarded is the
   * one in src/referee-mirror.ts where a referee whose comments are **all bare
   * placements** gets `input.comments.length === 0` and an early return that must
   * still yield the minted remarks. It is reachable only through the route: every
   * unit test hands `mintPlacements` its list directly and never goes near the
   * return that carries it out.
   *
   * Two comments with a number and no words, through the real store, and the
   * whole of the referee's answer comes back for nothing.
   */
  describe("a referee whose every mark is a bare placement", () => {
    /**
     * The criterion both placements are made on, so the minted note can name it.
     *
     * **The id is taken off the row the store hands back, never written down.**
     * `begin` accepts a wanted id only if `isSpideryarnId` likes it, and quietly
     * mints its own otherwise — the alphabet has no `i`, `l`, `o` or `1`, so a
     * plausible-looking `spya-crtm31` is silently replaced. This test was written
     * with exactly that literal and the criterion text then failed to join, which
     * is the good version of that mistake: the join is what it checks. A test
     * that only looked at the valences would have passed.
     *
     * Under Postgres it is load-bearing twice over: `comments.criterion_id` is a
     * foreign key onto `(article_id, id)`, so a placement naming an id that is
     * not there is refused by the database rather than stored and ignored.
     */
    const CRITERION = "Is the evidence for the headline claim in the paper?";
    let criterionId = "";

    beforeEach(async () => {
      const { row } = await asTestOwner(() =>
        refereeCriteriaStore.begin(SLUG, CRITERION, {
          kind: "diverging",
          poles: { against: "the evidence is thin", favour: "the evidence is strong" },
          scale: "rg",
        }),
      );
      criterionId = row.id;
    });

    it("anchors on passages the article really has", async () => {
      /* The fixture check, and it is not decoration: with a made-up block id
         every assertion in the next test would still pass for the wrong reason
         — an empty `remarks` list is what a `comments-dropped` run yields too.
         Where the filesystem version read `data/<slug>/blocks.json` back off
         disk, this asks the blocks the seeder says it loaded. */
      for (const at of [FIRST, SECOND]) {
        const block = article.blocks.find((b) => b.id === at.blockId);
        expect(block, `${at.blockId} is not a block of the seeded article`).toBeDefined();
        expect(block?.text.slice(at.start, at.start + at.quote.length)).toBe(at.quote);
      }
      expect(FIRST.blockId).not.toBe(SECOND.blockId);
    });

    it("mints both placements, signed, without asking a model", async () => {
      /* −60 first in the document and +100 second. The two numbers are chosen so
         that document order and strength order DISAGREE: `mintPlacements` picks
         by absolute valence and then shows in document order, so `[+100, −60]`
         coming back would mean the second half of that had stopped happening. */
      await asTestOwner(async () => {
        await commentStore.create(SLUG, { ...FIRST, criterionId, valence: -60 });
        await commentStore.create(SLUG, { ...SECOND, criterionId, valence: 100 });
      });

      const reply = await call("POST", URL_FOR(SLUG));
      const end = terminal(reply);
      expect(end.name, `terminal frame said: ${JSON.stringify(end.data)}`).toBe("done");

      /* **Nothing was bought.** The strong form: not "no error arrived" but "the
         gateway was never reached". */
      expect(fetches, "the run reached the model").toEqual([]);
      expect(
        reply.frames.filter((f) => f.name === "delta"),
        "a delta frame can only come from a model",
      ).toEqual([]);

      /* Nothing went to the model, and nothing was thrown away either: the two
         marks are on `placements`, not on `comments`, and neither is a bookmark. */
      const input = end.data.input as MirrorInput;
      expect(input.comments).toEqual([]);
      expect(input.placements).toHaveLength(2);
      expect(input.skippedBookmarks).toBe(0);
      expect(input.skippedOrphans).toBe(0);
      expect(end.data.placementsOmitted).toBe(0);
      expect(end.data.coverage).toEqual({ asked: false, reason: "nothing-to-mirror" });

      const remarks = end.data.remarks as MirrorRemark[];
      expect(remarks.map((r) => r.kind)).toEqual(["placement", "placement"]);
      const valences = remarks.map((r) => (r.kind === "placement" ? r.valence : undefined));
      /* Document order, and the sign kept at both ends. A store or a wire hop
         that clamped the negative would say `[0, 100]` here and nothing else in
         the run would look wrong — which is the failure `Comment.valence` in
         src/types.ts is written around, and which is a *column* now rather than
         a number in a JSON file. */
      expect(valences).toEqual([-60, 100]);

      /* **Mutation.** `toComment` in src/store/pg-comments.ts, `valence:
         row.valence` made `valence: Math.max(0, row.valence)` — the clamp the
         paragraph above says nothing else in the run would notice. Re-run
         2026-09-04: *1 failed | 6 passed (7)*, this case, `expected [ +0, 100 ]
         to deeply equal [ -60, 100 ]`.

         **Blind to.** Which direction the sign was lost in. It proves the read
         carries a minus out; a clamp on the way *in* would leave the column at
         0 and fail this line identically, so `create` and `toComment` are not
         told apart from here. It says nothing about the `criterion_id` half of
         the same pair, and nothing about the two remaining cases in the file. */

      /* And the referee's own criterion text made it all the way through the
         join — `criterionId` off the comment, matched against the criteria the
         route loaded, printed into a sentence nobody paid for. */
      const [first] = remarks;
      if (first?.kind !== "placement") throw new Error("expected a placement");
      expect(first.criterion).toBe(CRITERION);
      expect(first.note).toContain("at −60");
      expect(first.note).toContain(CRITERION);
      expect(first.commentId).toMatch(/^spya-[a-z0-9]{6}$/);
      expect(first.blockId).toBe(FIRST.blockId);
      expect(first.passage).toBe(FIRST.quote);
    });
  });
});
