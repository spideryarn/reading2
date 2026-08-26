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
 */
import { useRef, useState } from "react";
import { FileText, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { type ChosenFile, formatBytes, uploadProblem } from "../uploads.js";
import { addUploadHref, navigate } from "./router.js";
import { uploadPdf } from "./upload.js";

export function UploadPicker() {
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

  /* **A counter, not a boolean.** `dragleave` fires every time the pointer
     crosses into a child element — the icon, the button, the text — and each of
     those is immediately followed by a `dragenter` on the child. A boolean set
     false on leave makes the whole zone flicker as you move across it. Counting
     enters against leaves is the standard fix and the only one that survives
     nested children. A ref rather than state: it is read and written inside the
     same handler, and a stale render value would drift the count. */
  const depth = useRef(0);

  function take(files: FileList | null) {
    if (!files || files.length === 0) return;
    if (files.length > 1) {
      setChosen(null);
      setProblem("One at a time, please — drop a single PDF.");
      return;
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
    if (!chose || sent !== null) return;
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
    }
  }

  /** Whether this drag is carrying files at all, rather than selected text. */
  function hasFiles(event: React.DragEvent): boolean {
    return Array.from(event.dataTransfer.types).includes("Files");
  }

  return (
    <div className="tw:mt-4">
      {/* biome-ignore lint/a11y/noStaticElementInteractions: a drop target has
          no keyboard equivalent to give it — dragging a file is a pointer
          gesture and nothing else — so a role here would advertise an
          interaction that does not exist. The button inside is the accessible
          control, and it does everything the drop does. */}
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
             looks exactly like the handler below never ran. `dropEffect` is
             what makes the cursor say copy rather than move. */
          if (!hasFiles(e)) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
        }}
        onDragLeave={() => {
          depth.current = Math.max(0, depth.current - 1);
          if (depth.current === 0) setDragging(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          depth.current = 0;
          setDragging(false);
          take(e.dataTransfer.files);
        }}
        className={`tw:flex tw:flex-col tw:items-center tw:gap-2 tw:rounded-md tw:border tw:border-dashed tw:px-4 tw:py-5 tw:text-center tw:transition-colors ${
          dragging
            ? "tw:border-highlight tw:bg-highlight/10"
            : "tw:border-border tw:bg-background"
        }`}
      >
        <Upload size={16} className="tw:text-muted-foreground" />
        <p className="tw:m-0 tw:text-xs tw:text-muted-foreground">
          Or drop a PDF here
        </p>
        {/* The input is the mechanism and the button is the control. A bare
            file input cannot be styled to match anything else on this page, and
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
               `change`. Without this, refusing a file and picking it again
               after moving it does nothing at all, silently. */
            e.target.value = "";
          }}
        />
        <Button type="button" variant="outline" size="sm" onClick={() => input.current?.click()}>
          <Upload size={13} /> Upload a PDF
        </Button>
      </div>

      {/* Announced, because a refusal that only appears visually is no refusal
          to somebody using a screen reader — and the button they just pressed
          gives no other feedback. */}
      <div aria-live="polite">
        {problem && (
          <p className="tw:mt-2 tw:mb-0 tw:text-xs tw:text-destructive">{problem}</p>
        )}

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
    </div>
  );
}
