# A stream outlives the component that would refresh its result

Up: [postmortems.md](../project/postmortems.md).

Caught during review of `eaf3a3fee`; no evidence this reached readers. Start a chat from a
Debate claim, Send, and return to Debate before the first response. The answer can finish
successfully while the claim still has no conversation mark until a later refresh.

The class is **an asynchronous write outliving the owner of its result notification**. Chat's
controller deliberately lets a stream continue after the band unmounts. The claim's summaries
live longer, but their refresh was tied to leaving Chat rather than completing the write.
That departure can read the database before the thread exists. Nothing then notified the
remaining article view when the detached controller finished. Refreshing when opening a mark
could update an existing conversation, but could not discover one whose mark was absent.

`eaf3a3fee` introduced the claim mark and the departure refresh together. Earlier tests waited
for Send to finish before leaving Chat, so the departure snapshot already contained the thread.
They verified freshness at the mode boundary while assuming the write had finished there.

The regression in
[debate-check-claim-in-chat.test.tsx](../../tests/debate-check-claim-in-chat.test.tsx),
`refreshes the claim after an answer that begins and finishes after leaving Chat`, holds the
response until Debate has returned. It failed with `waited for the late answer on the claim,
and it did not happen`. The completion-refresh fix made both tests pass.

The durable fix makes completion notification live with the write, surviving the composer
unmount, and refreshes only the article that is still mounted. The callback is supplied by
Reader through the band to the controller; `useChatAnchors.refresh` refuses an old article's
completion. The controller notifies when an accepted turn, recovery or repair retires, including
retries and edits. A disconnection or refusal that hands work to recovery or repair postpones
notification until that successor finishes. Retiring the original turn while its answer is
still being recovered is a transfer, not an answer settling. The detached
completion and recovery regressions in
[chat-controller-notifies-once-per-task.test.ts](../../tests/chat-controller-notifies-once-per-task.test.ts)
pass with the existing notification tests: nine tests green.

Countermeasures, ranked by ease against value:

1. **Delay the response across unmount in an integration test.** Added here. Cheap controlled
   timing proves the write's real lifetime instead of assuming the screen's lifetime matches it.
2. **Keep result notifications beside the operation that survives.** The completion owner must
   follow transfers to recovery and refuse stale article callbacks. This also avoids depending
   on a mounted component to notice a stream ending.
3. **Poll every claim's conversations continuously.** Rejected: repeated requests hide the
   missing lifecycle event and keep running when no write needs discovery. A completion event
   answers exactly when the data can have changed.

The lesson is to trace both lifetimes: the component that starts a write may disappear, while
the component displaying its eventual result still needs to hear that the write finished.
