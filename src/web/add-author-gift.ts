/**
 * **For the author…, chosen while the article is being added** — the add
 * page's admin-only control, docs/plans/261009u-author-gift-draft-voucher-from-the-add-page.md
 * § D9 and § Revision 3, R2-F8. `AddAuthorGift.tsx` draws it.
 *
 * Confirmed (with the private link's rights tick), it ticks High-powered AI
 * through that box's own controller — the component does that — and *arms*
 * this intent. Nothing is sent while the import runs: the article has to be
 * on the shelf before `POST /api/admin/author-gifts` can make its link. The
 * request goes out **as the page leaves for the article**, from `send`, and
 * the page waits for it (about a second: the web search runs after the
 * response), then navigates on `go`, stays on `stay`, and does nothing on
 * `stale`.
 *
 *  - **Single-flight.** Two exits for the same article share one request,
 *    and a later one is answered from the outcome without asking again.
 *  - **It never rejects.** The request — token lookup included — runs inside
 *    the awaited call, so a throw before anything is sent is a *lost* answer
 *    like any other (Sol's F12).
 *  - **One reader's.** It lives in a registry `retireAddSharing` empties
 *    (add-sharing-session.ts). Retired, it forgets what it held, tells its
 *    page once, and an answer still in flight is drawn nowhere: `stale`.
 *  - **Not armed is not this file's business.** `engaged()` is false and the
 *    page leaves exactly as it always did, synchronously; `send` would answer
 *    `go` without a request, but the page does not ask.
 *
 * Framework-free, with the request injected, so a test drives every answer
 * (tests/add-author-gift.test.ts).
 */

import { statusOf } from "./lib/api.js";
import { type Retirable, readerRegistry } from "./add-sharing-session.js";
import { describeFetchFailure } from "./lib/describe-failure.js";

/** One state at a time: the question, the intent, the request, or its answer. */
export type AuthorGiftAtAdd =
  | { kind: "off" }
  /** The confirmation is open. Holds the page at completion, as the sharing confirmation does. */
  | { kind: "confirming"; rights: boolean }
  /** Confirmed; sent as the page leaves. */
  | { kind: "armed" }
  | { kind: "sending"; slug: string }
  /** `202` (a new gift, its lookup started) or `200` (one was already there). */
  | { kind: "made"; slug: string; created: boolean }
  /** The server answered no. */
  | { kind: "refused"; slug: string; message: string }
  /** No answer arrived: the gift may or may not have been made. */
  | { kind: "lost"; slug: string; message: string };

/** What the page does after the await: navigate, stay and say why, or nothing (it is not this page's any more). */
export type GiftExit = "go" | "stay" | "stale";

/** `POST /api/admin/author-gifts`; resolves on 2xx with `created`, throws with `.status` on a refusal. */
export type PostAuthorGift = (slug: string) => Promise<{ created: boolean }>;

export class AuthorGiftAtAddController implements Retirable {
  private state: AuthorGiftAtAdd = { kind: "off" };
  private inFlight: Promise<GiftExit> | null = null;
  private retired = false;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly post: PostAuthorGift) {}

  get = (): AuthorGiftAtAdd => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Armed or past it: the page's exit goes through `send`. */
  engaged(): boolean {
    const k = this.state.kind;
    return k !== "off" && k !== "confirming";
  }

  /** The confirmation is open: a completion waits rather than navigating out from under it. */
  unsettled(): boolean {
    return this.state.kind === "confirming";
  }

  open(): void {
    if (this.state.kind === "off") this.set({ kind: "confirming", rights: false });
  }

  tick(rights: boolean): void {
    if (this.state.kind === "confirming") this.set({ kind: "confirming", rights });
  }

  cancel(): void {
    if (this.state.kind === "confirming") this.set({ kind: "off" });
  }

  /** Arms, if the rights box is ticked. The caller ticks High-powered AI on `true`. */
  confirm(): boolean {
    if (this.state.kind !== "confirming" || !this.state.rights) return false;
    this.set({ kind: "armed" });
    return true;
  }

  /** Disarms, until the exit has started. */
  undo(): void {
    if (this.state.kind === "armed") this.set({ kind: "off" });
  }

  /** **The exit.** Never rejects. See the file's header for the three answers. */
  send(slug: string): Promise<GiftExit> {
    if (this.retired) return Promise.resolve("stale");
    const s = this.state;
    switch (s.kind) {
      case "off":
      case "confirming":
        return Promise.resolve("go");
      case "sending":
        if (this.inFlight === null) return Promise.resolve("stay");
        /* Another article (a Retry under another slug) waits for this one, then asks for itself. */
        return s.slug === slug ? this.inFlight : this.inFlight.then(() => this.send(slug));
      case "made":
        if (s.slug === slug) return Promise.resolve("go");
        break;
      case "refused":
      case "lost":
        if (s.slug === slug) return Promise.resolve("stay");
        break;
      case "armed":
        break;
      default: {
        const never: never = s;
        return never;
      }
    }
    this.set({ kind: "sending", slug });
    /* Kept after it settles: it is read only while the state is `sending`. */
    this.inFlight = (async (): Promise<GiftExit> => {
      try {
        const body = await this.post(slug);
        if (this.retired) return "stale";
        this.set({ kind: "made", slug, created: body.created });
        return "go";
      } catch (e) {
        if (this.retired) return "stale";
        /* Only server-authored and client-authored reader-facing sentences may
           reach the page. Browser and internal exception text is diagnostic,
           not copy (lib/describe-failure.ts). */
        const error = e instanceof Error ? e : new Error("the author-gift request threw a non-Error value");
        const message = describeFetchFailure(error);
        this.set(
          statusOf(e) === null ? { kind: "lost", slug, message } : { kind: "refused", slug, message },
        );
        return "stay";
      }
    })();
    return this.inFlight;
  }

  retire(): void {
    if (this.retired) return;
    this.state = { kind: "off" };
    for (const listener of this.listeners) listener();
    this.retired = true;
  }

  private set(next: AuthorGiftAtAdd): void {
    if (this.retired) return;
    this.state = next;
    for (const listener of this.listeners) listener();
  }
}

const gifts = readerRegistry<AuthorGiftAtAddController>();

/**
 * **The one controller for this reader and this add** — keyed by the page's
 * `wanted` (the normalised address, or the upload id), not the slug, because
 * it is armed before the import has one. Looking one up starts nothing.
 */
export function authorGiftAtAddFor(
  readerId: string | null,
  source: string,
  post: PostAuthorGift,
): AuthorGiftAtAddController {
  return gifts.for(readerId, source, () => new AuthorGiftAtAddController(post));
}
