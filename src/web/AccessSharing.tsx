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
import { useEffect, useRef, useState } from "react";
import { Check, Copy, Globe, Link2Off, Lock } from "lucide-react";

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
  SHARED_HEADING,
  SHARED_NOTE,
  SHARING_INVENTORY_UNKNOWN,
  SHARED_IF_BUILT_HEADING,
  SHARED_IF_BUILT_NOTE,
  NOT_SHARED_HEADING,
  SHARING_WRITE_UNCERTAIN,
  SHARING_COPY_TIP,
  SHARING_OPEN_TIP,
  SHARING_STOP_TIP,
  UNSHARING_COSTS_ALLOWANCE,
  sharingConfirmBody,
  sharingInFlight,
} from "../messages.js";
import type {
  ArticleSharing,
  PublicArtefacts,
  Visibility,
  VisibilityState,
} from "../types.js";
import { Button } from "./components/ui/button.js";
import { apiFetch, readJson } from "./lib/api.js";
import {
  sharedInventory,
  type InventoryItem,
  type SharedInventory,
} from "./shared-inventory.js";
import { exactly } from "./relative-time.js";
import { readHref } from "./router.js";
import { TipNote, Tooltip, TooltipGroup } from "./Tooltip.js";

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
export const ARTEFACT_KEYS = ["arc", "tweets", "glossary", "ideas", "quotes", "timeline", "sketch"] as const satisfies
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
    timeline: row.timeline as boolean,
    sketch: row.sketch as boolean,
  };
}

