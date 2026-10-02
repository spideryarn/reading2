/**
 * **High-powered AI, chosen while the article is being added** — the add
 * page's tick box, docs/plans/261002k-high-powered-ai-at-import.md.
 *
 * It calls the same `PUT /api/article/:slug/high-power` as the switch on
 * `/metadata` (src/web/HighPowerSwitch.tsx), so the price, the once-per-article
 * charge and every refusal are the server's and unchanged. What is new is only
 * *when*: the job runner reads the column as each step starts (`readStepPower`,
 * src/jobs.ts), so a switch that lands before `structure` moves the whole
 * import to Opus — before `extract`, for a PDF, whose front matter is read on
 * the capable tier.
 *
 * Three facts shape this, each from GPT Sol's plan review:
 *
 *  - **The page knows the slug before the row exists.** A job reports
 *    `running` before its claim opens the draft that creates the article row,
 *    so a `404` while the job is still queued or running means *not yet* and
 *    is retried; once the job has ended it is a real answer.
 *  - **The main modes must not overtake it.** `settle` is what the page awaits
 *    before queueing them, and it sends a still-waiting intent there and then,
 *    against the completion's slug — which also covers a completion that never
 *    had a job.
 *  - **Whether it was late cannot be known exactly** from a polled job (power
 *    is read before a step is marked running), so `lateRisk` is a cautious
 *    *may*, captured when the switch answers.
 *
 * Framework-free, with the request injected, so a test drives every answer
 * (tests/add-high-power.test.ts); `AddHighPower.tsx` draws it.
 */

import { statusOf } from "./lib/api.js";

/** One state at a time: the reader's intent, the request, or the server's last answer. */
export type HighPowerAtAdd =
  | { kind: "off" }
  /** Wanted, and not sent yet: no slug, or the row was not there yet. */
  | { kind: "waiting" }
  | { kind: "saving"; on: boolean }
  | { kind: "on"; since: string; lateRisk: boolean }
  /** The server answered no, and nothing changed. */
  | { kind: "refused"; message: string }
  /** No answer arrived — the write may or may not have committed. */
  | { kind: "unknown"; message: string };

export type PutHighPower = (slug: string, on: boolean) => Promise<{ highPowerSince: string | null }>;

/** How long a `404` waits before asking again, while the job is still alive. */
export const NOT_YET_RETRY_MS = 1000;

/**
 * **How many *not yet*s before giving up** — five minutes at the default. A job
 * cancelled before its claim never creates the row, and the page that would
 * have said so may be gone, so the loop needs an end of its own.
 */
export const MAX_NOT_YET = 300;

export class HighPowerIntent {
  private state: HighPowerAtAdd = { kind: "off" };
  private slug: string | null = null;
  /** Whether the job may still create the row — a `404` is then *not yet*. */
  private jobAlive = true;
  private lateRisk = false;
  private inFlight: Promise<void> | null = null;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private notYet = 0;
  private disposed = false;
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly put: PutHighPower,
    private readonly retryMs: number = NOT_YET_RETRY_MS,
  ) {}

  get = (): HighPowerAtAdd => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /**
   * **The page's job, as it now stands** — called on every render. `slug` is
   * `job.slug` or the completion's, never one derived from the address.
   */
  observe(slug: string | null, jobAlive: boolean, lateRisk: boolean): void {
    this.slug = slug;
    this.jobAlive = jobAlive;
    this.lateRisk = lateRisk;
    this.kick();
  }

  /** The tick box. Ignored while a request is in flight (the box is disabled then). */
  want(on: boolean): void {
    if (this.disposed || this.state.kind === "saving") return;
    if (on) {
      if (this.state.kind === "on") return;
      this.set({ kind: "waiting" });
      this.kick();
      return;
    }
    switch (this.state.kind) {
      case "waiting":
        /* Never sent, so nothing to undo and nothing charged. */
        this.clearRetry();
        this.set({ kind: "off" });
        return;
      case "on":
      case "unknown":
        /* `unknown` may be on server-side; switching off is free either way. */
        if (this.slug) this.send(this.slug, false);
        else this.set({ kind: "off" });
        return;
      default:
        this.set({ kind: "off" });
    }
  }

  /**
   * **Before the main modes are queued.** The import has finished, so the row
   * exists: a still-waiting intent is sent now against `slug`, and a `404` is
   * final. Resolves when no request is in flight; never rejects.
   */
  settle(slug: string): Promise<void> {
    this.slug = slug;
    this.jobAlive = false;
    this.clearRetry();
    this.kick();
    return this.inFlight ?? Promise.resolve();
  }

  /** A new address, or the page gone: stop retrying. A request in flight still settles. */
  dispose(): void {
    this.disposed = true;
    this.clearRetry();
  }

  private kick(): void {
    if (this.disposed || this.state.kind !== "waiting" || this.inFlight || this.retry) return;
    if (this.slug) this.send(this.slug, true);
  }

  private send(slug: string, on: boolean): void {
    this.set({ kind: "saving", on });
    this.inFlight = this.put(slug, on).then(
      (body) => {
        this.inFlight = null;
        this.set(
          body.highPowerSince
            ? { kind: "on", since: body.highPowerSince, lateRisk: this.lateRisk }
            : { kind: "off" },
        );
      },
      (e: unknown) => {
        this.inFlight = null;
        const message = e instanceof Error ? e.message : "The request failed.";
        const status = statusOf(e);
        if (on && status === 404 && this.jobAlive && !this.disposed && this.notYet < MAX_NOT_YET) {
          this.notYet += 1;
          /* The claim has not opened the draft yet. */
          this.set({ kind: "waiting" });
          this.retry = setTimeout(() => {
            this.retry = null;
            this.kick();
          }, this.retryMs);
          return;
        }
        this.set(status !== null ? { kind: "refused", message } : { kind: "unknown", message });
      },
    );
  }

  private clearRetry(): void {
    if (this.retry) clearTimeout(this.retry);
    this.retry = null;
  }

  private set(next: HighPowerAtAdd): void {
    this.state = next;
    for (const listener of this.listeners) listener();
  }
}

/**
 * **Whether some of this import may already have run on the standard model**
 * — any step other than `fetch` and `blocks` started. `extract` counts because
 * a PDF's is capable-tier; for a web page that makes the line a *may* it
 * cannot sharpen, and the copy says *may*.
 */
export function mayHaveStartedOnStandard(
  steps: readonly { name: string; status: string }[] | undefined,
): boolean {
  return (steps ?? []).some(
    (s) => s.name !== "fetch" && s.name !== "blocks" && s.status !== "pending",
  );
}
