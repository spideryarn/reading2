/**
 * **The plain-words rule, once, for every prompt that writes words a reader sees.**
 *
 * > we want to make this plainer/simpler language rule common across *all* prompts that generate
 * > text of any kind. And ideally also in a way that it will apply to all future prompts
 * >
 * > — Greg, 2026-09-28
 *
 * A prompt interpolates `${plainWords(...)}` as its own section, the way `PROFILE_RULES`
 * (src/profile.ts) is interpolated, and names the kinds of text it writes. The core — who the
 * reader is, commoner words for the same meaning, nothing lost, copies untouched, the prompt's own
 * field rules winning — is in every call; each kind adds only what applies to it, because a single
 * long rule contradicted prompts it was added to (a question told to explain its own term, a label
 * told to be a sentence). docs/project/prompting-guide.md is the why, the per-kind trade-off, and
 * how to measure a change; docs/plans/260926a-plainer-summaries-and-glossary.md is the evidence.
 *
 * A prompt that writes no words for a reader — a verdict, a URL, ids, a verbatim transcription —
 * does not carry it, and says so in `PLAIN_WORDS_EXEMPT` below. tests/plain-words-coverage.test.ts
 * fails for a file that calls a model and does neither.
 *
 * **Every byte here is in many prompts.** An edit changes all of them, so it bumps every stamped
 * prompt that uses it — the guide says how, and how to measure first.
 */

/** The kinds of text a prompt writes. A prompt that writes several names them all. */
export type PlainKind =
  /** An answer, a summary, a definition, a reason, feedback, a caption. */
  | "explain"
  /** A question put to the reader. */
  | "ask"
  /** A label, heading or title the model writes. */
  | "landmark"
  /** Words to be heard, not read. */
  | "spoken";

const CORE = `PLAIN WORDS

Write for a curious reader who has not studied this field. If these
instructions, or the reader's own description, say who the reader is, write
for them instead: a specialist does not need their own field's terms explained.

Use the commonest word that loses nothing. This changes the words, never the
meaning: plainer means equally specific. Never drop a number, a direction, a
comparison, a condition or a hedge ("may", "in mice", "in this sample") that
the claim depends on; a sentence that is plainer and less exact is worse. It
never changes which field a fact belongs in, which source may support it, or
the shape and length these instructions set for each field: where those rules
are more specific, they win. Text you are told to copy exactly stays exactly as written.`;

const KINDS: Record<PlainKind, string> = {
  explain: `In what you write to explain — an answer, a summary, a definition, a
reason, feedback, a caption: say what it means here, in everyday words, first.
Keep the article's own term where the reader will meet it again in the prose;
it is their handhold. But a handhold is not an explanation: if this reader
would not know the term, say what it means where it first appears, as part of
the sentence. Never explain one hard word with another. A word is not plain
because the article uses it.

For example, explaining a line in a medical paper:
BAD: "The trial was underpowered, so its null result is uninformative."
GOOD: "The trial was underpowered: too small to reliably catch an effect of the
size it was looking for, so finding no effect tells us little either way."

Before you finish, look at each word you wrote that this reader might not know.
Either it is the article's term and you have said what it means, or change it.`,

  ask: `In a question you write: keep the article's own term as its topic, and ask
the rest in ordinary words, so that it makes sense to a reader who does not know
that term yet. Do not explain the term inside the question, and never give the
answer away.`,

  landmark: `In a label, heading or title you write: keep the author's key term, with
ordinary words around it, so the reader can match it to the text. Never replace
the author's term with your own, and never stack field terms one after another.`,

  spoken: `In words to be heard: short sentences, the meaning before the name, no
brackets, and never read symbols or notation aloud.`,
};

const ANCHOR = "Plainer than the article, never further from it: never less exact, and never beyond what it says.";

/**
 * The rule, for a prompt that writes the given kinds of text. With no kinds, the core alone — for a
 * prompt whose own sections already carry the per-kind detail, measured (the summary and glossary
 * prompts).
 */
export function plainWords(...kinds: PlainKind[]): string {
  const seen = [...new Set(kinds)];
  return [CORE, ...seen.map((k) => KINDS[k]), ANCHOR].join("\n\n");
}

