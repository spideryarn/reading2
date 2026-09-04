/**
 * The arms of the ToC structure eval, as data. An arm is a *recipe for
 * producing a tree* — which model, how hard it thinks, what it is shown, and
 * in how many calls — and adding one is adding an entry here plus, for a
 * genuinely new strategy, an executor case in model-arms.ts. It is
 * deliberately not a string the runner parses.
 *
 * **Every arm says what kind of claim its result can support** (`comparison`),
 * because several cannot support causal ones (REVIEW-SOL.md, 8):
 *
 * - `"isolated"` — differs from the incumbent in ONE variable, so a gap is
 *   attributable to that variable (still subject to run-to-run noise).
 * - `"bakeoff"` — differs in several at once. It can pick a deployable recipe;
 *   it can never explain why the recipe won, and no result from it may be
 *   quoted as a fact about any single variable.
 * - `"baseline"` / `"noise-floor"` — what ships, and its own repeat.
 *
 * An arm is the model PLUS how it is asked, never just a model id — the lesson
 * evals/embedding-retrieval.ts wrote down. `cheap-high` is the standing
 * example: gpt-5.6-luna cannot speak the Messages wire at all (src/models.ts
 * § why the quick tier has no Anthropic-SDK spelling), so that arm swaps
 * model, wire AND thinking semantics together — bakeoff, by construction.
 *
 * The two seeded arms ask different questions and both exist on purpose:
 * production already shows the model every heading block and calls headings
 * hard boundaries, so `headings-listed` (an explicit list, for salience) and
 * `headings-seeded` (a whole deterministic proposed tree, echo/edit/replace)
 * are different interventions, and the first version conflated them.
 *
 * The two free arms:
 * - **headings** is arm zero, the denominator (src/heading-tree.ts).
 * - **incumbent-disk** scores `data/<slug>/tree.json` as it sits — the
 *   incumbent's already-paid-for output. One old run per document, from
 *   different days; fine for orientation, never for the noise floor.
 */

import { CAPABLE_MODEL_OPENROUTER, QUICK_MODEL_OPENROUTER, type Effort } from "../../src/models.js";
import { PRODUCTION_EFFORT } from "../../src/hierarchy.js";

/**
 * **Where a call is allowed to be served, when that is part of the arm.**
 *
 * Only the chat wire reads this; the Messages wire pins `MESSAGES_PROVIDER`
 * because production does, and an incumbent routed differently from production
 * is not the incumbent (the `PRODUCTION_EFFORT` lesson, below, in its other
 * form).
 *
 * `zdr` is the field src/ai-call.ts already uses for dictation — copied rather
 * than invented, because OpenRouter accepting a request is never evidence that
 * OpenRouter honoured a field (src/messages-stream.ts § MESSAGES_PROVIDER), and
 * a made-up spelling here would route to whoever, succeed, and be reported as
 * a zero-retention number. `require_parameters` is the half that is not a
 * preference: without it an upstream that ignores `reasoning` may serve the
 * request anyway, and a "low effort" arm would be measuring no effort at all.
 */
export interface ProviderPolicy {
  /** Only upstreams that retain nothing. Fewer of them, and sometimes none. */
  zdr?: true;
  /** Only upstreams that accept every parameter sent — `reasoning`, above all. */
  require_parameters?: true;
  allow_fallbacks?: boolean;
  /**
   * **Serve this call from these upstreams and no others.**
   *
   * Added 2026-09-03 because the screening panel could not otherwise tell a bad
   * model from a bad upstream. `zdr: true` with no pin load-balances across
   * every zero-retention provider for the model — twenty-two of them for
   * DeepSeek V4 Flash — and they are not equivalent: all three of that arm's
   * draws happened to land on DigitalOcean and all three came back with
   * reasoning and no answer, while the same model, same body and same policy
   * answered perfectly through OpenInference. "The model failed" and "that one
   * endpoint failed" are the same observation until the provider is held fixed.
   *
   * It is also the shape any deployment would need: choosing a model is not
   * enough if the gateway may route it anywhere.
   */
  only?: readonly string[];
}

/** One model call's worth of choices. */
export interface CallSpec {
  /** OpenRouter spelling — the only wire id this eval sends. */
  model: string;
  effort: Effort;
  /**
   * Chat wire only. Absent means "OpenRouter's default routing", which is what
   * the two incumbent-shaped arms need and what a candidate arm must not have:
   * a candidate we would not be allowed to ship has no business winning a
   * bake-off, so the constraint belongs on the call, not on the write-up.
   */
  provider?: ProviderPolicy;
}

