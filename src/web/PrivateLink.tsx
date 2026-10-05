/**
 * **The private link** — the owner's other control on the Access & Sharing
 * card, above the public switch.
 * docs/plans/261005e-share-an-article-with-some-people-a-private-link-first.md.
 *
 * A private link is `/read/<slug>?key=<key>`. Anyone who has it can read the
 * article as a visitor reads a public one; it is listed nowhere; the owner can
 * turn it off, and making one again makes a new key.
 *
 * ## It asks the server every time it opens
 *
 * Unlike the public switch below it, which reads `ArticleMetadata.sharing` off
 * the page's own fetch. The link's state is a secret and is on no payload but
 * its own route's (`GET /api/article/:slug/share-link`, `no-store`), and that
 * route is the one path `apiFetch` never keeps a copy of (lib/api.ts §
 * `NEVER_KEPT`). So what is drawn is what the server said a moment ago, and
 * with no connection the card says it could not check.
 *
 * ## The states, and why a failure is two of them
 *
 * The public switch's own (AccessSharing.tsx § `card`), for its reasons:
 * `known` is the only one that draws a link or a button; `pending` draws
 * neither, so a second press has nothing to land on; and *we could not read
 * it* and *a write did not come back* are different sentences, because only
 * the first may promise nothing changed.
 *
 * **A refusal is neither.** The server answering 4xx has said no and changed
 * nothing (the body is checked before the store, and a paper not read through
 * yet is refused inside the transaction), so the card shows the server's
 * sentence and stays where it was.
 *
 * ## The same confirmation as going public
 *
 * A private link republishes the article's text to the people it is sent to,
 * so making one shows the same derived inventory of what goes out and what
 * stays (`Inventory`), the same note about the reader profile, and the same
 * rights tick-box, with the sentences about listing swapped for ones about a
 * link. The server refuses a create without `rightsConfirmed: true`.
 *
 * ## The key
 *
 * It is drawn in the link box and nowhere else, held in this component's state
 * and nowhere else, and never logged.
 */
import { useEffect, useRef, useState } from "react";
import { Link2, Link2Off } from "lucide-react";

import {
  PRIVATE_LINK_ALSO_PUBLIC,
  PRIVATE_LINK_CANNOT_UNRING,
  PRIVATE_LINK_CONFIRM_TITLE,
  PRIVATE_LINK_COPY_TIP,
  PRIVATE_LINK_HEADING,
  PRIVATE_LINK_OPEN_TIP,
  PRIVATE_LINK_STOP_TIP,
  PRIVATE_LINK_UNKNOWN,
  PRIVATE_LINK_WHAT,
  PRIVATE_LINK_WRITE_UNCERTAIN,
  SHARING_INVENTORY_UNKNOWN,
  SHARING_RIGHTS_CONFIRM,
  privateLinkConfirmBody,
  privateLinkInFlight,
} from "../messages.js";
import { SHARE_KEY_PARAM, parseShareKey } from "../share-key.js";
import type { ArticleSharing, ShareLinkState } from "../types.js";
import { CopyLink, Inventory, Personalisation } from "./AccessSharing.js";
import { Button } from "./components/ui/button.js";
import { apiFetch, readJson, statusOf } from "./lib/api.js";
import { exactly } from "./relative-time.js";
import { readHref } from "./router.js";
import { sharedInventory } from "./shared-inventory.js";
import { TipNote, Tooltip } from "./Tooltip.js";

type LinkCard =
  /** The read is out. Nothing is drawn but the heading. */
  | { kind: "reading" }
  | { kind: "known"; state: ShareLinkState }
  | { kind: "pending"; to: "on" | "off" }
  | { kind: "unknown"; because: "unread" | "write" };

/**
 * The route's reply, **checked rather than asserted**, for
 * `asVisibilityState`'s reason: `readJson<T>` validates nothing and answers
 * `{}` for a 204, and a card that drew `on: undefined` as *off* would tell an
 * owner nobody can get in while a link is live.
 *
 * `null` for anything else, which the caller draws as *we do not know*. The
 * key must be a key (`parseShareKey`) and the date a date, so the card never
 * builds a link that cannot work or prints *On since Invalid Date*.
 */
