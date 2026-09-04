/**
 * Choose a PDF off your own machine, or drop one on the shelf.
 *
 * **The transfer does not live here any more, as of 2026-09-03.** It lives in
 * [`uploadEngine`](uploadEngine.ts), a tab-level singleton, and this component
 * renders what that engine is doing. The reason is Greg's:
 *
 * > sometimes it takes a while to upload over a slow connection. I have to wait
 * > before I can then click the Add button … I'd like to be able to upload and
 * > then click Add immediately, which would then wait for the upload to finish
 * > and run the ingestion queue immediately, so I could go off and do something
 * > else in the meantime.
 * >
 * > — Greg, 2026-09-03
 *
 * Going off and doing something else unmounts this component. So everything
 * that must survive that — the `File`, the grant, the PUT, and the
 * `POST /api/jobs` that follows it — had to stop being state of a mount.
 * docs/plans/260903j-background-pdf-upload-so-add-does-not-wait.md.
 *
 * **What went with it: the abort-on-unmount.** That cleanup existed so a
 * finished transfer could not navigate at somebody who had already left the
 * shelf. Nothing navigates on completion now — the address is minted *before*
 * the bytes move and the reader is sent there immediately — so the hazard it
 * guarded is gone, and what it actually did in practice was throw away a nearly
 * finished 40 MB upload every time somebody clicked anything.
 *
 * ## What is still here
 *
 * The **chosen file**, which is page state and should die when you leave: a PDF
 * picked and not yet committed is a thought, not a transfer. The **drop
 * target**, the drag counter, and `uploadProblem`'s refusals, all unchanged.
 *
 * ## It wraps the add row rather than sitting under it
 *
 * Until 2026-09-03 this drew a dashed rectangle of its own, holding an icon,
 * *Or drop a PDF here* and a button — about 130px of the 300px add box, for the
 * rarer of the two ways in. On a phone that pushed the shelf's own list
 * entirely below the fold.
 *
 * So the box is gone and the parts went two ways: the **button** is now a small
 * control on the URL row, handed back to the caller through `children` so it
 * can sit beside Add; and the **drop target** became this wrapper, which is
 * larger than the dashed box ever was rather than smaller. Only the rest at idle
 * costs nothing: the border is transparent until a file is over it.
 * docs/plans/260903g-faster-shelf-load-and-tidier-homepage-controls.md § Stage 3.
 */
