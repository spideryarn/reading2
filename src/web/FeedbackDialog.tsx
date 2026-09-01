/**
 * "Something went wrong" — three boxes, a tick-box, and somewhere for it to go.
 *
 * Greg, 2026-08-31, asking for this:
 *
 * > I want to add a `Feedback` button somewhere, perhaps top-right. It should
 * > pop up a dialog box, with a request from the user to describe "Steps to
 * > reproduce", "What you expected to see", and "What you saw instead". It
 * > should always send the user-email. It should give them the option
 * > (default-false) to send extra diagnostics.
 *
 * The whole design, and the arguments behind each decision, are in
 * docs/plans/260831aj-feedback-button-and-bug-reports-to-sentry.md. This file is
 * the reader-facing half; `POST /api/feedback` in src/routes.ts is the other,
 * and the row it writes is the authoritative copy of the report.
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
 * there are three populated boxes to lose, and a reader who has just typed out
 * what went wrong is the last person in the app who should be able to lose it to
 * one keystroke. GPT Sol's review of the plan, 2026-08-31.
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
import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Copy, LoaderCircle, Mail, X } from "lucide-react";

import { ADMIN_EMAIL } from "../admin.js";
import { mintId } from "../ids.js";
import { FEEDBACK_NOT_AVAILABLE, FEEDBACK_SEND_FAILED } from "../messages.js";
import { MAX_FEEDBACK_ANSWER_CHARS, type FeedbackRouteKind } from "../types.js";
import type { FeedbackDiagnosticsV1 } from "../feedback-payload.js";
import { collectFeedbackDiagnostics } from "./feedback-diagnostics.js";
import { imageFileFromDrop, imageFileFromPaste, screenshotFromFile } from "./feedback-screenshot.js";
import { apiFetch, failure } from "./lib/api.js";

declare const __SPIDERYARN_BUILD_COMMIT__: string;

/** Where the reader is, in the closed vocabulary the server and the table share. */
export interface FeedbackWhere {
  routeKind: FeedbackRouteKind;
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
function asPlainText(
  answers: { steps: string; expected: string; actual: string },
  where: FeedbackWhere,
): string {
  return [
    `Steps to reproduce:\n${answers.steps || "(blank)"}`,
    `What I expected to see:\n${answers.expected || "(blank)"}`,
    `What I saw instead:\n${answers.actual || "(blank)"}`,
    `Page: ${where.routeKind}${where.slug ? ` / ${where.slug}` : ""}`,
    `Build: ${buildCommit() ?? "unknown"}`,
  ].join("\n\n");
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
  answers: { steps: string; expected: string; actual: string };
  consented: boolean;
  where: FeedbackWhere;
  diagnostics: FeedbackDiagnosticsV1 | null;
  screenshot: string | null;
}) {
  return {
    id: input.id,
    steps: input.answers.steps.trim() || null,
    expected: input.answers.expected.trim() || null,
    actual: input.answers.actual.trim() || null,
    consented: input.consented,
    routeKind: input.where.routeKind,
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
  /* Lightbox.tsx § closingOurselves, and the same trap: `close()` fires the same
     `close` event Escape does, so without this our own "shut it" comes straight
     back as a second `onClose`. */
  const closingOurselves = useRef(false);

  const [steps, setSteps] = useState("");
  const [expected, setExpected] = useState("");
  const [actual, setActual] = useState("");
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
    setSteps("");
    setExpected("");
    setActual("");
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

  const somethingSaid = steps.trim() !== "" || expected.trim() !== "" || actual.trim() !== "";

  const send = useCallback(async () => {
    if (sending.current) return;
    if (!somethingSaid) return;
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
    const stillMine = () => mine === reportIdRef.current;

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
            answers: { steps, expected, actual },
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
  }, [reportId, somethingSaid, preparing, consented, steps, expected, actual, where, shot]);

  const copy = useCallback(() => {
    const clipboard = navigator.clipboard;
    if (!clipboard) return setCopyFailed(true);
    void clipboard
      .writeText(asPlainText({ steps, expected, actual }, where))
      .then(() => {
        setCopied(true);
        setCopyFailed(false);
      })
      .catch(() => setCopyFailed(true));
    /* The three strings, not the `answers` object built from them — that one is
       a new object on every render, so naming it here would be a dependency
       that always differs and a `useCallback` that never caches. */
  }, [steps, expected, actual, where]);

  return (
    /* The click handled below is the backdrop, whose keyboard equivalent is
       Escape — which <dialog> implements itself. Lightbox.tsx needs a
       `biome-ignore` for the same handler and this does not, because the
       ⌘/Ctrl+Enter listener further down already satisfies the rule. */
    <dialog
      ref={ref}
      className="fb-dialog"
      aria-label="Report a problem"
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
          <h2 className="fb-title">Report a problem</h2>
          <button type="button" className="fb-close" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <p className="fb-intro">
          Fill in whichever of these you can — one is enough.
          {readerEmail ? (
            <>
              {" "}
              It is sent as <span className="fb-email">{readerEmail}</span>, so we can reply.
            </>
          ) : null}
        </p>

        <Answer
          label="Steps to reproduce"
          hint="What you did, in order."
          value={steps}
          onChange={setSteps}
        />
        <Answer
          label="What you expected to see"
          hint=""
          value={expected}
          onChange={setExpected}
        />
        <Answer label="What you saw instead" hint="" value={actual} onChange={setActual} />

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
                  `Spideryarn bug report ${reportId}`,
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
                in the boxes above and copy it by hand.
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
            disabled={!somethingSaid || stage.kind === "sending" || preparing}
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

function Answer({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  value: string;
  onChange(next: string): void;
}) {
  const over = value.length > MAX_FEEDBACK_ANSWER_CHARS;
  return (
    <label className="fb-field">
      <span className="fb-label">
        {label}
        {hint ? <span className="fb-hint"> {hint}</span> : null}
      </span>
      <textarea
        className="fb-input"
        rows={3}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {/* Only once it matters. A character counter under every box turns three
          plain questions into a form. */}
      {over ? (
        <span className="fb-over">
          {value.length} characters — the limit is {MAX_FEEDBACK_ANSWER_CHARS}.
        </span>
      ) : null}
    </label>
  );
}
