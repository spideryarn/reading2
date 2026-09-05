/**
 * **The showcase links — a few real, shared articles, on the pages a stranger
 * reads before signing in.**
 *
 * Greg, 2026-09-04: *"create a `/read/public/` page that lists Public-readable
 * pages … and **pick a few of those to link to from various places to showcase
 * what Spideryarn is capable of**."* The page is `/read/public`
 * (PublicLibraryPage.tsx); this is the second half of the sentence, and it is
 * stage 4c of docs/plans/260904b-pricing-page-and-public-showcase.md.
 *
 * ## The one rule that decided the whole design
 *
 * **Greg flips an article's visibility in the production UI whenever he likes,
 * and nobody redeploys afterwards.** So a marketing page that names a slug in
 * its source is a broken page waiting to happen — the reader presses a title,
 * and Spideryarn's own front door hands them a 404 about an article that was
 * never theirs to see. Every link here is therefore **derived from the same
 * listing the shelf draws**, `GET /api/public/library`, so an article that stops
 * being public leaves nothing behind on any page. `tests/public-showcase.test.tsx`
 * proves exactly that rather than trusting this paragraph.
 *
 * Two other mechanisms were weighed and are worse:
 *
 * - **Hardcoded slugs, or a curated list in a constant.** The cheapest to write
 *   and the only one that can actually honour *"pick a few"* — and it is the
 *   failure the rule above exists to prevent. A dead link is not a stale link:
 *   it is the product arguing against itself in the one place a stranger is
 *   deciding.
 * - **Baking the list in at deploy time**, from a build step or a generated
 *   module. It is stale the moment the flip happens, which is the same failure
 *   an hour later, with a build to run before anybody can fix it.
 *
 * **What the listing cannot do is *pick*.** It is ordered by `public_at`
 * descending (src/store/public-library.ts), so these three are the most recently
 * shared, not the three best. That is a real gap against what Greg asked for and
 * it is left open on purpose: picking means naming, naming means a slug in the
 * source, and the rule above forbids it. If choosing which three matters more
 * than the dead link does, the honest next step is a *column* — a `showcase_at`
 * or a rank on `articles` that the flip owns — not a list in a component.
 *
 * ## The fetch can only add
 *
 * The block draws its heading, its sentence and the link to `/read/public`
 * **before** the listing lands, and the articles appear underneath if and when
 * they do. So a failed read, an empty shelf and a slow one are all the same
 * thing to a stranger: a page that is one link short of what it would have been,
 * rather than an error message on a marketing page or a hole where a list was.
 *
 * That is deliberately the opposite of `/read/public`, where the list *is* the
 * page and a failure has to be said out loud (PublicLibraryPage.tsx §
 * `usePublicShelf`). Here the list is a garnish, and an apology for a missing
 * garnish is worse than the missing garnish.
 *
 * ## Where it is drawn, and where it is not
 *
 * `/` (LandingPage.tsx) and `/features` (FeaturesPage.tsx). One component, two
 * callers — Greg's *"reusing the same machinery"* — and both are pages that make
 * a claim about public articles a few lines above, which this is the evidence
 * for.
 *
 * **Not `/pricing`, and that is a hard constraint rather than a preference.**
 * `tests/pricing-page-current-plan.test.tsx` asserts that a signed-out
 * `/pricing` makes **no network request at all**, and that assertion is
 * load-bearing: it is the page a stranger is most often sent to, and the failure
 * it guards is a 401 per view. A showcase there would also be a link because
 * there is room — somebody reading a price table has already asked what the
 * thing is.
 *
 * **`LandingPage` is drawn at more addresses than `/`**, and the listing is read
 * on all of them: signed out, `App.tsx` answers `/profile`, `/design`, `/admin`,
 * `/add/…` and an unshared `/read/<slug>` with the landing page. That is one
 * anonymous request nobody asked for, and it is accepted rather than gated — the
 * route those readers are *at* is not a route with a no-request rule, and a prop
 * threaded through five call sites to suppress a listing read would be more
 * machinery than the request costs. Raised by GPT Sol, 2026-09-05, who agreed it
 * leaks nothing.
 */
