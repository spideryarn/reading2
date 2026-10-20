/**
 * **Press *Get Skim ready*** — the guide's `prepare` step, by the reader or,
 * for a step the guide marked `now`, by the page itself once (plan
 * docs/plans/261019p-guide-chat-plainer.md § Stage 2b).
 *
 * `POST /api/guide-prepare/<slug>`, through the job engine's action seam as
 * *Read this* is (src/web/read-this.ts): on Vercel nothing but this tab drives
 * a job, and `actionSucceeded` owes a reconciliation where a bare `poke` owes
 * one poll (GPT Sol's F5 on the plan). It never opens the mode.
 *
 * Kept per answer and key, outside the button, so the remount a transcript
 * redraw causes neither presses twice nor forgets what the press said.
 */
import { MODE_PREPARATION_ALREADY_CLAIMED } from "../preparable-modes.js";
import { jobEngine, send } from "./jobEngine.js";
import { statusOf } from "./lib/api.js";
import { describeFetchFailure } from "./lib/describe-failure.js";

/** What a press came to. `refused` is a `now` press the thread had already spent: show the button. */
export type PrepareOutcome =
  | { kind: "started" }
  | { kind: "ready" }
  | { kind: "refused" }
  | { kind: "failed"; message: string };

const presses = new Map<string, Promise<PrepareOutcome>>();

/** The press already made for this answer and mode, if any. */
export function pressFor(answerId: string, mode: string): Promise<PrepareOutcome> | undefined {
  return presses.get(`${answerId}\u0000${mode}`);
}

/** Press it, once per answer and mode; a second call gets the first's outcome. */
export function pressPrepare(
  slug: string,
  body: { mode: string; threadId: string; now: boolean },
  answerId: string,
): Promise<PrepareOutcome> {
  const key = `${answerId}\u0000${body.mode}`;
  const existing = presses.get(key);
  if (existing) return existing;
  const pending = (async (): Promise<PrepareOutcome> => {
    const epoch = jobEngine.epoch();
    try {
      const answer = await send<unknown>(
        `/api/guide-prepare/${encodeURIComponent(slug)}`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
      );
      if (typeof answer !== "object" || answer === null || !("status" in answer)) {
        throw new Error("The server did not say whether the mode was started or ready.");
      }
      const status = (answer as { status?: unknown }).status;
      if (status !== "started" && status !== "ready") {
        throw new Error("The server did not say whether the mode was started or ready.");
      }
      jobEngine.actionSucceeded(epoch);
      return status === "started" ? { kind: "started" } : { kind: "ready" };
    } catch (err) {
      if (body.now && statusOf(err) === 409 && err instanceof Error && err.message === MODE_PREPARATION_ALREADY_CLAIMED) {
        return { kind: "refused" };
      }
      const message = describeFetchFailure(err instanceof Error ? err : new Error(String(err)));
      jobEngine.actionFailed(message, statusOf(err), epoch);
      return { kind: "failed", message };
    }
  })();
  presses.set(key, pending);
  /* A refusal or a failure may be pressed again, by the reader. */
  void pending.then((outcome) => {
    if (outcome.kind === "refused" || outcome.kind === "failed") presses.delete(key);
  });
  return pending;
}

/** For tests: forget every press. */
export function forgetPrepares(): void {
  presses.clear();
}
