/**
 * One line, at the bottom of the window, when the connection has gone.
 *
 * **Serving a saved copy without saying so is the failure this exists to
 * prevent.** The reader carries on reading, everything looks normal, and
 * nothing tells them that what they are looking at arrived from a database on
 * their own machine and may be a month behind the server. GPT Sol's review put
 * that plainly enough to move this out of "later" and into the same slice as
 * the cache itself: a cache without this is
 * [silent success](../../docs/reusable/silent-success.md) with a reader
 * attached.
 *
 * ## The words
 *
 * Per [copy.md](../../docs/project/copy.md): say what happened, say whose
 * problem it is, say what to do next, and carry a bracketed code so a test need
 * not pin the prose.
 *
 * It says **offline copy**, never "stale". *Stale* already means something
 * specific in this app — an artefact computed against an older version of the
 * article — and it is shown a few centimetres away in the same bands. Two
 * meanings for one word, in one screen, is how a reader stops trusting either.
 *
 * ## Why the bottom
 *
 * The reading line is near the top and the band is at the bottom edge already;
 * a strip that pushed the article down would move every row the moment a
 * connection dropped, which is the one moment a reader is least able to explain
 * why the text jumped. It is fixed, over the top of the page, and it does not
 * reflow anything.
 */
import { useOffline } from "./offline.js";

/** `14 August`, for a date the reader is meant to judge rather than parse. */
function readable(at: number): string {
  try {
    return new Date(at).toLocaleDateString(undefined, { day: "numeric", month: "long" });
  } catch {
    return "an earlier visit";
  }
}

export function OfflineStrip() {
  const { connected, servedCopyAt } = useOffline();

  /* Nothing at all while things work. This is not a status bar. */
  if (connected) return null;

  return (
    <div
      /* `status` rather than `alert`: a lost connection is worth saying once,
         in the reader's own time, and not worth interrupting a screen reader
         mid-sentence for. `polite` is the default for `status` and is spelled
         out here because the two are easy to conflate. */
      role="status"
      aria-live="polite"
      className="tw:fixed tw:bottom-0 tw:left-0 tw:right-0 tw:z-50 tw:px-4 tw:py-2 tw:text-center tw:text-sm tw:bg-amber-950/95 tw:text-amber-100 tw:border-t tw:border-amber-800/60"
    >
      {servedCopyAt === null ? (
        <>Spideryarn can’t reach its server. Anything not already open won’t load. [offline]</>
      ) : (
        <>
          Spideryarn can’t reach its server. Showing the copy saved on{" "}
          {readable(servedCopyAt)}. Reconnect to check for changes. [offline-copy]
        </>
      )}
    </div>
  );
}
