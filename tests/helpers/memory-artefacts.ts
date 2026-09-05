/**
 * An `ArtifactStore` that keeps everything in a `Map` — the store to hand a
 * test whose subject is **not** storage.
 *
 * ## Why this exists
 *
 * About ten suites open by building a `createFsArtifactStore` over a
 * `mkdtemp` directory. None of them is testing the filesystem: they need
 * *somewhere* for a stage to write its product so that the next line can read it
 * back, or so that `stepIsDone` has a stamp to consult, and a filesystem store
 * over a temp directory was the cheapest somewhere to construct. They are the
 * `store-agnostic-fake` rows of
 * [`store-migration-registry.ts`](../store-migration-registry.ts), and that
 * entry's own words are *"a narrow `ArtifactReads` or a purpose-built fake
 * replaces it"*. This is the purpose-built fake, so that stage G of
 * docs/plans/260903f-delete-the-spideryarn-store-flag-and-the-filesystem-store.md
 * can delete `src/store/artifacts-fs.ts` without those ten files noticing.
 *
 * ## It behaves like Postgres, not like the filesystem, in the one place they differ
 *
 * **Nothing is aliased.** On disk `extractedHtml` and `stampedHtml` are the same
 * `output/<slug>.html`, because stage 3 overwrites stage 2's page in place; here
 * they are two values, as they are two columns in Postgres. Same for the two
 * `blocks`: `(blocks, blocks)` and `(hierarchy, blocks)` are already separate
 * files and stay separate here.
 *
 * That is a deliberate choice rather than an oversight, and it is the direction
 * the repository is moving: a fake that reproduced the filesystem's aliasing
 * would be a fake **of the thing being deleted**, and would keep a
 * filesystem-shaped assumption alive in ten suites after the filesystem was
 * gone. If a suite genuinely depends on the aliasing, its subject is the
 * filesystem adapter and it belongs in the `filesystem-adapter-behaviour`
 * category instead — which is the question worth asking rather than the
 * behaviour worth copying.
 *
 * ## What it does keep, because tests depend on all of it
 *
 * - **`has` and `read` apply `whyUnusable`** — the same shared table
 *   (src/store/artifacts.ts § `SHAPE`) both real adapters apply. A planted value
 *   of the wrong shape reads back as `null`, which is what the on-disk half-
 *   written file did.
 * - **`readBaseline` asks the deeper question** through
 *   `whyUnusableAsBaseline`, so the *unusable* arm of the four-state table
 *   (glossary and ideas identity inheritance) is reachable.
 * - **`beginStep` mints an attempt and `finishStep` will not accept another's**,
 *   which is the ownership rule a review took six steps to take apart.
 * - **`write` runs `assertStampAgrees`**, so a stage whose stamp disagrees with
 *   its own artefact is refused here exactly as it is on either real store.
 *
 * ## `plant` and `forget`, and why a fake needs an escape hatch
 *
 * A test that must produce *"there is an artefact and it cannot be used"* has no
 * other way in: `write` refuses a bad shape and that is the point of `write`.
 * On the filesystem the equivalent was writing a truncated file directly. So
 * `plant` puts a value in without asking, and `forget` takes one away the way
 * deleting a file did. Neither is on `ArtifactStore`; a caller has to hold the
 * concrete type to reach them, which is what keeps them out of the production
 * seam.
 */
import { mintId } from "../../src/ids.js";
import { STEPS, STEP_ORDER } from "../../src/pipeline.js";
import { fixtureArtefacts } from "./fixture-artefacts.js";
import {
  STAMP_SOURCE,
  assertStampAgrees,
  stampOf,
  whyUnusable,
  whyUnusableAsBaseline,
} from "../../src/store/artifacts.js";
import type {
  ArtifactKind,
  ArtifactMap,
  ArtifactOutcome,
  ArtifactParts,
  ArtifactStore,
} from "../../src/store/artifacts.js";
import type { StepName } from "../../src/types.js";

/** The `ArtifactStore` surface plus the two hatches a fixture needs. */
export interface MemoryArtifactStore extends ArtifactStore {
  /**
   * Put a value in **without** the shape check — the only way to produce an
   * artefact that exists and cannot be used.
   */
  plant(slug: string, step: StepName, kind: ArtifactKind, value: unknown): void;
  /** Take one away, the way `rm` on its file did. */
  forget(slug: string, step: StepName, kind: ArtifactKind): void;
}