import { useEffect, useState } from "react";

import {
  PUBLIC_SHELF_BROWSE_LINK,
  PUBLIC_SHOWCASE_HEADING,
  PUBLIC_SHOWCASE_LEDE,
  publicShelfWords,
} from "../messages.js";
import type { PublicLibraryEntry } from "../public-library-types.js";
import { Link } from "./Link.js";
import { loadPublicLibrary } from "./public-api.js";
import { PUBLIC_LIBRARY_HREF, readHref } from "./router.js";

/**
 * How many articles the block shows.
 *
 * Three, because Greg said *"a few"* and because these sit inside a section of a
 * page that is already long — `/features` was cut from 11,000px once
 * (FeaturesPage.tsx) and a fourth row of prose is how it grows back.
 *
 * The slice happens **here rather than in the request**, and that is a knowing
 * trade rather than an oversight: `GET /api/public/library` is a closed,
 * parameterless route in the public namespace (src/public/routes.ts), and giving
 * it a `limit` would mean a query parameter on an anonymous route, a second
 * shape for the three route sweeps to cover, and a cap that two places now
 * argue about. The response is bounded at 200 rows with every text column capped
 * in the SQL (src/store/public-library.ts § `PUBLIC_CARD_CHARS`), so the worst
 * case is a large response rather than an unbounded one — and the day that
 * worst case is real, a `limit` on the route is the answer, not a bigger slice.
 */
export const PUBLIC_SHOWCASE_MAX = 3;

/**
 * The block: a heading, a sentence, up to three real articles, and the way to
 * the rest of them.
 *
 * It takes no props. Everything it draws comes from the listing or from
 * src/messages.ts, so the two callers cannot come to show two different things —
 * which is the whole reason it is a component rather than a few lines repeated
 * on two pages.
 */
export function PublicShowcase() {
  const entries = useShowcaseEntries();

  return (
    <section className="site-panel site-reveal tw:mt-8 tw:p-6 tw:sm:p-8">
      {/* `h3`, on both callers: this sits under one of the page's `H2`s in each
          of them, and a heading that jumps a level is a heading a screen reader
          reads as a missing section. Visual reuse must not decide document
          structure — SiteBits.tsx § `Showcase`, which learned it the same way. */}
      <h3 className="tw:mb-2 tw:font-prose tw:text-lg tw:text-foreground">
        {PUBLIC_SHOWCASE_HEADING}
      </h3>
      <p className="tw:max-w-[58ch] tw:text-sm tw:leading-relaxed">{PUBLIC_SHOWCASE_LEDE}</p>

      {entries.length > 0 && (
        /* A real list, so a screen reader says how many before reading any of
           them — and `role="list"` on top of `list-none` for the reason
           PublicLibraryPage.tsx gives at length: Safari drops list semantics
           from a `ul` whose `list-style` is `none`. */
        // biome-ignore lint/a11y/noRedundantRoles: redundant in the spec and not in Safari, which drops list semantics from a `ul` whose `list-style` is `none` — the exact combination on this line
        <ul role="list" className="tw:mt-5 tw:mb-0 tw:grid tw:list-none tw:gap-4 tw:p-0">
          {entries.map((entry) => (
            <li key={entry.slug} className="tw:m-0">
              <ShowcaseArticle entry={entry} />
            </li>
          ))}
        </ul>
      )}

      {/* **Outside the conditional above**, so it survives a failed read and an
          empty shelf. It is the only thing on this block that is promised
          before the network is asked, and losing it in exactly the case where
          the articles did not arrive would leave a heading over nothing. */}
      <p className="tw:mt-6 tw:mb-0 tw:text-sm">
        <Link
          href={PUBLIC_LIBRARY_HREF}
          className="tw:text-highlight tw:no-underline tw:hover:underline"
        >
          {PUBLIC_SHELF_BROWSE_LINK}
        </Link>
      </p>
    </section>
  );
}

