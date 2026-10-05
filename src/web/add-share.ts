/**
 * **Make it public, chosen while the article is being added** — the add
 * page's third box,
 * docs/plans/261005l-permalink-and-share-while-an-article-is-importing.md.
 * Greg, 2026-10-05 (spya-e9t58e):
 *
 * > While I'm importing an article, make it possible for me to mark it as
 * > public/shared as it's importing
 *
 * It calls the same `PUT /api/article/:slug/visibility` as the card on
 * `/metadata` (src/web/AccessSharing.tsx), so every refusal is the server's
 * and unchanged. What is new is only *when*: the route needs the owner's
 * article row and no published revision, and a public article with nothing
 * published is readable by nobody, so switching early exposes nothing early.
 *
 * The shape is `HighPowerIntent`'s (src/web/add-high-power.ts): the page
 * knows the slug before the row exists, so a `404` while the job is alive
 * means *not yet* and is retried. Six things differ, each from GPT Sol's
 * reviews of the plan and of the code:
 *
 *  - **One controller per slug, per tab, for the tab's life** (plan review
 *    P1, code review F12). That intent is retargeted when a Retry comes back
 *    under another slug, and carries `on` across. Here that would say B is
 *    public without sharing it, and unticking would make B private and leave
 *    A public. So the slug is a constructor argument, and `shareAtAddFor`
 *    keeps one instance per slug in a module-level registry: two addresses
 *    that name one article (`/add/A` and `/add/A/`) get the same controller,
 *    so there are never two writers for one slug whose answers could land in
 *    the wrong order. A Retry onto another slug shows that slug's own
 *    controller, and the old one stays as it was, still saying what is true
 *    of its slug.
 *  - **The only `private` it sends is the box being unticked** (code review
 *    F11). An earlier version took a share back when the page moved to
 *    another slug. A compensating write whose failure nobody can see is worse
 *    than the state it compensates for, and what it compensated for is an
 *    unpublished import nobody can read.
 *  - **A reload cannot read the state back, so it does not claim one** (code
 *    review F10). Before publication no route says whether the article is
 *    public. The controller leaves a mark in the tab **before** each publish
 *    is sent (`ShareIo.marks`), since the server can commit one whose answer
 *    the page never sees, and removes it only when the outcome rules
 *    publication out. A fresh controller that finds the mark starts at
 *    `unknown`: the box ticked, a sentence saying why, and unticking sends
 *    `private`. The mark never sends a publish. Another tab has no mark and
 *    starts at `off`; that residual is accepted.
 *  - **Attached to a page again, it asks first** (fix check F16, F17). The
 *    registry keeps a controller across visits, and between two visits the
 *    article may have published and Metadata's switch may have changed it.
 *    So every attachment after the first runs the probe again and sends
 *    nothing while it is out. A published article gives way to Metadata,
 *    whatever was held: `resume`.
 *  - **It first finds out whether there is already an article here** (P2-2).
 *    An import can adopt one already on the shelf (`freeSlug`, src/jobs.ts),
 *    with a glossary and notes that would go public on the press, and the
 *    confirmation here lists an article nothing has been built on. No box
 *    unless the probe says there is nothing published.
 *  - **Nothing is sent without the confirmation**: the rights box ticked for
 *    this slug, and then the press. Both are held here and not in the
 *    component, so the rule is this file's and a test drives it without React.
 *  - **Giving up is not final** (P2-7). Five minutes of *not yet* is a job
 *    that sat queued, and `settle` at completion sends it again.
 *
 * Framework-free, with the requests injected, so a test drives every answer
 * (tests/add-share.test.ts); `AddShare.tsx` draws it.
 */

import type { VisibilityState } from "../types.js";
import { MAX_NOT_YET, NOT_YET_RETRY_MS } from "./add-high-power.js";
import { statusOf } from "./lib/api.js";

