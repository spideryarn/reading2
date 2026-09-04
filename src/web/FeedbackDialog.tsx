/**
 * "Tell us" — one box, a toggle, a microphone, a tick-box, and somewhere for it
 * to go.
 *
 * Greg, 2026-08-31, asking for this:
 *
 * > I want to add a `Feedback` button somewhere, perhaps top-right. It should
 * > pop up a dialog box, with a request from the user to describe "Steps to
 * > reproduce", "What you expected to see", and "What you saw instead". It
 * > should always send the user-email. It should give them the option
 * > (default-false) to send extra diagnostics.
 *
 * It had exactly that, in three boxes, and on 2026-09-02 he asked for the
 * opposite:
 *
 * > It has three input boxes. I worry that will be intimidating/off-putting to
 * > users, so let's combine them into one, with combined instructions (and
 * > perhaps a tooltip with extra guidance/reassurance). And add some kind of
 * > indication of our appreciation for them making the effort to provide
 * > feedback at the top of the dialog box.
 * >
 * > Maybe also add toggle for "Bug/problem" vs "Suggestion".
 *
 * On 2026-09-03 he asked for the *questions* back, without the boxes:
 *
 * > The Feedback / Problem dialog box wording should explicitly ask users for:
 * > Steps to reproduce; What you expected to see; and What you saw instead.
 *
 * So they are above the single box, always visible. They had been moved into the
 * "Not sure what to write?" disclosure, and a hint nobody opens is a hint nobody
 * reads.
 *
 * On 2026-09-04 he asked for them to change with the toggle — three lines when
 * the reader has said this is a problem, one sentence otherwise — and for the
 * disclosure to go, since nobody would click it. `KindHint` below is that, with
 * his words on it.
 *
 * Three boxes is a form. A form is what you fill in once you have *decided* to
 * file a bug — and the reader this whole feature exists for is the one who was
 * merely annoyed and would otherwise close the tab.
 * docs/plans/260902m-one-feedback-box-with-a-kind-toggle-and-dictation.md.
 *
 * The original design, and the arguments behind each decision, are in
 * docs/plans/260831aj-feedback-button-and-bug-reports-to-sentry.md. This file is
 * the reader-facing half; `POST /api/feedback` in src/routes.ts is the other,
 * and the row it writes is the authoritative copy of the report.
 *
 * ## What the toggle starts as
 *
 * Nothing. Greg: *"don't default to Problem. Default to null/unknown."* So the
 * two are `aria-pressed` buttons rather than radios — pressing the pressed one
 * puts it back to unset, which a native radio group cannot do, and there is
 * nothing to explain about a third "not sure" option that does not exist.
 *
 * ## The microphone, and the two ways it can lose what was said
 *
 * `useDictationField`, the same three lines every other box uses
 * (docs/project/dictation.md). Two guards are specific to *this* box, and both
 * were GPT Sol's, 2026-09-02:
 *
 * - **Send is refused while the microphone is on.** `dictate.readOnly` is only
 *   the two seconds *after* stop, so a guard on it alone would let ⌘+Enter file
 *   the rough half-transcribed words while the reader was still talking.
 *   `armed` is the other half.
 * - **Closing the dialog stops the microphone.** This component is mounted for
 *   the life of the page — FeedbackButton renders it whether or not it is open
 *   — so Escape does not unmount anything, and without the effect below the
 *   recorder would go on running behind a closed dialog with the browser's
 *   recording indicator lit.
 *
 * ## It is a native `<dialog>`, following Lightbox.tsx
 *
 * The three hand-rolled `<aside role="dialog">` panels in this app —
 * CommentDialog, ChatDialog, AnnotateDialog — are non-modal *on purpose*: you
 * are meant to keep reading behind them. Filing a bug report is the opposite.
 * It interrupts, so `showModal()` is right, and it brings four things the others
 * each hand-roll: an inert background, focus trapped and then restored to the
 * button that opened it, top-layer painting that joins no z-index budget, and
 * Escape.
 *
 * **AnnotateDialog would have been the wrong precedent for a second reason**, and
 * it is the one that would have hurt: its first Escape *clears the box*. Here
 * there is a populated box to lose, and a reader who has just typed out what
 * went wrong is the last person in the app who should be able to lose it to one
 * keystroke. GPT Sol's review of the plan, 2026-08-31.
 *
 * ## The report id is minted when the dialog opens, not when Send is pressed
 *
 * That is what makes the server's idempotency real rather than decorative. A
 * failed submit that the reader retries carries **the same id**, so
 * `pg-feedback.ts` answers `duplicate` and the reader gets one report rather
 * than four — and only a newly created row is mirrored to Sentry, so a retry
 * cannot file the same bug twice there either. Mint it per opening and the
 * property holds; mint it per click and there is no idempotency at all.
 */
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { Bug, Check, Copy, Lightbulb, LoaderCircle, Mail, X } from "lucide-react";

