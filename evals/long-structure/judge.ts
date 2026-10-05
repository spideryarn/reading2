/**
 * The blind pairwise judge for two tables of contents of one document, and
 * the check that it can fail. Plan 261005j § Stage 2, plan review F7.
 *
 * evals/structure-whole-document/blind.ts shows a part's opening sentence and
 * three gists against 400 characters each, which cannot say where a part ends
 * or whether two sets of gists are as good. This judge is shown:
 *
 *  (a) the document's authored headings, in order;
 *  (b) each tree's top level: where each part starts, its title, its gist;
 *  (c) for the top-level boundaries of either tree, about 300 words either
 *      side of each;
 *  (d) the same eight passages for both trees, chosen from the document by a
 *      seeded rule and never from a tree, each with the section title and gist
 *      each tree gives the section holding it.
 *
 * The two trees are X and Y by a seeded coin, and the key never enters the
 * prompt. `spoiledCheck` builds three trees spoiled in known ways from a good
 * one and asks whether a judge prefers the good one each time; a judge that
 * does not is reported and not used.
 */
import { openRouterJson } from "../../src/ai-call.js";
import { collectSpend, totalSpend, type AiCallRow } from "../../src/ai-spend.js";
import { estimateTokens } from "../../src/article-prompt.js";
import { parseJsonAnswer } from "../../src/parse-json.js";
import type { ModelNode } from "../../src/structure.js";
import { supplementIndex } from "../../src/supplement.js";
import type { Block, Tree, TreeNode } from "../../src/types.js";
import { mulberry32 } from "../debate/label-sheet.js";
import { priceOf } from "../dig-deeper/arms.js";
import { type Judge, judgeById } from "../dig-deeper/judges.js";
import { finishTree } from "./arms.js";
import type { CallRecord, Ledger } from "./calls.js";
import type { Doc } from "./corpus.js";

/** Two families, neither the one that wrote the trees' sibling model alone: Anthropic and OpenAI. */
export const DEFAULT_JUDGES = ["opus", "sol"] as const;

const WORDS_EITHER_SIDE = 300;
const MAX_BOUNDARIES = 30;
const PASSAGES = 8;
const PASSAGE_WORDS = 220;
const MAX_HEADINGS = 400;
const JUDGE_MAX_TOKENS = 8000;
const JUDGE_TIMEOUT_MS = 600_000;

export type Side = "X" | "Y";
export type Pick = Side | "same";

export interface Verdict {
  topLevel: { better: Pick; why: string };
  gists: { better: Pick; why: string; perPassage: Pick[] };
  weldedParts: { tree: Side; part: string; why: string }[];
  inventedClaims: { tree: Side; passage: number; what: string }[];
  overall: { better: Pick; why: string };
}

const words = (text: string): string[] => text.split(/\s+/).filter(Boolean);
const firstWords = (text: string, n: number): string => {
  const w = words(text);
  return w.length <= n ? w.join(" ") : `${w.slice(0, n).join(" ")} …`;
};

function bodyParts(tree: Tree): TreeNode[] {
  const supplement = supplementIndex(tree);
  return tree.nodes[tree.rootId]!.children.map((id) => tree.nodes[id]!).filter((n) => !supplement.has(n.id) && n.children.length > 0);
}

/** The deepest internal node holding the block at `at`, and the part above it. */
function sectionAt(tree: Tree, index: ReadonlyMap<string, number>, at: number): { part: TreeNode | null; section: TreeNode | null } {
  let node = tree.nodes[tree.rootId]!;
  let part: TreeNode | null = null;
  for (;;) {
    const next = node.children
      .map((id) => tree.nodes[id]!)
      .find((c) => c.children.length > 0 && (index.get(c.range[0]) ?? Infinity) <= at && at <= (index.get(c.range[1]) ?? -1));
    if (!next) break;
    if (node.id === tree.rootId) part = next;
    node = next;
  }
  return { part, section: node.id === tree.rootId ? null : node };
}

