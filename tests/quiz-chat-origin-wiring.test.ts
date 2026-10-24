/**
 * The two Reader-only navigation seams for a Quiz mark's chat (plan 261024i,
 * stage 2). QuizPanel can prove which callback it calls, but only Reader knows
 * that a chat cannot be overlaid while Learn is open, and that the way back
 * must carry the batch and question into Quiz.
 *
 * This is deliberately a wiring test: the behaviour on either side has its
 * own rendered tests, while a missed callback between them otherwise looks
 * valid to the type checker and leaves a press that changes the URL but draws
 * nothing. See tests/glossary-band-wiring.test.ts for the same kind of seam.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const reader = await readFile(path.join(ROOT, "src/web/reader/Reader.tsx"), "utf8");

function callbackBody(name: string): string {
  const start = reader.indexOf(`const ${name} = useCallback`);
  expect(start, `${name} must exist in Reader.tsx to be checked`).toBeGreaterThan(-1);
  const end = reader.indexOf("\n  );", start);
  expect(end, `${name} must have a complete useCallback body`).toBeGreaterThan(start);
  return reader.slice(start, end);
}

describe("Quiz mark chat navigation wiring", () => {
  it("finds a waiting or just-sent draft before summaries refresh", () => {
    const reopen = callbackBody("reopenItemChat");
    expect(reopen).toMatch(/chatDraftsFor\(slug\)\.threadForOrigin\(origin, \(id\) => refusedHandoffs\.current\.has\(id\)\)/);
    expect(reader).toMatch(/for \(const id of known\) drafts\.clearOrigin\(id\)/);
  });

  it("opens a mark's stored chat in Chat, where conversations are visible from Learn", () => {
    const open = callbackBody("openQuizMarkChat");
    expect(open.indexOf('showBand("chat")')).toBeGreaterThan(-1);
    expect(open.indexOf("openClaimChat(threadId)")).toBeGreaterThan(open.indexOf('showBand("chat")'));
    expect(reader).toMatch(/quizChats[\s\S]{0,220}onOpen:\s*openQuizMarkChat/);
  });

  it("takes a chat's way back to the exact current-batch question", () => {
    const open = callbackBody("openOrigin");
    expect(open).toMatch(/case "quiz":[\s\S]{0,160}openQuizAt\(origin\.batchId, origin\.itemId\)/);
  });
});
