/**
 * Every piece of view state, expressed as a query-string parameter.
 *
 * Greg, 2026-08-25:
 *
 * > if I, for example, scroll down to a particular place in the doc for example
 * > (or changed something else, etc etc), that should update the URL somehow
 *
 * > if I reload the page, I'd like it to return to the same location … Or if I
 * > send someone a url
 *
 * Both of those fall out of one rule: **the URL is always current**. Nothing is
 * kept in `useState` that the address bar doesn't also know, so reloading and
 * copy-pasting are the same operation, and neither needs any storage of its own.
 *
 * The library is [nuqs](https://nuqs.dev) — see docs/project/url-state.md for
 * why, and for the two options that carry the whole design (`history` and
 * `limitUrlUpdates`).
 *
 * A note on where position is *not* kept: not `localStorage`, and not the hash.
 * The hash would make the browser jump to the block itself, before our own
 * offset-for-the-sticky-bars scroll runs, so you would see it land twice. It
 * would also mean two unsynchronised state systems — `hashchange` for position,
 * `popstate` for everything else. One query string, one listener.
 */
import { createParser, debounce } from "nuqs";
import { isSpideryarnId } from "../ids.js";
import {
  DEFAULT_SORT,
  isSortKey,
  type ShelfFilter,
  type ShelfView,
  type SortDir,
  type SortKey,
} from "./library-sort.js";

/* Which article is NOT in here. It is the path — `/read/<slug>` — and has been
   since the library landed, 2026-08-25. The rule the two halves divide on:
   **the path says which article, the query string says how you are looking at
   it.** See router.ts, and docs/project/url-state.md#which-article-is-the-path.

   Old `/?slug=x` links still work; main.tsx rewrites them on the way in. */

/**
 * How long the reader has to stop scrolling before the URL catches up.
 *
 * Debounce rather than throttle, at Greg's suggestion: mid-flick the URL is of
 * no use to anybody, so there is nothing to gain by keeping it live through the
 * movement, and something to lose — browsers rate-limit `replaceState` (~50ms
 * in Chrome, ~120ms in Safari) and will warn if you push past it. Waiting for
 * the reader to settle also means the URL records where they *landed*, not
 * every section they flew over on the way.
 */
export const POSITION_SETTLE_MS = 300;

/**
 * A block id, validated on the way in.
 *
 * Returning `null` for anything else is what makes a hand-mangled or stale link
 * degrade to "top of the article" instead of scrolling to nothing — see
 * docs/project/block-ids.md for the character set and why it excludes `l`/`i`/`o`.
 */
export const parseAsBlockId = createParser<string>({
  parse: (value) => (isSpideryarnId(value) ? value : null),
  serialize: (value) => value,
});

/** `text=1` / `text=0` — the spelling this app already documented, kept. */
export const parseAsBit = createParser<boolean>({
  parse: (value) => (value === "1" ? true : value === "0" ? false : null),
  serialize: (value) => (value ? "1" : "0"),
});

/** The empty column set, which would otherwise serialize to an empty string. */
const NO_COLUMNS = "none";

/**
 * `cols=0,1,2`, and `cols=none` when every gist column is off.
 *
 * Written out rather than encoded, because these URLs get pasted to people: a
 * reader should be able to see what a link is going to show them.
 */
export const parseAsDepths = createParser<number[]>({
  parse(value) {
    if (value === NO_COLUMNS) return [];
    const parts = value.split(",").map((p) => Number.parseInt(p, 10));
    if (parts.length === 0 || parts.some((n) => !Number.isInteger(n) || n < 0)) {
      return null;
    }
    return [...new Set(parts)].sort((a, b) => a - b);
  },
  serialize: (value) =>
    value.length === 0
      ? NO_COLUMNS
      : [...new Set(value)].sort((a, b) => a - b).join(","),
  eq: (a, b) => a.length === b.length && a.every((n, i) => n === b[i]),
});

/* ------------------------------------------------------------ the params --
   `history` is the whole argument. Greg, 2026-08-25:

   > scrolling should replace rather than adding to history because we don't
   > need the back button to change scrolling

   So position replaces, and the deliberate acts — toggling a column, switching
   to outline mode, opening an article from the library — push. Back then undoes
   the last thing you *did*, and never crawls you back up the page one screen at
   a time. Clicking a gist to jump is the one scroll that pushes, because it is
   a deliberate act too; that override lives at the call site in TableView. */

