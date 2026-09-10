/**
 * Reduce an already-resolved work scan to the bounded shape retained beside a
 * health sample. Checkpoint parsing and inventory attribution happen before
 * this leaf; keeping them out makes replaying one accepted reading pure.
 *
 * **The renderer keys an event by its source discriminant and its source
 * timestamp.** Repeated copies of one `scannedAt` or one `attemptedAt` are one
 * observation, never several.
 */
import type { PaneWork, StoredWork, StoredWorkGroup } from "./wire.js";

export const MAX_STORED_WORK_BYTES = 4 * 1024;
const MAX_STORED_TEXT_CHARS = 512;
const TRUNCATED = "… (truncated for work history)";

export type ResolvedWork =
  | { kind: "scanned"; scannedAt: string; panes: ReadonlyMap<string, PaneWork> }
  | {
      kind: "unavailable";
      source:
        | { kind: "not-yet-run"; asOf: string }
        | { kind: "probe-failed"; attemptedAt: string; sourceCollectedAt: string }
        | { kind: "checkpoint-unavailable"; checkedAt: string };
      why: string;
    };

type RankedWorkGroup = {
  session: string;
  recogniser: string;
  jobs: number;
  knownJobs: number;
  oldestStartedAt: string | null;
  longestRanForMs: number | null;
};

export function boundStoredWorkText(value: string): string {
  return value.length <= MAX_STORED_TEXT_CHARS
    ? value
    : `${value.slice(0, MAX_STORED_TEXT_CHARS)}${TRUNCATED}`;
}

function encodedBytes(value: StoredWork): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function checkpointUnavailable(checkedAt: string, why: string): StoredWork {
  const result: StoredWork = {
    kind: "checkpoint-unavailable",
    checkedAt,
    why: boundStoredWorkText(why),
  };
  if (encodedBytes(result) <= MAX_STORED_WORK_BYTES) return result;
  /* `checkedAt` is an accepted ISO timestamp, so only a future change to this
     small fixed shape can reach the fallback. Measure it anyway: this is the
     last line of defence for the byte contract, not another size estimate. */
  const fallback: StoredWork = {
    kind: "checkpoint-unavailable",
    checkedAt,
    why: "the work summary could not fit the history byte budget after its text was bounded",
  };
  if (encodedBytes(fallback) <= MAX_STORED_WORK_BYTES) return fallback;
  throw new RangeError("the injected work-check clock is not a bounded canonical timestamp");
}

