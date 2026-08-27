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
 * server rendered, which we have not got. See docs/project/page-titles.md
 * § Still open.
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
 * ## No server rendering, so this is the only place a title is set
 *
 * The app is one HTML file and a router that never reloads (router.ts), so
 * `document.title` is a thing each page assigns on mount and on change. The
 * `<title>` in `index.html` is what the tab says until some page's effect
 * replaces it — which is longer than it sounds: effects run after paint, and
 * the whole app waits on a session check and then on an article fetch, so a
 * cold load into `/read/<slug>` sits on it for as long as those take. That is
 * why it is deliberately just the app's name. A page-specific title guessed
 * before the fetch would be a wrong one shown for a noticeable while.
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
import type { Mode } from "./params.js";
import type { ArticleView } from "./router.js";

/** The product. `spideryarn2` is the working directory; this is the name. */
export const APP_NAME = "Spideryarn";

/**
 * The strapline. It appears on the two homepages and nowhere else — the shelf
 * with nothing chosen on it, and the landing page a signed-out reader gets
 * instead. See `pageTitle` for why it is on no other.
 */
export const TAGLINE = "AI-assisted reading";

/**
 * Between segments.
 *
 * A middot rather than an em dash or a pipe: it is already this app's
 * separator (the fact lines on the library card and the metadata page use it),
 * it is the narrowest of the three so it spends the fewest of a tab's very few
 * pixels, and unlike `-` it can never be confused with a hyphen inside a title
 * that has one. No evidence anywhere says one separator is more legible than
 * another; consistency with the rest of the app is the whole argument.
 */
export const SEP = " · ";

/**
 * How much of a leading title we keep.
 *
 * Nothing forces this. No browser has a character limit, and every place that
 * truncates does it by **pixels** rather than characters — Firefox caps a tab
 * at 225px, Chrome shrinks tabs until only the favicon is left, Google cuts a
 * search result at about 600px. The familiar "50-60 characters" is SEO folklore
 * converged on by blogs, not a vendor number, and it is the wrong *unit*
 * besides. So a clamp cannot make a title fit a tab, and this one does not try.
 *
 * It is for the places that do *not* truncate: the history list, a bookmark,
 * the window switcher, and the text somebody gets when they paste a link into a
 * chat. A 180-character academic paper title there pushes everything after it
 * off the end of the useful world.
 *
 * 64 is therefore a judgment call rather than a measurement, and it is
 * deliberately generous — comfortably more than any tab shows, so clamping
 * never costs a reader something the tab would have shown them.
 */
export const CLAMP = 64;

/** Which of an article's seven middle-band modes, by the name the Dock uses. */
const MODE_LABEL: Record<Mode, string> = {
  toc: "Contents",
  summary: "Summary",
  glossary: "Glossary",
  ideas: "Ideas",
  search: "Search",
  diagram: "Diagram",
  chat: "Chat",
};

/**
 * The two of an article's three views that are pages beside the article rather
 * than the article itself. Named as the Dock names them, so the tab and the
 * button you pressed to get there agree.
 */
const VIEW_LABEL: Record<Exclude<ArticleView, "article">, string> = {
  metadata: "Metadata",
  tweets: "Tweets",
};

/**
 * Everything a page can tell us about itself.
 *
 * One variant per route in router.ts, plus the two states an article page
 * passes through before it has an article to name.
 */
export type TitleSpec =
  /** The shelf. Both fields are what the reader has narrowed it to, if anything. */
  | { kind: "library"; query?: string | null; unread?: boolean }
  /** An article, in whichever of its views and — for the reading view — mode. */
  | { kind: "read"; title: string; view: ArticleView; mode?: Mode }
  /** An ingest in flight. `source` is the host, or the file, being added. */
  | { kind: "add"; source?: string | null }
  | { kind: "profile" }
  | { kind: "design" }
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

    /* "You" is what the page calls itself and what the shelf's link to it
       says — docs/project/reader-profile.md. It is a strange word on its own
       in a window switcher, so this is the one label that gains a noun. */
    case "profile":
      return ["Your profile", APP_NAME];

    case "design":
      return ["Design reference", APP_NAME];

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
 * The segments before the app name, for one of an article's three views.
 *
 * The article's own title leads in all three, because that is what tells six
 * open tabs apart. What follows it says which view — except in the one case
 * where it says nothing at all:
 *
 * **The default mode is left out.** `toc` is where a reader spends most of
 * their time, so a "Contents" in nearly every tab distinguishes nearly
 * nothing, while costing every tab eleven characters at the end of a string
 * that is already being cut. Front-loading is not just about order; it is about
 * only saying what is *different* about this tab. The URL leaves the default
 * mode out for a related reason (params.ts § modeParam), so the two agree, and
 * a reader who learns the rule in one place has learned it in both.
 */
function readTitle(spec: Extract<TitleSpec, { kind: "read" }>): string[] {
  const title = clamp(spec.title.trim()) || "Untitled";
  if (spec.view !== "article") return [title, VIEW_LABEL[spec.view]];
  const mode = spec.mode ?? "toc";
  return mode === "toc" ? [title] : [title, MODE_LABEL[mode]];
}

/** Drop the empties, then join. See `pageTitle` for why the empties happen. */
function join(parts: string[]): string {
  return parts.map((p) => p.trim()).filter(Boolean).join(SEP);
}

/**
 * Cut at a word boundary, with an ellipsis, or return the text unchanged.
 *
 * Word boundary rather than mid-word because the cut is doing the reader a
 * favour and a truncation that lands inside a word looks like corruption. If
 * there is no space to cut at in the last third of the budget — one very long
 * word, or a language that does not space its words — it cuts where it must,
 * which is still better than not clamping.
 *
 * **Counted in code points, not in UTF-16 units**, which is why the text is
 * split into an array first rather than sliced. `"…".slice(0, 64)` will happily
 * cut an emoji in half and leave a lone surrogate, which renders as `�` — a
 * clamp whose whole job is to look deliberate, producing the one character that
 * looks like corruption. GPT Sol found it, 2026-08-27.
 *
 * Code points, not graphemes: a combining accent or a flag can still be split,
 * and doing better needs `Intl.Segmenter`. Not worth a segmenter for a title
 * that is already being cut with an ellipsis on it — but that is the next step
 * if this ever matters.
 */
export function clamp(text: string, max = CLAMP): string {
  const points = [...text];
  if (points.length <= max) return text;
  const cut = points.slice(0, max).join("");
  const space = cut.lastIndexOf(" ");
  // Only honour a space in the last third; otherwise a title whose first word
  // is long would be clamped down to that one word.
  const at = space > cut.length * 0.66 ? cut.slice(0, space) : cut;
  return `${at.trimEnd()}…`;
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
 * mode changes the tab from `… · Contents` to `… · Glossary`, and announcing
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
