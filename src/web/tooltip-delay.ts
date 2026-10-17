/**
 * Long enough that crossing the rail on the way somewhere else doesn't fire a
 * dozen tooltips; short enough that pausing on a band feels like an answer
 * rather than a wait. Closing is quick but not instant, so a wobble of the
 * mouse between two adjacent bands doesn't blink the panel out and back.
 *
 * Its own module, not Tooltip.tsx, because useDelegatedCard.tsx reads it too
 * and seventeen tests mock Tooltip.js wholesale: a constant there went missing
 * from under every card those tests hover.
 */
export const DELAY = { open: 240, close: 90 } as const;
