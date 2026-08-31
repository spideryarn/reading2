/**
 * Pipeline stage 5b — the **arc**: one article-level sentence per part, saying
 * where the argument stands there. See docs/project/granularity-zoom.md#the-arc.
 *
 *   npm run arc -- data/noema-mythology-of-conscious-ai
 *
 * Why this exists. The L0 column used to render the root node, and a tree has
 * one root, so the column was a single cell: a constant along an axis whose
 * whole meaning is "this changes as you move down the article". It cost a
 * column's width and told you nothing you hadn't read in the masthead.
 *
 * The arc is the one kind of content that is genuinely *article-level* and
 * still varies vertically. An L1 gist says what this part says, in the part's
 * own terms. An arc sentence says what the piece has established by the time
 * you reach it and what it still owes you — a claim about the whole, written
 * from a position in it.
 *
 * **A separate artefact, not a field on the tree.** `tree.json` is stage 4's
 * (architecture.md#stage-ownership) and a re-run of `npm run toc` rewrites it
 * wholesale, which would silently drop anything we had merged in. So the arc
 * lives in its own `arc.json` and is joined back on at load time — by block
 * range, never by node id, because node ids are positional and a re-run
 * renumbers them. An entry whose range no longer matches a part is *dropped*
 * rather than attached to whichever part now sits at that index: a stale arc
 * line beside the wrong part is a lie the reader has no way to detect, and an
 * empty cell is one they do.
 */

import type Anthropic from "@anthropic-ai/sdk";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { streamMessage, wasRefused } from "./messages-stream.js";
import { CAPABLE_MODEL, effortFor } from "./models.js";
import { loadEnvLocal } from "./env.js";
import { MODEL_REFUSED } from "./messages.js";
import { anthropicCallFailed } from "./anthropic-call.js";
import { stageFailure } from "./job-failure.js";
import { budgetFor, truncationFailure } from "./token-budget.js";
import type { Arc, ArcEntry, Block, Meta, Tree, TreeNode } from "./types.js";
import { parseJsonFrom, stripFence } from "./parse-json.js";
import { articleText } from "./article-prompt.js";
import { isBodyEvidence } from "./block-policy.js";
import { isSupplementNode } from "./supplement.js";
import { withLedger } from "./cli-ledger.js";
import { articleFingerprint, type BlockFingerprint, type MetaFingerprint } from "./source-hash.js";

/**
 * Exported since 2026-08-29 so that the pipeline's `stamp` can compare against it
 * without writing the string out a second time. Two copies of a prompt version are
 * free to drift, and the drift shows up as an artefact that never regenerates —
 * which is the reason `tweets` and `glossary` export theirs as well.
 */
export const PROMPT_VERSION = "arc/2";

const SYSTEM = `You are writing the leftmost, coarsest column of a reading view for a long
article. The reader sees, side by side: your column, then a one-sentence gist
per PART, then one per SECTION, then the full text.

Your column is the ARC. One sentence per part, in order. It is the only column
written from the point of view of the WHOLE PIECE.

WHAT AN ARC SENTENCE IS

Where the argument stands as this part opens: what the piece has established so
far, and what it still owes the reader. It is a claim about the whole article,
made from a position inside it.

  part gist (the next column): "Feeling is metabolic, not computational."
  arc  (yours):                "Intelligence has been cut loose from
                                consciousness; what remains is to say what
                                consciousness is made of."

RULES

- Exactly ONE sentence per part. Same number of sentences as there are parts,
  in the same order. No numbering, no part titles.
- NEVER restate the part's own gist. That sentence is already on screen an inch
  to the right, and two columns saying the same thing is why this column exists
  at all. If your sentence would still make sense with the rest of the article
  deleted, it is a gist and it is wrong.
- Every sentence must be RELATIONAL: it names something settled earlier, or
  something still unresolved, or the turn between them. Words like "having",
  "with", "what remains", "still", "now that", "before" earn their place here.
- NEVER make the article the subject. No "the piece", "the article", "the
  argument", "the essay", "the author", "this section". Those words spend a
  clause saying that you are summarising something, which the reader can see.
  Write the state of the argument directly, in the article's own terms.
    bad:  "The piece opens by asking whether machines could be conscious."
    good: "Whether machines could be conscious is still open, and their moral
           status turns on the answer."
    bad:  "Having shown brains are not Turing machines, the argument turns to
           the substrate."
    good: "Brains are not Turing machines; what is left is to say what the
           substrate must be."
- The first part's sentence says what is at stake and unsettled. The last
  part's says what has been settled and what deliberately has not.
- Use the author's own distinctive vocabulary. Those words are the reader's
  handholds.
- No empty meta-narration: never "this section explores", "the author then
  turns to", "we are told that", "then", "next", "goes on to". Naming the state
  of the argument is the job; narrating the prose is not.
- Every word must carry content. Cut any opening clause that only announces
  that a summary is coming.
- Say what the ARTICLE argues, not what a reader should feel. No advice.

OUTPUT

JSON only, no prose, no code fence:

{"arc": ["...", "...", ...]}

Exactly one string per part, in order.`;

