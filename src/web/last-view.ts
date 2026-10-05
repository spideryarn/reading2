/**
 * **Reopen an article where you left it.**
 *
 * Greg, 2026-09-05 (SPIDERYARN-READING2-1W):
 *
 * > If I close and then reopen an article, it should ideally return me to the
 * > position/state/view that I was in. It's fine for this to be local to the
 * > device/browser, or whatever is simplest
 *
 * Almost all of that was already built. Everything about how you are looking at
 * an article is in the query string — `?at=` the section, `?mode=`,
 * `?summary=` and thirty more (docs/project/url-state.md) — so this file is not
 * about representing reading state. It answers one question: **what remembers
 * the query string, and when is it replayed?**
 *
 * The whole feature: copy the query string into `localStorage` under the slug
 * as the reader moves, and put it back when they open that article at a bare
 * address. No server, no schema, no sync, and per-device by construction, which
 * is what Greg said was fine.
 *
 * ## Why this is `localStorage` when url-state.md keeps view state in the URL
 *
 * That rule is about the **source of truth**: while you are looking at an
 * article the URL is the only thing that knows where you are, and a second
 * store that could disagree with it is a bug waiting to be written. This adds
 * no such store. What is kept here is a *copy of an address you have already
 * left*, read exactly once — before anything paints — to decide which address
 * you arrive at. From that moment the URL is the only writer, exactly as
 * before. Same shape as the other per-browser keys url-state.md lists, such as
 * install-hint.ts and mic-devices.ts.
 *
 * ## What is remembered, and what is deliberately not
 *
 * `REMEMBERED` below is everything that is purely *how you are looking at it*.
 * `NEVER_REMEMBERED` is the rest, and each entry has its reason beside it — the
 * short version is that a dialog, a drawer, an open conversation and a search
 * are things you **did**, not places you **were**. `NEEDS_AN_EXPLICIT_PRESS` is
 * the third list: three values of `?mode=` that start something merely by being
 * arrived in, so the mode is dropped while its subordinate parameters are kept.
 *
 * ## The link always wins
 *
 * A restore happens only when the incoming address carries **none** of the
 * article's parameters — not merely none of the remembered ones. So a shared
 * `?at=`, `?note=` or `?thread=` link beats this browser's memory outright.
 * Getting that backwards would break sharing, which is half of what the URL
 * state is for (docs/project/public-shelf.md, docs/project/links.md).
 *
 * ## And an article never opened here arrives at a default
 *
 * Since 2026-10-05, for a signed-in reader: a bare address with **no key at
 * all** for the slug opens in Summary where a band fits beside the prose, with
 * Marginalia's notes too where those fit and the reader's experimental switch
 * is on. It is the same decision with one more case, and the same rule: the
 * link always wins. So that "no key" means *never opened in this browser*, an
 * empty view is now stored as `""` rather than removed, and a storage that
 * cannot be read or written means no default rather than one on every visit.
 * A visit signed out, or on a window too narrow for a band, writes the key
 * like any other and so uses the first open up. § The first-open default,
 * below.
 *
 * The reasoning, the deferred pieces and the questions nobody was there to
 * answer are in
 * docs/plans/260905d-remember-where-you-were-in-an-article-and-move-the-design-link-into-admin.md.
 */
import { useEffect, useLayoutEffect, useRef } from "react";

import { onAddressChange, parseRoute } from "./router.js";
import { isMarginaliaModeWord } from "../modes.js";
import { bandCoversProse } from "./layout.js";
import { notesFit } from "./marginalia/press.js";
import { rootFontPx, usableWidth } from "./reader/measure.js";
import { useExperimental } from "./useExperimental.js";

/**
 * The parameters worth putting back, and every one of them is inert on arrival:
 * arriving with it set draws a view and asks nothing of the server that the
 * article's own page load did not already ask.
 *
 * The vocabulary is params.ts; `tests/last-view.test.ts` scans the tree for
 * `useQueryState` keys and fails if one is in neither this list nor the one
 * below, so a thirty-sixth parameter is a decision rather than an omission.
 */
