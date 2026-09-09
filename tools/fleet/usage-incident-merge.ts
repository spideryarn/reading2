/**
 * **What an incident is, and how two sightings of one become one — the single
 * home for that rule.**
 *
 * Extracted from `usage-history-record.ts` on 2026-09-09 because it was being
 * implemented **twice**: once there, with its own tests, and once by hand in the
 * browser's `usage-history-series.ts`. The server copy had *no production
 * caller at all* — the exact "tested and wired to nothing" shape this codebase
 * has a postmortem about, and the two would have drifted the first time either
 * was touched.
 *
 * It lives in its own file rather than staying in the record module because the
 * browser has to import it, and the record module reaches for `Buffer` to
 * enforce the line-size ceiling. Nothing here touches Node.
 *
 * ## A stable id is not a merge contract
 *
 * `UsageIncident.id` is `` `${window}@${resetsAt}` `` — derived by the producer,
 * stable across passes. That much makes merging *possible*; it does not say what
 * to do when the same id arrives twice with different contents, which it will:
 * a rejection sits in every five-minute scan until it expires or leaves the
 * eight-day scan window, and the picture gets **richer** as more of it is seen.
 * The card's own committed test constructs exactly that — one rejection on the
 * first pass, two rejections and another conversation on the second.
 *
 * So neither "first wins" nor "last wins" is safe. First-wins permanently
 * under-reports and truncates the span; last-wins lets an incomplete scan
 * replace richer evidence with poorer.
 *
 * ## The rules
 *
 *  - The span widens to the **earliest and latest instants ever observed**.
 *  - Counts come from the largest sighting in a scan that **finished**, falling
 *    back to the largest inconclusive one with `fromConclusiveScan: false` so the
 *    UI can say which it is. **Not "the larger number wins":** the counts are not
 *    comparable across scans of different completeness, because a scan that
 *    stopped early saw *fewer* rejections rather than a corrected number.
 *  - `window` and `resetsAt` must agree across sightings. If they do not, one of
 *    the records is lying about what it observed, and the incident is
 *    `unreadable` rather than resolved by picking a side.
 *
 * An incident whose hits carried no timestamp keeps `firstHitAt: null` and is
 * **listed but unplaced** by whatever draws it. Pinning it to scan time would
 * claim the rejection happened when we happened to look.
 */

/**
 * Narrower than the UI's `UsageIncident`: a conversation **count** rather than
 * the uuid list, which a chart never needs and which is most of the payload.
 */
export type HistoryIncident = {
  id: string;
  window: string;
  resetsAt: string;
  firstHitAt: string | null;
  lastHitAt: string | null;
  rejections: number;
  unidentifiedRejections: number;
  conversations: number;
};

export type MergedIncident = HistoryIncident & {
  /**
   * Whether the counts came from a scan that finished.
   *
   * Counts from disjoint incomplete scans cannot be unioned exactly without raw
   * hit ids, which this format deliberately does not store. That is acceptable
   * only because the UI can say what the number means — "most seen in one
   * complete scan", never "rejections in these 24 hours". This flag is what
   * lets it.
   */
  fromConclusiveScan: boolean;
  /** Two sightings disagreed about an invariant, so neither can be published. */
  unreadable: boolean;
  why: string | null;
};

export type IncidentSighting = {
  /** Whether the scan that produced these finished. */
  conclusive: boolean;
  incidents: readonly HistoryIncident[];
};

type Counts = Pick<HistoryIncident, "rejections" | "unidentifiedRejections" | "conversations">;

/**
 * Which of two sightings supplies the counts.
 *
 * A conclusive sighting always displaces an inconclusive one **even if its count
 * is lower** — an incident's rejections can genuinely fall between passes as
 * transcripts age out of the scan window. Two sightings of the same completeness
 * take the maximum. An inconclusive sighting never overwrites a conclusive one.
 */
function mergeCounts(seen: MergedIncident, incident: HistoryIncident, sightingConclusive: boolean): Counts {
  if (sightingConclusive && !seen.fromConclusiveScan) return incident;
  if (sightingConclusive !== seen.fromConclusiveScan) return seen;
  return {
    rejections: Math.max(seen.rejections, incident.rejections),
    unidentifiedRejections: Math.max(seen.unidentifiedRejections, incident.unidentifiedRejections),
    conversations: Math.max(seen.conversations, incident.conversations),
  };
}

function earlier(a: string | null, b: string | null): string | null {
  if (a === null) return b;
  if (b === null) return a;
  return Date.parse(a) <= Date.parse(b) ? a : b;
}

function later(a: string | null, b: string | null): string | null {
  if (a === null) return b;
  if (b === null) return a;
  return Date.parse(a) >= Date.parse(b) ? a : b;
}

export function mergeIncidents(sightings: readonly IncidentSighting[]): MergedIncident[] {
  const merged = new Map<string, MergedIncident>();
  for (const sighting of sightings) {
    for (const incident of sighting.incidents) {
      const seen = merged.get(incident.id);
      if (seen === undefined) {
        merged.set(incident.id, {
          ...incident,
          fromConclusiveScan: sighting.conclusive,
          unreadable: false,
          why: null,
        });
        continue;
      }
      if (seen.window !== incident.window || seen.resetsAt !== incident.resetsAt) {
        merged.set(incident.id, {
          ...seen,
          unreadable: true,
          why: `two records disagree about this incident: window ${seen.window}/${incident.window}, resets ${seen.resetsAt}/${incident.resetsAt}`,
        });
        continue;
      }
      if (seen.unreadable) continue;
      merged.set(incident.id, {
        ...seen,
        ...mergeCounts(seen, incident, sighting.conclusive),
        firstHitAt: earlier(seen.firstHitAt, incident.firstHitAt),
        lastHitAt: later(seen.lastHitAt, incident.lastHitAt),
        fromConclusiveScan: seen.fromConclusiveScan || sighting.conclusive,
      });
    }
  }
  return [...merged.values()];
}
