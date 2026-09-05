/**
 * Two things that both belong to comments, and neither of them is a store.
 *
 * **This file used to be the filesystem comment store's own suite** — 23 cases
 * against `data/<slug>/comments.json`. `createComment`, `beginAnswer`,
 * `patchComment`, `patchCommentBody`, `patchCommentMark`, `linkCommentThread`,
 * `deleteComment`, `sweepPendingComments` and `update` went with the filesystem
 * store on 2026-09-05
 * (docs/plans/260903f-delete-the-spideryarn-store-flag-and-the-filesystem-store.md,
 * the stage-G section). `loadComments` stayed, because
 * `tests/helpers/seed-reader-state.ts` reads a fixture's file through it to
 * seed `comments` rows, and the block below is what says it still reads.
 *
 * `describeFetchFailure` was always here and was never about the store — it is
 * `src/web/useComments.ts`, the wording a reader sees when a request fails —
 * and it is untouched.
 *
 * **Where the storage cases went:**
 *
 * - **Already in `tests/store-comments.test.ts`**: free-not-answered, the
 *   reader's words, a stored id refused rather than overwritten, a retry
 *   clearing the attempt and keeping everything the reader owns, the thread
 *   link refusing to be re-pointed, a second answer while one is running, a
 *   bookmark refused down the retired explanation path, editing and clearing
 *   the body, a patch that cannot rename, deletion, and the
 *   identical-Save-twice idempotence (§ *survives a create arriving while an
 *   identical one is uncommitted*, which holds the losing side open by hand and
 *   is the stronger version).
 * - **Ported there in the same commit**: *"mints its own id when the client's is
 *   malformed"*. `pg-comments.ts` re-states that rule —
 *   `isSpideryarnId(input.id) ? input.id : undefined` — and nothing drove it;
 *   the neighbouring case only says an *absent* id is minted, which the same
 *   line satisfies with the check deleted.
 * - **Abolished rather than dropped**: *"keeps every comment when several are
 *   created at once"* and both cases of § *the file is swapped, not truncated*.
 *   All three were properties of a whole-file rewrite behind a per-process
 *   queue. There is no file and no queue; § *turns a losing concurrent create
 *   into a refusal, not a raw key error* is what SQL puts in their place.
 * - **Dropped, and named**: *"patches one comment without disturbing the
 *   others"*. In SQL the `WHERE` on the id is the whole of it, and there is no
 *   read-modify-write of a list left for it to be a claim about.
 *
 * Deterministic: no network, no model.
 */
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadComments } from "../src/comments.js";
import { describeFetchFailure } from "../src/web/useComments.js";
import { StreamStalled } from "../src/web/lib/sse.js";
import { wentQuiet } from "../src/messages.js";

const SLUG = "test-comments-fixture";
const DIR = path.resolve(import.meta.dirname, "..", "data", SLUG);
const anchor = { blockId: "spya-k3m9qt", quote: "the hard problem", start: 12 };

async function writeComments(body: string): Promise<void> {
  await mkdir(DIR, { recursive: true });
  await writeFile(path.join(DIR, "comments.json"), body, "utf8");
}

afterEach(() => rm(DIR, { recursive: true, force: true }));

describe("reading a comments.json", () => {
  it("is empty for an article nobody has commented on", async () => {
    // The ordinary case, not a fault — a seeder that threw on one could not
    // seed most of a corpus.
    expect(await loadComments(SLUG)).toEqual([]);
  });

  it("refuses a slug that is not a path segment", async () => {
    // A slug becomes a directory name. Refusing is the whole defence; a
    // sanitiser is a thing that can be wrong about one case.
    await expect(loadComments("../../etc")).rejects.toThrow(/valid slug/);
  });

  it("reads a stored comment back whole", async () => {
    const stored = {
      ...anchor,
      id: "spya-k3m9qt",
      status: "none",
      createdAt: "2026-08-20T00:00:00.000Z",
    };
    await writeComments(JSON.stringify({ comments: [stored] }));
    expect(await loadComments(SLUG)).toEqual([stored]);
  });

  it("throws on a file that will not parse, rather than reporting no comments", async () => {
    /* The highest-stakes line in the module. A `[]` here would look exactly
       like "you have never commented on this", and the next write would make
       that true. It is also one of the drivers in tests/parse-json.test.ts:
       the log line must name `comments.json` without quoting the reader's own
       question back into it. */
    await writeComments("{ not json");
    await expect(loadComments(SLUG)).rejects.toThrow();
  });
});

describe("describeFetchFailure", () => {
  it("turns fetch's bare TypeError into something a reader can act on", () => {
    // The failure Greg actually hit on 2026-08-25: the dev server was not
    // running, and "Failed to fetch" said nothing about what to do next.
    const message = describeFetchFailure(new TypeError("Failed to fetch"));
    expect(message).toContain("npm run dev");
    expect(message).toContain("Failed to fetch"); // still searchable
  });

  it("leaves a real server message alone", () => {
    // Anything we threw ourselves already says something useful; wrapping it in
    // "is the dev server running?" would be actively misleading.
    expect(describeFetchFailure(new Error("OpenRouter 402: Insufficient credits"))).toBe(
      "OpenRouter 402: Insufficient credits",
    );
  });

  it("words a stalled stream for a reader rather than for a stack trace", () => {
    // `StreamStalled`'s own message is "the stream sent nothing for 60s", which
    // is the right thing to find in a log and the wrong thing to put on screen.
    // All three streaming hooks describe their failures through this function,
    // so wording it here is what stops the class message reaching any of them.
    const message = describeFetchFailure(new StreamStalled(60_000));
    expect(message).toBe(wentQuiet(60).message);
    expect(message).toContain("[ai-stalled]");
    expect(message).not.toContain("the stream sent nothing");
  });
});
