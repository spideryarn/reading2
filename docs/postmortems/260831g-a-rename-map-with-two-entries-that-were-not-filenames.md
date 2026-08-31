# A rename map with two entries that were not filenames

Back-filling date prefixes onto `docs/plans/`, `docs/research/` and `docs/postmortems/` renamed 745
files and rewrote 4,135 references to them. 92 of those rewrites turned the ordinary English word
**reviews** into a filename, in 60 files, including live source:

```ts
-    let reviews = 0;
+    let 260826ad-reviews = 0;
```

Caught by `npm run typecheck` before anything was committed. Never landed.

## The real cause

The rename map was built by listing each directory and renaming **every entry**. `docs/plans/`
contains an empty subdirectory called `reviews`, so `reviews → 260826ad-reviews` went into the map
beside 744 genuine filenames.

The sweep then had two rules: rewrite path-qualified references (`docs/plans/foo.md`), and rewrite
**bare** ones (`foo.md` in a comment, which is how most of this repo cites its plans). The bare rule
matched on exact map keys, and one of those keys was a common word with no extension. Every "two
reviews found this" in the repo became a filename.

The directory rename itself was also pointless: `reviews` is empty and untracked, so there was
nothing there to date-stamp.

## The check that agreed with the bug

Before running the gates I did look for over-replacement. That check listed every rewrite and
eyeballed the result — but it filtered to names ending in `.md` or `.diff`:

```python
grep -oE '[0-9]{6}[a-z]+-[a-z0-9-]+\.(md|diff)'
```

The only two map entries that could cause this failure — `reviews` and `decorated-mode` — have no
extension, so the check could not see them however many times it ran. It came back clean, and clean
was the wrong answer. This is [silent-success.md](../reusable/silent-success.md) exactly: the check
shared its central assumption ("a map key is a filename") with the code that was wrong.

`tests/doc-links.test.ts` was clean too, for a different reason: `260826ad-reviews` was never
written as a markdown link, so there was no link for it to resolve. It is a link checker, not an
edit checker, and it never claimed otherwise.

Typecheck caught it, and only because one of the 92 hits happened to be a variable name in a `.ts`
file. Had `reviews` appeared only in prose and comments, every gate in the repo would have gone
green on 92 corrupted sentences.

## The fix

Revert the 92 replacements, and put the empty directory back under its own name. The generalisable
half:

- **A bulk-edit map should be filtered to what it claims to be.** Entries with no file extension are
  not filenames; a directory is not a citation target. Both should have been dropped before the
  sweep, not repaired after it.
- **A bare-name rewrite rule needs the name to look like a name.** Requiring an extension would have
  made this class impossible rather than detectable.

## What would have caught the class

Not another eyeball pass. The check that works is a **property of the map, asserted before the
edit**: every key must end in a known document extension, and any key that does not must be named
explicitly as an exception. That is one line, it runs before any file is touched, and it fails on
the input rather than on the damage.

The weaker version — diff the rewrites and read them — is what I did, and it is what missed it,
because the filter I chose to make the diff readable was the same assumption that was wrong.

## See also

- [rename-or-move.md](../reusable/rename-or-move.md) — a rename is never one edit
- [silent-success.md](../reusable/silent-success.md) — the shape this bug has
- [write-planning-doc.md](../reusable/write-planning-doc.md) — the naming convention being back-filled