/**
 * **The routing every candidate arm is measured under**, because Greg's
 * constraint on a replacement model is zero data retention and no training on
 * reader text (2026-09-03), and a number measured without it would describe a
 * recipe we could not deploy.
 *
 * It is a real constraint, not a decoration: it narrows the upstreams a model
 * can be served by, so latency and price here belong to the ZDR-eligible
 * subset and may be worse than the headline figure on the model's page. Where
 * no such upstream exists the call fails outright, which is the honest answer
 * and is recorded as the arm's result rather than routed around.
 */
export const ZDR: ProviderPolicy = { zdr: true, require_parameters: true };

/** What kind of claim a result from this arm can support. */
export type Comparison = "baseline" | "noise-floor" | "isolated" | "bakeoff";

/** What extra material, if any, a one-call arm's prompt carries about the author's headings. */
export type Seed = "none" | "heading-list" | "heading-tree";

export type ArmSpec =
  /** Free: the deterministic author-heading tree. */
  | { name: string; kind: "headings"; comparison: "baseline" }
  /** Free: score the tree already on disk in the article's directory. */
  | { name: string; kind: "disk"; comparison: "baseline" }
  /** One structure call, the shape the pipeline ships today. */
  | { name: string; kind: "one-call"; comparison: Comparison; call: CallSpec; seed: Seed }
  /**
   * L1 in one call, then one call per part for the next level, recursively to
   * `levels`. Three, not two: the book-length motivation for waves is depth
   * the single call cannot reach, and an L1→L2 pilot would not test the
   * process it argues for (REVIEW-SOL.md, 8).
   *
   * `deltas` documents EVERY way this arm's prompts differ from production's,
   * per the governing rule: hold constant everything the arm is not about.
   * The arm tests *waves*, not "waves plus a prompt somebody rewrote" — a
   * better prompt is a different arm.
   */
  | {
      name: string;
      kind: "waves";
      comparison: "bakeoff";
      call: CallSpec;
      levels: number;
      deltas: readonly string[];
    }
  /** A cheap model proposes the whole tree; a capable one revises it. */
  | {
      name: string;
      kind: "revise";
      comparison: "bakeoff";
      propose: CallSpec;
      revise: CallSpec;
      deltas: readonly string[];
    };

/**
 * **Production, by import rather than by typing the number in again.**
 *
 * It read `effort: "high"` until 2026-09-03, while `src/hierarchy.ts` had run
 * `"medium"` since the max_tokens postmortem. So every paid arm was scored
 * against a recipe the pipeline does not use, and `smart-low` — declared
 * `isolated`, one variable, effort — was answering high-vs-low rather than the
 * medium-vs-low question production actually has. GPT Sol found it by reading
 * both files at once, which is the only way a restated constant is ever found.
 *
 * Hence `PRODUCTION_EFFORT`: the drift is now unrepresentable, not documented.
 * The runs under evals/results/hierarchy-structure/ dated 2026-08-30 all
 * predate this, their `incumbent` is `"high"`, and they are not one series
 * with anything measured after it.
 */
const INCUMBENT: CallSpec = { model: CAPABLE_MODEL_OPENROUTER, effort: PRODUCTION_EFFORT };

/* ------------------------------------------------- the challenger field -- */

/**
 * **A model we might replace Sonnet with, and the one fact about it that
 * decides how it may be asked.**
 *
 * `supportedEfforts` is copied verbatim from OpenRouter's own catalogue —
 * `GET /api/v1/models`, the `reasoning.supported_efforts` array, read
 * 2026-09-03 — and it is here because of what it says:
 *
 * | model | supported_efforts |
 * |---|---|
 * | deepseek v4 flash / v4 pro / glm-5.3 / glm-5.3-flash | `max, high, low` |
 * | qwen3.8-27b | `xhigh, medium, low` |
 * | gemini-3.8-flash, grok-4.3 | `high, medium, low` |
 *
 * **Five of these eight have no `medium`.** Production's effort is `medium`, so
 * the obvious bake-off — every challenger at the incumbent's setting — would
 * have sent those five a value they do not have. OpenRouter would have answered
 * 200 either way (src/messages-stream.ts § the rule that found all three), and
 * it does not refuse an effort a model lacks: it **maps the request onto the
 * nearest level the model does have**. So the results file would have carried a
 * "medium" column measuring some other rung, chosen by the router, differing
 * per model, with nothing in any response to say so. That is the silent-success
 * shape exactly, and it would have been undetectable from the numbers.
 *
 * So the field runs at **`low`**, the one value all eight share — which is also
 * the value that won the 2026-09-03 blind judging for Sonnet, so it is not a
 * concession.
 *
 * **`smart-low` is the nearest reference point, and it is still not a control.**
 * It was described here as "like-for-like, differing in model alone", and GPT
 * Sol was right that this is false: a candidate differs from it in model family,
 * wire (chat versus Messages), thinking semantics (a fixed `reasoning.effort`
 * versus Sonnet's adaptive thinking plus output effort), routing (ZDR-constrained
 * versus production's), upstream implementation, sampling defaults, and what the
 * word `low` means to a given vendor. Every challenger is therefore a `bakeoff`
 * arm and the honest claim is about whole recipes: *this model, at its own low
 * setting, through this upstream, produced this tree at this cost.* Nothing here
 * can say a candidate is intrinsically better or worse than Sonnet, and no gap
 * may be attributed to model choice.
 *
 * Three models were considered and dropped: `nvidia/nemotron-3.5-lightning`,
 * `minimax/minimax-m3` and `moonshotai/kimi-k2.6` all advertise `reasoning` but
 * **not `reasoning_effort`**, so there is no setting to hold equal and their
 * arm would be "whatever the provider felt like" — a bake-off entry that could
 * not be reproduced or explained.
 *
 * Prices are per million tokens, from the same catalogue read, and are here for
 * the write-up's sake only — the money that gets quoted is the money OpenRouter
 * bills in-band, per call (`CallStats.costUsd`), never this table.
 */
