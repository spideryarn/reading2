/**
 * **A checkpoint store in a `Map`**, for the tests that are about a *stage*
 * resuming rather than about the store.
 *
 * The real one is Postgres (src/store/checkpoints-pg.ts) and the tests that own
 * it are in tests/store-checkpoints.test.ts, against a live database. This is
 * for the other question: does `runPdfExtract` stop paying for a chunk it has
 * already read, does `generateLabels` stop asking for a batch it has already
 * bought. That question is about the caller, and it should not need a database
 * to ask.
 *
 * **It is a faithful fake, not a stub**, and the three things it copies are the
 * three a caller could get wrong against a lenient one:
 *
 * - **It refuses what the real store refuses.** The same
 *   `assertCheckpointRequest` — a key the CHECK would reject, an undeclared
 *   namespace, the wrong slug — so a stage that minted a bad key fails here
 *   rather than in production. `checkpointJson` too, for a value that will not
 *   serialise.
 * - **It is bound to one article**, and two of them do not see each other's
 *   entries. That is the property that stops one document's transcription being
 *   served to another, since the keys are content addresses and the same PDF in
 *   two libraries mints the same one.
 * - **It round-trips through JSON**, so a value comes back as data rather than
 *   as the very object that went in. Without that, a test could pass on
 *   reference equality against a store that had stored nothing at all, and
 *   every `Date`, `undefined` and class instance a `jsonb` column would flatten
 *   arrives here intact. docs/reusable/silent-success.md.
 *
 * `reads` and `writes` are counted because a checkpoint layer that silently
 * never hits looks exactly like one that works.
 */
import {
  assertCheckpointRequest,
  checkpointJson,
  type CheckpointArticleRef,
  type CheckpointNamespace,
  type CheckpointStore,
} from "../../src/store/checkpoints.js";

export interface MemoryCheckpoints extends CheckpointStore {
  /** Every entry, by `<namespace>/<key>`, as JSON — so a test can see what landed. */
  readonly entries: Map<string, string>;
  /** How many `read` calls were made, and how many keys they asked about in total. */
  readonly calls: { reads: number; keysAsked: number; writes: number };
}

/**
 * One store over one article. Pass the **same `store`** to two attempts to make
 * them a retry of each other; pass two stores over two `articleId`s to make them
 * two different articles.
 *
 * **`ref` is required and has no default**, which cost a debugging session
 * before it was: a default slug that did not match the stage's meant every call
 * was refused, every read was a miss, and — because a checkpoint failure is
 * deliberately not fatal — the run went through paying for everything while
 * looking exactly like a run that had nothing stored yet.
 * docs/reusable/silent-success.md, arriving inside the test helper written to
 * prevent it.
 */
export function memoryCheckpoints(ref: CheckpointArticleRef): MemoryCheckpoints {
  const entries = new Map<string, string>();
  const calls = { reads: 0, keysAsked: 0, writes: 0 };
  const at = (namespace: string, key: string): string => `${namespace}/${key}`;
  return {
    entries,
    calls,
    async read<T>(
      slug: string,
      namespace: CheckpointNamespace,
      keys: readonly string[],
    ): Promise<Map<string, T>> {
      assertCheckpointRequest(ref, slug, namespace, keys);
      calls.reads += 1;
      calls.keysAsked += keys.length;
      const found = new Map<string, T>();
      for (const key of keys) {
        const json = entries.get(at(namespace, key));
        if (json !== undefined) found.set(key, JSON.parse(json) as T);
      }
      return found;
    },
    async write(
      slug: string,
      namespace: CheckpointNamespace,
      key: string,
      value: unknown,
    ): Promise<void> {
      assertCheckpointRequest(ref, slug, namespace, [key]);
      calls.writes += 1;
      /* The last write wins, exactly as Postgres does — `write` is only ever
         called after a failed read, so the incoming value is the
         better-informed one. src/store/checkpoints.ts § Concurrency. */
      entries.set(at(namespace, key), checkpointJson(value));
    },
  };
}
