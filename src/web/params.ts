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
export const PANELS = ["questions"] as const;
export type Panel = (typeof PANELS)[number];

export const panelParam = createParser<Panel>({
  parse: (v) => (PANELS.includes(v as Panel) ? (v as Panel) : null),
  serialize: (v) => v,
}).withOptions({ history: "replace" });