import { useRef, useState } from "react";
import { FileText, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { type ChosenFile, formatBytes, uploadLimits, uploadProblem } from "../uploads.js";
import { QuotaNotice } from "./QuotaNotice.js";
import { addUploadHref, navigate } from "./router.js";
import { type Transfer, uploadEngine } from "./uploadEngine.js";
import { useUpload } from "./useUpload.js";

/**
 * The id tying the caps caption to the PDF button that `aria-describedby`
 * points at.
 *
 * A module constant rather than a literal in two places: the whole mechanism is
 * that the two strings are the same one, and the failure mode of a typo here is
 * silent — the reference dangles, browsers ignore it, and nothing renders any
 * differently. `tests/upload-caps-are-stated-before-the-file-is-chosen.test.tsx`
 * asserts the association rather than trusting it.
 *
 * Fixed rather than generated because there is one add box on the page. If a
 * second `UploadPicker` is ever mounted alongside the first, this becomes a
 * duplicate id and wants `useId()`.
 */
const LIMITS_ID = "upload-limits";

/** The three pieces this component draws and the caller places. */
export interface UploadSlots {
  /** The control that opens the file dialog. Belongs on the URL row, beside Add. */
  pdfButton: React.ReactNode;
  /**
   * The chosen file, the progress bar, the refusals.
   * Belongs directly under the row, above whatever else the caller draws.
   */
  uploadStatus: React.ReactNode;
  /**
   * Whether a file is chosen and waiting for Add, and how to commit it.
   *
   * The caller owns the Add button — it is the URL form's submit — and since
   * 2026-09-03 that one button commits both ways in, so it has to be able to ask
   * *is there a file* and to say *send it*. Greg chose one button over keeping a
   * separate *Send it*.
   */
  chosen: ChosenFile | null;
  commit: () => void;
}

export function UploadPicker({
  children,
}: {
  /**
   * Everything inside the drop target, given the pieces to place.
   *
   * A function rather than a plain node because the pieces have to live in rows
   * this component does not own, while the file, the refusals and the engine's
   * transfer have to stay in one place. Handing the elements down is the
   * smallest thing that satisfies both.
   *
   * The caller passes the **whole** of the add box through here, which is what
   * makes the drop target the whole of the add box — see the header.
   */
  children: (slots: UploadSlots) => React.ReactNode;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [chosen, setChosen] = useState<ChosenFile | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  /**
   * The transfer the engine is running, or null.
   *
   * **This is the whole of what used to be `sent`, `sending`, `abort` and the
   * `file` ref.** Reading it rather than holding it is what makes the bar still
   * be moving when the reader comes back to the shelf from somewhere else.
   */
  const transfer = useUpload();

  /* The `File` itself, which `ChosenFile` deliberately is not: that type is the
     small shared shape src/uploads.ts can check in either process, and this is
     the handle the bytes come out of. Held in a ref rather than in state
     because nothing renders it and a re-render must not lose it. It is handed
     to the engine on commit and forgotten here. */
  const file = useRef<File | null>(null);

  /* **A counter, not a boolean.** `dragleave` fires every time the pointer
     crosses into a child element — the icon, the button, the text — and each of
     those is immediately followed by a `dragenter` on the child. A boolean set
     false on leave makes the whole zone flicker as you move across it. Counting
     enters against leaves is the standard fix and the only one that survives
     nested children. A ref rather than state: it is read and written inside the
     same handler, and a stale render value would drift the count. */
  const depth = useRef(0);

  /** Whether the engine is busy with something that is not finished. */
  const busy =
    transfer !== null &&
    (transfer.phase.kind === "hashing" ||
      transfer.phase.kind === "granting" ||
      transfer.phase.kind === "sending" ||
      transfer.phase.kind === "queueing");

  /**
   * Whether Stop is a thing that can still be done.
   *
   * **Busy minus `queueing`.** By then the bytes are in Storage and
   * `POST /api/jobs` is in flight; there is nothing to abort that would undo
   * anything, and the server may already have made the job. Offering Stop there
   * produced the worst state available — a box saying the upload was cancelled
   * while the job poll found the ingest and drove it to completion. GPT Sol,
   * finding 2. The engine refuses it from its own side too; this is what stops
   * the reader being shown a button that declines.
   */
  const stoppable = busy && transfer.phase.kind !== "queueing";

  /**
   * Accept a file, and say whether it was accepted.
   *
   * The return value is what lets a **drop** go straight on to `commit()`. It
   * has to be a return value rather than a look at `chosen` afterwards, because
   * `setChosen` does not change `chosen` until the next render — the caller is
   * still in the same tick and would read the previous file, or `null`.
   * `file.current` is written here synchronously for the same reason.
   */
  function take(files: FileList | null): boolean {
    if (!files || files.length === 0) return false;
    /* **A transfer already in flight owns this control until it is done.** It
       used to overwrite the file and the name on screen while the *first* one
       went on uploading underneath the second one's name and then navigated to
       the first one's article — found by GPT Sol, 2026-08-27. The engine
       enforces the same rule from its own side (`ONE_UPLOAD_AT_A_TIME`); this
       is the half that keeps the reader from getting that far, and covers the
       file picker as well as the drop. */
    if (busy) {
      setProblem("That upload is still going. Wait for it, or stop it first.");
      return false;
    }
    if (files.length > 1) {
      setChosen(null);
      setProblem("One at a time, please — drop a single PDF.");
      return false;
    }
    // Named separately because `File` is a `ChosenFile` and nothing more is
    // wanted here; the bytes stay where they are until there is somewhere to
    // send them.
    const chose = files[0] as File;
    const picked: ChosenFile = { name: chose.name, type: chose.type, size: chose.size };
    const wrong = uploadProblem(picked);
    setProblem(wrong);
    setChosen(wrong ? null : picked);
    file.current = wrong ? null : chose;
    return !wrong;
  }

  /**
   * Whether the caps are on screen — and therefore whether the PDF button may
   * point at them.
   *
   * One expression rather than the same condition written in two places, so the
   * `aria-describedby` below cannot outlive the element it names. A dangling
   * reference is ignored by browsers rather than announced wrongly, but a
   * screen reader that says *"PDF, up to 50 MB and 250 pages"* about a control
   * whose caption has been replaced by a transfer's progress row is worse than
   * one that says nothing.
   *
   * **`transfer`, not `busy`**: this asks *is there a transfer record*, not *is
   * one running*. A `failed`, `cancelled` or finished transfer stays in the
   * snapshot until it is forgotten, and its row keeps this slot — so the caps
   * stay down while it does. That is the one-slot layout working as intended,
   * and it is stated here because the predicate does not say it. GPT Sol,
   * 2026-09-04.
   */
  const limitsShown = !chosen && !transfer;

  /**
   * Hand it to the engine, and go to the page that owns the ingest.
   *
   * **The navigation happens with zero bytes sent**, which is the point of the
   * whole change: `send` resolves as soon as the grant is in hand, so the
   * address exists long before the file has finished moving, and the transfer
   * carries on in the engine wherever the reader goes next.
   *
   * `null` means the grant itself was refused — a quota wall, a file the server
   * will not take — and there is nothing to navigate to. The reason is already
   * on screen through `transfer.phase`, the file is still chosen, and pressing
   * Add again is the whole of the recovery.
   */
  async function commit(): Promise<void> {
    const chose = file.current;
    if (!chose || busy) return;
    setProblem(null);
    /* Cleared here, not on the way back: this component is about to unmount,
       and if the reader presses Back the box should show the engine's transfer
       rather than a stale copy of the same file waiting to be sent again. */
    setChosen(null);
    file.current = null;
    const uploadId = await uploadEngine.send(chose);
    if (uploadId) navigate(addUploadHref(uploadId));
  }

  /** Whether this drag is carrying files at all, rather than selected text. */
  function hasFiles(event: React.DragEvent): boolean {
    return Array.from(event.dataTransfer.types).includes("Files");
  }

  /* The control that opens the file dialog, drawn here and placed by the
     caller. Outline rather than the filled default: pasting a URL is the common
     way in and Add is the one filled button on this row, so a second filled
     control beside it would make the section read as two equal choices. Same
     `h-9` as Add and as the URL input beside it —
     docs/project/design-css-overview.md § Controls: one height. */
  const pdfButton = (
    <>
      {/* The input is the mechanism and the button is the control. A bare file
          input cannot be styled to match anything else on this page, and
          wrapping it in a label styled as a button loses the focus ring the
          Button component draws deliberately — see components/ui/button.tsx. */}
      <input
        ref={input}
        type="file"
        accept="application/pdf,.pdf"
        className="tw:hidden"
        onChange={(e) => {
          take(e.target.files);
          /* Cleared so that choosing the *same* file again still fires
             `change`. Without this, refusing a file and picking it again after
             moving it does nothing at all, silently. */
          e.target.value = "";
        }}
      />
      <Button
        type="button"
        variant="outline"
        /* The words the dashed box used to say. They were the only thing
           advertising that dropping works at all, so they move to the title of
           the control that replaced it rather than disappearing. */
        title="Choose a PDF — or drop one anywhere on this box"
        /* **The caps, for somebody who cannot see the caption.** The line under
           this row states them; this is what makes a screen reader read it out
           as part of the control rather than as a stray paragraph after it.
           Only while that line is actually on screen — see `limitsShown`. */
        aria-describedby={limitsShown ? LIMITS_ID : undefined}
        onClick={() => input.current?.click()}
      >
        <Upload size={14} /> PDF
      </Button>
    </>
  );

  /**
   * What is on this box's mind: a chosen file, or a transfer, or a refusal.
   *
   * Drawn here and placed by the caller directly under the URL row, so that
   * the whole of the add box — the disclosure and the job list included — can
   * be inside the drop target without pushing this to the bottom of it.
   */
  const uploadStatus = (
    /* Announced, because a refusal that only appears visually is no refusal
       to somebody using a screen reader — and the button they just pressed
       gives no other feedback. */
    <div aria-live="polite">
      {/* **`POST /api/uploads` refuses at the door when there is no room
          left** — a non-reserving eligibility check, so nobody transfers
          11 MB to be told no (docs/project/billing.md § *Which requests spend
          a slot*). It carries the same refusal sentence the job route does, so
          it gets the same link beside it. QuotaNotice.tsx. */}
      <QuotaNotice
        message={problem ?? failureOf(transfer)}
        className="tw:mt-2 tw:mb-0 tw:text-xs tw:text-destructive"
      />

      {/* **What we will take, before anybody has chosen anything.**
          `uploadLimits()` (src/uploads.ts) names the size cap and the page cap
          from the constants that enforce them, so this cannot promise a limit
          that is not the real one.

          It exists because of Sentry `SPIDERYARN-READING2-V`, *"couldn't upload
          PDF"*: a 142-page paper against what was then a 100-page cap. The cap
          has moved and the refusal now names both numbers
          (docs/postmortems/260904b-a-sentence-written-for-the-reader-was-thrown-away-at-the-seam.md),
          but a **page** cap is not a thing anybody can check before uploading —
          a file manager shows you a size and not a page count — so the only way
          to discover it was to send a book and be turned away at the end of it.

          **In the slot the chosen-file row will occupy**, not above it: the two
          are mutually exclusive, so stating the limits costs no height once a
          reader has acted on them, which is what makes it affordable in a box
          Greg had just asked to be made shorter (AddArticle.tsx). Muted and
          12px, because it is a caption on a control and not an instruction.

          Not repeated on `/add/upload/<id>`: by then the file is chosen and the
          refusals, which name the numbers themselves, are what is useful.

          **It stays up under a refusal**, including the size refusal, which
          names the same 50 MB one line above it. A caption on a control is not
          an event and should not vanish when one happens — and the reader who
          has just been told *that doesn't look like a PDF* is the one about to
          choose again. The repetition is the price and it is small. */}
      {limitsShown && (
        <p id={LIMITS_ID} className="tw:mt-2 tw:mb-0 tw:text-xs tw:text-muted-foreground">
          {uploadLimits()}
        </p>
      )}

      {/* One row, whichever of the two it is describing. A chosen file and a
          transfer cannot both exist — committing clears the first — so this is
          a single shape with two sources rather than two rows that could both
          appear. */}
      {(chosen || transfer) && (
        <div className="tw:mt-2 tw:flex tw:items-baseline tw:gap-2 tw:text-xs tw:text-muted-foreground">
          <FileText size={13} className="tw:shrink-0 tw:self-center" />
          <span className="tw:min-w-0 tw:flex-1 tw:truncate tw:text-foreground">
            {chosen ? (
              chosen.name
            ) : (
              /* **A link, once there is an address.** The transfer has a page of
                 its own now, and a reader who wandered back to the shelf should
                 be able to get to it without remembering where they were. */
              <a
                href={transfer?.uploadId ? addUploadHref(transfer.uploadId) : undefined}
                className="tw:text-foreground tw:hover:text-highlight"
                onClick={(e) => {
                  if (!transfer?.uploadId) return;
                  e.preventDefault();
                  navigate(addUploadHref(transfer.uploadId));
                }}
              >
                {transfer?.filename}
              </a>
            )}
          </span>
          <span className="tw:shrink-0">
            {/* While it is going, how much of it has gone. The same units in
                both states, so the second number does not change meaning
                when the first appears. */}
            {transfer?.phase.kind === "sending"
              ? `${formatBytes(transfer.phase.sent)} of ${formatBytes(transfer.bytes)}`
              : formatBytes(chosen?.size ?? transfer?.bytes ?? 0)}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            title={stoppable ? "Stop uploading" : "Forget this file"}
            /* **Nothing to press while the ingest is being queued.** That phase
               is a single small request and it cannot be undone, so a button
               here would either lie or decline. It reappears the instant the
               job comes back. */
            disabled={busy && !stoppable}
            onClick={() => {
              /* One button, three jobs, and the middle one is why it stays on
                 screen during the upload: a transfer nobody can stop is a page
                 the reader has to reload to escape. On a transfer that has
                 already stopped it is `forget`, which is the only way to clear a
                 finished or cancelled row off the shelf. */
              if (stoppable) uploadEngine.cancel();
              else uploadEngine.forget();
              setChosen(null);
              setProblem(null);
              file.current = null;
            }}
          >
            <X size={12} />
          </Button>
        </div>
      )}

      {/* A real bar rather than a spinner, for the reason src/web/upload.ts
          reaches for `XMLHttpRequest` at all: 50 MB on a domestic connection
          is tens of seconds, and "something is happening" is not the question
          a reader has after the first five of them.

          `<progress>` rather than a styled div, because it is the element
          that already announces itself to a screen reader and already has a
          determinate value. */}
      {transfer?.phase.kind === "sending" && (
        <progress
          className="tw:mt-2 tw:h-1 tw:w-full"
          value={transfer.phase.sent}
          max={transfer.bytes}
          aria-label={`Uploading ${transfer.filename}`}
        />
      )}
    </div>
  );

  return (
    /* biome-ignore lint/a11y/noStaticElementInteractions: a drop target has
       no keyboard equivalent to give it — dragging a file is a pointer gesture
       and nothing else — so a role here would advertise an interaction that
       does not exist. The button inside is the accessible control, and it does
       everything the drop does. */
    <div
      onDragEnter={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        depth.current += 1;
        setDragging(true);
      }}
      onDragOver={(e) => {
        /* **`preventDefault` here or there is no drop at all.** The default
           action of dragover is "this is not a drop target", and without
           cancelling it the browser opens the PDF in the tab instead — which
           looks exactly like the handler below never ran. `dropEffect` is what
           makes the cursor say copy rather than move. */
        if (!hasFiles(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      }}
      onDragLeave={() => {
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) setDragging(false);
      }}
      /**
       * **A drop commits it. Dropping is the commit gesture.**
       *
       * It used to only *choose* the file, leaving a second button to press —
       * and on 2026-08-27 Greg dropped a PDF on this box and reported that
       * "nothing seems to have happened". Nothing had gone wrong: the filename
       * row appeared and the upload was waiting for a gesture that the box had
       * not asked for. A control captioned *drop a PDF here*, that catches the
       * file and then waits, is indistinguishable from one that swallowed it.
       *
       * So the two entry points still differ on purpose. Dropping a file on a
       * target that names itself is unambiguous, and there is nothing to
       * confirm. The **button** still chooses-then-Adds, because the file dialog
       * is a place people browse — the first PDF you click is often not the one
       * you meant, and the row with its size and its X is the only chance to
       * notice before 50 MB goes.
       *
       * `take` returning false is a refusal it has already explained (not a
       * PDF, too large, more than one, one already going), so there is nothing
       * to send and the reason is already on screen.
       */
      onDrop={(e) => {
        e.preventDefault();
        depth.current = 0;
        setDragging(false);
        if (take(e.dataTransfer.files)) void commit();
      }}
      /* **Nothing at rest, everything on drag, and it covers the whole card.**
         `-m-4 … p-4` cancels the section's own padding and puts it back inside
         this element, so the target reaches the card's edge — a PDF let go on
         the disclosure line, on a job row, or an inch high in the padding is
         still caught. Without that the title would be advertising a target
         bigger than the one that exists, and a miss falls through to the
         browser, which opens the PDF over the page. GPT Sol, 2026-09-03.
         `rounded-lg` to match the card it is lying exactly on top of. */
      className={`tw:-m-4 tw:rounded-lg tw:border tw:p-4 tw:transition-colors ${
        dragging ? "tw:border-highlight tw:bg-highlight/10" : "tw:border-transparent"
      }`}
    >
      {children({ pdfButton, uploadStatus, chosen, commit: () => void commit() })}
    </div>
  );
}

/**
 * The sentence for a transfer that stopped, or null.
 *
 * **Only `granting`**, and that is the division of labour rather than an
 * omission. A grant refused here is the one failure the reader is still on this
 * page for — everything after it happens on `/add/upload/<id>`, which has an
 * address, a *Try again* that knows which phase failed, and the room to say what
 * went wrong. Repeating those here would put the same refusal on two pages and
 * make the shelf's copy the one nobody maintains.
 */
function failureOf(transfer: Transfer | null): string | null {
  if (transfer?.phase.kind !== "failed") return null;
  return transfer.phase.at === "granting" ? transfer.phase.reason : null;
}
