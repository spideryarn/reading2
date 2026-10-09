/**
 * **The add page's *Public* control** — draws a `ShareAtAdd`
 * (src/web/add-share.ts), which holds the state and sends the request.
 * docs/plans/261005l-permalink-and-share-while-an-article-is-importing.md.
 *
 * Off by default and never remembered, like High-powered AI above it
 * (AddHighPower.tsx): a remembered choice would publish every later import.
 *
 * **A button, not a tick box, since 2026-10-09** (plan 261009i, spya-nsrkju):
 * the shape of the private link beside it and of the Metadata card's own
 * *Share with anyone…*. The box stayed ticked while the confirmation was still
 * asking, so the page looked shared when nothing was. Each press calls what
 * the box called (`open`, `untick`), so what is sent did not change. Which
 * press is offered in which state is `press`, below; `data-on` on the control
 * says what the box's tick used to.
 *
 * **The press opens a question; it shares nothing.** The confirmation is the
 * Metadata card's own, built from the pieces that card exports
 * (AccessSharing.tsx, and PrivateLink.tsx for the same shape used a second
 * time), so the sentences an owner agrees to are the same in both places. Its
 * inventory is the one for an article nothing has been built on: everything a
 * model makes is listed under *would be shared if built*, which is true,
 * because the import builds them. That is safe to say only because
 * `ShareAtAdd` offers the control when the probe found no published article.
 *
 * No money in the confirmation, by `UNSHARING_COSTS_ALLOWANCE`'s third rule
 * (src/messages.ts); that sentence is drawn beside the public state, as on
 * Metadata.
 */
import { useSyncExternalStore } from "react";
import { Globe, Link2Off, TriangleAlert } from "lucide-react";

import {
  PUBLIC_SHELF_LABEL,
  SHARE_AT_ADD_ALREADY_AN_ARTICLE,
  SHARE_AT_ADD_GAVE_UP,
  SHARE_AT_ADD_HEADING,
  SHARE_AT_ADD_LABEL,
  SHARE_AT_ADD_ON,
  SHARE_AT_ADD_RECALLED,
  SHARE_AT_ADD_UNKNOWN,
  SHARE_AT_ADD_WAITING,
  SHARE_AT_ADD_WHAT_LEAD,
  SHARING_CANNOT_UNRING,
  SHARING_CONFIRM_TITLE,
  SHARING_OPEN_TIP,
  SHARING_RIGHTS_CONFIRM,
  SHARING_STOP_TIP,
  UNSHARING_COSTS_ALLOWANCE,
  sharingConfirmBody,
  sharingInFlight,
} from "../messages.js";
import type { PublicArtefacts } from "../types.js";
import { ARTEFACT_KEYS, CopyLink, Inventory, Personalisation } from "./AccessSharing.js";
import type { ShareAtAdd, ShareAtAddState } from "./add-share.js";
import { Button } from "./components/ui/button.js";
import { Link } from "./Link.js";
import { PUBLIC_LIBRARY_HREF, readHref } from "./router.js";
import { sharedInventory } from "./shared-inventory.js";
import { TipNote, Tooltip } from "./Tooltip.js";

/** Every flag false, from the card's own list of keys so a new artefact cannot be left out. */
export const NOTHING_BUILT = Object.fromEntries(ARTEFACT_KEYS.map((key) => [key, false])) as unknown as PublicArtefacts;

/**
 * **Whether there is anything to draw.** No control until the probe has said
 * there is no article here yet, and none when it could not say. Outside the
 * interval the page offers its controls in (`offer`), an untouched control and the
 * *already an article* line are not drawn either. Exported because the
 * Sharing section (AddSharing.tsx) must not draw a row with nothing in it.
 */
export function shareDraws(state: ShareAtAddState, offer: boolean): boolean {
  if (state.kind === "probing" || state.kind === "unavailable") return false;
  return offer || (state.kind !== "adopted" && state.kind !== "off");
}

