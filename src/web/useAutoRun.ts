/**
 * **A mode the reader pressed, with nothing in it, starts itself.**
 *
 * > And let's have a rule that if the user clicks a mode that hasn't been run
 * > yet, automatically run it (rather than requiring them to click a button to
 * > start it running).
 * >
 * > — Greg, 2026-08-31
 *
 * Eleven targets can do this — Glossary, Ideas, Quotes, Timeline and Debate;
 * the Sketch and Illustrated pictures inside Diagram; the Quiz half of Remember;
 * Referee's Claims and Candidates; and the Tweets page — reached by twelve
 * controls, since Diagram's bar button and its Sketch chip both arm the Sketch.
 * This is the whole of it, in one place, because eleven copies of a rule about
 * spending money is eleven chances to get one of them wrong.
 *
 * **Two of them have no job behind them.** `claims` and `candidates` are SSE
 * streams rather than pipeline steps (auto-run-targets.ts), so `ensure` starts
 * a stream instead of enqueuing work. Nothing here notices: this hook asks only
 * *is there anything there* and *did the reader press it*, and the panel decides
 * what running means.
 *
 * ## The three questions, in the order they have to be asked
 *
 *  1. **Did the reader press this, on this screen?** src/web/activation.ts. A
 *     mount is not a press: a pasted `?mode=quotes`, a Back step and a link from
 *     the metadata page all mount a panel with nobody having done anything. And
 *     a press made while a *previous* mount of this panel was on screen is not
 *     this mount's to spend — `claimActivation` is where that is settled, and it
 *     is asked first, before anything else.
 *  2. **Is there nothing there?** The panel's own GET, settled — `status`. The
 *     bar's idea of what exists is a cached fact about somebody else's article
 *     and may be wrong, so it never authorises a paid call.
 *  3. **Has this tab already tried?** `jobEngine.beginAutoAttempt`. One attempt
 *     per `(slug, target)` per session, which is what closes the
 *     generate-fail-generate loop structurally rather than by remembering to set
 *     a flag on every error path. That loop is not hypothetical: it is the bug
 *     the Tweets page's button was written to avoid in 2026-08-25, back when
 *     this hook did not exist, and the reason the button could stop being the
 *     thing that avoids it.
 *
 * The press is consumed once step 2 has an **answer**, whichever answer it is:
 * a `ready` retires it exactly as a `none` spends it.
 *
 * ## A failed read is not an answer
 *
 * `error` is the third thing a GET can do and it is not an answer to *is there
 * anything there* — so the press is **kept**, and the panel is asked to read
 * again. Once per press: the nonce is what changes when the reader presses
 * again, and it is the only thing that makes the effect re-run, so a dead
 * network cannot loop. If the second read comes back empty the press is still in
 * hand and the run starts, which is what pressing a mode means.
 *
 * This is the way out of a failed GET, and there has to be one: Ideas, Quotes
 * and Timeline draw no button at all in their error state, so the bar is the
 * only control the reader has. Before 2026-09-02 the press was retired on
 * `error` and pressing the same mode again did nothing whatever — GPT Sol's
 * second finding. Retiring it was defending against a kept press firing against
 * whatever mounted next, and `owner` now stops that structurally: the only mount
 * that can spend this press is the one still looking at the error.
 *
 * ## Unforced, and the empty-state button must be too
 *
 * `ensure` is the unforced verb, and the button beside the empty state calls
 * the same one. That is not tidiness: `work_key` is computed from the request
 * including its `force`, so an unforced automatic run and a forced button press
 * during the same second are two different requests, `enqueueOrGet` does not
 * collapse them, and the reader pays twice. `regenerate` — forced — is for the
 * button that sits *beside an artefact that already exists*, where an unforced
 * run would skip and the reader would watch a job change nothing.
 *
 * ## What it does not do
 *
 * It never runs for a visitor, and mostly not because of a check here: every
 * hook that calls it mounts under `OwnedReader` — or, for Tweets, under the
 * owner's arm of `OwnedArticle` — and never for a visitor, which is the
 * capability seam the whole reading view uses. The Tweets *link* is the one
 * place that also checks, because the bar itself is drawn for a visitor and a
 * press there would mint a token nothing could ever spend (Dock.tsx). tests/public-network-trace.test.tsx is the measure of
 * that taken from outside.
 *
 * docs/plans/260902e-a-per-article-job-queue-that-appends-and-modes-that-start-themselves.md § 2b–2c.
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  type AutoRunTarget,
  claimActivation,
  consumeActivation,
  pendingActivation,
  subscribeActivations,
} from "./activation.js";
import { jobEngine } from "./jobEngine.js";

/** The four states every one of every read hook that calls this reports. */
export type ArtefactStatus = "loading" | "none" | "ready" | "error";

