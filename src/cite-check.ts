/**
 * **A citation's *Does it say that?*, as the chat route admits it** — the
 * server half of plan docs/plans/261024m-citation-card-streams-a-note-on-what-this-paragraph-cites-the-work-for.md
 * (option C, and the overrides in § After GPT Sol's review).
 *
 * The turn itself is an ordinary chat turn through `POST /api/chat/:slug`;
 * nothing here calls a model. What is here is what that route asks before it
 * creates a thread whose origin is `cite-check` (`CiteCheckOrigin`,
 * src/types.ts):
 *
 * - `citeCheckQuestion`: is the owner's Bibliography fresh, does it still have
 *   this work, does this block still cite it — and what question must the
 *   thread start with. The question is the press's own, rebuilt here from the
 *   stored work (`askDoesItSayThatAboutBlock`, src/chat-question.ts), so a
 *   `cite-check` origin always means *Does it say that?* was asked (GPT Sol's
 *   C4).
 * - `admitCiteCheck`: the allowance an **automatic** start takes (`auto: true`,
 *   a rest on the card), and the two ways to give it back. A press takes none:
 *   it is the reader choosing to spend, as every chat turn is. The allowance is
 *   an accidental-spend guard for the reader's own pointer, not an abuse
 *   boundary — `auto` is the client's word, and a signed-in reader is trusted
 *   (docs/project/security-map.md).
 *
 * Nothing here logs the work's title or the article's words; the route's
 * refusals carry fixed sentences.
 */
import { askDoesItSayThatAboutBlock } from "./chat-question.js";
import { CHAT_TIMEOUT_MS } from "./converse.js";
import { log } from "./log.js";
import {
  CITE_CHECK_BUSY,
  CITE_CHECK_DAY,
  CITE_CHECK_HOUR,
  CITE_CHECK_RESTING,
  CITE_CHECK_STALE,
} from "./messages.js";
import type { AllowanceTaken, FetchAllowanceStore, RatePolicy } from "./store/contracts.js";
import type { BibliographyFound, CiteCheckOrigin } from "./types.js";

/**
 * **The automatic start's allowance: 8 an hour and 20 a day for one reader,
 * two at once, and 100 a day across every reader.** Plan 261024m § C6, from
 * the measured cost in docs/investigations/261024d-does-it-say-that-cost-and-latency.md:
 * cold median $0.30, max $0.43; warm median $0.08. Worst case, every turn cold
 * at the observed maximum: $8.60 a reader-day, $43 a day overall. Greg's to
 * move.
 *
 * The lease is the chat turn's own deadline plus a minute for the store and
 * the gist, so a process that dies mid-answer frees the slot soon after; the
 * route frees it sooner, in the turn's terminal `finally`.
 */
export const CITE_CHECK_RATE_POLICY: RatePolicy = {
  fills: 8,
  windowMs: 60 * 60 * 1000,
  concurrency: 2,
  leaseMs: CHAT_TIMEOUT_MS + 60_000,
  daily: { fills: 20, globalFills: 100, windowMs: 24 * 60 * 60 * 1000 },
};

/** Why an automatic start was refused, as the 429 and 503 bodies say it. */
export type CiteCheckCapReason = "hour" | "day" | "busy" | "global";

/**
 * **An automatic start refused by its allowance**: 429 for the reader's own
 * hour, day or two-at-once, 503 for everybody's day. `reason` is the one
 * declared field the route's error handler puts beside `error`
 * (`declaredFields`, src/routes.ts), so the card can say which without
 * reading prose. Carries a `status`, so it passes `guardDbStore` and the
 * handler reads it first.
 */
export class CiteCheckCapped extends Error {
  readonly status: 429 | 503;
  readonly reason: CiteCheckCapReason;
  constructor(reason: CiteCheckCapReason) {
    super(capSentence(reason));
    this.name = "CiteCheckCapped";
    this.reason = reason;
    this.status = reason === "global" ? 503 : 429;
  }
}

function capSentence(reason: CiteCheckCapReason): string {
  switch (reason) {
    case "hour":
      return CITE_CHECK_HOUR;
    case "day":
      return CITE_CHECK_DAY;
    case "busy":
      return CITE_CHECK_BUSY;
    case "global":
      return CITE_CHECK_RESTING.message;
    default:
      return reason satisfies never;
  }
}

function capReasonOf(taken: Exclude<AllowanceTaken, { kind: "allowed" }>): CiteCheckCapReason {
  switch (taken.kind) {
    case "rate":
      return taken.reason;
    case "concurrency":
      return "busy";
    case "global":
      return "global";
    default:
      return taken satisfies never;
  }
}

/**
 * The allowance one automatic start holds. **Exactly one of the two is
 * called, once**; a second call of either does nothing.
 *
 * - `release`: the turn ran (or failed while running). Frees the slot; the
 *   fill still counts. In the route's terminal `finally`, after the model and
 *   the store, never on the socket closing (plan § C10).
 * - `refund`: the turn was refused after the allowance and before the model
 *   started — a lost race, a stale request. Deletes the fill (plan § C1).
 */
export interface CiteCheckLease {
  release(): Promise<void>;
  refund(): Promise<void>;
}

/**
 * **Take one automatic start's allowance, or throw `CiteCheckCapped`** — a
 * 429 or 503 the route answers as ordinary JSON, because its stream has not
 * opened. `admitHelpChat`'s shape (src/help-chat-call.ts), with a refund.
 */
export async function admitCiteCheck(
  allowance: Pick<FetchAllowanceStore, "take" | "finish" | "cancel">,
): Promise<CiteCheckLease> {
  const taken = await allowance.take("cite-check", CITE_CHECK_RATE_POLICY);
  if (taken.kind !== "allowed") {
    const reason = capReasonOf(taken);
    log("model").warn({ why: reason }, "cite-check: allowance spent");
    throw new CiteCheckCapped(reason);
  }
  const id = taken.id;
  let settled = false;
  return {
    async release() {
      if (settled) return;
      settled = true;
      await allowance.finish(id);
    },
    async refund() {
      if (settled) return;
      settled = true;
      await allowance.cancel(id);
    },
  };
}

/**
 * A creating cite-check turn the owner's current Bibliography does not back:
 * the list is missing or stale, the work has gone, or the block no longer
 * cites it, or the question is not the one this work and block ask. A 409 with
 * a fixed sentence and nothing spent; the card checks the same things, so this
 * is the backstop for a stale tab.
 */
export class CiteCheckStale extends Error {
  readonly status = 409;
  constructor() {
    super(CITE_CHECK_STALE);
    this.name = "CiteCheckStale";
  }
}

/**
 * **The question a `cite-check` thread for this origin must start with**, or
 * `CiteCheckStale` when the owner's Bibliography does not back it.
 *
 * `found` is `loadBibliography`'s answer, or `null` when the article has no
 * list. `blocks` are the article's current blocks. Pure, so every refusal is
 * a unit test.
 */
export function citeCheckQuestion(
  found: Pick<BibliographyFound, "bibliography" | "stale"> | null,
  blocks: readonly { id: string }[],
  origin: CiteCheckOrigin,
): string {
  if (found === null || found.stale) throw new CiteCheckStale();
  const work = found.bibliography.citations.find((w) => w.id === origin.itemId);
  if (!work) throw new CiteCheckStale();
  if (!blocks.some((b) => b.id === origin.blockId)) throw new CiteCheckStale();
  if (!work.citedAt.includes(origin.blockId)) throw new CiteCheckStale();
  return askDoesItSayThatAboutBlock(work, origin.blockId);
}
