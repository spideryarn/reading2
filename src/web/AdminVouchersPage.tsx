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
 */
import { useCallback, useContext, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { RefreshCw } from "lucide-react";

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
import type { LibraryEntry } from "../types.js";
import { Shell } from "./AdminPage.js";
import { Button } from "./components/ui/button.js";
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
import { useJobs } from "./useJobs.js";
import { useNow } from "./useNow.js";
import { useShelf } from "./useShelf.js";
import { articleTitleVoice, voiceClass } from "./voice.js";

/** The table's name: its caption, and its scroll box's while it scrolls. */
const CAPTION = "Every gift voucher, newest first";

const INPUT =
  "tw:h-8 tw:rounded-md tw:border tw:border-border tw:bg-card tw:px-2 tw:text-sm tw:text-foreground tw:outline-none tw:any-pointer-coarse:text-base tw:focus:border-highlight-text tw:focus:ring-2 tw:focus:ring-highlight-text/25";
const BUTTON =
  "tw:inline-flex tw:h-7 tw:items-center tw:gap-1 tw:rounded-full tw:border tw:border-border tw:bg-transparent tw:px-3 tw:text-xs tw:text-muted-foreground tw:hover:border-highlight/50 tw:hover:text-foreground tw:disabled:opacity-50";
/** The note to them is a sentence or two, so it gets lines rather than a single box. */
const TEXTAREA =
  "tw:min-h-16 tw:rounded-md tw:border tw:border-border tw:bg-card tw:px-2 tw:py-1.5 tw:text-sm tw:text-foreground tw:outline-none tw:any-pointer-coarse:text-base tw:focus:border-highlight-text tw:focus:ring-2 tw:focus:ring-highlight-text/25";
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

function Refusal({ message }: { message: string }) {
  return (
    <p
      role="alert"
      className="tw:mb-4 tw:rounded-md tw:border tw:border-destructive/40 tw:bg-destructive/10 tw:p-3 tw:text-sm tw:text-foreground"
    >
      {message}
    </p>
  );
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

/** What a starter can be: the shelf's articles that have been read, newest first. */
function starterChoices(shelf: readonly LibraryEntry[] | null): LibraryEntry[] {
  return (shelf ?? [])
    .filter((a) => a.processing !== "minimal")
    .sort((a, b) => (a.addedAt < b.addedAt ? 1 : a.addedAt > b.addedAt ? -1 : 0));
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
      <div className="tw:flex tw:flex-wrap tw:items-end tw:gap-2">
        <label className="tw:flex tw:min-w-0 tw:flex-1 tw:basis-56 tw:flex-col tw:gap-1">
          <span>
            <span className="tw:text-sm tw:font-medium tw:text-foreground">Starter article</span> (optional —
            their email links it, to start with; your articles, newest first)
          </span>
          <select
            id="voucher-new-starter"
            value={slug}
            onChange={(e) => onChoose(e.target.value)}
            className={`${INPUT} tw:w-full tw:min-w-0`}
          >
            <option value="">None</option>
            {choices.map((a) => (
              <option key={a.slug} value={a.slug}>
                {a.title}
              </option>
            ))}
          </select>
        </label>
        <button type="button" onClick={reload} title="Read your articles again" className={BUTTON}>
          <RefreshCw size={12} />
          Refresh
        </button>
      </div>
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
      {shelfError && <p className="tw:m-0 tw:text-destructive">Couldn’t read your articles. {shelfError}</p>}
      <StarterStatus state={state} id={statusId} replay={replay} />
    </div>
  );
}

function CreateForm({ create, canReplay, readerId }: {
  create: UseAdminVouchers["create"];
  canReplay: UseAdminVouchers["canReplay"];
  readerId: string;
}) {
  const [email, setEmail] = useState("");
  const [articles, setArticles] = useState(String(DEFAULT_ARTICLES));
  const [note, setNote] = useState("");
  const [recipientNote, setRecipientNote] = useState("");
  const [recipientName, setRecipientName] = useState("");
  const [starterSlug, setStarterSlug] = useState("");
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  /* The draft as it stands now, read when a create answers: the fields stay
     editable while it is in flight, and a draft typed meanwhile is not the
     one that was sent, so it is not cleared (Sol's F13 on 261007j). */
  const draft = JSON.stringify([email, articles, note, recipientNote, recipientName, starterSlug]);
  const draftNow = useRef(draft);
  draftNow.current = draft;

  /* The administrator's own shelf, for the starter. Read again when an import
     finishes (the shelf page's own wiring, Library.tsx) and on Refresh. */
  const shelf = useShelf(readerId);
  const reloadShelf = shelf.reload;
  /* A failed read is already in `shelf.error`, which the picker shows. */
  const readShelfAgain = useCallback(() => void reloadShelf().catch(() => {}), [reloadShelf]);
  useJobs("watches-queue", readShelfAgain);
  const choices = useMemo(() => starterChoices(shelf.articles), [shelf.articles]);
  const starter = starterState(starterSlug, shelf.articles);
  const count = wholeNumber(articles);
  const input: NewVoucherInput | null = count === null ? null : {
    email,
    articles: count,
    note: note.trim() === "" ? null : note,
    recipientNote: recipientNote.trim() === "" ? null : recipientNote,
    recipientName: cleanRecipientName(recipientName),
    starterSlug: starterSlug === "" ? null : starterSlug,
  };
  /* The server answers an unchanged replay before checking today's article.
     A lost answer must remain recoverable after its link is off or it is gone. */
  const replay = input !== null && canReplay(input);
  const starterOk = starterReady(starter) || replay;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setDone(null);
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
    }
  }

  return (
    <form
      onSubmit={(e) => void submit(e)}
      className="tw:mb-8 tw:rounded-lg tw:border tw:border-border tw:bg-card tw:p-4"
      aria-label="New gift voucher"
    >
      <h2 className="tw:m-0 tw:mb-3 tw:text-sm tw:font-medium tw:text-foreground">New voucher</h2>
      {refusal && <Refusal message={refusal} />}
      {done && (
        <p role="status" className="tw:m-0 tw:mb-3 tw:text-sm tw:text-muted-foreground">
          {done}
        </p>
      )}
      <div className="tw:flex tw:flex-wrap tw:items-end tw:gap-3">
        <label className="tw:flex tw:min-w-0 tw:flex-1 tw:basis-56 tw:flex-col tw:gap-1 tw:text-xs tw:text-muted-foreground">
          Email address
          <input
            id="voucher-new-email"
            type="email"
            required
            enterKeyHint="go"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
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
        reload={readShelfAgain}
        replay={replay}
      />
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
    </form>
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
    ? "That voucher had already been created, so nothing new was sent. Its email is in the table below."
    : "Voucher created. The email to them is on its way.";
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
        <p role="alert" className="tw:m-0 tw:mt-1 tw:text-destructive">
          {refusal}
        </p>
      )}
    </div>
  );
}

