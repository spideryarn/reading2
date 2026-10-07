/**
 * What a Codex bucket and window are called, in one place for the live card,
 * the per-account sections and the 24-hour chart.
 */

/** The one Codex bucket that is about the whole subscription rather than one model. */
export function isGeneralCodexBucket(limitId: string): boolean {
  return limitId === "codex";
}

/** A Codex window is named by its duration; the slot is only a position in the payload. */
export function codexWindowLabel(window: { windowMinutes: number | null; slot: "primary" | "secondary" }): string {
  if (window.windowMinutes === 300) return "5 hours";
  if (window.windowMinutes === 10_080) return "7 days";
  if (window.windowMinutes !== null) return `${window.windowMinutes.toLocaleString("en-GB")} minutes`;
  return `${window.slot} window (duration unknown)`;
}
