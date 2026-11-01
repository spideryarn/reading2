/**
 * **Plan 261101c stage 2, arm N1: a better notes section in the one call** —
 * production's `citations/8` system prompt with only the `why` and `relevance`
 * instructions replaced. The replacement throws if the passage is not found, so
 * a drift in production's prompt cannot leave this arm silently sending the old
 * text.
 *
 * The rules come from the slips 261101a's blind judge found in Haiku's notes
 * (evals/results/citations-recall/261101a/why-judgement.md): a `why` with
 * details the citing passage does not support, a summary of a book instead of
 * what the article uses it for, a wrong task named, and relevance of 0.8–1.0
 * on works cited in passing. The examples are invented for this prompt, not
 * taken from any eval article, so the held-out half of the sample is not
 * taught to.
 */
import { systemPrompt } from "../../src/bibliography.js";

const OLD_NOTES = `"why" — one plain sentence, at most 160 characters: what THIS piece uses the
work for — the finding it builds on, the claim it supports, the view it argues
against. Not a summary of the work. Do not begin "The article", "The author" or
"This work".
"relevance" 0-1 — how much THIS piece's argument leans on the work. 1: the piece
is built on it. 0.5: it carries one step of the argument. 0.1: a passing mention
or further reading.`;

export const NEW_NOTES = `"why" — one plain sentence, at most 160 characters: what THIS piece uses the
work for — the finding it builds on, the claim it supports, the view it argues
against. Not a summary of the work. Do not begin "The article", "The author" or
"This work".
  Write it from the sentence that cites the work, and say what that sentence
  uses it for. Add nothing the article does not say: no details from your own
  memory of the work, its methods or its dataset. If the article cites it for
  several things, name the one it leans on most.
  Good: "Evidence that rats replay recent routes while they sleep."
  Good: "The view of memory that the piece argues against."
  Bad: "A 1998 book surveying sleep research across many species." — a summary
  of the work, not its use here.
  Bad: "Shows replay drives learning on maze tasks." — when the citing sentence
  says only that replay happens.
"relevance" 0-1 — how much THIS piece's argument leans on the work. 1: the piece
is built on it. 0.5: it carries one step of the argument. 0.1: a passing mention
or further reading. In a long list most works are 0.1 to 0.3; give 0.8 or more
only to the few the argument could not stand without. A work cited once, in a
list of several, is rarely above 0.3.`;

export function notesSystem(): string {
  const today = systemPrompt();
  const occurrences = today.split(OLD_NOTES).length - 1;
  if (occurrences !== 1) {
    throw new Error(`notes prompt: expected the why/relevance passage once in systemPrompt(), found ${occurrences}`);
  }
  return today.replace(OLD_NOTES, NEW_NOTES);
}