import { ADMIN_EMAIL } from "../admin.js";
import { mintId } from "../ids.js";
import { FEEDBACK_NOT_AVAILABLE, FEEDBACK_SEND_FAILED } from "../messages.js";
import {
  MAX_FEEDBACK_ANSWER_CHARS,
  type FeedbackKind,
} from "../types.js";
import type { FeedbackDiagnosticsV1 } from "../feedback-payload.js";
import { DictationButton, DictationStrip } from "./DictationStrip.js";
import { collectFeedbackDiagnostics } from "./feedback-diagnostics.js";
import { imageFileFromDrop, imageFileFromPaste, screenshotFromFile } from "./feedback-screenshot.js";
import { apiFetch, failure } from "./lib/api.js";
import { useDictationField } from "./useDictationField.js";

declare const __SPIDERYARN_BUILD_COMMIT__: string;

/** Where the reader is: the address bar, and the article if there is one. */
export interface FeedbackWhere {
  /** `location.href`. See FeedbackButton.tsx for why it is the whole thing. */
  url: string;
  slug: string | null;
}

interface Props {
  open: boolean;
  onClose(): void;
  /**
   * The address the report is filed under, shown to the reader rather than
   * merely sent.
   *
   * Greg asked that the email always go, and the server takes it from the auth
   * gate rather than from this body — a browser-supplied address would be a
   * claim, and the point of the column is that it is not. So this prop is for
   * *saying so*: "sent as you@example.com" is the difference between a form
   * that quietly identifies you and one that tells you it does.
   */
  readerEmail: string | null;
  where: FeedbackWhere;
}

type Stage =
  | { kind: "editing" }
  | { kind: "sending" }
  | { kind: "sent" }
  | { kind: "failed"; message: string };

interface Shot {
  base64: string;
  width: number;
  height: number;
  bytes: number;
}

/** What the reader would paste into an email if the send never works. */
function asPlainText(body: string, kind: FeedbackKind | null, where: FeedbackWhere): string {
  return [
    /* The kind goes in too. Without it, the one copy of the report that survives
       a failed send is the one that has lost whether the reader called it a
       problem or a suggestion. GPT Sol, 2026-09-02. */
    `Kind: ${kind === null ? "not specified" : KIND_LABEL[kind]}`,
    body,
    `Page: ${where.url}${where.slug ? ` / ${where.slug}` : ""}`,
    `Build: ${buildCommit() ?? "unknown"}`,
  ].join("\n\n");
}

/** What each kind is called, in one place — the buttons and the copied text. */
const KIND_LABEL: Record<FeedbackKind, string> = {
  problem: "A problem",
  suggestion: "A suggestion",
};

/**
 * **The guidance under the label, and it follows the toggle.**
 *
 * Greg, 2026-09-04, having filed a report from this very dialog:
 *
 * > I think if the user clicks on a problem, then we want to show that guidance
 * > for bug tracking about steps to reproduce and what happened and what do they
 * > expect to happen — we want to show that text explicitly and quite
 * > prominently, because that will help hint to them what would make for a
 * > better bug report. And then we can get rid of not sure what to write because
 * > no one will click that.
 *
 * So the three asks are **a list when the reader has said this is a problem**,
 * and one sentence otherwise. This is the third arrangement of the same words
 * and the direction has been consistent throughout: 2026-09-02 hid them in a
 * "Not sure what to write?" disclosure, 2026-09-03 brought them out as one
 * always-visible sentence, and this makes them prominent exactly when they
 * apply. A hint nobody opens is a hint nobody reads; a hint that is the same
 * whatever you picked is a hint nobody uses.
 *
 * **The unset wording is unchanged**, deliberately: a reader who has not touched
 * the toggle is the one Greg's 2026-09-03 instruction was about — the dialog
 * must ask for the three things without anybody clicking anything, and
 * tests/feedback-dialog.test.tsx pins that.
 *
 * The disclosure it replaced said two more things, and the one worth keeping is
 * the reassurance rather than the list — a reader who has been handed three
 * questions is the reader most likely to decide their answer is not good enough
 * to send. It rides along as the last line.
 *
 * Phrasing content only, `<span>`s rather than a `<ul>`, because this sits
 * inside the `<label>` that wraps the box and a list is not allowed there.
 */