/**
 * The parts — depth-1 nodes in document order, per the tree's own child list.
 *
 * **A supplement is not a part.** The apparatus is a depth-one child of the
 * root like every part is (src/supplement.ts), and excluding it here is what
 * keeps four separate things right at once, because this one function is where
 * "the parts of the argument" is defined:
 *
 *  - `buildArc` **throws** on a parts/sentences length mismatch, so a
 *    supplement counted as a part would fail the arc stage outright on every
 *    article with endnotes — the loud failure, and the one that made this
 *    obvious;
 *  - `renderPrompt` below, and the skeletons in src/glossary.ts, src/ideas.ts
 *    and src/tweets.ts, would each show a model a part called "Notes" with no
 *    gist and invite it to write about the bibliography;
 *  - the step marker would read "3 / 9" where the argument has seven parts,
 *    which is the one place the structure states a count out loud.
 *
 * The client's own numbering is a separate copy of this rule and cannot import
 * it — `buildArcColumn` in src/web/tree.ts numbers the cells it is drawing, not
 * the tree — so both are held by tests.
 */
export function partsOf(tree: Tree): TreeNode[] {
  const root = tree.nodes[tree.rootId];
  /* `bug`, so the job card does not offer a Retry that cannot work. The tree
     comes off disk from a `toc` step that already finished, and Retry skips
     every step that finished — so a second attempt reads the identical
     tree.json and fails in the same line. A tree that names a root it does not
     contain is stage 4 having written something malformed, which is a defect
     here rather than anything the reader can act on. src/job-failure.ts. */
  if (!root) throw stageFailure("bug", `rootId "${tree.rootId}" is not in nodes`);
  return root.children
    .map((id) => tree.nodes[id])
    .filter((n): n is TreeNode => !!n && !isSupplementNode(n));
}

/**
 * The article as a skeleton plus its full text.
 *
 * Both, deliberately. The skeleton is what makes relational writing possible —
 * you cannot say "what remains" without seeing what comes after — and the full
 * text is what keeps the sentences in the author's own words rather than in a
 * summary of a summary.
 */
function renderPrompt(tree: Tree): string {
  const parts = partsOf(tree);
  const skeleton = parts
    .map((p, i) => {
      const subs = p.children
        .map((id) => tree.nodes[id])
        .filter((c): c is TreeNode => !!c && !!c.gist)
        .map((c) => `      - ${c.title}: ${c.gist}`)
        .join("\n");
      return `PART ${i + 1}: ${p.title}\n  gist: ${p.gist ?? "(none)"}\n${subs}`;
    })
    .join("\n\n");

  /* The full text is no longer here — it moved to a cached `system` block, so
     that this stage, the thread and the glossary all put the *same bytes* in
     front of their own instructions and can share one cache entry for an
     article. What is left is the part that is this stage's own. */
  return `The article has ${parts.length} parts. Write ${parts.length} arc sentences.

=== STRUCTURE ===

${skeleton}`;
}

/**
 * Pair the model's sentences with the parts they belong to.
 *
 * A length mismatch throws rather than zipping as far as it can. Zipping would
 * put every sentence after the missing one against the wrong part, and each of
 * those cells would still look perfectly plausible — the failure would only be
 * visible to someone who read the article closely enough not to need the
 * column.
 */
