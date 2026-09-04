import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { enableHistorySync, NuqsAdapter } from "nuqs/adapters/react";
import { LucideProvider } from "lucide-react";
import { App } from "./App.js";
import { CALLBACK_HREF, settleAddress, watchHistoryWrites } from "./router.js";
import { startPerf } from "./perf.js";
import { watchConnection } from "./offline.js";
import { watchUncaughtErrors } from "./log-buffer.js";
import { OfflineStrip } from "./OfflineStrip.js";
import { AppBoundary } from "./AppBoundary.js";
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
 * And let *us* see them too, which is a different question.
 *
 * `enableHistorySync` above tells nuqs about our writes. This tells the app
 * about nuqs's: `useAddressSearch` needs to hear every change to the query
 * string, and nuqs's own subscriptions are key-isolated, so nothing else does.
 * router.ts § `watchHistoryWrites` has the whole of why — the short version is
 * that 551 block permalinks are built from the query string inside a memoised
 * subtree, and without this they would quietly stop being refreshed.
 *
 * After `enableHistorySync`, so nuqs's wrapper is the inner one and ours sees
 * every call either way. Both run; the order only decides which is outermost.
 */
watchHistoryWrites();

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

/**
 * **All four rewrites, in one call, behind one guard.**
 *
 * They used to be four `replaceState`s in a row here — side effects at module
 * scope, which nothing can call. Each had tests of its own; the *sequence* had
 * none, and that is where the eighth divergence lived: the hash rewrite ran the
 * query through `URLSearchParams`, which reserialised `?%61bout=1` into
 * `?about=1`, and the metadata rewrite two steps later then fired on a parameter
 * the server had not seen. GPT Sol, 2026-08-30.
 *
 * `settleAddress` in router.ts is that sequence as a pure function, so the
 * interactions are testable and the server can be checked against it over a
 * cross-product of addresses (tests/address-settling.test.ts). It also means one
 * `onCallback` guard rather than four: a fifth rewrite added inside it is exempt
 * from the callback by construction, instead of by the person adding it
 * remembering to.
 */
if (!onCallback) {
  const settled = settleAddress(location.pathname, location.search, location.hash);
  if (settled !== null) history.replaceState(history.state, "", settled);
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

/**
 * Put the throws nobody caught into the client log buffer, so a bug report can
 * show them in order against the requests around them. Sentry already has the
 * throw itself, with its stack; this is the ordering, which it cannot show.
 * See log-buffer.ts § watchUncaughtErrors.
 */
watchUncaughtErrors();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <LucideProvider size={16} strokeWidth={1.75}>
      <NuqsAdapter>
        {/* Inside `NuqsAdapter` and `LucideProvider` so the fallback is drawn
            with the app's own chrome, and around `App` rather than inside it —
            `App` returns early down a dozen paths and a boundary inside one of
            them would miss the other eleven. `OfflineStrip` is left outside on
            purpose: a reader whose page has just broken is exactly the reader
            who still needs to be told the connection is down. */}
        <AppBoundary>
          <App />
        </AppBoundary>
        {/* Outside `App`, which returns early down a dozen different paths —
            the sign-in screen and the landing page need to say this as much as
            the reading view does, and a reader who cannot reach the server is
            precisely the reader most likely to be looking at one of them. */}
        <OfflineStrip />
      </NuqsAdapter>
    </LucideProvider>
  </StrictMode>,
);
