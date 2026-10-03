/**
 * **The articles the reader opened most recently, fetched while they look at
 * the shelf**, so that opening one of them does not wait on the server.
 *
 * Report spya-j78fff, from Greg: back to the home page, click the article
 * again, *"it still takes a few seconds to load"*. Nearly all of those seconds
 * are `GET /api/article/<slug>` — a function, three queries and about 150KB —
 * and nothing was kept between visits. The plan, and what was passed over (a
 * stale-then-fresh repaint from the offline copy, HTTP caching, a service
 * worker), is docs/plans/261003d-preload-recent-shelf-articles.md.
 *
 * ## The rules that keep it from ever showing an old article
 *
 * - **One use.** A slot is deleted the moment its answer is handed over (a
 *   load abandoned before then leaves it for the next — see `takePreloaded`). Opening the same
 *   article again without passing the shelf fetches as it always did.
 * - **One draw.** The reading view draws the preloaded payload as its only
 *   first draw, exactly as if the server had just sent it — never a stale copy
 *   painted and then replaced, which is the visual artefact the report asked
 *   us not to make.
 * - **A short life**, `LIFE_MS`. A change this page cannot see — a pipeline run
 *   publishing, a rename in another tab — can be that old and no older; the
 *   same staleness as an article left open in a second tab.
 * - **No write since.** A slot fetched before a write was sent or finished is
 *   not used (writes.ts, which says which two writes are exempt and why).
 * - **The same reader.** Taken only by the reader whose credential actually
 *   fetched it (`apiFetchOwned`).
 * - **A real 200.** Not a 401, 404 or 409 — the reading view asks for itself
 *   and the error page says what it always said — and not the offline copy
 *   `apiFetch` serves when the network is gone, which also arrives as a 200.
 *
 * It goes through `apiFetch`, so the offline copy is refreshed on the way, and
 * the IndexedDB ticket order is untouched (each request reserves its own).
 */
import { apiFetchOwned, type Owned } from "./api.js";
import { writeCount } from "./writes.js";

/** How many of the most recently opened articles to keep ready. Greg's number. */
export const PRELOAD_COUNT = 5;

/**
 * How long a preloaded article may be handed over. The report's case is "back
 * to the shelf, then straight back in", which is seconds; sixty leaves room for
 * a look along the shelf first. GPT Sol suggested 15–30 and was overruled on
 * that ground — the plan doc says so.
 */
export const LIFE_MS = 60_000;

/**
 * A slot younger than this is not asked for again when the shelf re-renders
 * with the same articles, or the cached shelf is followed by the live one.
 * Older, and a visit to the shelf refreshes it — Greg's *"refresh them if they
 * have"*.
 */
export const REASK_MS = 15_000;

interface Slot {
  issuedAt: number;
  /** `writeCount()` when it went out. Any other value at handover: discarded. */
  writes: number;
  controller: AbortController;
  /** Never rejects. `null` is anything other than a fresh, real 200. */
  answer: Promise<Owned | null>;
  /** The signal of the load waiting on it, if any — see `takePreloaded`. */
  claim: AbortSignal | null;
}

const slots = new Map<string, Slot>();

/** Injected by tests; `Date.now` everywhere else. */
let now: () => number = Date.now;

/**
 * Make these the articles held, and only these.
 *
 * A slot for an article no longer in the list is dropped and its request
 * aborted. One that is still young and made under the current write count is
 * kept; anything else is asked for again.
 */
export function preloadArticles(slugs: readonly string[]): void {
  const wanted = new Set(slugs);
  for (const [slug, slot] of slots) {
    if (!wanted.has(slug)) drop(slug, slot);
  }
  for (const slug of wanted) {
    const held = slots.get(slug);
    if (held && now() - held.issuedAt < REASK_MS && held.writes === writeCount()) continue;
    if (held) drop(slug, held);
    slots.set(slug, issue(slug));
  }
}

