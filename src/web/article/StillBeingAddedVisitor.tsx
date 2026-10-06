/**
 * **A shared address, opened before its article is published** — the page a
 * visitor waits on. docs/plans/261005l-permalink-and-share-while-an-article-is-importing.md
 * § Stage 2, 2c. Greg, 2026-10-06:
 *
 * > if it's not too complex, a "still being added" page sounds good. i'm not
 * > too worried about the security tradeoff
 *
 * The public article read answers `409 still-being-added` for an article the
 * request may read (public, or opened with its private link's key) whose
 * import is queued or running (src/still-being-added.ts). Before this the
 * person a link was sent to met the landing page, or *Not shared*, for the
 * minutes a PDF import takes.
 *
 * ## Who is drawn this
 *
 * A signed-out visitor, at once. A signed-in reader only where
 * `OwnerNotShared` (StillBeingAdded.tsx) would have said *Not shared*: that
 * component looks for their own import first, and its card is the better
 * page when there is one. `ArticlePage` makes both choices.
 *
 * ## It asks again; it decides nothing
 *
 * Every `RECHECK_MS` while the tab is visible, when the tab comes back, and
 * on *Check now*, it asks the same public read the page was drawn from. An
 * answer other than *still being added* is not acted on here: `onChanged`
 * has `ArticlePage` run its own two-step again, and that draws the article,
 * the landing page or *Not shared* exactly as it would have on arrival. So
 * there is one place that decides what a visitor sees, and this is not it.
 * The price is that a published article is fetched twice, once.
 *
 * A re-ask that fails changes nothing, and the next one is asked as usual.
 *
 * ## It promises nothing about when
 *
 * A queued import may be waiting on its owner's browser (GPT Sol's stage 2
 * plan review, F5), so the sentence says *when it is ready* and no more.
 *
 * It says nothing about the article either: the 409 carries no title, and the
 * tab says only what the heading says.
 */
import { useEffect, useRef, useState } from "react";

import { STILL_BEING_ADDED_HEADING, STILL_BEING_ADDED_VISITOR } from "../../messages.js";
import type { ShareKey } from "../../share-key.js";
import { APP_NAME, SEP } from "../../title-text.js";
import { Button } from "../components/ui/button.js";
import { FeedbackTrigger } from "../FeedbackButton.js";
import { HomeLogo } from "../HomeLogo.js";
import { useDocumentTitle } from "../page-title.js";
import { loadPublicArticle } from "../public-api.js";

/** How often the page asks again while the tab is visible. */
export const RECHECK_MS = 10_000;

export function StillBeingAddedVisitor({
  slug,
  shareKey,
  onChanged,
}: {
  slug: string;
  /** The private link's key the address carries, or `null`. Sent with every re-ask. */
  shareKey: ShareKey | null;
  /** The public read no longer says *still being added*: published, not shared, or failed. */
  onChanged: () => void;
}) {
  useDocumentTitle([STILL_BEING_ADDED_HEADING, APP_NAME].join(SEP));
  const [checking, setChecking] = useState(false);
  /* *Check now* reaches the effect's own `ask`, so there is one request out
     at a time whichever of the three asked for it. */
  const askRef = useRef<() => void>(() => {});
  const changedRef = useRef(onChanged);
  changedRef.current = onChanged;

  useEffect(() => {
    /* One per slug and key. Leaving either, or the page, aborts what is out
       and makes its answer nobody's. */
    const gone = new AbortController();
    let out = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    const ask = (): void => {
      if (out || gone.signal.aborted) return;
      out = true;
      setChecking(true);
      void loadPublicArticle(slug, gone.signal, shareKey).then(
        (answer) => {
          if (gone.signal.aborted) return;
          out = false;
          setChecking(false);
          if (answer.kind !== "still-being-added") changedRef.current();
        },
        () => {
          if (gone.signal.aborted) return;
          out = false;
          setChecking(false);
        },
      );
    };
    askRef.current = ask;

    const watch = (): void => {
      if (timer === null) timer = setInterval(ask, RECHECK_MS);
    };
    const rest = (): void => {
      if (timer !== null) clearInterval(timer);
      timer = null;
    };
    const visibility = (): void => {
      if (document.visibilityState === "visible") {
        /* Back to the tab is the moment somebody wants to know. */
        if (timer === null) ask();
        watch();
      } else rest();
    };
    if (document.visibilityState === "visible") watch();
    document.addEventListener("visibilitychange", visibility);
    return () => {
      gone.abort();
      rest();
      document.removeEventListener("visibilitychange", visibility);
      askRef.current = () => {};
      setChecking(false);
    };
  }, [slug, shareKey]);

  /* The chrome `NotSharedPage` uses (PublicChrome.tsx): the corner pair and
     one narrow column. The Feedback trigger draws nothing for a stranger. */
  return (
    <>
      <HomeLogo />
      <FeedbackTrigger variant="corner" />
      <main className="tw:mx-auto tw:max-w-xl tw:px-6 tw:pt-24 tw:font-sans">
        <h1 className="tw:m-0 tw:mb-3 tw:font-prose tw:text-2xl tw:text-foreground">
          {STILL_BEING_ADDED_HEADING}
        </h1>
        <p className="tw:m-0 tw:mb-4 tw:text-sm tw:text-ink-faint">{STILL_BEING_ADDED_VISITOR}</p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={checking}
          onClick={() => askRef.current()}
        >
          Check now
        </Button>
      </main>
    </>
  );
}
