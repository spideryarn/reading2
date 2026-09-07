/**
 * **The Socratic-summaries eval — stage C of
 * [260905f](../../docs/plans/260905f-socratic-summaries-eval-admin-page-gating-short-selections.md).**
 *
 * ```
 * # the corpus, once — read the Target: line it prints, not its success line
 * npm run db:export -- --out output/summaries-corpus
 *
 * npx tsx evals/summaries/run.ts generate --stub          # free: no model, no network
 * npx tsx evals/summaries/run.ts generate                 # ~50 calls, production's model
 * npx tsx evals/summaries/run.ts judge --run <dir> --repeats 3
 * npx tsx evals/summaries/run.ts report --run <dir>
 * npx tsx evals/summaries/run.ts plan                     # what a run would buy, and from where
 * ```
 *
 * ## What this eval is, and the one sentence that must survive being quoted
 *
 * **It is a screen that rejects bad variants, not a verdict that ships one.**
 * The final instrument is Greg reading rendered examples on three or four
 * articles — the plan's stage 2 — and both advisers reached that from opposite
 * directions (Fable from what the reader is doing in the panel, GPT Sol from
 * what a model judge cannot settle). Everything here is upstream of that: it
 * exists so what Greg reads is the best of seven rather than the first of one.
 *
 * ## The three guards, and what each is for
 *
 * - **The calibration gate** ([`anchors.ts`](anchors.ts)). Five known-bad lines
 *   go into one lineup, and the run reports **no ranking at all** unless the
 *   judge put every one of them below every real line. Blinding cannot help
 *   here — a question announces itself — so this is the only thing standing
 *   between "the judge preferred the doors" and "the judge measured anything".
 * - **The two resolutions** ([`score.ts`](score.ts)). The incumbent run twice
 *   measures how much the model wobbles; the same frozen output judged again
 *   under a fresh shuffle measures how much the judge does. A gap smaller than
 *   the larger of them is not a gap.
 * - **A clean bill computed forwards** ([`evals/dictation/coverage.ts`](../dictation/coverage.ts)).
 *   Every arm must have answered all of what it was sent, in whole positive
 *   numbers. The exit code comes from that module and from nothing else.
 *
 * ## What it cannot claim
 *
 * Listed at the top of [`arms.ts`](arms.ts) and repeated in every results file:
 * every arm is a `bakeoff`, the control included, because production asks for
 * structure, titles, gists and questions in **one** long-context response and
 * this asks only for wording over a fixed tree. Nothing here sees an interaction
 * between the new wording and the structure the model proposes in the same
 * breath, and nothing here touches `EXPAND_SYSTEM`. That prompt gained its own
 * QUESTIONS block on 2026-09-07 (`expand/4`), carrying V4's rules — so the
 * cascade is no longer a hole in the product, but it is still a hole in this
 * harness, and no result from here may be read as covering it.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { loadEnvLocal } from "../../src/env.js";
import { withLedger } from "../../src/cli-ledger.js";
import { isMain } from "../../src/is-main.js";
import { modelFor } from "../../src/models.js";
import { parseJsonFrom } from "../../src/parse-json.js";
import { coverageLines, exitCodeFor } from "../dictation/coverage.js";
import { ANCHOR_SITE, anchors, assertAnchorSite, calibrationOf, isAnchorId, type RankedLineup } from "./anchors.js";
import { ARMS, armByName, armsNeedingCodeChange, type ArmSpec } from "./arms.js";
import { CORPUS, DEFAULT_CORPUS_ROOT, defaultCorpus, entryFor, loadDocument, type LoadedDocument } from "./corpus.js";
import {
  type Cell,
  generateCell,
  type Generator,
  liveGenerator,
  requestedNodes,
  type RequestedNode,
  userFor,
} from "./generate.js";
import {
  buildLineup,
  codexJudge,
  type DocumentLineup,
  type Judge,
  type JudgeAnswer,
  type JudgedLineup,
  keyFor,
  materialsOnlyJudge,
  questionIdsIn,
  renderPrompt,
  unblind,
} from "./judge.js";
import {
  type ArmPlan,
  coverageFor,
  generationNoiseFloor,
  type Judgement,
  judgeInstability,
  meanRanks,
  perRepeatLeaders,
  separabilityThreshold,
  separate,
  shapeFacts,
} from "./score.js";

/**
 * **Gitignored, because a judging prompt is real article prose.**
 *
 * It was `evals/results/summaries/` — beside every other eval's committed
 * numbers — and GPT Sol was right that this puts tens of thousands of words of
 * readers' articles on a path `evals/results/README.md` says is committed. The
 * corpus manifest already says those bytes "do not belong in git"; the excerpts
 * of them do not either.
 *
 * So a run lives under `/output/`, and what gets *promoted* into
 * `evals/results/summaries/` by hand is `results.md`, which carries arm names,
 * counts, ranks and model-written lines — no article prose.
 */
const RUN_ROOT = "output/summaries-runs";

/* ------------------------------------------------------------- the flags -- */

interface Options {
  command: string;
  corpusRoot: string;
  arms: string[];
  slugs: string[];
  depth: number;
  repeats: number;
  out: string;
  run: string | null;
  stub: boolean;
  stubSilent: string[];
  stubJudge: "good" | "bad" | null;
  judgeKind: "codex" | "materials";
}

