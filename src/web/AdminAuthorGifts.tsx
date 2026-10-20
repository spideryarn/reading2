/**
 * **Author gifts** on `/admin/vouchers` — drafts of a gift voucher for the
 * author of one of the administrator's own articles, filled in by a web-search
 * lookup, and turned into a voucher only when Greg presses *Send*.
 *
 * Greg, 2026-10-09: *"it would create a gift voucher that's ready and
 * populated but hasn't been sent. … And so then it would be easy for me to then
 * say, okay, great, I'm gonna click send on the gift voucher."* Plan
 * docs/plans/261010c-author-gift-draft-voucher-from-the-add-page.md (§
 * Revision 3 wins); docs/project/admin.md § `/admin/vouchers`.
 *
 * Each gift says where it has got to in plain words, where its address and
 * name came from (a lookup and the page it was seen on, or typed by hand), the
 * notes in full, and every lookup with what it found and what it cost. That is
 * what Greg reads before he presses *Send*: a planted address reaches, at
 * worst, a draft he reads beside the URL it came from (D7).
 *
 * Not a table, unlike the voucher list under *Given*: a gift carries notes
 * that can run to pages and a list of lookups, which a row would squeeze.
 *
 * **Since plan 261020ab this is the page's *Drafts* tab**, and drafting is the
 * page's one *New gift* form, ticked (AdminVouchersPage.tsx § `CreateForm`):
 * the hook is the page's, so the form's draft lands in this list. **A finished
 * gift — sent or discarded — is one line, shut**, below the ones still waiting
 * (Greg, 2026-10-20, spya-vcnmrd: *"At the very least collapse it"*).
 *
 * **Admin-only page**, so a lookup's cost is drawn in dollars
 * (`formatCostNanos`); tests/no-ai-cost-for-readers.test.ts scans copy for a
 * written figure, and this file writes none.
 */
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { RefreshCw } from "lucide-react";

import { formatCostNanos } from "../admin.js";
import type { AdminAuthorGift, AdminAuthorLookup, AuthorGiftStatus } from "../admin-author-gifts.js";
import { freeArticles, RECIPIENT_NAME_MAX, cleanRecipientName } from "../admin-vouchers.js";
import { addressBoxChange } from "../email-address.js";
import { SHARING_RIGHTS_CONFIRM } from "../messages.js";
import { BUTTON, INPUT, Refusal, StarterOwnerLine, TEXTAREA } from "./admin-vouchers-parts.js";
import { Button } from "./components/ui/button.js";
import { exactly } from "./relative-time.js";
import { readHref } from "./router.js";
import { type AuthorGiftPatchInput, lookupPending, type UseAdminAuthorGifts } from "./useAdminAuthorGifts.js";
import { useNow } from "./useNow.js";
import { voiceClass } from "./voice.js";

/** More searches than the prompt allows (D4, D7): flagged on the run. */
const SEARCHES_ASKED = 3;

/** The gift `?gift=<id>` names, or null. A UUID or nothing, so the address cannot put text in an id. */
export function giftIdOrNull(id: string | null): string | null {
  return id !== null && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) ? id : null;
}

/** The element id a gift's card carries, so *Draft a gift* can scroll to one that already existed. */
export function authorGiftAnchor(id: string): string {
  return `author-gift-${id}`;
}

/** Where a gift has got to, in Greg's words. */
export function giftStatusWords(gift: Pick<AdminAuthorGift, "status" | "discardedAt">): string {
  const status: AuthorGiftStatus = gift.status;
  switch (status) {
    case "draft":
      return "Draft — not sent";
    case "sending":
      return "Sending didn't finish — press Send again";
    case "sent":
      return "Sent — its voucher is under Given";
    case "discarded": {
      const when = gift.discardedAt === null ? undefined : exactly(gift.discardedAt);
      return when ? `Discarded on ${when}` : "Discarded";
    }
    default: {
      const never: never = status;
      return never;
    }
  }
}

/** Sent or discarded: nothing left to do, so the card folds to its line (plan 261020ab). */
function finished(gift: Pick<AdminAuthorGift, "status">): boolean {
  return gift.status === "sent" || gift.status === "discarded";
}