/** Reading mode (text column on) vs outline mode. */
export const textParam = parseAsBit
  .withDefault(true)
  .withOptions({ history: "push" });

/**
 * Whether the bird's-eye rail down the left is on screen — see Spine.tsx.
 *
 * **No default, deliberately** — the same call `colsParam` makes below, for
 * nearly the same reason. Absent means *nobody has touched this*, and the rail
 * follows the window and the mode exactly as it always did: off in outline
 * mode, where the table already is a whole-article overview, and labelled only
 * when the labels are free (layout.ts § fitView). Giving it a default here
 * would make "the reader hid the rail" indistinguishable from "outline mode
 * dropped it", and those want opposite things when the text comes back.
 *
 * It only says on or off. Whether an on rail shows its labels or collapses to
 * ticks stays with the window width, because that is a question about how much
 * room there is rather than about what the reader wants to see.
 *
 * `push`, like `cols` and `text`: hiding a whole column of the view is a
 * deliberate act, and Back should undo it.
 */
export const spineParam = parseAsBit.withOptions({ history: "push" });

/**
 * Which gist columns are visible.
 *
 * No default, deliberately: the sensible default is "all of them", and how many
 * there are depends on how deep this particular article's tree turned out. Absent
 * means "whatever this article's full set is" and is resolved in App.
 */
export const colsParam = parseAsDepths.withOptions({ history: "push" });

/** Reading position, as the first block of the section in view. */
export const atParam = parseAsBlockId.withOptions({
  history: "replace",
  limitUrlUpdates: debounce(POSITION_SETTLE_MS),
});

/**
 * Which explanation dialog is open — see docs/project/comments.md.
 *
 * A comment id is a block id by construction (both come from `mintId`), so the
 * same parser validates it and the same "mangled link degrades to nothing"
 * behaviour falls out.
 *
 * `replace`, not `push`, even though opening a dialog is a deliberate act.
 * Pushing would put *two* entries on the stack for every open-then-close, so
 * Back would walk the reader through a history of panels they had already
 * finished with. The link still works when pasted, which is the part that
 * matters.
 */
export const noteParam = parseAsBlockId.withOptions({ history: "replace" });

/**
 * Which drawer panel is open, or nothing — see Dock.tsx and
 * docs/plans/bottom-bar.md.
 *
 * **One value, where there were two.** `about` is gone: the article's details
 * outgrew a drawer and became a page, `/read/<slug>/metadata`
 * (docs/plans/metadata-page.md). So this parameter now has exactly one legal
 * value, and it stays a parameter rather than becoming a flag because the next
 * panel will want the same shape.
 *
 * That leaves **two** superseded spellings of the same thing, and main.tsx
 * rewrites both to the metadata page on the way in: `?about=1`, which was the
 * masthead's ▾ disclosure, and `?panel=about`, which was this drawer. Same
 * trick the old `/?slug=` links get, and for the same reason — one spelling
 * reaches React and every old link keeps working.
 *
 * `replace`, for the same reason as `note`: opening and closing a panel twice
 * would otherwise cost four presses of Back to undo. It is in the URL at all so
 * that a link can arrive with the panel already showing, which is the one time
 * anybody wants it.
 *
 * An unknown value parses to null — a closed drawer — rather than throwing, so
 * a link from a future version that has more panels degrades to the article
 * instead of to an error. Same rule as `parseAsBlockId`. Note that `about=`
 * therefore degrades safely too, for any link main.tsx did not catch.
 */
const PANELS = ["questions"] as const;
export type Panel = (typeof PANELS)[number];

export const panelParam = createParser<Panel>({
  parse: (v) => (PANELS.includes(v as Panel) ? (v as Panel) : null),
  serialize: (v) => v,
}).withOptions({ history: "replace" });

