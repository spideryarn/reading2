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
 * Writes under `data/<throwaway slug>/`, which is gitignored, and removes it.
 */

import { cp, readFile, rm } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { handleApi } from "../src/routes.js";
import { createComment } from "../src/comments.js";
import type { MirrorInput, MirrorRemark } from "../src/referee-mirror-types.js";
/* The very object the route reads its criteria from, rather than the
   filesystem one by name: if the two ever differed, a test that named the
   implementation would go on passing while the route read somewhere else. */
import { refereeCriteriaStore } from "../src/store/index.js";
import { acceptAny, AUTHED_HEADERS } from "./helpers/authed.js";

const SLUG = "test-referee-mirror-route";
const DIR = path.resolve(import.meta.dirname, "..", "data", SLUG);
/** The committed fixture, so the article has real block ids to anchor to. */
const EXAMPLE = path.resolve(import.meta.dirname, "..", "example");

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
 */
let fetches: string[] = [];

beforeEach(async () => {
  fetches = [];
  vi.stubGlobal("fetch", (input: unknown) => {
    fetches.push(String(input));
    throw new Error("a model call was made");
  });
  await rm(DIR, { recursive: true, force: true });
  await cp(EXAMPLE, DIR, { recursive: true });
});
afterEach(async () => {
  vi.unstubAllGlobals();
  await rm(DIR, { recursive: true, force: true });
});

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
    await createComment(SLUG, {
      blockId: "spya-k3m9qt",
      quote: "the",
      start: 0,
    });

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
   * The two passages, read off the fixture rather than written down.
   *
   * **A placement on a block the article does not have is not a placement.**
   * `mirrorInput` counts it as an orphan — the check comes after the bookmark
   * check, so unlike a bookmark it never reaches the placements list — and the
   * run then reports `comments-dropped` and mints nothing. So the ids are
   * asserted against `example/blocks.json` below, not trusted.
   */
  const FIRST = { blockId: "spya-gp3g6s", quote: "Berggruen Prize", start: 30 };
  const SECOND = { blockId: "spya-rg493b", quote: "neuroscience professor", start: 2 };

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
   */
  const CRITERION = "Is the evidence for the headline claim in the paper?";
  let criterionId = "";

  beforeEach(async () => {
    const { row } = await refereeCriteriaStore.begin(SLUG, CRITERION, {
      kind: "diverging",
      poles: { against: "the evidence is thin", favour: "the evidence is strong" },
      scale: "rg",
    });
    criterionId = row.id;
  });

  it("anchors on passages the fixture really has", async () => {
    /* The fixture check, and it is not decoration: with a made-up block id
       every assertion in the next test would still pass for the wrong reason
       — an empty `remarks` list is what a `comments-dropped` run yields too. */
    const blocks = JSON.parse(
      await readFile(path.join(DIR, "blocks.json"), "utf8"),
    ) as { blocks: { id: string; text: string }[] };
    for (const at of [FIRST, SECOND]) {
      const block = blocks.blocks.find((b) => b.id === at.blockId);
      expect(block, `${at.blockId} is not a block of the fixture`).toBeDefined();
      expect(block?.text.slice(at.start, at.start + at.quote.length)).toBe(at.quote);
    }
  });

  it("mints both placements, signed, without asking a model", async () => {
    /* −60 first in the document and +100 second. The two numbers are chosen so
       that document order and strength order DISAGREE: `mintPlacements` picks
       by absolute valence and then shows in document order, so `[+100, −60]`
       coming back would mean the second half of that had stopped happening. */
    await createComment(SLUG, { ...FIRST, criterionId, valence: -60 });
    await createComment(SLUG, { ...SECOND, criterionId, valence: 100 });

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
       src/types.ts is written around. */
    expect(valences).toEqual([-60, 100]);

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
