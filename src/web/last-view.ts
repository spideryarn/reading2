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
 * The whole feature: copy the query string into `localStorage` under the reader
 * and the slug as the reader moves, and put it back when that reader opens that
 * article at a bare address. No server, no schema, no sync, and per-device by
 * construction, which is what Greg said was fine.
 *
 * ## Per device, and per reader
 *
 * Since 2026-10-06 the key names who was reading (§ `lastViewKey`). Two readers
 * can share one browser profile, and both can open the same slug when the
 * article is public; with the slug alone in the key, the second was put where
 * the first had been reading, in the first's mode. A place is the reader's, so
 * the key says whose it is, and signing out clears nothing: the reader may come
 * back. docs/project/auth.md § Browser storage that is a reader's is keyed by
 * that reader;
 * docs/plans/261006h-browser-storage-keyed-by-reader-and-the-feedback-switch-test.md.
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
 * all** for the slug opens in a band where one fits beside the prose — the
 * guide since 2026-10-07, Summary before that — with Marginalia's notes too
 * where those fit. It is the same decision with one more case, and the same rule: the
 * link always wins. So that "no key" means *never opened by this reader in this browser*, an
 * empty view is now stored as `""` rather than removed, and a storage that
 * cannot be read or written means no default rather than one on every visit.
 * A visit on a window too narrow for a band writes the key like any other and
 * so uses the first open up; a visit signed out writes nobody's key, and uses
 * up nobody's but its own. § The first-open default, below. A bare metadata visit does not claim that first article open.
 *
 * The reasoning, the deferred pieces and the questions nobody was there to
 * answer are in
 * docs/plans/260905d-remember-where-you-were-in-an-article-and-move-the-design-link-into-admin.md.
 */
import { useEffect, useLayoutEffect, useRef } from "react";

import { type ArticleView, liftedLegacySearch, onAddressChange, parseRoute } from "./router.js";
import { type BandMode, isMarginaliaModeWord, modeFromParam } from "../modes.js";
import { bandCoversProse } from "./layout.js";
import { notesFit } from "./marginalia/press.js";
import { storageReader } from "./lib/storage-reader.js";
import { rootFontPx, usableWidth } from "./reader/measure.js";
import { peekAskPurpose } from "./ask-purpose.js";
import { firstOpenHeld, GUIDE_FIRST_OPEN, holdFirstOpen, releaseWhenDecided } from "./first-open-purpose.js";

/**
 * The parameters worth putting back. Most only draw a view on arrival;
 * `margin=1` also makes missing relation words when the owner's column fits
 * on screen (useRelations.ts). The modes whose restoration would start
 * other work are excluded by `NEEDS_AN_EXPLICIT_PRESS` below.
 *
 * The vocabulary is params.ts; `tests/last-view.test.ts` scans the tree for
 * `useQueryState` keys and fails if one is in neither this list nor the one
 * below, so a thirty-sixth parameter is a decision rather than an omission.
 */
