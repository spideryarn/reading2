/**
 * **An author gift for the article you are reading, without leaving it** —
 * the command bar's *Gift this to its author*, the administrator's alone.
 * Greg, 2026-10-23 (`spya-v88mga`): *"if there's a way to do this without
 * leaving the article, that would be even better."* Plan
 * docs/plans/261024n-admin-commands-in-the-command-bar-and-an-author-gift-without-leaving-the-article.md
 * § D2.
 *
 * It is the Give form's ticked half (AdminVouchersPage.tsx § `DraftFields`)
 * with the article already chosen: the same rights tick, the same
 * *High-powered AI* box ticked by default, and the same request through the
 * same hook (`useAdminAuthorGifts` § `ensure`). When the article already has a
 * gift it says how far that has got instead, and links to its card. **Nothing
 * is emailed from here**: Send stays on the Drafts card, beside the exact
 * email it would send.
 *
 * **Loaded on the first press and not before** (CommandBar.tsx §
 * `openAuthorGift`), so no reader downloads it and no request is made until
 * the administrator asks (plan § F3). The server is the gate either way:
 * every request here is under `/api/admin`.
 */
import { useLayoutEffect, useRef, useState } from "react";
import { Gift } from "lucide-react";

import { AUTHOR_LOOKUP_MAX_SEARCHES, type AdminAuthorGift, type AuthorGiftStatus, authorGiftPath } from "../admin-author-gifts.js";
import { SHARING_RIGHTS_CONFIRM } from "../messages.js";
import { Button } from "@/components/ui/button";
import { lookupPending, useAdminAuthorGifts } from "./useAdminAuthorGifts.js";
import { useVisualViewport } from "./useVisualViewport.js";

export const AUTHOR_GIFT_DIALOG_TITLE = "Gift this to its author";
export const AUTHOR_GIFT_DIALOG_DRAFT = "Draft a gift for the author";
export const AUTHOR_GIFT_DIALOG_OPEN = "Open it in Gift vouchers";

/** What *Draft* will do, in order. */
export const AUTHOR_GIFT_DIALOG_STEPS = [
  "A private link is made, if the article has none.",
  "Its main modes are queued — on Opus, if High-powered AI is ticked.",
  `A web lookup looks for the author and an email address, using up to ${AUTHOR_LOOKUP_MAX_SEARCHES} searches.`,
  "A draft gift appears in Gift vouchers. Nothing is sent until you press Send there.",
] as const;

const STATUS_WORDS: Record<AuthorGiftStatus, string> = {
  draft: "A draft gift is waiting for you to review and send.",
  sending: "This gift is being sent.",
  sent: "This gift has been sent.",
  discarded: "This article's gift was discarded. Restore or delete it in Gift vouchers.",
};