/** One state at a time. */
export type ShareAtAddState =
  /** Not known yet whether an article is already published at this slug. No box. */
  | { kind: "probing" }
  /** There is one. No box, and one line pointing at its Metadata page. */
  | { kind: "adopted" }
  /** The probe could not say. No box and no line: not knowing is not a reason to offer the switch. */
  | { kind: "unavailable" }
  | { kind: "off" }
  /** The box is ticked and the confirmation is open. Nothing has been sent. */
  | { kind: "confirming"; rights: boolean }
  /** Confirmed, and not sent yet: the import has not made the article's row. */
  | { kind: "waiting" }
  | { kind: "saving"; to: "public" | "private" }
  | { kind: "on"; publicAt: string }
  /** The server answered no, so the last confirmed state (`on`) did not change. */
  | { kind: "refused"; message: string; on: boolean; attempted: "public" | "private" }
  /** `MAX_NOT_YET` *not yet*s with the job still alive. `settle` tries again. */
  | { kind: "gave-up" }
  /**
   * It may be public and we cannot say. `write`: no answer arrived, or one
   * that could not be read. `reload`: this tab made it public before the page
   * was reloaded, and nothing can be asked until the import has published.
   */
  | { kind: "unknown"; because: "write" | "reload" };

/** What the probe found at the slug: nothing published, an article, or no answer it can trust. */
export type Probe = "none" | "article" | "unknown";

export interface ShareIo {
  /** Whether an article is already published at `slug`. May reject; that is `unknown`. */
  probe(slug: string): Promise<Probe>;
  /**
   * `PUT …/visibility`. The server's state, or `null` for a success that
   * could not be read (`asVisibilityState`, src/web/AccessSharing.tsx).
   * Rejects with the status on it for a refusal.
   */
  put(slug: string, to: "public" | "private"): Promise<VisibilityState | null>;
  /**
   * **What this tab remembers having made public**, by slug: the page's
   * `sessionStorage`, injected so a test can drive it. A hint, never an
   * answer. None of the three may throw.
   */
  marks: {
    recall(slug: string): boolean;
    remember(slug: string): void;
    forget(slug: string): void;
  };
}

/**
 * **Whether the add page should wait rather than open the article by
 * itself**: the confirmation is open, or there is an answer the reader has
 * not had the chance to read. A share that is on, or a box never touched,
 * holds nothing up. GPT Sol's plan review, P2-5.
 */
