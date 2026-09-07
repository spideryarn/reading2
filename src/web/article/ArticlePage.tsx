/**
 * **One article, fetched once for all three of its views**, and the three
 * components that stand for the three footings you can read it on: your own
 * (`OwnedArticle` and `OwnedReader`), or somebody else's, shared
 * (`VisitorArticle`).
 *
 * The boundaries between them are the capability seam, not a tidy-up: a hook
 * cannot be skipped conditionally, so *a visitor does not do this* has to be a
 * component that does not exist. reader-capability.ts says it at length.
 *
 * Lifted out of `App.tsx` unchanged on 2026-09-06, together with the access
 * hook it calls (access.ts, beside this file), in the shape the mode
 * controllers established a day earlier: a unit with its own reason to change
 * moves into a file of its own, keeping its code byte-for-byte, so `App.tsx`
 * stops knowing what is inside it. What is left up there is route choice, the
 * session and the persistent services. See
 * docs/plans/260906c-separate-article-access-reader-composition-and-mode-controllers.md.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Article, Comment, Visibility } from "../../types.js";
import { HomeLogo } from "../HomeLogo.js";
import { LandingPage } from "../LandingPage.js";
import type { ArticleView } from "../router.js";
import { Metadata } from "../Metadata.js";
import { Reader } from "../reader/Reader.js";
import { Tweets } from "../Tweets.js";
import { useSlow } from "../useSlow.js";
import { useArc } from "../useArc.js";
import { useGlossaryRead } from "../useGlossary.js";
import type { SavedSearch } from "../useSearch.js";
import { useLastView } from "../last-view.js";
import { useComments } from "../useComments.js";
import { useChatAnchors } from "../useChatAnchors.js";
import { articleWaitTitle, useDocumentTitle } from "../page-title.js";
import { apiFetch } from "../lib/api.js";
import type { PublicArtefactSet, PublicArtefacts } from "../../public-types.js";
import { NotSharedPage, ReauthRequiredPage } from "../PublicChrome.js";
import { PublicMetadataPage, VisitorTweetsPage } from "../PublicPages.js";
import { useRenderCount } from "../perf.js";
import { FeedbackTrigger } from "../FeedbackButton.js";
import { useArticleAccess } from "./access.js";

/**
 * One article, fetched **once for all three of its views**.
 *
 * The fetch lives here rather than in the reading view because the metadata and
 * tweet pages need the same payload, and because this component does not
 * remount when only the view changes: stepping out to the metadata page and
 * back is then free, rather than 150KB and a spinner each way. The remount that
 * *does* matter is keyed below, on the slug.
 *
 * **What it no longer holds is anything that only an owner may do.** The
 * record-open POST and the rename overlay moved down into `OwnedArticle`, and
 * the private hooks moved into `OwnedReader`, because "never mounted" is the
 * only version of "a visitor does not do this" that survives contact with a
 * network trace. A boolean prop cannot express it: a hook cannot be skipped
 * conditionally inside one component, so the condition has to be a component
 * boundary. GPT Sol, answer 8 on this plan's stage-1 input, 2026-08-28.
 */