export interface Candidate {
  /** Arm name, and the column head it gets in the results. */
  name: string;
  /** OpenRouter slug, verbatim from the catalogue. */
  model: string;
  /** `reasoning.supported_efforts`, verbatim, 2026-09-03. `null` = the record listed none. */
  supportedEfforts: readonly string[] | null;
  /** USD per million tokens, catalogue price on 2026-09-03. Sonnet is $2.00 / $10.00. */
  priceIn: number;
  priceOut: number;
}

/**
 * The eight, cheapest first. Chosen to span vendors and price tiers rather than
 * to be a top-eight of anything: the question is whether *any* materially
 * cheaper model carves an article as well as Sonnet, so the field is wide and
 * the screening round is the filter.
 *
 * Every one of them has at least one zero-retention endpoint able to serve the
 * ~48k `max_tokens` this stage asks for (`GET /api/v1/endpoints/zdr`, same
 * read). That is a real constraint on the field, not a formality — `tencent/hy4-preview`
 * has exactly one such provider, so its latency is that provider's latency.
 */
export const CANDIDATES: readonly Candidate[] = [
  { name: "deepseek-flash", model: "deepseek/deepseek-v4-flash-0731", supportedEfforts: ["max", "high", "low"], priceIn: 0.07, priceOut: 0.18 },
  { name: "glm-flash", model: "z-ai/glm-5.3-flash", supportedEfforts: ["max", "high", "low"], priceIn: 0.07, priceOut: 0.25 },
  { name: "qwen-27b", model: "qwen/qwen3.8-27b", supportedEfforts: ["xhigh", "medium", "low"], priceIn: 0.42, priceOut: 2.55 },
  { name: "gemini-flash", model: "google/gemini-3.8-flash", supportedEfforts: ["high", "medium", "low"], priceIn: 0.75, priceOut: 3.75 },
  { name: "hunyuan", model: "tencent/hy4-preview", supportedEfforts: ["high", "low", "none"], priceIn: 0.83, priceOut: 2.5 },
  { name: "deepseek-pro", model: "deepseek/deepseek-v4-pro-0813", supportedEfforts: ["max", "high", "low"], priceIn: 1.12, priceOut: 3.35 },
  { name: "grok", model: "x-ai/grok-4.3", supportedEfforts: ["high", "medium", "low"], priceIn: 1.25, priceOut: 2.5 },
  { name: "glm", model: "z-ai/glm-5.3", supportedEfforts: ["max", "high", "low"], priceIn: 1.4, priceOut: 4.4 },
];

/** The one effort the whole field shares — see `Candidate`. */
export const FIELD_EFFORT: Effort = "low";

const CHALLENGERS: readonly ArmSpec[] = CANDIDATES.map((c) => ({
  name: c.name,
  kind: "one-call" as const,
  /* Model AND effort differ from production at once, so this can pick a
     deployable recipe and can never explain why one won. The like-for-like
     reading is against `smart-low`, which differs in model alone. */
  comparison: "bakeoff" as const,
  call: { model: c.model, effort: FIELD_EFFORT, provider: ZDR },
  seed: "none" as const,
}));