/** How many gifts wait on Greg — drafts and half-sent ones — for the *Drafts* tab's count. */
export function giftsWaiting(gifts: readonly AdminAuthorGift[] | null): number {
  return gifts === null ? 0 : gifts.filter((g) => !finished(g)).length;
}

/** What one lookup came to, in Greg's words. `now` decides whether an unfinished one is still running. */
export function lookupOutcomeWords(lookup: AdminAuthorLookup, now: number): string {
  if (lookup.outcome === null) return lookupPending(lookup, now) ? "Looking…" : "Did not finish";
  switch (lookup.outcome) {
    case "address":
      return "Address found";
    case "author":
      return "Author found, no address";
    case "nothing":
      return "Nothing found";
    case "failed":
      /* The server marks an unfinished run `stale` when the next one starts (D4). */
      return lookup.failure === "stale" ? "Did not finish" : `Failed: ${lookup.failure ?? "no reason given"}`;
    default: {
      const never: never = lookup.outcome;
      return never;
    }
  }
}

/** What a lookup cost, or why that is not known yet. */
function costWords(lookup: AdminAuthorLookup): string {
  const cost = lookup.cost;
  if (cost === null) return "nothing spent yet";
  const figure = formatCostNanos(cost.nanos);
  const calls = cost.calls === 1 ? "1 call" : `${cost.calls} calls`;
  if (cost.unpricedCalls === 0) return `${figure} (${calls})`;
  return `at least ${figure} (${calls}) — cost not fully known: ${cost.unpricedCalls} not priced yet`;
}

/** A link out, beside this page. */
function Out({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="tw:break-all tw:text-highlight-text tw:underline">
      {children}
    </a>
  );
}

/** A whole number from the box, or null. The server checks 1–1000. */
function wholeNumber(raw: string): number | null {
  const n = Number(raw);
  return raw.trim() !== "" && Number.isInteger(n) ? n : null;
}

/* ----------------------------------------------------------- one gift -- */

/** Where a field's value came from: the lookup that supplied it and the page it named, or typed. */
function Provenance({
  value,
  lookup,
  sourceUrl,
}: {
  value: string | null;
  lookup: AdminAuthorLookup | null;
  sourceUrl: string | null;
}) {
  if (value === null) return null;
  if (lookup === null) return <span className="tw:text-ink-faint"> — typed by you</span>;
  const when = exactly(lookup.createdAt);
  return (
    <span className="tw:text-ink-faint">
      {" "}
      — from the lookup{when ? ` of ${when}` : ""}
      {sourceUrl ? (
        <>
          , seen at <Out href={sourceUrl}>{sourceUrl}</Out>
        </>
      ) : null}
    </span>
  );
}

function LookupLine({ lookup, gift, now }: { lookup: AdminAuthorLookup; gift: AdminAuthorGift; now: number }) {
  const started = exactly(lookup.createdAt);
  /* Found, but the gift's field did not take it from this run (D4, R2-F5). */
  const emailNotApplied = lookup.email !== null && gift.emailLookupId !== lookup.id && lookup.email !== gift.email;
  const nameNotApplied =
    lookup.authorName !== null && gift.nameLookupId !== lookup.id && lookup.authorName !== gift.recipientName;
  return (
    <li className="tw:border-t tw:border-border/60 tw:py-2 tw:first:border-t-0">
      <div className="tw:text-foreground">
        <span className="tw:font-medium">{lookupOutcomeWords(lookup, now)}</span>
        {started && <span className="tw:text-ink-faint"> · started {started}</span>}
      </div>
      {lookup.authorName !== null && (
        <div>
          Author: {lookup.authorName}
          {lookup.authorSourceUrl && (
            <>
              {" "}
              (<Out href={lookup.authorSourceUrl}>{lookup.authorSourceUrl}</Out>)
            </>
          )}
          {nameNotApplied && <em> — found, not applied</em>}
        </div>
      )}
      {lookup.email !== null && (
        <div>
          Address: {lookup.email}
          {lookup.emailSourceUrl && (
            <>
              {" "}
              (seen at <Out href={lookup.emailSourceUrl}>{lookup.emailSourceUrl}</Out>)
            </>
          )}
          {emailNotApplied && <em> — found, not applied</em>}
        </div>
      )}
      {lookup.suggestedEmail !== null && (
        <div>
          {lookup.suggestedEmail} — <em>suggested, not seen in any result</em>
        </div>
      )}
      {lookup.contactUrl !== null && (
        <div>
          Contact page: <Out href={lookup.contactUrl}>{lookup.contactUrl}</Out>
        </div>
      )}
      <div className="tw:text-ink-faint">
        {lookup.searches === null ? "searches: not reported" : lookup.searches === 1 ? "1 search" : `${lookup.searches} searches`}
        {lookup.searches !== null && lookup.searches > SEARCHES_ASKED && (
          <strong className="tw:text-danger"> — more than the {SEARCHES_ASKED} it was allowed</strong>
        )}
        {" · cost: "}
        {costWords(lookup)}
        {lookup.model && ` · ${lookup.model}`}
      </div>
    </li>
  );
}

