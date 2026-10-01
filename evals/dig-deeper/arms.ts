/**
 * **The arms, the judges, today's prices, and the one edit an arm makes to
 * production's request** — plan 261001s § The arms, § Holding the search step
 * fixed.
 *
 * Every arm answers from **production's own messages** (`buildExplainMessages`,
 * `investigateRequest`), and the declared changes are exactly these:
 *
 * - `model` — the arm's;
 * - `tools` — removed: the search step is frozen, so no arm may read different
 *   pages from another (Sol F2);
 * - the one sentence that tells the model to search again, replaced by
 *   `NO_MORE_SEARCH` — in explain's `DIG`, in Citations' `DIG_INVESTIGATE` and
 *   in `INVESTIGATE_SYSTEM`'s *What to search* section. `replaceOnce` throws
 *   when the sentence is not there exactly once, so a prompt change cannot
 *   quietly turn the edit into a no-op; tests/dig-deeper-eval.test.ts builds
 *   the real messages and checks it.
 *
 * `max_tokens` stays production's 4,000 (`DIG_ANSWER_TOKENS`, Sol F1).
 */
import type { AiRequestBody } from "../../src/ai-call.js";
import type { OpenRouterMessage } from "../../src/article-prompt.js";

export type Family = "anthropic" | "openai" | "moonshot" | "deepseek" | "google" | "zai" | "xai";

/** OpenRouter ids, checked against `/api/v1/models` on 2026-10-01 (plan § The arms). */
export const MODELS = {
  opus: "anthropic/claude-opus-5.5",
  sonnet5: "anthropic/claude-sonnet-5",
  sonnet55: "anthropic/claude-sonnet-5.5",
  luna: "openai/gpt-6-luna",
  sol: "openai/gpt-6.1-sol",
  kimi: "moonshotai/kimi-k3",
  deepseekFlash: "deepseek/deepseek-v4.1-flash",
  geminiFlash: "google/gemini-3.8-flash",
  glm: "z-ai/glm-5.3",
  grok: "x-ai/grok-4.7",
} as const;

/** Per million tokens, OpenRouter's listing on 2026-10-01. `null` = not listed (no discount / no premium). */
export interface Price {
  input: number;
  output: number;
  cacheRead: number | null;
  cacheWrite: number | null;
}

