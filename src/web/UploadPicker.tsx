/**
 * Choose a PDF off your own machine, or drop one on the shelf.
 *
 * **Wired up, 2026-08-27.** It used to pick a file and then say plainly that
 * there was nowhere to send it, which was the honest thing to do while the
 * object store was unbuilt. There is one now, so this sends the bytes — and
 * everything that was here for the inert version survived unchanged: the drop
 * target, the drag counter, the refusals, and `uploadProblem` in
 * src/uploads.ts, which `POST /api/uploads` now uses too.
 *
 * ## The two halves, and why the file never leaves this component
 *
 * The bytes go **straight to the object store** and never through our server —
 * src/web/upload.ts says why, and it is not an optimisation. That upload
 * happens here, on the shelf, because this is where the `File` is: navigating
 * first and uploading there would mean carrying a file handle through a page
 * change, which is not a thing an address can do.
 *
 * Then, and only then, the reader goes to `/add/upload/<id>` — which queues the
 * job and watches it, exactly as `/add/<url>` does for a page. So an ingest
 * still has one place and one address, and the thing without an address (the
 * transfer) is over before the navigation happens.
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
 * larger than the dashed box ever was rather than smaller. Nothing was removed —
 * dragging, the counter, the refusals, progress, cancellation and retry are all
 * as they were. Only the rest at idle costs nothing: the border is transparent
 * until a file is over it. docs/plans/260903g-faster-shelf-load-and-tidier-homepage-controls.md § Stage 3.
 */