export const REMEMBERED = [
  "at", // the section you were reading
  "spine", // the bird's-eye rail
  "mode", // which mode owns the band — bar three; NEEDS_AN_EXPLICIT_PRESS
  "margin", // Marginalia's column of notes, right of the prose — draws only what is already there
  "summary", // brief, fuller or thread — dormant without `mode`, and a restore never opens the thread
  "structure", // fisheye or expanded — nothing to generate either way
  "diagram", // which of the five pictures
  "dx", // drift's sideways axis
  "dhue", // what a dot's colour means
  "referee", // which referee sub-mode
  "crits", // which criteria are selected
  "refscale", // which diverging ramp
  "remember", // recall, tutorial, explore or quiz
  "sort", // glossary order
  "gate", // glossary threshold
  "rank", // quotes order
  "bar", // quotes threshold
  "debate", // reception or claims — a restore draws what is stored; only a press searches
  "debateby", // reception's order
  "bears", // claims' relevance threshold
  "debatethread", // which of debate's threads narrows its list
  "citeby", // citations order
  "citebar", // citations threshold
  "faqby", // FAQ order
  "faqbar", // FAQ threshold
  "term", // selected glossary term
  "idea", // selected idea
  "quote", // selected quote
  "event", // selected timeline event
  "depth", // which pass of a Skim — Gist, More or Most
  "stop", // which quote-sized Skim stop you were reading
] as const;

/**
 * Known article parameters that are **never** put back. Listed rather than
 * simply omitted, because the difference between "we decided against this one"
 * and "nobody has looked at this one" is the whole value of the test that pins
 * these two lists against `params.ts`.
 */
export const NEVER_REMEMBERED = [
  /* Opens the explanation dialog and jumps the page to the passage it is
     anchored to. A dialog is something the reader did; reopening one they
     closed a week ago is a surprise, not a restoration. */
  "note",
  /* A drawer is not a place you were — the app's own `carriedSearch` already
     drops it when stepping between an article's three pages (router.ts). */
  "panel",
  /* Names an open conversation. `NEEDS_AN_EXPLICIT_PRESS` below is why we do
     not put the reader back into a conversation mode at all, either. */
  "thread",
  /* Search mode's matcher, the thing being matched, and the ordering of its
     results. A search *outlines* the passages that match, so replaying last
     week's over the prose changes what the article looks like on arrival.
     Excluded as a block so the rule is one sentence rather than six. */
  "match",
  "find",
  "run",
  "runs",
  "order",
  "conf",
  /* **The viewport diagnostic** — `?probe=1`, ViewportProbe.tsx. A diagnostic
     is not a place the reader was, and this one installs two visual-viewport
     listeners and draws a panel over the article, so putting it back on a bare
     address would be the app switching an instrument on by itself.

     It is *listed* rather than left out, and that is the load-bearing half:
     `hasArticleState` is built from both lists, so a parameter neither list has
     heard of makes `/read/x?probe=1` read as a **bare** address — and a restore
     would then overwrite it with the remembered view, taking the probe off the
     URL that had just switched it on. */
  "probe",
  /* **Which Metadata section to open and flash on arrival** — `?section=`,
     params.ts § `sectionParam`, written by the command bar's *Run again* rows
     (plan 261002c). An instruction carried out once and then taken off the
     address, so never a place to put back. Listed for `probe`'s reason: left
     out, `/read/x/metadata?section=ai-processing` reads as a bare address and
     the remembered view is appended over the link that had just named the
     section. GPT Sol's F5 on that plan. */
  "section",
  /* **A retired key, kept so an old link still wins.** `?deep=` chose Parts or
     Sections in Summary's outline until the outline went on 2026-10-01
     (docs/plans/261001p-summary-loses-parts-and-sections-a-touch-wider.md).
     Nothing writes it now, and nothing reads it, so it is never stored. But
     an address from before then can be `/read/x?deep=2` with no `mode` on it
     (Summary wrote `deep`, then Plain changed only `mode`), and dropping the
     key from both lists would make that address read as bare — so a
     remembered view would be restored over a link somebody had just opened.
     GPT Sol's plan review of 261001p, P1. */
  "deep",
  /* Debate's retired identification threshold still marks an explicit old
     link. As with `deep`, do not restore another view over it. */
  "name",
] as const;

/** Every parameter this app puts on an article's address. */
export const ARTICLE_PARAMS: readonly string[] = [...REMEMBERED, ...NEVER_REMEMBERED];

