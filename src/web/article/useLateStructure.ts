/**
 * **The real structure, taken in live by a reading view that opened before it
 * was built.**
 *
 * A first import from the browser publishes with a stand-in tree cut from the
 * article's headings (`tree.provisional === "awaiting-structure"`), so the
 * article opens after about six seconds rather than thirty, and a queued
 * `["structure"]` job replaces the tree in a second publication. This hook is
 * what notices that from the open page, and swaps **only the tree** into the
 * article it already holds — no reload, and the prose, its images and the
 * reader's place are not touched.
 * docs/plans/261005j-open-the-article-before-structure-and-swap-the-real-tree-in-live.md
 * § Stage 2, and § Review record for everything below that is not obvious.
 *
 * ## A level check, not an edge
 *
 * The opening question is *the tree I hold is awaiting, and no structure job for this
 * slug is queued or running*, asked of the job list. A completion signal alone
 * is insufficient: a job that ended while the article was still loading is never
 * announced (`useJobs` § `onFinished` only hears completions after it began
 * observing), and a level check is true in that window too.
 *
 * ## Why not `loaded`
 *
 * `useJobs().loaded` says a list landed at some point, which can be before
 * this article existed: a tab holding an old empty list opens an article
 * imported elsewhere, sees no job, fetches a tree that is still the stand-in
 * and says *could not be built* over a job that is running. And the reading
 * view's only other subscriber is quiet, so nothing would ever correct it.
 * GPT Sol's plan review, F2. So the decision waits for a list **asked for
 * after the awaiting article arrived** (`jobEngine.afterFreshList`, with a
 * poke, since that barrier asks for nothing itself).
 *
 * ## What it costs the engine
 *
 * Until that list has landed this mount is a paying subscriber
 * (`"watches-queue"`), which is what keeps the engine asking through a failed
 * poll: a quiet one neither wakes it nor arms a retry. From then on it is
 * quiet. A structure job in the list keeps the engine on its busy cadence with
 * no help from here, and once nothing is running there is nothing left to
 * watch for — the next transition is a press of **Build it**, whose own POST
 * pokes. tests/late-structure.test.tsx § what it costs the job engine.
 *
 * ## Why the tree is held beside the article
 *
 * `useArticleAccess` draws an article twice: once at once, and again when its
 * own images have arrived (access.ts § the second draw), which can be after
 * the swap. That second object carries the tree it was fetched with — the
 * stand-in. Writing the real tree *into* the answer would have it overwritten;
 * holding it here, keyed on the slug, and laying it over whichever article
 * object is current, cannot.
 *
 * ## What is not swapped
 *
 * `arc`. `useArc` seeds its own state from the payload once, so a changed prop
 * would not move it (Sol F8); it waits for the real tree instead and then runs
 * as it does on any open. And nothing about the blocks: the fetched ones are
 * compared and thrown away.
 *
 * **Owner only.** It reads the owned route and subscribes to the job engine. A
 * visitor sees the stand-in and gets the real tree on their next load — the
 * plan's known limit — and is told so by the band
 * (modes/structure/StructureArriving.tsx § `visitorArrival`).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  awaitingStructure,
  type Article,
  type Block,
  type NavLabelStatus,
  type Tree,
} from "../../types.js";
import { jobEngine } from "../jobEngine.js";
import { apiFetch, readJson } from "../lib/api.js";
import { withChildLists } from "../tree.js";
import { useJobs } from "../useJobs.js";

/**
 * Where the article's structure stands, as the open page can tell.
 *
 * - `final` — the tree is not a stand-in waiting to be replaced: it never was,
 *   or the real one has been swapped in. The final headings fallback
 *   (`provisional: "headings"`) is `final` too; nothing is coming for it.
 * - `building` — the stand-in is on screen, and either a structure job is
 *   queued or running or we do not know yet.
 * - `stalled` — no job is coming and the server's tree is still the stand-in.
 * - `mismatch` — the real tree exists, but was cut from blocks that are not the
 *   ones on screen, so it was not swapped in.
 * - `unread` — checking the published tree failed; the reader can try the read again.
 */
