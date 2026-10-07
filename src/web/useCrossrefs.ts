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
 * generated (the ordinary case — a `200 null`, or a 404 from a server older
 * than plan 261006g), when the first read for this article fails, and — the one
 * that is a decision rather than an absence — **when the artefact is stale**
 * (Sol F8). A carried link can still name two surviving ids and a phrase that
 * still matches while no longer being true, and the prose has no panel to say
 * "out of date" in, so a stale artefact draws nothing until it is regenerated.
 * `outdated` (a newer prompt) is not stale: the article is the same.
 *
 * The array is the response's own, so its identity holds until the next read
 * lands — TableView keys its prose cache on it.
 *
 * **A failed re-read changes nothing.** Links this article's last answered
 * read gave stay drawn when a later read throws (a 500, a 401, a dropped
 * connection with no saved copy): a failure is not an answer, and until
 * 2026-10-06 it was treated as "none", which took the underlines out of the
 * prose after a finished job. It is still silent — there is no panel to say
 * it in. Only a read that answered clears: none, stale, or another article's.
 * tests/crossrefs-revalidate.test.tsx.
 *
 * ## It revalidates when a crossrefs job finishes
 *
 * The after-import box queues `crossrefs` while the article opens, so the
 * ordinary first read is "none yet" and the links arrive a minute later. A job for
 * this article that writes `crossrefs` and reaches `done` while this page is
 * open **refreshes** the read — `refresh`, never `reload`, because a reload
 * joins a GET that may have read the database before the job wrote it
 * (useStepJob.ts § The read half is next door). The listener is
 * `useStepFinished`, the one the other always-mounted reads use: it announces
 * only jobs that finished after it began watching, so opening an article does
 * not refetch once per historical job, and it is quiet — this mount has no
 * progress to show, so it does not keep the idle poll going on its own.
 */
import { useCallback, useEffect, useState } from "react";
import { NONE_YET_AS_NULL_HEADER } from "../types.js";
import type { Crossref, CrossrefsResponse } from "../types.js";
import { apiFetch, readJson } from "./lib/api.js";
import { useOrderedRead } from "./useOrderedRead.js";
import { useStepFinished } from "./useStepJob.js";

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
        /* The header asks for "none were ever generated" as `200 null` rather
           than a 404, which a browser prints in red on every ordinary page
           load (`NONE_YET_AS_NULL_HEADER`, src/types.ts). The 404 branch stays
           for a server that has not heard of the header — the minutes of a
           deploy. `drawableCrossrefs` already reads `null` as nothing to draw. */
        const res = await apiFetch(`/api/crossrefs/${encodeURIComponent(slug)}`, {
          headers: { [NONE_YET_AS_NULL_HEADER]: "1" },
        });
        if (!current()) return;
        if (res.status === 404) {
          setRead({ slug, links: null });
          return;
        }
        const found = await readJson<CrossrefsResponse | null>(res);
        if (!current()) return;
        setRead({ slug, links: drawableCrossrefs(found, slug) });
      } catch {
        /* Nothing to say in the prose, and nothing to retry from. **But a
           failure is not an answer**: what this article's last answered read
           gave stays as it is, links or none. Only when there is nothing for
           this slug — the first read, or the last article's state still here —
           does it settle on "nothing to draw". */
        if (current()) setRead((was) => (was?.slug === slug ? was : { slug, links: null }));
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

  useStepFinished(slug, "crossrefs", refresh);

  return read?.slug === slug ? read.links : null;
}
