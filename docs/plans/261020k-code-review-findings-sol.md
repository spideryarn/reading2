# Code review findings: reading another conversation in full

F1 — Medium — `src/chat-tools.ts:2411`, `src/chat-tools.ts:2454`

An explicit JSON `null` cursor is treated as though `before` were absent. With a thread,
`reader_notes({ thread: "spya-…", before: null })` silently returns the newest page; without a
thread, `reader_notes({ before: null })` silently returns the notes and conversation index. That is
the plausible-result fallback the cursor validation is meant to prevent: a malformed paging call
can repeat a page, or read the other tool shape, without telling the model its cursor was unusable.
Only an absent `before` property should mean “newest”; an explicitly present null should get the
same “whole number” or “needs thread” sentence as other wrong-typed values.

F2 — Medium — `src/converse.ts:688`, `src/converse.ts:1481`

Both prompts say to “keep calling until you reach exchange 1”, but `converse` offers tools for only
three rounds (`MAX_TOOL_ROUNDS`). A conversation needing four sequential pages therefore reaches a
final round in which `reader_notes` is unavailable while the prompt still requires another call.
The model is not told to acknowledge that it has not reached the start, so it can imply that it read
the requested conversation in full or give up by asking for a tool that cannot run. The prompts
should require paging while the tool remains available and, if a returned page still names an
earlier one when tools stop, require the model to say it has not reached the start, carry the exact
`before` number into its visible reply (tool results are not stored in the next turn), and ask the
reader to continue in another turn.
