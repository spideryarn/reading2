/**
 * `/admin/vouchers` — gift vouchers: create one, see every one, change one.
 *
 * Greg, 2026-10-01: *"That /admin/vouchers page should show existing vouchers
 * that have been created, which have been claimed and how used, allow me to
 * edit/invalidate them, etc."* Plan 261001m; docs/project/admin.md §
 * `/admin/vouchers`; what a voucher does is docs/project/billing.md § Gift
 * vouchers.
 *
 * **The one admin page that writes**, and still not a gate: App.tsx decides
 * whether it is drawn (router.ts § `ADMIN_ONLY`) and the server's namespace
 * gate on `/api/admin/` decides whether anything happens. Every write is
 * followed by a fresh read (useAdminVouchers.ts), so the table shows what the
 * server holds rather than what this page hoped.
 *
 * **A voucher may name a starter article** for its email to link (plan
 * 261007j): picked from the administrator's own shelf, with links out to the
 * add page and the article's sharing card rather than a copy of either. This
 * page never asks for, holds or shows a private link's key.
 *
 * A plain table rather than `DataTable`: there are few vouchers, one order
 * (newest first, the server's), and a row that turns into a form, which a
 * TanStack cell renderer would make harder to read rather than easier.
 *
 * **Three tabs since plan 261020ab** — Greg, 2026-10-20 (spya-vyddks): *"This
 * page is now quite long and messy. Perhaps add tabs at the top to divide
 * it"*. *Give* holds the one *New gift* form, *Drafts* the author gifts, and
 * *Given* the voucher table. And one form for both kinds of gift, with a
 * tick-box for the author's — the same day (spya-vusqvg): *"is one just a
 * special case of the other (e.g. we could provide a tick box and/or extra
 * field), to simplify the UI?"*
 */
import {
  type KeyboardEvent as ReactKeyboardEvent,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { RefreshCw } from "lucide-react";
import { parseAsString, parseAsStringLiteral, useQueryState } from "nuqs";

import type { AdminUser } from "../admin.js";
import { AUTHOR_GIFT_PARAM } from "../admin-author-gifts.js";
import {
  type VoucherEmailState,
  RECIPIENT_NAME_MAX,
  cleanRecipientName,
  giftEmailGreeting,
  giftEmailHeading,
  giftEmailStarterLine,
  giftEmailSubject,
} from "../admin-vouchers.js";
import { readableDate } from "../billing-plan.js";
import { addressBoxChange, normaliseEmail } from "../email-address.js";
import { SHARING_RIGHTS_CONFIRM } from "../messages.js";
import type { LibraryEntry } from "../types.js";
import { AuthorGifts, type GiftPointer, giftIdOrNull, giftsWaiting } from "./AdminAuthorGifts.js";
import { type AccountUsage, AdminUserLink } from "./AdminUserCard.js";
import {
  BUTTON,
  INPUT,
  Refusal,
  StarterOwnerLine,
  StarterSelect,
  type StarterShelf,
  TEXTAREA,
  starterChoices,
  useStarterShelf,
} from "./admin-vouchers-parts.js";
import { Shell } from "./AdminPage.js";
import { Button } from "./components/ui/button.js";
import { PINNED } from "./lib/DataTable.js";
import { SignedInReader } from "./lib/made-for.js";
import { SidewaysScrollBox } from "./lib/SidewaysScrollBox.js";
import { pageTitle, useDocumentTitle } from "./page-title.js";
import { exactly } from "./relative-time.js";
import { ADMIN_HREF, addHref, readHref } from "./router.js";
import {
  type AdminVoucherRow,
  type CreateAnswer,
  type NewVoucherInput,
  type UpdateAnswer,
  type UseAdminVouchers,
  useAdminVouchers,
  type VoucherPatchInput,
} from "./useAdminVouchers.js";
import { type EnsureAnswer, type UseAdminAuthorGifts, useAdminAuthorGifts } from "./useAdminAuthorGifts.js";
import { type UseAdminUsers, useAdminUsers } from "./useAdminUsers.js";
import { useNow } from "./useNow.js";
import { articleTitleVoice, voiceClass } from "./voice.js";

/** The table's name: its caption, and its scroll box's while it scrolls. */
const CAPTION = "Every gift voucher, newest first";

const CELL = "tw:px-3 tw:py-2 tw:align-top tw:first:pl-4 tw:last:pr-4";
const HEAD = `${CELL} tw:whitespace-nowrap tw:text-left tw:text-xs tw:font-medium tw:text-muted-foreground`;

/** The default a new voucher offers: Greg's own example, *"e.g. 20 free articles"*. */
const DEFAULT_ARTICLES = 20;
const RECIPIENT_NAME_TOO_LONG = `recipientName must be at most ${RECIPIENT_NAME_MAX} characters.`;
/** The starter's status line, which the disabled Create button points at. */
const STARTER_STATUS = "voucher-new-starter-status";
/** After a readdress whose new email could not link the starter (plan 261007j, Sol's F3). */
const STARTER_DROPPED =
  "Saved. The email to the new address went without the starter article: it can no longer be " +
  "linked (deleted, not yet readable, or its private link is off).";
/* Keep the email's shared sentence while letting JSX voice only the title.
   The separator is in our template, never in the article's text. */
const [STARTER_LEAD, STARTER_TAIL] = giftEmailStarterLine("\u0000").split("\u0000");

function recipientNameTooLong(name: string): boolean {
  return [...name].length > RECIPIENT_NAME_MAX;
}

/** A whole number from the box, or null when it is not one. The server checks 1–1000. */
function wholeNumber(raw: string): number | null {
  const n = Number(raw);
  return raw.trim() !== "" && Number.isInteger(n) ? n : null;
}

/**
 * **Where a chosen starter article stands**, read from the administrator's own
 * shelf row (plan 261007j). Only `none`, `public` and `linked` let Create go;
 * the server checks the same and refuses with a sentence if this was stale.
 *
 * - `reading`: an article is chosen and the shelf is not on screen (a 401
 *   cleared it, say), so nothing is known.
 * - `gone`: no longer on the shelf — deleted or archived since it was chosen.
 *   An import still running is not on the shelf yet either, so it is never
 *   offered.
 * - `unread`: a paper with only its title and abstract read, which a private
 *   link refuses (`NOT_READ_YET_SHARE`). Never offered; here so a shelf
 *   that changed under a choice still says why.
 */
type StarterState =
  | { readonly kind: "none" }
  | { readonly kind: "reading" }
  | { readonly kind: "gone" }
  | { readonly kind: "unread"; readonly entry: LibraryEntry }
  | { readonly kind: "public"; readonly entry: LibraryEntry }
  | { readonly kind: "linked"; readonly entry: LibraryEntry }
  | { readonly kind: "no-link"; readonly entry: LibraryEntry };

function starterState(slug: string, shelf: readonly LibraryEntry[] | null): StarterState {
  if (slug === "") return { kind: "none" };
  if (shelf === null) return { kind: "reading" };
  const entry = shelf.find((a) => a.slug === slug);
  if (!entry) return { kind: "gone" };
  if (entry.processing === "minimal") return { kind: "unread", entry };
  if (entry.visibility === "public") return { kind: "public", entry };
  return entry.privateLinkOn ? { kind: "linked", entry } : { kind: "no-link", entry };
}

/** Whether Create may go with this starter. */
function starterReady(state: StarterState): boolean {
  switch (state.kind) {
    case "none":
    case "public":
    case "linked":
      return true;
    case "reading":
    case "gone":
    case "unread":
    case "no-link":
      return false;
    default: {
      const never: never = state;
      return never;
    }
  }
}

/** A link that opens beside this page, so the voucher draft is still here after. */
function NewTab({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="tw:text-highlight-text tw:underline">
      {children}
    </a>
  );
}

/** An article's title, in the voice of whoever wrote it (fonts.md). */
function EntryTitle({ entry }: { entry: LibraryEntry }) {
  return <span className={voiceClass(articleTitleVoice(Boolean(entry.titleOverridden)))}>{entry.title}</span>;
}

/** The line under the picker: what the email will do with the chosen article, and what waits. */
function StarterStatus({ state, id, replay }: { state: StarterState; id: string; replay: boolean }) {
  if (replay && !starterReady(state)) {
    return (
      <p id={id} className="tw:m-0 tw:break-words tw:text-xs tw:text-muted-foreground">
        The starter is no longer ready for a new voucher. You can retry the unchanged voucher to
        recover its first answer. This sends no second email if it was already created.
      </p>
    );
  }
  const waits = <> Create voucher waits until it has one.</>;
  let said: ReactNode;
  switch (state.kind) {
    case "none":
      return null;
    case "reading":
      said = <>Reading your articles… Create voucher waits until they are here.</>;
      break;
    case "gone":
      said = <>That article is no longer on your shelf. Choose another, or none.</>;
      break;
    case "unread":
      said = (
        <>
          <EntryTitle entry={state.entry} /> has only its title and abstract read, so it cannot be
          shared yet. Choose another, or none.
        </>
      );
      break;
    case "public":
      said = (
        <>
          <EntryTitle entry={state.entry} />: public. The email links to{" "}
          <NewTab href={readHref(state.entry.slug)}>its public page</NewTab>; no key involved.
        </>
      );
      break;
    case "linked":
      said = (
        <>
          <EntryTitle entry={state.entry} />: its private link is on. The email will carry it.
        </>
      );
      break;
    case "no-link":
      said = (
        <>
          <EntryTitle entry={state.entry} />: private, with no private link yet.{" "}
          <NewTab href={readHref(state.entry.slug, "section=access-sharing", "metadata")}>
            Make one on its page
          </NewTab>{" "}
          (a new tab), then Refresh here.{waits}
        </>
      );
      break;
    default: {
      const never: never = state;
      return never;
    }
  }
  return (
    <p id={id} className="tw:m-0 tw:break-words tw:text-xs tw:text-muted-foreground">
      {said}
    </p>
  );
}

/**
 * **The starter article: pick one of yours, or import one in another tab** —
 * plan 261007j, Greg 2026-10-07: *"make the UI easy to generate an article
 * with a shareable link … at the same time as generating the gift voucher"*.
 *
 * It links out rather than importing or making the link here (the plan's §
 * Why the form links out): the add page and the article's own sharing card
 * already own that delicate work, and this page reads the result back through
 * the shelf — on Refresh, and whenever an import this tab can see finishes,
 * as the shelf page does. **The key is never asked for**: the shelf says only
 * whether the link is on, and the server reads the key when it sends.
 */
function StarterPicker({
  choices,
  slug,
  onChoose,
  state,
  statusId,
  shelfError,
  reload,
  replay,
}: {
  choices: readonly LibraryEntry[];
  slug: string;
  onChoose: (slug: string) => void;
  state: StarterState;
  statusId: string;
  shelfError: string | null;
  reload: () => void;
  replay: boolean;
}) {
  const [url, setUrl] = useState("");
  const importLink = useRef<HTMLAnchorElement>(null);
  const href = url.trim() === "" ? undefined : addHref(url);

  return (
    <div className="tw:mt-3 tw:flex tw:flex-col tw:gap-2 tw:text-xs tw:text-muted-foreground">
      <StarterSelect
        id="voucher-new-starter"
        label={
          <>
            <span className="tw:text-sm tw:font-medium tw:text-foreground">Starter article</span> (optional —
            their email links it, to start with; your articles, newest first)
          </>
        }
        noneLabel="None"
        choices={choices}
        slug={slug}
        onChoose={onChoose}
        reload={reload}
      />
      <div className="tw:flex tw:flex-wrap tw:items-end tw:gap-2">
        <label className="tw:flex tw:min-w-0 tw:flex-1 tw:basis-56 tw:flex-col tw:gap-1">
          Or import one (it opens the add page; choose it here once it is on your shelf)
          <input
            id="voucher-new-import"
            /* This separate action must not add URL validation to the voucher form.
               Like AddArticle, it also accepts addresses without a scheme. */
            type="text"
            inputMode="url"
            enterKeyHint="go"
            autoComplete="off"
            placeholder="https://…"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              /* Enter here opens the add page; it must not create the voucher. */
              if (e.key !== "Enter") return;
              e.preventDefault();
              importLink.current?.click();
            }}
            className={`${INPUT} tw:w-full`}
          />
        </label>
        <a
          ref={importLink}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          aria-disabled={href === undefined}
          className={`${BUTTON} tw:no-underline ${href === undefined ? "tw:pointer-events-none tw:opacity-50" : ""}`}
        >
          Import in a new tab
        </a>
      </div>
      {shelfError && <p className="tw:m-0 tw:text-danger">Couldn’t read your articles. {shelfError}</p>}
      <StarterStatus state={state} id={statusId} replay={replay} />
    </div>
  );
}

