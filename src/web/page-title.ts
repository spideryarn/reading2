/**
 * What the browser tab says — one pure function, one hook.
 *
 * Until 2026-08-27 every page in this app had the same title, baked into
 * `index.html`: *"Spideryarn — granularity zoom"*. Two problems with that. It
 * named one feature as though it were the product, and — worse for anybody
 * actually using the thing — a reader with six articles open had six identical
 * tabs. A tab title is the only label a browser gives you for a page you are
 * not looking at, and it is also the label in the window switcher, the history
 * list and the bookmark. Six copies of one string is six labels that label
 * nothing.
 *
 * Not the link preview, though — a pasted address unfurls from `og:` tags a
 * server rendered. Since 2026-08-29 there is one, for public articles only:
 * src/public/page-head.ts. That changes this file's job, and the next section
 * is where.
 *
 * ## The one rule: what is different about this tab goes first
 *
 * A tab is a few characters wide once you have a few open, and what survives
 * the truncation is the **left** end. So the leading segment is always the most
 * specific thing on the page — the article's own title, the term you searched
 * for — and the app's name is always last, where losing it costs nothing
 * because you already know which app it is.
 *
 * That is also why the default mode is *absent* rather than spelled out; see
 * `readTitle` below.
 *
 * ## The server writes a title first now, and this one has to match it
 *
 * The app is one HTML file and a router that never reloads (router.ts), so
 * `document.title` is a thing each page assigns on mount and on change. What
 * the tab says until then depends on how you arrived:
 *
 *  - **Any page but a shared article**: the `<title>` in `index.html`, which is
 *    deliberately just the app's name. Effects run after paint and the app waits
 *    on a session check and then on a fetch, so a cold load sits on it for a
 *    noticeable while — and a page-specific title guessed before the fetch would
 *    be a wrong one, shown for exactly that long.
 *  - **`/read/<slug>` for a public article**: a real title, composed on the
 *    server before the bundle loads (src/public/page-head.ts), so that a pasted
 *    link previews as something.
 *
 * In the second case this file's assignment **overwrites a title that was
 * already right**, in front of the reader. So the two have to produce the same
 * string, and the way that is guaranteed is that both call `documentTitle` in
 * src/title-text.ts — read its header for the two rules and which side won
 * each. `readTitle` below is the client's half of it.
 *
 * ## Why the composition is a pure function
 *
 * Every page calls `useDocumentTitle(pageTitle({…}))`, so the *rules* — the
 * order of the segments, the separator, the clamp, when the app name is
 * dropped — live in one tested place rather than being reinvented in nine
 * components. tests/page-title.test.ts is the test.
 *
 * See docs/project/page-titles.md for the research behind the rules, and
 * docs/project/url-state.md for the state these titles are drawn from.
 */
import { useEffect } from "react";
import { APP_NAME, MODE_LABEL, SEP, TAGLINE, VIEW_LABEL, articleTitle, clamp } from "../title-text.js";
import { DEFAULT_MODE, type Mode } from "./params.js";
import type { AdminPage, ArticleView } from "./router.js";

/**
 * What each admin page calls itself in the tab.
 *
 * A `Record` keyed by the union rather than a chain of ternaries: a page added
 * to `AdminPage` and not to this map is a compile error, which is the only
 * version of this that cannot quietly title a new page "Admin · Spideryarn".
 * The index has no name of its own — `""` is dropped by `pageTitle`'s join.
 */
const ADMIN_PAGE_TITLE: Record<AdminPage, string> = {
  home: "",
  users: "Users",
  feedback: "Feedback",
};

/**
 * **The rules themselves live in src/title-text.ts**, and are re-exported here
 * so that every existing caller of this module — nine components and
 * tests/page-title.test.ts — keeps importing them from the place it always did.
 *
 * They moved because the server composes the same title before this file's
 * React ever runs (src/public/page-head.ts), and two copies of one rule is one
 * place for them to disagree. They did disagree, visibly, in the tab. The whole
 * argument is in the header of src/title-text.ts.
 */