/**
 * One article, as a line rather than as a card.
 *
 * **Deliberately not `PublicCard`** (PublicLibraryPage.tsx), and the difference
 * is the job rather than the styling: that one is a *shelf* card, three or four
 * facts in a bordered tile, and it is what the reader gets one click from here.
 * Three of them inside a panel inside a marketing page would be a panel in a
 * panel, and on `/features` — the page that was cut from 11,000px of stacked
 * screenshots — three cards is another screen of scrolling to make a point the
 * sentence above has already made.
 *
 * What it shows is the same fields in the same order the shelf card uses —
 * byline, then where it was published, then how long it is — so the two cannot
 * teach a reader two conventions. The byline is **the article's author**, never
 * the Spideryarn reader who shared it: src/public-library-types.ts § `byline`
 * says at length why that distinction is worth writing down.
 */
function ShowcaseArticle({ entry }: { entry: PublicLibraryEntry }) {
  /* A filtered join rather than a chain of `&&`s, which can leave a stranded
     separator: `byline`, `siteName` and `words` are all nullable on the wire.
     Same shape and same reason as `PublicCard`'s. */
  const facts = [
    entry.byline,
    entry.siteName,
    entry.words === null ? null : publicShelfWords(entry.words),
  ].filter(Boolean) as string[];

  return (
    <div>
      <Link
        href={readHref(entry.slug)}
        /* `readHref`, so this page, the shelf and the owner's library cannot
           come to disagree about where an article lives. */
        className="tw:font-prose tw:text-base tw:text-foreground tw:no-underline tw:hover:text-highlight"
      >
        {entry.title}
      </Link>
      {facts.length > 0 && (
        <p className="tw:mt-1 tw:mb-0 tw:text-xs tw:text-ink-faint">{facts.join(" · ")}</p>
      )}
    </div>
  );
}

/**
 * The one request this block makes, and the only state it has.
 *
 * **An anonymous `GET /api/public/library` through `loadPublicLibrary`**, which
 * is the same call `/read/public` makes and carries no token, no cookie and no
 * refresh (public-api.ts). That matters more here than it does there: these two
 * pages are drawn for a reader with no account, and a listing fetched with
 * `apiFetch` would work for every developer and every test run and fail first
 * for a stranger.
 *
 * **A failure is not an error state**, it is simply no articles — see the
 * header. So there is one piece of state, the entries, and no union: the block
 * before the answer and the block after a failed answer are the same block, and
 * a reader cannot tell them apart because there is nothing to tell.
 *
 * `live` rather than the generation counter `/read/public` needs, because there
 * is nothing here to retry: exactly one read is started per mount, so the only
 * thing to guard is a late answer arriving after unmount — which `<StrictMode>`
 * produces on every development mount, and which React warns about rather than
 * silently ignoring.
 */
function useShowcaseEntries(): PublicLibraryEntry[] {
  const [entries, setEntries] = useState<PublicLibraryEntry[]>([]);

  useEffect(() => {
    let live = true;
    loadPublicLibrary()
      .then((read) => {
        if (!live) return;
        /* A 404 arrives as `not-shared` and is treated exactly like a failure:
           this route does not answer one today, so the only thing it could mean
           is that the client is ahead of a deployment. */
        setEntries(read.kind === "ok" ? read.body.entries.slice(0, PUBLIC_SHOWCASE_MAX) : []);
      })
      .catch(() => {
        /* Swallowed on purpose, and cleared rather than left: whatever was on
           screen is now known not to be the answer. There is nothing to say to a
           stranger about a listing they were not promised. */
        if (live) setEntries([]);
      });
    return () => {
      live = false;
    };
  }, []);

  return entries;
}