export function ArticlePage({
  slug,
  view,
  readerId,
}: {
  slug: string;
  view: ArticleView;
  /**
   * **Who is reading, or `null` for nobody** — and it is the identity rather
   * than a boolean for a reason `useArticleAccess` sets out at length: a
   * boolean cannot tell owner A from reader B, so an answer fetched for one was
   * being shown to the other.
   *
   * Below this line the only question anyone asks of it is *is there a
   * session*, and only for the sign-up offer. Everything else keys on *is this
   * mine*: a signed-in reader on somebody else's shared document sees exactly
   * what a stranger sees, which is the rule the whole read-only chrome follows.
   * docs/plans/260827ai-public-read-only-access.md.
   */
  readerId: string | null;
}) {
  useRenderCount("ArticlePage");
  /* **Reopen this article where the reader left it.** Above the fetch, and
     first, because its restore is a layout effect that settles the address
     before anything paints — `useReadingPosition` then reads the `?at=` it put
     back exactly as it reads a pasted one, and needs to know nothing about it.

     Here rather than in main.tsx, which is where every other address rewrite
     lives, because those run once per page load and the commonest way to reopen
     an article is a click on the shelf — a client-side navigation that never
     re-runs that file. src/web/last-view.ts has the whole of it, including why
     a shared link always beats the memory. */
  useLastView(slug);
  const access = useArticleAccess(slug, readerId);
  const signedIn = readerId !== null;
  const slow = useSlow(access.kind === "loading");

  /**
   * The tab, for the two states this component owns and no others.
   *
   * Once the article is here, each of the views sets its own title — Reader has
   * the mode, Metadata and Tweets have their own names — and this must then get
   * out of the way. Hence the empty string, which `useDocumentTitle` treats as
   * "not mine to set": React runs a child's effects *before* its parent's, so a
   * title computed here would otherwise land on top of the more specific one
   * the child had just written.
   *
   * **`Loading…` waits for `slow`, the same threshold the line below waits
   * for.** A tab that flickers through "Loading…" on every fast navigation is
   * the tab equivalent of a spinner that flashes and vanishes, and it is worse
   * than that here: the title is announced to a screen reader, so a flicker
   * nobody sees is an interruption somebody hears. Until then the previous
   * title stands, which is exactly what a browser does during a real page load.
   *
   * **And on a shared link it does not say `Loading…` at all**, because the
   * server already put the article's real title in the tab and replacing it
   * would be a step backwards. That decision is `articleWaitTitle` in
   * page-title.ts, which is where the two guards it needs are explained; this
   * component's job is to say which of the three states it is in.
   */
  useDocumentTitle(
    articleWaitTitle(
      access.kind === "error" ? "error" : access.kind === "loading" && slow ? "loading" : "ready",
      slug,
      /* Read at call time rather than captured: the question `articleWaitTitle`
         asks is whether the tab *still* shows what the server put there, and a
         value captured earlier could not answer it. */
      typeof document === "undefined" ? "" : document.title,
    ),
  );

  /* **Which of the six branches below draws a way home, and where.**
     `LandingPage` draws its own wordmark, so this branch adds nothing. The four
     that follow — not-shared, reauth-required, error and loading — keep the
     corner mark, because the reader may have arrived straight here from a
     pasted link with no shelf behind them, and a visitor with no account
     especially so, since the mark is the only thing on screen that says whose
     page this is. The last branch draws none: it mounts a `Dock`, and the bar
     carries the wordmark there (2026-09-06 — see that branch). */
  if (access.kind === "not-shared") return signedIn ? <NotSharedPage /> : <LandingPage />;

  /* **Its own branch, beside `error` and never through it.** The reader can fix
     this one, and the error page is a `<pre>` with nothing to press. It draws
     its own corner logo, as `NotSharedPage` above does. PublicChrome.tsx. */
  if (access.kind === "reauth-required") return <ReauthRequiredPage />;

  /* **The corner pair, on the two branches with no bar to put it in.**
     `App` stopped drawing the corner Feedback trigger on the `read` route on
     2026-09-06, because the pages that mount a `Dock` draw it in the bar
     instead — and these two mount none. Without this line a signed-in reader
     waiting for an article, or looking at one that failed, would have no way to
     report the thing they are looking at, which is the state a report is most
     likely to be about. `FeedbackTrigger` renders nothing with no host above
     it, so a stranger here still gets none. */
  if (access.kind === "error")
    return (
      <>
        <HomeLogo />
        <FeedbackTrigger variant="corner" />
        <pre className="error">{access.message}</pre>
      </>
    );

  // Silent until the wait is worth mentioning (useSlow.ts owns the threshold),
  // then a line naming what is being waited for rather than "Loading…".
  if (access.kind === "loading")
    return (
      <>
        <HomeLogo />
        <FeedbackTrigger variant="corner" />
        <div className="loading">{slow ? "Fetching the article and its summaries…" : ""}</div>
      </>
    );

  /* Keyed on the slug so switching article remounts rather than trying to carry
     one article's reading position — or one owner's rename, or one visitor's
     artefact flags — into another's. NOT keyed on the view: switching view is
     meant to keep the fetch, which is the whole reason it happens up here. */
  /* **No corner pair here since 2026-09-06, and this is the branch that lost
     it.** Every page below this line mounts a `Dock` — the reading view, the
     metadata and tweets pages, and the three visitor stand-ins in
     PublicPages.tsx — and the bar draws both the wordmark and the Feedback
     trigger itself (Dock.tsx). A `<HomeLogo />` here would be a second way home
     on the same screen, one of them fixed over the top of the spine while the
     bars are hidden, which is the live bug this move dissolves:
     docs/postmortems/260905g-the-top-of-the-spine-is-under-the-wordmark-on-a-phone.md.

     **The reservation has not followed yet**, and that is the intended
     intermediate state rather than a miss: the masthead and the controls bar
     still hold ~136px of left gutter and ~120px of right open on these pages
     for controls that are no longer in them. Stage 2 of the plan takes it out,
     across the five `main` elements that hold it. */
  return (
    <>
      {access.kind === "owned" ? (
        <OwnedArticle key={slug} slug={slug} article={access.article} view={view} />
      ) : (
        <VisitorArticle
          key={slug}
          slug={slug}
          article={access.article}
          artefacts={access.artefacts}
          available={access.available}
          comments={access.comments}
          searches={access.searches}
          signedIn={signedIn}
          sessionUnconfirmed={access.sessionUnconfirmed}
          view={view}
        />
      )}
    </>
  );
}
/**
 * **Your own article**, and everything that follows from it being yours.
 *
 * Three things live here rather than a level up, and all three are the same
 * decision: they must not exist at all for a visitor, and the only reliable way
 * to say "must not exist" in React is to put them behind a component boundary.
 *
 *  - the record-open POST, which a visitor has no shelf to be counted on;
 *  - the rename overlay, whose PATCH a visitor would be refused;
 *  - the owner's `Metadata` page, which mounts editing, deletion, the profile
 *    boxes and the pipeline's own provenance.
 */
