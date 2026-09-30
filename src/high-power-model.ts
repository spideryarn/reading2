/**
 * **The high-power model's two literals, in a leaf.** src/models.ts re-exports
 * them and is where they are explained (§ `HIGH_POWER_MODEL`); they live here
 * only because src/ai-call.ts needs `isHighPowerModel` for its effort seam, and
 * importing src/models.ts from there closes a cycle through src/embeddings.ts
 * that `npm run cycles` gates on. Plan 260930f.
 */

/** The stored **name** — what a `generator` stamp says when Opus wrote it. */
export const HIGH_POWER_MODEL = "claude-opus-5-5";
/** The OpenRouter **address** — what goes on the wire. Dashes above, a dot here. */
export const HIGH_POWER_MODEL_OPENROUTER = "anthropic/claude-opus-5.5";

/** Is this id — either spelling — the high-power model? For the two effort seams. */
export function isHighPowerModel(modelId: string): boolean {
  return modelId === HIGH_POWER_MODEL || modelId === HIGH_POWER_MODEL_OPENROUTER;
}
