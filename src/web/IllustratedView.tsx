/**
 * **The painted plates, in the band** — docs/project/diagram.md § Illustrated.
 *
 * Its own component beside [`SketchView.tsx`](./SketchView.tsx) rather than a
 * branch inside it, for the reason that file gives about not being a fourth
 * branch of `DiagramPanel`: everything under the chips is about the *kind* of
 * picture on screen, and this one is a JPEG. It has no nodes, no coordinate
 * space, no painter and no hit targets, so the three things it shares with
 * Sketch — a row of scenes, a Back, an Enlarge — are the only three, and they
 * are the cheap part.
 *
 * ## The plate is fetched, not `src`-ed, and this is the failure to know about
 *
 * **A plain `<img src="/api/illustrated/…">` 401s.** Authentication here is an
 * `Authorization: Bearer` header (lib/api.ts § A header rather than a cookie)
 * and an `<img>` sends no headers, so the browser's own image fetch arrives
 * anonymous. What the reader sees is a broken-image glyph, with nothing in the
 * console and nothing in any error state — it looks exactly like a CSS bug. So
 * the bytes come through `apiFetch`, `res.ok` is checked before `blob()`
 * (an error body is perfectly good bytes), and the object URL is revoked in an
 * effect of its own. `AdminFeedbackList.tsx` § Screenshot is where that dance
 * is written up, including the bug the two-effect split fixes; `Metadata.tsx`
 * and `SourceLink.tsx` do the same.
 *
 * ## Nothing in the picture is a control, and the list under it is
 *
 * > A hotspot may only come from **measuring the output**, never from trusting
 * > the input.
 * >
 * > — Fable, 2026-09-03
 *
 * We do not know where the illustrator put section 3, so a hotspot placed where
 * the *Sketch* said it would be is a door onto section 7 that the reader cannot
 * tell is wrong until they have landed. The clickable layer is therefore the
 * **what it depicts** list below the plate: one row per surviving vignette,
 * showing what was drawn and the sentence of the article it came from, each row
 * jumping to that block — every destination checked in the browser on arrival
 * (useIllustrated.ts). It is also how a reader reads the picture back against
 * the piece, which is why the quote is shown at a readable size and wraps
 * rather than being clamped to a line.
 *
 * ## And the label is owed rather than decorative
 *
 * This is the one picture in this app that cannot be checked against what it
 * claims to depict: a genuine, verbatim, block-local quote can still sit beside
 * an invented `depicts`, and the image model can ignore the brief entirely. So
 * a visible sentence says so — not a tooltip, which is a thing you have to go
 * looking for — and the brief itself is one press away, because a prompt can be
 * read against the article where a picture cannot.
 */
import { BandWaiting } from "./BandWaiting.js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Brush,
  ChevronLeft,
  ImageOff,
  LoaderCircle,
  Maximize2,
  Minimize2,
} from "lucide-react";
import { type IllustratedPlate, MAX_ILLUSTRATION_NOTE_CHARS } from "../illustrated-plate.js";
import type { Block, BlockId } from "../types.js";
import { Button } from "@/components/ui/button";
import { DictationButton, DictationStrip } from "./DictationStrip.js";
import { keepDictation } from "./dictation-keep.js";
import { useReaderTranscriber } from "./dictation-upload.js";
import { JobProgress } from "./JobProgress.js";
import { apiFetch } from "./lib/api.js";
/* The Sketch's own wait, imported rather than restated — see
   `SKETCH_THEN_PAINT`. They lived in `./SketchView.js` until 2026-09-07 and
   moved to a leaf when a third caller arrived (the Metadata page's *Generate it
   again* row), which also takes the panel-to-panel edge out of the graph
   entirely rather than leaving a one-way one for `npm run check`'s cycle gate to
   keep quiet about. */
import { SKETCH_WAIT } from "./sketch-cost.js";
import { laterClickOfMany, pressEnlarges } from "./enlargePress.js";
import { ReadError } from "./ReadError.js";
import { RewriteWaiting } from "./RewriteWaiting.js";
import { ControlTip, Tooltip, TooltipGroup } from "./Tooltip.js";
import { type UseIllustrated, useIllustrated } from "./useIllustrated.js";
import { type UseDictationField, useDictationField } from "./useDictationField.js";
import { Excerpt } from "./Excerpt.js";

/**
 * **What a press buys, in one phrase, in exactly one place** — the work and
 * the wait, never the price.
 *
 * What it costs us, for developers: measured over three articles on 2026-09-04, under the lettering prompt and
 * `google/gemini-3.1-flash-image` at 1K: $0.41, $0.49 and $0.62 all in, about
 * two thirds of it the brief call rather than the pictures
 * (docs/project/diagram.md § The wire, and what it costs). It went up from
 * $0.27–$0.40 that day for two reasons pulling the same way — a plate is priced
 * on the wire now at $0.068 rather than arriving as a $0.013 BYOK figure, and
 * the brief is longer because it writes a caption for every vignette.
 *
 * **The dollar figure was in front of the press until 2026-09-30**, as
 * `ILLUSTRATED_PRICE`, and came out when Greg ruled that what AI processing
 * costs us is for the administrator alone (*"i don't want any regular users to
 * know how much AI processing of their articles costs"*). What the reader is
 * still owed before this, the dearest and slowest button in the app, is what it
 * does and how long it takes — so that is what is named, as a constant because
 * the empty state and the chip's hover card must not be able to drift apart.
 * docs/plans/260930k-high-power-for-readers-and-cost-only-for-admins.md § 3.
 */