/**
 * **The gifts this address already has, not revoked**, so the form can say a
 * new one adds to them. Greg, 2026-10-11 (spya-dkddku): *"It should be
 * possible to send multiple gift vouchers to the same person and they're
 * additive."* They always were; this says so (plan 261011k). A waiting
 * voucher counts by its address, since the claim takes every one at it; a
 * claimed one only while its claimant's current address is this one, because
 * a claimed voucher belongs to an account, which may have moved address since
 * (Sol, plan review F1). From the last successful, settled list: while a list
 * is loading, or after a refresh failed and left the old list on screen, the
 * form says nothing rather than making a stale claim.
 */
export function giftsAlreadyAt(
  email: string,
  vouchers: readonly AdminVoucherRow[] | null,
): { readonly count: number; readonly articles: number } | null {
  const address = normaliseEmail(email);
  if (vouchers === null || address === "") return null;
  const same = vouchers.filter(
    (v) =>
      v.revokedAt === null &&
      (v.claimedBy === null
        ? v.email === address
        : v.claimantEmail !== null && normaliseEmail(v.claimantEmail) === address),
  );
  if (same.length === 0) return null;
  return { count: same.length, articles: same.reduce((sum, v) => sum + v.articles, 0) };
}

function alreadyLine(already: { readonly count: number; readonly articles: number }): string {
  const articles = `${already.articles} article${already.articles === 1 ? "" : "s"}`;
  const gifts = already.count === 1 ? `a gift of ${articles}` : `${already.count} gifts (${articles})`;
  return `This address already has ${gifts}. This one adds to ${already.count === 1 ? "it" : "them"}.`;
}

/** A draft the ticked form made, or found already made: the *Drafts* tab opens on it. */
type Drafted = Exclude<EnsureAnswer, { readonly kind: "refused" }>;

/**
 * **New gift** — a voucher, or ticked, the draft of an author gift (plan
 * 261020ab, spya-vusqvg). Unticked it is the voucher form it always was.
 * Ticked, the fields the draft does not take are hidden, not cleared, and it
 * asks only for the article and the private link's rights: `POST
 * /api/admin/author-gifts` takes the article alone, and the address, name,
 * note and articles are filled by the lookup and edited on the draft's card.
 *
 * **The two starter rules stay apart** (P1-02 of the plan's review). A voucher
 * reads the link and never makes one, so its starter must already be linkable
 * (`starterReady`). Drafting makes a missing link at once (`ensureAuthorGift`),
 * so any article on the shelf will do once the rights box is ticked. The
 * chosen article is one value, so it carries across the tick both ways.
 */
