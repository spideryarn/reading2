/**
 * **The add page's *Create a private link*** — draws a `LinkAtAdd`
 * (src/web/add-share-link.ts), which holds the state and sends the requests.
 * docs/plans/261005l-permalink-and-share-while-an-article-is-importing.md
 * § Stage 2, 2b.
 *
 * **The button opens a question; it makes nothing.** The confirmation is the
 * Metadata card's own (PrivateLink.tsx), built from the pieces that card
 * uses, so the sentences an owner agrees to are the same in both places. Its
 * inventory is the one for an article nothing has been built on
 * (`NOTHING_BUILT`, AddShare.tsx), which is safe to say only because
 * `LinkAtAdd` offers the control when the probe found no published article.
 *
 * **The key is drawn in the link box and nowhere else**: not in an
 * attribute, a title or a log. It is there only while the state is `on`, or
 * a refused turn-off left the link standing.
 *
 * It draws nothing over an article already on the shelf: *Make it public*'s
 * line beside it says where to go (AddSharing.tsx).
 */
import { useSyncExternalStore } from "react";
import { Link2, Link2Off } from "lucide-react";

import {
  LINK_AT_ADD_GAVE_UP,
  LINK_AT_ADD_ON,
  LINK_AT_ADD_UNKNOWN,
  LINK_AT_ADD_UNREAD,
  LINK_AT_ADD_WAITING,
  LINK_AT_ADD_WHAT,
  PRIVATE_LINK_ALSO_PUBLIC,
  PRIVATE_LINK_CANNOT_UNRING,
  PRIVATE_LINK_CONFIRM_TITLE,
  PRIVATE_LINK_COPY_TIP,
  PRIVATE_LINK_HEADING,
  PRIVATE_LINK_OPEN_TIP,
  PRIVATE_LINK_STOP_TIP,
  SHARING_RIGHTS_CONFIRM,
  privateLinkConfirmBody,
  privateLinkInFlight,
} from "../messages.js";
import { SHARE_KEY_PARAM } from "../share-key.js";
import { CopyLink, Inventory, Personalisation } from "./AccessSharing.js";
import { NOTHING_BUILT, Warning } from "./AddShare.js";
import type { LinkAtAdd, LinkAtAddState, LinkOn } from "./add-share-link.js";
import { Button } from "./components/ui/button.js";
import { readHref } from "./router.js";
import { sharedInventory } from "./shared-inventory.js";
import { TipNote, Tooltip } from "./Tooltip.js";

/**
 * **Whether there is anything to draw**, for the Sharing section
 * (AddSharing.tsx). No control until the first read has answered, none when
 * it could not, and none over a published article. Outside the interval the
 * page offers its boxes in (`offer`), an untouched control is not drawn.
 */
export function linkDraws(state: LinkAtAddState, offer: boolean): boolean {
  if (state.kind === "reading" || state.kind === "unavailable" || state.kind === "adopted") return false;
  return offer || state.kind !== "off";
}

/** The link that may be shown: one that is on, or one a refused turn-off left on. */
function shown(state: LinkAtAddState): LinkOn | null {
  if (state.kind === "on") return state.link;
  return state.kind === "refused" ? state.link : null;
}

