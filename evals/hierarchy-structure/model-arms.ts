/**
 * The executor for the arms that spend money.
 *
 * **The prompt is production's own**: `structureRequest` in src/hierarchy.ts is the
 * one assembly point, called by `generateHierarchy` itself, so the incumbent arm's
 * bytes cannot drift from what ships — parity by construction, pinned (and
 * seen red under perturbation) by tests/hierarchy-structure-request-parity.test.ts.
 * The answer comes back through the pipeline's own `buildTree` +
 * `appendSupplement` + `assertTreeSound`, so an arm is judged on the
 * pipeline's rules, not this file's.
 *
 * **The transports are declared bypasses** — `hierarchy-structure-messages` and
 * `hierarchy-structure-chat` in src/spend-declarations.ts name this file — because
 * the arms vary model and effort per call and both seams own those on purpose.
 * Every request goes through `withDeclaredExternalCall`, which refuses to run
 * without an open ledger, and `declaredFetch`, which refuses to run outside a
 * declaration; `maxRetries: 0` so one logical call is one billed attempt.
 *
 * **A paid call that cannot account for itself fails the run**
 * (`assertCallAccounted`): tokens must arrive and a cost figure must arrive
 * with them, in-band — the Messages wire streams so the raw events' `cost`
 * can be read exactly as meterStream reads it, and the chat wire asks with
 * `usage: {include: true}`. After the run, verify-costs.ts reconciles every
 * stored generation id against OpenRouter's generation endpoint — the
 * provider's own number — and a run is not quotable until it passes.
 *
 * **Nothing here has made a live call yet** (the paid hold stands), so two
 * wire facts are flagged rather than asserted, to be verified on the first
 * calibration call: whether the Skin's raw-event `message.id` is the id the
 * generation endpoint answers to, and Luna's treatment of `max_tokens` vs
 * `max_completion_tokens` (both are sent; providers ignore unknowns silently).
 *
 * The `waves` and `cheap-then-revise` strategies are governed by one rule
 * (the team lead's, 2026-08-30): hold constant everything the arm is not
 * about. Both reuse production's SYSTEM verbatim and append a scoped
 * addendum; every delta is documented in the arm's own `deltas` declaration
 * (arms.ts), so a reader of the results knows exactly what varied.
 */

import Anthropic from "@anthropic-ai/sdk";
import { declaredFetch, withDeclaredExternalCall } from "../declared-spend.js";
import { isStructural } from "../../src/block-policy.js";
import { MESSAGES_PROVIDER, wasRefused } from "../../src/messages-stream.js";
import { parseJsonFrom, stripFence } from "../../src/parse-json.js";
import { appendSupplement, splitBlocks } from "../../src/supplement.js";
import { buildTree, structureRequest, type BuildReport, type ModelNode } from "../../src/hierarchy.js";
import { assertTreeSound } from "../../src/tree-invariants.js";
import type { Block, Tree, TreeNode } from "../../src/types.js";
import type { ArmSpec, CallSpec } from "./arms.js";
import { buildHeadingTree } from "../../src/heading-tree.js";

/** What one paid call reports back, for the results file and the noise floor. */
export interface CallStats {
  ms: number;
  inputTokens: number | null;
  outputTokens: number | null;
  reasoningTokens: number | null;
  /** The response id, which is what OpenRouter's generation endpoint is asked about. */
  generationId: string | null;
  /** What the response's own usage said the call cost, in USD. */
  costUsd: number | null;
  /** The generation endpoint's answer for the same call — the provider's own number. */
  providerCostUsd: number | null;
}

/**
 * **A paid call that cannot account for itself fails the run.** The riskiest
 * seam in this executor is the observer mapping — an openrouter-account
 * declaration expects OpenRouter-shaped usage while the Messages wire answers
 * in Anthropic's shape — and the failure mode of getting it wrong is a cost
 * that lands as zero, silently, after which the results file reports a free
 * arm that was not free and somebody quotes it in three months
 * (docs/reusable/silent-success.md). So the rule is enforced per call, not
 * checked once: tokens must have arrived, at least one cost source must have
 * answered, and when both answered they must agree — a >10% gap means one of
 * them is about a different call.
 */
