/**
 * **The guide's offer to save, drawn under its answer** — ordinarily saved on
 * the reader's press, or at once for a checked word-for-word offer — plan
 * docs/plans/261009q-the-guide-offers-to-save-your-reason-and-about-you-in-your-words.md.
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
 * **An offer marked `now` saves itself**, once, on an answer this tab watched
 * being written (src/web/chat/answered-here.ts): it is the reader's own typed
 * words, word for word (src/save-closeness.ts decided, in the tool), so the
 * press would only have confirmed their own words. The same `save` as the
 * button, so the same fresh read, basis check, verification and Undo. Seen
 * any other way (a reload, coming back to the conversation) it does not save:
 * it reads, and shows *Saved* with its Undo if the words are what is stored,
 * or the button if not, so an Undo and a reload never save it again. Greg's reply A to q-t3j8hj and report `spya-yk3r03`, plan
 * docs/plans/261011s-the-guide-saves-your-reason-and-about-you-at-once-when-the-words-are-yours.md.
 *
 * **A reworded `now` offer** (since 2026-10-17, plan
 * docs/plans/261012c-the-guide-saves-a-close-rewording-by-itself-the-safest-form-of-b.md)
 * is one whole sentence the reader typed with only its spelling tidied. Saved,
 * it says *lightly reworded* and shows that sentence, in the reader's face,
 * beside the Undo; in a hidden tab it does not save itself, and shows its button.
 *
 * The words are the model's, however close to the reader's, so they are set in
 * the model's face (docs/project/fonts.md); the heading and buttons are ours.
 */
import { useEffect, useRef, useState } from "react";
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
import { answeredHereWork, takeAnsweredHere, trackAnsweredHereWork } from "./chat/answered-here.js";
import { savePurpose, storedReader } from "./purpose.js";
import { PROFILE_HREF, readHref } from "./router.js";
import { saveProfile } from "./useProfile.js";

/** Our words for each field: the card's heading, its button, and what it says once saved. */
export const OFFER_WORDS = {
  purpose: {
    heading: "Why you're reading this one",
    save: "Save as why you're reading",
    saved: "Saved as why you're reading this one.",
    savedNow: "Saved as why you're reading this one, from what you wrote.",
    savedReworded: "Saved as why you're reading this one, lightly reworded.",
  },
  profile: {
    heading: "About you",
    save: "Save to About you",
    saved: "Saved to About you.",
    savedNow: "Saved to About you, from what you wrote.",
    savedReworded: "Saved to About you, lightly reworded.",
  },
} as const satisfies Record<
  SaveOffer["field"],
  { heading: string; save: string; saved: string; savedNow: string; savedReworded: string }
>;

/** Before the reader's own sentence, under a reworded save. */
export const FROM_YOUR_MESSAGE = "From your message:";

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
  /* Saved without a press only when the stored run says so literally. A
     reworded one also needs the reader's sentence to show beside it; an
     offer stored before routes existed has none and reads as exact. */
  const { now, route, source } = run.offer as { now?: unknown; route?: unknown; source?: unknown };
  if (now !== true) return { field, text, basis };
  if (route === undefined) return { field, text, basis, now: true };
  if (route === "exact") return { field, text, basis, now: true, route };
  if (route === "reworded" && typeof source === "string" && source.trim() !== "") {
    return { field, text, basis, now: true, route, source };
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
        <GuideSaveOffer key={offer.field} slug={slug} offer={offer} answer={message.id} />
      ))}
    </>
  );
}

type OfferState =
  | { kind: "offer"; note?: keyof typeof NOTES }
  | { kind: "busy"; was: "offer" | "saved" }
  /** Saved by this press, or by the card itself (`now`); `before` is what it replaced, for Undo. */
  | { kind: "saved"; before: string | null; now?: true; note?: "changed" | "failed" }
  | { kind: "already" };

/** What the card says after a press that did not save, or an Undo that worked. */
const NOTES = {
  undone: "Undone: it is back as it was.",
  unread: "Couldn't check what is saved now, so nothing was changed. Try again.",
  failed: "Couldn't save it. Try again.",
  changed: "It has changed since I offered this, so I left it as it is. Ask me again if you want this saved.",
} as const;

export function GuideSaveOffer({ slug, offer, answer }: { slug: string; offer: SaveOffer; answer: string }) {
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

  const save = (now: boolean) =>
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
        return (await landed(offer.text))
          ? { kind: "saved", before, ...(now ? { now: true as const } : {}) }
          : { kind: "offer", note: "failed" };
      },
      { kind: "offer", note: "failed" },
    );

  /* A `now` offer: saved by the card on the one sight of an answer this tab
     watched being written; on any other, shown saved, with its Undo, when
     the words are what is stored (a reload, coming back to it). */
  const tried = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: once on this answer-and-field mount; the message id keys the parent and `tried` guards StrictMode's effect replay
  useEffect(() => {
    if (offer.now !== true || tried.current) return;
    tried.current = true;
    /* A reworded one saves itself only where the reader can see it happen
       (plan 261012c): in a hidden tab it shows its button instead. */
    const unseen = offer.route === "reworded" && document.visibilityState === "hidden";
    if (takeAnsweredHere(answer, offer.field) && !unseen) {
      void trackAnsweredHereWork(answer, offer.field, () => save(true));
      return;
    }
    void once(
      "offer",
      async () => {
        /* A previous mount may have started the PATCH and gone away. It cannot
           cancel an uncertain write, so wait for it before deciding what the
           store says and whether this mount must show Undo. */
        await answeredHereWork(answer, offer.field);
        return (await current()) === offer.text
          ? { kind: "saved", before: offer.basis, now: true }
          : { kind: "offer" };
      },
      { kind: "offer" },
    );
  }, []);

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
          {state.kind === "saved" && state.now
            ? offer.route === "reworded"
              ? words.savedReworded
              : words.savedNow
            : words.saved}{" "}
          {state.kind === "saved" && state.now && offer.source !== undefined && (
            <>
              {FROM_YOUR_MESSAGE} “<span className="voice-reader">{offer.source}</span>”{" "}
            </>
          )}
          You can change it on <Link href={where}>{whereName}</Link>.{" "}
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
          <button type="button" className="chat-suggest-btn" disabled={state.kind === "busy"} onClick={() => void save(false)}>
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
