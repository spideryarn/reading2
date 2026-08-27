import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { enableHistorySync, NuqsAdapter } from "nuqs/adapters/react";
import { LucideProvider } from "lucide-react";
import { App } from "./App.js";
import { CALLBACK_HREF, canonicalAddHref, parseRoute, readHref } from "./router.js";
import { isSpideryarnId } from "../ids.js";
import { startPerf } from "./perf.js";
import { watchConnection } from "./offline.js";
import { OfflineStrip } from "./OfflineStrip.js";
// The entry stylesheet, and the ONLY one imported here. It pulls in
// styles.css inside `@layer app` — importing the two side by side would
// leave styles.css unlayered, where it silently outranks every Tailwind
// utility. See the header of tailwind.css.
import "./tailwind.css";

/**
 * The browser must not try to restore scroll itself.
 *
 * By default it remembers a pixel offset across reload and back/forward and
 * reapplies it — which here is both wrong and late. Wrong, because the offset
 * was measured against whichever granularity columns happened to be open, and
 * every row changes height when those change. Late, because it lands after our
 * own restore and so wins, producing a visible jump to the wrong place. The URL
 * is the only thing that knows where the reader was; let it be the only thing
 * that decides. See src/web/position.ts.
 */
history.scrollRestoration = "manual";

/**
 * Count what the page does when nobody is asking it to — but only if asked.
 *
 * **First, and before React exists.** The probe patches `setTimeout`, `fetch`
 * and `requestAnimationFrame`, and anything that captured one of those before
 * the patch goes on calling the original and is invisible for the life of the
 * page. Modules run in import order, so a poller that grabs `setTimeout` at
 * module scope would already have escaped by the time an effect ran.
 *
 * Off unless `?perf=1` or `localStorage["spya-perf"]`, in which case this is a
 * function call that returns. See src/web/perf.ts.
 */
startPerf();

/**
 * Let nuqs see the history writes it did not make. **This is opt-in, and
 * without it router.ts's whole argument was false.**
 *
 * The claim in router.ts — that nuqs patches `history.pushState`, so our own
 * `navigate()` is indistinguishable from nuqs's own writes — is only true once
 * something calls this. Nothing did. `NuqsAdapter` does not patch history
 * itself, and the react adapter's `subscribe` listens to exactly two things:
 * nuqs's internal emitter and `popstate` (nuqs/dist/adapters/react.js). Our
 * `spideryarn:navigated` event is not one of them, so every `useQueryState` went
 * on serving the *previous* page's search until a popstate or a nuqs-initiated
 * write happened to wake it.
 *
 * Two things this buys, and the second is the one that bites:
 *
 *  - **Navigations are seen.** `patchHistory` wraps push/replaceState and, for
 *    any call not carrying nuqs's own `"__nuqs__"` marker — i.e. every call
 *    ours makes — emits to the same module-level emitter `subscribe` reads.
 *  - **Pending writes are cancelled.** It also calls `spinQueueResetMutex()`,
 *    which aborts the debounce queue. `?at=` is debounced by 300ms
 *    (params.ts), and nothing cancelled that queue when the reading view
 *    unmounted — so a scroll position could flush onto the URL of the page you
 *    had just navigated to.
 *
 * **The docstring on `enableHistorySync` will talk you out of this.** It says
 * it is for "syncing shallow updates of the URL with the
 * useOptimisticSearchParams hook", which we do not use. That describes one use,
 * not the mechanism: the emitter it patches is the same one every
 * `useQueryState` in this app subscribes to.
 *
 * Called here, above all four rewrites below, so there is never a window in
 * which a history write is invisible. Patching is idempotent per adapter.
 */
enableHistorySync();

