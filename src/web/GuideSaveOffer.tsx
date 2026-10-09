/**
 * **The guide's offer to save, drawn under its answer, and saved only on the
 * reader's press** — plan
 * docs/plans/261009o-the-guide-offers-to-save-your-reason-and-about-you-in-your-words.md.
 *
 * > the guide should have a tool to enable it to save to why you're reading or
 * > your profile … stay fairly close to the user's input, but it doesn't have
 * > to be exact.
 * >
 * > — Greg, 2026-10-09, reply `spya-ujstyz` to q-w2740x
 *
 * The guide's `offer_to_save` tool (src/chat-tools.ts) saves nothing: it puts
 * an offer on the turn's run (`ToolRun.offer`), and this card is where it
 * becomes a write, by a press. That is the rule in
 * docs/project/security-map.md that anything a model proposes that writes the
 * reader's data is a press: the guide's prompt has the whole article in it, so
 * the words on the card can be a planted instruction's choosing, and the reader
 * reads them before deciding.
 *
 * - **The press reads before it writes.** What is stored now is read fresh
 *   (`storedReader`); a read that cannot answer writes nothing, since the Undo
 *   needs the old value. Words already stored are said to be saved, and not
 *   written again.
 * - **Undo** puts back what the press replaced, and only over what the press
 *   wrote: if it has changed since (another tab, Metadata, a second offer), it
 *   says so and leaves it.
 * - A write that rejects is checked against the server before it is called a
 *   failure (`savePurpose`'s contract: the reply can be lost after the write).
 * - One write in flight per card.
 *
 * The words are the model's, however close to the reader's, so they are set in
 * the model's face (docs/project/fonts.md); the heading and buttons are ours.
 */
import { useRef, useState } from "react";
import {
  type ChatMessage,
  MAX_PROFILE_CHARS,
  MAX_PURPOSE_CHARS,
  normaliseProfileText,
  type SaveOffer,
  type ToolRun,
} from "../types.js";
import { Link } from "./Link.js";
import { useMadeFor } from "./lib/made-for.js";
import { savePurpose, storedReader } from "./purpose.js";
import { PROFILE_HREF, readHref } from "./router.js";
import { saveProfile } from "./useProfile.js";

/** Our words for each field: the card's heading, its button, and what it says once saved. */
export const OFFER_WORDS = {
  purpose: {
    heading: "Why you're reading this one",
    save: "Save as why you're reading",
    saved: "Saved as why you're reading this one.",
  },
  profile: {
    heading: "About you",
    save: "Save to About you",
    saved: "Saved to About you.",
  },
} as const satisfies Record<SaveOffer["field"], { heading: string; save: string; saved: string }>;

export const UNDO_LABEL = "Undo";

/**
 * **The offer on a stored run, if it is one this card may draw.** The server
 * checked it when the tool ran; a run is stored JSON, so its name, status and
 * shape are checked again here rather than trusted.
 */
export function offerOf(run: ToolRun): SaveOffer | null {
  if (run.name !== "offer_to_save" || run.status !== "done" || run.offer === undefined) return null;
  const { field, text, basis } = run.offer as { field?: unknown; text?: unknown; basis?: unknown };
  if (field !== "purpose" && field !== "profile") return null;
  if (typeof text !== "string" || normaliseProfileText(text) !== text) return null;
  const max = field === "purpose" ? MAX_PURPOSE_CHARS : MAX_PROFILE_CHARS;
  if (text.length > max) return null;
  /* No basis is not an old/looser offer: it is one that cannot prove what it
     is replacing. Refuse it at the stored-JSON boundary as well as in the
     tool, so a forged or partial run cannot turn the fresh read into blanket
     permission to overwrite whatever it finds. */
  if (basis !== null && (typeof basis !== "string" || normaliseProfileText(basis) !== basis || basis.length > max)) {
    return null;
  }
  return { field, text, basis };
}

/**
 * **The cards an answer draws: the last valid offer per field**, in the order
 * the fields were first offered. A model may call the tool twice for one field
 * in one answer, and two cards for one box would race each other.
 */
export function offersIn(tools: readonly ToolRun[] | undefined): SaveOffer[] {
  const last = new Map<SaveOffer["field"], SaveOffer>();
  for (const run of tools ?? []) {
    const offer = offerOf(run);
    if (offer !== null) last.set(offer.field, offer);
  }
  return [...last.values()];
}

/** Every card an answer carries, drawn once the answer has settled. */
export function GuideSaveOffers({ slug, message }: { slug: string; message: ChatMessage }) {
  if (message.role !== "assistant" || message.status === "pending") return null;
  const offers = offersIn(message.tools);
  if (offers.length === 0) return null;
  return (
    <>
      {offers.map((offer) => (
        <GuideSaveOffer key={offer.field} slug={slug} offer={offer} />
      ))}
    </>
  );
}