export function AccessSharing({
  slug,
  title,
  sharing,
  onVisibility,
}: {
  slug: string;
  title: string;
  /**
   * **The switch was thrown — tell whoever else is drawing this fact.**
   *
   * The reading view's masthead draws the same fact from the same article
   * payload (`Article.visibility`, src/web/Masthead.tsx § `SharingMark`), and
   * that payload is fetched once for all three of an article's views and is
   * **not** refetched when the view changes (`ArticlePage` in App.tsx says why:
   * stepping out to this page and back should be free rather than 150KB and a
   * spinner). So without this, publishing an article here and pressing Back
   * left a lock sitting over a document anyone with the link could read — the
   * one sentence this control must never get wrong, arriving by the back door
   * of a payload nobody thought of as stale.
   *
   * Reported upwards rather than written into a store, exactly as the rename
   * beside it is: `OwnedArticle` owns the payload and layers this over it.
   *
   * **`null` means *we no longer know*, and it is not a nicety.** A write that
   * failed after the server committed leaves this card in `WRITE_UNCERTAIN` —
   * see `set` below — and the honest thing for every other view of the fact is
   * to stop claiming one. The masthead draws nothing for an absent
   * `visibility`, which is exactly that sentence.
   *
   * Optional so the card can still be mounted on its own — tests/access-sharing.test.tsx
   * does — without every caller inventing a no-op.
   */
  onVisibility?: ((slug: string, visibility: Visibility | null) => void) | undefined;
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

  /**
   * **Is this card still on screen** — the guard on every report upwards.
   *
   * A `PUT` outlives the card that sent it: the owner can press Share and leave
   * for the article before the answer lands, and this component then resolves
   * its promise from inside a tree React has already thrown away. Its own
   * `setActed` is harmless there (React drops it), but `onVisibility` is not —
   * it writes into the *parent*, which is still mounted, and the parent has no
   * way to tell a live answer from a dead one.
   *
   * That is the out-of-order case, and it is not hypothetical: publish, leave,
   * come back to this page, unpublish, and if the first request was slow enough
   * its `public` lands **after** the second's `private` and the masthead ends
   * up wearing a globe over a private article. Last writer wins is exactly the
   * wrong rule when the writers are two requests about one document.
   *
   * So a dead card says nothing at all, and it does not need to: it has already
   * reported `null` at the moment it started writing (see `report` below), so
   * whatever is drawing this fact elsewhere is already saying *we cannot say*
   * rather than something stale. Silence is a state this design has; a wrong
   * answer is not. GPT Sol, finding 2, 2026-09-04.
   *
   * Set in the effect body rather than only cleared in its cleanup, because
   * `<StrictMode>` mounts, unmounts and remounts every component in
   * development — a ref only ever set to `false` would leave every card in the
   * app silently dead. docs/reusable/silent-success.md.
   */
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

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

  /**
   * **Tell the rest of the page, or say nothing** — every report goes through
   * here, and there is no second spelling of the guard.
   *
   * `null` is *we no longer know*, which every other view of this fact draws as
   * no claim at all rather than as a stale one.
   */
  function report(visibility: Visibility | null): void {
    if (live.current) onVisibility?.(slug, visibility);
  }

  /**
   * **What the page already knew, handed upwards once.**
   *
   * The reading view's payload carries `Article.visibility` from the moment it
   * was fetched and is never refetched between an article's views — so after a
   * write this card could not confirm, the masthead goes on drawing nothing
   * even though *this* page has since asked the server again and been told.
   * `GET /api/metadata/:slug` is a validated read, and it is better information
   * than a payload from ten minutes ago. GPT Sol, finding 3, 2026-09-04.
   *
   * **Only while this card has done nothing**, which is what keeps it in order:
   * `acted` goes to `pending` synchronously at the first press, so a slow
   * metadata read that lands mid-write cannot report the state from before it
   * over the top of the write's own answer.
   *
   * The parent ignores a report that changes nothing, so the common case — open
   * the page, read the same value the payload already had, go back — costs no
   * re-render. src/web/article/ArticlePage.tsx § `OwnedArticle`.
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies: `report` is a fresh closure every render over a ref and a prop that do not change; listing it would re-run this on every render, and what it must fire on is what the server said and whether this card has acted
  useEffect(() => {
    if (acted !== null || !sharing) return;
    report(sharing.visibility);
  }, [sharing, acted]);

  async function set(to: "private" | "public"): Promise<void> {
    /* The pending state replaces the buttons rather than disabling them, so a
       second press is not merely refused — there is nothing there to press.
       Sol asked for a double-click test; this is the shape that makes one
       pass. */
    setActed({ kind: "pending", to });
    /* **Before the request, not only after it.** Until the answer arrives
       nobody knows what is true — the server may have committed already — and
       a masthead still drawing the state from before the press is a lock over
       a document that may by now be public. The press is the moment the old
       answer stops being trustworthy, not the moment the new one lands. GPT
       Sol, finding 1, 2026-09-04. */
    report(null);
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
      /* **The server's answer, not `to`** — the same rule the line above
         follows, and for the same reason: a 200 is not evidence a field was
         honoured, and an unparseable one is the absence of an answer rather
         than the value we asked for. `null` in that case, which every other
         view of this fact renders as *we cannot say*. */
      report(state ? state.visibility : null);
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
      /* And the same sentence to everybody else drawing this fact. A failed
         request is not proof nothing was written, so the masthead must stop
         claiming either state rather than keep the one from before the write. */
      report(null);
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
          {/* **The state, and then when it started being the state.** The
              timestamp moved up here on 2026-09-04, from under the copy row: it
              is the second half of the sentence above it, and it was separated
              from it by the one control that has nothing to do with when.

              `exactly` rather than `toLocaleString`, which drew *"9/1/2026,
              10:30:00 AM"* — a seconds field nobody needs and a month/day order
              half the world reads backwards. relative-time.ts already owns this
              spelling and four other places use it. */}
          <div className="tw:mb-3 tw:flex tw:flex-wrap tw:items-center tw:gap-x-2 tw:gap-y-0.5">
            {/* `items-start` with the glyph nudged onto the first line's
                centre, rather than `items-center`: at a phone's width this
                sentence wraps to two lines, and a centred padlock then floats
                in the gutter beside the *middle* of them. `shrink-0` because a
                flex child with an intrinsic size is otherwise fair game. */}
            <p className="tw:m-0 tw:flex tw:items-start tw:gap-2 tw:text-ink">
              <span className="tw:mt-[3px] tw:shrink-0">
                {shared ? <Globe size={14} /> : <Lock size={14} />}
              </span>
              {shared ? SHARING_ON : SHARING_OFF}
            </p>
            {shared && publicAt && (
              <p className="tw:m-0 tw:text-xs tw:text-ink-faint">Shared since {exactly(publicAt)}.</p>
            )}
          </div>

          {/* **No prose sentence about what a shared link carries, in either
              state, since 2026-09-03.** It used to be drawn here, above this
              branch, so a *private* article's card stated in the present
              indicative what a stranger sees — directly under "Only you can
              read this", on the card whose whole job is to say which state the
              article is in.

              And it is not merely moved into the `shared` branch, which was the
              first fix: there it sat immediately above `Inventory`, which says
              the same thing itemised — and had a hand-written summary of its
              own until 2026-09-04, which is exactly the sentence that went
              stale (src/messages.ts, at `NOT_SHARED_HEADING`).
              The list is the better answer — it is derived from the modes rather
              than written, so it cannot fall behind — and one fact belongs on
              this card once. The sentence survives for the visitor, who has no
              list: src/messages.ts § SHARED_LINK_CARRIES.

              What a private article's owner is told about publishing is the
              confirmation box's question, and the box answers it with the same
              `Inventory`. */}
          {shared && (
            <>
              <CopyLink link={link} />
              <Inventory inventory={inventory} />
              <p className="tw:m-0 tw:mb-3 tw:text-ink-faint">{SHARING_CANNOT_UNRING}</p>
              {/* **The allowance, and only on this side of the card.** A public
                  article counts as half, so taking it down puts the other half
                  back — a consequence worth saying before the press rather than
                  discovering on the next add. It is a sentence and not a gate:
                  no tick-box, no second confirmation, no red. And it is
                  deliberately absent from the confirmation box below, where the
                  rights tick-box lives — src/messages.ts §
                  `UNSHARING_COSTS_ALLOWANCE` has the three rules. */}
              <p className="tw:m-0 tw:mb-3 tw:text-ink-faint">{UNSHARING_COSTS_ALLOWANCE}</p>
              <Tooltip placement="bottom" content={<TipNote>{SHARING_STOP_TIP}</TipNote>}>
                {/* `outline` and **not** `destructive`, which is the tint the
                    eye reaches for on a button that takes something away. It
                    would be the wrong sentence: this is the safe direction, and
                    every direction on this page that is not is the *other* one
                    — publishing, which cannot be un-rung.

                    This used to say the red belonged to Delete, "the one
                    control here that loses work". It never did: that button
                    archives, it lost nothing, and on 2026-09-04 it became
                    Archive and gave the red back. There is no destructive tint
                    on this page now. */}
                <Button type="button" variant="outline" size="sm" onClick={() => void set("private")}>
                  <Link2Off size={14} />
                  Stop sharing
                </Button>
              </Tooltip>
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

          {/* **A button that looks like one, and says what it does before it
              does it.** Greg, 2026-09-04: *"the Share button should visibly be
              a button with rich tooltip"*.

              It read as a line of plain text until then, and the reason is
              worth knowing because four other buttons in this app still have
              it: `className="linky"` styles **nothing here**. That class is
              scoped — `.cmt-dialog button.linky`, `.chat-dialog button.linky`,
              `.annotate-dialog button.linky`, and styles.css says so in as many
              words (*"a shape, not a shared class"*). This card is in none of
              those three, so the class matched no rule at all and the button
              fell back to the reset: no border, no padding, no affordance. A
              class that silently does nothing looks exactly like one that
              works — docs/reusable/silent-success.md.

              `outline`, not the orange `default`: this button does not share
              anything, it opens the question. The primary is on `Share it`
              inside the confirmation, which is the press that does. */}
          {!shared && inventory && !confirming && (
            <Tooltip placement="bottom" content={<TipNote>{SHARING_OPEN_TIP}</TipNote>}>
              {/* **Allowed to wrap, which `Button` on its own is not.** The
                  shared component ships `whitespace-nowrap` and a fixed height,
                  and this is the one button in the app with a sentence for a
                  label: at a 320px viewport it comes out around 279px inside a
                  card with about 238px of room, so it would push the page
                  sideways. The old unstyled control wrapped, so this would have
                  been a regression rather than an old bug. Measured by GPT Sol,
                  2026-09-04; 390px, which is where I checked first, has the
                  room and hides it.

                  **The label lost *"who has the link"* on 2026-09-04**, with
                  the rest of the link-only copy — a public article is listed
                  now, so the link is one way in rather than the way in
                  (src/messages.ts § SHARING_ON). The wrap guard stays: it was
                  measured against the longer label and costs nothing, and the
                  next word added here would need it again. */}
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="tw:h-auto tw:min-h-8 tw:whitespace-normal tw:py-1.5 tw:text-left"
                onClick={() => setConfirming(true)}
              >
                <Globe size={14} />
                Share with anyone…
              </Button>
            </Tooltip>
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
              <div className="tw:flex tw:items-center tw:gap-2">
                {/* **The primary, and the only one on this card.** It is the
                    press that publishes, so it is the press that gets the
                    orange; everything else here is `outline` or `ghost`. The
                    disabled state is `Button`'s own `opacity-50`, which reads
                    as not-yet rather than as broken. */}
                <Button
                  type="button"
                  size="sm"
                  /* The server refuses a publish without it too — this is the
                     reader being told why the button is not live yet, in the
                     one place where a silent refusal would be baffling.

                     No `busy` beside it any more: a write in flight puts the
                     card into `pending`, which draws no buttons at all, so
                     there is nothing here to press twice. */
                  disabled={!rights}
                  onClick={() => void set("public")}
                >
                  <Globe size={14} />
                  Share it
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setConfirming(false);
                    setRights(false);
                  }}
                >
                  Cancel
                </Button>
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
 * The sentence is on a tooltip rather than beside the label because two dozen of
 * them stacked would bury the thing the owner came here to read — Greg asked for
 * *"tooltips if needed"* and this is where it is needed.
 *
 * **Where each reader gets that sentence, as of 2026-09-04**, because it is
 * three different mechanisms and the old one served only two thirds of one:
 *
 * | reader | how |
 * |---|---|
 * | pointer | the `Tooltip`, on hover |
 * | touch | the same, on the hover a tap synthesises — measured in Chrome, not assumed |
 * | screen reader | an `sr-only` span in the chip, permanently in the tree |
 * | sighted keyboard, no screen reader | **still nothing — see below** |
 *
 * It was a `title` attribute, which is the *worst* of these: a screen reader
 * read it (it was the `aria-label` too), and nobody else without a mouse got
 * anything, because `title` has no focus or tap disclosure in any browser. The
 * comment here used to say the honest fix was a real disclosure component
 * *"which this app does not have"* — which was simply wrong when it was
 * written: `Tooltip.tsx` is one, six other panels use it, and `Metadata.tsx`'s
 * own six `Stat` cards use it four sections up this same page.
 *
 * **The last row is a real gap, left open on purpose.** Two drafts tried to
 * close it by putting the chips in the tab order — `tabIndex={0}`, then a
 * `<button>` — and both were worse than the gap: twenty-three inert controls
 * standing between a keyboard user and the rights checkbox they came to tick.
 * The shape that would close it honestly is one *"what are these?"* disclosure
 * per list, expanding the chips into label-and-sentence rows: three tab stops
 * instead of twenty-three, and every one of them does something. That is a new
 * interaction rather than a polish, so it is Greg's to decide.
 *
 * One `TooltipGroup` per card, so sweeping the row is instant after the first —
 * the same reasoning as `Metadata.tsx`'s "At a glance", and the same delays.
 */
function Inventory({ inventory }: { inventory: SharedInventory | undefined }) {
  if (!inventory) return null;
  const { shared, ifBuilt, withheld } = inventory;
  return (
    <TooltipGroup delay={{ open: 300, close: 120 }} timeoutMs={400}>
      {/* `gap-3.5`, not `gap-2`: three headings each followed by a wrapping row
          of chips, and at two the last chip of one list sat closer to the next
          list's heading than that heading sat to its own chips — so the eye
          grouped them wrongly, on the one list where which column a thing is in
          is the entire point. */}
      <div className="tw:mb-3 tw:flex tw:flex-col tw:gap-3.5">
        <InventoryList heading={SHARED_HEADING} note={SHARED_NOTE} items={shared} tone="out" />
        {ifBuilt.length > 0 && (
          <InventoryList heading={SHARED_IF_BUILT_HEADING} note={SHARED_IF_BUILT_NOTE} items={ifBuilt} tone="out" />
        )}
        {/* **No note under this one since 2026-09-04**, like the first column
            and for the same reason. The sentence that was here summarised the
            whole card by hand and went stale the day comments began crossing —
            src/messages.ts, where `NOT_SHARED_HEADING` is declared, has the
            argument. */}
        <InventoryList heading={NOT_SHARED_HEADING} items={withheld} tone="kept" />
      </div>
    </TooltipGroup>
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
        {/* **The chip is not a control, and two drafts got that wrong in
            opposite directions.** First `<li tabIndex={0}>`, which biome
            refuses (`a11y/noNoninteractiveTabindex`); then a `<button>`, which
            biome accepts and GPT Sol rejected for a better reason — a button
            promises that Enter and Space *do* something, and this one did
            nothing. Twenty-three of those, in the confirmation, sitting in the
            tab order in front of the rights checkbox: a keyboard user would
            have had to pass every one of them to reach the irreversible press.

            So the chip is a plain list item again, and what it gained is the
            `sr-only` span below.

            `keepSide`, for the reason `Tooltip` spells out: these are rows of
            triggers, and a card thrown onto the cross axis lands on top of the
            chips the reader is about to hover. `cursor-help` rather than the
            dotted underline the `Stat` cards use, which would be too much at
            this size on two dozen at once. */}
        {items.map((item) => (
          <Tooltip key={item.key} placement="top" keepSide content={<TipNote>{item.detail}</TipNote>}>
            <li
              className={`tw:cursor-help tw:rounded tw:border tw:px-1.5 tw:py-0.5 tw:text-xs tw:transition-colors tw:hover:border-highlight/50 ${
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
              {/* **The sentence, permanently in the accessibility tree** — the
                  half of this that a `title` did badly and a tooltip alone does
                  not do at all. `useRole` gives the panel an `aria-describedby`
                  only while it is *open*, and a screen-reader user moving by
                  virtual cursor never opens it, so the detail could simply
                  never be announced. `InventoryItem.detail`'s contract says the
                  sentence reaches a screen reader (shared-inventory.ts), and
                  this is the line that keeps it true. GPT Sol, 2026-09-04. */}
              <span className="tw:sr-only"> — {item.detail}</span>
            </li>
          </Tooltip>
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
      <Tooltip placement="bottom" content={<TipNote>{SHARING_COPY_TIP}</TipNote>}>
        <Button
          type="button"
          variant="outline"
          size="sm"
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
          {copied ? "Copied" : "Copy"}
        </Button>
      </Tooltip>
    </div>
  );
}