/**
 * Which **mode** the middle band is in — the columns between the spine and the
 * prose. Absent means the table of contents, which is the default and the only
 * one there was until 2026-08-25.
 *
 * Greg's framing, which is the reason this is a mode rather than a panel:
 *
 * > I'm thinking that this might be a common pattern, that when we switch into
 * > a mode (e.g. Chat, Glossary, etc) we'll want to keep the spine and article,
 * > but reuse the middle sections. In fact, the current "Table of Contents"
 * > middle sections are just such a mode that can be chosen from the bottom-bar
 * > (the default).
 *
 * So `toc` is a real value with a real name, even though it is the default and
 * therefore never appears in a URL. Naming it is what makes the next mode an
 * addition to a list rather than a second special case.
 *
 * **`push`, unlike `?panel=`.** A drawer is a glance; a mode is where you are.
 * Switching to chat and pressing Back should put the table of contents back,
 * the same way toggling a column does — and unlike opening and closing a panel,
 * you do not do it twice in ten seconds, so it will not fill the history.
 *
 * An unknown value parses to `toc` rather than throwing, so a link from a
 * future version with a mode this one has not got degrades to the article
 * instead of to an error. Same rule as `parseAsBlockId` and `panelParam`.
 *
 * The Glossary that paragraph used to name as hypothetical arrived on
 * 2026-08-25 (docs/project/glossary.md), which is the first evidence that the
 * slot was the right shape: it cost this list one word. Search arrived the day
 * after (docs/project/search.md) and cost it one more, which is now enough
 * evidence to stop calling it evidence. Summary is the fourth
 * (docs/project/summaries.md).
 */
export const MODES = ["toc", "chat", "glossary", "search", "summary"] as const;
export type Mode = (typeof MODES)[number];

export const modeParam = createParser<Mode>({
  parse: (v) => (MODES.includes(v as Mode) ? (v as Mode) : null),
  serialize: (v) => v,
})
  .withDefault("toc")
  .withOptions({ history: "push" });

/**
 * Which conversation is open in chat mode, or none for the list of them.
 *
 * A thread id is minted by `mintId`, so it is a block id by construction and
 * the same parser validates it — and the same "a mangled link degrades to
 * nothing" behaviour falls out, which here means the thread list rather than an
 * error.
 *
 * `replace`, not `push`. Stepping between conversations while you read is
 * browsing, not navigating, and `mode` above already put one entry on the stack
 * for the trip into chat — which is the entry Back should use.
 */
export const threadParam = parseAsBlockId.withOptions({ history: "replace" });

/**
 * Which glossary term is selected, or none for a list nobody has picked from.
 *
 * A term id is minted by `mintId` (src/glossary.ts), so it is a block id by
 * construction and the same parser validates it — the same trick `?thread=`
 * uses, and the same "a mangled link degrades to nothing" behaviour falls out,
 * which here means an unselected list rather than an error.
 *
 * **It is in the URL because it changes what the article looks like.** A
 * selected term underlines every one of its occurrences in the prose beside the
 * panel, so "the article as I am currently looking at it" is not fully
 * described without it — which is the whole rule this file exists to keep
 * (url-state.md). Sending someone a link to a term is sending them the
 * underlines too.
 *
 * `replace`, not `push`. Stepping between terms while you read is browsing, not
 * navigating, and `mode` above already put one entry on the stack for the trip
 * into the glossary — which is the entry Back should use. Same call as
 * `?thread=`.
 */
export const termParam = parseAsBlockId.withOptions({ history: "replace" });

/**
 * How the glossary list is ordered.
 *
 * `document` — first use in the article first — is what the **artefact** stores
 * and was the default until 2026-08-26. `difficulty` and `centrality` are the
 * reader asking for the model's own judgment, which is the whole condition
 * attached to keeping those scores at all: Greg's call, 2026-08-25, was *keep
 * both, but never sort by them silently*. A sort the reader chose is not
 * silent; a sort that is simply how the list arrives is.
 *
 * **`prioritised` is now the default, and it is an override of that condition
 * rather than an exception the condition allows for.** Greg, 2026-08-26, asked
 * for an order that combines the two scores with first appearance and for it to
 * arrive without being asked for. It is the gentlest ranked order we could
 * build: the two scores only decide which of two groups an entry is in, and
 * *inside* a group the order is still first use, so the model chooses nothing
 * there. The divider names the rule and both scores are shown on every row —
 * see docs/plans/glossary-prioritised-order.md for the four designs and
 * `groupEntries` in GlossaryPanel.tsx for what it actually does.
 *
 * It is also **self-cancelling**: when the gate does not split the list (no
 * scores, or every entry on one side of it), the panel falls back to `document`
 * and does not offer the control. So an old glossary with no scores behaves
 * exactly as it did before, and the default never labels an order that isn't
 * one.
 *
 * `push`, like `cols` and `text` and unlike `term`: changing the order of a
 * list is a deliberate act on the view, and Back should undo it.
 *
 * An unknown value parses to the default, so a link written by a version with
 * more sorts still shows a list.
 */
export const TERM_SORTS = ["prioritised", "document", "difficulty", "centrality"] as const;
export type TermSort = (typeof TERM_SORTS)[number];

