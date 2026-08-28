# A cache entry a crash half-wrote, and the article that could never be read again

**Found 2026-08-28**, by writing the failure down as a test before changing anything. Truncate one
file under `data/<slug>/pdf-chunks/` — exactly what a killed process leaves behind — and run the PDF
extract step again:

```
SyntaxError: Unexpected end of JSON input
 ❯ Module.runPdfExtract src/pdf-read.ts:814:22
    812|     const cached = await readFile(cacheFile, "utf-8").catch(() => null…
    813|     if (cached) {
    814|       reading = JSON.parse(cached) as ChunkReading;
       |                      ^
    815|       result = checkChunk(reading, chunk, pass, seen);
```

Not a cache miss. A `SyntaxError` out of the whole step, and the article can never be extracted
again, on any machine, however many times anybody presses Retry.

## Root cause

Two ordinary defects, neither of which is interesting on its own. It is the pair that is the trap.

**The write was not atomic.** [`src/pdf-read.ts`](../../src/pdf-read.ts) cached each transcribed
chunk with a plain `writeFile`, which truncates its target before it writes. A process killed in
that window — a deploy, a Ctrl-C, an OOM-killed container — leaves a file that **exists** and does
not parse.

**The read tolerated a missing file but not a damaged one.** `readFile(…).catch(() => null)` covers
the read. `JSON.parse` was on the next line, outside it. So "no file" was a miss and "half a file"
was a crash.

**And what closes the trap is that the key is deterministic.** The cache key is a sha256 of the
source hash, the page range, the context page, the prompt fingerprint, the reader id and
`maxTokens` — nothing in it changes between runs, by design, because that is what makes the cache a
cache. Every later attempt therefore computed the *same* key, found the *same* broken file, and
threw the *same* error. Nothing in the codebase deletes these files: not on failure, not on success,
not on Retry. And the failure was a bare `SyntaxError` with a stack in `runPdfExtract`, so the
message never named the file a human would have to delete by hand.

The blast radius is one article per damaged file and it is permanent. Worse, the wedged step is the
expensive one: PDF extract is the only stage in the pipeline that pays a vision model per page.

### The codebase already contained the correct answer

This is the part worth keeping. Every sibling of this cache reads its own checkpoint tolerantly, and
they were all written **before** the broken one:

| Where | How it reads back | Landed |
|---|---|---|
| [`src/labels.ts`](../../src/labels.ts) `readJsonIfPresent` | `try { JSON.parse(await readFile(…)) } catch { return undefined }` | `3385866`, 2026-08-26 10:26 |
| [`src/summarise.ts`](../../src/summarise.ts) `readJson` | same shape | before |
| [`src/ideas.ts`](../../src/ideas.ts) `readJson` | same shape | before |
| [`src/tweets.ts`](../../src/tweets.ts) `readJson` | same shape | before |
| [`src/glossary.ts`](../../src/glossary.ts), [`src/arc.ts`](../../src/arc.ts) (`meta.json`) | `.then(raw => JSON.parse(raw)).catch(() => null)` — parse **inside** the chain | before |
| **`src/pdf-read.ts`** | **`readFile(…).catch(() => null)`, then parse outside it** | `f68a601`, 2026-08-26 18:11 |

`labels.ts` even wrote down *why*, and the reasoning transfers word for word:

> A checkpoint that is missing, unreadable or not JSON is worth exactly the same as one that is
> stale: nothing. So this returns `undefined` for all of them rather than distinguishing failures the
> caller has no different response to — and it deliberately does not throw, because the alternative
> to resuming is a run that works and costs money, not a run that cannot happen.

The same is true of `writeAtomic`, which existed in [`src/toc.ts`](../../src/toc.ts) and
[`src/labels.ts`](../../src/labels.ts) — with a comment saying in as many words that `writeFile`
truncates and a killed process leaves an invalid file — **eight hours before** the broken cache was
written, on the same day.

So this was not a hard problem nobody had thought about. It was a solved problem, solved twice, in
the two files nearest to this one, and the third instance of the same pattern did not copy either
half.

## The commit

- **[`f68a601`](../../src/pdf-read.ts)**, "Read a PDF with a model, and refuse to write half an
  article", 2026-08-26 18:11, introduced both halves in one hunk: `readFile(…).catch(() => null)` on
  one line, `JSON.parse(cached)` on the next, and `writeFile(cacheFile, …)` below.
- `b0bebab`, 2026-08-26 20:35, moved the write under `if (result.ok)` so a failed reading is not
  cached. That change is right and is untouched here; it did not create or notice either defect.

There is an irony in the title of the introducing commit. It refuses to write half an *article* —
`outFile` is written only once every chunk has passed — and then writes half a *chunk* without
noticing that the same argument applies to it, more strongly, because a half-written article is
re-made by the next run and a half-written chunk is not.