function ascending(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function descendingMeasuredDuration(a: number | null, b: number | null): number {
  if (a === null) return b === null ? 0 : 1;
  if (b === null) return -1;
  return b - a;
}

function timingOf(group: RankedWorkGroup): StoredWorkGroup["timing"] {
  if (
    group.knownJobs === 0 ||
    group.oldestStartedAt === null ||
    group.longestRanForMs === null
  ) return { kind: "unknown" };
  if (group.knownJobs === group.jobs) {
    return {
      kind: "known",
      oldestStartedAt: group.oldestStartedAt,
      longestRanForMs: group.longestRanForMs,
    };
  }
  return {
    kind: "partial",
    knownJobs: group.knownJobs,
    oldestStartedAt: group.oldestStartedAt,
    longestRanForMs: group.longestRanForMs,
  };
}

function projectUnavailable(
  work: Extract<ResolvedWork, { kind: "unavailable" }>,
  checkedAt: string,
): StoredWork {
  /* An unavailable scan is not an empty successful scan. Preserve the
     resolver's own words so the next reader learns what observation failed. */
  const why = boundStoredWorkText(work.why);
  let result: StoredWork;
  switch (work.source.kind) {
    case "not-yet-run":
      result = { kind: "not-yet-run", asOf: work.source.asOf, why };
      break;
    case "probe-failed":
      result = {
        kind: "probe-failed",
        attemptedAt: work.source.attemptedAt,
        sourceCollectedAt: work.source.sourceCollectedAt,
        why,
      };
      break;
    case "checkpoint-unavailable":
      return checkpointUnavailable(work.source.checkedAt, why);
  }
  return encodedBytes(result) <= MAX_STORED_WORK_BYTES
    ? result
    : checkpointUnavailable(checkedAt, "the unavailable work reading could not fit the history byte budget");
}

function groupsForWorkingPane(
  session: string,
  pane: Extract<PaneWork, { kind: "work" }>,
): RankedWorkGroup[] {
  /* One group names one (session key, recogniser), not one process. Two
     sibling `codex exec` jobs are concurrent work under one pane, while the
     descendants hidden below either job were never separate classifier
     results and therefore cannot be double-counted here. */
  const byRecogniser = new Map<string, RankedWorkGroup>();
  for (const item of pane.jobs) {
    const group = byRecogniser.get(item.recogniser);
    if (group === undefined) {
      byRecogniser.set(item.recogniser, {
        session,
        recogniser: item.recogniser,
        jobs: 1,
        knownJobs: item.startedAt === null ? 0 : 1,
        oldestStartedAt: item.startedAt,
        longestRanForMs: item.ranForMs,
      });
      continue;
    }
    group.jobs += 1;
    if (item.startedAt !== null) group.knownJobs += 1;
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
  return [...byRecogniser.values()];
}

function collectGroups(panes: ReadonlyMap<string, PaneWork>): {
  groups: RankedWorkGroup[];
  counts: { work: number; none: number; cannotTell: number };
} {
  const groups: RankedWorkGroup[] = [];
  let panesWork = 0;
  let panesNone = 0;
  let panesCannotTell = 0;
  for (const [session, pane] of panes) {
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
    groups.push(...groupsForWorkingPane(session, pane));
  }
  return {
    groups,
    counts: { work: panesWork, none: panesNone, cannotTell: panesCannotTell },
  };
}

function projectScan(
  work: Extract<ResolvedWork, { kind: "scanned" }>,
  checkedAt: string,
): StoredWork {
  const collected = collectGroups(work.panes);
  const { groups } = collected;
  /* The cap keeps the densest work first, then the longest measured run, then
     the session key so equal measurements do not jump between samples.
     Unknown timing ranks after every measured duration within an equal job
     count: it is not a zero-millisecond run, but there is no evidence for
     ranking it above one whose duration was observed. A recogniser tie-break
     is still needed when two groups share that session. */
  groups.sort((a, b) =>
    b.jobs - a.jobs ||
    descendingMeasuredDuration(a.longestRanForMs, b.longestRanForMs) ||
    ascending(a.session, b.session) ||
    ascending(a.recogniser, b.recogniser));

  /* Bound text AFTER ranking, so truncation cannot change which evidence wins.
     It is visible in each value, rather than quietly turning an identifier into
     a different one. */
  const storedGroups: StoredWorkGroup[] = groups.map((group) => ({
    session: boundStoredWorkText(group.session),
    recogniser: boundStoredWorkText(group.recogniser),
    jobs: group.jobs,
    timing: timingOf(group),
  }));

  let groupsDropped = 0;
  let result: StoredWork = {
    kind: "scan",
    scannedAt: work.scannedAt,
    groups: storedGroups,
    groupsDropped,
    panes: collected.counts,
  };

  /* The budget is on the encoded value, not a group count or a character
     proxy. Re-encode after each drop because `groupsDropped` changes too. */
  while (encodedBytes(result) > MAX_STORED_WORK_BYTES && storedGroups.length > 0) {
    storedGroups.pop();
    groupsDropped += 1;
    result = { ...result, groups: storedGroups, groupsDropped };
  }
  return encodedBytes(result) <= MAX_STORED_WORK_BYTES
    ? result
    : checkpointUnavailable(checkedAt, "the accepted work scan could not fit the history byte budget");
}

/** Project one accepted resolver result without reading a clock or doing I/O. */
export function projectStoredWork(work: ResolvedWork, checkedAt: string): StoredWork {
  return work.kind === "unavailable"
    ? projectUnavailable(work, checkedAt)
    : projectScan(work, checkedAt);
}