/**
 * **Modes a reader may only arrive in by pressing something.** `?mode=` is
 * remembered for every value but these three; the mode pair is simply dropped,
 * so the reader lands on the article itself.
 *
 * The rule they break is *a restore must not start anything*, and each one
 * breaks it for its own reason — checked in the code rather than assumed, after
 * a first survey said all thirteen modes were inert and a cross-family review
 * showed two of them were not (GPT Sol, F1 and F2, 2026-09-05):
 *
 * - **`diagram`** — `useSimilar` in DiagramPanel.tsx **POSTs `/api/similar` on
 *   arrival** for the Force picture, and `useProjection` does the same for
 *   Drift and Trail. The panel's own comment is the clearest statement of it:
 *   *"merely opening `?mode=diagram` fires this POST — it is the one fetch in
 *   the reading view a reader can start without pressing anything that says
 *   what it will do."* It costs a model call the first time. Bare `?mode=`
 *   would be safe, because `?diagram=` defaults to `sketch` — but we remember
 *   `?diagram=` too, so restoring the mode would restore the picture with it.
 * - **`remember`** — `RememberBand` mounts the same `ConversationBand` chat
 *   does, and its arrival effect calls `startNew()`, which opens a conversation,
 *   focuses the composer and writes a `?thread=`.
 * - **`chat`** — the same conversation-on-arrival, and this one costs nothing:
 *   `begin` in useChat.ts is client-side until the reader sends something. It is
 *   dropped on judgment rather than on cost, because a conversation panel that
 *   opens by itself reads as the app *starting* something.
 *
 * **`?diagram=`, `?dx=`, `?dhue=` and `?remember=` stay in `REMEMBERED`.** They
 * are subordinate to a mode nobody is now in, so they draw nothing and fetch
 * nothing — and pressing Diagram or Remember later returns the reader to the
 * picture or the half they had chosen, which is most of what they wanted.
 *
 * `tweets` was the fourth, from 2026-09-29 to 2026-10-03. The thread is one of
 * Summary's views now, so its rule is a condition on a pair of parameters
 * rather than a mode word: § `opensTheThread` below.
 */
const NEEDS_AN_EXPLICIT_PRESS = new Set(["chat", "diagram", "remember"]);

/**
 * **Would restoring these pairs open Summary's thread?** Then the mode is
 * dropped, as the three above are.
 *
 * Opening the thread with none stored **writes one**, a model call, on arrival
 * rather than on a press (useTweets.ts § `useAutoRunOnArrival`; Greg,
 * 2026-09-12), and a restore is the one arrival nobody chose. Summary at Brief
 * or Fuller arms nothing on arrival and is restored as it stands, so the
 * question needs both pairs: `mode` reads as Summary and the remembered
 * `summary` is `thread`. `summary=thread` itself stays remembered and dormant,
 * as `diagram=force` does, so pressing Summary later returns to the thread —
 * and that press is a press.
 *
 * `mode=tweets`, the word a browser may have remembered before 2026-10-03,
 * counts whatever `summary` says: `settleAddress` would lift it to the thread
 * (router.ts § `liftLegacyTweets`).
 * docs/plans/261003l-fewer-top-level-modes-tweets-become-summary-s-thread.md.
 */
function opensTheThread(all: readonly string[]): boolean {
  const first = (name: string) => all.find((p) => pairKey(p) === name);
  const mode = first("mode");
  if (mode === undefined) return false;
  if (pairValue(mode) === "tweets") return true;
  const summary = first("summary");
  return pairValue(mode) === "summary" && summary !== undefined && pairValue(summary) === "thread";
}

/** Where one article's last view is kept. One key per slug; see `writeLastView`. */
const KEY_PREFIX = "spya.lastView.";

/**
 * **Does this pair name that parameter, however it is spelled?**
 *
 * `?%61t=…` is `?at=…` to every parser in this app, because `URLSearchParams`
 * decodes keys — and a textual filter for `at=` does not. router.ts has the
 * same function and the story of the two bugs that came of not having it; the
 * copy is deliberate, because exporting one from there would drag this
 * module's concerns into the address canonicaliser, whose whole point is that
 * its rewrites are a closed set.
 */