/** Eight passages, spread through the body: a block of 40 words or more nearest each eighth, jittered by the seed. */
export function samplePassages(body: readonly Block[], seed: number): number[] {
  const random = mulberry32(seed);
  const eligible = body.map((b, i) => ({ b, i })).filter(({ b }) => b.kind !== "heading" && b.gistable && b.words >= 40);
  if (eligible.length <= PASSAGES) return eligible.map((e) => e.i);
  const picked: number[] = [];
  for (let k = 0; k < PASSAGES; k++) {
    const lo = Math.floor((k * eligible.length) / PASSAGES);
    const hi = Math.floor(((k + 1) * eligible.length) / PASSAGES);
    picked.push(eligible[lo + Math.floor(random() * (hi - lo))]!.i);
  }
  return picked;
}

function around(body: readonly Block[], at: number): { before: string; after: string } {
  const render = (b: Block): string => (b.kind === "heading" ? `## ${b.text}` : b.text);
  const before: string[] = [];
  let count = 0;
  for (let i = at - 1; i >= 0 && count < WORDS_EITHER_SIDE; i--) {
    const w = words(render(body[i]!));
    const take = w.slice(Math.max(0, w.length - (WORDS_EITHER_SIDE - count)));
    before.unshift(`${take.length < w.length ? "… " : ""}${take.join(" ")}`);
    count += take.length;
  }
  const after: string[] = [];
  count = 0;
  for (let i = at; i < body.length && count < WORDS_EITHER_SIDE; i++) {
    const w = words(render(body[i]!));
    const take = w.slice(0, WORDS_EITHER_SIDE - count);
    after.push(`${take.join(" ")}${take.length < w.length ? " …" : ""}`);
    count += take.length;
  }
  return { before: before.join("\n"), after: after.join("\n") };
}

export interface Materials {
  prompt: string;
  passages: number[];
  boundariesShown: number;
  boundariesInAll: number;
}

