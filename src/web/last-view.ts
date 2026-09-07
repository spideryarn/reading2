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
 * an article is in the query string — `?at=` the section, `?mode=`, `?cols=`,
 * `?deep=` and thirty more (docs/project/url-state.md) — so this file is not
 * about representing reading state. It answers one question: **what remembers
 * the query string, and when is it replayed?**
 *
 * The whole feature: copy the query string into `localStorage` under the slug
 * as the reader moves, and put it back when they open that article at a bare
 * address. No server, no schema, no sync, and per-device by construction, which
 * is what Greg said was fine.
 *
 * ## Why this is `localStorage` when url-state.md says nothing is
 *
 * That rule is about the **source of truth**: while you are looking at an
 * article the URL is the only thing that knows where you are, and a second
 * store that could disagree with it is a bug waiting to be written. This adds
 * no such store. What is kept here is a *copy of an address you have already
 * left*, read exactly once — before anything paints — to decide which address
 * you arrive at. From that moment the URL is the only writer, exactly as
 * before. Same shape as referee-card.ts, install-hint.ts and mic-devices.ts,
 * which are the other three exceptions and all say the same thing.
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
 * The reasoning, the deferred pieces and the questions nobody was there to
 * answer are in
 * docs/plans/260905d-remember-where-you-were-in-an-article-and-move-the-design-link-into-admin.md.
 */
import { useEffect, useLayoutEffect, useRef } from "react";

import { onAddressChange, parseRoute } from "./router.js";

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
  "cols", // which gist columns are on
  "spine", // the bird's-eye rail
  "mode", // which mode owns the band — bar three; NEEDS_AN_EXPLICIT_PRESS
  "deep", // how far down summary mode goes
  "diagram", // which of the five pictures
  "dx", // drift's sideways axis
  "dhue", // what a dot's colour means
  "referee", // which referee sub-mode
  "crits", // which criteria are selected
  "refscale", // which diverging ramp
  "remember", // recall or quiz
  "sort", // glossary order
  "gate", // glossary threshold
  "rank", // quotes order
  "bar", // quotes threshold
  "term", // selected glossary term
  "idea", // selected idea
  "quote", // selected quote
  "event", // selected timeline event
] as const;

/**
 * Known article parameters that are **never** put back. Listed rather than
 * simply omitted, because the difference between "we decided against this one"
 * and "nobody has looked at this one" is the whole value of the test that pins
 * these two lists against `params.ts`.
 */
export const NEVER_REMEMBERED = [
  /* **`text=0` is the one state a restore could put the reader in and not get
     them out of**, so it moved down here on 2026-09-05, the day the `Text` pill
     that wrote it went with the rest of the controls bar. `settleAddress`
     rewrites an incoming `?mode=hierarchy&text=0` to `?mode=outline` for exactly
     that reason (src/web/router.ts § `liftStrandedText`) — and a restore runs
     *after* that rewrite, from a React effect, so a stored one would walk
     straight past it and hand the reader the address the rewrite exists to
     prevent. There is no writer for this parameter any more either, so what is
     left in a browser's memory of it is a state nobody can re-create on
     purpose. A *link* carrying `?text=0` is still honoured, on arrival, once. */
  "text",
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
     results. A search *washes* the passages that match, so replaying last
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
 */
const NEEDS_AN_EXPLICIT_PRESS = new Set(["chat", "diagram", "remember"]);

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
 * comes out is byte-for-byte what the app wrote — `?cols=0,1,2` stays itself
 * rather than being reserialised to `?cols=0%2C1%2C2`. Same reason router.ts's
 * rewrites are textual.
 *
 * **Three modes are remembered as no mode at all** —
 * `NEEDS_AN_EXPLICIT_PRESS` above. Every other mode is put back as it stands,
 * and a *link* that names any of the three is untouched: this is only about
 * what we replay unasked.
 */
export function rememberableSearch(search: string): string {
  const kept = pairs(search).filter((p) => {
    const key = pairKey(p);
    if (!REMEMBERED.includes(key as (typeof REMEMBERED)[number])) return false;
    return !(key === "mode" && NEEDS_AN_EXPLICIT_PRESS.has(pairValue(p)));
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
     past the boot-time rewrite that exists to get a reader out of exactly that
     state (router.ts § `liftStrandedText`). The passive save that cleans the
     storage up happens too late to help the address they are already looking at.

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
 * What this browser last saw of that article, or `null`.
 *
 * Wrapped, and not only against an empty value: `localStorage` **throws** in
 * Safari's private mode and wherever site data is blocked, and in vitest's node
 * environment the global is Node's own and reads `undefined`. A convenience is
 * never worth taking a page down for, so a failure here means the reader gets
 * the top of the article, which is what they got before this file existed.
 */
export function readLastView(slug: string): string | null {
  try {
    return window.localStorage.getItem(KEY_PREFIX + slug);
  } catch {
    return null;
  }
}

/**
 * Remember this article's view, or forget it when there is nothing to keep.
 *
 * **Forgetting on empty is the point, not tidiness.** A reader who scrolls back
 * to the top of a plain article has a query string with nothing in it, and that
 * *is* their last view: leaving a stale `?at=` behind would send them back down
 * the page next time in spite of what they just did.
 *
 * One key per slug, and no index and no pruning — deliberately. An entry is a
 * few dozen bytes against a quota of about five megabytes, so it would take
 * tens of thousands of articles to matter, and `QuotaExceededError` is caught
 * here like every other failure. Read-modify-writing a bounded index on a path
 * that runs while the reader is scrolling would cost more than it saves.
 */
export function writeLastView(slug: string, search: string): void {
  try {
    if (search === "") window.localStorage.removeItem(KEY_PREFIX + slug);
    else window.localStorage.setItem(KEY_PREFIX + slug, search);
  } catch {
    /* See `readLastView`. The view simply will not survive being closed. */
  }
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
  useLayoutEffect(() => {
    if (restoredFor.current === slug) return;
    restoredFor.current = slug;
    const href = restoredHref(location.pathname, location.search, readLastView(slug));
    if (href === null) return;
    /* `replaceState`, not `pushState`: the bare address is a spelling the reader
       arrived in rather than a page they visited, so Back belongs to whatever
       they came from. The same call every rewrite in main.tsx makes. Both nuqs
       and router.ts have this patched, so every `useQueryState` below sees the
       new query string without being told. */
    history.replaceState(history.state, "", href);
  }, [slug]);

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
