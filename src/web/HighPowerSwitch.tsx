/**
 * **High-powered AI, one article at a time** — the switch on `/metadata` that
 * moves most of this article's capable-tier calls from Claude Sonnet to Claude
 * Opus. Simple already uses Opus for every article (plan 261001p).
 * docs/project/high-powered-ai.md; the build is
 * docs/plans/260930f-high-powered-ai-per-article.md, decision 8 and stage 3.
 *
 * **Drawn for every owner, on their own article** — `/metadata` is owner-only
 * (a visitor gets `PublicMetadataPage`). The gate and the charge are the
 * server's: `PUT /api/article/:slug/high-power` is owner-scoped, and switching on
 * charges one more article's worth against the reader's allowance (half while
 * the article is public), once, never refunded — src/billing/admission.ts. The
 * administrator is exempt as with ingests; `isAdmin` here only adds a line
 * saying so, and decides nothing (src/admin.ts).
 *
 * **The text states the price in articles and never in money.** Greg,
 * 2026-09-30: *"i don't want any regular users to know how much AI processing of
 * their articles costs"*. The v1 line said Opus ran "at about twice Sonnet's token
 * prices", which is exactly that. docs/plans/260930k-high-power-for-readers-and-cost-only-for-admins.md.
 *
 * **The box shows the server's last answer, never the click.** It is controlled
 * by `since`, which changes only when the `PUT` answers or the page's metadata
 * read brings a new value — so a refusal leaves it exactly as it was, with the
 * reason beside it, rather than reading "on" over an article that is not.
 * Disabled until the metadata has answered (there is nothing to toggle yet: an
 * enabled box drawn from a default could send "off" over an "on" we had not
 * read) and while a write is in flight, the same two rules as the experimental
 * switch in SettingsSection.tsx.
 */
import { useState } from "react";
import { TriangleAlert, Zap } from "lucide-react";

import { isAdmin } from "../admin.js";
import { apiFetch, readJson, statusOf } from "./lib/api.js";
import { exactly } from "./relative-time.js";
import { useSession } from "./useSession.js";

export function HighPowerSwitch({
  slug,
  since: read,
  onChanged,
}: {
  slug: string;
  /**
   * `highPowerSince` off `GET /api/metadata/:slug` — `undefined` until that read
   * has answered, `null` for off, a timestamp for on.
   */
  since: string | null | undefined;
  /** The page's `refresh`, so everything else on it that reads the column agrees. */
  onChanged: () => void;
}) {
  const { user } = useSession();
  const [since, setSince] = useState(read);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<{
    kind: "refused" | "unknown";
    message: string;
  } | null>(null);

  /* **A new read from the page wins, and only a new one.** Adjusted during
     render when `read` itself changes — not in an effect keyed on `saving` too,
     which is what this was first, and which the browser check caught: when a
     save finished, the effect re-applied the read from *before* the write, so
     switching off drew "On since …" again until the refresh landed. A read
     that lands mid-save is dropped: the write's answer is newer. */
  const [lastRead, setLastRead] = useState(read);
  if (read !== lastRead) {
    setLastRead(read);
    if (!saving) {
      setSince(read);
      setError(null);
    }
  }

  const exempt = isAdmin(user?.id);

  const loaded = since !== undefined;

  function set(on: boolean): void {
    setSaving(true);
    setError(null);
    apiFetch(`/api/article/${encodeURIComponent(slug)}/high-power`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ on }),
    })
      .then((r) => readJson<{ highPowerSince: string | null }>(r))
      .then((body) => {
        setSince(body.highPowerSince);
        onChanged();
      })
      .catch((e: unknown) => {
        const message = e instanceof Error ? e.message : "The request failed.";
        if (statusOf(e) !== null) {
          /* The server answered with a refusal, so the old state is still the
             latest answer it gave us. */
          setError({ kind: "refused", message });
        } else {
          /* A connection can disappear after the transaction commits. Do not
             claim that means "not saved": ask the ordered page read which
             state the server now holds. */
          setError({ kind: "unknown", message });
          onChanged();
        }
      })
      .finally(() => setSaving(false));
  }

  return (
    <div data-high-power className="tw:mb-3 tw:flex tw:flex-col tw:gap-1">
      <label className="tw:flex tw:items-center tw:gap-2 tw:text-sm tw:text-foreground">
        <input
          type="checkbox"
          /* The native box, tinted — as SettingsSection.tsx's experimental
             switch, and for the reason written there. */
          className="tw:[accent-color:var(--highlight-text)]"
          checked={Boolean(since)}
          disabled={!loaded || saving}
          onChange={(e) => set(e.target.checked)}
        />
        <Zap size={13} className="tw:text-ink-faint" />
        <span>High-powered AI</span>
      </label>
      <p className="tw:m-0 tw:text-xs tw:text-ink-faint">
        Uses a stronger AI model (Claude Opus) for this article — better on difficult pieces. Plain-words
        summaries use it already.{" "}
        {exempt
          ? "Administrator: no charge."
          : "Switching it on counts as one more article against your allowance (half of one while the article is shared publicly). Switching off doesn't give it back, and switching on again is free."}{" "}
        Only later runs use it — nothing re-runs by itself. Use a mode&apos;s <em>Run it again</em>{" "}
        below to redo it.
      </p>
      <p className="tw:m-0 tw:text-xs tw:text-ink-faint" aria-live="polite">
        {error ? (
          <span className="tw:inline-flex tw:items-center tw:gap-1 tw:text-highlight-text">
            <TriangleAlert size={12} />
            {error.kind === "refused" ? "Not saved" : "Couldn't confirm that"} — {error.message}
          </span>
        ) : saving ? (
          "Saving…"
        ) : since ? (
          `On since ${exactly(since) ?? since}.`
        ) : loaded ? (
          "Off."
        ) : null}
      </p>
    </div>
  );
}