function KindHint({ kind }: { kind: FeedbackKind | null }) {
  if (kind === "problem") {
    return (
      <span className="fb-hint fb-asks">
        <span className="fb-ask">The steps to reproduce it — what you did, in order.</span>
        <span className="fb-ask">What you expected to see.</span>
        <span className="fb-ask">What you saw instead.</span>
        <span className="fb-ask-note">
          Any of the three is better than none, and nobody is going to judge the writing.
        </span>
      </span>
    );
  }
  if (kind === "suggestion") {
    return (
      <span className="fb-hint">
        What you'd like, and what it would let you do. A rough sketch is plenty.
      </span>
    );
  }
  return (
    <span className="fb-hint">
      If something went wrong: the steps to reproduce it, what you expected to
      see, and what you saw instead.
    </span>
  );
}

/**
 * **The request body, built field by field.**
 *
 * The same rule `src/routes.ts` keeps at the other end of the wire and
 * `safeEvent` keeps one file over: *build the payload, do not clean it*. There
 * is no spread here and no object from anywhere else passed through, so the only
 * way a field reaches the server is by being written on one of these lines —
 * which is also why `FEEDBACK_FIELDS` on the server can refuse an unknown key
 * outright rather than ignoring it.
 */
function reportBody(input: {
  id: string;
  body: string;
  kind: FeedbackKind | null;
  consented: boolean;
  where: FeedbackWhere;
  diagnostics: FeedbackDiagnosticsV1 | null;
  screenshot: string | null;
}) {
  return {
    id: input.id,
    body: input.body.trim(),
    kind: input.kind,
    consented: input.consented,
    url: input.where.url,
    slug: input.where.slug,
    buildCommit: buildCommit(),
    diagnostics: input.diagnostics,
    screenshot: input.screenshot,
  };
}

/** The stamp the release and the source maps went up under, if this is a build. */
function buildCommit(): string | null {
  return typeof __SPIDERYARN_BUILD_COMMIT__ === "string" ? __SPIDERYARN_BUILD_COMMIT__ : null;
}

