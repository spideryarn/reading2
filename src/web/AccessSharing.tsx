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
 * From `ArticleMetadata.sharing`, which the page it lives on has already
 * fetched. **This component makes no request of its own until the owner presses
 * something.**
 *
 * It asked the *public* endpoint anonymously until 2026-08-28 — a 200 meant a
 * stranger could read it, a 404 meant they could not — because there was no
 * owner-side field to read. That worked and it was the wrong shape: an
 * owner-facing control interrogating the anonymous surface about their own
 * document, unable to tell *private* from *no such article* since both are a
 * 404, and leaning on a second source of truth to decide whether to render at
 * all. It also could not see `publicAt`, so "shared since" survived only until
 * a reload.
 *
 * **The absence is still the important state.** `sharing` is optional and
 * absent means *this store cannot say* — the filesystem store has no column, and
 * `ArticleMetadata.sharing` says at length why it refuses rather than defaulting
 * to `private`. The card keeps the state it had for a failed probe: it says it
 * does not know, and offers no switch. A toggle that reads "not shared" because
 * the read failed is a page that looks exactly like one that works, on the one
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

import type { StepName } from "../types.js";
import {
  SHARING_CANNOT_UNRING,
  SHARING_CONFIRM_TITLE,
  SHARING_NOT_PERSONALISED,
  SHARING_OFF,
  SHARING_ON,
  SHARING_PERSONALISED,
  sharingPersonalisedList,
  SHARING_RIGHTS_CONFIRM,
  SHARING_WHAT_VISITORS_SEE,
  sharingConfirmBody,
} from "../messages.js";
import type { ArticleSharing, VisibilityState } from "../types.js";
import { apiFetch, readJson } from "./lib/api.js";
import { readHref } from "./router.js";

export function AccessSharing({
  slug,
  title,
  sharing,
}: {
  slug: string;
  title: string;
  /**
   * From the page's own metadata fetch. `undefined` covers both *not landed
   * yet* and *this store cannot say*, and the card draws the same thing for
   * both — it does not know, so it offers nothing.
   *
   * Telling those two apart would need a third value and would change no
   * pixel: neither is a state in which it is safe to draw a switch.
   */
  sharing: ArticleSharing | undefined;
}) {
  /**
   * What our own `PUT` last said, or `"unknown"` after one failed.
   *
   * `null` means the owner has not touched it and `sharing` stands. A sentinel
   * object rather than seeding state from the prop in an effect, because the
   * prop arrives late and a seeding effect would have to decide whether a later
   * `sharing` is fresher than a click — a question with no good answer. The
   * same shape `DeleteArticle` on this page uses, for the same reason.
   */
  const [acted, setActed] = useState<VisibilityState | "unknown" | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [rights, setRights] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* The switch's own answer wins over the page load, and a failed write beats
     both — see `set` below for why a failure means we stop claiming to know. */
  const state: VisibilityState | null = acted === "unknown" ? null : (acted ?? sharing ?? null);
  const shared = state === null ? null : state.visibility === "public";
  const publicAt = state?.publicAt ?? null;
  /**
   * Which artefacts were written for this reader's profile.
   *
   * Read from the **page load** rather than from `acted`, and that is not an
   * oversight: `PUT …/visibility` answers with `VisibilityState`, which has no
   * `personalised` — because turning sharing on and off does not change what
   * the model was given when it wrote a glossary last week.
   */
  const personalised = sharing?.personalised;

  /* One article's answer must not survive into another's. `Metadata` is keyed
     on the slug so this component remounts anyway; the effect is what keeps
     that true if the key ever moves. */
  // biome-ignore lint/correctness/useExhaustiveDependencies: deliberate re-run trigger — the effect reads nothing, and a new slug is exactly when one article's answer stops describing the article on screen
  useEffect(() => {
    setActed(null);
    setConfirming(false);
    setRights(false);
    setError(null);
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
      setActed(await readJson<VisibilityState>(res));
      setConfirming(false);
      setRights(false);
    } catch (e) {
      setError((e as Error).message);
      /* **A failed request is not proof that nothing was written** — the same
         lesson Delete on this page learned, 2026-08-27. So the switch goes to
         "we do not know" rather than back to where it was, and the reader is
         invited to reload. Claiming the old state would be the version of this
         where somebody believes a document is private and it is not.

         It overrides `sharing` deliberately: the prop still holds what the page
         load said, which is now exactly the stale answer that must not be
         drawn. */
      setActed("unknown");
    } finally {
      setBusy(false);
    }
  }

  const link = `${location.origin}${readHref(slug)}`;

  return (
    <div className="tw:font-sans tw:text-sm">
      {shared === null ? (
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
              <Personalisation kinds={personalised} />
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
 * **Which of this document's artefacts were written for the owner, and the
 * three answers that are genuinely different.**
 *
 * The plan's first draft warned in general, and GPT Sol's improvement on it was
 * that the dialog should *name* them — which is what turns a sentence nobody
 * reads into a specific fact about the thing being shared. Between 2026-08-28
 * morning and afternoon this was thought to be unbuildable, then built; the
 * general sentence survives as the first row rather than as the answer.
 *
 * | `kinds` | what it means | what it says |
 * |---|---|---|
 * | `undefined` | the store cannot say | *may have been written for your profile* |
 * | `[]` | it can, and none were | *nothing here was* |
 * | non-empty | these were | names them |
 *
 * **The middle row is the one worth defending.** It is a much stronger claim
 * than the first, and the only thing separating them is the difference between
 * an absent field and an empty array — which `?? []` silently erases. The
 * `sharing` block exists so that `[]` can only come from a store that answered:
 * src/types.ts § ArticleSharing.
 */
function Personalisation({ kinds }: { kinds: StepName[] | undefined }) {
  const said =
    kinds === undefined
      ? SHARING_PERSONALISED
      : kinds.length === 0
        ? SHARING_NOT_PERSONALISED
        : sharingPersonalisedList(kinds);
  return <p className="tw:m-0 tw:mb-2 tw:text-ink-faint">{said}</p>;
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