/** One artefact's address. Nothing is aliased — see the header. */
const at = (slug: string, step: StepName, kind: ArtifactKind): string =>
  `${slug}\u0000${step}\u0000${kind}`;

/** The three states a read can be in, from what the map holds. */
function outcomeOf(
  held: Map<string, unknown>,
  slug: string,
  step: StepName,
  kind: ArtifactKind,
): ArtifactOutcome<unknown> {
  const key = at(slug, step, kind);
  if (!held.has(key)) return { state: "absent" };
  const value = held.get(key);
  return whyUnusable(kind, value) ? { state: "unusable" } : { state: "ok", value };
}

/**
 * A copy that shares nothing with what was passed in — **the difference between
 * a fake store and a `Map` with methods on it.**
 *
 * ## The bug this exists to stop, reproduced
 *
 * Until 2026-09-05 this store held and handed back the *same object reference*,
 * so a caller that read an artefact and edited it had already changed the store
 * before it did anything else:
 *
 * ```
 * const first = await store.read("x", "hierarchy", "blocks");
 * first.blocks[0].text = "mutated";
 * const second = await store.read("x", "hierarchy", "blocks");
 * // filesystem: "before"    memory (then): "mutated"
 * ```
 *
 * Neither real store can do that: each read of the filesystem parses bytes, and
 * each read of Postgres decodes a JSONB column. Found by the stage's
 * cross-family review, and it was not merely impure — **two converted controls
 * were most of the way to being constants because of it.**
 * `quiz-step-registration` and `illustrated-step-registration` both do
 * *read, edit a block's text, `plant` it back, assert the step is/is not
 * current*, and the edit alone was already moving the article. The `plant` was
 * decoration. Both are load-bearing again, and this file's own test watches the
 * property rather than trusting it.
 *
 * ## A JSON round trip, not `structuredClone`
 *
 * `structuredClone` would detach just as well and is faster. It is the wrong
 * choice all the same: it preserves `undefined` properties, `Date`s and `Map`s,
 * and **neither real store can**. An artefact goes to disk through
 * `JSON.stringify` and comes back through `JSON.parse`; in Postgres it is a
 * JSONB column. So a fixture that leaned on a field JSON drops would pass here
 * and fail against both things this fake stands in for — which is the class of
 * bug the fake exists to avoid rather than to add.
 *
 * A value JSON cannot carry is a **throw**, not a silent `undefined`: it means
 * the test is holding something no store could ever have returned.
 */
function detach<T>(value: T): T {
  if (value === undefined) return value;
  const text = JSON.stringify(value);
  if (text === undefined) {
    throw new Error(
      "this value cannot survive a JSON round trip, so no real artefact store could hold it — " +
        "a function, a symbol, or undefined where an artefact was expected",
    );
  }
  return JSON.parse(text) as T;
}