function OwnedArticle({
  slug,
  article: fetched,
  view,
}: {
  slug: string;
  article: Article;
  view: ArticleView;
}) {
  /**
   * The title the reader has just given this article, if they have.
   *
   * **Layered over the fetched payload rather than written into it**, which is
   * the same shape the server uses: `titleFor` in src/library-scalars.ts does not edit the
   * extractor's meta either, it picks the reader's title over it at the moment
   * of answering. Two reasons it matters here.
   *
   * One, the fetched payload has been through `sanitizeArticle`
   * (tests/sanitize-client.test.ts), and that guard is worth more than the
   * convenience of editing state in place. A rename introduces no HTML and
   * would have to be spelled as an exemption, and an exemption is how a guard
   * stops meaning anything.
   *
   * Two, the memo. `Reader` rebuilds the whole geometry from `article` by
   * identity, so a fresh object per render would rebuild the table on every
   * keystroke elsewhere in the page. Hence the `useMemo` below rather than a
   * spread in the render body.
   *
   * The slug travels beside the title, exactly as it did when this state lived
   * one component up: the PATCH behind a rename resolves after the reader may
   * have moved on. This component is keyed on the slug now, so the pair is
   * belt-and-braces rather than the whole guard — and it is three lines to keep
   * a rule that used to be load-bearing and would fail silently if the key ever
   * moved. GPT Sol, 2026-08-27.
   */
  const [renamed, setRenamed] = useState<{ slug: string; title: string } | null>(null);
  const title = renamed?.slug === slug ? renamed.title : null;

  /**
   * **Who can read this, if the reader has just changed it** — the second thing
   * layered over the payload, and it is here for the same reason the rename is.
   *
   * This component does not remount when only the view changes, which is the
   * whole point of the fetch living a level up: stepping out to the metadata
   * page and back is free rather than 150KB and a spinner. The cost is that a
   * fact the metadata page *changes* stays as it was fetched — and one of the
   * facts on that page is now also drawn in the masthead
   * (src/web/Masthead.tsx § `SharingMark`). Without this, publishing an article
   * and pressing Back left a lock over a document anyone with the link could
   * read: not a stale number, the one sentence about sharing that must never be
   * wrong. Nothing would have caught it — the payload is correct, the card is
   * correct, and they disagree.
   *
   * **`"unknown"` is a third value rather than a missing one.** A write that
   * failed after the server committed leaves `AccessSharing` unable to say what
   * is true (`WRITE_UNCERTAIN` there), and the honest thing for the masthead is
   * to stop claiming a state rather than keep the one from before the write. It
   * *removes* the key, because an absent `Article.visibility` already means
   * *nobody could tell us* — the same thing the filesystem store's silence
   * means (src/types.ts).
   *
   * The slug travels beside it for the reason it travels beside the title: the
   * `PUT` behind it resolves after the reader may have moved on.
   */
  const [shared, setShared] = useState<{ slug: string; visibility: Visibility | "unknown" } | null>(
    null,
  );
  const visibility = shared?.slug === slug ? shared.visibility : null;

  const article = useMemo(() => {
    /* `!== null`, not truthiness: clearing an override restores the
       extractor's title, and `Meta.title` may be the empty string. Read as
       truthy that would silently fall through to `fetched`, which is still
       carrying the override that was just cleared. */
    const named = title !== null ? { ...fetched, meta: { ...fetched.meta, title } } : fetched;
    if (visibility === null) return named;
    if (visibility === "unknown") {
      /* Deleted rather than set to `undefined`: `exactOptionalPropertyTypes`
         makes those different values, and the one that means *we cannot say*
         is the absent key. */
      const { visibility: _cleared, ...rest } = named;
      return rest;
    }
    return { ...named, visibility };
  }, [fetched, title, visibility]);

  const renameTo = useCallback(
    (forSlug: string, next: string) => setRenamed({ slug: forSlug, title: next }),
    [],
  );
  /**
   * **The same answer twice is not a change.**
   *
   * The card reports what the metadata page's own fetch said as well as what a
   * write said (AccessSharing.tsx), so the ordinary visit — open the page, read
   * the value the payload already carried, go back — reports a value identical
   * to the one in hand. Returning the same state object for that keeps
   * `article` referentially stable, and `Reader` rebuilds its whole geometry
   * from `article` by identity.
   */
  const sharedTo = useCallback((forSlug: string, next: Visibility | null) => {
    const now: Visibility | "unknown" = next ?? "unknown";
    setShared((was) =>
      was?.slug === forSlug && was.visibility === now ? was : { slug: forSlug, visibility: now },
    );
  }, []);

  /**
   * One more open, for the shelf's tooltip to count.
   *
   * **From here, not from inside `GET /api/article/:slug`.** A GET that writes
   * is a GET that a prefetch, a retry or a health check inflates without
   * anybody deciding to — and the shelf itself does not fetch article payloads,
   * so counting on the server would count a different thing anyway.
   *
   * **And not from a visitor at all**, which is why it is in this component
   * rather than in `ArticlePage`. There is no shelf row to count against, the
   * POST would be refused, and the acceptance test for public reading is that a
   * signed-out browser issues no POST whatever.
   *
   * **The ref is not belt-and-braces; without it the number is simply wrong.**
   * `<StrictMode>` is on (main.tsx), and in development React deliberately runs
   * every effect twice — so every article opened counted as two, and the
   * tooltip said "opened 19 times" to somebody who had opened it nine. It would
   * have been right in a production build, which is the worst version of this:
   * a number that is confidently wrong exactly where anybody would look at it.
   * A ref survives StrictMode's simulated remount, so this counts once per slug
   * per mount either way. See docs/reusable/silent-success.md.
   *
   * See src/shelf.ts and docs/project/library.md.
   */
  const counted = useRef<string | null>(null);
  useEffect(() => {
    if (counted.current === slug) return;
    counted.current = slug;
    void apiFetch(`/api/library/${encodeURIComponent(slug)}/open`, { method: "POST" }).catch(
      () => {},
    );
  }, [slug]);

  if (view === "metadata")
    return (
      <Metadata
        slug={slug}
        article={article}
        onRenamed={renameTo}
        onVisibility={sharedTo}
      />
    );
  if (view === "tweets") return <Tweets slug={slug} article={article} />;
  return <OwnedReader slug={slug} article={article} onRenamed={renameTo} />;
}
/**
 * **Where the private hooks are mounted, and the only place they are.**
 *
 * `useComments`, `useChatAnchors` and `useGlossaryRead` each fetch on mount
 * against an authenticated endpoint. A `readOnly` prop on `Reader` could not
 * have kept them out — React forbids calling a hook conditionally — so the
 * condition is this component existing, which is the point of the capability
 * seam. Sol's answer 8 predicted this would be the expensive part of the client
 * work and it was right.
 *
 * The three results are handed down as one object rather than nine props so
 * that the visitor case is a *different member of a union* rather than nine
 * absent values, and `Reader` reads them through one `capability.kind === "owner"`
 * test. reader-capability.ts.
 */
