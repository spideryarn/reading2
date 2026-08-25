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
  createComment,
  deleteComment,
  loadComments,
  patchComment,
} from "../src/comments.js";
import { describeFetchFailure } from "../src/web/useComments.js";

const SLUG = "test-comments-fixture";
const DIR = path.resolve(import.meta.dirname, "..", "data", SLUG);
const anchor = { blockId: "spya-k3m9qt", quote: "the hard problem", start: 12 };

afterEach(() => rm(DIR, { recursive: true, force: true }));

describe("comment storage", () => {
  it("is empty for an article nobody has commented on", async () => {
    expect(await loadComments(SLUG)).toEqual([]);
  });

  it("stores a new comment as pending, before any model has been called", async () => {
    // The ordering is the point: a crash mid-answer must leave evidence rather
    // than losing the question. See src/comments.ts § createComment.
    const created = await createComment(SLUG, anchor);
    expect(created.status).toBe("pending");
    expect(created.answer).toBeUndefined();
    expect(await loadComments(SLUG)).toEqual([created]);
  });

  it("keeps the client's id, so the dialog never has to swap one out", async () => {
    const created = await createComment(SLUG, { ...anchor, id: "spya-k3m9qt" });
    expect(created.id).toBe("spya-k3m9qt");
  });

  it("mints its own id when the client's is malformed", async () => {
    const made = await createComment(SLUG, { ...anchor, id: "../../etc/passwd" });
    expect(made.id).toMatch(/^spya-[a-z][a-z0-9]{5}$/);
  });

  it("resets an existing comment in place rather than appending a second one", async () => {
    // This is the retry path, and it is the whole reason createComment is
    // idempotent on the id. Appending instead would leave the failed original in
    // the file, drawing a second mark over the same words that nothing clears.
    const first = await createComment(SLUG, { ...anchor, id: "spya-k3m9qt" });
    await patchComment(SLUG, first.id, { status: "error", error: "OpenRouter 402" });

    const again = await createComment(SLUG, { ...anchor, id: "spya-k3m9qt" });
    expect(again.id).toBe(first.id);
    expect(again.createdAt).toBe(first.createdAt); // asked once, answered twice
    expect(await loadComments(SLUG)).toEqual([again]);
  });

  it("clears the failed attempt's answer and error on reset", async () => {
    const first = await createComment(SLUG, { ...anchor, id: "spya-k3m9qt" });
    await patchComment(SLUG, first.id, {
      status: "done",
      answer: "stale",
      citations: [{ url: "https://example.com" }],
      searches: 2,
      error: "old",
    });

    const again = await createComment(SLUG, { ...anchor, id: "spya-k3m9qt" });
    expect(again.status).toBe("pending");
    expect(again.answer).toBeUndefined();
    expect(again.citations).toBeUndefined();
    expect(again.searches).toBeUndefined();
    expect(again.error).toBeUndefined();
    expect((await loadComments(SLUG))[0]!.answer).toBeUndefined();
  });

  it("patches one comment without disturbing the others", async () => {
    const a = await createComment(SLUG, anchor);
    const b = await createComment(SLUG, { ...anchor, quote: "another passage" });
    await patchComment(SLUG, b.id, { status: "done", answer: "Because…" });

    const stored = await loadComments(SLUG);
    expect(stored.find((c) => c.id === a.id)?.status).toBe("pending");
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