export function FeedbackDialog({ open, onClose, readerEmail, where }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  /** The one box. `useDictationField` needs it to find the caret. */
  const box = useRef<HTMLTextAreaElement>(null);
  /* Lightbox.tsx § closingOurselves, and the same trap: `close()` fires the same
     `close` event Escape does, so without this our own "shut it" comes straight
     back as a second `onClose`. */
  const closingOurselves = useRef(false);

  const [body, setBody] = useState("");
  const [kind, setKind] = useState<FeedbackKind | null>(null);
  const [consented, setConsented] = useState(false);
  const [shot, setShot] = useState<Shot | null>(null);
  const [shotProblem, setShotProblem] = useState<string | null>(null);
  const [stage, setStage] = useState<Stage>({ kind: "editing" });
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  /** A pasted image is still being decoded and re-encoded. See `takeFile`. */
  const [preparing, setPreparing] = useState(false);

  /**
   * **The latch, and `disabled` is not a substitute for it.**
   *
   * `setStage({kind:"sending"})` schedules a render; two clicks inside one frame
   * both see `stage.kind === "editing"` and both post. A ref is written
   * synchronously, so the second click reads the first click's value. The same
   * call `useSearch.ts` and the upload path already make.
   */
  const sending = useRef(false);

  /**
   * **Which *attempt* this is**, as distinct from which report.
   *
   * The id deliberately survives a close and reopen, and reopening releases the
   * latch above — so two requests carrying one id can be in flight at once, and
   * they can settle in either order. `stillMine` checked only the id, so the
   * slower one still counted as current: a first send that fails *after* a retry
   * has succeeded would paint the failure panel over "Thank you", and the
   * reverse ordering would paint success over a failure. GPT Sol's code review,
   * 2026-09-02.
   *
   * A counter rather than a token because it is read the same way: only the
   * newest attempt may write to the screen.
   */
  const attempts = useRef(0);

  /**
   * **One id per *report*, and it outlives the dialog being shut.**
   *
   * This was `useMemo(() => open ? mintId() : null, [open])` until GPT Sol's
   * review on 2026-09-01, and that was wrong twice over.
   *
   * `useMemo` is not storage. React documents it as a performance hint that may
   * be discarded and recomputed, so an idempotency key kept there is a key that
   * may silently change — the one property it exists to have. `useState` with a
   * lazy initialiser is the durable form, and it is no more code.
   *
   * And keying it to `open` meant a reader who closed the dialog after a failed
   * send came back with a **new** id, so their retry filed a second report of
   * the same bug rather than being recognised as the same one. The id now
   * changes in exactly one place: after a report is successfully filed, when
   * `discard()` starts the next one.
   */
  const [reportId, setReportId] = useState<string>(() => mintId());
  /* The same value, readable from inside a promise that started before the last
     render. `send` closes over the id it began with; this is what it compares
     against to find out whether that report is still the one on screen. */
  const reportIdRef = useRef(reportId);
  reportIdRef.current = reportId;

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      closingOurselves.current = false;
      dialog.showModal();
    } else if (!open && dialog.open) {
      closingOurselves.current = true;
      dialog.close();
    }
  }, [open]);

  /**
   * **A send the reader walked away from is not still in progress.**
   *
   * Close the dialog mid-flight and the request keeps going, but `sending` — the
   * synchronous latch — was never released, because the only things that release
   * it are that request's own completions and those are now guarded on the id.
   * So on reopening, Send did nothing at all: the words were there, the button
   * looked live, and pressing it was silent. Found by the test written for the
   * *other* half of this finding, which is the good reason to write the awkward
   * test rather than the easy one.
   *
   * Abandoning the attempt is safe, and the id is what makes it safe. Press Send
   * again and the same id goes out; if the first request did land, the server
   * answers `duplicate` and the reader gets one report and a thank-you. That is
   * the property the durable id was for, doing a second job.
   *
   * Narrow on purpose: this touches the send state and nothing the reader typed.
   */
  useEffect(() => {
    if (!open) return;
    setStage((current) => (current.kind === "sending" ? { kind: "editing" } : current));
    sending.current = false;
  }, [open]);

  /**
   * **Start a new, empty report** — and this is the only thing that ever clears
   * the boxes.
   *
   * There used to be an effect here that reset the form every time `open` became
   * true, under a comment claiming the reader who closed it by accident was the
   * one person that would infuriate. It infuriated exactly them: a failed send,
   * an Escape, a reopen, and the only copy of what they had written was gone.
   * The comment described the intended behaviour and the code did the opposite,
   * which is the kind of thing a reviewer finds and an author reads past.
   *
   * So a draft survives being dismissed, and is cleared only here — after a
   * report is filed, on the reader's way out of the thank-you panel.
   */
  const discard = useCallback(() => {
    setBody("");
    setKind(null);
    setConsented(false);
    setShot(null);
    setShotProblem(null);
    setStage({ kind: "editing" });
    setCopied(false);
    setCopyFailed(false);
    setPreparing(false);
    sending.current = false;
    setReportId(mintId());
  }, []);

  /**
   * **The newest paste wins, whenever it happens to finish.**
   *
   * Decoding and re-encoding an image is asynchronous, so two pastes in quick
   * succession can finish in either order and the slower one would otherwise
   * overwrite the newer. A generation counter is the smallest thing that fixes
   * it: each call takes the next number, and a result whose number is no longer
   * current is dropped on the floor.
   */
  const shotGeneration = useRef(0);

  const takeFile = useCallback(async (file: File) => {
    const mine = ++shotGeneration.current;
    setShotProblem(null);
    setPreparing(true);
    const outcome = await screenshotFromFile(file);
    if (mine !== shotGeneration.current) return;
    setPreparing(false);
    if (!outcome.ok) {
      setShotProblem(
        outcome.problem === "not-an-image"
          ? "That does not look like a picture."
          : outcome.problem === "too-big"
            ? "That picture is too big, even after shrinking it."
            : "That picture could not be read.",
      );
      return;
    }
    setShot({
      base64: outcome.base64,
      width: outcome.width,
      height: outcome.height,
      bytes: outcome.bytes,
    });
  }, []);

  const somethingSaid = body.trim() !== "";
  /* Only once it matters. A character counter under a box a person is being
     encouraged to write freely in is a form asking to be filled in correctly. */
  const over = body.length > MAX_FEEDBACK_ANSWER_CHARS;

  /**
   * **The microphone, on the one box.** docs/project/dictation.md § Adding it to
   * a box — three lines, and the only decision a caller makes is `context`,
   * which says *where* rather than *what*.
   *
   * The two kinds that exist are the right two. On an article the server primes
   * the transcript with that article's glossary and proper nouns, which is
   * exactly the vocabulary of somebody describing what went wrong on the page in
   * front of them; anywhere else it primes with the app's own words and the
   * reader's own profile prose. A third `Where` kind for feedback would buy
   * nothing these two do not already give.
   */
  const dictate = useDictationField({
    value: body,
    onChange: setBody,
    box,
    context: where.slug === null ? { kind: "profile" } : { kind: "article", slug: where.slug },
  });

  /**
   * **Nothing may be sent while the microphone is involved**, and that is two
   * states rather than one.
   *
   * `readOnly` is `transcribing` alone — the two seconds *after* the reader
   * presses stop. A guard on that by itself leaves the case that actually
   * happens: press Cmd+Enter while still talking, and the report goes with
   * Chrome's rough live guesses in it, or with nothing at all on a browser that
   * has no live recogniser — and the microphone is still on over the thank-you
   * panel. `armed` is the other half. GPT Sol, 2026-09-02.
   */
  const dictationBusy = dictate.dictation.armed || dictate.readOnly;

  /**
   * **Shutting the dialog stops the microphone.**
   *
   * This component is mounted for the whole life of the page — FeedbackButton
   * renders it open or shut — so Escape, Cancel, the close button and the
   * backdrop all merely flip a prop, and `useDictation`'s cleanup, which runs on
   * *unmount*, never runs at all. Without this the recorder keeps going behind a
   * closed dialog with the browser's recording light on. GPT Sol, 2026-09-02.
   *
   * `dictation.toggle` and not `dictate.toggle`: the field wrapper deliberately
   * puts the focus back in the textarea, which is inside a dialog that has just
   * closed. Stopping rather than aborting, so the words already said are still
   * in the draft when the reader comes back to it.
   */
  useEffect(() => {
    if (!open && dictate.dictation.armed) dictate.dictation.toggle();
  }, [open, dictate.dictation.armed, dictate.dictation.toggle]);

  const send = useCallback(async () => {
    if (sending.current) return;
    if (!somethingSaid) return;
    /* **The counter above was a statement, not a rule**, until GPT Sol's code
       review on 2026-09-02: Send stayed enabled at 4,001 characters, so the
       reader was told the limit, allowed to press the button, and answered with
       a server-side `[fb-long]`. The keyboard path needs it too — `disabled` on
       the button does not stop ⌘+Enter. */
    if (over) return;
    /* The microphone is still on, or the good words are still on their way.
       Either way the draft is not what the reader means to send yet. */
    if (dictationBusy) return;
    /* **A screenshot still being re-encoded is not a screenshot to send.** Paste
       a large image and press ⌘+Enter in the same second and the POST would
       otherwise be built with `shot === null` — the report goes without the
       picture, and the thumbnail appears afterwards as if it had gone. Refusing
       is right rather than waiting: `preparing` also disables Send, so this is
       the keyboard path's copy of a rule the button already keeps. */
    if (preparing) return;
    sending.current = true;
    setStage({ kind: "sending" });

    /**
     * **Which report this send is for.**
     *
     * A request can outlive the draft that started it: the reader can close the
     * dialog mid-flight, and if they then file a different report, this
     * request's `setStage` would land in it — a stale success replacing a new
     * draft with "Thank you", whose Close button would then throw the new words
     * away. So every completion below is guarded on the id still being current.
     * GPT Sol, 2026-09-01, and it was the second half of the same finding as
     * the durable id above.
     */
    const mine = reportId;
    const attempt = ++attempts.current;
    const stillMine = () => mine === reportIdRef.current && attempt === attempts.current;

    /* Collected **at send time and only when consented**, so an unticked box
       never builds the blob at all. The server refuses diagnostics without
       consent (`[fb-consent]`) and so does the table's CHECK — this is the third
       of the three, and the only one that stops the collection happening. */
    const diagnostics = consented ? collectFeedbackDiagnostics() : null;

    try {
      const res = await apiFetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          reportBody({
            id: mine,
            body,
            kind,
            consented,
            where,
            diagnostics,
            screenshot: shot?.base64 ?? null,
          }),
        ),
      });
      if (!res.ok) {
        /* 501 is this deployment having no database rather than anything the
           reader did — src/store/index.ts. Everything else already carries a
           sentence written for a reader, with an `[fb-…]` code on the end. */
        const message =
          res.status === 501 ? FEEDBACK_NOT_AVAILABLE.message : (await failure(res)).message;
        if (!stillMine()) return;
        sending.current = false;
        setStage({ kind: "failed", message });
        return;
      }
      /* 200 and 201 are both success as far as the reader is concerned: the
         second means this exact report is already filed, which is what a retry
         after a lost response looks like, and telling them about it would be
         explaining our idempotency to somebody reporting a bug. */
      if (!stillMine()) return;
      setStage({ kind: "sent" });
    } catch {
      /* The network, or a request that never left. `failure()` needs a
         `Response` and there is not one — this is the correlated-failure case
         the plan names, and the sentence is written for it. */
      if (!stillMine()) return;
      sending.current = false;
      setStage({ kind: "failed", message: FEEDBACK_SEND_FAILED.message });
    }
  }, [reportId, somethingSaid, over, preparing, consented, body, kind, where, shot, dictationBusy]);

  const copy = useCallback(() => {
    const clipboard = navigator.clipboard;
    if (!clipboard) return setCopyFailed(true);
    void clipboard
      .writeText(asPlainText(body, kind, where))
      .then(() => {
        setCopied(true);
        setCopyFailed(false);
      })
      .catch(() => setCopyFailed(true));
  }, [body, kind, where]);

  return (
    /* The click handled below is the backdrop, whose keyboard equivalent is
       Escape — which <dialog> implements itself. Lightbox.tsx needs a
       `biome-ignore` for the same handler and this does not, because the
       ⌘/Ctrl+Enter listener further down already satisfies the rule. */
    <dialog
      ref={ref}
      className="fb-dialog"
      aria-label="Feedback"
      onClose={() => {
        if (closingOurselves.current) return;
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      onPaste={(e) => {
        const file = imageFileFromPaste(e.nativeEvent);
        if (file) {
          e.preventDefault();
          void takeFile(file);
        }
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        const file = imageFileFromDrop(e.nativeEvent);
        if (file) {
          e.preventDefault();
          void takeFile(file);
        }
      }}
      /* ⌘/Ctrl+Enter from anywhere in the form. The textareas need Enter for
         paragraphs, so the modifier is what separates "new line" from "send" —
         the same combination CommentDialog, AnnotateDialog, ProfileBox and
         QuizPanel already use, which is what makes it worth having here rather
         than a keystroke this one dialog invented. */
      onKeyDown={(e) => {
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          void send();
        }
      }}
    >
      {/* **One `<dialog>` element, two panels inside it**, and that is not a
          style choice. Returning a different `<dialog>` for the sent state
          unmounts the node the effect above called `showModal()` on and mounts
          a fresh one that nothing has opened — so the thank-you would be in the
          document and painted nowhere. */}
      {stage.kind === "sent" ? (
        <div className="fb-panel fb-done">
          <Check size={20} />
          <p>Thank you — that is filed.</p>
          {/* **The one place the boxes are emptied**, and it is on the far side
              of a filed report. `discard` also mints the next report's id — see
              its comment for why that is the only moment the id may change. */}
          <button
            type="button"
            className="fb-send"
            onClick={() => {
              discard();
              onClose();
            }}
          >
            Close
          </button>
        </div>
      ) : (
      <form
        className="fb-panel"
        method="dialog"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <div className="fb-head">
          <h2 className="fb-title">Feedback</h2>
          <button type="button" className="fb-close" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        {/* **The thanks goes first**, because it is the reason to keep reading
            rather than a sign-off. Greg asked for "some kind of indication of our
            appreciation for them making the effort", and it is true in a way
            that is worth a reader knowing: most of what goes wrong in this app
            never throws, so nothing tells us about it unless a person does. */}
        <p className="fb-thanks">
          Thank you — telling us is genuinely the most useful thing you can do
          with two minutes here.
        </p>

        <p className="fb-intro">
          A rough note is worth far more than nothing.
          {readerEmail ? (
            <>
              {" "}
              It is sent as <span className="fb-email">{readerEmail}</span>, so we can reply.
            </>
          ) : null}
        </p>

        {/* **Two buttons rather than radios**, so that pressing the pressed one
            puts it back to unset — Greg asked for the toggle to start on
            neither, and a native radio group cannot be un-picked. `aria-pressed`
            is what says so to a screen reader, and the `<legend>` is what stops
            two toggles standing there unnamed. */}
        <fieldset className="fb-kind">
          <legend className="fb-kind-legend">Is this…</legend>
          <KindButton
            kind="problem"
            chosen={kind}
            onChoose={setKind}
            icon={<Bug size={14} aria-hidden="true" />}
          />
          <KindButton
            kind="suggestion"
            chosen={kind}
            onChoose={setKind}
            icon={<Lightbulb size={14} aria-hidden="true" />}
          />
        </fieldset>

        <label className="fb-field">
          <span className="fb-label">What happened, or what would you like?</span>
          {/* **The three asks, said out loud, and louder once the reader has
              said this is a problem.** They used to be three boxes, then they
              were hidden behind "Not sure what to write?" — and a hint nobody
              opens is a hint nobody reads. See `KindHint` for the three
              wordings and whose instruction each one answers. */}
          <KindHint kind={kind} />
          <textarea
            ref={box}
            className="fb-input fb-body"
            rows={6}
            value={body}
            readOnly={dictate.readOnly}
            onChange={(e) => setBody(e.target.value)}
            placeholder="In your own words…"
          />
        </label>

        <div className="fb-under-box">
          {/* The microphone, for a reader who would rather say it than type it.
              Hidden entirely where the browser cannot open one, the way every
              other box in the app does it. */}
          {dictate.dictation.supported && (
            <DictationButton
              dictation={dictate.dictation}
              toggle={dictate.toggle}
              disabled={stage.kind === "sending"}
            />
          )}
          {/* **"Not sure what to write?" used to open here**, and it is gone —
              Greg, 2026-09-04: *"we can get rid of not sure what to write
              because no one will click that."* Its guidance is in `KindHint`
              now, on screen without a click. It was a disclosure rather than the
              tooltip Greg first suggested because this dialog is a modal
              `<dialog>` in the top layer and the house tooltip portals to
              `document.body`, underneath it — worth keeping written down, since
              the next person to want help text here will reach for a tooltip
              too. */}
        </div>
        <DictationStrip dictation={dictate.dictation} />

        {over ? (
          <span className="fb-over">
            {body.length} characters — the limit is {MAX_FEEDBACK_ANSWER_CHARS}.
          </span>
        ) : null}

        <div className="fb-shot">
          <span className="fb-shot-label">Screenshot (optional)</span>
          {shot ? (
            <div className="fb-shot-have">
              <img
                className="fb-shot-thumb"
                src={`data:image/png;base64,${shot.base64}`}
                alt="The screenshot you attached"
              />
              <span className="fb-shot-facts">
                {shot.width}×{shot.height}, {Math.round(shot.bytes / 1024)} KB
              </span>
              <button type="button" className="fb-shot-drop" onClick={() => setShot(null)}>
                Remove
              </button>
            </div>
          ) : (
            <label className="fb-shot-pick">
              {/* Three ways in, because the reader's screenshot is already on
                  their clipboard nine times out of ten and asking them to save
                  it to a file first would lose most of them. */}
              <span>Paste it here, drop it in, or</span>
              <input
                type="file"
                accept="image/*"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void takeFile(file);
                  e.target.value = "";
                }}
              />
            </label>
          )}
          {shotProblem ? <p className="fb-shot-problem">{shotProblem}</p> : null}
        </div>

        <label className="fb-consent">
          <input
            type="checkbox"
            checked={consented}
            onChange={(e) => setConsented(e.target.checked)}
          />
          <span>
            <strong>Send extra diagnostics.</strong> The last few requests this page made to us and
            how they went, the names of any errors, which article and passages you were looking at,
            and facts about your browser and screen size. <em>Never</em> the article's text, your
            notes, or anything you have typed into a search box.
          </span>
        </label>

        {stage.kind === "failed" ? (
          <div className="fb-failed" role="alert">
            <p>{stage.message}</p>
            {/* **Copy, and somewhere to put it.** The panel had only the Copy
                button until GPT Sol's review on 2026-09-01, while the sentence
                beside it said to send the report by email — so at the one moment
                the app holds the only copy of something a person wrote, it told
                them to email it and did not say to whom. The address is
                `ADMIN_EMAIL`, the same constant that decides who sees /admin, so
                there is one answer to "who runs this" rather than two.

                The subject carries the report id: if the row *did* land and only
                the reply was lost, the email and the row can still be matched
                up. */}
            <div className="fb-failed-outs">
              <button type="button" className="fb-copy" onClick={copy}>
                <Copy size={14} />
                {copied ? "Copied" : "Copy the report"}
              </button>
              <a
                className="fb-copy"
                href={`mailto:${ADMIN_EMAIL}?subject=${encodeURIComponent(
                  `Spideryarn feedback ${reportId}`,
                )}`}
              >
                <Mail size={14} />
                Email it to {ADMIN_EMAIL}
              </a>
            </div>
            {/* Clipboard access can be refused outright — a permissions policy,
                a non-secure context, a browser that wants a user gesture it did
                not see. Saying so matters more here than anywhere else, because
                a reader who believes they have copied their words and has not is
                one Escape away from losing them. */}
            {copyFailed ? (
              <p className="fb-shot-problem">
                Your browser would not let us reach the clipboard. Select the text
                in the box above and copy it by hand.
              </p>
            ) : null}
          </div>
        ) : null}

        <div className="fb-actions">
          <button type="button" className="fb-cancel" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className="fb-send"
            disabled={
              !somethingSaid || over || stage.kind === "sending" || preparing || dictationBusy
            }
          >
            {stage.kind === "sending" ? (
              <>
                <LoaderCircle className="cmt-spinner" size={14} />
                Sending
              </>
            ) : preparing ? (
              <>
                <LoaderCircle className="cmt-spinner" size={14} />
                Adding the picture
              </>
            ) : dictate.readOnly ? (
              <>
                <LoaderCircle className="cmt-spinner" size={14} />
                Writing that down
              </>
            ) : (
              "Send"
            )}
          </button>
        </div>
      </form>
      )}
    </dialog>
  );
}

/**
 * One half of the toggle, and **pressing it while it is pressed clears it**.
 *
 * That is the whole reason these are buttons rather than radios: Greg asked for
 * the toggle to start unset, and a reader who picks the wrong one should be able
 * to put it back rather than being stuck with a classification they did not
 * mean. A radio group has no such move.
 */
function KindButton({
  kind,
  chosen,
  onChoose,
  icon,
}: {
  kind: FeedbackKind;
  chosen: FeedbackKind | null;
  onChoose(next: FeedbackKind | null): void;
  icon: ReactNode;
}) {
  const pressed = chosen === kind;
  return (
    <button
      type="button"
      className="fb-kind-button"
      aria-pressed={pressed}
      onClick={() => onChoose(pressed ? null : kind)}
    >
      {icon}
      {KIND_LABEL[kind]}
    </button>
  );
}