/** Everything the judge reads about one pair. `x` and `y` are already in their blind order. */
export function materials(doc: Doc, x: Tree, y: Tree, seed: number): Materials {
  const { body } = doc;
  const index = new Map(body.map((b, i) => [b.id, i]));
  const random = mulberry32(seed ^ 0x9e3779b9);
  const out: string[] = [];

  const headings = body.filter((b) => b.kind === "heading");
  out.push("# (a) THE DOCUMENT'S OWN HEADINGS, IN ORDER", "");
  if (headings.length === 0) out.push("The document has no headings of its own.");
  for (const h of headings.slice(0, MAX_HEADINGS)) out.push(`- [block ${index.get(h.id)}] ${"#".repeat(Math.min(6, h.level ?? 1))} ${firstWords(h.text, 20)}`);
  if (headings.length > MAX_HEADINGS) out.push(`(… ${headings.length - MAX_HEADINGS} more headings not shown)`);

  out.push("", "# (b) EACH TREE'S TOP LEVEL", "");
  const top = (label: Side, tree: Tree): number[] => {
    const parts = bodyParts(tree);
    out.push(`## Tree ${label}: ${parts.length} parts`, "");
    if (parts.length === 0) out.push("This tree has no parts: one flat list of paragraphs.");
    parts.forEach((p, i) => {
      const at = index.get(p.range[0]) ?? 0;
      out.push(`${i + 1}. [starts at block ${at}] **${p.title || "(untitled)"}**`);
      out.push(`   gist: ${p.gist?.trim() || "(no gist)"}`);
      out.push(`   opens: "${firstWords(body[at]?.text ?? "", 18)}"`);
    });
    out.push("");
    return parts.slice(1).map((p) => index.get(p.range[0]) ?? 0);
  };
  const seamsX = new Set(top("X", x));
  const seamsY = new Set(top("Y", y));

  const all = [...new Set([...seamsX, ...seamsY])].sort((a, b) => a - b);
  const differing = all.filter((at) => seamsX.has(at) !== seamsY.has(at));
  const shared = all.filter((at) => seamsX.has(at) && seamsY.has(at));
  const draw = (pool: number[], n: number): number[] => {
    const left = [...pool];
    const got: number[] = [];
    while (got.length < n && left.length > 0) got.push(left.splice(Math.floor(random() * left.length), 1)[0]!);
    return got;
  };
  /* Where the trees disagree is what tells them apart, so those go first. */
  const fromDiffering = draw(differing, MAX_BOUNDARIES);
  const shown = [...fromDiffering, ...draw(shared, MAX_BOUNDARIES - fromDiffering.length)].sort((a, b) => a - b);
  out.push("# (c) THE TEXT EITHER SIDE OF TOP-LEVEL BOUNDARIES", "");
  if (all.length > shown.length) out.push(`${shown.length} of ${all.length} boundaries are shown: those only one tree makes first, the rest drawn at random.`, "");
  for (const at of shown) {
    const by = seamsX.has(at) && seamsY.has(at) ? "both trees" : seamsX.has(at) ? "tree X only" : "tree Y only";
    const text = around(body, at);
    out.push(`## Boundary at block ${at}: a new part starts here in ${by}`, "", "BEFORE:", text.before, "", "AFTER:", text.after, "");
  }

  const passages = samplePassages(body, seed);
  out.push("# (d) EIGHT PASSAGES, AND THE SECTION EACH TREE PUTS THEM IN", "");
  passages.forEach((at, n) => {
    out.push(`## Passage ${n + 1} (block ${at})`, "", `"${firstWords(body[at]!.text, PASSAGE_WORDS)}"`, "");
    for (const [label, tree] of [["X", x], ["Y", y]] as const) {
      const { part, section } = sectionAt(tree, index, at);
      const title = section?.title || "(untitled)";
      const where = part && section && part.id !== section.id ? ` (inside part "${part.title}")` : "";
      out.push(`Tree ${label} puts it in: **${section ? title : "(no section: the tree is flat here)"}**${where}`);
      out.push(`  that section's gist: ${section?.gist?.trim() || "(no gist)"}`);
    }
    out.push("");
  });

  return { prompt: out.join("\n"), passages, boundariesShown: shown.length, boundariesInAll: all.length };
}

export const JUDGE_SYSTEM = `You compare two tables of contents, X and Y, made for the same long document.
A reader will use one of them as a map: its top-level parts to see how the
document is divided, and each section's one-sentence gist to decide what to
read. You do not know how either was made, and X and Y are in no particular
order.

You are given (a) the document's own headings, (b) each tree's top-level
parts, (c) the text either side of top-level boundaries, and (d) eight
passages from the document with the section title and gist each tree gives
the section that holds each passage.

Judge three things.

TOP LEVEL. Which tree's parts divide the document better? A good part is one
whole chapter, story or major division. Two faults matter most: a part that
welds together two divisions the document keeps apart (use (a) and (c) to
see what sits either side of a boundary the other tree makes), and a
boundary that cuts one division in two partway through.

GISTS. On the eight passages in (d), which tree's section gists serve a
reader better? A good gist states what its section claims or does, is true
to the passage it covers, and is specific. A gist that is missing, that is
about some other part of the document, or that claims something the passage
does not support is a fault. Judge each passage, then overall.

OVERALL. Which tree would you rather navigate by?

Say "same" only when you cannot tell them apart on that point.

Answer in JSON only, no prose outside it, in exactly this shape:

{"top_level": {"better": "X" | "Y" | "same", "why": "<one or two sentences>"},
 "gists": {"better": "X" | "Y" | "same", "why": "<one or two sentences>",
           "per_passage": ["X" | "Y" | "same", … one per passage, in order]},
 "welded_parts": [{"tree": "X" | "Y", "part": "<the part's title>", "why": "<what it welds>"}],
 "invented_claims": [{"tree": "X" | "Y", "passage": <number>, "what": "<the claim the passage does not support>"}],
 "overall": {"better": "X" | "Y" | "same", "why": "<one or two sentences>"}}

"welded_parts" and "invented_claims" are empty lists when you saw none.`;

