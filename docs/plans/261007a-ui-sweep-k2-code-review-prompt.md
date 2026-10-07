# Review: K2 of the UI sweep. Keys pressed while an input method is composing

Repo: this worktree (`/var/tmp/spideryarn-worktrees/agent-a5509682377cc2ace`), branch
`worktree-agent-a5509682377cc2ace`. TypeScript, ESM, React 19, vitest with jsdom. Read `CLAUDE.md`
§ Working agreements first.

Nonce, to echo on the first line of your answer: `K2-REVIEW-7f3a91`.

## The candidate

Committed: base `edce9846f`, head `67ce4c833`.

    git diff edce9846f...67ce4c833
    git diff --stat edce9846f...67ce4c833      # the complete list of changed paths

Start with: `src/web/useEscapeToClose.ts`, `src/web/Dock.tsx` (the drawer's Escape listener only),
`src/web/ChatPanel.tsx`, and `tests/one-escape-closes-one-surface.test.tsx` (the last 190 lines).
That is where to begin, not the limit of scope: the diff is.

Also part of the candidate, and to be read as a reviewer of its conclusions, not only of the code:
`docs/plans/261007a-ui-sweep-k2-composition-keys.md` (the census, the evidence, what was left) and
the new section of `docs/project/keyboard.md`, "A key an input method is using is not ours".
The specification is `docs/plans/261007a-ui-sweep-umbrella.md` § K2 and K2's line in its File
manifest.

## What it is meant to do

A reader typing Japanese or Chinese presses Enter to accept a candidate word and Escape to dismiss
the candidate list. While a composition is open, no text box in this cluster may save, send, clear,
cancel or navigate on those keys, and no surface may close. `isImeComposing` in
`src/web/key-chord.ts` is the one test (native `isComposing`, React's `nativeEvent.isComposing`,
or `keyCode === 229`).

The rules the builder was given:

- The two shared listeners are fixed centrally: `useEscapeToClose` and the Dock drawer's capture
  listener.
- Where a handler calls `stopPropagation` on purpose, the composition test goes **after** it, so a
  composing key is contained like any other.
- Where a box sits in a form that would submit implicitly, a composing Enter is `preventDefault`ed
  (`DebatePanel.tsx` is the model). Elsewhere a composing key is left untouched; in `CommandBar`
  the test comes before any `preventDefault`.
- No new hook, wrapper or abstraction. `isImeComposing` is the tool.
- `PageContents.tsx`'s contents entries get a visible `:focus-visible` mark, inset, in
  `--highlight-text`.

One thing was added beyond the umbrella, from a browser measurement: a `type="search"` box is
emptied by Chrome itself on Escape, so the five search-type boxes in this cluster `preventDefault`
a composing Escape and do nothing else with it.

Deliberately out of scope: any file outside K2's manifest line (the plan doc § Left names the
defects found there and not fixed), the `Passages` props and sentences in `Library.tsx`, every
`.css` file, and anything in `CommentDialog.tsx` beyond its two key handlers.

## What was measured in a browser

Headless system Chrome, this worktree's dev server, a real composition opened with CDP
`Input.imeSetComposition` and a key sent while it was open (the page saw `isComposing: true`,
`keyCode` 27 or 13). On the fixed build: the chat composer kept its draft and the panel on Escape;
the rename box neither saved on Enter nor cancelled on Escape and sent no write; Help's search did
not navigate on Enter or clear on Escape; the shelf's and /profile's searches likewise; Search
mode's box (words matcher) kept its text; Annotate's box kept its draft and stayed open. An
ordinary key after each still did the old thing. On the intermediate build without the search-type
cancel, Help's and the shelf's boxes were emptied by the composing Escape.

The contents list on /profile after real Tab presses, both themes: before, `outline: none`; after,
`solid 2px` at offset `-2px`, 7.29:1 on the dark page and 5.70:1 on the light one, nothing drawn
outside the button.

You cannot run a browser. The numbers are in the plan doc.

## What you can and cannot run, and what you may change

You may edit this worktree. **Fix what is inside this cluster, narrowly and red-first** (write the
test, see it fail for the right reason, then fix); **report, do not fix, anything wider**, including
anything in a file outside K2's manifest line. Do not commit. Do not run any git command that
discards work. List every file you changed at the end.

You have no network, not even loopback: run a single test file with `npx vitest run tests/<one>`
or a script with `node --import tsx <script>`. `npm run typecheck` works. Do not run the whole
suite.

## Attack it

Independently, before you read my suspicions at the end. The statement to break is:

> For every Enter or Escape handler on a text box in K2's files, and for the two shared listeners,
> a keydown with `isComposing: true` or `keyCode: 229` changes no state, closes nothing, and is
> still contained wherever the same key without the flag was contained; and the same key without
> the flag behaves exactly as it did before this change.

Then two direct questions:

1. **Does any change alter what a reader sees or what a key does beyond what the plan says?**
   Including a reader who never uses an input method.
2. **Is the census in the plan doc accurate?** Is there an Enter or Escape handler, a shared
   listener, or a form in `src/web` it does not list, or one whose verdict is wrong?

For each finding give:

- an ID (`K2-F1`, `K2-F2`, …), a severity, and whether it is established or reasoned
- (a) the input or mutation that shows it
- (b) the smallest change that closes it, and whether you made it

Severity, by consequence:

| | |
|---|---|
| **P0** | data loss, exploitable security, incorrect charging, or the service broadly unusable |
| **P1** | user-visible wrong behaviour, or an authoritative contract violated |
| **P2** | design or maintainability risk with no wrong behaviour today |
| **P3** | non-behavioural prose or comment defect |

End with a verdict line: **ready**, **ready with these fixes**, or **not ready**. Refuse only on an
established P0 or P1, and name what established it.

## My own suspicions, read last

These are already my doubts, so confirming them is worth less than anything you find yourself.

- The Dock drawer stops a composing Escape (`stopImmediatePropagation`) and then ignores it. I chose
  that so the key is contained as an ordinary one is. Is there a listener behind it that a
  composing Escape now needs to reach and cannot?
- The five search-type boxes `preventDefault` a composing Escape. I believe that cannot stop a real
  input method dismissing its candidates, because the input method has the key before the page
  does. If you know an engine where it can, say so.
- `TitleEditor` now tests Enter before its `if (e.key !== "Escape") return`. Check an ordinary Enter
  still submits and nothing else changed.
- The sentence I would least like to be wrong about is in the plan doc § What the umbrella got
  wrong: that implicit form submission on a composing Enter is a precaution and not an observed
  defect. If you can show a path where it is real for a form I left alone, that is a finding.
- `tests/eager-client-graph.test.ts` gained `src/web/key-chord.ts` on its shared list. Is the
  comment there true?