export function buildArc(
  sentences: string[],
  tree: Tree,
  slug: string,
  sourceHash: string,
): Arc {
  const parts = partsOf(tree);
  if (sentences.length !== parts.length) {
    throw new Error(
      `Model returned ${sentences.length} arc sentences for ${parts.length} parts. ` +
        `Refusing to guess which part each belongs to.`,
    );
  }
  const entries: ArcEntry[] = parts.map((p, i) => ({
    range: p.range,
    // In range because the lengths were checked equal immediately above; that
    // check is the whole reason this function refuses to guess.
    text: sentences[i]!.trim(),
  }));
  return { version: PROMPT_VERSION, generator: CAPABLE_MODEL, slug, entries, sourceHash };
}

/**
 * **What this arc was written from: the blocks, the tree, and the three metadata
 * fields the prompt actually carries.**
 *
 * The arc had no input fingerprint at all until 2026-08-29. Its freshness was its
 * *position* — it sat in `DEFAULT_INGEST_STEPS` behind `toc`, so `cascadeForce`
 * swept it whenever an earlier step was forced (src/pipeline.ts §
 * `FORCE_ONLY_WHEN_NAMED`, which says so and adds "give it a freshness check of its
 * own and it belongs here too"). That was never quite true: `cascadeForce` only
 * names steps already in the job, so a forced `steps: ["toc"]` has never reached
 * `arc`, and the resulting stale arc loses entries **in silence** — the join in
 * `buildArcColumn` is by exact block range, and an entry matching no node is simply
 * not drawn.
 *
 * **Blocks, tree and metadata — and the definition now lives in
 * src/source-hash.ts.** This was the first stage to get all three right, and on
 * 2026-08-31 the other five article-reading stages were completed against it, so
 * the body moved to `articleFingerprint` where all six can share one definition
 * rather than six that are free to drift. The canonical string is unchanged, so
 * every `arc.json` already on a shelf keeps its fingerprint. Why each third is
 * there — and the one head line it knowingly does not cover — is written up
 * there; this name stays because it is what the arc's own callers ask for.
 *
 * A *missing* `meta.json` is a distinct input rather than an error, because
 * `generateArc` tolerates one.
 *
 * GPT Sol raised the metadata half on 2026-08-29. **The reason given at the time
 * was wrong** and is corrected here: it cited the reading view's rename, which is
 * a shelf override (`shelf.json`, `articles.title_override`) that no generator
 * reads. What really moves this head is a re-extraction — the title, byline and
 * site are stage 2's, and they change when the page does.
 * docs/plans/defer-arc-and-rename-hierarchy.md § 2.1.
 */
export function inputFingerprint(
  blocks: readonly BlockFingerprint[],
  tree: Tree,
  meta: MetaFingerprint | null,
): string {
  return articleFingerprint(blocks, tree, meta);
}

/**
 * Is this arc still about this article?
 *
 * Three questions, and the artefact already answered two of them before this
 * function existed — `version` and `generator` have been on `Arc` all along, and
 * nothing compared them. The third is the new one.
 *
 * **An arc with no `sourceHash` is stale, not current.** Every `arc.json` written
 * before 2026-08-29 is in that state, and reading absent as current is precisely how
 * the original hole survived: "we cannot tell" and "we checked and it matches" are
 * different answers, and only one of them justifies skipping a model call.
 */
export function isStale(
  arc: Arc,
  blocks: readonly BlockFingerprint[],
  tree: Tree,
  meta: MetaFingerprint | null,
): boolean {
  if (!arc.sourceHash) return true;
  if (arc.version !== PROMPT_VERSION) return true;
  if (arc.generator !== CAPABLE_MODEL) return true;
  return arc.sourceHash !== inputFingerprint(blocks, tree, meta);
}

/**
 * Read the model's answer, fence and all.
 *
 * `stripFence` then `parseJsonFrom`, never a bare `JSON.parse` — src/parse-json.ts
 * § `stripFence` has the reasoning, and the short version is that nothing in this
 * file logs and that is not enough, because a thrown error is logged where it is
 * caught and V8 quotes the input in it.
 */
function parseJson(raw: string): { arc: string[] } {
  return parseJsonFrom(stripFence(raw), "the arc response");
}

export interface ArcRun {
  arc: Arc;
  outFile: string;
  /** Which model wrote it. `CAPABLE_MODEL` is private here, and the queue logs what an arc cost. */
  model: string;
  parts: TreeNode[];
  blocks: number;
  inputTokens: number;
  outputTokens: number;
  /* What the cache did on this call. Reported next to the token counts because
     a cache that has silently stopped hitting is indistinguishable from one that
     is working — same answer, no error, a bigger bill.
     docs/reusable/silent-success.md. */
  cacheReadTokens: number;
  cacheWriteTokens: number;
  elapsedMs: number;
}

