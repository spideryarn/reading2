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
import {
  type AdminAuthorGift,
  type AdminAuthorLookup,
  type AuthorGiftStatus,
  STARTER_LINK_PLACEHOLDER,
} from "../admin-author-gifts.js";
import {
  freeArticles,
  giftEmailGreeting,
  RECIPIENT_NAME_MAX,
  VOUCHER_NOTE_MAX,
  cleanRecipientName,
} from "../admin-vouchers.js";
import { addressBoxChange } from "../email-address.js";
import { SHARING_RIGHTS_CONFIRM } from "../messages.js";
import { BUTTON, INPUT, Refusal, StarterOwnerLine, TEXTAREA } from "./admin-vouchers-parts.js";
import { AuthorGiftGuidance } from "./AuthorGiftGuidance.js";
import { Button } from "./components/ui/button.js";
import { exactly } from "./relative-time.js";
import { readHref } from "./router.js";
import {
  type AuthorGiftPatchInput,
  type EmailPreviewAnswer,
  fetchEmailPreview,
  lookupPending,
  type UseAdminAuthorGifts,
} from "./useAdminAuthorGifts.js";
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
        <span className="tw:text-sm tw:font-medium tw:text-foreground">Private notes</span>
        <span className="tw:text-ink-faint">
          (never sent; only admins see them{written ? `; last written ${written}` : ""})
        </span>
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
            aria-label="Private notes"
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

/**
 * The draft's own fields — address, name, the message to them, articles: every
 * part of the email that is not fixed. Only what changed is sent. `noteToUse`
 * is a lookup's suggestion, put in the message box by *Use as your message*
 * for Greg to edit and save (plan 261024f, R1): it is not saved until he does.
 */