function OwnedReader({
  slug,
  article,
  onRenamed,
}: {
  slug: string;
  article: Article;
  onRenamed: (slug: string, title: string) => void;
}) {
  const comments = useComments(slug);
  const chatAnchors = useChatAnchors(slug);
  /**
   * **One read, shared with the band.** `useGlossaryRead` is the opening fetch
   * — the list and the three facts about whether it still describes the article
   * and the reader — and `GlossaryBand` layers the job poller and the verbs on
   * top of it rather than starting from `loading` of its own. Until 2026-08-27
   * it fetched the same URL again, so the panel said "Looking for a glossary…"
   * while the list it wanted was already on screen, underlined, in the prose
   * behind it. docs/plans/260827am-glossary-read-latency.md.
   *
   * The band does still *revalidate* when it opens — see `useGlossaryRead` for
   * why it has to — but behind the list, never in front of it.
   *
   * `GlossaryBand` still exists for the reason it always did, which was never
   * the opening fetch: subscribing to the job engine puts it on its idle
   * cadence, and a reader who never opens the band should not pay for that.
   */
  const glossary = useGlossaryRead(slug);
  /**
   * **The arc, and the request for one if there is none.** Here rather than in
   * `Reader` for the same reason the three above are: it can POST, and the
   * acceptance test for public reading is that a signed-out browser issues no
   * POST at all. A visitor keeps the payload's arc, or none.
   * src/web/useArc.ts § Who must not reach this.
   */
  const arc = useArc(slug, article.arc);

  return (
    <Reader
      slug={slug}
      article={article}
      capability={{ kind: "owner", comments, chatAnchors, glossary, arc }}
      onRenamed={onRenamed}
    />
  );
}

