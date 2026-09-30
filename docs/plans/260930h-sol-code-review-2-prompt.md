Second, small code review in this worktree. Read-only: do NOT edit files. Write findings to your answer.

After your first review ("ship after my fixes"), a WebKit touch check (iPad UA, hasTouch, locator.tap)
found that on a tap the Tooltip card opens from compatibility mouse events and stays visible until
the next tap elsewhere, sitting over the post above. The fix: in src/web/Tweets.tsx § CopyButton the
Tooltip now gets `enabled={state === "idle"}`, so the press (which moves state to done/failed)
closes the card via Tooltip.tsx's disabledWhileOpen effect. A new test in
tests/tweets-copy-icons.test.tsx "put the card away when pressed" was red before the fix, green after.

Check: is this correct and complete? After the 1.6s reset re-enables it, can the card pop back on
its own (touch: a stale hover open state; mouse resting on the button; keyboard focus still on the
button)? Read src/web/Tooltip.tsx § enabled / disabledWhileOpen and Floating UI useHover/useFocus
behaviour. Any regression for mouse or keyboard users? Any false comment? Scoped tests:
`npx vitest run tests/tweets-copy-icons.test.tsx`.

End with VERDICT: ship / fix first (with the fix).
