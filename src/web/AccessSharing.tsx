/**
 * **Access & Sharing** — the owner's switch, on the page that describes the
 * article.
 *
 * The section name is the original version's own, which
 * docs/plans/260825e-metadata-page.md recorded and deliberately dropped — *"**drop** —
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
  SHARING_UNKNOWN,
  SHARING_WHAT_VISITORS_SEE,
  SHARED_HEADING,
  SHARING_INVENTORY_UNKNOWN,
  SHARED_IF_BUILT_HEADING,
  SHARED_IF_BUILT_NOTE,
  NOT_SHARED_HEADING,
  NOT_SHARED_NOTE,
  SHARING_WRITE_UNCERTAIN,
  sharingConfirmBody,
  sharingInFlight,
} from "../messages.js";
import type { ArticleSharing, PublicArtefacts, VisibilityState } from "../types.js";
import { apiFetch, readJson } from "./lib/api.js";
import {
  sharedInventory,
  type InventoryItem,
  type SharedInventory,
} from "./shared-inventory.js";
import { readHref } from "./router.js";

/**
 * What the card has learned since the page loaded — see `card` in the component
 * for what each member draws and why they cannot be folded together.
 */
type Learned =
  | { kind: "known"; state: VisibilityState }
  | { kind: "pending"; to: "private" | "public" }
  | { kind: "unknown"; because: "unread" | "write" };

type CardState = Learned;

const UNREAD: CardState = { kind: "unknown", because: "unread" };
const WRITE_UNCERTAIN: CardState = { kind: "unknown", because: "write" };

/**
 * `PUT …/visibility`'s reply, **checked rather than asserted.**
 *
 * `readJson<T>` performs no validation — `T` is whatever the caller wrote — and
 * it answers `{}` for a 204, which several routes in this app legitimately
 * return. So a success we cannot parse used to reach `visibility === "public"`
 * as `undefined`, evaluate `false`, and draw *"Only you can read this"* about a
 * database nobody had read. GPT Sol, 2026-08-28.
 *
 * `null` for anything unrecognised, and the caller turns that into *we do not
 * know* rather than into a state. A 2xx we cannot read is the absence of an
 * answer, not a quiet `private`.
 */
export function asVisibilityState(body: unknown): VisibilityState | null {
  if (body === null || typeof body !== "object") return null;
  const { visibility, publicAt } = body as Record<string, unknown>;
  if (visibility !== "private" && visibility !== "public") return null;
  /* `publicAt` is `string | null` and both are meaningful — a missing key is
     not the same as an explicit `null`, and only the explicit one is the
     server saying "private, and no timestamp". */
  if (publicAt !== null && typeof publicAt !== "string") return null;
  /* **The two fields have to agree, and a string has to be a date.** The
     contract is that `public_at` is set on publishing and cleared on
     unpublishing, so `{visibility: "public", publicAt: null}` and
     `{visibility: "private", publicAt: "…"}` are both states the server does
     not hold — and a card that drew one of them would be reporting a database
     that does not exist. `"soon"` would have been printed straight into
     *"Shared since Invalid Date"*. GPT Sol, second pass, 2026-08-28. */
  if (publicAt !== null && Number.isNaN(Date.parse(publicAt))) return null;
  if ((visibility === "public") !== (publicAt !== null)) return null;
  return { visibility, publicAt };
}

/**
 * **The same parser, for the other door.**
 *
 * `ArticleSharing` arrives through `GET /api/metadata/:slug`, which
 * `Metadata.tsx` reads with `readJson<ArticleMetadata>` — a cast, which
 * validates nothing. So `sharing: {}` was truthy, became the card's `known`
 * state, and drew *"Only you can read this"* with complete confidence about a
 * body that said nothing at all.
 *
 * That is the rule this control must never break, arriving through the one door
 * that had not been validated: the write response was checked from the day it
 * was written and the page load was not. GPT Sol, second pass, 2026-08-28.
 *
 * `undefined` rather than a throw, so the rest of the metadata page still
 * renders and the card falls back to *we could not check* — which is exactly
 * true, and is a state it already has.
 */
