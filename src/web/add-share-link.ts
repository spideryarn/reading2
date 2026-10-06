/**
 * **A private link, made while the article is being added** — the add page's
 * other sharing control, beside *Make it public* (add-share.ts).
 * docs/plans/261005l-permalink-and-share-while-an-article-is-importing.md
 * § Stage 2, 2b. Greg, 2026-10-06, asked whether the add page should offer
 * one:
 *
 * > yeah ok, might as well include that. perhaps bundle all sharing-related
 * > stuff in a default-collapsed section, because most people won't want to
 * > use it
 *
 * It sends the Metadata card's own requests (src/web/PrivateLink.tsx):
 * `POST /api/article/:slug/share-link` with the rights confirmed, and
 * `DELETE` on the same path. Both need the owner's article row and no
 * published revision, and a link to an article with nothing published opens
 * nothing, so making one early exposes nothing early.
 *
 * The shape is `ShareAtAdd`'s: one controller per reader and slug, paused
 * when its page leaves, asked again on every return, a `404` while the job is
 * alive is *not yet*, and `settle` at completion. It is a class of its own
 * and not that one made generic, because the three things that differ are
 * the ones that carry the risk:
 *
 *  - **It reads the truth, so it remembers nothing.**
 *    `GET /api/article/:slug/share-link` answers from the owner's row before
 *    publication (src/store/pg-share-link.ts § `read`). So every attachment
 *    reads (a first mount, a reload, a second tab, a return to the page) and
 *    what is drawn is what the server said a moment ago. `404` is *no row
 *    yet*, which is *off*. There is no `sessionStorage` mark, and the key is
 *    in this object's state and nowhere else: no storage, no log, no error.
 *  - **An answer that did not come back is never sent again by itself.** The
 *    public switch may repeat a publish; a second create here makes a second
 *    key and turns off the first, which the reader may already have sent to
 *    somebody. So a create or a turn-off with no answer, a `5xx`, or a `200`
 *    that cannot be read is `unknown`, which sends nothing from anywhere:
 *    not a retry, not `settle`, not a Retry of the job. What leaves it is a
 *    read: *Check again* (`recheck`), or the next attachment. GPT Sol's stage
 *    2 plan review.
 *  - **A link it could not read again is not drawn.** If an attachment's read
 *    fails over a link held from an earlier visit, the key on screen may have
 *    been turned off or replaced since. It becomes `unknown`.
 *
 * And the two that are the same, for the same reasons:
 *
 *  - **It first finds out whether there is already an article here**, with
 *    the probe the public switch uses (the add page hands both one request).
 *    A published article is Metadata's to share: no control.
 *  - **Nothing is created without the confirmation**: the rights box ticked
 *    for this slug, and then the press. Both are held here and not in the
 *    component.
 *
 * **A controller belongs to one reader** (F1): add-sharing-session.ts. A
 * retired one drops its key at once.
 *
 * Framework-free, with the requests injected, so a test drives every answer
 * (tests/add-share-link.test.ts); `AddShareLink.tsx` draws it.
 */

import type { ShareLinkState } from "../types.js";
import { MAX_NOT_YET, NOT_YET_RETRY_MS } from "./add-high-power.js";
import type { Probe } from "./add-share.js";
import { readerRegistry } from "./add-sharing-session.js";
import { statusOf } from "./lib/api.js";

/** A link that is on, as the server gave it. The key is drawn in the link box and nowhere else. */
export interface LinkOn {
  key: string;
  since: string;
}

/** One state at a time. */
export type LinkAtAddState =
  /** The probe or the first read is out. No control. */
  | { kind: "reading" }
  /** An article is already published here. No control: the public switch's line says where to go. */
  | { kind: "adopted" }
  /** The probe or the first read could not say. No control: not knowing is not a reason to offer one. */
  | { kind: "unavailable" }
  | { kind: "off" }
  /** The confirmation is open. Nothing has been sent. */
  | { kind: "confirming"; rights: boolean }
  /** Confirmed, and not made yet: the import has not made the article's row. */
  | { kind: "waiting" }
  | { kind: "saving"; to: "on" | "off" }
  | { kind: "on"; link: LinkOn }
  /** The server said no and changed nothing, so `link` is what was on before, if anything was. */
  | { kind: "refused"; message: string; link: LinkOn | null; attempted: "on" | "off" }
  /** `MAX_NOT_YET` *not yet*s with the job still alive. `settle` tries again. */
  | { kind: "gave-up" }
  /**
   * There may be a link and we cannot say. `write`: a create or a turn-off
   * did not come back. `read`: a link was held, and the read on coming back
   * to the page failed. Nothing is sent from here by itself; `checking` is
   * *Check again*'s read being out.
   */
  | { kind: "unknown"; because: "write" | "read"; checking: boolean };

