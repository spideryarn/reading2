/**
 * Choose a PDF off your own machine, or drop one on the shelf.
 *
 * **The front half of an upload, and only the front half.** There is no
 * `POST /api/uploads` yet, no object store behind it, and the pipeline still
 * refuses to run without a URL — the whole of it is planned, reviewed and
 * unbuilt in docs/plans/pdf-upload-and-storage.md. So this picks a file, checks
 * what can be checked without the bytes, and then says plainly that it cannot
 * send it anywhere.
 *
 * Saying so is the point. A picker that swallowed the file and showed a
 * spinner, or one whose button was disabled with no explanation, would both be
 * a version of the failure this repo keeps writing up
 * (docs/reusable/silent-success.md) — something that looks like it worked.
 * The reader is told what happened and that the file never left their machine.
 *
 * What survives into the real version is everything here except the last
 * paragraph of copy: the drop target, the drag counter, the refusals, and
 * `uploadProblem` in src/uploads.ts, which the server will use too.
 */
import { useRef, useState } from "react";
import { FileText, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { type ChosenFile, formatBytes, uploadProblem } from "../uploads.js";

export function UploadPicker() {
  const input = useRef<HTMLInputElement>(null);
  const [chosen, setChosen] = useState<ChosenFile | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

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
    const file = files[0] as File;
    const picked: ChosenFile = { name: file.name, type: file.type, size: file.size };
    const wrong = uploadProblem(picked);
    setProblem(wrong);
    setChosen(wrong ? null : picked);
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
            <span className="tw:shrink-0">{formatBytes(chosen.size)}</span>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              title="Forget this file"
              onClick={() => {
                setChosen(null);
                setProblem(null);
              }}
            >
              <X size={12} />
            </Button>
          </div>
        )}

        {chosen && (
          <p className="tw:mt-2 tw:mb-0 tw:text-xs tw:text-muted-foreground">
            Uploading isn't built yet, so this is as far as it goes — the file
            hasn't left your machine. A PDF on the web still works: paste its
            address in the box above.
          </p>
        )}
      </div>
    </div>
  );
}