function CreateForm({ create, canReplay, vouchers, shelf, drafts, onDrafted }: {
  create: UseAdminVouchers["create"];
  canReplay: UseAdminVouchers["canReplay"];
  /** The list under Given, to say when this address already has gifts. */
  vouchers: UseAdminVouchers["vouchers"];
  /** The administrator's own shelf, for the starter; read once for the page. */
  shelf: StarterShelf;
  /** The page's one author-gift list, so a draft made here is the one Drafts shows (P1-01). */
  drafts: Pick<UseAdminAuthorGifts, "ensure">;
  onDrafted: (answer: Drafted) => void;
}) {
  /* Greg's tick-box: this gift is for the author of one of my articles. */
  const [forAuthor, setForAuthor] = useState(false);
  /* The private link's rights, which drafting makes if there is none — the
     tick `DraftForm` asked for before this form took its place. */
  const [rights, setRights] = useState(false);
  const [email, setEmail] = useState("");
  const [articles, setArticles] = useState(String(DEFAULT_ARTICLES));
  const [note, setNote] = useState("");
  const [recipientNote, setRecipientNote] = useState("");
  const [recipientName, setRecipientName] = useState("");
  const [starterSlug, setStarterSlug] = useState("");
  /* *High-powered AI* for the chosen article, ticked by default (plan
     261021j § D4). One value across the tick, like the article. */
  const [highPower, setHighPower] = useState(true);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  /* The draft as it stands now, read when a create answers: the fields stay
     editable while it is in flight, and a draft typed meanwhile is not the
     one that was sent, so it is not cleared (Sol's F13 on 261007j).
     **High-powered AI is not in it**, as it is not in the create's identity
     (useAdminVouchers.ts § `createKey`, plan 261021j § D4): the box toggled
     while a create is in flight still clears the form, and a retry of an
     unchanged voucher is the same create whatever the box says. */
  const draft = JSON.stringify([email, articles, note, recipientNote, recipientName, starterSlug]);
  const draftNow = useRef(draft);
  draftNow.current = draft;

  const choices = useMemo(() => starterChoices(shelf.articles), [shelf.articles]);
  const starter = starterState(starterSlug, shelf.articles);
  const already = giftsAlreadyAt(email, vouchers);
  const count = wholeNumber(articles);
  const input: NewVoucherInput | null = count === null ? null : {
    email,
    articles: count,
    note: note.trim() === "" ? null : note,
    recipientNote: recipientNote.trim() === "" ? null : recipientNote,
    recipientName: cleanRecipientName(recipientName),
    starterSlug: starterSlug === "" ? null : starterSlug,
    /* Meaningless without a starter, so not sent without one. */
    ...(starterSlug === "" ? {} : { highPower }),
  };
  /* The server answers an unchanged replay before checking today's article.
     A lost answer must remain recoverable after its link is off or it is gone. */
  const replay = input !== null && canReplay(input);
  const starterOk = starterReady(starter) || replay;

  async function draftGift() {
    /* The button is disabled too; this is Enter in a field. */
    if (starterSlug === "" || !rights || busy) return;
    setBusy(true);
    const answer = await drafts.ensure(starterSlug, { highPower });
    setBusy(false);
    if (answer.kind === "refused") {
      setRefusal(answer.message);
      return;
    }
    setRefusal(null);
    setStarterSlug("");
    setRights(false);
    setHighPower(true);
    onDrafted(answer);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setDone(null);
    if (forAuthor) {
      await draftGift();
      return;
    }
    /* The button is disabled too; this is Enter in a field. */
    if (!starterOk) return;
    if (input === null) {
      setRefusal("Articles must be a whole number.");
      return;
    }
    /* Refuse the raw value before trim can shorten it, as the route does. */
    if (recipientNameTooLong(recipientName)) {
      setRefusal(RECIPIENT_NAME_TOO_LONG);
      return;
    }
    setBusy(true);
    const sent = draft;
    const answer = await create(input);
    setBusy(false);
    setRefusal(answer.kind === "refused" ? answer.message : null);
    if (answer.kind === "created") {
      setDone(createdSentence(answer));
      if (draftNow.current !== sent) return;
      setEmail("");
      setArticles(String(DEFAULT_ARTICLES));
      setNote("");
      setRecipientNote("");
      setRecipientName("");
      setStarterSlug("");
      setHighPower(true);
    }
  }

  return (
    <form
      onSubmit={(e) => void submit(e)}
      /* Ticked, the hidden voucher fields must not hold the draft back: a
         browser will not submit past a required box it cannot show. */
      noValidate={forAuthor}
      className="tw:mb-8 tw:rounded-lg tw:border tw:border-border tw:bg-card tw:p-4"
      aria-label="New gift"
    >
      <h2 className="tw:m-0 tw:mb-3 tw:text-sm tw:font-medium tw:text-foreground">New gift</h2>
      <label className="tw:mb-3 tw:flex tw:items-start tw:gap-2 tw:text-sm tw:text-foreground">
        <input
          id="voucher-new-for-author"
          type="checkbox"
          checked={forAuthor}
          disabled={busy}
          onChange={(e) => {
            setForAuthor(e.target.checked);
            setRefusal(null);
            setDone(null);
          }}
        />
        <span>For the author of one of my articles — look up their address, and send it later</span>
      </label>
      {refusal && <Refusal message={refusal} />}
      {done && (
        <p role="status" className="tw:m-0 tw:mb-3 tw:text-sm tw:text-muted-foreground">
          {done}
        </p>
      )}
      {forAuthor && (
        <DraftFields
          shelf={shelf}
          choices={choices}
          slug={starterSlug}
          onChoose={setStarterSlug}
          rights={rights}
          onRights={setRights}
          highPower={highPower}
          onHighPower={setHighPower}
          busy={busy}
        />
      )}
      {/* The voucher's own fields, hidden rather than unmounted while ticked,
          so unticking finds them as they were — the import box's draft too. */}
      <div hidden={forAuthor}>
        <div className="tw:flex tw:flex-wrap tw:items-end tw:gap-3">
          <label className="tw:flex tw:min-w-0 tw:flex-1 tw:basis-56 tw:flex-col tw:gap-1 tw:text-xs tw:text-muted-foreground">
            Email address
            <input
              id="voucher-new-email"
              type="email"
              required
              enterKeyHint="go"
              value={email}
              aria-describedby={already ? "voucher-new-already" : undefined}
              onChange={(e) => {
                /* `Name <a@b>` pasted keeps the address and fills an empty name (plan 261011k). */
                const next = addressBoxChange(e.target.value, recipientName);
                setEmail(next.email);
                setRecipientName(next.name);
              }}
              className={`${INPUT} tw:w-full`}
            />
          </label>
          <label className="tw:flex tw:w-24 tw:flex-col tw:gap-1 tw:text-xs tw:text-muted-foreground">
            Articles
            <input
              id="voucher-new-articles"
              type="number"
              required
              enterKeyHint="go"
              min={1}
              max={1000}
              step={1}
              value={articles}
              onChange={(e) => setArticles(e.target.value)}
              className={`${INPUT} tw:w-full`}
            />
          </label>
        </div>
        {already && (
          <p id="voucher-new-already" className="tw:m-0 tw:mt-2 tw:text-xs tw:text-muted-foreground">
            {alreadyLine(already)}
          </p>
        )}
        {/* Their name, above the note it is drawn above in the email — Greg,
            2026-10-06 (spya-vc6pnm): *"the gift voucher would say something
            like, Dear so-and-so. So maybe it needs a name field as well."*
            Plan 261007f. */}
        <div className="tw:mt-3 tw:flex tw:flex-wrap tw:items-end tw:gap-3">
          <label className="tw:flex tw:min-w-0 tw:flex-1 tw:basis-56 tw:flex-col tw:gap-1 tw:text-xs tw:text-muted-foreground">
            <span>
              <span className="tw:text-sm tw:font-medium tw:text-foreground">Their name</span> (optional — their
              email then opens “{giftEmailGreeting("<name>")}”)
            </span>
            <input
              id="voucher-new-recipient-name"
              type="text"
              enterKeyHint="go"
              autoComplete="off"
              value={recipientName}
              onChange={(e) => setRecipientName(e.target.value)}
              className={`${INPUT} tw:w-full`}
            />
          </label>
        </div>
        {/* **The note they will read comes first and is the loud one**; the
            note only the admin sees is last and quiet. Greg, 2026-10-03
            (spya-prv9yu): *"emphasise the public over the private message"*. */}
        <div className="tw:mt-3 tw:flex tw:flex-wrap tw:items-start tw:gap-3">
          <div className="tw:flex tw:min-w-0 tw:flex-1 tw:basis-72 tw:flex-col tw:gap-1 tw:text-xs tw:text-muted-foreground">
            <label className="tw:flex tw:flex-col tw:gap-1">
              <span>
                <span className="tw:text-sm tw:font-medium tw:text-foreground">Note to them</span> (optional — it
                goes in their email, above our words)
              </span>
              <textarea
                id="voucher-new-recipient-note"
                rows={3}
                value={recipientNote}
                onChange={(e) => setRecipientNote(e.target.value)}
                aria-describedby="voucher-new-recipient-note-hint"
                className={`${TEXTAREA} tw:w-full`}
              />
            </label>
            {/* Greg, 2026-10-02: the note is unlabelled in the email, so
                "add a tooltip or something in the interface to remind me to
                sign my name". */}
            <p id="voucher-new-recipient-note-hint" className="tw:m-0 tw:text-ink-faint">
              Sign it yourself, e.g. “— Greg”. The email comes from Spideryarn, so the note isn’t signed
              otherwise.
            </p>
          </div>
          <EmailSketch
            articles={wholeNumber(articles)}
            name={recipientName}
            note={recipientNote}
            starterEntry={"entry" in starter ? starter.entry : null}
          />
        </div>
        <StarterPicker
          choices={choices}
          slug={starterSlug}
          onChoose={setStarterSlug}
          state={starter}
          statusId={STARTER_STATUS}
          shelfError={shelf.error}
          reload={shelf.reload}
          replay={replay}
        />
        {starterSlug !== "" && (
          <HighPowerBox id="voucher-new-high-power" checked={highPower} onChange={setHighPower} disabled={busy} />
        )}
        {/* The submit is the form's last control and its one filled button —
            *"Make the 'Create voucher' button more visible"*, the same report.
            It was a quiet outline pill in the middle of the first row. */}
        <div className="tw:mt-4 tw:flex tw:flex-wrap tw:items-end tw:gap-3">
          <label className="tw:flex tw:min-w-0 tw:flex-1 tw:basis-56 tw:flex-col tw:gap-1 tw:text-xs tw:text-muted-foreground">
            Private note (optional — only you see it)
            <input
              id="voucher-new-note"
              type="text"
              enterKeyHint="go"
              maxLength={500}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className={`${INPUT} tw:w-full`}
            />
          </label>
          <Button
            type="submit"
            disabled={busy || !starterOk}
            aria-describedby={starterOk ? undefined : STARTER_STATUS}
          >
            {busy ? "Creating…" : "Create voucher"}
          </Button>
        </div>
      </div>
    </form>
  );
}