export function asArticleSharing(value: unknown): ArticleSharing | undefined {
  const state = asVisibilityState(value);
  if (!state) return undefined;
  const { personalised } = value as Record<string, unknown>;
  /* Every entry a string. An artefact name we do not recognise is left in
     rather than dropped — `sharingPersonalisedList` falls back to "your <name>"
     — because a silently shortened list is worse here than an odd noun: the
     whole point of the sentence is that it is complete. */
  if (!Array.isArray(personalised) || personalised.some((k) => typeof k !== "string")) {
    return undefined;
  }
  /* **Not a reason to reject the body.** The visibility is what this card is
     for, and it parsed; an inventory we cannot read is an inventory we do not
     draw. Rejecting here took the whole switch away over one field — see
     `ArticleSharing.available` in src/types.ts. */
  const available = asPublicArtefacts((value as Record<string, unknown>).available);
  return {
    ...state,
    personalised: personalised as ArticleSharing["personalised"],
    ...(available ? { available } : {}),
  };
}

/**
 * **The five presence flags, every one of them checked.**
 *
 * `undefined` for anything short of five booleans, and the caller draws no list
 * at all rather than a partial one. **A missing key is not a `false`**: that
 * default would tell an owner their glossary stays private, which is the exact
 * sentence this slice exists to stop being guessed at. Saying nothing about an
 * inventory we could not read is the only honest answer, and it is a smaller
 * one than it looks — the switch itself is unaffected, because `visibility`
 * parsed on its own.
 *
 * `ARTEFACT_KEYS` rather than five hand-written reads, and it is typed
 * `readonly (keyof PublicArtefacts)[]` with an exhaustiveness test beside it
 * (tests/shared-inventory.test.ts) so a sixth artefact cannot be validated into
 * existence by being forgotten.
 */
export const ARTEFACT_KEYS = ["arc", "tweets", "glossary", "ideas", "quotes"] as const satisfies
  readonly (keyof PublicArtefacts)[];