/** Waiting / Claimed by … on … / Revoked — the status column. */
function status(v: AdminVoucherRow): string {
  if (v.revokedAt !== null) {
    const when = readableDate(v.revokedAt);
    const claimed = v.claimedBy !== null ? ` (had been claimed by ${v.claimantEmail ?? "an account"})` : "";
    return `Revoked${when ? ` on ${when}` : ""}${claimed}`;
  }
  if (v.claimedBy === null) return "Waiting for sign-up";
  const when = v.claimedAt === null ? null : readableDate(v.claimedAt);
  return `Claimed by ${v.claimantEmail ?? "an account whose address could not be read"}${when ? ` on ${when}` : ""}`;
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
    <div className="tw:break-words tw:text-xs tw:text-muted-foreground" title={starter.slug}>
      Starter:{" "}
      {starter.title === null ? (
        `${starter.slug} (deleted)`
      ) : (
        <span className={voiceClass("author")}>{starter.title}</span>
      )}
    </div>
  );
}

function VoucherRow({
  voucher,
  update,
  retry,
  now,
}: {
  voucher: AdminVoucherRow;
  update: UseAdminVouchers["update"];
  retry: UseAdminVouchers["retry"];
  now: number;
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
      <td className={`${CELL} tw:min-w-48 tw:break-all`}>
        {editing && unclaimed ? (
          <input
            ref={firstField}
            type="email"
            aria-label="Email address"
            enterKeyHint="done"
            form={`voucher-${voucher.id}`}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={`${INPUT} tw:w-56`}
          />
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
            className={`${INPUT} tw:mt-1 tw:block tw:w-56`}
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
        {status(voucher)}
        {voucher.emails.gift && <EmailLine label="Email to them" email={voucher.emails.gift} now={now} retry={retry} />}
        {voucher.emails.claimed && (
          <EmailLine label="Email to you" email={voucher.emails.claimed} now={now} retry={retry} />
        )}
      </td>
      <td className={`${CELL} tw:min-w-56`}>{usage(voucher)}</td>
      <td className={CELL}>
        {refusal && (
          <p role="alert" className="tw:m-0 tw:mb-2 tw:text-xs tw:text-destructive">
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
            <button type="submit" disabled={busy} className={BUTTON}>
              {busy ? "Saving…" : "Save"}
            </button>
            <button type="button" disabled={busy} onClick={() => setEditing(false)} className={BUTTON}>
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

export function AdminVouchersPage() {
  useDocumentTitle(pageTitle({ kind: "admin", page: "vouchers" }));
  const { vouchers, error, loading, reload, create, canReplay, update, retry } = useAdminVouchers();
  /* Whose shelf the starter picker reads. App draws every admin page signed
     in, inside this provider; null would be a page drawn outside it. */
  const readerId = useContext(SignedInReader);
  /* For the *may or may not have gone* warning on a send stuck past ten minutes. */
  const now = useNow();

  return (
    <Shell title="Gift vouchers" back={{ href: ADMIN_HREF, label: "Back to Admin" }}>
      <p className="tw:mb-6 tw:text-sm tw:text-muted-foreground">
        A voucher adds articles to the free allowance of whoever signs in with that address, and
        counts only while they are on the Free plan.
      </p>

      {readerId === null ? (
        <Refusal message="Sign in again to create a voucher." />
      ) : (
        <CreateForm create={create} canReplay={canReplay} readerId={readerId} />
      )}

      {error && <Refusal message={vouchers ? `Refresh failed, so this is the previous list. ${error}` : error} />}

      <div className="tw:mb-3 tw:flex tw:flex-wrap tw:items-center tw:justify-between tw:gap-3">
        <span className="tw:text-xs tw:text-muted-foreground">
          {vouchers === null ? "" : vouchers.length === 1 ? "1 voucher" : `${vouchers.length} vouchers`}
        </span>
        <button
          type="button"
          onClick={() => void reload()}
          disabled={loading}
          aria-label="Refresh the vouchers"
          title="Refresh the vouchers"
          className={BUTTON}
        >
          <RefreshCw size={12} />
          {loading ? "Loading…" : "Refresh"}
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
                <th className={HEAD}>Email</th>
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
                <VoucherRow key={v.id} voucher={v} update={update} retry={retry} now={now} />
              ))}
            </tbody>
          </table>
        </SidewaysScrollBox>
      )}
    </Shell>
  );
}
