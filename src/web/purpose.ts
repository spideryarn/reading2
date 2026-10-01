/**
 * **Why you're reading this one** — the per-article half of the reader profile,
 * as the client reads and writes it (docs/project/reader-profile.md).
 *
 * One module because there are now three places that touch it — the Metadata
 * page's box, the add page's box, and Skim's line — and two copies of a
 * `PATCH` are two places to forget `forgetSummaries`.
 * docs/plans/260930e-ask-why-you-are-reading-and-a-trajectory-for-that-intent.md.
 */
import { useEffect, useRef, useState } from "react";
import { apiFetch, readJson } from "./lib/api.js";
import { forgetSummaries } from "./link-facts.js";

/**
 * Store the purpose, and answer with **what the server stored** — it trims and
 * settles line endings, so a box must show that string rather than what was
 * typed. `null` clears it.
 *
 * **A caller that means "leave it alone" must not call this with `null`.** The
 * add page never does (plan 260930e F1): its box starts empty even on a re-add
 * of an article that already has a purpose, so an empty draft there is not a
 * request to erase a sentence the reader cannot see.
 *
 * Rejects with the server's sentence on failure.
 */
export async function savePurpose(slug: string, purpose: string | null): Promise<string | null> {
  const body = await readJson<{ purpose: string | null }>(
    await apiFetch(`/api/library/${encodeURIComponent(slug)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ purpose }),
    }),
  );
  /* **The link cards' summaries were written from the old sentence.** They are
     cached per tab in front of a server that would have noticed
     (src/web/link-facts.ts § `forgetSummaries`), so without this a reader who
     changes their purpose and hovers a link they hovered before reads the
     answer written for the sentence they just replaced. */
  forgetSummaries();
  return body.purpose ?? null;
}

/**
 * What `GET /api/reader?slug=` says about this article's purpose.
 *
 * `purposeFailed` is the server saying the shelf could not be read — which must
 * never render as "you have not said", because a reader told that will type
 * over the sentence they already wrote. src/web/ProfilePanel.tsx has the same
 * three states and the reason at length.
 */
export type PurposeRead =
  | { state: "loading" }
  | { state: "ready"; purpose: string | null; purposeFailed: boolean }
  | { state: "failed" };

/** Read the purpose for `slug`, once per slug. For Skim's line (stage 2). */
export function usePurpose(slug: string): PurposeRead {
  const [read, setRead] = useState<PurposeRead>({ state: "loading" });
  /* A generation rather than a `live` boolean, for StrictMode — ProfilePanel's
     `generation` says why. */
  const generation = useRef(0);
  useEffect(() => {
    const mine = ++generation.current;
    setRead({ state: "loading" });
    apiFetch(`/api/reader?slug=${encodeURIComponent(slug)}`)
      .then((r) => readJson<{ purpose: string | null; purposeFailed?: boolean }>(r))
      .then(
        (body) =>
          mine === generation.current &&
          setRead({
            state: "ready",
            purpose: body.purpose ?? null,
            purposeFailed: body.purposeFailed === true,
          }),
      )
      .catch(() => mine === generation.current && setRead({ state: "failed" }));
    return () => {
      generation.current++;
    };
  }, [slug]);
  return read;
}