/**
 * `/add/<a whole URL>` and `/?add=<a whole URL>` become `/add/<encoded>`.
 *
 * > Add a url that I can use to add something directly, e.g.
 * > `/add/[my-full-url-here]` or `/?add=[my-full-url-here]` or similar
 * >
 * > — Greg, 2026-08-26
 *
 * Both, because both are things a person types, and neither is a spelling React
 * should have to know about. Fourth rewrite in this file and the same shape as
 * the other three: recognise every entrance, leave by one door.
 *
 * **First, though, and that is not tidiness — it is three bugs.** The three
 * rewrites below all read `location.search` and `location.hash`, and on a raw
 * `/add/…` address those belong to the *pasted* URL rather than to us. Running
 * them first meant (GPT Sol's review, 2026-08-26):
 *
 *  - `/add/https://x.test/a?slug=story` became `/read/story`. Nothing was
 *    queued at all; the reader was sent to an article that may not exist.
 *  - `/add/https://x.test/a?about=1` queued `https://x.test/a` — the query
 *    string stripped, so a different page.
 *  - `/add/https://x.test/a#spya-k6fpme` queued `https://x.test/a?at=spya-k6fpme`,
 *    turning a fragment that never reaches a server into a real query parameter.
 *
 * Canonicalising first fixes all three at once rather than one at a time,
 * because what it leaves behind — `/add/<encoded>` with no query and no hash —
 * is an address none of the three can match.
 *
 * **The decision itself is `canonicalAddHref` in router.ts**, not here. This
 * file is module-init side effects, which nothing can test; that function is
 * pure and is tested, which is the difference between the three bugs above
 * being caught by a reviewer and being caught by `npm test`.
 *
 * `replaceState`, as with the others: the address you typed is a spelling, not
 * a page you visited, and pressing Back should not offer to re-add anything.
 */
/**
 * **`/auth/callback` is exempt from every rewrite in this file, and it goes
 * first.** Not tidiness — a security property.
 *
 * Google returns the reader to this address with a one-time `?code=` and a
 * `state` on it. `canonicalAddHref` below reads `location.search` as *part of
 * an article's address*: that is its whole job, and it is why
 * `/add/https://x.test/a?about=1` correctly queues a URL with `?about=1` on
 * it. So a return landing on any `/add/…` spelling would fold our
 * authorisation code into a stranger's URL, which the ingest pipeline then
 * fetches — putting a live auth code in someone else's access log.
 *
 * The window is real rather than theoretical: this file imports `App` at module
 * scope, so the Supabase client reads `window.location.href` before any line
 * below runs. It can therefore exchange the code *successfully* while a rewrite
 * leaves a copy of it encoded in an article address. It works, and it leaks.
 *
 * GPT Sol, 2026-08-26. The path is `CALLBACK_HREF` from router.ts rather than a
 * string here, because two spellings of it is exactly how this comes back.
 *
 * **All four rewrites are guarded, not just the one that can bite.** Only the
 * `/add/` one is reachable from a real callback — the other three need a
 * `#spya-…`, a `?slug=`, or an `about=`, and Google sends none of those. But
 * "this one is unreachable" is a judgement that has to be re-made every time
 * somebody adds a rewrite, and the person adding the fifth will not read this
 * paragraph. One flag, checked four times, is a rule instead.
 */
const onCallback = new RegExp(`^${CALLBACK_HREF}/?$`).test(location.pathname);

if (!onCallback) {
  const canonicalAdd = canonicalAddHref(location.pathname, location.search, location.hash);
  if (canonicalAdd) history.replaceState(history.state, "", canonicalAdd);
}

/**
 * Deep links used to be `/#spya-k6fpme`; position now lives in `?at=`.
 *
 * Rewritten before React mounts, for the same reason the hash was abandoned:
 * blocks carry their id in the HTML, so left in place the browser would scroll
 * to the block on its own, and then our restore would scroll again to offset it
 * under the sticky bars. Old links keep working; they just arrive in the new
 * spelling.
 *
 * **The hash beats an `?at=` that came with it**, which it did not until GPT
 * Sol's review on 2026-08-26. The article's own internal links are `#spya-…`
 * now (src/web/internal-links.ts), so ⌘-clicking one opens
 * `?at=<where you were>#<where you asked to go>` — two positions in one
 * address, and keeping the parameter meant the new tab opened at the paragraph
 * you had *left*. Nothing about that looks like a bug from the outside; the tab
 * opens, the article is there, and it is simply in the wrong place.
 *
 * The two are not equal claims. `?at=` is where the reader happened to be, put
 * there by scrolling; a fragment is somewhere they asked to go. Reading it as
 * the more recent of the two is right whichever way the link was made.
 */
const legacyAnchor = decodeURIComponent(location.hash.slice(1));
if (!onCallback && isSpideryarnId(legacyAnchor)) {
  const url = new URL(location.href);
  url.hash = "";
  url.searchParams.set("at", legacyAnchor);
  history.replaceState(history.state, "", url);
}

