/**
 * **What the route was planned for, and the question when nobody has said** —
 * the one line Skim's band carries about the article's purpose, owner
 * only. docs/plans/260930e-ask-why-you-are-reading-and-a-trajectory-for-that-intent.md
 * § Stage 2; the purpose itself is docs/project/reader-profile.md.
 *
 * - **Set**: *Reading for: …* on one line, the whole sentence in a tooltip,
 *   and **Edit**, which opens the box below in place, filled with the
 *   sentence (since 2026-10-11; a link to Metadata's box before). Greg,
 *   spya-wu83xh: *"an optional input box so that you could say what it is
 *   that you're trying to skim for. In that way, it wouldn't be so different
 *   from the search box."* The purpose is what the route is planned for
 *   already, so this is that box, asked as *What are you skimming for?*, not a
 *   second, Skim-only focus with its own storage (plan 261011r says why).
 * - **Not set, and a route on screen**, or **editing**: the box and *Plan the
 *   route for this*, which saves the purpose and, **only once the save has
 *   answered**, asks for the route with `ensure()`. Unforced is enough: a
 *   route's stamp carries the profile hash, so the server re-plans one
 *   written for another profile. The box never saves an empty sentence —
 *   clearing the purpose stays in Metadata — nor the sentence already saved.
 *
 * **Never in the empty state** (Sol F6). With no route, `useAutoRun` plans one
 * as the mode opens, and a second request made with a different profile would
 * not de-duplicate against it — two paid routes. The caller mounts this only
 * when a route is ready. And never when the purpose could not be read: a reader
 * told "you have not said" types over the sentence they already wrote.
 *
 * **With a microphone**, in `PurposeAsk` below: the add page's box writes the
 * same purpose and has one. docs/plans/261021e-microphone-on-the-five-remaining-prose-boxes.md.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Route } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MAX_PURPOSE_CHARS } from "../types.js";
import { DictationButton, DictationStrip } from "./DictationStrip.js";
import { keepDictation } from "./dictation-keep.js";
import { dictationReporter } from "./dictation-report.js";
import { useReaderTranscriber } from "./dictation-upload.js";
import { describeFetchFailure } from "./lib/describe-failure.js";
import { savePurpose, storedPurpose, usePurpose } from "./purpose.js";
import { profileSaved } from "./profile-saved.js";
import { Tooltip } from "./Tooltip.js";
import type { UseSkim } from "./useSkim.js";
import { useDictationField } from "./useDictationField.js";

interface Props {
  owner: UseSkim;
  /** A stale or profile-changed banner is up: it already offers the re-plan, so do not ask again. */
  bannerUp: boolean;
}

