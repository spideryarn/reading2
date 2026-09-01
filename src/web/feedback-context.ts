/**
 * Where the reader was, published by the view that knows and read by the
 * Feedback dialog, which does not.
 *
 * The Feedback button lives at the top level of the window and the facts a bug
 * report needs — which revision, which mode, which granularity level, which
 * blocks were under the reader's eyes — live eight components down inside
 * `Reader`. Prop-drilling them up would braid the whole tree for one dialog, so
 * this is module state instead: the same choice
 * [`log-buffer.ts`](log-buffer.js) already made, in the shape
 * [`offline.ts`](offline.js) established for cross-tree state that is not URL
 * state.
 *
 * **No listener set and no `useSyncExternalStore`**, for `log-buffer.ts`'s
 * reason rather than by omission: nothing renders from this, and a component
 * that re-rendered every time the reading position moved would be a performance
 * bug wearing a diagnostic's hat. If a panel ever needs to watch it,
 * `offline.ts` is the pattern to copy, whole.
 *
 * ## What may be put in here
 *
 * **Ids, never prose** — docs/plans/260831aj-feedback-button-and-bug-reports-to-sentry.md
 * § Article identifiers, not article prose. A slug and a revision id let us open
 * the exact article at the exact revision out of our own Postgres, and
 * docs/project/block-ids.md is why an id is the whole address of a passage. The
 * text adds nothing we do not already have, at the cost of the one rule
 * `src/monitoring-scrub.ts` exists to defend.
 *
 * The shapes below are narrow on purpose, and the collector shape-checks them
 * again on the way out (`src/web/feedback-diagnostics.ts`) — a type is a claim
 * about today's callers, and this is the field where a future one puts a title
 * where a slug was meant.
 */
import type { ArticleView } from "../read-address.js";
import type { Mode } from "../modes.js";
import type { JobStatus, StepName } from "../types.js";

/**
 * How many block ids the reading view publishes.
 *
 * The run of blocks from wherever the reader is standing, which is what "the
 * blocks on screen" means for a report filed seconds after something went
 * wrong. Well under the 200 the wire shape allows
 * (`MAX_BLOCK_IDS` in src/feedback-payload.ts) because forty is already more
 * than a viewport holds and the rest would be a list of what the reader had not
 * got to yet.
 */
export const FEEDBACK_BLOCK_IDS = 40;

/** Which article the reader was in, and how they were looking at it. */
export interface FeedbackArticleContext {
  slug: string;
  /**
   * `article_revisions.id`, or `null`.
   *
   * `null` today: the client's `Article` (src/types.ts) does not carry the
   * revision it was projected from, so there is nothing honest to put here. The
   * slug plus the report's timestamp gets us to the right revision by hand, and
   * the field stays in the shape so that adding it later is a publisher change
   * rather than a wire change.
   */
  revisionId: string | null;
  view: ArticleView;
  mode: Mode;
  /** How many gist columns are open — the granularity level. */
  level: number | null;
  blockCount: number | null;
  /** The article's first block, from the tree's root node range. */
  rootBlockId: string | null;
  /** The blocks around the reading position, newest-first-in-document-order. */
  blockIds: readonly string[];
}

/** An ingest job in flight. The 2026-08-28 outage was failing ingests. */
export interface FeedbackJobContext {
  id: string | null;
  step: StepName | null;
  status: JobStatus | null;
}

let articleContext: FeedbackArticleContext | null = null;
let jobContext: FeedbackJobContext | null = null;

/**
 * Say where the reader is, or `null` on the way out of the reading view.
 *
 * Called from an effect whose cleanup clears it, so a report filed from the
 * shelf never claims an article the reader has left.
 */
export function setFeedbackArticleContext(next: FeedbackArticleContext | null): void {
  articleContext = next;
}

export function readFeedbackArticleContext(): FeedbackArticleContext | null {
  return articleContext;
}

/**
 * Say what the job queue is doing, or `null`.
 *
 * **Nothing publishes into this yet**, and that is recorded rather than hidden:
 * the queue moved to a tab-level service (`src/web/jobEngine.ts`) on
 * 2026-09-01 and both that file and `useJobs.ts` were being rewritten while this
 * was built, so the publisher is deferred rather than wedged into somebody
 * else's half-finished edit. The reader half exists so that adding it is one
 * call in one effect.
 */
export function setFeedbackJobContext(next: FeedbackJobContext | null): void {
  jobContext = next;
}

export function readFeedbackJobContext(): FeedbackJobContext | null {
  return jobContext;
}

/** Forget both. For tests, and for a sign-out if that ever becomes a thing. */
export function clearFeedbackContext(): void {
  articleContext = null;
  jobContext = null;
}