export { APP_NAME, CLAMP, SEP, TAGLINE, clamp } from "../title-text.js";



/**
 * Everything a page can tell us about itself.
 *
 * One variant per route in router.ts, plus the two states an article page
 * passes through before it has an article to name.
 */
export type TitleSpec =
  /** The shelf. Both fields are what the reader has narrowed it to, if anything. */
  | { kind: "library"; query?: string | null; unread?: boolean }
  /**
   * An article, in whichever of its views and — for the reading view — mode.
   *
   * **Split by view, so that the reading view cannot forget its mode.** `mode`
   * was one optional field on a single variant, and GPT Sol named the hole,
   * 2026-08-30: deleting `mode` from the call in App.tsx compiles, the real tab
   * silently loses `· Glossary`, and no cross-product test can see it, because
   * the test passes its own arguments. A required field is a better answer than
   * a test — the mutation stops existing rather than being caught.
   *
   * `mode?: never` on the other variant is not decoration. A union rejects a bad
   * combination in a fresh object literal by excess-property checking, but a
   * value assembled in a variable and passed in is structurally fine without it;
   * naming the field is what makes `{ view: "metadata", mode }` an error
   * wherever it is built.
   */
  | { kind: "read"; title: string; view: "article"; mode: Mode }
  | {
      kind: "read";
      title: string;
      view: Exclude<ArticleView, "article">;
      mode?: never;
    }
  /** An ingest in flight. `source` is the host, or the file, being added. */
  | { kind: "add"; source?: string | null }
  /**
   * The page a signed-in reader gets for an article that is not theirs and not
   * shared — `NotSharedPage` in PublicChrome.tsx. A signed-out reader gets the
   * landing page instead, which has its own variant below.
   *
   * It exists because **every terminal state of `ArticlePage` must have an owner
   * for the tab**, and this one had none: `articleWaitTitle` hands over on
   * anything that is not loading-and-slow or an error, and `NotSharedPage` then
   * set no title at all. So a reader who navigated to an unavailable article
   * kept the previous article's title, or — if the fetch had already gone slow —
   * sat on `Loading…` for ever, because `slow` goes false and the hand-over is
   * to nobody. GPT Sol, 2026-08-30.
   *
   * It says what the page's own heading says, and nothing more: a slug you do
   * not own is a 404 rather than a 403, and the tab must not be the thing that
   * confirms an article exists.
   */
  | { kind: "not-shared" }
  /**
   * **The page for a reader we could not identify at all** —
   * `ReauthRequiredPage` in PublicChrome.tsx: the owned route answered 401 and
   * the public one answered 404.
   *
   * Its own variant rather than borrowing `not-shared`, which is what it did for
   * one afternoon on 2026-09-02 and which a browser pass caught. Two things were
   * wrong with that. The tab said *Not shared*, which is a claim about the
   * document — and the whole point of this state is that a 401 leaves us unable
   * to make one. And the title is read aloud: `useDocumentTitle` mirrors it into
   * the `aria-live` announcer below, so a screen reader was told *"Not shared"*
   * over a page whose heading says we could not confirm the sign-in.
   *
   * It names the action instead, which is a fact about the reader's session and
   * about nothing else.
   */
  | { kind: "reauth-required" }
  /**
   * **An address nobody minted** — NotFoundPage.tsx.
   *
   * Its own variant rather than borrowing `error`, which is the neighbouring
   * shape and says *Couldn't open*. That one is about a fetch that failed and
   * deliberately does not guess why; this one is a verdict we are certain of,
   * reached before any request was made. A reader whose tab said *Couldn't
   * open* would go on believing the address was right.
   */
  | { kind: "not-found" }
  | { kind: "profile" }
  | { kind: "design" }
  /** What we do with a reader's data — PrivacyPage.tsx. */
  | { kind: "privacy" }
  /** What the thing does, with pictures — FeaturesPage.tsx. */
  | { kind: "features" }
  /** What it costs — PricingPage.tsx. */
  | { kind: "pricing" }
  /** The administrator's pages. `page` is which one — see router.ts. */
  | { kind: "admin"; page: AdminPage }
  /**
   * The page a signed-out reader sees, wherever they were heading —
   * LandingPage.tsx. It has no address of its own, which is why this variant
   * cannot be inferred from the route.
   */
  | { kind: "landing" }
  | { kind: "login" }
  | { kind: "callback" }
  /** An article page with its fetch still in the air. */
  | { kind: "loading" }
  /** An article page whose fetch failed. We do not know enough to say what. */
  | { kind: "error" };