function parseOptions(argv: string[]): Options {
  const o: Options = {
    command: argv[0] ?? "plan",
    corpusRoot: process.env.SUMMARIES_CORPUS_ROOT ?? DEFAULT_CORPUS_ROOT,
    arms: [],
    slugs: [],
    depth: 1,
    repeats: 1,
    out: "",
    run: null,
    stub: false,
    stubSilent: [],
    stubJudge: null,
    judgeKind: "codex",
  };
  const rest = argv.slice(1);
  const value = (flag: string): string => {
    const v = rest.shift();
    if (v === undefined) throw new Error(`${flag} requires a value`);
    return v;
  };
  while (rest.length) {
    const flag = rest.shift()!;
    switch (flag) {
      case "--corpus-root": o.corpusRoot = value(flag); break;
      case "--arm": o.arms.push(value(flag)); break;
      case "--doc": o.slugs.push(value(flag)); break;
      case "--depth": o.depth = Number(value(flag)); break;
      case "--repeats": o.repeats = Number(value(flag)); break;
      case "--out": o.out = value(flag); break;
      case "--run": o.run = value(flag); break;
      case "--stub": o.stub = true; break;
      case "--stub-silent": o.stubSilent.push(value(flag)); break;
      case "--stub-judge": {
        const v = value(flag);
        if (v !== "good" && v !== "bad") throw new Error(`--stub-judge must be good or bad (got ${v})`);
        o.stubJudge = v;
        break;
      }
      case "--judge": {
        const v = value(flag);
        if (v !== "codex" && v !== "materials") throw new Error(`--judge must be codex or materials (got ${v})`);
        o.judgeKind = v;
        break;
      }
      default: throw new Error(`unknown flag: ${flag}`);
    }
  }
  if (!Number.isInteger(o.depth) || o.depth < 0) throw new Error(`--depth must be a whole number (got ${o.depth})`);
  if (!Number.isInteger(o.repeats) || o.repeats < 1) throw new Error(`--repeats must be a positive whole number (got ${o.repeats})`);
  return o;
}

function armsFor(o: Options): ArmSpec[] {
  return o.arms.length ? o.arms.map(armByName) : [...ARMS];
}

function corpusFor(o: Options) {
  if (o.slugs.length === 0) return defaultCorpus();
  return o.slugs.map((slug) => {
    const entry = entryFor(slug);
    if (!entry) throw new Error(`"${slug}" is not in the manifest. Corpus: ${CORPUS.map((e) => e.slug).join(", ")}`);
    return entry;
  });
}

/* ------------------------------------------------------------- the stubs -- */

/**
 * **A generator that spends nothing and still exercises every seam** — the
 * prompt assembly, the JSON parse, the `questionFor` rule, the lineups, the
 * gate, the coverage arithmetic and the exit code.
 *
 * Its lines are deliberately, visibly synthetic and they **name their own arm**.
 * A stub whose output looked plausible could end up in a results file being read
 * as a measurement, which is the failure mode this whole eval is built around;
 * naming the arm also makes the shuffle checkable by eye in the written
 * materials. The obvious cost — a stub lineup is not blinded — is real and
 * harmless, because a stub run measures nothing and says so in its run file, its
 * directory name and the first line of its report.
 */
function stubGenerator(arm: ArmSpec, silent: readonly string[]): Generator {
  return async ({ system, user }) => {
    if (silent.includes(arm.name)) throw new Error(`--stub-silent ${arm.name}: this arm's call was made to fail`);
    /* Only the rows the outline actually asks for — the stub has to obey the
       same instruction the arms do, or it would answer for the context rows and
       every cell would report invented ids. */
    const ids = [...user.matchAll(/^\s*(n\d+)\s+depth (\d+)[^\n]*WRITE GIST/gm)].map((m) => [m[1]!, Number(m[2])] as const);
    const nodes: Record<string, { gist: string; question?: string }> = {};
    for (const [id, depth] of ids) {
      const entry: { gist: string; question?: string } = { gist: `STUB gist for ${id} from arm ${arm.name}.` };
      if (depth <= 1) {
        /* **Keyed on the block this arm actually sends**, which is the only
           thing that stays true as the lineup changes.

           It was `arm.questionRule`, which stopped discriminating the moment V4
           shipped and production took its patch; the fix for that keyed on
           `arm.variant === "V4"`, and that was wrong within the hour, because
           removing the `v4` arm left **no** arm with that variant while five
           arms carry V4's block through `productionQuestions()`. So `--stub`
           claimed to exercise the trailing-hint seam and exercised it zero
           times. ⟨GPT Sol, F12, 2026-09-07.⟩

           Reading the system prompt cannot go stale that way: whichever arm
           sends the shape, the stub answers in it. */
        entry.question = system.includes('"<topic> — <question>? (<shape hint>)"')
          ? `STUB topic — what does ${id} argue? (2 reasons)`
          : `STUB topic (2 reasons): why does ${id} argue what it argues?`;
      }
      nodes[id] = entry;
    }
    return { text: JSON.stringify({ nodes }), inputTokens: 0, outputTokens: 0, answeredBy: "stub" };
  };
}

/**
 * A judge that does not think, so the gate can be watched doing both things.
 *
 * `good` ranks the anchors last, in lineup order otherwise. `bad` puts one
 * anchor at the top — which is how the calibration gate gets **seen red** rather
 * than merely believed (`docs/reusable/silent-success.md`).
 */