/**
 * Stage 5b over a data directory: one model call, then `arc.json` beside the
 * tree it was written against.
 *
 * Exported because two callers run this stage and they must not drift —
 * `main()` below, and the ingest queue in the server process (src/pipeline.ts).
 */
export async function generateArc(opts: {
  dir: string;
  onProgress?: (detail: string) => void;
  /** Cancel the call. The queue passes its job's signal — src/jobs.ts. */
  signal?: AbortSignal;
  /**
   * Mark the article as a cache breakpoint.
   *
   * **Off by default, because a cache write costs 1.25x and a prefix nobody
   * reads never earns it back.** Each of these stages makes one call per run, so
   * none of them caches anything for itself; the entry only pays off if a stage
   * in the same group (src/models.ts § STAGE_EFFORT) runs behind it, inside the
   * 5-minute TTL. Ordinary ingest stops at `arc` — tweets, glossary and summary
   * are things a reader asks for later — so on the normal path that reader never
   * arrives, and marking unconditionally was a premium paid on every article
   * against a read that does not come. src/jobs.ts sets this from the steps the
   * job actually has left. Raised by GPT Sol's review, 2026-08-26; see
   * docs/project/prompt-caching.md.
   */
  cacheArticle?: boolean;

}): Promise<ArcRun> {
  /* `parseJsonFrom`, not `JSON.parse`: blocks.json *is* the article, and V8's
     own parse error quotes the first characters of what it was handed. Nothing
     in this file logs, but a step that throws is logged by src/jobs.ts with
     `errorFields`, which keeps `message` and `stack`. src/parse-json.ts. */
  const { blocks } = parseJsonFrom<{ blocks: Block[] }>(
    await readFile(path.join(opts.dir, "blocks.json"), "utf-8"),
    "blocks.json",
  );
  const tree = parseJsonFrom<Tree>(
    await readFile(path.join(opts.dir, "tree.json"), "utf-8"),
    "tree.json",
  );
  /* Loaded only so the cached article block reads the same here as it does in
     the thread and the glossary — the three share one cache entry per article,
     and a head that differs by a line is a prefix that does not match. Optional,
     like it is there: a missing meta.json is not worth failing the stage over,
     and its absence is the same absence for all three. */
  const meta = await readFile(path.join(opts.dir, "meta.json"), "utf-8")
    .then((raw) => JSON.parse(raw) as Meta)
    .catch(() => null);
  /* **The argument, not the apparatus.** Applied here at the call site rather
     than inside `articleText`/`articleWithIds`, and that is the whole care in
     this line: the two builders look like the seam between automatic and asked
     work and they are not — `ideas` is automatic and sends ids, while
     `explain`, `search` and `converse` are *asked* and send ids too. Filtering
     inside the builders would be right three times and would silently leave
     `ideas` summarising the bibliography. src/block-policy.ts. */
  const evidence = blocks.filter(isBodyEvidence);
  const parts = partsOf(tree);
  const started = Date.now();

  /* One sentence per part, so the answer is small and stays small — a dozen
     parts is a few hundred tokens. What is not small is the article this stage
     reads to write them, and the model's reasoning over it comes out of the
     same allowance as the answer. That is what the 16,000 typed here before
     could not survive: not a long arc, a long article. See src/token-budget.ts,
     and docs/postmortems/toc-max-tokens.md for the run that found it. */
  const answerTokens = 300 + parts.length * 80;
  const maxTokens = budgetFor("arc", answerTokens);

  /* The request itself, wrapped: a 429/401/etc from the SDK is not caught
     anywhere upstream of here, and the installed SDK builds `Error.message`
     from the upstream error body — the one place it can echo back part of
     what we sent, which is the whole article. See src/anthropic-call.ts.

     The client is built by `streamMessage`, which also sets `logLevel: "off"`
     — a privacy setting rather than a preference. The SDK has a logger of its
     own that defaults to `console` and reads `ANTHROPIC_LOG` from the
     environment; at `debug` it prints the outgoing request — **which is the
     whole article** — and, for a non-JSON error response, the raw upstream
     body. Neither goes through Pino, so neither can be redacted, and
     `anthropicCallFailed` never sees them. See docs/project/logging.md. */
  let message: Anthropic.Message;
  try {
    const call = streamMessage("arc", {
      max_tokens: maxTokens,
      thinking: { type: "adaptive" },
      output_config: { effort: effortFor("arc") },
      /* Article first, instructions second — the cache prefix starts at the top of
         the request, so anything stage-specific ahead of the article stops two
         stages ever matching. docs/plans/prompt-caching.md. */
      system: [
        {
          type: "text" as const,
          text: articleText(meta, evidence),
          ...(opts.cacheArticle ? { cache_control: { type: "ephemeral" as const } } : {}),
        },
        { type: "text" as const, text: SYSTEM },
      ],
      messages: [{ role: "user", content: renderPrompt(tree) }],
    }, { ...(opts.signal ? { signal: opts.signal } : {}) });

    if (opts.onProgress) {
      const report = opts.onProgress;
      let chars = 0;
      let last = 0;
      call.onText((delta) => {
        chars += delta.length;
        const now = Date.now();
        if (now - last < 500) return;
        last = now;
        report(`${parts.length} parts, ${Math.round(chars / 1000)}k characters so far`);
      });
    }

    /* `call.finalMessage()`, never `call.stream.finalMessage()` — the wrapper is
       what records what this call cost. The stream's own method works and
       records nothing. See src/messages-stream.ts. */
    message = await call.finalMessage();
  } catch (err) {
    throw anthropicCallFailed(err);
  }
  if (wasRefused(message)) {
    /* `stop_details` is deliberately neither thrown nor logged — it is the
       provider's own words about a request that carried the whole article,
       and this error is copied onto the job and shown on the progress card.
       See MODEL_REFUSED in src/messages.ts. */
    throw new Error(MODEL_REFUSED.message);
  }
  if (message.stop_reason === "max_tokens") {
    throw truncationFailure("arc", maxTokens, answerTokens, {
      outputTokens: message.usage.output_tokens,
      answerChars: message.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .reduce((n, b) => n + b.text.length, 0),
    });
  }

  const raw = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");

  const arc = buildArc(parseJson(raw).arc, tree, tree.slug, inputFingerprint(blocks, tree, meta));
  const outFile = path.join(opts.dir, "arc.json");
  await writeFile(outFile, JSON.stringify(arc, null, 2), "utf-8");

  return {
    arc,
    outFile,
    model: CAPABLE_MODEL,
    parts,
    blocks: blocks.length,
    inputTokens: message.usage.input_tokens,
    outputTokens: message.usage.output_tokens,
    cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
    cacheWriteTokens: message.usage.cache_creation_input_tokens ?? 0,
    elapsedMs: Date.now() - started,
  };
}

