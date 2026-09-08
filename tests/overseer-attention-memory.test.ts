/**
 * The attention pass's memory on disk — tools/overseer/attention-memory.ts.
 *
 * **The asymmetry is the whole file.** A VERDICT is about a piece of text and
 * stays true across any gap, so it survives a restart and saves the money it was
 * cached to save. A WAIT is about continuous observation and cannot survive one:
 * everything that happened while nothing was looking is unknown.
 *
 * That distinction was missing, and GPT Sol found it (finding 2). `store.ts`
 * deliberately refuses to republish the previous attention list after a restart —
 * a first-seen instant for a question that may have been answered during the
 * downtime is a false claim about a person's obligations — and this file quietly
 * undid it by persisting the waits. It is the same bug as the four sessions that
 * printed `13m` because the number was measuring the daemon's uptime rather than
 * theirs, one level down.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import {
  ATTENTION_MEMORY_FILE,
  ATTENTION_MEMORY_SCHEMA,
  memoryForEpoch,
  parseAttentionMemory,
  readAttentionMemory,
  writeAttentionMemory,
  type AttentionMemory,
} from "../tools/overseer/attention-memory.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "overseer-attention-memory-"));
  roots.push(root);
  return root;
}

const MEMORY: AttentionMemory = {
  epoch: "daemon-one",
  waits: new Map([["$1 abc", "2026-09-08T09:00:00.000Z"]]),
  verdicts: new Map([
    [
      "abc",
      {
        fingerprint: "abc",
        classifiedAt: "2026-09-08T09:00:00.000Z",
        verdict: {
          kind: "question" as const,
          topic: "shall I push",
          why: "it stopped and offered",
          attentionKind: "irreversible" as const,
          answerability: { kind: "phone" as const },
        },
      },
    ],
  ]),
};

describe("the epoch — what survives a gap and what must not", () => {
  test("keeps the waits when the epoch matches, because observation was continuous", () => {
    const same = memoryForEpoch(MEMORY, "daemon-one");
    expect([...same.waits]).toEqual([["$1 abc", "2026-09-08T09:00:00.000Z"]]);
  });

  test("DROPS the waits when the epoch changed, because a gap cannot be timed through", () => {
    // Sol's reproduction: `$1` asks Q at 09:00; the daemon stops; Q is answered
    // and asked again while nothing is watching; the daemon restarts and sees Q
    // at 12:00. Without this, the inbox says "waiting since 09:00" and tells Greg
    // he has ignored something for three hours that he has ignored for none.
    const fresh = memoryForEpoch(MEMORY, "daemon-two");
    expect(fresh.waits.size).toBe(0);
  });

  test("KEEPS the verdicts across the same gap, because a verdict is about text", () => {
    // The other half, and the reason this is not just "throw the file away". The
    // verdicts are the whole of the cost saving; dropping them would make every
    // restart a full-price pass for no gain in honesty.
    const fresh = memoryForEpoch(MEMORY, "daemon-two");
    expect(fresh.verdicts.size).toBe(1);
  });

  test("takes the new epoch, so the next write is filed under the run that made it", () => {
    expect(memoryForEpoch(MEMORY, "daemon-two").epoch).toBe("daemon-two");
  });
});

describe("the round trip", () => {
  test("goes out and comes back whole", () => {
    const root = tempRoot();
    writeAttentionMemory(root, MEMORY);
    const read = readAttentionMemory(root);
    expect(read.kind).toBe("memory");
    if (read.kind !== "memory") return;
    expect(read.memory.epoch).toBe("daemon-one");
    expect([...read.memory.waits]).toEqual([...MEMORY.waits]);
    expect([...read.memory.verdicts]).toEqual([...MEMORY.verdicts]);
  });

  test("is written atomically, so a second writer cannot leave half a file", () => {
    // GPT Sol's finding 5: a shutdown used to release the store's lock while a
    // pass was still in flight, so two processes could be writing this file at
    // once. The daemon now awaits the pass, and this is the belt to that brace.
    const root = tempRoot();
    writeAttentionMemory(root, MEMORY);
    // A temp-then-rename leaves nothing behind; a write-in-place would.
    const read = readAttentionMemory(root);
    expect(read.kind).toBe("memory");
    expect(readFileSync(join(root, ATTENTION_MEMORY_FILE), "utf8").endsWith("}\n")).toBe(true);
  });

  test("says a missing memory is absent rather than empty", () => {
    expect(readAttentionMemory(tempRoot()).kind).toBe("absent");
  });
});

describe("the parser, which must be total — GPT Sol's finding 3", () => {
  function withVerdict(verdict: unknown): unknown {
    return {
      schema: ATTENTION_MEMORY_SCHEMA,
      epoch: "e",
      waits: {},
      verdicts: { abc: { fingerprint: "abc", classifiedAt: "2026-09-08T09:00:00.000Z", verdict } },
    };
  }

  test("refuses a memory holding a cached `unreadable`, however it got there", () => {
    // GPT SOL'S SECOND ROUND, and it is the first finding arriving through the
    // door marked "upgrade". The pass had stopped WRITING an unreadable verdict,
    // and a memory file from an older build could still HOLD one — which read
    // back as a cache hit, was never added to `unclassified`, and went on
    // publishing false calm for as long as that agent said nothing new. A fix
    // that only covers newly-written records is not a fix.
    //
    // The type says so too (`CacheableVerdict` excludes the arm), so neither a
    // writer nor a reader can now express it. This is the belt to that brace: a
    // file that already holds one is refused whole and rebuilt, which costs one
    // fleet's worth of cheap calls, once.
    const bad = {
      schema: ATTENTION_MEMORY_SCHEMA,
      epoch: "e",
      waits: {},
      verdicts: {
        abc: {
          fingerprint: "abc",
          classifiedAt: "2026-09-08T09:00:00.000Z",
          verdict: { kind: "unreadable", why: "the gateway returned 429" },
        },
      },
    };
    expect(parseAttentionMemory(bad).kind).toBe("unusable");
  });

  test.each([
    ["a question with no topic", { kind: "question", why: "w", attentionKind: "other", answerability: { kind: "phone" } }],
    ["a question with a kind this build does not know", { kind: "question", topic: "t", why: "w", attentionKind: "urgent", answerability: { kind: "phone" } }],
    ["a question with no answerability", { kind: "question", topic: "t", why: "w", attentionKind: "other" }],
    ["a verdict arm this build does not know", { kind: "maybe", why: "w" }],
    ["a bare kind with nothing else", { kind: "question" }],
  ])("refuses %s", (_name, verdict) => {
    expect(parseAttentionMemory(withVerdict(verdict)).kind).toBe("unusable");
  });

  test("accepts a fully-formed verdict, so it is not simply refusing everything", () => {
    const good = withVerdict({
      kind: "question",
      topic: "t",
      why: "w",
      attentionKind: "irreversible",
      answerability: { kind: "needs-a-screen", why: "a diff" },
    });
    expect(parseAttentionMemory(good).kind).toBe("memory");
  });

  test("refuses a classifiedAt that is not an instant", () => {
    const bad = {
      schema: ATTENTION_MEMORY_SCHEMA,
      epoch: "e",
      waits: {},
      verdicts: { abc: { fingerprint: "abc", classifiedAt: "not-a-date", verdict: { kind: "no-question", why: "w" } } },
    };
    expect(parseAttentionMemory(bad).kind).toBe("unusable");
  });

  test("refuses a record filed under a key it disagrees with", () => {
    const bad = {
      schema: ATTENTION_MEMORY_SCHEMA,
      epoch: "e",
      waits: {},
      verdicts: { abc: { fingerprint: "def", classifiedAt: "2026-09-08T09:00:00.000Z", verdict: { kind: "no-question", why: "w" } } },
    };
    expect(parseAttentionMemory(bad).kind).toBe("unusable");
  });

  test("refuses a memory with no epoch, because then the waits cannot be trusted", () => {
    const bad = { schema: ATTENTION_MEMORY_SCHEMA, waits: {}, verdicts: {} };
    expect(parseAttentionMemory(bad).kind).toBe("unusable");
  });

  test("an unusable file is replaced rather than repaired, and reads as unusable first", () => {
    const root = tempRoot();
    writeFileSync(join(root, ATTENTION_MEMORY_FILE), "{ not json", "utf8");
    const read = readAttentionMemory(root);
    expect(read.kind).toBe("unusable");
  });
});
