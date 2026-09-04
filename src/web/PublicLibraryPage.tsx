/**
 * **`/read/public` — every article anybody has shared, to anybody.**
 *
 * Greg, 2026-09-04: *"create a `/read/public/` page that lists Public-readable
 * pages (reusing some of the article-listing machinery from Homepage), and pick a
 * few of those to link to from various places to showcase what Spideryarn is
 * capable of."*
 *
 * The data, the query, the route and the client loader were built a stage
 * earlier and both ends deliberately answered 404 until this file existed
 * (docs/plans/260904b-pricing-page-and-public-showcase.md § Stage 3b). What is
 * decided *here* is three things, and each of them had a plausible other answer.
 *
 * ## 1. A card of its own, rather than `ShelfCard` with its verbs made optional
 *
 * **The option rejected: making `ShelfCard`'s owner verbs optional capabilities**
 * — the callback being the capability — so that one component draws both shelves.
 * That is the right instinct in general and it is the wrong trade here, because
 * of what `ShelfCard` is actually made of rather than because of how it looks.
 *
 * It takes `LibraryEntry` and `Shelf`, and `Shelf` is the whole `useShelf`
 * hook — rename, archive, undo, an error channel, and `apiFetch` underneath all
 * of it. Sharing the component means the union of two entry types, an optional
 * hook, and a conditional around `TitleEditor`, `Actions`, the details `Tooltip`
 * and the `note` line: six branches inside one component, of which the public
 * page exercises one arm and the owner's shelf the other, so **every one of them
 * is a place where a change checked on the shelf silently alters a page a
 * stranger sees**. It would also put an owner-scoped hook in the import graph of
 * a page mounted for people with no account, which is the shape
 * `tests/public-shelf-page.test.tsx` exists to refuse.
 *
 * `PublicCard` below is about forty lines and touches nothing. The duplication
 * is the border tokens and a stretched link — the same trade
 * `src/store/public-library.ts` makes against importing the article reader, and
 * for the same reason: two readers that must not become one. What is genuinely
 * shared is shared for real — `readHref` decides where an article lives, so the
 * two shelves cannot disagree about that.
 *
 * ## 2. The marketing bar, and no footer, which is not an inconsistency
 *
 * **The nav is `SiteNav`**, the same bar `/`, `/features` and `/pricing` carry.
 * The alternative was `PublicChrome.tsx`'s visitor chrome, and it does not fit:
 * that is *article* chrome — a chip inside the reading view's controls bar and a
 * notice under a masthead, both saying *this document is read-only* — and there
 * is no document here. This page is somewhere a stranger is **sent**, to find
 * out what the thing does, so the furniture it wants is the furniture the other
 * pages a stranger is sent to already have: a way to Home, Features, Pricing,
 * Privacy and a sign-in.
 *
 * **And no `SiteFooter`**, which looks like an inconsistency and is Greg's rule
 * taken at its word: *"NOT on any `/read/*` pages"*. `SiteFooter.tsx` § Where it
 * goes records that a previous version of that file read the exclusion as being
 * about the reading *view* rather than the path, gave the row to
 * `PublicChrome`'s two dead ends on that reasoning, and had it called
 * rationalising by a cross-family review. This page sits at a `/read/` address,
 * so it is out on the same terms — and nothing is lost, because the bar above
 * already carries every link the row would.
 *
 * ## 3. An empty shelf is a page
 *
 * The route answers 200 with an empty list rather than 404, because *"nobody has
 * shared anything"* is an answer about the world
 * (`src/store/public-library.ts` § `scrubbed`). So there is a real empty state
 * here, with the heading still above it — a page that drew nothing over an empty
 * list would be indistinguishable from one whose fetch never came back.
 *
 * Every sentence is in `src/messages.ts` § the shelf of public articles.
 * docs/project/public-shelf.md is the doc.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import {
  PUBLIC_SHELF_EMPTY,
  PUBLIC_SHELF_FAILED,
  PUBLIC_SHELF_HEADING,
  PUBLIC_SHELF_LEDE,
  PUBLIC_SHELF_RETRY,
  PUBLIC_SHELF_SLOW,
  PUBLIC_SHELF_TRUNCATED,
  publicShelfShared,
  publicShelfWords,
} from "../messages.js";
import type { PublicLibrary, PublicLibraryEntry } from "../public-library-types.js";
import { Link } from "./Link.js";
import { pageTitle, useDocumentTitle } from "./page-title.js";
import { loadPublicLibrary } from "./public-api.js";
import { timeAgo } from "./relative-time.js";
import { readHref } from "./router.js";
import { SHELL, SiteNav } from "./SiteBits.js";
import { useSlow } from "./useSlow.js";

export function PublicLibraryPage({
  signedIn,
}: {
  /**
   * Whether a reader with an account is looking at this — **for the top bar and
   * nothing else**, and that is the whole of its job.
   *
   * A visitor and an owner are served identical bytes on this page, which is the
   * rule the entire public namespace follows; what differs is only whether the
   * bar offers a *Sign in* link that would go nowhere for somebody already
   * signed in (SiteBits.tsx § `signedIn`). `tests/public-shelf-page.test.tsx`
   * asserts the request is the same either way, because the obvious
   * "improvement" here is to enrich the page for a signed-in reader, and that
   * would put an owner-scoped read on a page a stranger renders.
   */
  signedIn: boolean;
}) {
  useDocumentTitle(pageTitle({ kind: "public-library" }));
  const { state, again } = usePublicShelf();
  /* Silent until the wait is worth mentioning — a line that flashes up and away
     reads as a fault. `useSlow` owns the threshold, and the shelf's own loading
     line follows the same rule. */
  const slow = useSlow(state.kind === "loading");

  return (
    /* **`className="site"` is required, not decorative.** The `--site-*` custom
       properties are declared on `.site` (styles.css § the site), so without it
       `SiteNav`'s bar and the glow below draw against nothing — a page that looks
       unstyled rather than broken, which is the version nobody reports. Copied
       from PricingPage.tsx, which found that out the hard way. */
    <div className="site tw:font-sans tw:text-muted-foreground">
      <SiteNav here="public-library" signedIn={signedIn} />

      {/* The same hero shape as `/pricing` and `/features`: glow, display
          heading, one lede, no picture. Deliberately not a new one — this page
          is reached from the same places those are, and a fourth header
          treatment would say the reader had left the site. */}
      <header className="tw:relative tw:overflow-hidden tw:pt-16 tw:pb-2">
        <div className="site-glow" />
        <div className={`${SHELL} tw:relative`}>
          <h1 className="site-display tw:max-w-[16ch]">{PUBLIC_SHELF_HEADING}</h1>
          <p className="site-lede tw:mt-6">{PUBLIC_SHELF_LEDE}</p>
        </div>
      </header>

      <main className={`${SHELL} tw:pb-24`}>
        <div className="tw:mt-10">
          {slow && <p className="tw:text-sm tw:text-muted-foreground">{PUBLIC_SHELF_SLOW}</p>}

          {/* **`role="alert"`, because this arrives after the reader has stopped
              looking.** The heading and the lede are announced when the page
              loads; a failure appears a second or two later and is announced by
              nothing at all without this. `alert` rather than `status` because
              it replaces the content the reader came for.

              **One thing it does not fix, said out loud rather than left to be
              found:** pressing Retry unmounts this paragraph, so focus falls to
              the body, and if the retry also fails a new button appears
              somewhere the reader is no longer standing. Refocusing it
              automatically would also yank focus on the *first* failure, out of
              wherever the reader actually was, which is worse — so the
              announcement is the remedy and the focus is a known limit. */}
          {state.kind === "failed" && (
            <p
              role="alert"
              className="tw:m-0 tw:rounded-md tw:border tw:border-destructive/40 tw:bg-destructive/10 tw:p-4 tw:text-sm tw:text-foreground"
            >
              {PUBLIC_SHELF_FAILED}{" "}
              {/* **A real button, and it really asks again.** A retry that
                  re-rendered the same failed state would look exactly like one
                  that tried — the test presses it and counts the requests. */}
              <button
                type="button"
                onClick={again}
                className="tw:cursor-pointer tw:border-0 tw:bg-transparent tw:p-0 tw:text-sm tw:text-highlight tw:underline"
              >
                {PUBLIC_SHELF_RETRY}
              </button>
            </p>
          )}

          {state.kind === "loaded" && state.shelf.entries.length === 0 && (
            <p className="tw:text-sm tw:text-muted-foreground">{PUBLIC_SHELF_EMPTY}</p>
          )}

          {state.kind === "loaded" && state.shelf.entries.length > 0 && (
            /* A real list, so a screen reader is told how many there are before
               reading any of them. `list-none` because the markers would be
               drawn beside cards, which is not what a marker is for — and
               `role="list"` back on top of it, because Safari's VoiceOver drops
               list semantics from a `ul` whose `list-style` is `none`, which
               would silently undo the sentence above on the one browser nobody
               here tests with. */
            // biome-ignore lint/a11y/noRedundantRoles: redundant in the spec and not in Safari, which drops list semantics from a `ul` whose `list-style` is `none` — the exact combination on this line
            <ul role="list" className="tw:m-0 tw:grid tw:list-none tw:gap-4 tw:p-0 tw:sm:grid-cols-2">
              {state.shelf.entries.map((entry) => (
                <li key={entry.slug} className="tw:m-0">
                  <PublicCard entry={entry} />
                </li>
              ))}
            </ul>
          )}

          {/* **Under the list, because it is about the end of it.** `truncated`
              exists for this one sentence, nothing can reach it today, and a cap
              that reports nothing is a list that quietly stops being the list —
              so it is drawn rather than deferred, and a test drives it.
              src/public-library-types.ts § `truncated`. */}
          {state.kind === "loaded" && state.shelf.truncated && (
            <p className="tw:mt-6 tw:text-sm tw:text-muted-foreground">{PUBLIC_SHELF_TRUNCATED}</p>
          )}
        </div>
      </main>
    </div>
  );
}

