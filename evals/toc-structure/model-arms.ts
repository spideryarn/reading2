/**
 * The executor for the arms that spend money.
 *
 * **The prompt is production's own**: `structureRequest` in src/toc.ts is the
 * one assembly point, called by `generateToc` itself, so the incumbent arm's
 * bytes cannot drift from what ships — parity by construction, pinned (and
 * seen red under perturbation) by tests/toc-structure-request-parity.test.ts.
 * The answer comes back through the pipeline's own `buildTree` +
 * `appendSupplement` + `assertTreeSound`, so an arm is judged on the
 * pipeline's rules, not this file's.
 *
 * **The transports are declared bypasses** — `toc-structure-messages` and
 * `toc-structure-chat` in src/spend-declarations.ts name this file — because
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
 * The `waves` and `cheap-then-revise` strategies still throw `PENDING`: their
 * prompts are new design, waiting on the phase-2 design relay so they are
 * written once rather than twice.
 */

import Anthropic from "@anthropic-ai/sdk";
import { declaredFetch, withDeclaredExternalCall } from "../declared-spend.js";
import { isStructural } from "../../src/block-policy.js";
import { MESSAGES_PROVIDER, wasRefused } from "../../src/messages-stream.js";
import { parseJsonFrom, stripFence } from "../../src/parse-json.js";
import { appendSupplement, splitBlocks } from "../../src/supplement.js";
import { buildTree, structureRequest, type ModelNode } from "../../src/toc.js";
import { assertTreeSound } from "../../src/tree-invariants.js";
import type { Block, Tree, TreeNode } from "../../src/types.js";
import type { ArmSpec, CallSpec } from "./arms.js";
import { buildHeadingTree } from "./heading-tree.js";

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
   evals/toc-structure/verify-costs.ts, run against a finished run.json; a run
   is not quotable until it passes. In-process, `costUsd` comes in-band:
   OpenRouter puts `cost` in the raw stream events on the Messages wire — the
   fact src/messages-stream.ts § meterStream is built on, pinned by
   tests/messages-stream.test.ts — and in `usage` on chat/completions when
   `usage: {include: true}` is sent. */

export interface ModelArmRun {
  tree: Tree;
  calls: CallStats[];
}

/* ------------------------------------------------------------- the seams -- */

/**
 * Thrown by the two functions below. `run.ts` lets it propagate — a runner
 * that caught it and moved on would write a results file in which these arms
 * scored nothing, which reads identically to these arms being worthless.
 */
export class PendingError extends Error {}

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
  return withDeclaredExternalCall("toc-structure-messages", { model: call.model }, async ({ observe }) => {
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
    observe.openRouter({
      usage: {
        prompt_tokens: u.input_tokens ?? null,
        completion_tokens: u.output_tokens ?? null,
        cost: streamCostUsd,
      },
      model: message.model,
      provider: (message as unknown as { provider?: string | null }).provider ?? null,
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
  return withDeclaredExternalCall("toc-structure-chat", { model: call.model }, async ({ observe }) => {
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
 * A model's raw answer, turned into the same artefact the pipeline stores:
 * fence stripped, JSON parsed, leaves grown mechanically, supplement appended,
 * invariants asserted. Reusing `buildTree` is the point — an arm judged on a
 * tree assembled by different code is being judged partly on that code.
 */
export function parseStructureResponse(raw: string, blocks: Block[], slug: string): Tree {
  const { body, groups } = splitBlocks(blocks);
  const { root } = parseJsonFrom<{ root: ModelNode }>(
    stripFence(raw),
    "the structure-arm response",
  );
  const tree = appendSupplement(buildTree(root, {}, body, slug), groups);
  /* The labels pass never runs here, so structural leaves have no navLabel and
     checkTree would advise about every one; that advice is scoreTree's to
     count. What must throw is structural damage, which is what
     `assertTreeSound` does — over a tree whose gists the model DID write, so
     the gist rule genuinely applies. */
  assertTreeSound(blocks, tree);
  return tree;
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
      return { tree: parseStructureResponse(raw, blocks, slug), calls: [stats] };
    }
    case "waves":
    case "revise":
      throw new PendingError(
        `Arm "${arm.name}" needs a prompt that does not exist yet — held for GPT Sol's ` +
          `review of the phase-2 design so it is written once, not twice.`,
      );
    default:
      throw new Error(`runModelArm was handed the free arm "${arm.name}" — run.ts owns those.`);
  }
}