function DraftEditor({
  gift,
  patch,
  noteToUse,
  done,
}: {
  gift: AdminAuthorGift;
  patch: UseAdminAuthorGifts["patch"];
  noteToUse: string | null;
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
  const [note, setNote] = useState(noteToUse ?? initial.recipientNote ?? "");
  const noteLength = [...note.trim()].length;
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
      aria-label="Edit the email"
      className="tw:mt-2 tw:flex tw:flex-col tw:gap-2 tw:rounded-md tw:border tw:border-border tw:p-3"
    >
      {refusal && (
        <p role="alert" className="tw:m-0 tw:text-danger">
          {refusal}
        </p>
      )}
      <div className="tw:flex tw:flex-wrap tw:items-end tw:gap-3">
        <label className="tw:flex tw:min-w-0 tw:flex-1 tw:basis-56 tw:flex-col tw:gap-1">
          To: their email address (editing it marks it as typed by you)
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
          Free articles
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
        Their name (the email opens “{giftEmailGreeting("<name>")}”)
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
        Your message to them: the one part of the email you write, under the greeting. Everything else in it is fixed.
        Sign it yourself.
        <textarea
          aria-label="Your message to them"
          rows={6}
          value={note}
          disabled={busy}
          onChange={(e) => setNote(e.target.value)}
          className={`${TEXTAREA} tw:w-full`}
        />
        <span className={noteLength > VOUCHER_NOTE_MAX ? "tw:text-danger" : "tw:text-ink-faint"}>
          {noteLength} of {VOUCHER_NOTE_MAX} characters
          {noteLength > VOUCHER_NOTE_MAX && ": shorten it before saving"}
        </span>
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

/**
 * What the voucher will carry, and where each part came from. `withNote` draws
 * the note to them too: a gift that can still be sent shows it in its email
 * instead (plan 261024f § D2), so it is not drawn twice.
 */
function GiftFields({ gift, withNote }: { gift: AdminAuthorGift; withNote: boolean }) {
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
      {withNote && (
        <>
          <dt>Note to them</dt>
          <dd className="tw:m-0 tw:whitespace-pre-wrap tw:break-words tw:text-foreground">
            {gift.recipientNote ?? <span className="tw:text-ink-faint">none</span>}
          </dd>
        </>
      )}
    </dl>
  );
}

/**
 * **The email, if you sent it now** — Greg, 2026-10-23 (#687, spya-nt6hee):
 * *"crystal clear what the subject line, what the text is going to be … what's
 * about to go out and where from"*. Plan 261024f § D2, R2.
 *
 * The server renders it with the function Send uses, so this is the email,
 * not a sketch of it (unlike the Give form's `EmailSketch`, which draws while
 * you type). Asked again whenever the gift's `updatedAt` moves — an edit, a
 * lookup filling an address. The small print names the two things that can
 * still differ at Send.
 */
function EmailPreview({ gift }: { gift: AdminAuthorGift }) {
  const [answer, setAnswer] = useState<EmailPreviewAnswer | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `updatedAt` is the trigger, not an input — every edit, and every lookup that fills a field, moves it, and the email has to be asked for again then.
  useEffect(() => {
    let live = true;
    void fetchEmailPreview(gift.id).then((a) => {
      if (live) setAnswer(a);
    });
    return () => {
      live = false;
    };
  }, [gift.id, gift.updatedAt]);

  return (
    <section
      aria-label="The email, if you sent it now"
      className="tw:mt-3 tw:rounded-md tw:border tw:border-border tw:bg-background tw:p-3"
    >
      <h3 className="tw:m-0 tw:mb-2 tw:text-sm tw:font-medium tw:text-foreground">The email, if you sent it now</h3>
      {answer === null ? (
        <p className="tw:m-0 tw:text-ink-faint">Loading the email…</p>
      ) : answer.kind === "failed" ? (
        <p className="tw:m-0 tw:text-danger">
          Could not show the email: {answer.message}
        </p>
      ) : (
        <>
          <dl className="tw:m-0 tw:grid tw:grid-cols-[auto_1fr] tw:gap-x-3 tw:gap-y-1">
            <dt>From</dt>
            <dd className="tw:m-0 tw:break-words tw:text-foreground">{answer.preview.from}</dd>
            <dt>To</dt>
            <dd className="tw:m-0 tw:break-words tw:text-foreground">
              {answer.preview.to ?? <span className="tw:text-ink-faint">no address yet</span>}
            </dd>
            <dt>Subject</dt>
            <dd className="tw:m-0 tw:break-words tw:text-foreground">{answer.preview.subject}</dd>
          </dl>
          <div
            data-email-body=""
            className="tw:mt-2 tw:whitespace-pre-wrap tw:break-words tw:border-t tw:border-border/60 tw:pt-2 tw:text-foreground"
          >
            {answer.preview.text}
          </div>
          <p className="tw:m-0 tw:mt-2 tw:text-ink-faint">
            This is the plain-text version; the formatted one has the same words, with buttons for the links.{" "}
            {STARTER_LINK_PLACEHOLDER} stands for the article's real link, which Send adds.{" "}
            {answer.preview.audience === "reader"
              ? "This address already has a Spideryarn account, so the email tells them what the gift adds to theirs."
              : "No confirmed Spideryarn account has this address yet, so the email invites them to sign up."}{" "}
            That part is decided again at Send, as is the article's title, so either can change if the address signs up
            or the article is re-imported first. Replies go to {answer.preview.from}.
          </p>
        </>
      )}
    </section>
  );
}

/**
 * **The lookup's suggested message, offered, never applied** (plan 261024f,
 * R1). The newest lookup's suggestion, shown while it differs from the
 * message already in the email, with *Use as your message*, which opens the
 * editor with it in the message box. Model text reaches the email only through
 * that editor's Save — Greg's own — so 261010c's D7 is unchanged.
 */
function SuggestedMessage({ gift, onUse }: { gift: AdminAuthorGift; onUse: (text: string) => void }) {
  const suggestion = gift.lookups.find((l) => l.suggestedMessage !== null)?.suggestedMessage ?? null;
  if (suggestion === null || suggestion.trim() === (gift.recipientNote ?? "").trim()) return null;
  return (
    <section aria-label="Suggested message" className="tw:mt-3 tw:rounded-md tw:border tw:border-dashed tw:border-border tw:p-3">
      <div className="tw:flex tw:flex-wrap tw:items-baseline tw:gap-2">
        <span className="tw:text-sm tw:font-medium tw:text-foreground">Suggested message</span>
        <span className="tw:text-ink-faint">(written by the lookup; not in the email unless you use it)</span>
      </div>
      <p className={`tw:m-0 tw:mt-1 tw:whitespace-pre-wrap tw:break-words tw:text-foreground ${voiceClass("ai")}`}>
        {suggestion}
      </p>
      <button type="button" onClick={() => onUse(suggestion)} className={`${BUTTON} tw:mt-2`}>
        Use as your message
      </button>
    </section>
  );
}

/**
 * What can be done to a draft or a half-sent gift: Send (held back, with the
 * reason, until there is an address); Edit, Look up again and Discard on a
 * draft. A finished gift has none of these: Restore and Delete, on a discarded
 * one, are on its card's line, so they are reachable while the card is shut
 * (plans 261020ab, 261024f).
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
            Edit the email
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

/**
 * **A draft's High-powered AI**: on, or off with *Switch on* — the line plan
 * 261010c's D10 meant the card to show, and plan 261021j § D4 adds. It covers
 * a gift an agent drafted (MCP's `draft_author_gift` leaves it off by default)
 * and one drafted with the box unticked. Drafts only: once a gift is sent the
 * article may be the recipient's. There is no *Switch off* here; the article's
 * own page has that.
 */
function HighPowerLine({
  gift,
  busy,
  attempt,
  hooks,
}: {
  gift: AdminAuthorGift;
  busy: boolean;
  attempt: (run: () => Promise<string | null>) => Promise<void>;
  hooks: Pick<UseAdminAuthorGifts, "switchOnHighPower">;
}) {
  /* Which of the card's actions is in flight, so only this one says so. */
  const [switching, setSwitching] = useState(false);
  return (
    <div data-high-power={gift.highPower ? "on" : "off"} className="tw:mt-2 tw:flex tw:flex-wrap tw:items-center tw:gap-2">
      <span className="tw:text-foreground">High-powered AI: {gift.highPower ? "on" : "off"}</span>
      {!gift.highPower && (
        <button
          type="button"
          disabled={busy}
          data-tip="Uses Opus for what is made from now on, and queues the article's main modes. What is already made stays as it is."
          onClick={() => {
            setSwitching(true);
            void attempt(() => hooks.switchOnHighPower(gift.id)).finally(() => setSwitching(false));
          }}
          className={BUTTON}
        >
          {switching ? "Switching on…" : "Switch on"}
        </button>
      )}
    </div>
  );
}

function GiftCard({
  gift,
  hooks,
  now,
  pointer,
  onSent,
}: {
  gift: AdminAuthorGift;
  hooks: Pick<UseAdminAuthorGifts, "patch" | "send" | "lookUpAgain" | "switchOnHighPower" | "remove">;
  now: number;
  /** A fresh object each time this gift is pointed at, so an old fold choice cannot hide a new arrival. */
  pointer: GiftPointer | null;
  onSent: () => void;
}) {
  const [editing, setEditing] = useState(false);
  /* *Use as your message*: the suggestion the editor opens with in its message box (plan 261024f, R1). */
  const [noteToUse, setNoteToUse] = useState<string | null>(null);
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
  /* The inline *Delete for good?* on a discarded gift's line (plan 261024f § D1). */
  const [deleting, setDeleting] = useState(false);
  /* **Whether a finished gift is open** (plan 261020ab, P1-03 and P2-02 of its
     review): what the person chose with Show or Hide in this pointing context.
     A fresh pointer supersedes an earlier Hide, but Hide still works after the
     arrival; a draft or half-sent gift is always open. Discard records Hide in
     the current context, so a highlighted card still folds at once. */
  const [foldChoice, setFoldChoice] = useState<{ readonly pointer: GiftPointer | null; readonly open: boolean } | null>(null);
  const draft = gift.status === "draft";
  const canSend = gift.status === "draft" || gift.status === "sending";
  const highlighted = pointer !== null;
  const chosenOpen = foldChoice?.pointer === pointer ? foldChoice.open : null;
  const open = !finished(gift) || (chosenOpen ?? highlighted);
  const running = gift.lookups.some((l) => lookupPending(l, now));
  const title = gift.starter.title;
  const shown = canSend && confirming ? confirming : gift;
  const bodyId = `${authorGiftAnchor(gift.id)}-body`;

  /* A gift sent or discarded elsewhere no longer has anything to confirm.
     Restoring it later must require opening a fresh confirmation. */
  useEffect(() => {
    if (!canSend) setConfirming(null);
  }, [canSend]);
  /* Restored elsewhere: there is nothing to delete, so the question goes. */
  useEffect(() => {
    if (gift.status !== "discarded") setDeleting(false);
  }, [gift.status]);
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
              onClick={() => setFoldChoice({ pointer, open: !open })}
              className={BUTTON}
            >
              {open ? "Hide" : "Show"}
            </button>
          )}
          {gift.status === "discarded" && (
            <>
              <button
                type="button"
                disabled={busy}
                onClick={() => void attempt(() => hooks.patch(gift.id, { discarded: false }))}
                className={BUTTON}
              >
                Restore
              </button>
              <button
                type="button"
                disabled={busy || deleting}
                onClick={() => {
                  setRefusal(null);
                  setDeleting(true);
                }}
                className={`${BUTTON} tone-negative`}
              >
                Delete
              </button>
            </>
          )}
        </span>
      </div>
      {/* Greg, 2026-10-23 (#685): *"actually delete permanently the discarded
          draft"*. Asked inline, like Send, and outside the fold so it is seen
          whether the card is open or shut. */}
      {deleting && gift.status === "discarded" && (
        <fieldset
          aria-label="Delete this draft for good"
          className="tw:m-0 tw:mt-2 tw:min-w-0 tw:rounded-md tw:border tw:border-border tw:p-3"
        >
          <p className="tw:m-0 tw:mb-2 tw:text-foreground">
            Delete this draft for good? Its notes and lookups go with it. This cannot be undone.
          </p>
          <div className="tw:flex tw:flex-wrap tw:gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="tone-negative"
              disabled={busy}
              onClick={() => void attempt(() => hooks.remove(gift.id)).finally(() => setDeleting(false))}
            >
              {busy ? "Deleting…" : "Delete for good"}
            </Button>
            <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => setDeleting(false)}>
              Cancel
            </Button>
          </div>
        </fieldset>
      )}
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
        <GiftFields gift={shown} withNote={!canSend} />
        {/* The email itself, for a gift that can still be sent (plan 261024f § D2). */}
        {canSend && <EmailPreview gift={shown} />}

        {editing && draft ? (
          <DraftEditor
            gift={gift}
            patch={hooks.patch}
            noteToUse={noteToUse}
            done={() => {
              setEditing(false);
              setNoteToUse(null);
            }}
          />
        ) : confirming && canSend && confirming.email !== null ? (
          <div className="tw:mt-2 tw:rounded-md tw:border tw:border-border tw:p-3">
            <p className="tw:m-0 tw:mb-2 tw:text-foreground">
              Send the email above to <strong>{confirming.email}</strong>? It gives {freeArticles(confirming.articles)}
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
              setNoteToUse(null);
              setEditing(true);
            }}
            onDiscard={() => {
              /* Shut as soon as it is discarded — the point of #663. */
              setFoldChoice({ pointer, open: false });
              void attempt(() => hooks.patch(gift.id, { discarded: true }));
            }}
            attempt={(run) => void attempt(run)}
            hooks={hooks}
          />
        )}

        {draft && !editing && (
          <SuggestedMessage
            gift={gift}
            onUse={(text) => {
              setRefusal(null);
              setConfirming(null);
              setNoteToUse(text);
              setEditing(true);
            }}
          />
        )}
        {draft && <HighPowerLine gift={gift} busy={busy} attempt={attempt} hooks={hooks} />}

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
  active,
  onVoucherMade,
}: {
  gifts: UseAdminAuthorGifts;
  pointer: GiftPointer | null;
  notice: string | null;
  /** Whether the mounted Drafts panel is the visible tab. */
  active: boolean;
  onVoucherMade: () => void;
}) {
  const { gifts, error, loading, watching, reload, lookUpAgain, patch, remove, send, switchOnHighPower } = list;
  /* Re-render each minute, so a lookup past the stale limit says it did not finish. */
  const now = useNow();
  const hooks = useMemo(
    () => ({ patch, send, lookUpAgain, switchOnHighPower, remove }),
    [patch, send, lookUpAgain, switchOnHighPower, remove],
  );
  const ordered = useMemo(
    () => (gifts === null ? null : [...gifts.filter((g) => !finished(g)), ...gifts.filter(finished)]),
    [gifts],
  );
  const scrolled = useRef<GiftPointer | null>(null);

  /* Scroll to the gift pointed at, once it is drawn. */
  // biome-ignore lint/correctness/useExhaustiveDependencies: `gifts` is the trigger, not an input — the card may only be drawn by the read after the write, and this has to look again then.
  useEffect(() => {
    /* `hidden` panels stay mounted. Scrolling one does nothing useful in the
       browser, and recording it here would consume the arrival before the
       person opens Drafts. */
    if (!active || pointer === null || scrolled.current === pointer) return;
    const el = document.getElementById(authorGiftAnchor(pointer.id));
    if (!el) return;
    scrolled.current = pointer;
    el.scrollIntoView?.({ block: "center", behavior: "smooth" });
  }, [active, pointer, gifts]);

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
      <AuthorGiftGuidance />
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
              pointer={pointer?.id === g.id ? pointer : null}
              onSent={onVoucherMade}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
