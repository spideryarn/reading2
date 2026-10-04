/**
 * **A read that failed, and the way to ask again** — the sentence and a *Try
 * again* button, for every band whose artefact GET can fail.
 *
 * FAQ's markup, moved. It was written into FAQ in `418a3d57f` and copied into
 * Simple, Skim and Thread; the other panels drew the sentence and no button,
 * so the only way out of a dropped connection was to leave the mode and come
 * back. One component is how the next band gets both halves.
 *
 * **Markup only.** No state, no parsing and no policy: the sentence is whatever
 * the hook stored (through `describeFetchFailure`, src/web/lib/describe-failure.ts),
 * and `onRetry` is the hook's own `retryRead`, which sends a GET and nothing
 * else — useFaq.ts § `retryRead`. It is not the start of a generic read hook
 * (useOrderedRead.ts § What it deliberately is not): each hook keeps its own
 * state, 404 branch and copy, and this is the one part that is the same in all
 * of them.
 *
 * `className` is for the band's own gutter — `.read-error` in glossary.css is
 * the default, and a band whose rows sit differently (Summary's scroll box,
 * the Thread's Tailwind-spaced head) passes its own.
 *
 * tests/read-error-matrix.test.tsx is where a new mode registers.
 * docs/plans/261004c-sweep-cluster-5-a-failed-read-can-be-retried-and-says-a-readers-sentence.md § Stage 1c.
 */
import { RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  /** The sentence to show — already one written for a reader. */
  error: string;
  /** Read again. Never a generation verb. */
  onRetry(): void | Promise<void>;
  className?: string | undefined;
}

export function ReadError({ error, onRetry, className }: Props) {
  return (
    <div className={className ? `read-error ${className}` : "read-error"}>
      <p className="gloss-error" role="alert">
        {error}
      </p>
      <Button type="button" variant="outline" size="sm" onClick={() => void onRetry()}>
        <RotateCw size={13} />
        Try again
      </Button>
    </div>
  );
}
