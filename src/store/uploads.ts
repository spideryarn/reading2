/**
 * **Where an upload attempt is written down**, as a contract with two adapters.
 *
 * The state machine itself is not here and never was: `canTransition`,
 * `grantExpired` and `sweepable` live in [`src/source.ts`](../source.ts) and
 * know nothing about where a record is kept. That separation is what makes this
 * a change of adapter rather than a change of rules, and it was done that way
 * on purpose before either adapter existed.
 *
 * ## The one method whose implementations are genuinely different
 *
 * `claim`. Finalising has to be **exactly once** — two tabs, or one impatient
 * double-click, otherwise both pass the same checks and both queue a job that
 * spends model money. Read-then-write has a gap in it that is however long the
 * awaits take.
 *
 * On the filesystem that needs a create-only marker beside the record —
 * `open(…, "wx")`, atomic at the kernel, which is a definite answer rather than
 * a probable one. In Postgres it is one conditional `UPDATE` and `rowCount`
 * decides. The database makes the filesystem adapter's cleverest piece of
 * machinery disappear, which is worth noticing rather than glossing: it is the
 * clearest single argument for the move.
 *
 * Everything else is the same shape on both sides, which is what
 * `tests/store-uploads-parity.test.ts` is for.
 *
 * See docs/plans/260827h-durable-queue-and-uploads.md.
 */

import { type RejectReason, type UploadStatus, grantExpired } from "../source.js";

/**
 * What we know about one upload, and **which half of it we believe**.
 *
 * The `claimed…` fields are what the browser said. They are recorded so that a
 * mismatch can be *reported* — "the file that arrived is not the file you
 * chose" is a useful sentence — and they are never treated as identity. The
 * unprefixed `sha256` and `bytes` are ours, computed over what actually landed,
 * and they only exist after `verified`.
 */
export interface UploadRecord {
  id: string;
  /**
   * Who asked for it.
   *
   * **Recorded and checked, even though it decides little today.** There is one
   * owner in this installation (`currentOwnerId`, src/owner.ts). It is here for
   * the reason the plan gave when it was still hypothetical: *the day it stops
   * being trivial is the day it matters*, and adding a column to a live state
   * machine is more work than starting with one. GPT Sol, 2026-08-27.
   */
  owner: string;
  /** Cleaned by `cleanFilename`. Display only — nothing derives a key from it. */
  filename: string;
  claimedBytes: number;
  claimedSha256: string;
  status: UploadStatus;
  mintedAt: string;
  /**
   * When the grant stops working — **the token's clock, not this row's.**
   *
   * A record's creation time can precede the token's `iat`, so a sweep counting
   * from `mintedAt` counts from the wrong clock and can delete an object while
   * a grant over its key is still live — which re-arms that grant. Storing what
   * the issuer told us removes the arithmetic entirely.
   */
  grantExpiresAt: string;
  /** Our hash, over the bytes we read. Present only once `verified`. */
  sha256?: string;
  bytes?: number;
  /** Why we would not take it. Present only once `rejected`. */
  reason?: RejectReason;
  /** The article it became, once one exists. */
  slug?: string;
}

/** Why a claim did not happen. Each one is a different sentence to the reader. */
/**
 * **A caller asked for a state change the machine does not have.**
 *
 * A class rather than a bare `Error`, and it is worth saying why, because both
 * adapters threw one of these happily for a day. `guardDbStore` in
 * db-errors.ts replaces every error leaving a Postgres store with one of two
 * fixed sentences — deliberately an allowlist, so that a store which one day
 * throws `new Error(\`bad row \${JSON.stringify(row)}\`)` cannot leak by
 * default. The moment `pgUploadStore` went behind that guard, the Postgres
 * adapter stopped saying *pending to verified* and started saying *this app
 * asked its database for something it would not do*, while the filesystem
 * adapter — which has no guard, having no database — went on saying the first.
 * Two stores answering differently is the one thing
 * tests/store-uploads-parity.test.ts exists to prevent, and it caught it.
 *
 * Naming the type fixes both halves at once: it crosses the guard intact, and
 * it crosses it identically from both adapters.
 *
 * **Safe to let out because its message is closed.** Both values interpolated
 * are `UploadStatus`, which is a union of five literals in src/source.ts.
 * Nothing here can carry a filename, a URL or a word of anybody's article —
 * that is the test db-errors.ts asks of everything on its allowlist, and the
 * only reason this qualifies. Keep it that way: do not add the record's
 * `reason` or `slug` to this message.
 */