export const ILLUSTRATED_WORK = "a brief plus one image call per plate";
/** Brief plus plates, measured 2026-09-04: 220 s, 276 s and 385 s. */
export const ILLUSTRATED_WAIT = "four to seven minutes";

/**
 * **What one press does when it has to draw the Sketch first**, built out of
 * the three constants rather than out of new words.
 *
 * It named both prices until 2026-09-30 (see `ILLUSTRATED_WORK` for why it no
 * longer does), and the reasoning for naming each half rather than a total still
 * holds for the waits: a sum would read better and would be a number nothing
 * measures — the kind of fact
 * [260903b-facts-that-were-wrong](../../docs/investigations/260903b-facts-that-were-wrong.md)
 * is about. Both halves named is also what the reader actually needs to know,
 * because the two steps fail, stop and finish separately.
 *
 * The whole point of the sentence is that it is in front of the press. The
 * chain it enables was refused until 2026-09-03 — *"not `enqueue(["sketch",
 * "illustrated"])`, which turns one press into a hidden $0.20 charge and a
 * three-minute wait that nothing warned about"* — and Greg asked for the chain
 * anyway. **The objection was to the hiding, not to the chain**, so the chain
 * lands and the second step — and its wait — is named before the press.
 */
const SKETCH_THEN_PAINT_WORK =
  `The Sketch first: one model call, taking ${SKETCH_WAIT}. Then the painting: ` +
  `${ILLUSTRATED_WORK}, taking ${ILLUSTRATED_WAIT}.`;
export const SKETCH_THEN_PAINT =
  `${SKETCH_THEN_PAINT_WORK} Two steps for one press — Stop takes ` +
  `effect after the step that is running, so stopping during the Sketch leaves the painting unstarted.`;

/**
 * One plate's bytes, as an object URL, or the sentence saying why not.
 *
 * The two effects are not one: the first fetches and calls `setUrl`, the second
 * owns the URL's lifetime and depends on the URL alone. Folded together, the
 * `setUrl` re-renders, the dependency changes, the cleanup runs and revokes the
 * URL it has just handed to state — an `<img>` pointing at nothing,
 * intermittently, depending on render timing. GPT Sol found that in
 * `AdminFeedbackList.tsx`, 2026-09-02, and it is copied rather than re-derived.
 */
function usePlateBytes(
  slug: string,
  /**
   * **The whole stored record, not just its hash** — the extension is half the
   * URL. An article can hold JPEG plates drawn before 2026-09-04 beside PNG ones
   * drawn after, and the route requires the extension to match the record
   * (src/routes.ts § `sendPlate`), so a hard-coded `.jpeg` here would 404 every
   * plate the new illustrator painted.
   */
  image: { sha256: string; ext: string } | null,
): { url: string | null; error: string | null } {
  /**
   * **The URL carries the request it belongs to**, and that is finding 4 of the
   * 2026-09-03 review rather than defensiveness.
   *
   * `setUrl(null)` happens in an *effect*, so the render that switches from
   * plate A to plate B still returns A's object URL — and commits it beside B's
   * title and B's dimensions — until the effect clears it. Whether that frame
   * visibly paints depends on timing; the wrong DOM state is not in doubt. With
   * the key beside it the mismatch is simply unreadable: `url` is exposed only
   * when its `key` is the plate being asked for now.
   */
  const sha256 = image?.sha256 ?? null;
  const ext = image?.ext ?? null;
  const key = image === null ? "" : `${slug}\u0000${image.sha256}\u0000${image.ext}`;
  const [got, setGot] = useState<{ key: string; url: string } | null>(null);
  const [failure, setFailure] = useState<{ key: string; why: string } | null>(null);
  const url = got?.key === key ? got.url : null;
  const error = failure?.key === key ? failure.why : null;

  useEffect(() => {
    /* Cleared here as well as guarded above, so that what is *held* is only ever
       the current plate's — the guard covers the one render between the switch
       and this effect, and this covers everything after it. Without the clear,
       switching to a second plate and back before the second lands would find
       the first plate's URL still in state and already revoked below: a broken
       image, from a control that had worked a second earlier. */
    setGot(null);
    setFailure(null);
    if (!sha256) return;
    /* The reader may move to another plate, or leave the mode, while the bytes
       are in flight. `live` is what stops a `setState` on a gone component and,
       more importantly, stops an orphaned object URL being made with nobody
       left to revoke it. */
    let live = true;
    /* **The key this request answers, captured from the one above rather than
       spelled a second time.** Written twice it was written differently — one
       had a separator in it and the other did not — so no answer ever matched
       its own request and the plate never appeared. Two spellings of one
       identity is the whole bug, and one `const` is the whole fix. */
    const mine = key;
    void apiFetch(`/api/illustrated/${encodeURIComponent(slug)}/${sha256}.${ext}`)
      .then(async (res) => {
        /* `res.ok` before `blob()`: an error body is perfectly good bytes, and
           without this the reader gets a broken image rather than the sentence
           saying what went wrong. */
        if (!res.ok) throw new Error(`This plate did not load (${res.status}).`);
        const made = URL.createObjectURL(await res.blob());
        if (live) setGot({ key: mine, url: made });
        else URL.revokeObjectURL(made);
      })
      .catch((e: Error) => {
        if (live) setFailure({ key: mine, why: e.message });
      });
    return () => {
      live = false;
    };
    /* `key` is derived from the other two and changes exactly with them, so it
       re-triggers nothing; it is listed because it is read, which is the rule
       worth keeping rather than arguing with. */
  }, [slug, sha256, ext, key]);

  /* The URL's whole lifetime and nothing else's: revoked when it is replaced
     and when this component goes. **Keyed on the record rather than on the
     derived `url`**, because the derived one goes null for a render whenever the
     plate changes, and revoking on that would destroy a URL that is still the
     current answer for the plate the reader is on. */
  const held = got?.url;
  useEffect(() => {
    if (!held) return;
    return () => URL.revokeObjectURL(held);
  }, [held]);

  return { url, error };
}