export const REMEMBERED = [
  "at", // the section you were reading
  "spine", // the bird's-eye rail
  "mode", // which mode owns the band — bar three; NEEDS_AN_EXPLICIT_PRESS
  "margin", // Marginalia's column of notes, right of the prose — a restore makes its relation words if there are none (useRelations.ts)
  "summary", // brief, fuller or thread — dormant without `mode`, and a restore never opens the thread
  "structure", // fisheye or expanded — nothing to generate either way
  "diagram", // which of the five pictures
  "dx", // drift's sideways axis
  "dhue", // what a dot's colour means
  "referee", // which referee sub-mode
  "crits", // which criteria are selected
  "refscale", // which diverging ramp
  "learn", // recall, tutorial, explore or quiz — `remember` until 2026-10-06, now in NEVER_REMEMBERED
  "sort", // glossary order
  "gate", // glossary threshold
  "rank", // quotes order
  "bar", // quotes threshold
  "peer-review", // bibliography, reception or claims — a restore draws what is stored; only a press makes anything
  "debateby", // reception's order
  "bears", // claims' relevance threshold
  "debatethread", // which of debate's threads narrows its list
  "chatfrom", // which source Chat's list of conversations is narrowed to
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
  /* "Open the guide", which Chat turns into `thread=<the guide's id>` the
     moment its list answers (params.ts § `guideParam`): an instruction, not a
     place, and gone from the address before anything could remember it. */
  "guide",
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
  /* **Learn's sub-mode key until 2026-10-06**, when it became `learn` above
     (docs/plans/261006a-remember-identifiers-become-learn-all-the-way-down.md).
     Nothing reads it now: an old `/read/x?remember=quiz` opens Learn at Recall,
     and a browser still holding the pair has it dropped on the way out. Listed
     for `deep`'s reason: left out of both lists, that old link reads as a bare
     address, and the stored view (or the first-open default) is put over a
     link somebody had just opened. GPT Sol's plan review of 261006a, PR-2. */
  "remember",
  /* **Debate's sub-mode key until 2026-10-09**, when Debate became Peer
     review's Reception and Claims and the key became `peer-review` above
     (docs/plans/261009l-peer-review-mode-merges-citations-and-debate.md).
     An old `?mode=debate&debate=claims` is lifted to the new words before
     anything reads it, on arrival and on restore (router.ts §
     `liftLegacyPeerReview`); anywhere else the pair is read by nothing.
     Listed for `deep`'s reason. */
  "debate",
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
 * - **`learn`** — `LearnBand` mounts the same `ConversationBand` chat
 *   does, and its arrival effect calls `startNew()`, which opens a conversation,
 *   focuses the composer and writes a `?thread=`.
 * - **`chat`** — the same conversation-on-arrival, and this one costs nothing:
 *   `begin` in useChat.ts is client-side until the reader sends something. It is
 *   dropped on judgment rather than on cost, because a conversation panel that
 *   opens by itself reads as the app *starting* something.
 *
 * **`?diagram=`, `?dx=`, `?dhue=` and `?learn=` stay in `REMEMBERED`.** They
 * are subordinate to a mode nobody is now in, so they draw nothing and fetch
 * nothing — and pressing Diagram or Learn later returns the reader to the
 * picture or the half they had chosen, which is most of what they wanted.
 *
 * `tweets` was the fourth, from 2026-09-29 to 2026-10-03. The thread is one of
 * Summary's views now, so its rule is a condition on a pair of parameters
 * rather than a mode word: § `opensTheThread` below.
 *
 * **Asked of the mode a word means, not of the word** (`needsAnExplicitPress`).
 * `learn` was `remember` until 2026-10-06 and `?mode=remember` still opens it
 * (src/modes.ts § `RETIRED_MODES`), so a set of raw words would let the old
 * spelling through: stored, and replayed into a conversation nobody asked
 * for. Going through `modeFromParam` closes that for every retired word at
 * once. docs/plans/261006a-remember-identifiers-become-learn-all-the-way-down.md.
 */
const NEEDS_AN_EXPLICIT_PRESS: ReadonlySet<BandMode> = new Set(["chat", "diagram", "learn"]);

function needsAnExplicitPress(modeWord: string): boolean {
  const mode = modeFromParam(modeWord);
  return mode !== null && NEEDS_AN_EXPLICIT_PRESS.has(mode);
}

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

/**
 * **Where one reader's last view of one article is kept**:
 * `spya.lastViewFor.<reader>.<slug>`, one key per reader and slug (see
 * `writeLastView`). The reader is their id, or `signed-out` for nobody
 * (`storageReader`), and neither has a dot in it, so the slug is whatever
 * follows the second one.
 *
 * **A new prefix rather than a longer old one**, so a key written before
 * 2026-10-06 can never be read as a new one.
 */
const KEY_PREFIX = "spya.lastViewFor.";

export function lastViewKey(slug: string, readerId: string | null): string {
  return `${KEY_PREFIX}${storageReader(readerId)}.${slug}`;
}

/**
 * **The key every browser wrote until 2026-10-06**: `spya.lastView.<slug>`,
 * with no reader in it. Read once more, by `readLastView`, and then removed.
 */
const LEGACY_KEY_PREFIX = "spya.lastView.";

export function legacyLastViewKey(slug: string): string {
  return LEGACY_KEY_PREFIX + slug;
}

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
    return !(key === "mode" && (thread || needsAnExplicitPress(pairValue(p))));
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
  /* **And lifted, as an arrival is.** A browser that remembered
     `?mode=debate&debate=claims` before 2026-10-09 would otherwise restore it
     after boot's `settleAddress` had run, and `RETIRED_MODES` would open Peer
     review at Bibliography instead of Claims (GPT Sol's F1 on plan 261009l). */
  const keep = rememberableSearch(liftedLegacySearch(remembered));
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
type StorageSource = () => Pick<Storage, "getItem" | "setItem" | "removeItem">;
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
 * What this reader last saw of that article, in this browser.
 *
 * Wrapped, and not only against an empty value: `localStorage` **throws** in
 * Safari's private mode and wherever site data is blocked. A convenience is
 * never worth taking a page down for, so a failure here means the reader gets
 * the top of the article, which is what they got before this file existed.
 *
 * **A legacy key is adopted once, by the first signed-in reader with no entry
 * of their own, and then removed.** Dropping the old keys instead would be less
 * code and would cost every reader their place in every article on the day of
 * the deploy, and more than that: no key is how `claimFirstOpen` knows a first
 * open, so each article they had ever opened would reopen at the first-open
 * default. Adoption keeps both for the ordinary browser one reader uses. Where
 * two share one, the first to open a slug afterwards inherits whatever was
 * last written there, once: the old behaviour one last time.
 *
 * - **Nobody adopts while signed out.** A reader whose session has lapsed
 *   opens their own article signed out before signing back in, and that visit
 *   would use the key up for an identity that has nothing to restore it to.
 * - **Two tabs can both adopt it**, if both read it before either removes it.
 *   Accepted, not serialised: it is the same one-time inheritance, and a lock
 *   in `localStorage` is more machinery than the case is worth (GPT Sol, plan
 *   261006h, F4).
 * - **A storage that reads and will not write still answers.** The legacy
 *   value is returned and left where it is.
 */
export function readLastView(
  slug: string,
  readerId: string | null,
  storage: StorageSource = browserStorage,
): StoredView {
  try {
    const store = storage();
    const search = store.getItem(lastViewKey(slug, readerId));
    if (search !== null) return { kind: "stored", search };
    if (readerId === null) return { kind: "none" };
    const legacy = store.getItem(legacyLastViewKey(slug));
    if (legacy === null) return { kind: "none" };
    try {
      store.setItem(lastViewKey(slug, readerId), legacy);
      store.removeItem(legacyLastViewKey(slug));
    } catch {
      /* Not moved. It is still this reader's to restore from, this once. */
    }
    return { kind: "stored", search: legacy };
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
 * One key per reader and slug, and no index and no pruning — deliberately. An entry is a
 * few dozen bytes against a quota of about five megabytes, so it would take
 * tens of thousands of articles to matter, and `QuotaExceededError` is caught
 * here like every other failure. Read-modify-writing a bounded index on a path
 * that runs while the reader is scrolling would cost more than it saves.
 */
export function writeLastView(
  slug: string,
  readerId: string | null,
  search: string,
  storage: StorageSource = browserStorage,
): boolean {
  try {
    storage().setItem(lastViewKey(slug, readerId), search);
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
 * And Greg, 2026-10-07, on whether the guide should replace Summary as that
 * band (q-kgrhm4): *"yes. but perhaps with a fixed starting message?"* — so
 * the band is the guide, whose greeting is ours and free (GuideGreeting.tsx),
 * plan docs/plans/261007p-the-guide-acts-without-a-press-and-opens-every-new-article.md.
 *
 * One more case in the same decision: a bare address **and no key for this
 * slug** arrives at a default instead of at the article alone. Three pure
 * functions, one per question, and the effect in `useLastView` that asks them.
 * docs/plans/261005a-no-home-icon-beside-the-logo-and-a-first-open-default-of-summary-and-marginalia.md.
 *
 * **"First open" means this reader's first open in this browser**, because the
 * key is the only memory there is, and it is theirs (§ `lastViewKey`). So an
 * article read on another device gets the default once here; and since the
 * save in `useLastView` writes the key on every open, a visit on a window too
 * narrow for a band counts as having opened it — the default is not held over
 * for a wider window. **A signed-out visit no longer counts against the reader
 * who then signs in** (2026-10-06): it is recorded for nobody, and the reader's
 * own first open is still to come.
 *
 * **The add page's mark holds it** (since 2026-10-07, plan 261007j F4): while
 * the mark names this slug, the arrival is applied without waiting for the
 * settings store, and the owner's purpose read decides only whether the
 * "Why are you reading this?" modal shows — never where a band already shows
 * the guide's box. first-open-purpose.ts is that one decision.
 */

/**
 * **What the default is, for a window this wide** — `""` for the article alone.
 *
 * Asked of the two functions the reading view itself uses, so the default can
 * never name a column the layout would then decline to draw: `bandCoversProse`
 * (a band would lie over the prose — below 700px with the rail) and `notesFit`
 * beside Summary's `roomy` band (from 900px). The widths are theirs; the tests
 * sit either side of each.
 *
 * **Not a question for the experimental switch since 2026-10-05**, when
 * Marginalia left it (spya-vv54j2); until then a third argument kept the notes
 * out for a reader whose switch was off.
 * docs/plans/261005d-marginalia-out-of-the-experimental-switch.md.
 *
 * `?mode=chat&guide=1` starts nothing on arrival: Chat turns `guide=1` into
 * the stored guide or an empty one, and the guide's greeting is drawn, not
 * asked for (GuideGreeting.tsx), so the reader's first message is its first
 * model call. **`?margin=1` does start something, on purpose, since
 * 2026-10-05**: the column asks for its relation words when it is shown, and
 * this default is the case Greg's decision was made for (useRelations.ts) —
 * one call, once per article, for its owner.
 */
export function firstOpenSearch(windowWidth: number, rootFontPx: number): string {
  if (bandCoversProse(windowWidth)) return "";
  /* Measured beside Summary's `roomy` band, as it was when Summary was the
     default, though the guide opens Chat's standard one: the marginalia
     admission in layout.ts § `fitBoth` happens before `bandWidth` sees the
     shape, so `.both` is the same for the two (plan 261007j F4). */
  const notes = notesFit({ windowWidth, bandShape: "roomy", rootFontPx }, true).both;
  return notes ? `${GUIDE_FIRST_OPEN}&margin=1` : GUIDE_FIRST_OPEN;
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
  readerId: string | null,
  search: string,
  stored: StoredView,
  storage: StorageSource = browserStorage,
): boolean {
  if (stored.kind !== "none") return false;
  if (hasArticleState(search)) return false;
  return writeLastView(slug, readerId, "", storage);
}

/**
 * **The query string with every article parameter taken off it**: what is
 * left is whatever was not ours (`?key=`, a `?utm_source=`), as text, in order.
 *
 * For one caller: `useLastView`, when the reader changes under an article that
 * is still on screen. § A change of reader, there.
 */
export function withoutArticleState(search: string): string {
  const kept = pairs(search).filter((p) => !ARTICLE_PARAMS.includes(pairKey(p)));
  return kept.length > 0 ? `?${kept.join("&")}` : "";
}

/**
 * **The address a claimed first open arrives at, or `null` to leave it.**
 * Asked after the claim — so everything that could have changed in that
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
 * Both halves, wired in `App` above its auth branches. A null slug means
 * no article is on screen: advance the reader identity without reading,
 * claiming or saving an article's view. This also covers client navigation;
 * boot-time rewrites in main.tsx alone cannot do that.
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
 * of `App` on each of those would re-render the whole article.
 *
 * ## A change of reader, with the article still on screen
 *
 * `readerId` comes from `App`'s current session, **not `useMadeFor()`**,
 * whose answer is frozen at mount. The hook must outlive both signed-in
 * account changes and sign-out/sign-in: `ArticlePage` remounts across the
 * auth branches, but the old reader's address stays in this tab. Keeping
 * the arrival ref inside that page loses the very identity needed to strip
 * the old view. tests/last-view-app-reader-change.test.tsx exercises the
 * real App boundary; plan 261006h code review C1.
 *
 * At that moment the address is A's view: A's section, A's mode, perhaps the
 * `?note=` or `?thread=` A had open. B did not open that link. So **the change
 * is an arrival for B at a bare address**: the article's parameters are taken
 * off (`withoutArticleState`), and then the ordinary decision runs as B, which
 * puts B's own stored view back or claims B's first open. The alternative,
 * leaving the address alone, shows B where A was and then saves it under B's
 * key as if B had chosen it. Everything below the gate is being fetched again
 * for B at the same moment, so nothing B was looking at is lost.
 *
 * And A's listener is still subscribed while that rewrite is made, because a
 * layout effect runs before the previous render's passive cleanup. It checks
 * `arrivedFor` for exactly that, or the bare address would be saved over A's
 * place on A's way out.
 */
export function useLastView(slug: string | null, view: ArticleView, readerId: string | null): void {
  /* One decision per slug/view/reader arrival, including StrictMode replay. A
     view change can claim a first article open after metadata, but only a new
     slug or a new reader restores a saved view. */
  const arrivedFor = useRef<{ slug: string | null; view: ArticleView; readerId: string | null } | null>(null);
  /* The slug and reader whose first open has been claimed and whose default
     is still to be applied — see the second effect. */
  const firstOpenFor = useRef<{ slug: string; readerId: string | null } | null>(null);
  useLayoutEffect(() => {
    const before = arrivedFor.current;
    if (before?.slug === slug && before.view === view && before.readerId === readerId) return;
    const newReader = before !== null && before.readerId !== readerId;
    const restore = before?.slug !== slug || newReader;
    arrivedFor.current = { slug, view, readerId };
    if (slug === null) {
      firstOpenFor.current = null;
      holdFirstOpen(null);
      return;
    }
    /* § A change of reader, above. Only while the address still names this
       article: one that has moved on is somewhere somebody chose to go. */
    const route = parseRoute(location.pathname);
    const leftBehind = newReader && before.slug === slug && route.kind === "read" && route.slug === slug;
    const search = leftBehind ? withoutArticleState(location.search) : location.search;
    const stored = readLastView(slug, readerId);
    /* The same one read answers both questions: something to put back, or a
       first open. They cannot both be yes — one needs a key and the other
       needs there to be none. */
    firstOpenFor.current =
      view === "article" && claimFirstOpen(slug, readerId, search, stored) ? { slug, readerId } : null;
    /* **The add page's mark holds this arrival's decision**, so it can apply
       the guide immediately and let the purpose read decide only the modal
       (first-open-purpose.ts, plan 261007p). Measured here, at the claim, so
       `PurposePrompt` can know whether a band fits before the settings store
       has answered. Every arrival holds afresh or drops the hold. */
    holdFirstOpen(
      firstOpenFor.current !== null && peekAskPurpose(slug)
        ? { slug, readerId, ordinary: firstOpenSearch(usableWidth(), rootFontPx()) }
        : null,
    );
    /* A view change keeps the old restoration rule: only a new slug (or a new
       reader) restores. But metadata must not claim the reading view's first
       arrival. */
    const restored = restore
      ? restoredHref(location.pathname, search, stored.kind === "stored" ? stored.search : null)
      : null;
    const href = restored ?? (search === location.search ? null : location.pathname + search);
    if (href === null) return;
    /* `replaceState`, not `pushState`: the bare address is a spelling the reader
       arrived in rather than a page they visited, so Back belongs to whatever
       they came from. The same call every rewrite in main.tsx makes. Both nuqs
       and router.ts have this patched, so every `useQueryState` below sees the
       new query string without being told. */
    history.replaceState(history.state, "", href);
  }, [slug, view, readerId]);

  /* **The first-open default.** Applied as soon as it is claimed, on both
     paths; neither waits on the settings store. Until 2026-10-08 the ordinary
     (unmarked) path waited for that store's `loaded`, because it took
     `signedIn` from there — so a settings read that failed, or served an
     offline copy, left the arrival in Plain for good (CR3 of
     docs/plans/261007p-code-review-sol.md). Nothing about the default depends
     on the switch since 2026-10-05 (plan 261005d), and `App` hands this hook a
     null slug until the session is known, so `readerId` already answers
     signed-in status.

     **A marked first open** registers its release with the add page's
     coordinator instead (first-open-purpose.ts, plan 261007p), which applies
     it without waiting for the purpose outcome.

     **Measured here, once**, with the reader's own two measurements
     (reader/measure.ts): a resize afterwards moves the layout and never
     reapplies this. The reader id is also what keeps a default claimed for
     one reader from being applied for the next. Declared after the claim so
     it sees this render's claim. */
  useLayoutEffect(() => {
    const claimed = firstOpenFor.current;
    if (slug === null || view !== "article" || claimed?.slug !== slug || claimed.readerId !== readerId) return;
    firstOpenFor.current = null;
    const apply = (firstOpen: string) => {
      const href = firstOpenHref(slug, location.pathname, location.search, { signedIn: readerId !== null }, firstOpen);
      if (href !== null) history.replaceState(history.state, "", href);
    };
    /* `firstOpenHref` still checks that the address names this arrival and
       carries no explicit article state. */
    if (firstOpenHeld(slug, readerId)) releaseWhenDecided(slug, readerId, apply);
    else apply(firstOpenSearch(usableWidth(), rootFontPx()));
  }, [slug, view, readerId]);

  useEffect(() => {
    if (slug === null) return;
    const save = () => {
      /* **Which article the address currently names, not which one this
         component was rendered for.** `navigate()` writes the new address
         synchronously and fires its event before React re-renders, so on the
         way *out* of an article this listener runs one last time with the
         address of wherever the reader has just gone. Without this guard that
         last call would write the shelf's query string — or another article's —
         under this slug. The view must match too: an old metadata listener
         must not write the article's marker before its arrival effect runs. */
      const route = parseRoute(location.pathname);
      if (route.kind !== "read" || route.slug !== slug || route.view !== view) return;
      /* **And the reader this listener was made for is still the one who
         arrived.** The pathname cannot say that. § A change of reader. */
      if (arrivedFor.current?.readerId !== readerId) return;
      const search = rememberableSearch(location.search);
      /* A bare metadata visit is not an open of the prose. Keep its missing
         key missing; existing views and explicit article state still save. */
      if (route.view === "metadata" && search === "" && readLastView(slug, readerId).kind !== "stored") return;
      writeLastView(slug, readerId, search);
    };
    // The state we arrived with counts: a shared link's `?at=` is where this
    // reader was, from the moment they opened it.
    save();
    return onAddressChange(save);
  }, [slug, view, readerId]);
}
