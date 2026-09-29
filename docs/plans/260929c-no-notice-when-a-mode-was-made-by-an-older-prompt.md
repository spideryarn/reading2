# No notice when a mode was made by an older prompt

> I'm seeing "This route was planned by an older version of the prompt. Plan it again". Maybe provide a x for me to hide that. Or perhaps even don't bother showing it. There are probably lots of cases where the prompt will get out of date, and it's not worth bugging the user about it.
>
> — Greg, 2026-09-29, SPIDERYARN-READING2-55

His last thought wins, as the Overseer relayed it: **stop showing the stale-prompt notice**, in
Trajectory and in every other mode that shows one. Re-running lives in Metadata
([260929b-one-place-to-re-run-ai-processing](260929b-one-place-to-re-run-ai-processing.md), fb4z,
report 53).

UI only: no server, step, prompt or stamp change.

## Three kinds of "this is out of date", and which go

Every generated mode can know three different things about its result:

| | what it means | shown today as | after this |
|---|---|---|---|
| **stale** | the article changed under the result, so a passage it points at may have gone or moved | a banner with a redo button | **kept** — the result may now be *wrong*, and the banner is the only place a reader learns it |
| **profile changed** | the result was shaped for a profile the reader no longer has | a banner (Trajectory, Ideas, Quotes, …) | **kept** — it is about the reader, not the prompt |
| **outdated** | the article is the same; we would write it differently now (older prompt or model) | "…by an older version of the prompt" + a redo button | **gone** — Greg's report |

The `outdated` flag itself stays on the server and in the hooks: freshness logic, the Metadata re-run
rows and other readers of it (Quotes hides *Find more* on an outdated list; the Trajectory stop card
treats outdated sources as usable) keep working. Only the notice goes.

**Where a banner combines reasons** (Trajectory's `outdatedBy` picks the most serious of stale,
profile changed, outdated), only the outdated arm goes; stale and profile changed still show.

## The nine panels

Trajectory, Ideas, Timeline, Debate, Quiz, Quotes, Glossary, Citations and FAQ — every `*Panel.tsx`
with an "older version of the prompt" notice or an `owner.outdated` branch (grep, recorded in
Progress).

**One side effect to watch — Quotes' *Find more*.** It is hidden on an outdated list, on purpose
(plan 260924d, *choose them again on an outdated quote list*: extending a list chosen by an
older prompt mixes two prompts' spans). Without the banner, an outdated Quotes list simply has no
*Find more* and says nothing about why. Left as it is: re-running in Metadata replaces the list and
brings *Find more* back. Named here so it is a decision, not an accident.

## The status-only footers stay, and lose their outdated gate

fb4z's review added a footer to Ideas, Timeline, Debate, Quiz and Trajectory (and Thread's `RunFoot`)
drawn **only while a job is starting, running or failed** — the one place a run started from
Metadata shows its progress, its Stop and its failure. They stay. Ideas, Timeline, Debate and
Trajectory gate them on `!owner.outdated` / `!outdatedBy(owner)`, because the outdated banner used to
carry the job's progress itself; with that banner gone the condition must go too (keeping only the
stale / profile-changed gate where those banners still carry the job), or a run on an outdated result
would show nowhere. A test for each: an outdated result with a job running shows the footer.

## Order of work, with fb4z

fb4z removed the *standing* redo buttons from the same panels (report 53) and its plan kept the
outdated banners; this plan removes those. Sequenced by message: fb4z's work landed first
(`e0aacef8`, 04:53), its worktree is gone, and this plan builds on it. Its Trajectory tests that
press *Plan it again* through the **outdated** banner move to the **stale** one, which keeps its
button. A line goes in its note, `docs/user-feedback/260929_0355-modes-lose-their-redo-buttons.md`,
saying 55 answered its open question about the out-of-date banner buttons.

## Tests and checks

- Each panel's test that asserts the outdated notice is changed to assert it is **absent** on an
  outdated, non-stale result; the stale and profile-changed banners are asserted still present.
  Red first: the new absence assertions fail before the edit.
- Gates: typecheck, the panel tests, `every-mode-draws-its-surface`, doc-links.
- Sol plan review, Sol code review, a quick Sonnet browser check on one outdated route (Trajectory)
  and one outdated list (Ideas or Quotes).
- A feedback note for report 55.

## Progress

- 2026-09-29 — plan written; fb4z's panel work is on `dev` (`e0aacef8`), this starts from it.
- GPT Sol plan review ([prompt](260929c-plan-review-prompt.md), [answer](260929c-plan-review-sol.md)),
  *approve with changes*. Taken: **F1** Glossary's *Find more* is hidden on an outdated list, as
  Quotes' is — there it would replace the list, not add to it; **F2** Quiz is the fifth footer gate,
  and Trajectory's becomes an explicit `!stale && !profileChanged`; **F4** the docs named. Not taken:
  **F3**, the citations chat tool telling the *model* its list came from an older step — context
  for the model, not a notice in a mode, and it helps the model qualify an answer. Sol confirmed
  Quotes' hidden *Find more* is right, and that no Metadata row, shelf, command bar or visitor view
  shows the outdated verdict.
