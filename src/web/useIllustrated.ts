/**
 * **Fetching the painted plates, and asking for them when there are none.**
 *
 * Shaped on [`useSketch.ts`](./useSketch.ts), which is the nearest neighbour:
 * one GET, the two verbs `ensure` and `regenerate`, ordering from
 * [`useOrderedRead`](./useOrderedRead.ts), the job from
 * [`useStepJob`](./useStepJob.ts) and the one automatic attempt from
 * [`useAutoRun`](./useAutoRun.ts). Everything those files say about a 404 being
 * the ordinary case, about a failed revalidation not being allowed to blank a
 * good artefact, and about why `ensure` and `regenerate` are two verbs rather
 * than one with a flag, applies here for the same reasons and is not repeated.
 *
 * ## Two things are different, and both come from the same fact
 *
 * Illustrated is the only surface in this app whose artefact was made from
 * **another artefact** (docs/project/diagram.md § Illustrated), and that shows
 * up twice.
 *
 * **The plates are re-validated on arrival, and the scene order comes from the
 * artefact itself.** `readStoredIllustrated` wants `sceneIds` — normally
 * `platedScenes(sketch).map(s => s.id)` — and the browser has no Sketch. It
 * would be easy to fetch one and hand its ids over, and it would be wrong: a
 * Sketch redrawn since the painting has different scene ids, so every stored
 * plate would be dropped as *"no scene in the Sketch has that id"* and a
 * picture already paid for would vanish from the band. The stored order was
 * established server-side against the real Sketch at the time it was written,
 * so **for a stored artefact its own plate order is the Sketch's order**. What
 * that costs is the unknown-scene check, which has nothing left to say about
 * our own file; what it keeps is the check the browser is actually here to make
 * — every vignette's block id against *this* article's ids, and every quote
 * against that block's own text, so no row in the *what it depicts* list can
 * jump somewhere that does not contain what the reader just read.
 *
 * **And the empty state has three refusals to tell apart, not one.** The step
 * refuses when the Sketch is absent, stale, or drawn for a different reader
 * profile (`illustrated` in src/pipeline.ts), always before anything is spent —
 * so offering a button that will certainly fail is a $0.00 lie rather than an
 * expensive one, but a lie. `useSketchReadiness` below asks the Sketch's own
 * route which of the three it is, and it is asked **only when there is nothing
 * to show**, because that is the only moment the answer changes what the reader
 * is offered.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  type Illustrated,
  type IllustratedFault,
  readStoredIllustrated,
} from "../illustrated-plate.js";
import type { Block, BlockId, IllustratedResponse, Job, SketchResponse } from "../types.js";
import { apiFetch, readJson } from "./lib/api.js";
import { useAutoRun } from "./useAutoRun.js";
import { useOrderedRead } from "./useOrderedRead.js";
import { type StepFailure, useStepJob } from "./useStepJob.js";

export type IllustratedStatus = "loading" | "ready" | "none" | "error";

/**
 * **Whether pressing the button would buy anything**, and if not, which of the
 * three refusals it is.
 *
 * A discriminated union rather than three booleans, because exactly one of them
 * is true at a time and the panel says a different sentence for each. `unknown`
 * is its own member and not folded into `ready`: the Sketch's route failed, we
 * genuinely cannot tell, and the honest thing is to offer the button and let
 * the server answer rather than to refuse on a guess.
 */
export type SketchReadiness =
  | { kind: "checking" }
  | { kind: "ready" }
  | { kind: "absent" }
  | { kind: "stale" }
  | { kind: "profile-changed" }
  | { kind: "unknown" };