/* --------------------------------------------------------------- the card -- */

/**
 * One shared article.
 *
 * **The same border, fill and hover as the owner's shelf card**
 * (ShelfEntry.tsx § `ShelfCard`), deliberately: a reader who meets this page
 * first and signs up later should recognise their own shelf, and an article is
 * an article on both. What it does not carry is anything the owner's card
 * carries about a *person's* relationship with the document — there is no
 * `opens`, no comment count, no rename — because there is no such field on the
 * wire to draw one from (src/public-library-types.ts).
 *
 * **The meta line says the thing the list is ordered by**, which is the rule the
 * owner's card follows for the same reason: *"why is this one at the top?"* has
 * to be answerable from the card, and here the answer is when it was shared.
 */
function PublicCard({ entry }: { entry: PublicLibraryEntry }) {
  /* Only the facts this article actually has — `gist`, `siteName` and `words`
     are all nullable on the wire, and a filtered join beats a chain of `&&`s
     that can leave a stranded separator. Same shape as `ShelfCard`'s. */
  const shared = entry.publicAt ? timeAgo(entry.publicAt, Date.now()) : undefined;
  const facts = [
    entry.siteName,
    entry.words === null ? null : publicShelfWords(entry.words),
    shared ? publicShelfShared(shared) : null,
  ].filter(Boolean) as string[];

  return (
    <article className="tw:relative tw:h-full tw:rounded-lg tw:border tw:border-border tw:bg-card tw:p-5 tw:transition-colors tw:hover:border-highlight/60 tw:focus-within:border-highlight">
      <h2 className="tw:m-0 tw:font-prose tw:text-xl tw:leading-snug">
        {/* The stretched link: a real `<a href>` whose ::after covers the card,
            so the whole card is a click target and ⌘-click still opens a tab.
            `readHref`, so this page and the owner's shelf cannot come to
            disagree about where an article lives. */}
        <Link
          href={readHref(entry.slug)}
          className="tw:text-foreground tw:no-underline tw:after:absolute tw:after:inset-0 tw:after:content-['']"
        >
          {entry.title}
        </Link>
      </h2>

      {facts.length > 0 && (
        <p className="tw:mt-1.5 tw:mb-0 tw:flex tw:flex-wrap tw:items-center tw:gap-x-2 tw:gap-y-1 tw:text-xs tw:text-muted-foreground">
          {facts.map((f, i) => (
            <span key={f}>
              {i > 0 && <span className="tw:mr-2 tw:opacity-50">·</span>}
              {f}
            </span>
          ))}
        </p>
      )}

      {/* The whole piece in one sentence. Serif, because it is the article
          talking rather than the app — the same distinction the reading view
          makes between prose and chrome, and the same choice `ShelfCard` makes
          for the same field. */}
      {entry.gist && (
        <p className="tw:mt-3 tw:mb-0 tw:font-prose tw:text-[0.95rem] tw:leading-relaxed tw:text-ink-faint">
          {entry.gist}
        </p>
      )}
    </article>
  );
}

