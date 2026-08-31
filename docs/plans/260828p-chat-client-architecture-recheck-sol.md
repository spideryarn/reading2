**Verdict: do not ship.**

The one thing that must change is the lifecycle claim around `showing`.

The test is mechanically sound:

- Its unkeyed `Harness` preserves `running.current`.
- The retry remains inside `run` because it awaits the deferred repair.
- `running` is exactly 1, so `> 1` does not hide the missing guard.
- The title assertion distinguishes the same-ID threads.

But this is not the reader’s lifecycle. Production keys `Reader` by slug ([App.tsx](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/App.tsx:413)), so both `useChat` instances remount. The abandoned hook cannot overwrite the new hook; its `showing` ref does not change either. The test creates a same-hook slug transition that production does not.

Therefore the [comment](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/useChat.ts:653), [test docstring](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/chat-error-scope.test.ts:23), and [write-up](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/plans/260828p-chat-client-architecture.md:135) must describe this as defensive hook-level behavior, not a reader-visible cross-article race.

The other corrections are right:

- `live`, not `phase`, provides stale-load safety.
- There are ten `setComments` sites.
- Deferring the three remaining error guards to step 2 is the right call; do not add them now.

No regression found. The two focused files pass: 14/14 tests.