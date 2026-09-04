/**
 * **Fetching the Sketch picture, and asking for one when there is none.**
 *
 * Shaped on [`useIdeas.ts`](./useIdeas.ts), which is the nearest neighbour:
 * one GET, the two verbs `ensure` and `regenerate`, and the job half delegated
 * to [`useStepJob`](./useStepJob.ts). Everything that file says about a 404 being
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
import { useAutoRun } from "./useAutoRun.js";
import { useOrderedRead } from "./useOrderedRead.js";
import { type StepFailure, useStepJob } from "./useStepJob.js";

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
  failed: StepFailure | null;
  /**
   * This tab can see the job on screen and cannot move it. A pass-through:
   * `StepJob.stalled` in src/web/useStepJob.ts carries the reasoning, and
   * src/job-state.ts § Transport health is not a job state carries why it is
   * not on the record.
   */
  stalled: boolean;
  /** The POST has gone and the queue has not seen it yet. `StepJob.starting`. */
  starting: boolean;
  /** The run in flight was started automatically. `UseIdeas.automatic`. */
  automatic: boolean;
  /**
   * **Draw it if nobody has** — unforced, for the automatic run and for the
   * button in the empty state.
   *
   * There was no unforced entry point at all until 2026-09-02, because the only
   * caller was a button and forcing was right for it. It is wrong for the two
   * of them together: `work_key` includes `force`, so a forced press landing
   * during an unforced automatic start is a second key and a second two-minute,
   * $0.20 job. useIdeas.ts § `ensure`.
   */
  ensure(useProfile?: boolean): Promise<void>;
  /**
   * **Draw it again** — forced, for a redraw offered beside a picture that is
   * already there, where an unforced run would skip while the reader watched a
   * two-minute job change nothing. Safe to force because the step replaces
   * rather than appends, and `sketch` is in `FORCE_ONLY_WHEN_NAMED` so nothing
   * else is swept in with it.
   */
  regenerate(useProfile?: boolean): Promise<void>;
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

  /* Two verbs, split on `force`. See the interface above, and useIdeas.ts. */
  const ensure = useCallback(
    async (useProfile = true) => {
      await queue.start({ useProfile });
    },
    [queue],
  );
  const regenerate = useCallback(
    async (useProfile = true) => {
      await queue.start({ force: true, useProfile });
    },
    [queue],
  );

  /* **Armed by the Sketch chip, not by opening Diagram.** Opening the mode
     costs nothing and lands on a picture drawn from the tree; picking this
     picture is the gesture that spends. src/web/DiagramPanel.tsx. */
  const auto = useAutoRun(slug, "sketch", status, ensure, reload);

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
    starting: queue.starting,
    automatic: auto && (queue.job !== null || queue.starting),
    ensure,
    regenerate,
    cancel: queue.cancel,
  };
}

/**
 * **The drawn picture's caption, for something that is not the picture.**
 *
 * One line of text, no job machinery and no `useAutoRun` — which is the whole
 * reason this is not `useSketch` with the rest thrown away. A second
 * `useSketch` on the page would be a second auto-runner: mounted with the
 * activation token armed, both instances would call `ensure`, and `ensure`
 * buys a two-minute, $0.20 model call. A hover card must not be able to reach
 * that.
 *
 * The caller is the Sketch chip's hover card in
 * [`DiagramPanel.tsx`](./DiagramPanel.tsx). Greg asked for the caption there
 * after meeting it as an SVG `<title>` over the whole picture
 * (`SketchView.tsx` § no `<title>` here), and a chip on a row the reader is
 * reading along is the opposite of that: it says what *this* article's picture
 * turned out to be, once, where the reader is choosing between pictures.
 *
 * **Read straight off the wire, not through `readSketch`.** That function's job
 * is to refuse coordinates and block ids that no longer mean anything against
 * this article, and it needs the block order to do it; a caption is a sentence
 * rendered as text by React, so there is nothing here for it to check. Hence
 * the narrow cast and the `typeof` — the field is `unknown` on the wire and
 * this is the one thing being asked of it.
 *
 * **No `enabled` argument, unlike `useSimilar` and `useProjection`.** Theirs
 * gate a purchase; there is nothing here to gate. The version that shipped
 * first took `kind !== "sketch"`, on the reasoning that while Sketch is the
 * picture on screen `SketchView` is reading the same artefact anyway — and that
 * bought one duplicate free GET at the price of two real faults: the same chip
 * gave a different card depending on which picture was up, and the reset below
 * blanked the caption on the way back, so a card opened in that window grew a
 * paragraph a moment later. ⟨Fable, code review⟩, 2026-09-03. `useProjection`
 * § *not cleared when `enabled` goes false* is the same lesson from the other
 * direction.
 *
 * So: one GET per article per Diagram open, and the only thing that clears the
 * text is arriving at a different article.
 */
export function useSketchCaption(slug: string | null): string | null {
  const [caption, setCaption] = useState<string | null>(null);

  useEffect(() => {
    setCaption(null);
    /**
     * **`null` means issue no request at all**, and it is the visitor's arm.
     *
     * This hook took a bare `string` until 2026-09-04 and had no `enabled`
     * argument, because for an owner there is no purchase to gate — the
     * reasoning is a few lines up and still holds. A visitor's diagram panel
     * changed that: `/api/sketch/:slug` is behind the auth gate, so an
     * anonymous mount is a 401 per diagram open and a request the public
     * reading feature's acceptance test forbids outright.
     *
     * **Not "catch the 401 and carry on"**, which is what the `catch` below
     * would have done, quietly and correctly-looking. That is the shape
     * docs/reusable/silent-success.md is about: right answer, wrong reasoning,
     * and it stops being the right answer the day the gate moves. Same
     * treatment, and the same argument, as the experimental-features store —
     * docs/project/experimental-features.md § A signed-out reader is off,
     * because we decided.
     */
    if (slug === null) return;
    let live = true;
    void (async () => {
      try {
        const res = await apiFetch(`/api/sketch/${encodeURIComponent(slug)}`);
        // 404 is the ordinary case — most articles have never had one drawn.
        if (!live || res.status === 404) return;
        const loaded = await readJson<SketchResponse>(res);
        if (!live) return;
        const drawn = loaded.sketch as { caption?: unknown } | null;
        const text = typeof drawn?.caption === "string" ? drawn.caption.trim() : "";
        if (text !== "") setCaption(text);
      } catch {
        // A caption on a hover card is a nicety. Nothing is broken without it,
        // and there is no surface here to say so on.
      }
    })();
    return () => {
      live = false;
    };
  }, [slug]);

  return caption;
}