export const sortParam = createParser<TermSort>({
  parse: (v) => (TERM_SORTS.includes(v as TermSort) ? (v as TermSort) : null),
  serialize: (v) => v,
})
  .withDefault("prioritised")
  .withOptions({ history: "push" });

/**
 * How high the bar is for the prioritised order's top group — the reader's own
 * hand on the threshold, added 2026-08-26 at Greg's request for "a small
 * threshold-slider ... set to a sensible default".
 *
 * The number is `difficulty × centrality`, the same product `priorityOf` in
 * GlossaryPanel.tsx computes, so `?gate=0.45` says *promote the terms the model
 * called at least 0.45 hard-and-load-bearing*. Two decimal places on the way
 * out, and anything outside 0–1 parses to null rather than throwing, which is
 * the same rule every other parser in this file follows.
 *
 * **No default, deliberately** — the same call `colsParam` makes above, for the
 * same reason. Absent means *nobody has touched this*, and the panel resolves it
 * to `PRIORITY_GATE`. Giving it a default here would put the constant in two
 * files and make "the reader chose 0.30" indistinguishable from "the reader
 * chose nothing", which matters because the second is the one the condition on
 * these scores is about.
 *
 * `replace` and debounced, for exactly the reason `?at=` and `?find=` are: a
 * range input fires on every pixel of a drag, browsers rate-limit history
 * writes, and a Back button that walked back through a drag one step at a time
 * would be useless. Back should undo the *decision*, which is the `?sort=` push
 * that got you here.
 */
export const gateParam = createParser<number>({
  parse: (v) => {
    const n = Number.parseFloat(v);
    return Number.isFinite(n) && n >= 0 && n <= 1 ? Math.round(n * 100) / 100 : null;
  },
  serialize: (v) => v.toFixed(2),
}).withOptions({ history: "replace", limitUrlUpdates: debounce(200) });


/* ------------------------------------------------------------- search mode --
   Four parameters, which is more than any other mode needs, and the reason is
   that search mode has two matchers in it rather than one feature. See
   docs/project/search.md § The URL for the table.

   The division: `match` says which matcher, and then exactly one of `find` and
   `run` is the thing being matched — the letters you typed, or the saved
   meaning-search you re-opened. `order` is how the answers are stacked. */

/**
 * Which way the box matches: on the letters you typed, or on what they mean.
 *
 * These are not two settings of one search, they are two different questions —
 * the finding the version this is borrowed from recorded and then acted on
 * (docs/project/original-version/search-and-chat.md): *text search and
 * meaning-based search answer different questions, and their version ran both,
 * side by side.* One box, two matchers, and the reader says which.
 *
 * **`meaning` is the default**, changed by Greg on 2026-08-26. It was `words`
 * before, and the argument for that was that `words` is the free one — a reader
 * who opens the panel and types should get instant highlights, not a bill.
 *
 * That argument was about the wrong thing. Nothing in `meaning` mode spends
 * anything until the reader presses **find**; the free-ness of `words` was never
 * at risk, because the cost is attached to the submit and not to the mode. What
 * the old default actually decided was which *question* the panel opens on, and
 * the interesting one — describe what you are looking for — is the one this app
 * exists to offer. Find-on-page is the thing every reader already has a key for.
 *
 * The one URL that relied on the old default is the library's passage
 * deep-link, which carries `?find=` and nothing else. It now says `match=words`
 * out loud (Library.tsx). Nothing else produces a bare `?find=`: reaching words
 * mode by hand pushes `match=words` on the way.
 *
 * `push`, like `cols` and `text`: switching matcher changes what the article
 * looks like, and Back should undo it.
 */
export const MATCHERS = ["words", "meaning"] as const;
export type Matcher = (typeof MATCHERS)[number];

export const matchParam = createParser<Matcher>({
  parse: (v) => (MATCHERS.includes(v as Matcher) ? (v as Matcher) : null),
  serialize: (v) => v,
}).withOptions({ history: "push" });

const DEFAULT_MATCHER: Matcher = "meaning";