function pairKey(pair: string): string {
  const key = pair.split("=")[0] ?? "";
  try {
    return decodeURIComponent(key);
  } catch {
    /* A malformed escape is not a match for any plain name, and it must not
       throw here: this runs on whatever address the reader arrived with. */
    return key;
  }
}

/** The value half of a pair, decoded, or `""`. */
function pairValue(pair: string): string {
  const eq = pair.indexOf("=");
  if (eq === -1) return "";
  try {
    return decodeURIComponent(pair.slice(eq + 1));
  } catch {
    return pair.slice(eq + 1);
  }
}

/** `"?a=1&b=2"` → `["a=1", "b=2"]`, empty pairs dropped. */
function pairs(search: string): string[] {
  return search
    .replace(/^\?/, "")
    .split("&")
    .filter((p) => p !== "");
}

/**
 * Does this address already say how to look at the article?
 *
 * Asked over **every** article parameter rather than the remembered ones, so
 * that a link carrying only `?note=` or `?find=` is left exactly as sent. Query
 * parameters that are not ours — a `?utm_source=` on a pasted link — are not
 * state and do not count.
 */
export function hasArticleState(search: string): boolean {
  return pairs(search).some((p) => ARTICLE_PARAMS.includes(pairKey(p)));
}

/**
 * The part of an address worth remembering: `"?at=spya-x&mode=summary"`, or
 * `""` when there is nothing.
 *
 * **Filtered pair by pair as text**, never through `URLSearchParams`, so what
 * comes out is byte-for-byte what the app wrote — a value with a comma in it
 * stays itself rather than being reserialised with `%2C`. Same reason router.ts's
 * rewrites are textual.
 *
 * **Three modes are remembered as no mode at all** —
 * `NEEDS_AN_EXPLICIT_PRESS` above — **and so is Summary while its thread is the
 * view** (`opensTheThread`). Every other mode is put back as it stands, and a
 * *link* that names any of them is untouched: this is only about what we replay
 * unasked.
 */
export function rememberableSearch(search: string): string {
  /* **`mode=annotations` is `margin=1` now** (2026-10-01): Marginalia (called
     Annotations until later that day) was a value of `?mode=` for its first
     day, and a browser that remembered it then should get the notes back
     rather than a word `modeParam` reads as Plain. `mode=marginalia` takes the
     same road (`isMarginaliaModeWord`, 261001n). Translated here, on the way in
     and on the way out, so a restore never puts either spelling on the address
     — docs/plans/261001i-annotations-column-beside-a-band-mode.md. */
  const raw = pairs(search);
  const firstMode = raw.find((p) => pairKey(p) === "mode");
  const marginaliaWord = firstMode !== undefined && isMarginaliaModeWord(pairValue(firstMode));
  let wroteMargin = false;
  const translated = marginaliaWord
    ? raw.flatMap((p) => {
        const key = pairKey(p);
        /* Match the Reader's atomic rewrite: the legacy mode wins over any
           simultaneous margin value, and no duplicate of either spelling is
           restored into an order-dependent URL. */
        if (key === "margin") return [];
        if (key !== "mode") return [p];
        if (wroteMargin) return [];
        wroteMargin = true;
        return ["margin=1"];
      })
    : raw;
  const thread = opensTheThread(translated);
  const kept = [...new Set(translated)].filter((p) => {
    const key = pairKey(p);
    if (!REMEMBERED.includes(key as (typeof REMEMBERED)[number])) return false;
    return !(key === "mode" && (thread || NEEDS_AN_EXPLICIT_PRESS.has(pairValue(p))));
  });
  return kept.length > 0 ? `?${kept.join("&")}` : "";
}

/**
 * The address to arrive at instead, or `null` for "leave it alone" — the whole
 * decision, as a pure function, so every clause can be watched failing
 * (docs/reusable/silent-success.md).
 *
 * The incoming query string is **kept and appended to** rather than replaced: a
 * `?utm_source=` that came in on the link is not ours to throw away, and we
 * only get here when the address holds no state of its own.
 */
