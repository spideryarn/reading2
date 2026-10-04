/**
 * **Why the reader is reading this, saved while the article is being added** —
 * the add page's box, docs/plans/261004l-the-add-page-purpose-box-saves-as-you-type.md.
 *
 * > B with a small debounce of some kind
 * >
 * > — Greg, 2026-10-04
 *
 * The server queues the first modes in the transaction that publishes the
 * import, with the reader's profile as it stands then. A purpose saved at a
 * button after the import is too late for them; one saved as it is typed is
 * usually in the `articles` row by then.
 *
 * One session is bound to one article. It is a class rather than
 * `useAutosavedText` in the page because the article can change under one
 * mounted page (a new address, or a Retry that comes back with another slug),
 * and because every fact the page decides on, at completion and at *Open the
 * article*, has to be true in the tick it is read. So there is one copy of the
 * text, here, and no render between a keystroke and a decision.
 *
 * Three rules shape it, each from GPT Sol's plan reviews:
 *
 *  - **Nothing is written until the stored purpose has been read.** The page
 *    knows the slug before the row exists, and a re-add has a purpose the
 *    reader cannot see. So the session asks `GET /api/reader?slug=` until it
 *    is told, freshly and explicitly, that the article's purpose could be
 *    read. A box that is blank then takes the stored text; typed words are
 *    kept and sent at once. Only after that does an emptied box mean *clear
 *    it* (260930e F1, kept).
 *  - **One write in flight, the newest text behind it.** The rule is
 *    `useAutosavedText`'s, copied: two PATCHes can be applied in either order,
 *    so the second waits for the first. This is the second copy of it; the
 *    hook's header says why it exists.
 *  - **Two sessions for one article never overlap** (F9). A retired session
 *    still owes its article its last words, and `retire()` resolves when that
 *    has settled. A new session for the same slug is handed that promise as
 *    `after` and neither reads nor writes before it.
 *
 * What it does not do: `leaveNow` (`pagehide`) sends without waiting for a
 * write in flight, so the older one can in principle be applied second. That
 * is the hook's documented limit too; the plan's § What this does not fix.
 *
 * Framework-free, with its requests injected, so a test drives every answer
 * (tests/add-purpose.test.ts). AddPage.tsx holds one and draws it.
 */

import type { SaveState } from "./useAutosavedText.js";

/**
 * How long the add page's box sits still before it saves. Shorter than the
 * other boxes' two seconds because this one is racing an import: the words
 * have to be in before publication reads them.
 */
export const ADD_PURPOSE_IDLE_MS = 700;

/** How long one read of the stored purpose may take before it is given up on. */
export const PURPOSE_READ_DEADLINE_MS = 10_000;

/** How long after a read that did not seed before the next. */
export const PURPOSE_READ_RETRY_MS = 1_000;

/**
 * How many reads in one run before giving up. A job cancelled before its claim
 * never makes the row, so the loop needs an end of its own, as
 * add-high-power.ts § `MAX_NOT_YET` does.
 */
export const PURPOSE_READ_MAX_TRIES = 300;

/** How many tries are left to a run once the import has completed, when the row must exist. */
export const PURPOSE_READ_FINAL_TRIES = 5;

/** What one read of `GET /api/reader?slug=` said. */
export interface PurposeAnswer {
  /** False for a copy served from the offline cache, which proves nothing about now. */
  fresh: boolean;
  purpose: string | null;
  /** As the server sent it. Only an explicit `false` counts. */
  purposeFailed: unknown;
}

export interface AddPurposeIo {
  read(slug: string, signal: AbortSignal): Promise<PurposeAnswer>;
  /** Store the text (`""` clears); resolve with what was stored, `""` for none. */
  save(slug: string, text: string): Promise<string>;
  /** The `keepalive` write. Must not await anything first. */
  leave(slug: string, text: string): void;
}