/**
 * Which article used to be `/?slug=…`; it is now `/read/<slug>`.
 *
 * Rewritten here, before React mounts, so nothing downstream has to know two
 * spellings — App reads the path and only the path (router.ts). `replaceState`
 * rather than `push`, because the old address is not somewhere the reader
 * should be able to press Back into; it isn't a page they visited, it's a
 * spelling they arrived in.
 *
 * Every other parameter is carried across untouched, so an old link that
 * pinned columns and a position still lands exactly where it said it would.
 *
 * "Untouched" is why the rest of the query string is edited as TEXT rather than
 * through `URLSearchParams`. Round-tripping it re-encodes as it serializes, and
 * `?cols=0,1` comes back out as `?cols=0%2C1` — still correct, still parsed the
 * same, and no longer readable. Those commas are spelled out on purpose so that
 * someone handed a link can see what it is going to show them (params.ts).
 */
const legacySlug = new URLSearchParams(location.search).get("slug");
if (!onCallback && legacySlug) {
  const rest = location.search
    .replace(/^\?/, "")
    .split("&")
    .filter((pair) => pair !== "" && !pair.startsWith("slug="))
    .join("&");
  history.replaceState(history.state, "", readHref(legacySlug, rest));
}

/**
 * The article's details have been in three places. They opened in the masthead
 * as `?about=1`, then became a drawer panel as `?panel=about`, and are now a
 * page of their own at `/read/<slug>/metadata`.
 *
 * **One pass, not one per spelling.** Two hops would put a superseded address
 * in the middle of a rewrite chain and leave whoever adds the fourth spelling
 * deciding which hop to bolt onto. So: recognise either spelling, strip *every*
 * `about=` and `panel=about` from the query, and send an article to its
 * metadata page. Third rewrite in this file and the same shape as the other
 * two — one spelling reaches React, and every old address keeps working. Done
 * as text rather than through `URLSearchParams` for the reason spelled out
 * above: a round trip re-encodes `?cols=0,1` into something still correct and
 * no longer readable.
 *
 * `about=0` is stripped but does **not** redirect. It meant the panel was shut,
 * and a shut panel is not a reason to send anybody to a different page — but it
 * is a dead parameter, and this file has been claiming since the drawer landed
 * that the new spelling for a shut panel is no parameter at all. It used to say
 * that and then leave the parameter sitting in the URL.
 *
 * Either spelling can also arrive with no article in the path — `/?about=1`,
 * from the days when the slug was a parameter too. There is no metadata page
 * for "no article", so that case strips and stays put. The rewrite above has
 * already turned `/?slug=x` into `/read/x`, so this only catches genuinely
 * article-less links.
 */
const aboutish = /(^|[?&])(about=[^&]*|panel=about)($|&)/.test(location.search);
if (!onCallback && aboutish) {
  const rest = location.search
    .replace(/^\?/, "")
    .split("&")
    .filter((pair) => pair !== "" && !/^about=/.test(pair) && pair !== "panel=about")
    .join("&");
  // Only the two spellings that meant "open", never `about=0`.
  const wantsPage = /(^|[?&])(about=1|panel=about)($|&)/.test(location.search);
  const route = parseRoute(location.pathname);
  const href =
    wantsPage && route.kind === "read"
      ? readHref(route.slug, rest, "metadata")
      : `${location.pathname}${rest ? `?${rest}` : ""}`;
  history.replaceState(history.state, "", `${href}${location.hash}`);
}

/**
 * Icon defaults for the whole app — see docs/project/icons.md.
 *
 * Set once here rather than at every call site, so the chrome stays one weight.
 * 16px against a 0.82rem UI face, and a stroke thinner than Lucide's default 2,
 * because on the dark ground a 2px stroke reads as bold: the icons are meant to
 * sit behind the prose, not compete with it.
 */
/**
 * Notice the moment the network interface goes away.
 *
 * Only the loss — coming back is decided by a request actually succeeding,
 * because `navigator.onLine` says `true` on a captive portal. See offline.ts.
 */
watchConnection();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <LucideProvider size={16} strokeWidth={1.75}>
      <NuqsAdapter>
        <App />
        {/* Outside `App`, which returns early down a dozen different paths —
            the sign-in screen and the landing page need to say this as much as
            the reading view does, and a reader who cannot reach the server is
            precisely the reader most likely to be looking at one of them. */}
        <OfflineStrip />
      </NuqsAdapter>
    </LucideProvider>
  </StrictMode>,
);