/**
 * **Somebody else's article, shared.** Signed out, or signed in and not the
 * owner — the same page either way, because the question is *is this mine*.
 *
 * Note which components are reachable from here: `Reader`, and two small pages
 * written for this case. `Metadata` and `Tweets` are not among them, and that
 * is the seam rather than an omission — between them they mount the profile
 * boxes, the delete button, the provenance fetch and `useJobs`.
 */
function VisitorArticle({
  slug,
  article,
  artefacts,
  available,
  comments,
  searches,
  signedIn,
  sessionUnconfirmed,
  view,
}: {
  slug: string;
  article: Article;
  /** The artefacts the payload carried. reader-capability.ts § artefacts. */
  artefacts: PublicArtefactSet;
  available: PublicArtefacts;
  /** The owner's comments, read-only. reader-capability.ts § comments. */
  comments: Comment[];
  /** The owner's saved searches, read-only. reader-capability.ts § searches. */
  searches: SavedSearch[];
  /** For the call to action, and nothing else — reader-capability.ts § signedIn. */
  signedIn: boolean;
  /**
   * **Only for what the chrome says**, and it goes to all three views rather
   * than to the reading view alone: the other two are one click away and carry
   * the same `SharedNotice`, so a reader who stepped out to the metadata page
   * would otherwise watch the explanation vanish. App.tsx § ArticleAccess.
   */
  sessionUnconfirmed: boolean;
  view: ArticleView;
}) {
  if (view === "metadata")
    return (
      <PublicMetadataPage
        slug={slug}
        article={article}
        available={available}
        signedIn={signedIn}
        sessionUnconfirmed={sessionUnconfirmed}
      />
    );
  if (view === "tweets")
    return (
      <VisitorTweetsPage
        slug={slug}
        article={article}
        thread={artefacts.tweets}
        available={available}
        signedIn={signedIn}
        sessionUnconfirmed={sessionUnconfirmed}
      />
    );
  return (
    <Reader
      slug={slug}
      article={article}
      capability={{
        kind: "visitor",
        artefacts,
        available,
        comments,
        searches,
        signedIn,
        sessionUnconfirmed,
      }}
    />
  );
}