const isPick = (v: unknown): v is Pick => v === "X" || v === "Y" || v === "same";
const isSide = (v: unknown): v is Side => v === "X" || v === "Y";

/** The judge's reply, or a throw naming what is wrong with its shape. */
export function readVerdict(raw: string, passages: number): Verdict {
  const j = parseJsonAnswer<Record<string, unknown>>(raw, "the judge's reply");
  const point = (key: string): { better: Pick; why: string } => {
    const v = j[key] as { better?: unknown; why?: unknown } | undefined;
    if (!v || !isPick(v.better)) throw new Error(`the reply's "${key}.better" is not X, Y or same`);
    return { better: v.better, why: typeof v.why === "string" ? v.why : "" };
  };
  const gists = j.gists as { per_passage?: unknown } | undefined;
  const per = Array.isArray(gists?.per_passage) ? gists.per_passage : [];
  if (per.length !== passages || !per.every(isPick)) throw new Error(`the reply's "gists.per_passage" is not ${passages} picks`);
  const list = (key: string): Record<string, unknown>[] => (Array.isArray(j[key]) ? (j[key] as Record<string, unknown>[]) : []);
  return {
    topLevel: point("top_level"),
    gists: { ...point("gists"), perPassage: per },
    weldedParts: list("welded_parts").flatMap((w) => (isSide(w.tree) ? [{ tree: w.tree, part: String(w.part ?? ""), why: String(w.why ?? "") }] : [])),
    inventedClaims: list("invented_claims").flatMap((c) => (isSide(c.tree) ? [{ tree: c.tree, passage: Number(c.passage ?? 0), what: String(c.what ?? "") }] : [])),
    overall: point("overall"),
  };
}

export interface Judgement {
  doc: string;
  judge: string;
  model: string;
  /** Which candidate was shown as X. The other was Y. */
  x: string;
  y: string;
  seed: number;
  passages: number[];
  boundariesShown: number;
  boundariesInAll: number;
  verdict: Verdict | null;
  failure: string | null;
  call: CallRecord;
}

export interface Candidate {
  name: string;
  proposal: ModelNode;
}

/** Which of a pair a pick names, by candidate. */
export const named = (j: Pick, x: string, y: string): string => (j === "X" ? x : j === "Y" ? y : "same");

/**
 * One judge, one pair. `xFirst` puts `a` in the X seat. The trees are rebuilt
 * from their proposals by the one build every arm uses.
 */
