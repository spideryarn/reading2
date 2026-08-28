/**
 * **Access & Sharing** — the owner's switch, on the page that describes the
 * article.
 *
 * The section name is the original version's own, which
 * docs/plans/metadata-page.md recorded and deliberately dropped — *"**drop** —
 * no accounts here"* — on the day there were no accounts. There are now.
 *
 * ## How it finds out whether the document is already shared
 *
 * By asking the public endpoint, anonymously: a 200 means a stranger can read
 * this, a 404 means they cannot. **There is no owner-side field to read** —
 * `GET /api/metadata/:slug` answers with stages, timings and byte counts and
 * says nothing about visibility (`ArticleMetadata` in src/types.ts), and the
 * `PUT` is the only other route that knows, which is not a thing you may call
 * to find out.
 *
 * That turns out to be the better check rather than a workaround: it asks
 * exactly the question the card claims to answer — *can somebody with this link
 * read it* — from exactly the position a stranger asks it from. What it costs
 * is the timestamp, which only the `PUT` returns.
 *
 * **And a third answer, which is the part that matters.** Anything that is
 * neither 200 nor 404 — a 500, a 501 from the filesystem store, a dropped
 * connection — leaves this `null`, and the card says it does not know rather
 * than drawing an off switch. A toggle that reads "not shared" because the
 * check failed is a page that looks exactly like one that works, on the one
 * control where being wrong publishes somebody else's article.
 * docs/reusable/silent-success.md.
 *
 * ## Why the confirmation is inline rather than a modal
 *
 * There is no dialog component in this app — `AnnotateDialog` and
 * `CommentDialog` are hand-built floating panels for the reading view — and a
 * modal is machinery (focus trap, restore, escape, scroll lock) for something
 * that is not an interruption. This is a form: read three sentences, tick the
 * box, press the button. It appears in place, it cannot be skipped, and the
 * `PUT` behind it is refused by the server without `rightsConfirmed: true`
 * anyway (src/routes.ts § parseVisibilityRequest), so the box is a statement
 * the owner makes rather than a gate the client keeps.
 */
import { useEffect, useState } from "react";
import { Check, Copy, Globe, Lock } from "lucide-react";

import {
  SHARING_CANNOT_UNRING,
  SHARING_CONFIRM_TITLE,
  SHARING_OFF,
  SHARING_ON,
  SHARING_PERSONALISED,
  SHARING_RIGHTS_CONFIRM,
  SHARING_WHAT_VISITORS_SEE,
  sharingConfirmBody,
} from "../messages.js";
import { apiFetch, readJson } from "./lib/api.js";
import { loadPublicMetadata } from "./public-api.js";
import { readHref } from "./router.js";

/** What `PUT /api/article/:slug/visibility` answers with. src/store/contracts.ts. */
interface VisibilityState {
  visibility: "private" | "public";
  publicAt: string | null;
}

