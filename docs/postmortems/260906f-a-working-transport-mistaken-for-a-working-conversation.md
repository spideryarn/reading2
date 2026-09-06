# A working transport mistaken for a working conversation

2026-09-06. [Repair plan and evidence](../plans/260906f-repair-realtime-chat.md) ·
[Live conversation contract](../project/live-conversation.md).

> Right now it seems completely broken - there's no tooltip, no UI indicator showing the volume of mic input, I can't hear anything, it doesn't seem to hear me, etc.
>
> — Greg, 2026-09-06

The original report reached a reader: Greg encountered this broken Chat experience. The additional
asynchronous and persistence orderings below were reproduced in this repair's tests and
investigation; they establish code paths and regression risks, not that those orderings happened
to Greg or that reader data was lost.

## Cause

**Failure class: a working transport mistaken for a working conversation.** The realtime preview rendered
the hook's errors, transcripts and tool activity. The actual chat composer rendered only its button.
It therefore hid the evidence needed to distinguish a connection failure, a microphone supplying
silence, blocked playback, or a model thinking. The same omission hid `show_passage`: the companion
could say it was pointing at a paragraph while the reader had no live link to it.

The shipping integration in `94ddccd42` introduced the button without the preview's feedback, and
disabled that button throughout startup. It also omitted Live from the list composer even though
the server supports a new thread with an empty seed and null tail. The missing tooltip was an
explicit `aria-label`-only choice in `src/web/live/LiveButton.tsx`; an accessible name did not provide
mouse users with an explanation.

**Failure class: capture configuration bypassed a shared boundary.** The first transport,
`0bfc30fea`, opened `getUserMedia({ audio: true })`. It ignored the microphone remembered by
dictation's `mic-devices.ts`. That helper already documents this Mac's silent Teams virtual default
input. Realtime had neither the captured device's name nor a local level meter, so the reader could
not discover or correct the mismatch. This is a demonstrated code defect, not proof that the same
virtual microphone caused Greg's particular attempt.

The same initial transport set `Audio.autoplay` but never observed `play()` rejection. A browser
refusing playback left the screen claiming the companion was speaking without a recovery action.

**Failure class: asynchronous startup had no owning lifetime.** The seed timer added in
`94ddccd42` checked shared state that initially said seeding was done. A channel that never opened
therefore escaped it entirely; earlier ticket and permission waits escaped too. When a seed timeout
did fire, setting the failure ref prevented teardown from returning to idle without ever setting
failed, leaving the button in `closing`. Its local timer was not cancelled on stop and could expire
inside the next session. Each ordering was reproduced by a failing test before repair.

**Failure class: device ownership mistaken for input intent.** The same integration,
`94ddccd42`, relied on the microphone lock to hand over to dictation, but Live requested its
ticket before claiming the device. Both ordinary Dictate buttons called dictation directly.
Choosing Dictate while that ticket was pending therefore started dictation successfully, then
the late Live ticket claimed the microphone and stopped it. The lock obeyed the last device
claim; that claim no longer represented the reader's last choice. The first repair covered the
new fallback button but missed the ordinary buttons. Sol's code review caught the omission.

The tool loop had the same ownership gap: returning a tool result could request another answer
before the provider finished the response that requested the tool. Multiple calls made that worse.
The original immediate continuation was introduced in `0bfc30fea`.

The accounting close callback had the same lifetime mistake. In `10bd79c4f` it began
assigning `endedBecause` before checking whether the channel still owned the session. A delayed
close event from session A could therefore change session B's eventual reason from `reader` to
`channel-closed`, while correctly refraining from closing B. The full-hook regression delivers that
delayed event after resume and observes both reported reasons; it failed before the unconditional
assignment was removed. Only the current session's guarded failure path now sets that reason.

**Failure class: an uncertain commit was reported before reconciliation finished.** In
`94ddccd42`, the spoken controller began its repair after a 409 but immediately told the live
hook that persistence failed. If the first POST had committed and lost its response, the retry's
409 was expected; repair then loaded the saved pair alongside the hook's restored, falsely
unsaved copy. The real controller/hook seam reproduced that ordering before the fix.

The repair now owns the provisional rows and waiter until its one bounded read finishes. A pair
must match immediately after the claimed tail, including the metadata the route actually stores;
the existing label truncation is shared in `src/spoken-label.ts`. An exact match transfers to the
stored rows and returns that answer's id. Later server turns do not silently become live history:
the next append still claims the recovered answer and conflicts if the thread has moved on.
Missing pairs and failed reads restore the live copy; a ten-second deadline aborts a hung read and
ignores its late response. The existing repair identity guard still protects newer local changes.

The same uncertainty exists when all retries lose their response, receive a server error, or return
malformed success bodies without ever reaching a 409. The effect now marks those outcomes uncertain
and sends them through the same repair. It preserves uncertainty from an earlier attempt even if a
later attempt receives a definite rejection. A first-attempt 4xx still fails immediately. Tests drive
the real retry effect for these outcomes and the real controller/live hook for the ownership handoff.