/**
 * The picture itself, in whichever of its four states it is in.
 *
 * **A failed plate is a state, not a gap.** A run keeps the plates it managed
 * to draw and records why the others have no picture (src/pipeline.ts
 * § illustrated), so the artefact can legitimately list a plate with a sentence
 * and no bytes. Saying so in place is the difference between "this one did not
 * get painted" and a panel that looks broken.
 *
 * **And a plate with neither is a fourth state, which had to be found by
 * reading the parser rather than by looking at the panel.** `IllustratedPlate`
 * is a union of *undrawn*, drawn and failed, and `withStoredOutcome`
 * (src/illustrated-plate.ts) returns the undrawn arm for a stored plate whose
 * `image` record does not parse — with a fault beside it. Written as "no
 * picture yet, keep waiting", this component spun a spinner for ever on it: no
 * request in flight, nothing coming, no error, the exact
 * docs/reusable/silent-success.md shape. It gets its own sentence, and the
 * spinner is now reachable only while a fetch really is out.
 */
function Plate({
  slug,
  plate,
  onEnlarge,
}: {
  slug: string;
  plate: IllustratedPlate;
  /** In the band only: a press on the picture is Enlarge. `null` in the overlay. */
  onEnlarge: (() => void) | null;
}) {
  const { url, error } = usePlateBytes(slug, plate.image ?? null);

  if (plate.failed !== undefined) {
    return (
      <p className="ill-plate-out is-failed">
        <ImageOff size={14} aria-hidden="true" /> {plate.failed}
      </p>
    );
  }
  if (!plate.image) {
    return (
      <p className="ill-plate-out">
        <ImageOff size={14} aria-hidden="true" /> This plate has no picture stored against it. The
        words below are what it was to have drawn.
      </p>
    );
  }
  if (error) return <p className="ill-plate-out is-failed">{error}</p>;
  if (!url) {
    return (
      /* The dashed plate is there at once, so the page does not jump; the
         words join it only if the fetch is slow. BandWaiting.tsx. */
      <BandWaiting key={`${slug}\u0000${plate.image.sha256}\u0000${plate.image.ext}`} className="ill-plate-out">
        Fetching the picture…
      </BandWaiting>
    );
  }
  return (
    /* biome-ignore lint/a11y/useKeyWithClickEvents: a pointer shortcut for the Enlarge button beside the title, which is the keyboard's way in — enlargePress.ts. */
    <img
      className={`ill-plate${onEnlarge ? " enlarges" : ""}`}
      onClick={
        onEnlarge
          ? (e) => {
              if (pressEnlarges(e)) onEnlarge();
            }
          : undefined
      }
      src={url}
      /* The plate's own title, and the sentence that says what kind of thing
         this is — a screen reader gets no more from a painting than that, and
         claiming otherwise would be the same lie the label under it refuses. */
      alt={`An illustration of "${plate.title}". Some of the passages behind it are listed below.`}
      width={plate.image?.width}
      height={plate.image?.height}
    />
  );
}

interface Props {
  slug: string;
  blocks: readonly Block[];
  onJump(id: BlockId): void;
}

/**
 * **The reader's note on how the picture should come out** — the box under it,
 * with the shared microphone (docs/project/dictation.md § Adding it to a box).
 * Report spya-wxd4nq; plan 261002j.
 *
 * **Nothing here stores it.** The note rides on the job that paints
 * (`Job.illustrationNote`) and is recorded on the picture it produced, which
 * is where the box is filled from: open a noted picture and its note is in the
 * box, so *Paint again* untouched keeps the steer and clearing it paints plain.
 * Once the reader has typed, a picture arriving does not overwrite them.
 *
 * Lives in `IllustratedView` rather than in the box, because the box is drawn
 * in whichever of the band, the overlay and the empty state is showing, and
 * what the reader typed must not be lost moving between them.
 */
interface SteerNote {
  note: string;
  change(next: string): void;
  box: React.RefObject<HTMLTextAreaElement | null>;
  dictate: UseDictationField;
  /** Over the cap: refused by the server, so not sent. */
  tooLong: boolean;
  /**
   * **No paint while the microphone is involved, or with a note the server
   * would refuse** — `armed` and `readOnly` both, which is the guard
   * dictation.md says everybody forgets the second half of.
   */
  blocked: boolean;
}

function useSteerNote(slug: string, painted: string | undefined): SteerNote {
  const [note, setNote] = useState(painted ?? "");
  const touched = useRef(false);
  useEffect(() => {
    if (!touched.current) setNote(painted ?? "");
  }, [painted]);
  const change = useCallback((next: string) => {
    touched.current = true;
    setNote(next);
  }, []);
  const box = useRef<HTMLTextAreaElement | null>(null);
  const transcribe = useReaderTranscriber();
  const dictate = useDictationField({
    value: note,
    onChange: change,
    box,
    context: { kind: "article", slug },
    transcribe,
    keep: keepDictation(`illustrated:${slug}`),
  });
  const tooLong = note.trim().length > MAX_ILLUSTRATION_NOTE_CHARS;
  return {
    note,
    change,
    box,
    dictate,
    tooLong,
    blocked: tooLong || dictate.busy,
  };
}

