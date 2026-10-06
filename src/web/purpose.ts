/**
 * **Why you're reading this one** — the per-article half of the reader profile,
 * as the client reads and writes it (docs/project/reader-profile.md).
 *
 * One module because there are now four places that touch it — the Metadata
 * page's box, the add page's box, Skim's line and the profile panel — and two copies of a
 * `PATCH` are two places to forget `forgetSummaries`.
 * docs/plans/260930e-ask-why-you-are-reading-and-a-trajectory-for-that-intent.md.
 */
import { useEffect, useRef, useState } from "react";
import { apiFetch, leavingFetch, readJson } from "./lib/api.js";
import { profileSaved } from "./profile-saved.js";

/**
 * Store the purpose, and answer with **what the server stored** — it trims and
 * settles line endings, so a box must show that string rather than what was
 * typed. `null` clears it.
 *
 * **A caller that means "leave it alone" must not call this with `null`.** The
 * add page sends it only once its box has read and shown what is stored
 * (plan 260930e F1, kept by src/web/add-purpose.ts): before that an empty box
 * is not a request to erase a sentence the reader cannot see.
 *
 * Rejects with the server's sentence on failure.
 *
 * `madeFor` is the reader these words are for, when the caller can outlive a
 * change of reader: the add page's session sends its last words after the
 * page has gone. Sent as anybody else, the write is not sent and this rejects
 * (`NotThisReader` in lib/api.ts;
 * docs/plans/261006e-add-page-forgets-everything-when-the-reader-changes.md § 2).
 * The other callers name nobody.
 */
export async function savePurpose(
  slug: string,
  purpose: string | null,
  madeFor: string | null = null,
): Promise<string | null> {
  const body = await readJson<{ purpose: string | null }>(
    await apiFetch(
      `/api/library/${encodeURIComponent(slug)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ purpose }),
      },
      madeFor,
    ),
  );
  /* **The link cards' summaries were written from the old sentence.** They are
     cached per tab in front of a server that would have noticed
     (src/web/link-facts.ts § `forgetSummaries`), so without this a reader who
     changes their purpose and hovers a link they hovered before reads the
     answer written for the sentence they just replaced. `profileSaved`
     forgets them, and tells the command bar its list from why you are reading
     is old (src/web/profile-saved.ts). */
  profileSaved();
  return body.purpose ?? null;
}

/**
 * The same write as the page goes away, or the box with it — a `keepalive`
 * request started at once, with nothing awaited first (`leavingFetch`, and
 * useProfile.ts § `leaveProfile` for why not `apiFetch`). An empty box clears,
 * as every caller's `savePurpose` does. For `useAutosavedText`'s `leave`.
 *
 * One copy, for the box on Metadata, the first-open prompt and the profile
 * panel, which until 2026-10-02 each wrote this request out for themselves,
 * and since plan 261004l the add page's box.
 *
 * Forgets the link summaries as it sends and again when the write settles —
 * useProfile.ts § `leaveProfile` says why it takes both.
 *
 * `madeFor` as `savePurpose` has it: nothing is sent unless that reader is
 * the one this tab last saw.
 */
export function leavePurpose(slug: string, text: string, madeFor: string | null = null): void {
  profileSaved();
  void leavingFetch(
    `/api/library/${encodeURIComponent(slug)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ purpose: text === "" ? null : text }),
    },
    madeFor,
  ).then(profileSaved);
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