export function shareUnsettled(state: ShareAtAddState): boolean {
  switch (state.kind) {
    case "confirming":
    case "waiting":
    case "saving":
    case "refused":
    case "gave-up":
    case "unknown":
      return true;
    case "probing":
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

export class ShareAtAdd {
  private state: ShareAtAddState = { kind: "probing" };
  private started = false;
  /** Whether the job may still create the row — a `404` is then *not yet*. */
  private jobAlive = true;
  private inFlight: Promise<void> | null = null;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private notYet = 0;
  /** A terminal pre-claim 404 is waiting for Retry to make the job live again. */
  private retryOnNextAlive = false;
  private active = true;
  /** `pause` has run since the last attachment, so the next `resume` asks again. */
  private detached = false;
  /** A probe is out. A second attachment waits on it and does not ask again. */
  private probeOut = false;
  /**
   * Nothing may be sent as public: the attachment's probe is out, or it
   * could not say. Lifted by a probe that finds nothing published, and by
   * `settle`.
   */
  private held = false;
  /** `settle` was called while the probe was out, so it is owed when the probe answers. */
  private settleOwed = false;
  private readonly listeners = new Set<() => void>();

  constructor(
    /** The one article this share is about. Never changed. */
    readonly slug: string,
    private readonly io: ShareIo,
    private readonly retryMs: number = NOT_YET_RETRY_MS,
  ) {}

  get = (): ShareAtAddState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /**
   * Ask whether there is already an article here. Once; a second call does
   * nothing. Not in the constructor, because the add page looks its
   * controller up during a render that may never commit.
   */
  start(): void {
    if (this.started) return;
    this.started = true;
    this.ask();
  }

  /** Stop unsent work when its page leaves, without undoing a confirmed share. */
  pause(): void {
    this.active = false;
    this.detached = true;
    this.clearRetry();
  }

  /**
   * **A page is showing this controller.** The first time that is all; any
   * time after a `pause` it asks again whether an article is published here
   * before doing anything else, and sends nothing until that has answered
   * (`asked`):
   *
   *  - **published**: the state is Metadata's to say and to change. Whatever
   *    was held here gives way to the *already an article* line; a `waiting`
   *    intent from an earlier visit must not publish over a later unshare.
   *  - **nothing published**: Metadata cannot have touched it, so what was
   *    held is still true, and a `waiting` share goes on.
   *  - **could not say**: what was held stays on screen, and nothing is sent
   *    from `waiting` on this attachment. `settle`, or the next attachment,
   *    may.
   *
   * StrictMode's mount, unmount, mount lands here with the first probe still
   * out. That probe is the answer to this attachment too; it is not asked
   * twice.
   */
  resume(): void {
    this.active = true;
    if (!this.detached) {
      this.kick();
      return;
    }
    this.detached = false;
    this.held = true;
    this.ask();
  }

  /** Whether the page's job can still create the article's row. */
  observe(jobAlive: boolean): void {
    const wasAlive = this.jobAlive;
    this.jobAlive = jobAlive;
    if (jobAlive && !wasAlive && this.retryOnNextAlive) {
      /* A failed job can end before its claim creates the article row. Its 404
         is final for that attempt, but Retry under the same slug is still the
         share the owner confirmed. */
      this.retryOnNextAlive = false;
      this.notYet = 0;
      this.set({ kind: "waiting" });
    }
    this.kick();
  }

  /** The box, ticked: open the confirmation. Sends nothing. */
  open(): void {
    const from = this.state;
    if (from.kind !== "off" && !(from.kind === "refused" && !from.on)) return;
    this.retryOnNextAlive = false;
    this.set({ kind: "confirming", rights: false });
  }

  /** The rights box inside the confirmation. */
  tick(rights: boolean): void {
    if (this.state.kind !== "confirming") return;
    this.set({ kind: "confirming", rights });
  }

  /** *Cancel* inside the confirmation. */
  cancel(): void {
    if (this.state.kind !== "confirming") return;
    this.set({ kind: "off" });
  }

  /**
   * ***Share it***: the only way anything is sent as public, and only with
   * the rights box ticked. The request that follows carries
   * `rightsConfirmed: true` on the strength of this.
   */
  share(): void {
    if (this.state.kind !== "confirming" || !this.state.rights) return;
    this.notYet = 0;
    this.set({ kind: "waiting" });
    this.kick();
  }

  /** The box, unticked. Ignored while a request is in flight (the box is disabled then). */
  untick(): void {
    this.retryOnNextAlive = false;
    switch (this.state.kind) {
      case "confirming":
        this.set({ kind: "off" });
        return;
      case "gave-up":
      case "waiting":
        /* Nothing has taken effect: every attempt so far was answered 404,
           so there is nothing for a reload to be unsure about either. */
        this.clearRetry();
        this.io.marks.forget(this.slug);
        this.set({ kind: "off" });
        return;
      case "on":
      case "unknown":
        /* `unknown` may be public on the server. Taking it back needs no
           second confirmation: unsharing is never harder than sharing
           (src/messages.ts § `UNSHARING_COSTS_ALLOWANCE`). */
        this.send("private");
        return;
      case "refused":
        /* A refused unshare leaves the last confirmed state public. */
        if (this.state.on) this.send("private");
        else this.set({ kind: "off" });
        return;
      case "probing":
      case "adopted":
      case "unavailable":
      case "off":
      case "saving":
        return;
      default:
        this.state satisfies never;
    }
  }

  /**
   * **At completion.** The import has finished, so the row exists: a share
   * still waiting is sent now, one that gave up is sent again, and a `404` is
   * final. Resolves when no request is in flight; never rejects.
   */
  settle(): Promise<void> {
    this.jobAlive = false;
    this.clearRetry();
    if (this.state.kind === "gave-up") {
      this.notYet = 0;
      this.set({ kind: "waiting" });
    }
    /* Not ahead of an attachment's probe: it may be about to say the article
       is published. `asked` pays this when it answers. */
    if (this.probeOut) this.settleOwed = true;
    else this.held = false;
    this.kick();
    return this.inFlight ?? Promise.resolve();
  }

  /** Run the probe, unless one is already out. */
  private ask(): void {
    if (this.probeOut) return;
    this.probeOut = true;
    void this.io.probe(this.slug).then(
      (found) => this.asked(found),
      () => this.asked("unknown"),
    );
  }

  private asked(found: Probe): void {
    this.probeOut = false;
    const owed = this.settleOwed;
    this.settleOwed = false;
    if (this.state.kind === "probing" || (this.state.kind === "unavailable" && found === "none")) {
      /* The first answer, or the first one that could say. */
      this.held = false;
      if (found === "article") this.set({ kind: "adopted" });
      else if (found === "unknown") this.set({ kind: "unavailable" });
      /* Nothing published, and this tab remembers asking to make it public.
         That is not read back from anywhere, so it is not `on`: `unknown`,
         which draws the box ticked and lets it be unticked. It sends nothing. */
      else if (this.io.marks.recall(this.slug)) this.set({ kind: "unknown", because: "reload" });
      else this.set({ kind: "off" });
      return;
    }
    /* A later attachment, over a state from an earlier visit: `resume`. */
    if (found === "article") {
      this.clearRetry();
      this.retryOnNextAlive = false;
      /* Metadata reads the truth now, so the hint has nothing left to say. */
      this.io.marks.forget(this.slug);
      if (this.state.kind !== "adopted") this.set({ kind: "adopted" });
      return;
    }
    /* `none` lifts the hold. `unknown` leaves it, unless completion has since
       said the row exists and asked for the share to be sent. */
    if (found === "none" || owed) this.held = false;
    this.kick();
  }

  private kick(): void {
    if (!this.active || this.held || this.state.kind !== "waiting" || this.inFlight || this.retry) return;
    this.send("public");
  }

  private send(to: "public" | "private"): void {
    const before = this.state;
    /* **Before the request, not when it answers.** The server can commit a
       publish whose reply this page never sees, and a reload in that gap
       would otherwise find no mark and draw the box off over a public
       article. Every send, retries and `settle` included. What removes it is
       an outcome that rules publication out, below and in `untick`. */
    if (to === "public") this.io.marks.remember(this.slug);
    this.set({ kind: "saving", to });
    this.inFlight = this.io.put(this.slug, to).then(
      (answer) => {
        this.inFlight = null;
        /* The article published while this was out, and the controller has
           given way to Metadata (`asked`). Its answer is not this box's to draw. */
        if (this.state.kind !== "saving") return;
        this.retryOnNextAlive = false;
        this.notYet = 0;
        if (answer === null) {
          /* Unreadable: it may have taken, so the mark stays as it is. */
          this.set({ kind: "unknown", because: "write" });
        } else if (answer.publicAt !== null) {
          this.set({ kind: "on", publicAt: answer.publicAt });
        } else {
          /* Private, in the server's own words. */
          this.io.marks.forget(this.slug);
          this.set({ kind: "off" });
        }
      },
      (e: unknown) => {
        this.inFlight = null;
        if (this.state.kind !== "saving") return;
        const status = statusOf(e);
        const message = e instanceof Error ? e.message : "The request failed.";
        if (to === "public" && status === 404 && this.jobAlive) {
          /* The claim has not opened the draft yet. */
          if (this.notYet >= MAX_NOT_YET) {
            this.set({ kind: "gave-up" });
            return;
          }
          this.notYet += 1;
          this.set({ kind: "waiting" });
          /* The request may answer after unmount. Keep its outcome, but do
             not create a new writer with no page left to own it. */
          if (!this.active) return;
          this.retry = setTimeout(() => {
            this.retry = null;
            this.kick();
          }, this.retryMs);
          return;
        }
        /* A failed attempt that ended before the article row existed is tried
           again when JobCard's Retry produces the replacement job. */
        this.retryOnNextAlive = to === "public" && status === 404;
        /* The server answered a publish with a refusal, so the article is
           not public on our account. No status is no answer, and keeps it;
           so does the *not yet* above, which is followed by another send. */
        if (to === "public" && status !== null) this.io.marks.forget(this.slug);
        if (status === null || before.kind === "unknown") {
          this.set({ kind: "unknown", because: "write" });
          return;
        }
        const knownOn = before.kind === "on" || (before.kind === "refused" && before.on);
        this.set({ kind: "refused", message, on: knownOn, attempted: to });
      },
    );
  }

  private clearRetry(): void {
    if (this.retry) clearTimeout(this.retry);
    this.retry = null;
  }

  private set(next: ShareAtAddState): void {
    this.state = next;
    for (const listener of this.listeners) listener();
  }
}

/**
 * **The tab's controllers, by slug.** At module level so a page that
 * unmounted and the next one mounted on the same article find the same one,
 * whatever address each was reached by.
 */
const controllers = new Map<string, ShareAtAdd>();

/**
 * The one controller for `slug` in this tab, made on first asking. Making one
 * starts nothing (`start`), so this is safe to call during render. `io` is
 * the first caller's; the add page passes the same object every time.
 */
export function shareAtAddFor(slug: string, io: ShareIo): ShareAtAdd {
  let held = controllers.get(slug);
  if (!held) {
    held = new ShareAtAdd(slug, io);
    controllers.set(slug, held);
  }
  return held;
}

/** A fresh tab, for a test: what a reload does to the registry. */
export function resetShareAtAddForTests(): void {
  for (const held of controllers.values()) held.pause();
  controllers.clear();
}
