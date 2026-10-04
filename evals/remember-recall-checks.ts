/**
 * What `evals/remember-recall.ts` counts about one reply. Pure, and apart from
 * that file because that one runs (and spends money) when it is imported.
 *
 * **Every number here is a prompt to look, never a verdict** — the eval's own
 * header says why. What this file is for is not misreporting: a Recall reply now
 * ends with a `Hint:` paragraph, so "ends on a question" and the 120-word
 * ceiling are measured on the body, the hint is measured on its own, and the
 * block id is looked for **next to the question itself**. An id anywhere in the
 * reply used to satisfy the check, which is how "Do you remember what comes
 * next?" passed with only the correction cited (Greg's report `spya-fryxrf`).
 *
 * Tested by tests/remember-recall-checks.test.ts.
 * docs/plans/261004h-recall-questions-link-the-passage-and-carry-a-hint-button.md
 */
import { endsWithRecallQuestion, splitHint } from "../src/recall-hint.js";

/** The hint's own ceiling, from `REMEMBER_SYSTEM` in src/converse.ts. */
export const HINT_WORD_LIMIT = 25;
/** The body's ceiling, from the same prompt. */
export const BODY_WORD_LIMIT = 120;

export interface ReplyChecks {
  /** The reply without its hint: what the reader sees before pressing Hint. */
  body: string;
  /** The hint the panel would put behind the button, or null. */
  hint: string | null;
  bodyWords: number;
  hintWords: number;
  /** Does the **body** end on a question? */
  endsInQuestion: boolean;
  /** Block ids inside the closing question, or straight after its mark. */
  questionIds: string[];
  /**
   * Is the closing question linked to a passage? `unknown-id` when an id beside
   * it is not one the article has, so the chip would not be pressable.
   */
  questionLink: "linked" | "unknown-id" | "no-id" | "no-question";
  /** What is wrong with the hint, in words. Empty when there is none, or it is fine. */
  hintProblems: string[];
  /**
   * The body ends on a question and no hint came with it. A pure clarification
   * is rightly one of these; a nudge is not.
   */
  nudgeWithoutHint: boolean;
  /**
   * Something hint-like the panel will show in the open: a `Hint:` in another
   * spelling, or a correctly spelt one that was not split off.
   */
  strayHint: boolean;
  /** Block ids anywhere in the reply, hint included. */
  citations: number;
}

const ID = /\bspya-[a-z0-9]{6}\b/g;

const words = (text: string): number => (text.trim() === "" ? 0 : text.trim().split(/\s+/).length);

/**
 * The closing question and whatever follows its mark: from the end of the
 * sentence before it to the end of the body.
 */
function closingQuestion(body: string): string {
  const mark = Math.max(body.lastIndexOf("?"), body.lastIndexOf("？"));
  const before = body.slice(0, mark);
  /* The last place a sentence ended: `.`, `!` or `?`, any closers or a
     bracketed id after it, then space. Or a line break. */
  let start = 0;
  for (const m of before.matchAll(/[.!?。！？](?:["'”’»)]|\s*\[[^\]\n]*\])*\s+|\n+/g)) {
    start = m.index + m[0].length;
  }
  return body.slice(start);
}

export function checkReply(text: string, knownIds: ReadonlySet<string>): ReplyChecks {
  const { body, hint } = splitHint(text.trim());
  const endsInQuestion = endsWithRecallQuestion(body);
  const questionIds = endsInQuestion ? (closingQuestion(body).match(ID) ?? []) : [];

  const hintProblems: string[] = [];
  if (hint !== null) {
    if (words(hint) > HINT_WORD_LIMIT) hintProblems.push(`over ${HINT_WORD_LIMIT} words`);
    if (hint.includes("?") || hint.includes("？")) hintProblems.push("asks a question");
    const hintIds = hint.match(ID) ?? [];
    if (hintIds.length === 0) hintProblems.push("has no block id");
    else if (hintIds.some((id) => !knownIds.has(id))) hintProblems.push("has an unknown block id");
  }

  return {
    body,
    hint,
    bodyWords: words(body),
    hintWords: hint === null ? 0 : words(hint),
    endsInQuestion,
    questionIds,
    questionLink: !endsInQuestion
      ? "no-question"
      : questionIds.length === 0
        ? "no-id"
        : questionIds.every((id) => knownIds.has(id))
          ? "linked"
          : "unknown-id",
    hintProblems,
    nudgeWithoutHint: endsInQuestion && hint === null,
    /* A line that opens with the word, through any Markdown emphasis. */
    strayHint: hint === null && /^[\s*_>#-]*hint\b[\s*_]*[:\-–—]/im.test(text),
    citations: (text.match(ID) ?? []).length,
  };
}
