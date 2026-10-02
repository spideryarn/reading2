/**
 * **The one answer to "is this article archived", and the one way to change
 * it** — for every button that offers Archive or Put back.
 *
 * Lived in `Metadata.tsx` until 2026-10-02, when Archive got a third button, on
 * the reading view's masthead beside the sharing mark (Masthead.tsx §
 * `ArchiveMark`, Greg's spya-br27ef). A second copy of the rules below is the
 * thing that must not happen: each of them was found by a review, and a copy
 * that missed one would offer Archive over an archived article.
 * docs/plans/261002a-horizontal-scrollbar-wider-band-on-wide-windows-archive-button-on-the-masthead.md.
 */
import { useRef, useState } from "react";
import type { ArticleMetadata } from "../types.js";
import { apiFetch, readJson } from "./lib/api.js";

/**
 * Archive — and Put back, which is the whole reason it may.
 *
 * **It was called Delete until 2026-09-04**, and the handler behind it has
 * never done anything but archive. That gap is the whole of report
 * SPIDERYARN-READING2-19: Greg asked for an archive feature, from this page and
 * from the shelf, that had existed since 2026-08-26 — because the word on the
 * button told him he was looking at something else. Renaming a control is a
 * smaller act than building one and it was the entire fix.
 *
 * ## Why the placeholder that stood here for two days was right, and what changed
 *
 * This was a dimmed `SOON` row until 2026-08-27, and its stated reason was not
 * that the endpoint was missing — `PATCH /api/library/:slug` has taken
 * `{ archived }` since 2026-08-26 — but that the shelf's confirmation is a
 * nine-second Undo strip, and *"a page you can navigate away from is a bad
 * place to put the only chance to change your mind"*.
 *
 * That reason has been answered twice over. The shelf grew a **Show archived**
 * disclosure the same week, so the strip stopped being the only way back
 * ([Library.tsx](Library.tsx)); and this control does not use a strip at all.
 * An archived article stays readable by direct link — only the shelf filters
 * (docs/project/library.md) — so the reader who archives it from here is still
 * looking at its page afterwards, and the honest thing for that page to show is
 * the state it is now in, with the way out of it, and no clock. **The undo here
 * never expires.** That is a stronger promise than the shelf's, not a weaker
 * one, and it is available precisely because this page is about one article.
 *
 * ## Three states, and the third is the one to get right
 *
 * `undefined` is *we have not been told yet* — the metadata request is in
 * flight, or it failed. Neither may show a button at all, and the failed one
 * must not say which way round things are: a page that shows Archive over an
 * already-archived article, or Put back over a live one, has made a claim about
 * the reader's library out of a request that established nothing. The same rule
 * `AboutYou` above is arranged around, found by the same review.
 *
 * There is a fourth state above those three, and it is a refusal rather than an
 * ignorance: an address with **no article of its own**, which `loadArticle` and
 * `articleMetadata` both answer with the fixture. Nothing to archive, and the
 * PATCH would 404, so the section says so instead of offering a button whose
 * only outcome is an error. `showingFixture` at the call site.
 *
 * Nothing here needs a `key`: App.tsx already mounts this whole page as
 * `<Metadata key={slug}>`, so switching article remounts everything below it
 * and none of this state can cross from one article to another. An inner key
 * was written first and removed as redundant when a review pointed at the outer
 * one.
 */
export type ArchiveControl = {
  /** An ISO date, `null` for *on the shelf*, `undefined` for *we do not know*. */
  at: string | null | undefined;
  /** Unknown because something failed, rather than because nothing has answered yet. */
  lost: boolean;
  busy: boolean;
  error: string | null;
  set: (archived: boolean) => Promise<void>;
};

/** A real answer to the archive question, or `undefined` when the wire did not say. */
export function archiveAt(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) return undefined;
  return value;
}

/** Read the PATCH representation without turning a malformed success into *on the shelf*. */
function archiveAtFromPatch(value: unknown, slug: string): string | null | undefined {
  if (value === null || typeof value !== "object") return undefined;
  const entry = (value as Record<string, unknown>).entry;
  if (entry === null || typeof entry !== "object") return undefined;
  const row = entry as Record<string, unknown>;
  if (row.slug !== slug) return undefined;
  /* `LibraryEntry.archivedAt` is absent when the article is on the shelf; an
     explicit null says the same thing in tests and is harmless on the wire. */
  return "archivedAt" in row ? archiveAt(row.archivedAt) : null;
}

