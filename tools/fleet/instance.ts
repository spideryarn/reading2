/**
 * Which run of the fleet server this is.
 *
 * **WHY ANYTHING NEEDS THIS.** Everything the dashboard hands a client an id
 * for lives in memory and dies with the process — the steering queue says so
 * on every snapshot (`queue.ts`, `PERSISTENCE_WARNING`). What the warning does
 * NOT cover is that the *counters* restart too, so `q1` comes round again and
 * the next thing queued takes the name of something the phone in somebody's
 * pocket is still showing. An id that is only unique within a run is a
 * collision waiting for a restart, and the collision is silent: the id matches,
 * the route acts, and the answer is 200.
 *
 * So an id that leaves this process carries the run that minted it, and the
 * route that receives one back can say **that was a previous server** rather
 * than *no such item*. Those are different facts and the second one is the
 * misleading one — it invites the reader to conclude their instruction was
 * never queued, when in truth it was queued, lost in a restart, and their tap
 * is now pointing at a stranger's.
 *
 * **MINTED ONCE PER PROCESS, AND INJECTED FROM THERE.** `serverInstanceId()`
 * is called at the composition root (`realActionDeps`) and passed down; nothing
 * reaches for it from inside a class. That is not tidiness — the tests build
 * two instances in one process to prove the refusal fires, which a module-level
 * global read from inside the class makes impossible to write.
 *
 * **THE TOKEN IS LOWERCASE HEX, AND THAT IS THE CONTRACT**, because it is what
 * makes `<instance>-<local id>` parse back unambiguously: `-` cannot occur
 * inside the token, so the FIRST `-` in a qualified id is always the boundary,
 * whatever the local half contains. Anything that widens the alphabet has to
 * revisit every parse — `SteeringQueue.idOrigin` is the one today.
 *
 * Not a uuid: it is read in logs and in refusal messages by a person on a
 * phone, and 32 hex digits with dashes in them would be both unreadable and, in
 * the dashes, actively wrong for the reason above. 8 hex digits is 4 billion,
 * against a population of "the handful of times this box restarts in a day".
 */
import { randomBytes } from "node:crypto";

/** How many hex characters. See the header on why not a uuid. */
const TOKEN_BYTES = 4;

/** `^[0-9a-f]{8}$` — the shape every parse checks before believing a prefix. */
export const INSTANCE_TOKEN = /^[0-9a-f]{8}$/;

/**
 * A fresh id for one run of the server.
 *
 * A function rather than a module-level constant so that importing this file
 * commits nobody to a value, and so a test can mint two. Production calls it
 * exactly once, at the composition root.
 */
export function newServerInstanceId(): string {
  return randomBytes(TOKEN_BYTES).toString("hex");
}
