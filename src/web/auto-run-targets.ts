/**
 * **The targets allowed one automatic attempt, named once, in a module that
 * imports nothing at runtime.**
 *
 * Eleven start after a press; Tweets starts when its owner arrives at its own
 * page. `beginAutoAttempt` applies the same loop guard to both triggers.
 *
 * A file of its own for the reason [`src/modes.ts`](../modes.ts) and
 * [`src/web/referee-views.ts`](./referee-views.ts) are files of their own: two
 * modules need this union and one of them cannot reach the other.
 * `activation.ts` mints the tokens and imports `jobEngine.ts` for the session
 * epoch; `jobEngine.ts` keys `beginAutoAttempt` on the same vocabulary and
 * therefore cannot import `activation.ts` back. The type lived in
 * `activation.ts` until 2026-09-06, when `beginAutoAttempt` had to stop being
 * keyed on `StepName` — see below.
 *
 * ## Nine of these are pipeline steps and two are not
 *
 * The nine go through `StepTarget`, whose only job is to **fail where the
 * mistake is made**. `Extract<StepName, …>` was tried first and is not good
 * enough: `Extract` silently *erases* a name it does not recognise, so
 * `Extract<StepName, "tweeets">` is `never`, the union quietly narrows, and the
 * error — if it comes at all — surfaces at some unrelated call site, or nowhere,
 * if the misspelled target has no caller yet. GPT Sol, reviewing this plan,
 * 2026-09-06. A constrained alias errors on the literal, in this file, on the
 * line that is wrong.
 *
 * The two that are written as plain string literals are Referee's streamed
 * sub-modes. Neither has a job row, a `StepName` or a place in `STEP_ORDER`:
 * `claims` is one SSE run per paper ([`useClaims.ts`](./useClaims.ts)) and
 * `candidates` is a chat thread of kind `candidates`
 * ([`CandidatesPanel.tsx`](./CandidatesPanel.tsx)). They are capped by
 * `beginAutoAttempt` exactly like the rest — it is only a `Set` key — but there
 * is no job behind them for the reader to watch or cancel.
 *
 * docs/plans/260906b-opening-a-mode-starts-it-generating.md § Stage 1.
 */
import type { StepName } from "../types.js";

/**
 * **Identity, constrained.** `StepTarget<"tweeets">` is a compile error on the
 * word itself; `Extract<StepName, "tweeets">` is silently `never`. See the
 * header — this alias exists for that difference and for nothing else.
 */
type StepTarget<T extends StepName> = T;

/** The nine that are pipeline steps, and therefore have a job behind them. */
type StepAutoRunTarget = StepTarget<
  /* The five modes whose whole content is one artefact, and the two picture
     chips inside Diagram. */
  | "glossary"
  | "ideas"
  | "quotes"
  | "timeline"
  | "debate"
  /* Every work the piece cites — docs/plans/260911g-citations-mode.md. */
  | "citations"
  | "sketch"
  | "illustrated"
  /* The article as a numbered thread. Its own page rather than a band, and
     since 2026-09-15 it starts on arrival rather than on a press — no token is
     ever armed for it; it is here because `beginAutoAttempt` is keyed on this
     union (useAutoRun.ts § `useAutoRunOnArrival`). */
  | "tweets"
  /* The second half of Remember: the questions the piece asks you back. */
  | "quiz"
>;

/** The two that are streams, with no job row and no place in `STEP_ORDER`. */
type StreamAutoRunTarget = "claims" | "candidates";

/** Every target that may receive one automatic attempt in this tab session. */
export type AutoRunTarget = StepAutoRunTarget | StreamAutoRunTarget;