import { useEffect, useRef, useState } from "react";
import { FileText, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { type ChosenFile, formatBytes, uploadProblem } from "../uploads.js";
import { QuotaNotice } from "./QuotaNotice.js";
import { addUploadHref, navigate } from "./router.js";
import { uploadPdf } from "./upload.js";

/** The two pieces this component draws and the caller places. */
export interface UploadSlots {
  /** The control that opens the file dialog. Belongs on the URL row, beside Add. */
  pdfButton: React.ReactNode;
  /**
   * The chosen file, the progress bar, the refusals and the Send it button.
   * Belongs directly under the row, above whatever else the caller draws.
   */
  uploadStatus: React.ReactNode;
}

export function UploadPicker({
  children,
}: {
  /**
   * Everything inside the drop target, given the two pieces to place.
   *
   * A function rather than a plain node because both pieces have to live in
   * rows this component does not own, while their state (the chosen file, the
   * transfer, the refusals) has to stay in the one component that runs the
   * upload. Handing the elements down is the smallest thing that satisfies both.
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
   * How far the transfer has got, or `null` when none is running.
   *
   * Bytes rather than a percentage, because the two things a reader wants from
   * a progress bar during a 50 MB upload are "is it moving" and "how much is
   * left", and a rounded percentage answers the first badly — it sits on the
   * same integer for seconds at a time on a slow connection.
   */
  const [sent, setSent] = useState<number | null>(null);
  /* The `File` itself, which `ChosenFile` deliberately is not: that type is the
     small shared shape src/uploads.ts can check in either process, and this is
     the handle the bytes come out of. Held in a ref rather than in state
     because nothing renders it and a re-render must not lose it. */
  const file = useRef<File | null>(null);
  const abort = useRef<AbortController | null>(null);
  /** Whether a send is in flight *right now*, rather than as of the last render. */
  const sending = useRef(false);

  /* **A counter, not a boolean.** `dragleave` fires every time the pointer
     crosses into a child element — the icon, the button, the text — and each of
     those is immediately followed by a `dragenter` on the child. A boolean set
     false on leave makes the whole zone flicker as you move across it. Counting
     enters against leaves is the standard fix and the only one that survives
     nested children. A ref rather than state: it is read and written inside the
     same handler, and a stale render value would drift the count. */
  const depth = useRef(0);

  /**
   * Accept a file, and say whether it was accepted.
   *
   * The return value is what lets a **drop** go straight on to `send()`. It has
   * to be a return value rather than a look at `chosen` afterwards, because
   * `setChosen` does not change `chosen` until the next render — the caller is
   * still in the same tick and would read the previous file, or `null`.
   * `file.current` is written here synchronously for the same reason, and that
   * is the handle `send()` actually reads.
   */
  function take(files: FileList | null): boolean {
    if (!files || files.length === 0) return false;
    /* **A transfer already in flight owns this control until it is done.**
       `take` used to overwrite `file.current` and `chosen` unconditionally, and
       `send` only checked the lock afterwards — so a second drop during an
       upload replaced the name and the size on screen, its own `send` returned
       at the lock, and the *first* file went on uploading underneath the second
       one's name and then navigated to the first one's article. Nothing was
       lost twice and no second grant was minted; the display simply described a
       file that was not moving. Found by GPT Sol's review, 2026-08-27.

       Refusing here rather than in `send` covers the file picker as well as the
       drop, which had the same hole from the other direction. */
    if (sending.current) {
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
   * Send it, then go to the page that owns the ingest.
   *
   * `navigate` only on success. A failed upload leaves the reader here, with
   * the file still chosen and the reason on screen, so pressing the button
   * again is the whole of the recovery — no page to come back from, and nothing
   * to re-pick.
   */
  async function send() {
    const chose = file.current;
    /* **A ref, not `sent !== null`.** `sent` is the value from the last render,
       and `setSent(0)` does not change it until the next one — so two clicks
       inside one tick, which is a double-click or an agent clicking twice
       because the first looked like it had not registered, both read `null` and
       both start. That mints two grants, sends the file twice, and navigates
       twice. The ref is written before the first `await`, so the second caller
       sees it however fast it arrives. */
    if (!chose || sending.current) return;
    sending.current = true;
    const controller = new AbortController();
    abort.current = controller;
    setProblem(null);
    setSent(0);
    try {
      const grant = await uploadPdf(chose, {
        onProgress: (p) => setSent(p.sent),
        signal: controller.signal,
      });
      navigate(addUploadHref(grant.uploadId));
    } catch (err) {
      /* An abort is the reader's own doing and is not a failure to report —
         `name` rather than `instanceof DOMException`, which is false across a
         realm boundary and true of several things that are not aborts. */
      if ((err as Error).name !== "AbortError") setProblem((err as Error).message);
      setSent(null);
    } finally {
      abort.current = null;
      sending.current = false;
    }
  }

  /**
   * **Stop the transfer if the reader leaves.**
   *
   * `send` navigates on success, and without this the navigation could happen
   * to somebody who is no longer here: leave the shelf mid-upload, and minutes
   * later the finished request pulls you onto the ingest page of a file you had
   * already walked away from. The X button aborted, and nothing else did.
   *
   * Aborting rather than merely ignoring the result, because the bytes are
   * still going: a reader who left is not a reader who wants to keep paying for
   * a 50 MB PUT. `send` treats an abort as the reader's own doing and reports
   * nothing, which is exactly right here.
   */
  useEffect(() => () => abort.current?.abort(), []);

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
        onClick={() => input.current?.click()}
      >
        <Upload size={14} /> PDF
      </Button>
    </>
  );

  /**
   * The chosen file, how much of it has gone, the refusals, and Send it.
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
    <QuotaNotice message={problem} className="tw:mt-2 tw:mb-0 tw:text-xs tw:text-destructive" />

    {chosen && (
      <div className="tw:mt-2 tw:flex tw:items-baseline tw:gap-2 tw:text-xs tw:text-muted-foreground">
        <FileText size={13} className="tw:shrink-0 tw:self-center" />
        <span className="tw:min-w-0 tw:flex-1 tw:truncate tw:text-foreground">
          {chosen.name}
        </span>
        <span className="tw:shrink-0">
          {/* While it is going, how much of it has gone. The same units in
              both states, so the second number does not change meaning
              when the first appears. */}
          {sent === null
            ? formatBytes(chosen.size)
            : `${formatBytes(sent)} of ${formatBytes(chosen.size)}`}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          title={sent === null ? "Forget this file" : "Stop uploading"}
          onClick={() => {
            /* One button, two jobs, and the second is why it stays on
               screen during the upload: a transfer nobody can stop is a
               page the reader has to reload to escape. */
            abort.current?.abort();
            setChosen(null);
            setProblem(null);
            setSent(null);
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
    {chosen && sent !== null && (
      <progress
        className="tw:mt-2 tw:h-1 tw:w-full"
        value={sent}
        max={chosen.size}
        aria-label={`Uploading ${chosen.name}`}
      />
    )}

    {chosen && sent === null && (
      <div className="tw:mt-2">
        <Button type="button" size="sm" onClick={() => void send()}>
          <Upload size={13} /> Send it
        </Button>
      </div>
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
       * **A drop uploads it. Dropping is the commit gesture.**
       *
       * It used to only *choose* the file, leaving a "Send it" button to
       * press — and on 2026-08-27 Greg dropped a PDF on this box and reported
       * that "nothing seems to have happened". Nothing had gone wrong: the
       * filename row appeared and the upload was waiting for a second gesture
       * that the box had not asked for. A control captioned *drop a PDF here*,
       * that catches the file and then waits, is indistinguishable from one
       * that swallowed it.
       *
       * So the two entry points now differ on purpose. Dropping a file on a
       * target that names itself is unambiguous, and there is nothing to
       * confirm. The **button** still chooses-then-sends, because the file
       * dialog is a place people browse — the first PDF you click is often not
       * the one you meant, and the row with its size and its X is the only
       * chance to notice before 50 MB goes.
       *
       * `take` returning false is a refusal it has already explained (not a
       * PDF, too large, more than one), so there is nothing to send and the
       * reason is already on screen.
       */
      onDrop={(e) => {
        e.preventDefault();
        depth.current = 0;
        setDragging(false);
        if (take(e.dataTransfer.files)) void send();
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
      {children({ pdfButton, uploadStatus })}
    </div>
  );
}
