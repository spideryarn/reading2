/**
 * **A rewrite finished and its result is not on screen yet** — a quiet line and
 * a read-only *Try again*, drawn in place of the forced control it is holding.
 *
 * The way out of every stuck hold (src/web/rewrite-hold.ts), whatever stuck
 * it. A re-read that failed has `ReadError` beside it already; one answered
 * from the offline copy has no error at all, so without this a held panel
 * would show the old artefact, a disabled Regenerate and nothing to press —
 * and nothing re-reads on reconnect (GPT Sol's plan review of 261004c, F10).
 * Quiz's *Read the new questions* (QuizPanel.tsx § `run`) is the model, and
 * keeps its own words.
 *
 * `line` is the mode's own sentence. `onRead` is the hook's `refresh`: a GET,
 * never a generation verb. Not an alert — nothing went wrong that the reader
 * has not already been told.
 */
import { useState } from "react";
import { RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  /** "The new summary hasn't loaded yet." */
  line: string;
  /** Read again. Never spends. */
  onRead(): Promise<void>;
  className?: string | undefined;
}

export function RewriteWaiting({ line, onRead, className }: Props) {
  const [reading, setReading] = useState(false);
  return (
    <div className={className ? `read-error ${className}` : "read-error"}>
      <p className="gloss-hint tw:m-0 tw:mb-2 tw:text-muted-foreground">{line}</p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={reading}
        onClick={() => {
          setReading(true);
          void onRead().then(
            () => setReading(false),
            () => setReading(false),
          );
        }}
      >
        <RotateCw size={13} />
        Try again
      </Button>
    </div>
  );
}
