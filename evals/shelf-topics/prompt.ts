/**
 * **What every model arm is shown, and the one rubric they all score against**
 * (plan 260929c § Reviews, R7). Pure; no I/O.
 *
 * The candidates a model sees are `promptCandidates`: the baseline's own picks
 * first (so a model can always reproduce today's list), then the rest of the
 * chooser's pool best-first by computed quality, skipping restatements of a
 * candidate already listed (same member articles, or a shared word stem and
 * mostly the same articles — *ball lightning*, *ball lightning events*, *saw
 * ball lightning*), up to `PROMPT_CANDIDATES`. Predeclared, and the same for
 * every arm.
 */
import { type PoolCandidate, stemForOverlap } from "../../src/shelf-terms/choose.js";
import type { ShelfCase } from "./case.js";

export const PROMPT_CANDIDATES = 80;
/** Example member titles shown per candidate in the prompt. */
export const EXAMPLE_TITLES = 3;
/** How many topics the order arms are asked for, and every arm's list length. */
export const LIST_LENGTH = 30;

/** The 0–3 anchors, worst first — Jev's `criteria` array and the chat rubric are this one list. */
export const RUBRIC: readonly [string, string, string, string] = [
  "0 — Not a topic: an everyday or vague word, a name or artefact of the text (a site name, boilerplate, a phrase from one passage), or something its articles are not actually about.",
  "1 — Weak: loosely related to what its articles are about, too generic, or incidental to them; this reader would rarely filter by it.",
  "2 — Good: a real subject its articles share; a reasonable filter, though less central to this reader, or somewhat too broad or too narrow.",
  "3 — Excellent: a clear, specific subject its articles are genuinely about, and one this reader would want to filter their shelf by.",
];

export interface PromptCandidate {
  /** Short id the model answers with: `t01`… */
  id: string;
  key: string;
  label: string;
  /** Physical member articles. */
  count: number;
  slugs: string[];
}

function stems(key: string): Set<string> {
  return new Set(key.split(" ").map(stemForOverlap));
}

function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

export function promptCandidates(pool: PoolCandidate[], baselineKeys: string[]): PromptCandidate[] {
  const byKey = new Map(pool.map((p) => [p.key, p]));
  const kept: PoolCandidate[] = [];
  for (const k of baselineKeys) {
    const p = byKey.get(k);
    if (p) kept.push(p);
  }
  const taken = new Set(kept.map((p) => p.key));
  for (const p of pool) {
    if (kept.length >= PROMPT_CANDIDATES) break;
    if (taken.has(p.key) || p.quality <= 0) continue;
    const set = new Set(p.articles.map((a) => a.slug));
    const ps = stems(p.key);
    const restates = kept.some((k) => {
      const j = jaccard(set, new Set(k.articles.map((a) => a.slug)));
      const shared = [...stems(k.key)].some((s) => ps.has(s));
      return j >= 0.9 || (shared && j >= 0.5);
    });
    if (restates) continue;
    kept.push(p);
    taken.add(p.key);
  }
  return kept.map((p, i) => ({
    id: `t${String(i + 1).padStart(2, "0")}`,
    key: p.key,
    label: p.label,
    count: p.articles.length,
    slugs: p.articles.map((a) => a.slug),
  }));
}

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

const TASK = `You help a reader filter their reading shelf. A program has found candidate topics: phrases that several of the reader's saved articles actually use. Each candidate becomes a clickable "pill" that shows the articles containing that phrase. Your job is judgement only: how useful each candidate would be to THIS reader as a filter for THIS shelf. Never invent topics.`;

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

export const SCORE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["scores"],
  properties: {
    scores: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "score"],
        properties: { id: { type: "string" }, score: { type: "integer", enum: [0, 1, 2, 3] } },
      },
    },
  },
} as const;

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