export type LateStructure = "final" | "building" | "stalled" | "mismatch" | "unread";

export interface WithLateStructure {
  /**
   * The article to draw. The one handed in, by identity, unless the real tree
   * has arrived — then the same article with `tree` and `navLabelStatus`
   * replaced and **the same `blocks` array**.
   */
  article: Article;
  structure: LateStructure;
  /** Retry the read, without buying another structure job. */
  retry(): void;
}

/** The two fields a swap replaces, and whose article they belong to. */
interface LateTree {
  slug: string;
  tree: Tree;
  navLabelStatus: NavLabelStatus;
}

/**
 * **Are these the blocks the fetched tree was cut from?** In order, on every
 * field the tree's contract reads.
 *
 * Not on the id alone: a concurrent Rebuild keeps ids and re-classifies
 * (`describeBlock`, src/blocks.ts), so the same ids do not prove the same
 * kinds, roles or treatments, and a tree built against the new ones would be
 * laid over the old (Sol F5). Not on `html`: the held copy has been through the
 * sanitiser, the maths and the image re-hosting, none of which touch the
 * fields below.
 */
export function sameStructuralBlocks(held: readonly Block[], fetched: readonly Block[]): boolean {
  if (held.length !== fetched.length) return false;
  return held.every((a, i) => {
    const b = fetched[i];
    return (
      b !== undefined &&
      a.id === b.id &&
      a.kind === b.kind &&
      a.tag === b.tag &&
      a.level === b.level &&
      a.text === b.text &&
      a.gistable === b.gistable &&
      a.role === b.role &&
      a.treatment === b.treatment
    );
  });
}

/** Is a job that will write this article's tree queued or running? */
function structureJobComing(
  jobs: readonly { slug: string; status: string; steps: readonly { name: string }[] }[],
  slug: string,
): boolean {
  return jobs.some(
    (j) =>
      j.slug === slug &&
      (j.status === "queued" || j.status === "running") &&
      j.steps.some((s) => s.name === "structure"),
  );
}