export interface UseIllustrated {
  status: IllustratedStatus;
  /** Validated and safe to show, or `null` when there is none. */
  illustrated: Illustrated | null;
  /** What `readStoredIllustrated` refused, so the panel can say rows are missing. */
  faults: IllustratedFault[];
  /** The Sketch moved underneath these plates — or moved underneath itself. */
  stale: boolean;
  /** We would paint it differently now — the prompt has moved on. */
  outdated: boolean;
  /** It was painted from a Sketch drawn for a reader profile. */
  profiled: boolean;
  /** …and you are not that reader any more. */
  profileChanged: boolean;
  /** Whether the button would be refused, and why. See `SketchReadiness`. */
  sketch: SketchReadiness;
  slug: string;
  error: string | null;
  job: Job | null;
  /**
   * The failure, with the two things a surface has to know about it.
   *
   * A bare `string | null` until 2026-09-03, when `StepFailure` grew `retryable`
   * and `retry` so the band and the shelf card could not give two answers about
   * one job — `useStepJob.ts` § `StepFailure`. This is passed straight to
   * `JobProgress`, so following that type is what keeps them one answer here too.
   */
  failed: StepFailure | null;
  /** This tab can see the job on screen and cannot move it. `StepJob.stalled`. */
  stalled: boolean;
  /** The POST has gone and the queue has not seen it yet. `StepJob.starting`. */
  starting: boolean;
  /** The run in flight was started automatically. */
  automatic: boolean;
  /**
   * **Paint it if nobody has** — unforced, for the automatic run and for the
   * button in the empty state.
   *
   * The two verbs are two because `work_key` includes `force`: a forced press
   * landing inside an unforced automatic start is a second key, is not
   * de-duplicated, and buys a second four-to-seven-minute, $0.40–$0.65 job.
   * useSketch.ts § `ensure` has the longer version.
   */
  ensure(): Promise<void>;
  /**
   * **Paint it again** — forced, offered beside a picture that is already
   * there, where an unforced run would skip while the reader watched a job
   * change nothing. Safe to force because `illustrated` is in
   * `FORCE_ONLY_WHEN_NAMED` and is last in `STEP_ORDER`, so nothing else is
   * swept in with it.
   */
  regenerate(): Promise<void>;
  /**
   * **Draw the Sketch, then paint it** — one job holding both steps, for the
   * three states in which painting alone would be refused.
   *
   * The chain is the server's: `STEP_ORDER` puts `illustrated` immediately after
   * `sketch`, so a job naming both draws before it paints (src/pipeline.ts), and
   * `stepIsDone` is what decides whether the Sketch half runs at all. That last
   * part is the load-bearing one for `stale` and `profile-changed`, where the
   * Sketch has to be **re-drawn rather than adopted**: the sketch step's stamp
   * is read out of the artefact's own `sourceHash` and `profileHash`, which are
   * the same two fields the route reports `stale` and `profileChanged` from — so
   * a Sketch the panel calls out of date is a Sketch the step cannot call
   * current. Asserted rather than assumed:
   * tests/illustrated-step-registration.test.ts § one press that draws and then
   * paints.
   *
   * **Unforced — and the reason this said until 2026-09-03 was wrong in every
   * clause.** It read: *"a force would name `sketch`, and forcing a step forces
   * every step after it, so a Sketch that is genuinely current would be redrawn
   * at $0.20 for nothing"*. GPT Sol checked it against the code:
   *
   *  - a force from here names **`illustrated`**, never `sketch` —
   *    `useStepJob.start` sends `force: [step]`, its own step, and nothing
   *    widens it (src/web/useStepJob.ts § `precededBy`);
   *  - `sketch` is *before* `illustrated`, and `cascadeForce` (src/jobs.ts)
   *    starts at the first forced name and looks only at what follows it, so
   *    nothing this button can send would sweep the Sketch in;
   *  - and it could not be swept in even from further back: **both** steps are
   *    in `FORCE_ONLY_WHEN_NAMED` (src/pipeline.ts), the set the positional
   *    cascade is not allowed to speak for. `regenerate` above says this
   *    correctly about `illustrated`; the same is true of `sketch`.
   *
   * So the Sketch half is unforced whichever way this button goes, and
   * `stepIsDone` is the only thing deciding whether it is redrawn — which is
   * the paragraph above, and that part was right.
   *
   * **What unforced actually buys is de-duplication of the painting half.**
   * `work_key` is computed over the request with `force` in it (`workKeyFor`,
   * src/jobs.ts), so a forced press and an unforced one are two keys and two
   * $0.40–$0.65 jobs: two tabs, or a press either side of a poll, and the reader
   * pays twice — `ensure` above, at length. There is nothing for a force to
   * overcome here in any case, because this verb is offered only from the empty
   * state, where there is no painting for the step to skip. Narrower than the
   * sentence it replaces, and true.
   */
  drawThenPaint(): Promise<void>;
  cancel(id: string): void;
}

/**
 * **No profile argument on either verb, and that is not an omission.**
 *
 * Every other panel's `ensure` takes `useProfile` because the artefact records
 * what it was run with. This step passes `profile: null` to the brief call and
 * inherits `profileHash` from the Sketch (src/pipeline.ts § illustrated), so a
 * tickbox here would be a control with no effect on the picture — and worse
 * than no control, because it would imply the personalisation is this stage's
 * when it is the Sketch's. The panel states the inherited fact instead.
 */