/**
 * Which matcher a URL is asking for, when it may not say.
 *
 * **No `withDefault`, because absence has to stay visible.** The rule is one
 * line and it is the whole reason this function exists rather than a constant:
 * a URL that carries `?find=` and no `?match=` is a *words* search, whatever the
 * default is today.
 *
 * That URL was the only spelling of a words search before 2026-08-26, so every
 * one that was pasted into a message, bookmarked, or left in somebody's history
 * is of that shape. Flipping the default without this would not have broken
 * them loudly — it would have opened them in meaning mode with the words they
 * were sent for sitting unread in a parameter nothing looks at, which is the
 * quiet kind of wrong. Found by a GPT Sol review of this change, which is also
 * where the point that updating `Library.tsx` is not the same as covering the
 * URLs already in the world came from.
 *
 * It is safe in the other direction because **`?find=` is cleared on the way
 * into meaning mode** (SearchPanel.tsx § Box): a live meaning search never has
 * one set, so "has `find`" cannot mean anything but words.
 */
export function resolveMatcher(match: Matcher | null, find: string | null): Matcher {
  if (match !== null) return match;
  return find !== null && find.trim() !== "" ? "words" : DEFAULT_MATCHER;
}

/**
 * The literal text being matched, in `words` mode.
 *
 * **It is in the URL because it changes what the article looks like** — every
 * occurrence is washed while it is set — which is the rule this whole file
 * exists to keep (url-state.md). A pasted link to a search is a link to the
 * highlights it draws.
 *
 * `replace` and debounced, for exactly the reason `?at=` is: this is written on
 * every keystroke, browsers rate-limit history writes, and a Back button that
 * walked backwards through a half-typed word one letter at a time would be
 * useless. The debounce is shorter than the scroll one because a search is
 * *finished* sooner than a scroll settles — you stop typing when you mean it.
 *
 * No validation beyond emptiness: any string is a legitimate thing to look for,
 * and a matcher that refused some of them would be refusing prose the article
 * might contain. An empty value is `null`, which is "not searching" rather than
 * "searching for nothing" — the difference between an unmarked article and one
 * where every gap between characters is a match.
 */
export const findParam = createParser<string>({
  parse: (value) => (value.trim() === "" ? null : value),
  serialize: (value) => value,
}).withOptions({ history: "replace", limitUrlUpdates: debounce(200) });

/**
 * Which saved meaning-search is showing, or none for the list of them.
 *
 * A run id is minted by `mintId`, so it is a block id by construction and the
 * same parser validates it — the trick `?thread=` and `?term=` both use, and
 * the same "a mangled link degrades to nothing" behaviour falls out, which here
 * means the list of saved searches rather than an error.
 *
 * `replace`, not `push`. Stepping between saved searches while you read is
 * browsing, not navigating, and `mode` already put one entry on the stack for
 * the trip into search — which is the entry Back should use. Same call as
 * `?thread=` and `?term=`.
 */
export const runParam = parseAsBlockId.withOptions({ history: "replace" });

/**
 * **Which saved meaning-searches are switched on** — `runs=k3m9qt,p7x2vb`.
 *
 * The plural is the parameter that matters now; `?run=` above is kept only so
 * that a link written before 2026-08-26 still opens the search it names. The
 * reconciliation is `resolveRuns`, one function below, and it is the same shape
 * as `resolveMatcher`: a rule about what an *absent* parameter means, written
 * once, rather than a default that would erase the distinction.
 *
 * Comma-separated and spelled out, exactly like `?cols=`, and for the reason
 * given there — these URLs get pasted to people, and a reader should be able to
 * see what a link is going to show them. Ids are already URL-safe by
 * construction (docs/project/block-ids.md), so nothing needs encoding.
 *
 * **Order is preserved rather than sorted.** `?cols=` sorts because a set of
 * depths has a natural order and two spellings of one view should be one
 * string; a set of ids does not. Sorting them would order the reader's searches
 * by a random six characters, which is not an order — so the order kept is the
 * one thing here that means anything, which is the order they switched them on
 * in. Nothing downstream depends on it (the marks stack by palette slot, and
 * the results list sorts by place or confidence), so this is about the URL
 * being readable rather than about the view.
 *
 * Duplicates are dropped, because two ticks of one box is one tick.
 *
 * **The empty set serializes to `runs=none`, and that is load-bearing.** It is
 * the same trick `?cols=` plays with `NO_COLUMNS`, and here it is not merely
 * tidy — without it the legacy fallback below resurrects a search the reader
 * has switched off. An empty list joined with commas is `""`, `""` parses back
 * to "no valid ids", and "no valid ids" is indistinguishable from *absent*, at
 * which point `resolveRuns` reads the old `?run=` and switches it on again. So
 * `?run=a` → untick → reload → `a` is back, with no way for the reader to make
 * it stop. Found by a GPT Sol review, 2026-08-26.
 *
 * A *mangled* value still degrades to nothing, which is the right answer for a
 * hand-edited URL. `none` is the only spelling of "deliberately empty".
 *
 * `replace`, like `?run=` before it and for the same reason: switching a saved
 * search on while you read is browsing, not navigating, and `?mode=` already
 * put the entry on the stack that Back should use.
 */
