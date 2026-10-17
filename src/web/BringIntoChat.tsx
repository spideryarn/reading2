/**
 * ***Bring into this chat*** — the button on a web link in Chat (a row of *From
 * the web*, an address in the draft) that makes the page one of the reader's
 * articles and puts it in the composer's "Bringing in" row. Greg's 1A on
 * q-madusw; plan docs/plans/261017e-bring-a-web-page-into-chat.md. The pure
 * half, and the reasons for each state, are in bring-in.ts.
 *
 * **The import is the ordinary one**: `POST /api/jobs { url, ownCopy: true }`
 * through `useJobs().add`, the call the link hover card's *add to Spideryarn*
 * makes (`WithAddToShelf` in ProseHoverCard.tsx). So the slot, the free repeat
 * and the 402 are the server's. `ownCopy` because a public copy of somebody
 * else's would be offered first, and Chat reads only the reader's own.
 *
 * **What was asked is remembered per address, for the tab**, as the hover card
 * does, so an import outlives this button: leave the conversation and come
 * back, and it is *on your shelf*, a press away. **Only the button that was
 * pressed puts the chip in, and only while it is on screen** — a chip never
 * lands in a conversation the reader has since left.
 */
import { ArrowDownToLine, Check, LoaderCircle } from "lucide-react";
import { useEffect, useReducer, useState } from "react";
import { urlKey } from "../ingest.js";
import { hostOf } from "../urls.js";
import {
  BRING_IN_HOW,
  type BringInAsked,
  describeBringIn,
  OPEN_ALREADY,
} from "./bring-in.js";
import type { BroughtIn } from "./MentionPicker.js";
import { loadMentionCandidates } from "./mentions.js";
import { forgetOnReaderChange } from "./lib/reader-change.js";
import { ControlTip, Tooltip } from "./Tooltip.js";
import { useJobs } from "./useJobs.js";

/**
 * Hand an article to the open conversation's composer: null when its chip is
 * in the row, or the sentence that says why not (the row is full).
 */
export interface BringIn {
  /** Hand a finished article to the box. */
  add(article: BroughtIn): string | null;
  /** Refuse before an import can spend an allowance slot. */
  refusal(): string | null;
}

const asked = new Map<string, BringInAsked>();
const listeners = new Map<string, Set<() => void>>();
let generation = 0;
forgetOnReaderChange(() => {
  generation += 1;
  asked.clear();
  for (const wake of [...listeners.values()].flatMap((set) => [...set])) wake();
});

/** Write one address's tab-wide state and wake every button for that page. */
function remember(key: string, next: BringInAsked | null): void {
  if (next === null) asked.delete(key);
  else asked.set(key, next);
  for (const wake of listeners.get(key) ?? []) wake();
}

/** A repeat can be a minimal paper: on the shelf, but not readable by Chat. */
const NOT_READY = "That page is on your shelf, but it is not ready to bring into Chat. Open it and choose Read this first.";

/**
 * Whether an article of the reader's appears on the shelf list the `@` picker
 * reads, and its title when it does. A minimal paper is deliberately absent.
 */
async function shelfArticle(
  slug: string,
  openSlug: string,
): Promise<{ kind: "ready"; title: string } | { kind: "not-ready" } | { kind: "unknown" }> {
  try {
    const found = (await loadMentionCandidates(openSlug)).find((c) => c.slug === slug);
    return found ? { kind: "ready", title: found.title } : { kind: "not-ready" };
  } catch {
    return { kind: "unknown" };
  }
}

/** What happened when this button last handed a chip over. */
type Handed = { kind: "in" } | { kind: "refused"; message: string };