export function AccessSharing({ slug, title }: { slug: string; title: string }) {
  /**
   * `true` shared, `false` not, **`null` we do not know** — see the header.
   * `undefined` is the fourth state and it is "still asking".
   */
  const [shared, setShared] = useState<boolean | null | undefined>(undefined);
  /** Only ever known from a `PUT` we made, so it is absent on a fresh page. */
  const [publicAt, setPublicAt] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [rights, setRights] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setShared(undefined);
    setPublicAt(null);
    setConfirming(false);
    setRights(false);
    loadPublicMetadata(slug)
      .then((read) => live && setShared(read.kind === "ok"))
      /* Not `false`. See the header: a failed check must not be drawn as an
         answer, because one of the two answers is about somebody's article
         being on the open web. */
      .catch(() => live && setShared(null));
    return () => {
      live = false;
    };
  }, [slug]);

  async function set(to: "private" | "public"): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/article/${encodeURIComponent(slug)}/visibility`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        /* `rightsConfirmed` on the publish only. The server refuses it on an
           unpublish, and that is a real rule rather than symmetry: nobody is
           asked to confirm anything to take a document *down*, so sending one
           would write a `true` into `article_visibility_changes` for an act
           about which nobody confirmed anything — and that column is precisely
           what a rights complaint would ask about. */
        body: JSON.stringify(to === "public" ? { visibility: to, rightsConfirmed: true } : { visibility: to }),
      });
      /* **The server's own answer, not the value we sent.** The response is the
         whole state of the subresource, and asking for a state the article is
         already in returns the current representation without changing
         anything — so reading back is the only way the card ends up agreeing
         with the database. A 200 is not evidence a field was honoured. */
      const state = await readJson<VisibilityState>(res);
      setShared(state.visibility === "public");
      setPublicAt(state.publicAt);
      setConfirming(false);
      setRights(false);
    } catch (e) {
      setError((e as Error).message);
      /* **A failed request is not proof that nothing was written** — the same
         lesson Delete on this page learned, 2026-08-27. So the switch goes back
         to "we do not know" rather than back to where it was, and the reader is
         invited to reload. Claiming the old state would be the version of this
         where somebody believes a document is private and it is not. */
      setShared(null);
    } finally {
      setBusy(false);
    }
  }

  const link = `${location.origin}${readHref(slug)}`;

  return (
    <div className="tw:font-sans tw:text-sm">
      {shared === undefined ? (
        <p className="tw:m-0 tw:text-ink-faint">Checking who can read this…</p>
      ) : shared === null ? (
        <p className="tw:m-0 tw:text-ink-faint">
          We could not check who can read this, so nothing is offered here — reload the page to try
          again. Whatever it was before is unchanged.
        </p>
      ) : (
        <>
          <p className="tw:m-0 tw:mb-1 tw:flex tw:items-center tw:gap-2 tw:text-ink">
            {shared ? <Globe size={14} /> : <Lock size={14} />}
            {shared ? SHARING_ON : SHARING_OFF}
          </p>
          <p className="tw:m-0 tw:mb-3 tw:text-ink-faint">{SHARING_WHAT_VISITORS_SEE}</p>

          {shared && (
            <>
              <CopyLink link={link} />
              {publicAt && (
                <p className="tw:m-0 tw:mb-3 tw:text-xs tw:text-ink-faint">
                  Shared since {new Date(publicAt).toLocaleString()}.
                </p>
              )}
              <p className="tw:m-0 tw:mb-3 tw:text-ink-faint">{SHARING_CANNOT_UNRING}</p>
              <button
                type="button"
                className="linky"
                disabled={busy}
                onClick={() => void set("private")}
              >
                {busy ? "Turning sharing off…" : "Stop sharing"}
              </button>
            </>
          )}

          {!shared && !confirming && (
            <button type="button" className="linky" onClick={() => setConfirming(true)}>
              Share with anyone who has the link…
            </button>
          )}

          {!shared && confirming && (
            <div className="tw:mt-2 tw:rounded-md tw:border tw:border-rule-strong tw:bg-surface-raised tw:p-3">
              <h3 className="tw:m-0 tw:mb-2 tw:text-sm tw:font-semibold tw:text-ink">
                {SHARING_CONFIRM_TITLE}
              </h3>
              <p className="tw:m-0 tw:mb-2 tw:text-ink-faint">{sharingConfirmBody(title)}</p>
              <p className="tw:m-0 tw:mb-2 tw:text-ink-faint">{SHARING_PERSONALISED}</p>
              <p className="tw:m-0 tw:mb-3 tw:text-ink-faint">{SHARING_CANNOT_UNRING}</p>
              <label className="tw:mb-3 tw:flex tw:items-start tw:gap-2 tw:text-ink">
                <input
                  type="checkbox"
                  checked={rights}
                  onChange={(e) => setRights(e.target.checked)}
                />
                <span>{SHARING_RIGHTS_CONFIRM}</span>
              </label>
              <div className="tw:flex tw:gap-3">
                <button
                  type="button"
                  className="linky"
                  /* The server refuses a publish without it too — this is the
                     reader being told why the button is not live yet, in the
                     one place where a silent refusal would be baffling. */
                  disabled={!rights || busy}
                  onClick={() => void set("public")}
                >
                  {busy ? "Sharing…" : "Share it"}
                </button>
                <button
                  type="button"
                  className="linky"
                  disabled={busy}
                  onClick={() => {
                    setConfirming(false);
                    setRights(false);
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {error && <p className="tw:m-0 tw:mt-3 tw:text-destructive">{error}</p>}
    </div>
  );
}

/**
 * The link, and a button that puts it on the clipboard.
 *
 * The tick is not decoration: `navigator.clipboard` is a promise and a copy
 * that failed looks exactly like one that worked. And the guard is a statement
 * rather than `navigator.clipboard?.writeText(…)` — where there is no clipboard
 * object at all the optional chain evaluates to `undefined` and the `.catch`
 * throws. `ChatPanel.tsx` has the long version of both.
 */
function CopyLink({ link }: { link: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="tw:mb-3 tw:flex tw:items-center tw:gap-2">
      <input
        readOnly
        value={link}
        onFocus={(e) => e.currentTarget.select()}
        className="tw:min-w-0 tw:flex-1 tw:rounded tw:border tw:border-rule tw:bg-background tw:px-2 tw:py-1 tw:font-mono tw:text-xs tw:text-ink"
        aria-label="The link to share"
      />
      <button
        type="button"
        className="linky"
        onClick={() => {
          if (!navigator.clipboard) return;
          navigator.clipboard
            .writeText(link)
            .then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            })
            .catch(() => setCopied(false));
        }}
      >
        {copied ? <Check size={13} /> : <Copy size={13} />}
        {copied ? " Copied" : " Copy"}
      </button>
    </div>
  );
}
