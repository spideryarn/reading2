---
id: q-fneq6t
report: spya-u62q09
status: open
asked: 2026-10-09
title: The rename rule: should it name comments and database columns, as you did?
refs: SPIDERYARN-READING2-FW · qi-yckkzqah · docs/plans/261009x-metadata-ai-processing-named-as-the-modes-are.md · docs/user-feedback/261009_1225-metadata-ai-processing-named-as-the-modes-are.md · docs/reusable/rename-or-move.md
---
Your rule already says a rename goes all the way down, but its list leaves out two things you named: comments, and database columns (it says stored values, not column or table names). May I add them?

A. Add them (recommended). One sentence changes in docs/reusable/rename-or-move.md; the line in the agents' file already says "all the way down" and stays as it is.
  Before: "rename it everywhere in the same piece of work: identifiers, files, URL words, CSS classes, tests, docs, and stored values in the database (an ordinary migration that rewrites the value)."
  After: "rename it everywhere in the same piece of work: identifiers and the comments that use the name, file and folder names, URL words, CSS classes, tests, docs, log and event names, and the database, both the stored values and the column and table names (an ordinary migration)." Your words of 9 Oct would be quoted under it.
  Costs: nothing now. A rename that reaches a column is a bigger job, which is the point.

B. Leave the wording. "Everywhere" already covers it, and agents mostly do it.
  Gives up: the list is what agents check against, and a list that names stored values but not columns reads as if columns were optional.

Details

What you asked, on 9 Oct, on the Metadata page of the Attention paper: "if you rename stuff, make sure that you've renamed it thoroughly. So not just in the UI, but also variables and comments and file names and database columns and whatever else."

The rule you mean is "A rename on screen is a rename all the way down", in the rename instructions every agent follows. It came from your words of 6 Oct. Rule docs are changed only with your yes, one change at a time, so this asks rather than edits.

The first half of the same report is done: the AI processing section on the Metadata page now names each item the way the mode bar does (Summary › Thread, Learn › Quiz, Sources › Reception), with one line under each saying what it is. Items that are not a mode (the arc, relation words, cross-references) say where they show up. Both lists in that section, and the "start again" row, take their names from one table, so the next rename of a mode changes them all.