export function AddShare({
  share,
  offer,
}: {
  share: ShareAtAdd;
  /**
   * Whether the add is at a point where the page offers its controls: the
   * import is going, or it has finished and the page is waiting on the
   * reader. Outside that (a failed job, say) an untouched control is not drawn,
   * but one the reader has acted on is: a share that is on must stay
   * somewhere it can be stopped, and a refusal somewhere it can be read.
   */
  offer: boolean;
}) {
  const state = useSyncExternalStore(share.subscribe, share.get);

  if (!shareDraws(state, offer)) return null;
  if (state.kind === "adopted") {
    return (
      <p data-add-share="adopted" className="tw:mt-3 tw:mb-0 tw:text-sm tw:text-muted-foreground">
        {SHARE_AT_ADD_ALREADY_AN_ARTICLE}
      </p>
    );
  }

  const on = sharedOrAsked(state);
  const offered = press(state);

  return (
    <div data-add-share data-on={on} className="tw:mt-4 tw:text-sm">
      <h3 className="tw:m-0 tw:flex tw:items-center tw:gap-1 tw:text-sm tw:font-normal tw:text-foreground">
        <Globe size={13} className="tw:text-ink-faint" />
        {SHARE_AT_ADD_HEADING}
      </h3>
      {offered === "open" && (
        <p className="tw:m-0 tw:text-muted-foreground">
          {SHARE_AT_ADD_WHAT_LEAD}{" "}
          <Link href={PUBLIC_LIBRARY_HREF} className="tw:text-highlight-text tw:underline">
            {PUBLIC_SHELF_LABEL}
          </Link>
          .
        </p>
      )}
      <p className="tw:m-0 tw:text-muted-foreground" aria-live="polite">
        {line(state)}
      </p>

      {offered === "open" && (
        <Tooltip placement="bottom" content={<TipNote>{SHARING_OPEN_TIP}</TipNote>}>
          {/* `outline`: this opens the question. The primary is on *Share it*,
              which is the press that publishes. */}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="tw:mt-2"
            data-add-share-press="open"
            onClick={() => share.open()}
          >
            <Globe size={14} />
            {SHARE_AT_ADD_LABEL}
          </Button>
        </Tooltip>
      )}

      {/* Asked for and not sent yet: every attempt so far was answered *no
          article here yet*, so calling it off takes nothing back. */}
      {offered === "cancel" && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="tw:mt-2"
          data-add-share-press="cancel"
          onClick={() => share.untick()}
        >
          Cancel
        </Button>
      )}

      {state.kind === "confirming" && (
        <div className="tw:mt-2 tw:rounded-md tw:border tw:border-rule-strong tw:bg-surface-raised tw:p-3">
          <h4 className="tw:m-0 tw:mb-2 tw:text-sm tw:font-semibold tw:text-ink">
            {SHARING_CONFIRM_TITLE}
          </h4>
          <p className="tw:m-0 tw:mb-2 tw:text-ink-faint">{sharingConfirmBody(null)}</p>
          <Inventory inventory={sharedInventory(NOTHING_BUILT)} />
          <Personalisation kinds={undefined} />
          <p className="tw:m-0 tw:mb-3 tw:text-ink-faint">{SHARING_CANNOT_UNRING}</p>
          <label className="tw:mb-3 tw:flex tw:items-start tw:gap-2 tw:text-ink">
            <input
              type="checkbox"
              checked={state.rights}
              onChange={(event) => share.tick(event.target.checked)}
            />
            <span>{SHARING_RIGHTS_CONFIRM}</span>
          </label>
          <div className="tw:flex tw:flex-wrap tw:items-center tw:gap-2">
            {/* The press that publishes. `ShareAtAdd.share` refuses it without
                the tick too; the disabled state is the reader being told why. */}
            <Button type="button" size="sm" disabled={!state.rights} onClick={() => share.share()}>
              <Globe size={14} />
              Share it
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => share.cancel()}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {state.kind === "on" && (
        <div className="tw:mt-2">
          <CopyLink link={`${location.origin}${readHref(share.slug)}`} />
          <p className="tw:m-0 tw:text-muted-foreground">{UNSHARING_COSTS_ALLOWANCE}</p>
        </div>
      )}

      {/* Public, or may be: the Metadata card's own label, tooltip and
          `outline`, because this is the safe direction. */}
      {offered === "stop" && (
        <Tooltip placement="bottom" content={<TipNote>{SHARING_STOP_TIP}</TipNote>}>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="tw:mt-2"
            data-add-share-press="stop"
            onClick={() => share.untick()}
          >
            <Link2Off size={14} />
            Stop sharing
          </Button>
        </Tooltip>
      )}
    </div>
  );
}