/** The empty set, which would otherwise serialize to an empty string. */
const NO_RUNS = "none";

export const parseAsIdList = createParser<string[]>({
  parse(value) {
    if (value === NO_RUNS) return [];
    const parts = value.split(",").filter((p) => p !== "");
    /* Every id validated, and a single bad one drops **only itself**. `?cols=`
       takes the opposite view and rejects the whole value, which is right there
       because a depth list is short and hand-written; a run list is machine-
       written and long-lived, and the id most likely to be wrong in one is a
       search the reader deleted on another machine. Throwing away the other
       four searches because of it would be the worst available answer. */
    const ids = [...new Set(parts.filter((p) => isSpideryarnId(p)))];
    return ids.length === 0 ? null : ids;
  },
  serialize: (value) => (value.length === 0 ? NO_RUNS : [...new Set(value)].join(",")),
  eq: (a, b) => a.length === b.length && a.every((id, i) => id === b[i]),
});

export const runsParam = parseAsIdList.withOptions({ history: "replace" });

/**
 * Which saved searches a URL is asking to switch on, when it may not say.
 *
 * **No `withDefault`, because absence has to stay visible** — the same sentence
 * `resolveMatcher` above is built on, and the same reason. A URL carrying
 * `?run=<id>` and no `?runs=` was written when a search panel could show
 * exactly one search at a time, and it means *switch that one on*. There are
 * such URLs in messages and bookmarks and browser histories; flipping to the
 * plural without this would open every one of them on an article with no marks
 * on it and a parameter nothing reads, which is the quiet kind of wrong rather
 * than the loud kind.
 *
 * It is safe in the other direction because **`?run=` is never written any
 * more**: the panel serializes the plural only, so a live URL that has one can
 * only have got it from an old link.
 *
 * And note what `runs` being *present but empty* has to mean, because getting
 * this wrong is a bug the reader cannot escape from: `?runs=none` is the reader
 * saying "none of them", and it must beat a leftover `?run=`. That is why the
 * empty set has a spelling of its own rather than serializing to nothing —
 * `parseAsIdList` above has the full account.
 *
 * The default is the **empty** set, which is Greg's ask on 2026-08-26 that the
 * boxes start unticked. Landing on an article in search mode therefore paints
 * nothing until the reader says so — the rule the glossary and the summaries
 * both already follow: *the article acquires marks when the reader asks for
 * them and at no other time.*
 */
export function resolveRuns(runs: string[] | null, run: string | null): string[] {
  if (runs !== null) return runs;
  return run !== null ? [run] : [];
}

/**
 * How the results list is ordered.
 *
 * `document` — where each passage sits in the article — is the default, and it
 * is the default because it is the ordering the reader already has in their
 * head. `confidence` is the reader asking for the model's own judgment about
 * its own answers, which is worth offering and is never worth doing silently:
 * the same condition Greg attached to the glossary's scores on 2026-08-25, and
 * for the same reason.
 *
 * A separate parameter from `?sort=`, which belongs to the glossary, rather
 * than one shared one with five legal values. Two modes' orderings have nothing
 * in common but the word, and `sort=difficulty` arriving in search mode would
 * be a value with no meaning that something would eventually have to guess at.
 *
 * `prioritised` is the third, added 2026-08-26 at Greg's request, and it is the
 * only one of the three that is not purely an ordering:
 *
 * > add a "Prioritised" ordering/filtering (kinda like how we do with Glossary)
 * > that orders by place but thresholds by confidence, and a threshold slider
 *
 * So it sorts exactly as `document` does and **hides** what falls under
 * `?conf=`. The word is spelt as the glossary spells it (`TERM_SORTS` above),
 * because it is the same idea in the reader's hands and two spellings of one
 * idea is a thing to have to remember.
 *
 * `push`: changing the order of a list is a deliberate act on the view.
 */
const HIT_ORDERS = ["document", "confidence", "prioritised"] as const;
export type HitOrder = (typeof HIT_ORDERS)[number];

