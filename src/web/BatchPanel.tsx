/**
 * **The batch on the shelf** — one row per file, what it is doing, and Stop.
 *
 * Draws `batchUpload` (batchUpload.ts) and nothing else; renders nothing while
 * there is no batch. On the shelf under the add box, because that is where the
 * files were dropped. Plan
 * docs/plans/261001m-bulk-import-of-many-papers-a-stepping-stone.md § The batch,
 * in the browser; docs/project/ingest-queue.md § Many at once.
 *
 * **Narrow windows**: every row is a wrapping flex line whose filename may
 * shrink and truncate, so at 390px a row becomes two lines and the page never
 * scrolls sideways (docs/project/narrow-windows.md). The list scrolls inside
 * itself past a few dozen rows, so a thousand files do not push the shelf a
 * mile down the page.
 */
import { useSyncExternalStore } from "react";
import { FileText, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatBytes } from "../uploads.js";
import {
  BATCH_MAX_FILES,
  type BatchRow,
  type BatchSnapshot,
  type BatchState,
  batchUpload,
  rowIsLive,
} from "./batchUpload.js";
import { Link } from "./Link.js";
import { QuotaNotice } from "./QuotaNotice.js";
import { readHref } from "./router.js";

/** What the panel needs of the engine. A prop so a test can hand it a fake. */
export interface BatchSource {
  subscribe(onChange: () => void): () => void;
  getSnapshot(): BatchSnapshot;
  cancel(): void;
  retry(rowId: number): void;
  dismiss(): void;
}

/** The short words for a state. The longer sentence, when there is one, goes under. */
export function stateLabel(state: BatchState, bytes: number): string {
  switch (state.kind) {
    case "waiting":
      return "Waiting";
    case "hashing":
      return "Checking the file";
    case "sending":
      return state.sent > 0 ? `Sending, ${formatBytes(state.sent)} of ${formatBytes(bytes)}` : "Sending";
    case "reading":
      return "Reading its title and abstract";
    case "shelved":
      return "On your shelf";
    case "duplicate":
      if (state.message.includes("[up-dup-archived]")) return "Already on your shelf, archived";
      if (state.message.includes("[up-dup-wait]")) return "Already being added";
      return "Already on your shelf";
    case "same-file":
      return `The same file as ${state.as}`;
    case "refused":
      return "Not a file this can add";
    case "no-room":
      return "Not started: out of allowance";
    case "failed":
      return "Couldn't read this one";
    case "auth-paused":
      return "Paused until you are signed in again";
    case "lost":
      return "Out of sight: look on your shelf";
    case "stopped":
      return "Stopped";
    default: {
      const unreachable: never = state;
      throw new Error(`Unknown batch state: ${String(unreachable)}`);
    }
  }
}

/** Where a row's link goes, when it has one. */
function slugOf(state: BatchState): string | null {
  if (state.kind === "shelved") return state.slug;
  if (state.kind === "duplicate") return state.slug;
  return null;
}

/** The counts line: only the counts that are not zero. */
export function batchSummary(rows: readonly BatchRow[]): string {
  let shelved = 0;
  let already = 0;
  let going = 0;
  let failed = 0;
  let noRoom = 0;
  let other = 0;
  for (const r of rows) {
    const k = r.state.kind;
    if (k === "shelved") shelved += 1;
    else if (k === "duplicate" || k === "same-file") already += 1;
    else if (rowIsLive(r.state)) going += 1;
    else if (k === "failed") failed += 1;
    else if (k === "no-room") noRoom += 1;
    else other += 1;
  }
  const parts = [
    `${shelved} of ${rows.length} on your shelf`,
    already > 0 && `${already} already there`,
    going > 0 && `${going} still going`,
    failed > 0 && `${failed} couldn't be read`,
    noRoom > 0 && `${noRoom} out of allowance`,
    other > 0 && `${other} not added`,
  ].filter(Boolean);
  return parts.join(" · ");
}

