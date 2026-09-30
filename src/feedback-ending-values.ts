/**
 * **The three endings a feedback note may name.** An import-free leaf so the
 * note compiler can run even when its generated output is missing or contains
 * merge-conflict markers; src/feedback-ending.ts adds the generated map on the
 * server side.
 */
export const FEEDBACK_ENDINGS = ["shipped", "declined", "awaiting"] as const;
export type FeedbackEnding = (typeof FEEDBACK_ENDINGS)[number];