/**
 * **Files that call a model and deliberately do not carry the rule**, each with the reason. A file
 * that calls a model must import `plainWords` or be here — tests/plain-words-coverage.test.ts.
 * Paths are relative to the repository root.
 */
export const PLAIN_WORDS_EXEMPT: Record<string, string> = {
  "src/quiz-verdict.ts": "writes one word — right, wrong or unclear — that no reader sees",
  "src/simple-check.ts": "writes a verdict per paragraph — ok or contradicts — that no reader sees",
  "src/dig-deeper.ts":
    "runs a forced web search and writes a one-line keyword query for the library search; no reader sees either — the answer they read is explain's, which carries the rule",
  "src/source-guess-run.ts": "no prompt of its own: it sends citation-find.ts's, whose answer is a URL or null",
  "src/pdf-frontmatter.ts": "writes block ids",
  "src/pdf-authors.ts":
    "copies names and affiliations off the page verbatim, and the code stores the page's characters, not the model's",
  "src/pdf-figure-locate.ts": "writes a page number and a box for a figure",
  "src/paper-metadata.ts":
    "copies a paper's title, authors, abstract and DOI off its first pages exactly as printed",
  "src/citation-paper-passages.ts":
    "copies up to three passages from a paper verbatim and picks one of three words for each; the code stores the paper's characters, not the model's",
  "src/citation-influence.ts":
    "writes a number, the number of a page, and words copied from that page verbatim; the code stores the page's characters, not the model's",
  "src/crossrefs.ts":
    "writes two block ids and a phrase copied from the article, and the code stores the article's characters, not the model's",
  "src/relations.ts":
    "writes a block id and one of ten fixed words per paragraph; the words a reader sees for them are the app's own",
  "src/pdf-read.ts": "transcribes a PDF verbatim; a transcriber told to prefer common words is invited to tidy",
  "src/command-pick-call.ts":
    "picks one of the command bar's own rows, then copies words out of the reader's sentence verbatim; neither call writes prose",
  "src/transcribe.ts": "speech to text, verbatim, with no prompt at all",
  "src/messages-stream.ts": "the wire every Messages call goes through, not a prompt",
  "src/ai-call.ts": "the wire every OpenRouter call goes through, not a prompt",
  "src/stream-run.ts": "sends whatever request its caller built — explain's prompt carries the rule in src/explain.ts",
  "src/embeddings.ts": "asks for vectors, not words",
  "src/pipeline.ts":
    "only builds the PDF front-matter and authors readers, whose prompts are src/pdf-frontmatter.ts and src/pdf-authors.ts",
  "src/structure-deepen.ts": "sends EXPAND_SYSTEM, which lives in src/structure-expand.ts and carries the rule there",
  "src/spend-declarations.ts": "names a model call inside a string, and makes none",
  "scripts/spike-book-structure.ts": "a one-off spike that sends production's own structure prompt",
  "scripts/spike-expand-section.ts": "a one-off spike that sends production's own expansion prompt",
  "scripts/probes/260930d-quote-stop-repro.ts":
    "a one-off reproduction; it sends production's own INVESTIGATE_SYSTEM, which carries plainWords(\"explain\")",
  "scripts/probes/260930a-investigate-probe.ts":
    "a one-off probe; its prompt, in scripts/probes/260930a-investigate-prompt.ts, carries plainWords(\"explain\")",
  "scripts/probes/261001a-paper-read-probe.ts":
    "a one-off probe; it runs production's own Investigate press, whose prompts are production's (INVESTIGATE_SYSTEM carries plainWords(\"explain\"); the passages call is exempt above)",
  "scripts/probes/261001h-fidelity-guard-probe.ts":
    "a one-off measurement; it asks for per-paragraph verdicts in JSON, which no reader sees",
  "scripts/gjd-remote-envpolicy.ts": "an internal tool's reason for Greg, not text for a reader",
  "evals/dig-deeper/answer.ts":
    "an eval that sends production's own Dig deeper prompts (explain's SYSTEM and INVESTIGATE_SYSTEM carry plainWords(\"explain\")) to other models, and production's search step, which is exempt as src/dig-deeper.ts",
};
