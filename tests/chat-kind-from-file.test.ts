/**
 * **A `chat.json` written before a thread kind was renamed reads back as the
 * kind it became, never as a chat.**
 *
 * The database renamed `review` to `remember` (0048, 2026-09-01) and
 * `remember` to `learn` (20261006035355). A file on disk is not migrated: a
 * fixture or a working `data/<slug>/chat.json` written before either keeps the
 * old word. Until this test, `normaliseKind` in src/chat.ts turned any word it
 * did not know into `"chat"`, so a Recall conversation silently became a chat
 * on its way into Postgres — the failure the `kind` field exists to prevent.
 * docs/postmortems/261007a-a-renamed-enum-word-read-by-a-lenient-reader-becomes-its-default.md.
 */
import { describe, expect, it } from "vitest";
import { foldRetiredTutorial, kindFromFile } from "../src/chat.js";
import { THREAD_KINDS, type ChatMessage, type ChatThread } from "../src/types.js";

describe("kindFromFile", () => {
  it("reads a retired kind as the kind it was renamed to", () => {
    expect(kindFromFile("remember")).toBe("learn");
    expect(kindFromFile("review")).toBe("learn");
    /* Tutorial was folded into Recall on 2026-10-20 (plan 261020m). */
    expect(kindFromFile("tutorial")).toBe("learn");
  });

  it("reads an absent kind as a chat — a file written before Learn existed", () => {
    expect(kindFromFile(undefined)).toBe("chat");
  });

  it("keeps every current kind as it is", () => {
    for (const kind of THREAD_KINDS) expect(kindFromFile(kind)).toBe(kind);
  });

  it("refuses a kind it has no name for, rather than calling it a chat", () => {
    expect(() => kindFromFile("recall")).toThrow(/unknown thread kind/);
    expect(() => kindFromFile(3)).toThrow(/unknown thread kind/);
  });

  it.each([null, "", false, {}, [], "constructor", "toString", "__proto__"])(
    "refuses malformed and inherited kinds: %j",
    (kind) => {
      expect(() => kindFromFile(kind)).toThrow(/unknown thread kind/);
    },
  );

  it("does not put arbitrary file contents in an error that loadThreads logs", () => {
    const prose = "private conversation accidentally placed in kind";
    try {
      kindFromFile(prose);
      expect.fail("a kind outside the known names must throw");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toMatch(/unknown thread kind/);
      expect((error as Error).message).not.toContain(prose.slice(0, 20));
    }
  });
});

/**
 * **A file holding both a Recall and a Tutorial thread** reads back as one
 * Recall thread, as drizzle/20261020063618_fold_tutorial_into_recall.sql folds
 * the rows (GPT Sol's F4 on docs/plans/261020m-recall-and-tutorial-become-one-recall.md).
 */
describe("foldRetiredTutorial", () => {
  const msg = (id: string, role: "user" | "assistant"): ChatMessage =>
    ({ id, role, text: `text ${id}`, createdAt: "2026-09-01T10:00:00.000Z", status: "done" }) as ChatMessage;
  const thread = (id: string, kind: string, updatedAt: string, messages: ChatMessage[], gist?: string): ChatThread =>
    ({
      id,
      title: `title ${id}`,
      createdAt: "2026-09-01T10:00:00.000Z",
      updatedAt,
      kind,
      messages,
      ...(gist ? { gist } : {}),
    }) as unknown as ChatThread;

  it("appends the Tutorial thread's messages to the Recall thread and drops the Tutorial thread", () => {
    const recall = thread("spya-rcaa04", "learn", "2026-09-02T10:00:00.000Z", [msg("spya-r1", "user"), msg("spya-r2", "assistant")], "a gist");
    const tutorial = thread("spya-tuaa04", "tutorial", "2026-09-05T10:00:00.000Z", [msg("spya-t1", "user"), msg("spya-t2", "assistant")]);
    const chat = thread("spya-chat04", "chat", "2026-09-03T10:00:00.000Z", [msg("spya-c1", "user")]);

    const folded = foldRetiredTutorial([tutorial, recall, chat]);

    expect(folded.map((t) => t.id)).toEqual(["spya-rcaa04", "spya-chat04"]);
    const kept = folded[0]!;
    expect(kept.kind).toBe("learn");
    expect(kept.title).toBe("title spya-rcaa04");
    expect(kept.messages.map((m) => m.id)).toEqual(["spya-r1", "spya-r2", "spya-t1", "spya-t2"]);
    /* The later clock, and no gist: the transcript it summarised has grown. */
    expect(kept.updatedAt).toBe("2026-09-05T10:00:00.000Z");
    expect(kept.gist).toBeUndefined();
    expect(folded[1]).toBe(chat);
  });

  it("folds into a Recall thread written under a retired word too", () => {
    const recall = thread("spya-rcaa04", "remember", "2026-09-06T10:00:00.000Z", [msg("spya-r1", "user")]);
    const tutorial = thread("spya-tuaa04", "tutorial", "2026-09-05T10:00:00.000Z", [msg("spya-t1", "user")]);
    const [kept, ...rest] = foldRetiredTutorial([recall, tutorial]);
    expect(rest).toEqual([]);
    expect(kept?.messages.map((m) => m.id)).toEqual(["spya-r1", "spya-t1"]);
    expect(kept?.updatedAt).toBe("2026-09-06T10:00:00.000Z");
  });

  it("leaves a Tutorial thread alone when there is no Recall thread (kindFromFile renames it)", () => {
    const tutorial = thread("spya-tuaa04", "tutorial", "2026-09-05T10:00:00.000Z", [msg("spya-t1", "user")], "kept gist");
    expect(foldRetiredTutorial([tutorial])).toEqual([tutorial]);
  });
});
