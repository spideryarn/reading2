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

import Anthropic from "@anthropic-ai/sdk";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CAPABLE_MODEL, effortFor } from "./models.js";
import { MODEL_REFUSED } from "./messages.js";
import { anthropicCallFailed } from "./anthropic-call.js";
import { budgetFor, truncatedMessage } from "./token-budget.js";
import type { Arc, ArcEntry, Block, Meta, Tree, TreeNode } from "./types.js";
import { parseJsonFrom } from "./parse-json.js";
import { articleText } from "./article-prompt.js";

const PROMPT_VERSION = "arc/2";

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

/** The parts — depth-1 nodes in document order, per the tree's own child list. */
export function partsOf(tree: Tree): TreeNode[] {
  const root = tree.nodes[tree.rootId];
  if (!root) throw new Error(`rootId "${tree.rootId}" is not in nodes`);
  return root.children.map((id) => tree.nodes[id]).filter((n): n is TreeNode => !!n);
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
  return { version: PROMPT_VERSION, generator: CAPABLE_MODEL, slug, entries };
}

/**
 * Strip a stray code fence if the model wraps its JSON despite instructions.
 *
 * The parse goes through src/parse-json.ts, and the reason is that **nothing in
 * this file logs**. A step that throws is logged by src/jobs.ts with
 * `errorFields`, which keeps `message` *and* `stack` — and V8's own parse error
 * quotes the first characters of whatever it was handed. So a plain
 * `JSON.parse` here writes part of the model's writing about the article into
 * the log, from a file that never calls the logger at all. An error is a value
 * that travels, and where it is thrown is not where it is written down.
 */
function parseJson(raw: string): { arc: string[] } {
  const text = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, "").trim();
  return parseJsonFrom(text, "the arc response");
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

  /* `logLevel: "off"`, and it is a privacy setting rather than a preference. The
     SDK has a logger of its own that defaults to `console` and reads
     `ANTHROPIC_LOG` from the environment; at `debug` it prints the outgoing
     request — **which is the whole article** — and, for a non-JSON error
     response, the raw upstream body. Neither goes through Pino, so neither can
     be redacted, and `anthropicCallFailed` never sees them. One environment
     variable, set by somebody debugging something else, and every article this
     app has read is on stdout. See docs/project/logging.md. */
  const client = new Anthropic({ logLevel: "off" });
  /* The request itself, wrapped: a 429/401/etc from the SDK is not caught
     anywhere upstream of here, and the installed SDK builds `Error.message`
     from the upstream error body — the one place it can echo back part of
     what we sent, which is the whole article. See src/anthropic-call.ts. */
  let message: Anthropic.Message;
  try {
    const stream = client.messages.stream({
      model: CAPABLE_MODEL,
      max_tokens: maxTokens,
      thinking: { type: "adaptive" },
      output_config: { effort: effortFor("arc") },
      /* Article first, instructions second — the cache prefix starts at the top of
         the request, so anything stage-specific ahead of the article stops two
         stages ever matching. docs/plans/prompt-caching.md. */
      system: [
        {
          type: "text" as const,
          text: articleText(meta, blocks),
          ...(opts.cacheArticle ? { cache_control: { type: "ephemeral" as const } } : {}),
        },
        { type: "text" as const, text: SYSTEM },
      ],
      messages: [{ role: "user", content: renderPrompt(tree) }],
    }, { signal: opts.signal });

    if (opts.onProgress) {
      const report = opts.onProgress;
      let chars = 0;
      let last = 0;
      stream.on("text", (delta) => {
        chars += delta.length;
        const now = Date.now();
        if (now - last < 500) return;
        last = now;
        report(`${parts.length} parts, ${Math.round(chars / 1000)}k characters so far`);
      });
    }

    message = await stream.finalMessage();
  } catch (err) {
    throw anthropicCallFailed(err);
  }
  if (message.stop_reason === "refusal") {
    /* `stop_details` is deliberately neither thrown nor logged — it is the
       provider's own words about a request that carried the whole article,
       and this error is copied onto the job and shown on the progress card.
       See MODEL_REFUSED in src/messages.ts. */
    throw new Error(MODEL_REFUSED.message);
  }
  if (message.stop_reason === "max_tokens") {
    throw new Error(
      truncatedMessage("arc", maxTokens, answerTokens, {
        outputTokens: message.usage.output_tokens,
        answerChars: message.content
          .filter((b): b is Anthropic.TextBlock => b.type === "text")
          .reduce((n, b) => n + b.text.length, 0),
      }),
    );
  }

  const raw = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");

  const arc = buildArc(parseJson(raw).arc, tree, tree.slug);
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
if (isMain) void main();