export function assertCallAccounted(stats: CallStats, label: string): void {
  if (stats.inputTokens === null || stats.outputTokens === null) {
    throw new Error(
      `${label}: the call returned no token usage. It cost money and reported nothing — ` +
        `the observer mapping is broken, and scoring would record a free arm that was not free.`,
    );
  }
  if (stats.costUsd === null && stats.providerCostUsd === null) {
    throw new Error(
      `${label}: no cost from the response's usage AND none from the generation endpoint ` +
        `(id ${stats.generationId ?? "missing"}). A paid arm must not score as free — ` +
        `fix the accounting before re-running.`,
    );
  }
  if (stats.costUsd !== null && stats.providerCostUsd !== null) {
    /* 10% is a JUDGEMENT CALL, not a discovered constant, and here is the
       judgement: the failures this check exists for — a zero, a mapping that
       dropped the field, a figure about a different call — miss by orders of
       magnitude or by everything, while legitimate drift between the in-band
       figure and the generation record (rounding on a sub-cent call, billing
       lag, a cache-pricing detail settling) stays in single-digit percent. A
       1% band would false-alarm on rounding noise for the smallest calls;
       anything wide enough to pass a halved cost would defeat the point. If
       the band ever needs moving, move it in the open — fix the id or the
       mapping, never the threshold, when the verifier cannot find a record. */
    const gap = Math.abs(stats.costUsd - stats.providerCostUsd) / Math.max(stats.providerCostUsd, 1e-9);
    if (gap > 0.1) {
      throw new Error(
        `${label}: usage.cost ($${stats.costUsd}) and the generation endpoint ` +
          `($${stats.providerCostUsd}) disagree by ${(gap * 100).toFixed(0)}% — one of them ` +
          `describes a different call, and neither can be trusted into a results file.`,
      );
    }
  }
}

/* `providerCostUsd` is NOT fetched here. The scan (tests/no-undeclared-spend.
   test.ts) forbids a raw fetch in a declared file — a metered declaration
   covers only what declaredFetch guards, and that rule is right. The
   generation-endpoint reconciliation is therefore its own GET-only step,
   evals/hierarchy-structure/verify-costs.ts, run against a finished run.json; a run
   is not quotable until it passes. In-process, `costUsd` comes in-band:
   OpenRouter puts `cost` in the raw stream events on the Messages wire — the
   fact src/messages-stream.ts § meterStream is built on, pinned by
   tests/messages-stream.test.ts — and in `usage` on chat/completions when
   `usage: {include: true}` is sent. */

export interface ModelArmRun {
  tree: Tree;
  calls: CallStats[];
  /**
   * What the pipeline mended in this arm's answer on the way to a tree — a
   * one-block partition slip snapped shut, a `sourceHeading` claim dropped.
   * **Recorded rather than merely permitted**: these are the two failure
   * families this eval was built to count, and since src/hierarchy.ts started
   * repairing them an arm that makes either mistake comes back `ok`. Without
   * this field the throw rate would have quietly stopped meaning what
   * evals/README.md says it means.
   */
  built: BuildReport;
}

/**
 * **A throw with the bill attached.** Roughly one structure call in five
 * returns a tree whose children do not tile (measured on HEAD, 2026-08-30 —
 * the postmortem agent's finding, reproduced by this eval's own fourth
 * calibration call), and "produced nothing" is a legitimate outcome of the
 * recipe, not an accident to retry past: a calibration that retried and
 * measured the survivors would understate the floor by a selection effect,
 * and the wasted calls belong on the arm's cost and latency. So an executor
 * failure after money was spent carries the completed calls' stats out with
 * it, and the runner records the cell as `outcome: "threw"` and continues.
 */
export class ArmFailure extends Error {
  readonly calls: CallStats[];
  /**
   * **What the builder had already mended before it threw**, when there was a
   * builder in the picture at all.
   *
   * `buildTree` fills its report in on the way down, so an answer that mended a
   * boundary at depth one and *then* hit an invented id at depth three has both
   * facts to tell — and until 2026-08-31 the failure carried only the second,
   * so the repair figures for a refused answer went nowhere. Production's own
   * catch preserves them for exactly this reason
   * (src/hierarchy.ts § `generateHierarchy`); the eval was the half that did
   * not. GPT Sol's review of the tiling change, finding 5.
   */
  readonly built: BuildReport | undefined;
  constructor(message: string, calls: CallStats[], built?: BuildReport) {
    super(message);
    this.calls = calls;
    this.built = built;
  }
}