export async function judgePair(opts: {
  doc: Doc;
  a: Candidate;
  b: Candidate;
  xFirst: boolean;
  seed: number;
  judge: Judge;
  ledger: Ledger;
  cell: string;
}): Promise<Judgement> {
  const { doc, judge, seed } = opts;
  const [x, y] = opts.xFirst ? [opts.a, opts.b] : [opts.b, opts.a];
  const m = materials(doc, finishTree(doc, x.proposal).tree, finishTree(doc, y.proposal).tree, seed);
  const price = priceOf(judge.model);
  const inputEstimate = estimateTokens(JUDGE_SYSTEM + m.prompt);
  const release = opts.ledger.admit((inputEstimate * price.input + JUDGE_MAX_TOKENS * price.output) / 1e6);
  const began = Date.now();
  const rows: AiCallRow[] = [];
  const { result, report } = await collectSpend(
    async () => {
      try {
        const call = await openRouterJson(
          "eval",
          {
            model: judge.model,
            max_tokens: JUDGE_MAX_TOKENS,
            messages: [
              { role: "system", content: JUDGE_SYSTEM },
              { role: "user", content: `The document is "${doc.title}" (${doc.body.length} blocks).\n\n${m.prompt}` },
            ],
          },
          { signal: AbortSignal.timeout(JUDGE_TIMEOUT_MS) },
        );
        return { json: call.json, error: null as string | null };
      } catch (err) {
        const status = (err as { status?: number }).status;
        return { json: null, error: `${status ? `HTTP ${status}` : (err as Error).name}` };
      }
    },
    {
      attribution: { scopeKind: "eval", articleSlug: doc.slug },
      sink: async (row) => {
        rows.push(row);
      },
    },
  );
  release();
  for (const row of rows) opts.ledger.write(opts.cell, `judge:${judge.id}`, undefined, 1, row);
  let verdict: Verdict | null = null;
  let failure = result.error;
  if (!failure) {
    const choice = (result.json as { choices?: { finish_reason?: string; message?: { content?: unknown } }[] } | null)?.choices?.[0];
    const content = typeof choice?.message?.content === "string" ? choice.message.content : null;
    if (content === null) failure = "no text in the reply";
    else if (choice?.finish_reason !== "stop") failure = `stopped on ${choice?.finish_reason}`;
    else {
      try {
        verdict = readVerdict(content, m.passages.length);
      } catch (err) {
        failure = (err as Error).message.slice(0, 120);
      }
    }
  }
  const spent = totalSpend(report.calls);
  const last = report.calls.at(-1);
  return {
    doc: doc.name,
    judge: judge.id,
    model: judge.model,
    x: x.name,
    y: y.name,
    seed,
    passages: m.passages,
    boundariesShown: m.boundariesShown,
    boundariesInAll: m.boundariesInAll,
    verdict,
    failure,
    call: {
      purpose: `judge:${judge.id}`,
      attempt: 1,
      startedAt: new Date(began).toISOString(),
      endedAt: new Date().toISOString(),
      ms: Date.now() - began,
      networkAttempts: 1,
      inputTokens: last?.inputTokens ?? null,
      outputTokens: last?.outputTokens ?? null,
      reasoningTokens: last?.reasoningTokens ?? null,
      cacheReadTokens: last?.cacheReadTokens ?? null,
      usd: spent.nanos / 1e9,
      unpriced: spent.unpriced,
      outcome: failure ? "parse" : "ok",
      ...(failure ? { detail: failure } : {}),
    },
  };
}

/* ------------------------------------------------------ the spoiled trees -- */

export const SPOILS = ["welded", "gists-from-elsewhere", "section-gists-removed"] as const;
export type Spoil = (typeof SPOILS)[number];

const copy = (node: ModelNode): ModelNode => JSON.parse(JSON.stringify(node)) as ModelNode;

/** Two adjacent parts made one: the first's title and gist, both parts' sections. */
export function weld(doc: Doc, good: ModelNode, seed: number): ModelNode {
  const root = copy(good);
  const parts = root.children ?? [];
  const index = new Map(doc.body.map((b, i) => [b.id, i]));
  const size = (p: ModelNode): number => index.get(p.range[1])! - index.get(p.range[0])! + 1;
  /* Both with sections, or the build would have to stretch one part's sections over the other's blocks. */
  const pairs = parts.flatMap((p, i) => (i + 1 < parts.length && p.children?.length && parts[i + 1]!.children?.length ? [i] : []));
  if (pairs.length === 0) throw new Error("no two adjacent parts both have sections; nothing to weld");
  /* The largest third of the candidate pairs, then one by the seed: a weld of two front-matter scraps would be a fair thing to miss. */
  const ranked = [...pairs].sort((a, b) => size(parts[b]!) + size(parts[b + 1]!) - (size(parts[a]!) + size(parts[a + 1]!)));
  const pool = ranked.slice(0, Math.max(1, Math.ceil(ranked.length / 3)));
  const i = pool[Math.floor(mulberry32(seed)() * pool.length)]!;
  const [a, b] = [parts[i]!, parts[i + 1]!];
  parts.splice(i, 2, { ...a, range: [a.range[0], b.range[1]], children: [...a.children!, ...b.children!] });
  return root;
}