/**
 * @param ensure the **unforced** run. Held in a ref, so a caller that rebuilds
 *   it every render cannot re-fire the effect — the press is what fires it.
 * @param reread the panel's own artefact GET, for the one case the press cannot
 *   be answered from what is on screen: a read that failed. Held in a ref for
 *   the same reason. See § A failed read is not an answer.
 * @returns whether this mount made the automatic attempt, so the panel can say
 *   *Using your profile* instead of offering a tickbox it has already decided.
 */
export function useAutoRun(
  slug: string,
  target: AutoRunTarget,
  status: ArtefactStatus,
  ensure: () => Promise<void>,
  reread: () => Promise<void>,
): boolean {
  /* A primitive, so React can compare it without a memo, and so nothing here
     can hold a token it has not spent. */
  const read = useCallback(() => pendingActivation(slug, target), [slug, target]);
  const nonce = useSyncExternalStore(subscribeActivations, read, read);

  /**
   * **This mount's name, for as long as it is on screen.** Lazy `useState`
   * rather than a ref written during render: it is created once, survives
   * `<StrictMode>`'s double-invoked render and its setup / cleanup / setup, and
   * dies with the component — which is exactly the lifetime a press is allowed
   * to be spent over. activation.ts § A press belongs to the band that was on
   * screen.
   */
  const [owner] = useState(() => Symbol(`auto-run ${target}`));

  const [automatic, setAutomatic] = useState(false);
  const run = useRef(ensure);
  run.current = ensure;
  const again = useRef(reread);
  again.current = reread;
  /* The press this mount has already re-read for, so `<StrictMode>`'s second
     invocation asks the network once rather than twice. */
  const rereadFor = useRef<number | null>(null);

  useEffect(() => {
    /* Nothing pressed. */
    if (nonce === null) return;
    /* **Whose press is this?** Before the status is even looked at, because a
       press left behind by a mount that is gone must be retired rather than
       waited on. Claiming is idempotent, so `<StrictMode>` running this twice
       makes no difference. */
    if (!claimActivation(slug, target, nonce, owner)) return;
    /* The GET has not settled. Ordinary, and the press waits for it. */
    if (status === "loading") return;
    if (status === "error") {
      /* No answer yet, so nothing is spent and nothing is retired — ask again.
         See § A failed read is not an answer. */
      if (rereadFor.current === nonce) return;
      rereadFor.current = nonce;
      void again.current();
      return;
    }
    /* **Atomic, and before anything else that could be reached twice.**
       `<StrictMode>` invokes this effect twice on mount; the second invocation
       finds the token gone. A check followed by a clear would let both through,
       which on `sketch` is two minutes and about $0.40. */
    if (!consumeActivation(slug, target, nonce, owner)) return;
    if (status !== "none") return;
    /* The session's one automatic try. See jobEngine.ts § beginAutoAttempt. */
    if (!jobEngine.beginAutoAttempt(slug, target)) return;
    setAutomatic(true);
    void run.current();
  }, [nonce, status, slug, target, owner]);

  /* **Not reset anywhere**, and it does not need to be: every caller narrows it
     with *and a run is in flight* before showing anything, so it stops being
     true of the screen the moment the job lands or fails. A reset effect here
     would have to run after the one above and would simply undo it. */
  return automatic;
}
