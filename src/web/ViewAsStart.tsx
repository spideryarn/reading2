/**
 * **Asking why, then opening the tab** — what *View as* on /admin/users and
 * *View as owner* on /admin/articles open.
 * docs/plans/261019n-admin-sees-other-users-articles-and-views-as-them.md
 * § Part 3, Client 5.
 *
 * An inline section above the table, drawn the way *Transfer…* asks
 * (AdminArticlesPage.tsx § `TransferConfirm`), with the same field and button
 * classes (admin-vouchers-parts.tsx; controls.md § Controls that do the same
 * job look the same). The reason is required and at most 300 characters: the
 * server stores it on the session row, which is the whole audit.
 *
 * On success the server's nonce goes into a **new tab's fragment**, opened
 * `noopener` so the new tab has no handle back to this one, and the fragment
 * is gone from its address before anything else on it runs (index.html §
 * `view-as-boot`). The link under the button is the same address, for a
 * browser that blocked the window because it opened after a round trip rather
 * than straight from the press.
 */
import { useState } from "react";

import { apiFetch, readJson } from "./lib/api.js";
import { isViewAsNonce } from "./lib/view-as.js";
import { BUTTON, INPUT, Refusal } from "./admin-controls.js";

/** The server's limit on the reason, and this box's. */
const VIEW_AS_REASON_MAX = 300;

/** The address a view-as tab is opened at. */
function viewAsHref(nonce: string): string {
  return `/#view-as=${nonce}`;
}

/** How the tab is opened: a new tab with no handle back to this one. */
const viewAsWindow = {
  open: (href: string): void => {
    window.open(href, "_blank", "noopener");
  },
};

export function ViewAsStart({
  subjectId,
  label,
  onCancel,
}: {
  /** The account to view as: a user id. */
  subjectId: string;
  /** Who that is, as the page already names them. */
  label: string;
  onCancel: () => void;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [opened, setOpened] = useState<string | null>(null);
  const trimmed = reason.trim();

  async function start() {
    if (trimmed === "" || trimmed.length > VIEW_AS_REASON_MAX) return;
    setBusy(true);
    setMessage(null);
    try {
      const body = await readJson<{ nonce?: unknown }>(
        await apiFetch("/api/admin/view-as", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ subject: subjectId, reason: trimmed }),
        }),
      );
      if (!isViewAsNonce(body.nonce)) {
        setMessage("The server's answer did not include a usable session, so nothing was opened.");
        return;
      }
      const href = viewAsHref(body.nonce);
      viewAsWindow.open(href);
      setOpened(href);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      aria-label="View as this reader"
      className="tw:mb-6 tw:rounded-md tw:border tw:border-border tw:bg-card tw:p-4 tw:text-sm"
    >
      <h2 className="tw:mb-2 tw:text-base tw:font-medium">View as {label}</h2>
      <p className="tw:mb-3 tw:text-muted-foreground">
        Opens a new tab showing their shelf and articles as they see them, read-only, for 30 minutes. Nothing
        there can change or spend anything. The reason is kept with the record of this view.
      </p>
      {message && <Refusal message={message} />}
      {opened ? (
        <p role="status" className="tw:mb-3">
          Opened in a new tab. If no tab appeared,{" "}
          <a href={opened} target="_blank" rel="noopener noreferrer" className="tw:underline">
            open it here
          </a>
          .
        </p>
      ) : (
        <label className="tw:mb-3 tw:flex tw:flex-wrap tw:items-center tw:gap-2">
          <span>Why</span>
          <input
            className={`${INPUT} tw:min-w-0 tw:flex-1`}
            value={reason}
            maxLength={VIEW_AS_REASON_MAX}
            enterKeyHint="go"
            onChange={(e) => setReason(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void start();
            }}
            disabled={busy}
            placeholder="e.g. their report spya-… says the shelf is empty"
            aria-label="Why you are viewing as this reader"
          />
        </label>
      )}
      <div className="tw:flex tw:flex-wrap tw:gap-2">
        {!opened && (
          <button
            type="button"
            className={BUTTON}
            disabled={busy || trimmed === "" || trimmed.length > VIEW_AS_REASON_MAX}
            onClick={() => void start()}
          >
            {busy ? "Starting…" : "View as"}
          </button>
        )}
        <button type="button" className={BUTTON} disabled={busy} onClick={onCancel}>
          {opened ? "Close" : "Cancel"}
        </button>
      </div>
    </section>
  );
}
