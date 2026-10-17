/**
 * ***Bring into this chat*** — the pure half: which addresses in a draft get
 * a button, and what a button says, given what was asked and where its import
 * has got to. The button itself is BringIntoChat.tsx.
 *
 * A web page enters a conversation the one way an article does: it becomes
 * one of the reader's own articles (the ordinary import, `POST /api/jobs`),
 * then a chip in the composer's "Bringing in" row, exactly as an `@` pick
 * (plan docs/plans/261012d-chat-at-mention-your-own-articles.md). Nothing is
 * sent by the press; the reader's next question carries the chip. Plan
 * docs/plans/261017e-bring-a-web-page-into-chat.md; Greg's 1A on q-madusw.
 */
import type { Job } from "../types.js";
import { urlKey } from "../ingest.js";
import { webLinks } from "../urls.js";
import { worthRetrying } from "../messages.js";
import { MENTIONS_MAX_PER_QUESTION } from "../chat-mention-limits.js";

/**
 * What was asked about one address, in this tab. A module map holds these,
 * keyed on `urlKey`, so an import outlives the button that started it.
 */
export type BringInAsked =
  | { kind: "sending"; wait: Promise<void> }
  | { kind: "queued"; jobId: string }
  /** On the reader's shelf already, so the add was free; its title if the shelf could say. */
  | { kind: "have"; slug: string; title: string | null }
  | { kind: "refused"; message: string };

/** What the button draws. */
export type BringInView =
  /** Press to import, with the last refusal under it when there was one worth another go. */
  | { kind: "offer"; after: string | null }
  | { kind: "working"; line: string }
  /** An article of the reader's: a press adds the chip at once, nothing spent. */
  | { kind: "ready"; slug: string; title: string | null }
  /** The address is the article this conversation is about. */
  | { kind: "open" }
  | { kind: "refused"; message: string };

/** The line while no step is running — before the first, and between two. */
export const ADDING = "Adding it to your shelf…";

/** What the press costs, said before it. billing.md. */
export const BRING_IN_HOW =
  "Adds the page to your shelf, which uses one article from your allowance, then brings it into this conversation. Free if it is on your shelf already.";

/** Said when the address is the open article. */
export const OPEN_ALREADY = "This is the article this conversation is about.";

/**
 * The button, as arithmetic: what was asked, the job's latest snapshot (by
 * id), and the open article's slug. `describeAdd` in ProseHoverCard.tsx is the
 * same decision for the link hover card, and the reasons for each branch are
 * written there; what differs is that a finished import is `ready`, since a
 * chip needs only the slug.
 */
export function describeBringIn(
  asked: BringInAsked | undefined,
  job: Job | null,
  openSlug: string,
): BringInView {
  if (!asked) return { kind: "offer", after: null };
  const ready = (slug: string, title: string | null): BringInView =>
    slug === openSlug ? { kind: "open" } : { kind: "ready", slug, title };
  switch (asked.kind) {
    case "sending":
      return { kind: "working", line: ADDING };
    case "have":
      return ready(asked.slug, asked.title);
    case "refused":
      return worthRetrying(asked.message)
        ? { kind: "offer", after: asked.message }
        : { kind: "refused", message: asked.message };
    case "queued":
      if (!job) return { kind: "working", line: ADDING };
      switch (job.status) {
        case "queued":
        case "running": {
          const step = job.steps.find((s) => s.status === "running");
          return { kind: "working", line: step?.label ?? ADDING };
        }
        /* `done`, not the article opening early: a mention is refused until
           the import has published (`admitMentions`, src/chat-mentions.ts). */
        case "done":
          return ready(job.slug, job.title ?? null);
        /* The sentence and no button: a fresh add is not a retry of this job
           (ProseHoverCard.tsx § describeAdd, Sol 2026-09-05 P1-2). */
        case "error":
          return job.error ? { kind: "refused", message: job.error } : { kind: "offer", after: null };
        case "cancelled":
          return { kind: "offer", after: null };
      }
  }
}

/**
 * The web addresses in a draft that get a button: `http(s)` only, as Chat's
 * own links are found (`webLinks`), each once by `urlKey`, in order, and no
 * more than one question can bring in.
 */
export function pastedAddresses(draft: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const link of webLinks(draft)) {
    const key = urlKey(link.url);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(link.url);
    if (out.length === MENTIONS_MAX_PER_QUESTION) break;
  }
  return out;
}