/* ---------------------------------------------------------------- the read -- */

/**
 * **The three things this page can be, as a union rather than as two flags.**
 *
 * It was `shelf: PublicLibrary | null` beside `failed: boolean`, and that pair
 * can represent a fourth thing that means nothing — a shelf *and* a failure —
 * which is exactly what happened: two reads overlap under `<StrictMode>`, one
 * fails, one succeeds, each sets its own flag and neither clears the other, and
 * the page draws the error paragraph above the cards. GPT Sol's review of this
 * stage, 2026-09-04.
 *
 * A discriminated union makes that combination **unrepresentable** rather than
 * merely untested, which is what AGENTS.md § Let the types catch it asks for.
 * The test that reproduced it is kept anyway, because the union alone does not
 * stop a late answer from a superseded read overwriting a fresh one — that is
 * the generation counter's job, and the two are separate guarantees.
 *
 * There is deliberately no `empty` member: an empty shelf is a `loaded` with no
 * entries, because it is an answer from the server rather than a state of this
 * component, and giving it a member here would invite somewhere else to
 * construct one without having asked.
 */
type ShelfState =
  | { kind: "loading" }
  | { kind: "loaded"; shelf: PublicLibrary }
  | { kind: "failed" };

/**
 * The one request this page makes, and what to show while it is in the air.
 *
 * A hook rather than three `useState`s in the component so that the three
 * states — nothing yet, a shelf, a failure — cannot be set in a combination that
 * means nothing, and so the retry has somewhere to live.
 *
 * **A 404 is treated as a failure here, and that is the opposite of what the
 * article page does with one.** `PublicRead` carries `not-shared` because the
 * namespace's rule is that a 404 is an answer rather than an error — but that
 * rule is about *a document somebody named*, and this route names nothing. An
 * empty shelf is a 200 with an empty list, so the only thing a 404 can mean here
 * is that the route is not there: a deployment behind the client, or a path that
 * has been renamed. Drawing *"nothing has been shared yet"* over that would tell
 * a reader something false about the world with complete confidence, which is
 * worse than admitting we could not read it. src/web/public-api.ts.
 */