/* ------------------------------------------------------------- the seams -- */


/** The one Messages-wire request this eval makes. Body is Anthropic's Messages shape. */
export type MessagesSend = (req: {
  call: CallSpec;
  system: string;
  user: string;
  maxTokens: number;
}) => Promise<{ raw: string; stats: CallStats }>;

/** The one chat/completions request this eval makes. */
export type ChatSend = MessagesSend;

function apiKey(): string {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) {
    throw new Error(
      "OPENROUTER_API_KEY is not set. The runner loads .env.local at its own edge; " +
        "nothing deeper reads credentials (src/messages-stream.ts § loadEnvLocal).",
    );
  }
  return key;
}

/**
 * The Messages wire, through OpenRouter's Anthropic-compatible Skin — the same
 * endpoint, provider pin and `require_parameters` production uses
 * (`MESSAGES_PROVIDER`, src/messages-stream.ts), with only model and effort
 * varying per arm. Non-streaming, because nobody watches an eval.
 */
export const sendMessages: MessagesSend = async ({ call, system, user, maxTokens }) => {
  const client = new Anthropic({
    baseURL: "https://openrouter.ai/api",
    apiKey: apiKey(),
    authToken: apiKey(),
    logLevel: "off",
    /* One logical call is one billed attempt, or the spend row understates —
       the same reason streamMessage sets it (src/messages-stream.ts). */
    maxRetries: 0,
    fetch: declaredFetch,
  });
  const startedAt = Date.now();
  return withDeclaredExternalCall("hierarchy-structure-messages", { model: call.model }, async ({ observe }) => {
    /* Streamed, not for anybody watching — for the COST. `finalMessage()`'s
       merge drops the `cost` field the Skin puts in the raw `message_delta`
       usage (src/messages-stream.ts § the three things that fail silently
       here), so the raw events are subscribed exactly as meterStream does;
       tests/messages-stream.test.ts is what pins that the field arrives. */
    let streamCostUsd: number | null = null;
    let streamGenerationId: string | null = null;
    const stream = client.messages.stream({
      model: call.model,
      max_tokens: maxTokens,
      thinking: { type: "adaptive" },
      output_config: { effort: call.effort },
      system,
      messages: [{ role: "user", content: user }],
      provider: MESSAGES_PROVIDER,
    } as unknown as Anthropic.MessageStreamParams);
    stream.on("streamEvent", (event) => {
      const raw = event as unknown as {
        message?: { id?: string };
        usage?: { cost?: unknown };
      };
      if (typeof raw.usage?.cost === "number") streamCostUsd = raw.usage.cost;
      if (raw.message?.id) streamGenerationId = raw.message.id;
    });
    const message = await stream.finalMessage();

    const u = (message.usage ?? {}) as unknown as {
      input_tokens?: number | null;
      output_tokens?: number | null;
      output_tokens_details?: { thinking_tokens?: number | null } | null;
    };
    /* **`messagesViaOpenRouter`, not `openRouter`** — OpenRouter's settled cost
       *and* the Anthropic-shaped usage, which is what this wire answers in. It
       was `openRouter` until 2026-08-31, and that observer's body shape has
       nowhere to put a cache split, a thinking count, a service tier or an
       inference geography: the ledger row carried the right money and had
       quietly stopped explaining it. GPT Sol; evals/declared-spend.ts §
       `Observer`. Nothing about the request changed. */
    observe.messagesViaOpenRouter(message, {
      costUsd: streamCostUsd,
      upstream: (message as unknown as { provider?: string | null }).provider ?? null,
    });

    if (wasRefused(message)) throw new Error("the model refused the structure request");
    if (message.stop_reason === "max_tokens") {
      throw new Error(
        `truncated at max_tokens=${maxTokens} (${message.usage.output_tokens} output tokens) — ` +
          `the answer cannot be scored`,
      );
    }
    const raw = message.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    const stats: CallStats = {
      ms: Date.now() - startedAt,
      inputTokens: u.input_tokens ?? null,
      outputTokens: u.output_tokens ?? null,
      reasoningTokens: u.output_tokens_details?.thinking_tokens ?? null,
      /* The raw event's id, like meterStream's generationId — with the merged
         message's id as the fallback. verify-costs.ts asks the generation
         endpoint about it after the run. */
      generationId: streamGenerationId ?? message.id ?? null,
      costUsd: streamCostUsd,
      providerCostUsd: null, // verify-costs.ts fills this from the provider's record
    };
    assertCallAccounted(stats, `messages wire, ${call.model}`);
    return { raw, stats };
  });
};

