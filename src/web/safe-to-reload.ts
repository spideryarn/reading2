/**
 * **Whether this page can be reloaded right now without the reader losing
 * something they have not sent.**
 *
 * Asked by the one page that reloads itself, `/changelog`, when a new build is
 * live (stale-shell.ts § `reloadForNewBuild`). A reload looks free from a page
 * with no form on it, and is not: this app keeps unsent work in memory *on
 * purpose*, so that it survives going to another page, and a reload is the
 * one thing it does not survive. GPT Sol's review of plan
 * docs/plans/261005d-notice-a-deploy-on-wake-and-reload-the-changelog.md found
 * each of these by reading for it (F1, F2, F4); "the reader is on a page with
 * nothing to lose" cannot see any of them.
 *
 * **A veto is a line in `VETOES`**, and each asks the module that owns the
 * fact rather than keeping a copy. Add to the list; do not add a second list.
 * It is also the start of what a full page load on navigation would need —
 * the half of that plan which was not built, for want of exactly this across
 * every subsystem.
 *
 * Not here, because it cannot be true on `/changelog`: a save still on its way
 * (useAutosavedText.ts). The boxes that own one are unmounted by then, and
 * unmounting is the ordered path. A second page that reloads itself would have
 * to add it.
 */
import { anyChatDraftHeld } from "./chat-draft.js";
import { isConnected } from "./offline.js";
import { unloadGuarded } from "./unload-guard.js";

export interface ReloadVeto {
  /** A short name for the reason, for a test or a log line; never shown. */
  why: string;
  holds: () => boolean;
}

/**
 * Whether the Feedback dialog holds words or a screenshot. The dialog's draft
 * is React state inside a component mounted once for the whole signed-in app
 * (FeedbackButton.tsx § `FeedbackHost`), so that it survives navigation and
 * being dismissed; nothing outside it can read that. The dialog says so here.
 */
let feedbackDraft = false;

/** FeedbackDialog.tsx reports its draft becoming non-empty, and empty. */
export function noteFeedbackDraft(held: boolean): void {
  feedbackDraft = held;
}

const VETOES: readonly ReloadVeto[] = [
  /* A reload with no server behind it is a browser error page, in an app that
     may have no back button and no address bar. Both facts, because each
     misses a case: `navigator.onLine` is true on a captive portal, and
     `connected` is only as fresh as the last request. */
  { why: "offline", holds: () => !isConnected() || navigator.onLine === false },
  /* Unsent Chat and Remember words, on any article — chat-draft.ts. */
  { why: "chat-draft", holds: anyChatDraftHeld },
  { why: "feedback-draft", holds: () => feedbackDraft },
  /* An upload or a batch in flight: the very fact that warns on closing the
     tab, so the two cannot disagree — unload-guard.ts. */
  { why: "upload", holds: unloadGuarded },
];

/** The first reason not to reload, or `null` when there is none. */
export function reloadVeto(vetoes: readonly ReloadVeto[] = VETOES): string | null {
  return vetoes.find((v) => v.holds())?.why ?? null;
}

export function safeToReload(vetoes: readonly ReloadVeto[] = VETOES): boolean {
  return reloadVeto(vetoes) === null;
}