/** What the read found: the row's state, `"none"` for no row yet, or `null` for an answer it could not use. */
export type LinkRead = ShareLinkState | "none" | null;

export interface LinkIo {
  /** Whether an article is already published at `slug`. May reject; that is `unknown`. */
  probe(slug: string): Promise<Probe>;
  /** `GET …/share-link`. A `404` is `"none"`. May reject; that is no answer. */
  read(slug: string): Promise<LinkRead>;
  /**
   * `POST …/share-link` with the rights confirmed. The server's state, or
   * `null` for a success that could not be read. Rejects with the status on
   * it for a refusal. **Each call that lands makes a new key.**
   */
  create(slug: string): Promise<ShareLinkState | null>;
  /** `DELETE …/share-link`. As `create`. */
  remove(slug: string): Promise<ShareLinkState | null>;
}

/**
 * **Whether the add page should wait rather than open the article by
 * itself**, for `shareUnsettled`'s reason (add-share.ts): the confirmation is
 * open, or there is an answer the reader has not had the chance to read. A
 * link that is on, or a control never touched, holds nothing up.
 */
export function linkUnsettled(state: LinkAtAddState): boolean {
  switch (state.kind) {
    case "confirming":
    case "waiting":
    case "saving":
    case "refused":
    case "gave-up":
    case "unknown":
      return true;
    case "reading":
    case "adopted":
    case "unavailable":
    case "off":
    case "on":
      return false;
    default: {
      const never: never = state;
      return never;
    }
  }
}

const linkOf = (state: ShareLinkState & { on: true }): LinkOn => ({ key: state.key, since: state.since });

export class LinkAtAdd {
  private state: LinkAtAddState = { kind: "reading" };
  private started = false;
  /** Whether the job may still create the row — a `404` on the create is then *not yet*. */
  private jobAlive = true;
  private inFlight: Promise<void> | null = null;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private notYet = 0;
  /** A terminal pre-claim 404 is waiting for Retry to make the job live again. */
  private retryOnNextAlive = false;
  private active = true;
  /** `pause` has run since the last attachment, so the next `resume` asks again. */
  private detached = false;
  /** The probe and the read are out. A second attachment waits on them and does not ask again. */
  private asking = false;
  /**
   * Nothing may be created: an attachment's read is out, or it could not say.
   * Lifted by an attachment that found nothing published and read the row,
   * and by `settle`.
   */
  private held = false;
  /** `settle` was called while asking, so it is owed when that answers. */
  private settleOwed = false;
  /** Which *Check again* may still set state. */
  private turn = 0;
  /** The reader it belonged to has gone (`retire`). Nothing below may change state again. */
  private retired = false;
  private readonly listeners = new Set<() => void>();

  constructor(
    /** The one article this link is to. Never changed. */
    readonly slug: string,
    private readonly io: LinkIo,
    private readonly retryMs: number = NOT_YET_RETRY_MS,
  ) {}

  get = (): LinkAtAddState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Ask for the first time. Once; not in the constructor, as `ShareAtAdd.start` is not. */
  start(): void {
    if (this.started || this.retired) return;
    this.started = true;
    this.ask();
  }

  /** Stop unsent work when its page leaves. Undoes nothing. */
  pause(): void {
    this.active = false;
    this.detached = true;
    this.clearRetry();
  }

  /**
   * **A page is showing this controller.** The first time that is all; any
   * time after a `pause` it asks again, and creates nothing until that has
   * answered (`asked`). StrictMode's mount, unmount, mount lands here with
   * the first ask still out, and that one answers this attachment too.
   */
  resume(): void {
    if (this.retired) return;
    this.active = true;
    if (!this.detached) {
      this.kick();
      return;
    }
    this.detached = false;
    this.held = true;
    this.ask();
  }

  /**
   * **The reader this belonged to has changed, or gone** (F1). The key goes
   * with them: the state is emptied and the page told once, and after this
   * every answer still on its way is ignored and every method is inert.
   */
  retire(): void {
    if (this.retired) return;
    this.clearRetry();
    this.active = false;
    this.turn += 1;
    this.set({ kind: "reading" });
    this.retired = true;
    this.listeners.clear();
  }