/**
 * chat/completions, for the models the Messages wire cannot reach. Effort maps
 * onto OpenRouter's `reasoning.effort` (high|medium|low are all valid there).
 * `max_tokens` AND `max_completion_tokens` are both sent: Luna advertises the
 * second, providers ignore parameters they do not take silently
 * (src/models.ts § the completion ceilings), and a truncated answer is caught
 * below by `finish_reason` rather than trusted to the parameter.
 */
export const sendChat: ChatSend = async ({ call, system, user, maxTokens }) => {
  const key = apiKey();
  const startedAt = Date.now();
  return withDeclaredExternalCall("hierarchy-structure-chat", { model: call.model }, async ({ observe }) => {
    const res = await declaredFetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: call.model,
        reasoning: { effort: call.effort },
        max_tokens: maxTokens,
        max_completion_tokens: maxTokens,
        /* The settled figure, in-band, per call — what assertCallAccounted requires. */
        usage: { include: true },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });
    const json = (await res.json()) as {
      error?: { message?: string };
      choices?: { message?: { content?: string }; finish_reason?: string }[];
      usage?: {
        prompt_tokens?: number | null;
        completion_tokens?: number | null;
        completion_tokens_details?: { reasoning_tokens?: number | null } | null;
        cost?: number | null;
      };
      id?: string;
      model?: string;
      provider?: string;
    };
    /* Before any early return: a refusal that reports usage still cost money —
       the same ordering the PDF bake-off's OpenRouter arm uses. */
    observe.openRouter(json);
    if (!res.ok || json.error) {
      throw new Error(`chat wire ${res.status}: ${json.error?.message?.slice(0, 400) ?? "no error body"}`);
    }
    const choice = json.choices?.[0];
    if (!choice?.message?.content) throw new Error("chat wire returned no message content");
    /* `length` is not an error anywhere in the app, which src/models.ts flags
       as the first thing to bite on this wire — here it is one. */
    if (choice.finish_reason === "length") {
      throw new Error(`truncated (finish_reason: length) at max ${maxTokens} — the answer cannot be scored`);
    }
    const stats: CallStats = {
      ms: Date.now() - startedAt,
      inputTokens: json.usage?.prompt_tokens ?? null,
      outputTokens: json.usage?.completion_tokens ?? null,
      reasoningTokens: json.usage?.completion_tokens_details?.reasoning_tokens ?? null,
      generationId: json.id ?? null,
      costUsd: typeof json.usage?.cost === "number" ? json.usage.cost : null,
      providerCostUsd: null, // verify-costs.ts fills this from the provider's record
    };
    assertCallAccounted(stats, `chat wire, ${call.model}`);
    return { raw: choice.message.content, stats };
  });
};

/* --------------------------------------------------- the deterministic half */

/**
 * The author's headings as an explicit list — the `headings-listed` arm's
 * seed. A different intervention from the seeded tree below, on purpose:
 * production already shows the model every heading block and calls headings
 * hard boundaries, so what this arm isolates is *salience* — the same facts,
 * gathered in one place — with no proposal attached (REVIEW-SOL.md, 8).
 */
export function renderHeadingList(blocks: Block[]): string {
  const { body } = splitBlocks(blocks);
  const lines = body.flatMap((b, i) =>
    b.kind === "heading" ? [`[${i}] h${b.level ?? "?"}: ${b.text}`] : [],
  );
  return [
    "For reference, the article's own headings, in order, with their block",
    "numbers and levels. They are already hard boundaries; this list adds",
    "nothing new — it only gathers them in one place.",
    "",
    ...lines,
  ].join("\n");
}