export function AuthorGiftDialog({ slug, open, onClose }: { slug: string; open: boolean; onClose: () => void }) {
  const gifts = useAdminAuthorGifts();
  /* The gift `ensure` answered with, so a gift whose frozen slug is not this
     address's still shows once drafted. */
  const [madeId, setMadeId] = useState<string | null>(null);
  const [rights, setRights] = useState(false);
  const [highPower, setHighPower] = useState(true);
  const [busy, setBusy] = useState(false);
  /* State disables what is drawn; this closes the same-render gap before
     React commits it, so two clicks are still one POST. */
  const drafting = useRef(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  const gift = gifts.gifts?.find((g) => g.id === madeId || g.starter.slug === slug) ?? null;

  async function draft() {
    if (!rights || drafting.current) return;
    drafting.current = true;
    setBusy(true);
    try {
      const answer = await gifts.ensure(slug, { highPower });
      if (answer.kind === "refused") {
        setRefusal(answer.message);
        return;
      }
      setRefusal(null);
      setMadeId(answer.id);
    } finally {
      drafting.current = false;
      setBusy(false);
    }
  }

  const ref = useRef<HTMLDialogElement>(null);
  /* PurposePrompt.tsx § closingOurselves: our own `close()` fires the same
     `close` event Escape does. */
  const closingOurselves = useRef(false);
  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      closingOurselves.current = false;
      dialog.showModal();
    } else if (!open && dialog.open) {
      closingOurselves.current = true;
      dialog.close();
    }
  }, [open]);
  const visible = useVisualViewport(open);

  return (
    // The click is the backdrop, whose keyboard equivalent is Escape — which
    // <dialog> implements itself. Lightbox.tsx carries the same exemption.
    // biome-ignore lint/a11y/useKeyWithClickEvents: Escape is the backdrop's keyboard twin, native to <dialog>
    <dialog
      ref={ref}
      className="author-gift-dialog tw:m-auto tw:w-[min(32rem,calc(100vw-2rem))] tw:rounded-lg tw:border tw:border-rule-strong tw:bg-surface-raised tw:p-0 tw:text-ink"
      aria-labelledby="author-gift-dialog-title"
      style={visible === null ? undefined : { top: `${visible.offsetTop}px`, maxHeight: `${visible.height}px`, bottom: "auto" }}
      onClose={() => {
        if (closingOurselves.current) return;
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <div className="tw:flex tw:flex-col tw:gap-3 tw:p-4 tw:text-sm">
        <h2 id="author-gift-dialog-title" className="tw:m-0 tw:flex tw:items-center tw:gap-2 tw:text-base tw:font-semibold">
          <Gift size={16} className="tw:text-ink-faint" />
          {AUTHOR_GIFT_DIALOG_TITLE}
        </h2>

        {gifts.gifts === null && gifts.error === null && <p className="tw:m-0 tw:text-ink-faint">Checking for a gift already made…</p>}

        {gifts.gifts === null && gifts.error !== null && (
          <div className="tw:flex tw:flex-wrap tw:items-center tw:gap-2">
            <p className="tw:m-0 tw:text-danger">Couldn’t read the author gifts. {gifts.error}</p>
            <Button type="button" variant="outline" size="sm" onClick={() => void gifts.reload()} disabled={gifts.loading}>
              Retry
            </Button>
          </div>
        )}

        {gift !== null && <GiftState gift={gift} />}

        {gifts.gifts !== null && gift === null && madeId === null && (
          <form
            className="tw:flex tw:flex-col tw:gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void draft();
            }}
          >
            <ul className="tw:m-0 tw:pl-5 tw:text-ink-faint">
              {AUTHOR_GIFT_DIALOG_STEPS.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ul>
            <label className="tw:flex tw:items-start tw:gap-2">
              <input type="checkbox" checked={rights} disabled={busy} onChange={(e) => setRights(e.target.checked)} />
              <span>{SHARING_RIGHTS_CONFIRM}</span>
            </label>
            <label className="tw:flex tw:items-start tw:gap-2">
              <input type="checkbox" checked={highPower} disabled={busy} onChange={(e) => setHighPower(e.target.checked)} />
              <span>High-powered AI for this article (Opus for what is made from now on)</span>
            </label>
            <div>
              <Button type="submit" size="sm" disabled={busy || !rights}>
                {busy ? "Drafting…" : AUTHOR_GIFT_DIALOG_DRAFT}
              </Button>
            </div>
          </form>
        )}

        {/* Drafted, but the read after it failed: the gift exists, so say so
            rather than offering a second Draft. */}
        {gift === null && madeId !== null && (
          <p className="tw:m-0">
            The gift was drafted.{" "}
            <a href={authorGiftPath(madeId)} target="_blank" rel="noreferrer">
              {AUTHOR_GIFT_DIALOG_OPEN}
            </a>
            {gifts.error !== null && <span className="tw:text-danger"> (Couldn’t read it back. {gifts.error})</span>}
          </p>
        )}

        {refusal !== null && <p className="tw:m-0 tw:text-danger">{refusal}</p>}

        <div className="tw:flex tw:justify-end">
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </dialog>
  );
}

/** How far this article's gift has got, and the way to its card. */
function GiftState({ gift }: { gift: AdminAuthorGift }) {
  const running = gift.lookups.some((l) => lookupPending(l, Date.now()));
  return (
    <div className="tw:flex tw:flex-col tw:gap-1" data-author-gift-state={gift.status}>
      <p className="tw:m-0">{STATUS_WORDS[gift.status]}</p>
      {running && <p className="tw:m-0 tw:text-ink-faint">Looking for the author and their address…</p>}
      {!running && gift.status === "draft" && (
        <p className="tw:m-0 tw:text-ink-faint">
          {gift.email === null ? "No address yet." : `To: ${gift.recipientName === null ? "" : `${gift.recipientName} `}<${gift.email}>`}
        </p>
      )}
      <p className="tw:m-0">
        <a href={authorGiftPath(gift.id)} target="_blank" rel="noreferrer">
          {AUTHOR_GIFT_DIALOG_OPEN}
        </a>
      </p>
    </div>
  );
}
