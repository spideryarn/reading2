/**
 * READING `attemptedAt` — one implementation, imported by both sides.
 *
 * ## Why this is its own file
 *
 * It used to live in `state.ts`, which reaches `node:child_process` through
 * `collect.ts`, so the browser client could not import it — and the client
 * therefore did not read `attemptedAt` at all, naming the field in its `Omit<>`
 * with the reason written beside it. That was declined on 2026-09-08 on the
 * grounds that a runtime helper could not be shared, and **that reasoning was
 * wrong**: what the client project cannot tolerate is a NODE dependency, not a
 * runtime value. `wire.ts` bans runtime values, and that ban is `wire.ts`'s own
 * rule — it exists because a `const` there would be bundled into the browser and
 * the file's whole job is to be free of anything but types. A leaf module with
 * no imports has neither problem: nothing to pull a node type in behind it, and
 * a function the browser is perfectly happy to bundle. GPT Sol's M5.
 *
 * **So: no imports, and it must never acquire one.** Same discipline as
 * `wire.ts` for the same measured reason — `tools/fleet/web/tsconfig.json` is a
 * separate project with `types: ["vite/client"]` and no node types, so anything
 * reachable from here is compiled a second time under DOM-only libs, and one
 * edge to `collect.ts` or `status.ts` produces ~33 "Cannot find name
 * 'node:child_process'" errors on sight. docs/postmortems/260908b.
 *
 * The alternative was a second hand-written three-arm parse in
 * `web/src/types.ts`. That is the twin problem the whole shared-wire stage exists
 * to remove: two declarations of one rule, related by nothing but hope, and the
 * one that drifts is the one nobody is reading at the time.
 *
 * ## What it is for
 *
 * **The silent stall.** A collection that never settles throws nothing, so
 * `error` stays null and the loop simply stops — measured at ~30 minutes stale
 * with `error: null`, which reads as a calm, slightly-quiet box. `collectedAt`
 * says when data last ARRIVED and cannot tell that apart from a box with nothing
 * to report. `attemptedAt` says when one was last STARTED, and the difference
 * between the two is the diagnostic: *no attempt since the last success* is a
 * loop that stopped, and *an attempt later than the last success* is one that
 * began and hung.
 */

/**
 * What a payload can tell you about whether the collector is still trying.
 *
 * Three arms because there are three genuinely different situations, and the
 * one that would otherwise be lost is the third.
 */
export type AttemptClock =
  /** The producer said when it last started a collection. */
  | { kind: "attempted"; at: string }
  /** The producer tracks this and has not started one yet — a fresh process. */
  | { kind: "never-attempted" }
  /**
   * The producer does not report this at all, so nothing can be concluded about
   * whether it is still trying. **Not a fault, and not a wedge.**
   */
  | { kind: "not-reported"; why: string };

/**
 * Read `attemptedAt` without mistaking an old server for a wedged one.
 *
 * `attemptedAt` landed on 2026-09-08 as an added field rather than a schema
 * bump — state.ts's own rule, since a consumer that ignores it is poorer rather
 * than wrong. But that leaves an ambiguity for anyone who *does* use it: a
 * payload with no `attemptedAt` is either a producer that has never attempted a
 * collection, or one built before the field existed. Read naively, the second
 * looks exactly like a collector that has stopped trying — which is the very
 * fault the field was added to detect. Raised by the `orchestrator-setup`
 * session, whose freshness watchdog consumes this.
 *
 * **The ambiguity is recoverable, and `collectedAt` is what recovers it.**
 * `attemptedAt` is set BEFORE every attempt, so on any producer that reports it,
 * a non-null `collectedAt` implies a non-null `attemptedAt` — a collection
 * cannot have succeeded without having been started. So a payload carrying data
 * but no attempt clock is not a producer that never tried; it is a producer that
 * does not report trying. That is an inference from the field's own ordering
 * rather than a convention two programs have agreed to, which is why it belongs
 * here as code rather than in a message between us.
 *
 * When BOTH are absent the two cases stay merged — never attempted, or an old
 * server that has never collected — and that is fine: no data has ever arrived
 * either way, and a consumer does the same thing about it.
 *
 * Deliberately does not look at `undefined` versus `null`. A producer that has
 * the field and has not attempted sends `null`, and one without it sends
 * nothing, so in raw JSON the two ARE distinguishable — but that distinction
 * dies in the first parser, ORM or round trip that normalises one to the other,
 * and a guard that survives only until somebody reasonable touches the pipe is
 * not a guard.
 */
export function readAttemptClock(state: {
  attemptedAt?: string | null;
  collectedAt?: string | null;
}): AttemptClock {
  if (typeof state.attemptedAt === "string" && state.attemptedAt !== "") {
    return { kind: "attempted", at: state.attemptedAt };
  }
  if (typeof state.collectedAt === "string" && state.collectedAt !== "") {
    return {
      kind: "not-reported",
      why:
        "this payload has rows and a collection time but no attempt clock, so it comes from a " +
        "server built before that field — whether it is still collecting cannot be told from here",
    };
  }
  return { kind: "never-attempted" };
}
