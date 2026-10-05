# A slice between two markers can be empty, and replace with an empty needle succeeds everywhere

Up: [postmortems.md](../project/postmortems.md) · the guard:
[261005m](../plans/261005m-a-docs-size-cap-and-a-chat-tools-test-that-stops-doing-dns.md)

On 2026-10-03 one commit took a plan doc from 17 KB to 22 MB. It sat on `dev` for two days, until the
session building the follow-on work (261005i) opened it. **Nothing reached a reader.**
The damaged plan is not part of the production site. The cost was the two days, one agent's detour
to restore it, and a 22 MB blob that is in the repository's history for good.

## What happened

Commit f36b4507d changed
`docs/plans/261003m-citations-influence-unknown-unless-confident-and-dig-deeper-fills-it-in.md` by
297,999 lines. Its inflated portion was the old file with the same 1,278-byte question block,
`**[Q-crossref-count]** …`, before every character and after the last, followed by a new section.

The session that wrote it (transcript 0ddfccba, 20:32:46Z) was replacing a short question with a
longer one. It did not use the Edit tool. It ran a Python heredoc:

```python
old = s[s.index("**[Q-crossref-count]** Should a row with a DOI"):s.index("**[Q-bar-on-relevance]**")]
s = s.replace(old, new)
```

The intent was "everything from the first question up to the next one". But the second marker
appears twice in the file. Its first appearance is in an earlier section, in a sentence that says
the question is *below*:

```
index of "**[Q-crossref-count]** Should a row…"   12555
index of "**[Q-bar-on-relevance]**" (first)        4319   ← the mention, not the heading
```

`s[12555:4319]` is not an error in Python. It is `""`. And `s.replace("", new)` is not an error
either: the empty string is found at every position, so `new` goes in at every position. Running
those two lines with the heredoc's actual replacement (1,284 bytes) against the last good version
gives 22,487,524 bytes. The same script appended 2,306 bytes, bringing it to 22,489,830 bytes.
The next command shortened each of the 17,500 inserted blocks by 6 bytes, removing 105,000 bytes
and leaving the committed 22,384,830 bytes. The block in the commit is therefore 1,278 bytes.
The plan review's 22,382,524-byte reproduction used that final block, rather than the initial
heredoc's replacement.

## The class, named: an edit whose target was computed, and came out empty

Two total functions in a row, each of which treats "I found nothing" as a legitimate answer:

- **A slice between two markers** is empty whenever the end marker is found before the start
  marker. A marker that names a thing tends to appear wherever the thing is *mentioned*, which is
  usually before where it is defined.
- **`replace` with an empty needle** matches everywhere. Python's `str.replace` and JavaScript's
  `replaceAll` insert the replacement at every position in the string.

The general shape is a [silent success](../reusable/silent-success.md): the edit reported nothing
because, by its own definition, nothing went wrong. It is the same family as `s.replace(old, new)`
where `old` is not in the file at all, which changes nothing and also says nothing.
For an existing file with non-whitespace text, Edit rejects an empty `old_string`;
it rejects an absent target, and by default it also rejects multiple matches. An empty needle is
allowed when creating an absent file or replacing whitespace-only contents, and `replace_all`
explicitly permits multiple matches.

**The sibling.** The same session's next command, 35 seconds later, has the habit that is meant to
catch this, and it would not have:

```python
assert old in s
```

`"" in s` is true for every string. The assertion that fails on the empty needle, the absent needle
and the ambiguous needle alike is `assert old and s.count(old) == 1`. The explicit nonempty check
also covers an empty source, where `"".count("") == 1`.

No second inflated file is on disk today. The three largest Markdown files under `docs/` (428 KB,
338 KB, 296 KB) were checked and are long by honest means.

## Why nothing went red

- **The script.** No exception, no output. It then wrote the file.
- **The tests the session ran straight afterwards** (`doc-links`, `citations-panel`, `help-page`):
  148 passed. The replacement split the original links between their characters.
  Only the two links from the append remained recognizable. The checker validates links it
  discovers; it cannot notice that the original eight links disappeared.
- **The commit.** `git commit -q -F msg -- docs src evals`. `-q` drops the line that would have said
  `298395 insertions(+)`, and a directory pathspec means no one named the file. The session read
  `git status --short` and `git log --oneline -1` afterwards, neither of which shows size.
- **The full suite**, started in the same command seconds after the commit: red, with
  8 failed files, 7 failed tests, 32,151 passed and `EXIT=1` (transcript 21:27:32Z).
  None reported the inflated doc; no test measured its size. The session fixed its client-import
  failure and later ran a targeted set: 14 files, 601 passed, 2 skipped. Typecheck passed too.
- **The reviews.** GPT Sol's stage review had been committed four minutes before the edit. The plan
  was being updated *after* its last review, to record that review, which is the normal order here
  and means the final edit to a plan is the one nobody else reads.
- **The later edit.** Commit 5312d3a42, at 21:31:13Z, appended to the damaged plan almost an hour
  later without repairing the inflation.

The recorded authoring session contains no warning about the inflation.

## What would have caught it, ranked by ease against value

1. **A size cap on `docs/`, in the suite** — `tests/docs-size-cap.test.ts`:
   listed binary extensions at most 4 MB, everything else 1 MB, read from the working tree.
   Hidden paths are included; symlinks are refused rather than skipped. **Done.** Seen red on the
   22 MB file itself, and it rebuilds the incident's two lines in a test of its own. It is aimed wider than this bug on
   purpose: a pasted log or an inlined image trips it too. It does not catch an empty-needle
   replace with a *short* replacement on a short file, which doubles or triples a doc and stays
   under the cap. That part of the class is left to item 2.
2. **Edit a doc with the Edit tool; if it must be a script, `assert old and s.count(old) == 1` before
   every replace.** Costs nothing and closes the whole class, short replacement included. It is a
   habit, so it lives in prose, and the doc it belongs in is a rule doc that is edited one approved
   set at a time. **Proposed to Greg in the debrief, not yet written anywhere but here.**
3. **Do not pass `-q` to `git commit`.** The stat line is one line and it is the only place the
   commit says how big it was. Same status as item 2.
4. *A commit-time check* (a git hook, or more work for `check:staged-revert`) — rejected. The repo
   has no hooks, and item 1 would have been red in the suite started seconds after the commit,
   before the push.
5. *A detector for repeated text* — rejected. It is aimed at the instance.

## The fix that is right for the long term

Item 2. The cap is a net under the commonest way this ends; it does not stop a computed, unchecked
needle being handed to `replace`. What stops that is not computing the needle: name the exact text
to be replaced, and let the tool refuse when it is absent or ambiguous. Scripted edits to prose
exist here because a heredoc can make four edits in one tool call. That is a real saving, and it is
bought by giving up the one check the Edit tool does for free.

## The thing I would tell myself

I did not write the edit, but I have written that line, and for the same reason: I knew what the
section looked like, so I described it by its two ends instead of quoting it. The description felt
more robust than a quotation, because it would survive small changes to the text in between. It was
less robust in the one way that mattered. A quotation that is wrong fails. A description that is
wrong returns something.
