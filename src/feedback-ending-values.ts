/**
 * **The three endings a feedback note may name.** An import-free leaf so the
 * note compiler can run even when its generated output is missing or contains
 * merge-conflict markers; src/feedback-ending.ts adds the generated map on the
 * server side.
 */
export const FEEDBACK_ENDINGS = ["shipped", "declined", "awaiting"] as const;
export type FeedbackEnding = (typeof FEEDBACK_ENDINGS)[number];

/**
 * The longest a note's `comment:` line may be: one line under a row in the
 * Earlier tab. Here, in the leaf, because the note compiler refuses a longer
 * one and the dialog refuses to draw one, and neither may import the other.
 */
export const MAX_FEEDBACK_COMMENT_CHARS = 240;