  /** Whether the page's job can still create the article's row. */
  observe(jobAlive: boolean): void {
    if (this.retired) return;
    const wasAlive = this.jobAlive;
    this.jobAlive = jobAlive;
    if (jobAlive && !wasAlive && this.retryOnNextAlive) {
      /* A failed job can end before its claim makes the row. That 404 made
         nothing, and Retry under the same slug is still the link the owner
         confirmed (add-share.ts § `observe`). Never from `unknown`. */
      this.retryOnNextAlive = false;
      this.notYet = 0;
      this.set({ kind: "waiting" });
    }
    this.kick();
  }

  /** *Create a private link*: open the confirmation. Sends nothing. */
  open(): void {
    const from = this.state;
    if (from.kind !== "off" && !(from.kind === "refused" && from.link === null)) return;
    this.retryOnNextAlive = false;
    this.set({ kind: "confirming", rights: false });
  }

  /** The rights box inside the confirmation. */
  tick(rights: boolean): void {
    if (this.state.kind !== "confirming") return;
    this.set({ kind: "confirming", rights });
  }

  /**
   * *Cancel*: shut the confirmation, or give up a link that has not been made
   * yet. From `waiting` and `gave-up` every attempt so far was answered 404,
   * so there is nothing to take back.
   */
  cancel(): void {
    const kind = this.state.kind;
    if (kind !== "confirming" && kind !== "waiting" && kind !== "gave-up") return;
    this.clearRetry();
    this.retryOnNextAlive = false;
    this.set({ kind: "off" });
  }

  /**
   * ***Create the link***: the only way a create is ever sent, and only with
   * the rights box ticked. The request carries `rightsConfirmed: true` on the
   * strength of this.
   */
  create(): void {
    if (this.state.kind !== "confirming" || !this.state.rights) return;
    this.notYet = 0;
    this.set({ kind: "waiting" });
    this.kick();
  }

  /** *Turn off*. No confirmation: this is the safe direction. */
  turnOff(): void {
    const from = this.state;
    if (from.kind !== "on" && !(from.kind === "refused" && from.link !== null)) return;
    this.send("off");
  }

  /**
   * ***Check again***, from `unknown`: read the row, which changes nothing on
   * the server, and draw what it says. A read that fails leaves `unknown`.
   */
  recheck(): void {
    const from = this.state;
    if (this.retired || from.kind !== "unknown" || from.checking) return;
    const mine = ++this.turn;
    this.set({ ...from, checking: true });
    void this.io.read(this.slug).then(
      (read) => read,
      () => null,
    ).then((read) => {
      if (this.turn !== mine || this.state.kind !== "unknown") return;
      if (read === null) this.set({ kind: "unknown", because: from.because, checking: false });
      else this.set(read !== "none" && read.on ? { kind: "on", link: linkOf(read) } : { kind: "off" });
    });
  }

  /**
   * **At completion.** The import has finished, so the row exists: a create
   * still waiting is sent now, one that gave up is sent again, and a `404` is
   * final. `unknown` is not sent. Resolves when no request is in flight;
   * never rejects.
   */
  settle(): Promise<void> {
    if (this.retired) return Promise.resolve();
    this.jobAlive = false;
    this.clearRetry();
    if (this.state.kind === "gave-up") {
      this.notYet = 0;
      this.set({ kind: "waiting" });
    }
    /* Not ahead of an attachment's read: it may be about to say the article
       is published, or that a link is already on. `asked` pays this. */
    if (this.asking) this.settleOwed = true;
    else this.held = false;
    this.kick();
    return this.inFlight ?? Promise.resolve();
  }

  /** The probe, and then the read unless the probe has already decided. One at a time. */
  private ask(): void {
    if (this.asking || this.retired) return;
    this.asking = true;
    void this.io.probe(this.slug).then(
      (found) => found,
      (): Probe => "unknown",
    ).then((found) => {
      if (this.retired) return;
      const first = this.state.kind === "reading" || this.state.kind === "unavailable";
      /* A published article is Metadata's; and with nothing held, not knowing
         whether there is one already means no control, whatever the row says. */
      if (found === "article" || (found === "unknown" && first)) {
        this.asked(found, null);
        return;
      }
      void this.io.read(this.slug).then(
        (read) => this.asked(found, read),
        () => this.asked(found, null),
      );
    });
  }

  private asked(found: Probe, read: LinkRead): void {
    this.asking = false;
    if (this.retired) return;
    const owed = this.settleOwed;
    this.settleOwed = false;
    if (found === "article") {
      this.clearRetry();
      this.retryOnNextAlive = false;
      if (this.state.kind !== "adopted") this.set({ kind: "adopted" });
      return;
    }
    const now = this.state;
    if (now.kind === "reading" || now.kind === "unavailable") {
      /* The first answer, or the first one that could say. */
      this.held = false;
      if (found === "unknown" || read === null) {
        if (now.kind !== "unavailable") this.set({ kind: "unavailable" });
      } else this.set(read !== "none" && read.on ? { kind: "on", link: linkOf(read) } : { kind: "off" });
      return;
    }
    /* A later attachment, over a state from an earlier visit. A write still
       out will answer after this read was taken, so its answer stands. */
    if (!this.inFlight) this.reconcile(now, read);
    /* Nothing published and the row read lifts the hold. Otherwise it stays,
       unless completion has since asked for the create to be sent. */
    if ((found === "none" && read !== null) || owed) this.held = false;
    this.kick();
  }

