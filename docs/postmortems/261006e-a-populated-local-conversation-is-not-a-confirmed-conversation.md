# A populated local conversation is not a confirmed conversation

Up: [postmortems.md](../project/postmortems.md). Found in the code review of
`c6e162610`; deployment impact was not checked. Four reducer tests reproduced
an unsaved typed question disappearing after two transient failures.

An initial Send that fails before `begin` keeps its question and error answer
in `base`. The thread remains `unnamed`, but the UI offers Retry on the answer
and Edit on the question. The new failure/disconnect branches withdrew those
attempts and asked for a repair. When the server correctly answered that the
conversation did not exist, `repair.succeeded` removed the entire local draft.

The class is **local content mistaken for server confirmation**. The inference
that Retry/Edit implies a stored conversation was false: the failed Send had
populated it locally. The server mints the Send's message IDs (`withTurn` in
`src/chat.ts`), so these later attempts cannot match the provisional question
or answer, and neither can create the conversation.

The two new call sites in `c6e162610` introduced the regression. Its tests began
with loaded conversations, so the premise was true in every tested Retry/Edit.
The original 409 path can already erase such a draft and remains outside this
fix; it needs a separate decision about refusal on unsaved rows.

The narrow fix requires a confirmed conversation for the two new withdrawal
paths. An unnamed draft retains the previous commit behavior. Its held rename
is intentionally retained for a later successful Send, rather than stranded
after the draft disappears. All four Retry/Edit × failed/disconnected tests
were observed red at the question assertion: actual `undefined` instead of
`my draft` or `my revised draft`.

Countermeasures, ranked by cost against value:

1. Exercise the feature after a failed first action, not only after loading
   stored data. Added the four tests with a held rename and a missing repair
   result; each checks the reader's words and retirement of the attempted turn.
2. Use the existing `unnamed` evidence at the transition that chooses a repair.
   An operation's shape alone does not prove a conversation exists remotely.
3. Hiding Retry/Edit on unsaved rows was rejected for this review: it would
   change the UI's existing behavior and widen the task. Making those controls
   actually resubmit provisional words is a possible later product change,
   not something this preservation fix establishes.