/** The notes: shown in full, editable in every status (R2-F7), with when they were last written. */
function Notes({
  gift,
  patch,
  lookupRunning,
}: {
  gift: AdminAuthorGift;
  patch: UseAdminAuthorGifts["patch"];
  lookupRunning: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(gift.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  /* When the notes stood at as Edit was pressed: a lookup, an agent or another
     tab may write them while the box is open, and Save replaces the whole
     text. The pause below catches what this page has seen; the server checks
     the same stamp (`notesBase`) and refuses with a 409 for what it has not
     (Sol's C7). A refusal leaves the box open with Greg's words in it. */
  const [base, setBase] = useState<string | null>(null);
  const written = gift.notesUpdatedAt === null ? undefined : exactly(gift.notesUpdatedAt);
  const movedOn = editing && base !== gift.notesUpdatedAt;

  async function save(event: FormEvent) {
    event.preventDefault();
    /* Something wrote the notes after Edit. Replacing the field from this
       stale box would lose that; the warning tells Greg how to merge it. */
    if (busy || movedOn || lookupRunning) return;
    setBusy(true);
    /* Notes only, so a sent gift takes it (R2-F7). */
    const said = await patch(gift.id, { notes: text.trim() === "" ? null : text, notesBase: base });
    setBusy(false);
    setRefusal(said);
    if (said === null) setEditing(false);
  }

  return (
    <div className="tw:mt-3">
      <div className="tw:flex tw:flex-wrap tw:items-baseline tw:gap-2">
        <span className="tw:text-sm tw:font-medium tw:text-foreground">Notes</span>
        <span className="tw:text-ink-faint">(only admins see them{written ? `; last written ${written}` : ""})</span>
      </div>
      {refusal && (
        <p role="alert" className="tw:m-0 tw:mt-1 tw:text-danger">
          {refusal}
        </p>
      )}
      {editing ? (
        <form onSubmit={(e) => void save(e)} className="tw:mt-1 tw:flex tw:flex-col tw:gap-2">
          {movedOn && (
            <p role="status" className="tw:m-0 tw:text-danger">
              The notes changed after you started editing (a lookup or an agent may have added to them). Save is
              paused; copy anything you typed, then Cancel and Edit again to see the new text.
            </p>
          )}
          {lookupRunning && (
            <p role="status" className="tw:m-0 tw:text-danger">
              A lookup is still running and may add to these notes. Wait for it to finish, then Cancel and Edit again.
            </p>
          )}
          <textarea
            aria-label="Notes"
            rows={8}
            value={text}
            disabled={busy}
            onChange={(e) => setText(e.target.value)}
            className={`${TEXTAREA} tw:w-full`}
          />
          <div className="tw:flex tw:flex-wrap tw:gap-2">
            <button type="submit" disabled={busy || movedOn || lookupRunning} className={`${BUTTON} tone-positive`}>
              {busy ? "Saving…" : "Save notes"}
            </button>
            <button type="button" disabled={busy} onClick={() => setEditing(false)} className={`${BUTTON} tone-negative`}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <>
          <p className="tw:m-0 tw:mt-1 tw:whitespace-pre-wrap tw:break-words tw:text-foreground">
            {gift.notes ?? <span className="tw:text-ink-faint">None yet.</span>}
          </p>
          <button
            type="button"
            onClick={() => {
              setText(gift.notes ?? "");
              setBase(gift.notesUpdatedAt);
              setRefusal(null);
              setEditing(true);
            }}
            className={`${BUTTON} tw:mt-1`}
          >
            Edit notes
          </button>
        </>
      )}
    </div>
  );
}

/** The draft's own fields: address, name, note to them, articles. Only what changed is sent. */
function DraftEditor({
  gift,
  patch,
  done,
}: {
  gift: AdminAuthorGift;
  patch: UseAdminAuthorGifts["patch"];
  done: () => void;
}) {
  /* **What the fields held when Edit was pressed**, and what a save compares
     against: a lookup may fill an empty field while this editor is open, and a
     comparison with the live row would send the box's old blank back over it. */
  const [initial] = useState(() => ({
    email: gift.email,
    recipientName: gift.recipientName,
    recipientNote: gift.recipientNote,
    articles: gift.articles,
  }));
  const [email, setEmail] = useState(initial.email ?? "");
  const [name, setName] = useState(initial.recipientName ?? "");
  const [note, setNote] = useState(initial.recipientNote ?? "");
  const [articles, setArticles] = useState(String(initial.articles));
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  async function save(event: FormEvent) {
    event.preventDefault();
    const count = wholeNumber(articles);
    if (count === null) {
      setRefusal("Articles must be a whole number.");
      return;
    }
    if ([...name].length > RECIPIENT_NAME_MAX) {
      setRefusal(`recipientName must be at most ${RECIPIENT_NAME_MAX} characters.`);
      return;
    }
    const change: { -readonly [K in keyof AuthorGiftPatchInput]: AuthorGiftPatchInput[K] } = {};
    const nextEmail = email.trim() === "" ? null : email.trim().toLowerCase();
    if (nextEmail !== initial.email) change.email = nextEmail;
    const nextName = cleanRecipientName(name);
    if (nextName !== initial.recipientName) change.recipientName = nextName;
    const nextNote = note.trim() === "" ? null : note;
    if (nextNote !== initial.recipientNote) change.recipientNote = nextNote;
    if (count !== initial.articles) change.articles = count;
    if (Object.keys(change).length === 0) {
      done();
      return;
    }
    setBusy(true);
    const said = await patch(gift.id, change);
    setBusy(false);
    setRefusal(said);
    if (said === null) done();
  }

  return (
    <form
      onSubmit={(e) => void save(e)}
      aria-label="Edit the draft"
      className="tw:mt-2 tw:flex tw:flex-col tw:gap-2 tw:rounded-md tw:border tw:border-border tw:p-3"
    >
      {refusal && (
        <p role="alert" className="tw:m-0 tw:text-danger">
          {refusal}
        </p>
      )}
      <div className="tw:flex tw:flex-wrap tw:items-end tw:gap-3">
        <label className="tw:flex tw:min-w-0 tw:flex-1 tw:basis-56 tw:flex-col tw:gap-1">
          Email address (editing it marks it as typed by you)
          <input
            type="email"
            aria-label="Email address"
            enterKeyHint="done"
            value={email}
            disabled={busy}
            onChange={(e) => {
              /* `Name <a@b>` pasted keeps the address and fills an empty name (plan 261011k). */
              const next = addressBoxChange(e.target.value, name);
              setEmail(next.email);
              setName(next.name);
            }}
            className={`${INPUT} tw:w-full`}
          />
        </label>
        <label className="tw:flex tw:w-24 tw:flex-col tw:gap-1">
          Articles
          <input
            type="number"
            aria-label="Articles"
            enterKeyHint="done"
            min={1}
            max={1000}
            step={1}
            value={articles}
            disabled={busy}
            onChange={(e) => setArticles(e.target.value)}
            className={`${INPUT} tw:w-full`}
          />
        </label>
      </div>
      <label className="tw:flex tw:flex-col tw:gap-1">
        Their name
        <input
          type="text"
          aria-label="Their name"
          enterKeyHint="done"
          autoComplete="off"
          value={name}
          disabled={busy}
          onChange={(e) => setName(e.target.value)}
          className={`${INPUT} tw:w-full`}
        />
      </label>
      <label className="tw:flex tw:flex-col tw:gap-1">
        Note to them (it goes in their email; sign it yourself)
        <textarea
          aria-label="Note to them"
          rows={3}
          value={note}
          disabled={busy}
          onChange={(e) => setNote(e.target.value)}
          className={`${TEXTAREA} tw:w-full`}
        />
      </label>
      <div className="tw:flex tw:flex-wrap tw:gap-2">
        <button type="submit" disabled={busy} className={`${BUTTON} tone-positive`}>
          {busy ? "Saving…" : "Save"}
        </button>
        <button type="button" disabled={busy} onClick={done} className={`${BUTTON} tone-negative`}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/** The article, by its title, and whose it is now. The first thing on a card's line. */
function GiftTitle({ gift }: { gift: AdminAuthorGift }) {
  const title = gift.starter.title;
  return (
    <span className="tw:text-sm tw:text-foreground">
      {title === null ? (
        `${gift.starter.slug} (deleted)`
      ) : gift.starter.owner === "claimant" || gift.starter.owner === "other" ? (
        /* Somebody else's now: its address would be a 404 for the
           administrator, so the title stands without a link (261011n § D3). */
        <span className={voiceClass("author")}>{title}</span>
      ) : (
        <a href={readHref(gift.starter.slug)} className={`${voiceClass("author")} tw:underline`}>
          {title}
        </a>
      )}
      {gift.starter.owner != null && (
        <>
          {" · "}
          <StarterOwnerLine owner={gift.starter.owner} />
        </>
      )}
    </span>
  );
}

/** What the voucher will carry, and where each part came from. */
function GiftFields({ gift }: { gift: AdminAuthorGift }) {
  const byId = (id: string | null) => (id === null ? null : (gift.lookups.find((l) => l.id === id) ?? null));
  const emailFrom = byId(gift.emailLookupId);
  const nameFrom = byId(gift.nameLookupId);
  return (
    <dl className="tw:m-0 tw:mt-2 tw:grid tw:grid-cols-[auto_1fr] tw:gap-x-3 tw:gap-y-1">
      <dt>Address</dt>
      <dd className="tw:m-0 tw:break-words tw:text-foreground">
        {gift.email ?? <span className="tw:text-ink-faint">none yet</span>}
        <Provenance value={gift.email} lookup={emailFrom} sourceUrl={emailFrom?.emailSourceUrl ?? null} />
      </dd>
      <dt>Name</dt>
      <dd className="tw:m-0 tw:break-words tw:text-foreground">
        {gift.recipientName ?? <span className="tw:text-ink-faint">none yet</span>}
        <Provenance value={gift.recipientName} lookup={nameFrom} sourceUrl={nameFrom?.authorSourceUrl ?? null} />
      </dd>
      <dt>Gift</dt>
      <dd className="tw:m-0 tw:text-foreground">{freeArticles(gift.articles)}</dd>
      <dt>Note to them</dt>
      <dd className="tw:m-0 tw:whitespace-pre-wrap tw:break-words tw:text-foreground">
        {gift.recipientNote ?? <span className="tw:text-ink-faint">none</span>}
      </dd>
    </dl>
  );
}

/**
 * What can be done to a draft or a half-sent gift: Send (held back, with the
 * reason, until there is an address); Edit, Look up again and Discard on a
 * draft. A finished gift has none of these: Restore, on a discarded one, is on
 * its card's line, so it is reachable while the card is shut (plan 261020ab).
 */
function GiftActions({
  gift,
  busy,
  running,
  onSend,
  onEdit,
  onDiscard,
  attempt,
  hooks,
}: {
  gift: AdminAuthorGift;
  busy: boolean;
  running: boolean;
  onSend: () => void;
  onEdit: () => void;
  onDiscard: () => void;
  attempt: (run: () => Promise<string | null>) => void;
  hooks: Pick<UseAdminAuthorGifts, "lookUpAgain">;
}) {
  const draft = gift.status === "draft";
  const canSend = draft || gift.status === "sending";
  const sendHeldId = `${authorGiftAnchor(gift.id)}-send-held`;
  const sendHeld =
    gift.email === null
      ? "Send waits for an address: add one with Edit."
      : running
        ? "Send waits for the lookup to finish, so you can review what it found first."
        : null;
  if (!canSend) return null;
  return (
    <div className="tw:mt-2 tw:flex tw:flex-wrap tw:items-center tw:gap-2">
      <Button
        type="button"
        size="sm"
        disabled={busy || sendHeld !== null}
        aria-describedby={sendHeld === null ? undefined : sendHeldId}
        onClick={onSend}
      >
        Send
      </Button>
      {sendHeld !== null && (
        <span id={sendHeldId} className="tw:text-ink-faint">
          {sendHeld}
        </span>
      )}
      {draft && (
        <>
          <button type="button" disabled={busy} onClick={onEdit} className={BUTTON}>
            Edit
          </button>
          <button
            type="button"
            disabled={busy || running}
            data-tip={running ? "A lookup is running" : undefined}
            onClick={() => attempt(() => hooks.lookUpAgain(gift.id))}
            className={BUTTON}
          >
            {running ? "Looking…" : "Look up again"}
          </button>
          <button type="button" disabled={busy} onClick={onDiscard} className={BUTTON}>
            Discard
          </button>
        </>
      )}
    </div>
  );
}

function GiftCard({
  gift,
  hooks,
  now,
  highlighted,
  onSent,
}: {
  gift: AdminAuthorGift;
  hooks: Pick<UseAdminAuthorGifts, "patch" | "send" | "lookUpAgain">;
  now: number;
  highlighted: boolean;
  onSent: () => void;
}) {
  const [editing, setEditing] = useState(false);
  /* Keep what the person opened, including the fields drawn above the
     confirmation. A refresh (or a poll for another gift's lookup) must not
     replace their review with an agent's newer edit. The server compares
     this snapshot with the row when Send freezes it. */
  const [confirming, setConfirming] = useState<AdminAuthorGift | null>(null);
  /* The rights tick for a gift whose article has no link yet, which Send then
     makes (261010r § D2). Belongs to one confirmation: cleared with it. */
  const [rights, setRights] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  /* **Whether a finished gift is open** (plan 261020ab, P1-03 and P2-02 of its
     review): what the person chose with Show or Hide, and until they choose,
     open only when the address or a draft just made pointed at it. A draft or a
     half-sent gift is always open — it is waiting on Greg. Discard sets it
     shut, so the card folds at once even when it was the one pointed at. */
  const [opened, setOpened] = useState<boolean | null>(null);
  const draft = gift.status === "draft";
  const canSend = gift.status === "draft" || gift.status === "sending";
  const open = !finished(gift) || (opened ?? highlighted);
  const running = gift.lookups.some((l) => lookupPending(l, now));
  const title = gift.starter.title;
  const shown = canSend && confirming ? confirming : gift;
  const bodyId = `${authorGiftAnchor(gift.id)}-body`;

  /* A gift sent or discarded elsewhere no longer has anything to confirm.
     Restoring it later must require opening a fresh confirmation. */
  useEffect(() => {
    if (!canSend) setConfirming(null);
  }, [canSend]);
  /* Whether this Send would make the private link, decided by what the confirmation showed. */
  const needsRights = confirming !== null && !confirming.starter.linkable;

  async function attempt(run: () => Promise<string | null>) {
    setBusy(true);
    setSaid(null);
    const answer = await run();
    setBusy(false);
    setRefusal(answer);
  }

  async function sendNow() {
    if (busy || running || confirming === null || (needsRights && !rights)) return;
    setBusy(true);
    setSaid(null);
    const answer = await hooks.send(confirming, { rightsConfirmed: needsRights && rights });
    setBusy(false);
    setConfirming(null);
    if (answer.kind === "refused") {
      setRefusal(answer.message);
      return;
    }
    setRefusal(null);
    setSaid(
      answer.email === "replayed"
        ? "It had already been sent, so nothing new went. Its voucher is under Given."
        : "Sent. The gift email is on its way; its voucher is under Given.",
    );
    onSent();
  }

  return (
    <li
      id={authorGiftAnchor(gift.id)}
      aria-label={`Author gift: ${title ?? gift.starter.slug}`}
      className={`tw:rounded-lg tw:border tw:bg-card tw:p-4 tw:text-xs tw:text-muted-foreground ${
        highlighted ? "tw:border-highlight-text tw:ring-2 tw:ring-highlight-text/25" : "tw:border-border"
      }`}
    >
      {/* **The card's line**: the article, where it has got to, and — on a
          finished gift — Show/Hide and Restore. What the last action said
          stays under it, outside the fold, so a Send's *Sent* or a Discard's
          refusal is seen whether the card is open or shut (plan 261020ab,
          P1-03). */}
      <div className="tw:flex tw:flex-wrap tw:items-baseline tw:justify-between tw:gap-2">
        <GiftTitle gift={shown} />
        <span className="tw:flex tw:flex-wrap tw:items-center tw:gap-2">
          <span data-gift-status={shown.status} className="tw:font-medium tw:text-foreground">
            {giftStatusWords(shown)}
          </span>
          {finished(gift) && (
            <button
              type="button"
              aria-expanded={open}
              aria-controls={bodyId}
              onClick={() => setOpened(!open)}
              className={BUTTON}
            >
              {open ? "Hide" : "Show"}
            </button>
          )}
          {gift.status === "discarded" && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void attempt(() => hooks.patch(gift.id, { discarded: false }))}
              className={BUTTON}
            >
              Restore
            </button>
          )}
        </span>
      </div>
      {refusal && (
        <p role="alert" className="tw:m-0 tw:mt-2 tw:text-danger">
          {refusal}
        </p>
      )}
      {said && (
        <p role="status" className="tw:m-0 tw:mt-2 tw:text-foreground">
          {said}
        </p>
      )}

      {/* Hidden rather than unmounted, so an open notes editor survives a fold. */}
      <div id={bodyId} hidden={!open}>
        <GiftFields gift={shown} />

        {editing && draft ? (
          <DraftEditor gift={gift} patch={hooks.patch} done={() => setEditing(false)} />
        ) : confirming && canSend && confirming.email !== null ? (
          <div className="tw:mt-2 tw:rounded-md tw:border tw:border-border tw:p-3">
            <p className="tw:m-0 tw:mb-2 tw:text-foreground">
              Send the gift email to <strong>{confirming.email}</strong>? It gives {freeArticles(confirming.articles)}
              {confirming.starter.title !== null ? <> and links “{confirming.starter.title}”</> : null}. This sends a
              real email and cannot be taken back.
            </p>
            {confirming.starter.title !== null && (
              /* What the claim does when they sign in (plan 261011n § D3). */
              <p className="tw:m-0 tw:mb-2 tw:text-foreground">
                When they sign in, a private article with none of your notes on it becomes theirs.
              </p>
            )}
            {needsRights && (
              <>
                <p className="tw:m-0 tw:mb-2 tw:text-foreground">
                  This article is private and has no private link yet, so Send makes one: anyone with the link can
                  read it.
                </p>
                <label className="tw:mb-2 tw:flex tw:items-start tw:gap-2 tw:text-foreground">
                  <input type="checkbox" checked={rights} disabled={busy} onChange={(e) => setRights(e.target.checked)} />
                  <span>{SHARING_RIGHTS_CONFIRM}</span>
                </label>
              </>
            )}
            <div className="tw:flex tw:flex-wrap tw:gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="tone-positive"
                disabled={busy || running || (needsRights && !rights)}
                onClick={() => void sendNow()}
              >
                {busy ? "Sending…" : running ? "Waiting for lookup…" : `Send to ${confirming.email}`}
              </Button>
              <Button type="button" variant="ghost" size="sm" className="tone-negative" disabled={busy} onClick={() => setConfirming(null)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <GiftActions
            gift={gift}
            busy={busy}
            running={running}
            onSend={() => {
              setRefusal(null);
              /* A fresh confirmation starts unticked: a tick belongs to the one it was given in. */
              setRights(false);
              setConfirming(gift);
            }}
            onEdit={() => {
              setRefusal(null);
              setEditing(true);
            }}
            onDiscard={() => {
              /* Shut as soon as it is discarded — the point of #663. */
              setOpened(false);
              void attempt(() => hooks.patch(gift.id, { discarded: true }));
            }}
            attempt={(run) => void attempt(run)}
            hooks={hooks}
          />
        )}

        <Notes gift={gift} patch={hooks.patch} lookupRunning={running} />

        <div className="tw:mt-3">
          <span className="tw:text-sm tw:font-medium tw:text-foreground">Lookups</span>
          {gift.lookups.length === 0 ? (
            <p className="tw:m-0 tw:mt-1 tw:text-ink-faint">None yet.</p>
          ) : (
            <ul className="tw:m-0 tw:mt-1 tw:list-none tw:p-0">
              {gift.lookups.map((l) => (
                <LookupLine key={l.id} lookup={l} gift={gift} now={now} />
              ))}
            </ul>
          )}
        </div>
      </div>
    </li>
  );
}

/* ------------------------------------------------------------ section -- */

/**
 * The gift the page points at — from `?gift=<id>`, or the one *Draft a gift*
 * just made or found. A fresh object each time it is pointed at, so pointing
 * at the same gift twice scrolls to it twice.
 */
export type GiftPointer = { readonly id: string };

/**
 * The *Drafts* tab: every gift, the ones still waiting first (newest first, as
 * the server sends them), then the finished ones, folded. `gifts` is the
 * page's one `useAdminAuthorGifts` (P1-01 of plan 261020ab's review), shared
 * with the *New gift* form; `notice` is what that form's last draft came to,
 * said here because drafting brings you here. `onVoucherMade` re-reads the
 * voucher table after a *Send*.
 */
export function AuthorGifts({
  gifts: list,
  pointer,
  notice,
  onVoucherMade,
}: {
  gifts: UseAdminAuthorGifts;
  pointer: GiftPointer | null;
  notice: string | null;
  onVoucherMade: () => void;
}) {
  const { gifts, error, loading, watching, reload, lookUpAgain, patch, send } = list;
  /* Re-render each minute, so a lookup past the stale limit says it did not finish. */
  const now = useNow();
  const hooks = useMemo(() => ({ patch, send, lookUpAgain }), [patch, send, lookUpAgain]);
  const ordered = useMemo(
    () => (gifts === null ? null : [...gifts.filter((g) => !finished(g)), ...gifts.filter(finished)]),
    [gifts],
  );
  const scrolled = useRef<GiftPointer | null>(null);

  /* Scroll to the gift pointed at, once it is drawn. */
  // biome-ignore lint/correctness/useExhaustiveDependencies: `gifts` is the trigger, not an input — the card may only be drawn by the read after the write, and this has to look again then.
  useEffect(() => {
    if (pointer === null || scrolled.current === pointer) return;
    const el = document.getElementById(authorGiftAnchor(pointer.id));
    if (!el) return;
    scrolled.current = pointer;
    el.scrollIntoView?.({ block: "center", behavior: "smooth" });
  }, [pointer, gifts]);

  return (
    <section aria-label="Author gifts" className="tw:mb-8">
      <div className="tw:mb-3 tw:flex tw:flex-wrap tw:items-center tw:justify-between tw:gap-3">
        <h2 className="tw:m-0 tw:text-sm tw:font-medium tw:text-foreground">Author gifts</h2>
        <button
          type="button"
          onClick={() => void reload()}
          disabled={loading}
          aria-label="Refresh the author gifts"
          data-tip="Refresh the author gifts"
          data-tip-describes="off"
          className={BUTTON}
        >
          <RefreshCw size={12} />
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>
      <p className="tw:m-0 tw:mb-3 tw:text-xs tw:text-muted-foreground">
        Drafts of a gift voucher for the author of one of your articles, made on Give with its box ticked. A lookup
        fills in what it can find; nothing is emailed until you press Send. Once Send succeeds, it creates a voucher
        under Given, with its article as the starter. Sent and discarded ones are folded to a line at the end.
        {watching && " A lookup is running, so this list is checked every few seconds."}
      </p>
      {notice && (
        <p role="status" className="tw:m-0 tw:mb-3 tw:text-sm tw:text-foreground">
          {notice}
        </p>
      )}
      {error && <Refusal message={gifts ? `Refresh failed, so this is the previous list. ${error}` : error} />}
      {ordered === null ? null : ordered.length === 0 ? (
        <p className="tw:text-sm tw:text-muted-foreground">No author gifts yet.</p>
      ) : (
        <ul className="tw:m-0 tw:flex tw:list-none tw:flex-col tw:gap-3 tw:p-0">
          {ordered.map((g) => (
            <GiftCard
              key={g.id}
              gift={g}
              hooks={hooks}
              now={now}
              highlighted={pointer?.id === g.id}
              onSent={onVoucherMade}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
