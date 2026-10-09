/**
 * **The public shelf's topic pills, on /admin**: whether `/read/public` is
 * showing them, and a Rebuild for the one case that does not run by itself.
 *
 * Filing a newly shared article is automatic at any size, and so is a whole
 * rebuild while the public shelf has 20 articles or fewer. Past 20 a rebuild
 * can cost more than Greg's half-cent bar, so it waits for this button, and
 * this panel says when one is due. Spent as the site account, and shown on
 * /admin/costs as *the site*. Plan
 * docs/plans/261008j-public-shelf-topic-pills-automatic-billed-to-the-site.md;
 * approved by Greg as "q-p5h2a7 A", 2026-10-09.
 */
import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import type { PublicShelfTopicsStatus } from "../types.js";
import { apiFetch, readJson } from "./lib/api.js";
import { describeFetchFailure } from "./lib/describe-failure.js";
import { exactly, timeAgo } from "./relative-time.js";
import { useNow } from "./useNow.js";

const PATH = "/api/admin/public-shelf-topics";

const BUTTON =
  "tw:inline-flex tw:h-7 tw:items-center tw:gap-1 tw:rounded-full tw:border tw:border-border tw:bg-transparent tw:px-3 tw:text-xs tw:text-muted-foreground tw:hover:border-highlight/50 tw:hover:text-foreground tw:disabled:opacity-50";

/** The one sentence that says where the pills stand. */
export function statusSentence(s: PublicShelfTopicsStatus, ago: string | null): string {
  if (s.working) return "Being worked out now.";
  if (s.cards < 8) return `Not shown: the public shelf has ${s.cards} articles, and topics need 8.`;
  if (s.rethoughtAt === null) return s.rebuildDue ? "None yet, and a rebuild is due." : "None yet.";
  const when = ago ? `last rebuilt ${ago}` : "rebuilt";
  if (s.withheld) return `Hidden: an article they were made from is no longer shared. ${s.rebuildDue ? "A rebuild is due." : "They rebuild by themselves."} (${when})`;
  if (s.rebuildDue) return `Shown, and a rebuild is due: the shelf has changed since they were ${when}.`;
  return `Shown, ${when}, with ${s.filed} of ${s.cards} articles sorted.`;
}

export function AdminPublicTopics() {
  const [status, setStatus] = useState<PublicShelfTopicsStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);
  const now = useNow();

  const ask = useCallback(async (method: "GET" | "POST") => {
    setBusy(true);
    try {
      const answer = await readJson<PublicShelfTopicsStatus>(
        await apiFetch(method === "GET" ? PATH : `${PATH}/rebuild`, { method }),
      );
      if (mounted.current) {
        setStatus(answer);
        setError(null);
      }
    } catch (e) {
      if (mounted.current) setError(describeFetchFailure(e as Error));
    } finally {
      if (mounted.current) setBusy(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void ask("GET");
    return () => {
      mounted.current = false;
    };
  }, [ask]);

  const ago = status?.rethoughtAt ? timeAgo(status.rethoughtAt, now) : null;
  return (
    <section aria-labelledby="admin-public-topics" className="tw:mt-8 tw:rounded-lg tw:border tw:border-border tw:bg-card tw:p-4">
      <h2 id="admin-public-topics" className="tw:m-0 tw:text-base tw:font-normal tw:text-foreground">
        Public shelf topics
      </h2>
      <p className="tw:mt-1 tw:mb-3 tw:text-xs tw:text-muted-foreground">
        The topic pills on /read/public. New shares are sorted in by themselves, and so is a full
        rebuild while there are {status?.autoMax ?? 20} public articles or fewer. Past that a rebuild
        waits for this button. Billed to the site.
      </p>
      {error && <p className="tw:mb-3 tw:text-sm tw:text-danger">{error}</p>}
      {status && (
        <p className="tw:mb-3 tw:text-sm tw:text-foreground" title={status.rethoughtAt ? exactly(status.rethoughtAt) : undefined}>
          {statusSentence(status, ago ?? null)}
        </p>
      )}
      <div className="tw:flex tw:flex-wrap tw:gap-2">
        {/* Only when a rebuild is due: pressed otherwise it would do nothing,
            and a button that does nothing looks broken. */}
        {status?.rebuildDue && !status.working && (
          <button type="button" className={BUTTON} disabled={busy} onClick={() => void ask("POST")}>
            Rebuild
          </button>
        )}
        <button type="button" className={BUTTON} disabled={busy} onClick={() => void ask("GET")} aria-label="Refresh the public shelf topics">
          <RefreshCw size={12} aria-hidden="true" />
          {busy ? "Loading…" : "Refresh"}
        </button>
      </div>
    </section>
  );
}
