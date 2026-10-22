---
id: q-rymrtq
report: spya-e5t77w
status: open
asked: 2026-10-22
title: When a review discusses the books it cites, should their authors get glossary entries?
refs: qi-zyr6rsh4 · docs/plans/261022f-explain-this-and-a-glossary-that-scales-with-length.md · docs/user-feedback/261021_2311-torricelli-explain-names-the-glossary-missed.md
---
Your Torricelli fix (glossary entries for names met once, in passing) has a side effect on literature reviews: the glossary now sometimes gives an entry to the author of a book the review cites and talks about, which your 3 October rule ("That's what citations are for") had kept out. Which do you want?

A. Accept it (what is live on dev now). On the one review tested, a run adds 0 to 4 such entries, for example "Stenhoff: author of the 1999 book Ball Lightning, with about 2,400 references". Each is true and reads like a passing name. Hide removes one. Costs nothing more.

B. Drop them in code: an entry whose name matches an author in the article's own reference list is removed. Clean on reviews, but it would probably also remove people the piece tells about and also cites (on the same review, likely Arago, Jennison and Haidinger; not yet checked), which are the Torricelli-like names you asked for. A small change, plus an eval run.

C. Go back to leaving passing names out, and rely on Find more and Look up for names like Torricelli. Undoes the main part of the fix.

Recommendation: A. The entries are on the line between your two rules rather than over it, the cost is a few entries on one kind of piece, and B removes the names you wanted.

Details

What you asked (21 October, on Rovelli's The Order of Time): you met "Torricelli", did not know who it was, and nothing made it one click away. The glossary had missed him for two reasons. It asked for at most 20 terms whatever the length, so a 38,000-word book got 21. And its instructions deliberately left out names the argument does not rest on.

What was done: the count now follows the length (up to 80), a long piece is worked through part by part, and a person, place, work or event named without introduction gets an entry even when named once. On your book a first run now gives about 70 entries, Torricelli included, and one press of Find more on your existing list does the same.

The side effect: the old instructions had a line against citations: a work the piece only points at as a source, and its authors, get no entry, because Citations lists them. The new names rule pulls the other way. We tested on four pieces. Three were fine. On one, a review of research on ball lightning that spends a section on the books before it, three runs gave 4, 0 and 2 entries for authors of those books (Stenhoff, Rakov and Uman, Walther Brand, Stanley Singer). The previous version gave none in 15 runs. A rewording of the instructions did not help. A citation written as "Stenhoff (1999)" is already stopped from becoming an underlined alias.

What would decide it: whether, reading a review, a one-line "who wrote this and what is the book" card on such a name helps you (A) or clutters the glossary with things Citations already lists (B).