/**
 * The heading tree, rendered as the proposal the `headings-seeded` arm hands
 * the model. Nested JSON in the same shape the model is asked to emit, so
 * "modify or replace" needs no second format — the model can echo it, edit it,
 * or ignore it.
 */
export function renderSeedProposal(blocks: Block[], slug: string): string {
  const built = buildHeadingTree(blocks, slug);
  const tree = built.tree;
  const toModelNode = (id: string): ModelNode | null => {
    const node = tree.nodes[id];
    if (!node || node.children.length === 0 || node.treatment === "supplement") return null;
    const children = node.children
      .map(toModelNode)
      .filter((c): c is ModelNode => c !== null);
    return {
      title: node.title,
      range: node.range,
      ...(node.sourceHeading ? { sourceHeading: node.sourceHeading } : {}),
      ...(children.length > 0 ? { children } : {}),
    };
  };
  const root = toModelNode(tree.rootId);
  return [
    "A deterministic pass over the article's own headings produced this proposed",
    "structure. Treat it as a starting point: keep it, adjust its boundaries, add",
    "levels beneath it, or replace it entirely where the headings mislead — the",
    "article's actual topic structure wins. It carries no gists; you write those",
    "either way.",
    "",
    JSON.stringify({ root }, null, 2),
  ].join("\n");
}

/**
 * A proposed root, turned into the same artefact the pipeline stores: leaves
 * grown mechanically, supplement appended, invariants asserted. Reusing
 * `buildTree` is the point — an arm judged on a tree assembled by different
 * code is being judged partly on that code.
 */
export function assembleTree(
  root: ModelNode,
  blocks: Block[],
  slug: string,
  /**
   * **Threaded out, because otherwise the eval stops being able to see the
   * faults it exists to count.** `buildTree` now mends a one-block partition
   * slip and drops an unbacked `sourceHeading` (src/hierarchy.ts). Those are the
   * right production outcomes, and they are the two failure families this
   * eval measured — so an arm that makes either mistake would come back
   * `outcome: "ok"` with nothing recorded, and `sourceHeadingValid` would read
   * a necessary 1 for every paid arm. The repairs stay; what changes is that
   * the run records them. GPT Sol's review, 2026-08-30.
   */
  report?: BuildReport,
): Tree {
  const { body, groups } = splitBlocks(blocks);
  const tree = appendSupplement(buildTree(root, {}, body, slug, report), groups);
  /* The labels pass never runs here, so structural leaves have no navLabel and
     checkTree would advise about every one; that advice is scoreTree's to
     count. What must throw is structural damage, which is what
     `assertTreeSound` does — over a tree whose gists the model DID write, so
     the gist rule genuinely applies. */
  assertTreeSound(blocks, tree);
  return tree;
}

/** A raw answer through `assembleTree`: fence stripped, JSON parsed, then the pipeline's rules. */
export function parseStructureResponse(
  raw: string,
  blocks: Block[],
  slug: string,
  report?: BuildReport,
): Tree {
  const { root } = parseJsonFrom<{ root: ModelNode }>(
    stripFence(raw),
    "the structure-arm response",
  );
  return assembleTree(root, blocks, slug, report);
}

/**
 * True for the leaves the pipeline would label. Exported for run.ts's stats
 * only; kept beside the executor so nothing re-derives it differently.
 */
export function structuralLeaves(tree: Tree, blocks: Block[]): TreeNode[] {
  const byId = new Map(blocks.map((b) => [b.id, b]));
  return Object.values(tree.nodes).filter((n) => {
    if (n.children.length > 0) return false;
    const block = byId.get(n.range[0]);
    return !!block && isStructural(block);
  });
}

/* ----------------------------------------------------- waves and revise -- */

/* The addenda are APPENDED to production's SYSTEM, never spliced into it —
   every byte of the shipping prompt survives, and the addendum IS the
   documented delta (arms.ts § deltas). If a wave wants a better prompt, that
   is a different arm. */