export const orderParam = createParser<HitOrder>({
  parse: (v) => (HIT_ORDERS.includes(v as HitOrder) ? (v as HitOrder) : null),
  serialize: (v) => v,
})
  .withDefault("document")
  .withOptions({ history: "push" });

/**
 * How much confidence a result needs to stay on screen in `?order=prioritised`
 * — the reader's own hand on the bar, the counterpart of `?gate=` above.
 *
 * **0–100 integer, the same unit `SearchHit.confidence` is in everywhere**, and
 * that is deliberate rather than incidental: docs/project/search.md § the unit
 * that changed silently is about a confidence that meant 0–1 on one side of a
 * boundary and 0–100 on the other. A threshold in a different unit from the
 * numbers printed on the rows it hides would be that bug wearing a slider.
 *
 * **No default, deliberately**, exactly as `gateParam` has none: absent has to
 * keep meaning *nobody has touched this*, and the panel resolves it to
 * `PRIORITY_CONF`. A default here would put the constant in two files.
 *
 * `replace` and debounced, for the same reason `?gate=` is: a range input fires
 * on every pixel of a drag, and a Back button that walked back through a drag
 * would be useless. Back should undo the `?order=` push that got you here.
 */
export const confParam = createParser<number>({
  /* Digits only, and that is not pedantry. `Number.parseInt` stops at the first
     character it does not like, so `?conf=0.5` would parse to **0** — a bar at
     zero, hiding nothing, with no error anywhere. And `0.5` is exactly the
     value a person would try, because `?gate=` two parsers above this one IS a
     0-1 fraction and they sit side by side in the same URL. `Number()` is no
     better on its own: `Number("")` is 0. So the shape is checked before the
     range, and anything else is nobody's choice rather than a guess at one. */
  parse: (v) => {
    if (!/^\d{1,3}$/.test(v)) return null;
    const n = Number(v);
    return n <= 100 ? n : null;
  },
  serialize: (v) => String(v),
}).withOptions({ history: "replace", limitUrlUpdates: debounce(200) });

/* ---------------------------------------------------------- summary mode --
   Two controls, and they are the two axes of the same thing: how much summary
   you want. `len` says how long each entry is, `deep` says how many entries
   there are. See docs/project/summaries.md and SummaryPanel.tsx.

   **What is NOT in the URL, and why.** The panel also lets you open and close
   individual sections, and docs/project/original-version/structure-panel.md is
   emphatic that their version regretted keeping that only in memory. It stays
   in memory here anyway, and the reason is the rule that governs everything
   else in this app: a per-node open/closed set can only be written down as a
   list of node ids, node ids are **positional**, and a re-run of `npm run toc`
   renumbers them (docs/project/block-ids.md#why-random-and-not-sequential). A
   URL full of them would be long and, after any re-extraction, quietly wrong —
   it would open a set of sections that are no longer the ones you opened. What
   *is* stable is the depth, so the depth is what a link carries. Their point
   still stands and this is the honest version of it. */

/**
 * Which rung of the ladder every entry in the summary panel is shown at.
 *
 * Named rather than numbered, all the way down to the URL, because that is the
 * whole finding this feature is built on: *"sentence or two" is a thing a
 * writer can aim at and a reader can recognise; "level 4" is not*
 * (docs/project/original-version/summaries.md). `?len=long` says what it will
 * show you; `?len=2` would not.
 *
 * `gist` is the default and never appears in a URL. It is the rung that costs
 * nothing — one sentence per node, already on the tree — so an article with no
 * `summary.json` at all still has a usable panel, and the two generated rungs
 * are an upgrade rather than a precondition.
 *
 * `push`, like `cols` and `text`: changing how much summary you are reading is
 * a deliberate act on the view, and Back should undo it.
 */
export const RUNGS = ["gist", "short", "long"] as const;
export type Rung = (typeof RUNGS)[number];

export const rungParam = createParser<Rung>({
  parse: (v) => (RUNGS.includes(v as Rung) ? (v as Rung) : null),
  serialize: (v) => v,
})
  .withDefault("gist")
  .withOptions({ history: "push" });