export function PurposeLine({ owner, bannerUp }: Props) {
  const read = usePurpose(owner.slug);
  /** What the server stored after a press here — it wins over the read. */
  const [saved, setSaved] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  /** The box is open over a saved purpose — *Edit* was pressed. */
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /* **The hold** (plan 261021e, Sol's F1). `PurposeAsk` says when its
     microphone is busy, and while it is nothing here takes the box away: a
     banner arriving would unmount it, and unmounting aborts the dictation.
     `false` again when the box goes, since its dictation went with it. */
  const [dictating, setDictating] = useState(false);
  /* State disables the visible control; the ref closes the smaller gap before
     React re-renders, when two clicks could otherwise send two PATCHes and call
     `ensure()` twice. */
  const planning = useRef(false);
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      planning.current = false;
    };
  }, []);

  if (read.state !== "ready" || read.purposeFailed) return null;
  const purpose = saved ?? read.purpose;

  const set = purpose !== null && purpose !== "";
  /* A route being planned, or a forced one whose result is not read yet:
     another request now would race it (GPT Sol, plan review F6). */
  const planningElsewhere = owner.starting || owner.job !== null || owner.rewriting;
  /* A banner waits for a dictation to end before it takes the box (the hold). */
  const bannerTakesBox = bannerUp && !dictating;
  if (set && (!editing || bannerTakesBox)) {
    return (
      <div className="skim-purpose">
        <Tooltip content={<p>{purpose}</p>} placement="bottom" className="skim-purpose-tip">
          {/* Focusable so a keyboard reaches the whole sentence too. */}
          {/* biome-ignore lint/a11y/noNoninteractiveTabindex: the tooltip's trigger */}
          <span className="skim-purpose-said" tabIndex={0}>
            <span className="skim-purpose-label">Reading for:</span>{" "}
            <span className="skim-purpose-text">{purpose}</span>
          </span>
        </Tooltip>
        {/* Not under a banner: its own button re-plans, and two ways to ask
            for a route at once is the race the hold exists to stop. */}
        {!bannerUp && (
          <Button
            type="button"
            variant="link"
            size="sm"
            className="skim-purpose-edit"
            disabled={planningElsewhere}
            onClick={() => {
              setDraft(purpose);
              setError(null);
              setEditing(true);
            }}
          >
            Edit
          </Button>
        )}
      </div>
    );
  }

  /* The box waits under a banner, whose own button re-plans — unless it is
     being dictated into (the hold). */
  if (bannerTakesBox) return null;

  const busy = saving || planningElsewhere;
  const text = draft.trim();
  /* Saving the sentence already saved would re-plan nothing and say it had. */
  const unchanged = set && text === purpose;
  const plan = async () => {
    /* Never an empty draft: `savePurpose(slug, null)` erases (plan F1). Never
       under a banner, which the hold can leave the box above; its own button
       re-plans. A busy microphone is refused in `PurposeAsk`. */
    if (text === "" || unchanged || busy || bannerUp || planning.current) return;
    planning.current = true;
    setSaving(true);
    setError(null);
    let stored: string | null;
    try {
      stored = await savePurpose(owner.slug, text);
    } catch (err) {
      /* **A save that rejected may still have been stored** (purpose.ts §
         `savePurpose`), so ask what is there before saying which it was. This
         said "Not saved" for every rejection until 2026-10-07. */
      const why = describeFetchFailure(err as Error);
      const held = await storedPurpose(owner.slug);
      if (!live.current) return;
      /* `text` is what the server would hold: it trims and settles `\r\n`, and
         a textarea's value never carries a `\r`. */
      if (held === null || held.purpose !== text) {
        planning.current = false;
        setError(
          held === null
            ? /* No code: the reason's own sentence can claim more than is known
                 here ("nothing was sent"), and Metadata's delete says the same
                 thing the same way (copy.md § The words on the one control). */
              "Couldn't tell whether that was saved, so no route was planned. Your words are still " +
                "in the box. Reload the page to see what is stored."
            : /* What the read showed, not what the write did: another tab can
                 replace a save that landed before this read (GPT Sol, K4-F3). */
              `These words are not what is saved for this article, so no route was planned. ${why}`,
        );
        setSaving(false);
        return;
      }
      /* It is there. Invalidate work made from the old purpose, just as
         savePurpose does after a readable reply, then carry on as asked. */
      profileSaved();
      stored = held.purpose;
    }
    if (!live.current) return;
    setSaved(stored);
    setSaving(false);
    setEditing(false);
    /* Held until the route has been asked for, so a press in between cannot
       send a second save and a second `ensure()`. */
    await owner.ensure();
    planning.current = false;
  };

  return (
    <PurposeAsk
      slug={owner.slug}
      draft={draft}
      setDraft={setDraft}
      canPlan={!busy && !bannerUp && text !== "" && !unchanged}
      plan={() => void plan()}
      micOff={busy}
      cancel={editing ? () => setEditing(false) : null}
      saving={saving}
      error={error}
      onBusyChange={setDictating}
    />
  );
}

/**
 * **The box, its microphone, and *Plan the route for this*.** Its own
 * component rather than more of `PurposeLine`, which stays mounted when the
 * box goes (Cancel, a save, a banner): a dictation hook there would keep
 * recording behind a box that is gone. Here the box going unmounts the hook,
 * which aborts. dictation.md § Adding it to a box; plan
 * docs/plans/261021e-microphone-on-the-five-remaining-prose-boxes.md § Stage 2.
 *
 * While the microphone is busy (on, or its words on their way) *Plan* and
 * *Cancel* are refused and disabled — the first would plan from the live
 * guesses, the second would unmount mid-sentence — and `busy` goes up to
 * `PurposeLine` so that a banner does not take the box (the add page's hold,
 * dictation.md § A page that leaves by itself). A double press on Stop plans
 * once the words have landed.
 */
