# Review the built code: the gutter chip, help metadata, the teaching prompt, and the web search

You are reviewing **built code**, not a plan. You reviewed the plan earlier
(`docs/plans/260905c-gutter-comment-chip-plan-review-sol.md`); this is the second pass, and it
weighs more, because a plan-stage review cannot find a route that writes one field and rejects the
request.

Bias hard towards **simplicity and cleanness** — the reporter asked for that by name.

## The candidate

Worktree: `/home/greg/code/spideryarn2/.claude/worktrees/feedback-comment-chip`
Branch: `worktree-feedback-comment-chip`. **Two commits**, both to review:

- `77e045a6` — stage 1, the gutter chip (report 1Q)
- `HEAD` — stage 2, help metadata + teaching prompt + web search (reports 1R, 1S, 1X)

Base: `15f2cb39`. The scoped diff is:

```
git diff 15f2cb39...HEAD
git diff --stat 15f2cb39...HEAD      # for the file list
```

Everything is committed; there are no untracked files to hunt for.

## What it is meant to do

Read `docs/plans/260905c-gutter-comment-chip-explanation-metadata-and-prompt.md` first — it carries
the four reports verbatim, the decisions, both places I overruled you and why, and what was
deliberately deferred.

Four reader reports, all from the product owner:

- **1Q** the gutter's blue chat chip opened a new conversation instead of the ones it counted — and
  each press minted another, so the count grew.
- **1R** record that a conversation began with the "?" button.
- **1S** the "?" answer should open plainly and reach for an analogy or worked example.
- **1X** a comment asking for evidence did not search the web. Diagnosed as the *instruction*, not
  the plumbing: production logged the real turn as `rounds:2, tools:2, searches:0`, so the model was
  offered the search and declined.

## What I most want attacked, in order

1. **The route's `help` handling** (`src/routes.ts`, `src/chat.ts`, `src/store/pg-chat.ts`). This is
   where your plan-stage P1 landed: `help` is per-turn on the wire, persisted on the **user message
   row**, and on retry/edit must be derived from the **stored** row rather than accepted from the
   client. Check that is actually what the code does — including that a retry of a help question is
   still answered with the help prompt, that `false` on the wire is a 400 rather than a coercion,
   and that nothing lets a later ordinary turn relabel a stored row.
2. **The `useChat.send` signature change.** It became an options object because a tenth positional
   argument is how a field lands in the wrong slot. It touched ~21 call sites across production and
   tests. Check none of them changed meaning — especially the `send(…, false)` sites, where
   `useProfile` was positional. One test fakes `useChat` in a `vi.mock` factory and is therefore
   **not type-checked**; it was already broken by this and fixed. Are there others like it?
3. **Prompt caching.** `helpSection()` must sit below the `cache_control` breakpoint and change
   nothing above it. There is a test asserting byte-identity; check the test actually proves that
   rather than sharing an assumption with the code.
4. **The 1X wording, against 1S's.** These pull in opposite directions — the teaching addendum leans
   towards answering from the article, the search change leans towards leaving it. `helpSection()`
   deliberately says nothing about sourcing. Did that hold? Did the "USE web search unless you are
   genuinely sure" bullet survive intact?
5. **The migration.** `drizzle/20260905103814_chat_messages_help.sql` is additive with a CHECK and
   deliberately has **no backfill** (that was your F-02, partially overruled — the reason is in the
   plan). Is the CHECK right? Does anything read the column expecting a backfill to have happened?
6. **The explain.ts tripwire fix.** The `from` value `"neither"` could never be logged. The fix is
   `if (chunk.usage) from = counted.from` rather than unconditional assignment — the author's reason
   is that assigning on every chunk would reset a real answer to `"no-usage"`. Is that right, and is
   the test able to fail?

## Severity scale

| | |
|---|---|
| **P0** | data loss, exploitable security, incorrect charging, or the service broadly unusable |
| **P1** | user-visible wrong behaviour, or an authoritative contract violated |
| **P2** | design or maintainability risk with no wrong behaviour today |
| **P3** | non-behavioural prose or comment defect |

Give every finding an ID and a severity. Run any test you like — the tree is complete and
`npx vitest run <file>` works. Anything needing Postgres or a network is mine to run: say so rather
than asserting a result. Note that `tests/store-migration-registry.test.ts` and
`tests/admin-store.test.ts` are red for reasons that predate this work.

End with a one-line verdict: land it / land it with these changes / do not land it.

## My own suspicions, worth less than yours

Spend most of the run elsewhere.

- The two `ChatDialog.tsx` changes (stage 1's "New conversation" link, stage 2's `help` wiring) were
  made by different agents an hour apart and I have not read them together.
- `threadFor` and `helpThreadFor` in `useChatAnchors.ts` are now two similar functions with
  deliberately different rules. Is that a distinction a reader will keep straight, or two things
  that should be one with a flag?
- The author reports that `converse` never passes an anchor to `buildConverseMessages` at all — so
  `anchorSection`'s "sent on every turn" docblock may describe something that does not happen. That
  is pre-existing and was left alone. Is it real?
