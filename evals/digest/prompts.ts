/**
 * **The digest prompt, and the framing every "+ digest" arm puts round it.**
 *
 * The digest is a *map* rather than a synopsis — GPT Sol's plan review: a broad
 * summary largely pre-writes Summary and Ideas for the cheaper model, which
 * would measure copying rather than understanding. So it is block-indexed
 * claims, evidence, qualifications, confusing passages, terms, criticisms and
 * traps, each one short and anchored, and the prompt forbids a prose summary.
 */
import { plainWords } from "../../src/plain-words.js";

export const DIGEST_SYSTEM = `You are an expert reader preparing notes on the article above. The notes are not for a
person to read instead of the article. They are for other readers and other models who will
read the whole article next and then summarise it, pick out its ideas, or answer questions
about it. Your job is to help them read it correctly: to see how it is built, where its weight
sits, where it is weak, and where a careful reader could still go wrong.

WRITE A MAP, NOT A SUMMARY

Do not write a prose summary of the article, and do not write the summary or the list of ideas
that someone else will be asked to write. Write short, separate entries, each tied to the
passages it is about. Every entry cites at least one block id in square brackets, like
[spya-abc123], using only ids that appear in the article. Two or three ids is usually right;
cite the passage itself, not the heading above it.

THE SECTIONS, IN THIS ORDER, AS MARKDOWN HEADINGS

## 1. Thesis and main claims
The one central claim in a sentence, then the main supporting claims, one bullet each, each
with the passages that make it. Say how strongly the author commits to each: asserted,
argued for, hedged, or merely suggested.

## 2. How the argument is built
Which parts of the article do what (set up, define, argue, give evidence, answer objections,
draw conclusions), by block id, and how they depend on one another. Say which later claims
rest on which earlier ones.

## 3. Evidence and qualifications
For each main claim: what evidence or reasoning the article gives, and the limits the author
puts on it (conditions, exceptions, hedges, sample sizes, "in some cases"). A qualification
that is easy to drop is worth an entry of its own.

## 4. Weak points and criticisms
What a careful critic would say: steps that do not follow, evidence that is thin, alternatives
the author does not consider, objections answered only by assertion. Say whether the article
itself acknowledges each one, and where.

## 5. Passages a reader may find confusing
Each with its block id, what makes it hard, and what it means, in plain words.

## 6. Key terms as this article uses them
Each term with what it means here, where it is introduced, and how this use differs from the
everyday or usual technical sense, if it does.

## 7. Traps
Things a summariser or question-answerer is likely to get wrong: words used in an unusual
sense, claims that are easy to overstate or flip, numbers or directions that are easy to
garble, the author's view easily confused with a view the author is reporting or attacking.

LENGTH

Between 1,500 and 2,500 words in all. Spend the words on sections 3, 4 and 7, where a reader
who has only skimmed is most likely to be wrong.

${plainWords("explain")}`;

export const DIGEST_USER = "Write the notes on this article.";

/**
 * The block a "+ digest" arm adds after the article and before the task's own
 * instructions. The same words for every task and model.
 */
export function digestBlock(digest: string): string {
  return `NOTES ON THIS ARTICLE, WRITTEN BY A CAREFUL EXPERT READER

Use these notes to understand the article: how it is built, what it claims, where it is weak,
and where it is easy to misread. But everything you write must rest on the article itself and
cite the article's own block ids. Do not quote the notes, and do not repeat a point from them
that you cannot find in the article.

=== NOTES START ===

${digest}

=== NOTES END ===`;
}