export function asPublicArtefacts(value: unknown): PublicArtefacts | undefined {
  if (value === null || typeof value !== "object") return undefined;
  const row = value as Record<string, unknown>;
  if (ARTEFACT_KEYS.some((k) => typeof row[k] !== "boolean")) return undefined;
  return {
    arc: row.arc as boolean,
    tweets: row.tweets as boolean,
    glossary: row.glossary as boolean,
    ideas: row.ideas as boolean,
    quotes: row.quotes as boolean,
  };
}

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
   * What this card has learned since the page loaded, or `null` for nothing.
   *
   * A sentinel rather than seeding state from the prop in an effect, because
   * the prop arrives late and a seeding effect would have to decide whether a
   * later `sharing` is fresher than a click — a question with no good answer.
   * The same shape `DeleteArticle` on this page uses, for the same reason.
   */
  const [acted, setActed] = useState<Learned | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [rights, setRights] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * **The four states this card can be in**, and they are four because three of
   * them used to be one.
   *
   * `known` is the only one that draws a switch. The other three each say
   * something different and one of them used to say something false:
   *
   * - **`pending`** — a write is out. Until 2026-08-28 there was no such state,
   *   so a slow publish went on drawing *"Only you can read this"* with a live
   *   Share button under it for as long as the request took.
   * - **`unknown: "unread"`** — nothing was asked of the server, so whatever
   *   was true before still is, and the copy may say so.
   * - **`unknown: "write"`** — a write failed, and **it may have taken effect**.
   *   The route writes and then reads back to build its reply, so every failure
   *   after the write leaves the write standing. Saying "unchanged" here told
   *   an owner their public article was private. GPT Sol, 2026-08-28.
   */
  const card: CardState = acted ?? (sharing ? { kind: "known", state: sharing } : UNREAD);
  const shared = card.kind === "known" ? card.state.visibility === "public" : null;
  const publicAt = card.kind === "known" ? card.state.publicAt : null;
  /**
   * Which artefacts were written for this reader's profile.
   *
   * Read from the **page load** rather than from `acted`, and that is not an
   * oversight: `PUT …/visibility` answers with `VisibilityState`, which has no
   * `personalised` — because turning sharing on and off does not change what
   * the model was given when it wrote a glossary last week.
   */
  const personalised = sharing?.personalised;
  /**
   * The inventory, from the page load for the same reason `personalised` is:
   * `PUT …/visibility` answers with a `VisibilityState`, which carries neither
   * — because publishing an article does not change what has been built for it.
   *
   * `undefined` on a store that cannot say, and the list is simply not drawn.
   * Guessing here would be guessing about what a stranger is about to receive.
   */
  const inventory = sharing?.available ? sharedInventory(sharing.available) : undefined;

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
    /* The pending state replaces the buttons rather than disabling them, so a
       second press is not merely refused — there is nothing there to press.
       Sol asked for a double-click test; this is the shape that makes one
       pass. */
    setActed({ kind: "pending", to });
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
      /* **Validated, not cast.** `readJson` is typed by its caller and checks
         nothing, and it answers `{}` for a 204 — so a malformed success used to
         reach `visibility === "public"` as `undefined`, come out `false`, and
         draw *"Only you can read this"* over a database nobody had read. A 2xx
         we cannot parse is not an answer; it is the absence of one. */
      const state = asVisibilityState(await readJson<unknown>(res));
      setActed(state ? { kind: "known", state } : WRITE_UNCERTAIN);
      setConfirming(false);
      setRights(false);
    } catch (e) {
      setError((e as Error).message);
      /* **A failed request is not proof that nothing was written** — the same
         lesson Delete on this page learned, 2026-08-27. `"write"` rather than
         `"unread"`, and that distinction is the whole of the fix: one of them
         may honestly promise nothing changed and the other may not.

         It overrides `sharing` deliberately: the prop still holds what the page
         load said, which is now exactly the stale answer that must not be
         drawn. */
      setActed(WRITE_UNCERTAIN);
    }
  }

  const link = `${location.origin}${readHref(slug)}`;

  return (
    <div className="tw:font-sans tw:text-sm">
      {card.kind === "pending" ? (
        /* No switch while one is out. The buttons are gone rather than
           disabled, so a second press has nothing to land on. */
        <p className="tw:m-0 tw:text-ink-faint">{sharingInFlight(card.to)}</p>
      ) : card.kind === "unknown" ? (
        <p className="tw:m-0 tw:text-ink-faint">
          {card.because === "write" ? SHARING_WRITE_UNCERTAIN : SHARING_UNKNOWN}
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
              <Inventory inventory={inventory} />
              <p className="tw:m-0 tw:mb-3 tw:text-ink-faint">{SHARING_CANNOT_UNRING}</p>
              <button
                type="button"
                className="linky"
                onClick={() => void set("private")}
              >
                Stop sharing
              </button>
            </>
          )}

          {/* **No offer to publish while we cannot say what publishing would
              carry**, and `inventory` is the whole test. Unsharing above is
              untouched: taking an article back is never the direction worth
              blocking, and a card that could not do it would strand an owner
              over a field that has nothing to do with visibility.
              src/messages.ts § SHARING_INVENTORY_UNKNOWN. */}
          {!shared && !inventory && (
            <p className="tw:m-0 tw:text-ink-faint">{SHARING_INVENTORY_UNKNOWN}</p>
          )}

          {!shared && inventory && !confirming && (
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
              <Inventory inventory={inventory} />
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
                     one place where a silent refusal would be baffling.

                     No `busy` beside it any more: a write in flight puts the
                     card into `pending`, which draws no buttons at all, so
                     there is nothing here to press twice. */
                  disabled={!rights}
                  onClick={() => void set("public")}
                >
                  Share it
                </button>
                <button
                  type="button"
                  className="linky"
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
/**
 * **The three lists** — what goes out, what would go out if it existed, and what
 * never does.
 *
 * Drawn in both places the card can be: under the confirmation, where it is
 * what the owner is agreeing to, and on the already-shared card, where it is
 * what is out there now. One component, because two would be two lists to keep
 * in step and this one is already derived.
 *
 * `undefined` draws nothing at all. It means the store could not say what this
 * article has (`ArticleSharing` is absent, or the body did not parse), and a
 * list assembled from a guess is the one thing worse here than no list: it is
 * a specific, checkable, wrong claim about what a stranger is about to read.
 *
 * The sentence is on `title` rather than beside the label because two dozen of
 * them stacked would bury the thing the owner came here to read — Greg asked for
 * *"tooltips if needed"* and this is where it is needed.
 *
 * **A known gap, stated rather than glossed.** It is also the `aria-label`, so a
 * screen reader gets it — but a sighted keyboard or touch user gets neither, and
 * an earlier draft of this comment claimed otherwise. `title` has no focus or
 * tap disclosure in any browser. The honest fix is a real disclosure component,
 * which this app does not have; until then the chips are a *skimmable index* and
 * the three headings and their notes carry every claim an owner has to be able
 * to read. GPT Sol's review, 2026-09-02, and it is in the plan as an open item.
 */
function Inventory({ inventory }: { inventory: SharedInventory | undefined }) {
  if (!inventory) return null;
  const { shared, ifBuilt, withheld } = inventory;
  return (
    <div className="tw:mb-3 tw:flex tw:flex-col tw:gap-2">
      <InventoryList heading={SHARED_HEADING} items={shared} tone="out" />
      {ifBuilt.length > 0 && (
        <InventoryList heading={SHARED_IF_BUILT_HEADING} note={SHARED_IF_BUILT_NOTE} items={ifBuilt} tone="out" />
      )}
      <InventoryList heading={NOT_SHARED_HEADING} note={NOT_SHARED_NOTE} items={withheld} tone="kept" />
    </div>
  );
}

function InventoryList({
  heading,
  note,
  items,
  tone,
}: {
  heading: string;
  note?: string;
  items: InventoryItem[];
  /** `out` is what a stranger receives; `kept` is what does not leave. */
  tone: "out" | "kept";
}) {
  return (
    <div>
      <p className="tw:m-0 tw:flex tw:items-center tw:gap-1.5 tw:text-xs tw:font-semibold tw:text-ink">
        {tone === "out" ? <Globe size={12} /> : <Lock size={12} />}
        {heading}
      </p>
      {note && <p className="tw:m-0 tw:mt-0.5 tw:text-xs tw:text-ink-faint">{note}</p>}
      <ul className="tw:m-0 tw:mt-1 tw:flex tw:list-none tw:flex-wrap tw:gap-x-1.5 tw:gap-y-1 tw:p-0">
        {items.map((item) => (
          <li
            key={item.key}
            title={item.detail}
            aria-label={`${item.label} — ${item.detail}`}
            className={`tw:rounded tw:border tw:px-1.5 tw:py-0.5 tw:text-xs ${
              tone === "out"
                ? "tw:border-rule tw:text-ink"
                /* Muted, and **not struck through**, which the first draft was.
                   Twelve struck-out chips read as twelve things that have gone
                   wrong; the heading and the padlock beside it already say what
                   this column is, and saying it a third time in the type is
                   what turns a list into a warning. */
                : "tw:border-rule tw:text-ink-faint"
            }`}
          >
            {item.label}
          </li>
        ))}
      </ul>
    </div>
  );
}

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
