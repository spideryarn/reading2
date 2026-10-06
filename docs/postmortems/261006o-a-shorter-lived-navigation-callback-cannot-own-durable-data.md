# A shorter-lived navigation callback cannot own durable data

Nothing reached a reader: round two of the code review caught this in the unreviewed fixes from
round one. A saved comment was first linked locally to a chat's guessed id. If the reader left Chat
before the server corrected that id, the server stored the right link but this tab kept the guess
until reload. Server id correction is rare, but the lifetime mistake was exact.

## What happened

Commit `2c75820ae1d27bf5ab00d4c885dc4c0ec63bc384` added the saved comment's corrected-id update to
`SendOptions.onThreadId`. That callback also changes `?thread=`, so `useChat` deliberately removes
it when the conversation band unmounts: a late answer must not navigate a screen the reader has
left. The request and controller outlive the band. Their `begin` frame could therefore correct the
chat after the only callback that would correct the comment had gone.

The red test held the `begin` frame, unmounted the band, then released a different server id. Before
the fix it reported only the guessed id:

```text
expected [ "spya-fspjbt" ] to deeply equal [ "spya-fspjbt", "spya-rgn444" ]
```

## The class: durable repair in an ephemeral navigation channel

An asynchronous result often has two consumers with different lifetimes: durable data repair must
finish after its view goes away, while navigation must stop at unmount. Giving both to the
shorter-lived callback makes the cleanup correct for one responsibility and destructive for the
other.

This code already had the right separation. `onConfirmed` is data-only and survives `detach`;
`onThreadId` belongs to the screen and is cleared. `ChatDialog` also states and uses that split. The
new call crossed it because both consumers happened to receive the same corrected id.

## Why nothing went red

Round one's corrected-id test returned the `begin` frame while `ConversationBand` remained mounted,
so the navigation callback was still present. Existing leave-before-`begin` tests covered origin
and draft repair through `onConfirmed`, but did not include a saved-comment handoff. StrictMode's
synthetic cleanup was tested; the distinct real-unmount-after-send lifetime was not.

## What would have caught it, ranked by ease against value

1. **Hold the acknowledgement past unmount** — the new regression test does this and asserts that
   the durable callback still receives the corrected id. Done.
2. **Classify every async callback by owner lifetime at the call site** — use `onConfirmed` for data
   and `onThreadId` for navigation, even when both currently consume the same value. The controller
   API already makes the distinction; the fix now follows it.
3. **Encode the distinction in callback types** — rejected. Both callbacks are `(id: string) =>
   void`; brands or wrapper objects would add ceremony without preventing a caller from putting the
   wrong side effect in either body. A lifecycle test checks the property directly.

## The fix that is right for the long term

Keep URL correction alone in `onThreadId`. Report a server-corrected saved-comment id from
`onConfirmed`, beside the existing origin/draft bookkeeping that already has the same lifetime.
Keep the immediate guessed-id notification so the mark links to the optimistic conversation at
once, and report from `onConfirmed` only when the server changes it.

That is also the implemented fix; no broader abstraction is needed because the controller already owns
the right two channels.

## The thing I would tell myself

I saw one corrected id and treated its consumers as one callback. I should have asked how long each
side effect was allowed to live: the URL belongs to the mounted band, while the saved comment
belongs to the article and must be repaired after that band is gone.