function stubJudge(kind: "good" | "bad", lineups: Map<string, DocumentLineup>): Judge {
  return async (_prompt, label) => {
    const lineup = lineups.get(label);
    if (!lineup) throw new Error(`the stub judge has no lineup for ${label}`);
    const nodes: JudgeAnswer["nodes"] = {};
    for (const node of lineup.nodes) {
      const rank = (cands: { id: string; label: string }[]) => {
        const real = cands.filter((c) => !isAnchorId(c.id)).map((c) => c.label);
        const anchorLabels = cands.filter((c) => isAnchorId(c.id)).map((c) => c.label);
        return kind === "bad" && anchorLabels.length
          ? [anchorLabels[0]!, ...real, ...anchorLabels.slice(1)]
          : [...real, ...anchorLabels];
      };
      const axesFor = (cands: { label: string }[], extra: Record<string, number | string>) =>
        Object.fromEntries(
          cands.map((c) => [c.label, { fidelity: 3, distinctive: 3, triage: 3, orientation: 3, simplicity: 3, ...extra }]),
        );
      nodes[node.nodeId] = {
        gists: { axes: axesFor(node.gists, { length: "right" }), ranking: rank(node.gists) },
        questions: { axes: axesFor(node.questions, { leakage: 2, shapeHint: "none" }), ranking: rank(node.questions) },
        rowForm: "both",
        why: "stub judge: no judgement was made.",
      };
    }
    return { nodes };
  };
}

/* --------------------------------------------------------- the run files -- */

interface RunFile {
  runId: string;
  startedAt: string;
  corpusRoot: string;
  /** Empty when every document was the pinned bytes. Read this, not the absence of a complaint. */
  corpusDrift: string[];
  arms: { name: string; comparison: string; isolatedAgainst?: string | undefined; axis: string; deltas: readonly string[] }[];
  armsNeedingCodeChange: string[];
  documents: { slug: string; role: string; blocks: number; nodesRequested: number; questionsRequested: number }[];
  /**
   * **What each arm was sent, fixed before any call** — the coverage
   * denominator, recorded here rather than counted off `generated.json`, so a
   * cell that never got written is missing from the numerator and present in the
   * denominator instead of absent from both. ⟨GPT Sol, P0-3.⟩
   */
  plan: ArmPlan[];
  depth: number;
  stub: boolean;
  model: string;
  claimLimits: string[];
}

/** Repeated into every results file, so it cannot be lost by being quoted out of context. */
const CLAIM_LIMITS = [
  "Every arm is a `bakeoff`, the control included: production asks for structure, titles, gists and questions in ONE long-context response, and this asks only for wording over a fixed tree.",
  "Nothing here sees an interaction between the new wording and the structure the model proposes in the same breath — that is what the cheap design buys its cheapness with.",
  "Nothing here touches `EXPAND_SYSTEM` (src/hierarchy-expand.ts), so no result covers the deepening cascade. That prompt gained its own QUESTIONS block on 2026-09-07 (`expand/4`), carrying V4's rules — but nothing in this harness measures it.",
  "A win is a reason to put a variant in front of Greg RENDERED (the plan's stage 2), never a reason to ship it.",
  "Depth-2 gists at two sentences are deferred, not measured: they raise TOKENS_PER_NODE and break evals/hierarchy-structure's baseline.",
];