function usePublicShelf(): { state: ShelfState; again: () => void } {
  const [state, setState] = useState<ShelfState>({ kind: "loading" });
  /**
   * **Which read is allowed to answer**, and it is a ref rather than state
   * because nothing renders from it.
   *
   * Two reads really are in the air at once in the ordinary case: `main.tsx`
   * mounts the app inside `<StrictMode>`, so in development every effect runs
   * mount → cleanup → mount and this hook starts two. Without a generation the
   * loser can land last and put a stale answer on screen — and before the
   * discriminated state above it could do worse, leaving the failure and the
   * list up together.
   */
  const generation = useRef(0);

  /**
   * **One function, called on mount and by the retry**, rather than a counter
   * the effect depends on without reading.
   *
   * That counter version is the usual idiom for "run this again", and the linter
   * is right to object to it: the counter appears in the dependency list and
   * nowhere in the body, which is a dependency that exists to be *changed* and
   * looks exactly like one somebody left behind. Biome offers an autofix that
   * removes it, and taking that fix would leave a retry button that silently
   * stopped retrying.
   *
   * One limit accepted rather than engineered away: nothing is aborted, so a
   * request whose answer is no longer wanted still finishes and is thrown away
   * here. An `AbortController` would save a listing-sized response on a page
   * nobody presses twice, at the cost of a lifecycle to get wrong.
   */
  const again = useCallback(() => {
    const mine = ++generation.current;
    setState({ kind: "loading" });
    loadPublicLibrary()
      .then((read) => {
        /* **The one guard, and it is what makes the union hold.** A late answer
           from a superseded read must change nothing at all — not the state it
           would have set, and not some other field beside it. */
        if (mine !== generation.current) return;
        setState(read.kind === "ok" ? { kind: "loaded", shelf: read.body } : { kind: "failed" });
      })
      .catch(() => {
        if (mine === generation.current) setState({ kind: "failed" });
      });
  }, []);

  useEffect(() => {
    again();
  }, [again]);

  return { state, again };
}