/**
 * **Whether the box would have been ticked**: asked for, public, or possibly
 * public. Drawn as `data-on` for the tests, which held the tick before the box
 * became a button.
 */
function sharedOrAsked(state: ShareAtAddState): boolean {
  return (
    state.kind === "confirming" ||
    state.kind === "waiting" ||
    state.kind === "gave-up" ||
    state.kind === "on" ||
    state.kind === "unknown" ||
    (state.kind === "saving" && state.to === "public") ||
    (state.kind === "refused" && state.on)
  );
}

/**
 * **The one press offered in each state**, and what it calls is what the box
 * called: ticking was `open`, unticking was `untick`.
 *
 *  - `open`: nothing asked for, so *Make it public…*.
 *  - `cancel`: confirmed and not sent yet (`untick` takes nothing back).
 *  - `stop`: public, or it may be (`unknown`, a refused take-back): `untick`
 *    sends `private`, as unticking did.
 *  - `none`: the confirmation is open and has its own *Cancel*, or a request
 *    is in flight (the box was disabled then), or there is nothing to draw.
 */
function press(state: ShareAtAddState): "open" | "cancel" | "stop" | "none" {
  switch (state.kind) {
    case "off":
      return "open";
    case "refused":
      return state.on ? "stop" : "open";
    case "waiting":
    case "gave-up":
      return "cancel";
    case "on":
    case "unknown":
      return "stop";
    case "probing":
    case "adopted":
    case "unavailable":
    case "confirming":
    case "saving":
      return "none";
    default: {
      const never: never = state;
      return never;
    }
  }
}

function line(state: ShareAtAddState) {
  switch (state.kind) {
    case "probing":
    case "adopted":
    case "unavailable":
    case "off":
    case "confirming":
      return null;
    case "waiting":
      return SHARE_AT_ADD_WAITING;
    case "saving":
      return sharingInFlight(state.to);
    case "on":
      return SHARE_AT_ADD_ON;
    case "gave-up":
      return <Warning>{SHARE_AT_ADD_GAVE_UP}</Warning>;
    case "refused":
      /* The server's sentence, which says what was refused and why. */
      return (
        <Warning>
          {state.attempted === "public" ? "Not shared" : "Still public"}: {state.message}
        </Warning>
      );
    case "unknown":
      /* Two ways of not knowing, and each sentence is true of one only. */
      return (
        <Warning>
          {state.because === "reload" ? SHARE_AT_ADD_RECALLED : SHARE_AT_ADD_UNKNOWN}
        </Warning>
      );
    default: {
      const never: never = state;
      return never;
    }
  }
}

/** A line the reader should not miss: a refusal, a give-up, a state we cannot vouch for. */
export function Warning({ children }: { children: React.ReactNode }) {
  return (
    <span className="tw:inline-flex tw:items-start tw:gap-1 tw:text-highlight-text">
      <TriangleAlert size={12} className="tw:mt-[3px] tw:shrink-0" />
      <span>{children}</span>
    </span>
  );
}