export const ARMS: readonly ArmSpec[] = [
  { name: "headings", kind: "headings", comparison: "baseline" },
  { name: "incumbent-disk", kind: "disk", comparison: "baseline" },
  {
    name: "incumbent",
    kind: "one-call",
    comparison: "baseline",
    call: INCUMBENT,
    seed: "none",
  },
  /* Identical to `incumbent` on purpose: repeats of it are the noise floor —
     the run-to-run disagreement of the shipping recipe, which is the
     resolution any arm-to-arm gap must clear. Note it measures the
     incumbent's OWN stochasticity under this configuration; a challenger may
     be more or less stable, which per-arm repeats at the finalist stage check. */
  {
    name: "incumbent-repeat",
    kind: "one-call",
    comparison: "noise-floor",
    call: INCUMBENT,
    seed: "none",
  },
  {
    name: "cheap-high",
    kind: "one-call",
    comparison: "bakeoff", // model + wire + thinking semantics move together
    call: { model: QUICK_MODEL_OPENROUTER, effort: "high" },
    seed: "none",
  },
  /**
   * **The isolated-effort arm, which points the other way now.**
   *
   * It was `smart-low` until 2026-09-04, when production moved to `low`
   * (src/hierarchy.ts § `EFFORT`) on the strength of eight blind judgements and
   * this harness's own cost and latency figures. At that moment `smart-low`
   * became a second copy of `incumbent` — the same recipe under two names,
   * which is the shape `incumbent-repeat` already occupies deliberately and
   * which nothing else should.
   *
   * So the arm keeps its job and changes its value: **the one variable is still
   * effort, and the direction is now up.** If the flip was wrong, this is the
   * arm that says so, and it asks the question with production as the control
   * rather than as the challenger.
   *
   * Results filed before 2026-09-04 name `smart-low` and measured `low` against
   * a `medium` incumbent; they are not one series with anything this arm
   * produces, because the control moved.
   */
  {
    name: "smart-medium",
    kind: "one-call",
    comparison: "isolated", // one variable: effort
    call: { model: CAPABLE_MODEL_OPENROUTER, effort: "medium" },
    seed: "none",
  },
  {
    name: "headings-listed",
    kind: "one-call",
    comparison: "isolated", // one variable: an explicit list of the author's headings
    call: INCUMBENT,
    seed: "heading-list",
  },
  {
    name: "headings-seeded",
    kind: "one-call",
    comparison: "isolated", // one variable: the whole deterministic proposal
    call: INCUMBENT,
    seed: "heading-tree",
  },
  {
    name: "waves",
    kind: "waves",
    comparison: "bakeoff",
    call: INCUMBENT,
    levels: 3,
    deltas: [
      "system: production SYSTEM verbatim, plus a scoped wave addendum (wave 1: root and chapters only, no deeper; later waves: subdivide one given part, no deeper)",
      "later waves see ONLY their own part's blocks — that is where the latency and cost case lives — plus the parent's title and gist and the sibling titles as a context preamble",
      "a part or section spanning nine blocks or fewer is not subdivided, which is production's own long-run rule applied as scope",
    ],
  },
  {
    name: "cheap-then-revise",
    kind: "revise",
    comparison: "bakeoff",
    propose: { model: QUICK_MODEL_OPENROUTER, effort: "high" },
    revise: INCUMBENT,
    deltas: [
      "call 1 (cheap, chat wire): production prompt verbatim",
      "call 2 (capable, messages wire): production SYSTEM verbatim plus a revise addendum; the user prompt is the article followed by the draft, with explicit permission to change anything including starting over",
    ],
  },
  ...CHALLENGERS,
  /**
   * **The same model as `deepseek-flash`, held to one upstream.**
   *
   * Its three screening draws all went to DigitalOcean and all three returned
   * reasoning with no answer, so "this model cannot do the task" and "this
   * endpoint cannot" were perfectly confounded and the cheapest model in the
   * field — $0.07/$0.18, twenty-eight times cheaper than Sonnet on input — was
   * about to be written off on the strength of one provider.
   *
   * OpenInference is named because a direct probe of the identical body went
   * there and returned 6,251 characters of well-formed JSON for $0.0029. That
   * is the reason it is not cherry-picking: the provider was chosen by the
   * diagnostic *before* this arm existed, and this arm asks the narrow question
   * that probe left open — does that JSON survive the pipeline's own rules?
   *
   * A win here is a claim about the model AND about pinning, never about the
   * ZDR lottery, which `deepseek-flash` continues to measure.
   */
  {
    name: "deepseek-flash-pinned",
    kind: "one-call",
    comparison: "bakeoff",
    call: {
      model: "deepseek/deepseek-v4-flash-0731",
      effort: FIELD_EFFORT,
      provider: { ...ZDR, only: ["OpenInference"] },
    },
    seed: "none",
  },
];

export function armByName(name: string): ArmSpec {
  const arm = ARMS.find((a) => a.name === name);
  if (!arm) {
    throw new Error(
      `No arm named "${name}". Arms: ${ARMS.map((a) => a.name).join(", ")}`,
    );
  }
  return arm;
}