export function useIllustrated(slug: string, blocks: readonly Block[]): UseIllustrated {
  const [status, setStatus] = useState<IllustratedStatus>("loading");
  const [illustrated, setIllustrated] = useState<Illustrated | null>(null);
  const [faults, setFaults] = useState<IllustratedFault[]>([]);
  const [stale, setStale] = useState(false);
  const [outdated, setOutdated] = useState(false);
  const [profiled, setProfiled] = useState(false);
  const [profileChanged, setProfileChanged] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * **Keyed on the ids, and the prose is read through a ref.**
   *
   * `blocks` is derived in the caller, so a new array arrives on every render
   * of the panel; depending on its reference would re-fetch the picture a few
   * times a second while the reader scrolled. `useSketch` solves this by
   * joining the ids into a string and rebuilding the list from it — which works
   * there because the ids are all it needs. This reader also needs each block's
   * **text**, to check that a quote really occurs in the block its row jumps
   * to, and text does not go in a dependency key. So the ids decide *when* to
   * re-read and the ref supplies *what to read against*, which is the same pair
   * of answers by a different route.
   */
  const order = blocks.map((b) => b.id).join(",");
  const latest = useRef(blocks);
  latest.current = blocks;

  // biome-ignore lint/correctness/useExhaustiveDependencies: `order` is the trigger and not an input — the ids decide WHEN to re-read, and `latest.current` supplies what to read against. Removing it, as the rule suggests, would leave the picture validated against the article it arrived with for ever.
  const load = useCallback(async (current: () => boolean) => {
    try {
      const res = await apiFetch(`/api/illustrated/${encodeURIComponent(slug)}`);
      if (!current()) return;
      if (res.status === 404) {
        // The ordinary case: `illustrated` is off DEFAULT_INGEST_STEPS, so most
        // articles have never had one painted. This is what the button is for.
        setIllustrated(null);
        setFaults([]);
        setStale(false);
        setOutdated(false);
        setProfiled(false);
        setProfileChanged(false);
        setError(null);
        setStatus("none");
        return;
      }
      const loaded = await readJson<IllustratedResponse>(res);
      if (!current()) return;

      const blockText = new Map<BlockId, string>(latest.current.map((b) => [b.id, b.text]));
      const { illustrated: checked, report } = readStoredIllustrated(loaded.illustrated, {
        blockText,
        /* The artefact's own order — see the header for why it is not the
           Sketch's. Read off the raw JSON rather than off `checked`, because
           `checked` is the thing this list is an input to. */
        sceneIds: storedSceneIds(loaded.illustrated),
      });

      /* **No plate is "none", not "ready".** Both stores refuse to serve an
         empty plate list and the step refuses to write one, so reaching here
         means something got past both — an import, a hand-edited column, a
         schema from before the union existed. A panel that took it as `ready`
         would draw an empty band and report success. */
      if (checked.plates.length === 0) {
        setIllustrated(null);
        setFaults(report.faults);
        setStatus("none");
        setError(null);
        return;
      }

      setIllustrated(checked);
      setFaults(report.faults);
      setStale(loaded.stale);
      setOutdated(loaded.outdated);
      /* `!= null` rather than truthiness: the field is `string | null |
         undefined` and only `null` and absent mean "painted from a Sketch that
         had no profile". */
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

  const { reload, refresh } = useOrderedRead(load);

  useEffect(() => {
    void reload();
  }, [reload]);

  const queue = useStepJob(slug, "illustrated", refresh);

  const ensure = useCallback(async () => {
    await queue.start();
  }, [queue]);
  const regenerate = useCallback(async () => {
    await queue.start({ force: true });
  }, [queue]);
  const drawThenPaint = useCallback(async () => {
    await queue.start({ precededBy: ["sketch"] });
  }, [queue]);

  /* Asked only when there is nothing to show — see the header. Re-asked when an
     Illustrated job ends, because a refusal is itself evidence the Sketch is
     not what this hook last thought it was. */
  const sketch = useSketchReadiness(
    slug,
    status === "none",
    `${queue.failed ?? ""} ${queue.job?.id ?? ""}`,
  );

  /**
   * **The automatic run waits for the Sketch, and this is a paid bug's fix
   * rather than tidiness.**
   *
   * `useAutoRun` reads one status and does three different things with it:
   * `"loading"` waits, `"none"` spends, and anything else consumes the press
   * without spending. Handed this hook's own `status` alone it spends the
   * moment the artefact 404s — **before `useSketchReadiness` has answered** —
   * so a press made while a `sketch` job is still drawing enqueues an
   * Illustrated job that is refused today and, once the Sketch lands, is
   * accepted and billed. GPT Sol, 2026-09-03:
   *
   * > This is worse than a harmless preflight POST: the server checks
   * > prerequisites when the queued job executes, not when it is enqueued.
   *
   * So readiness is folded into the status the press is judged against:
   *
   * | this hook | the Sketch | handed to `useAutoRun` | what happens |
   * |---|---|---|---|
   * | not `none` | not asked | the status itself | unchanged |
   * | `none` | `checking` | `"loading"` | the press waits, unspent |
   * | `none` | `ready` / `unknown` | `"none"` | the one automatic run |
   * | `none` | a refusal | `"ready"` | the press is retired, nothing spent |
   *
   * The last row is the load-bearing one: `"ready"` makes `useAutoRun` consume
   * the token and return, which is exactly *this press is answered and it
   * bought nothing*. Leaving it armed would fire it at the next status change.
   */
  const gate: IllustratedStatus =
    status !== "none"
      ? status
      : sketch.kind === "checking"
        ? "loading"
        : sketch.kind === "ready" || sketch.kind === "unknown"
          ? "none"
          : "ready";

  /* **Armed by the Illustrated chip, not by opening Diagram.** Opening the mode
     costs nothing; picking this picture is the gesture that spends, and it
     spends more than any other press in the app. src/web/DiagramPanel.tsx. */
  const auto = useAutoRun(slug, "illustrated", gate, ensure, reload);

  return {
    status,
    illustrated,
    faults,
    stale,
    outdated,
    profiled,
    profileChanged,
    sketch,
    slug,
    error,
    job: queue.job,
    failed: queue.failed,
    stalled: queue.stalled,
    starting: queue.starting,
    automatic: auto && (queue.job !== null || queue.starting),
    ensure,
    regenerate,
    drawThenPaint,
    cancel: queue.cancel,
  };
}

/**
 * The scene ids a stored artefact claims, in the order it stored them.
 *
 * Deliberately trusting and deliberately tiny: `readStoredIllustrated` does all
 * the checking, and everything this hands it is checked again by it — a plate
 * whose `sceneId` is missing or duplicated is dropped there, with a fault. What
 * this must not do is *invent* an order, which is the failure the header
 * describes.
 */
function storedSceneIds(raw: unknown): string[] {
  if (typeof raw !== "object" || raw === null) return [];
  const plates = (raw as { plates?: unknown }).plates;
  if (!Array.isArray(plates)) return [];
  const ids: string[] = [];
  for (const p of plates) {
    const id = (p as { sceneId?: unknown })?.sceneId;
    if (typeof id === "string" && id.trim() && !ids.includes(id.trim())) ids.push(id.trim());
  }
  return ids;
}

/**
 * **Would the step refuse, and why** — the Sketch's own route, read for its
 * three flags rather than for its picture.
 *
 * One `fetch` and no job machinery, which is the whole reason this is not
 * `useSketch`: that hook holds a `useStepJob` subscription and a `useAutoRun`
 * for `sketch`, so mounting it here would poll a second queue and could spend a
 * *Sketch* activation token that the reader armed before they moved to this
 * chip. What is wanted is four fields off one GET.
 *
 * `enabled` rather than an early return, because hooks cannot be conditional:
 * the request is what is skipped, not the hook.
 *
 * **`again` is a re-ask, and it exists because this is otherwise a one-shot
 * snapshot.** A Sketch drawn, or gone stale, after this answered would leave the
 * panel offering a button the server now refuses — or, worse, hiding one it now
 * allows. The caller passes a string that changes whenever an Illustrated job
 * ends, which is the moment we have direct evidence the answer may have moved.
 * A Sketch finishing in another tab is **not** covered: switching chips remounts
 * this and re-asks, and polling a second artefact every eight seconds to catch
 * the rest is a cost this mode has not earned. GPT Sol, 2026-09-03.
 */
function useSketchReadiness(slug: string, enabled: boolean, again: string): SketchReadiness {
  const [state, setState] = useState<SketchReadiness>({ kind: "checking" });

  // biome-ignore lint/correctness/useExhaustiveDependencies: `again` is the trigger and not an input — see the header. Removing it, as the rule would, turns this back into the one-shot snapshot the re-ask exists to fix.
  useEffect(() => {
    if (!enabled) {
      setState({ kind: "checking" });
      return;
    }
    /* The article may change, or the reader may move to another chip, while
       this is in flight. Same guard `useOrderedRead` makes for the artefact
       reads; this one is small enough not to need the whole mechanism. */
    let live = true;
    void (async () => {
      try {
        const res = await apiFetch(`/api/sketch/${encodeURIComponent(slug)}`);
        if (!live) return;
        if (res.status === 404) {
          setState({ kind: "absent" });
          return;
        }
        const loaded = await readJson<SketchResponse>(res);
        if (!live) return;
        /* **Stale before profile**, because that is the order `run` checks them
           in (src/pipeline.ts) and a reader told to fix the second one first
           would fix it and be refused for the first. */
        if (loaded.stale) setState({ kind: "stale" });
        else if (loaded.profileChanged) setState({ kind: "profile-changed" });
        else setState({ kind: "ready" });
      } catch {
        /* Not `absent`: a network failure is not evidence there is no Sketch,
           and the two lead the reader to opposite places. */
        if (live) setState({ kind: "unknown" });
      }
    })();
    return () => {
      live = false;
    };
  }, [slug, enabled, again]);

  return state;
}
