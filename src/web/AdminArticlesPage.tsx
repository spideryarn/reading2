/**
 * `/admin/articles` — every article, whose it is, and moving one to another
 * account. docs/plans/261011n-author-gift-link-and-article-ownership-transfer.md
 * § D4; the transfer itself is src/store/pg-article-transfer.ts.
 *
 * > And more generally, we want a /admin/articles page, which includes a way
 * > for me to transfer ownership of an article from one user to another.
 * >
 * > — Greg, 2026-10-11 (`spya-wqvxjv`)
 *
 * A plain table, for AdminVouchersPage.tsx's reason: one order, a few columns,
 * and a filter by address or id. Another reader's private article is a row of
 * dates and an owner — the server sends no title or slug for it (D4).
 *
 * **The confirmation is the whole safety of the press.** It names the article
 * and both owners, says it will be made private, lists what of the old owner's
 * will be deleted (the preview's counts), and **re-reads the preview just
 * before it sends** (Opus): if anything moved since it opened, it shows the new
 * state and asks for the press again instead of sending. The POST carries the
 * owner the confirmation showed (`expectedFrom`), so a change of owner in the
 * last moment is the server's 409, in its own words.
 */
import { useEffect, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";

import {
  READER_STATE,
  type AdminArticle,
  type TransferCounts,
  type TransferDone,
  type TransferPreview,
} from "../admin-articles.js";
import { readableDate } from "../billing-plan.js";
import { Shell } from "./AdminPage.js";
import { BUTTON, INPUT, Refusal } from "./admin-vouchers-parts.js";
import { Link } from "./Link.js";
import { SidewaysScrollBox } from "./lib/SidewaysScrollBox.js";
import { pageTitle, useDocumentTitle } from "./page-title.js";
import { exactly } from "./relative-time.js";
import { ADMIN_HREF, readHref } from "./router.js";
import { type AccountChoice, useAdminArticles } from "./useAdminArticles.js";
import { voiceClass } from "./voice.js";

const CAPTION = "Every article, newest first";
const CELL = "tw:px-3 tw:py-2 tw:align-top tw:first:pl-4 tw:last:pr-4";
const HEAD = `${CELL} tw:whitespace-nowrap tw:text-left tw:text-xs tw:font-medium tw:text-muted-foreground`;

/** What the table's filter matches: the owner's address, the article's id or short id. */
export function matchesFilter(article: AdminArticle, filter: string): boolean {
  const q = filter.trim().toLowerCase();
  if (q === "") return true;
  return [article.ownerEmail, article.ownerId, article.id, article.shortId].some(
    (field) => field?.toLowerCase().includes(q) === true,
  );
}

/** The handle a row is known by: its short id, or its id when it has none (Sol F9). */
function handleOf(article: AdminArticle): string {
  return article.shortId ?? article.id;
}

function ownerLabel(article: AdminArticle): string {
  return article.ownerEmail ?? article.ownerId;
}

/** "questions and notes 3, chats 1" — the kinds with any rows, in READER_STATE's order. */
export function describeCounts(counts: TransferCounts): string | null {
  const parts = READER_STATE.filter((k) => counts[k.table] > 0).map((k) => `${k.label} ${counts[k.table]}`);
  return parts.length === 0 ? null : parts.join(", ");
}

const BLOCKED: Record<NonNullable<TransferPreview["blocked"]>, string> = {
  busy: "An import or a job is running on this article. Wait for it to finish, then transfer it.",
  minimal: "Only this article's abstract has been read. Read it in full first, then transfer it.",
};

/** The same preview, as far as the press is concerned: the owner, the counts, the refusal. */
function samePreview(a: TransferPreview, b: TransferPreview): boolean {
  return (
    a.ownerId === b.ownerId &&
    a.blocked === b.blocked &&
    a.visibility === b.visibility &&
    a.privateLink === b.privateLink &&
    READER_STATE.every((k) => a.counts[k.table] === b.counts[k.table])
  );
}

function ArticleCell({ article }: { article: AdminArticle }) {
  if (article.title === null && article.slug === null) {
    return (
      <span className="tw:text-muted-foreground">
        Another reader's private article · <code className="tw:text-xs">{handleOf(article)}</code>
      </span>
    );
  }
  const title = article.title ?? "Untitled";
  return (
    <span>
      {article.slug ? (
        <Link href={readHref(article.slug)} className={voiceClass("author")}>
          {title}
        </Link>
      ) : (
        <span className={voiceClass("author")}>{title}</span>
      )}{" "}
      <code className="tw:text-xs tw:text-muted-foreground">{handleOf(article)}</code>
    </span>
  );
}

interface ConfirmProps {
  readonly article: AdminArticle;
  readonly preview: (id: string) => ReturnType<ReturnType<typeof useAdminArticles>["preview"]>;
  readonly transfer: ReturnType<typeof useAdminArticles>["transfer"];
  readonly accounts: ReturnType<typeof useAdminArticles>["accounts"];
  readonly onCancel: () => void;
  readonly onDone: (done: TransferDone, toLabel: string) => void;
}

/**
 * **The confirmation.** Opened by *Transfer…* on a row; reads the preview and
 * the accounts, and sends only from a preview it has just read again.
 */
function TransferConfirm({ article, preview, transfer, accounts, onCancel, onDone }: ConfirmProps) {
  const [shown, setShown] = useState<TransferPreview | null>(null);
  const [choices, setChoices] = useState<readonly AccountChoice[] | null>(null);
  const [to, setTo] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    void preview(article.id).then((answer) => {
      if (!live) return;
      if (answer.ok) setShown(answer.value);
      else setMessage(answer.message);
    });
    void accounts().then((answer) => {
      if (!live) return;
      if (answer.ok) setChoices(answer.value);
      else setMessage(answer.message);
    });
    return () => {
      live = false;
    };
  }, [article.id, preview, accounts]);

  const target = choices?.find((c) => c.id === to) ?? null;

  async function press() {
    if (!shown || !target) return;
    setBusy(true);
    setMessage(null);
    setNote(null);
    try {
      /* Read again just before the press (Opus): what the person agreed to is
         what is sent, or nothing is. */
      const again = await preview(article.id);
      if (!again.ok) {
        setMessage(again.message);
        return;
      }
      if (!samePreview(shown, again.value)) {
        setShown(again.value);
        if (target.id === again.value.ownerId) setTo("");
        setNote("This article changed since you opened it. Check what will happen again, then press Transfer.");
        return;
      }
      if (again.value.blocked) return;
      const answer = await transfer(article.id, { to: target.id, expectedFrom: shown.ownerId });
      if (!answer.ok) {
        setMessage(answer.message);
        return;
      }
      onDone(answer.value, target.email);
    } finally {
      setBusy(false);
    }
  }

  const deleted = shown ? describeCounts(shown.counts) : null;
  const shownOwner =
    shown === null
      ? ownerLabel(article)
      : (choices?.find((choice) => choice.id === shown.ownerId)?.email ??
        (shown.ownerId === article.ownerId ? ownerLabel(article) : shown.ownerId));
  const unshare =
    shown?.visibility === "public"
      ? "It is public now, and will be taken off the public shelf."
      : shown?.privateLink
        ? "Its private link is on, and will be turned off: anybody holding it loses it."
        : null;

  return (
    <section
      aria-label="Transfer this article"
      className="tw:mb-6 tw:rounded-md tw:border tw:border-border tw:bg-card tw:p-4 tw:text-sm"
    >
      <h2 className="tw:mb-2 tw:text-base tw:font-medium">Transfer this article</h2>
      <p className="tw:mb-3">
        <ArticleCell article={article} /> belongs to <strong>{shownOwner}</strong>.
      </p>
      {message && <Refusal message={message} />}
      {shown === null ? (
        <p className="tw:text-muted-foreground">Reading what a transfer would do…</p>
      ) : (
        <>
          <label className="tw:mb-3 tw:flex tw:flex-wrap tw:items-center tw:gap-2">
            <span>Give it to</span>
            <select
              className={INPUT}
              value={to}
              onChange={(e) => setTo(e.target.value)}
              disabled={choices === null || busy}
              aria-label="The account to give it to"
            >
              <option value="">{choices === null ? "Loading accounts…" : "Choose an account"}</option>
              {(choices ?? []).map((c) => (
                <option key={c.id} value={c.id} disabled={c.id === shown.ownerId || !c.emailConfirmedAt}>
                  {c.email}
                  {c.id === shown.ownerId ? " (owns it now)" : !c.emailConfirmedAt ? " (address not confirmed)" : ""}
                </option>
              ))}
            </select>
          </label>
          <ul className="tw:mb-3 tw:list-disc tw:pl-5">
            <li>It will be made private, and theirs: they read it as their own, with chat and every mode.</li>
            {unshare && <li>{unshare}</li>}
            <li>
              {deleted
                ? `Deleted, as the old owner's: ${deleted}.`
                : "Nothing of the old owner's is on it to delete."}{" "}
              Their reading position, title, purpose and archive state on it are reset. Their charges for it stay
              theirs. Any personal illustration directions, and paintings made from them, are deleted.
            </li>
          </ul>
          {shown.blocked && <Refusal message={BLOCKED[shown.blocked]} />}
          {note && (
            <p role="status" className="tw:mb-3 tw:text-sm">
              {note}
            </p>
          )}
          <div className="tw:flex tw:flex-wrap tw:gap-2">
            <button
              type="button"
              className={BUTTON}
              disabled={busy || target === null || shown.blocked !== null}
              onClick={() => void press()}
            >
              {busy ? "Transferring…" : "Transfer"}
            </button>
            <button type="button" className={BUTTON} disabled={busy} onClick={onCancel}>
              Cancel
            </button>
          </div>
        </>
      )}
    </section>
  );
}