/**
 * **The page's one answer to "is this archived", and the one way to change it.**
 *
 * Lifted out of `ArchiveArticle` on 2026-09-30, when Archive got a second
 * button near the top of the page (`TopActions`, SPIDERYARN-READING2-6Z). Two
 * buttons with a state each could disagree on one screen — the top saying
 * *Archive* while the section says *Put back* — so both read this, and a press
 * on either flips both.
 * docs/plans/260930h-metadata-collapses-more-sections-and-archive-and-share-near-the-top.md.
 *
 * **`failed` makes `at` unknown**, which it did not before the lift: a failed
 * *refresh* keeps the old `provenance` on the page (see `readProvenance`), so
 * reading `archivedAt` off it alone offered Archive or Put back from an answer
 * the latest request could no longer vouch for. What the reader has done since
 * (`acted`) still wins, because the server told us that after the stale read.
 * GPT Sol, plan review, 2026-09-30.
 */
export function useArchive(
  slug: string,
  /** From the server, still `unknown` here because `readJson<T>` only casts. */
  archivedAt: unknown,
  /** Distinguishes an unanswered request from an answered body missing its required field. */
  answered: boolean,
  failed: boolean,
): ArchiveControl {
  /* What the reader has just done, if anything — `null` means they have not
     touched it, and the server's answer stands. A sentinel object rather than
     seeding a `useState` from the prop in an effect, because the prop arrives
     late and a seeding effect would need to know whether a later `provenance`
     is fresher than a click, which is a question with no good answer.

     `at: undefined` inside it is the third answer: *we asked, and we no longer
     know*. See the catch below. */
  const [acted, setActed] = useState<{ at: string | null | undefined } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /* `disabled` lands on both buttons at the next render. This closes the
     smaller window before that render, when the two controls can both dispatch
     their click and would otherwise send the same PATCH twice. */
  const inFlight = useRef(false);

  const fromServer = archiveAt(archivedAt);
  const unreadable = answered && fromServer === undefined;
  const at = acted ? acted.at : failed || unreadable ? undefined : fromServer;

  /* One function for both directions, because they are one PATCH with one
     boolean in it — exactly as `useShelf.undo` and `useShelf.restore` are
     deliberately the same request on the shelf side. Two functions here would
     be two places to get the field name wrong. */
  async function set(archived: boolean): Promise<void> {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const r = await apiFetch(`/api/library/${encodeURIComponent(slug)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archived }),
      });
      /* The server's own answer, not the boolean we sent. Both stores build
         this entry through `describeArticle`, so the date on it is the date
         that was stored — including the case that makes this worth doing:
         archiving something already archived keeps the ORIGINAL date
         (src/shelf.ts), and a locally-invented `new Date()` would print a
         timestamp the store disagrees with. */
      const stored = archiveAtFromPatch(await readJson<unknown>(r), slug);
      if (stored === undefined) {
        throw new Error("The server's answer did not say whether this article is archived.");
      }
      setActed({ at: stored });
    } catch (e) {
      /* **A failed request is not proof that nothing was written**, and saying
         so was this control's one dishonest sentence until a cross-model review
         took it apart, 2026-08-27. The route writes and *then* reads again to
         answer `purpose` (src/routes.ts § patchShelf), both stores persist and
         then rebuild the entry to return it, and a response can simply be lost
         on the way back. Every one of those fails after the archive has
         happened. A page that then says "Nothing changed" and offers Archive
         again is telling the reader something it has no way to know — and the
         Archive they press next is the one that looks like it did nothing.

         So: ask. The answer to "did that work" is a fresh read, not the
         request's own exit code. If even the re-read fails we are honestly
         lost, and `at: undefined` says so by taking the button away. */
      setError((e as Error).message);
      try {
        const m = await readJson<ArticleMetadata>(
          await apiFetch(`/api/metadata/${encodeURIComponent(slug)}`),
        );
        setActed({ at: archiveAt(m.archivedAt) });
      } catch {
        setActed({ at: undefined });
      }
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return {
    at,
    lost: at === undefined && (failed || unreadable || acted !== null),
    busy,
    error,
    set,
  };
}