function newRunId(): string {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

/* ------------------------------------------------------------- generate --- */

async function loadAll(o: Options): Promise<LoadedDocument[]> {
  const docs: LoadedDocument[] = [];
  for (const entry of corpusFor(o)) docs.push(await loadDocument(o.corpusRoot, entry));
  return docs;
}

async function commandPlan(o: Options): Promise<void> {
  const arms = armsFor(o);
  const docs = await loadAll(o);
  console.log(`# What a run would buy\n`);
  console.log(`Corpus root: ${o.corpusRoot}`);
  console.log(`Model:       ${modelFor("hierarchy")}\n`);
  let nodes = 0;
  let promptChars = 0;
  for (const doc of docs) {
    const requested = requestedNodes(doc, o.depth);
    nodes += requested.length;
    promptChars += userFor(doc, requested).length;
    console.log(
      `  ${doc.entry.slug.padEnd(56)} ${String(doc.entry.blocks).padStart(5)} blocks  ${String(requested.length).padStart(3)} nodes` +
        (doc.drift.length ? `  DRIFTED: ${doc.drift.join("; ")}` : ""),
    );
  }
  console.log(`\n  ${arms.length} arms x ${docs.length} documents = ${arms.length * docs.length} calls, ${nodes * arms.length} node lines.`);
  /* **A rough figure, and it says so.** Four characters to the token is a
     rule of thumb, and the money that ever gets quoted is what OpenRouter bills
     in-band — `withLedger` prints it at the end of a real run. This is here to
     stop somebody starting a run without knowing its order of magnitude, which
     is the only decision it is good enough for. Prompt caching does not help:
     the system block differs per arm and comes first, so each arm re-reads the
     article. */
  console.log(
    `  roughly ${Math.round((promptChars * arms.length) / 4 / 1000)}k input tokens and ` +
      `${Math.round((nodes * arms.length * 120) / 1000)}k output, +/- a lot — four chars to the token, and the bill is what the ledger says.`,
  );
  console.log(`  Arms: ${arms.map((a) => a.name).join(", ")}`);
  console.log(`  Needing a production code change if they win: ${armsNeedingCodeChange().join(", ") || "(none)"}`);
  console.log(`\nWhat this eval cannot claim:`);
  for (const line of CLAIM_LIMITS) console.log(`  - ${line}`);
}

async function commandGenerate(o: Options): Promise<void> {
  const arms = armsFor(o);
  const docs = await loadAll(o);
  const runId = newRunId();
  const dir = o.out || path.join(RUN_ROOT, `${runId}${o.stub ? "-stub" : ""}`);
  await mkdir(dir, { recursive: true });

  const anchorDoc = docs.find((d) => d.entry.slug === ANCHOR_SITE.slug);
  /* Before a penny is spent: the anchors' node has to still be the node they
     were written against, or the calibration gate would pass over nothing. */
  if (anchorDoc) assertAnchorSite(anchorDoc);
  else console.log(`! ${ANCHOR_SITE.slug} is not in this run, so there is no calibration gate and no ranking may be reported.`);

  const requestedBy = new Map(docs.map((d) => [d.entry.slug, requestedNodes(d, o.depth)]));
  const totalGists = [...requestedBy.values()].reduce((n, r) => n + r.length, 0);
  const totalQuestions = [...requestedBy.values()].reduce((n, r) => n + r.filter((x) => x.wantsQuestion).length, 0);
  const plan: ArmPlan[] = arms.map((a) => ({ arm: a.name, gists: totalGists, questions: totalQuestions }));
  const runFile: RunFile = {
    runId,
    startedAt: new Date().toISOString(),
    corpusRoot: o.corpusRoot,
    corpusDrift: docs.flatMap((d) => d.drift),
    arms: arms.map((a) => ({ name: a.name, comparison: a.comparison, isolatedAgainst: a.isolatedAgainst, axis: a.axis, deltas: a.deltas })),
    armsNeedingCodeChange: armsNeedingCodeChange(),
    documents: docs.map((d) => ({
      slug: d.entry.slug,
      role: d.entry.role,
      blocks: d.entry.blocks,
      nodesRequested: requestedBy.get(d.entry.slug)!.length,
      questionsRequested: requestedBy.get(d.entry.slug)!.filter((x) => x.wantsQuestion).length,
    })),
    plan,
    depth: o.depth,
    stub: o.stub,
    model: o.stub ? "(stub — no model was called)" : modelFor("hierarchy"),
    claimLimits: CLAIM_LIMITS,
  };
  await writeFile(path.join(dir, "run.json"), `${JSON.stringify(runFile, null, 2)}\n`, "utf-8");
  if (runFile.corpusDrift.length) {
    console.log(`! the corpus is not the pinned bytes:\n  - ${runFile.corpusDrift.join("\n  - ")}\n`);
  }

  const cells: Cell[] = [];
  for (const doc of docs) {
    const requested = requestedBy.get(doc.entry.slug)!;
    for (const arm of arms) {
      const generate = o.stub ? stubGenerator(arm, o.stubSilent) : liveGenerator;
      const cell = await generateCell(arm, doc, requested, generate);
      cells.push(cell);
      /* Checkpointed after every cell, so progress is read from the run
         directory rather than from whatever is orchestrating it — the lesson
         evals/hierarchy-structure wrote down after a laptop lid killed a panel. */
      await writeFile(path.join(dir, "generated.json"), `${JSON.stringify(cells, null, 2)}\n`, "utf-8");
      console.log(
        `  ${arm.name.padEnd(18)} ${doc.entry.slug.padEnd(56)} ${String(cell.lines.length).padStart(3)}/${String(cell.requested.length).padEnd(3)} lines` +
          (cell.error ? `  FAILED: ${cell.error}` : "") +
          (cell.missing.length && !cell.error ? `  missing: ${cell.missing.join(",")}` : ""),
      );
    }
  }

  const coverage = coverageFor(cells, plan, o.stub ? "stub" : modelFor("hierarchy"));
  console.log("");
  for (const line of coverageLines(coverage)) console.log(line);
  console.log(`\nWrote ${dir}`);
  if (exitCodeFor(coverage) === 1) process.exitCode = 1;
}

/* ---------------------------------------------------------------- judge --- */

/**
 * Build and write every lineup, one per (document, repeat).
 *
 * The materials are written **before** anything is judged, so a run whose judge
 * never answers still leaves behind exactly what it would have asked — readable
 * by a person, and re-runnable.
 */
async function writeLineups(
  dir: string,
  docs: readonly LoadedDocument[],
  cells: readonly Cell[],
  runFile: RunFile,
  repeats: number,
): Promise<Map<string, DocumentLineup>> {
  const lineups = new Map<string, DocumentLineup>();
  for (const doc of docs) {
    /* **Again, here.** `generate` already checked, but a judging pass can be run
       days later against a re-export, and the anchors are injected in THIS
       function — so the check belongs where the injection happens as well as
       where the money is spent. A gate over a moved node passes over nothing. */
    if (doc.entry.slug === ANCHOR_SITE.slug) assertAnchorSite(doc);
    const requested: RequestedNode[] = requestedNodes(doc, runFile.depth);
    const mine = cells.filter((c) => c.slug === doc.entry.slug);
    for (let repeat = 1; repeat <= repeats; repeat++) {
      const label = `${doc.entry.slug}-r${repeat}`;
      const lineup = buildLineup(doc, requested, mine, {
        repeat,
        runId: runFile.runId,
        anchorNodeId: doc.entry.slug === ANCHOR_SITE.slug ? ANCHOR_SITE.nodeId : undefined,
      });
      lineups.set(label, lineup);
      await writeFile(path.join(dir, "judging", `${label}.md`), renderPrompt(lineup), "utf-8");
      /* **The key is NOT written here.** It used to be, and a tool-using judge
         that found this directory could read it — the codex sandbox changes the
         working directory and write permissions, it does not stop reads
         elsewhere. ⟨GPT Sol, P1-11.⟩ Keys are written once every judgement is
         in, and until then the seed in `run.json` is enough to rebuild them. */
    }
  }
  return lineups;
}

async function commandJudge(o: Options): Promise<void> {
  const dir = o.run;
  if (!dir) throw new Error("judge needs --run <the directory generate wrote>");
  const runFile = parseJsonFrom<RunFile>(await readFile(path.join(dir, "run.json"), "utf-8"), "run.json");
  const cells = parseJsonFrom<Cell[]>(await readFile(path.join(dir, "generated.json"), "utf-8"), "generated.json");
  /* `--doc` narrows the judging without re-generating: 21 codex calls at high
     effort is over an hour, and the calibration article is the one worth
     repeating three times. A slug named here that the run never generated for
     would judge an empty lineup, so the intersection is taken rather than the
     flag. */
  const generated = runFile.documents.map((d) => d.slug);
  const slugs = o.slugs.length ? generated.filter((s) => o.slugs.includes(s)) : generated;
  if (slugs.length === 0) throw new Error(`--doc named none of the documents this run generated for: ${generated.join(", ")}`);
  const docs = await loadAll({ ...o, corpusRoot: runFile.corpusRoot, slugs });
  /* **Drift between `generate` and `judge` is a different failure from drift at
     generation**, and the first version checked only the second. A re-export in
     between judges lines written against yesterday's prose using today's, while
     `run.json` still says the corpus was pinned. ⟨GPT Sol, P1-9.⟩ */
  const driftNow = docs.flatMap((d) => d.drift);
  const newDrift = driftNow.filter((line) => !runFile.corpusDrift.includes(line));
  if (newDrift.length) {
    throw new Error(
      `The corpus has changed since these lines were generated, so judging them would score yesterday's answers against today's prose:\n  - ${newDrift.join("\n  - ")}\n` +
        `Re-export to the bytes run.json names, or re-run generate.`,
    );
  }
  /* **Stub and live must not be mixed.** Live generation judged by the stub
     produces a full-looking ranking of real lines that nothing judged; stub
     generation judged by codex spends a subscription on synthetic text. Neither
     announces itself in the report, because the STUB banner reads `run.json`.
     ⟨GPT Sol, P0-5.⟩ */
  if (runFile.stub && !o.stubJudge && o.judgeKind === "codex") {
    throw new Error("this run was generated with --stub, so there is nothing worth judging: pass --stub-judge good|bad, or --judge materials.");
  }
  if (!runFile.stub && o.stubJudge) {
    throw new Error("--stub-judge on a run that spent real money would produce a ranking nothing judged, under a report with no STUB banner. Use --judge codex.");
  }
  /* And a run that did not come back in full cannot be judged into a leader —
     `separate` refuses one — so say it here, before the calls, rather than after
     an hour of them. */
  const preCoverage = coverageFor(cells, runFile.plan, runFile.stub ? "stub" : runFile.model);
  if (!preCoverage.clean) {
    console.log("! this run is not a clean bill; the report will rank but will refuse to name a leader:");
    for (const line of coverageLines(preCoverage)) console.log(line);
  }
  await mkdir(path.join(dir, "judging"), { recursive: true });

  const lineups = await writeLineups(dir, docs, cells, runFile, o.repeats);

  const judge: Judge = o.stubJudge
    ? stubJudge(o.stubJudge, lineups)
    : o.judgeKind === "codex"
      ? codexJudge({ dir: path.join(dir, "judging") })
      : materialsOnlyJudge;

  const judged: { label: string; slug: string; repeat: number; nodes: Record<string, unknown> }[] = [];
  const calibration: RankedLineup[] = [];
  const failures: string[] = [];
  for (const [label, lineup] of lineups) {
    try {
      const answer = await judge(renderPrompt(lineup), label);
      const { nodes, unknownLabels } = unblind(lineup, answer);
      if (unknownLabels.length) console.log(`  ! ${label}: ${unknownLabels.join("; ")}`);
      judged.push({ label, slug: lineup.slug, repeat: lineup.repeat, nodes });
      for (const nodeId of Object.keys(nodes)) {
        const present = questionIdsIn(lineup, nodeId);
        if (!present.some(isAnchorId)) continue;
        calibration.push({
          where: `${label}/${nodeId}`,
          ranking: (nodes[nodeId] as { questions?: { ranking: string[] } }).questions?.ranking ?? [],
          present,
        });
      }
      await writeFile(path.join(dir, "judging", `${label}.judged.json`), `${JSON.stringify(nodes, null, 2)}\n`, "utf-8");
      console.log(`  judged ${label}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      failures.push(`${label}: ${message}`);
      console.log(`  ! ${label} FAILED: ${message}`);
    }
  }

  /* Now that nothing is left to judge, the keys can be written down. */
  for (const [label, lineup] of lineups) {
    await writeFile(path.join(dir, "judging", `${label}.key.json`), `${JSON.stringify(keyFor(lineup), null, 2)}\n`, "utf-8");
  }

  const verdict = calibrationOf(calibration);
  await writeFile(
    path.join(dir, "judged.json"),
    `${JSON.stringify({ judged, calibration: verdict, failures, repeats: o.repeats, judge: o.stubJudge ? `stub-${o.stubJudge}` : o.judgeKind }, null, 2)}\n`,
    "utf-8",
  );
  console.log(`\nCalibration: ${verdict.passed ? "PASSED" : "FAILED"} over ${verdict.checked} lineup(s)`);
  for (const line of [...verdict.malformed, ...verdict.inversions, ...verdict.unranked]) console.log(`  - ${line}`);
  if (failures.length) console.log(`\n${failures.length} judging call(s) failed.`);
}

/* --------------------------------------------------------------- report --- */

type JudgedDoc = Judgement & { label: string; nodes: Record<string, { gists?: JudgedLineup; questions?: JudgedLineup; rowForm?: string }> };

interface JudgedFile {
  judged: JudgedDoc[];
  calibration: ReturnType<typeof calibrationOf>;
  failures: string[];
  repeats: number;
  /** `codex`, `materials`, `stub-good`, `stub-bad` — printed in the report, not only stored. */
  judge: string;
}

type Say = (s?: string) => void;

/**
 * **Observations, never scores** — score.ts § *Facts, not scores* has the
 * argument, and the one that matters is V3: it deliberately relaxes "not
 * yes/no", so a percentage in this table is a description of what the arm did
 * and nothing subtracts a point for it.
 */
function shapeFactsTable(runFile: RunFile, cells: readonly Cell[], say: Say): void {
  say();
  say(`## Shape facts — observations, never scores`);
  say();
  say(`| arm | questions kept | never written | dropped by the rule | invented ids | median words | ends "?" | yes/no | bracketed hint | counted hint | hint after "?" | gists with meta-narration |`);
  say(`|---|---|---|---|---|---|---|---|---|---|---|---|`);
  for (const arm of runFile.arms) {
    const mine = cells.filter((c) => c.arm === arm.name);
    const lines = mine.flatMap((c) => c.lines);
    const questions = lines.map((l) => l.question).filter((q): q is string => !!q);
    const facts = questions.map(shapeFacts);
    const gistMeta = lines.filter((l) => shapeFacts(l.gist).metaNarration.length > 0).length;
    const words = facts.map((f) => f.words).sort((a, b) => a - b);
    const median = words.length ? words[Math.floor(words.length / 2)]! : 0;
    const pct = (n: number) => (facts.length ? `${Math.round((100 * n) / facts.length)}%` : "—");
    /* **Two ways an arm loses a row without failing**, both counted here rather
       than left to be inferred from a smaller `lineups` denominator further
       down. `questionless` is the model declining to write one; `dropped` is
       `questionFor` (or V4's rule) throwing one away — the gist asked again,
       most often. Either would otherwise make a variant look fine while it was
       quietly absent from half the lineups it should have been in. */
    const questionless = mine.reduce((n, c) => n + c.questionless.length, 0);
    const dropped = lines.filter((l) => l.questionDropped !== undefined).length;
    const invented = mine.reduce((n, c) => n + c.extra.length, 0);
    say(
      `| ${arm.name} | ${questions.length} | ${questionless} | ${dropped} | ${invented} | ${median} | ` +
        `${pct(facts.filter((f) => f.endsInQuestionMark).length)} | ` +
        `${pct(facts.filter((f) => f.yesNoOpener).length)} | ${pct(facts.filter((f) => f.hasBracketedHint).length)} | ` +
        `${pct(facts.filter((f) => f.hintClaimsCount).length)} | ${pct(facts.filter((f) => f.hintAfterQuestionMark).length)} | ${gistMeta} |`,
    );
  }
}

/**
 * One ranking table, and the three things a leader has to survive.
 *
 * Reached only when the calibration gate passed. The threshold is judge
 * instability in mean-rank units; the generation floor is a *paired* per-lineup
 * figure and is printed beside the judge's own per-lineup churn, which is the
 * only thing on its scale. Both of those are GPT Sol's P0-4: taking the max of
 * two statistics on different sampling scales, and computing the generation
 * floor as a difference of means that cancels, were the two halves of one bad
 * test.
 */
function rankingSection(runFile: RunFile, judgedFile: JudgedFile, which: "questions" | "gists", clean: boolean, say: Say): void {
  const ranks = meanRanks(judgedFile.judged, which);
  const floor = generationNoiseFloor(judgedFile.judged, which);
  const instability = judgeInstability(judgedFile.judged, which);
  const threshold = separabilityThreshold(instability);
  const leaders = perRepeatLeaders(judgedFile.judged, which);
  const sep = separate(ranks, threshold, { perRepeatLeaders: leaders, coverageClean: clean });
  say();
  say(`## Ranking — ${which}`);
  say();
  say(
    `Generation noise floor (incumbent vs incumbent-repeat, PAIRED within each lineup): ` +
      (floor
        ? `${floor.paired.toFixed(2)} ranks over ${floor.lineups} lineups` +
          (floor.meanGap === null ? "" : ` — their mean ranks differ by ${floor.meanGap.toFixed(2)}, which cancels and is not the floor`)
        : "not measured"),
  );
  say(
    `Judge instability (same output, fresh shuffle): ` +
      (instability
        ? `${instability.ranks.toFixed(2)} ranks — how far an arm's MEAN rank moves between ${instability.repeats} repeats, which is the unit the gaps below are in. ` +
          `Per-lineup churn, comparable with the generation floor above and NOT the threshold: ${instability.perLineup.toFixed(2)} over ${instability.comparisons} comparisons.`
        : "not measured — fewer than two repeats"),
  );
  say(`Separability threshold: ${threshold === null ? "none, so no gap may be called real" : `${threshold.toFixed(2)} ranks`}`);
  say(`Leader in each repeat's own table: ${leaders.length ? leaders.join(", ") : "(not measurable)"}`);
  say();
  say(`| arm | mean rank | lineups | comparison |`);
  say(`|---|---|---|---|`);
  for (const r of sep.ordered) {
    const arm = runFile.arms.find((a) => a.name === r.arm);
    say(`| ${r.arm} | ${r.meanRank.toFixed(2)} | ${r.lineups} | ${arm?.comparison ?? "?"}${arm?.isolatedAgainst ? ` (one block vs \`${arm.isolatedAgainst}\`)` : ""} |`);
  }
  say();
  if (sep.separable) {
    say(`**\`${sep.ordered[0]!.arm}\` leads by more than the threshold and led every repeat.** That is a reason to render it for Greg, not to ship it.`);
  } else {
    say(`**No leader is named.** The honest output is that this screen rejected nothing among the arms above:`);
    for (const line of sep.refusedBecause) say(`- ${line}`);
  }
}

/**
 * **The axes, aggregated — because collecting them and never showing them is
 * the same as not collecting them.**
 *
 * The seven axes are asked before any preference precisely so that fidelity,
 * simplicity, leakage and the shape hint can be read on their own; until this
 * table existed the report used only `meanRanks`, so the harness could not
 * support a single one of the independent claims it was built to make. ⟨GPT Sol,
 * P1-7.⟩
 *
 * **And "before" is a request, not an enforcement.** One response carries both
 * the axes and the ranking, so the model's preference can still colour the
 * earlier fields. Splitting them into two calls is the fix and it is not built;
 * until it is, an axis that agrees with the ranking is weak evidence and an axis
 * that DISAGREES with it is the interesting one.
 */
function axesSection(judgedFile: JudgedFile, which: "questions" | "gists", say: Say): void {
  const sums = new Map<string, Map<string, { sum: number; n: number }>>();
  const words = new Map<string, Map<string, number>>();
  for (const j of judgedFile.judged) {
    for (const node of Object.values(j.nodes)) {
      for (const [arm, scores] of Object.entries(node[which]?.axes ?? {})) {
        for (const [axis, value] of Object.entries(scores)) {
          if (typeof value === "number" && Number.isFinite(value)) {
            const byAxis = sums.get(arm) ?? new Map();
            const cell = byAxis.get(axis) ?? { sum: 0, n: 0 };
            cell.sum += value;
            cell.n += 1;
            byAxis.set(axis, cell);
            sums.set(arm, byAxis);
          } else if (typeof value === "string") {
            const byValue = words.get(`${arm}/${axis}`) ?? new Map();
            byValue.set(value, (byValue.get(value) ?? 0) + 1);
            words.set(`${arm}/${axis}`, byValue);
          }
        }
      }
    }
  }
  if (sums.size === 0 && words.size === 0) return;
  const axes = [...new Set([...sums.values()].flatMap((m) => [...m.keys()]))].sort();
  say();
  say(`## Axes — ${which}, scored before any preference was asked for`);
  say();
  say(`| arm | ${axes.join(" | ")} | judgements |`);
  say(`|---|${axes.map(() => "---").join("|")}|---|`);
  for (const [arm, byAxis] of [...sums].sort((a, b) => a[0].localeCompare(b[0]))) {
    const cells = axes.map((axis) => {
      const c = byAxis.get(axis);
      return c ? (c.sum / c.n).toFixed(2) : "—";
    });
    const n = Math.max(...[...byAxis.values()].map((c) => c.n));
    say(`| ${arm} | ${cells.join(" | ")} | ${n} |`);
  }
  const wordAxes = [...words].sort(([a], [b]) => a.localeCompare(b));
  if (wordAxes.length) {
    say();
    say(`Non-numeric axes (${which}):`);
    for (const [key, tally] of wordAxes) {
      say(`- ${key}: ${[...tally].map(([v, n]) => `${v} ${n}`).join(", ")}`);
    }
  }
  say();
  say(
    `Lower is better for \`leakage\` alone. "Before" is a request made in the prompt and the schema, not something a ` +
      `text model can be forced into — an axis that AGREES with the ranking is weak evidence; one that disagrees is the interesting one.`,
  );
  say();
  say(
    `**The anchors are in this table and out of the ranking one**, deliberately: excluded from mean ranks because they are a ` +
      `gate rather than a competitor, included here because their axis scores are the diagnostic — anchor 1 should score 1 on ` +
      `fidelity, anchor 3 should score high on leakage, and a judge that gave them threes across the board was not reading.`,
  );
}

/** The plan's open outcome — gist, question, or both — tallied rather than decided. */
function rowFormSection(judgedFile: JudgedFile, say: Say): void {
  const tally = new Map<string, number>();
  for (const j of judgedFile.judged) {
    for (const node of Object.values(j.nodes)) {
      if (node.rowForm) tally.set(node.rowForm, (tally.get(node.rowForm) ?? 0) + 1);
    }
  }
  say();
  say(`## Does the row want the gist, the question, or both?`);
  say();
  say([...tally].map(([k, v]) => `${k}: ${v}`).join(" · ") || "(not asked)");
  say();
  say(
    `This is the plan's open outcome, not a decision: GPT Sol's P1-1 moved "the question replaces the gist" out of ` +
      `§ What changes, precisely and into something the eval is allowed to return.`,
  );
  say();
  say(
    `**And it is the weakest thing in this file.** The gist and the question lineups are shuffled independently, so this ` +
      `answer is about the row in the abstract and not about any ARM's gist beside its own question — it cannot see whether ` +
      `one arm's two lines complement each other, duplicate each other or disagree. Settling the rendering needs a second, ` +
      `paired lineup of whole rows, which is not built. ⟨GPT Sol, P1-8.⟩`,
  );
}

async function commandReport(o: Options): Promise<void> {
  const dir = o.run;
  if (!dir) throw new Error("report needs --run <the directory generate wrote>");
  const runFile = parseJsonFrom<RunFile>(await readFile(path.join(dir, "run.json"), "utf-8"), "run.json");
  const cells = parseJsonFrom<Cell[]>(await readFile(path.join(dir, "generated.json"), "utf-8"), "generated.json");
  const judgedFile = await readFile(path.join(dir, "judged.json"), "utf-8").then(
    (raw) => parseJsonFrom<JudgedFile>(raw, "judged.json"),
    () => null,
  );

  const out: string[] = [];
  const say = (s = "") => { out.push(s); console.log(s); };

  say(`# Socratic summaries — ${runFile.runId}${runFile.stub ? " (STUB: nothing was measured)" : ""}`);
  say();
  say(
    `Model: \`${runFile.model}\` · corpus root \`${runFile.corpusRoot}\` · depth ${runFile.depth}` +
      (judgedFile ? ` · judged by \`${judgedFile.judge}\`` : " · not judged"),
  );
  if (judgedFile?.judge.startsWith("stub")) {
    say();
    say(`**The judge was a stub.** It ranks in lineup order and reads nothing. No number below is a judgement.`);
  }
  say();
  say(`**What this eval cannot claim.**`);
  for (const line of runFile.claimLimits) say(`- ${line}`);
  if (runFile.corpusDrift.length) {
    say();
    say(`**The corpus is not the pinned bytes.** Every number below is over other bytes than the manifest names:`);
    for (const line of runFile.corpusDrift) say(`- ${line}`);
  }

  const coverage = coverageFor(cells, runFile.plan, runFile.stub ? "stub" : runFile.model);
  say();
  say(`## Coverage`);
  say();
  say("```");
  for (const line of coverageLines(coverage)) say(line);
  say("```");

  shapeFactsTable(runFile, cells, say);

  if (!judgedFile) {
    say();
    say(`## No judging pass has been run — there is nothing to rank.`);
  } else {
    say();
    say(`## Calibration — ${judgedFile.calibration.passed ? "PASSED" : "FAILED"}`);
    say();
    say(
      `Five known-bad lines (${anchors().map((a) => `#${a.n} ${a.failure}`).join("; ")}) went into the question lineup ` +
        `for \`${ANCHOR_SITE.slug}\`/\`${ANCHOR_SITE.nodeId}\`. Checked over ${judgedFile.calibration.checked} lineup(s).`,
    );
    for (const line of [...judgedFile.calibration.malformed, ...judgedFile.calibration.inversions, ...judgedFile.calibration.unranked]) say(`- ${line}`);

    if (!judgedFile.calibration.passed) {
      say();
      say(
        `**No ranking is reported.** The judge did not put every anchor below every real line, so it is measuring ` +
          `something other than the door-or-wall criterion and its ordering of the real arms says nothing. This is a result, not a failure of the run.`,
      );
    } else {
      for (const which of ["questions", "gists"] as const) {
        rankingSection(runFile, judgedFile, which, coverage.clean, say);
        axesSection(judgedFile, which, say);
      }
      rowFormSection(judgedFile, say);
    }
    if (judgedFile.failures.length) {
      say();
      say(`## ${judgedFile.failures.length} judging call(s) failed`);
      for (const f of judgedFile.failures) say(`- ${f}`);
    }
  }

  say();
  say(`## Arms needing a change to production code if they win`);
  say();
  say(runFile.armsNeedingCodeChange.length ? runFile.armsNeedingCodeChange.join(", ") : "(none)");
  say(`(\`v4\` puts the shape hint after the question mark, and \`questionFor\` used to turn that into "…? (4 arguments)?". It shipped as \`toc/7\` on 2026-09-07 and production now carries the patch — variants.md § The code change V4 needs.)`);

  await writeFile(path.join(dir, "results.md"), `${out.join("\n")}\n`, "utf-8");
  if (exitCodeFor(coverage) === 1) process.exitCode = 1;
}

/* ----------------------------------------------------------------- main --- */

async function main(): Promise<void> {
  const o = parseOptions(process.argv.slice(2));
  switch (o.command) {
    case "plan": await commandPlan(o); break;
    case "generate": await commandGenerate(o); break;
    case "judge": await commandJudge(o); break;
    case "report": await commandReport(o); break;
    default:
      throw new Error(`unknown command "${o.command}". One of: plan, generate, judge, report`);
  }
}

if (isMain(import.meta.url)) {
  loadEnvLocal();
  /* `withLedger("eval", …)`, not a bare `main()`: the generation calls go
     through `streamMessage`, which meters them, and a run with no collector open
     drops every row and warns once per call. src/cli-ledger.ts. */
  await withLedger("eval", main);
}
