/**
 * **"This request is the administrator viewing the app as another reader."**
 *
 * The marker the view-as gate in src/routes.ts (`serveViewingAs`) sets around
 * one allowlisted GET handler, and that every backstop reads: `beginSpend`,
 * `sendEmail`, `afterResponse`, job enqueue, Storage writes, and the database
 * pool, which runs every statement in a read-only transaction while it is set
 * (src/db/client.ts). docs/plans/261019n-admin-sees-other-users-articles-and-views-as-them.md
 * § Part 3, and F4 and F7 of GPT Sol's plan review there.
 *
 * **Its own `AsyncLocalStorage`, not a field on the owner box** in src/owner.ts.
 * The handler runs as `runViewingAs(marker, () => runAsOwner(subject, handler))`,
 * and `runAsOwner` opens a fresh owner scope; a marker kept in the owner box
 * would be dropped by exactly the call that makes the subject the owner. Two
 * stores, so neither can erase the other.
 *
 * **`run()`, never `enterWith`**, for the reason src/owner.ts gives: with
 * keep-alive, `enterWith` can leak into the next request on the same socket.
 * The marker exists only inside the callback.
 *
 * **Frozen**, so nothing downstream can retarget a live marker at somebody
 * else between the gate and a backstop.
 */

import { AsyncLocalStorage } from "node:async_hooks";

import type { OwnerId } from "./types.js";

/** Who is looking (`actorId`), at whose app (`subjectId`), under which session row. */
export interface ViewingAs {
  readonly actorId: OwnerId;
  readonly subjectId: OwnerId;
  /** `view_as_sessions.id` — the audit row this request is under. */
  readonly sessionId: string;
}

const scope = new AsyncLocalStorage<ViewingAs>();

/** Run `fn` with the marker set. A frozen copy is stored, never the caller's object. */
export function runViewingAs<T>(marker: ViewingAs, fn: () => T): T {
  const frozen: ViewingAs = Object.freeze({
    actorId: marker.actorId,
    subjectId: marker.subjectId,
    sessionId: marker.sessionId,
  });
  return scope.run(frozen, fn);
}

/** The marker, or `null` outside a view-as handler. */
export function viewingAs(): ViewingAs | null {
  return scope.getStore() ?? null;
}

/**
 * **A backstop tripped**: something reachable from an allowlisted GET tried to
 * change or spend something while viewing as. A 500 on purpose: the allowlist
 * is the boundary and this is the net under it, so reaching it is a bug in the
 * allowlist to see in the error tracker, not a refusal the reader is owed.
 */
export class RefusedWhileViewingAs extends Error {
  readonly status = 500;
  constructor(what: string) {
    super(`Refused while viewing as another reader: ${what}. See src/view-as-scope.ts.`);
    this.name = "RefusedWhileViewingAs";
  }
}

/** Throw if the marker is set. `what` is fixed prose — it reaches a log. */
export function refuseWhileViewingAs(what: string): void {
  if (scope.getStore() !== undefined) throw new RefusedWhileViewingAs(what);
}
