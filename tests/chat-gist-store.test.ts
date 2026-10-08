/**
 * The store's half of a conversation's gist — plan
 * docs/plans/261008e-chat-knows-the-reader-s-other-conversations.md.
 *
 * `chatStore.setGist` writes only when nothing has been stored in the thread
 * since the transcript was read, never touches the clock the list sorts by,
 * and answers for the owner alone. Every transcript-changing path invalidates
 * the previous gist. `refreshGist` (src/routes.ts) writes the gist of a turn
 * whose answer landed, and nothing for one that did not.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { ChatGistGateway } from "../src/chat-gist.js";
import { closeDb } from "../src/db/client.js";
import { loadEnvLocal } from "../src/env.js";
import { mintId } from "../src/ids.js";
import { EVAL_OWNER_ID, runAsOwner } from "../src/owner.js";
import { TEST_OWNER } from "./helpers/authed.js";
import { pgReady } from "./helpers/pg-ready.js";
import { scratchArticleInPg, type ScratchArticle } from "./helpers/scratch-article.js";

loadEnvLocal();

const SLUG = "test-chat-gist-store";
const OTHER = "test-chat-gist-store-other";

await pgReady({
  suite: "tests/chat-gist-store.test.ts",
  tables: ["spideryarn.chat_threads", "spideryarn.chat_messages"],
});

const { chatStore } = await import("../src/store/index.js");
const { refreshGist } = await import("../src/routes.js");

let mine: ScratchArticle | undefined;
let theirs: ScratchArticle | undefined;

beforeAll(async () => {
  mine = await scratchArticleInPg(SLUG, { ownerId: TEST_OWNER });
  theirs = await scratchArticleInPg(OTHER, { ownerId: EVAL_OWNER_ID });
}, 120_000);

afterAll(async () => {
  await mine?.remove();
  await theirs?.remove();
  await closeDb();
});

const asMe = <T>(fn: () => Promise<T>) => runAsOwner(TEST_OWNER, fn);

/** One finished exchange; the turn's thread and reply ids. */
async function exchange(slug: string, threadId: string, question: string, answer: string, status: "done" | "error" = "done") {
  const turn = await chatStore.begin(slug, { threadId, question });
  await chatStore.finish(
    slug,
    turn.thread.id,
    turn.reply.id,
    status === "done" ? { status, text: answer } : { status, text: answer, error: "it failed" },
    { attempt: turn.attempt },
  );
  return { threadId: turn.thread.id, replyId: turn.reply.id };
}

const stored = async (slug: string, id: string) => (await chatStore.load(slug)).find((t) => t.id === id);

const answering = (gist: string): { gateway: ChatGistGateway; calls: () => number } => {
  let calls = 0;
  return {
    gateway: async () => {
      calls++;
      return { json: { choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ gist }) } }] } } as Awaited<
        ReturnType<ChatGistGateway>
      >;
    },
    calls: () => calls,
  };
};

