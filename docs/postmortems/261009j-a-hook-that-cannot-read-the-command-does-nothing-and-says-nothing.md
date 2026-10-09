# A hook that cannot read the command does nothing, and says nothing

Up: [postmortems.md](../project/postmortems.md) · change:
[plan 261009p](../plans/261009p-the-commit-hook-reads-only-one-commit-command-in-seven.md)

On 2026-10-09 `tests/screenshots-compressed.test.ts` went red on `dev` at least four times, each
time because a session committed plan screenshots without running `npm run screenshots:compress`,
and each time found an hour later by a full suite or the readiness loop, blocking deploys
(c7f389ebd, aee8df569, 0e745191e and 2a7841322 fixed them, and four more sessions compressed their
own after the fact). Nothing reached a reader; the failures kept `dev` from being ready to deploy.
The Overseer's brief called the class *a slow gate is the only gate for a fast mistake*, and asked
for a gate at commit time.

There already was one. `.claude/hooks/compress-commit-pngs.sh` (261007m, `02ceadd60`, 2026-10-07)
runs before every Bash command, recognises a `git commit`, and compresses the PNGs it carries. It
was registered, it fired, and on the commits that broke `dev` it did nothing.

## The root cause

The hook acts only on a commit it can read for certain. Its parser (`commit_command.py`, shared
since `2d709cc13`) returns `None`, meaning "leave it to the test", for any `$`, glob, `~` or newline
anywhere in the command, any pipe or redirect, and any segment but a leading `cd`, `git add` and
`npm run check:staged-revert`. Each refusal is reasonable on its own; every one was written to stop
the hook acting on something it had misread. Together they describe a command few sessions write.
Over three days of transcripts on the box, 131 of 908 commit commands could be read (14%), and 20 of
the 67 that named a PNG. The misses were ordinary: `-F $SP/msg.txt`, a heredoc message,
`; git log -1 | cat`, `&& git fetch && git merge`, `docs/plans/261009m-shots/*.png`.

The reason nobody noticed is the same reason the hook was safe to install: it never blocks and it
is quiet on any error. Quiet on an error, and quiet on "I could not read this", are the same output,
and both are also what a commit without screenshots produces. The tests the hook shipped with fed it
commands written to the house recipe, so they exercised the 14%.

## The class: a guard that reads its input conservatively, and stays silent when it declines

A conservative reader is right when declining is safe. When the declining is the failure, "read it
for certain or not at all" turns every ambiguity into a silent miss, and the miss rate is set by how
people actually write the input, which nobody measured. This is
[silent-success.md](../reusable/silent-success.md)'s shape with one extra turn: the check did run,
did see the commit, and decided correctly by its own rules that it had nothing to do.

`regenerate-commit-generated.sh` (261007q) reads commits through the same parser, in a stricter
mode, because it rewrites the command and grants permission. It misses at least as often, and its
failure is the generated-file tests going red later.

## The fix, and the one that is right for the long term

**Built here** (261009p): when the parser declines, the hook falls back to changed screenshots the
command *names* (the file, its folder as a whole word, or a glob over its folder), found on disk and
compared with `HEAD` by raw hash rather than inferred from `git status`. A false positive compresses
a changed screenshot under `docs/` that the commit then leaves out, which has to be compressed
before it is committed anyway. The parser still decides when it can. Measured red first: four real
command shapes covering five screenshots from 2026-10-09 failed against the old hook.

**Right for the long term: a git `pre-commit` hook**, which gets the exact file list of every commit
from git itself, from Claude, Codex, a human in a terminal or the Overseer, with no shell parsing at
all. It needs `core.hooksPath` set on the shared repository, and
[260902b](../plans/260902b-protect-main-from-an-accidental-push.md) ties that one flip to the
`pre-push` hook protecting `main` (security-risks.md R9) and a `pre-commit` running
`check-staged-revert`, which Greg asked to be planned and not yet built (2026-09-02). So this is a
question for Greg, not something to slip in: **a `pre-commit` that refuses an uncompressed docs PNG
is a third reason to make that flip, and the cheapest of the three to land.**

## What would have caught it, ranked by ease against value

1. **Measure a guard against real input before trusting it.** The transcripts are on the box; the
   script that counted 131 of 908 is ten lines (in the plan). A parser that declines is a filter,
   and a filter's pass rate is a number someone has to look at once. Done here, and the habit is
   what carries.
2. **A guard that declines says so, when declining could matter.** Not on every command: on a
   commit that changes a docs PNG and that it could not read, one line of `additionalContext` would
   have told each session what to run. Subsumed here for the ordinary command shapes measured above;
   still the right default for the regenerate hook, which now does exactly that
   ([261009t](../plans/261009t-the-regenerate-hook-says-when-it-declines-a-commit-that-names-its-sources.md)).
3. **The git `pre-commit` hook** above. The only option with no parsing in it. Greg's call.
4. **Compress at capture** (in the screenshot helpers) — rejected again for 261007m's reasons:
   several capture paths, and it misses a copied-in or hand-made shot.
5. **Make the slow test faster or run it more often** — rejected. It is already fast; nobody runs
   it because nobody touched it. The gate has to be on the commit, not on the suite.