  /** What a later attachment's read does to the state held from an earlier visit. */
  private reconcile(held: LinkAtAddState, read: LinkRead): void {
    if (read === null) {
      /* Could not read. Nothing that showed a link, or stood for one, is
         kept on the strength of memory. */
      const stoodForALink = held.kind === "on" || (held.kind === "refused" && held.link !== null);
      if (stoodForALink) this.set({ kind: "unknown", because: "read", checking: false });
      return;
    }
    if (read !== "none" && read.on) {
      /* On, whatever was held: a link made elsewhere while this one was
         waiting is the link, and creating over it would turn it off. */
      this.clearRetry();
      this.retryOnNextAlive = false;
      this.set({ kind: "on", link: linkOf(read) });
      return;
    }
    /* Off. What the reader was in the middle of asking for is still theirs
       to finish; anything that claimed a link is not true now. */
    const stillAsking =
      held.kind === "off" ||
      held.kind === "confirming" ||
      held.kind === "waiting" ||
      held.kind === "gave-up" ||
      (held.kind === "refused" && held.link === null);
    if (!stillAsking) this.set({ kind: "off" });
  }

  private kick(): void {
    if (this.retired) return;
    if (!this.active || this.held || this.state.kind !== "waiting" || this.inFlight || this.retry) return;
    this.send("on");
  }

  private send(to: "on" | "off"): void {
    if (this.retired) return;
    const before = this.state;
    this.set({ kind: "saving", to });
    const request = to === "on" ? this.io.create(this.slug) : this.io.remove(this.slug);
    this.inFlight = request.then(
      (answer) => {
        this.inFlight = null;
        /* Its reader has gone, or the article published and this gave way. */
        if (this.retired || this.state.kind !== "saving") return;
        this.retryOnNextAlive = false;
        this.notYet = 0;
        /* A 200 that cannot be read is the absence of an answer, and it may
           have made a key. */
        if (answer === null) this.set({ kind: "unknown", because: "write", checking: false });
        else this.set(answer.on ? { kind: "on", link: linkOf(answer) } : { kind: "off" });
      },
      (e: unknown) => {
        this.inFlight = null;
        if (this.retired || this.state.kind !== "saving") return;
        const status = statusOf(e);
        const message = e instanceof Error ? e.message : "The request failed.";
        if (to === "on" && status === 404 && this.jobAlive) {
          /* The claim has not opened the draft yet, so nothing was made. */
          if (this.notYet >= MAX_NOT_YET) {
            this.set({ kind: "gave-up" });
            return;
          }
          this.notYet += 1;
          this.set({ kind: "waiting" });
          if (!this.active) return;
          this.retry = setTimeout(() => {
            this.retry = null;
            this.kick();
          }, this.retryMs);
          return;
        }
        this.retryOnNextAlive = to === "on" && status === 404;
        if (status === null || status < 400 || status >= 500) {
          /* No answer, or a fault: it may have taken effect. This is the
             state nothing is sent from (the header's second point). */
          this.set({ kind: "unknown", because: "write", checking: false });
          return;
        }
        /* A refusal: the server said no and wrote nothing. Its sentence, and
           whatever link was on before. */
        const link =
          before.kind === "on" ? before.link : before.kind === "refused" ? before.link : null;
        this.set({ kind: "refused", message, link, attempted: to });
      },
    );
  }

  private clearRetry(): void {
    if (this.retry) clearTimeout(this.retry);
    this.retry = null;
  }

  private set(next: LinkAtAddState): void {
    if (this.retired) return;
    this.state = next;
    for (const listener of this.listeners) listener();
  }
}

/** The tab's link controllers, by reader and slug. Emptied when the reader changes. */
const controllers = readerRegistry<LinkAtAdd>();

/**
 * The one link controller for this reader's `slug` in this tab, made on first
 * asking. Making one starts nothing, so this is safe to call during render.
 */
export function linkAtAddFor(slug: string, io: LinkIo, readerId: string | null = null): LinkAtAdd {
  return controllers.for(readerId, slug, () => new LinkAtAdd(slug, io));
}
