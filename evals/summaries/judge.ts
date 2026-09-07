/**
 * **The blinded judging pass, and the gate in front of it.**
 *
 * Three things this file does that the template
 * ([`evals/hierarchy-structure/blind.ts`](../hierarchy-structure/blind.ts)) does
 * not, each because of something the plan review found:
 *
 * 1. **Negative anchors in the lineup, and a gate on them.** Blinding does not
 *    blind the intervention here — a question *visibly identifies itself*, so a
 *    judge primed to value "a door" will prefer the arms that look like doors
 *    however the labels are shuffled (GPT Sol, P1-3). The anchors are the answer:
 *    five lines that are definitely bad, and no ranking is reported at all until
 *    the judge has put every one of them below every real line
 *    ([`anchors.ts`](anchors.ts)).
 * 2. **Axes before preference.** Seven named properties are asked for first and
 *    the overall ordering last, so "which do you prefer" cannot colour the
 *    answers to "does it say what the prose says". This is an *ordering request*
 *    made in the prompt and in the schema, not something a text model can be
 *    forced into — said plainly here because a comment claiming enforcement
 *    would be the more dangerous of the two.
 * 3. **A seeded shuffle.** `Math.random` cannot be replayed, and the whole point
 *    of the repeat pass is to judge the *same frozen output* under a *different*
 *    label assignment. The seed goes in the run file, so a judgement can be
 *    reproduced and a disagreement between two repeats can be attributed to the
 *    judge rather than to the materials.
 *
 * ## Two lineups per node, not one
 *
 * The gist and the question are judged separately, and the reason is the
 * anchors: they are all question-shaped single lines, so putting them into a
 * lineup where every other candidate is a gist-and-question pair would let the
 * judge cluster them by shape and reject them for looking odd. That would be the
 * gate passing for the wrong reason — the most expensive kind of green.
 *
 * Separating them also gets the `gists-only` arm a fair hearing on the axis it
 * exists for, and lets the third question — *does this row want the gist, the
 * question, or both?* — be asked afterwards, which is where the plan's
 * "question replaces gist" outcome actually gets decided.
 *
 * ## The judge does not get the repo
 *
 * The default judge is GPT Sol through
 * [`scripts/run-codex.ts`](../../scripts/run-codex.ts) — Greg's own suggestion
 * ("then ask GPT Sol to judge which is best") and the only cross-family reader
 * available, which matters when the text being judged was written by a Claude
 * model. It runs `--sandbox read-only` against an **empty directory**, not this
 * repo: a judge that can open `evals/summaries/variants.md` can read the arms,
 * the anchors and the key, and the blinding would be decoration.
 */

import { spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { isBody } from "../../src/block-policy.js";
import { parseJsonAnswer } from "../../src/parse-json.js";
import { splitBlocks } from "../../src/supplement.js";
import { anchors, isAnchorId, permutationOf } from "./anchors.js";
import type { LoadedDocument } from "./corpus.js";
import type { Cell, RequestedNode } from "./generate.js";

/* ------------------------------------------------------- seeded shuffle -- */

/** FNV-1a over a string, so a seed is a function of what it identifies. */
export function seedFrom(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32 — small, seedable, and good enough to shuffle six labels. */
export function rngFrom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Fisher-Yates, in place on a copy.
 *
 * Not a sort comparator returning `random() - 0.5`, for the reason
 * `evals/hierarchy-labels.ts` § `printShuffled` already wrote down: that leaks
 * positional bias, and a lineup whose first entry is more often the first file
 * on the command line is not blinded.
 */
export function shuffled<T>(items: readonly T[], rng: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/* ----------------------------------------------------------- the lineup -- */

export interface Candidate {
  /** Arm name, or `anchor-N`. Never shown to the judge. */
  id: string;
  /** `A`, `B`, … — what the judge sees. */
  label: string;
  text: string;
}

export interface NodeLineup {
  nodeId: string;
  title: string;
  depth: number;
  /** Windows of the prose the line stands in for — the judge's only source of truth. */
  prose: string;
  /** Whether `prose` is the whole section. False means the judge is reading an excerpt. */
  proseComplete: boolean;
  /** How long the section really is, so the prompt can say what fraction is shown. */
  proseChars: number;
  gists: Candidate[];
  questions: Candidate[];
}

export interface DocumentLineup {
  slug: string;
  title: string;
  repeat: number;
  seed: number;
  nodes: NodeLineup[];
}

/**
 * **How much of a node's prose the judge is shown, and why it is not the head of
 * it.**
 *
 * The first version took the first 1,800 characters. GPT Sol's review killed
 * that, and the example is the calibration node itself: it is **30,187
 * characters**, its opening announces four arguments and starts the first, and
 * the material anchors 3 and 5 quote — the biological-life and simulation
 * arguments — is nowhere in that prefix. So the judge could have ranked the two
 * anchors that matter most at the bottom **for being unsupported by the excerpt**
 * rather than for leaking the answer, and the gate would have passed while
 * measuring excerpt coverage. The most expensive kind of green.
 *
 * So the excerpt is **windows spread across the range**, head first, and the
 * budget is larger. It is still an excerpt and the prompt says so out loud —
 * "you are seeing part of the section" — because a judge that believes it has
 * the whole thing will score fidelity against a gap.
 */
const PROSE_CHARS = 6_000;
const PROSE_WINDOWS = 3;

/**
 * Head, middle and tail of the node's prose, each window whole-ish and marked
 * with an ellipsis where text was cut out. A section short enough to fit comes
 * back complete and un-marked, which is how the caller can tell.
 */
export function proseWindows(text: string, budget = PROSE_CHARS, windows = PROSE_WINDOWS): { excerpt: string; complete: boolean } {
  if (text.length <= budget) return { excerpt: text, complete: true };
  const each = Math.floor(budget / windows);
  const stride = Math.floor((text.length - each) / (windows - 1));
  const parts: string[] = [];
  for (let i = 0; i < windows; i++) {
    const at = i * stride;
    parts.push(text.slice(at, at + each).trim());
  }
  return { excerpt: `${parts.join(" […] ")}`, complete: false };
}

function proseFor(doc: LoadedDocument, node: RequestedNode): { excerpt: string; complete: boolean; chars: number } {
  const { body } = splitBlocks(doc.blocks);
  const text = body
    .slice(node.from, node.to + 1)
    .filter((b) => isBody(b) && b.kind !== "heading")
    .map((b) => b.text)
    .join(" ");
  return { ...proseWindows(text), chars: text.length };
}

/**
 * **Two label alphabets, so a gist and a question cannot look like a pair.**
 *
 * Both lineups used `A`, `B`, … until GPT Sol pointed out what that invites: the
 * prompt says labels differ between sections, and says nothing about gist A and
 * question A within one section, so a judge can reasonably read them as one
 * candidate's two lines. They are not — the two lineups are shuffled
 * independently — and any `rowForm` answer built on that misreading would be
 * about nothing. `G1`/`Q1` cannot be mistaken for each other.
 */
const GIST_LABEL = (i: number) => `G${i + 1}`;
const QUESTION_LABEL = (i: number) => `Q${i + 1}`;

function label(
  items: readonly { id: string; text: string }[],
  rng: () => number,
  name: (i: number) => string,
): Candidate[] {
  return shuffled(items, rng).map((c, i) => ({ id: c.id, label: name(i), text: c.text }));
}

/**
 * Build one document's lineups for one repeat.
 *
 * **The anchors join the calibration node's question lineup and nowhere else** —
 * they are written against that one node, and injecting a line about
 * *Consciousness & Computation* under a section about the Antikythera mechanism
 * would test whether the judge can spot a non-sequitur, which is not the
 * question.
 */
export function buildLineup(
  doc: LoadedDocument,
  requested: readonly RequestedNode[],
  cells: readonly Cell[],
  opts: { repeat: number; runId: string; anchorNodeId?: string | undefined },
): DocumentLineup {
  const seed = seedFrom(`${opts.runId}|${doc.entry.slug}|repeat-${opts.repeat}`);
  const rng = rngFrom(seed);
  const nodes: NodeLineup[] = [];
  for (const node of requested) {
    const gistCandidates: { id: string; text: string }[] = [];
    const questionCandidates: { id: string; text: string }[] = [];
    for (const cell of cells) {
      const line = cell.lines.find((l) => l.nodeId === node.id);
      if (!line) continue;
      gistCandidates.push({ id: cell.arm, text: line.gist });
      if (line.question) questionCandidates.push({ id: cell.arm, text: line.question });
    }
    if (opts.anchorNodeId === node.id) {
      for (const a of anchors()) questionCandidates.push({ id: a.id, text: a.line });
    }
    /* A node no arm answered for is skipped rather than rendered empty: an empty
       lineup judged is a row of nothing that still gets a ranking. */
    if (gistCandidates.length === 0 && questionCandidates.length === 0) continue;
    const prose = proseFor(doc, node);
    nodes.push({
      nodeId: node.id,
      title: node.title,
      depth: node.depth,
      prose: prose.excerpt,
      proseComplete: prose.complete,
      proseChars: prose.chars,
      gists: label(gistCandidates, rng, GIST_LABEL),
      questions: label(questionCandidates, rng, QUESTION_LABEL),
    });
  }
  return { slug: doc.entry.slug, title: doc.title, repeat: opts.repeat, seed, nodes };
}

/* ----------------------------------------------------------- the rubric -- */

/**
 * **What the judge is asked, and the order it is asked in.**
 *
 * The criterion is the plan's, stated so the rubric cannot quietly become
 * "which is most Socratic": *can the reader decide whether to descend from the
 * line alone?* — a door, not a wall.
 *
 * Two things are said out loud because leaving them unsaid would rig a result:
 *
 * - **A straight question, yes/no included, is legitimate.** V3 deliberately
 *   relaxes production's "not yes/no" rule and moves the direction into the
 *   bracketed hint; a rubric that treated yes/no as a defect would decide
 *   against V3 before a word of it was read, and V3 is the arm that can falsify
 *   the whole plan.
 * - **Being informative is not the same as being useful here.** A line that
 *   answers its own question has told the reader everything and given them no
 *   reason to read. That is the trap anchors 3 and 5 are built out of.
 *
 * ## The `demand` axis, added 2026-09-07, and why its absence was a hole
 *
 * Every variant's prompt forbids a **lookup** — *"never 'which', 'who', or
 * anything a single fact settles"* — and until this axis existed, **nothing in
 * this rubric asked about that**. So the 2026-09-05 run put anchor 2, the
 * designated lookup, 4th / 2nd / 4th of twelve with a perfect `5,5,5,5,5` and
 * leakage 1, and the calibration gate failed on it. The obvious reading was that
 * the anchor was mislabelled; the truer one is that **the judge was being asked
 * to reject a failure it had never been told to look for**, and a rewritten
 * anchor alone would have bought a passing gate over a judge still preferring
 * polished lookups. ⟨GPT Sol, F3 on 260907d — the strongest finding of that
 * review, and the reason this axis exists rather than only the new anchor.⟩
 *
 * **It does not penalise a straight question**, which would undo the first of
 * the two guarantees above: *"is computation sufficient for consciousness?"* is
 * yes/no and demands the whole argument, while *"how many arguments are
 * there?"* is neither and demands nothing. The axis is about what the reader
 * must **do**, not about the line's grammar or its quality — a well-made
 * question about exactly the right topic can still score 1.
 *
 * **It applies to every arm equally**, which is what separates adding a
 * criterion from rigging one: the rule it measures is in every variant's own
 * prompt, including the incumbent's and the pinned pre-V4 control's.
 *
 * ### Its examples were coached, and were changed on 2026-09-07 for the NEXT run
 *
 * The wording that shipped taught the axis with *"how many arguments are
 * there?"* — anchor 2 almost verbatim — and *"is computation sufficient for
 * consciousness?"*, which is the core of V3's worked example. Both are in the
 * lineup the axis was about to be used on, so a judge could reject the anchor
 * and reward the arm by **surface resemblance** and never apply the criterion at
 * all; the gate would then pass on a match, not a measurement. ⟨GPT Sol, F23 on
 * 260907d — reasoned rather than reproduced, and cheap enough to fix either
 * way.⟩
 *
 * The examples are now sourdough, which no candidate, no anchor and no corpus
 * article is about. **The result of 2026-09-07 was produced under the coached
 * wording** and is not re-scored by this change: it applies to the next run, and
 * anything read off the old one is read off the old rubric.
 *
 * The half that is **not** fixed here, deliberately: anchor 2 stays as it is and
 * no anchor is added. Those are pre-registered in
 * [`variants.md`](variants.md) § *The five negative anchors*, and editing them
 * after a run is exactly the argument this file's gate exists to refuse. Sol's
 * other observation about it — that anchor 2 scored 2.5 on triage and 3.0 on
 * orientation against ~4.5–5 for the real arms, so its rejection is not isolated
 * to `demand` — stands unaddressed and is a question for the next run's design.
 */
export const RUBRIC = `You are judging candidate summary lines for the sections of an article, one
section at a time. For each section you get the prose it covers, then two
lineups: candidate GISTS (a one-sentence summary) and candidate QUESTIONS (one
line naming what the section is built to answer). Labels are shuffled per
section; A in one section has nothing to do with A in the next, and you do not
know how any candidate was produced.

The reader these are for is deciding, from a collapsed outline, WHICH sections to
open — and then, once inside, wants to know where they are. So the test is:

  Could a reader decide whether to go into this section from this line alone?

A line that already answers its own question has told them everything and given
them no reason to read: it is a wall, not a door. Being the most informative line
in the lineup is therefore NOT the same as being the best one.

A question asked straight — including a yes/no question — is legitimate, and so
is one that leans. Judge what it does for the reader, not its grammatical mood.

Score every axis for every label BEFORE you write any ranking. Integers 1-5,
where 3 is ordinary and 5 is excellent, except where stated.

GIST axes
  fidelity      everything it asserts is in the prose above (5 = nothing added)
  distinctive   says what is specific to THIS section, not what any section on
                the topic would say
  triage        from this alone, could you decide whether to read the section
  orientation   once you are reading, does it tell you where you are
  simplicity    plain, lands first time, no meta-narration ("the essay opens by")
  length        "short" | "right" | "long" — is it the right size for its depth,
                given that a root gist should be the BRIEFEST row in the article
                and a chapter gist may be a little longer

QUESTION axes
  fidelity      everything it presupposes or asserts is in the prose (5 = nothing
                added); a claimed count or kind that the prose does not support
                scores 1
  distinctive   names what is specific to this section
  triage        from this alone, could you decide whether to read the section
  orientation   once inside, does it tell you what the section is doing
  simplicity    plain and readable at a glance
  leakage       how much of the answer it gives away. LOWER IS BETTER:
                1 = tells you nothing you would have read for, 5 = answers itself
  demand        does answering it require FOLLOWING the section's argument, or
                would retrieving one fact or one list from the prose settle it?
                5 = you have to read the reasoning, 1 = a single lookup answers
                it. A well-made question about exactly the right topic can still
                score 1: this is about what the reader must DO, not about how
                good the line is. A yes/no question is not automatically low —
                for a section on sourdough, "does a longer ferment really
                improve the crumb?" makes you follow the case, while "what
                temperature does the recipe call for?" is settled by one line.
  shapeHint     "none" if it makes no claim about the shape of the answer,
                "true" if it claims a count or kind the prose supports,
                "false" if it claims one the prose does not support,
                "unverifiable" if you cannot tell from the prose given

THEN, and only then, rank each lineup best-first, and say which form the row
wants.

The prose under each section may be an EXCERPT — windows taken from the start,
middle and end, joined by "[…]". Where it says so, judge fidelity against what
you can see and use "unverifiable" rather than "false" for a claim the excerpt
neither supports nor contradicts. Do not mark a line down for naming something
that plausibly sits in a gap.

Gist labels are G1, G2, … and question labels are Q1, Q2, …. They are shuffled
INDEPENDENTLY: G1 and Q1 in the same section are not the same candidate and have
nothing to do with each other.

Answer in JSON only, no prose outside it:

{"nodes": {
  "<nodeId>": {
    "gists":     {"axes": {"G1": {"fidelity": 3, "distinctive": 3, "triage": 3,
                                  "orientation": 3, "simplicity": 3,
                                  "length": "right"}},
                  "ranking": ["<best gist label>", "…"]},
    "questions": {"axes": {"Q1": {"fidelity": 3, "distinctive": 3, "triage": 3,
                                  "orientation": 3, "simplicity": 3,
                                  "leakage": 2, "demand": 3, "shapeHint": "none"}},
                  "ranking": ["<best question label>", "…"]},
    "rowForm": "gist" | "question" | "both",
    "why": "<one sentence on what separated the top from the bottom>"
  }
}}

Every label in a lineup must appear exactly once in that lineup's ranking. Rank
every label, including any you think are bad — where the bad ones land is the
most useful thing you will tell us.`;

export function renderPrompt(lineup: DocumentLineup): string {
  const parts: string[] = [
    `# Candidate summary lines for "${lineup.title}"`,
    "",
    RUBRIC,
    "",
    "---",
  ];
  for (const node of lineup.nodes) {
    parts.push(
      "",
      `## Section \`${node.nodeId}\` — ${node.title} (depth ${node.depth})`,
      "",
      node.proseComplete
        ? "The prose this section covers, in full:"
        : `The prose this section covers — an EXCERPT: three windows out of ${node.proseChars.toLocaleString()} characters, joined by "[…]".`,
      "",
      `> ${node.prose}`,
      "",
      "Candidate GISTS:",
      ...node.gists.map((c) => `- **${c.label}**: ${c.text}`),
      "",
      "Candidate QUESTIONS:",
      ...(node.questions.length
        ? node.questions.map((c) => `- **${c.label}**: ${c.text}`)
        : ["- (none — this section is below the question depth)"]),
    );
  }
  return `${parts.join("\n")}\n`;
}

/** Label → candidate id, per node and per lineup. Written to a key file the judge never sees. */
export function keyFor(lineup: DocumentLineup): Record<string, { gists: Record<string, string>; questions: Record<string, string> }> {
  const key: Record<string, { gists: Record<string, string>; questions: Record<string, string> }> = {};
  for (const node of lineup.nodes) {
    key[node.nodeId] = {
      gists: Object.fromEntries(node.gists.map((c) => [c.label, c.id])),
      questions: Object.fromEntries(node.questions.map((c) => [c.label, c.id])),
    };
  }
  return key;
}

/* ---------------------------------------------------------- the answer --- */

export interface JudgedLineup {
  axes: Record<string, Record<string, number | string>>;
  ranking: string[];
}
export interface JudgedNode {
  gists?: JudgedLineup | undefined;
  questions?: JudgedLineup | undefined;
  rowForm?: string | undefined;
  why?: string | undefined;
}
/** One node's judgement with the labels turned back into arm names. */
export interface UnblindedNode {
  gists?: JudgedLineup | undefined;
  questions?: JudgedLineup | undefined;
  rowForm?: string | undefined;
}

export interface JudgeAnswer {
  nodes: Record<string, JudgedNode>;
}

/**
 * Turn the judge's labels back into arm names.
 *
 * A label the key does not know is **dropped and reported**, never guessed: a
 * hallucinated label in a ranking is a ranking over something that was not in
 * the lineup, and silently coercing it would put an invented candidate into an
 * aggregate.
 */
export function unblind(
  lineup: DocumentLineup,
  answer: JudgeAnswer,
): { nodes: Record<string, UnblindedNode>; unknownLabels: string[] } {
  const key = keyFor(lineup);
  const unknownLabels: string[] = [];
  const nodes: Record<string, UnblindedNode> = {};
  for (const [nodeId, judged] of Object.entries(answer.nodes ?? {})) {
    const nodeKey = key[nodeId];
    if (!nodeKey) {
      unknownLabels.push(`node ${nodeId} is not in the lineup`);
      continue;
    }
    const translate = (which: "gists" | "questions", j?: JudgedLineup): JudgedLineup | undefined => {
      if (!j) return undefined;
      const map = nodeKey[which];
      const axes: Record<string, Record<string, number | string>> = {};
      for (const [lab, scores] of Object.entries(j.axes ?? {})) {
        const id = map[lab];
        if (!id) {
          unknownLabels.push(`${nodeId}/${which}: axes name label ${lab}, which was not in the lineup`);
          continue;
        }
        axes[id] = scores;
      }
      const ranking: string[] = [];
      for (const lab of j.ranking ?? []) {
        const id = map[lab];
        if (!id) {
          unknownLabels.push(`${nodeId}/${which}: ranking names label ${lab}, which was not in the lineup`);
          continue;
        }
        ranking.push(id);
      }
      return { axes, ranking };
    };
    nodes[nodeId] = {
      gists: translate("gists", judged.gists),
      questions: translate("questions", judged.questions),
      rowForm: judged.rowForm,
    };
  }
  return { nodes, unknownLabels };
}

/* ------------------------------------------------- the answer, validated -- */

interface AxisSpec {
  /** Integers 1-5. Every one is required of every label. */
  numeric: readonly string[];
  /** Word axes, and the only words allowed. */
  enums: Readonly<Record<string, readonly string[]>>;
}

/**
 * **The axes the rubric asks for, in a form code can check.**
 *
 * The rubric is prose to a model and this is the same list to a program; they
 * are two statements of one fact and `tests/summaries-eval.test.ts` holds them
 * to each other, because an axis described in one and absent from the other is
 * either a field nobody defined or a check nobody makes.
 */
export const AXES: Readonly<Record<"gists" | "questions", AxisSpec>> = {
  gists: {
    numeric: ["fidelity", "distinctive", "triage", "orientation", "simplicity"],
    enums: { length: ["short", "right", "long"] },
  },
  questions: {
    numeric: ["fidelity", "distinctive", "triage", "orientation", "simplicity", "leakage", "demand"],
    enums: { shapeHint: ["none", "true", "false", "unverifiable"] },
  },
};

/**
 * **Does this answer answer the question that was asked?** Every complaint it
 * can make, in words; an empty array is the whole of "yes".
 *
 * ## Where this check belongs, and why it is not in the gate
 *
 * `anchors.ts` § `calibrationOf` already checks that a ranking is a permutation
 * of its lineup, and this does not duplicate it, because the two run over
 * different things and answer different questions:
 *
 * - The **gate** is about ORDER, over **candidate ids**, after unblinding, and
 *   only in the one lineup that carries anchors. It is the pre-registered
 *   verdict, and it has to keep meaning what it says when `judged.json` is read
 *   back weeks later by something that never called this function.
 * - **This** is about SHAPE, over **the judge's own labels**, before unblinding,
 *   in every lineup of every node. It is an *acceptance* check: an answer that
 *   fails it is not a bad judgement, it is not a judgement.
 *
 * So this sits at the seam where the answer arrives and the gate stays where the
 * verdict is computed. The shared set arithmetic is `permutationOf`, imported
 * from `anchors.ts` rather than written twice.
 *
 * ## Why the whole answer, and not the offending node
 *
 * A caller is expected to treat any complaint as a failed judging call and drop
 * the whole document's answer. Keeping the nodes that happened to parse would
 * leave some arms ranked over more lineups than others inside one repeat, which
 * is the exact shape the clean bill exists to refuse — and a model that
 * disobeyed the schema on one node has told you something about the answer, not
 * about the node. The raw answer is still on disk either way.
 *
 * ⟨GPT Sol, F26 on 260907d: the `demand` axis was requested by the rubric and
 * required by nothing. A complete ranking with no axes at all passed the gate,
 * stripping every `demand` field left calibration and ranking usable, and the
 * stub judge — the judge on every free run — never wrote one.⟩
 */
/** One label's scores against one lineup's axis spec. Every complaint, in words. */
function axisComplaints(spec: AxisSpec, scores: Record<string, number | string> | undefined, where: string): string[] {
  if (!scores) return [`${where}: not scored on any axis`];
  const complaints: string[] = [];
  for (const axis of spec.numeric) {
    const v = scores[axis];
    if (typeof v !== "number" || !Number.isFinite(v)) {
      complaints.push(`${where}: ${axis} is ${JSON.stringify(v ?? null)}, not a number`);
    } else if (v < 1 || v > 5) {
      complaints.push(`${where}: ${axis} is ${v}, outside 1-5`);
    }
  }
  for (const [axis, allowed] of Object.entries(spec.enums)) {
    const v = scores[axis];
    if (typeof v !== "string" || !allowed.includes(v)) {
      complaints.push(`${where}: ${axis} is ${JSON.stringify(v ?? null)}, not one of ${allowed.join(" | ")}`);
    }
  }
  return complaints;
}

/** One lineup — a node's gists or its questions — against what came back for it. */
function lineupComplaints(
  candidates: readonly Candidate[],
  lines: JudgedLineup | undefined,
  where: string,
  spec: AxisSpec,
): string[] {
  /* A node below the question depth has no question lineup, so there is nothing
     owed for it and nothing to complain about. */
  if (candidates.length === 0) return [];
  if (!lines) return [`${where}: ${candidates.length} line(s) shown and none judged`];
  const labels = candidates.map((c) => c.label);
  const complaints: string[] = [];
  const { duplicated, absent, foreign } = permutationOf(labels, lines.ranking ?? []);
  if (duplicated.length) complaints.push(`${where}: ranked twice — ${duplicated.join(", ")}`);
  if (absent.length) complaints.push(`${where}: left out of the ranking — ${absent.join(", ")}`);
  if (foreign.length) complaints.push(`${where}: ranked something that was not in the lineup — ${foreign.join(", ")}`);
  for (const label of labels) complaints.push(...axisComplaints(spec, lines.axes?.[label], `${where}/${label}`));
  return complaints;
}

export function validateAnswer(lineup: DocumentLineup, answer: JudgeAnswer): string[] {
  const complaints: string[] = [];
  const nodes = answer?.nodes;
  if (!nodes || typeof nodes !== "object") return [`the answer has no "nodes" object`];
  const shown = new Set(lineup.nodes.map((n) => n.nodeId));
  for (const nodeId of Object.keys(nodes)) {
    if (!shown.has(nodeId)) complaints.push(`${nodeId}: judged, and it was not in the lineup`);
  }
  for (const node of lineup.nodes) {
    const judged = nodes[node.nodeId];
    if (!judged) {
      complaints.push(`${node.nodeId}: in the lineup and not in the answer`);
      continue;
    }
    for (const which of ["gists", "questions"] as const) {
      complaints.push(...lineupComplaints(node[which], judged[which], `${node.nodeId}/${which}`, AXES[which]));
    }
  }
  return complaints;
}

/** Candidate ids present in a node's question lineup — what the calibration gate is measured over. */
export function questionIdsIn(lineup: DocumentLineup, nodeId: string): string[] {
  return lineup.nodes.find((n) => n.nodeId === nodeId)?.questions.map((c) => c.id) ?? [];
}

export function hasAnchors(lineup: DocumentLineup): boolean {
  return lineup.nodes.some((n) => n.questions.some((c) => isAnchorId(c.id)));
}

/* ---------------------------------------------------------- the drivers -- */

/** One judging call: prompt in, JSON out. A seam, so a stub can stand in for GPT Sol. */
export type Judge = (prompt: string, label: string) => Promise<JudgeAnswer>;

export interface CodexJudgeOptions {
  model?: string;
  effort?: string;
  timeoutMinutes?: number;
  /** Where the prompt, the raw answer and the activity log are written. */
  dir: string;
}

/**
 * GPT Sol, through `scripts/run-codex.ts`, with **no repo in front of it**.
 *
 * `--repo-dir` is a fresh empty temp directory and `--sandbox read-only`,
 * because the review sandbox needs a `.codex/config.toml` and, more to the
 * point, because a judge pointed at this checkout could read `variants.md`, the
 * arms and the key file it is being blinded from.
 */
export function codexJudge(opts: CodexJudgeOptions): Judge {
  return async (prompt, label) => {
    const promptFile = path.join(opts.dir, `judge-${label}.md`);
    const answerFile = path.join(opts.dir, `judge-${label}.answer.md`);
    await writeFile(promptFile, prompt, "utf-8");
    const empty = await mkdtemp(path.join(tmpdir(), "summaries-judge-"));
    const args = [
      "tsx",
      "scripts/run-codex.ts",
      "--model",
      opts.model ?? "gpt-5.6-sol",
      "--effort",
      opts.effort ?? "high",
      "--sandbox",
      "read-only",
      "--repo-dir",
      empty,
      "--timeout-minutes",
      String(opts.timeoutMinutes ?? 30),
      "--prompt-file",
      promptFile,
      "--output",
      answerFile,
      "--quiet",
    ];
    const code = await new Promise<number>((resolve, reject) => {
      const child = spawn("npx", args, { stdio: ["ignore", "inherit", "inherit"] });
      child.on("error", reject);
      child.on("close", (c) => resolve(c ?? 1));
    });
    /* **Both, not either.** A review that returned nothing looks exactly like
       one that found nothing — CLAUDE.md § Get a cross-family review — so the
       exit code and the answer file are checked separately and named separately. */
    const raw = await readFile(answerFile, "utf-8").catch(() => "");
    if (code !== 0) throw new Error(`the judge exited ${code} for ${label} (answer file ${raw.length} chars)`);
    if (raw.trim() === "") throw new Error(`the judge exited 0 for ${label} and wrote an empty answer file`);
    return parseJsonAnswer<JudgeAnswer>(raw, `judge answer for ${label}`);
  };
}

/** Writes the materials and calls nothing. What `--judge materials` and a dry run get. */
export const materialsOnlyJudge: Judge = async (_prompt, label) => {
  throw new Error(
    `--judge materials writes the prompt and the key and stops; nothing judged ${label}. Run again with --judge codex to buy the judgement.`,
  );
};
