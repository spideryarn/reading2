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
export type BringIn = (article: BroughtIn) => string | null;

const asked = new Map<string, BringInAsked>();
let generation = 0;
forgetOnReaderChange(() => {
  generation += 1;
  asked.clear();
});

/**
 * The title of an article of the reader's, off the shelf the `@` list reads,
 * or null — including for an unread paper, which the list leaves out.
 */
async function shelfTitle(slug: string, openSlug: string): Promise<string | null> {
  try {
    return (await loadMentionCandidates(openSlug)).find((c) => c.slug === slug)?.title ?? null;
  } catch {
    return null;
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

  /* Wake when the POST answers; every write to `asked` is a new record. */
  useEffect(() => {
    if (state?.kind !== "sending") return;
    let live = true;
    void state.wait.then(() => {
      if (live) bump();
    });
    return () => {
      live = false;
    };
  }, [state]);

  const job = state?.kind === "queued" ? (queue.jobs.find((j) => j.id === state.jobId) ?? null) : null;
  const view = describeBringIn(state, job, openSlug);

  const hand = (slug: string, own: string | null) => {
    const refusal = bringIn({ slug, title: own ?? (title?.trim() || hostOf(url)) });
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
    if (view.kind === "ready") {
      hand(view.slug, view.title);
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
        /* A repeat answers with the slug alone; the shelf has its title. */
        const title = await shelfTitle(started.article, openSlug);
        if (asOf !== generation) return;
        asked.set(key, { kind: "have", slug: started.article, title });
      }
      else if (started && "id" in started) asked.set(key, { kind: "queued", jobId: started.id });
      else if (why) asked.set(key, { kind: "refused", message: why });
      /* Nothing to say (or a public copy, which `ownCopy` does not ask about):
         put the button back rather than leave a dead end. */
      else asked.delete(key);
    })();
    asked.set(key, { kind: "sending", wait });
    bump();
  };

  if (handed?.kind === "in") {
    return (
      <span className="bring-in bring-in-done" role="status">
        <Check size={13} aria-hidden="true" /> In the box below
      </span>
    );
  }
  const button = (
    <Tooltip
      placement="top"
      content={<ControlTip head="Bring into this chat" what={BRING_IN_HOW} how="Nothing is sent until you ask your question." />}
    >
      <button type="button" className="bring-in-button" onClick={press} aria-description={BRING_IN_HOW}>
        <ArrowDownToLine size={13} aria-hidden="true" />
        {label ?? "Bring into this chat"}
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
          {handed?.kind === "refused"
            ? note(handed.message)
            : view.kind === "offer" && view.after
              ? note(view.after)
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