function PurposeAsk({
  slug,
  draft,
  setDraft,
  canPlan,
  plan,
  micOff,
  cancel,
  saving,
  error,
  onBusyChange,
}: {
  slug: string;
  draft: string;
  setDraft: (value: string) => void;
  /** Everything but the microphone allows *Plan* now. */
  canPlan: boolean;
  /** `PurposeLine`'s plan, with its own refusals. */
  plan: () => void;
  /** A save or a route is in flight: no new dictation. Stopping one always works. */
  micOff: boolean;
  /** *Cancel*, when the box is open over a saved purpose. */
  cancel: (() => void) | null;
  saving: boolean;
  error: string | null;
  onBusyChange: (busy: boolean) => void;
}) {
  const box = useRef<HTMLTextAreaElement>(null);
  const transcribe = useReaderTranscriber();
  /* The hook calls `onDone` from an effect on the render after the words
     land, so this sees that render's `busy`, false by then. */
  const send = (): void => {
    if (dictate.busy) return;
    plan();
  };
  const dictate = useDictationField({
    value: draft,
    onChange: setDraft,
    box,
    context: { kind: "article", slug },
    transcribe,
    report: dictationReporter("skim"),
    keep: keepDictation(`skim:purpose:${slug}`),
    onDone: send,
  });
  const tell = useRef(onBusyChange);
  tell.current = onBusyChange;
  /* A microphone press and a banner answer can be batched into one render. If
     the hold waited only for the busy render's layout effect below, the parent
     could see the banner first and unmount this box before that render existed.
     Claim synchronously at the press, as AddPage's `useBusyDictation` does. */
  const claimed = useRef(false);
  const claim = (): void => {
    if (dictate.busy) return;
    claimed.current = true;
    tell.current(true);
  };
  const toggle = (): void => {
    claim();
    dictate.toggle();
  };
  const retry = (): void => {
    /* A kept recording's Retry enters transcription and has the same
       same-batch unmount race as a first microphone press. */
    claim();
    dictate.dictation.retry();
  };
  const heldDictation = { ...dictate.dictation, retry };
  /* A layout effect, so `PurposeLine` has the settled phase before a passive
     effect or a later press reads it. */
  useLayoutEffect(() => {
    tell.current(dictate.busy);
  }, [dictate.busy]);
  /* A refused press never changes `busy`, so settle its provisional claim on
     the first render the claim itself caused. */
  useLayoutEffect(() => {
    if (!claimed.current) return;
    claimed.current = false;
    if (!dictate.busy) tell.current(false);
  });
  /* A box that has gone is not busy: its dictation was aborted with it. */
  useLayoutEffect(() => () => tell.current(false), []);

  return (
    <div className="skim-purpose skim-purpose-ask">
      <div className="skim-purpose-head">
        <label className="skim-purpose-q" htmlFor="skim-purpose-input">
          What are you skimming for?
        </label>
        {heldDictation.supported && (
          <DictationButton
            dictation={heldDictation}
            toggle={toggle}
            /* Only while idle: switched off mid-dictation it would be a Stop
               that cannot stop. */
            disabled={micOff && !dictate.busy}
            sendingAfter={dictate.sendingAfter}
            doubleStop={dictate.doubleStop}
          />
        )}
      </div>
      <textarea
        id="skim-purpose-input"
        ref={box}
        className="skim-purpose-input"
        rows={2}
        maxLength={MAX_PURPOSE_CHARS}
        placeholder="e.g. how they handled missing data"
        value={draft}
        readOnly={dictate.readOnly}
        onChange={(e) => setDraft(e.target.value)}
      />
      <DictationStrip dictation={heldDictation} sendingAfter={dictate.sendingAfter} />
      <div className="skim-purpose-foot">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!canPlan || dictate.busy}
          onClick={send}
        >
          <Route size={13} />
          Plan the route for this
        </Button>
        {cancel !== null && (
          <Button type="button" variant="ghost" size="sm" disabled={saving || dictate.busy} onClick={cancel}>
            Cancel
          </Button>
        )}
        <span className="skim-purpose-note">
          A paid model call. Saved as your purpose for this piece, which other modes use too.
        </span>
      </div>
      {error !== null && (
        <p className="gloss-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