## The fix

Both halves, in [`src/pdf-read.ts`](../../src/pdf-read.ts):

- **`readCachedChunk`** — a damaged entry is a miss. It parses inside a `try`, and it accepts
  anything that parses to an object with a `records` array, which is deliberately the most tolerant
  test that still means something: a miss re-buys a vision-model call, so the check that keeps a
  valid entry usable matters as much as the one that tolerates a broken one. Nothing is asserted
  about the records themselves — `checkChunk` runs next and is far stricter than any shape test here
  could be.
- **It says so in the log** (`log("pipeline").warn`). An entry that had to be discarded is the only
  surviving trace that an earlier run was killed halfway through writing it; discard it silently and
  the crash leaves no record anywhere. This is the one thing this stage logs, and the comment on it
  says why it is not the cost line `src/pipeline.ts` owns.
- **`writeAtomic`** — write beside the target, then `rename`, which is atomic within a directory. The
  same four lines as the twins in `src/toc.ts` and `src/labels.ts`, duplicated for the reason given
  there. A killed process now leaves a `.tmp` file that no key ever addresses, instead of a corrupt
  entry under a key every future run computes.

Nothing deletes cache files, and that is still true — the repair happens by itself, because a chunk
re-read after a discard is written back over the damaged file.

### The tests, and the control for each

Four tests in [`tests/pdf-read.test.ts`](../../tests/pdf-read.test.ts) § the chunk cache. Every one
of them was watched failing, because a check nobody has seen fail is not evidence
([silent-success.md](../reusable/silent-success.md)):

| Test | Seen red by |
|---|---|
| a half-written entry is a miss, not a failure | the bug itself, before the fix: `SyntaxError` at `src/pdf-read.ts:814`, quoted above |
| a well-formed entry is read back — `asks` is **0** on the second run | making `readCachedChunk` return `null` always: `expected 2 to be +0` |
| only the damaged chunk is re-read — `asks` is **1**, not all of them | the same control: `expected 2 to be 1` |
| the discard is logged | deleting only the `warn` call: `expected +0 to be 1`, and nothing else red |
| no scratch file is left behind | replacing the `rename` with a second `writeFile`: `expected [ …(2) ] to deeply equal []` |

The second row is the one that guards the money. A fix for a corrupt entry that quietly turned
*every* entry into a miss would have passed the first test, looked correct, and re-bought the whole
transcription of every PDF on every run.

The logger is `silent` under vitest by construction (`src/log.ts` § level), so the log test replaces
the module rather than reading stdout.

## What would have caught the class

Not "be careful with `JSON.parse`". Three things, in the order they would have helped.

**1. One reader for on-disk JSON, not six.** There are at least six copies of "read this JSON file or
give me nothing" in `src/`, five correct and one not, and they are copies rather than calls. The
class is closed by making the tolerant read the only read: a single `readJsonIfPresent` (and a
single `writeAtomic`) that every stage imports, so a new cache cannot be written with the parse
outside the catch, because there is no place to put it. `src/labels.ts` argues *against* sharing —
"either writes atomically or it does not, and there is no middle behaviour to disagree about" —
and that argument is about `writeAtomic`, where it holds. It does not hold for the read: the reads
had already disagreed, in the way that costs money, and nobody could see it because the disagreement
is between two files that never mention each other.

**2. A rule about caches, stated where caches are: an entry whose key is deterministic must be
written atomically and read tolerantly.** Deterministic-key caching is the repo's own convention —
`architecture.md` § Conventions tells you to cache anything expensive on a content hash — and the
convention as written says nothing about durability. It should, because determinism is exactly what
turns a one-off corrupt file into a permanent one. Everything in the pipeline keyed on a content
hash is exposed to this shape.

**3. Ask what a killed process leaves behind.** Every one of these tests is cheap and none of them is
obvious to write, because the failure needs a *crash* to produce and no ordinary run ever produces
it. The trick that made it easy was doing the damage by hand rather than trying to stage a crash:
truncate the file to half its length, and the state a `SIGKILL` would have left is on disk in one
line. That works for any write-then-read pair in the repo and it is the reusable move here.

There is a fourth, weaker one worth naming because it nearly worked. `docs/plans/pdf-ingestion.md`
and the header of `src/pdf-read.ts` both describe the cache as the thing that makes a re-run free.
Neither says what happens if an entry is unreadable — and a design note that describes only the
happy path reads exactly like one that has considered both.

## See also

- [silent-success.md](../reusable/silent-success.md) — the family this belongs to. A crash reports
  nothing; the file that survives it looks like a cache hit right up to the moment it parses.
- [architecture.md § Conventions](../project/architecture.md#conventions) — the content-hash caching
  convention this is about.
- [`src/labels.ts`](../../src/labels.ts) — the sibling checkpoint that got both halves right first.
</content>