export function AdminArticlesPage() {
  useDocumentTitle(pageTitle({ kind: "admin", page: "articles" }));
  const { list, error, loading, reload, preview, transfer, accounts } = useAdminArticles();
  const [filter, setFilter] = useState("");
  const [open, setOpen] = useState<AdminArticle | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const rows = useMemo(
    () => (list?.articles ?? []).filter((a) => matchesFilter(a, filter)),
    [list, filter],
  );

  return (
    <Shell title="Articles" back={{ href: ADMIN_HREF, label: "Back to Admin" }}>
      <p className="tw:mb-6 tw:text-sm tw:text-muted-foreground">
        Every article and whose it is. Titles show only for your own articles and public ones. Transfer moves an
        article to another account and makes it private; the old owner's notes, chats and other activity on it
        are deleted.
      </p>

      {done && (
        <p role="status" className="tw:mb-4 tw:text-sm">
          {done}
        </p>
      )}

      {open && (
        <TransferConfirm
          key={open.id}
          article={open}
          preview={preview}
          transfer={transfer}
          accounts={accounts}
          onCancel={() => setOpen(null)}
          onDone={(answer, toLabel) => {
            setOpen(null);
            const deleted = describeCounts(answer.deleted);
            setDone(`Moved to ${toLabel}.${deleted ? ` Deleted: ${deleted}.` : ""}`);
            void reload();
          }}
        />
      )}

      {error && <Refusal message={list ? `Refresh failed, so this is the previous list. ${error}` : error} />}
      {list && !list.emailsAvailable && (
        <Refusal message="The account listing did not answer, so owners are shown by id." />
      )}

      <div className="tw:mb-3 tw:flex tw:flex-wrap tw:items-center tw:justify-between tw:gap-3">
        <input
          type="search"
          enterKeyHint="search"
          className={INPUT}
          placeholder="Filter by address or id"
          aria-label="Filter by owner address or article id"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <span className="tw:text-xs tw:text-muted-foreground">
          {list === null ? "" : `${rows.length} of ${list.articles.length}`}
        </span>
        <button
          type="button"
          onClick={() => void reload()}
          disabled={loading}
          aria-label="Refresh the articles"
          title="Refresh the articles"
          className={BUTTON}
        >
          <RefreshCw size={12} />
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      {list === null ? null : rows.length === 0 ? (
        <p className="tw:text-sm tw:text-muted-foreground">
          {list.articles.length === 0 ? "No articles yet." : "Nothing matches that filter."}
        </p>
      ) : (
        /* `relative` for the vouchers table's reason: the sr-only caption and
           header must be clipped by this box, not laid out against the page. */
        <SidewaysScrollBox label={CAPTION} cue={false}>
          <table className="tw:w-full tw:border-collapse tw:text-sm">
            <caption className="tw:sr-only">{CAPTION}</caption>
            <thead>
              <tr className="tw:border-b tw:border-border">
                <th className={HEAD}>Article</th>
                <th className={HEAD}>Owner</th>
                <th className={HEAD}>Added</th>
                <th className={HEAD}>Visibility</th>
                <th className={HEAD}>Read</th>
                <th className={HEAD}>
                  <span className="tw:sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id} className="tw:border-b tw:border-border">
                  <td className={`${CELL} tw:min-w-56`}>
                    <ArticleCell article={a} />
                  </td>
                  <td className={`${CELL} tw:min-w-48`}>
                    {ownerLabel(a)}
                    {a.mine ? " (you)" : ""}
                  </td>
                  <td className={`${CELL} tw:whitespace-nowrap`} title={exactly(a.createdAt)}>
                    {readableDate(a.createdAt) ?? a.createdAt}
                  </td>
                  <td className={CELL}>{a.visibility === "public" ? "Public" : "Private"}</td>
                  <td className={CELL}>{a.processing === "minimal" ? "Abstract only" : "In full"}</td>
                  <td className={CELL}>
                    <button
                      type="button"
                      className={BUTTON}
                      onClick={() => {
                        setDone(null);
                        setOpen(a);
                      }}
                    >
                      Transfer…
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </SidewaysScrollBox>
      )}
    </Shell>
  );
}
