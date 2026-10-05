# A slice between two markers can be empty, and replace with an empty needle succeeds everywhere

Up: [postmortems.md](../project/postmortems.md) · the guard:
[261005m](../plans/261005m-a-docs-size-cap-and-a-chat-tools-test-that-stops-doing-dns.md)

On 2026-10-03 one commit took a plan doc from 17 KB to 22 MB. It sat on `dev` for two days, until the
session building the follow-on work (261005i) opened it. **Nothing reached a reader**: docs are not
served. The cost was the two days, one agent's detour to restore it, and a 22 MB blob that is in the
repository's history for good.

## What happened

Commit f36b4507d changed
`docs/plans/261003m-citations-influence-unknown-unless-confident-and-dig-deeper-fills-it-in.md` by
297,999 lines. The new file was the old one with the same 1,278-byte question block,
`**[Q-crossref-count]** …`, before every character and after the last.

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
those two lines against the last good version gives 22,382,524 bytes: the bad commit's file, less
the 2,306 bytes the same script appended afterwards.

## The class, named: an edit whose target was computed, and came out empty

Two total functions in a row, each of which treats "I found nothing" as a legitimate answer:

- **A slice between two markers** is empty whenever the end marker is found before the start
  marker. A marker that names a thing tends to appear wherever the thing is *mentioned*, which is
  usually before where it is defined.
- **`replace` with an empty needle** matches everywhere. Python's `str.replace`, JavaScript's
  `replaceAll` and `split("").join(x)`, and `sed 's//x/g'` on some inputs all do it.

The general shape is a [silent success](../reusable/silent-success.md): the edit reported nothing
because, by its own definition, nothing went wrong. It is the same family as `s.replace(old, new)`
where `old` is not in the file at all, which changes nothing and also says nothing. The Edit tool
refuses both: an empty or absent `old_string` is an error, and so is one that matches twice.

**The sibling.** The same session's next command, 35 seconds later, has the habit that is meant to
catch this, and it would not have:

```python
assert old in s
```

`"" in s` is true for every string. The assertion that fails on the empty needle, the absent needle
and the ambiguous needle alike is `assert s.count(old) == 1`.

No second inflated file is on disk today. The three largest Markdown files under `docs/` (428 KB,
338 KB, 296 KB) were checked and are long by honest means.

## Why nothing went red

- **The script.** No exception, no output. It then wrote the file.
- **The tests the session ran straight afterwards** (`doc-links`, `citations-panel`, `help-page`):
  148 passed. Every link the plan had was still in it, about 17,500 times over.
- **The commit.** `git commit -q -F msg -- docs src evals`. `-q` drops the line that would have said
  `298395 insertions(+)`, and a directory pathspec means no one named the file. The session read
  `git status --short` and `git log --oneline -1` afterwards, neither of which shows size.
- **The full suite**, started in the same command: green. No test measured a doc.
- **The reviews.** GPT Sol's stage review had been committed four minutes before the edit. The plan
  was being updated *after* its last review, to record that review, which is the normal order here
  and means the final edit to a plan is the one nobody else reads.
- **Everyone after.** The plan's later commits (5312d3a42, bd5f4bdc1), an hour later, changed the same
  file again and did not notice.

Nobody raised it and was talked round. Nobody saw it.

## What would have caught it, ranked by ease against value

1. **A size cap on `docs/`, in the suite** — `tests/docs-size-cap.test.ts`: text at most 1 MB,
   anything else 4 MB, read from the working tree. **Done.** Seen red on the 22 MB file itself, and
   it rebuilds the incident's two lines in a test of its own. It is aimed wider than this bug on
   purpose: a pasted log or an inlined image trips it too. It does not catch an empty-needle
   replace with a *short* replacement on a short file, which doubles or triples a doc and stays
   under the cap. That part of the class is left to item 2.
2. **Edit a doc with the Edit tool; if it must be a script, `assert s.count(old) == 1` before
   every replace.** Costs nothing and closes the whole class, short replacement included. It is a
   habit, so it lives in prose, and the doc it belongs in is a rule doc that is edited one approved
   set at a time. **Proposed to Greg in the debrief, not yet written anywhere but here.**
3. **Do not pass `-q` to `git commit`.** The stat line is one line and it is the only place the
   commit says how big it was. Same status as item 2.
4. *A commit-time check* (a git hook, or more work for `check:staged-revert`) — rejected. The repo
   has no hooks, and item 1 is red in the suite the author was already running two minutes later,
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