function SteerBox({ steer }: { steer: SteerNote }) {
  const { dictate } = steer;
  return (
    <div className="ill-steer">
      <label className="ill-steer-label" htmlFor="ill-steer-note">
        How should it come out? <span className="ill-steer-optional">Optional</span>
      </label>
      <div className="ill-steer-row">
        <textarea
          id="ill-steer-note"
          ref={steer.box}
          className="ill-steer-input"
          rows={2}
          value={steer.note}
          readOnly={dictate.readOnly}
          onChange={(e) => steer.change(e.target.value)}
          placeholder="Say it or type it — fewer scenes and bigger lettering, a map rather than a manuscript…"
        />
        {dictate.dictation.supported && (
          <DictationButton dictation={dictate.dictation} toggle={dictate.toggle} />
        )}
      </div>
      <DictationStrip dictation={dictate.dictation} />
      {steer.tooLong ? (
        <p className="ill-steer-how ill-steer-long" role="alert">
          That is {steer.note.trim().length} characters; the note can be at most{" "}
          {MAX_ILLUSTRATION_NOTE_CHARS}.
        </p>
      ) : (
        <p className="ill-steer-how">
          Used for the next painting. It can change the style, what comes first and how crowded the
          page is; everything drawn still comes from the article.
        </p>
      )}
    </div>
  );
}

/** The note a picture was painted with, beside the brief it shaped — or nothing. */
function YourNote({ note }: { note: string | undefined }) {
  if (!note) return null;
  return (
    <p className="ill-your-note">
      Your note: <span className="voice-reader">{note}</span>
    </p>
  );
}

/**
 * **Paint again, beside a picture that is there** — with whatever is in the box.
 * Forced, because an unforced run would skip a current picture with the same
 * note while the reader watched a job change nothing.
 *
 * **Held from the press until the new painting has been read** (`rewriting`,
 * rewrite-hold.ts): the job leaving the list is not the painting arriving, and
 * a press in between is a second run of the dearest job there is.
 */
function PaintAgain({ view, steer }: { view: UseIllustrated; steer: SteerNote }) {
  const busy = view.job !== null || view.starting || view.rewriting;
  return (
    <div className="ill-run">
      {view.profileChanged && <p className="ill-empty-why">{SKETCH_THEN_PAINT_WORK}</p>}
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={steer.blocked || busy}
        onClick={() => void view.regenerate(steer.note)}
      >
        <Brush size={13} />
        {view.profileChanged ? "Draw the Sketch, then paint again" : "Paint again"}
      </Button>
    </div>
  );
}