export function BatchPanel({ source = batchUpload }: { source?: BatchSource }) {
  const snapshot = useSyncExternalStore(source.subscribe, source.getSnapshot);
  const { rows, overflow } = snapshot;
  if (rows.length === 0 && overflow === 0) return null;

  const live = rows.some((r) => rowIsLive(r.state));
  /* Stop is about files that have not been queued; a running job is left to finish. */
  const stoppable = rows.some(
    (r) =>
      r.state.kind === "waiting" ||
      r.state.kind === "hashing" ||
      r.state.kind === "sending" ||
      r.state.kind === "auth-paused",
  );
  /* The allowance's own sentence, once for the batch rather than once a row. */
  const noRoom = rows.find((r) => r.state.kind === "no-room")?.state;

  return (
    <section
      aria-label="Files being added"
      className="tw:mb-8 tw:rounded-lg tw:border tw:border-border tw:bg-card tw:p-4"
    >
      <div className="tw:flex tw:flex-wrap tw:items-center tw:gap-x-3 tw:gap-y-2">
        <h2 className="tw:m-0 tw:min-w-0 tw:flex-1 tw:text-sm tw:font-semibold">
          Adding {rows.length} {rows.length === 1 ? "file" : "files"} without AI processing
        </h2>
        {stoppable && (
          <Button type="button" variant="outline" size="sm" onClick={() => source.cancel()}>
            Stop
          </Button>
        )}
        {!live && (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Clear this list"
            title="Clear this list"
            onClick={() => source.dismiss()}
          >
            <X size={14} />
          </Button>
        )}
      </div>

      <p aria-live="polite" className="tw:mt-1 tw:mb-0 tw:text-xs tw:text-muted-foreground">
        {batchSummary(rows)}
      </p>
      <p className="tw:mt-1 tw:mb-0 tw:text-xs tw:text-muted-foreground">
        {live
          ? "Keep this tab open while it works. Each counts as 1/100 of an article, and only its title, authors and abstract are read; press Read this on a paper to read the whole of it."
          : "Each paper is on your shelf with only its title, authors and abstract read. Press Read this on one to read the whole of it."}
      </p>
      {overflow > 0 && (
        <p className="tw:mt-1 tw:mb-0 tw:text-xs tw:text-destructive">
          {`One drop takes up to ${BATCH_MAX_FILES.toLocaleString()} files, so the other ${overflow.toLocaleString()} were not added. Drop them again once these are done.`}
        </p>
      )}
      <QuotaNotice
        message={noRoom?.kind === "no-room" ? noRoom.message : null}
        className="tw:mt-1 tw:mb-0 tw:text-xs tw:text-destructive"
      />

      <ul className="tw:mt-3 tw:mb-0 tw:flex tw:max-h-96 tw:list-none tw:flex-col tw:gap-1.5 tw:overflow-y-auto tw:p-0">
        {rows.map((row) => (
          <BatchRowLine key={row.id} row={row} onRetry={() => source.retry(row.id)} />
        ))}
      </ul>
    </section>
  );
}

function BatchRowLine({ row, onRetry }: { row: BatchRow; onRetry: () => void }) {
  const { state } = row;
  const slug = slugOf(state);
  const bad = state.kind === "failed" || state.kind === "refused" || state.kind === "auth-paused";
  /* The longer sentence a row carries, said under it. A duplicate's and an
     allowance refusal's are already said by the label and the panel. */
  const detail =
    state.kind === "failed" || state.kind === "refused" || state.kind === "auth-paused"
      ? state.message
      : null;

  return (
    <li data-batch-state={state.kind} className="tw:text-xs">
      <div className="tw:flex tw:flex-wrap tw:items-baseline tw:gap-x-2 tw:gap-y-0.5">
        <FileText size={12} aria-hidden="true" className="tw:shrink-0 tw:self-center tw:text-muted-foreground" />
        <span className="tw:min-w-0 tw:max-w-full tw:flex-1 tw:basis-40 tw:truncate tw:text-foreground">
          {slug ? (
            <Link href={readHref(slug)} className="tw:text-foreground tw:hover:text-highlight">
              {row.filename}
            </Link>
          ) : (
            row.filename
          )}
        </span>
        <span className={bad ? "tw:text-destructive" : "tw:text-muted-foreground"}>
          {stateLabel(state, row.bytes)}
        </span>
        {state.kind === "failed" && (
          <Button type="button" variant="outline" size="xs" onClick={onRetry}>
            Retry
          </Button>
        )}
      </div>
      {detail && (
        <p className="tw:mt-0.5 tw:mb-0 tw:break-words tw:pl-5 tw:text-muted-foreground">
          {detail}
        </p>
      )}
    </li>
  );
}