/** `setTimeout` and `clearTimeout`, for a test that wants its own clock. */
export interface PurposeTimers {
  set(run: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

const REAL_TIMERS: PurposeTimers = {
  set: (run, ms) => setTimeout(run, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export interface AddPurposeSnapshot {
  text: string;
  /** `loading` until seeded; then what `SaveStatus` draws. */
  state: SaveState;
  /** A write is on the wire, including one for older text. Not recoverable from `state`. */
  inFlight: boolean;
  /** The stored purpose has been read, so the box can be saved. */
  seeded: boolean;
  /** The read ran out of tries. The words cannot be saved from here. */
  gaveUp: boolean;
  /**
   * **Words the server may not have, or a write not yet settled.** Typed and
   * unseeded counts (F6: words with nowhere to go yet), as does a write in
   * flight over a box that says clean, and a refusal. What the page waits on
   * before it opens the article, and what the leave warning asks about.
   */
  unsaved: boolean;
}

interface Attempt {
  controller: AbortController;
  deadline: unknown;
}

export class AddPurposeSession {
  private text: string;
  /** Whether the text in the box is the reader's own, not a stored purpose it adopted. */
  private touched: boolean;
  /** What the server holds. `null` until read. */
  private saved: string | null = null;
  /** The text of the write in flight, or null. */
  private sending: string | null = null;
  private flight: Promise<void> | null = null;
  private queued = false;
  /** The refusal of the text now in the box. An edit clears it. */
  private error: string | null = null;
  private savedThisVisit = false;
  private abandoned = false;

  /** False while the previous session for this article still has writes to make. */
  private ready: boolean;
  private readonly before: Promise<void>;
  private done: Promise<void> | null = null;

  private alive = false;
  private observed = false;
  /** The add has stopped and its one last read has not gone yet. */
  private lastTry = false;
  private tries = 0;
  private gaveUp = false;
  private asking: Attempt | null = null;
  private wait: unknown = null;

  private readonly timers: PurposeTimers;
  private readonly listeners = new Set<() => void>();
  private snapshot: AddPurposeSnapshot;

  constructor(
    /** `job.slug` or the completion's, never one derived from the address. Null: nothing to save to yet. */
    readonly slug: string | null,
    private readonly io: AddPurposeIo,
    options: {
      /** The previous same-slug session's `retire()`. Nothing is read or written before it. */
      after?: Promise<void>;
      /** Words the reader typed before this session, carried in. */
      text?: string;
      timers?: PurposeTimers;
    } = {},
  ) {
    this.text = options.text ?? "";
    this.touched = this.text !== "";
    this.timers = options.timers ?? REAL_TIMERS;
    if (options.after) {
      this.ready = false;
      const go = (): void => {
        this.ready = true;
        this.kick();
      };
      this.before = options.after.then(go, go);
    } else {
      this.ready = true;
      this.before = Promise.resolve();
    }
    this.snapshot = this.snap();
  }

  get = (): AddPurposeSnapshot => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    if (this.done) return () => {};
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  get isRetired(): boolean {
    return this.done !== null;
  }

  /**
   * What follows the reader to this add's next article: only words they typed.
   * A box still showing a stored purpose they never edited carries nothing, so
   * one article's purpose is never written to another.
   */
  carried(): string {
    return this.touched ? this.text : "";
  }

  /** A keystroke (`byReader`). Clears a refusal: it was about the words that were sent. */
  setText = (text: string, byReader: boolean): void => {
    if (this.done) return;
    this.text = text;
    this.touched = byReader;
    this.error = null;
    this.changed();
  };

  /** Save the text if the server does not have it. Safe to call often; nothing before the seed. */
  commit = (): void => {
    if (this.done || this.abandoned || this.saved === null) return;
    /* Before "nothing changed": the box may be back at the stored value while
       an older write is on its way to replace it. That needs a correction
       queued behind the write. useAutosavedText.ts § `commit`. */
    if (this.sending !== null) {
      this.queued = true;
      this.changed();
      return;
    }
    const text = this.wanted();
    if (text === this.saved) return;
    this.send(text);
  };

  /** Give this draft up, so retiring does not send it behind the reader's back. */
  abandon = (): void => {
    this.abandoned = true;
    this.queued = false;
    this.changed();
  };

  /** `pagehide`: the `keepalive` write, now, with nothing awaited. */
  leaveNow = (): void => {
    if (this.done || this.abandoned || this.slug === null || this.saved === null) return;
    const text = this.wanted();
    if (text !== this.saved) this.io.leave(this.slug, text);
  };

  /**
   * **Whether the add is alive**: a job queued or running, or a completion.
   * Called by the page whenever that changes. The read runs while it is; a
   * stopped add gets one last try (its row may have been made before it
   * failed); alive again after a stop, which is a Retry, starts a fresh run.
   */
  observe(alive: boolean): void {
    if (this.done) return;
    const was = this.observed ? this.alive : null;
    this.observed = true;
    this.alive = alive;
    if (this.saved !== null || this.slug === null) return;
    if (alive && was !== true) {
      this.tries = 0;
      this.lastTry = false;
      if (this.gaveUp) {
        this.gaveUp = false;
        this.changed();
      }
    } else if (!alive && was !== false) {
      this.lastTry = true;
      if (this.wait !== null) {
        this.timers.clear(this.wait);
        this.wait = null;
      }
    }
    this.kick();
  }

  /**
   * **The import has finished, so the row exists**: a read that ran out of
   * tries gets a fresh run. A job queued for longer than the cap makes no row
   * until it is claimed, and staying alive into its completion is not the
   * stop-then-Retry that `observe` restarts on. Without this the box would say
   * its words cannot be saved about an article that is now there.
   */
  completed(): void {
    if (this.done || this.saved !== null || this.slug === null) return;
    /* A short run: with the row there, a read that still fails is a real
       failure, and the reader pressing *Open the article* should not wait
       five minutes to be offered *Open without saving*. */
    this.tries = Math.max(this.tries, PURPOSE_READ_MAX_TRIES - PURPOSE_READ_FINAL_TRIES);
    if (this.gaveUp) {
      this.gaveUp = false;
      this.changed();
    }
    this.kick();
  }

  /**
   * **The page has moved on from this article.** Stops the read, lets a write
   * in flight finish, then sends the latest text if the server does not have
   * it. Resolves when that has settled, and never rejects. Nothing a retired
   * session does reaches the page: its listeners are gone.
   */
  retire(): Promise<void> {
    if (this.done) return this.done;
    this.listeners.clear();
    if (this.asking) {
      this.timers.clear(this.asking.deadline);
      this.asking.controller.abort();
      this.asking = null;
    }
    if (this.wait !== null) {
      this.timers.clear(this.wait);
      this.wait = null;
    }
    this.done = this.before.then(() => this.flight ?? undefined).then(() => this.flush());
    return this.done;
  }

  private async flush(): Promise<void> {
    if (this.abandoned || this.slug === null || this.saved === null) return;
    /* A refusal still standing is about this very text. Not sent again. */
    const text = this.wanted();
    if (text === this.saved || this.error !== null) return;
    try {
      this.saved = await this.io.save(this.slug, text);
    } catch {
      /* Nobody is left to tell. */
    }
  }

  private send(text: string): void {
    const slug = this.slug;
    if (slug === null) return;
    this.sending = text;
    this.error = null;
    /* A `save` that throws before returning a promise must still clear
       `sending`, or every later commit queues behind a write that never
       comes back. Started synchronously all the same. */
    let request: Promise<string>;
    try {
      request = this.io.save(slug, text);
    } catch (e) {
      request = Promise.reject(e);
    }
    this.flight = request
      .then(
        (value) => {
          this.saved = value;
          /* The server's string, only over the text that was sent. The reader
             may be typing again, and those words the server never saw. */
          if (this.text === text) this.text = value;
          this.savedThisVisit = true;
          return true;
        },
        (e: unknown) => {
          /* Only over the words it is about. A refusal of text no longer in
             the box would be a claim about the new words, and would stop the
             idle timer sending them. */
          if (this.wanted() === text) {
            this.error = e instanceof Error ? e.message : "The request failed.";
          }
          return false;
        },
      )
      .then((landed) => {
        this.sending = null;
        this.flight = null;
        /* A refused text is not sent again because a blur queued behind it. */
        const again = this.queued && (landed || this.wanted() !== text);
        this.queued = false;
        this.changed();
        /* Retired: `retire` sends what is left, once, in order. */
        if (again && !this.done) this.commit();
      });
    this.changed();
  }

  /**
   * What the box asks the server to hold: its text, or `""` for a box of
   * nothing but spaces. The server stores both as *no purpose*, so a blank box
   * over an article with none is not a difference worth a write.
   */
  private wanted(): string {
    return this.text.trim() === "" ? "" : this.text;
  }

  private kick(): void {
    if (this.done || !this.ready || this.slug === null || this.saved !== null) return;
    if (this.asking !== null || this.wait !== null || this.gaveUp) return;
    if (!this.alive) {
      if (!this.lastTry) return;
      this.lastTry = false;
    }
    this.ask(this.slug);
  }

  private ask(slug: string): void {
    const controller = new AbortController();
    const attempt: Attempt = {
      controller,
      deadline: this.timers.set(() => this.answered(attempt, null), PURPOSE_READ_DEADLINE_MS),
    };
    this.asking = attempt;
    let request: Promise<PurposeAnswer>;
    try {
      request = this.io.read(slug, controller.signal);
    } catch (e) {
      request = Promise.reject(e);
    }
    request.then(
      (answer) => this.answered(attempt, answer),
      () => this.answered(attempt, null),
    );
  }

  /** One attempt's end: an answer, a failure or its deadline. Consumed once. */
  private answered(attempt: Attempt, answer: PurposeAnswer | null): void {
    if (this.asking !== attempt) return;
    this.asking = null;
    this.timers.clear(attempt.deadline);
    if (answer === null) attempt.controller.abort();
    /* Fresh, and an explicit `false`: an offline copy is not evidence the
       article exists (F5), and `purposeFailed: true` covers *not yet*. */
    if (answer !== null && answer.fresh === true && answer.purposeFailed === false) {
      this.seed(answer.purpose ?? "");
      return;
    }
    this.tries += 1;
    if (!this.alive) {
      this.kick();
      return;
    }
    if (this.tries >= PURPOSE_READ_MAX_TRIES) {
      this.gaveUp = true;
      this.changed();
      return;
    }
    this.wait = this.timers.set(() => {
      this.wait = null;
      this.kick();
    }, PURPOSE_READ_RETRY_MS);
  }

  private seed(stored: string): void {
    this.saved = stored;
    /* A blank box takes what is stored, and that text is not the reader's.
       Typed words stay, and the commit below sends them at once. */
    if (this.text.trim() === "") {
      this.text = stored;
      this.touched = false;
    }
    this.changed();
    this.commit();
  }

  private snap(): AddPurposeSnapshot {
    const seeded = this.saved !== null;
    const inFlight = this.sending !== null;
    const wanted = this.wanted();
    const dirty = seeded && wanted !== this.saved;
    let state: SaveState;
    if (this.error !== null) state = { kind: "error", message: this.error };
    else if (!seeded) state = { kind: "loading" };
    // "Saving" only about the text in the box; typing on makes it dirty again.
    else if (inFlight && this.sending === wanted) state = { kind: "saving" };
    else if (dirty) state = { kind: "dirty" };
    else state = this.savedThisVisit ? { kind: "saved" } : { kind: "clean" };
    const unsaved =
      !this.abandoned &&
      (inFlight || this.queued || this.error !== null || (seeded ? dirty : wanted !== ""));
    return { text: this.text, state, inFlight, seeded, gaveUp: this.gaveUp, unsaved };
  }

  private changed(): void {
    this.snapshot = this.snap();
    if (this.done) return;
    for (const listener of [...this.listeners]) listener();
  }
}