/**
 * How far down the tree the summary panel goes — their structure panel's depth
 * cut-off, which is the one control that view had and the one thing it proved:
 * *one control, whole-document granularity* is usable.
 *
 * 1 is the parts, 2 is the sections. It stops at 2 because that is where the
 * summaries stop being written (src/summarise.ts § MAX_DEPTH) and because below
 * it a node is a single paragraph, which the reader should be reading rather
 * than being told about.
 *
 * Note that this and a node's own open/closed state are **two different ways to
 * be hidden**, and they compose rather than sharing a variable — their version
 * got that right and it is the one design note worth copying verbatim from it:
 * "too deep to show" and "I closed this" are different states.
 *
 * An unparseable or out-of-range value falls back to the default rather than
 * throwing, the same rule as everything else in this file.
 */
export const MAX_SUMMARY_DEPTH = 2;

export const deepParam = createParser<number>({
  parse: (v) => {
    const n = Number.parseInt(v, 10);
    return Number.isInteger(n) && n >= 0 && n <= MAX_SUMMARY_DEPTH ? n : null;
  },
  serialize: (v) => String(v),
})
  .withDefault(1)
  .withOptions({ history: "push" });

/* -------------------------------------------------------- the library --- */

/**
 * The shelf's own four parameters — `/?q=seth&by=opened&dir=desc&view=table`.
 *
 * These live on `/`, and every parameter above lives on `/read/<slug>`. The two
 * sets never meet: nothing carries a query string across that boundary
 * (`readHref` mints a bare path, and `carriedSearch` in router.ts only runs
 * between an article's own views). They are still given names of their own
 * rather than reusing `sort` and `order` — a URL should be readable without
 * knowing which page it is for, and a doc table with two rows called `sort`
 * meaning different things is a doc that has to apologise for itself.
 *
 * The rule they are here at all is the one this file exists for: reload the
 * homepage, or send somebody the link, and you get the same shelf back.
 * Until 2026-08-26 the search box was `useState` and the order was the server's,
 * so neither survived a reload.
 */

/**
 * What is in the search box.
 *
 * `replace` and debounced, the same call as `?find=` and for the same reasons:
 * written on every keystroke, browsers rate-limit history writes, and a Back
 * button that walked backwards through a half-typed word would be useless.
 *
 * No validation. Any string is a legitimate thing to look for; empty is `null`,
 * which is "not searching" rather than "searching for nothing".
 */
export const libraryQueryParam = createParser<string>({
  parse: (value) => (value.trim() === "" ? null : value),
  serialize: (value) => value,
}).withOptions({ history: "replace", limitUrlUpdates: debounce(200) });

/**
 * Which key the shelf is ordered by — `by=length`.
 *
 * The vocabulary is `SORTS` in library-sort.ts rather than a list repeated
 * here, so a key cannot exist in the control and not in the URL. An unknown
 * value returns `null` and the shelf falls back to `added`, which is the order
 * it has always had — a mangled link degrades to the ordinary homepage.
 */
export const libraryByParam = createParser<SortKey>({
  parse: (v) => (isSortKey(v) ? v : null),
  serialize: (v) => v,
})
  .withDefault(DEFAULT_SORT)
  .withOptions({ history: "push" });

/**
 * Which way round — `dir=asc`.
 *
 * Absent means "whichever way this key naturally goes" (newest first for a
 * date, longest first for a length — `SortSpec.natural`), and that is why this
 * has **no default**: a default of `desc` would be wrong for Title, and baking
 * each key's natural direction into the parser would put half of `SORTS` in
 * this file. `null` here means "the reader has not chosen", which the shelf
 * reads through `sortSpec(by).natural`.
 */
export const libraryDirParam = createParser<SortDir>({
  parse: (v) => (v === "asc" || v === "desc" ? v : null),
  serialize: (v) => v,
}).withOptions({ history: "push" });

/**
 * Cards or the dense table — `view=table`.
 *
 * `push`, because switching how the whole shelf is painted is a thing Back
 * should undo. Absent is cards, which is the shelf as it was.
 */
export const libraryViewParam = createParser<ShelfView>({
  parse: (v) => (v === "cards" || v === "table" ? v : null),
  serialize: (v) => v,
})
  .withDefault("cards")
  .withOptions({ history: "push" });

/**
 * Everything, or only what you have never opened — `show=unread`.
 *
 * A filter rather than an end of the "last opened" sort, because a missing
 * value is not a small one — see library-sort.ts, which keeps unopened articles
 * at the foot of that sort in *both* directions precisely so this chip is the
 * only way to ask the question.
 */
export const libraryShowParam = createParser<ShelfFilter>({
  parse: (v) => (v === "unread" ? v : v === "all" ? v : null),
  serialize: (v) => v,
})
  .withDefault("all")
  .withOptions({ history: "push" });