/**
 * The preloaded answer for this article, **or `null`, in which case the caller
 * fetches as it always did**. Never throws.
 *
 * An answer still on its way is awaited: it is the same request the caller
 * would otherwise make, already under way.
 *
 * ## A load abandoned before it used the slot leaves it for the next one
 *
 * `signal` is the article load's. **The slot stays in the map while a load
 * waits on it**, marked with that load's signal, and leaves only when its
 * response is actually handed over. A later load may adopt a slot whose
 * claimant has aborted. Nothing aborts the request itself: it is not the
 * reader's to cancel, since it was going to be made whether or not they
 * clicked, and it still ends by the usual rules (used once, `LIFE_MS`, a
 * write, or the next shelf list).
 *
 * It took two attempts, and both were found in a real browser while every test
 * was green. `<StrictMode>` runs effect, cleanup, effect **synchronously**.
 * The first version took the slot out of the map and aborted it when the load
 * did. The second put it back on abort, but a microtask later, by which time
 * the second effect run had already looked and found nothing. Either way the
 * load the reader sees asked the server on every click, and the feature could
 * not be seen working in development.
 */
export async function takePreloaded(
  slug: string,
  readerId: string,
  signal: AbortSignal,
): Promise<Response | null> {
  const slot = slots.get(slug);
  if (!slot) return null;
  if (!current(slot)) {
    drop(slug, slot);
    return null;
  }
  /* Another load, still live, is waiting on this one: two views of the same
     article at once. It is theirs; this one asks for itself. */
  if (slot.claim && !slot.claim.aborted) return null;
  slot.claim = signal;
  const got = await untilAborted(slot.answer, signal);
  if (got === ABANDONED || signal.aborted) {
    if (slot.claim === signal) slot.claim = null;
    return null;
  }
  if (slots.get(slug) === slot) slots.delete(slug);
  /* Asked again after the wait, because a write can be sent while the answer is
     still arriving — and then the server may have answered from either side of
     it. */
  if (!got || got.owner !== readerId || !current(slot)) {
    if (got) discard(got.response);
    return null;
  }
  return got.response;
}

const ABANDONED = Symbol("abandoned");

/** `answer`, or `ABANDONED` as soon as `signal` aborts, whichever is first. */
function untilAborted<T>(answer: Promise<T>, signal: AbortSignal): Promise<T | typeof ABANDONED> {
  if (signal.aborted) return Promise.resolve(ABANDONED);
  return new Promise((settle) => {
    const abandon = () => settle(ABANDONED);
    signal.addEventListener("abort", abandon, { once: true });
    void answer.then((value) => {
      signal.removeEventListener("abort", abandon);
      settle(value);
    });
  });
}

function current(slot: Slot): boolean {
  return now() - slot.issuedAt < LIFE_MS && slot.writes === writeCount();
}

function issue(slug: string): Slot {
  const controller = new AbortController();
  const answer = apiFetchOwned(`/api/article/${encodeURIComponent(slug)}`, {
    signal: controller.signal,
  }).then(
    (got) => {
      if (realOk(got.response)) return got;
      discard(got.response);
      return null;
    },
    () => null,
  );
  return { issuedAt: now(), writes: writeCount(), controller, answer, claim: null };
}

function drop(slug: string, slot: Slot): void {
  slots.delete(slug);
  slot.controller.abort();
}

/**
 * A 200 the server sent. `apiFetch` answers a lost connection with the offline
 * copy as a synthetic 200 marked `x-spideryarn-offline: copy`, and a slot that
 * held one would be the stale article this module exists not to show. GPT Sol's
 * plan review.
 */
function realOk(res: Response): boolean {
  if (res.status !== 200) return false;
  try {
    return res.headers.get("x-spideryarn-offline") !== "copy";
  } catch {
    return false;
  }
}

function discard(res: Response): void {
  try {
    void res.body?.cancel().catch(() => {});
  } catch {
    /* Already read or locked: nothing to free. */
  }
}

/** For tests: forget every slot, and the clock. */
export function resetPreloads(clock: () => number = Date.now): void {
  for (const [slug, slot] of slots) drop(slug, slot);
  now = clock;
}

/** For tests: which articles are held. */
export function preloadedSlugs(): string[] {
  return [...slots.keys()];
}
