/**
 * **Fetching the Sketch picture, and asking for one when there is none.**
 *
 * Shaped on [`useIdeas.ts`](./useIdeas.ts), which is the nearest neighbour:
 * one GET, one verb, and the job half delegated to
 * [`useStepJob`](./useStepJob.ts). Everything that file says about a 404 being
 * the ordinary case, and about a failed revalidation not being allowed to blank
 * a good artefact, applies here for the same reasons and is not repeated.
 *
 * ## What is different, and it is the whole reason this file is not three lines
 *
 * **The scene is validated here, in the browser, on arrival.** Every other
 * panel is handed an artefact and renders it. This one is handed a set of
 * coordinates that only mean anything against the article they were drawn for —
 * and the artefact may have been written by an older schema, or against an
 * article whose block ids have since moved. So `readSketch` runs at ingress,
 * exactly as `sanitizeArticle` does in `App.tsx`: not at the sink, where four
 * different components would each have to remember.
 *
 * What it drops is the *unreachable*, never the picture: an unknown block id
 * costs a node its click and leaves the node, and the count of what went comes
 * back on `faults` so a reader can be told the picture is older than the
 * article rather than quietly given a diagram whose clicks do nothing.
 *
 * That the same function runs on the server before writing is not a duplicate.
 * It is the same rule applied at both ends of a wire that has a database and a
 * year in the middle of it.
 */
import { useCallback, useEffect, useState } from "react";
import { readSketch, type Sketch, type SketchFault } from "../sketch-scene.js";
import type { BlockId, Job, SketchResponse } from "../types.js";
import { apiFetch, readJson } from "./lib/api.js";
import { useHasProfile } from "./useProfile.js";
import { useOrderedRead } from "./useOrderedRead.js";
import { useStepJob } from "./useStepJob.js";

export type SketchStatus = "loading" | "ready" | "none" | "error";

export interface UseSketch {
  status: SketchStatus;
  /** Validated and safe to paint, or `null` when there is none. */
  sketch: Sketch | null;
  /** What `readSketch` refused, so the panel can say the picture is out of date. */
  faults: SketchFault[];
  /** The article moved underneath the picture. */
  stale: boolean;
  /** We would draw it differently now — the prompt has moved on. */
  outdated: boolean;
  /** It was drawn for a reader profile. */
  profiled: boolean;
  /** …and you are not that reader any more. */
  profileChanged: boolean;
  hasProfile: boolean;
  slug: string;
  error: string | null;
  job: Job | null;
  failed: string | null;
  /**
   * This tab can see the job on screen and cannot move it. A pass-through:
   * `StepJob.stalled` in src/web/useStepJob.ts carries the reasoning, and
   * src/job-state.ts § Transport health is not a job state carries why it is
   * not on the record.
   */
  stalled: boolean;
  /** Draw it — the only verb, and always forced. See `find` below. */
  draw(useProfile?: boolean): Promise<void>;
  cancel(id: string): void;
}

export function useSketch(slug: string, blockOrder: readonly BlockId[]): UseSketch {
  const [status, setStatus] = useState<SketchStatus>("loading");
  const [sketch, setSketch] = useState<Sketch | null>(null);
  const [faults, setFaults] = useState<SketchFault[]>([]);
  const [stale, setStale] = useState(false);
  const [outdated, setOutdated] = useState(false);
  const [profiled, setProfiled] = useState(false);
  const [profileChanged, setProfileChanged] = useState(false);
  const hasProfile = useHasProfile(slug);
  const [error, setError] = useState<string | null>(null);

  /**
   * **Keyed on the ids, not on the array.** `blockOrder` is derived in the
   * caller, so a new array arrives on every render of the panel; depending on
   * the reference would re-fetch the picture a few times a second while the
   * reader scrolled. The join is the thing that actually decides what
   * `readSketch` will do.
   */
  const order = blockOrder.join(",");

  /**
   * The read itself — the parse, the 404 branch and the error copy, which are
   * this mode's own. `current()` after every `await`, before any state is
   * set: false means this reply is about an article, or an artefact, the hook
   * has since moved on from. See src/web/useOrderedRead.ts.
   */
  const load = useCallback(async (current: () => boolean) => {
    try {
      const res = await apiFetch(`/api/sketch/${encodeURIComponent(slug)}`);
      if (!current()) return;
      if (res.status === 404) {
        // The ordinary case, not a fault: `sketch` is off DEFAULT_INGEST_STEPS,
        // so most articles have never had one drawn. This is what the button is
        // for.
        setSketch(null);
        setFaults([]);
        setStale(false);
        setOutdated(false);
        setProfiled(false);
        setProfileChanged(false);
        setError(null);
        setStatus("none");
        return;
      }
      const loaded = await readJson<SketchResponse>(res);
      if (!current()) return;
      const ids = order ? (order.split(",") as BlockId[]) : [];
      const { sketch: checked, report } = readSketch(loaded.sketch, { blockOrder: ids });

      /* **An empty scene list is "none", not "ready".** The server refuses to
         write one and both stores refuse to serve one, so reaching here means
         something got past both — an import, a hand-edited column, a schema
         from before `accept` existed. A panel that took it as `ready` would
         draw an empty band and report success, which is the failure this whole
         feature keeps having to be defended against. */
      if (checked.scenes.length === 0) {
        setSketch(null);
        setFaults(report.faults);
        setStatus("none");
        setError(null);
        return;
      }

      setSketch(checked);
      setFaults(report.faults);
      setStale(loaded.stale);
      setOutdated(loaded.outdated);
      /* `!= null` rather than truthiness: the field is `string | null |
         undefined` and only `null` and absent mean "drawn without one". */
      setProfiled(checked.profileHash != null);
      setProfileChanged(loaded.profileChanged);
      setError(null);
      setStatus("ready");
    } catch (err) {
      if (!current()) return;
      setError((err as Error).message);
      // A failed revalidation must not take the picture away — useIdeas.ts
      // § load has the reasoning, and it is the same one.
      setStatus((was) => (was === "loading" ? "error" : was));
    }
  }, [slug, order]);

  /* **The ordering is not this hook's**: an ordinary `reload` joins the read
     already in flight, a post-job `refresh` trails it rather than racing it, and
     only the newest reply may commit. src/web/useOrderedRead.ts, shared with the
     seven other artefact readers — this one lost that race until 2026-09-02
     (tests/artefact-read-race.test.tsx). */
  const { reload, refresh } = useOrderedRead(load);

  useEffect(() => {
    void reload();
  }, [reload]);

  const queue = useStepJob(slug, "sketch", refresh);

  const draw = useCallback(
    async (useProfile = true) => {
      /* **Always forced**, for the reason `useIdeas.find` gives: the button is
         offered beside a picture that is current, and an unforced run would
         skip while the reader watched a two-minute job change nothing. Safe to
         force because the step replaces rather than appends, and `sketch` is in
         `FORCE_ONLY_WHEN_NAMED` so nothing else is swept in with it. */
      await queue.start({ force: true, useProfile });
    },
    [queue],
  );

  return {
    status,
    sketch,
    faults,
    stale,
    outdated,
    profiled,
    profileChanged,
    hasProfile,
    slug,
    error,
    job: queue.job,
    failed: queue.failed,
    stalled: queue.stalled,
    draw,
    cancel: queue.cancel,
  };
}
