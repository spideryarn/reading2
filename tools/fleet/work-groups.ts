/**
 * Reduce an already-resolved work scan to the bounded shape retained beside a
 * health sample. Checkpoint parsing and inventory attribution happen before
 * this leaf; keeping them out makes replaying one accepted reading pure.
 */
import type { PaneWork, StoredWork, StoredWorkGroup } from "./wire.js";

export const MAX_GROUPS = 30;

type ResolvedWork =
  | { kind: "scanned"; scannedAt: string; panes: ReadonlyMap<string, PaneWork> }
  | { kind: "unavailable"; why: string };

function ascending(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Project one accepted resolver result without reading a clock or doing I/O. */
export function projectStoredWork(work: ResolvedWork): StoredWork {
  /* An unavailable scan is not an empty successful scan. Preserve the
     resolver's own words so the next reader learns what observation failed. */
  if (work.kind === "unavailable") return work;

  const groups: StoredWorkGroup[] = [];
  let panesWork = 0;
  let panesNone = 0;
  let panesCannotTell = 0;
  for (const [session, pane] of work.panes) {
    if (pane.kind === "cannot-tell") {
      /* An unreadable pane contributes only uncertainty. Giving it a group or
         letting it fall through to `none` would turn no observation into an
         observation of idleness. */
      panesCannotTell += 1;
      continue;
    }
    if (pane.kind === "none") {
      /* `none` is a positive reading however many processes were inspected:
         the count belongs in this arm, while the pane produces no work group. */
      panesNone += 1;
      continue;
    }
    /* Every map entry increments exactly one arm. That partition is the
       uncertainty sentence the page prints, so it must sum to the map size. */
    panesWork += 1;
    /* One group names one (session key, recogniser), not one process. Two
       sibling `codex exec` jobs are concurrent work under one pane, while the
       descendants hidden below either job were never separate classifier
       results and therefore cannot be double-counted here. */
    const byRecogniser = new Map<string, StoredWorkGroup>();
    for (const item of pane.jobs) {
      const group = byRecogniser.get(item.recogniser);
      if (group === undefined) {
        byRecogniser.set(item.recogniser, {
          session,
          recogniser: item.recogniser,
          jobs: 1,
          oldestStartedAt: item.startedAt,
          longestRanForMs: item.ranForMs,
        });
        continue;
      }
      group.jobs += 1;
      /* Unknown starts do not compete with known ones: the minimum of the
         evidence we do have is still true, without implying the unknown jobs
         began later. */
      if (
        item.startedAt !== null &&
        (group.oldestStartedAt === null || item.startedAt < group.oldestStartedAt)
      ) group.oldestStartedAt = item.startedAt;
      /* `ranForMs` was frozen by the producer at the scan. Taking its maximum
         preserves that measurement; deriving a duration from any clock here
         would make a stale daemon's job keep running in the history. */
      if (
        item.ranForMs !== null &&
        (group.longestRanForMs === null || item.ranForMs > group.longestRanForMs)
      ) group.longestRanForMs = item.ranForMs;
    }
    groups.push(...byRecogniser.values());
  }

  /* The cap keeps the densest work first, then the longest measured run, then
     the session key so equal measurements do not jump between samples. A
     recogniser tie-break is still needed when two groups share that session. */
  groups.sort((a, b) =>
    b.jobs - a.jobs ||
    (b.longestRanForMs ?? -1) - (a.longestRanForMs ?? -1) ||
    ascending(a.session, b.session) ||
    ascending(a.recogniser, b.recogniser));
  /* A bounded list without the remainder count reads as exhaustive. Keep the
     count beside the slice so truncation can never happen silently. */
  const groupsDropped = Math.max(0, groups.length - MAX_GROUPS);

  return {
    kind: "scan",
    scannedAt: work.scannedAt,
    groups: groups.slice(0, MAX_GROUPS),
    groupsDropped,
    panes: { work: panesWork, none: panesNone, cannotTell: panesCannotTell },
  };
}
