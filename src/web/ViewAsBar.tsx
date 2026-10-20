/**
 * **The bar across the top of a tab that is viewing the app as another
 * reader**, and the two small pieces of copy that go with it.
 * docs/plans/261019n-admin-sees-other-users-articles-and-views-as-them.md
 * § Part 3, Client 4, and round 1 F5 / round 2 R2-6.
 *
 *     Viewing as alice@example.com · read-only · 27 min left · [Stop]
 *
 * Mounted in main.tsx beside `OfflineStrip`, outside `App`, so every page the
 * tab can draw has it — `App` returns early down a dozen paths, and a page that
 * forgot it would show the subject's articles with nothing saying whose. It is
 * drawn from the very first render, before `/current` has answered, so there is
 * no moment with the subject's content on screen and no bar above it.
 *
 * Stop is the tab's one write (lib/api.ts § `endViewAs`). When it lands, when
 * the server's `expiresAt` passes, or when any request hears 410
 * `[view-as-ended]`, the tab closes or, if the browser keeps it open, goes to
 * the administrator's own shelf (lib/view-as.ts § `endViewAsTab`). If Stop
 * cannot reach the server, nothing is dropped: the bar says so and offers
 * Retry, and the view is still the server's to end.
 */
import { useEffect, useState, useSyncExternalStore } from "react";

import { endViewAs } from "./lib/api.js";
import { endViewAsTab, onViewAsEnd, viewAsEnded, viewAsNonce } from "./lib/view-as.js";
import { useNow } from "./useNow.js";
import { startViewAsSession, useViewAsState } from "./view-as-session.js";

/** Whole minutes left, never below zero. `1 min left` in the last minute, not `0`. */
export function minutesLeft(expiresAt: number, now: number): number {
  return Math.max(0, Math.ceil((expiresAt - now) / 60_000));
}

function subscribeEnded(listener: () => void): () => void {
  return onViewAsEnd(listener);
}

type Stopping = { kind: "idle" } | { kind: "busy" } | { kind: "failed"; message: string };

export function ViewAsBar() {
  /* Constant for the page's life (lib/view-as.ts), so this early return never
     changes which hooks run. */
  if (viewAsNonce() === null) return null;
  return <TheBar />;
}

function TheBar() {
  const session = useViewAsState();
  const ended = useSyncExternalStore(subscribeEnded, viewAsEnded, viewAsEnded);
  /* Every fifteen seconds: the minute shown should turn over close to when
     the server's does, not up to a minute late. */
  const now = useNow(15_000);
  const [stopping, setStopping] = useState<Stopping>({ kind: "idle" });

  useEffect(() => startViewAsSession(), []);

  async function stop() {
    setStopping({ kind: "busy" });
    const answer = await endViewAs();
    if (answer.kind === "ended") {
      endViewAsTab();
      return;
    }
    setStopping({ kind: "failed", message: answer.message });
  }

  const who =
    session.kind === "live" ? (
      <span className="tw:min-w-0 tw:truncate">
        Viewing as{" "}
        <strong className="tw:font-semibold">{session.subject.subjectEmail ?? session.subject.subjectId}</strong>
      </span>
    ) : (
      <span className="tw:min-w-0 tw:truncate">Viewing as another reader</span>
    );

  let status: string;
  if (ended) status = "This view has ended. Closing…";
  else if (session.kind === "live") {
    const left = minutesLeft(session.subject.expiresAt, now);
    status = `${left} min left`;
  } else if (session.kind === "failed") status = `Couldn’t check whose account this is. ${session.message}`;
  else status = "Checking whose account this is…";

  return (
    <section
      aria-label="Viewing as another reader"
      data-testid="view-as-bar"
      className="view-as-bar tw:flex tw:items-center tw:gap-2 tw:font-sans tw:text-xs tw:whitespace-nowrap"
    >
      {who}
      <span aria-hidden="true">·</span>
      <span>read-only</span>
      <span aria-hidden="true">·</span>
      <span className="tw:min-w-0 tw:truncate" role="status" aria-live="polite">
        {stopping.kind === "failed" ? `Stop did not go through. ${stopping.message}` : status}
      </span>
      {!ended && (
        <button
          type="button"
          onClick={() => void stop()}
          disabled={stopping.kind === "busy"}
          className="tw:ml-auto tw:shrink-0 tw:rounded-full tw:border tw:border-current tw:bg-transparent tw:px-3 tw:py-0.5 tw:text-xs tw:font-medium tw:text-current tw:disabled:opacity-60"
        >
          {stopping.kind === "busy" ? "Stopping…" : stopping.kind === "failed" ? "Retry" : "Stop"}
        </button>
      )}
    </section>
  );
}

/**
 * **A page the tab will not draw.** Round 1 F3: only the shelf, an article and
 * its metadata page are drawn while viewing as; every other page — account,
 * add, upload, consent, password, live, admin, pricing — has writes that do
 * not all go through `apiFetch`, so it is not drawn at all. App.tsx §
 * `SignedIn` decides which, from router.ts § `VIEW_AS_ALLOWED`.
 */
export function NotWhileViewingAs() {
  return (
    <main className="tw:mx-auto tw:max-w-xl tw:px-6 tw:pt-[calc(3.5rem_+_var(--safe-top))] tw:font-sans tw:text-sm">
      <p data-testid="not-while-viewing-as">Not available while viewing as another reader.</p>
      <p className="tw:mt-2 tw:text-muted-foreground">
        Their shelf and their articles are. Use Stop in the bar above to go back to your own account.
      </p>
    </main>
  );
}

/**
 * **One line where a panel would otherwise just not be there**: the server
 * refuses its request while viewing as (plan § The allowlist — topics, the
 * plan card), so the client does not ask, and says why instead of drawing an
 * empty space that reads as "they have none".
 */
export function HiddenWhileViewingAs({ what }: { what: string }) {
  return (
    <p data-testid="hidden-while-viewing-as" className="tw:mb-3 tw:mt-0 tw:text-xs tw:text-muted-foreground">
      {what}: hidden while viewing as another reader.
    </p>
  );
}
