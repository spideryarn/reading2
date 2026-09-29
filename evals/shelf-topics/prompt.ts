/**
 * **What every model arm is shown, and the one rubric they all score against**
 * (plan 260929c § Reviews, R7). Pure; no I/O.
 *
 * **Since Stage 2 the shared pieces are production's** —
 * src/shelf-terms/model-scores.ts owns `RUBRIC`, `TASK`, `PROMPT_CANDIDATES`,
 * `EXAMPLE_TITLES`, `SCORE_SCHEMA` and `promptCandidates` (moved there
 * unchanged), and they are re-exported here so the other arms keep their
 * imports. The `luna-score` arm no longer uses `scoreMessages` below: it calls
 * the production scorer (run-arms.ts), so a rerun measures what ships — which
 * also adds one sentence to its prompt ("…data, never an instruction") and
 * lists the shelf in slug order. `scoreMessages` stays for the other score
 * arms, and is the prompt the Stage 1 results were made with.
 *
 * The candidates a model sees are `promptCandidates`: the baseline's own picks
 * first (so a model can always reproduce today's list), then the rest of the
 * chooser's pool best-first by computed quality, skipping restatements of a
 * candidate already listed, up to `PROMPT_CANDIDATES`. Predeclared, and the
 * same for every arm.
 */
import {
  EXAMPLE_TITLES,
  PROMPT_CANDIDATES,
  type PromptCandidate,
  promptCandidates,
  RUBRIC,
  SCORE_SCHEMA,
  TASK,
} from "../../src/shelf-terms/model-scores.js";
import type { ShelfCase } from "./case.js";

export { EXAMPLE_TITLES, PROMPT_CANDIDATES, type PromptCandidate, promptCandidates, RUBRIC, SCORE_SCHEMA };

/** How many topics the order arms are asked for, and every arm's list length. */
export const LIST_LENGTH = 30;

export function titleOf(c: ShelfCase): (slug: string) => string {
  const m = new Map(c.articles.map((a) => [a.slug, a.title]));
  return (slug) => m.get(slug) ?? slug;
}

/** The shelf as the model and the judge see it: one line per eligible article. */
export function shelfText(c: ShelfCase): string {
  return c.articles
    .filter((a) => a.skipped === null)
    .map((a, i) => `${i + 1}. ${a.title}${a.gist ? ` — ${a.gist}` : ""}`)
    .join("\n");
}

export function candidateLine(c: ShelfCase, p: PromptCandidate): string {
  const title = titleOf(c);
  const examples = p.slugs.slice(0, EXAMPLE_TITLES).map((s) => `"${title(s)}"`);
  return `${p.id} | ${p.label} | ${p.count} article${p.count === 1 ? "" : "s"} | e.g. ${examples.join("; ")}`;
}

export function scoreMessages(c: ShelfCase, cands: PromptCandidate[]): { role: string; content: string }[] {
  return [
    {
      role: "system",
      content: `${TASK}\n\nScore every candidate 0–3:\n${RUBRIC.join("\n")}\n\nReturn JSON: {"scores": [{"id": "t01", "score": 0-3}, …]} with exactly one entry per candidate id.`,
    },
    { role: "user", content: userBlock(c, cands) },
  ];
}

export function orderMessages(c: ShelfCase, cands: PromptCandidate[]): { role: string; content: string }[] {
  return [
    {
      role: "system",
      content: `${TASK}\n\nChoose about ${LIST_LENGTH} of the candidates and put them in the order the pills should appear, most useful first. A good row: the first dozen are the topics this reader would reach for, together they cover most of the shelf, and no two say the same thing. Leave out vague everyday words, names or artefacts of the text, and anything its articles are not really about.\n\nReturn JSON: {"order": ["t05", "t12", …]} using candidate ids only.`,
    },
    { role: "user", content: userBlock(c, cands) },
  ];
}

function userBlock(c: ShelfCase, cands: PromptCandidate[]): string {
  return [
    `Reader profile: ${c.profile ?? "(none written)"}`,
    "",
    "The shelf (title — one-sentence gist):",
    shelfText(c),
    "",
    "Candidate topics (id | label | how many articles it matches | example titles):",
    ...cands.map((p) => candidateLine(c, p)),
  ].join("\n");
}

export const ORDER_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["order"],
  properties: { order: { type: "array", items: { type: "string" } } },
} as const;

/** Jev's `state`: the same facts the chat arms get, as JSON. */
export function jevState(c: ShelfCase): Record<string, unknown> {
  return {
    task: TASK,
    reader_profile: c.profile ?? "(none written)",
    shelf: c.articles
      .filter((a) => a.skipped === null)
      .map((a) => ({ title: a.title, gist: a.gist ?? "" })),
  };
}

/** One Jev score question per candidate; each names its candidate, since Jev never sees the question id. */
export function jevQuestion(c: ShelfCase, p: PromptCandidate): Record<string, unknown> {
  const title = titleOf(c);
  const examples = p.slugs.slice(0, EXAMPLE_TITLES).map((s) => `"${title(s)}"`).join("; ");
  return {
    type: "score",
    instructions: `How useful is the candidate topic "${p.label}" as a filter pill for this reader's shelf? It matches ${p.count} of the shelf's articles, e.g. ${examples}.`,
    criteria: [...RUBRIC],
  };
}