export function useLateStructure(slug: string, article: Article): WithLateStructure {
  /** The stand-in is what the page was handed. Not "is still on screen": see `swapped`. */
  const awaiting = awaitingStructure(article.tree);

  const [late, setLate] = useState<LateTree | null>(null);
  /* Keyed on the slug like every answer in this directory, so the render after
     the slug changes cannot lay one article's tree over another. */
  const swapped = late?.slug === slug ? late : null;

  const [verdict, setVerdict] = useState<{ slug: string; kind: "stalled" | "mismatch" | "unread" } | null>(
    null,
  );
  /** The slug a list asked for after its awaiting article arrived has landed for. */
  const [freshFor, setFreshFor] = useState<string | null>(null);
  const fresh = freshFor === slug;
  const [attempt, setAttempt] = useState(0);
  const [completion, setCompletion] = useState(0);

  /* **Before `useJobs`, and the order is one request.** Effects run in the order
     their hooks were called, so this poke starts the list before the
     subscription below arrives and its `wake` finds one in flight. The other
     way round the subscription polls, this poke lands on top of it, and the
     engine makes a second request to honour it. Correct either way. */
  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt rearms reconciliation after an explicit read retry.
  useEffect(() => {
    if (!awaiting) return;
    const stop = jobEngine.afterFreshList(() => setFreshFor(slug));
    /* The barrier asks for nothing. Asleep (signed out) or paused, this is a
       no-op, the list never comes and the page can only say the full structure
       is unavailable. */
    jobEngine.poke();
    return () => {
      stop();
      setFreshFor(null);
    };
  }, [slug, awaiting, attempt]);

  /* What the answer is checked against when it lands, read at that moment
     rather than captured when the request left. */
  const now = useRef({ slug, article });
  now.current = { slug, article };
  /** The newest request. An answer to any other is ignored. */
  const requests = useRef(0);
  /**
   * The slug already asked about since a structure job was last seen for it.
   *
   * Once per *episode*, not once per mount: a job that comes and goes — the
   * owner pressing **Build it** after a stall — is a reason to ask again, so
   * seeing one clears this. A ref for the reason `useArc`'s guard is: Strict
   * Mode runs the effect twice, and the second pass must not send a second
   * request. Which is also why the effect has no cleanup that cancels: the
   * first pass's request would be cancelled and the second never sent.
   */
  const asked = useRef<string | null>(null);
  const retry = useCallback(() => {
    asked.current = null;
    requests.current += 1;
    setVerdict(null);
    setFreshFor(null);
    setAttempt((n) => n + 1);
  }, []);

  /* The level check covers completion before mount; the completion signal
     covers a new job that finishes between polls without ever looking active. */
  const queue = useJobs(awaiting && !swapped && !fresh ? "watches-queue" : "quiet", (job) => {
    if (!awaiting || swapped || job.slug !== slug || !job.steps.some((s) => s.name === "structure")) return;
    asked.current = null;
    requests.current += 1;
    setVerdict(null);
    setCompletion((n) => n + 1);
  });
  const coming = useMemo(() => structureJobComing(queue.jobs, slug), [queue.jobs, slug]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: completion rearms the level check when a job finishes between polls.
  useEffect(() => {
    if (!awaiting || swapped || !fresh) return;
    if (coming) {
      asked.current = null;
      /* A read begun before this job belongs to the previous episode. */
      requests.current += 1;
      /* Clear the previous verdict through the gap between this job ending
         and the next read arriving. */
      setVerdict(null);
      return;
    }
    if (asked.current === slug) return;
    asked.current = slug;

    const request = ++requests.current;
    const epoch = jobEngine.epoch();
    /* **Asked directly, never through `takePreloaded`** (access.ts §
       `findArticle`), which may hand back a payload up to a minute old: the
       stand-in again, read as a stall. */
    void apiFetch(`/api/article/${encodeURIComponent(slug)}`)
      .then((res) => readJson<Article>(res))
      .then(
        (fetched) => {
          /* Superseded: by a newer request, by the reader moving to another
             article, or by another reader signing in to this tab. */
          if (request !== requests.current) return;
          if (now.current.slug !== slug || epoch !== jobEngine.epoch()) return;
          if (awaitingStructure(fetched.tree)) {
            setVerdict({ slug, kind: "stalled" });
            return;
          }
          if (!sameStructuralBlocks(now.current.article.blocks, fetched.blocks)) {
            setVerdict({ slug, kind: "mismatch" });
            return;
          }
          setVerdict(null);
          setLate({
            slug,
            /* The door every tree comes through on its way into component
               state — access.ts § The tree's door is this one too. */
            tree: withChildLists(fetched.tree),
            navLabelStatus: fetched.navLabelStatus,
          });
        },
        () => {
          if (request !== requests.current) return;
          if (now.current.slug !== slug || epoch !== jobEngine.epoch()) return;
          /* A failed read says nothing about whether building succeeded.
             Offer another read rather than another paid job. */
          setVerdict({ slug, kind: "unread" });
        },
      );
  }, [awaiting, swapped, fresh, coming, slug, completion]);

  const drawn = useMemo(
    () =>
      awaiting && swapped
        ? { ...article, tree: swapped.tree, navLabelStatus: swapped.navLabelStatus }
        : article,
    [article, awaiting, swapped],
  );

  if (!awaiting || swapped) return { article: drawn, structure: "final", retry };
  if (coming) return { article: drawn, structure: "building", retry };
  return { article: drawn, structure: verdict?.slug === slug ? verdict.kind : "building", retry };
}
