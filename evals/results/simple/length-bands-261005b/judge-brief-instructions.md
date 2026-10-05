# Instructions to the blind judge, round three (Brief)

You are judging pairs of short summaries. Read ONE file and nothing else:
`evals/results/simple/length-bands-261005b/pairs-brief.md`. Do not read any other file in the
repository, do not search it, and do not run any command except to read that file and write your
answer. In particular never open a file whose name starts with `key`.

Each pair is two short summaries ("Brief") of the same piece, A and B, in a random order. Each
is meant to be a one-glance orientation for a reader in a hurry who does not know the field and
is about to read the piece: what it is about, why it matters, what it found or concluded. Above
each pair is either the whole piece (when it is short) or the piece's headings.

Judge each pair on its own. The two sides may differ a little in length. **Do not count length
itself for or against either side.** Ask what the words were spent on.

For every pair write a section headed `## P01` (the pair's own id) with exactly four lines, each
starting with the label, then one verdict word, then a full stop and one or two sentences of
reason that quote the words you mean:

- `pad:` which side spends words on something a reader in a hurry does not need: repetition,
  filler, the summariser's own commentary, a detail that is not the point. Verdict: `A`, `B`,
  `both` or `neither`.
- `bent:` which side loses, bends or blurs a claim: a dropped hedge, a hardened verb, a wrong
  number or direction. Verdict: `A`, `B`, `both` or `neither`. When you only have the headings,
  say so and judge the two against each other.
- When the whole piece is given, `omit:` which side leaves out a point the piece itself marks as
  important, quoting the passage. Verdict: `A`, `B`, `both` or `neither`.
  When only headings are given, write `coverage:` instead: which side gives a truer picture of
  the whole piece, judging by the headings. Verdict: `A`, `B` or `same`.
  Write exactly one of these two lines, never both.
- `prefer:` which would you rather be given before reading the piece, as a reader in a hurry.
  Verdict: `A`, `B` or `no` (no real difference).

Write your answers to `evals/results/simple/length-bands-261005b/judge-brief.md`, starting with
the line `# Blind judge answers, round three (Brief)`. Answer every pair in the file, in order.
Your final message back should be one line saying how many pairs you answered.