/**
 * The title for a page, most specific part first, app name last.
 *
 * Empty and whitespace-only segments are dropped rather than joined, because
 * the alternative is a title that starts with a stranded separator — the same
 * trap the metadata page's fact line has.
 */
export function pageTitle(spec: TitleSpec): string {
  return join(segments(spec));
}

/** The parts, before they are joined. Split out so the tests can read them. */
function segments(spec: TitleSpec): string[] {
  switch (spec.kind) {
    /* **The one page whose own name leads**, and the one place the strapline
       appears. A homepage is the page where the site's name *is* the most
       specific thing there is to say, which is why every piece of guidance
       that otherwise says "site name last" makes this exception. Narrow the
       shelf and it stops being the homepage in that sense: what you narrowed
       it to is now the specific thing, and it takes the front. */
    case "library": {
      const q = (spec.query ?? "").trim();
      if (!q && !spec.unread) return [APP_NAME, TAGLINE];
      return [q ? `“${clamp(q)}”` : "", spec.unread ? "Unread" : "", "Shelf", APP_NAME];
    }

    case "read":
      return [...readTitle(spec), APP_NAME];

    /* The host is the useful half of an address and the whole of it is not:
       "Adding nytimes.com" is a tab you can pick out, and the full URL is a
       tab whose every visible character is `https%3A%2F%2F`. A file upload has
       no host, and the caller passes the filename instead — `host` hands
       anything that is not a URL straight back, so one call site covers both. */
    case "add":
      return [spec.source ? `Adding ${clamp(host(spec.source))}` : "Adding an article", APP_NAME];

    /* "Profile" is what the page calls itself and what the shelf's link to it
       says — docs/project/reader-profile.md. It was "You" until 2026-08-27,
       and the title had to add a noun because a window switcher showing "You"
       says nothing; the page's own name now carries that, so the title is the
       name and nothing else. */
    case "not-shared":
      return ["Not shared", APP_NAME];

    /* The words on the page's own button, so the tab, the heading and what a
       screen reader announces are one thing. It says nothing about the article
       because there is nothing we can honestly say. */
    case "reauth-required":
      return ["Sign in again", APP_NAME];

    /* Two words rather than the page's own heading, which is a whole sentence
       — *There's nothing at this address* — and a tab has less room than a
       heading. The same trade the privacy page makes just below. It says
       nothing about a document, for the reason `not-shared` gives above: the
       tab must not be what confirms an article exists. */
    case "not-found":
      return ["Not found", APP_NAME];

    case "profile":
      return ["Profile", APP_NAME];

    case "design":
      return ["Design reference", APP_NAME];

    /* "Privacy" and not "Privacy policy": the page's own heading is the longer
       phrase, and a tab has less room than a heading. */
    case "privacy":
      return ["Privacy", APP_NAME];

    case "features":
      return ["Features", APP_NAME];

    case "pricing":
      return ["Pricing", APP_NAME];

    /* Most specific part first, like every other page: "Users · Admin ·
       Spideryarn" rather than the other way round, so the tab is legible when
       it is squeezed to four characters. */
    case "admin":
      return [ADMIN_PAGE_TITLE[spec.page], "Admin", APP_NAME];

    /* **The second page whose own name leads, and the second to carry the
       strapline** — see the `library` case above for the rule and the reason.
       A signed-out reader is looking at the front door whatever address they
       typed, and on the front door the app's name *is* the most specific thing
       there is to say. It is deliberately the same title as the bare shelf:
       signing in swaps one homepage for the other, and a tab that renames
       itself at that moment would be claiming a change of page that did not
       happen. */
    case "landing":
      return [APP_NAME, TAGLINE];

    case "login":
      return ["Sign in", APP_NAME];

    /* Half a second on a good day, and a page nobody chose to visit. It says
       what is happening rather than naming itself, because "Callback" would
       mean nothing to the person reading it. */
    case "callback":
      return ["Signing you in", APP_NAME];

    case "loading":
      return ["Loading…", APP_NAME];

    /* Deliberately not "Not found": the fetch can fail for a dozen reasons and
       the tab is the worst place to guess which. The page itself says. */
    case "error":
      return ["Couldn’t open", APP_NAME];
  }
}