const WAVE_L1_ADDENDUM = `

THIS CALL IS WAVE 1 OF SEVERAL. Propose ONLY the root and its depth-1 chapters:
the root's "children" are the chapters, and the chapters carry NO "children" of
their own. Later calls will subdivide each chapter separately. Everything above
still applies — headings as hard boundaries, titles, and a gist for the root
and for every chapter.`;

const WAVE_SUB_ADDENDUM = `

THIS CALL IS A LATER WAVE. The numbered blocks you receive are ONE PART of a
larger article, and its boundaries are already fixed: your root must cover
exactly the full block range you were given, and its "children" partition it
one level deep — no deeper. Everything above still applies.`;

const REVISE_ADDENDUM = `

A DRAFT of the tree, produced by an earlier pass, follows the article. Revise
it freely: keep what is right, move any boundary, retitle, rewrite any gist, or
discard it entirely and start over. The draft is a suggestion; the article is
the authority.`;

/** Which transport a model id speaks. */
const senderFor = (model: string): MessagesSend =>
  model.startsWith("anthropic/") ? sendMessages : sendChat;

function parseWave(raw: string, what: string): ModelNode {
  const { root } = parseJsonFrom<{ root: ModelNode }>(stripFence(raw), what);
  return root;
}

/**
 * Waves: L1 over the whole article, then one call per long part, then one per
 * long section — later waves in parallel, each seeing only its own slice.
 * Parts of nine blocks or fewer are left whole (production's own long-run
 * rule, applied as scope). The assembled proposal then goes through the same
 * `buildTree` as every other arm, whose `assertChildrenPartition` is what
 * enforces that every wave tiled its parent exactly.
 */
async function runWaves(
  arm: Extract<ArmSpec, { kind: "waves" }>,
  blocks: Block[],
  slug: string,
): Promise<ModelArmRun> {
  const { body } = splitBlocks(blocks);
  const index = new Map(body.map((b, i) => [b.id, i]));
  const span = (node: ModelNode): number => {
    const lo = index.get(node.range[0]);
    const hi = index.get(node.range[1]);
    if (lo === undefined || hi === undefined || lo > hi) {
      throw new Error(`a wave returned a range that is not in this article`);
    }
    return hi - lo + 1;
  };
  const slice = (node: ModelNode): Block[] => {
    const lo = index.get(node.range[0])!;
    const hi = index.get(node.range[1])!;
    return body.slice(lo, hi + 1);
  };
  const send = senderFor(arm.call.model);
  const calls: CallStats[] = [];
  const built: BuildReport = { repairs: [], droppedChildren: [], droppedHeadings: [] };
  try {
  // Wave 1: the whole article, chapters only.
  const base = structureRequest(body);
  const l1 = await send({
    call: arm.call,
    system: base.system + WAVE_L1_ADDENDUM,
    user: base.user,
    maxTokens: base.maxTokens,
  });
  calls.push(l1.stats);
  const root = parseWave(l1.raw, "the wave-1 response");
  if (!root.children?.length) throw new Error("wave 1 proposed no chapters at all");
  if (root.children.some((c) => c.children?.length)) {
    /* The wave discipline is part of what the arm tests; silently stripping
       the extra depth would score a different strategy under this name. */
    throw new Error("wave 1 returned children below depth 1, against its scope");
  }

  /**
   * One deeper wave over `parent`'s children: subdivide every child longer
   * than nine blocks, in parallel, each call seeing only its own slice plus
   * the context the team lead specified — the parent's title and gist and the
   * sibling titles.
   */
  const subdivide = async (parents: ModelNode[]): Promise<ModelNode[]> => {
    const next: ModelNode[] = [];
    await Promise.all(
      parents.flatMap((parent) =>
        (parent.children ?? []).map(async (child) => {
          if (span(child) <= 9 || child.children?.length) return;
          const part = slice(child);
          const req = structureRequest(part);
          const siblings = (parent.children ?? []).map((c) => c.title).join("; ");
          const context =
            `CONTEXT (locating this part; do not summarise it): this is one part of a larger ` +
            `article. The part is "${child.title}"` +
            (child.gist ? ` — ${child.gist}` : "") +
            `. Its sibling parts, in order: ${siblings}.\n\n`;
          const answer = await send({
            call: arm.call,
            system: req.system + WAVE_SUB_ADDENDUM,
            user: context + req.user,
            maxTokens: req.maxTokens,
          });
          calls.push(answer.stats);
          const sub = parseWave(answer.raw, "a later-wave response");
          if (sub.range[0] !== child.range[0] || sub.range[1] !== child.range[1]) {
            throw new Error(
              "a later wave answered about a different range than the part it was given",
            );
          }
          child.children = sub.children ?? [];
          /* The sub-root's own title/gist are discarded: the part's identity
             was fixed by the earlier wave, and letting a later one rename it
             would let the waves disagree about what a part is. */
          next.push(child);
        }),
      ),
    );
    return next;
  };

  // Waves 2..levels: subdivide the previous wave's long survivors.
  let frontier: ModelNode[] = [root];
  for (let level = 2; level <= arm.levels && frontier.length > 0; level++) {
    frontier = await subdivide(frontier);
  }

  return { tree: assembleTree(root, blocks, slug, built), calls, built };
  } catch (err) {
    // The bill travels with the failure — see ArmFailure.
    throw err instanceof ArmFailure ? err : new ArmFailure((err as Error).message, calls);
  }
}