export function restoredHref(
  pathname: string,
  search: string,
  remembered: string | null,
): string | null {
  if (remembered === null || remembered === "") return null;
  if (hasArticleState(search)) return null;
  /* **Filtered on the way out as well as on the way in**, because `REMEMBERED`
     governs what gets *written* and a browser's storage outlives any version of
     that list. When `text` moved to `NEVER_REMEMBERED` on 2026-09-05, every
     browser already holding `?mode=hierarchy&text=0` would have restored it —
     from a layout effect, *after* `settleAddress` had run — and walked straight
     past the boot-time rewrite that then existed to get a reader out of exactly
     that state. The passive save that cleans the storage up happens too late
     to help the address they are already looking at. (`text` and `cols` left
     both lists on 2026-09-29 with the Hierarchy mode, and this is what drops
     them from a browser that still holds them.)

     Here rather than in `readLastView` because this is the pure function, which
     is where this file puts its decisions so each one can be watched failing;
     and general rather than a special case for `text`, so the *next* parameter
     to leave the list is safe without anybody remembering this happened.
     GPT Sol, reviewing stage 3 of
     docs/plans/260905d-declutter-the-reading-view-top-bars.md. */
  const keep = rememberableSearch(remembered);
  if (keep === "") return null;
  const existing = pairs(search);
  const restored = pairs(keep);
  return `${pathname}?${[...existing, ...restored].join("&")}`;
}

/**
 * Where the storage comes from. A function, because merely *reaching for*
 * `window.localStorage` throws where site data is blocked, and in vitest's node
 * environment there is no `window` at all — so the reach has to happen inside
 * the caller's `try`. A parameter of the two functions below so a test can hand
 * in one that throws on a read or on a write (tests/last-view.test.ts).
 */
type StorageSource = () => Pick<Storage, "getItem" | "setItem">;
const browserStorage: StorageSource = () => window.localStorage;

/**
 * **What the storage said about one article — three answers, not two.**
 *
 * `none` and `failed` were both `null` until 2026-10-05, and nothing cared: a
 * restore does nothing for either. The first-open default does care. With
 * storage blocked every open would look like a first one, and the default
 * would be put back over a reader's choice of Plain on every visit (GPT Sol,
 * plan 261005a, F1). A discriminated union so the compiler makes each caller
 * say which it means.
 */
export type StoredView =
  /** A key is there. `search` may be `""`: opened before, and left in Plain at the top. */
  | { kind: "stored"; search: string }
  /** Read cleanly, and there is no key: this browser has not opened the article. */
  | { kind: "none" }
  /** The storage threw. Nothing is known, so nothing is assumed. */
  | { kind: "failed" };

/**
 * What this browser last saw of that article.
 *
 * Wrapped, and not only against an empty value: `localStorage` **throws** in
 * Safari's private mode and wherever site data is blocked. A convenience is
 * never worth taking a page down for, so a failure here means the reader gets
 * the top of the article, which is what they got before this file existed.
 */
export function readLastView(slug: string, storage: StorageSource = browserStorage): StoredView {
  try {
    const search = storage().getItem(KEY_PREFIX + slug);
    return search === null ? { kind: "none" } : { kind: "stored", search };
  } catch {
    return { kind: "failed" };
  }
}

/**
 * Remember this article's view, and say whether that worked.
 *
 * **An empty view is stored as `""`, not forgotten.** A reader who scrolls back
 * to the top of a plain article has a query string with nothing in it, and that
 * *is* their last view: a stale `?at=` left behind would send them back down
 * the page next time in spite of what they just did. Until 2026-10-05 the key
 * was removed instead, which said the same thing to a restore and the wrong
 * thing to the first-open default below — no key has to mean *never opened
 * here*, or going back to Plain would earn the default again on the next open.
 * `restoredHref` treats `""` as nothing to restore, so restores are unchanged.
 *
 * One key per slug, and no index and no pruning — deliberately. An entry is a
 * few dozen bytes against a quota of about five megabytes, so it would take
 * tens of thousands of articles to matter, and `QuotaExceededError` is caught
 * here like every other failure. Read-modify-writing a bounded index on a path
 * that runs while the reader is scrolling would cost more than it saves.
 */
export function writeLastView(slug: string, search: string, storage: StorageSource = browserStorage): boolean {
  try {
    storage().setItem(KEY_PREFIX + slug, search);
    return true;
  } catch {
    /* See `readLastView`. The view simply will not survive being closed. */
    return false;
  }
}

