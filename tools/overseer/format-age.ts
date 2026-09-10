/**
 * A duration in the compact vocabulary the Overseer CLI uses.
 *
 * Kept as an import-free leaf because both the long-lived daemon's schedule
 * preview and the file-backed CLI renderer need it. Importing the renderer for
 * this one function pulls its store readers and `scripts/gjd-remote-tmux.ts`
 * into the daemon process.
 */
export function describeAge(ms: number): string {
  if (ms < 0) return "in the future";
  const seconds = Math.round(ms / 1000);
  if (seconds < 90) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) return `${minutes}m`;
  return `${Math.round(minutes / 60)}h`;
}