/**
 * **What the server already put in this tab, read once before React can change
 * it.**
 *
 * A shared `/read/<slug>` arrives with a real `<title>` and a full `og:` head,
 * composed from the database (src/public/page-head.ts). Nothing else in the app
 * does — an ordinary SPA navigation, a private article, and every other route
 * get the bare shell — so the presence of an `og:url` naming a slug is exactly
 * the signal "the server composed a head for *this* article".
 *
 * `og:url` rather than a marker of its own: it is already there, already
 * asserted in tests/page-head.test.ts, and adding a second element that means
 * the same thing is a second place for the two to disagree. Its value is
 * `articleUrl(slug)` (src/urls.ts), so the slug is the last segment, decoded —
 * that function is the only place the path is spelled, and this is the reader of
 * what it writes.
 *
 * Read at module load and never again. The server writes this once, into the
 * document that arrived; React never updates it, so a value read later would be
 * stale in a way that is invisible. `title` is captured alongside it for the
 * reason `articleWaitTitle` gives.
 */
export function serverComposedHead(doc: Document): { slug: string; title: string } | null {
  const url = doc.querySelector('meta[property="og:url"]')?.getAttribute("content");
  if (!url) return null;
  const match = /\/read\/([^/?#]+)$/.exec(url);
  if (!match?.[1]) return null;
  try {
    return { slug: decodeURIComponent(match[1]), title: doc.title };
  } catch {
    /* A malformed percent-escape. `decodeURIComponent` throws, and a thrown
       exception at module load would take the whole bundle down over a tab
       title. There is simply no composed head as far as we are concerned. */
    return null;
  }
}

/** Captured at module load — see `serverComposedHead` for why not later. */
const COMPOSED: { slug: string; title: string } | null =
  typeof document === "undefined" ? null : serverComposedHead(document);

/**
 * **What `ArticlePage` puts in the tab while it waits**, and the one case where
 * the answer is to say nothing.
 *
 * Before the server composed heads, a cold load of `/read/<slug>` started at the
 * bare app name, so replacing it with `Loading…` after 600ms was strictly an
 * improvement. It is not any more. A shared link now arrives with **the article's
 * real title already in the tab**, and a fetch slower than `SLOW_AFTER_MS` — a
 * cold serverless start against Postgres, routinely — would replace it with
 * `Loading…` and then put it back. The reader watches a correct title turn into
 * a worse one and back again, and a screen reader announces both.
 *
 * That is the same fault as the two this file's `documentTitle` fixes: two
 * sources answering "what should the tab say", disagreeing. So the rule is the
 * one this component already follows for a *fast* fetch, extended to the case
 * the server made possible: **do not replace a title that is already right.**
 *
 * The two guards are both necessary:
 *
 *  - **`slug === COMPOSED.slug`** — the composed head is about one article. Once
 *    the reader navigates to a different one the server's title is a lie, and
 *    `Loading…` is the honest thing to say.
 *  - **`currentTitle === COMPOSED.title`** — the tab must still be showing it.
 *    A reader who goes `/read/a` → `/read/b` → back to `/read/a` has an `og:url`
 *    that still names `a`, and suppressing here would leave *b's* title standing
 *    over a's loading page. Comparing the string self-expires the moment
 *    anything writes a different one, which is exactly when the guarantee stops
 *    holding.
 *
 * **An error still replaces it**, deliberately. `Loading…` is a claim that the
 * right title is coming; `Couldn't open` is a claim that it is not, and a broken
 * page must not go on advertising the article it failed to show.
 */
export function articleWaitTitle(
  state: "loading" | "error" | "ready",
  slug: string,
  currentTitle: string,
  composed: { slug: string; title: string } | null = COMPOSED,
): string {
  if (state === "error") return pageTitle({ kind: "error" });
  /* "" is `useDocumentTitle`'s "not mine to set" — see the hook, and see
     `ArticlePage`, which uses the same value to hand over to its children. */
  if (state === "ready") return "";
  if (composed !== null && composed.slug === slug && composed.title === currentTitle) return "";
  return pageTitle({ kind: "loading" });
}

/**
 * The segments before the app name, for one of an article's three views.
 *
 * The article's own title leads in all three, because that is what tells six
 * open tabs apart. What follows it says which view — except in the one case
 * where it says nothing at all:
 *
 * **The default mode is left out** — whichever it is, which is why the code
 * compares against `DEFAULT_MODE` rather than naming one (src/modes.ts). The
 * default is where a reader spends most of their time, so its label in nearly
 * every tab distinguishes nearly nothing, while costing every tab the characters
 * at the end of a string that is already being cut. This paragraph used to say
 * `toc`, and then meant the mode now called Hierarchy; the default has since
 * moved to `plain` (2026-08-31) and the argument did not change. Front-loading is not just about order; it is about
 * only saying what is *different* about this tab. The URL leaves the default
 * mode out for a related reason (params.ts § modeParam), so the two agree, and
 * a reader who learns the rule in one place has learned it in both.
 */
function readTitle(spec: Extract<TitleSpec, { kind: "read" }>): string[] {
  const title = articleTitle(spec.title);
  if (spec.view !== "article") return [title, VIEW_LABEL[spec.view]];
  const mode = spec.mode ?? DEFAULT_MODE;
  return mode === DEFAULT_MODE ? [title] : [title, MODE_LABEL[mode]];
}

/** Drop the empties, then join. See `pageTitle` for why the empties happen. */
function join(parts: string[]): string {
  return parts.map((p) => p.trim()).filter(Boolean).join(SEP);
}


/**
 * The host of a URL, without its `www.`, or the text unchanged if it is not a
 * URL at all — which is how the add page's uploaded filenames pass through.
 *
 * `URL` throws on anything it cannot parse, and this is called on a string the
 * reader typed, so the throw is the common case rather than the exception.
 */
export function host(text: string): string {
  try {
    return new URL(text).host.replace(/^www\./, "") || text;
  } catch {
    return text;
  }
}

/**
 * Put a title in the tab, and tell a screen reader the page changed.
 *
 * The first half is one line. The second is the part that is easy to miss:
 * **assigning `document.title` announces nothing.** A screen reader reads the
 * title on a document *load*, and this app never loads twice — the router
 * swaps components under one document (router.ts), so a reader using a screen
 * reader gets a new page and no word about it. WCAG 2.4.2 (Page Titled, Level
 * A) is satisfied by the title being right; being *told* is a separate job.
 *
 * So the title is also spoken into a polite live region — one node for the
 * page, created on first use and reused.
 *
 * ## The three-step dance, and why it is three steps
 *
 * The region is **created and emptied now, and filled later**. That ordering is
 * the whole thing:
 *
 *  - A region created *and* filled in one go is a live region **appearing**,
 *    not a live region updating, and nothing is announced. The first sentence
 *    of this file's first draft said so, and the code underneath it did it
 *    anyway — GPT Sol caught that, 2026-08-27.
 *  - Emptying and filling in the same tick is no better: what the browser sees
 *    is one net change, so re-announcing the *same* string — two articles can
 *    share a title — is coalesced away to nothing.
 *
 * Splitting the two across the delay below fixes both at once, which is the
 * only reason one function does two things a tick apart.
 *
 * ## What is announced, and when
 *
 * **Everything but the app's name.** Not just the leading segment: switching
 * mode changes the tab from `… · Hierarchy` to `… · Glossary`, and announcing
 * the first segment alone would repeat the article's title and say nothing
 * about what the reader had just pressed. And not the app's name either —
 * hearing *"· Spideryarn"* after every navigation is the audible version of the
 * problem this whole file exists to fix.
 *
 * **The tab changes at once and the announcement waits.** Not every title
 * change is a navigation: the shelf's search box puts what you have typed into
 * the title, and `useQueryState` updates on the keystroke rather than on the
 * debounced URL write — so an unguarded announce would say the word back one
 * letter at a time to somebody in the middle of typing it. The pause collapses
 * a burst into one announcement of wherever it settled.
 *
 * **An honest limit.** `polite` is a request rather than a guarantee: assistive
 * technology can be configured to interrupt anyway, and none of this is proven
 * by the tests — jsdom can tell you the node holds the right text, and nothing
 * short of VoiceOver and NVDA can tell you it was spoken. See
 * docs/project/page-titles.md § Still open.
 */
export function useDocumentTitle(title: string): void {
  useEffect(() => {
    if (!title) return;
    document.title = title;
    /* Now: the region exists and is empty. Later: it has words in it. See the
       three-step dance above — collapsing these into one call is the bug this
       shape exists to prevent. */
    const node = region();
    node.textContent = "";
    const id = setTimeout(() => {
      node.textContent = announcement(title);
    }, ANNOUNCE_AFTER);
    return () => clearTimeout(id);
  }, [title]);
}

/**
 * How long a title has to stand still before it is worth saying out loud.
 *
 * Long enough to swallow a burst of typing, short enough that a navigation is
 * announced while the reader is still wondering where they landed. Not measured
 * — the same order as the 300ms `?at=` debounce in params.ts, which is this
 * app's existing answer to "has the reader stopped?".
 */
const ANNOUNCE_AFTER = 350;

/** The title without its trailing app name, as a spoken phrase. */
export function announcement(title: string): string {
  const parts = title.split(SEP);
  const spoken = parts.length > 1 && parts.at(-1) === APP_NAME ? parts.slice(0, -1) : parts;
  /* A comma rather than the middot: the separator is punctuation a screen
     reader may read aloud, skip, or announce as "middle dot" depending on how
     it is configured, and a comma is the one mark every one of them turns into
     a pause. It carries no meaning either way — see docs/project/page-titles.md
     on why a separator must never have to. */
  return spoken.join(", ");
}

/** The singleton live region, created on first use and never removed. */
let node: HTMLElement | null = null;

function region(): HTMLElement {
  /* `isConnected` as well as null, because a test or a hot reload can take the
     body out from under us, and a detached node announces nothing while every
     write to it succeeds. */
  if (node?.isConnected) return node;
  node = document.createElement("div");
  node.id = "spya-page-title-announcer";
  node.setAttribute("role", "status");
  node.setAttribute("aria-live", "polite");
  /* Off-screen rather than `display: none` or `hidden`, both of which take the
     node out of the accessibility tree and so silence it. The standard
     visually-hidden recipe, inline so it cannot be lost to a stylesheet change
     nobody connected to it. */
  node.style.cssText =
    "position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0";
  document.body.appendChild(node);
  return node;
}