## Evidence that narrowed the diagnosis

**Failure class: a terminal event mistaken for a complete answer.** Sol's code review found
that the ledger settled every tool-free `response.done` without checking its status. Introduced
in `ae4ca4229`, this stored provider-failed partials as ordinary complete replies. Failed,
cancelled and incomplete provider responses now retain their words with the existing
`interrupted` marker; the saved UI says the spoken answer ended early, and normal history
filtering excludes that unfinished pair. Four assertions (three ledger statuses and the runtime
failure/accounting seam) were watched to fail before repair. The corresponding three-file
run then passed 138 tests. Testing terminal statuses separately would have caught the class.

Against `28096583`, an independent server investigation used the actual `liveSession` and
`mintLiveToken` with synthetic article text, no reader data, and no database writes:

- The configured local key minted a client secret successfully; the provider echoed
  `gpt-realtime-2.1` with 599 seconds remaining. The session accepted `gpt-live-transcribe`,
  semantic VAD, far-field reduction, Marin and all eight tools.
- A real provider WebSocket acknowledged both resume seeds as `conversation.item.added`, with
  user `input_text` and assistant `output_text`. No audio or `response.create` was sent.
- A read-only query against the configured local database, `127.0.0.1:54362`, found the journal
  table present and empty before browser reproduction. The old documentation claiming that its
  migration was still blocked was stale.
- The browser baseline then reproduced a successful ticket followed by an indefinitely disabled
  startup button in actual Chat. The silent-input preview produced streamed words, output audio
  events and tool results. See the [browser evidence](../plans/260906f-repair-realtime-chat-browser-results.md).

These observations exclude a broken local model name, transcriber name, seed schema or missing
journal migration. They do not prove physical microphone capture or audible speaker output.

The final gate also caught a test confusing settled component state with settled browser history.
`77e045a6e` asserted the reopened Chat URL after six zero-delay turns although nuqs throttles its
history write. The test now waits for the URL invariant. Removing the real `setThread(null)` still
makes it fail, proving that the wait preserves the navigation check. The same gate rejected the
new shared label helper until its import-free leaf was registered with the client purity guard.

## Repair

The real composer now shows `LiveStatus`: streaming transcript by default, actual input name and
shared level meter, quiet-input notice, tool/thinking/listening/speaking status, failures, playback
recovery and typed/dictated handoff. The existing microphone preference and picker helpers serve
both voice features. Changing device or noise-reduction mode flushes the current turn and reconnects.
Live passage links reuse `PassageLinks` and `BlockRef`, filtered against this article's actual ids.

Startup has one deadline owned by its session epoch, covering every wait and cleared on every exit.
Cancel remains available. Playback rejection has an explicit Enable sound action. Tool outputs are
returned once, with continuation deferred until their parent response finishes and the batch settles;
late results from an abandoned session cannot start a new answer.
Both ordinary Dictate buttons and the fallback now share one callback that cancels and awaits Live
before toggling dictation. The real Composer, Live hook and microphone lock regression starts
dictation during a pending ticket, returns that ticket anyway, and checks that dictation stays on
and no Live peer connection is created. Both Chat and Remember failed before that repair.

New-chat Live mints a thread, carries the unsent draft, and waits for selection to reach the render
before starting. Leaving an empty spoken thread waits for its flush before discarding; a late stored
id correction cannot pull the reader back into a conversation they left. Streaming lines transfer to
the chat controller when provisional rows register, rather than duplicating them until the request
finishes, and return to the live recovery display if persistence fails. A same-thread retry retains
those words and their unsaved label; leaving an otherwise empty thread does not discard its recovery
text.

## What would have caught the class

1. **Highest value, cheap:** mount the actual chat composer with failed, connecting, speaking,
   quiet-input and partial-transcript states. Assert visible feedback and a working next action,
   not merely the presence of a Live button. The original UI tests explicitly asserted that new
   conversations could not start from the list, so they agreed with the product gap.
2. **Highest value, cheap:** controllable deferred promises and timers across start, stop and
   resume. Test A-stop-B-start with A's deadline firing, an ignored permission prompt, and a
   rejected playback promise. These are covered in `tests/live-session-flow.test.tsx` now.
3. **High value, moderate effort:** browser-test the shipping composer at 320px and 400px alongside
   deterministic feedback states. A successful preview connection is evidence about the wire only.
4. **Useful complement:** small real-provider schema probes with synthetic context. Keep them
   separate from physical audio claims; neither a received audio event nor a moving synthetic meter
   establishes what a person could hear.
5. **A transport/SDK rewrite** — rejected. The real provider wire accepted the existing transport;
   the shipped gap was the Chat UI, microphone-input boundary, and session lifecycle. Replacing the
   transport would add cost without catching this class.

The watched UI failures and final targeted checks are in
[the raw UI results](../plans/260906f-repair-realtime-chat-ui-results.txt); transport orderings and
their checks are in [the runtime results](../plans/260906f-repair-realtime-chat-runtime-results.txt).
