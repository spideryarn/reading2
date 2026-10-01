/**
 * **The owner's cross-references, as the prose draws them** — one
 * `GET /api/crossrefs/:slug`, and nothing else.
 *
 * docs/plans/260930f-cross-reference-links-between-blocks-with-a-rich-hover-preview.md
 * § 2, the data path (Sol F7): this hook → `OwnedReader` (ArticlePage.tsx) →
 * `ReaderCapability` → `Reader` → `TableView` and the block-link card.
 *
 * **Mounted only in `OwnedReader`.** A visitor's links arrive inside the
 * public article payload, already judged fresh by the same `isStale` (plan
 * 261001b), so a signed-out or non-owning reader makes no request for them,
 * and does not: the component that calls this is never mounted for them.
 *
 * **Unconditional**, like the other standing annotations (`useCitationsRead`,
 * `useQuotesRead`): the links are drawn in every mode, so there is no band
 * whose opening could trigger the read.
 *
 * ## What it yields
 *
 * **The links to draw, or null.** Null while loading, when none were ever
 * generated (the 404 that is the ordinary case), on an error, and — the one
 * that is a decision rather than an absence — **when the artefact is stale**
 * (Sol F8). A carried link can still name two surviving ids and a phrase that
 * still matches while no longer being true, and the prose has no panel to say
 * "out of date" in, so a stale artefact draws nothing until it is regenerated.
 * `outdated` (a newer prompt) is not stale: the article is the same.
 *
 * The array is the response's own, so its identity holds until the next read
 * lands — TableView keys its prose cache on it.
 *
 * ## It revalidates when a crossrefs job finishes
 *
 * The after-import box queues `crossrefs` while the article opens, so the
 * ordinary first read is a 404 and the links arrive a minute later. A job for
 * this article that writes `crossrefs` and reaches `done` while this page is
 * open **refreshes** the read — `refresh`, never `reload`, because a reload
 * joins a GET that may have read the database before the job wrote it
 * (useStepJob.ts § The read half is next door). `useJobs` announces only jobs
 * that finished after it began watching, so opening an article does not
 * refetch once per historical job. `"quiet"`: this mount has no progress to
 * show, so it does not keep the idle poll going on its own.
 */
import { useCallback, useEffect, useState } from "react";
import type { Crossref, CrossrefsResponse, Job } from "../types.js";
import { apiFetch, readJson } from "./lib/api.js";
import { useJobs } from "./useJobs.js";
import { useOrderedRead } from "./useOrderedRead.js";

/** What the prose may draw: this article's response links when fresh, else null. */
export function drawableCrossrefs(
  found: CrossrefsResponse | null,
  slug: string,
): readonly Crossref[] | null {
  /* The request-generation fence below stops a late response for the previous
     route. This is the other seam: the response itself must name the article it
     was requested for. Usually foreign block ids would happen not to place, but
     that is not an ownership or freshness check, and two revisions can preserve
     the same ids. **If slugs ever become renameable** (src/ingest.ts § the short
     id), the stored `crossrefs.slug` goes stale with them and this check would
     hide every link without a word — compare the revision, or rewrite the field
     in the rename. */
  if (!found || found.stale || found.crossrefs.slug !== slug) return null;
  return Array.isArray(found.crossrefs?.links) ? found.crossrefs.links : null;
}

export function useCrossrefs(slug: string): readonly Crossref[] | null {
  /* Keyed on the slug it answers, so an article switch never shows the last
     article's links against the new one's blocks — the nonce would still pass,
     and `to` would name a block of the wrong article. */
  const [read, setRead] = useState<{ slug: string; links: readonly Crossref[] | null } | null>(null);

  /* `current()` after every `await`, before any state is set — useOrderedRead.ts. */
  const load = useCallback(
    async (current: () => boolean) => {
      try {
        const res = await apiFetch(`/api/crossrefs/${encodeURIComponent(slug)}`);
        if (!current()) return;
        if (res.status === 404) {
          setRead({ slug, links: null });
          return;
        }
        const found = await readJson<CrossrefsResponse>(res);
        if (!current()) return;
        setRead({ slug, links: drawableCrossrefs(found, slug) });
      } catch {
        /* Nothing to say in the prose, and nothing to retry from: an owner's
           reading view without its underlines is the page it was yesterday. */
        if (current()) setRead({ slug, links: null });
      }
    },
    [slug],
  );

  /* Through `useOrderedRead` rather than a bare effect so StrictMode's second
     effect pass joins the first request instead of sending another — one GET
     per article view, which tests/the-ideas-extraction-changed-no-requests.test.tsx
     pins. */
  const { reload, refresh } = useOrderedRead(load);
  useEffect(() => {
    void reload();
  }, [reload]);

  const onFinished = useCallback(
    (job: Job) => {
      if (job.slug === slug && job.steps.some((s) => s.name === "crossrefs")) void refresh();
    },
    [slug, refresh],
  );
  useJobs("quiet", onFinished);

  return read?.slug === slug ? read.links : null;
}