export function asShareLinkState(body: unknown): ShareLinkState | null {
  if (body === null || typeof body !== "object") return null;
  const { on, key, since } = body as Record<string, unknown>;
  if (on === false) return { on: false };
  if (on !== true) return null;
  const parsed = parseShareKey(key);
  if (parsed === null) return null;
  if (typeof since !== "string" || Number.isNaN(Date.parse(since))) return null;
  return { on: true, key: parsed, since };
}

export function PrivateLink({
  slug,
  title,
  sharing,
  isPublic,
  onLink,
}: {
  slug: string;
  title: string;
  /**
   * The page's own fetch, for the two things the confirmation draws from it:
   * what a link would carry, and which artefacts were written for the owner's
   * profile. `undefined` when the page could not say, and then no link is
   * offered, as no publish is. Turning one off needs neither.
   */
  sharing: ArticleSharing | undefined;
  /**
   * Whether the article is public **now**, as far as the card knows: `null`
   * when it does not (a write is out, or failed). Only `true` draws the
   * sentence saying the link is not what keeps the article readable.
   */
  isPublic: boolean | null;
  /**
   * **Whether a link is on, told to the rest of the card**: `true`, `false`,
   * or `null` for *not known* (reading, a write out, a failure). The public
   * switch below draws *"Only you can read this"* for a private article, and
   * that is false while a link is on (AccessSharing.tsx § `privateLinkOn`).
   * Only ever the fact, never the key.
   */
  onLink?: ((on: boolean | null) => void) | undefined;
}) {
  const [card, setCard] = useState<LinkCard>({ kind: "reading" });
  const [confirming, setConfirming] = useState(false);
  const [rights, setRights] = useState(false);
  /** A refusal's sentence, or a read's. Shown under the control. */
  const [said, setSaid] = useState<string | null>(null);

  /* Which read or write may still set state: a late answer about one article
     must not be drawn on another, or on a card that has moved on. */
  const turn = useRef(0);

  const path = `/api/article/${encodeURIComponent(slug)}/share-link`;

  // biome-ignore lint/correctness/useExhaustiveDependencies: `path` is derived from `slug`, and a new slug is the one reason to read again.
  useEffect(() => {
    const mine = ++turn.current;
    setCard({ kind: "reading" });
    setConfirming(false);
    setRights(false);
    setSaid(null);
    void apiFetch(path)
      .then((res) => readJson<unknown>(res))
      .then((body) => {
        if (turn.current !== mine) return;
        const state = asShareLinkState(body);
        setCard(state ? { kind: "known", state } : { kind: "unknown", because: "unread" });
      })
      .catch(() => {
        if (turn.current !== mine) return;
        setCard({ kind: "unknown", because: "unread" });
      });
    return () => {
      /* Unmounted, or the slug moved: whatever is still out is nobody's. */
      turn.current += 1;
    };
  }, [slug]);

  async function change(to: "on" | "off"): Promise<void> {
    const before = card;
    const mine = ++turn.current;
    /* The buttons and the link go while a write is out, so there is nothing
       to press twice and nothing drawn that may no longer be true. */
    setCard({ kind: "pending", to });
    setSaid(null);
    try {
      const res = await apiFetch(
        path,
        to === "on"
          ? {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              /* Exactly this. The server refuses any other body. */
              body: JSON.stringify({ rightsConfirmed: true }),
            }
          : /* Nobody confirms anything to turn a link off, so nothing is sent. */
            { method: "DELETE" },
      );
      const state = asShareLinkState(await readJson<unknown>(res));
      if (turn.current !== mine) return;
      /* The server's answer, not what was asked for: a 200 that cannot be read
         is the absence of an answer. */
      setCard(state ? { kind: "known", state } : { kind: "unknown", because: "write" });
      setConfirming(false);
      setRights(false);
    } catch (e) {
      if (turn.current !== mine) return;
      const status = statusOf(e);
      if (status !== null && status >= 400 && status < 500) {
        /* A refusal: the server said no and wrote nothing. Its sentence, and
           the card as it was. */
        setSaid((e as Error).message);
        setCard(before);
        setConfirming(false);
        setRights(false);
        return;
      }
      /* Anything else may have taken effect, so no state is claimed and no
         link is drawn. */
      setCard({ kind: "unknown", because: "write" });
    }
  }

  /* What this control knows, upwards, each time it changes. A dead control
     says nothing: the effect does not run after unmount. */
  const linkOn = card.kind === "known" ? card.state.on : null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: `onLink` is the parent's closure; what this must fire on is the fact changing, and which write it followed.
  useEffect(() => {
    onLink?.(linkOn);
  }, [linkOn, card]);

  const inventory = sharing?.available ? sharedInventory(sharing.available) : undefined;
  const on = card.kind === "known" && card.state.on ? card.state : null;
  const off = card.kind === "known" && !card.state.on;

  return (
    <div className="tw:font-sans tw:text-sm">
      <h3 className="tw:m-0 tw:mb-2 tw:flex tw:items-center tw:gap-2 tw:text-sm tw:font-semibold tw:text-ink">
        <Link2 size={14} />
        {PRIVATE_LINK_HEADING}
      </h3>

      {card.kind === "pending" && (
        <p className="tw:m-0 tw:text-ink-faint">{privateLinkInFlight(card.to)}</p>
      )}
      {card.kind === "unknown" && (
        <p className="tw:m-0 tw:text-ink-faint">
          {card.because === "write" ? PRIVATE_LINK_WRITE_UNCERTAIN : PRIVATE_LINK_UNKNOWN}
        </p>
      )}

      {on && (
        <>
          <CopyLink
            link={`${location.origin}${readHref(slug, `${SHARE_KEY_PARAM}=${on.key}`)}`}
            label="The private link"
            tip={PRIVATE_LINK_COPY_TIP}
          />
          <p className="tw:m-0 tw:mb-3 tw:text-ink-faint">
            On since {exactly(on.since)}. {PRIVATE_LINK_WHAT}
          </p>
          {isPublic === true && (
            <p className="tw:m-0 tw:mb-3 tw:text-ink">{PRIVATE_LINK_ALSO_PUBLIC}</p>
          )}
          <Tooltip placement="bottom" content={<TipNote>{PRIVATE_LINK_STOP_TIP}</TipNote>}>
            {/* `outline`, not `destructive`: this is the safe direction, as
                *Stop sharing* is below. */}
            <Button type="button" variant="outline" size="sm" onClick={() => void change("off")}>
              <Link2Off size={14} />
              Turn off
            </Button>
          </Tooltip>
        </>
      )}

      {off && !confirming && (
        <>
          <p className="tw:m-0 tw:mb-3 tw:text-ink-faint">{PRIVATE_LINK_WHAT}</p>
          {inventory ? (
            <Tooltip placement="bottom" content={<TipNote>{PRIVATE_LINK_OPEN_TIP}</TipNote>}>
              {/* `outline`: this opens the question. The primary is on
                  *Create the link*, which is the press that makes one. */}
              <Button type="button" variant="outline" size="sm" onClick={() => setConfirming(true)}>
                <Link2 size={14} />
                Create a link
              </Button>
            </Tooltip>
          ) : (
            /* No offer while we cannot say what a link would carry, as with
               the public switch. */
            <p className="tw:m-0 tw:text-ink-faint">{SHARING_INVENTORY_UNKNOWN}</p>
          )}
        </>
      )}

      {off && confirming && (
        <div className="tw:mt-2 tw:rounded-md tw:border tw:border-rule-strong tw:bg-surface-raised tw:p-3">
          <h4 className="tw:m-0 tw:mb-2 tw:text-sm tw:font-semibold tw:text-ink">
            {PRIVATE_LINK_CONFIRM_TITLE}
          </h4>
          <p className="tw:m-0 tw:mb-2 tw:text-ink-faint">{privateLinkConfirmBody(title)}</p>
          <Inventory inventory={inventory} />
          <Personalisation kinds={sharing?.personalised} />
          <p className="tw:m-0 tw:mb-3 tw:text-ink-faint">{PRIVATE_LINK_CANNOT_UNRING}</p>
          <label className="tw:mb-3 tw:flex tw:items-start tw:gap-2 tw:text-ink">
            <input type="checkbox" checked={rights} onChange={(e) => setRights(e.target.checked)} />
            <span>{SHARING_RIGHTS_CONFIRM}</span>
          </label>
          <div className="tw:flex tw:flex-wrap tw:items-center tw:gap-2">
            <Button type="button" size="sm" disabled={!rights} onClick={() => void change("on")}>
              <Link2 size={14} />
              Create the link
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

      {said && <p className="tw:m-0 tw:mt-3 tw:text-destructive">{said}</p>}
    </div>
  );
}