/** Cheap proposes with production's prompt; capable revises with the draft in hand. */
async function runRevise(
  arm: Extract<ArmSpec, { kind: "revise" }>,
  blocks: Block[],
  slug: string,
): Promise<ModelArmRun> {
  const calls: CallStats[] = [];
  try {
    const { body } = splitBlocks(blocks);
    const base = structureRequest(body);
    const proposal = await senderFor(arm.propose.model)({
      call: arm.propose,
      system: base.system,
      user: base.user,
      maxTokens: base.maxTokens,
    });
    calls.push(proposal.stats);
    /* The draft is passed on as the model wrote it (fence stripped). It is NOT
       validated first: a draft the reviser has to repair is precisely the
       strategy under test, and pre-filtering it would measure a kinder one. */
    const revised = await senderFor(arm.revise.model)({
      call: arm.revise,
      system: base.system + REVISE_ADDENDUM,
      user: `${base.user}\n\nDRAFT:\n${stripFence(proposal.raw)}`,
      maxTokens: base.maxTokens,
    });
    calls.push(revised.stats);
    const built: BuildReport = { repairs: [], droppedChildren: [], droppedHeadings: [] };
    return { tree: parseStructureResponse(revised.raw, blocks, slug, built), calls, built };
  } catch (err) {
    // The bill travels with the failure — see ArmFailure.
    throw err instanceof ArmFailure ? err : new ArmFailure((err as Error).message, calls);
  }
}

/* ------------------------------------------------------------ the dispatch */

export async function runModelArm(
  arm: ArmSpec,
  blocks: Block[],
  slug: string,
): Promise<ModelArmRun> {
  const { body } = splitBlocks(blocks);
  switch (arm.kind) {
    case "one-call": {
      const { system, user, maxTokens } = structureRequest(body);
      const seed =
        arm.seed === "heading-tree"
          ? `\n\n${renderSeedProposal(blocks, slug)}`
          : arm.seed === "heading-list"
            ? `\n\n${renderHeadingList(blocks)}`
            : "";
      const send = arm.call.model.startsWith("anthropic/") ? sendMessages : sendChat;
      const { raw, stats } = await send({
        call: arm.call,
        system,
        user: `${user}${seed}`,
        maxTokens,
      });
      const built: BuildReport = { repairs: [], droppedChildren: [], droppedHeadings: [] };
      try {
        return { tree: parseStructureResponse(raw, blocks, slug, built), calls: [stats], built };
      } catch (err) {
        /* The call succeeded and the answer failed the pipeline's rules — a
           tiling gap, an invented id. The money is spent and the outcome is
           "produced nothing"; both travel with the failure. See ArmFailure. */
        throw new ArmFailure((err as Error).message, [stats], built);
      }
    }
    case "waves":
      return runWaves(arm, blocks, slug);
    case "revise":
      return runRevise(arm, blocks, slug);
    default:
      throw new Error(`runModelArm was handed the free arm "${arm.name}" — run.ts owns those.`);
  }
}