/** A fresh, empty store. One per test, or per `beforeEach`. */
export function memoryArtefacts(): MemoryArtifactStore {
  const held = new Map<string, unknown>();
  /** Open attempts, by `(slug, step)` — the in-memory `.running` marker. */
  const running = new Map<string, string>();
  const marker = (slug: string, step: StepName): string => `${slug}\u0000${step}`;

  const readOne = (slug: string, step: StepName, kind: ArtifactKind): unknown | null => {
    const outcome = outcomeOf(held, slug, step, kind);
    return outcome.state === "ok" ? outcome.value : null;
  };

  return {
    plant(slug, step, kind, value) {
      /* Detached on the way **in** as well as out: a caller that plants an
         object and then edits its own copy must not be editing the store. */
      held.set(at(slug, step, kind), detach(value));
    },

    forget(slug, step, kind) {
      held.delete(at(slug, step, kind));
    },

    /**
     * **Deliberately not detached**, and it is the one place that is true.
     *
     * `has` never hands a value to anybody — it asks whether each kind reads
     * back non-null and throws the value away. Copying a 150 KB blocks file on
     * every skip check would be work nobody reads, and `readOne` stays raw for
     * the same reason: the detach belongs at the two exits where a caller ends
     * up holding something, not on every internal look.
     */
    async has(slug, step, kinds) {
      /* Empty is `false`, not a vacuous `true`: "the store holds all of nothing"
         would report every step with no declared products complete. The
         filesystem adapter opens with the same line and for the same reason. */
      if (kinds.length === 0) return false;
      return kinds.every((kind) => readOne(slug, step, kind) !== null);
    },

    async read(slug, step, kind) {
      /* **The first of the two exits, and where the aliasing bug lived.** See
         `detach` for what the caller used to get and what it cost. */
      return detach(readOne(slug, step, kind)) as ArtifactMap[typeof kind] | null;
    },

    async readBaseline(slug, step, kind) {
      const outcome = outcomeOf(held, slug, step, kind);
      if (outcome.state !== "ok") return outcome;
      /* The deeper question, and only here — `read` and `has` are untouched,
         because a half-formed artefact is still a perfectly good answer to *is
         this step done*. src/store/artifacts.ts § `whyUnusableAsBaseline`. */
      if (whyUnusableAsBaseline(kind, outcome.value)) return { state: "unusable" };
      /* The second exit. `whyUnusableAsBaseline` runs on what the store holds
         and the caller gets the copy, so the check and the answer cannot drift. */
      return { state: "ok", value: detach(outcome.value) as ArtifactMap[typeof kind] };
    },

    async hasEarlierBlocks(slug) {
      /* **Stage 4's copy, not stage 3's**, and *unusable counts as yes*. A file
         that will not parse means the article has an identity from an earlier
         run that somebody could still restore; answering "no" there is how
         stage 3 mints a fresh id for every paragraph and reports success.
         src/store/artifacts.ts § `hasEarlierBlocks`. */
      const outcome = outcomeOf(held, slug, "hierarchy", "blocks");
      if (outcome.state === "absent") return false;
      if (outcome.state === "unusable") return true;
      const { blocks } = outcome.value as ArtifactMap["blocks"];
      return blocks !== undefined && blocks.length > 0;
    },

    async write(slug, step, parts: ArtifactParts, stamp) {
      for (const [kind, value] of Object.entries(parts) as [
        ArtifactKind,
        ArtifactMap[ArtifactKind],
      ][]) {
        if (value === undefined) continue;
        assertStampAgrees(slug, step, kind, value, stamp);
        /* Detached, like `plant` and for the same reason: a stage that writes
           its product and then goes on editing the object it wrote must not be
           editing the store. Neither real adapter can be edited that way — the
           filesystem has already serialised, Postgres has already sent. */
        held.set(at(slug, step, kind), detach(value));
      }
    },

    async stampFor(slug, step) {
      const kind = STAMP_SOURCE[step];
      if (!kind) return null;
      const artefact = readOne(slug, step, kind);
      if (artefact === null) return null;
      return stampOf(artefact);
    },

    async beginStep(slug, step) {
      const attempt = mintId();
      running.set(marker(slug, step), attempt);
      return attempt;
    },

    async finishStep(slug, step, attempt) {
      const key = marker(slug, step);
      const held = running.get(key);
      /* **Somebody else's attempt is left alone**, and an absent one is not an
         error: a step can finish without this store having seen it start. */
      if (held !== undefined && held !== attempt) return;
      running.delete(key);
    },

    async interrupted(slug, step) {
      return running.has(marker(slug, step));
    },
  };
}

/**
 * A memory store already holding one or more articles, read off a fixture tree.
 *
 * `root` is a directory with `data/<slug>/` and `output/<slug>.html` under it —
 * the committed corpus, or a scratch copy of `example/`. Every artefact the
 * layout knows about is read through [`./fixture-artefacts.ts`](fixture-artefacts.ts)
 * and planted, so the store answers exactly what the fixture holds and nothing
 * else.
 *
 * **It refuses an article it found nothing for**, by name. A store loaded from a
 * misspelled slug is empty, every stage then fails saying *run the hierarchy
 * step first*, and the suite reads as though it had proved something about the
 * stage. That is the shape docs/reusable/silent-success.md is about, and it is
 * the same refusal `loadArticleIntoPg` makes for the same reason.
 */
export async function memoryArtefactsFrom(
  root: string,
  ...slugs: readonly string[]
): Promise<MemoryArtifactStore> {
  const fixture = fixtureArtefacts(root);
  const store = memoryArtefacts();
  for (const slug of slugs) {
    let found = 0;
    for (const step of STEP_ORDER) {
      for (const kind of STEPS[step].produces) {
        const value = await fixture.read(slug, step, kind);
        if (value === null) continue;
        store.plant(slug, step, kind, value);
        found++;
      }
    }
    if (found === 0) {
      throw new Error(
        `no artefact of "${slug}" is under ${root}: the fixture tree has nothing to load. ` +
          "An empty store answers every read with null, which reads exactly like a stage that " +
          "cannot find its article.",
      );
    }
  }
  return store;
}