export function AddShareLink({
  link,
  offer,
  alsoPublic,
}: {
  link: LinkAtAdd;
  /** As `AddShare`'s: whether the page is offering its boxes now. */
  offer: boolean;
  /** The article is public too, as far as *Make it public* knows: the link is then not what keeps it readable. */
  alsoPublic: boolean;
}) {
  const state = useSyncExternalStore(link.subscribe, link.get);
  if (!linkDraws(state, offer)) return null;

  const on = shown(state);
  /* Where a create can be asked for: nothing is on, and nothing is out. */
  const canAsk = state.kind === "off" || (state.kind === "refused" && state.link === null);

  return (
    <div data-add-share-link className="tw:mt-4 tw:text-sm">
      <h2 className="tw:m-0 tw:flex tw:items-center tw:gap-1 tw:text-sm tw:font-normal tw:text-foreground">
        <Link2 size={13} className="tw:text-ink-faint" />
        {PRIVATE_LINK_HEADING}
      </h2>
      {canAsk && <p className="tw:m-0 tw:mb-2 tw:text-muted-foreground">{LINK_AT_ADD_WHAT}</p>}
      <p className="tw:m-0 tw:text-muted-foreground" aria-live="polite">
        {line(state)}
      </p>

      {canAsk && (
        <Tooltip placement="bottom" content={<TipNote>{PRIVATE_LINK_OPEN_TIP}</TipNote>}>
          {/* `outline`: this opens the question. The primary is on *Create
              the link*, which is the press that makes one. */}
          <Button type="button" variant="outline" size="sm" className="tw:mt-2" onClick={() => link.open()}>
            <Link2 size={14} />
            Create a private link
          </Button>
        </Tooltip>
      )}

      {state.kind === "confirming" && (
        <div className="tw:mt-2 tw:rounded-md tw:border tw:border-rule-strong tw:bg-surface-raised tw:p-3">
          <h3 className="tw:m-0 tw:mb-2 tw:text-sm tw:font-semibold tw:text-ink">
            {PRIVATE_LINK_CONFIRM_TITLE}
          </h3>
          <p className="tw:m-0 tw:mb-2 tw:text-ink-faint">{privateLinkConfirmBody(null)}</p>
          <Inventory inventory={sharedInventory(NOTHING_BUILT)} />
          <Personalisation kinds={undefined} />
          <p className="tw:m-0 tw:mb-3 tw:text-ink-faint">{PRIVATE_LINK_CANNOT_UNRING}</p>
          <label className="tw:mb-3 tw:flex tw:items-start tw:gap-2 tw:text-ink">
            <input
              type="checkbox"
              checked={state.rights}
              onChange={(event) => link.tick(event.target.checked)}
            />
            <span>{SHARING_RIGHTS_CONFIRM}</span>
          </label>
          <div className="tw:flex tw:flex-wrap tw:items-center tw:gap-2">
            {/* The press that makes a link. `LinkAtAdd.create` refuses it
                without the tick too; the disabled state is the reader being
                told why. */}
            <Button type="button" size="sm" disabled={!state.rights} onClick={() => link.create()}>
              <Link2 size={14} />
              Create the link
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => link.cancel()}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {/* Not made yet, and it can still be called off: every attempt so far
          was answered *no article here yet*. */}
      {(state.kind === "waiting" || state.kind === "gave-up") && (
        <Button type="button" variant="ghost" size="sm" className="tw:mt-2" onClick={() => link.cancel()}>
          Cancel
        </Button>
      )}

      {state.kind === "unknown" && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="tw:mt-2"
          disabled={state.checking}
          onClick={() => link.recheck()}
        >
          {state.checking ? "Checking…" : "Check again"}
        </Button>
      )}

      {on && (
        <div className="tw:mt-2">
          {alsoPublic && <p className="tw:m-0 tw:mb-2 tw:text-foreground">{PRIVATE_LINK_ALSO_PUBLIC}</p>}
          <CopyLink
            link={`${location.origin}${readHref(link.slug, `${SHARE_KEY_PARAM}=${on.key}`)}`}
            label="The private link"
            tip={PRIVATE_LINK_COPY_TIP}
          />
          <Tooltip placement="bottom" content={<TipNote>{PRIVATE_LINK_STOP_TIP}</TipNote>}>
            {/* `outline`, not `destructive`: this is the safe direction. */}
            <Button type="button" variant="outline" size="sm" onClick={() => link.turnOff()}>
              <Link2Off size={14} />
              Turn off
            </Button>
          </Tooltip>
        </div>
      )}
    </div>
  );
}

function line(state: LinkAtAddState) {
  switch (state.kind) {
    case "reading":
    case "adopted":
    case "unavailable":
    case "off":
    case "confirming":
      return null;
    case "waiting":
      return LINK_AT_ADD_WAITING;
    case "saving":
      return privateLinkInFlight(state.to);
    case "on":
      return LINK_AT_ADD_ON;
    case "gave-up":
      return <Warning>{LINK_AT_ADD_GAVE_UP}</Warning>;
    case "refused":
      /* The server's sentence, which says what was refused and why. */
      return (
        <Warning>
          {state.attempted === "on" ? "No link made" : "Still on"}: {state.message}
        </Warning>
      );
    case "unknown":
      /* Two ways of not knowing, and each sentence is true of one only. */
      return <Warning>{state.because === "read" ? LINK_AT_ADD_UNREAD : LINK_AT_ADD_UNKNOWN}</Warning>;
    default: {
      const never: never = state;
      return never;
    }
  }
}
