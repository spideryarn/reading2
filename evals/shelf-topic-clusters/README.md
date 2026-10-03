# Shelf topics as concepts: model-proposed topics against embedding clustering

The eval behind
[investigation 261003b](../../docs/investigations/261003b-shelf-topics-as-concepts-not-phrases.md),
which has the question, the arms, the numbers, the caveats and the commands to run it again. It
reads the cases of [`../shelf-topics/`](../shelf-topics/README.md) and compares against that eval's
`luna-score` arm, which is today's production list.

`run.ts` and `file-one.ts` are **paid** (a few cents in all). Per-run lists under `results/<case>/`
are regenerable and not committed; `results/summary.md`, `results/pairs/`, `results/pairs-key.json`,
`results/judgements/` and `results/file-one.txt` are the evidence and are.

The judge is a fresh Opus subagent per case that reads only `results/pairs/<case>.json` and writes
`results/judgements/<case>.json`. Check each file landed: one judge reported writing a file it had
not written.

## The shipped tree

`hier.ts` (**paid**, about eight cents) runs the product's own `rethink` and `fileWorks` on
greg-wide and on `shelves/expert.json`, and writes `results/hier-<shelf>.md`: the tree, how well it
matches what the articles were written to be about, and how well held-out articles are filed
afterwards. Its header says what it does not show.

## One real shelf

`npm run shelf-topics:preview -- --owner <email or uuid> [--archived] [--members]`
(`preview-shelf.ts`) prints a real shelf's size and today's pills beside the proposed ones. It
reads inside one read-only transaction, makes one paid call of about a cent, and records nothing.
Its header says what "today" means there and what it leaves out.

## The judge's brief

Each judge was given this, with its own case's file name, and nothing else:

> You are a blind judge. Read ONLY this one file: `results/pairs/<case>.json`. Do not read any
> other file in that repo (in particular no "key" file, no run.ts, no summary), and run no git
> commands.
>
> The file describes one reader's shelf of saved articles (their profile, and each article's title
> and one-sentence gist), then several "pairs". Each pair has two candidate lists, A and B, of
> "topic pills": a row of chips above the shelf. Clicking a pill filters the shelf to that topic's
> articles (listed under it); clicking a second pill narrows to articles in both. Only about the
> first 12 pills in a list are visible without expanding.
>
> For each pair decide which list this reader would rather filter their shelf with: "A", "B" or
> "tie". Judge as the reader: are the topics the high-level concepts they would use to organise
> their own articles; do the articles under each topic really belong there; does the list cover the
> shelf; is it free of generic or arbitrary labels and near-duplicates; and is choosing two pills
> together still useful. Also score each list 1-10 on three things: meaningful (labels are concepts
> this reader would file under), membership (articles under each topic belong there, and few that
> belong are missing), coverage (most of the shelf is reachable).

followed by the JSON shape to write. **The brief asks for "high-level concepts"**, which is Greg's
own criterion from the report and also what the new arms were told to produce. A judge asked
instead for the most specific useful filters might have scored production higher.