/** Every part's and section's gist replaced by the gist of the node half the document away. */
export function gistsFromElsewhere(good: ModelNode): ModelNode {
  const root = copy(good);
  const rotate = (nodes: ModelNode[]): void => {
    const gists = nodes.map((n) => n.gist);
    const shift = Math.floor(nodes.length / 2);
    if (shift === 0) return;
    nodes.forEach((n, i) => {
      const from = gists[(i + shift) % nodes.length];
      if (from !== undefined) n.gist = from;
    });
  };
  rotate(root.children ?? []);
  rotate((root.children ?? []).flatMap((p) => p.children ?? []));
  return root;
}

/** Every section's gist taken away. */
export function sectionGistsRemoved(good: ModelNode): ModelNode {
  const root = copy(good);
  for (const part of root.children ?? []) {
    for (const section of part.children ?? []) delete section.gist;
  }
  return root;
}

export const spoil = (doc: Doc, good: ModelNode, kind: Spoil, seed: number): ModelNode =>
  kind === "welded" ? weld(doc, good, seed) : kind === "gists-from-elsewhere" ? gistsFromElsewhere(good) : sectionGistsRemoved(good);

/** Which point of the verdict each spoil must lose on. */
const MUST_LOSE: Record<Spoil, "topLevel" | "gists"> = {
  welded: "topLevel",
  "gists-from-elsewhere": "gists",
  "section-gists-removed": "gists",
};

export interface SpoiledCheck {
  judge: string;
  model: string;
  /** True only if the judge preferred the unspoiled tree on the point each spoil damages, all three times. */
  usable: boolean;
  /** A comparison came back with no verdict twice: the check did not finish, and says nothing about the judge. */
  inconclusive: boolean;
  rows: { spoil: Spoil; goodWas: Side; point: "topLevel" | "gists"; picked: string; overallPicked: string; passed: boolean; failure: string | null }[];
  judgements: Judgement[];
}

/**
 * Three spoiled trees against the good one they were made from, per judge.
 * The good tree sits in X for some and Y for others, by the seed, so a judge
 * with a favourite seat cannot pass by sitting still.
 */
export async function spoiledCheck(opts: {
  doc: Doc;
  good: Candidate;
  judges: readonly string[];
  ledger: Ledger;
  seed: number;
  cell: string;
}): Promise<SpoiledCheck[]> {
  const { doc, good, seed } = opts;
  const base = mulberry32(seed)() < 0.5 ? 0 : 1;
  const out: SpoiledCheck[] = [];
  for (const id of opts.judges) {
    const judge = judgeById(id);
    const judgements = await Promise.all(
      SPOILS.map(async (kind, k) => {
        const pair = {
          doc,
          a: good,
          b: { name: `spoiled:${kind}`, proposal: spoil(doc, good.proposal, kind, seed) },
          xFirst: (base + k) % 2 === 0,
          seed: seed + k,
          judge,
          ledger: opts.ledger,
          cell: opts.cell,
        };
        /* A reply with no verdict says nothing about the judge: asked once more. */
        const first = await judgePair(pair);
        return first.verdict ? first : judgePair(pair);
      }),
    );
    const rows = SPOILS.map((kind, k) => {
      const j = judgements[k]!;
      const point = MUST_LOSE[kind];
      const picked = j.verdict ? named(j.verdict[point].better, j.x, j.y) : "(no verdict)";
      return {
        spoil: kind,
        goodWas: (j.x === good.name ? "X" : "Y") as Side,
        point,
        picked,
        overallPicked: j.verdict ? named(j.verdict.overall.better, j.x, j.y) : "(no verdict)",
        passed: picked === good.name,
        failure: j.failure,
      };
    });
    out.push({ judge: judge.id, model: judge.model, usable: rows.every((r) => r.passed), inconclusive: rows.some((r) => r.failure !== null), rows, judgements });
  }
  return out;
}