async function main(): Promise<void> {
  const dir = process.argv[2];
  if (!dir) {
    console.error("Usage: tsx src/arc.ts <dir with blocks.json + tree.json>");
    process.exit(1);
  }
  // Before the call, not after. This is the only thing on screen for the two
  // minutes the model takes, and printing it afterwards made `npm run arc` look
  // hung for the whole request.
  /* At the program's edge, not inside the gateway — see `messagesClient` in
     src/messages-stream.ts for the test that proved the difference. Without it
     this command answers `[ai-not-set-up]` on a machine where the key is right
     there in `.env.local`. */
  loadEnvLocal();
  console.log(`Writing the arc with ${CAPABLE_MODEL}\u2026`);
  const run = await generateArc({
    dir,
    onProgress: (detail) => process.stdout.write(`\r  ${detail}          `),
  });

  console.log(`\n${run.parts.length} parts, ${run.blocks} blocks → ${CAPABLE_MODEL}`);
  console.log(`\nTokens:    ${run.inputTokens} in, ${run.outputTokens} out`);
  console.log(`Elapsed:   ${(run.elapsedMs / 1000).toFixed(1)}s`);
  console.log(`Wrote:     ${path.resolve(run.outFile)}\n`);
  run.arc.entries.forEach((e, i) => {
    console.log(`${String(i + 1).padStart(2)}. ${run.parts[i]?.title ?? ""}\n    ${e.text}\n`);
  });
}

/* Compared as resolved paths, not by suffix. `import.meta.url.endsWith(basename)`
   also matches when a *different* entry file with the same basename imports this
   module — `scripts/arc.ts` importing `src/arc.ts` would run the CLI as a side
   effect of the import, which is the one thing this guard exists to prevent. */
const isMain =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) void withLedger("cli", main);
