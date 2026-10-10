/**
 * **The Feedback dialog's unsent words, kept in this browser so a reload does
 * not lose them.** Greg, 2026-10-09 (`spya-exhqqr`), after the page hung with a
 * report half written: *"I wonder if it's worth auto-saving the feedback dialog
 * every few seconds after a debounce, so that if … the page does get lost or
 * blocked, it can reload."* Plan
 * docs/plans/261010f-feedback-dialog-send-after-dictation-and-a-saved-draft.md,
 * stage 2.
 *
 * **One record per reader**, `spya.feedbackDraft.<reader>`, keyed the way
 * docs/project/auth.md § Browser storage that is a reader's is keyed by that
 * reader says. The words and the kind only: not the screenshot (too big for
 * `localStorage`), and not the diagnostics tick-box, which is consent for one
 * report and is given again. A spoken draft is kept separately until its words
 * land (dictation-keep.ts); this keeps the words once they are in the box.
 *
 * **Several tabs: last write wins.** A tab reads the record only when its
 * dialog mounts, so two open tabs never fight over a box on screen; a reload
 * brings back whichever tab wrote last. Each record carries the id of the
 * report it was saved from, and a tab removes a record only when that id is
 * its own, so filing a report in one tab does not wipe another tab's draft.
 *
 * **Gone** when its report is filed, when the reader presses Sign out, and
 * when it is read more than a week after it was saved — the same three as the
 * dictation copy, and /privacy says so.
 *
 * Every call is wrapped: storage that is full, blocked or missing costs the
 * copy, never the dialog.
 */
import type { FeedbackKind } from "../types.js";
import { storageReader } from "./lib/storage-reader.js";

export interface FeedbackDraft {
  body: string;
  kind: FeedbackKind | null;
}

interface Saved extends FeedbackDraft {
  /** The report id of the tab that saved it: whose record this is to remove. */
  id: string;
  /** When it was saved, in ms. */
  at: number;
}

/** A draft older than this is not offered back, and is removed when read. */
export const FEEDBACK_DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const keyFor = (readerId: string): string => `spya.feedbackDraft.${storageReader(readerId)}`;

function read(readerId: string): Saved | null {
  try {
    const raw = localStorage.getItem(keyFor(readerId));
    if (raw === null) return null;
    const v = JSON.parse(raw) as Partial<Saved> | null;
    if (
      v === null ||
      typeof v.body !== "string" ||
      typeof v.id !== "string" ||
      typeof v.at !== "number" ||
      !(v.kind === null || v.kind === "problem" || v.kind === "suggestion")
    ) {
      localStorage.removeItem(keyFor(readerId));
      return null;
    }
    return { body: v.body, kind: v.kind, id: v.id, at: v.at };
  } catch {
    return null;
  }
}

/**
 * The reader's saved draft, or null. Read once, when the dialog mounts. A
 * stale or malformed record is removed rather than offered.
 */
export function readFeedbackDraft(readerId: string): FeedbackDraft | null {
  const saved = read(readerId);
  if (saved === null) return null;
  if (Date.now() - saved.at > FEEDBACK_DRAFT_TTL_MS || saved.body.trim() === "") {
    forgetFeedbackDraft(readerId);
    return null;
  }
  return { body: saved.body, kind: saved.kind };
}

/** Save this tab's draft, made under report `id`, over whatever was there. */
export function saveFeedbackDraft(readerId: string, id: string, draft: FeedbackDraft): void {
  try {
    const saved: Saved = { body: draft.body, kind: draft.kind, id, at: Date.now() };
    localStorage.setItem(keyFor(readerId), JSON.stringify(saved));
  } catch {
    /* Full or blocked: the in-page draft is unaffected. */
  }
}

/**
 * Remove the reader's saved draft — only if it was saved under report `id`,
 * when one is given, so a tab removes its own record and never another tab's.
 * Without an id (Sign out, a stale record) it goes whoever saved it.
 */
export function forgetFeedbackDraft(readerId: string, id?: string): void {
  try {
    if (id !== undefined && read(readerId)?.id !== id) return;
    localStorage.removeItem(keyFor(readerId));
  } catch {
    /* Nothing to do. */
  }
}
