# A focus fix that only misbehaved under StrictMode

Caught in review, cost nothing, and would have shipped a change that **took the keyboard away from
the reader it was written to help** — in development, which is where every browser check runs. It is
worth a file for two reasons: the class is not the one this plan has already named three times, and
finding it turned up a diagnostic I had not used before and will again.

## What happened

Stage 5a of
[260906f](../plans/260906f-the-active-mode-gets-one-surface-and-one-way-to-fit-the-screen.md) gave
`ChatDialog` the focus restore it had none of. The reader presses the block gutter's **Help**, the
panel opens and focuses its composer, and on close the panel now hands focus back to where they were
— because otherwise it unmounts the element they are standing on and their next Tab starts again from
the top of the article.

The restore lives in an effect's cleanup, which is the pattern `CommentDialog` and the Dock drawer
already use:

```ts
useEffect(() => {
  const panel = box.current;
  const back = opened.opener;
  return () => {
    /* …restore focus to `back`… */
  };
}, [opened]);
```

**`src/web/main.tsx` wraps the whole app in `<StrictMode>`.** StrictMode runs every effect
**setup → cleanup → setup** on mount. So that cleanup fires *once, immediately, while the dialog is
perfectly well mounted* — and restored focus to the Help button. The composer's own second setup did
not take it back, because the nonce ref it guards on had already advanced.

The result: press Help, get a chat panel with **no caret in it**. Worse than the gap being fixed, and
present only in code written that day.

Every test passed. None of them used StrictMode.

## The real root cause

Not StrictMode, and not the cleanup. Both behaved exactly as documented.

The cause is that **the harness ran a configuration production never runs.** The app is wrapped in
`<StrictMode>` at its only entry point — there is no build in which it is absent — and the tests
mounted the component bare. So the fix was verified in a world with one effect lifecycle against an
app with another, and the difference is precisely the thing the fix is about.

Ask why once more and the general shape appears: **a component's behaviour is a function of what it
is mounted inside, and a test that supplies its own wrapper has chosen an answer to that.** Providers,
Suspense boundaries, `<StrictMode>`, error boundaries, routers — every one of them changes what
"mount" and "unmount" mean, and a test harness that omits one is not a smaller version of production,
it is a different one.

## The class: *the harness omitted what production wraps everything in*

Say it in a sentence: **the component was tested outside the wrapper it is never rendered outside
of.**

It is a **sibling** of
[260907b](260907b-a-test-blurred-away-the-condition-it-existed-to-test.md) — both are the harness
describing a world the reader is not in — and it is worth telling apart, because the two are found
differently. There, the fixture reached the right *state* by a route the scenario does not use, and
the cure is to take the reader's route. Here the state and the route were both right, and the
**context** was wrong; no amount of care inside the test would have found it, because the missing
thing was outside the test.

It also has a distinctive smell the other does not: **the defect exists only in development.**
StrictMode's double-invoke is a development behaviour, so this could never have been caught by
reasoning about what ships. It would have been caught by anybody opening the reader and pressing
Help — which is exactly what browser checks are for, and none had been run on it yet.

## Which commit introduced it

`3381e700`, on `dev` for about ninety minutes. Found by GPT Sol's stage-5a code review before any
browser check ran, and fixed in `b04e939a`. **Nothing reached a reader**: the affected path is the
chat draft's composer focus, in development builds.

## The fix

**Shipped, and it is the right one:** the restore is deferred by one microtask and checks
`isConnected`.

```ts
queueMicrotask(() => {
  if (panel?.isConnected !== false) return;   // still mounted ⇒ StrictMode's synthetic cycle
  /* …restore… */
});
```

Asking `isConnected` *synchronously* does not work, and the reason is the same fact that had already
caused a different bug in the same effect: **React runs cleanups before it detaches the subtree**, so
the panel is still in the document on a real unmount too. One microtask later they separate cleanly —
a real unmount has detached, StrictMode's cycle has not.

The `activeElement` question stays synchronous, because by the microtask focus has already fallen to
`<body>` and the answer would be useless. So the two halves of the same cleanup deliberately run at
different times, and the comment in the code says why.

Rejected: making the composer's second setup re-focus. It treats the symptom, leaves the restore
firing on a mounted dialog, and would have to be repeated in every surface that takes focus on open.

## What would have caught the class

Ranked by cost against value.

1. **Mount the way the app mounts.** The cheapest, most general fix, and the one adopted:
   `tests/chat-dialog-gives-focus-back.test.tsx` § *under StrictMode* renders inside `<StrictMode>`
   and asserts the composer still holds the keyboard. Watched failing against the old code, with
   focus on the Help button. **Any test about an effect's lifecycle should do this**; it costs one
   wrapper. Not proposed as a blanket rule for every test in the repo — most do not depend on effect
   ordering, and a rule that broad would be ignored.
2. **A browser check on the change.** Would have found it in seconds, because the symptom is "press
   Help, get a panel you cannot type into". None had been run yet — the change was ninety minutes
   old. Worth remembering that a focus change is a *visible* change, and the eye is cheap.
3. **The mutation that refuses to fail is itself the signal.** This is the new one, and it is
   general. After fixing this I deleted the fix and re-ran, expecting red — and got green. That was
   not the fix being unnecessary; it was **the new test passing for the wrong reason**: it asserted
   synchronously, before the microtask it was supposed to be observing. With an `await` it reddened
   correctly.

   The lesson is narrow enough to keep: **when a mutation you expect to break something does not,
   the first suspect is the test, not the code.** It is the same instinct as "watch it fail before
   you trust it", pointed at the fix instead of the bug, and it caught a sixth instance of the
   green-for-the-wrong-reason family on this plan.
4. **Asserting the wrapper in the test setup.** Rejected. A helper that renders inside every provider
   production uses sounds right and drifts immediately — the day someone adds a provider, the helper
   is the thing nobody updates. Mounting the way the app mounts is the same idea without the
   indirection.

## The one sentence

**A component's behaviour includes what it is mounted inside** — so a test that supplies its own
wrapper has already answered a question it looks like it is not asking.