/**
 * ## The first-open default
 *
 * Greg, 2026-10-04 (spya-ax5tmm):
 *
 * > When I open an article for the first time, default to Summary/Briefer in left-hand (if there's
 * > room) and (if there's even more room) Marginalia mode in right-hand
 *
 * One more case in the same decision: a bare address **and no key for this
 * slug** arrives at a default instead of at the article alone. Three pure
 * functions, one per question, and the effect in `useLastView` that asks them.
 * docs/plans/261005a-no-home-icon-beside-the-logo-and-a-first-open-default-of-summary-and-marginalia.md.
 *
 * **"First open" means first open in this browser**, because the key is the
 * only memory there is. So an article read on another device gets the default
 * once here; and since the save in `useLastView` writes the key on every open,
 * a signed-out visit, or one on a window too narrow for a band, counts as
 * having opened it — the default is not held over for a wider window or a
 * later sign-in.
 */

/**
 * **What the default is, for a window this wide** — `""` for the article alone.
 *
 * Asked of the two functions the reading view itself uses, so the default can
 * never name a column the layout would then decline to draw: `bandCoversProse`
 * (a band would lie over the prose — below 700px with the rail) and `notesFit`
 * beside Summary's `roomy` band (from 900px). The widths are theirs; the tests
 * sit either side of each. `?summary=` is left off, which is Brief.
 *
 * **`marginalia` is the reader's experimental switch**: Marginalia is behind
 * it (src/mode-catalog.ts), and a default must not put an experimental column
 * in front of a reader who has not asked for those. Summary is not behind it.
 *
 * Neither parameter starts anything on arrival — checked in the hooks, as
 * `NEEDS_AN_EXPLICIT_PRESS` above says to: Summary's `useSimple` and
 * Marginalia's `useRelations` both spend through `useAutoRun`, which waits for
 * a press.
 */
export function firstOpenSearch(windowWidth: number, rootFontPx: number, marginalia: boolean): string {
  if (bandCoversProse(windowWidth)) return "";
  const notes = marginalia && notesFit({ windowWidth, bandShape: "roomy", rootFontPx }, true).both;
  return notes ? "?mode=summary&margin=1" : "?mode=summary";
}

/**
 * **Is this a first open — and is that now on record?** True only when the
 * address says nothing, the storage was read cleanly and held no key, *and*
 * the marker (an empty view) was then written. The write comes before the
 * default rather than after it because a default that cannot be recorded
 * cannot be once-only: where the storage refuses, the address is left alone.
 *
 * Not pure — it writes — but the storage is handed in, so each of its four
 * ways of saying no can be watched.
 */
export function claimFirstOpen(
  slug: string,
  search: string,
  stored: StoredView,
  storage: StorageSource = browserStorage,
): boolean {
  if (stored.kind !== "none") return false;
  if (hasArticleState(search)) return false;
  return writeLastView(slug, "", storage);
}

/**
 * **The address a claimed first open arrives at, or `null` to leave it.**
 * Asked once the experimental switch has answered, which on a cold load is a
 * moment after the claim — so everything that could have changed in that
 * moment is asked again here:
 *
 * - a signed-out reader gets none. A stranger's first sight of a shared
 *   article is the article; whether it should be a summary is not decided;
 * - `firstOpen` is `""` where the window has no room;
 * - the address must still say nothing. A reader who has scrolled or pressed
 *   a mode in the meantime has state on it, and the link always wins;
 * - and it must still name this article's reading view — not the metadata
 *   page, and not wherever a navigation has just gone.
 *
 * Appended to the incoming query string, as `restoredHref` does.
 */
export function firstOpenHref(
  slug: string,
  pathname: string,
  search: string,
  reader: { signedIn: boolean },
  firstOpen: string,
): string | null {
  if (!reader.signedIn || firstOpen === "") return null;
  if (hasArticleState(search)) return null;
  const route = parseRoute(pathname);
  if (route.kind !== "read" || route.slug !== slug || route.view !== "article") return null;
  return `${pathname}?${[...pairs(search), ...pairs(firstOpen)].join("&")}`;
}

