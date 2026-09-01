/**
 * Comment storage — src/comments.ts. See docs/project/comments.md.
 *
 * Deterministic: no network, no model. The one genuinely nondeterministic thing
 * a comment involves — the model call in src/explain.ts — is not tested here,
 * for the reason testing.md gives about stage 4.
 *
 * Writes under `data/<throwaway slug>/`, which is gitignored, and removes it.
 */
import { readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  beginAnswer,
  CommentIdTaken,
  createComment,
  deleteComment,
  linkCommentThread,
  loadComments,
  patchComment,
  patchCommentBody,
} from "../src/comments.js";
import { describeFetchFailure } from "../src/web/useComments.js";
import { StreamStalled } from "../src/web/lib/sse.js";
import { wentQuiet } from "../src/messages.js";

const SLUG = "test-comments-fixture";
const DIR = path.resolve(import.meta.dirname, "..", "data", SLUG);
const anchor = { blockId: "spya-k3m9qt", quote: "the hard problem", start: 12 };

afterEach(() => rm(DIR, { recursive: true, force: true }));

describe("comment storage", () => {
  it("is empty for an article nobody has commented on", async () => {
    expect(await loadComments(SLUG)).toEqual([]);
  });

  it("stores a new comment as free — no model call was ever attempted", async () => {
    /* `none` is the whole feature: a comment is the reader's mark on a passage
       and costs nothing. It also has to be a state `sweepOrphaned` cannot see —
       that function turns an abandoned `pending` row into an error, and a
       bookmark is not an answer that never arrived. */
    const created = await createComment(SLUG, anchor);
    expect(created.status).toBe("none");
    expect(created.answer).toBeUndefined();
    expect(created.body).toBeUndefined();
    expect(await loadComments(SLUG)).toEqual([created]);
  });

  it("keeps the reader's own words, and only when there are some", async () => {
    const withBody = await createComment(SLUG, { ...anchor, body: "this is the bit I doubt" });
    expect(withBody.body).toBe("this is the bit I doubt");
    /* **Absent, not `""`.** The two stores are compared structurally, so an
       empty string on one side and a missing key on the other is a real
       failure — and the database has a check constraint saying the same. */
    const bare = await createComment(SLUG, { ...anchor, quote: "another passage" });
    expect("body" in bare).toBe(false);
  });

  it("keeps the client's id, so the dialog never has to swap one out", async () => {
    const created = await createComment(SLUG, { ...anchor, id: "spya-k3m9qt" });
    expect(created.id).toBe("spya-k3m9qt");
  });

  it("mints its own id when the client's is malformed", async () => {
    const made = await createComment(SLUG, { ...anchor, id: "../../etc/passwd" });
    expect(made.id).toMatch(/^spya-[a-z][a-z0-9]{5}$/);
  });

  it("hands back the same comment when the identical Save arrives twice", async () => {
    // A double-clicked Save, or a POST retried by the browser. Idempotent means
    // *return the one you have*: appending would draw a second mark over the
    // same words that nothing can clear.
    const first = await createComment(SLUG, { ...anchor, id: "spya-k3m9qt", body: "hm" });
    const again = await createComment(SLUG, { ...anchor, id: "spya-k3m9qt", body: "hm" });
    expect(again).toEqual(first);
    expect(await loadComments(SLUG)).toEqual([first]);
  });

  it("refuses a stored id rather than overwriting the comment under it", async () => {
    /* **The bug this whole split exists to prevent.** While creating a comment
       cost a model call, a colliding id could only be a retry, and resetting
       the row was the right answer. Now that it is free, a collision is an
       ordinary event — and a reset would silently rewrite the anchor and blank
       the answer of a comment the reader made in another tab. GPT Sol found
       this reviewing the plan, 2026-08-28. */
    const first = await createComment(SLUG, { ...anchor, id: "spya-k3m9qt", body: "mine" });
    await expect(
      createComment(SLUG, { ...anchor, quote: "somewhere else", id: "spya-k3m9qt" }),
    ).rejects.toBeInstanceOf(CommentIdTaken);
    // And the stored one is untouched, which is the half that matters.
    expect(await loadComments(SLUG)).toEqual([first]);
  });

  it("clears the failed attempt's answer, and keeps everything the reader owns", async () => {
    /* `beginAnswer` is the retry path. The answer fields belong to the attempt
       being replaced and go; the anchor, the creation time, the reader's words
       and the linked conversation are theirs and stay. Building the row from
       named fields — which the old `createComment` reset did — would blank all
       three of the reader's the moment they pressed "Try again". */
    const first = await createComment(SLUG, { ...anchor, id: "spya-k3m9qt", body: "my note" });
    await linkCommentThread(SLUG, first.id, "spya-t2t2t2", anchor);
    await patchComment(SLUG, first.id, {
      status: "done",
      answer: "stale",
      citations: [{ url: "https://example.com" }],
      searches: 2,
      error: "old",
    });

    const { comment: again, attempt } = await beginAnswer(SLUG, first.id);
    /* No fence on the filesystem side, and the absence is asserted rather than
       assumed: one process means `begun` in src/comments.ts can say whether an
       attempt is live without a token. See `CommentStore.patch`. */
    expect(attempt).toBeUndefined();
    expect(again.status).toBe("pending");
    expect(again.answer).toBeUndefined();
    expect(again.citations).toBeUndefined();
    expect(again.searches).toBeUndefined();
    expect(again.error).toBeUndefined();
    expect(again.createdAt).toBe(first.createdAt); // marked once, answered twice
    expect(again.body).toBe("my note");
    expect(again.threadId).toBe("spya-t2t2t2");
    expect((await loadComments(SLUG))[0]!.answer).toBeUndefined();
  });

  it("refuses to link a comment that is not the one the conversation is about", async () => {
    /* `sourceCommentId` comes off a request, so on its own it names any comment
       this reader owns on this article — a stale id from another tab would
       attach the conversation to an unrelated mark. GPT Sol, 2026-08-28. */
    const made = await createComment(SLUG, anchor);
    await expect(
      linkCommentThread(SLUG, made.id, "spya-t2t2t2", { ...anchor, quote: "different words" }),
    ).rejects.toBeInstanceOf(CommentIdTaken);
    expect((await loadComments(SLUG))[0]!.threadId).toBeUndefined();
  });

  it("refuses a second answer while one is already running", async () => {
    /* `status !== "none"` was not a claim: a row already `pending` passed it,
       so two presses of Try again both succeeded and bought two model calls.
       GPT Sol, reviewing the built code, 2026-08-28. */
    const made = await createComment(SLUG, { ...anchor, id: "spya-k3m9qt" });
    await patchComment(SLUG, made.id, { status: "done", answer: "an old explanation" });
    await beginAnswer(SLUG, made.id); // now pending
    await expect(beginAnswer(SLUG, made.id)).rejects.toThrow(/already being answered/);
  });

  it("will not drag a bookmark down the retired explanation path", async () => {
    const bare = await createComment(SLUG, anchor);
    await expect(beginAnswer(SLUG, bare.id)).rejects.toThrow(/never a question/);
    expect((await loadComments(SLUG))[0]!.status).toBe("none");
  });

  it("edits the body, and clearing it leaves a bare bookmark", async () => {
    const made = await createComment(SLUG, { ...anchor, body: "first thought" });
    const edited = await patchCommentBody(SLUG, made.id, "second thought");
    expect(edited.body).toBe("second thought");
    expect(edited.updatedAt).toBeDefined();

    const cleared = await patchCommentBody(SLUG, made.id, null);
    // Absent rather than empty, for the same reason creation drops `""`.
    expect("body" in cleared).toBe(false);
  });

  it("links a comment to one conversation, and only one", async () => {
    const made = await createComment(SLUG, anchor);
    const linked = await linkCommentThread(SLUG, made.id, "spya-t2t2t2", anchor);
    expect(linked.threadId).toBe("spya-t2t2t2");
    // The same link again is the client retrying, and is a no-op.
    expect((await linkCommentThread(SLUG, made.id, "spya-t2t2t2", anchor)).threadId).toBe(
      "spya-t2t2t2",
    );
    // A different one would orphan the first conversation.
    await expect(
      linkCommentThread(SLUG, made.id, "spya-t3t3t3", anchor),
    ).rejects.toBeInstanceOf(CommentIdTaken);
    expect((await loadComments(SLUG))[0]!.threadId).toBe("spya-t2t2t2");
  });

  it("patches one comment without disturbing the others", async () => {
    const a = await createComment(SLUG, anchor);
    const b = await createComment(SLUG, { ...anchor, quote: "another passage" });
    await patchComment(SLUG, b.id, { status: "done", answer: "Because…" });

    const stored = await loadComments(SLUG);
    expect(stored.find((c) => c.id === a.id)?.status).toBe("none");
    expect(stored.find((c) => c.id === b.id)).toMatchObject({
      status: "done",
      answer: "Because…",
    });
  });

  it("never lets a patch rewrite an id", async () => {
    const a = await createComment(SLUG, anchor);
    await patchComment(SLUG, a.id, { id: "spya-zzzzzz" } as never);
    expect((await loadComments(SLUG))[0]!.id).toBe(a.id);
  });

  it("keeps every comment when several are created at once", async () => {
    // Selecting two passages in quick succession is the *normal* way to use
    // this, and each is a read-modify-write of the whole file. Without the
    // serialisation in src/comments.ts the second read starts before the first
    // write lands and one comment vanishes — with both writes reporting success.
    const made = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        createComment(SLUG, { ...anchor, quote: `passage ${i}` }),
      ),
    );
    const stored = await loadComments(SLUG);
    expect(stored).toHaveLength(8);
    expect(new Set(stored.map((c) => c.id))).toEqual(new Set(made.map((c) => c.id)));
  });

  it("deletes one comment and leaves the rest", async () => {
    const a = await createComment(SLUG, anchor);
    const b = await createComment(SLUG, { ...anchor, quote: "another passage" });
    expect(await deleteComment(SLUG, a.id)).toEqual([expect.objectContaining({ id: b.id })]);
  });

  it("refuses a slug that is not a path segment", async () => {
    await expect(loadComments("../../etc")).rejects.toThrow(/valid slug/);
    await expect(createComment("..", anchor)).rejects.toThrow(/valid slug/);
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

describe("the file is swapped, not truncated", () => {
  it("leaves no temp file behind, and always parses", async () => {
    // `writeFile` truncates before it writes, so a crash inside that window
    // leaves a half-written comments.json and every later read throws — losing
    // *all* the comments for the article, not just the one being written. The
    // write goes to a neighbour and renames over the top instead.
    for (let i = 0; i < 5; i++) {
      await createComment(SLUG, { ...anchor, quote: `question ${i}` });
    }
    const names = await readdir(DIR);
    expect(names).toEqual(["comments.json"]);

    const raw = await readFile(path.join(DIR, "comments.json"), "utf8");
    expect(() => JSON.parse(raw)).not.toThrow();
    expect(JSON.parse(raw).comments).toHaveLength(5);
  });

  it("survives writes issued together, because they are serialised", async () => {
    // Two selections in quick succession is the normal way to use this.
    await Promise.all(
      [0, 1, 2, 3].map((i) => createComment(SLUG, { ...anchor, quote: `at once ${i}` })),
    );
    expect(await loadComments(SLUG)).toHaveLength(4);
    expect(await readdir(DIR)).toEqual(["comments.json"]);
  });
});