/**
 * **The ticked form**: the article, the rights tick-box and *Draft a gift*.
 * What `DraftForm` in AdminAuthorGifts.tsx was until plan 261020ab folded it
 * in here (D10 of 261010c: an article imported before the add page asked, or a
 * tab closed before it could). The submit's words differ from *Create voucher*
 * on purpose: this one emails nobody.
 */
function DraftFields({
  shelf,
  choices,
  slug,
  onChoose,
  rights,
  onRights,
  highPower,
  onHighPower,
  busy,
}: {
  shelf: StarterShelf;
  choices: readonly LibraryEntry[];
  slug: string;
  onChoose: (slug: string) => void;
  rights: boolean;
  onRights: (rights: boolean) => void;
  highPower: boolean;
  onHighPower: (on: boolean) => void;
  busy: boolean;
}) {
  return (
    <div className="tw:flex tw:flex-col tw:gap-2 tw:text-xs tw:text-muted-foreground">
      <StarterSelect
        id="author-gift-new-article"
        label={<span className="tw:text-sm tw:font-medium tw:text-foreground">Article (your articles, newest first)</span>}
        noneLabel="Choose one…"
        choices={choices}
        slug={slug}
        onChoose={onChoose}
        reload={shelf.reload}
        disabled={busy}
      />
      {shelf.error && <p className="tw:m-0 tw:text-danger">Couldn’t read your articles. {shelf.error}</p>}
      <label className="tw:flex tw:items-start tw:gap-2 tw:text-foreground">
        <input id="voucher-new-rights" type="checkbox" checked={rights} disabled={busy} onChange={(e) => onRights(e.target.checked)} />
        <span>{SHARING_RIGHTS_CONFIRM}</span>
      </label>
      {slug !== "" && <HighPowerBox id="author-gift-new-high-power" checked={highPower} onChange={onHighPower} disabled={busy} />}
      <p className="tw:m-0">
        Drafting makes the article's private link if it has none, saves a draft, queues the article's main modes, and
        runs a web lookup for the author and an address, using up to three searches. Nothing is emailed: the draft
        appears under Drafts, where you review it and press Send.
      </p>
      <div className="tw:mt-2">
        <Button type="submit" disabled={busy || slug === "" || !rights}>
          {busy ? "Drafting…" : "Draft a gift"}
        </Button>
      </div>
    </div>
  );
}

/**
 * ***High-powered AI* for the chosen article** — plan 261021j § D3 and D4.
 * Ticked by default. It switches the article to Opus as the gift is made, so
 * what is made from then on (the main modes the gift queues among it) is made
 * on Opus; what is already made stays as it was, and the line says so.
 */
function HighPowerBox({
  id,
  checked,
  onChange,
  disabled,
}: {
  id: string;
  checked: boolean;
  onChange: (on: boolean) => void;
  disabled: boolean;
}) {
  const hint = `${id}-hint`;
  return (
    <div className="tw:mt-3 tw:flex tw:flex-col tw:gap-1 tw:text-xs tw:text-muted-foreground">
      <label className="tw:flex tw:items-start tw:gap-2 tw:text-sm tw:text-foreground">
        <input
          id={id}
          type="checkbox"
          checked={checked}
          disabled={disabled}
          aria-describedby={hint}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span>High-powered AI</span>
      </label>
      <p id={hint} className="tw:m-0 tw:text-ink-faint">
        Uses Opus for what is made from now on. What is already made, Structure included, stays as it is — to have it
        all on Opus, tick High-powered AI when you import it.
      </p>
    </div>
  );
}

/**
 * **A sketch of the email they will get**, and where the note goes — Greg,
 * 2026-10-01: *"give a small indication of what the gift voucher email that
 * gets sent will look like and where my note for them would go"*. Plan
 * 261002b.
 *
 * The subject and heading are the email's own words, from
 * src/admin-vouchers.ts, which the renderer calls too. **The body is described
 * rather than quoted**: it depends on who they are (a stranger is invited, a
 * reader is told their numbers), which only the server can look up, and the
 * renderer is not browser code. The note is drawn as typed; the server makes
 * its line breaks plain and escapes it when it builds the email. It is in
 * italics and unlabelled, as in the email. **The greeting** is the email's own
 * line too (`giftEmailGreeting`), drawn only when a name is typed, because the
 * email has no such line otherwise (plan 261007f). **The starter's line** is
 * `giftEmailStarterLine` with the title as the shelf has it, drawn only when
 * one is chosen (plan 261007j). The email uses the article's own title, so a
 * title the administrator renamed on the shelf reads differently there; the
 * sketch says so beside that title rather than promising it will be sent.
 */
