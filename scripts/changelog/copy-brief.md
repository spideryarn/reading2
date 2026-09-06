# Write the reader-facing copy for one version of the Spideryarn changelog

You are stage 4 of the process in `docs/project/changelog.md`. Read-only on the repo: **do not edit,
create or delete any file in it**, and run no version-control command that writes. The one file you
write is your output path, under `logs/`, which is gitignored and so is not part of the repo's
contents even though it sits inside the checkout.

## Do this

1. Read **`scripts/changelog/copy-prompt.md`** in full. It is your instructions — the audience, the
   output shape, the translation table, the link rules, the banned adjectives, the worked examples.
   Follow it exactly.
2. Read your **input file** (given below). It is the `{version, changes}` JSON that prompt describes.
3. Write **one JSON object** to your **output path**, in the shape that prompt specifies. Nothing
   else in the file — no prose, no code fence.

## The things people get wrong here

- **You may not introduce a fact.** Everything in an entry comes from the input. The items have
  already been verified against the diffs by a stronger model; your job is to say what they say, in
  the reader's words. If an item does not claim something got faster, your entry does not either.
  **No number may appear that is not in an item's `evidence`.**
- **Never quote or paraphrase a commit message**, and never name an internal file, module, symbol,
  table or model. The reader has only ever *used* the app.
- **`section` is one of `headline`, `enhancement`, `fix`**, ordered that way, at most two headlines.
  There is no section for engineering: a behind-the-scenes change takes whichever of the three it
  fits, or it does not go on the page.
- **Copy every sha exactly** into `commits`, all 40 characters. Never shorten, never invent.
- **`sources`** must be the zero-based indexes into the input `changes` array. Every input change
  should appear in some entry's `sources` unless you deliberately dropped it as too small.
- Only link to app addresses on the closed list in the copy prompt. A guessed URL is a 404.

## Check before you finish

Re-read your JSON against the checklist at the end of the copy prompt. Then confirm: it parses;
every `commits` entry is a 40-character sha present in the input; `sources` is non-empty on every
entry; sections are ordered and there are at most two headlines. Report the entry count per section
and nothing else.