export const PRICES: Readonly<Record<string, Price>> = {
  [MODELS.opus]: { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  [MODELS.sonnet5]: { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  [MODELS.sonnet55]: { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  [MODELS.luna]: { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.12 },
  [MODELS.sol]: { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 },
  [MODELS.kimi]: { input: 0.41, output: 10, cacheRead: 0.41, cacheWrite: null },
  [MODELS.deepseekFlash]: { input: 0.03, output: 0.5, cacheRead: 0.01, cacheWrite: null },
  [MODELS.geminiFlash]: { input: 0.75, output: 3.75, cacheRead: 0.07, cacheWrite: 0.04 },
  [MODELS.glm]: { input: 0.22, output: 3.39, cacheRead: 0.18, cacheWrite: null },
  [MODELS.grok]: { input: 2, output: 6, cacheRead: 0.5, cacheWrite: null },
};

export function priceOf(model: string): Price {
  const p = PRICES[model];
  if (!p) throw new Error(`no price for ${model} — add it to PRICES in evals/dig-deeper/arms.ts`);
  return p;
}

/**
 * What writing the prefix costs per token: the input price, or the listed
 * cache-write price when it is higher (Anthropic's 1.25×). A listed write price
 * *below* input (Gemini's 0.04, a storage fee) is not a discount on the first
 * read of the prefix, so it never lowers this.
 */
export const writePrice = (p: Price): number => Math.max(p.input, p.cacheWrite ?? p.input);
/** The read price, or the input price when the listing gives none (no discount). */
export const readPrice = (p: Price): number => p.cacheRead ?? p.input;

/**
 * **The route a model goes through** (Sol F1, F3): Anthropic models through
 * production's `dig-deeper` row — its Anthropic `order` pin, and `wireEffort`'s
 * `high` for Opus — and everything else through `eval` (no order, no fallback,
 * provider-default effort), which is what a new route row would start as.
 */
export function jobFor(model: string): "dig-deeper" | "eval" {
  return model.startsWith("anthropic/") ? "dig-deeper" : "eval";
}

export function familyOf(model: string): Family {
  const vendor = model.split("/")[0];
  switch (vendor) {
    case "anthropic":
      return "anthropic";
    case "openai":
      return "openai";
    case "moonshotai":
      return "moonshot";
    case "deepseek":
      return "deepseek";
    case "google":
      return "google";
    case "z-ai":
      return "zai";
    case "x-ai":
      return "xai";
    default:
      throw new Error(`no family for ${model}`);
  }
}

export type Arm =
  | { id: string; kind: "single"; model: string; frontier: boolean; why: string }
  /** Luna writes, Opus checks — plan § The Opus check. */
  | { id: string; kind: "check"; draft: string; checker: string; frontier: true; why: string };

export const ARMS: readonly Arm[] = [
  { id: "opus", kind: "single", model: MODELS.opus, frontier: true, why: "today's production answer" },
  {
    id: "opus-b",
    kind: "single",
    model: MODELS.opus,
    /* The incumbent generation spread: two draws of one arm judged blind side by side. */
    frontier: false,
    why: "the same as opus, a second label",
  },
  { id: "sonnet-5", kind: "single", model: MODELS.sonnet5, frontier: true, why: "the old set-up" },
  { id: "sonnet-5.5", kind: "single", model: MODELS.sonnet55, frontier: true, why: "the current Sonnet" },
  { id: "luna", kind: "single", model: MODELS.luna, frontier: true, why: "the cheap baseline alone" },
  {
    id: "luna+check",
    kind: "check",
    draft: MODELS.luna,
    checker: MODELS.opus,
    frontier: true,
    why: "Greg's idea: Luna writes, Opus checks",
  },
  { id: "sol", kind: "single", model: MODELS.sol, frontier: true, why: "Greg named GPT Sol" },
  { id: "kimi-k3", kind: "single", model: MODELS.kimi, frontier: true, why: "Greg named it" },
  { id: "deepseek-flash", kind: "single", model: MODELS.deepseekFlash, frontier: true, why: "Greg named it" },
  { id: "gemini-flash", kind: "single", model: MODELS.geminiFlash, frontier: true, why: "Gemini 4 is not listed" },
  { id: "glm-5.3", kind: "single", model: MODELS.glm, frontier: true, why: "an Artificial Analysis pick" },
  { id: "grok-4.7", kind: "single", model: MODELS.grok, frontier: true, why: "an Artificial Analysis pick" },
];

/** The anchor every judging batch carries (plan § Judging). */
export const ANCHOR_ARM = "opus";

export function armById(id: string): Arm {
  const a = ARMS.find((x) => x.id === id);
  if (!a) throw new Error(`no arm "${id}" — known: ${ARMS.map((x) => x.id).join(", ")}`);
  return a;
}

/** Every model an arm calls, in call order. */
export function modelsOf(arm: Arm): string[] {
  return arm.kind === "single" ? [arm.model] : [arm.draft, arm.checker];
}

/** A family per arm, for the outside-family sensitivity check: the model the reader reads. */
export function armFamily(arm: Arm): Family {
  return arm.kind === "single" ? familyOf(arm.model) : familyOf(arm.checker);
}

/** The panel: three families, each its family's strongest on long context (plan § Judging). */
export const JUDGES: readonly { id: string; model: string }[] = [
  { id: "opus", model: MODELS.opus },
  { id: "sol", model: MODELS.sol },
  { id: "kimi", model: MODELS.kimi },
];

export function judgeById(id: string): { id: string; model: string } {
  const j = JUDGES.find((x) => x.id === id);
  if (!j) throw new Error(`no judge "${id}" — known: ${JUDGES.map((x) => x.id).join(", ")}`);
  return j;
}

/* ------------------------------------------------------- the model check -- */

/**
 * **Did the model we asked for answer?** (Sol F8.) OpenRouter names a dated
 * snapshot — `openai/gpt-6-luna-20260922`, `deepseek/deepseek-v4-flash-0731` —
 * so the requested id, optionally followed by one date-shaped suffix, matches;
 * anything else (another model, a `-latest`, an `-exp`, nothing at all) does
 * not, and the cell fails.
 */
export function modelMatches(requested: string, returned: string | null | undefined): boolean {
  if (!returned) return false;
  if (returned === requested) return true;
  if (!returned.startsWith(`${requested}-`)) return false;
  return /^(\d{4}|\d{6}|\d{8}|\d{4}-\d{2}-\d{2})$/.test(returned.slice(requested.length + 1));
}

/* -------------------------------------------------- the eval-only edits -- */

/** What replaces each search-again sentence (plan § Holding the search step fixed). */
export const NO_MORE_SEARCH = "That search is all the research there is; you cannot search again.";

/** explain's `DIG` (src/explain.ts), the search-again sentence, verbatim. */
export const EXPLAIN_SEARCH_AGAIN =
  "If they do not settle it,\nsearch again, and use the article to aim the search: the author, the date, the\npublication, the other names in the same sentence.";

/** Citations' `DIG_INVESTIGATE` (src/citation-investigate.ts), verbatim. */
export const INVESTIGATE_SEARCH_AGAIN = "Search again only if they do\nnot settle it.";

/** `INVESTIGATE_SYSTEM`'s *What to search* section body, verbatim. */
export const INVESTIGATE_WHAT_TO_SEARCH =
  "Search for the work itself: its title, with the first author and year when you\nhave them. Use the article's own link to aim the search when one is given. One\nor two searches is usually enough; do not keep searching once you have found\npages about the work.";

/** Replace `find` in `text` exactly once, or throw — the edit must never be a silent no-op. */
export function replaceOnce(text: string, find: string, by: string, where: string): string {
  const first = text.indexOf(find);
  if (first < 0) throw new Error(`${where}: the sentence to replace is not there — has the production prompt changed?`);
  if (text.indexOf(find, first + 1) >= 0) throw new Error(`${where}: the sentence to replace is there more than once`);
  return text.slice(0, first) + by + text.slice(first + find.length);
}

type Part = { type: "text"; text: string; cache_control?: { type: "ephemeral" } };

function lastPartEdited(messages: OpenRouterMessage[], edit: (t: string) => string): OpenRouterMessage[] {
  const out = structuredClone(messages);
  const user = out[out.length - 1];
  if (!user || user.role !== "user" || typeof user.content === "string") throw new Error("the last message is not the user's parts");
  const parts = user.content as Part[];
  const last = parts[parts.length - 1];
  if (!last) throw new Error("the user message has no parts");
  last.text = edit(last.text);
  return out;
}

export type EntryKind = "glossary" | "comment" | "citation";

/**
 * **An isolated arm's request**, from production's: the model, no tools, and
 * the search-again sentence(s) replaced. Nothing else moves; the test compares
 * the result with production's own request field by field.
 */
export function isolatedRequest(production: AiRequestBody, entry: EntryKind, model: string): AiRequestBody {
  const { tools: _tools, ...rest } = production as AiRequestBody & { tools?: unknown };
  const messages = production.messages as OpenRouterMessage[];
  let edited: OpenRouterMessage[];
  if (entry === "citation") {
    edited = lastPartEdited(messages, (t) => replaceOnce(t, INVESTIGATE_SEARCH_AGAIN, NO_MORE_SEARCH, "DIG_INVESTIGATE"));
    const system = edited[0];
    if (!system || system.role !== "system" || typeof system.content !== "string") throw new Error("no system prompt");
    system.content = replaceOnce(system.content, INVESTIGATE_WHAT_TO_SEARCH, NO_MORE_SEARCH, "INVESTIGATE_SYSTEM");
  } else {
    edited = lastPartEdited(messages, (t) => replaceOnce(t, EXPLAIN_SEARCH_AGAIN, NO_MORE_SEARCH, "explain DIG"));
  }
  return { ...rest, model, messages: edited } as AiRequestBody;
}

/** The text after the cache breakpoint — what every arm on one example saw beyond the article. */
export function lastPartText(request: AiRequestBody): string {
  const messages = request.messages as OpenRouterMessage[];
  const user = messages[messages.length - 1];
  if (!user || typeof user.content === "string") throw new Error("no user parts");
  const parts = user.content as Part[];
  const last = parts[parts.length - 1];
  if (!last) throw new Error("no last part");
  return last.text;
}

/** The system prompt the request carries. */
export function systemText(request: AiRequestBody): string {
  const m = (request.messages as OpenRouterMessage[])[0];
  if (!m || m.role !== "system" || typeof m.content !== "string") throw new Error("no system prompt");
  return m.content;
}

/** The cached part's text (the article part), for prefix sizes. */
export function articlePartText(request: AiRequestBody): string {
  const messages = request.messages as OpenRouterMessage[];
  const user = messages[messages.length - 1];
  if (!user || typeof user.content === "string") throw new Error("no user parts");
  const first = (user.content as Part[])[0];
  if (!first?.cache_control) throw new Error("the first user part carries no cache breakpoint");
  return first.text;
}

/* ------------------------------------------------------------ the check -- */

/** The instruction after Luna's draft, verbatim from the plan § The Opus check. */
export const CHECK_INSTRUCTION =
  'Check the draft against the article and the evidence above. Reply with JSON only: {"action":"keep"} if it is accurate, uses the sources faithfully and answers the reader well; otherwise {"action":"replace","answer":"…"} with the corrected answer in full, ready for the reader.';

/** Fence for the draft — src/untrusted-fence.ts, imported by the caller to keep this file free of src values. */
export type Fence = (kind: string, body: string) => string;

/**
 * **The checker's request**: the Opus arm's own request (same system prompt,
 * same article part, so the same cached prefix), with Luna's draft fenced and
 * the instruction appended to its last part.
 */
export function checkRequest(opusRequest: AiRequestBody, draft: string, fence: Fence): AiRequestBody {
  const messages = lastPartEdited(
    opusRequest.messages as OpenRouterMessage[],
    (t) => `${t}\n\nA DRAFT ANSWER, WRITTEN BY ANOTHER MODEL\n\n${fence("draft answer", draft)}\n\n${CHECK_INSTRUCTION}`,
  );
  return { ...opusRequest, messages } as AiRequestBody;
}

export type CheckVerdict = { action: "keep" } | { action: "replace"; answer: string };

/**
 * **The checker's reply, validated** (Sol F4): exactly `{"action":"keep"}` or
 * `{"action":"replace","answer":"<non-empty>"}`, optionally inside one
 * ```json fence. Anything else — prose, an extra key, an empty answer, an
 * `OK` — is `null`, a failed press, never silently the reader's answer.
 */
export function readCheckVerdict(text: string): CheckVerdict | null {
  let t = text.trim();
  const fenced = /^```(?:json)?\s*\n([\s\S]*?)\n?```$/.exec(t);
  if (fenced?.[1] !== undefined) t = fenced[1].trim();
  let v: unknown;
  try {
    v = JSON.parse(t);
  } catch {
    return null;
  }
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const keys = Object.keys(o).sort().join(",");
  if (o.action === "keep" && keys === "action") return { action: "keep" };
  if (o.action === "replace" && keys === "action,answer" && typeof o.answer === "string" && o.answer.trim() !== "") {
    return { action: "replace", answer: o.answer.trim() };
  }
  return null;
}