function EmailSketch({
  articles,
  name,
  note,
  starterEntry,
}: {
  articles: number | null;
  name: string;
  note: string;
  /** The chosen starter's title, for its line; never its link (plan 261007j). */
  starterEntry: LibraryEntry | null;
}) {
  const n = articles !== null && articles >= 1 ? articles : 1;
  const trimmed = note.trim();
  const who = cleanRecipientName(name);
  return (
    <section
      aria-label="What their email will look like"
      className="tw:min-w-0 tw:flex-1 tw:basis-72 tw:rounded-md tw:border tw:border-border tw:bg-background tw:p-3 tw:text-xs tw:text-muted-foreground"
    >
      <p className="tw:m-0 tw:mb-2">
        <span className="tw:text-ink-faint">Subject:</span> {giftEmailSubject(n)}
      </p>
      <p className="tw:m-0 tw:mb-2 tw:text-sm tw:font-medium tw:text-foreground">{giftEmailHeading(n)}</p>
      {who !== null && <p className="tw:m-0 tw:mb-2 tw:break-words tw:text-foreground">{giftEmailGreeting(who)}</p>}
      {trimmed === "" ? (
        <p className="tw:m-0 tw:mb-2 tw:border-l-2 tw:border-dashed tw:border-highlight/50 tw:pl-2 tw:italic">
          Your note to them goes here, if you write one.
        </p>
      ) : (
        <p className="tw:m-0 tw:mb-2 tw:whitespace-pre-wrap tw:break-words tw:border-l-2 tw:border-highlight tw:pl-2 tw:text-foreground">
          <em>{trimmed}</em>
        </p>
      )}
      {/* The email's own line, then its button; the address stays out of
          this page, key and all (plan 261007j). */}
      {starterEntry !== null && (
        <>
          <p className="tw:m-0 tw:break-words tw:text-foreground">
            {STARTER_LEAD}<EntryTitle entry={starterEntry} />{STARTER_TAIL}
          </p>
          <p className="tw:m-0 tw:mb-2">…and a “Read it” button that opens it.</p>
          {starterEntry.titleOverridden && (
            <p className="tw:m-0 tw:mb-2">
              Your shelf title is shown here. Their email uses the article’s original title.
            </p>
          )}
        </>
      )}
      <p className="tw:m-0">
        …then a short paragraph from us: what Spideryarn is and how to collect the articles (or, if
        the address is already a reader's, how many articles they had left and have now), and a
        button to sign in.
      </p>
    </section>
  );
}

/**
 * What the create form says once the server has the voucher. A replay is a
 * resubmit whose first answer was lost: the server sent nothing the second
 * time, and the table says how the first one went.
 */
function createdSentence(answer: Extract<CreateAnswer, { kind: "created" }>): string {
  return answer.email === "replayed"
    ? "That voucher had already been created, so nothing new was sent. Its email is under Given."
    : "Voucher created. The email to them is on its way. It is under Given.";
}

/**
 * How long a send may say *sending* before the page warns it may not have
 * gone: the server's own ten minutes, after which Retry may take it. Plan
 * 261001p.
 */
const STUCK_AFTER_MS = 10 * 60_000;

/** `sent 1 Oct 2026, 17:20` / `failed (Resend answered 422)` / … — one email's state, in words. */
function emailState(e: VoucherEmailState, now: number): string {
  switch (e.status) {
    case "sent": {
      const when = exactly(e.updatedAt);
      return when ? `sent ${when}` : "sent";
    }
    case "skipped":
      return e.detail ? `not sent (${e.detail})` : "not sent";
    case "failed":
      if (e.detail?.startsWith("request outcome unknown")) {
        return `${e.detail}; it may or may not have gone`;
      }
      return e.detail ? `failed (${e.detail})` : "failed";
    case "queued":
      return "waiting to send";
    case "sending": {
      const since = e.attemptStartedAt ?? undefined;
      const started = since === undefined ? Number.NaN : Date.parse(since);
      return Number.isFinite(started) && now - started > STUCK_AFTER_MS
        ? `sending… since ${exactly(since) ?? "a while ago"}; it may or may not have gone`
        : "sending…";
    }
  }
}

/**
 * One line per email a voucher has: *Email to them* is the gift to the
 * recipient, *Email to you* the notice when it was claimed. Retry appears only
 * where the server's own `retryable` says it would be taken, and is disabled
 * while its request is out, so one click is one send.
 */
function EmailLine({
  label,
  email,
  now,
  retry,
}: {
  label: string;
  email: VoucherEmailState;
  now: number;
  retry: UseAdminVouchers["retry"];
}) {
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  async function again() {
    /* State disables the drawn button; the ref also closes the same-tick gap
       before React has rendered that state. The server still owns the real
       at-most-once guard, but the losing 409 should not overwrite success here. */
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setRefusal(null);
    try {
      const answer = await retry(email.id);
      setRefusal(answer);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="tw:mt-1 tw:text-xs tw:text-muted-foreground">
      <span>
        {label}: {emailState(email, now)}
      </span>
      {email.retryable && (
        <button
          type="button"
          disabled={busy}
          onClick={() => void again()}
          aria-label={`Retry the ${label.toLowerCase()}`}
          className={`${BUTTON} tw:ml-2 tw:h-6 tw:px-2`}
        >
          Retry
        </button>
      )}
      {refusal && (
        <p role="alert" className="tw:m-0 tw:mt-1 tw:text-danger">
          {refusal}
        </p>
      )}
    </div>
  );
}

/**
 * Waiting / Claimed by … on … / Revoked — the status column. The claimant is
 * named by their address now, and that address is the link to their account
 * (plan 261019k): the row's first column is the address the voucher was sent
 * to, which they may since have left.
 */
function Status({ v, account, now }: { v: AdminVoucherRow; account: RowAccount | null; now: number }) {
  const claimant = (fallback: string) => {
    /* `claimantEmail` is normally the freshest address, from the vouchers
       read itself. If that read could not resolve it but the independently
       fetched, non-stale user row did, the id match is still authoritative. */
    const resolvedEmail = account?.usage.kind === "loaded" ? account.usage.user.email : null;
    const words = v.claimantEmail ?? resolvedEmail ?? fallback;
    return account && v.claimedBy !== null ? (
      <AdminUserLink id={account.id} usage={account.usage} now={now}>
        {words}
      </AdminUserLink>
    ) : (
      words
    );
  };
  if (v.revokedAt !== null) {
    const when = readableDate(v.revokedAt);
    return (
      <>
        Revoked{when ? ` on ${when}` : ""}
        {v.claimedBy !== null && <> (had been claimed by {claimant("an account")})</>}
      </>
    );
  }
  if (v.claimedBy === null) return <>Waiting for sign-up</>;
  const when = v.claimedAt === null ? null : readableDate(v.claimedAt);
  return (
    <>
      Claimed by {claimant("an account whose address could not be read")}
      {when ? ` on ${when}` : ""}
    </>
  );
}

/**
 * *How used* — the claimant's current free usage, which is what the allowance
 * is. `remaining` is the server's further private articles, never
 * `limit − used`.
 */
function usage(v: AdminVoucherRow): string {
  const c = v.claimant;
  if (!c) return "—";
  switch (c.kind) {
    case "free":
      return (
        `${c.used} added; free allowance ${c.limit}; room for ${c.remaining} further private ` +
        `${c.remaining === 1 ? "article" : "articles"}${c.lapsed ? " (back on Free)" : ""}`
      );
    case "paid":
      return `On a paid plan (${c.tierId}) — the gift waits until they are on Free`;
    case "unknown":
      return "Plan unknown just now";
  }
}

/**
 * What a row says after a change: the server's refusal, or — when a new
 * address resent the gift and its starter article could no longer be linked —
 * that the email went without it (plan 261007j, Sol's F3).
 */
function whatTheChangeCameTo(answer: UpdateAnswer): { refusal: string | null; saved: string | null } {
  if (answer.kind === "refused") return { refusal: answer.message, saved: null };
  return { refusal: null, saved: answer.starter === "dropped" ? STARTER_DROPPED : null };
}

/**
 * The article a voucher's email linked, under its address — by title, never
 * by link. Fixed at create, so not in Edit (plan 261007j). The title is the
 * revision's own, the author's words; a deleted article keeps its slug.
 */
function StarterLine({ starter }: { starter: AdminVoucherRow["starter"] }) {
  if (starter === null) return null;
  return (
    <div className="tw:break-words tw:text-xs tw:text-muted-foreground" data-tip={starter.slug}>
      Starter:{" "}
      {starter.title === null ? (
        `${starter.slug} (deleted)`
      ) : (
        <span className={voiceClass("author")}>{starter.title}</span>
      )}
      {starter.owner != null && (
        <>
          {" · "}
          <StarterOwnerLine owner={starter.owner} />
        </>
      )}
    </div>
  );
}

/** The account a row is about, and what the page knows of its usage. */
type RowAccount = { readonly id: string; readonly usage: AccountUsage };

/**
 * **Which account a voucher's row is about**, for its link to /admin/users
 * (plan 261019k). A claimed voucher names its claimant by id, so it links
 * whether or not the user list has arrived, from the claimant's address in
 * Status. A waiting one is matched by address, and only to exactly one account:
 * two accounts can hold one address (src/store/admin-accounts.ts treats that as
 * ambiguous too), and a guess between them would link the wrong person; it
 * links from the Email column. No match, no link: nobody has signed up with it.
 * A revoked voucher nobody claimed is about an address, not an account.
 */
export function accountForVoucher(
  v: Pick<AdminVoucherRow, "claimedBy" | "email" | "revokedAt">,
  list: Pick<UseAdminUsers, "users" | "error">,
): RowAccount | null {
  const { users, error } = list;
  if (v.claimedBy !== null) {
    const id = v.claimedBy;
    if (users === null) return { id, usage: error === null ? { kind: "loading" } : { kind: "failed", error } };
    const user = users.find((u) => u.id === id);
    if (!user) return { id, usage: error === null ? { kind: "missing" } : { kind: "failed", error } };
    return { id, usage: error === null ? { kind: "loaded", user } : { kind: "stale", user, error } };
  }
  /* A failed refresh leaves `users` in memory. That is useful for the usage
     on an id-based claimed link, but not evidence that an address still
     belongs to the same account: suppress waiting-row links until a fresh
     list arrives rather than pointing one at yesterday's address holder. */
  if (users === null || error !== null || v.revokedAt !== null) return null;
  const address = normaliseEmail(v.email);
  const holders: AdminUser[] = users.filter((u) => normaliseEmail(u.email) === address);
  const only = holders.length === 1 ? holders[0] : undefined;
  return only ? { id: only.id, usage: { kind: "loaded", user: only } } : null;
}

function VoucherRow({
  voucher,
  update,
  retry,
  now,
  account,
}: {
  voucher: AdminVoucherRow;
  update: UseAdminVouchers["update"];
  retry: UseAdminVouchers["retry"];
  now: number;
  account: RowAccount | null;
}) {
  const [editing, setEditing] = useState(false);
  const [articles, setArticles] = useState(String(voucher.articles));
  const [note, setNote] = useState(voucher.note ?? "");
  const [recipientNote, setRecipientNote] = useState(voucher.recipientNote ?? "");
  const [recipientName, setRecipientName] = useState(voucher.recipientName ?? "");
  const [email, setEmail] = useState(voucher.email);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  /* Said after a save that went through but did not do all it might have. */
  const [saved, setSaved] = useState<string | null>(null);
  const firstField = useRef<HTMLInputElement>(null);
  const editButton = useRef<HTMLButtonElement>(null);
  const wasEditing = useRef(false);
  const unclaimed = voucher.claimedBy === null;
  const revoked = voucher.revokedAt !== null;
  /* Also changes if a refresh says a waiting voucher was claimed while its
     editor was open, when the email field gives way to the article field. */
  const focusDestination = editing ? (unclaimed ? "email" : "articles") : "edit";

  /* The Edit button disappears when the fields arrive. Put focus on the first
     field rather than leaving a keyboard user on a detached element. */
  useEffect(() => {
    if (focusDestination !== "edit") firstField.current?.focus();
    else if (wasEditing.current) editButton.current?.focus();
    wasEditing.current = focusDestination !== "edit";
  }, [focusDestination]);

  async function send(patch: VoucherPatchInput): Promise<boolean> {
    setBusy(true);
    setSaved(null);
    const answer = await update(voucher.id, patch);
    setBusy(false);
    const said = whatTheChangeCameTo(answer);
    setRefusal(said.refusal);
    setSaved(said.saved);
    return answer.kind === "saved";
  }

  function startEditing() {
    setSaved(null);
    setArticles(String(voucher.articles));
    setNote(voucher.note ?? "");
    setRecipientNote(voucher.recipientNote ?? "");
    setRecipientName(voucher.recipientName ?? "");
    setEmail(voucher.email);
    setRefusal(null);
    setEditing(true);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    const count = wholeNumber(articles);
    if (count === null) {
      setRefusal("Articles must be a whole number.");
      return;
    }
    if (recipientNameTooLong(recipientName)) {
      setRefusal(RECIPIENT_NAME_TOO_LONG);
      return;
    }
    /* Only what changed, so a save never sends an address for a claimed
       voucher (which the server would refuse with a 409). */
    const patch: { -readonly [K in keyof VoucherPatchInput]: VoucherPatchInput[K] } = {};
    if (count !== voucher.articles) patch.articles = count;
    const nextNote = note.trim() === "" ? null : note.trim();
    if (nextNote !== voucher.note) patch.note = nextNote;
    const nextRecipientNote = recipientNote.trim() === "" ? null : recipientNote;
    if (nextRecipientNote !== voucher.recipientNote) patch.recipientNote = nextRecipientNote;
    const nextRecipientName = cleanRecipientName(recipientName);
    if (nextRecipientName !== voucher.recipientName) patch.recipientName = nextRecipientName;
    if (unclaimed && email.trim().toLowerCase() !== voucher.email) patch.email = email;
    if (Object.keys(patch).length === 0) {
      setEditing(false);
      return;
    }
    if (await send(patch)) setEditing(false);
  }

  return (
    <tr className={`tw:border-b tw:border-border/60 tw:last:border-0 ${revoked ? "tw:text-muted-foreground" : ""}`}>
      {/* Held at the left while the notes and statuses scroll (plan 261019o),
          and narrower on a phone, where it cannot be scrolled past. */}
      <td className={`${CELL} ${PINNED} tw:min-w-40 tw:sm:min-w-48 tw:break-all`}>
        {editing && unclaimed ? (
          <input
            ref={firstField}
            type="email"
            aria-label="Email address"
            enterKeyHint="done"
            form={`voucher-${voucher.id}`}
            value={email}
            onChange={(e) => {
              /* `Name <a@b>` pasted keeps the address and fills an empty name (plan 261011k). */
              const next = addressBoxChange(e.target.value, recipientName);
              setEmail(next.email);
              setRecipientName(next.name);
            }}
            className={`${INPUT} tw:w-36 tw:sm:w-56`}
          />
        ) : account && voucher.claimedBy === null ? (
          <AdminUserLink id={account.id} usage={account.usage} now={now}>
            {voucher.email}
          </AdminUserLink>
        ) : (
          voucher.email
        )}
        {/* Their name under the address: the list reads more easily with a
            name on each row than an address alone (plan 261007f). */}
        {editing ? (
          <input
            type="text"
            aria-label="Their name"
            enterKeyHint="done"
            autoComplete="off"
            form={`voucher-${voucher.id}`}
            value={recipientName}
            onChange={(e) => setRecipientName(e.target.value)}
            className={`${INPUT} tw:mt-1 tw:block tw:w-36 tw:sm:w-56`}
          />
        ) : (
          voucher.recipientName !== null && (
            <div className="tw:break-words tw:text-xs tw:text-muted-foreground">{voucher.recipientName}</div>
          )
        )}
        <StarterLine starter={voucher.starter} />
      </td>
      <td className={`${CELL} tw:text-right tw:tabular-nums`}>
        {editing ? (
          <input
            ref={unclaimed ? undefined : firstField}
            type="number"
            aria-label="Articles"
            enterKeyHint="done"
            form={`voucher-${voucher.id}`}
            min={1}
            max={1000}
            step={1}
            value={articles}
            onChange={(e) => setArticles(e.target.value)}
            className={`${INPUT} tw:w-20`}
          />
        ) : (
          voucher.articles
        )}
      </td>
      <td className={`${CELL} tw:min-w-48`}>
        {editing ? (
          <>
            <textarea
              aria-label="Note to them"
              form={`voucher-${voucher.id}`}
              rows={3}
              value={recipientNote}
              onChange={(e) => setRecipientNote(e.target.value)}
              className={`${TEXTAREA} tw:w-56`}
            />
            {/* The email is frozen when it is queued (plan 261001p), so an
                edit here changes what a later email to a new address says,
                and nothing already sent or waiting. */}
            <p className="tw:m-0 tw:mt-1 tw:max-w-56 tw:text-xs tw:text-muted-foreground">
              Changing it does not resend the email. A new address would get the new note. The same
              goes for their name.
            </p>
          </>
        ) : (
          <span className="tw:whitespace-pre-wrap tw:break-words">{voucher.recipientNote ?? ""}</span>
        )}
      </td>
      <td className={`${CELL} tw:min-w-32`}>
        {editing ? (
          <input
            type="text"
            aria-label="Private note"
            enterKeyHint="done"
            form={`voucher-${voucher.id}`}
            maxLength={500}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className={`${INPUT} tw:w-48`}
          />
        ) : (
          <span className="tw:text-muted-foreground">{voucher.note ?? ""}</span>
        )}
      </td>
      <td className={`${CELL} tw:whitespace-nowrap`}>{readableDate(voucher.createdAt) ?? "—"}</td>
      <td className={`${CELL} tw:min-w-48`}>
        <Status v={voucher} account={account} now={now} />
        {voucher.emails.gift && <EmailLine label="Email to them" email={voucher.emails.gift} now={now} retry={retry} />}
        {voucher.emails.claimed && (
          <EmailLine label="Email to you" email={voucher.emails.claimed} now={now} retry={retry} />
        )}
      </td>
      <td className={`${CELL} tw:min-w-56`}>{usage(voucher)}</td>
      <td className={CELL}>
        {refusal && (
          <p role="alert" className="tw:m-0 tw:mb-2 tw:text-xs tw:text-danger">
            {refusal}
          </p>
        )}
        {saved && (
          <p role="status" className="tw:m-0 tw:mb-2 tw:max-w-56 tw:text-xs tw:text-foreground">
            {saved}
          </p>
        )}
        {editing ? (
          <form
            id={`voucher-${voucher.id}`}
            onSubmit={(e) => void save(e)}
            className="tw:flex tw:flex-wrap tw:gap-2"
          >
            <button type="submit" disabled={busy} className={`${BUTTON} tone-positive`}>
              {busy ? "Saving…" : "Save"}
            </button>
            <button type="button" disabled={busy} onClick={() => setEditing(false)} className={`${BUTTON} tone-negative`}>
              Cancel
            </button>
          </form>
        ) : (
          <div className="tw:flex tw:flex-wrap tw:gap-2">
            <button ref={editButton} type="button" disabled={busy} onClick={startEditing} className={BUTTON}>
              Edit
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void send({ revoked: !revoked })}
              className={BUTTON}
            >
              {revoked ? "Restore" : "Revoke"}
            </button>
          </div>
        )}
      </td>
    </tr>
  );
}

/**
 * The *New gift* form, once the administrator's shelf is read for its article
 * picker. A component of its own because the shelf's hook needs a reader.
 */
function SignedInForm({
  readerId,
  create,
  canReplay,
  vouchers,
  drafts,
  onDrafted,
}: {
  readerId: string;
  create: UseAdminVouchers["create"];
  canReplay: UseAdminVouchers["canReplay"];
  vouchers: UseAdminVouchers["vouchers"];
  drafts: Pick<UseAdminAuthorGifts, "ensure">;
  onDrafted: (answer: Drafted) => void;
}) {
  const shelf = useStarterShelf(readerId);
  return (
    <CreateForm
      create={create}
      canReplay={canReplay}
      vouchers={vouchers}
      shelf={shelf}
      drafts={drafts}
      onDrafted={onDrafted}
    />
  );
}

/* --------------------------------------------------------------- tabs -- */

/**
 * The three tabs, in order. *Give / Drafts / Given*: short, parallel, and
 * named for what you do there rather than for the widget (plan 261020ab).
 */
const TABS = ["give", "drafts", "given"] as const;
type Tab = (typeof TABS)[number];
const TAB_NAMES: Record<Tab, string> = { give: "Give", drafts: "Drafts", given: "Given" };
const tabId = (tab: Tab) => `vouchers-tab-${tab}`;
const panelId = (tab: Tab) => `vouchers-panel-${tab}`;

/**
 * **`?tab=drafts|given`**, absent for Give, so a reload keeps your place
 * (P1-04 of the plan's review). Replace, not push: a tab is a view of one
 * page, not somewhere Back should walk through. An unknown value reads as
 * absent.
 */
const tabParam = parseAsStringLiteral(["drafts", "given"] as const).withOptions({ history: "replace" });
/** `?gift=<id>`, MCP's link to one gift (plan 261011n § D1); cleared by a tab chosen by hand. */
const giftParam = parseAsString.withOptions({ history: "replace" });

/**
 * **The row of tabs** — the Feedback dialog's (`FeedbackDialog.tsx`), shared
 * class and all, so a control that does the same job looks the same
 * (controls.md): a `role="tablist"` of buttons with a roving `tabIndex`, so
 * only the chosen tab is in the Tab order, and Left and Right (Home and End
 * too) moving between them and round the ends. `counts` is drawn after a
 * name; null draws none.
 */
function VoucherTabs({
  tab,
  counts,
  onChoose,
}: {
  tab: Tab;
  counts: Record<Tab, number | null>;
  onChoose: (tab: Tab) => void;
}) {
  const refs = useRef<Partial<Record<Tab, HTMLButtonElement | null>>>({});
  const choose = (next: Tab) => {
    onChoose(next);
    refs.current[next]?.focus();
  };
  const onKey = (e: ReactKeyboardEvent<HTMLButtonElement>) => {
    const at = TABS.indexOf(tab);
    const to =
      e.key === "ArrowRight"
        ? TABS[(at + 1) % TABS.length]
        : e.key === "ArrowLeft"
          ? TABS[(at + TABS.length - 1) % TABS.length]
          : e.key === "Home"
            ? TABS[0]
            : e.key === "End"
              ? TABS[TABS.length - 1]
              : undefined;
    if (to === undefined) return;
    e.preventDefault();
    choose(to);
  };
  return (
    <div className="fb-tabs tw:mb-5" role="tablist" aria-label="Gift vouchers">
      {TABS.map((t) => {
        const count = counts[t];
        return (
          <button
            key={t}
            ref={(el) => {
              refs.current[t] = el;
            }}
            type="button"
            role="tab"
            id={tabId(t)}
            className="fb-tab"
            aria-selected={tab === t}
            aria-controls={panelId(t)}
            tabIndex={tab === t ? 0 : -1}
            onClick={() => choose(t)}
            onKeyDown={onKey}
          >
            {TAB_NAMES[t]}
            {count !== null && <span className="tw:ml-1.5 tw:font-normal tw:tabular-nums tw:text-muted-foreground">{count}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** One tab's panel. **Always mounted**, hidden when not chosen, so a half-typed form survives a switch and the gift list's lookup poll keeps running. */
function TabPanel({ tab, chosen, children }: { tab: Tab; chosen: Tab; children: ReactNode }) {
  return (
    <div role="tabpanel" id={panelId(tab)} aria-labelledby={tabId(tab)} hidden={tab !== chosen}>
      {children}
    </div>
  );
}

export function AdminVouchersPage() {
  useDocumentTitle(pageTitle({ kind: "admin", page: "vouchers" }));
  const { vouchers, error, loading, reload, create, canReplay, update, retry, reloadAfterEmail } = useAdminVouchers();
  /* Whose shelf the starter picker reads. App draws every admin page signed
     in, inside this provider; null would be a page drawn outside it. */
  const readerId = useContext(SignedInReader);
  /* For the *may or may not have gone* warning on a send stuck past ten minutes. */
  const now = useNow();
  /* The accounts the rows link to, and the usage on each link's card: the
     same read /admin/users makes (plan 261019k). */
  const accounts = useAdminUsers();
  /* **One read of the author gifts for the page** (P1-01 of plan 261020ab's
     review): the form drafts into it, the Drafts tab draws it, and the tab
     counts it. Two would each read and poll, and a draft made by one would not
     reach the other. */
  const gifts = useAdminAuthorGifts();

  const [tabInAddress, setTabInAddress] = useQueryState("tab", tabParam);
  const [giftInAddress, setGiftInAddress] = useQueryState(AUTHOR_GIFT_PARAM, giftParam);
  const giftIdInAddress = giftIdOrNull(giftInAddress);
  /* `?gift=<id>` with no `?tab=` opens Drafts, where that gift is. */
  const tab: Tab = tabInAddress ?? (giftIdInAddress === null ? "give" : "drafts");
  /* The gift the page points at: the address's, then whichever *Draft a gift* made or found. */
  const [pointer, setPointer] = useState<GiftPointer | null>(() => {
    return giftIdInAddress === null ? null : { id: giftIdInAddress };
  });
  const lastAddressGift = useRef(giftIdInAddress);
  /* The admin route stays mounted when navigation changes only its query. A
     later MCP review address must point just as an initial one does. Clearing
     `?gift=` does not clear a draft made in this mount; adding another valid id
     creates a fresh pointer, so even the same card scrolls and opens again. */
  useEffect(() => {
    if (giftIdInAddress === lastAddressGift.current) return;
    lastAddressGift.current = giftIdInAddress;
    if (giftIdInAddress !== null) setPointer({ id: giftIdInAddress });
  }, [giftIdInAddress]);
  /* What the last *Draft a gift* came to, said on Drafts, where it takes you. */
  const [notice, setNotice] = useState<string | null>(null);

  /* A tab chosen by hand drops `?gift=`, so a reload never has to choose between them. */
  const chooseTab = (next: Tab) => {
    void setTabInAddress(next === "give" ? null : next);
    void setGiftInAddress(null);
  };

  const onDrafted = (answer: Drafted) => {
    setNotice(
      answer.kind === "created"
        ? "Drafted. The lookup for its author is running now; this list updates when it finishes."
        : "That article already has a gift, so nothing new was made. It is highlighted below.",
    );
    setPointer({ id: answer.id });
    chooseTab("drafts");
  };

  const waiting = giftsWaiting(gifts.gifts);

  return (
    <Shell title="Gift vouchers" back={{ href: ADMIN_HREF, label: "Back to Admin" }}>
      <VoucherTabs
        tab={tab}
        counts={{ give: null, drafts: waiting === 0 ? null : waiting, given: vouchers === null ? null : vouchers.length }}
        onChoose={chooseTab}
      />

      <TabPanel tab="give" chosen={tab}>
        {/* Greg, 2026-10-19 (spya-vuw2hy): the two sections read as two kinds of
            gift. They are one kind and a shortcut to it — plan 261019i. Here,
            above the form, since it is about giving (plan 261020ab). */}
        <div className="tw:mb-6 tw:flex tw:flex-col tw:gap-2 tw:text-sm tw:text-muted-foreground">
          <p className="tw:m-0">
            A <span className="tw:font-medium tw:text-foreground">voucher</span> adds articles to the free
            allowance of whoever signs in with that address, and counts only while they are on the Free plan.
            Several to one address add up.
          </p>
          <p className="tw:m-0">
            A voucher can include one of your articles as a{" "}
            <span className="tw:font-medium tw:text-foreground">starter article</span>. The first gift email links
            to it, so they have something to read straight away. Receiving or reading it uses none of their
            allowance. When they sign in, the starter moves to their account, unless something makes that unsafe (it is
            public, another gift names it, or it has your notes on it); then they go on reading your copy by its
            link. Giving one queues the article's main modes, made while you have Spideryarn open, and, with
            High-powered AI ticked, switches it to Opus at no cost to them. After that, what they do themselves —
            High-powered AI on one they own that you left off, or importing their own copy of one that stayed — uses
            their allowance as usual.
          </p>
          <p className="tw:m-0">
            An <span className="tw:font-medium tw:text-foreground">author gift</span> is a shortcut for drafting a
            voucher for the author of one of your articles: tick the box at the top of the form. That article is its
            starter. A lookup suggests their address, and the gift waits under Drafts until you press Send. Once Send
            succeeds, it creates an ordinary voucher, under Given.
          </p>
        </div>

        {readerId === null ? (
          <Refusal message="Sign in again to create a voucher." />
        ) : (
          <SignedInForm
            readerId={readerId}
            create={create}
            canReplay={canReplay}
            vouchers={loading || error !== null ? null : vouchers}
            drafts={gifts}
            onDrafted={onDrafted}
          />
        )}
      </TabPanel>

      <TabPanel tab="drafts" chosen={tab}>
        <AuthorGifts
          gifts={gifts}
          pointer={pointer}
          notice={notice}
          active={tab === "drafts"}
          onVoucherMade={reloadAfterEmail}
        />
      </TabPanel>

      <TabPanel tab="given" chosen={tab}>
        {error && <Refusal message={vouchers ? `Refresh failed, so this is the previous list. ${error}` : error} />}
        {/* Without the accounts a waiting voucher's address looks exactly like
            one nobody has signed up with, so the page says which it is. */}
        {accounts.error && (
          <Refusal
            message={
              accounts.users
                ? `Refreshing the accounts failed. Claimed links show usage from the last successful read; waiting vouchers are not linked until the accounts can be refreshed. ${accounts.error}`
                : `Could not read the accounts, so vouchers waiting for sign-up are not linked to Users, and the links on claimed ones show no usage. ${accounts.error}`
            }
          />
        )}

        <div className="tw:mb-3 tw:flex tw:flex-wrap tw:items-center tw:justify-between tw:gap-3">
          <span className="tw:text-xs tw:text-muted-foreground">
            {vouchers === null ? "" : vouchers.length === 1 ? "1 voucher" : `${vouchers.length} vouchers`}
          </span>
          <button
            type="button"
            onClick={() => {
              void reload();
              void accounts.reload();
            }}
            disabled={loading || accounts.loading}
            aria-label="Refresh the vouchers"
            data-tip="Refresh the vouchers and their accounts"
            data-tip-describes="off"
            className={BUTTON}
          >
            <RefreshCw size={12} />
            {loading || accounts.loading ? "Loading…" : "Refresh"}
          </button>
        </div>

        {vouchers === null ? null : vouchers.length === 0 ? (
          <p className="tw:text-sm tw:text-muted-foreground">No vouchers yet.</p>
        ) : (
          /* `relative` because the caption and the Actions header are `sr-only`,
             which is `position: absolute`: with no positioned ancestor they were
             laid out against the table's full width rather than clipped by this
             box, and the whole page scrolled sideways by 336px at 390. The same
             bug and fix as DataTable.tsx § the scroll box. The `min-w-*` on the
             wordy columns are what make the table scroll in here rather than
             squeezing an address to two characters a line. Plan 261001m.

             The shared box without its shade, so it is measured and takes
             keyboard focus while the table is wider than it (plan 261006h). */
          <SidewaysScrollBox label={CAPTION} cue={false}>
            <table className="tw:w-full tw:border-collapse tw:text-sm">
              <caption className="tw:sr-only">{CAPTION}</caption>
              <thead>
                <tr className="tw:border-b tw:border-border">
                  <th className={`${HEAD} ${PINNED}`}>Email</th>
                  <th className={`${HEAD} tw:text-right`}>Articles</th>
                  <th className={HEAD}>Note to them</th>
                  <th className={HEAD}>Private note</th>
                  <th className={HEAD}>Created</th>
                  <th className={HEAD}>Status</th>
                  <th className={HEAD}>Claimant's free usage</th>
                  <th className={HEAD}>
                    <span className="tw:sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {vouchers.map((v) => (
                  <VoucherRow
                    key={v.id}
                    voucher={v}
                    update={update}
                    retry={retry}
                    now={now}
                    account={accountForVoucher(v, accounts)}
                  />
                ))}
              </tbody>
            </table>
          </SidewaysScrollBox>
        )}
      </TabPanel>
    </Shell>
  );
}