/**
 * Both halves, wired to one article. Called near the top of `ArticlePage`.
 *
 * **In `ArticlePage` rather than in main.tsx**, which is where every other
 * address rewrite lives. Those run once per page load, and the commonest way to
 * reopen an article is a click on the shelf — a client-side `navigate()` that
 * never re-runs that file. This component mounts on a cold load, mounts again
 * on a navigation from the shelf, and changes its `slug` prop on a jump from
 * one article to another. One hook covers all three.
 *
 * **A layout effect for the restore**, so the address is settled before
 * anything paints. `useReadingPosition`, which turns `?at=` into a scroll,
 * lives inside the reader — not rendered until the article has been fetched —
 * so it reads the restored value exactly as it reads a pasted one, and needs to
 * know nothing about this.
 *
 * **A passive effect for the save, and it holds no state**, which is why it
 * subscribes through `onAddressChange` rather than calling `useAddress()`:
 * `?at=` is rewritten about once a second while anybody scrolls, and a re-render
 * of `ArticlePage` on each of those would re-render the whole article.
 */
export function useLastView(slug: string): void {
  /* **Once per article, and the ref is what makes that true rather than nearly
     true.** `StrictMode` (main.tsx) deliberately runs every effect twice in
     development, so without this the storage is read twice on every open — and
     "read exactly once, before anything paints" is the sentence this file uses
     to argue it has not added a second source of truth. A claim contradicted by
     the code in development is not a claim worth making. The second pass is
     harmless today, because by then the address holds state and `restoredHref`
     declines — but that is the guard downstream doing this one's job, and it
     stops being true the moment anything here needs to be idempotent for a
     different reason. GPT Sol, F4, 2026-09-05. */
  const restoredFor = useRef<string | null>(null);
  /* The slug whose first open has been claimed and whose default is still to
     be applied — see the second effect. */
  const firstOpenFor = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (restoredFor.current === slug) return;
    restoredFor.current = slug;
    const stored = readLastView(slug);
    /* The same one read answers both questions: something to put back, or a
       first open. They cannot both be yes — one needs a key and the other
       needs there to be none. */
    firstOpenFor.current = claimFirstOpen(slug, location.search, stored) ? slug : null;
    const href = restoredHref(location.pathname, location.search, stored.kind === "stored" ? stored.search : null);
    if (href === null) return;
    /* `replaceState`, not `pushState`: the bare address is a spelling the reader
       arrived in rather than a page they visited, so Back belongs to whatever
       they came from. The same call every rewrite in main.tsx makes. Both nuqs
       and router.ts have this patched, so every `useQueryState` below sees the
       new query string without being told. */
    history.replaceState(history.state, "", href);
  }, [slug]);

  /* **The first-open default, applied once the experimental switch has
     answered**, because the switch decides whether Marginalia is part of it
     (`firstOpenSearch`). Arriving from the shelf the answer is already in the
     store, so this runs in the same commit as the claim above and the address
     is settled before anything paints. On a cold load it arrives a moment
     after the page, and the band appears a moment after the article — once per
     article, and only when the address was typed or pasted bare. A switch that
     never answers means no default.

     **Measured here, once**, with the reader's own two measurements
     (reader/measure.ts): a resize afterwards moves the layout and never
     reapplies this. `signedIn` is the store's too, which is why no reader id
     is passed in. Declared after the claim so it sees this render's claim. */
  const { loaded, signedIn, on } = useExperimental();
  useLayoutEffect(() => {
    if (!loaded || firstOpenFor.current !== slug) return;
    firstOpenFor.current = null;
    const href = firstOpenHref(
      slug,
      location.pathname,
      location.search,
      { signedIn },
      firstOpenSearch(usableWidth(), rootFontPx(), on),
    );
    if (href !== null) history.replaceState(history.state, "", href);
  }, [slug, loaded, signedIn, on]);

  useEffect(() => {
    const save = () => {
      /* **Which article the address currently names, not which one this
         component was rendered for.** `navigate()` writes the new address
         synchronously and fires its event before React re-renders, so on the
         way *out* of an article this listener runs one last time with the
         address of wherever the reader has just gone. Without this guard that
         last call would write the shelf's query string — or another article's —
         under this slug. */
      const route = parseRoute(location.pathname);
      if (route.kind !== "read" || route.slug !== slug) return;
      writeLastView(slug, rememberableSearch(location.search));
    };
    // The state we arrived with counts: a shared link's `?at=` is where this
    // reader was, from the moment they opened it.
    save();
    return onAddressChange(save);
  }, [slug]);
}
