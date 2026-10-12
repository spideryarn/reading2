/**
 * Eval — does bringing an article into a chat leave the open article's cache
 * alone, and is the mentioned article cached after that?
 *
 *   npx tsx evals/chat-mention-caching.ts <open-slug> <mentioned-slug>
 *
 * **This one spends money**: three real chat calls through OpenRouter, as the
 * owner in `SPIDERYARN_OWNER_ID`, both articles read from the store. Plan
 * docs/plans/261012d-chat-at-mention-your-own-articles.md § 3 ("How it is
 * checked"): tests/chat-mentions-prompt.test.ts proves the request keeps the
 * open article's part byte-identical with and without a mention, and GPT Sol's
 * F6 was that a unit test proves the request, not the cache. Only the
 * provider's own counts can say a cache was read.
 *
 * The three calls, `useTools: false` for evals/prompt-caching.ts's reason (a
 * turn that changes its tools invalidates the whole prefix):
 *
 *   1. no mention — writes the open article's prefix (bp1), or reads it if a
 *      previous run left it warm;
 *   2. the same conversation's next question, now bringing the article in —
 *      expect a READ of about the open article's size (bp1 untouched) and,
 *      on a cold run, a WRITE of about the mentioned article's size (bp2). If
 *      a previous run left bp2 warm, expect a READ of about both instead;
 *   3. the next question again, with the mention still in the thread —
 *      expect a READ of about both.
 *
 * A pass needs (2) to read at least 80% of the open article's estimated
 * tokens and either write at least 80% of the mentioned one's or read at
 * least 80% of both together, and (3) to read at least 80% of both. Estimates
 * come from `estimateTokens`, which under-counts; the 80% is for that, not for
 * slack in the cache. A cache that silently stopped working answers correctly
 * and shows up only as a bill.
 */

import { loadEnvLocal } from "../src/env.js";
import { articleWithIds, estimateTokens } from "../src/article-prompt.js";
import { converse, type MentionForPrompt } from "../src/converse.js";
import { withLedger } from "../src/cli-ledger.js";
import { isMain } from "../src/is-main.js";
import type { Block, ChatMessage, Meta } from "../src/types.js";

export interface Turn {
  label: string;
  read: number | null;
  write: number | null;
  input: number | null;
}

/** Pure verdict for the paid probe, exported so its pass criteria are guarded without paid calls. */
export function cacheProblems(
  turns: readonly Turn[],
  openTokens: number,
  otherTokens: number,
): string[] {
  const added = turns[1];
  const kept = turns[2];
  if (!added || !kept) return ["the probe did not complete all three turns"];

  const why: string[] = [];
  const openFloor = 0.8 * openTokens;
  const otherFloor = 0.8 * otherTokens;
  const bothFloor = 0.8 * (openTokens + otherTokens);
  if ((added.read ?? 0) < openFloor) {
    why.push(`turn 2 read ${added.read ?? "nothing"}, expected about the open article (${openTokens}): bp1 was not reused`);
  }
  const bp2WasRead = (added.read ?? 0) >= bothFloor;
  const bp2WasWritten = (added.write ?? 0) >= otherFloor;
  if (!bp2WasRead && !bp2WasWritten) {
    why.push(
      `turn 2 neither read a warm bp2 nor wrote a cold one (read ${added.read ?? "nothing"}, wrote ${added.write ?? "nothing"})`,
    );
  }
  if ((kept.read ?? 0) < bothFloor) {
    why.push(`turn 3 read ${kept.read ?? "nothing"}, expected about both (${openTokens + otherTokens})`);
  }
  return why;
}

async function ask(
  slug: string,
  meta: Meta,
  blocks: Block[],
  history: ChatMessage[],
  question: string,
  mentions: MentionForPrompt[],
  label: string,
): Promise<Turn> {
  let answer = "";
  let turn: Turn | null = null;
  for await (const event of converse({
    power: "standard",
    meta,
    blocks,
    history,
    question,
    slug,
    useTools: false,
    kind: "chat",
    mentions,
  })) {
    if (event.type === "done") {
      answer = event.text;
      turn = {
        label,
        read: event.usage.cacheReadTokens,
        write: event.usage.cacheWriteTokens,
        input: event.usage.inputTokens,
      };
    }
  }
  if (!turn) throw new Error(`${label}: the turn ended without a done event`);
  /* What the app stores and replays: the bare question, the stored answer. */
  history.push({ id: `spya-q${history.length}`, role: "user", text: question, status: "done" } as ChatMessage);
  history.push({ id: `spya-a${history.length}`, role: "assistant", text: answer, status: "done" } as ChatMessage);
  return turn;
}

async function main(): Promise<void> {
  /* Kept here as well as before `withLedger`: paid-CLI coverage checks the
     entry function itself, and the second call is memoised. */
  loadEnvLocal();
  const [openSlug, mentionedSlug] = process.argv.slice(2);
  if (!openSlug || !mentionedSlug) {
    console.error("Usage: npx tsx evals/chat-mention-caching.ts <open-slug> <mentioned-slug>");
    console.error("This calls a model three times and costs money.");
    process.exit(1);
  }
  const { loadArticle } = await import("../src/store/index.js");
  const { environmentOwnerId, runAsOwner } = await import("../src/owner.js");
  const [open, other] = await runAsOwner(environmentOwnerId(), () =>
    Promise.all([loadArticle(openSlug), loadArticle(mentionedSlug)]),
  );
  const openTokens = estimateTokens(articleWithIds(open.meta, open.blocks));
  const otherTokens = estimateTokens(articleWithIds(other.meta, other.blocks));
  const mention: MentionForPrompt = { available: true, meta: other.meta, blocks: other.blocks };
  console.log(`open ≈ ${openTokens.toLocaleString()} tokens, mentioned ≈ ${otherTokens.toLocaleString()} tokens`);

  const history: ChatMessage[] = [];
  const turns = [
    await ask(openSlug, open.meta, open.blocks, history, "What is this piece arguing?", [], "1 no mention"),
    await ask(openSlug, open.meta, open.blocks, history, "How does the other article compare?", [mention], "2 mention added"),
    await ask(openSlug, open.meta, open.blocks, history, "Where do they disagree most?", [mention], "3 mention kept"),
  ];
  for (const t of turns) {
    console.log(`${t.label.padEnd(18)} input ${t.input ?? "?"}  cache read ${t.read ?? "?"}  cache write ${t.write ?? "?"}`);
  }

  const why = cacheProblems(turns, openTokens, otherTokens);
  console.log(why.length === 0 ? "\nPASS" : `\nFAIL\n- ${why.join("\n- ")}`);
  if (why.length > 0) process.exitCode = 1;
}

if (isMain(import.meta.url)) {
  /* `withLedger` asks for the environment owner before it calls `main`, so
     load .env.local first or a dev default can own the paid eval's ledger. */
  loadEnvLocal();
  withLedger("eval", main).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