export function IllustratedView({ slug, blocks, onJump }: Props) {
  const view = useIllustrated(slug, blocks);
  const { illustrated } = view;
  const steer = useSteerNote(slug, illustrated?.note);

  /** Which plate is open, by scene id. `null` is the first — the overview. */
  const [open, setOpen] = useState<string | null>(null);
  const [full, setFull] = useState(false);
  const dialog = useRef<HTMLDialogElement | null>(null);

  /* A new painting is a new set of scene ids, so a selection into the old one
     points at nothing. Reset rather than carry, exactly as SketchView does. */
  // biome-ignore lint/correctness/useExhaustiveDependencies: the identity of the artefact is what invalidates the open plate, not any field of it
  useEffect(() => {
    setOpen(null);
  }, [illustrated]);

  const plate = useMemo(() => {
    if (!illustrated) return null;
    return (open && illustrated.plates.find((p) => p.sceneId === open)) || illustrated.plates[0] || null;
  }, [illustrated, open]);

  /**
   * Whether *we* are the ones closing the overlay.
   *
   * `close()` fires the same `close` event Escape does, so without this our own
   * "shut it" comes straight back as a second close. Lightbox.tsx and
   * SketchView.tsx carry the same guard and the same reasoning.
   */
  const closingOurselves = useRef(false);

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (full && !d.open) {
      closingOurselves.current = false;
      d.showModal();
    } else if (!full && d.open) {
      closingOurselves.current = true;
      d.close();
    }
  }, [full]);

  /**
   * **Escape has to put `full` back.** The dialog closing without React hearing
   * about it is the worst state this component can be in: the overlay gone,
   * `full` still true, the band saying the picture is full screen while nothing
   * is. Two listeners rather than one — `cancel`, which Escape fires first, and
   * `close`, which follows — and attached by a **callback ref**, because this
   * component returns early for `loading`, `none` and `error`, so an effect with
   * empty deps would find no `<dialog>` on the first render and never run again.
   * SketchView.tsx § Escape has the longer version and what a browser pass could
   * and could not establish about it.
   */
  const onClosed = useCallback(() => {
    if (closingOurselves.current) return;
    setFull(false);
  }, []);

  const attachDialog = useCallback(
    (el: HTMLDialogElement | null) => {
      const was = dialog.current;
      if (was) {
        was.removeEventListener("close", onClosed);
        was.removeEventListener("cancel", onClosed);
      }
      dialog.current = el;
      if (el) {
        el.addEventListener("close", onClosed);
        el.addEventListener("cancel", onClosed);
      }
    },
    [onClosed],
  );

  if (view.status === "loading") {
    return (
      <BandWaiting as="div" className="ill-wait">
        Looking for a painting…
      </BandWaiting>
    );
  }

  if (view.status === "none" || view.status === "error") {
    /* **A failure over "none yet" keeps the empty state under it** — the
       server has said nobody painted one, and a read failing since does not
       unsay it (Greg, 2026-10-07; docs/project/mode.md § The artefact, if the
       mode shows one). Until then a failure here drew the sentence alone, in
       either status, so the paint button went with any failed read. A failed
       *opening* read (`error`) still draws the sentence alone: nothing was
       ever answered. */
    return (
      <div className="ill-empty">
        {view.error && (
          <ReadError
            error={view.error}
            onRetry={view.retryRead}
            className={view.status === "none" ? "tw:m-0 tw:mb-2" : "tw:m-0"}
          />
        )}
        {view.status === "none" && <Empty view={view} steer={steer} />}
      </div>
    );
  }

  if (!illustrated || !plate) return null;

  const notes: string[] = [];
  if (view.stale) {
    notes.push(
      "The Sketch this was painted from has moved since — either it was redrawn, or the article moved underneath it. The picture is of an earlier version of the argument.",
    );
  }
  const lost = view.faults.filter((f) => f.what.includes("not in this article")).length;
  if (lost > 0) {
    notes.push(`${lost} of the passages it drew from are no longer in this article, so their rows are gone.`);
  }
  if (view.profileChanged) notes.push("It was painted from a Sketch drawn before your profile said what it says now.");

  /**
   * **One body, rendered in whichever container is open** — not two instances,
   * for SketchView's reason: which plate is open is one piece of state, and a
   * second copy of the picture would keep a second copy of it, so closing the
   * overlay would put the reader back on the plate they started from rather
   * than the one they got to inside it.
   */
  const body = (
    <>
      <div className="ill-bar">
        {open !== null && illustrated.plates.length > 1 && (
          <button type="button" className="ill-up" onClick={() => setOpen(null)}>
            <ChevronLeft size={13} /> Back
          </button>
        )}
        {/* **A row of plates, not Sketch's row of scenes, and it is a sibling
            rather than a reuse.** They look alike and are not the same control:
            Sketch's row drives `goTo`, which measures a `ZoomAnchor` off the
            box that was pressed and hands a direction to a layout effect that
            animates one scene out of another. There is no anchor here and
            nothing to animate — a plate swap is a different picture arriving —
            so sharing the component would mean a `goTo` with two of its three
            arguments unused on this side, which is the braiding CLAUDE.md's
            *prefer simple over easy* is about. What is shared is the *pattern*:
            a `radiogroup` of `<button>`s, one tab stop each and no arrow
            handler, because on this page the arrows belong to the article
            (docs/project/keyboard.md) and an arrow press must never buy a job.
            tests/arrows-belong-to-the-article.test.tsx sweeps for one coming
            back. */}
        {illustrated.plates.length > 1 ? (
          <div className="ill-plates" role="radiogroup" aria-label="Which plate">
            <TooltipGroup delay={{ open: 300, close: 120 }} timeoutMs={400}>
              {illustrated.plates.map((p, i) => {
                const on = i === 0 ? open === null : open === p.sceneId;
                return (
                  <Tooltip
                    key={p.sceneId}
                    placement="bottom"
                    keepSide
                    className="tip-soon ill-plate-tip"
                    content={
                      <ControlTip
                        head={p.title}
                        what={
                          i === 0
                            ? "The whole argument as one painted page."
                            : "One part of the argument, painted on its own page."
                        }
                        how={
                          p.failed === undefined
                            ? "Painted in the same hand as the first plate — the overview goes back to the image model as a style reference, so the parts look like pages of one book rather than of several."
                            : "This one was not painted. The plate is listed so the gap is visible rather than silent."
                        }
                      />
                    }
                  >
                    {/* biome-ignore lint/a11y/useSemanticElements: see above */}
                    <button
                      type="button"
                      role="radio"
                      aria-checked={on}
                      tabIndex={0}
                      className={`ill-plate-chip${on ? " on" : ""}`}
                      data-ill-plate={p.sceneId}
                      onClick={() => setOpen(i === 0 ? null : p.sceneId)}
                    >
                      {p.title}
                    </button>
                  </Tooltip>
                );
              })}
            </TooltipGroup>
          </div>
        ) : (
          <span className="ill-title">{plate.title}</span>
        )}
        <Tooltip
          placement="bottom"
          keepSide
          className="tip-soon"
          content={
            <ControlTip
              head={full ? "Close" : "Enlarge"}
              what={
                full
                  ? "Put the painting back in the band beside the article."
                  : "The same plate, filling the window."
              }
              how="The plates are portrait, because up is the top of the article and down is the bottom. In a 288-pixel band that is a thumbnail; this is where one is actually looked at."
            />
          }
        >
          <button type="button" className="ill-zoom" onClick={() => setFull((v) => !v)}>
            {full ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
            {full ? "Close" : "Enlarge"}
          </button>
        </Tooltip>
      </div>

      {/* A repaint the reader did not start is still a repaint — SketchView
          § A redraw the reader did not start. Not `JobProgress`: that row
          carries a Draw button, and offering a $0.40 repaint beside a picture
          that is already there is a product decision this is not. */}
      {view.job && (
        <p className="ill-busy" role="status">
          <LoaderCircle className="cmt-spinner" size={12} aria-hidden="true" />
          {view.job.status === "queued"
            ? "Waiting for the queue…"
            : (view.job.steps.find((s) => s.name === "illustrated")?.label ?? "Painting…")}
        </p>
      )}
      {/* And the spinner going away is not the same as the work succeeding. The
          server's own words, per copy.md. */}
      {!view.job && view.failed && <p className="ill-failed">{view.failed.message}</p>}
      {/* A re-read that failed, beside the painting it could not replace —
          SketchView.tsx § OwnerSketch has the same line and the reason. */}
      {view.error && <ReadError error={view.error} onRetry={view.retryRead} />}
      {/* A repaint finished and its painting is not here yet — the read, never
          a second paid repaint. SketchView.tsx § `progress` has the same line,
          in the same words, for the same reason. */}
      {view.rewriting && !view.job && !view.starting && !view.failed && !view.error && (
        <RewriteWaiting line="The new picture hasn't loaded yet." onRead={view.refresh} />
      )}

      {notes.length > 0 && <p className="ill-note">{notes.join(" ")}</p>}

      <div className="ill-scroll">
        {/* **A press on the plate is Enlarge**, in the band — Greg, 2026-09-05
            (`spya-dfghb4`) and 2026-09-11 (`spya-mghbv7`). Nothing in the
            overlay, which is already enlarged. Plan 261001l. */}
        <Plate slug={slug} plate={plate} onEnlarge={full ? null : () => setFull(true)} />

        {/* **The label, and it is a line rather than a tooltip.** This is the
            one picture here nothing can check against what it claims to depict,
            and a reader who has to hover to find that out has not been told.
            docs/project/diagram.md § It is an interpretation. */}
        {/* **"the words below are" was an overclaim, and it was the wrong half
            of the row.** What is checked is each quote — that it is a contiguous
            run of the article's own words, and that it is in the block the row
            jumps to. What is *not* checked is what the row says is drawn:
            `depicts` is a model's prose, and the plan names "a genuine quote
            paired with an invented `depicts`" as an accepted failure of this
            mode. A label that overstates its own guarantee is worse than none.
            GPT Sol, 2026-09-03. */}
        <p className="ill-says">
          An illustration of the argument, not a diagram of it. A model painted this from the Sketch
          and nothing in the picture is checked. Below, the quoted passages are the article's own
          words and each one leads where it says — what the picture makes of them is the model's.
        </p>

        {/* **The clickable layer.** One row per surviving vignette; each jumps
            the article to the block the quote was checked against. */}
        {plate.vignettes.length > 0 ? (
          <>
            <h3 className="ill-list-head">What it depicts</h3>
            <ul className="ill-list">
              {/* **Keyed on the same triple the parser de-duplicates on** —
                  block, quote and `depicts` (src/illustrated-plate.ts
                  § readVignettes). Keyed on any subset, two vignettes drawing
                  different things from one sentence would be two rows sharing
                  one React key, which is a rendering bug that only appears on
                  an artefact nobody has yet. */}
              {plate.vignettes.map((v) => (
                <li key={`${v.block}\u0000${v.quote}\u0000${v.depicts}`}>
                  {/* **Close the overlay first, and always, not only when it is
                      open.** The article is `inert` under a modal `<dialog>`, so
                      a jump made from full screen scrolls a page nobody can see
                      and the press reads as doing nothing at all — the picture
                      does not move, and neither does anything else. `Lightbox`
                      closes before following a link for exactly this reason.
                      Unconditional because a guard here would be a second place
                      that has to know whether the overlay is open. GPT Sol,
                      2026-09-03. */}
                  <button
                    type="button"
                    className="ill-row"
                    onClick={() => {
                      setFull(false);
                      onJump(v.block);
                    }}
                  >
                    {/* **The caption that is lettered in the picture**, when
                        the plate was drawn with lettering at all — so a reader
                        who has just read a title off a vignette can find the row
                        it belongs to. It is not the claim: the quote below is.
                        Absent on a wordless plate, which is every plate drawn
                        before 2026-09-04 and any whose vignettes were not all
                        captioned (src/illustrated.ts § `plateLettering`). */}
                    {v.title === undefined ? null : (
                      <span className="ill-caption">{v.title}</span>
                    )}
                    <span className="ill-depicts">{v.depicts}</span>
                    {/* Not clamped. This is how the reader reads the picture
                        back against the piece, so a quote cut to an ellipsis
                        would take away the whole point of the row. */}
                    <q className="ill-quote">
                      {/* The article's own words, drawn from the block's markup (Excerpt.tsx, plan 261009k). */}
                      <Excerpt blockId={v.block} words={v.quote} />
                    </q>
                  </button>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="ill-none">
            None of this plate's passages are still in the article, so there is nothing here to jump
            to. The picture is what was painted from them.
          </p>
        )}

        {/* **The brief, reachable rather than in the way.** A prompt can be read
            against the article where a picture cannot, so it has to be here; it
            is 200–500 words, so it is not open by default in a 288px band.

            **The register the model chose is in here too, and it started out
            under the label.** It is a good sentence — *"vellum, gold leaf and
            marginalia are the article's own idiom, not an imported one"* — and
            it is four lines of italic prose in the band, which at 1280 was
            enough on its own to push the *what it depicts* list off the bottom
            of the screen. It belongs with the prompt in any case: both are what
            the illustrator was asked for, and neither is the safety label that
            has to be read without a press. */}
        <details className="ill-brief">
          <summary>What the illustrator was asked for</summary>
          <YourNote note={illustrated.note} />
          {illustrated.style && <p className="ill-style">{illustrated.style}</p>}
          <p className="ill-prompt">{plate.prompt}</p>
        </details>

        {/* **The box, and a Paint again beside a picture that is there.** The
            reader asked for exactly this (spya-wxd4nq): a way to say how it
            should come out and have it painted again. Forced, because an
            unforced run would skip a current picture with the same note. */}
        <SteerBox steer={steer} />
        <PaintAgain view={view} steer={steer} />
      </div>
    </>
  );

  return (
    <div className={`ill${full ? " away" : ""}`}>
      {full ? (
        <p className="ill-elsewhere">
          The painting is full screen.{" "}
          <button type="button" className="ill-back" onClick={() => setFull(false)}>
            Bring it back
          </button>
        </p>
      ) : (
        body
      )}

      {/* biome-ignore lint/a11y/useKeyWithClickEvents: the click handled here is the backdrop, whose keyboard equivalent is Escape — which `<dialog>` implements itself. Lightbox.tsx makes the same call and carries the reasoning. */}
      <dialog
        ref={attachDialog}
        className="ill-full"
        aria-label={`${plate.title}, full screen`}
        /* **The second click of the double-click that opened it is nobody's
           press**, wherever it lands — the backdrop, Close, a row that jumps.
           Swallowed before any of them hears it. enlargePress.ts
           § laterClickOfMany. */
        onClickCapture={(e) => {
          if (laterClickOfMany(e)) {
            e.preventDefault();
            e.stopPropagation();
          }
        }}
        onClick={(e) => {
          if (e.target === dialog.current) setFull(false);
        }}
      >
        {/* Mounted only while open, so the state lives in exactly one place and
            the overlay cannot hold a stale copy of it. */}
        {full && <div className="ill ill-in-full">{body}</div>}

        {/* **The brief, beside the picture rather than under it.** Greg,
            2026-09-05: *"if I have clicked Enlarge, show the prompt text in a
            column to one side so I can scroll up down independently through
            that text while looking at the image it refers to."* Which is the
            one thing the `<details>` inside the band cannot do: it is *below*
            the plate in a single scrolling column, so reading the prompt
            against the picture means scrolling the picture off the screen.

            A sibling of `.ill-in-full`, not a child, and that is what keeps the
            change small. The dialog is already a centred flex row, so a second
            column needs no new container and no change to `body` — the plate
            column keeps its own `.ill-scroll`, this one has its own, and the
            two scroll independently because they always were two boxes.

            **Only one copy of the prompt is on screen at any width.** Below the
            breakpoint there is no room for a column, so the CSS hides this and
            the band's `<details>` stays; above it, this shows and that one is
            hidden. Stacking was the alternative and is worse: `.ill-in-full` is
            `height: 100dvh`, so a column stacked under it starts one whole
            screen down, which is the scrolling this report is about. */}
        {full && (
          <aside className="ill-aside">
            <h2 className="ill-aside-head" id="ill-aside-head">
              What the illustrator was asked for
            </h2>
            {/* Focusable because it scrolls: a keyboard reader cannot reach the
                bottom of 350 words in a region nothing can put the caret in,
                and there is no button inside it to tab to. No key handler —
                the arrows belong to the article
                (tests/arrows-belong-to-the-article.test.tsx), and this only
                takes the ones the browser already spends on a scroll box. */}
            {/* biome-ignore lint/a11y/noNoninteractiveTabindex: a scroll box with no control inside it is unreachable from the keyboard without one, and 350 words of brief is exactly that. The rule is aimed at tab stops that lead nowhere; this one leads to the only way to read the text. A labelled <section> rather than a div, so it is a named landmark when focus lands. */}
            <section className="ill-aside-scroll" tabIndex={0} aria-labelledby="ill-aside-head">
              <YourNote note={illustrated.note} />
              {illustrated.style && <p className="ill-style">{illustrated.style}</p>}
              <p className="ill-aside-prompt">{plate.prompt}</p>
            </section>
          </aside>
        )}
      </dialog>
    </div>
  );
}

/**
 * **What stands where the painting will be, and the four different things it
 * has to say.**
 *
 * Three of them are states the `illustrated` step on its own would refuse:
 * it is the only step whose input is another step's artefact, and it will not
 * paint from a Sketch that is absent, stale, or drawn for a profile the reader
 * has since changed. Each of those three says which one it is, points at the
 * Sketch chip, **and offers to do both** — one job naming `["sketch",
 * "illustrated"]`, which the server orders for us.
 *
 * **That chain was refused until 2026-09-03**, and this docstring said so:
 * *"not `enqueue(["sketch", "illustrated"])`, which turns one press into a
 * hidden $0.20 charge and a three-minute wait that nothing warned about"*.
 * Greg asked for the chain the day after. The old sentence is kept here rather
 * than deleted because it is still right about the danger and still constrains
 * the code: **the objection was to the hiding, not to the chain**, so what the
 * reversal costs is a sentence naming both steps and both waits in front of
 * the press — `SKETCH_THEN_PAINT`, built from the two panels' own
 * constants so the combined copy cannot drift from the single-step copy.
 * The other route is untouched: a reader who would rather look at the Sketch
 * before spending anything on a painting presses the chip one to the left, and
 * is not doing anything wrong.
 *
 * The fourth is the ordinary one: there is a Sketch, nobody has painted it, and
 * **what it does and how long it takes go in front of the press** — a brief,
 * then the plates, and `ILLUSTRATED_WAIT`. It is the slowest and dearest
 * button in this app (evals/results/illustrated-2026-09-03/README.md), so it is
 * stated rather than implied; the dollar figure is the administrator's alone.
 *
 * **A run in flight outranks all four**, and that ordering is a fix rather than
 * a preference: the refusal branches carry no `JobProgress`, so a job started in
 * another tab, or one this tab started before the Sketch answer arrived, was
 * drawn as *"it cannot be painted from here"* with no spinner, no Stop, and no
 * sign that a four-to-seven-minute paid job was under way. GPT Sol, 2026-09-03.
 */
function Empty({ view, steer }: { view: UseIllustrated; steer: SteerNote }) {
  const { sketch } = view;

  /* **Before every other branch.** `JobProgress` draws the spinner, the step's
     own label and Stop when there is a job, so this is the whole of what a
     reader needs while one runs — and the four sentences below are all about a
     press that has not happened. */
  if (view.job !== null || view.starting) {
    return (
      <div className="ill-run">
        <JobProgress
          job={view.job}
          starting={view.starting}
          failed={view.failed}
          stalled={view.stalled}
          onRun={() => view.ensure()}
          onCancel={view.cancel}
          label="Paint the argument"
          step="illustrated"
          icon={<Brush size={13} />}
          runningLabel="Painting…"
        />
      </div>
    );
  }

  if (sketch.kind === "checking") {
    return (
      <>
        <p>Nobody has painted this one yet.</p>
        <BandWaiting>Looking for the Sketch…</BandWaiting>
      </>
    );
  }

  if (sketch.kind !== "ready" && sketch.kind !== "unknown") {
    const why = {
      absent: "There is no Sketch of this article yet, and the painting is made from the Sketch rather than from the article.",
      stale: "The Sketch of this article is out of date — the article has moved underneath it — so a painting made from it would be out of date the moment it landed.",
      "profile-changed": "The Sketch of this article was drawn before your profile said what it says now, and a painting inherits whose it was.",
    }[sketch.kind];
    return (
      <>
        {/* **"no *usable* Sketch", and the adjective is the whole of it.** This
            said *"there is no Sketch to paint from"* until 2026-09-03, which is
            true of `absent` and false of the other two — where a Sketch
            demonstrably exists and the very next sentence says so, out of date
            or drawn for a profile that has moved. A panel that denies a thing
            and then describes it is a panel arguing with itself, and the reader
            has no way to tell which half to believe. GPT Sol, 2026-09-03.

            One sentence for all three rather than three, because the branch is
            already spelled out underneath: `why` below says which of the three
            it is, in the reader's terms, and a headline that also branched would
            be the same fact twice with two places to get it wrong.
            tests/illustrated-view.test.tsx § *does not deny the Sketch it then
            describes*, which pins this sentence and rejects the class it belongs
            to. */}
        <p>Nobody has painted this one yet, and there is no usable Sketch to paint from.</p>
        <p className="ill-empty-why" data-ill-refusal={sketch.kind}>
          {why} Press <strong>Sketch</strong>, the chip one to the left, and draw{" "}
          {sketch.kind === "absent" ? "one" : "it again"} first — or do both from here:
        </p>
        {/* **Both steps, and both waits, before the press.** This is the whole of
            what the old refusal was protecting, and it is the reason the chain
            is allowed now: the objection was never to `["sketch",
            "illustrated"]`, it was to a reader buying the Sketch without being
            told. See `SKETCH_THEN_PAINT`. */}
        <p className="ill-empty-why" data-ill-both-cost="">
          {SKETCH_THEN_PAINT}
        </p>
        <SteerBox steer={steer} />
        <div className="ill-run">
          {/* **`drawThenPaint`, and unforced.** The Sketch half runs only if
              `stepIsDone` says it is not current — which for all three of these
              kinds it does, because the panel's `stale` and `profileChanged`
              are read off the same two artefact fields the step stamps against.
              tests/illustrated-step-registration.test.ts § one press.

              `step="illustrated"` rather than `"sketch"`: this band is about
              the thing the reader asked for, and `JobProgress` names whichever
              step is *running* off the record anyway — so while the Sketch half
              runs the band says "Drawing the argument" without this having to
              know. */}
          <JobProgress
            job={view.job}
            starting={view.starting}
            failed={view.failed}
            stalled={view.stalled}
            onRun={() => view.drawThenPaint(steer.note)}
            runDisabled={steer.blocked}
            onCancel={view.cancel}
            label="Draw the Sketch, then paint"
            step="illustrated"
            icon={<Brush size={13} />}
            runningLabel="Painting…"
          />
        </div>
        {/* **The server's own sentence used to be printed here, and now it is
            not — because `JobProgress` prints it.** The Sketch can go stale
            between the reader pressing and the step reading it, so this branch
            really can be reached with a refusal already in hand, and swallowing
            it would leave a failure looking like a button that did nothing.
            That reasoning is unchanged; what changed is who says it. This
            branch is only ever reached with no job and nothing starting — the
            first branch of `Empty` takes every other case — so the row above is
            always in its no-job state, which is the state that renders
            `failed.message`. A second copy here would be the same sentence
            twice, and it would also lose the Retry that comes with it. */}
      </>
    );
  }

  return (
    <>
      <p>Nobody has painted this one yet.</p>
      {/* **What it does and how long it takes, before the press rather than after it** — the same
          rule the chips' hover cards follow, and it matters more here than
          anywhere else in the app, because this is the dearest and slowest
          button in it. */}
      <p className="ill-empty-why">
        A model reads the article and the Sketch and writes an illustration brief, then an image
        model paints it — one plate for the whole argument and one for each part. It takes{" "}
        {ILLUSTRATED_WAIT}, so it is never painted until you ask.
      </p>
      <p className="ill-empty-why">
        It is an interpretation and cannot be checked. Sketch, one chip to the left, stays the
        diagram of record.
      </p>
      <SteerBox steer={steer} />
      <div className="ill-run">
        {/* **`ensure`, not `regenerate`.** There is no picture — that is what
            this state means — so the freshness check will agree, and it has to
            be the identical request the automatic run makes: a forced press
            landing inside the auto-start window is a different `work_key`, is
            not de-duplicated, and buys a second job at this price. (A note
            makes it a different key anyway, deliberately: it is a different
            request.) */}
        <JobProgress
          job={view.job}
          starting={view.starting}
          failed={view.failed}
          stalled={view.stalled}
          onRun={() => view.ensure(steer.note)}
          runDisabled={steer.blocked}
          onCancel={view.cancel}
          label="Paint the argument"
          step="illustrated"
          icon={<Brush size={13} />}
          runningLabel="Painting…"
        />
      </div>
    </>
  );
}