type OfferState =
  | { kind: "offer"; note?: keyof typeof NOTES }
  | { kind: "busy"; was: "offer" | "saved" }
  /** Saved by this press; `before` is what it replaced, for Undo. */
  | { kind: "saved"; before: string | null; note?: "changed" | "failed" }
  | { kind: "already" };

/** What the card says after a press that did not save, or an Undo that worked. */
const NOTES = {
  undone: "Undone: it is back as it was.",
  unread: "Couldn't check what is saved now, so nothing was changed. Try again.",
  failed: "Couldn't save it. Try again.",
  changed: "It has changed since I offered this, so I left it as it is. Ask me again if you want this saved.",
} as const;

export function GuideSaveOffer({ slug, offer }: { slug: string; offer: SaveOffer }) {
  const madeFor = useMadeFor();
  const [state, setState] = useState<OfferState>({ kind: "offer" });
  const busy = useRef(false);
  const words = OFFER_WORDS[offer.field];
  const where = offer.field === "purpose" ? readHref(slug, "", "metadata") : PROFILE_HREF;
  const whereName = offer.field === "purpose" ? "Metadata" : "your profile";

  /** Write, and answer with what the server says it stored. */
  const write = async (value: string | null): Promise<string | null> =>
    offer.field === "purpose"
      ? await savePurpose(slug, value, madeFor)
      : normaliseProfileText(await saveProfile(value ?? "", madeFor));
  /** What is stored now in this card's field, or `undefined` when that cannot be known. */
  const current = async (): Promise<string | null | undefined> => (await storedReader(slug, madeFor))?.[offer.field];
  /**
   * Write, and say whether `value` is what is stored afterwards: the reply's
   * own answer, or on a rejection the server's (the reply can be lost after
   * the write, `savePurpose`'s contract).
   */
  const landed = async (value: string | null): Promise<boolean> => {
    try {
      return (await write(value)) === value;
    } catch {
      return (await current()) === value;
    }
  };
  const once = async (was: "offer" | "saved", run: () => Promise<OfferState>, fallback: OfferState) => {
    if (busy.current) return;
    busy.current = true;
    setState({ kind: "busy", was });
    try {
      setState(await run());
    } catch {
      setState(fallback);
    } finally {
      busy.current = false;
    }
  };

  const save = () =>
    once(
      "offer",
      async () => {
        const before = await current();
        if (before === undefined) return { kind: "offer", note: "unread" };
        if (before === offer.text) return { kind: "already" };
        /* Saved only over what the guide saw when it offered this: an older
           card pressed after the words changed (a later offer saved, another
           tab, Metadata) would otherwise put back words the reader replaced. */
        if (before !== offer.basis) return { kind: "offer", note: "changed" };
        return (await landed(offer.text)) ? { kind: "saved", before } : { kind: "offer", note: "failed" };
      },
      { kind: "offer", note: "failed" },
    );

  const undo = (before: string | null) =>
    once(
      "saved",
      async () => {
        const now = await current();
        if (now === undefined) return { kind: "saved", before, note: "failed" };
        if (now !== offer.text) return { kind: "saved", before, note: "changed" };
        return (await landed(before)) ? { kind: "offer", note: "undone" } : { kind: "saved", before, note: "failed" };
      },
      { kind: "saved", before, note: "failed" },
    );

  const shows = state.kind === "busy" ? state.was : state.kind;
  return (
    <section className="guide-offer" aria-label={`The guide's offer: ${words.heading}`}>
      <p className="guide-offer-heading">{words.heading}</p>
      <p className="guide-offer-text voice-ai">{offer.text}</p>
      {shows === "saved" ? (
        <p className="chat-empty-hint guide-offer-status" role="status">
          {words.saved} You can change it on <Link href={where}>{whereName}</Link>.{" "}
          <button
            type="button"
            className="chat-suggest-btn"
            disabled={state.kind === "busy"}
            onClick={() => {
              if (state.kind === "saved") void undo(state.before);
            }}
          >
            {UNDO_LABEL}
          </button>
          {state.kind === "saved" && state.note === "changed" && <> It has changed since, so I left it as it is now.</>}
          {state.kind === "saved" && state.note === "failed" && <> Couldn't undo it. Try again, or change it there.</>}
        </p>
      ) : shows === "already" ? (
        <p className="chat-empty-hint guide-offer-status" role="status">
          Already saved: this is what it says now.
        </p>
      ) : (
        <div className="guide-offer-actions">
          {offer.field === "profile" && (
            <p className="chat-empty-hint guide-offer-note">Saving this replaces what About you says now.</p>
          )}
          <button type="button" className="chat-suggest-btn" disabled={state.kind === "busy"} onClick={() => void save()}>
            {words.save}
          </button>
          {state.kind === "offer" && state.note !== undefined && (
            <span className="chat-empty-hint" role={state.note === "undone" ? "status" : "alert"}>
              {" "}
              {NOTES[state.note]}
              {state.note !== "undone" && (
                <>
                  {" "}
                  You can write it yourself on <Link href={where}>{whereName}</Link>.
                </>
              )}
            </span>
          )}
        </div>
      )}
    </section>
  );
}