export class IllegalTransition extends Error {
  constructor(
    readonly from: UploadStatus,
    readonly to: UploadStatus,
  ) {
    super(`An upload cannot go from ${from} to ${to}.`);
    this.name = "IllegalTransition";
  }
}

export type ClaimFailure = "unknown" | "expired" | "taken";

export type ClaimResult =
  | { ok: true; record: UploadRecord }
  | { ok: false; why: ClaimFailure };

/** The fields a terminal transition may carry. Nothing else about a record moves. */
export type SettleFields = Partial<Pick<UploadRecord, "sha256" | "bytes" | "reason" | "slug">>;

export interface UploadStore {
  /**
   * **Somebody else's upload reads as one that is not there.**
   *
   * Not a courtesy: every caller turns `null` into a 404, so answering this way
   * gives the right status without a second decision — and 404 is right, since
   * "no such upload" is all a stranger should learn about an id they guessed.
   */
  read(id: string, owner?: string): Promise<UploadRecord | null>;

  /** Write a freshly minted record. Never used to update one. */
  create(record: UploadRecord): Promise<void>;

  /** Take exclusive ownership, exactly once, or say who got there first. */
  claim(id: string, options: { owner?: string; now?: Date }): Promise<ClaimResult>;

  /**
   * Move to a terminal state, **refusing an illegal transition loudly**.
   *
   * The whole value of `canTransition` is that it is consulted. A `verified`
   * upload being verified again is a bug in the caller, not a no-op to absorb.
   */
  settle(id: string, to: UploadStatus, fields: SettleFields): Promise<UploadRecord | null>;

  /**
   * Refuse an upload, and **say nothing if it is already refused.**
   *
   * `settle` throws on an illegal transition and that strictness is right for
   * callers making a decision. This one is not: it is the acquisition step
   * recording a check that failed, and that step can run again — a reader
   * presses Retry, or `advanceJob` walks the list once more — over an upload it
   * already rejected. Throwing there would replace a clear "that file isn't a
   * PDF" with a state-machine error about the state machine.
   *
   * Returns whether it wrote anything, so a caller that cares can tell a first
   * refusal from a repeat.
   */
  reject(id: string, reason: RejectReason): Promise<boolean>;

  /** Note the article an upload became, without moving its state. */
  noteSlug(id: string, slug: string): Promise<void>;

  /** Every record, newest first. For the sweep, and for tests. */
  list(): Promise<UploadRecord[]>;

  /** Forget one attempt. The staging object is deliberately left alone — see the sweep. */
  forget(id: string): Promise<void>;
}

/** A UUID as `crypto.randomUUID` writes one. The only shape an upload id ever has. */
export function isUploadId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value)
  );
}

/**
 * **Has this record's grant run out?** — read off `grantExpiresAt`, which is the
 * issuer's clock rather than ours.
 *
 * One predicate, used by both adapters and by the API that reports an upload's
 * state, because there were briefly two: `claimUpload` compared
 * `mintedAt + GRANT_TTL_MS` while the record stored what the issuer said, so a
 * `GET` could report `expired` while a claim still succeeded. Storing a value
 * and then not consuming it is worse than never storing it, because the doc
 * says it is used. GPT Sol, 2026-08-27.
 */
export function grantIsOver(record: UploadRecord, now: Date): boolean {
  const ends = Date.parse(record.grantExpiresAt);
  /* An unparseable timestamp is a record we cannot reason about, and the safe
     reading of "I do not know when this expires" is "it has". `GRANT_TTL_MS` is
     the fallback bound, from the one thing we do know. */
  return Number.isFinite(ends)
    ? now.getTime() >= ends
    : grantExpired(new Date(record.mintedAt), now);
}