describe("chatStore.setGist", () => {
  it("writes when nothing has changed since, and leaves the clock alone", async () => {
    await asMe(async () => {
      const { threadId } = await exchange(SLUG, mintId(), "Any confounds?", "Three.");
      const before = await stored(SLUG, threadId);
      expect(before?.gist).toBeUndefined();
      expect(await chatStore.setGist(SLUG, threadId, "Confounds: three", before!)).toBe(true);
      const after = await stored(SLUG, threadId);
      expect(after?.gist).toBe("Confounds: three");
      expect(after?.updatedAt).toBe(before?.updatedAt);
    });
  });

  it("does not write a gist of a transcript that has moved on", async () => {
    await asMe(async () => {
      const { threadId } = await exchange(SLUG, mintId(), "First?", "One.");
      const old = (await stored(SLUG, threadId))!;
      await exchange(SLUG, threadId, "Second?", "Two.");
      expect(await chatStore.setGist(SLUG, threadId, "STALE", old)).toBe(false);
      expect((await stored(SLUG, threadId))?.gist).toBeUndefined();
    });
  });

  it("refuses a changed transcript even when its millisecond clock is identical", async () => {
    await asMe(async () => {
      const sameMillisecond = () => "2026-10-08T12:34:56.789Z";
      const threadId = mintId();
      const first = await chatStore.begin(SLUG, { threadId, question: "First?" }, sameMillisecond);
      await chatStore.finish(
        SLUG,
        first.thread.id,
        first.reply.id,
        { status: "done", text: "One." },
        { attempt: first.attempt, now: sameMillisecond },
      );
      const old = (await stored(SLUG, threadId))!;
      await chatStore.begin(SLUG, { threadId, question: "Second?" }, sameMillisecond);
      expect((await stored(SLUG, threadId))?.updatedAt).toBe(old.updatedAt);
      expect(await chatStore.setGist(SLUG, threadId, "STALE", old)).toBe(false);
    });
  });

  it("cannot reach another reader's conversation", async () => {
    const theirsId = await runAsOwner(EVAL_OWNER_ID, async () => (await exchange(OTHER, mintId(), "Theirs?", "Theirs.")).threadId);
    const at = await runAsOwner(EVAL_OWNER_ID, async () => (await stored(OTHER, theirsId))!);
    await asMe(async () => {
      await expect(chatStore.setGist(OTHER, theirsId, "INTRUDER", at)).rejects.toThrow();
    });
    expect(await runAsOwner(EVAL_OWNER_ID, async () => (await stored(OTHER, theirsId))?.gist)).toBeUndefined();
  });

  it("clears a stale gist on every path that changes what another conversation may read", async () => {
    await asMe(async () => {
      const seed = async (question: string, answer: string) => {
        const ids = await exchange(SLUG, mintId(), question, answer);
        const before = await stored(SLUG, ids.threadId);
        expect(await chatStore.setGist(SLUG, ids.threadId, `old gist for ${question}`, before!)).toBe(true);
        return { ...ids, thread: (await stored(SLUG, ids.threadId))! };
      };

      const appended = await seed("Append?", "Old append answer.");
      await chatStore.begin(SLUG, { threadId: appended.threadId, question: "A new typed question" });
      expect((await stored(SLUG, appended.threadId))?.gist).toBeUndefined();

      const retried = await seed("Retry?", "Old retry answer.");
      await chatStore.retry(SLUG, retried.threadId, retried.replyId);
      expect((await stored(SLUG, retried.threadId))?.gist).toBeUndefined();

      const edited = await seed("Edit?", "Old edit answer.");
      await chatStore.edit(SLUG, edited.threadId, edited.thread.messages[0]!.id, "Edited question", {
        expectedTailId: edited.replyId,
      });
      expect((await stored(SLUG, edited.threadId))?.gist).toBeUndefined();

      const spoken = await seed("Spoken?", "Old spoken answer.");
      await chatStore.appendSpoken(SLUG, {
        threadId: spoken.threadId,
        expectedTailId: spoken.replyId,
        question: "A spoken question",
        answer: "A spoken answer",
      });
      expect((await stored(SLUG, spoken.threadId))?.gist).toBeUndefined();

      const hint = "The hidden clue.";
      const turn = await chatStore.begin(SLUG, {
        threadId: mintId(),
        question: "Recall?",
        kind: "learn",
      });
      await chatStore.finish(
        SLUG,
        turn.thread.id,
        turn.reply.id,
        { status: "done", text: `What follows?\n\nHint: ${hint}` },
        { attempt: turn.attempt },
      );
      const beforeHint = await stored(SLUG, turn.thread.id);
      expect(await chatStore.setGist(SLUG, turn.thread.id, "old gist without the hint", beforeHint!)).toBe(true);
      expect((await chatStore.markHintOpened(SLUG, turn.thread.id, turn.reply.id, hint)).ok).toBe(true);
      expect((await stored(SLUG, turn.thread.id))?.gist).toBeUndefined();
      expect(await chatStore.setGist(SLUG, turn.thread.id, "late gist without the hint", beforeHint!)).toBe(false);
      expect((await stored(SLUG, turn.thread.id))?.gist).toBeUndefined();
    });
  });

  it("reports whether an attempt-fenced finish actually landed", async () => {
    await asMe(async () => {
      const turn = await chatStore.begin(SLUG, { threadId: mintId(), question: "Which attempt?" });
      expect(
        await chatStore.finish(
          SLUG,
          turn.thread.id,
          turn.reply.id,
          { status: "done", text: "The first." },
          { attempt: turn.attempt },
        ),
      ).toBe(true);
      expect(
        await chatStore.finish(
          SLUG,
          turn.thread.id,
          turn.reply.id,
          { status: "done", text: "A late duplicate." },
          { attempt: turn.attempt },
        ),
      ).toBe(false);
    });
  });
});

describe("refreshGist", () => {
  it("writes the gist of a turn whose answer landed", async () => {
    await asMe(async () => {
      const { threadId, replyId } = await exchange(SLUG, mintId(), "Any confounds?", "Sample, caffeine.");
      const model = answering("Confounds: sample, caffeine");
      await refreshGist(SLUG, threadId, replyId, model.gateway);
      expect(model.calls()).toBe(1);
      expect((await stored(SLUG, threadId))?.gist).toBe("Confounds: sample, caffeine");
    });
  });

  it("asks nothing and writes nothing when the turn's answer did not land", async () => {
    await asMe(async () => {
      const { threadId, replyId } = await exchange(SLUG, mintId(), "Q?", "half", "error");
      const model = answering("SHOULD-NOT-BE-WRITTEN");
      await refreshGist(SLUG, threadId, replyId, model.gateway);
      expect(model.calls()).toBe(0);
      expect((await stored(SLUG, threadId))?.gist).toBeUndefined();
    });
  });

  it("never throws, and writes nothing, when the model fails", async () => {
    await asMe(async () => {
      const { threadId, replyId } = await exchange(SLUG, mintId(), "Q?", "A.");
      await expect(
        refreshGist(SLUG, threadId, replyId, async () => {
          throw new Error("provider down");
        }),
      ).resolves.toBeUndefined();
      expect((await stored(SLUG, threadId))?.gist).toBeUndefined();
    });
  });
});