export function BringIntoChat({
  url,
  title,
  openSlug,
  bringIn,
  label,
}: {
  url: string;
  /** The link's own words for the page, for the chip until the article has a title of its own. */
  title?: string | undefined;
  /** The article this conversation is about. */
  openSlug: string;
  bringIn: BringIn;
  /** The button's words; *Bring into this chat* unless the row needs to say which page. */
  label?: string | undefined;
}) {
  /* Quiet: an active job is polled every second wherever the reader is
     (jobEngine.ts § When it polls), and this must not buy the idle poll for
     every link under every answer. */
  const queue = useJobs("quiet");
  const [, bump] = useReducer((n: number) => n + 1, 0);
  const key = urlKey(url);
  const state = asked.get(key);
  /* This button started the import, so it hands the chip over when it is done. */
  const [pressed, setPressed] = useState(false);
  const [handed, setHanded] = useState<Handed | null>(null);

  /* Every copy of a button for this normalized address shows the same state.
     This is also the client-side half of making two quick presses one import. */
  useEffect(() => {
    const forKey = listeners.get(key) ?? new Set();
    forKey.add(bump);
    listeners.set(key, forKey);
    return () => {
      forKey.delete(bump);
      if (forKey.size === 0) listeners.delete(key);
    };
  }, [key]);

  const job = state?.kind === "queued" ? (queue.jobs.find((j) => j.id === state.jobId) ?? null) : null;
  const view = describeBringIn(state, job, openSlug);

  /* A job list is a snapshot, not durable history. Once this button has seen
     an ending, keep the ending itself: retention or another reconciliation
     must not turn Done or Failed back into an endless Adding… line. */
  useEffect(() => {
    if (state?.kind !== "queued" || !job || asked.get(key) !== state) return;
    if (job.status === "done") remember(key, { kind: "have", slug: job.slug, title: job.title ?? null });
    else if (job.status === "error") {
      if (job.error) remember(key, { kind: "failed", message: job.error });
      else remember(key, null);
    } else if (job.status === "cancelled") remember(key, null);
  }, [job, key, state]);

  const hand = (slug: string, own: string | null) => {
    const refusal = bringIn.add({ slug, title: own ?? (title?.trim() || hostOf(url)) });
    setHanded(refusal === null ? { kind: "in" } : { kind: "refused", message: refusal });
  };

  const readySlug = view.kind === "ready" ? view.slug : null;
  const readyTitle = view.kind === "ready" ? view.title : null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: once, when this button's own import becomes an article
  useEffect(() => {
    if (!pressed || readySlug === null) return;
    setPressed(false);
    hand(readySlug, readyTitle);
  }, [pressed, readySlug]);
  /* An import that ended any other way is no longer this button's to finish. */
  const settledOtherwise = view.kind === "offer" || view.kind === "refused" || view.kind === "open";
  useEffect(() => {
    if (pressed && settledOtherwise) setPressed(false);
  }, [pressed, settledOtherwise]);

  const press = () => {
    setHanded(null);
    /* Another copy of this button may have acted before React redrew this
       one. Join that state; never POST from a stale `offer` closure. */
    if (asked.get(key) !== state) {
      setPressed(true);
      bump();
      return;
    }
    if (view.kind === "ready") {
      hand(view.slug, view.title);
      return;
    }
    const cannotStart = bringIn.refusal();
    if (cannotStart !== null) {
      setHanded({ kind: "refused", message: cannotStart });
      return;
    }
    setPressed(true);
    const asOf = generation;
    const wait = (async () => {
      const started = await queue.add(url, { ownCopy: true });
      /* An answer made for the previous reader must not refill the cleared map. */
      if (asOf !== generation) return;
      /* Read straight after the await: useJobs.ts § lastFailure. */
      const why = started ? null : queue.lastFailure();
      if (started && "article" in started) {
        if (started.article === openSlug) {
          remember(key, { kind: "have", slug: started.article, title: null });
        } else {
          /* A repeat answers with the slug alone. The shelf supplies both the
             title and the fact that this is a readable article, not a minimal
             paper whose later Chat send would be refused. */
          const shelf = await shelfArticle(started.article, openSlug);
          if (asOf !== generation) return;
          if (shelf.kind === "ready") remember(key, { kind: "have", slug: started.article, title: shelf.title });
          else if (shelf.kind === "not-ready") remember(key, { kind: "unavailable", message: NOT_READY });
          else remember(key, { kind: "have", slug: started.article, title: null });
        }
      } else if (started && "id" in started) remember(key, { kind: "queued", jobId: started.id });
      else if (why) remember(key, { kind: "refused", message: why });
      /* Nothing to say (or a public copy, which `ownCopy` does not ask about):
         put the button back rather than leave a dead end. */
      else remember(key, null);
    })();
    remember(key, { kind: "sending", wait });
  };

  const button = (
    <Tooltip
      placement="top"
      content={<ControlTip head="Bring into this chat" what={BRING_IN_HOW} how="Nothing is sent until you ask your question." />}
    >
      <button
        type="button"
        className="bring-in-button"
        onClick={press}
        /* The visible words first, so a voice command that says them still finds it (WCAG 2.5.3). */
        aria-label={label ?? `Bring into this chat: ${title?.trim() || hostOf(url)}`}
        aria-description={BRING_IN_HOW}
      >
        <ArrowDownToLine size={13} aria-hidden="true" />
        <span className="bring-in-button-label">{label ?? "Bring into this chat"}</span>
      </button>
    </Tooltip>
  );
  const note = (text: string) => <span className="bring-in-note">{text}</span>;
  switch (view.kind) {
    case "offer":
    case "ready":
      return (
        <span className="bring-in">
          {button}
          {handed?.kind === "in"
            ? <span className="bring-in-done" role="status">
                <Check size={13} aria-hidden="true" /> Added to the box
              </span>
            : handed?.kind === "refused"
              ? <span className="bring-in-note" role="status">{handed.message}</span>
              : view.kind === "offer" && view.after
                ? <span className="bring-in-note" role="status">{view.after}</span>
                : null}
        </span>
      );
    case "working":
      return (
        <span className="bring-in" role="status">
          <LoaderCircle size={13} className="cmt-spinner" aria-hidden="true" />
          {note(view.line)}
        </span>
      );
    case "open":
      return <span className="bring-in">{note(OPEN_ALREADY)}</span>;
    case "refused":
      return (
        <span className="bring-in" role="status">
          {note(view.message)}
        </span>
      );
  }
}
